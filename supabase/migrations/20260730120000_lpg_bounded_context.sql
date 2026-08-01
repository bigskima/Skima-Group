begin;

insert into public.permissions (key, description, risk_level)
values
  ('lpg.cylinders.read', 'Read LPG cylinder records and lifecycle history.', 'standard'),
  ('lpg.cylinders.manage', 'Manage LPG cylinder verification, restriction, and lifecycle state.', 'high'),
  ('lpg.orders.read', 'Read LPG refill quotes, orders, dispatch, tracking, and history.', 'standard'),
  ('lpg.orders.manage', 'Manage LPG refill orders, exceptions, assignment, and operational state.', 'high'),
  ('lpg.stations.read', 'Read LPG station operational profiles.', 'standard'),
  ('lpg.stations.manage', 'Manage LPG station products, capacity, availability, and safety state.', 'high'),
  ('lpg.dispatch.execute', 'Execute LPG station and qualified driver matching.', 'high'),
  ('lpg.safety.manage', 'Manage LPG safety incidents, restrictions, and administrative overrides.', 'critical')
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    updated_at = timezone('utc', now());

select public.configure_platform_admin_role(
  'platform.lpg_operations_admin',
  'LPG Operations Admin',
  'Operates LPG cylinders, stations, orders, safety incidents, dispatch, and verification.',
  array[
    'platform.runtime.read',
    'platform.runtime.manage',
    'platform.dispatch.execute',
    'platform.tracking.manage',
    'platform.verification.manage',
    'platform.settlement.read',
    'lpg.cylinders.read',
    'lpg.cylinders.manage',
    'lpg.orders.read',
    'lpg.orders.manage',
    'lpg.stations.read',
    'lpg.stations.manage',
    'lpg.dispatch.execute',
    'lpg.safety.manage'
  ],
  '{"system_template":true,"category":"lpg"}'::jsonb,
  'active'
);

create table if not exists public.lpg_customer_locations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  label text not null check (char_length(btrim(label)) between 2 and 80),
  formatted_address text not null check (char_length(btrim(formatted_address)) between 5 and 500),
  latitude numeric(10, 7) not null check (latitude between -90 and 90),
  longitude numeric(10, 7) not null check (longitude between -180 and 180),
  accuracy_meters numeric(12, 3) check (accuracy_meters is null or accuracy_meters >= 0),
  landmark text,
  delivery_instructions text,
  contact_name text,
  contact_phone text,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'pending', 'verified', 'rejected')),
  status text not null default 'active'
    check (status in ('active', 'inactive', 'deleted')),
  provider_source text,
  provider_place_id text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  source text not null check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create table if not exists public.lpg_station_branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.organization_branches(id) on delete set null,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 160),
  formatted_address text not null check (char_length(btrim(formatted_address)) between 5 and 500),
  latitude numeric(10, 7) not null check (latitude between -90 and 90),
  longitude numeric(10, 7) not null check (longitude between -180 and 180),
  service_radius_meters integer not null default 8000 check (service_radius_meters > 0),
  operating_hours jsonb not null default '{}'::jsonb check (jsonb_typeof(operating_hours) = 'object'),
  supported_cylinder_sizes_kg numeric[] not null default array[]::numeric[],
  refill_capacity_kg numeric(12, 3) not null default 0 check (refill_capacity_kg >= 0),
  current_available_kg numeric(12, 3) not null default 0 check (current_available_kg >= 0),
  geofence jsonb not null default '{}'::jsonb check (jsonb_typeof(geofence) = 'object'),
  availability_status text not null default 'available'
    check (availability_status in ('available', 'unavailable', 'paused', 'capacity_reached', 'closed')),
  approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected', 'suspended')),
  compliance_status text not null default 'pending'
    check (compliance_status in ('pending', 'approved', 'expired', 'suspended', 'rejected')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  source text not null check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key),
  unique (organization_id, branch_id)
);

create table if not exists public.lpg_refill_pricing (
  id uuid primary key default gen_random_uuid(),
  station_branch_id uuid references public.lpg_station_branches(id) on delete cascade,
  currency_code text not null references public.currency_definitions(code) on delete restrict default 'NGN',
  price_per_kg numeric(28, 8) not null check (price_per_kg > 0),
  delivery_base_fee numeric(28, 8) not null default 0 check (delivery_base_fee >= 0),
  platform_fee_amount numeric(28, 8) not null default 0 check (platform_fee_amount >= 0),
  tax_rate_percent numeric(8, 4) not null default 0 check (tax_rate_percent >= 0),
  driver_commission_amount numeric(28, 8) not null default 0 check (driver_commission_amount >= 0),
  min_kg numeric(12, 3) not null default 1 check (min_kg > 0),
  max_kg numeric(12, 3) not null default 50 check (max_kg >= min_kg),
  status text not null default 'active' check (status in ('draft', 'active', 'paused', 'retired')),
  effective_from timestamptz not null default timezone('utc', now()),
  effective_until timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  source text not null check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create table if not exists public.lpg_cylinders (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  cylinder_identifier text not null check (char_length(btrim(cylinder_identifier)) between 3 and 120),
  qr_payload text,
  barcode_payload text,
  size_kg numeric(12, 3) not null check (size_kg > 0),
  max_capacity_kg numeric(12, 3) not null check (max_capacity_kg >= size_kg),
  manufacturer text,
  brand text,
  colour text,
  serial_number text,
  manufactured_at date,
  last_inspection_at date,
  next_inspection_at date,
  condition_status text not null default 'unknown'
    check (condition_status in ('unknown', 'good', 'fair', 'damaged', 'unsafe', 'expired')),
  valve_type text,
  ownership_proof_asset_id uuid references public.assets(id) on delete set null,
  image_asset_ids uuid[] not null default array[]::uuid[],
  status text not null default 'draft'
    check (status in (
      'draft',
      'active',
      'pending_verification',
      'verified',
      'damaged',
      'unsafe',
      'expired',
      'lost',
      'stolen',
      'deactivated'
    )),
  safety_restriction text,
  notes text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  source text not null check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_user_id, cylinder_identifier),
  unique (source, idempotency_key)
);

create table if not exists public.lpg_cylinder_history (
  id uuid primary key default gen_random_uuid(),
  cylinder_id uuid not null references public.lpg_cylinders(id) on delete cascade,
  event_type text not null
    check (event_type in (
      'registered',
      'updated',
      'verified',
      'pickup_scan',
      'station_scan',
      'refilled',
      'delivery_verified',
      'inspection',
      'damage_reported',
      'safety_restricted',
      'deactivated',
      'ownership_transfer'
    )),
  lpg_order_id uuid,
  station_branch_id uuid references public.lpg_station_branches(id) on delete set null,
  driver_profile_id uuid references public.driver_profiles(id) on delete set null,
  kilograms_filled numeric(12, 3) check (kilograms_filled is null or kilograms_filled >= 0),
  observations jsonb not null default '{}'::jsonb check (jsonb_typeof(observations) = 'object'),
  location jsonb not null default '{}'::jsonb check (jsonb_typeof(location) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  idempotency_key text not null,
  unique (cylinder_id, idempotency_key)
);

create table if not exists public.lpg_refill_quotes (
  id uuid primary key default gen_random_uuid(),
  service_request_id uuid not null references public.service_requests(id) on delete cascade,
  price_quote_id uuid not null references public.price_quotes(id) on delete restrict,
  cylinder_id uuid not null references public.lpg_cylinders(id) on delete restrict,
  pickup_location_id uuid not null references public.lpg_customer_locations(id) on delete restrict,
  delivery_location_id uuid not null references public.lpg_customer_locations(id) on delete restrict,
  station_branch_id uuid references public.lpg_station_branches(id) on delete set null,
  pricing_id uuid not null references public.lpg_refill_pricing(id) on delete restrict,
  requested_kg numeric(12, 3) not null check (requested_kg > 0),
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  lpg_amount numeric(28, 8) not null check (lpg_amount >= 0),
  delivery_fee_amount numeric(28, 8) not null check (delivery_fee_amount >= 0),
  platform_fee_amount numeric(28, 8) not null check (platform_fee_amount >= 0),
  tax_amount numeric(28, 8) not null check (tax_amount >= 0),
  driver_commission_amount numeric(28, 8) not null check (driver_commission_amount >= 0),
  total_amount numeric(28, 8) not null check (total_amount >= 0),
  status text not null default 'quoted' check (status in ('quoted', 'accepted', 'expired', 'cancelled')),
  expires_at timestamptz not null default timezone('utc', now()) + interval '15 minutes',
  breakdown jsonb not null default '{}'::jsonb check (jsonb_typeof(breakdown) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  source text not null check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key),
  check (total_amount = lpg_amount + delivery_fee_amount + platform_fee_amount + tax_amount)
);

create table if not exists public.lpg_refill_orders (
  id uuid primary key default gen_random_uuid(),
  lpg_refill_quote_id uuid not null references public.lpg_refill_quotes(id) on delete restrict,
  service_request_id uuid not null references public.service_requests(id) on delete restrict,
  price_quote_id uuid not null references public.price_quotes(id) on delete restrict,
  customer_user_id uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  cylinder_id uuid not null references public.lpg_cylinders(id) on delete restrict,
  pickup_location_id uuid not null references public.lpg_customer_locations(id) on delete restrict,
  delivery_location_id uuid not null references public.lpg_customer_locations(id) on delete restrict,
  station_branch_id uuid references public.lpg_station_branches(id) on delete set null,
  driver_profile_id uuid references public.driver_profiles(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  tracking_session_id uuid references public.tracking_sessions(id) on delete set null,
  escrow_hold_id uuid references public.escrow_holds(id) on delete set null,
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  requested_kg numeric(12, 3) not null check (requested_kg > 0),
  actual_kg numeric(12, 3) check (actual_kg is null or actual_kg >= 0),
  total_amount numeric(28, 8) not null check (total_amount >= 0),
  station_amount numeric(28, 8) not null check (station_amount >= 0),
  delivery_fee_amount numeric(28, 8) not null check (delivery_fee_amount >= 0),
  platform_fee_amount numeric(28, 8) not null check (platform_fee_amount >= 0),
  driver_commission_amount numeric(28, 8) not null check (driver_commission_amount >= 0),
  status text not null default 'awaiting_payment'
    check (status in (
      'awaiting_payment',
      'payment_reserved',
      'matching_station',
      'matching_driver',
      'driver_offered',
      'driver_accepted',
      'pickup_en_route',
      'pickup_verified',
      'station_en_route',
      'station_verified',
      'refill_in_progress',
      'refill_confirmed',
      'station_settled',
      'return_en_route',
      'delivery_verification_pending',
      'delivered',
      'completed',
      'cancelled',
      'disputed',
      'refunded',
      'failed'
    )),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'reserved', 'failed', 'refunded')),
  assignment_status text not null default 'unassigned'
    check (assignment_status in ('unassigned', 'station_assigned', 'driver_offered', 'driver_assigned', 'reassigned')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  source text not null check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key),
  unique (lpg_refill_quote_id)
);

