create or replace function public.set_lpg_service_coverage_status(
  target_area_id uuid,
  target_status text,
  target_reason text,
  target_idempotency_key text,
  target_source text default 'skima.lpg.service_coverage_admin'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  latest_rule_id uuid;
begin
  if not public.can_manage_lpg_service_coverage() then
    raise exception using errcode = '42501', message = 'LPG service coverage management permission is required';
  end if;
  if target_status not in ('active','inactive') then
    raise exception using errcode = '22023', message = 'coverage status must be active or inactive';
  end if;
  if target_reason is null or btrim(target_reason) = '' then
    raise exception using errcode = '22023', message = 'reason is required';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception using errcode = '22023', message = 'idempotency key is required';
  end if;

  update public.service_areas
  set
    status = target_status,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'lastStatusReason', btrim(target_reason),
      'lastStatusChangedAt', timezone('utc', now()),
      'lastStatusChangedBy', auth.uid(),
      'statusChangeIdempotencyKey', target_idempotency_key,
      'statusChangeSource', target_source
    ),
    updated_at = timezone('utc', now())
  where id = target_area_id;

  if not found then
    raise exception using errcode = '22023', message = 'coverage area could not be found';
  end if;

  if target_status = 'inactive' then
    update public.lpg_service_area_rules
    set
      status = 'inactive',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'lastStatusReason', btrim(target_reason),
        'statusChangeIdempotencyKey', target_idempotency_key,
        'statusChangeSource', target_source
      ),
      updated_at = timezone('utc', now())
    where area_id = target_area_id
      and status = 'active';
  else
    select id into latest_rule_id
    from public.lpg_service_area_rules
    where area_id = target_area_id
    order by created_at desc, id desc
    limit 1;

    if latest_rule_id is null then
      raise exception using errcode = '22023', message = 'coverage area has no saved service decision to reactivate';
    end if;

    update public.lpg_service_area_rules
    set status = 'inactive', updated_at = timezone('utc', now())
    where area_id = target_area_id
      and id <> latest_rule_id
      and status = 'active';

    update public.lpg_service_area_rules
    set
      status = 'active',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'lastStatusReason', btrim(target_reason),
        'statusChangeIdempotencyKey', target_idempotency_key,
        'statusChangeSource', target_source
      ),
      updated_at = timezone('utc', now())
    where id = latest_rule_id;
  end if;

  return target_area_id;
end;
$$;

revoke all on function public.set_lpg_service_coverage_status(uuid,text,text,text,text) from public, anon;
grant execute on function public.set_lpg_service_coverage_status(uuid,text,text,text,text) to authenticated, service_role;
