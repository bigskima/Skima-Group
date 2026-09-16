begin;

create or replace function public.resolve_lpg_internal_reference_policy(
  target_pickup_location_id uuid,
  target_at timestamptz default timezone('utc',now())
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  location_record public.lpg_customer_locations%rowtype;
  serviceability jsonb;
  geography_key text;
  geography_type text:='service_area';
  result jsonb;
begin
  select * into location_record
  from public.lpg_customer_locations
  where id=target_pickup_location_id;
  if not found then
    raise exception using errcode='22023',message='pickup location was not found';
  end if;

  serviceability:=public.resolve_lpg_serviceability(
    location_record.latitude::double precision,
    location_record.longitude::double precision,
    coalesce(location_record.metadata,'{}'::jsonb)
      || jsonb_build_object('formattedAddress',location_record.formatted_address)
  );
  if not coalesce((serviceability->>'serviceable')::boolean,false) then
    raise exception using errcode='P0001',message='pickup location is outside enabled LPG service coverage';
  end if;

  geography_key:=serviceability #>> '{matchedArea,id}';
  if geography_key is null then
    geography_type:='global';
  end if;

  result:=public.resolve_financial_policy(
    'pricing.lpg.internal_reference_per_kg',
    'NGN',
    target_at,
    'lpg',
    null,
    'lpg.refill.internal',
    geography_type,
    geography_key
  );

  return result || jsonb_build_object(
    'serviceability',serviceability,
    'resolvedGeographyType',geography_type,
    'resolvedGeographyKey',geography_key
  );
end
$$;

create or replace function public.resolve_lpg_internal_route_snapshot(
  target_pickup_location_id uuid,
  target_delivery_location_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  pickup_record public.lpg_customer_locations%rowtype;
  delivery_record public.lpg_customer_locations%rowtype;
  reference_policy jsonb;
  route_km numeric;
begin
  if auth.uid() is null and auth.role()<>'service_role' then
    raise exception using errcode='42501',message='authentication required';
  end if;

  select * into pickup_record
  from public.lpg_customer_locations
  where id=target_pickup_location_id
    and (auth.role()='service_role' or owner_user_id=auth.uid())
    and status<>'deleted';
  if not found then
    raise exception using errcode='42501',message='pickup location is not available to this customer';
  end if;

  select * into delivery_record
  from public.lpg_customer_locations
  where id=target_delivery_location_id
    and (auth.role()='service_role' or owner_user_id=auth.uid())
    and status<>'deleted';
  if not found then
    raise exception using errcode='42501',message='return location is not available to this customer';
  end if;

  reference_policy:=public.resolve_lpg_internal_reference_policy(target_pickup_location_id,timezone('utc',now()));
  route_km:=nullif(reference_policy #>> '{configuration,estimated_route_km}','')::numeric;
  if route_km is null or route_km<0 then
    raise exception using errcode='55000',message='internal LPG price policy must define estimated_route_km';
  end if;

  return jsonb_build_object(
    'provider','skima_internal_policy',
    'providerAdapterKey','policy.lpg.internal_route',
    'routeType','internal_service_area_estimate',
    'distanceMeters',round(route_km*1000,0),
    'distanceKilometers',route_km,
    'calculatedAt',timezone('utc',now()),
    'policyVersionId',reference_policy->>'policyVersionId',
    'geographyType',reference_policy->>'resolvedGeographyType',
    'geographyKey',reference_policy->>'resolvedGeographyKey'
  );
end
$$;

create or replace function public.calculate_lpg_internal_commercial_quote(
  target_pickup_location_id uuid,
  target_requested_kg numeric,
  target_route_snapshot jsonb,
  target_at timestamptz default timezone('utc',now())
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  reference_policy jsonb;
  markup_policy jsonb;
  delivery_policy jsonb;
  payout_policy jsonb;
  settlement_policy jsonb;
  reference_configuration jsonb;
  markup_configuration jsonb;
  delivery_configuration jsonb;
  payout_configuration jsonb;
  route_distance_meters numeric;
  route_distance_km numeric;
  reference_price_per_kg numeric;
  markup_per_kg numeric;
  lpg_amount numeric;
  platform_lpg_markup numeric;
  delivery_base_amount numeric;
  included_distance_km numeric;
  per_km_amount numeric;
  minimum_delivery_amount numeric;
  load_adjustment numeric;
  long_distance_surcharge numeric;
  customer_delivery_fee numeric;
  payout_percentage numeric;
  driver_payout numeric;
  logistics_margin numeric;
  distance_band jsonb;
  band_record jsonb;
  band_matches integer:=0;
begin
  if target_requested_kg is null or target_requested_kg<=0 then
    raise exception using errcode='22023',message='target_requested_kg must be greater than zero';
  end if;
  if target_route_snapshot is null or jsonb_typeof(target_route_snapshot)<>'object' then
    raise exception using errcode='22023',message='target_route_snapshot must be a JSON object';
  end if;

  route_distance_meters:=nullif(target_route_snapshot->>'distanceMeters','')::numeric;
  if route_distance_meters is null or route_distance_meters<0 or target_route_snapshot->>'provider' is null then
    raise exception using errcode='22023',message='an internal route snapshot is required for LPG pricing';
  end if;
  route_distance_km:=route_distance_meters/1000;

  reference_policy:=public.resolve_lpg_internal_reference_policy(target_pickup_location_id,target_at);
  markup_policy:=public.resolve_financial_policy(
    'pricing.lpg.platform_markup_per_kg','NGN',target_at,'lpg',null,'lpg.refill','global',null
  );
  delivery_policy:=public.resolve_financial_policy(
    'pricing.lpg.delivery','NGN',target_at,'lpg',null,'lpg.refill.delivery','global',null
  );
  payout_policy:=public.resolve_financial_policy(
    'payout.lpg.internal_driver','NGN',target_at,'lpg',null,'lpg.refill.internal','global',null
  );
  settlement_policy:=public.resolve_financial_policy(
    'settlement.lpg.internal','NGN',target_at,'lpg',null,'lpg.refill.internal.settlement','global',null
  );

  reference_configuration:=reference_policy->'configuration';
  markup_configuration:=markup_policy->'configuration';
  delivery_configuration:=delivery_policy->'configuration';
  payout_configuration:=payout_policy->'configuration';

  reference_price_per_kg:=nullif(reference_configuration->>'amount_per_kg','')::numeric;
  markup_per_kg:=nullif(markup_configuration->>'amount_per_kg','')::numeric;
  payout_percentage:=nullif(payout_configuration->>'percentage','')::numeric;

  if reference_price_per_kg is null or reference_price_per_kg<=0 then
    raise exception using errcode='55000',message='internal LPG reference policy must define a positive amount_per_kg';
  end if;
  if markup_per_kg is null or markup_per_kg<0 then
    raise exception using errcode='55000',message='LPG platform markup policy must define a non-negative amount_per_kg';
  end if;
  if payout_configuration->>'calculation_kind'<>'percentage_of_delivery_fee'
    or payout_percentage is null or payout_percentage<=0 or payout_percentage>100 then
    raise exception using errcode='55000',message='internal driver compensation must define a percentage greater than 0 and no more than 100';
  end if;

  if jsonb_typeof(coalesce(delivery_configuration->'distance_bands','[]'::jsonb))<>'array' then
    raise exception using errcode='55000',message='LPG delivery policy distance_bands must be an array';
  end if;

  for band_record in
    select value from jsonb_array_elements(coalesce(delivery_configuration->'distance_bands','[]'::jsonb))
  loop
    if route_distance_km>=coalesce(nullif(band_record->>'min_km','')::numeric,0)
      and (
        band_record->>'max_km' is null
        or route_distance_km<(band_record->>'max_km')::numeric
      ) then
      distance_band:=band_record;
      band_matches:=band_matches+1;
    end if;
  end loop;

  if band_matches<>1 then
    raise exception using errcode='55000',message='exactly one configured LPG delivery distance band must match the internal route estimate';
  end if;
  if coalesce((distance_band->>'supported')::boolean,true) is not true then
    raise exception using errcode='P0001',message='the internal LPG service route is outside the configured delivery area';
  end if;

  delivery_base_amount:=coalesce(
    nullif(distance_band->>'base_amount','')::numeric,
    nullif(delivery_configuration->>'base_amount','')::numeric,
    0
  );
  included_distance_km:=coalesce(
    nullif(distance_band->>'included_km','')::numeric,
    nullif(delivery_configuration->>'included_km','')::numeric,
    0
  );
  per_km_amount:=coalesce(
    nullif(distance_band->>'per_km_amount','')::numeric,
    nullif(delivery_configuration->>'per_km_amount','')::numeric,
    0
  );
  minimum_delivery_amount:=coalesce(
    nullif(distance_band->>'minimum_amount','')::numeric,
    nullif(delivery_configuration->>'minimum_amount','')::numeric,
    0
  );
  long_distance_surcharge:=coalesce(nullif(distance_band->>'surcharge_amount','')::numeric,0);
  load_adjustment:=round(
    target_requested_kg*coalesce(nullif(delivery_configuration->>'load_amount_per_kg','')::numeric,0),2
  );

  customer_delivery_fee:=greatest(
    round(
      delivery_base_amount
      + greatest(route_distance_km-included_distance_km,0)*per_km_amount
      + load_adjustment
      + long_distance_surcharge,
      2
    ),
    minimum_delivery_amount
  );

  driver_payout:=round(customer_delivery_fee*payout_percentage/100,2);
  if driver_payout<0 or driver_payout>customer_delivery_fee then
    raise exception using errcode='55000',message='internal driver compensation cannot exceed the customer delivery fee';
  end if;

  lpg_amount:=round(target_requested_kg*reference_price_per_kg,2);
  platform_lpg_markup:=round(target_requested_kg*markup_per_kg,2);
  logistics_margin:=customer_delivery_fee-driver_payout;

  return jsonb_build_object(
    'currencyCode','NGN',
    'requestedKg',target_requested_kg,
    'quotedKg',target_requested_kg,
    'fulfillmentChannel','skima_internal',
    'stationBranchId',null,
    'stationOrganizationId',null,
    'stationPriceRecordId',null,
    'stationPricePerKg',reference_price_per_kg,
    'internalReferencePricePerKg',reference_price_per_kg,
    'stationLpgAmount',lpg_amount,
    'internalReferenceLpgAmount',lpg_amount,
    'platformMarkupPerKg',markup_per_kg,
    'platformLpgMarkup',platform_lpg_markup,
    'customerDeliveryFee',customer_delivery_fee,
    'driverPayout',driver_payout,
    'driverPayoutPercentage',payout_percentage,
    'platformLogisticsMargin',logistics_margin,
    'route',target_route_snapshot || jsonb_build_object('distanceKilometers',route_distance_km),
    'distanceBand',distance_band,
    'components',jsonb_build_object(
      'deliveryBaseAmount',delivery_base_amount,
      'distanceAmount',round(greatest(route_distance_km-included_distance_km,0)*per_km_amount,2),
      'loadAdjustment',load_adjustment,
      'longDistanceSurcharge',long_distance_surcharge
    ),
    'policySnapshots',jsonb_build_object(
      'internalReference',reference_policy,
      'platformMarkup',markup_policy,
      'deliveryPricing',delivery_policy,
      'driverPayout',payout_policy,
      'settlement',settlement_policy
    ),
    'calculatedAt',target_at
  );
end
$$;

create or replace function public.resolve_lpg_internal_refill_quantity_from_amount(
  target_pickup_location_id uuid,
  target_amount numeric,
  target_at timestamptz default timezone('utc',now())
)
returns numeric
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  reference_policy jsonb;
  current_price numeric;
  resolved_kg numeric;
begin
  if auth.uid() is null and auth.role()<>'service_role' then
    raise exception using errcode='42501',message='authentication required';
  end if;
  if target_amount is null or target_amount<=0 then
    raise exception using errcode='22023',message='amount must be greater than zero';
  end if;

  reference_policy:=public.resolve_lpg_internal_reference_policy(target_pickup_location_id,target_at);
  current_price:=nullif(reference_policy #>> '{configuration,amount_per_kg}','')::numeric;
  if current_price is null or current_price<=0 then
    raise exception using errcode='55000',message='current internal LPG reference price is unavailable';
  end if;

  resolved_kg:=floor((target_amount/current_price)*1000)/1000;
  if resolved_kg<=0 then
    raise exception using errcode='22023',message='amount is below the minimum refill quantity';
  end if;
  return resolved_kg;
end
$$;

create or replace function public.create_lpg_internal_refill_quote(
  target_cylinder_id uuid,
  target_requested_kg numeric,
  target_pickup_location_id uuid,
  target_delivery_location_id uuid,
  target_route_snapshot jsonb,
  target_idempotency_key text,
  target_preferred_time timestamptz default null,
  target_delivery_instructions text default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'lpg.quote_api'
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
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
$$;

alter function public.create_lpg_refill_quote_from_purchase_input(
  uuid,numeric,numeric,uuid,uuid,uuid,jsonb,text,timestamptz,text,jsonb,text
) rename to create_lpg_marketplace_refill_quote_from_purchase_input;

create or replace function public.create_lpg_refill_quote_from_purchase_input(
  target_cylinder_id uuid,
  target_requested_kg numeric,
  target_requested_amount numeric,
  target_pickup_location_id uuid,
  target_delivery_location_id uuid,
  target_station_branch_id uuid,
  target_route_snapshot jsonb,
  target_idempotency_key text,
  target_preferred_time timestamptz default null,
  target_delivery_instructions text default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'lpg.quote_api'
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  internal_sentinel constant uuid:='00000000-0000-0000-0000-000000000001'::uuid;
  resolved_kg numeric;
begin
  if target_station_branch_id=internal_sentinel then
    if (target_requested_kg is null)=(target_requested_amount is null) then
      raise exception using errcode='22023',message='choose exactly one purchase input';
    end if;
    resolved_kg:=case
      when target_requested_amount is not null
        then public.resolve_lpg_internal_refill_quantity_from_amount(
          target_pickup_location_id,target_requested_amount,timezone('utc',now())
        )
      else target_requested_kg
    end;

    return public.create_lpg_internal_refill_quote(
      target_cylinder_id,resolved_kg,target_pickup_location_id,target_delivery_location_id,
      target_route_snapshot,target_idempotency_key,target_preferred_time,target_delivery_instructions,
      coalesce(target_metadata,'{}'::jsonb) || jsonb_build_object(
        'purchaseInput',case when target_requested_amount is null then 'weight' else 'amount' end,
        'requestedAmount',target_requested_amount,
        'digitalStationSentinel',internal_sentinel
      ),
      target_source
    );
  end if;

  return public.create_lpg_marketplace_refill_quote_from_purchase_input(
    target_cylinder_id,target_requested_kg,target_requested_amount,target_pickup_location_id,
    target_delivery_location_id,target_station_branch_id,target_route_snapshot,target_idempotency_key,
    target_preferred_time,target_delivery_instructions,target_metadata,target_source
  );
end
$$;

create or replace function public.enforce_lpg_refill_quote_station_eligibility()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  station_is_eligible boolean:=false;
begin
  if new.fulfillment_channel='skima_internal' then
    if new.station_branch_id is not null then
      raise exception using errcode='P0001',message='SKIMA internal fulfillment cannot be bound to a marketplace station';
    end if;
    if new.financial_policy_snapshot->'internalReference' is null then
      raise exception using errcode='55000',message='SKIMA internal fulfillment requires a locked geographic reference price';
    end if;
    new.metadata:=coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
      'stationEligibilityMode','skima_internal',
      'stationEligibilityVerifiedAt',timezone('utc',now())
    );
    return new;
  end if;

  if new.station_branch_id is null then
    raise exception using errcode='P0001',message='an eligible LPG station is required for this refill';
  end if;

  select exists(
    select 1
    from public.read_lpg_eligible_stations(
      new.pickup_location_id,new.delivery_location_id,new.cylinder_id,new.requested_kg,50,timezone('utc',now())
    ) eligible
    where eligible.station_branch_id=new.station_branch_id
  ) into station_is_eligible;

  if not station_is_eligible then
    raise exception using errcode='P0001',message='selected LPG station cannot fulfil this refill for the chosen trip';
  end if;

  new.metadata:=coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
    'stationEligibilityVerifiedAt',timezone('utc',now()),
    'stationEligibilityStationId',new.station_branch_id
  );
  return new;
end
$$;

create or replace function public.copy_lpg_quote_policy_snapshot_to_order()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  quote_record public.lpg_refill_quotes%rowtype;
begin
  select * into quote_record
  from public.lpg_refill_quotes where id=new.lpg_refill_quote_id;

  if not found
    or quote_record.financial_policy_snapshot is null
    or quote_record.financial_policy_snapshot='{}'::jsonb
    or quote_record.financial_policy_snapshot->'platformMarkup' is null
    or quote_record.financial_policy_snapshot->'deliveryPricing' is null
    or quote_record.financial_policy_snapshot->'driverPayout' is null
    or quote_record.financial_policy_snapshot->'settlement' is null then
    raise exception 'accepted LPG order requires a complete locked financial policy snapshot';
  end if;

  new.fulfillment_channel:=quote_record.fulfillment_channel;
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)
    || jsonb_build_object('fulfillmentChannel',quote_record.fulfillment_channel);

  new.financial_policy_snapshot:=quote_record.financial_policy_snapshot || jsonb_build_object(
    'snapshotSchema','skima.financial.lpg.order.v1',
    'commercialQuote',quote_record.breakdown,
    'acceptedQuote',jsonb_build_object(
      'quoteId',quote_record.id,
      'quotedKg',quote_record.quoted_kg,
      'stationAmount',quote_record.lpg_amount,
      'platformMarkupAmount',quote_record.platform_fee_amount,
      'deliveryFeeAmount',quote_record.delivery_fee_amount,
      'driverPayoutAmount',quote_record.driver_commission_amount,
      'taxAmount',quote_record.tax_amount,
      'totalAmount',quote_record.total_amount,
      'currencyCode',quote_record.currency_code,
      'fulfillmentChannel',quote_record.fulfillment_channel
    )
  );
  return new;
end
$$;

revoke all on function public.resolve_lpg_internal_reference_policy(uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.resolve_lpg_internal_route_snapshot(uuid,uuid) from public,anon;
revoke all on function public.calculate_lpg_internal_commercial_quote(uuid,numeric,jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.resolve_lpg_internal_refill_quantity_from_amount(uuid,numeric,timestamptz) from public,anon,authenticated;
revoke all on function public.create_lpg_internal_refill_quote(uuid,numeric,uuid,uuid,jsonb,text,timestamptz,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.create_lpg_refill_quote_from_purchase_input(uuid,numeric,numeric,uuid,uuid,uuid,jsonb,text,timestamptz,text,jsonb,text) from public,anon;

grant execute on function public.resolve_lpg_internal_route_snapshot(uuid,uuid) to authenticated,service_role;
grant execute on function public.create_lpg_refill_quote_from_purchase_input(uuid,numeric,numeric,uuid,uuid,uuid,jsonb,text,timestamptz,text,jsonb,text) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
