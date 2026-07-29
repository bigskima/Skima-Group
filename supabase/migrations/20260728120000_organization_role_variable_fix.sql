begin;

create or replace function public.configure_organization_role(
  target_organization_id uuid,
  target_role_key text,
  target_display_name text,
  target_permission_keys text[],
  target_description text,
  target_branch_id uuid,
  target_source text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  configured_role_id uuid;
  permission_key text;
  permission_count integer;
begin
  if not public.can_manage_organization_staff(target_organization_id) then
    raise exception 'organization staff management permission is required';
  end if;

  if target_role_key is null or target_role_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_role_key must be a valid platform key';
  end if;

  if target_display_name is null or btrim(target_display_name) = '' then
    raise exception 'target_display_name is required';
  end if;

  if target_permission_keys is null or array_length(target_permission_keys, 1) is null then
    raise exception 'target_permission_keys is required';
  end if;

  foreach permission_key in array target_permission_keys loop
    if permission_key is null or permission_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
      raise exception 'target_permission_keys contains an invalid permission key';
    end if;

    if permission_key like 'platform.%' then
      raise exception 'organization roles cannot grant platform permissions';
    end if;
  end loop;

  select count(*)
  into permission_count
  from public.permissions permission_record
  where permission_record.key = any(target_permission_keys);

  if permission_count <> array_length(target_permission_keys, 1) then
    raise exception 'target_permission_keys must reference configured permissions';
  end if;

  if target_branch_id is not null and not exists (
    select 1
    from public.organization_branches branch
    where branch.id = target_branch_id
      and branch.organization_id = target_organization_id
      and branch.status = 'active'
  ) then
    raise exception 'target_branch_id must reference an active branch in the organization';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  insert into public.roles (
    organization_id,
    key,
    display_name,
    description,
    status,
    metadata
  )
  values (
    target_organization_id,
    target_role_key,
    target_display_name,
    target_description,
    'active',
    target_metadata || jsonb_build_object(
      'source',
      target_source,
      'idempotency_key',
      target_idempotency_key,
      'branch_id',
      target_branch_id
    )
  )
  on conflict do nothing
  returning id into configured_role_id;

  if configured_role_id is null then
    select existing.id
    into configured_role_id
    from public.roles existing
    where existing.organization_id = target_organization_id
      and existing.key = target_role_key;

    if configured_role_id is null then
      raise exception 'organization role idempotency lookup failed';
    end if;

    update public.roles
    set display_name = target_display_name,
        description = target_description,
        status = 'active',
        metadata = metadata || target_metadata || jsonb_build_object(
          'source',
          target_source,
          'idempotency_key',
          target_idempotency_key,
          'branch_id',
          target_branch_id
        ),
        updated_at = timezone('utc', now())
    where id = configured_role_id;
  end if;

  delete from public.role_permissions
  where role_permissions.role_id = configured_role_id;

  insert into public.role_permissions (
    role_id,
    permission_id,
    conditions
  )
  select
    configured_role_id,
    permission_record.id,
    jsonb_build_object('branch_id', target_branch_id)
  from public.permissions permission_record
  where permission_record.key = any(target_permission_keys);

  perform public.record_organization_staff_event(
    target_organization_id,
    'event.organization.role.configured',
    target_idempotency_key || ':event',
    null,
    null,
    configured_role_id,
    target_branch_id,
    null,
    'active',
    target_metadata || jsonb_build_object('permission_keys', target_permission_keys)
  );

  return configured_role_id;
end;
$$;

commit;
