begin;

-- Boundaryless named Managed Driver coverage must be considered by customer
-- quote gating as well as final dispatch. Match the saved locality, LGA and
-- state hierarchy whenever a managed area has no verified polygon.
CREATE OR REPLACE FUNCTION public.lpg_internal_live_driver_available(target_latitude numeric, target_longitude numeric, target_location_metadata jsonb, target_formatted_address text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  dispatch_policy jsonb;
  config jsonb;
  v_program_key text;
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

  v_program_key:=coalesce(config->>'internal_driver_program_key','driver.skima_special');
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
     and membership.program_key=v_program_key
     and membership.status='active'
     and membership.starts_at<=timezone('utc',now())
     and (membership.ends_at is null or membership.ends_at>timezone('utc',now()))
    join public.driver_vehicle_links vehicle_link
      on vehicle_link.driver_profile_id=driver.id
     and vehicle_link.relationship_type='fleet_owned'
     and vehicle_link.status='active'
     and vehicle_link.starts_at<=timezone('utc',now())
     and (vehicle_link.ends_at is null or vehicle_link.ends_at>timezone('utc',now()))
    join public.vehicles vehicle
      on vehicle.id=vehicle_link.vehicle_id
     and vehicle.platform_owned
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
              and case
                when geography.boundary_geometry is not null then extensions.st_covers(
                  geography.boundary_geometry,
                  extensions.st_setsrid(extensions.st_makepoint(target_longitude,target_latitude),4326)::extensions.geography
                )
                else coverage.metadata->>'managedDriverSetup'='true'
                  and public.managed_driver_geography_matches_location(
                    geography.id,target_location_metadata,target_formatted_address
                  )
              end
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
$function$
;

revoke all on function public.lpg_internal_live_driver_available(numeric,numeric,jsonb,text) from public,anon,authenticated;
grant execute on function public.lpg_internal_live_driver_available(numeric,numeric,jsonb,text) to service_role;

CREATE OR REPLACE FUNCTION public.create_lpg_internal_refill_quote(target_cylinder_id uuid, target_requested_kg numeric, target_pickup_location_id uuid, target_delivery_location_id uuid, target_route_snapshot jsonb, target_idempotency_key text, target_preferred_time timestamp with time zone DEFAULT NULL::timestamp with time zone, target_delivery_instructions text DEFAULT NULL::text, target_metadata jsonb DEFAULT '{}'::jsonb, target_source text DEFAULT 'lpg.quote_api'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  cylinder_record public.lpg_cylinders%rowtype;
  pickup_record public.lpg_customer_locations%rowtype;
  delivery_record public.lpg_customer_locations%rowtype;
  module_record record;
  pricing_policy_record record;
  settlement_policy_id uuid;
  dispatch_policy_id uuid;
  service_request_id uuid;
  price_quote_id uuid;
  quote_id uuid;
  quote_policy jsonb;
  quote_expiry_seconds integer;
  commercial_snapshot jsonb;
  financial_snapshot jsonb;
  quote_expires_at timestamptz;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authenticated user is required';
  end if;
  if target_requested_kg is null or target_requested_kg<=0 then
    raise exception using errcode='22023',message='requested kilograms must be greater than zero';
  end if;
  if coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='idempotency key is required';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='metadata must be an object';
  end if;

  select * into cylinder_record
  from public.lpg_cylinders
  where id=target_cylinder_id and owner_user_id=auth.uid()
  for update;
  if not found then
    raise exception using errcode='42501',message='cylinder is not available to this customer';
  end if;
  if cylinder_record.status not in ('active','pending_verification','verified')
    or cylinder_record.condition_status in ('damaged','unsafe','expired') then
    raise exception using errcode='55000',message='cylinder is not eligible for refill';
  end if;
  if target_requested_kg>cylinder_record.max_capacity_kg then
    raise exception using errcode='22023',message='requested refill exceeds cylinder maximum capacity';
  end if;

  select * into pickup_record
  from public.lpg_customer_locations
  where id=target_pickup_location_id and owner_user_id=auth.uid() and status='active';
  if not found then
    raise exception using errcode='42501',message='pickup location is not available to this customer';
  end if;

  select * into delivery_record
  from public.lpg_customer_locations
  where id=target_delivery_location_id and owner_user_id=auth.uid() and status='active';
  if not found then
    raise exception using errcode='42501',message='return location is not available to this customer';
  end if;

  if not coalesce((public.resolve_lpg_location_capability(
      'lpg','skima_managed_fulfillment',pickup_record.longitude,pickup_record.latitude,
      coalesce(pickup_record.metadata,'{}'::jsonb)||jsonb_build_object('formattedAddress',pickup_record.formatted_address),
      timezone('utc',now())
    )->>'available')::boolean,false)
    or not coalesce((public.resolve_lpg_location_capability(
      'lpg','skima_managed_fulfillment',delivery_record.longitude,delivery_record.latitude,
      coalesce(delivery_record.metadata,'{}'::jsonb)||jsonb_build_object('formattedAddress',delivery_record.formatted_address),
      timezone('utc',now())
    )->>'available')::boolean,false) then
    raise exception using errcode='55000',message='SKIMA Managed fulfilment is not enabled for both selected locations';
  end if;
  if not public.lpg_internal_live_driver_available(
      pickup_record.latitude,pickup_record.longitude,
      coalesce(pickup_record.metadata,'{}'::jsonb),pickup_record.formatted_address
    )
    or not public.lpg_internal_live_driver_available(
      delivery_record.latitude,delivery_record.longitude,
      coalesce(delivery_record.metadata,'{}'::jsonb),delivery_record.formatted_address
    ) then
    raise exception using errcode='55000',message='no active SKIMA Managed driver and eligible fleet vehicle can serve both selected locations';
  end if;

  commercial_snapshot:=public.calculate_lpg_internal_commercial_quote(
    target_pickup_location_id,target_requested_kg,target_route_snapshot,timezone('utc',now())
  );
  financial_snapshot:=commercial_snapshot->'policySnapshots';

  quote_policy:=public.lpg_policy_config('lpg.quote.phase_one');
  quote_expiry_seconds:=nullif(quote_policy->>'quote_expiry_seconds','')::integer;
  if quote_expiry_seconds is null or quote_expiry_seconds<=0 then
    raise exception using errcode='55000',message='LPG quote expiry policy is incomplete';
  end if;
  quote_expires_at:=timezone('utc',now())+make_interval(secs=>quote_expiry_seconds);

  select module.id,version.id as version_id into module_record
  from public.business_modules module
  join public.business_module_versions version on version.module_id=module.id
  where module.key='lpg' and module.status='active' and version.status='active'
  order by version.version desc limit 1;
  if not found then
    raise exception using errcode='55000',message='active LPG module version is required';
  end if;

  select * into pricing_policy_record
  from public.pricing_policies
  where key=quote_policy->>'pricing_policy_key' and status='active'
  order by version desc limit 1;
  if not found then
    raise exception using errcode='55000',message='active LPG pricing policy is required';
  end if;

  select id into settlement_policy_id
  from public.settlement_policies
  where key='settlement.lpg.escrow.skima-internal.v1' and status='active'
  order by version desc limit 1;
  if settlement_policy_id is null then
    raise exception using errcode='55000',message='active SKIMA internal LPG settlement policy is required';
  end if;

  select id into dispatch_policy_id
  from public.dispatch_policies
  where key=quote_policy->>'dispatch_policy_key' and status='active'
  limit 1;
  if dispatch_policy_id is null then
    raise exception using errcode='55000',message='active LPG dispatch policy is required';
  end if;

  insert into public.service_requests(
    module_id,module_version_id,requester_user_id,pricing_policy_id,settlement_policy_id,
    dispatch_policy_id,status,request_payload,participants,source,idempotency_key,metadata
  ) values(
    module_record.id,module_record.version_id,auth.uid(),pricing_policy_record.id,settlement_policy_id,
    dispatch_policy_id,'priced',
    jsonb_build_object(
      'bounded_context','lpg',
      'fulfillment_channel','skima_internal',
      'cylinder_id',target_cylinder_id,
      'requested_kg',target_requested_kg,
      'pickup_location',jsonb_build_object('id',pickup_record.id,'latitude',pickup_record.latitude,'longitude',pickup_record.longitude),
      'delivery_location',jsonb_build_object('id',delivery_record.id,'latitude',delivery_record.latitude,'longitude',delivery_record.longitude),
      'dropoff_location',jsonb_build_object('id',delivery_record.id,'latitude',delivery_record.latitude,'longitude',delivery_record.longitude),
      'station_branch_id',null,
      'preferred_time',target_preferred_time,
      'delivery_instructions',target_delivery_instructions
    ),
    jsonb_build_object('customer_user_id',auth.uid(),'fulfillment_channel','skima_internal'),
    target_source,target_idempotency_key||':service-request',
    target_metadata || jsonb_build_object('quote_policy_key','lpg.quote.phase_one','fulfillmentChannel','skima_internal')
  )
  on conflict(source,idempotency_key) do nothing
  returning id into service_request_id;

  if service_request_id is null then
    select id into quote_id
    from public.lpg_refill_quotes
    where source=target_source and idempotency_key=target_idempotency_key;
    if quote_id is not null then return quote_id; end if;
    raise exception 'LPG internal quote idempotency lookup failed';
  end if;

  insert into public.price_quotes(
    service_request_id,pricing_policy_id,module_id,currency_code,status,
    subtotal_amount,fee_amount,discount_amount,tax_amount,total_amount,
    pricing_context,calculation_breakdown,expires_at,source,idempotency_key,created_by
  ) values(
    service_request_id,pricing_policy_record.id,module_record.id,'NGN','calculated',
    (commercial_snapshot->>'stationLpgAmount')::numeric + (commercial_snapshot->>'customerDeliveryFee')::numeric,
    (commercial_snapshot->>'platformLpgMarkup')::numeric,
    0,0,
    (commercial_snapshot->>'stationLpgAmount')::numeric
      + (commercial_snapshot->>'customerDeliveryFee')::numeric
      + (commercial_snapshot->>'platformLpgMarkup')::numeric,
    jsonb_build_object(
      'requested_kg',target_requested_kg,
      'fulfillment_channel','skima_internal',
      'internal_reference_policy_version_id',commercial_snapshot #>> '{policySnapshots,internalReference,policyVersionId}'
    ),
    commercial_snapshot,
    quote_expires_at,target_source,target_idempotency_key||':price-quote',auth.uid()
  )
  returning id into price_quote_id;

  update public.service_requests
  set active_quote_id=price_quote_id,updated_at=timezone('utc',now())
  where id=service_request_id;

  insert into public.lpg_refill_quotes(
    service_request_id,price_quote_id,cylinder_id,pickup_location_id,delivery_location_id,
    station_branch_id,pricing_id,requested_kg,quoted_kg,currency_code,lpg_amount,
    delivery_fee_amount,platform_fee_amount,tax_amount,driver_commission_amount,total_amount,
    status,expires_at,breakdown,financial_policy_snapshot,fulfillment_channel,metadata,
    source,idempotency_key
  ) values(
    service_request_id,price_quote_id,target_cylinder_id,target_pickup_location_id,target_delivery_location_id,
    null,null,target_requested_kg,target_requested_kg,'NGN',
    (commercial_snapshot->>'stationLpgAmount')::numeric,
    (commercial_snapshot->>'customerDeliveryFee')::numeric,
    (commercial_snapshot->>'platformLpgMarkup')::numeric,
    0,
    (commercial_snapshot->>'driverPayout')::numeric,
    (commercial_snapshot->>'stationLpgAmount')::numeric
      + (commercial_snapshot->>'customerDeliveryFee')::numeric
      + (commercial_snapshot->>'platformLpgMarkup')::numeric,
    'quoted',quote_expires_at,commercial_snapshot,financial_snapshot,'skima_internal',
    target_metadata || jsonb_build_object(
      'commercial_policy_snapshot',commercial_snapshot,
      'commercial_policy_snapshot_locked',true,
      'fulfillmentChannel','skima_internal'
    ),
    target_source,target_idempotency_key
  )
  returning id into quote_id;

  insert into public.service_request_events(
    service_request_id,event_type_key,status,idempotency_key,metadata
  ) values(
    service_request_id,'event.request.created','priced',target_idempotency_key||':lpg:quoted',
    jsonb_build_object('lpg_quote_id',quote_id,'price_quote_id',price_quote_id,'fulfillment_channel','skima_internal')
  ) on conflict do nothing;

  return quote_id;
end
$function$
;

CREATE OR REPLACE FUNCTION public.read_lpg_internal_candidate_for_kg(target_pickup_location_id uuid, target_delivery_location_id uuid, target_cylinder_id uuid, target_requested_kg numeric, target_at timestamp with time zone DEFAULT timezone('utc'::text, now()))
 RETURNS TABLE(station_branch_id uuid, display_name text, formatted_address text, latitude numeric, longitude numeric, service_radius_meters integer, pickup_distance_meters numeric, return_distance_meters numeric, route_proxy_distance_meters numeric, currency_code text, price_per_kg numeric, current_available_kg numeric, refill_capacity_kg numeric, supported_cylinder_sizes_kg numeric[], cylinder_size_kg numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  if not coalesce((public.resolve_lpg_location_capability(
      'lpg','skima_managed_fulfillment',pickup_record.longitude,pickup_record.latitude,
      coalesce(pickup_record.metadata,'{}'::jsonb)||jsonb_build_object('formattedAddress',pickup_record.formatted_address),
      timezone('utc',now())
    )->>'available')::boolean,false)
    or not coalesce((public.resolve_lpg_location_capability(
      'lpg','skima_managed_fulfillment',delivery_record.longitude,delivery_record.latitude,
      coalesce(delivery_record.metadata,'{}'::jsonb)||jsonb_build_object('formattedAddress',delivery_record.formatted_address),
      timezone('utc',now())
    )->>'available')::boolean,false) then
    return;
  end if;
  if not public.lpg_internal_live_driver_available(
      pickup_record.latitude,pickup_record.longitude,
      coalesce(pickup_record.metadata,'{}'::jsonb),pickup_record.formatted_address
    )
    or not public.lpg_internal_live_driver_available(
      delivery_record.latitude,delivery_record.longitude,
      coalesce(delivery_record.metadata,'{}'::jsonb),delivery_record.formatted_address
    ) then
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
$function$
;

commit;
