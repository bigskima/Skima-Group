begin;

-- Nigeria-first launch control: station-managed branches may cover a customer location
-- outside SKIMA's general customer-ordering area only when this explicit switch is enabled.
create table if not exists public.lpg_station_managed_coverage_policy (
  singleton boolean primary key default true check (singleton),
  outside_customer_coverage_enabled boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  change_reason text not null default 'Initial policy',
  version bigint not null default 1 check (version > 0)
);

insert into public.lpg_station_managed_coverage_policy(singleton, outside_customer_coverage_enabled, change_reason)
values (true, false, 'Initial safe default: station-managed external coverage requires admin activation')
on conflict (singleton) do nothing;

create table if not exists public.lpg_station_managed_coverage_policy_events (
  id uuid primary key default gen_random_uuid(),
  version bigint not null,
  previous_enabled boolean not null,
  next_enabled boolean not null,
  reason text not null check (char_length(btrim(reason)) between 5 and 500),
  actor_user_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  unique(version)
);

alter table public.lpg_station_managed_coverage_policy enable row level security;
alter table public.lpg_station_managed_coverage_policy_events enable row level security;

revoke all on public.lpg_station_managed_coverage_policy,
  public.lpg_station_managed_coverage_policy_events from public, anon, authenticated;
grant select, insert, update, delete on public.lpg_station_managed_coverage_policy,
  public.lpg_station_managed_coverage_policy_events to service_role;

create or replace function public.read_lpg_station_managed_coverage_policy()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare policy_record public.lpg_station_managed_coverage_policy%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode='42501', message='authentication required';
  end if;
  if not (
    public.is_platform_super_admin()
    or public.has_permission('platform.dispatch.read', null)
    or public.has_permission('platform.dispatch.manage', null)
  ) then
    raise exception using errcode='42501', message='LPG coverage policy read permission is required';
  end if;
  select * into policy_record from public.lpg_station_managed_coverage_policy where singleton=true;
  if not found then
    raise exception using errcode='55000', message='LPG station-managed coverage policy is missing';
  end if;
  return jsonb_build_object(
    'outsideCustomerCoverageEnabled', policy_record.outside_customer_coverage_enabled,
    'updatedAt', policy_record.updated_at,
    'updatedBy', policy_record.updated_by,
    'changeReason', policy_record.change_reason,
    'version', policy_record.version
  );
end
$$;

