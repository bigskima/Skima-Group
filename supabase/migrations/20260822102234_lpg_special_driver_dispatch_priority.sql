update public.lpg_operation_policies
set policy=policy || jsonb_build_object(
      'special_driver_priority_enabled',true,
      'special_driver_priority_bonus_meters',1000
    ),
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'driver_participation_priority_model','bounded_distance_bonus',
      'driver_participation_priority_fairness','special priority is bounded; proximity, workload, capacity and route bundling can still rank an independent driver first'
    ),
    updated_at=timezone('utc',now())
where key='lpg.dispatch.phase_one' and status='active';

create or replace function public.read_lpg_driver_priority_policy()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare policy_record public.lpg_operation_policies%rowtype;
begin
  if auth.role()<>'service_role'
    and not public.has_permission('platform.dispatch.read',null)
    and not public.has_permission('platform.dispatch.manage',null)
    and not public.has_permission('platform.drivers.read',null)
    and not public.has_permission('platform.drivers.manage',null) then
    raise exception using errcode='42501',message='dispatch or driver read permission required';
  end if;

  select * into policy_record
  from public.lpg_operation_policies
  where key='lpg.dispatch.phase_one' and status='active'
  limit 1;
  if not found then raise exception using errcode='55000',message='active LPG dispatch policy is required'; end if;

  return jsonb_build_object(
    'specialDriverPriorityEnabled',coalesce((policy_record.policy->>'special_driver_priority_enabled')::boolean,true),
    'specialDriverPriorityBonusMeters',coalesce(nullif(policy_record.policy->>'special_driver_priority_bonus_meters','')::numeric,1000),
    'specialDriverPriorityBonusKilometers',round((coalesce(nullif(policy_record.policy->>'special_driver_priority_bonus_meters','')::numeric,1000)/1000.0)::numeric,2),
    'fairnessModel','bounded_distance_bonus',
    'updatedAt',policy_record.updated_at
  );
end;
$$;

create or replace function public.set_lpg_driver_priority_policy(
  target_enabled boolean,
  target_bonus_meters numeric,
  target_reason text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare policy_record public.lpg_operation_policies%rowtype;
begin
  if auth.role()<>'service_role' and not public.has_permission('platform.dispatch.manage',null) then
    raise exception using errcode='42501',message='dispatch management permission required';
  end if;
  if target_enabled is null then raise exception using errcode='22023',message='priority enabled setting is required'; end if;
  if target_bonus_meters is null or target_bonus_meters<0 or target_bonus_meters>5000 then
    raise exception using errcode='22023',message='special driver priority advantage must be between 0 and 5 kilometres';
  end if;
  if char_length(btrim(coalesce(target_reason,'')))<3 then raise exception using errcode='22023',message='change reason is required'; end if;
  if coalesce(btrim(target_idempotency_key),'')='' then raise exception using errcode='22023',message='idempotency key is required'; end if;
  if target_metadata is null or jsonb_typeof(target_metadata)<>'object' then raise exception using errcode='22023',message='metadata must be an object'; end if;

  select * into policy_record
  from public.lpg_operation_policies
  where key='lpg.dispatch.phase_one' and status='active'
  for update;
  if not found then raise exception using errcode='55000',message='active LPG dispatch policy is required'; end if;

  if policy_record.metadata->>'driver_participation_priority_last_idempotency_key'=target_idempotency_key then
    return public.read_lpg_driver_priority_policy();
  end if;

  update public.lpg_operation_policies
  set policy=policy || jsonb_build_object(
        'special_driver_priority_enabled',target_enabled,
        'special_driver_priority_bonus_meters',round(target_bonus_meters,0)
      ),
      metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'driver_participation_priority_model','bounded_distance_bonus',
        'driver_participation_priority_last_reason',btrim(target_reason),
        'driver_participation_priority_last_idempotency_key',target_idempotency_key,
        'driver_participation_priority_last_changed_by',auth.uid(),
        'driver_participation_priority_last_changed_at',timezone('utc',now())
      ) || target_metadata,
      updated_at=timezone('utc',now())
  where key='lpg.dispatch.phase_one' and status='active';

  return public.read_lpg_driver_priority_policy();
