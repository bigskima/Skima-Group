begin;

create or replace function public.lpg_internal_live_driver_available(
  target_latitude numeric,
  target_longitude numeric
)
returns boolean
language plpgsql
stable
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  dispatch_policy jsonb;
  config jsonb;
  program_key text;
  freshness_seconds integer;
  max_driver_distance_meters numeric;
  driver_required jsonb;
  vehicle_required jsonb;
begin
  if target_latitude is null or target_longitude is null
    or target_latitude not between -90 and 90
    or target_longitude not between -180 and 180 then
    return false;
  end if;

  config:=public.lpg_policy_config('lpg.fulfillment.launch_assurance');
  if not coalesce((config->>'enabled')::boolean,false)
    or coalesce(config->>'mode','hybrid')='marketplace_only' then
    return false;
  end if;

  program_key:=coalesce(config->>'internal_driver_program_key','driver.skima_special');
  dispatch_policy:=public.lpg_policy_config('lpg.dispatch.phase_one');
  freshness_seconds:=coalesce(nullif(dispatch_policy->>'driver_location_freshness_seconds','')::integer,300);
  max_driver_distance_meters:=coalesce(nullif(dispatch_policy->>'max_driver_distance_meters','')::numeric,25000);
  driver_required:=coalesce(dispatch_policy->'required_driver_capabilities','[]'::jsonb);
  vehicle_required:=coalesce(dispatch_policy->'required_vehicle_capabilities','[]'::jsonb);

  return exists(
    select 1
    from public.driver_profiles driver
    join public.driver_program_memberships membership
      on membership.driver_profile_id=driver.id
     and membership.program_key=program_key
     and membership.status='active'
     and membership.starts_at<=timezone('utc',now())
     and (membership.ends_at is null or membership.ends_at>timezone('utc',now()))
    join public.driver_vehicle_links vehicle_link
      on vehicle_link.driver_profile_id=driver.id
     and vehicle_link.status='active'
     and vehicle_link.starts_at<=timezone('utc',now())
     and (vehicle_link.ends_at is null or vehicle_link.ends_at>timezone('utc',now()))
    join public.vehicles vehicle
      on vehicle.id=vehicle_link.vehicle_id
     and vehicle.status='active'
    join lateral (
      select public.evaluate_driver_vehicle_eligibility(driver.id,vehicle.id,'lpg') result
    ) eligibility on coalesce((eligibility.result->>'eligible')::boolean,false)
    join public.driver_location_state location_state
      on location_state.driver_id=driver.id
     and location_state.status='available'
     and location_state.captured_at>=timezone('utc',now())-make_interval(secs=>freshness_seconds)
    where driver.verification_status='approved'
      and driver.operational_status in ('available','busy')
      and public.lpg_distance_meters(
        target_latitude,target_longitude,
        extensions.st_y(location_state.point::extensions.geometry),
        extensions.st_x(location_state.point::extensions.geometry)
      )<=max_driver_distance_meters
      and exists(
        select 1
        from public.operational_coverage_assignments coverage
        left join public.geographies geography on geography.id=coverage.geography_id
        where coverage.entity_type='DRIVER'
          and coverage.entity_id=driver.id
          and coverage.service_key='lpg'
          and coverage.status in ('approved','active')
          and coverage.approved_at is not null
          and (coverage.valid_from is null or coverage.valid_from<=timezone('utc',now()))
          and (coverage.valid_to is null or coverage.valid_to>timezone('utc',now()))
          and case coverage.coverage_type
            when 'ADMIN_GEOGRAPHY' then geography.status='active'
              and geography.boundary_geometry is not null
              and extensions.st_covers(
                geography.boundary_geometry,
                extensions.st_setsrid(extensions.st_makepoint(target_longitude,target_latitude),4326)::extensions.geography
              )
            when 'RADIUS' then extensions.st_dwithin(
              coverage.center_point,
              extensions.st_setsrid(extensions.st_makepoint(target_longitude,target_latitude),4326)::extensions.geography,
              coverage.radius_meters
            )
            when 'CUSTOM_ZONE' then extensions.st_covers(
              coverage.coverage_geometry,
              extensions.st_setsrid(extensions.st_makepoint(target_longitude,target_latitude),4326)::extensions.geography
            )
            else false
          end
      )
      and not exists(
        select 1 from jsonb_array_elements_text(driver_required) required(capability_key)
        where not exists(
          select 1 from public.entity_capabilities capability
          where capability.entity_type='driver'
            and capability.entity_id=driver.id
            and capability.capability_key=required.capability_key
            and capability.status='active'
        )
      )
      and not exists(
        select 1 from jsonb_array_elements_text(vehicle_required) required(capability_key)
        where not exists(
          select 1 from public.entity_capabilities capability
          where capability.entity_type='vehicle'
            and capability.entity_id=vehicle.id
            and capability.capability_key=required.capability_key
            and capability.status='active'
        )
      )
  );
end
$$;

create or replace function public.read_lpg_internal_launch_readiness()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  config jsonb;
  program_key text;
  payout_policy jsonb;
  payout_percentage numeric;
  managed_driver_count integer:=0;
  vehicle_ready_count integer:=0;
  coverage_ready_count integer:=0;
  reference_scope_count integer:=0;
  reasons jsonb:='[]'::jsonb;
