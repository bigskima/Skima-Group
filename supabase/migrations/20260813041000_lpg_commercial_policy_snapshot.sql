begin;

alter table public.lpg_refill_quotes
add column if not exists financial_policy_snapshot jsonb not null default '{}'::jsonb
  check (jsonb_typeof(financial_policy_snapshot) = 'object');

alter table public.lpg_refill_orders
add column if not exists financial_policy_snapshot jsonb not null default '{}'::jsonb
  check (jsonb_typeof(financial_policy_snapshot) = 'object');

alter table public.lpg_refill_quotes
add column if not exists quoted_kg numeric(12, 3);

update public.lpg_refill_quotes
set quoted_kg = requested_kg
where quoted_kg is null;

alter table public.lpg_refill_quotes
alter column quoted_kg set not null;

create or replace function public.calculate_lpg_commercial_quote(
  target_station_branch_id uuid,
  target_requested_kg numeric,
  target_route_snapshot jsonb,
  target_at timestamptz default timezone('utc', now())
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  station_record public.lpg_station_branches%rowtype;
  station_price_record record;
  markup_policy jsonb;
  delivery_policy jsonb;
  payout_policy jsonb;
  markup_configuration jsonb;
  delivery_configuration jsonb;
  payout_configuration jsonb;
  route_distance_meters numeric(28, 8);
  route_distance_km numeric(28, 8);
  station_price_per_kg numeric(28, 8);
  markup_per_kg numeric(28, 8);
  station_lpg_amount numeric(28, 8);
  platform_lpg_markup numeric(28, 8);
  delivery_base_amount numeric(28, 8);
  included_distance_km numeric(28, 8);
  per_km_amount numeric(28, 8);
  minimum_delivery_amount numeric(28, 8);
  load_adjustment numeric(28, 8);
  long_distance_surcharge numeric(28, 8);
  customer_delivery_fee numeric(28, 8);
  driver_payout numeric(28, 8);
  logistics_margin numeric(28, 8);
  distance_band jsonb;
  band_record jsonb;
  band_matches integer := 0;
begin
  if target_requested_kg is null or target_requested_kg <= 0 then
    raise exception 'target_requested_kg must be greater than zero';
  end if;

  if target_route_snapshot is null or jsonb_typeof(target_route_snapshot) <> 'object' then
    raise exception 'target_route_snapshot must be a JSON object';
  end if;

  route_distance_meters := nullif(target_route_snapshot ->> 'distanceMeters', '')::numeric;
  if route_distance_meters is null or route_distance_meters < 0
    or target_route_snapshot ->> 'provider' is null then
    raise exception 'a provider-normalized road route snapshot is required for LPG pricing';
  end if;
  route_distance_km := route_distance_meters / 1000;

  select * into station_record
  from public.lpg_station_branches
  where id = target_station_branch_id
    and approval_status = 'approved'
    and compliance_status = 'approved';
  if not found then raise exception 'an approved LPG station is required'; end if;

  select
    catalog_price.id,
    catalog_price.amount as price_per_kg,
    catalog_price.currency_code,
    catalog_price.effective_from,
    catalog_price.effective_until
  into station_price_record
  from public.catalog_prices catalog_price
  join public.catalog_items catalog_item on catalog_item.id = catalog_price.item_id
  where catalog_price.organization_id = station_record.organization_id
    and catalog_price.branch_id is not distinct from station_record.branch_id
    and catalog_item.module_id = (select id from public.business_modules where key = 'lpg')
    and catalog_item.item_type in ('product', 'service')
    and catalog_item.status = 'active'
    and catalog_price.status = 'active'
    and catalog_price.currency_code = 'NGN'
    and catalog_price.effective_from <= target_at
    and (catalog_price.effective_until is null or catalog_price.effective_until > target_at)
    and catalog_price.metadata ->> 'price_basis' = 'per_kg'
  order by catalog_price.effective_from desc
  limit 1;
  if not found then raise exception 'an effective station LPG selling price is required'; end if;

  station_price_per_kg := station_price_record.price_per_kg;
  markup_policy := public.resolve_financial_policy(
    'pricing.lpg.platform_markup_per_kg', 'NGN', target_at, 'lpg',
    station_record.organization_id, 'lpg.refill', 'global', null
  );
  delivery_policy := public.resolve_financial_policy(
    'pricing.lpg.delivery', 'NGN', target_at, 'lpg',
    station_record.organization_id, 'lpg.refill.delivery', 'global', null
  );
  payout_policy := public.resolve_financial_policy(
    'payout.lpg.driver', 'NGN', target_at, 'lpg',
    station_record.organization_id, 'lpg.refill.delivery', 'global', null
  );

  markup_configuration := markup_policy -> 'configuration';
  delivery_configuration := delivery_policy -> 'configuration';
  payout_configuration := payout_policy -> 'configuration';
  markup_per_kg := nullif(markup_configuration ->> 'amount_per_kg', '')::numeric;
  if markup_per_kg is null or markup_per_kg < 0 then
    raise exception 'LPG platform markup policy must define a non-negative amount_per_kg';
  end if;

  if jsonb_typeof(coalesce(delivery_configuration -> 'distance_bands', '[]'::jsonb)) <> 'array' then
    raise exception 'LPG delivery policy distance_bands must be an array';
  end if;

  for band_record in select value from jsonb_array_elements(coalesce(delivery_configuration -> 'distance_bands', '[]'::jsonb))
  loop
    if route_distance_km >= coalesce(nullif(band_record ->> 'min_km', '')::numeric, 0)
      and (
        band_record ->> 'max_km' is null
        or route_distance_km < (band_record ->> 'max_km')::numeric
      ) then
      distance_band := band_record;
      band_matches := band_matches + 1;
    end if;
  end loop;

  if band_matches <> 1 then
    raise exception 'exactly one configured LPG delivery distance band must match the service route';
  end if;

  if coalesce((distance_band ->> 'supported')::boolean, true) is not true then
    raise exception 'the LPG service route is outside the configured delivery area';
  end if;

  delivery_base_amount := coalesce(
    nullif(distance_band ->> 'base_amount', '')::numeric,
    nullif(delivery_configuration ->> 'base_amount', '')::numeric,
    0
  );
  included_distance_km := coalesce(nullif(distance_band ->> 'included_km', '')::numeric,
    nullif(delivery_configuration ->> 'included_km', '')::numeric, 0);
  per_km_amount := coalesce(nullif(distance_band ->> 'per_km_amount', '')::numeric,
    nullif(delivery_configuration ->> 'per_km_amount', '')::numeric, 0);
  minimum_delivery_amount := coalesce(nullif(distance_band ->> 'minimum_amount', '')::numeric,
    nullif(delivery_configuration ->> 'minimum_amount', '')::numeric, 0);
  long_distance_surcharge := coalesce(nullif(distance_band ->> 'surcharge_amount', '')::numeric, 0);
  load_adjustment := round(
    target_requested_kg * coalesce(nullif(delivery_configuration ->> 'load_amount_per_kg', '')::numeric, 0),
    2
  );

  customer_delivery_fee := greatest(round(
    delivery_base_amount
    + greatest(route_distance_km - included_distance_km, 0) * per_km_amount
    + load_adjustment
    + long_distance_surcharge,
    2
  ), minimum_delivery_amount);

  driver_payout := round(
    coalesce(nullif(payout_configuration ->> 'base_amount', '')::numeric, 0)
    + route_distance_km * coalesce(nullif(payout_configuration ->> 'per_km_amount', '')::numeric, 0)
    + target_requested_kg * coalesce(nullif(payout_configuration ->> 'load_amount_per_kg', '')::numeric, 0)
    + coalesce(nullif(distance_band ->> 'driver_surcharge_amount', '')::numeric, 0),
    2
  );

  if driver_payout < 0 or driver_payout > customer_delivery_fee then
    raise exception 'configured LPG driver payout must be between zero and the customer delivery fee';
  end if;

  station_lpg_amount := round(target_requested_kg * station_price_per_kg, 2);
  platform_lpg_markup := round(target_requested_kg * markup_per_kg, 2);
  logistics_margin := customer_delivery_fee - driver_payout;

  return jsonb_build_object(
    'currencyCode', 'NGN',
    'requestedKg', target_requested_kg,
    'quotedKg', target_requested_kg,
    'stationBranchId', station_record.id,
    'stationOrganizationId', station_record.organization_id,
    'stationPriceRecordId', station_price_record.id,
    'stationPricePerKg', station_price_per_kg,
    'stationLpgAmount', station_lpg_amount,
    'platformMarkupPerKg', markup_per_kg,
    'platformLpgMarkup', platform_lpg_markup,
    'customerDeliveryFee', customer_delivery_fee,
    'driverPayout', driver_payout,
    'platformLogisticsMargin', logistics_margin,
    'route', target_route_snapshot || jsonb_build_object('distanceKilometers', route_distance_km),
    'distanceBand', distance_band,
    'components', jsonb_build_object(
      'deliveryBaseAmount', delivery_base_amount,
      'distanceAmount', round(greatest(route_distance_km - included_distance_km, 0) * per_km_amount, 2),
      'loadAdjustment', load_adjustment,
      'longDistanceSurcharge', long_distance_surcharge
    ),
    'policySnapshots', jsonb_build_object(
      'platformMarkup', markup_policy,
      'deliveryPricing', delivery_policy,
      'driverPayout', payout_policy
    ),
    'calculatedAt', target_at
  );
end;
$$;

create or replace function public.configure_lpg_station_catalog_price(
  target_station_branch_id uuid,
  target_item_id uuid,
  target_price_per_kg numeric,
  target_effective_from timestamptz,
  target_idempotency_key text,
  target_effective_until timestamptz default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.station_catalog_price'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  station_record public.lpg_station_branches%rowtype;
  item_record public.catalog_items%rowtype;
begin
  if not public.can_manage_delegated_lpg_station_price(target_station_branch_id) then
    raise exception 'delegated branch price management permission is required';
  end if;

  select * into station_record from public.lpg_station_branches where id = target_station_branch_id;
  select * into item_record from public.catalog_items where id = target_item_id;
  if station_record.id is null or item_record.id is null
    or item_record.organization_id <> station_record.organization_id
    or item_record.branch_id is distinct from station_record.branch_id
    or item_record.module_id is distinct from (select id from public.business_modules where key = 'lpg') then
    raise exception 'target_item_id must be an LPG catalog item owned by the delegated station branch';
  end if;

  if target_price_per_kg is null or target_price_per_kg <= 0 then
    raise exception 'target_price_per_kg must be greater than zero';
  end if;

  return public.configure_catalog_price(
    target_item_id, null, 'NGN', target_price_per_kg, null, null, 'exempt',
    case when target_effective_from > timezone('utc', now()) then 'scheduled' else 'active' end,
    target_effective_from, target_effective_until, target_source, target_idempotency_key,
    target_metadata || jsonb_build_object(
      'price_basis', 'per_kg',
      'delegated_station_branch_id', target_station_branch_id,
      'managed_field', 'station_price_per_kg'
    )
  );
end;
$$;

create or replace function public.read_lpg_station_catalog_prices(
  target_station_branch_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  station_record public.lpg_station_branches%rowtype;
begin
  select * into station_record
  from public.lpg_station_branches station
  where (target_station_branch_id is null or station.id = target_station_branch_id)
    and public.can_read_lpg_station_branch(station.id)
  order by station.created_at asc
  limit 1;

  if not found then raise exception 'branch-scoped LPG station access is required'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', catalog_price.id,
      'itemId', catalog_item.id,
      'itemKey', catalog_item.key,
      'displayName', catalog_item.display_name,
      'currencyCode', catalog_price.currency_code,
      'pricePerKg', catalog_price.amount,
      'status', catalog_price.status,
      'effectiveFrom', catalog_price.effective_from,
      'effectiveUntil', catalog_price.effective_until
    ) order by catalog_item.display_name, catalog_price.effective_from desc)
    from public.catalog_prices catalog_price
    join public.catalog_items catalog_item on catalog_item.id = catalog_price.item_id
    where catalog_price.organization_id = station_record.organization_id
      and catalog_price.branch_id is not distinct from station_record.branch_id
      and catalog_item.module_id = (select id from public.business_modules where key = 'lpg')
      and catalog_price.status in ('active', 'scheduled')
  ), '[]'::jsonb);