end;
$$;

revoke all on function public.read_lpg_driver_priority_policy() from public,anon;
revoke all on function public.set_lpg_driver_priority_policy(boolean,numeric,text,text,jsonb) from public,anon;
grant execute on function public.read_lpg_driver_priority_policy() to authenticated,service_role;
grant execute on function public.set_lpg_driver_priority_policy(boolean,numeric,text,text,jsonb) to authenticated,service_role;

create or replace function public.dispatch_lpg_order(
  target_lpg_order_id uuid,
  target_candidate_limit integer default null,
  target_idempotency_key text default null,
  target_source text default 'lpg.dispatch_api'
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  order_record record;
  station_record record;
  dispatch_request_id uuid;
  candidate_record record;
  candidate_rank integer := 0;
  selected_driver_profile_id uuid;
  selected_vehicle_id uuid;
  selected_active_order_count integer := 0;
  selected_program_key text := 'driver.independent';
  selected_priority_bonus numeric := 0;
  existing_dispatch_request_id uuid;
  dispatch_policy jsonb;
  policy_candidate_limit integer;
  freshness_seconds integer;
  max_driver_distance_meters numeric;
  offer_ttl_seconds integer;
  reservation_ttl_seconds integer;
  driver_required jsonb;
  vehicle_required jsonb;
  configured_dispatch_policy_key text;
  dispatch_policy_key text;
  reservation_id uuid;
  allow_concurrent boolean;
  max_driver_orders integer;
  max_vehicle_orders integer;
  workload_penalty numeric;
  same_station_bonus numeric;
  same_customer_bonus numeric;
  special_priority_enabled boolean;
  special_priority_bonus numeric;
begin
  if auth.role()<>'service_role'
    and not public.has_permission('lpg.dispatch.execute',null)
    and not public.can_manage_lpg_operations() then
    raise exception 'LPG dispatch permission is required';
  end if;

  if target_lpg_order_id is null then raise exception 'target_lpg_order_id is required'; end if;
  if target_idempotency_key is null or btrim(target_idempotency_key)='' then raise exception 'target_idempotency_key is required'; end if;

  dispatch_policy:=public.lpg_policy_config('lpg.dispatch.phase_one');
  policy_candidate_limit:=nullif(dispatch_policy->>'candidate_limit','')::integer;
  freshness_seconds:=nullif(dispatch_policy->>'driver_location_freshness_seconds','')::integer;
  max_driver_distance_meters:=nullif(dispatch_policy->>'max_driver_distance_meters','')::numeric;
  offer_ttl_seconds:=nullif(dispatch_policy->>'offer_ttl_seconds','')::integer;
  reservation_ttl_seconds:=nullif(dispatch_policy->>'capacity_reservation_ttl_seconds','')::integer;
  driver_required:=coalesce(dispatch_policy->'required_driver_capabilities','[]'::jsonb);
  vehicle_required:=coalesce(dispatch_policy->'required_vehicle_capabilities','[]'::jsonb);
  allow_concurrent:=coalesce((dispatch_policy->>'allow_concurrent_assignments')::boolean,true);
  max_driver_orders:=coalesce(nullif(dispatch_policy->>'max_concurrent_orders_per_driver','')::integer,12);
  max_vehicle_orders:=coalesce(nullif(dispatch_policy->>'max_concurrent_orders_per_vehicle','')::integer,max_driver_orders);
  workload_penalty:=coalesce(nullif(dispatch_policy->>'workload_penalty_meters_per_order','')::numeric,650);
  same_station_bonus:=coalesce(nullif(dispatch_policy->>'same_station_bundle_bonus_meters','')::numeric,900);
  same_customer_bonus:=coalesce(nullif(dispatch_policy->>'same_customer_bundle_bonus_meters','')::numeric,1400);
  special_priority_enabled:=coalesce((dispatch_policy->>'special_driver_priority_enabled')::boolean,true);
  special_priority_bonus:=coalesce(nullif(dispatch_policy->>'special_driver_priority_bonus_meters','')::numeric,1000);

  if not allow_concurrent then max_driver_orders:=1; max_vehicle_orders:=1; end if;

  if policy_candidate_limit is null or policy_candidate_limit<=0 or policy_candidate_limit>25
    or freshness_seconds is null or freshness_seconds<=0
    or max_driver_distance_meters is null or max_driver_distance_meters<=0
    or offer_ttl_seconds is null or offer_ttl_seconds<=0
    or reservation_ttl_seconds is null or reservation_ttl_seconds<=0
    or max_driver_orders<=0 or max_driver_orders>100
    or max_vehicle_orders<=0 or max_vehicle_orders>100
    or workload_penalty<0 or same_station_bonus<0 or same_customer_bonus<0
    or special_priority_bonus<0 or special_priority_bonus>5000
    or jsonb_typeof(driver_required)<>'array'
    or jsonb_typeof(vehicle_required)<>'array' then
    raise exception 'LPG dispatch policy is incomplete';
  end if;

  target_candidate_limit:=least(coalesce(target_candidate_limit,policy_candidate_limit),policy_candidate_limit);
  if target_candidate_limit<=0 or target_candidate_limit>25 then raise exception 'target_candidate_limit must be between 1 and 25'; end if;

  configured_dispatch_policy_key:=public.lpg_policy_config('lpg.quote.phase_one')->>'dispatch_policy_key';
  if configured_dispatch_policy_key is null then raise exception 'LPG quote policy must define dispatch_policy_key'; end if;

  select policy.key into dispatch_policy_key
  from public.dispatch_policies policy
  where policy.key=configured_dispatch_policy_key and policy.status='active'
  limit 1;
  if dispatch_policy_key is null then raise exception 'active LPG dispatch policy is required'; end if;

  select target_order.*,
         pickup.latitude as pickup_latitude,
         pickup.longitude as pickup_longitude,
         delivery.latitude as delivery_latitude,
         delivery.longitude as delivery_longitude,
         cylinder.size_kg as cylinder_size_kg
  into order_record
  from public.lpg_refill_orders target_order
  join public.lpg_customer_locations pickup on pickup.id=target_order.pickup_location_id
  join public.lpg_customer_locations delivery on delivery.id=target_order.delivery_location_id
  join public.lpg_cylinders cylinder on cylinder.id=target_order.cylinder_id
  where target_order.id=target_lpg_order_id
  for update of target_order;
  if not found then raise exception 'target_lpg_order_id must reference an LPG order'; end if;

  existing_dispatch_request_id:=nullif(order_record.metadata->>'dispatch_request_id','')::uuid;
  if existing_dispatch_request_id is not null and order_record.metadata->>'dispatch_idempotency_key'=target_idempotency_key then
    return existing_dispatch_request_id;
  end if;

  if order_record.status not in ('payment_reserved','matching_station','matching_driver','driver_offered') then
    raise exception 'LPG order must be funded before dispatch';
  end if;

  if order_record.station_branch_id is not null then
    select station.* into station_record
    from public.lpg_station_branches station
    where station.id=order_record.station_branch_id
      and station.approval_status='approved'
      and station.compliance_status='approved'
      and station.availability_status='available'
      and station.current_available_kg>=order_record.requested_kg
    for update;
  else
    select station.* into station_record
    from public.lpg_station_branches station
    where station.approval_status='approved'
      and station.compliance_status='approved'
      and station.availability_status='available'
      and station.current_available_kg>=order_record.requested_kg
      and (array_length(station.supported_cylinder_sizes_kg,1) is null or order_record.cylinder_size_kg=any(station.supported_cylinder_sizes_kg))
      and public.lpg_distance_meters(order_record.pickup_latitude,order_record.pickup_longitude,station.latitude,station.longitude)<=station.service_radius_meters
    order by public.lpg_distance_meters(order_record.pickup_latitude,order_record.pickup_longitude,station.latitude,station.longitude) asc,
             station.current_available_kg desc,
             station.created_at asc
    limit 1
    for update;
  end if;
  if not found then raise exception 'no eligible LPG station is available for this order'; end if;

  dispatch_request_id:=public.create_dispatch_request(
    dispatch_policy_key,target_source,'lpg_order',order_record.id,
    jsonb_build_object('driver_required_capabilities',driver_required,'vehicle_required_capabilities',vehicle_required),
    jsonb_build_object('latitude',order_record.pickup_latitude,'longitude',order_record.pickup_longitude),
    jsonb_build_object('latitude',order_record.delivery_latitude,'longitude',order_record.delivery_longitude),
    100,
    jsonb_build_object(
      'bounded_context','lpg',
      'station_branch_id',station_record.id,
      'candidate_limit',target_candidate_limit,
      'max_driver_distance_meters',max_driver_distance_meters,
      'allow_concurrent_assignments',allow_concurrent,
      'max_concurrent_orders_per_driver',max_driver_orders,
      'max_concurrent_orders_per_vehicle',max_vehicle_orders,
      'special_driver_priority_enabled',special_priority_enabled,
      'special_driver_priority_bonus_meters',special_priority_bonus
    ),
    target_idempotency_key||':dispatch-request'
  );

  for candidate_record in
    select candidate.*
    from (
      select
        driver.id as driver_profile_id,
        selected_vehicle.id as vehicle_id,
        latest_location.recorded_at,
        public.lpg_distance_meters(order_record.pickup_latitude,order_record.pickup_longitude,latest_location.latitude,latest_location.longitude) as distance_meters,
        workload.active_order_count,
        workload.active_vehicle_order_count,
        workload.same_station_order_count,
        workload.same_customer_order_count,
        coalesce(participation.program_key,'driver.independent') as participation_program_key,
        case when special_priority_enabled and coalesce(participation.program_key,'driver.independent')='driver.skima_special'
          then special_priority_bonus else 0 end as participation_priority_bonus_meters,
        greatest(
          public.lpg_distance_meters(order_record.pickup_latitude,order_record.pickup_longitude,latest_location.latitude,latest_location.longitude)
          + workload.active_order_count*workload_penalty
          - workload.same_station_order_count*same_station_bonus
          - workload.same_customer_order_count*same_customer_bonus
          - case when special_priority_enabled and coalesce(participation.program_key,'driver.independent')='driver.skima_special'
              then special_priority_bonus else 0 end,
          0
        ) as dispatch_cost
      from public.driver_profiles driver
      join public.driver_vehicle_links vehicle_link
        on vehicle_link.driver_profile_id=driver.id
        and vehicle_link.status='active'
        and vehicle_link.starts_at<=timezone('utc',now())
        and (vehicle_link.ends_at is null or vehicle_link.ends_at>timezone('utc',now()))
      join public.vehicles selected_vehicle
        on selected_vehicle.id=vehicle_link.vehicle_id
        and selected_vehicle.status='active'
      join lateral (
        select location.latitude,location.longitude,location.recorded_at
        from public.lpg_driver_locations location
        where location.driver_profile_id=driver.id
          and location.online_status='online'
          and location.recorded_at>=timezone('utc',now())-make_interval(secs=>freshness_seconds)
        order by location.recorded_at desc
        limit 1
      ) latest_location on true
      join lateral (
        select count(*)::integer as active_order_count,
               count(*) filter(where active.vehicle_id=selected_vehicle.id)::integer as active_vehicle_order_count,
               count(*) filter(where active.station_branch_id=station_record.id)::integer as same_station_order_count,
               count(*) filter(where active.customer_user_id=order_record.customer_user_id)::integer as same_customer_order_count
        from public.lpg_refill_orders active
        where active.driver_profile_id=driver.id
          and active.id<>order_record.id
          and active.status not in ('completed','cancelled','refunded','failed')
      ) workload on true
      left join lateral (
        select membership.program_key
        from public.driver_program_memberships membership
        join public.driver_participation_programs program on program.key=membership.program_key and program.status='active'
        where membership.driver_profile_id=driver.id
          and membership.status='active'
          and membership.ends_at is null
          and membership.starts_at<=timezone('utc',now())
        order by membership.starts_at desc
        limit 1
      ) participation on true
      where driver.verification_status='approved'
        and driver.operational_status in ('available','busy')
        and workload.active_order_count<max_driver_orders
        and workload.active_vehicle_order_count<max_vehicle_orders
        and not exists (
          select 1 from jsonb_array_elements_text(driver_required) required_capability(capability_key)
          where not exists (
            select 1 from public.entity_capabilities driver_capability
            where driver_capability.entity_type='driver'
              and driver_capability.entity_id=driver.id
              and driver_capability.capability_key=required_capability.capability_key
              and driver_capability.status='active'
          )
        )
        and not exists (
          select 1 from jsonb_array_elements_text(vehicle_required) required_capability(capability_key)
          where not exists (
            select 1 from public.entity_capabilities vehicle_capability
            where vehicle_capability.entity_type='vehicle'
              and vehicle_capability.entity_id=selected_vehicle.id
              and vehicle_capability.capability_key=required_capability.capability_key
              and vehicle_capability.status='active'
          )
        )
        and public.lpg_distance_meters(order_record.pickup_latitude,order_record.pickup_longitude,latest_location.latitude,latest_location.longitude)<=max_driver_distance_meters
    ) candidate
    order by candidate.dispatch_cost asc,candidate.distance_meters asc,candidate.recorded_at desc,candidate.driver_profile_id asc
    limit target_candidate_limit
  loop
    candidate_rank:=candidate_rank+1;

    if candidate_rank=1 then
      selected_driver_profile_id:=candidate_record.driver_profile_id;
      selected_vehicle_id:=candidate_record.vehicle_id;
      selected_active_order_count:=candidate_record.active_order_count;
      selected_program_key:=candidate_record.participation_program_key;
      selected_priority_bonus:=candidate_record.participation_priority_bonus_meters;
    end if;

    perform public.upsert_dispatch_candidate(
      dispatch_request_id,'driver',candidate_record.driver_profile_id,
      greatest(1000000-coalesce(candidate_record.dispatch_cost,1000000),1),candidate_rank,
      jsonb_build_object(
        'vehicle_id',candidate_record.vehicle_id,
        'distance_meters',candidate_record.distance_meters,
        'location_recorded_at',candidate_record.recorded_at,
        'active_order_count',candidate_record.active_order_count,
        'active_vehicle_order_count',candidate_record.active_vehicle_order_count,
        'same_station_order_count',candidate_record.same_station_order_count,
        'same_customer_order_count',candidate_record.same_customer_order_count,
        'remaining_driver_slots_before_assignment',greatest(max_driver_orders-candidate_record.active_order_count,0),
        'remaining_vehicle_slots_before_assignment',greatest(max_vehicle_orders-candidate_record.active_vehicle_order_count,0),
        'participation_program_key',candidate_record.participation_program_key,
        'participation_priority_bonus_meters',candidate_record.participation_priority_bonus_meters,
        'dispatch_cost',candidate_record.dispatch_cost,
        'selection_mode','lpg_capacity_route_bundle_with_bounded_driver_priority'
      ),
      case when candidate_rank=1 then 'offered' else 'suggested' end,
      target_idempotency_key||':candidate:'||candidate_rank::text
    );
  end loop;

  if candidate_rank=0 then raise exception 'no eligible LPG driver has fresh location and remaining assignment capacity'; end if;

  update public.lpg_station_branches
  set current_available_kg=current_available_kg-order_record.requested_kg,
      availability_status=case when current_available_kg-order_record.requested_kg<=0 then 'capacity_reached' else availability_status end,
      updated_at=timezone('utc',now())
  where id=station_record.id and current_available_kg>=order_record.requested_kg;
  if not found then raise exception 'station capacity could not be reserved'; end if;

  insert into public.lpg_station_capacity_reservations(
    lpg_order_id,station_branch_id,requested_kg,reserved_kg,status,expires_at,metadata,source,idempotency_key
  ) values (
    order_record.id,station_record.id,order_record.requested_kg,order_record.requested_kg,'reserved',
    timezone('utc',now())+make_interval(secs=>reservation_ttl_seconds),
    jsonb_build_object('dispatch_request_id',dispatch_request_id),target_source,target_idempotency_key||':capacity'
  )
  on conflict(lpg_order_id) do update
  set station_branch_id=excluded.station_branch_id,
      requested_kg=excluded.requested_kg,
      reserved_kg=excluded.reserved_kg,
      status='reserved',
      expires_at=excluded.expires_at,
      metadata=public.lpg_station_capacity_reservations.metadata||excluded.metadata,
      updated_at=timezone('utc',now())
  returning id into reservation_id;

  update public.dispatch_requests
  set assigned_entity_type='driver',
      assigned_entity_id=selected_driver_profile_id,
      metadata=metadata||jsonb_build_object(
        'vehicle_id',selected_vehicle_id,
        'capacity_reservation_id',reservation_id,
        'driver_active_orders_before_assignment',selected_active_order_count,
        'concurrent_assignment',selected_active_order_count>0,
        'driver_participation_program_key',selected_program_key,
        'driver_priority_bonus_meters',selected_priority_bonus
      ),
      updated_at=timezone('utc',now())
  where id=dispatch_request_id;

  update public.lpg_refill_orders
  set station_branch_id=station_record.id,
      driver_profile_id=selected_driver_profile_id,
      vehicle_id=selected_vehicle_id,
      status='driver_offered',
      assignment_status='driver_offered',
      metadata=metadata||jsonb_build_object(
        'dispatch_request_id',dispatch_request_id,
        'dispatch_idempotency_key',target_idempotency_key,
        'dispatch_candidate_count',candidate_rank,
        'driver_offer_expires_at',timezone('utc',now())+make_interval(secs=>offer_ttl_seconds),
        'capacity_reservation_id',reservation_id,
        'driver_active_orders_before_assignment',selected_active_order_count,
        'concurrent_assignment',selected_active_order_count>0,
        'driver_participation_program_key',selected_program_key,
        'driver_priority_bonus_meters',selected_priority_bonus
      ),
      updated_at=timezone('utc',now())
  where id=order_record.id;

  update public.service_requests
  set status='matching',
      participants=participants||jsonb_build_object(
        'station_branch_id',station_record.id,
        'driver_profile_id',selected_driver_profile_id,
        'vehicle_id',selected_vehicle_id
      ),
      updated_at=timezone('utc',now())
  where id=order_record.service_request_id;

  perform public.ensure_lpg_order_record(
    order_record.id,target_idempotency_key||':order-record','lpg.order_projection',jsonb_build_object('dispatch_request_id',dispatch_request_id)
  );

  perform public.record_lpg_order_event(
    order_record.id,'lpg.dispatch.driver_offered',order_record.status,'driver_offered',target_idempotency_key||':event',
    jsonb_build_object(
      'dispatch_request_id',dispatch_request_id,
      'station_branch_id',station_record.id,
      'driver_profile_id',selected_driver_profile_id,
      'vehicle_id',selected_vehicle_id,
      'capacity_reservation_id',reservation_id,
      'driver_active_orders_before_assignment',selected_active_order_count,
      'concurrent_assignment',selected_active_order_count>0,
      'driver_participation_program_key',selected_program_key,
      'driver_priority_bonus_meters',selected_priority_bonus
    )
  );

  return dispatch_request_id;
end;
$$;

revoke all on function public.dispatch_lpg_order(uuid,integer,text,text) from public,anon;
grant execute on function public.dispatch_lpg_order(uuid,integer,text,text) to authenticated,service_role;

comment on function public.dispatch_lpg_order(uuid,integer,text,text) is
  'Capacity-aware LPG auto-dispatch. SKIMA Special Driver receives only the configured bounded score advantage; proximity, workload, capacity, capabilities and route bundling remain authoritative so Independent Driver Partners are not excluded.';