create or replace function public.configure_lpg_station_managed_coverage_policy(
  target_enabled boolean,
  target_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare policy_record public.lpg_station_managed_coverage_policy%rowtype;
  previous_enabled boolean;
begin
  if auth.uid() is null then
    raise exception using errcode='42501', message='authentication required';
  end if;
  if not (
    public.is_platform_super_admin()
    or public.has_permission('platform.dispatch.manage', null)
  ) then
    raise exception using errcode='42501', message='LPG coverage policy manage permission is required';
  end if;
  if target_enabled is null
    or target_reason is null
    or char_length(btrim(target_reason)) < 5
    or char_length(btrim(target_reason)) > 500 then
    raise exception using errcode='22023', message='A valid state and a change reason of 5 to 500 characters are required';
  end if;

  select * into policy_record
  from public.lpg_station_managed_coverage_policy
  where singleton=true
  for update;
  if not found then
    raise exception using errcode='55000', message='LPG station-managed coverage policy is missing';
  end if;

  previous_enabled := policy_record.outside_customer_coverage_enabled;
  update public.lpg_station_managed_coverage_policy
  set outside_customer_coverage_enabled=target_enabled,
      updated_by=auth.uid(),
      updated_at=timezone('utc', now()),
      change_reason=btrim(target_reason),
      version=version + 1
  where singleton=true
  returning * into policy_record;

  insert into public.lpg_station_managed_coverage_policy_events(
    version, previous_enabled, next_enabled, reason, actor_user_id
  ) values (
    policy_record.version, previous_enabled, target_enabled, btrim(target_reason), auth.uid()
  );

  return jsonb_build_object(
    'outsideCustomerCoverageEnabled', policy_record.outside_customer_coverage_enabled,
    'updatedAt', policy_record.updated_at,
    'updatedBy', policy_record.updated_by,
    'changeReason', policy_record.change_reason,
    'version', policy_record.version
  );
end
$$;

create or replace function public.read_lpg_station_managed_eligible_stations(
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
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  actor_user_id uuid := auth.uid();
  pickup_record public.lpg_customer_locations%rowtype;
  delivery_record public.lpg_customer_locations%rowtype;
  cylinder_record public.lpg_cylinders%rowtype;
  coverage_enabled boolean := false;
begin
  if actor_user_id is null then
    raise exception using errcode='42501', message='authentication required';
  end if;
  if target_requested_kg is null or target_requested_kg <= 0 then
    raise exception using errcode='22023', message='target_requested_kg must be greater than zero';
  end if;
  if target_limit is null or target_limit < 1 or target_limit > 50 then
    raise exception using errcode='22023', message='target_limit must be between 1 and 50';
  end if;

  select * into pickup_record from public.lpg_customer_locations
  where id=target_pickup_location_id and owner_user_id=actor_user_id and status='active';
  if not found then raise exception using errcode='42501', message='pickup location is not available to this customer'; end if;
  select * into delivery_record from public.lpg_customer_locations
  where id=target_delivery_location_id and owner_user_id=actor_user_id and status='active';
  if not found then raise exception using errcode='42501', message='return location is not available to this customer'; end if;
  select * into cylinder_record from public.lpg_cylinders
  where id=target_cylinder_id and owner_user_id=actor_user_id and status<>'deactivated';
  if not found then raise exception using errcode='42501', message='cylinder is not available to this customer'; end if;
  if target_requested_kg > cylinder_record.max_capacity_kg then
    raise exception using errcode='22023', message='requested refill exceeds verified cylinder capacity';
  end if;

  select coalesce(p.outside_customer_coverage_enabled, false)
  into coverage_enabled
  from public.lpg_station_managed_coverage_policy p
  where p.singleton=true;
  if not coalesce(coverage_enabled, false) then
    return;
  end if;

  return query
  with candidate_stations as (
    select
      station.*,
      public.geo_distance_meters(station.latitude::double precision, station.longitude::double precision,
        pickup_record.latitude::double precision, pickup_record.longitude::double precision)::numeric as pickup_distance,
      public.geo_distance_meters(station.latitude::double precision, station.longitude::double precision,
        delivery_record.latitude::double precision, delivery_record.longitude::double precision)::numeric as return_distance
    from public.lpg_station_branches station
    join public.lpg_station_fulfillment_settings settings
      on settings.station_branch_id=station.id and settings.station_managed_enabled
    where station.approval_status='approved'
      and station.compliance_status='approved'
      and station.availability_status='available'
      and station.latitude is not null and station.longitude is not null
      -- External coverage must be bounded by an explicit, positive radius.
      and station.service_radius_meters is not null and station.service_radius_meters > 0
      and coalesce(station.current_available_kg, 0) >= target_requested_kg
      and coalesce(station.refill_capacity_kg, 0) >= target_requested_kg
      and (coalesce(array_length(station.supported_cylinder_sizes_kg, 1), 0)=0
        or cylinder_record.size_kg=any(station.supported_cylinder_sizes_kg))
      and exists (
        select 1 from public.lpg_station_managed_drivers driver
        where driver.station_branch_id=station.id and driver.status='active'
      )
  ),
  covered_stations as (
    select station.* from candidate_stations station
    where greatest(station.pickup_distance, station.return_distance) <= station.service_radius_meters
  ),
  effective_prices as (
    select distinct on (station.id)
      station.id as station_id, station.display_name, station.formatted_address,
      station.latitude, station.longitude, station.service_radius_meters,
      station.pickup_distance, station.return_distance, station.current_available_kg,
      station.refill_capacity_kg, station.supported_cylinder_sizes_kg,
      settings.currency_code, catalog_price.amount as price_per_kg
    from covered_stations station
    join public.lpg_station_fulfillment_settings settings on settings.station_branch_id=station.id
    join public.catalog_prices catalog_price
      on catalog_price.organization_id=station.organization_id
     and catalog_price.branch_id is not distinct from station.branch_id
    join public.catalog_items catalog_item on catalog_item.id=catalog_price.item_id
    join public.business_modules module on module.id=catalog_item.module_id and module.key='lpg'
    where catalog_item.status='active'
      and catalog_item.item_type in ('product','service')
      and catalog_price.status='active'
      and catalog_price.currency_code=settings.currency_code
      and catalog_price.effective_from <= target_at
      and (catalog_price.effective_until is null or catalog_price.effective_until > target_at)
      and catalog_price.metadata->>'price_basis'='per_kg'
      and catalog_price.amount > 0
    order by station.id, catalog_price.effective_from desc, catalog_price.created_at desc
  )
  select priced.station_id, priced.display_name, priced.formatted_address,
    priced.latitude, priced.longitude, priced.service_radius_meters,
    round(priced.pickup_distance,2), round(priced.return_distance,2),
    round(priced.pickup_distance + priced.return_distance,2),
    priced.currency_code, priced.price_per_kg, priced.current_available_kg,
    priced.refill_capacity_kg, priced.supported_cylinder_sizes_kg, cylinder_record.size_kg
  from effective_prices priced
  order by greatest(priced.pickup_distance, priced.return_distance), priced.display_name
  limit target_limit;
end
$$;

create or replace function public.read_lpg_station_managed_eligible_stations_for_amount(
  target_pickup_location_id uuid,
  target_delivery_location_id uuid,
  target_cylinder_id uuid,
  target_requested_amount numeric,
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
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  candidate record;
  resolved_kg numeric;
  actor_user_id uuid := auth.uid();
  pickup_record public.lpg_customer_locations%rowtype;
  delivery_record public.lpg_customer_locations%rowtype;
  cylinder_record public.lpg_cylinders%rowtype;
  matched_count integer := 0;
begin
  if actor_user_id is null then raise exception using errcode='42501', message='authentication required'; end if;
  if target_limit is null or target_limit < 1 or target_limit > 50 then
    raise exception using errcode='22023', message='target_limit must be between 1 and 50';
  end if;
  if target_requested_amount is null or target_requested_amount <= 0 then
    raise exception using errcode='22023', message='target_requested_amount must be greater than zero';
  end if;
  select * into pickup_record from public.lpg_customer_locations
  where id=target_pickup_location_id and owner_user_id=actor_user_id and status='active';
  if not found then raise exception using errcode='42501', message='pickup location is not available to this customer'; end if;
  select * into delivery_record from public.lpg_customer_locations
  where id=target_delivery_location_id and owner_user_id=actor_user_id and status='active';
  if not found then raise exception using errcode='42501', message='return location is not available to this customer'; end if;
  select * into cylinder_record from public.lpg_cylinders
  where id=target_cylinder_id and owner_user_id=actor_user_id and status<>'deactivated';
  if not found then raise exception using errcode='42501', message='cylinder is not available to this customer'; end if;

  for candidate in
    select * from public.read_lpg_station_managed_eligible_stations(
      target_pickup_location_id, target_delivery_location_id, target_cylinder_id,
      0.001, 50, target_at
    )
  loop
    resolved_kg := floor((target_requested_amount / candidate.price_per_kg) * 1000) / 1000;
    if resolved_kg > 0
      and resolved_kg <= cylinder_record.max_capacity_kg
      and resolved_kg <= candidate.current_available_kg
      and resolved_kg <= candidate.refill_capacity_kg then
      station_branch_id := candidate.station_branch_id;
      display_name := candidate.display_name;
      formatted_address := candidate.formatted_address;
      latitude := candidate.latitude;
      longitude := candidate.longitude;
      service_radius_meters := candidate.service_radius_meters;
      pickup_distance_meters := candidate.pickup_distance_meters;
      return_distance_meters := candidate.return_distance_meters;
      route_proxy_distance_meters := candidate.route_proxy_distance_meters;
      currency_code := candidate.currency_code;
      price_per_kg := candidate.price_per_kg;
      current_available_kg := candidate.current_available_kg;
      refill_capacity_kg := candidate.refill_capacity_kg;
      supported_cylinder_sizes_kg := candidate.supported_cylinder_sizes_kg;
      cylinder_size_kg := candidate.cylinder_size_kg;
      return next;
      matched_count := matched_count + 1;
      if matched_count >= target_limit then return; end if;
    end if;
  end loop;
end
$$;

-- Maintain the existing customer serviceability contract. Only explicitly selected
-- Station Managed orders may use the new, bounded station-radius path outside the
-- customer_ordering launch geography.
create or replace function public.enforce_lpg_refill_quote_serviceability()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  pickup_record record;
  delivery_record record;
  pickup_resolution jsonb;
  delivery_resolution jsonb;
  station_coverage_override boolean := false;
  eligible_station_count integer := 0;
begin
  select location.latitude, location.longitude, location.metadata
  into pickup_record from public.lpg_customer_locations location
  where location.id = new.pickup_location_id and location.status <> 'deleted';
  if not found then
    raise exception using errcode='23503', message='pickup location is missing for LPG serviceability verification';
  end if;

  select location.latitude, location.longitude, location.metadata
  into delivery_record from public.lpg_customer_locations location
  where location.id = new.delivery_location_id and location.status <> 'deleted';
  if not found then
    raise exception using errcode='23503', message='delivery location is missing for LPG serviceability verification';
  end if;

  pickup_resolution := public.resolve_lpg_serviceability(
    pickup_record.latitude, pickup_record.longitude, coalesce(pickup_record.metadata, '{}'::jsonb)
  );
  delivery_resolution := public.resolve_lpg_serviceability(
    delivery_record.latitude, delivery_record.longitude, coalesce(delivery_record.metadata, '{}'::jsonb)
  );

  if not coalesce((pickup_resolution ->> 'serviceable')::boolean, false)
    or not coalesce((delivery_resolution ->> 'serviceable')::boolean, false) then
    if coalesce(nullif(new.metadata->>'fulfillment_mode',''), new.fulfillment_mode, 'independent_driver') <> 'station_managed'
      or new.station_branch_id is null then
      raise exception using errcode='P0001',
        message='LPG service is not available for this trip through the selected fulfilment model';
    end if;

    -- This fallback is specifically for areas where customer-ordering has not
    -- launched. It must never override an explicit exclusion, a paused service,
    -- a location-quality failure, or a policy-configuration conflict.
    if (
      not coalesce((pickup_resolution->>'serviceable')::boolean,false)
      and pickup_resolution->>'reason' is distinct from 'SERVICE_NOT_LAUNCHED'
    ) or (
      not coalesce((delivery_resolution->>'serviceable')::boolean,false)
      and delivery_resolution->>'reason' is distinct from 'SERVICE_NOT_LAUNCHED'
    ) then
      raise exception using errcode='P0001',
        message='Station Managed cannot override an excluded, paused, or policy-blocked LPG area';
    end if;

    select count(*) into eligible_station_count
    from public.read_lpg_station_managed_eligible_stations(
      new.pickup_location_id, new.delivery_location_id, new.cylinder_id,
      new.requested_kg, 50, timezone('utc', now())
    ) candidate
    where candidate.station_branch_id = new.station_branch_id;

    if eligible_station_count = 0 then
      raise exception using errcode='P0001',
        message='The selected station is not eligible to serve both locations outside SKIMA customer coverage';
    end if;
    station_coverage_override := true;
  end if;

  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'serviceabilitySnapshot', jsonb_build_object(
      'verifiedAt', timezone('utc', now()),
      'pickup', pickup_resolution,
      'return', delivery_resolution,
      'stationManagedCoverageOverride', station_coverage_override,
      'stationBranchId', case when station_coverage_override then new.station_branch_id else null end
    )
  );
  return new;
end
$$;

-- Dollar quoting validated for the quote-eligibility trigger.
create or replace function public.enforce_lpg_refill_quote_station_eligibility()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  regular_station_eligible boolean := false;
  external_station_eligible boolean := false;
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

  if coalesce(nullif(new.metadata->>'fulfillment_mode',''),new.fulfillment_mode,'independent_driver')='station_managed' then
    if not exists(
      select 1
      from public.lpg_station_branches station
      join public.lpg_station_fulfillment_settings settings
        on settings.station_branch_id=station.id and settings.station_managed_enabled
      where station.id=new.station_branch_id
        and station.approval_status='approved'
        and station.compliance_status='approved'
        and station.availability_status='available'
        and exists(
          select 1 from public.lpg_station_managed_drivers driver
          where driver.station_branch_id=station.id and driver.status='active'
        )
    ) then
      raise exception using errcode='P0001',
        message='Station Managed requires an approved, available branch with Station Managed enabled and an active branch driver';
    end if;
  end if;

  select exists(
    select 1
    from public.read_lpg_eligible_stations(
      new.pickup_location_id,new.delivery_location_id,new.cylinder_id,new.requested_kg,50,timezone('utc',now())
    ) eligible
    where eligible.station_branch_id=new.station_branch_id
  ) into regular_station_eligible;

  if not regular_station_eligible and coalesce(nullif(new.metadata->>'fulfillment_mode',''),new.fulfillment_mode,'independent_driver')='station_managed' then
    select exists(
      select 1
      from public.read_lpg_station_managed_eligible_stations(
        new.pickup_location_id,new.delivery_location_id,new.cylinder_id,new.requested_kg,50,timezone('utc',now())
      ) eligible
      where eligible.station_branch_id=new.station_branch_id
    ) into external_station_eligible;
  end if;

  if not regular_station_eligible and not external_station_eligible then
    raise exception using errcode='P0001',
      message='selected LPG station cannot fulfil this refill for the chosen trip';
  end if;

  new.metadata:=coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
    'stationEligibilityVerifiedAt',timezone('utc',now()),
    'stationEligibilityStationId',new.station_branch_id,
    'stationEligibilityMode',case
      when external_station_eligible then 'station_managed_external_coverage'
      when coalesce(nullif(new.metadata->>'fulfillment_mode',''),new.fulfillment_mode,'independent_driver')='station_managed' then 'station_managed'
      else 'independent_driver'
    end
  );
  return new;
end
$$;

revoke all on function public.read_lpg_station_managed_eligible_stations(uuid,uuid,uuid,numeric,integer,timestamptz)
  from public, anon;
revoke all on function public.read_lpg_station_managed_eligible_stations_for_amount(uuid,uuid,uuid,numeric,integer,timestamptz)
  from public, anon;
revoke all on function public.read_lpg_station_managed_coverage_policy() from public, anon;
revoke all on function public.configure_lpg_station_managed_coverage_policy(boolean,text) from public, anon;

grant execute on function public.read_lpg_station_managed_eligible_stations(uuid,uuid,uuid,numeric,integer,timestamptz)
  to authenticated, service_role;
grant execute on function public.read_lpg_station_managed_eligible_stations_for_amount(uuid,uuid,uuid,numeric,integer,timestamptz)
  to authenticated, service_role;
grant execute on function public.read_lpg_station_managed_coverage_policy() to authenticated, service_role;
grant execute on function public.configure_lpg_station_managed_coverage_policy(boolean,text) to authenticated, service_role;

comment on function public.read_lpg_station_managed_eligible_stations(uuid,uuid,uuid,numeric,integer,timestamptz) is
  'Returns only approved, available, explicitly Station Managed branches with active branch-owned drivers, a configured delivery radius, sufficient stock, and current pricing. It may serve locations outside SKIMA customer-ordering coverage only when the separate platform policy is enabled.';

comment on function public.enforce_lpg_refill_quote_serviceability() is
  'Enforces standard customer LPG coverage for managed/independent fulfilment; permits an exception only for an explicitly selected, backend-eligible Station Managed branch covering both locations by its own bounded radius.';
drop policy if exists lpg_station_managed_coverage_policy_service_role_only on public.lpg_station_managed_coverage_policy;
create policy lpg_station_managed_coverage_policy_service_role_only
on public.lpg_station_managed_coverage_policy
for all
to service_role
using (true)
with check (true);

drop policy if exists lpg_station_managed_coverage_policy_events_service_role_only on public.lpg_station_managed_coverage_policy_events;
create policy lpg_station_managed_coverage_policy_events_service_role_only
on public.lpg_station_managed_coverage_policy_events
for all
to service_role
using (true)
with check (true);


commit;
