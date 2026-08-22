create or replace function public.read_lpg_eligible_stations(
  target_pickup_location_id uuid,
  target_delivery_location_id uuid,
  target_cylinder_id uuid,
  target_requested_kg numeric,
  target_limit integer default 10,
  target_at timestamptz default timezone('utc', now())
)
returns table (
  station_branch_id uuid,
  display_name text,
  formatted_address text,
  latitude numeric,
  longitude numeric,
  service_radius_meters integer,
  pickup_distance_meters numeric,
  return_distance_meters numeric,
  route_proxy_distance_meters numeric,
  currency_code text,
  price_per_kg numeric,
  current_available_kg numeric,
  refill_capacity_kg numeric,
  supported_cylinder_sizes_kg numeric[],
  cylinder_size_kg numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  actor_user_id uuid := auth.uid();
  pickup_record public.lpg_customer_locations%rowtype;
  delivery_record public.lpg_customer_locations%rowtype;
  cylinder_record public.lpg_cylinders%rowtype;
  pickup_serviceability jsonb;
  delivery_serviceability jsonb;
begin
  if actor_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if target_requested_kg is null or target_requested_kg <= 0 then
    raise exception using errcode = '22023', message = 'target_requested_kg must be greater than zero';
  end if;

  if target_limit is null or target_limit < 1 or target_limit > 50 then
    raise exception using errcode = '22023', message = 'target_limit must be between 1 and 50';
  end if;

  select * into pickup_record
  from public.lpg_customer_locations
  where id = target_pickup_location_id
    and owner_user_id = actor_user_id
    and status <> 'deleted';
  if not found then
    raise exception using errcode = '42501', message = 'pickup location is not available to this customer';
  end if;

  select * into delivery_record
  from public.lpg_customer_locations
  where id = target_delivery_location_id
    and owner_user_id = actor_user_id
    and status <> 'deleted';
  if not found then
    raise exception using errcode = '42501', message = 'return location is not available to this customer';
  end if;

  select * into cylinder_record
  from public.lpg_cylinders
  where id = target_cylinder_id
    and owner_user_id = actor_user_id
    and status <> 'deactivated';
  if not found then
    raise exception using errcode = '42501', message = 'cylinder is not available to this customer';
  end if;

  if target_requested_kg > cylinder_record.max_capacity_kg then
    raise exception using errcode = '22023', message = 'requested refill exceeds verified cylinder capacity';
  end if;

  pickup_serviceability := public.resolve_lpg_serviceability(
    pickup_record.latitude::double precision,
    pickup_record.longitude::double precision,
    coalesce(pickup_record.metadata, '{}'::jsonb)
      || jsonb_build_object('formattedAddress', pickup_record.formatted_address)
  );
  delivery_serviceability := public.resolve_lpg_serviceability(
    delivery_record.latitude::double precision,
    delivery_record.longitude::double precision,
    coalesce(delivery_record.metadata, '{}'::jsonb)
      || jsonb_build_object('formattedAddress', delivery_record.formatted_address)
  );

  if not coalesce((pickup_serviceability ->> 'serviceable')::boolean, false)
     or not coalesce((delivery_serviceability ->> 'serviceable')::boolean, false) then
    return;
  end if;

  return query
  with candidate_stations as (
    select
      station.*,
      public.geo_distance_meters(
        station.latitude::double precision,
        station.longitude::double precision,
        pickup_record.latitude::double precision,
        pickup_record.longitude::double precision
      )::numeric as pickup_distance,
      public.geo_distance_meters(
        station.latitude::double precision,
        station.longitude::double precision,
        delivery_record.latitude::double precision,
        delivery_record.longitude::double precision
      )::numeric as return_distance
    from public.lpg_station_branches station
    where station.approval_status = 'approved'
      and station.compliance_status = 'approved'
      and station.availability_status = 'available'
      and station.latitude is not null
      and station.longitude is not null
      and coalesce(station.current_available_kg, 0) >= target_requested_kg
      and coalesce(station.refill_capacity_kg, 0) >= target_requested_kg
      and (
        coalesce(array_length(station.supported_cylinder_sizes_kg, 1), 0) = 0
        or cylinder_record.size_kg = any(station.supported_cylinder_sizes_kg)
      )
  ),
  effective_prices as (
    select distinct on (station.id)
      station.id as station_id,
      station.display_name,
      station.formatted_address,
      station.latitude,
      station.longitude,
      station.service_radius_meters,
      station.pickup_distance,
      station.return_distance,
      station.current_available_kg,
      station.refill_capacity_kg,
      station.supported_cylinder_sizes_kg,
      catalog_price.currency_code,
      catalog_price.amount as price_per_kg
    from candidate_stations station
    join public.catalog_prices catalog_price
      on catalog_price.organization_id = station.organization_id
     and catalog_price.branch_id is not distinct from station.branch_id
    join public.catalog_items catalog_item
      on catalog_item.id = catalog_price.item_id
    join public.business_modules module
      on module.id = catalog_item.module_id
     and module.key = 'lpg'
    where catalog_item.status = 'active'
      and catalog_item.item_type in ('product', 'service')
      and catalog_price.status = 'active'
      and catalog_price.currency_code = 'NGN'
      and catalog_price.effective_from <= target_at
      and (catalog_price.effective_until is null or catalog_price.effective_until > target_at)
      and catalog_price.metadata ->> 'price_basis' = 'per_kg'
      and catalog_price.amount >= 0
      and (
        station.service_radius_meters is null
        or station.service_radius_meters <= 0
        or greatest(station.pickup_distance, station.return_distance) <= station.service_radius_meters
      )
    order by station.id, catalog_price.effective_from desc, catalog_price.created_at desc
  )
  select
    priced.station_id,
    priced.display_name,
    priced.formatted_address,
    priced.latitude,
    priced.longitude,
    priced.service_radius_meters,
    round(priced.pickup_distance, 2),
    round(priced.return_distance, 2),
    round(priced.pickup_distance + priced.return_distance, 2),
    priced.currency_code,
    priced.price_per_kg,
    priced.current_available_kg,
    priced.refill_capacity_kg,
    priced.supported_cylinder_sizes_kg,
    cylinder_record.size_kg
  from effective_prices priced
  order by
    priced.pickup_distance + priced.return_distance asc,
    priced.price_per_kg asc,
    priced.station_id asc
  limit target_limit;
end;
$$;

revoke all on function public.read_lpg_eligible_stations(uuid, uuid, uuid, numeric, integer, timestamptz) from public, anon;
grant execute on function public.read_lpg_eligible_stations(uuid, uuid, uuid, numeric, integer, timestamptz) to authenticated, service_role;
