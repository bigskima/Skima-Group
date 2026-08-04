begin;

create or replace function public.assign_lpg_station_role(
  target_station_branch_id uuid,
  target_user_id uuid,
  target_preset_key text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  station_record record;
  preset_record record;
  resolved_role_id uuid;
  assigned_user_role_id uuid;
begin
  if target_station_branch_id is null or target_user_id is null then
    raise exception 'target_station_branch_id and target_user_id are required';
  end if;

  if target_preset_key is null or target_preset_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_preset_key must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select station.*
  into station_record
  from public.lpg_station_branches station
  where station.id = target_station_branch_id;

  if not found then
    raise exception 'target_station_branch_id must reference an LPG station branch';
  end if;

  if auth.role() <> 'service_role'
    and not public.can_operate_lpg_station_branch(target_station_branch_id, 'lpg.stations.manage')
    and not public.has_permission('business.staff.manage', station_record.organization_id) then
    raise exception 'station staff management permission is required';
  end if;

  select preset.*
  into preset_record
  from public.lpg_station_role_presets preset
  where preset.key = target_preset_key
    and preset.status = 'active';

  if not found then
    raise exception 'target_preset_key must reference an active LPG station role preset';
  end if;

  select role.id
  into resolved_role_id
  from public.roles role
  where role.organization_id = station_record.organization_id
    and role.key = preset_record.role_key
    and role.status = 'active';

  if not found then
    raise exception 'station role preset has not been configured for this organization';
  end if;

  insert into public.organization_memberships (
    organization_id,
    user_id,
    membership_type,
    status,
    metadata,
    created_by
  )
  values (
    station_record.organization_id,
    target_user_id,
    preset_record.membership_type,
    'active',
    target_metadata || jsonb_build_object(
      'station_branch_id',
      target_station_branch_id,
      'preset_key',
      target_preset_key
    ),
    auth.uid()
  )
  on conflict (organization_id, user_id) do update
  set membership_type = case
        when public.organization_memberships.membership_type = 'owner' then 'owner'
        else excluded.membership_type
      end,
      status = 'active',
      metadata = public.organization_memberships.metadata || excluded.metadata,
      updated_at = timezone('utc', now());

  insert into public.user_roles (
    organization_id,
    user_id,
    role_id,
    branch_id,
    status,
    created_by
  )
  values (
    station_record.organization_id,
    target_user_id,
    resolved_role_id,
    station_record.branch_id,
    'active',
    auth.uid()
  )
  on conflict (organization_id, user_id, role_id) do update
  set branch_id = coalesce(public.user_roles.branch_id, excluded.branch_id),
      status = 'active',
      updated_at = timezone('utc', now())
  returning id into assigned_user_role_id;

  perform public.record_organization_staff_event(
    station_record.organization_id,
    'event.organization.role.assigned',
    target_idempotency_key || ':event',
    target_user_id,
    null,
    resolved_role_id,
    station_record.branch_id,
    null,
    'active',
    target_metadata || jsonb_build_object(
      'station_branch_id',
      target_station_branch_id,
      'preset_key',
      target_preset_key
    )
  );

  return assigned_user_role_id;
end;
$$;

commit;
