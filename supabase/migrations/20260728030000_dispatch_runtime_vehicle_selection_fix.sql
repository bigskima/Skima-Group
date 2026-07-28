begin;

create or replace function public.dispatch_service_request(
  target_service_request_id uuid,
  target_dispatch_policy_key text default null,
  target_candidate_limit integer default 5,
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request_record record;
  policy_record record;
  dispatch_request_id uuid;
  candidate_record record;
  candidate_rank integer := 0;
  required_capabilities text[];
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.dispatch.execute', null)
    and not public.can_execute_platform_runtime() then
    raise exception 'dispatch execution permission is required';
  end if;

  if target_service_request_id is null then
    raise exception 'target_service_request_id is required';
  end if;

  if target_candidate_limit is null or target_candidate_limit <= 0 or target_candidate_limit > 50 then
    raise exception 'target_candidate_limit must be between 1 and 50';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select request.*
  into request_record
  from public.service_requests request
  where request.id = target_service_request_id
  for update;

  if not found then
    raise exception 'target_service_request_id must reference an existing service request';
  end if;

  if target_dispatch_policy_key is not null then
    select policy.*
    into policy_record
    from public.dispatch_policies policy
    where policy.key = target_dispatch_policy_key
      and policy.status = 'active';
  elsif request_record.dispatch_policy_id is not null then
    select policy.*
    into policy_record
    from public.dispatch_policies policy
    where policy.id = request_record.dispatch_policy_id
      and policy.status = 'active';
  else
    select policy.*
    into policy_record
    from public.dispatch_policies policy
    where policy.status = 'active'
    order by policy.created_at asc
    limit 1;
  end if;

  if not found then
    raise exception 'an active dispatch policy is required for this service request';
  end if;

  select array_agg(required.value)
  into required_capabilities
  from jsonb_array_elements_text(
    coalesce(policy_record.rules -> 'required_capabilities', '[]'::jsonb)
  ) as required(value);

  required_capabilities := coalesce(required_capabilities, array[]::text[]);

  dispatch_request_id := public.create_dispatch_request(
    policy_record.key,
    'platform.dispatch_engine',
    'service_request',
    target_service_request_id,
    jsonb_build_object('required_capabilities', required_capabilities),
    coalesce(request_record.request_payload -> 'pickup_location', '{}'::jsonb),
    coalesce(request_record.request_payload -> 'dropoff_location', '{}'::jsonb),
    coalesce((request_record.request_payload ->> 'priority')::integer, 100),
    jsonb_build_object('module_id', request_record.module_id),
    target_idempotency_key || ':request'
  );

  for candidate_record in
    select
      driver.id as driver_id,
      driver.user_id,
      count(capability.id) as matching_capability_count,
      selected_vehicle.id as vehicle_id
    from public.driver_profiles driver
    left join public.entity_capabilities capability
      on capability.entity_type = 'driver'
      and capability.entity_id = driver.id
      and capability.status = 'active'
      and (
        array_length(required_capabilities, 1) is null
        or capability.capability_key = any(required_capabilities)
      )
    left join lateral (
      select vehicle.id
      from public.vehicles vehicle
      where vehicle.owner_user_id = driver.user_id
        and vehicle.status = 'active'
      order by vehicle.created_at asc
      limit 1
    ) selected_vehicle on true
    where driver.verification_status = 'approved'
      and driver.operational_status = 'available'
    group by driver.id, driver.user_id, selected_vehicle.id
    having array_length(required_capabilities, 1) is null
      or count(capability.id) >= array_length(required_capabilities, 1)
    order by count(capability.id) desc, driver.created_at asc
    limit target_candidate_limit
  loop
    candidate_rank := candidate_rank + 1;

    perform public.upsert_dispatch_candidate(
      dispatch_request_id,
      'driver',
      candidate_record.driver_id,
      greatest(100 - (candidate_rank - 1) * 5, 1),
      candidate_rank,
      jsonb_build_object(
        'matching_capability_count',
        candidate_record.matching_capability_count,
        'vehicle_id',
        candidate_record.vehicle_id,
        'selection_mode',
        policy_record.matching_strategy
      ),
      case when candidate_rank = 1 then 'offered' else 'suggested' end,
      target_idempotency_key || ':candidate:' || candidate_rank::text
    );
  end loop;

  if candidate_rank = 0 then
    raise exception 'no eligible dispatch candidates found';
  end if;

  update public.service_requests
  set dispatch_policy_id = policy_record.id,
      status = 'matching',
      updated_at = timezone('utc', now())
  where id = target_service_request_id;

  insert into public.service_request_events (
    service_request_id,
    event_type_key,
    status,
    idempotency_key,
    metadata
  )
  values (
    target_service_request_id,
    'event.driver.matched',
    'matching',
    target_idempotency_key || ':matched',
    jsonb_build_object('dispatch_request_id', dispatch_request_id, 'candidate_count', candidate_rank)
  )
  on conflict do nothing;

  return dispatch_request_id;
end;
$$;

revoke all on function public.dispatch_service_request(uuid, text, integer, text) from public;
revoke all on function public.dispatch_service_request(uuid, text, integer, text) from anon;
grant execute on function public.dispatch_service_request(uuid, text, integer, text)
to authenticated, service_role;

commit;