alter table public.lpg_cylinder_history
drop constraint if exists lpg_cylinder_history_lpg_order_fk;

alter table public.lpg_cylinder_history
add constraint lpg_cylinder_history_lpg_order_fk
foreign key (lpg_order_id) references public.lpg_refill_orders(id) on delete set null;

create table if not exists public.lpg_order_events (
  id uuid primary key default gen_random_uuid(),
  lpg_order_id uuid not null references public.lpg_refill_orders(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  idempotency_key text not null,
  unique (lpg_order_id, idempotency_key)
);

create table if not exists public.lpg_cylinder_scans (
  id uuid primary key default gen_random_uuid(),
  lpg_order_id uuid not null references public.lpg_refill_orders(id) on delete cascade,
  cylinder_id uuid not null references public.lpg_cylinders(id) on delete restrict,
  scan_type text not null
    check (scan_type in ('customer_pickup', 'station_receipt', 'station_release', 'customer_delivery', 'inspection')),
  scanned_by_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  driver_profile_id uuid references public.driver_profiles(id) on delete set null,
  station_branch_id uuid references public.lpg_station_branches(id) on delete set null,
  verification_event_id uuid references public.verification_events(id) on delete set null,
  latitude numeric(10, 7) check (latitude is null or latitude between -90 and 90),
  longitude numeric(10, 7) check (longitude is null or longitude between -180 and 180),
  accuracy_meters numeric(12, 3) check (accuracy_meters is null or accuracy_meters >= 0),
  result text not null default 'passed' check (result in ('passed', 'failed', 'manual_review')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  source text not null check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  unique (source, idempotency_key)
);

create table if not exists public.lpg_refill_records (
  id uuid primary key default gen_random_uuid(),
  lpg_order_id uuid not null references public.lpg_refill_orders(id) on delete cascade,
  cylinder_id uuid not null references public.lpg_cylinders(id) on delete restrict,
  station_branch_id uuid not null references public.lpg_station_branches(id) on delete restrict,
  station_operator_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  requested_kg numeric(12, 3) not null check (requested_kg > 0),
  actual_kg numeric(12, 3) not null check (actual_kg > 0),
  price_per_kg numeric(28, 8) not null check (price_per_kg > 0),
  refill_amount numeric(28, 8) not null check (refill_amount >= 0),
  safety_observations jsonb not null default '{}'::jsonb check (jsonb_typeof(safety_observations) = 'object'),
  status text not null default 'confirmed' check (status in ('confirmed', 'rejected', 'manual_review')),
  created_at timestamptz not null default timezone('utc', now()),
  source text not null check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  unique (source, idempotency_key),
  unique (lpg_order_id)
);

create table if not exists public.lpg_driver_locations (
  id uuid primary key default gen_random_uuid(),
  driver_profile_id uuid not null references public.driver_profiles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  lpg_order_id uuid references public.lpg_refill_orders(id) on delete set null,
  latitude numeric(10, 7) not null check (latitude between -90 and 90),
  longitude numeric(10, 7) not null check (longitude between -180 and 180),
  accuracy_meters numeric(12, 3) check (accuracy_meters is null or accuracy_meters >= 0),
  heading_degrees numeric(6, 2) check (heading_degrees is null or (heading_degrees >= 0 and heading_degrees <= 360)),
  speed_meters_per_second numeric(12, 3) check (speed_meters_per_second is null or speed_meters_per_second >= 0),
  online_status text not null default 'online' check (online_status in ('online', 'offline', 'busy')),
  recorded_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  source text not null check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create table if not exists public.lpg_safety_incidents (
  id uuid primary key default gen_random_uuid(),
  lpg_order_id uuid references public.lpg_refill_orders(id) on delete set null,
  cylinder_id uuid references public.lpg_cylinders(id) on delete set null,
  station_branch_id uuid references public.lpg_station_branches(id) on delete set null,
  driver_profile_id uuid references public.driver_profiles(id) on delete set null,
  reported_by uuid references public.profiles(id) on delete set null default auth.uid(),
  incident_type text not null
    check (incident_type in ('leak', 'damage', 'expired_cylinder', 'unsafe_valve', 'lost', 'stolen', 'accident', 'other')),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open' check (status in ('open', 'under_review', 'resolved', 'dismissed')),
  description text not null check (char_length(btrim(description)) between 5 and 2000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  source text not null check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create index if not exists lpg_customer_locations_owner_status_idx
on public.lpg_customer_locations (owner_user_id, status, created_at desc);

create index if not exists lpg_cylinders_owner_status_idx
on public.lpg_cylinders (owner_user_id, status, created_at desc);

create index if not exists lpg_cylinder_history_cylinder_created_idx
on public.lpg_cylinder_history (cylinder_id, created_at desc);

create index if not exists lpg_refill_orders_customer_status_idx
on public.lpg_refill_orders (customer_user_id, status, created_at desc);

create index if not exists lpg_refill_orders_station_status_idx
on public.lpg_refill_orders (station_branch_id, status, created_at desc);

create index if not exists lpg_refill_orders_driver_status_idx
on public.lpg_refill_orders (driver_profile_id, status, created_at desc);

create index if not exists lpg_driver_locations_driver_time_idx
on public.lpg_driver_locations (driver_profile_id, recorded_at desc);

drop trigger if exists set_lpg_customer_locations_updated_at on public.lpg_customer_locations;
drop trigger if exists set_lpg_station_branches_updated_at on public.lpg_station_branches;
drop trigger if exists set_lpg_refill_pricing_updated_at on public.lpg_refill_pricing;
drop trigger if exists set_lpg_cylinders_updated_at on public.lpg_cylinders;
drop trigger if exists set_lpg_refill_quotes_updated_at on public.lpg_refill_quotes;
drop trigger if exists set_lpg_refill_orders_updated_at on public.lpg_refill_orders;
drop trigger if exists set_lpg_safety_incidents_updated_at on public.lpg_safety_incidents;

create trigger set_lpg_customer_locations_updated_at
before update on public.lpg_customer_locations
for each row execute function public.set_updated_at();

create trigger set_lpg_station_branches_updated_at
before update on public.lpg_station_branches
for each row execute function public.set_updated_at();

create trigger set_lpg_refill_pricing_updated_at
before update on public.lpg_refill_pricing
for each row execute function public.set_updated_at();

create trigger set_lpg_cylinders_updated_at
before update on public.lpg_cylinders
for each row execute function public.set_updated_at();

create trigger set_lpg_refill_quotes_updated_at
before update on public.lpg_refill_quotes
for each row execute function public.set_updated_at();

create trigger set_lpg_refill_orders_updated_at
before update on public.lpg_refill_orders
for each row execute function public.set_updated_at();

create trigger set_lpg_safety_incidents_updated_at
before update on public.lpg_safety_incidents
for each row execute function public.set_updated_at();

create or replace function public.can_manage_lpg_operations()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.role() = 'service_role'
    or public.has_permission('lpg.orders.manage', null)
    or public.has_permission('lpg.cylinders.manage', null)
    or public.has_permission('lpg.safety.manage', null);
$$;

create or replace function public.can_access_lpg_order(target_lpg_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.role() = 'service_role'
    or public.can_manage_lpg_operations()
    or exists (
      select 1
      from public.lpg_refill_orders target_order
      where target_order.id = target_lpg_order_id
        and target_order.customer_user_id = auth.uid()
    )
    or exists (
      select 1
      from public.lpg_refill_orders target_order
      join public.driver_profiles driver on driver.id = target_order.driver_profile_id
      where target_order.id = target_lpg_order_id
        and driver.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.lpg_refill_orders target_order
      join public.lpg_station_branches station on station.id = target_order.station_branch_id
      where target_order.id = target_lpg_order_id
        and public.is_organization_member(station.organization_id)
    );
$$;

create or replace function public.lpg_distance_meters(
  origin_latitude numeric,
  origin_longitude numeric,
  target_latitude numeric,
  target_longitude numeric
)
returns numeric
language sql
immutable
as $$
  select 6371000 * 2 * asin(
    sqrt(
      power(sin(radians((target_latitude - origin_latitude) / 2)), 2)
      + cos(radians(origin_latitude))
      * cos(radians(target_latitude))
      * power(sin(radians((target_longitude - origin_longitude) / 2)), 2)
    )
  );
$$;

create or replace function public.record_lpg_order_event(
  target_lpg_order_id uuid,
  target_event_type text,
  target_from_status text,
  target_to_status text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  event_id uuid;
begin
  if target_lpg_order_id is null then
    raise exception 'target_lpg_order_id is required';
  end if;

  if target_event_type is null or target_event_type !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_event_type must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  insert into public.lpg_order_events (
    lpg_order_id,
    event_type,
    from_status,
    to_status,
    metadata,
    idempotency_key
  )
  values (
    target_lpg_order_id,
    target_event_type,
    target_from_status,
    target_to_status,
    target_metadata,
    target_idempotency_key
  )
  on conflict (lpg_order_id, idempotency_key) do nothing
  returning id into event_id;

  if event_id is null then
    select existing.id
    into event_id
    from public.lpg_order_events existing
    where existing.lpg_order_id = target_lpg_order_id
      and existing.idempotency_key = target_idempotency_key;
  end if;

  return event_id;
end;
$$;

create or replace function public.record_lpg_cylinder_history(
  target_cylinder_id uuid,
  target_event_type text,
  target_idempotency_key text,
  target_lpg_order_id uuid default null,
  target_station_branch_id uuid default null,
  target_driver_profile_id uuid default null,
  target_kilograms_filled numeric default null,
  target_observations jsonb default '{}'::jsonb,
  target_location jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  history_id uuid;
begin
  if target_cylinder_id is null then
    raise exception 'target_cylinder_id is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_observations is null or jsonb_typeof(target_observations) <> 'object'
    or target_location is null or jsonb_typeof(target_location) <> 'object' then
    raise exception 'target_observations and target_location must be JSON objects';
  end if;

  insert into public.lpg_cylinder_history (
    cylinder_id,
    event_type,
    lpg_order_id,
    station_branch_id,
    driver_profile_id,
    kilograms_filled,
    observations,
    location,
    idempotency_key
  )
  values (
    target_cylinder_id,
    target_event_type,
    target_lpg_order_id,
    target_station_branch_id,
    target_driver_profile_id,
    target_kilograms_filled,
    target_observations,
    target_location,
    target_idempotency_key
  )
  on conflict (cylinder_id, idempotency_key) do nothing
  returning id into history_id;

  if history_id is null then
    select existing.id
    into history_id
    from public.lpg_cylinder_history existing
    where existing.cylinder_id = target_cylinder_id
      and existing.idempotency_key = target_idempotency_key;
  end if;

  return history_id;
end;
$$;

create or replace function public.create_lpg_customer_location(
  target_label text,
  target_formatted_address text,
  target_latitude numeric,
  target_longitude numeric,
  target_idempotency_key text,
  target_accuracy_meters numeric default null,
  target_landmark text default null,
  target_delivery_instructions text default null,
  target_contact_name text default null,
  target_contact_phone text default null,
  target_provider_source text default null,
  target_provider_place_id text default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'lpg.location_api'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  location_id uuid;
  existing_record record;
begin
  if auth.uid() is null then
    raise exception 'authenticated user is required';
  end if;

  if target_label is null or char_length(btrim(target_label)) < 2 then
    raise exception 'target_label is required';
  end if;

  if target_formatted_address is null or char_length(btrim(target_formatted_address)) < 5 then
    raise exception 'target_formatted_address is required';
  end if;

  if target_latitude is null or target_latitude < -90 or target_latitude > 90
    or target_longitude is null or target_longitude < -180 or target_longitude > 180 then
    raise exception 'target_latitude and target_longitude must be valid coordinates';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  insert into public.lpg_customer_locations (
    label,
    formatted_address,
    latitude,
    longitude,
    accuracy_meters,
    landmark,
    delivery_instructions,
    contact_name,
    contact_phone,
    provider_source,
    provider_place_id,
    metadata,
    source,
    idempotency_key
  )
  values (
    btrim(target_label),
    btrim(target_formatted_address),
    target_latitude,
    target_longitude,
    target_accuracy_meters,
    target_landmark,
    target_delivery_instructions,
    target_contact_name,
    target_contact_phone,
    target_provider_source,
    target_provider_place_id,
    target_metadata,
    target_source,
    target_idempotency_key
  )
  on conflict (source, idempotency_key) do nothing
  returning id into location_id;

  if location_id is null then
    select existing.*
    into existing_record
    from public.lpg_customer_locations existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    if existing_record.owner_user_id <> auth.uid() then
      raise exception 'target_idempotency_key has already been used by another user';
    end if;

    return existing_record.id;
  end if;

  return location_id;
end;
$$;

create or replace function public.register_lpg_cylinder(
  target_cylinder_identifier text,
  target_size_kg numeric,
  target_max_capacity_kg numeric,
  target_idempotency_key text,
  target_qr_payload text default null,
  target_barcode_payload text default null,
  target_manufacturer text default null,
  target_brand text default null,
  target_colour text default null,
  target_serial_number text default null,
  target_manufactured_at date default null,
  target_last_inspection_at date default null,
  target_next_inspection_at date default null,
  target_condition_status text default 'unknown',
  target_valve_type text default null,
  target_ownership_proof_asset_id uuid default null,
  target_image_asset_ids uuid[] default array[]::uuid[],
  target_notes text default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'lpg.cylinder_registry'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cylinder_id uuid;
  existing_record record;
begin
  if auth.uid() is null then
    raise exception 'authenticated user is required';
  end if;

  if target_cylinder_identifier is null or char_length(btrim(target_cylinder_identifier)) < 3 then
    raise exception 'target_cylinder_identifier is required';
  end if;

  if target_size_kg is null or target_size_kg <= 0 then
    raise exception 'target_size_kg must be greater than zero';
  end if;

  if target_max_capacity_kg is null or target_max_capacity_kg < target_size_kg then
    raise exception 'target_max_capacity_kg must be at least target_size_kg';
  end if;

  if target_condition_status not in ('unknown', 'good', 'fair', 'damaged', 'unsafe', 'expired') then
    raise exception 'target_condition_status is not supported';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  insert into public.lpg_cylinders (
    cylinder_identifier,
    qr_payload,
    barcode_payload,
    size_kg,
    max_capacity_kg,
    manufacturer,
    brand,
    colour,
    serial_number,
    manufactured_at,
    last_inspection_at,
    next_inspection_at,
    condition_status,
    valve_type,
    ownership_proof_asset_id,
    image_asset_ids,
    status,
    notes,
    metadata,
    source,
    idempotency_key
  )
  values (
    btrim(target_cylinder_identifier),
    target_qr_payload,
    target_barcode_payload,
    target_size_kg,
    target_max_capacity_kg,
    target_manufacturer,
    target_brand,
    target_colour,
    target_serial_number,
    target_manufactured_at,
    target_last_inspection_at,
    target_next_inspection_at,
    target_condition_status,
    target_valve_type,
    target_ownership_proof_asset_id,
    coalesce(target_image_asset_ids, array[]::uuid[]),
    case when target_condition_status in ('damaged', 'unsafe', 'expired') then target_condition_status else 'active' end,
    target_notes,
    target_metadata,
    target_source,
    target_idempotency_key
  )
  on conflict (source, idempotency_key) do nothing
  returning id into cylinder_id;

  if cylinder_id is null then
    select existing.*
    into existing_record
    from public.lpg_cylinders existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    if existing_record.owner_user_id <> auth.uid() then
      raise exception 'target_idempotency_key has already been used by another user';
    end if;

    return existing_record.id;
  end if;

  perform public.record_lpg_cylinder_history(
    cylinder_id,
    'registered',
    target_idempotency_key || ':registered',
    null,
    null,
    null,
    null,
    target_metadata,
    '{}'::jsonb
  );

  return cylinder_id;
end;
$$;

create or replace function public.create_lpg_refill_quote(
  target_cylinder_id uuid,
  target_requested_kg numeric,
  target_pickup_location_id uuid,
  target_delivery_location_id uuid,
  target_idempotency_key text,
  target_station_branch_id uuid default null,
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
  cylinder_record record;
  pickup_record record;
  delivery_record record;
  station_record record;
  pricing_record record;
  module_record record;
  pricing_policy_record record;
  settlement_policy_id uuid;
  dispatch_policy_id uuid;
  service_request_id uuid;
  price_quote_id uuid;
  lpg_quote_id uuid;
  lpg_amount numeric(28, 8);
  tax_amount numeric(28, 8);
  total_amount numeric(28, 8);
begin
  if auth.uid() is null then
    raise exception 'authenticated user is required';
  end if;

  if target_requested_kg is null or target_requested_kg <= 0 then
    raise exception 'target_requested_kg must be greater than zero';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select cylinder.*
  into cylinder_record
  from public.lpg_cylinders cylinder
  where cylinder.id = target_cylinder_id
    and cylinder.owner_user_id = auth.uid()
  for update;

  if not found then
    raise exception 'target_cylinder_id must reference one of your cylinders';
  end if;

  if cylinder_record.status not in ('active', 'pending_verification', 'verified') then
    raise exception 'cylinder is not eligible for refill';
  end if;

  if cylinder_record.condition_status in ('damaged', 'unsafe', 'expired') then
    raise exception 'cylinder condition is not eligible for refill';
  end if;

  if target_requested_kg > cylinder_record.max_capacity_kg then
    raise exception 'target_requested_kg exceeds cylinder maximum capacity';
  end if;

  select location.*
  into pickup_record
  from public.lpg_customer_locations location
  where location.id = target_pickup_location_id
    and location.owner_user_id = auth.uid()
    and location.status = 'active';

  if not found then
    raise exception 'target_pickup_location_id must reference an active saved location';
  end if;

  select location.*
  into delivery_record
  from public.lpg_customer_locations location
  where location.id = target_delivery_location_id
    and location.owner_user_id = auth.uid()
    and location.status = 'active';

  if not found then
    raise exception 'target_delivery_location_id must reference an active saved location';
  end if;

  if target_station_branch_id is not null then
    select station.*
    into station_record
    from public.lpg_station_branches station
    where station.id = target_station_branch_id
      and station.approval_status = 'approved'
      and station.compliance_status = 'approved'
      and station.availability_status = 'available';

    if not found then
      raise exception 'target_station_branch_id must reference an available approved station';
    end if;
  else
    select station.*
    into station_record
    from public.lpg_station_branches station
    where station.approval_status = 'approved'
      and station.compliance_status = 'approved'
      and station.availability_status = 'available'
      and station.current_available_kg >= target_requested_kg
      and (
        array_length(station.supported_cylinder_sizes_kg, 1) is null
        or cylinder_record.size_kg = any(station.supported_cylinder_sizes_kg)
      )
      and public.lpg_distance_meters(
        pickup_record.latitude,
        pickup_record.longitude,
        station.latitude,
        station.longitude
      ) <= station.service_radius_meters
    order by
      public.lpg_distance_meters(
        pickup_record.latitude,
        pickup_record.longitude,
        station.latitude,
        station.longitude
      ) asc,
      station.current_available_kg desc,
      station.created_at asc
    limit 1;

    if found then
      target_station_branch_id := station_record.id;
    end if;
  end if;

  select pricing.*
  into pricing_record
  from public.lpg_refill_pricing pricing
  where pricing.status = 'active'
    and pricing.currency_code = 'NGN'
    and pricing.effective_from <= timezone('utc', now())
    and (pricing.effective_until is null or pricing.effective_until > timezone('utc', now()))
    and target_requested_kg between pricing.min_kg and pricing.max_kg
    and (
      (target_station_branch_id is not null and pricing.station_branch_id = target_station_branch_id)
      or pricing.station_branch_id is null
    )
  order by case when pricing.station_branch_id = target_station_branch_id then 0 else 1 end,
           pricing.effective_from desc
  limit 1;

  if not found then
    raise exception 'active LPG pricing is required for the requested kilograms';
  end if;

  select module.id, version.id as version_id
  into module_record
  from public.business_modules module
  join public.business_module_versions version on version.module_id = module.id
  where module.key = 'lpg'
    and module.status = 'active'
    and version.status = 'active'
  order by version.version desc
  limit 1;

  if not found then
    raise exception 'active LPG module version is required';
  end if;

  select policy.*
  into pricing_policy_record
  from public.pricing_policies policy
  where policy.key = 'pricing.lpg.fixed.v1'
    and policy.status = 'active'
  order by policy.version desc
  limit 1;

  if not found then
    raise exception 'active LPG pricing policy is required';
  end if;

  select policy.id
  into settlement_policy_id
  from public.settlement_policies policy
  where policy.key = 'settlement.lpg.escrow.station-driver.v1'
    and policy.status = 'active'
  order by policy.version desc
  limit 1;

  select policy.id
  into dispatch_policy_id
  from public.dispatch_policies policy
  where policy.key = 'dispatch.lpg.nearest-qualified-driver.v1'
    and policy.status = 'active'
  limit 1;

  lpg_amount := round(target_requested_kg * pricing_record.price_per_kg, 2);
  tax_amount := round((lpg_amount + pricing_record.delivery_base_fee + pricing_record.platform_fee_amount) * pricing_record.tax_rate_percent / 100, 2);
  total_amount := lpg_amount + pricing_record.delivery_base_fee + pricing_record.platform_fee_amount + tax_amount;

  insert into public.service_requests (
    module_id,
    module_version_id,
    requester_user_id,
    pricing_policy_id,
    settlement_policy_id,
    dispatch_policy_id,
    status,
    request_payload,
    participants,
    source,
    idempotency_key,
    metadata
  )
  values (
    module_record.id,
    module_record.version_id,
    auth.uid(),
    pricing_policy_record.id,
    settlement_policy_id,
    dispatch_policy_id,
    'priced',
    jsonb_build_object(
      'bounded_context',
      'lpg',
      'cylinder_id',
      target_cylinder_id,
      'requested_kg',
      target_requested_kg,
      'pickup_location',
      jsonb_build_object('id', pickup_record.id, 'latitude', pickup_record.latitude, 'longitude', pickup_record.longitude),
      'delivery_location',
      jsonb_build_object('id', delivery_record.id, 'latitude', delivery_record.latitude, 'longitude', delivery_record.longitude),
      'dropoff_location',
      jsonb_build_object('id', delivery_record.id, 'latitude', delivery_record.latitude, 'longitude', delivery_record.longitude),
      'station_branch_id',
      target_station_branch_id,
      'preferred_time',
      target_preferred_time,
      'delivery_instructions',
      target_delivery_instructions
    ),
    jsonb_build_object('customer_user_id', auth.uid(), 'station_branch_id', target_station_branch_id),
    target_source,
    target_idempotency_key || ':service-request',
    target_metadata
  )
  on conflict (source, idempotency_key) do nothing
  returning id into service_request_id;

  if service_request_id is null then
    select quote.id
    into lpg_quote_id
    from public.lpg_refill_quotes quote
    where quote.source = target_source
      and quote.idempotency_key = target_idempotency_key;

    if lpg_quote_id is not null then
      return lpg_quote_id;
    end if;

    raise exception 'LPG quote idempotency lookup failed';
  end if;

  insert into public.price_quotes (
    service_request_id,
    pricing_policy_id,
    module_id,
    currency_code,
    status,
    subtotal_amount,
    fee_amount,
    discount_amount,
    tax_amount,
    total_amount,
    pricing_context,
    calculation_breakdown,
    expires_at,
    source,
    idempotency_key,
    created_by
  )
  values (
    service_request_id,
    pricing_policy_record.id,
    module_record.id,
    pricing_record.currency_code,
    'calculated',
    lpg_amount + pricing_record.delivery_base_fee,
    pricing_record.platform_fee_amount,
    0,
    tax_amount,
    total_amount,
    jsonb_build_object('requested_kg', target_requested_kg, 'price_per_kg', pricing_record.price_per_kg),
    jsonb_build_object(
      'bounded_context',
      'lpg',
      'pricing_id',
      pricing_record.id,
      'lpg_amount',
      lpg_amount,
      'delivery_fee_amount',
      pricing_record.delivery_base_fee,
      'driver_commission_amount',
      pricing_record.driver_commission_amount
    ),
    timezone('utc', now()) + interval '15 minutes',
    target_source,
    target_idempotency_key || ':price-quote',
    auth.uid()
  )
  returning id into price_quote_id;

  update public.service_requests
  set active_quote_id = price_quote_id,
      updated_at = timezone('utc', now())
  where id = service_request_id;

  insert into public.lpg_refill_quotes (
    service_request_id,
    price_quote_id,
    cylinder_id,
    pickup_location_id,
    delivery_location_id,
    station_branch_id,
    pricing_id,
    requested_kg,
    currency_code,
    lpg_amount,
    delivery_fee_amount,
    platform_fee_amount,
    tax_amount,
    driver_commission_amount,
    total_amount,
    breakdown,
    metadata,
    source,
    idempotency_key
  )
  values (
    service_request_id,
    price_quote_id,
    target_cylinder_id,
    target_pickup_location_id,
    target_delivery_location_id,
    target_station_branch_id,
    pricing_record.id,
    target_requested_kg,
    pricing_record.currency_code,
    lpg_amount,
    pricing_record.delivery_base_fee,
    pricing_record.platform_fee_amount,
    tax_amount,
    pricing_record.driver_commission_amount,
    total_amount,
    jsonb_build_object(
      'price_per_kg',
      pricing_record.price_per_kg,
      'requested_kg',
      target_requested_kg,
      'station_amount',
      lpg_amount
    ),
    target_metadata,
    target_source,
    target_idempotency_key
  )
  returning id into lpg_quote_id;

  insert into public.service_request_events (
    service_request_id,
    event_type_key,
    status,
    idempotency_key,
    metadata
  )
  values (
    service_request_id,
    'event.request.created',
    'priced',
    target_idempotency_key || ':lpg:quoted',
    jsonb_build_object('lpg_quote_id', lpg_quote_id, 'price_quote_id', price_quote_id)
  )
  on conflict do nothing;

  return lpg_quote_id;
end;
$$;

create or replace function public.create_lpg_refill_order(
  target_lpg_refill_quote_id uuid,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'lpg.order_api'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  quote_record record;
  order_id uuid;
  existing_record record;
begin
  if auth.uid() is null then
    raise exception 'authenticated user is required';
  end if;

  if target_lpg_refill_quote_id is null then
    raise exception 'target_lpg_refill_quote_id is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select quote.*
  into quote_record
  from public.lpg_refill_quotes quote
  join public.lpg_cylinders cylinder on cylinder.id = quote.cylinder_id
  where quote.id = target_lpg_refill_quote_id
    and cylinder.owner_user_id = auth.uid()
  for update;

  if not found then
    raise exception 'target_lpg_refill_quote_id must reference one of your quotes';
  end if;

  if quote_record.status <> 'quoted' then
    if quote_record.status = 'accepted' then
      select existing.*
      into existing_record
      from public.lpg_refill_orders existing
      where existing.lpg_refill_quote_id = quote_record.id;

      if found then
        return existing_record.id;
      end if;
    end if;

    raise exception 'LPG quote cannot be ordered from its current status';
  end if;

  if quote_record.expires_at <= timezone('utc', now()) then
    update public.lpg_refill_quotes
    set status = 'expired',
        updated_at = timezone('utc', now())
    where id = quote_record.id;

    update public.price_quotes
    set status = 'expired',
        updated_at = timezone('utc', now())
    where id = quote_record.price_quote_id;

    raise exception 'LPG quote has expired';
  end if;

  update public.lpg_refill_quotes
  set status = 'accepted',
      updated_at = timezone('utc', now())
  where id = quote_record.id;

  update public.price_quotes
  set status = 'accepted',
      accepted_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = quote_record.price_quote_id;

  insert into public.lpg_refill_orders (
    lpg_refill_quote_id,
    service_request_id,
    price_quote_id,
    customer_user_id,
    cylinder_id,
    pickup_location_id,
    delivery_location_id,
    station_branch_id,
    currency_code,
    requested_kg,
    total_amount,
    station_amount,
    delivery_fee_amount,
    platform_fee_amount,
    driver_commission_amount,
    metadata,
    source,
    idempotency_key
  )
  values (
    quote_record.id,
    quote_record.service_request_id,
    quote_record.price_quote_id,
    auth.uid(),
    quote_record.cylinder_id,
    quote_record.pickup_location_id,
    quote_record.delivery_location_id,
    quote_record.station_branch_id,
    quote_record.currency_code,
    quote_record.requested_kg,
    quote_record.total_amount,
    quote_record.lpg_amount,
    quote_record.delivery_fee_amount,
    quote_record.platform_fee_amount,
    quote_record.driver_commission_amount,
    target_metadata,
    target_source,
    target_idempotency_key
  )
  on conflict (source, idempotency_key) do nothing
  returning id into order_id;

  if order_id is null then
    select existing.*
    into existing_record
    from public.lpg_refill_orders existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    return existing_record.id;
  end if;

  update public.service_requests
  set status = 'priced',
      metadata = metadata || jsonb_build_object('lpg_order_id', order_id),
      updated_at = timezone('utc', now())
  where id = quote_record.service_request_id;

  perform public.record_lpg_order_event(
    order_id,
    'lpg.order.created',
    null,
    'awaiting_payment',
    target_idempotency_key || ':created',
    jsonb_build_object('price_quote_id', quote_record.price_quote_id)
  );

  return order_id;
end;
$$;

create or replace function public.record_lpg_cylinder_scan(
  target_lpg_order_id uuid,
  target_scan_type text,
  target_idempotency_key text,
  target_latitude numeric default null,
  target_longitude numeric default null,
  target_accuracy_meters numeric default null,
  target_payload jsonb default '{}'::jsonb,
  target_source text default 'lpg.verification_api'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record record;
  scan_id uuid;
  new_status text;
  history_event text;
begin
  if target_scan_type not in ('customer_pickup', 'station_receipt', 'station_release', 'customer_delivery', 'inspection') then
    raise exception 'target_scan_type is not supported';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select target_order.*
  into order_record
  from public.lpg_refill_orders target_order
  where target_order.id = target_lpg_order_id
  for update;

  if not found then
    raise exception 'target_lpg_order_id must reference an LPG order';
  end if;

  if not public.can_access_lpg_order(target_lpg_order_id) then
    raise exception 'LPG order access permission is required';
  end if;

  if target_scan_type = 'customer_pickup' then
    if order_record.status not in ('driver_accepted', 'pickup_en_route') then
      raise exception 'customer pickup scan is not valid for the current order status';
    end if;
    new_status := 'pickup_verified';
    history_event := 'pickup_scan';
  elsif target_scan_type = 'station_receipt' then
    if order_record.status not in ('pickup_verified', 'station_en_route') then
      raise exception 'station receipt scan is not valid for the current order status';
    end if;
    new_status := 'station_verified';
    history_event := 'station_scan';
  elsif target_scan_type = 'station_release' then
    if order_record.status not in ('refill_confirmed', 'station_settled') then
      raise exception 'station release scan is not valid for the current order status';
    end if;
    new_status := 'return_en_route';
    history_event := 'station_scan';
  elsif target_scan_type = 'customer_delivery' then
    if order_record.status not in ('return_en_route', 'delivery_verification_pending') then
      raise exception 'customer delivery scan is not valid for the current order status';
    end if;
    new_status := 'delivered';
    history_event := 'delivery_verified';
  else
    new_status := order_record.status;
    history_event := 'inspection';
  end if;

  insert into public.lpg_cylinder_scans (
    lpg_order_id,
    cylinder_id,
    scan_type,
    driver_profile_id,
    station_branch_id,
    latitude,
    longitude,
    accuracy_meters,
    result,
    payload,
    source,
    idempotency_key
  )
  values (
    order_record.id,
    order_record.cylinder_id,
    target_scan_type,
    order_record.driver_profile_id,
    order_record.station_branch_id,
    target_latitude,
    target_longitude,
    target_accuracy_meters,
    'passed',
    target_payload,
    target_source,
    target_idempotency_key
  )
  on conflict (source, idempotency_key) do nothing
  returning id into scan_id;

  if scan_id is null then
    select existing.id
    into scan_id
    from public.lpg_cylinder_scans existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    return scan_id;
  end if;

  if new_status <> order_record.status then
    update public.lpg_refill_orders
    set status = new_status,
        updated_at = timezone('utc', now())
    where id = order_record.id;

    update public.service_requests
    set status = case
      when new_status in ('delivered', 'completed') then 'completed'
      when new_status in ('pickup_verified', 'station_verified', 'return_en_route') then 'in_progress'
      else status
    end,
        updated_at = timezone('utc', now())
    where id = order_record.service_request_id;
  end if;

  perform public.record_lpg_order_event(
    order_record.id,
    'lpg.scan.' || target_scan_type,
    order_record.status,
    new_status,
    target_idempotency_key || ':event',
    target_payload || jsonb_build_object('scan_id', scan_id)
  );

  perform public.record_lpg_cylinder_history(
    order_record.cylinder_id,
    history_event,
    target_idempotency_key || ':cylinder-history',
    order_record.id,
    order_record.station_branch_id,
    order_record.driver_profile_id,
    null,
    target_payload,
    jsonb_build_object('latitude', target_latitude, 'longitude', target_longitude, 'accuracy_meters', target_accuracy_meters)
  );

  return scan_id;
end;
$$;

create or replace function public.confirm_lpg_refill(
  target_lpg_order_id uuid,
  target_actual_kg numeric,
  target_price_per_kg numeric,
  target_idempotency_key text,
  target_safety_observations jsonb default '{}'::jsonb,
  target_source text default 'lpg.station_api'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record record;
  refill_id uuid;
  refill_amount numeric(28, 8);
begin
  if target_actual_kg is null or target_actual_kg <= 0 then
    raise exception 'target_actual_kg must be greater than zero';
  end if;

  if target_price_per_kg is null or target_price_per_kg <= 0 then
    raise exception 'target_price_per_kg must be greater than zero';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select target_order.*
  into order_record
  from public.lpg_refill_orders target_order
  where target_order.id = target_lpg_order_id
  for update;

  if not found then
    raise exception 'target_lpg_order_id must reference an LPG order';
  end if;

  if order_record.station_branch_id is null then
    raise exception 'a station must be assigned before refill confirmation';
  end if;

  if not exists (
    select 1
    from public.lpg_station_branches station
    where station.id = order_record.station_branch_id
      and (
        public.is_organization_member(station.organization_id)
        or public.has_permission('lpg.stations.manage', station.organization_id)
        or public.can_manage_lpg_operations()
      )
  ) then
    raise exception 'station operation permission is required';
  end if;

  if order_record.status not in ('station_verified', 'refill_in_progress') then
    raise exception 'refill cannot be confirmed from the current order status';
  end if;

  refill_amount := round(target_actual_kg * target_price_per_kg, 2);

  insert into public.lpg_refill_records (
    lpg_order_id,
    cylinder_id,
    station_branch_id,
    requested_kg,
    actual_kg,
    price_per_kg,
    refill_amount,
    safety_observations,
    source,
    idempotency_key
  )
  values (
    order_record.id,
    order_record.cylinder_id,
    order_record.station_branch_id,
    order_record.requested_kg,
    target_actual_kg,
    target_price_per_kg,
    refill_amount,
    target_safety_observations,
    target_source,
    target_idempotency_key
  )
  on conflict (source, idempotency_key) do nothing
  returning id into refill_id;

  if refill_id is null then
    select existing.id
    into refill_id
    from public.lpg_refill_records existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    return refill_id;
  end if;

  update public.lpg_refill_orders
  set actual_kg = target_actual_kg,
      station_amount = refill_amount,
      status = 'refill_confirmed',
      updated_at = timezone('utc', now())
  where id = order_record.id;

  perform public.record_lpg_order_event(
    order_record.id,
    'lpg.refill.confirmed',
    order_record.status,
    'refill_confirmed',
    target_idempotency_key || ':event',
    jsonb_build_object('refill_record_id', refill_id, 'actual_kg', target_actual_kg, 'refill_amount', refill_amount)
  );

  perform public.record_lpg_cylinder_history(
    order_record.cylinder_id,
    'refilled',
    target_idempotency_key || ':cylinder-history',
    order_record.id,
    order_record.station_branch_id,
    order_record.driver_profile_id,
    target_actual_kg,
    target_safety_observations,
    '{}'::jsonb
  );

  return refill_id;
end;
$$;

create or replace function public.record_lpg_driver_location(
  target_driver_profile_id uuid,
  target_latitude numeric,
  target_longitude numeric,
  target_idempotency_key text,
  target_lpg_order_id uuid default null,
  target_accuracy_meters numeric default null,
  target_heading_degrees numeric default null,
  target_speed_meters_per_second numeric default null,
  target_online_status text default 'online',
  target_recorded_at timestamptz default timezone('utc', now()),
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'lpg.driver_location_api'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  driver_record record;
  location_id uuid;
begin
  if target_latitude is null or target_latitude < -90 or target_latitude > 90
    or target_longitude is null or target_longitude < -180 or target_longitude > 180 then
    raise exception 'target_latitude and target_longitude must be valid coordinates';
  end if;

  if target_online_status not in ('online', 'offline', 'busy') then
    raise exception 'target_online_status is not supported';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select driver.*
  into driver_record
  from public.driver_profiles driver
  where driver.id = target_driver_profile_id;

  if not found then
    raise exception 'target_driver_profile_id must reference an existing driver';
  end if;

  if auth.role() <> 'service_role'
    and driver_record.user_id <> auth.uid()
    and not public.has_permission('lpg.dispatch.execute', null)
    and not public.can_manage_lpg_operations() then
    raise exception 'driver location permission is required';
  end if;

  insert into public.lpg_driver_locations (
    driver_profile_id,
    user_id,
    lpg_order_id,
    latitude,
    longitude,
    accuracy_meters,
    heading_degrees,
    speed_meters_per_second,
    online_status,
    recorded_at,
    metadata,
    source,
    idempotency_key
  )
  values (
    target_driver_profile_id,
    driver_record.user_id,
    target_lpg_order_id,
    target_latitude,
    target_longitude,
    target_accuracy_meters,
    target_heading_degrees,
    target_speed_meters_per_second,
    target_online_status,
    target_recorded_at,
    target_metadata,
    target_source,
    target_idempotency_key
  )
  on conflict (source, idempotency_key) do nothing
  returning id into location_id;

  if location_id is null then
    select existing.id
    into location_id
    from public.lpg_driver_locations existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;
  end if;

  return location_id;
end;
$$;

create or replace function public.dispatch_lpg_order(
  target_lpg_order_id uuid,
  target_candidate_limit integer default 5,
  target_idempotency_key text default null,
  target_source text default 'lpg.dispatch_api'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record record;
  station_record record;
  policy_record record;
  dispatch_request_id uuid;
  candidate_record record;
  candidate_rank integer := 0;
  selected_driver_profile_id uuid;
  selected_vehicle_id uuid;
  existing_dispatch_request_id uuid;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('lpg.dispatch.execute', null)
    and not public.can_manage_lpg_operations() then
    raise exception 'LPG dispatch permission is required';
  end if;

  if target_lpg_order_id is null then
    raise exception 'target_lpg_order_id is required';
  end if;

  if target_candidate_limit is null or target_candidate_limit <= 0 or target_candidate_limit > 25 then
    raise exception 'target_candidate_limit must be between 1 and 25';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select target_order.*,
         pickup.latitude as pickup_latitude,
         pickup.longitude as pickup_longitude,
         delivery.latitude as delivery_latitude,
         delivery.longitude as delivery_longitude,
         cylinder.size_kg as cylinder_size_kg
  into order_record
  from public.lpg_refill_orders target_order
  join public.lpg_customer_locations pickup on pickup.id = target_order.pickup_location_id
  join public.lpg_customer_locations delivery on delivery.id = target_order.delivery_location_id
  join public.lpg_cylinders cylinder on cylinder.id = target_order.cylinder_id
  where target_order.id = target_lpg_order_id
  for update of target_order;

  if not found then
    raise exception 'target_lpg_order_id must reference an LPG order';
  end if;

  if order_record.status not in ('payment_reserved', 'matching_station', 'matching_driver', 'driver_offered') then
    raise exception 'LPG order must be funded before dispatch';
  end if;

  existing_dispatch_request_id := nullif(order_record.metadata ->> 'dispatch_request_id', '')::uuid;

  if existing_dispatch_request_id is not null
    and order_record.metadata ->> 'dispatch_idempotency_key' = target_idempotency_key then
    return existing_dispatch_request_id;
  end if;

  if order_record.station_branch_id is not null then
    select station.*
    into station_record
    from public.lpg_station_branches station
    where station.id = order_record.station_branch_id
      and station.approval_status = 'approved'
      and station.compliance_status = 'approved'
      and station.availability_status = 'available'
      and station.current_available_kg >= order_record.requested_kg;
  else
    select station.*
    into station_record
    from public.lpg_station_branches station
    where station.approval_status = 'approved'
      and station.compliance_status = 'approved'
      and station.availability_status = 'available'
      and station.current_available_kg >= order_record.requested_kg
      and (
        array_length(station.supported_cylinder_sizes_kg, 1) is null
        or order_record.cylinder_size_kg = any(station.supported_cylinder_sizes_kg)
      )
      and public.lpg_distance_meters(
        order_record.pickup_latitude,
        order_record.pickup_longitude,
        station.latitude,
        station.longitude
      ) <= station.service_radius_meters
    order by
      public.lpg_distance_meters(
        order_record.pickup_latitude,
        order_record.pickup_longitude,
        station.latitude,
        station.longitude
      ) asc,
      station.current_available_kg desc,
      station.created_at asc
    limit 1;
  end if;

  if not found then
    raise exception 'no eligible LPG station is available for this order';
  end if;

  select policy.*
  into policy_record
  from public.dispatch_policies policy
  where policy.key = 'dispatch.lpg.nearest-qualified-driver.v1'
    and policy.status = 'active'
  limit 1;

  if not found then
    raise exception 'active LPG dispatch policy is required';
  end if;

  insert into public.dispatch_requests (
    policy_id,
    subject_type,
    subject_id,
    requester_user_id,
    required_capabilities,
    pickup_location,
    dropoff_location,
    priority,
    status,
    metadata
  )
  values (
    policy_record.id,
    'lpg_order',
    order_record.id,
    auth.uid(),
    jsonb_build_object(
      'driver_required_capabilities',
      jsonb_build_array('capability.driver.cylinder-handling'),
      'vehicle_required_capabilities',
      jsonb_build_array('capability.cargo.pressurized-cylinder')
    ),
    jsonb_build_object(
      'latitude',
      order_record.pickup_latitude,
      'longitude',
      order_record.pickup_longitude
    ),
    jsonb_build_object(
      'latitude',
      order_record.delivery_latitude,
      'longitude',
      order_record.delivery_longitude
    ),
    100,
    'matching',
    jsonb_build_object(
      'bounded_context',
      'lpg',
      'station_branch_id',
      station_record.id,
      'source',
      target_source,
      'idempotency_key',
      target_idempotency_key
    )
  )
  returning id into dispatch_request_id;

  for candidate_record in
    select
      driver.id as driver_profile_id,
      selected_vehicle.id as vehicle_id,
      latest_location.recorded_at,
      public.lpg_distance_meters(
        order_record.pickup_latitude,
        order_record.pickup_longitude,
        latest_location.latitude,
        latest_location.longitude
      ) as distance_meters
    from public.driver_profiles driver
    join public.driver_vehicle_links vehicle_link
      on vehicle_link.driver_profile_id = driver.id
      and vehicle_link.status = 'active'
      and vehicle_link.starts_at <= timezone('utc', now())
      and (vehicle_link.ends_at is null or vehicle_link.ends_at > timezone('utc', now()))
    join public.vehicles selected_vehicle
      on selected_vehicle.id = vehicle_link.vehicle_id
      and selected_vehicle.status = 'active'
    join public.entity_capabilities driver_capability
      on driver_capability.entity_type = 'driver'
      and driver_capability.entity_id = driver.id
      and driver_capability.capability_key = 'capability.driver.cylinder-handling'
      and driver_capability.status = 'active'
    join public.entity_capabilities vehicle_capability
      on vehicle_capability.entity_type = 'vehicle'
      and vehicle_capability.entity_id = selected_vehicle.id
      and vehicle_capability.capability_key = 'capability.cargo.pressurized-cylinder'
      and vehicle_capability.status = 'active'
    join lateral (
      select location.latitude, location.longitude, location.recorded_at
      from public.lpg_driver_locations location
      where location.driver_profile_id = driver.id
        and location.online_status = 'online'
        and location.recorded_at >= timezone('utc', now()) - interval '30 minutes'
      order by location.recorded_at desc
      limit 1
    ) latest_location on true
    where driver.verification_status = 'approved'
      and driver.operational_status = 'available'
    order by distance_meters asc, latest_location.recorded_at desc, driver.created_at asc
    limit target_candidate_limit
  loop
    candidate_rank := candidate_rank + 1;

    if candidate_rank = 1 then
      selected_driver_profile_id := candidate_record.driver_profile_id;
      selected_vehicle_id := candidate_record.vehicle_id;
    end if;

    insert into public.dispatch_candidates (
      dispatch_request_id,
      candidate_entity_type,
      candidate_entity_id,
      score,
      rank,
      rationale,
      status
    )
    values (
      dispatch_request_id,
      'driver',
      candidate_record.driver_profile_id,
      greatest(100000 - coalesce(candidate_record.distance_meters, 100000), 1),
      candidate_rank,
      jsonb_build_object(
        'vehicle_id',
        candidate_record.vehicle_id,
        'distance_meters',
        candidate_record.distance_meters,
        'location_recorded_at',
        candidate_record.recorded_at,
        'selection_mode',
        'lpg_nearest_qualified_driver'
      ),
      case when candidate_rank = 1 then 'offered' else 'suggested' end
    )
    on conflict (dispatch_request_id, candidate_entity_type, candidate_entity_id) do update
    set score = excluded.score,
        rank = excluded.rank,
        rationale = excluded.rationale,
        status = excluded.status,
        updated_at = timezone('utc', now());
  end loop;

  if candidate_rank = 0 then
    raise exception 'no fresh eligible LPG driver location is available for dispatch';
  end if;

  update public.dispatch_requests
  set assigned_entity_type = 'driver',
      assigned_entity_id = selected_driver_profile_id,
      metadata = metadata || jsonb_build_object('vehicle_id', selected_vehicle_id),
      updated_at = timezone('utc', now())
  where id = dispatch_request_id;

  update public.lpg_refill_orders
  set station_branch_id = station_record.id,
      driver_profile_id = selected_driver_profile_id,
      vehicle_id = selected_vehicle_id,
      status = 'driver_offered',
      assignment_status = 'driver_offered',
      metadata = metadata || jsonb_build_object(
        'dispatch_request_id',
        dispatch_request_id,
        'dispatch_idempotency_key',
        target_idempotency_key,
        'dispatch_candidate_count',
        candidate_rank
      ),
      updated_at = timezone('utc', now())
  where id = order_record.id;

  update public.service_requests
  set status = 'matching',
      participants = participants || jsonb_build_object(
        'station_branch_id',
        station_record.id,
        'driver_profile_id',
        selected_driver_profile_id,
        'vehicle_id',
        selected_vehicle_id
      ),
      updated_at = timezone('utc', now())
  where id = order_record.service_request_id;

  perform public.record_lpg_order_event(
    order_record.id,
    'lpg.dispatch.driver_offered',
    order_record.status,
    'driver_offered',
    target_idempotency_key || ':event',
    jsonb_build_object(
      'dispatch_request_id',
      dispatch_request_id,
      'station_branch_id',
      station_record.id,
      'driver_profile_id',
      selected_driver_profile_id,
      'vehicle_id',
      selected_vehicle_id
    )
  );

  return dispatch_request_id;
end;
$$;

create or replace function public.accept_lpg_driver_assignment(
  target_lpg_order_id uuid,
  target_idempotency_key text,
  target_source text default 'lpg.driver_api',
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record record;
  driver_record record;
  accepted_dispatch_request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authenticated user is required';
  end if;

  if target_lpg_order_id is null then
    raise exception 'target_lpg_order_id is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select target_order.*
  into order_record
  from public.lpg_refill_orders target_order
  where target_order.id = target_lpg_order_id
  for update;

  if not found then
    raise exception 'target_lpg_order_id must reference an LPG order';
  end if;

  if order_record.status = 'driver_accepted' then
    return order_record.id;
  end if;

  if order_record.status <> 'driver_offered' then
    raise exception 'LPG assignment can only be accepted after a driver offer';
  end if;

  select driver.*
  into driver_record
  from public.driver_profiles driver
  where driver.id = order_record.driver_profile_id
    and driver.user_id = auth.uid()
    and driver.verification_status = 'approved';

  if not found and not public.can_manage_lpg_operations() then
    raise exception 'assigned approved LPG driver is required';
  end if;

  accepted_dispatch_request_id := nullif(order_record.metadata ->> 'dispatch_request_id', '')::uuid;

  update public.lpg_refill_orders
  set status = 'driver_accepted',
      assignment_status = 'driver_assigned',
      metadata = metadata || target_metadata || jsonb_build_object(
        'driver_acceptance_source',
        target_source,
        'driver_acceptance_idempotency_key',
        target_idempotency_key
      ),
      updated_at = timezone('utc', now())
  where id = order_record.id;

  update public.service_requests
  set status = 'assigned',
      updated_at = timezone('utc', now())
  where id = order_record.service_request_id;

  if accepted_dispatch_request_id is not null then
    update public.dispatch_requests
    set status = 'assigned',
        updated_at = timezone('utc', now())
    where id = accepted_dispatch_request_id;

    update public.dispatch_candidates
    set status = case
          when candidate_entity_id = order_record.driver_profile_id then 'accepted'
          else 'expired'
        end,
        updated_at = timezone('utc', now())
    where public.dispatch_candidates.dispatch_request_id = accepted_dispatch_request_id
      and candidate_entity_type = 'driver';
  end if;

  perform public.record_lpg_order_event(
    order_record.id,
    'lpg.dispatch.driver_accepted',
    order_record.status,
    'driver_accepted',
    target_idempotency_key || ':event',
    target_metadata
  );

  return order_record.id;
end;
$$;

create or replace function public.create_lpg_safety_incident(
  target_incident_type text,
  target_severity text,
  target_description text,
  target_idempotency_key text,
  target_lpg_order_id uuid default null,
  target_cylinder_id uuid default null,
  target_station_branch_id uuid default null,
  target_driver_profile_id uuid default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'lpg.safety_api'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  incident_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authenticated user is required';
  end if;

  if target_incident_type not in ('leak', 'damage', 'expired_cylinder', 'unsafe_valve', 'lost', 'stolen', 'accident', 'other') then
    raise exception 'target_incident_type is not supported';
  end if;

  if target_severity not in ('low', 'medium', 'high', 'critical') then
    raise exception 'target_severity is not supported';
  end if;

  if target_description is null or char_length(btrim(target_description)) < 5 then
    raise exception 'target_description is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_lpg_order_id is not null and not public.can_access_lpg_order(target_lpg_order_id) then
    raise exception 'LPG order access permission is required';
  end if;

  if target_cylinder_id is not null
    and not exists (
      select 1
      from public.lpg_cylinders cylinder
      where cylinder.id = target_cylinder_id
        and (cylinder.owner_user_id = auth.uid() or public.can_manage_lpg_operations())
    ) then
    raise exception 'target_cylinder_id is not accessible';
  end if;

  insert into public.lpg_safety_incidents (
    lpg_order_id,
    cylinder_id,
    station_branch_id,
    driver_profile_id,
    incident_type,
    severity,
    description,
    metadata,
    source,
    idempotency_key
  )
  values (
    target_lpg_order_id,
    target_cylinder_id,
    target_station_branch_id,
    target_driver_profile_id,
    target_incident_type,
    target_severity,
    btrim(target_description),
    target_metadata,
    target_source,
    target_idempotency_key
  )
  on conflict (source, idempotency_key) do nothing
  returning id into incident_id;

  if incident_id is null then
    select existing.id
    into incident_id
    from public.lpg_safety_incidents existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;
  end if;

  if target_lpg_order_id is not null then
    perform public.record_lpg_order_event(
      target_lpg_order_id,
      'lpg.safety.incident_reported',
      null,
      null,
      target_idempotency_key || ':event',
      jsonb_build_object('safety_incident_id', incident_id, 'severity', target_severity)
    );
  end if;

  if target_cylinder_id is not null then
    perform public.record_lpg_cylinder_history(
      target_cylinder_id,
      'damage_reported',
      target_idempotency_key || ':cylinder-history',
      target_lpg_order_id,
      target_station_branch_id,
      target_driver_profile_id,
      null,
      target_metadata || jsonb_build_object(
        'incident_type',
        target_incident_type,
        'severity',
        target_severity,
        'description',
        target_description
      ),
      '{}'::jsonb
    );
  end if;

  return incident_id;
end;
$$;

insert into public.lpg_refill_pricing (
  currency_code,
  price_per_kg,
  delivery_base_fee,
  platform_fee_amount,
  tax_rate_percent,
  driver_commission_amount,
  min_kg,
  max_kg,
  metadata,
  source,
  idempotency_key
)
values (
  'NGN',
  1200,
  1000,
  250,
  0,
  700,
  1,
  50,
  '{"phase":"one","pricing_source":"admin_configurable_default"}'::jsonb,
  'lpg.pricing_seed',
  'lpg-pricing-default-ngn-v1'
)
on conflict (source, idempotency_key) do update
set price_per_kg = excluded.price_per_kg,
    delivery_base_fee = excluded.delivery_base_fee,
    platform_fee_amount = excluded.platform_fee_amount,
    driver_commission_amount = excluded.driver_commission_amount,
    status = 'active',
    updated_at = timezone('utc', now());

alter table public.lpg_customer_locations enable row level security;
alter table public.lpg_station_branches enable row level security;
alter table public.lpg_refill_pricing enable row level security;
alter table public.lpg_cylinders enable row level security;
alter table public.lpg_cylinder_history enable row level security;
alter table public.lpg_refill_quotes enable row level security;
alter table public.lpg_refill_orders enable row level security;
alter table public.lpg_order_events enable row level security;
alter table public.lpg_cylinder_scans enable row level security;
alter table public.lpg_refill_records enable row level security;
alter table public.lpg_driver_locations enable row level security;
alter table public.lpg_safety_incidents enable row level security;

drop policy if exists lpg_customer_locations_select_owner_or_privileged on public.lpg_customer_locations;
drop policy if exists lpg_customer_locations_insert_owner on public.lpg_customer_locations;
drop policy if exists lpg_customer_locations_update_owner on public.lpg_customer_locations;
drop policy if exists lpg_station_branches_select_related_or_privileged on public.lpg_station_branches;
drop policy if exists lpg_station_branches_manage_privileged on public.lpg_station_branches;
drop policy if exists lpg_refill_pricing_select_active_or_privileged on public.lpg_refill_pricing;
drop policy if exists lpg_refill_pricing_manage_privileged on public.lpg_refill_pricing;
drop policy if exists lpg_cylinders_select_owner_or_privileged on public.lpg_cylinders;
drop policy if exists lpg_cylinders_insert_owner on public.lpg_cylinders;
drop policy if exists lpg_cylinders_update_owner_or_privileged on public.lpg_cylinders;
drop policy if exists lpg_cylinder_history_select_related_or_privileged on public.lpg_cylinder_history;
drop policy if exists lpg_refill_quotes_select_owner_or_privileged on public.lpg_refill_quotes;
drop policy if exists lpg_refill_orders_select_related_or_privileged on public.lpg_refill_orders;
drop policy if exists lpg_order_events_select_related_or_privileged on public.lpg_order_events;
drop policy if exists lpg_cylinder_scans_select_related_or_privileged on public.lpg_cylinder_scans;
drop policy if exists lpg_refill_records_select_related_or_privileged on public.lpg_refill_records;
drop policy if exists lpg_driver_locations_select_related_or_privileged on public.lpg_driver_locations;
drop policy if exists lpg_safety_incidents_select_related_or_privileged on public.lpg_safety_incidents;

create policy lpg_customer_locations_select_owner_or_privileged on public.lpg_customer_locations
for select to authenticated
using (owner_user_id = auth.uid() or public.can_manage_lpg_operations());

create policy lpg_customer_locations_insert_owner on public.lpg_customer_locations
for insert to authenticated
with check (owner_user_id = auth.uid());

create policy lpg_customer_locations_update_owner on public.lpg_customer_locations
for update to authenticated
using (owner_user_id = auth.uid() or public.can_manage_lpg_operations())
with check (owner_user_id = auth.uid() or public.can_manage_lpg_operations());

create policy lpg_station_branches_select_related_or_privileged on public.lpg_station_branches
for select to authenticated
using (
  approval_status = 'approved'
  or public.is_organization_member(organization_id)
  or public.has_permission('lpg.stations.read', organization_id)
  or public.can_manage_lpg_operations()
);

create policy lpg_station_branches_manage_privileged on public.lpg_station_branches
for all to authenticated
using (public.has_permission('lpg.stations.manage', organization_id) or public.can_manage_lpg_operations())
with check (public.has_permission('lpg.stations.manage', organization_id) or public.can_manage_lpg_operations());

create policy lpg_refill_pricing_select_active_or_privileged on public.lpg_refill_pricing
for select to authenticated
using (status = 'active' or public.has_permission('lpg.stations.manage', null) or public.can_manage_lpg_operations());

create policy lpg_refill_pricing_manage_privileged on public.lpg_refill_pricing
for all to authenticated
using (public.has_permission('lpg.stations.manage', null) or public.can_manage_lpg_operations())
with check (public.has_permission('lpg.stations.manage', null) or public.can_manage_lpg_operations());

create policy lpg_cylinders_select_owner_or_privileged on public.lpg_cylinders
for select to authenticated
using (owner_user_id = auth.uid() or public.can_manage_lpg_operations());

create policy lpg_cylinders_insert_owner on public.lpg_cylinders
for insert to authenticated
with check (owner_user_id = auth.uid());

create policy lpg_cylinders_update_owner_or_privileged on public.lpg_cylinders
for update to authenticated
using (owner_user_id = auth.uid() or public.can_manage_lpg_operations())
with check (owner_user_id = auth.uid() or public.can_manage_lpg_operations());

create policy lpg_cylinder_history_select_related_or_privileged on public.lpg_cylinder_history
for select to authenticated
using (
  exists (
    select 1 from public.lpg_cylinders cylinder
    where cylinder.id = lpg_cylinder_history.cylinder_id
      and cylinder.owner_user_id = auth.uid()
  )
  or public.can_manage_lpg_operations()
  or (lpg_order_id is not null and public.can_access_lpg_order(lpg_order_id))
);

create policy lpg_refill_quotes_select_owner_or_privileged on public.lpg_refill_quotes
for select to authenticated
using (
  exists (
    select 1 from public.lpg_cylinders cylinder
    where cylinder.id = lpg_refill_quotes.cylinder_id
      and cylinder.owner_user_id = auth.uid()
  )
  or public.can_manage_lpg_operations()
);

create policy lpg_refill_orders_select_related_or_privileged on public.lpg_refill_orders
for select to authenticated
using (public.can_access_lpg_order(id));

create policy lpg_order_events_select_related_or_privileged on public.lpg_order_events
for select to authenticated
using (public.can_access_lpg_order(lpg_order_id));

create policy lpg_cylinder_scans_select_related_or_privileged on public.lpg_cylinder_scans
for select to authenticated
using (public.can_access_lpg_order(lpg_order_id));

create policy lpg_refill_records_select_related_or_privileged on public.lpg_refill_records
for select to authenticated
using (public.can_access_lpg_order(lpg_order_id));

create policy lpg_driver_locations_select_related_or_privileged on public.lpg_driver_locations
for select to authenticated
using (
  user_id = auth.uid()
  or public.can_manage_lpg_operations()
  or (lpg_order_id is not null and public.can_access_lpg_order(lpg_order_id))
);

create policy lpg_safety_incidents_select_related_or_privileged on public.lpg_safety_incidents
for select to authenticated
using (
  reported_by = auth.uid()
  or public.can_manage_lpg_operations()
  or (lpg_order_id is not null and public.can_access_lpg_order(lpg_order_id))
);

grant select, insert, update on public.lpg_customer_locations to authenticated, service_role;
grant select, insert, update on public.lpg_station_branches to authenticated, service_role;
grant select, insert, update on public.lpg_refill_pricing to authenticated, service_role;
grant select, insert, update on public.lpg_cylinders to authenticated, service_role;
grant select, insert on public.lpg_cylinder_history to authenticated, service_role;
grant select, insert, update on public.lpg_refill_quotes to authenticated, service_role;
grant select, insert, update on public.lpg_refill_orders to authenticated, service_role;
grant select, insert on public.lpg_order_events to authenticated, service_role;
grant select, insert on public.lpg_cylinder_scans to authenticated, service_role;
grant select, insert on public.lpg_refill_records to authenticated, service_role;
grant select, insert on public.lpg_driver_locations to authenticated, service_role;
grant select, insert, update on public.lpg_safety_incidents to authenticated, service_role;

revoke all on function public.can_manage_lpg_operations() from public;
revoke all on function public.can_access_lpg_order(uuid) from public;
revoke all on function public.lpg_distance_meters(numeric, numeric, numeric, numeric) from public;
revoke all on function public.record_lpg_order_event(uuid, text, text, text, text, jsonb) from public;
revoke all on function public.record_lpg_cylinder_history(uuid, text, text, uuid, uuid, uuid, numeric, jsonb, jsonb) from public;
revoke all on function public.create_lpg_customer_location(text, text, numeric, numeric, text, numeric, text, text, text, text, text, text, jsonb, text) from public;
revoke all on function public.register_lpg_cylinder(text, numeric, numeric, text, text, text, text, text, text, text, date, date, date, text, text, uuid, uuid[], text, jsonb, text) from public;
revoke all on function public.create_lpg_refill_quote(uuid, numeric, uuid, uuid, text, uuid, timestamptz, text, jsonb, text) from public;
revoke all on function public.create_lpg_refill_order(uuid, text, jsonb, text) from public;
revoke all on function public.record_lpg_cylinder_scan(uuid, text, text, numeric, numeric, numeric, jsonb, text) from public;
revoke all on function public.confirm_lpg_refill(uuid, numeric, numeric, text, jsonb, text) from public;
revoke all on function public.record_lpg_driver_location(uuid, numeric, numeric, text, uuid, numeric, numeric, numeric, text, timestamptz, jsonb, text) from public;
revoke all on function public.dispatch_lpg_order(uuid, integer, text, text) from public;
revoke all on function public.accept_lpg_driver_assignment(uuid, text, text, jsonb) from public;
revoke all on function public.create_lpg_safety_incident(text, text, text, text, uuid, uuid, uuid, uuid, jsonb, text) from public;

grant execute on function public.can_manage_lpg_operations() to authenticated, service_role;
grant execute on function public.can_access_lpg_order(uuid) to authenticated, service_role;
grant execute on function public.lpg_distance_meters(numeric, numeric, numeric, numeric) to authenticated, service_role;
grant execute on function public.create_lpg_customer_location(text, text, numeric, numeric, text, numeric, text, text, text, text, text, text, jsonb, text) to authenticated, service_role;
grant execute on function public.register_lpg_cylinder(text, numeric, numeric, text, text, text, text, text, text, text, date, date, date, text, text, uuid, uuid[], text, jsonb, text) to authenticated, service_role;
grant execute on function public.create_lpg_refill_quote(uuid, numeric, uuid, uuid, text, uuid, timestamptz, text, jsonb, text) to authenticated, service_role;
grant execute on function public.create_lpg_refill_order(uuid, text, jsonb, text) to authenticated, service_role;
grant execute on function public.record_lpg_cylinder_scan(uuid, text, text, numeric, numeric, numeric, jsonb, text) to authenticated, service_role;
grant execute on function public.confirm_lpg_refill(uuid, numeric, numeric, text, jsonb, text) to authenticated, service_role;
grant execute on function public.record_lpg_driver_location(uuid, numeric, numeric, text, uuid, numeric, numeric, numeric, text, timestamptz, jsonb, text) to authenticated, service_role;
grant execute on function public.dispatch_lpg_order(uuid, integer, text, text) to authenticated, service_role;
grant execute on function public.accept_lpg_driver_assignment(uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function public.create_lpg_safety_incident(text, text, text, text, uuid, uuid, uuid, uuid, jsonb, text) to authenticated, service_role;

commit;