begin
  if auth.role()<>'service_role'
    and not public.has_permission('platform.dispatch.read',null)
    and not public.has_permission('platform.dispatch.manage',null)
    and not public.has_permission('platform.financial_policy.read',null)
    and not public.is_platform_super_admin() then
    raise exception using errcode='42501',message='LPG launch assurance read permission is required';
  end if;

  config:=public.lpg_policy_config('lpg.fulfillment.launch_assurance');
  program_key:=coalesce(config->>'internal_driver_program_key','driver.skima_special');

  begin
    payout_policy:=public.resolve_financial_policy(
      'payout.lpg.internal_driver','NGN',timezone('utc',now()),
      'lpg',null,'lpg.refill.internal','global',null
    );
    payout_percentage:=nullif(payout_policy #>> '{configuration,percentage}','')::numeric;
  exception when others then
    payout_percentage:=null;
  end;

  select count(distinct driver.id)::integer into managed_driver_count
  from public.driver_profiles driver
  join public.driver_program_memberships membership on membership.driver_profile_id=driver.id
  where membership.program_key=program_key
    and membership.status='active'
    and membership.starts_at<=timezone('utc',now())
    and (membership.ends_at is null or membership.ends_at>timezone('utc',now()))
    and driver.verification_status='approved';

  select count(distinct driver.id)::integer into vehicle_ready_count
  from public.driver_profiles driver
  join public.driver_program_memberships membership on membership.driver_profile_id=driver.id
  join public.driver_vehicle_links link on link.driver_profile_id=driver.id
  join public.vehicles vehicle on vehicle.id=link.vehicle_id
  where membership.program_key=program_key
    and membership.status='active'
    and membership.starts_at<=timezone('utc',now())
    and (membership.ends_at is null or membership.ends_at>timezone('utc',now()))
    and driver.verification_status='approved'
    and link.status='active'
    and link.starts_at<=timezone('utc',now())
    and (link.ends_at is null or link.ends_at>timezone('utc',now()))
    and vehicle.status='active'
    and coalesce((public.evaluate_driver_vehicle_eligibility(driver.id,vehicle.id,'lpg')->>'eligible')::boolean,false);

  select count(distinct driver.id)::integer into coverage_ready_count
  from public.driver_profiles driver
  join public.driver_program_memberships membership on membership.driver_profile_id=driver.id
  where membership.program_key=program_key
    and membership.status='active'
    and membership.starts_at<=timezone('utc',now())
    and (membership.ends_at is null or membership.ends_at>timezone('utc',now()))
    and driver.verification_status='approved'
    and exists(
      select 1 from public.operational_coverage_assignments coverage
      where coverage.entity_type='DRIVER'
        and coverage.entity_id=driver.id
        and coverage.service_key='lpg'
        and coverage.status in ('approved','active')
        and coverage.approved_at is not null
        and (coverage.valid_from is null or coverage.valid_from<=timezone('utc',now()))
        and (coverage.valid_to is null or coverage.valid_to>timezone('utc',now()))
    );

  select count(*)::integer into reference_scope_count
  from public.financial_policy_versions version
  join public.financial_policy_definitions definition on definition.id=version.policy_definition_id
  join public.business_modules module on module.id=version.module_id
  where definition.key='pricing.lpg.internal_reference_per_kg'
    and module.key='lpg'
    and version.service_key='lpg.refill.internal'
    and version.currency_code='NGN'
    and version.geography_type='service_area'
    and version.lifecycle_status='active'
    and version.effective_from<=timezone('utc',now())
    and (version.effective_until is null or version.effective_until>timezone('utc',now()))
    and coalesce(nullif(version.configuration->>'amount_per_kg','')::numeric,0)>0;

  if payout_percentage is null or payout_percentage<=0 then
    reasons:=reasons||jsonb_build_array('Configure an internal driver compensation percentage greater than zero.');
  end if;
  if reference_scope_count=0 then
    reasons:=reasons||jsonb_build_array('Configure at least one service-area internal LPG reference price.');
  end if;
  if managed_driver_count=0 then
    reasons:=reasons||jsonb_build_array('Assign at least one approved driver to the configured SKIMA internal driver program.');
  end if;
  if vehicle_ready_count=0 then
    reasons:=reasons||jsonb_build_array('At least one managed driver needs an active LPG-eligible vehicle.');
  end if;
  if coverage_ready_count=0 then
    reasons:=reasons||jsonb_build_array('At least one managed driver needs approved LPG operational coverage.');
  end if;

  return jsonb_build_object(
    'ready',jsonb_array_length(reasons)=0,
    'enabled',coalesce((config->>'enabled')::boolean,false),
    'mode',coalesce(config->>'mode','hybrid'),
    'priority',coalesce(config->>'priority','marketplace_first'),
    'programKey',program_key,
    'driverCompensationPercent',payout_percentage,
    'internalReferencePriceScopeCount',reference_scope_count,
    'managedApprovedDriverCount',managed_driver_count,
    'vehicleReadyDriverCount',vehicle_ready_count,
    'coverageReadyDriverCount',coverage_ready_count,
    'reasons',reasons
  );
end
$$;

create or replace function public.set_lpg_launch_assurance_configuration(
  target_enabled boolean,
  target_mode text,
  target_priority text,
  target_marketplace_first_fallback_only boolean,
  target_reason text,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  config public.lpg_operation_policies%rowtype;
  readiness jsonb;
begin
  if auth.role()<>'service_role'
    and not public.has_permission('platform.dispatch.manage',null)
    and not public.is_platform_super_admin() then
    raise exception using errcode='42501',message='dispatch management permission is required';
  end if;
  if target_enabled is null then
    raise exception using errcode='22023',message='enabled setting is required';
  end if;
  if target_mode not in ('marketplace_only','internal_only','hybrid') then
    raise exception using errcode='22023',message='mode must be marketplace_only, internal_only, or hybrid';
  end if;
  if target_priority not in ('marketplace_first','internal_first') then
    raise exception using errcode='22023',message='priority must be marketplace_first or internal_first';
  end if;
  if char_length(btrim(coalesce(target_reason,'')))<3
    or coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='change reason and idempotency key are required';
  end if;

  if target_enabled and target_mode<>'marketplace_only' then
    readiness:=public.read_lpg_internal_launch_readiness();
    if not coalesce((readiness->>'ready')::boolean,false) then
      raise exception using errcode='55000',
        message='SKIMA internal fulfillment is not launch-ready: '||coalesce(readiness->'reasons'->>0,'complete the readiness checklist');
    end if;
  end if;

  select * into config
  from public.lpg_operation_policies
  where key='lpg.fulfillment.launch_assurance' and status='active'
  for update;
  if not found then
    raise exception using errcode='55000',message='active LPG launch assurance configuration is required';
  end if;

  if config.metadata->>'lastIdempotencyKey'=target_idempotency_key then
    return public.read_lpg_launch_assurance_configuration();
  end if;

  update public.lpg_operation_policies
  set policy=policy || jsonb_build_object(
        'enabled',target_enabled,
        'mode',target_mode,
        'priority',target_priority,
        'marketplace_first_fallback_only',coalesce(target_marketplace_first_fallback_only,true)
      ),
      metadata=metadata || jsonb_build_object(
        'lastReason',btrim(target_reason),
        'lastIdempotencyKey',target_idempotency_key,
        'lastChangedBy',auth.uid(),
        'lastChangedAt',timezone('utc',now())
      ),
      updated_at=timezone('utc',now())
  where id=config.id;

  return public.read_lpg_launch_assurance_configuration();
end
$$;

create or replace function public.read_lpg_internal_candidate_for_kg(
  target_pickup_location_id uuid,
  target_delivery_location_id uuid,
  target_cylinder_id uuid,
  target_requested_kg numeric,
  target_at timestamptz default timezone('utc',now())
)
returns table(
  station_branch_id uuid,display_name text,formatted_address text,latitude numeric,longitude numeric,
  service_radius_meters integer,pickup_distance_meters numeric,return_distance_meters numeric,
  route_proxy_distance_meters numeric,currency_code text,price_per_kg numeric,current_available_kg numeric,
  refill_capacity_kg numeric,supported_cylinder_sizes_kg numeric[],cylinder_size_kg numeric
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  config jsonb;
  reference_policy jsonb;
  payout_policy jsonb;
  pickup_record public.lpg_customer_locations%rowtype;
  delivery_record public.lpg_customer_locations%rowtype;
  cylinder_record public.lpg_cylinders%rowtype;
  reference_price numeric;
  route_km numeric;
  payout_percentage numeric;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication required';
  end if;

  config:=public.lpg_policy_config('lpg.fulfillment.launch_assurance');
  if not coalesce((config->>'enabled')::boolean,false)
    or coalesce(config->>'mode','hybrid')='marketplace_only' then
    return;
  end if;

  select * into pickup_record from public.lpg_customer_locations
  where id=target_pickup_location_id and owner_user_id=auth.uid() and status<>'deleted';
  select * into delivery_record from public.lpg_customer_locations
  where id=target_delivery_location_id and owner_user_id=auth.uid() and status<>'deleted';
  select * into cylinder_record from public.lpg_cylinders
  where id=target_cylinder_id and owner_user_id=auth.uid() and status<>'deactivated';

  if pickup_record.id is null or delivery_record.id is null or cylinder_record.id is null then
    raise exception using errcode='42501',message='customer refill inputs are not available';
  end if;
  if target_requested_kg is null or target_requested_kg<=0
    or target_requested_kg>cylinder_record.max_capacity_kg then
    return;
  end if;

  if not public.lpg_internal_live_driver_available(pickup_record.latitude,pickup_record.longitude) then
    return;
  end if;

  begin
    reference_policy:=public.resolve_lpg_internal_reference_policy(target_pickup_location_id,target_at);
    payout_policy:=public.resolve_financial_policy(
      'payout.lpg.internal_driver','NGN',target_at,'lpg',null,'lpg.refill.internal','global',null
    );
  exception when others then
    return;
  end;

  reference_price:=nullif(reference_policy #>> '{configuration,amount_per_kg}','')::numeric;
  route_km:=nullif(reference_policy #>> '{configuration,estimated_route_km}','')::numeric;
  payout_percentage:=nullif(payout_policy #>> '{configuration,percentage}','')::numeric;
  if reference_price is null or reference_price<=0
    or route_km is null or route_km<0
    or payout_percentage is null or payout_percentage<=0 or payout_percentage>100 then
    return;
  end if;

  return query select
    coalesce(nullif(config->>'digital_station_id','')::uuid,'00000000-0000-0000-0000-000000000001'::uuid),
    coalesce(config->>'digital_station_label','SKIMA Fulfillment'),
    'SKIMA-managed refill. Your assigned SKIMA driver will use a suitable available LPG supplier.'::text,
    pickup_record.latitude,pickup_record.longitude,
    null::integer,
    0::numeric,0::numeric,round(route_km*1000,2),
    'NGN'::text,reference_price,
    999999999::numeric,999999999::numeric,array[]::numeric[],cylinder_record.size_kg;
end
$$;

create or replace function public.dispatch_lpg_internal_order(
  target_lpg_order_id uuid,
  target_candidate_limit integer default null,
  target_idempotency_key text default null,
  target_source text default 'lpg.internal_dispatch_api'
)
returns uuid
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  order_record record;
  dispatch_request_id uuid;
  candidate_record record;
  candidate_rank integer:=0;
  selected_driver_profile_id uuid;
  selected_vehicle_id uuid;
  selected_driver_point extensions.geography(Point,4326);
  selected_driver_distance numeric;
  selected_coverage_assignment_ids uuid[]:='{}';
  existing_dispatch_request_id uuid;
  dispatch_policy jsonb;
  config jsonb;
  program_key text;
  policy_candidate_limit integer;
  freshness_seconds integer;
  max_driver_distance_meters numeric;
  offer_ttl_seconds integer;
  driver_required jsonb;
  vehicle_required jsonb;
  allow_concurrent boolean;
  max_driver_orders integer;
  max_vehicle_orders integer;
  workload_penalty numeric;
  dispatch_policy_key text;
  service_resolution jsonb;
begin
  if auth.role()<>'service_role'
    and not public.has_permission('lpg.dispatch.execute',null)
    and not public.can_manage_lpg_operations() then
    raise exception using errcode='42501',message='LPG dispatch permission is required';
  end if;
  if target_lpg_order_id is null or coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='LPG order and idempotency key are required';
  end if;

  config:=public.lpg_policy_config('lpg.fulfillment.launch_assurance');
  if not coalesce((config->>'enabled')::boolean,false)
    or coalesce(config->>'mode','hybrid')='marketplace_only' then
    raise exception using errcode='55000',message='SKIMA internal fulfillment is not enabled';
  end if;
  program_key:=coalesce(config->>'internal_driver_program_key','driver.skima_special');

  dispatch_policy:=public.lpg_policy_config('lpg.dispatch.phase_one');
  policy_candidate_limit:=coalesce(nullif(dispatch_policy->>'candidate_limit','')::integer,5);
  freshness_seconds:=coalesce(nullif(dispatch_policy->>'driver_location_freshness_seconds','')::integer,300);
  max_driver_distance_meters:=coalesce(nullif(dispatch_policy->>'max_driver_distance_meters','')::numeric,25000);
  offer_ttl_seconds:=coalesce(nullif(dispatch_policy->>'offer_ttl_seconds','')::integer,180);
  driver_required:=coalesce(dispatch_policy->'required_driver_capabilities','[]'::jsonb);
  vehicle_required:=coalesce(dispatch_policy->'required_vehicle_capabilities','[]'::jsonb);
  allow_concurrent:=coalesce((dispatch_policy->>'allow_concurrent_assignments')::boolean,true);
  max_driver_orders:=coalesce(nullif(dispatch_policy->>'max_concurrent_orders_per_driver','')::integer,12);
  max_vehicle_orders:=coalesce(nullif(dispatch_policy->>'max_concurrent_orders_per_vehicle','')::integer,max_driver_orders);
  workload_penalty:=coalesce(nullif(dispatch_policy->>'workload_penalty_meters_per_order','')::numeric,650);
  if not allow_concurrent then max_driver_orders:=1; max_vehicle_orders:=1; end if;
  target_candidate_limit:=least(coalesce(target_candidate_limit,policy_candidate_limit),policy_candidate_limit);
  if target_candidate_limit<1 or target_candidate_limit>25 then
    raise exception using errcode='22023',message='candidate limit must be between 1 and 25';
  end if;

  select policy.key into dispatch_policy_key
  from public.dispatch_policies policy
  where policy.key=public.lpg_policy_config('lpg.quote.phase_one')->>'dispatch_policy_key'
    and policy.status='active'
  limit 1;
  if dispatch_policy_key is null then
    raise exception using errcode='55000',message='active LPG dispatch policy is required';
  end if;

  select target_order.*,
         pickup.latitude pickup_latitude,pickup.longitude pickup_longitude,
         delivery.latitude delivery_latitude,delivery.longitude delivery_longitude
  into order_record
  from public.lpg_refill_orders target_order
  join public.lpg_customer_locations pickup on pickup.id=target_order.pickup_location_id
  join public.lpg_customer_locations delivery on delivery.id=target_order.delivery_location_id
  where target_order.id=target_lpg_order_id
  for update of target_order;
  if not found then raise exception using errcode='22023',message='LPG order was not found'; end if;
  if order_record.fulfillment_channel<>'skima_internal' then
    raise exception using errcode='22023',message='order is not a SKIMA internal fulfillment';
  end if;

  existing_dispatch_request_id:=nullif(order_record.metadata->>'dispatch_request_id','')::uuid;
  if existing_dispatch_request_id is not null
    and order_record.metadata->>'dispatch_idempotency_key'=target_idempotency_key then
    return existing_dispatch_request_id;
  end if;
  if order_record.status not in ('payment_reserved','matching_driver','driver_offered') then
    raise exception using errcode='55000',message='SKIMA internal order must be funded before dispatch';
  end if;

  service_resolution:=public.resolve_service_availability(
    'lpg','customer_ordering',order_record.pickup_longitude,order_record.pickup_latitude,timezone('utc',now())
  );
  if not coalesce((service_resolution->>'available')::boolean,false) then
    raise exception using errcode='P0001',message='pickup location is outside current LPG service coverage';
  end if;

  dispatch_request_id:=public.create_dispatch_request(
    dispatch_policy_key,target_source,'lpg_order',order_record.id,
    jsonb_build_object('driver_required_capabilities',driver_required,'vehicle_required_capabilities',vehicle_required),
    jsonb_build_object('latitude',order_record.pickup_latitude,'longitude',order_record.pickup_longitude),
    jsonb_build_object('latitude',order_record.delivery_latitude,'longitude',order_record.delivery_longitude),
    100,
    jsonb_build_object(
      'bounded_context','lpg',
      'fulfillment_channel','skima_internal',
      'driver_program_key',program_key,
      'candidate_limit',target_candidate_limit,
      'max_driver_distance_meters',max_driver_distance_meters
    ),
    target_idempotency_key||':dispatch-request'
  );

  for candidate_record in
    select candidate.* from (
      select
        driver.id driver_profile_id,
        vehicle.id vehicle_id,
        state.point driver_point,
        state.captured_at,
        extensions.st_y(state.point::extensions.geometry) latitude,
        extensions.st_x(state.point::extensions.geometry) longitude,
        public.lpg_distance_meters(
          order_record.pickup_latitude,order_record.pickup_longitude,
          extensions.st_y(state.point::extensions.geometry),extensions.st_x(state.point::extensions.geometry)
        ) distance_meters,
        coalesce(coverage_match.assignment_ids,'{}'::uuid[]) coverage_assignment_ids,
        workload.active_order_count,
        workload.active_vehicle_order_count,
        greatest(
          public.lpg_distance_meters(
            order_record.pickup_latitude,order_record.pickup_longitude,
            extensions.st_y(state.point::extensions.geometry),extensions.st_x(state.point::extensions.geometry)
          ) + workload.active_order_count*workload_penalty,
          0
        ) dispatch_cost
      from public.driver_profiles driver
      join public.driver_program_memberships membership
        on membership.driver_profile_id=driver.id
       and membership.program_key=program_key
       and membership.status='active'
       and membership.starts_at<=timezone('utc',now())
       and (membership.ends_at is null or membership.ends_at>timezone('utc',now()))
      join public.driver_vehicle_links link
        on link.driver_profile_id=driver.id
       and link.status='active'
       and link.starts_at<=timezone('utc',now())
       and (link.ends_at is null or link.ends_at>timezone('utc',now()))
      join public.vehicles vehicle on vehicle.id=link.vehicle_id and vehicle.status='active'
      join lateral (
        select public.evaluate_driver_vehicle_eligibility(driver.id,vehicle.id,'lpg') result
      ) eligibility on coalesce((eligibility.result->>'eligible')::boolean,false)
      join public.driver_location_state state
        on state.driver_id=driver.id
       and state.status='available'
       and state.captured_at>=timezone('utc',now())-make_interval(secs=>freshness_seconds)
      join lateral (
        select coalesce(array_agg(coverage.id order by coverage.id),'{}'::uuid[]) assignment_ids
        from public.operational_coverage_assignments coverage
        left join public.geographies geography on geography.id=coverage.geography_id
        where coverage.entity_type='DRIVER'
          and coverage.entity_id=driver.id
          and coverage.service_key='lpg'
          and coverage.status in ('approved','active')
          and coverage.approved_at is not null
          and (coverage.valid_from is null or coverage.valid_from<=timezone('utc',now()))
          and (coverage.valid_to is null or coverage.valid_to>timezone('utc',now()))
          and case coverage.coverage_type
            when 'ADMIN_GEOGRAPHY' then geography.status='active'
              and geography.boundary_geometry is not null
              and extensions.st_covers(
                geography.boundary_geometry,
                extensions.st_setsrid(extensions.st_makepoint(order_record.pickup_longitude,order_record.pickup_latitude),4326)::extensions.geography
              )
            when 'RADIUS' then extensions.st_dwithin(
              coverage.center_point,
              extensions.st_setsrid(extensions.st_makepoint(order_record.pickup_longitude,order_record.pickup_latitude),4326)::extensions.geography,
              coverage.radius_meters
            )
            when 'CUSTOM_ZONE' then extensions.st_covers(
              coverage.coverage_geometry,
              extensions.st_setsrid(extensions.st_makepoint(order_record.pickup_longitude,order_record.pickup_latitude),4326)::extensions.geography
            )
            else false
          end
      ) coverage_match on cardinality(coverage_match.assignment_ids)>0
      join lateral (
        select count(*)::integer active_order_count,
               count(*) filter(where active.vehicle_id=vehicle.id)::integer active_vehicle_order_count
        from public.lpg_refill_orders active
        where active.driver_profile_id=driver.id
          and active.id<>order_record.id
          and active.status not in ('completed','cancelled','refunded','failed','expired')
      ) workload on true
      where driver.verification_status='approved'
        and driver.operational_status in ('available','busy')
        and workload.active_order_count<max_driver_orders
        and workload.active_vehicle_order_count<max_vehicle_orders
        and not exists(
          select 1 from jsonb_array_elements_text(driver_required) required(capability_key)
          where not exists(
            select 1 from public.entity_capabilities capability
            where capability.entity_type='driver'
              and capability.entity_id=driver.id
              and capability.capability_key=required.capability_key
              and capability.status='active'
          )
        )
        and not exists(
          select 1 from jsonb_array_elements_text(vehicle_required) required(capability_key)
          where not exists(
            select 1 from public.entity_capabilities capability
            where capability.entity_type='vehicle'
              and capability.entity_id=vehicle.id
              and capability.capability_key=required.capability_key
              and capability.status='active'
          )
        )
        and public.lpg_distance_meters(
          order_record.pickup_latitude,order_record.pickup_longitude,
          extensions.st_y(state.point::extensions.geometry),extensions.st_x(state.point::extensions.geometry)
        )<=max_driver_distance_meters
    ) candidate
    order by candidate.dispatch_cost,candidate.distance_meters,candidate.captured_at desc,candidate.driver_profile_id
    limit target_candidate_limit
  loop
    candidate_rank:=candidate_rank+1;
    if candidate_rank=1 then
      selected_driver_profile_id:=candidate_record.driver_profile_id;
      selected_vehicle_id:=candidate_record.vehicle_id;
      selected_driver_point:=candidate_record.driver_point;
      selected_driver_distance:=candidate_record.distance_meters;
      selected_coverage_assignment_ids:=candidate_record.coverage_assignment_ids;
    end if;

    perform public.upsert_dispatch_candidate(
      dispatch_request_id,'driver',candidate_record.driver_profile_id,
      greatest(1000000-candidate_record.dispatch_cost,1),candidate_rank,
      jsonb_build_object(
        'vehicle_id',candidate_record.vehicle_id,
        'distance_meters',candidate_record.distance_meters,
        'coverage_assignment_ids',candidate_record.coverage_assignment_ids,
        'active_order_count',candidate_record.active_order_count,
        'active_vehicle_order_count',candidate_record.active_vehicle_order_count,
        'participation_program_key',program_key,
        'fulfillment_channel','skima_internal',
        'selection_mode','skima_internal_managed_driver'
      ),
      case when candidate_rank=1 then 'offered' else 'suggested' end,
      target_idempotency_key||':candidate:'||candidate_rank::text
    );
  end loop;

  if candidate_rank=0 then
    raise exception using errcode='P0001',message='no available SKIMA internal driver currently covers this pickup location';
  end if;

  update public.dispatch_requests
  set assigned_entity_type='driver',assigned_entity_id=selected_driver_profile_id,
      metadata=metadata||jsonb_build_object(
        'vehicle_id',selected_vehicle_id,
        'driver_program_key',program_key,
        'fulfillment_channel','skima_internal'
      ),updated_at=timezone('utc',now())
  where id=dispatch_request_id;

  update public.lpg_refill_orders
  set driver_profile_id=selected_driver_profile_id,
      vehicle_id=selected_vehicle_id,
      station_branch_id=null,
      status='driver_offered',
      assignment_status='driver_offered',
      metadata=metadata||jsonb_build_object(
        'dispatch_request_id',dispatch_request_id,
        'dispatch_idempotency_key',target_idempotency_key,
        'dispatch_candidate_count',candidate_rank,
        'driver_offer_expires_at',timezone('utc',now())+make_interval(secs=>offer_ttl_seconds),
        'driver_participation_program_key',program_key,
        'fulfillmentChannel','skima_internal'
      ),updated_at=timezone('utc',now())
  where id=order_record.id;

  update public.service_requests
  set status='matching',
      participants=participants||jsonb_build_object(
        'driver_profile_id',selected_driver_profile_id,
        'vehicle_id',selected_vehicle_id,
        'fulfillment_channel','skima_internal'
      ),updated_at=timezone('utc',now())
  where id=order_record.service_request_id;

  perform public.record_lpg_order_event(
    order_record.id,'lpg.dispatch.driver_offered',order_record.status,'driver_offered',
    target_idempotency_key||':event',
    jsonb_build_object(
      'dispatch_request_id',dispatch_request_id,
      'driver_profile_id',selected_driver_profile_id,
      'vehicle_id',selected_vehicle_id,
      'driver_program_key',program_key,
      'fulfillment_channel','skima_internal'
    )
  );

  insert into public.dispatch_location_decision_snapshots(
    dispatch_request_id,subject_type,subject_id,service_key,pickup_point,
    selected_entity_type,selected_entity_id,selected_entity_point,
    matched_coverage_assignment_ids,distance_meters,authority_mode,decision_metadata
  ) values(
    dispatch_request_id,'lpg_order',order_record.id,'lpg',
    extensions.st_setsrid(extensions.st_makepoint(order_record.pickup_longitude,order_record.pickup_latitude),4326)::extensions.geography,
    'DRIVER',selected_driver_profile_id,selected_driver_point,selected_coverage_assignment_ids,
    selected_driver_distance,'universal',
    jsonb_build_object(
      'vehicleId',selected_vehicle_id,
      'candidateCount',candidate_rank,
      'participationProgramKey',program_key,
      'fulfillmentChannel','skima_internal',
      'dispatchPolicyKey',dispatch_policy_key,
      'servicePolicyId',service_resolution->>'matchedPolicyId',
      'serviceGeographyId',service_resolution->>'matchedGeographyId'
    )
  ) on conflict(dispatch_request_id) do nothing;

  return dispatch_request_id;
end
$$;

create or replace function public.reserve_and_dispatch_lpg_refill_order(
  target_lpg_order_id uuid,
  target_actor_user_id uuid,
  target_idempotency_key text,
  target_customer_wallet_id uuid default null,
  target_escrow_wallet_id uuid default null,
  target_source text default 'lpg.payment_api',
  target_metadata jsonb default '{}'
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  resolved_order_id uuid;
  fulfillment_channel text;
begin
  if auth.role()<>'service_role' then
    raise exception 'service role is required to reserve and dispatch an LPG order';
  end if;

  resolved_order_id:=public.reserve_lpg_refill_order_payment(
    target_lpg_order_id,target_actor_user_id,target_idempotency_key,
    target_customer_wallet_id,target_escrow_wallet_id,target_source,target_metadata
  );

  select coalesce(target_order.fulfillment_channel,'marketplace') into fulfillment_channel
  from public.lpg_refill_orders target_order where target_order.id=resolved_order_id;

  if fulfillment_channel='skima_internal' then
    perform public.dispatch_lpg_internal_order(
      resolved_order_id,null,target_idempotency_key||':automatic-dispatch','skima.lpg.internal_automatic_dispatch'
    );
  else
    perform public.dispatch_lpg_order(
      resolved_order_id,null,target_idempotency_key||':automatic-dispatch','skima.lpg.automatic_dispatch'
    );
  end if;

  perform public.queue_lpg_order_status_notifications(
    resolved_order_id,target_idempotency_key||':driver-selected-notifications','skima.lpg.automatic_dispatch'
  );

  return resolved_order_id;
exception when others then
  if sqlerrm ilike '%no available SKIMA internal driver%' then
    raise exception using errcode='P0001',
      message='No SKIMA fulfillment driver is available right now. Your wallet was not charged. Please try again shortly.';
  elsif sqlerrm ilike '%no eligible LPG driver%' then
    raise exception using errcode='P0001',
      message='No nearby driver is available right now. Your wallet was not charged. Please try again shortly.';
  end if;
  raise;
end
$$;

create or replace function public.settle_lpg_internal_order(
  target_lpg_order_id uuid,
  target_idempotency_key text,
  target_source text default 'lpg.internal_settlement'
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  order_record public.lpg_refill_orders%rowtype;
  quote_record public.lpg_refill_quotes%rowtype;
  hold_record public.escrow_holds%rowtype;
  procurement public.lpg_internal_refill_procurements%rowtype;
  earning public.lpg_internal_driver_earnings%rowtype;
  settlement_policy_id uuid;
  settlement_execution_id uuid;
  transaction_id uuid;
  existing_execution public.settlement_executions%rowtype;
  clearing_wallet_id uuid;
  revenue_wallet_id uuid;
  liability_wallet_id uuid;
  remaining_amount numeric(28,8);
  reference_amount numeric(28,8);
  markup_amount numeric(28,8);
  delivery_amount numeric(28,8);
  driver_accrual_amount numeric(28,8);
  logistics_margin numeric(28,8);
  tax_amount numeric(28,8);
  revenue_amount numeric(28,8);
  liability_amount numeric(28,8);
  entries jsonb:='[]'::jsonb;
  distribution jsonb:='[]'::jsonb;
  ordinal integer:=0;
begin
  if coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='idempotency key is required';
  end if;

  select * into order_record from public.lpg_refill_orders where id=target_lpg_order_id for update;
  if not found then raise exception using errcode='22023',message='LPG order was not found'; end if;
  if order_record.fulfillment_channel<>'skima_internal' then
    raise exception using errcode='22023',message='order is not a SKIMA internal fulfillment';
  end if;
  if order_record.internal_settlement_execution_id is not null then
    return order_record.internal_settlement_execution_id;
  end if;
  if order_record.status<>'delivered' then
    raise exception using errcode='55000',message='SKIMA internal settlement requires verified delivery';
  end if;
  if order_record.escrow_hold_id is null or order_record.actual_kg is null then
    raise exception using errcode='55000',message='SKIMA internal settlement requires reserved escrow and confirmed refill';
  end if;

  select * into quote_record from public.lpg_refill_quotes where id=order_record.lpg_refill_quote_id;
  if not found or quote_record.status<>'accepted' or quote_record.fulfillment_channel<>'skima_internal' then
    raise exception using errcode='55000',message='accepted SKIMA internal quote is required';
  end if;
  select * into procurement from public.lpg_internal_refill_procurements where lpg_order_id=order_record.id;
  if not found or procurement.status<>'approved' then
    raise exception using errcode='55000',message='approved SKIMA supplier procurement record is required';
  end if;
  select * into earning from public.lpg_internal_driver_earnings where lpg_order_id=order_record.id for update;
  if not found or earning.status not in ('accrued','approved') then
    raise exception using errcode='55000',message='internal driver earning accrual is required';
  end if;

  select * into hold_record from public.escrow_holds where id=order_record.escrow_hold_id for update;
  if not found or hold_record.status not in ('held','partially_released') then
    raise exception using errcode='55000',message='SKIMA internal escrow cannot be settled from its current status';
  end if;
  remaining_amount:=round(hold_record.hold_amount-hold_record.released_amount,2);
  if remaining_amount<>round(order_record.total_amount,2) then
    raise exception using errcode='55000',message='SKIMA internal escrow remaining amount does not match accepted order total';
  end if;

  reference_amount:=round(order_record.station_amount,2);
  markup_amount:=round(order_record.platform_fee_amount,2);
  delivery_amount:=round(order_record.delivery_fee_amount,2);
  driver_accrual_amount:=round(order_record.driver_commission_amount,2);
  logistics_margin:=round(delivery_amount-driver_accrual_amount,2);
  tax_amount:=round(order_record.total_amount-reference_amount-markup_amount-delivery_amount,2);
  if reference_amount<0 or markup_amount<0 or delivery_amount<0 or driver_accrual_amount<0
    or logistics_margin<0 or tax_amount<0 then
    raise exception using errcode='55000',message='SKIMA internal settlement components are invalid';
  end if;
  revenue_amount:=markup_amount+logistics_margin;
  liability_amount:=driver_accrual_amount+tax_amount;
  if round(reference_amount+revenue_amount+liability_amount,2)<>remaining_amount then
    raise exception using errcode='55000',message='SKIMA internal settlement distribution does not balance';
  end if;

  select id into settlement_execution_id
  from public.settlement_executions
  where source=target_source and idempotency_key=target_idempotency_key;
  if settlement_execution_id is not null then return settlement_execution_id; end if;

  clearing_wallet_id:=public.ensure_platform_clearing_wallet(
    order_record.currency_code,'lpg.internal_settlement',target_idempotency_key||':clearing-wallet'
  );
  if revenue_amount>0 then
    revenue_wallet_id:=public.ensure_platform_revenue_wallet(
      order_record.currency_code,'lpg.internal_settlement',target_idempotency_key||':revenue-wallet'
    );
  end if;
  if liability_amount>0 then
    liability_wallet_id:=public.ensure_platform_liability_wallet(
      order_record.currency_code,'lpg.internal_settlement',target_idempotency_key||':liability-wallet'
    );
  end if;

  insert into public.financial_transactions(
    transaction_type,status,currency_code,total_amount,idempotency_key,source,
    subject_type,subject_id,actor_user_id,policy_snapshot,metadata
  ) values(
    'release','posted',order_record.currency_code,remaining_amount,target_idempotency_key||':financial',
    target_source,'lpg_refill_order',order_record.id,null,order_record.financial_policy_snapshot,
    jsonb_build_object(
      'fulfillment_channel','skima_internal',
      'escrow_hold_id',hold_record.id,
      'procurement_id',procurement.id,
      'procurement_amount',procurement.procurement_amount,
      'reference_amount',reference_amount,
      'platform_revenue_amount',revenue_amount,
      'driver_accrual_amount',driver_accrual_amount,
      'tax_liability_amount',tax_amount
    )
  ) returning id into transaction_id;

  ordinal:=ordinal+1;
  insert into public.wallet_ledger_entries(
    wallet_id,transaction_id,direction,amount,currency_code,entry_type,idempotency_key,metadata
  ) values(
    hold_record.wallet_id,transaction_id,'debit',remaining_amount,order_record.currency_code,'principal',
    target_idempotency_key||':ledger:'||ordinal,
    jsonb_build_object('role','escrow','fulfillment_channel','skima_internal')
  );
  entries:=entries||jsonb_build_array(jsonb_build_object('wallet_id',hold_record.wallet_id,'amount',remaining_amount,'direction','debit','role','escrow'));

  if reference_amount>0 then
    ordinal:=ordinal+1;
    insert into public.wallet_ledger_entries(
      wallet_id,transaction_id,direction,amount,currency_code,entry_type,idempotency_key,metadata
    ) values(
      clearing_wallet_id,transaction_id,'credit',reference_amount,order_record.currency_code,'principal',
      target_idempotency_key||':ledger:'||ordinal,
      jsonb_build_object(
        'role','internal_lpg_cost_recovery',
        'procurement_id',procurement.id,
        'actual_procurement_amount',procurement.procurement_amount,
        'supplier_price_per_kg',procurement.supplier_price_per_kg
      )
    );
    distribution:=distribution||jsonb_build_array(jsonb_build_object('wallet_id',clearing_wallet_id,'amount',reference_amount,'role','internal_lpg_cost_recovery'));
  end if;

  if revenue_amount>0 then
    ordinal:=ordinal+1;
    insert into public.wallet_ledger_entries(
      wallet_id,transaction_id,direction,amount,currency_code,entry_type,idempotency_key,metadata
    ) values(
      revenue_wallet_id,transaction_id,'credit',revenue_amount,order_record.currency_code,'fee',
      target_idempotency_key||':ledger:'||ordinal,
      jsonb_build_object(
        'role','skima_revenue',
        'revenue_stream','lpg_internal',
        'platform_markup_amount',markup_amount,
        'logistics_margin_amount',logistics_margin
      )
    );
    distribution:=distribution||jsonb_build_array(jsonb_build_object('wallet_id',revenue_wallet_id,'amount',revenue_amount,'role','skima_revenue'));
  end if;

  if liability_amount>0 then
    ordinal:=ordinal+1;
    insert into public.wallet_ledger_entries(
      wallet_id,transaction_id,direction,amount,currency_code,entry_type,idempotency_key,metadata
    ) values(
      liability_wallet_id,transaction_id,'credit',liability_amount,order_record.currency_code,
      case when driver_accrual_amount>0 then 'commission' else 'tax' end,
      target_idempotency_key||':ledger:'||ordinal,
      jsonb_build_object(
        'role','platform_liability',
        'driver_accrual_amount',driver_accrual_amount,
        'tax_liability_amount',tax_amount,
        'internal_driver_earning_id',earning.id
      )
    );
    distribution:=distribution||jsonb_build_array(jsonb_build_object('wallet_id',liability_wallet_id,'amount',liability_amount,'role','platform_liability'));
  end if;

  update public.escrow_holds
  set released_amount=hold_amount,status='released',updated_at=timezone('utc',now())
  where id=hold_record.id;

  select request.settlement_policy_id into settlement_policy_id
  from public.service_requests request where request.id=order_record.service_request_id;

  insert into public.settlement_executions(
    service_request_id,escrow_hold_id,settlement_policy_id,transaction_id,status,currency_code,
    gross_amount,distribution,policy_snapshot,source,idempotency_key,error_message,created_by
  ) values(
    order_record.service_request_id,hold_record.id,settlement_policy_id,transaction_id,'posted',
    order_record.currency_code,remaining_amount,distribution,
    order_record.financial_policy_snapshot->'settlement',target_source,target_idempotency_key,null,null
  ) returning id into settlement_execution_id;

  update public.lpg_internal_driver_earnings
  set status='approved',approved_at=coalesce(approved_at,timezone('utc',now())),
      metadata=metadata||jsonb_build_object(
        'approvedAutomaticallyAfterDelivery',true,
        'internalSettlementExecutionId',settlement_execution_id
      ),updated_at=timezone('utc',now())
  where id=earning.id and status='accrued';

  update public.lpg_refill_orders
  set internal_settlement_execution_id=settlement_execution_id,status='completed',
      metadata=metadata||jsonb_build_object(
        'internalSettlementExecutionId',settlement_execution_id,
        'internalSettlementTransactionId',transaction_id,
        'internalSettlementCompletedAt',timezone('utc',now()),
        'internalCostRecoveryAmount',reference_amount,
        'internalRevenueAmount',revenue_amount,
        'internalDriverAccrualAmount',driver_accrual_amount,
        'internalTaxLiabilityAmount',tax_amount
      ),updated_at=timezone('utc',now())
  where id=order_record.id;

  update public.service_requests set status='settled',updated_at=timezone('utc',now())
  where id=order_record.service_request_id;

  if order_record.order_record_id is not null then
    update public.order_records
    set status='completed',completed_at=coalesce(completed_at,timezone('utc',now())),
        metadata=metadata||jsonb_build_object(
          'fulfillment_channel','skima_internal',
          'internal_settlement_execution_id',settlement_execution_id
        ),updated_at=timezone('utc',now())
    where id=order_record.order_record_id;
  end if;

  perform public.record_lpg_order_event(
    order_record.id,'lpg.internal.settled','delivered','completed',target_idempotency_key||':event',
    jsonb_build_object(
      'settlement_execution_id',settlement_execution_id,
      'transaction_id',transaction_id,
      'procurement_id',procurement.id,
      'driver_earning_id',earning.id,
      'fulfillment_channel','skima_internal'
    )
  );

  return settlement_execution_id;
end
$$;

create or replace function public.auto_release_lpg_driver_payout_after_delivery()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  assigned_driver_user_id uuid;
  fulfillment_channel text;
begin
  if new.to_status<>'delivered' then return new; end if;

  select coalesce(target_order.fulfillment_channel,'marketplace'),driver.user_id
  into fulfillment_channel,assigned_driver_user_id
  from public.lpg_refill_orders target_order
  join public.driver_profiles driver on driver.id=target_order.driver_profile_id
  where target_order.id=new.lpg_order_id;

  if assigned_driver_user_id is null then
    raise exception 'verified LPG delivery requires an assigned driver before completion';
  end if;

  if fulfillment_channel='skima_internal' then
    perform public.settle_lpg_internal_order(
      new.lpg_order_id,new.idempotency_key||':auto-internal-settlement','lpg.internal_settlement.auto_delivery'
    );
  else
    perform public.execute_lpg_driver_commission(
      new.lpg_order_id,new.idempotency_key||':auto-driver-payout',null,assigned_driver_user_id,
      jsonb_build_object('automatic_delivery_release',true,'source_event_id',new.id),
      'lpg.driver_payout.auto_delivery'
    );
  end if;
  return new;
end
$$;

revoke all on function public.lpg_internal_live_driver_available(numeric,numeric) from public,anon,authenticated;
revoke all on function public.read_lpg_internal_launch_readiness() from public,anon;
revoke all on function public.dispatch_lpg_internal_order(uuid,integer,text,text) from public,anon,authenticated;
revoke all on function public.settle_lpg_internal_order(uuid,text,text) from public,anon,authenticated;

grant execute on function public.read_lpg_internal_launch_readiness() to authenticated,service_role;
grant execute on function public.dispatch_lpg_internal_order(uuid,integer,text,text) to service_role;
grant execute on function public.settle_lpg_internal_order(uuid,text,text) to service_role;

notify pgrst,'reload schema';
commit;