end;
$$;

create or replace function public.create_lpg_refill_quote_from_commercial_snapshot(
  target_cylinder_id uuid,
  target_requested_kg numeric,
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
set search_path = public
as $$
declare
  quote_id uuid;
  commercial_snapshot jsonb;
  generic_quote_id uuid;
begin
  commercial_snapshot := public.calculate_lpg_commercial_quote(
    target_station_branch_id, target_requested_kg, target_route_snapshot, timezone('utc', now())
  );

  quote_id := public.create_lpg_refill_quote(
    target_cylinder_id, target_requested_kg, target_pickup_location_id,
    target_delivery_location_id, target_idempotency_key, target_station_branch_id,
    target_preferred_time, target_delivery_instructions,
    target_metadata || jsonb_build_object('commercial_policy_snapshot', commercial_snapshot),
    target_source
  );

  update public.lpg_refill_quotes
  set quoted_kg = target_requested_kg,
      lpg_amount = (commercial_snapshot ->> 'stationLpgAmount')::numeric,
      delivery_fee_amount = (commercial_snapshot ->> 'customerDeliveryFee')::numeric,
      platform_fee_amount = (commercial_snapshot ->> 'platformLpgMarkup')::numeric,
      driver_commission_amount = (commercial_snapshot ->> 'driverPayout')::numeric,
      total_amount = (commercial_snapshot ->> 'stationLpgAmount')::numeric
        + (commercial_snapshot ->> 'platformLpgMarkup')::numeric
        + (commercial_snapshot ->> 'customerDeliveryFee')::numeric,
      breakdown = commercial_snapshot,
      financial_policy_snapshot = commercial_snapshot -> 'policySnapshots',
      metadata = metadata || jsonb_build_object('commercial_policy_snapshot_locked', true),
      updated_at = timezone('utc', now())
  where id = quote_id
    and status = 'quoted';

  select price_quote_id into generic_quote_id from public.lpg_refill_quotes where id = quote_id;

  update public.price_quotes
  set subtotal_amount = (commercial_snapshot ->> 'stationLpgAmount')::numeric
        + (commercial_snapshot ->> 'customerDeliveryFee')::numeric,
      fee_amount = (commercial_snapshot ->> 'platformLpgMarkup')::numeric,
      tax_amount = 0,
      total_amount = (commercial_snapshot ->> 'stationLpgAmount')::numeric
        + (commercial_snapshot ->> 'platformLpgMarkup')::numeric
        + (commercial_snapshot ->> 'customerDeliveryFee')::numeric,
      pricing_context = commercial_snapshot,
      calculation_breakdown = commercial_snapshot,
      updated_at = timezone('utc', now())
  where id = generic_quote_id
    and status = 'calculated';

  return quote_id;
end;
$$;

create or replace function public.copy_lpg_quote_policy_snapshot_to_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  quote_snapshot jsonb;
begin
  select financial_policy_snapshot into quote_snapshot
  from public.lpg_refill_quotes where id = new.lpg_refill_quote_id;

  if quote_snapshot is null or quote_snapshot = '{}'::jsonb then
    raise exception 'accepted LPG order requires a locked financial policy snapshot';
  end if;

  new.financial_policy_snapshot := quote_snapshot;
  return new;
end;
$$;

drop trigger if exists copy_lpg_quote_policy_snapshot_to_order on public.lpg_refill_orders;
create trigger copy_lpg_quote_policy_snapshot_to_order
before insert on public.lpg_refill_orders
for each row execute function public.copy_lpg_quote_policy_snapshot_to_order();

create or replace function public.prevent_lpg_financial_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
  if old.financial_policy_snapshot <> new.financial_policy_snapshot then
    raise exception 'accepted LPG financial policy snapshot is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_lpg_quote_financial_snapshot_mutation on public.lpg_refill_quotes;
create trigger prevent_lpg_quote_financial_snapshot_mutation
before update on public.lpg_refill_quotes
for each row when (old.status in ('accepted', 'expired', 'cancelled'))
execute function public.prevent_lpg_financial_snapshot_mutation();

drop trigger if exists prevent_lpg_order_financial_snapshot_mutation on public.lpg_refill_orders;
create trigger prevent_lpg_order_financial_snapshot_mutation
before update on public.lpg_refill_orders
for each row execute function public.prevent_lpg_financial_snapshot_mutation();

revoke all on function public.calculate_lpg_commercial_quote(uuid, numeric, jsonb, timestamptz) from public;
revoke all on function public.create_lpg_refill_quote_from_commercial_snapshot(uuid, numeric, uuid, uuid, uuid, jsonb, text, timestamptz, text, jsonb, text) from public;
grant execute on function public.calculate_lpg_commercial_quote(uuid, numeric, jsonb, timestamptz) to authenticated, service_role;
grant execute on function public.create_lpg_refill_quote_from_commercial_snapshot(uuid, numeric, uuid, uuid, uuid, jsonb, text, timestamptz, text, jsonb, text) to authenticated, service_role;
grant execute on function public.configure_lpg_station_catalog_price(uuid, uuid, numeric, timestamptz, text, timestamptz, jsonb, text) to authenticated, service_role;
grant execute on function public.read_lpg_station_catalog_prices(uuid) to authenticated, service_role;

commit;
