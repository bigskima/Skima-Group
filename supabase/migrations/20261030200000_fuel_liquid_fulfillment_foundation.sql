begin;

-- Fuel is a new business module; LPG remains a separate, unchanged bounded context.
insert into public.permissions (key, description, risk_level)
values
  ('platform.fuel.read', 'Read global fuel product and configuration records.', 'standard'),
  ('platform.fuel.manage', 'Manage global fuel products, container definitions and fuel controls.', 'critical'),
  ('business.fuel.inventory.read', 'Read liquid-fuel storage, stock and reservation records for an organization.', 'standard'),
  ('business.fuel.inventory.manage', 'Manage liquid-fuel storage, stock and inventory operations for an organization.', 'high'),
  ('business.fuel.containers.read', 'Read fuel-container assets, allocations and custody records for an organization.', 'standard'),
  ('business.fuel.containers.manage', 'Manage fuel-container assets, allocations and custody records for an organization.', 'high')
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    updated_at = timezone('utc', now());

-- Allow platform module administrators to configure the new business module.
insert into public.role_permissions (role_id, permission_id)
select role_record.id, permission_record.id
from public.roles role_record
join public.permissions permission_record
  on permission_record.key in ('platform.fuel.read', 'platform.fuel.manage')
where role_record.key = 'platform.module_admin'
  and role_record.organization_id is null
on conflict (role_id, permission_id) do nothing;

insert into public.business_modules (key, display_name, description, status, metadata)
values (
  'fuel',
  'Fuel',
  'Liquid-fuel fulfilment for PMS, AGO and DPK using shared SKIMA platform engines.',
  'draft',
  jsonb_build_object(
    'category', 'commerce.fulfillment',
    'configured_by', 'fuel_liquid_fulfillment_foundation',
    'products', jsonb_build_array('fuel.pms', 'fuel.ago', 'fuel.dpk'),
    'fulfillment_profile', 'station_fill_container_delivery',
    'core_platform_dependency', 'configuration_only'
  )
)
on conflict (key) do nothing;

create table if not exists public.fuel_products (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (key in ('fuel.pms', 'fuel.ago', 'fuel.dpk')),
  short_code text not null unique
    check (short_code in ('PMS', 'AGO', 'DPK')),
  display_name text not null,
  unit_code text not null default 'L'
    check (unit_code = 'L'),
  quantity_precision integer not null default 2
    check (quantity_precision between 0 and 3),
  status text not null default 'disabled'
    check (status in ('disabled', 'enabled', 'paused', 'retired')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.fuel_products (key, short_code, display_name, unit_code, quantity_precision, status, metadata)
values
  ('fuel.pms', 'PMS', 'Petrol', 'L', 2, 'disabled', '{"official_product_code":"PMS","unit_label":"litres"}'::jsonb),
  ('fuel.ago', 'AGO', 'Diesel', 'L', 2, 'disabled', '{"official_product_code":"AGO","unit_label":"litres"}'::jsonb),
  ('fuel.dpk', 'DPK', 'Kerosene', 'L', 2, 'disabled', '{"official_product_code":"DPK","unit_label":"litres"}'::jsonb)
on conflict (key) do nothing;

create table if not exists public.fuel_product_events (
  id uuid primary key default gen_random_uuid(),
  fuel_product_id uuid not null references public.fuel_products(id) on delete restrict,
  from_status text,
  to_status text not null
    check (to_status in ('disabled', 'enabled', 'paused', 'retired')),
  reason text,
  idempotency_key text not null unique,
  actor_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now())
);

insert into public.event_types (key, description, schema, status)
values
  ('event.fuel.product.status_changed', 'Global fuel product availability was changed.', '{"required":["product_key","from_status","to_status"]}'::jsonb, 'active'),
  ('event.fuel.stock.received', 'Liquid-fuel stock was received into a station storage unit.', '{}'::jsonb, 'active'),
  ('event.fuel.stock.adjusted', 'Liquid-fuel physical stock was adjusted with an audit reason.', '{}'::jsonb, 'active'),
  ('event.fuel.stock.reserved', 'Liquid-fuel stock was reserved for an order.', '{}'::jsonb, 'active'),
  ('event.fuel.stock.released', 'An order liquid-fuel stock reservation was released.', '{}'::jsonb, 'active'),
  ('event.fuel.stock.consumed', 'Liquid-fuel stock was consumed by fulfilment.', '{}'::jsonb, 'active'),
  ('event.fuel.container.reserved', 'A fuel container was reserved for an order.', '{}'::jsonb, 'active'),
  ('event.fuel.container.station_filled', 'A fuel container was filled and measured at a station.', '{}'::jsonb, 'active'),
  ('event.fuel.container.handed_to_driver', 'A filled fuel container was handed to a driver.', '{}'::jsonb, 'active'),
  ('event.fuel.container.delivered', 'A fuel container was delivered to a customer.', '{}'::jsonb, 'active'),
  ('event.fuel.container.returned_to_driver', 'A rented fuel container was returned by a customer to a driver.', '{}'::jsonb, 'active'),
  ('event.fuel.container.received_at_station', 'A rented fuel container was received back at a station.', '{}'::jsonb, 'active'),
  ('event.fuel.container.inspected', 'A returned fuel container was inspected.', '{}'::jsonb, 'active'),
  ('event.fuel.container.ownership_transferred', 'A purchased fuel container ownership was transferred to a customer.', '{}'::jsonb, 'active')
on conflict (key) do update
set description = excluded.description,
    schema = excluded.schema,
    status = excluded.status,
    updated_at = timezone('utc', now());

-- Capability definitions are intentionally not assigned to existing drivers or vehicles.
-- LPG qualifications never imply liquid-fuel delivery eligibility.
insert into public.capability_definitions (key, category, description, schema, status)
values
  ('capability.driver.fuel-delivery', 'driver', 'Approved for a configured SKIMA liquid-fuel delivery workflow.', '{"product_specific_approval_required":true,"assignment_checks_current_approval":true}'::jsonb, 'active'),
  ('capability.driver.fuel-pms-delivery', 'driver', 'Approved to deliver PMS using an eligible configured container and vehicle.', '{"product_key":"fuel.pms","product_specific_approval_required":true}'::jsonb, 'active'),
  ('capability.driver.fuel-ago-delivery', 'driver', 'Approved to deliver AGO using an eligible configured container and vehicle.', '{"product_key":"fuel.ago","product_specific_approval_required":true}'::jsonb, 'active'),
  ('capability.driver.fuel-dpk-delivery', 'driver', 'Approved to deliver DPK using an eligible configured container and vehicle.', '{"product_key":"fuel.dpk","product_specific_approval_required":true}'::jsonb, 'active'),
  ('capability.cargo.liquid-fuel-container', 'cargo', 'Can transport an approved liquid-fuel container subject to product, capacity and operating restrictions.', '{"product_compatibility_required":true,"capacity_check_required":true}'::jsonb, 'active'),
  ('capability.vehicle.liquid-fuel-transport', 'vehicle', 'Vehicle is approved for configured liquid-fuel container transport.', '{"product_specific_approval_required":true,"vehicle_capacity_check_required":true}'::jsonb, 'active'),
  ('capability.partner.fuel-fulfillment', 'partner', 'Partner branch can prepare and hand over configured liquid-fuel orders.', '{"branch_stock_required":true,"product_configuration_required":true}'::jsonb, 'active')
on conflict (key) do update
set category = excluded.category,
    description = excluded.description,
    schema = excluded.schema,
    status = excluded.status,
    updated_at = timezone('utc', now());

create table if not exists public.fuel_container_types (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  nominal_capacity_litres numeric(12,3) not null
    check (nominal_capacity_litres > 0),
  supported_product_keys text[] not null
    check (
      cardinality(supported_product_keys) > 0
      and supported_product_keys <@ array['fuel.pms', 'fuel.ago', 'fuel.dpk']::text[]
    ),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'paused', 'retired')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.fuel_container_profiles (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null unique references public.assets(id) on delete restrict,
  container_type_id uuid not null references public.fuel_container_types(id) on delete restrict,
  serial_number text not null unique
    check (btrim(serial_number) <> ''),
  ownership_mode text not null default 'skima'
    check (ownership_mode in ('skima', 'customer')),
  capacity_litres numeric(12,3) not null
    check (capacity_litres > 0),
  status text not null default 'pending'
    check (status in ('pending', 'available', 'reserved', 'at_station', 'with_driver', 'with_customer', 'inspection', 'damaged', 'lost', 'retired')),
  last_inspected_at timestamptz,
  last_inspection_result text
    check (last_inspection_result is null or last_inspection_result in ('passed', 'failed', 'conditional')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.fuel_station_storage_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.organization_branches(id) on delete cascade,
  product_key text not null references public.fuel_products(key) on update cascade on delete restrict,
  key text not null
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  capacity_litres numeric(16,3) not null
    check (capacity_litres > 0),
  safety_reserve_litres numeric(16,3) not null default 0
    check (safety_reserve_litres >= 0),
  physical_stock_litres numeric(16,3) not null default 0
    check (physical_stock_litres >= 0),
  reserved_stock_litres numeric(16,3) not null default 0
    check (reserved_stock_litres >= 0),
  status text not null default 'active'
    check (status in ('active', 'paused', 'maintenance', 'retired')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (branch_id, key),
  check (safety_reserve_litres <= capacity_litres),
  check (physical_stock_litres <= capacity_litres),
  check (reserved_stock_litres <= physical_stock_litres),
  check (organization_id is not null)
);

create table if not exists public.fuel_station_stock_movements (
  id uuid primary key default gen_random_uuid(),
  storage_unit_id uuid not null references public.fuel_station_storage_units(id) on delete restrict,
  product_key text not null references public.fuel_products(key) on update cascade on delete restrict,
  movement_kind text not null
    check (movement_kind in ('receipt', 'adjustment', 'dispense', 'loss', 'transfer_in', 'transfer_out', 'reservation_consumed', 'reservation_released')),
  quantity_delta_litres numeric(16,3) not null
    check (quantity_delta_litres <> 0),
  physical_before_litres numeric(16,3) not null
    check (physical_before_litres >= 0),
  physical_after_litres numeric(16,3) not null
    check (physical_after_litres >= 0),
  order_id uuid references public.order_records(id) on delete set null,
  reason text,
  source text not null default 'platform.fuel_inventory'
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  actor_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key),
  check (abs((physical_after_litres - physical_before_litres) - quantity_delta_litres) < 0.001)
);

create table if not exists public.fuel_order_stock_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.order_records(id) on delete cascade,
  order_line_item_id uuid references public.order_line_items(id) on delete set null,
  storage_unit_id uuid not null references public.fuel_station_storage_units(id) on delete restrict,
  product_key text not null references public.fuel_products(key) on update cascade on delete restrict,
  requested_litres numeric(16,3) not null
    check (requested_litres > 0),
  reserved_litres numeric(16,3) not null
    check (reserved_litres > 0),
  status text not null default 'reserved'
    check (status in ('reserved', 'partially_consumed', 'consumed', 'released', 'expired', 'cancelled')),
  expires_at timestamptz,
  consumed_at timestamptz,
  released_at timestamptz,
  release_reason text,
  source text not null default 'platform.fuel_inventory'
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key),
  check (reserved_litres <= requested_litres)
);

create unique index if not exists fuel_order_stock_reservations_one_open_line
on public.fuel_order_stock_reservations (order_id, coalesce(order_line_item_id, '00000000-0000-0000-0000-000000000000'::uuid))
where status in ('reserved', 'partially_consumed');

create table if not exists public.fuel_container_allocations (
  id uuid primary key default gen_random_uuid(),
  container_profile_id uuid not null references public.fuel_container_profiles(id) on delete restrict,
  order_id uuid not null references public.order_records(id) on delete cascade,
  order_line_item_id uuid references public.order_line_items(id) on delete set null,
  product_key text not null references public.fuel_products(key) on update cascade on delete restrict,
  station_branch_id uuid not null references public.organization_branches(id) on delete restrict,
  customer_user_id uuid references public.profiles(id) on delete set null,
  allocated_litres numeric(12,3) not null check (allocated_litres > 0),
  allocation_mode text not null
    check (allocation_mode in ('purchase', 'rental')),
  status text not null default 'reserved'
    check (status in ('reserved', 'station_prepared', 'with_driver', 'delivered', 'return_due', 'returned_to_driver', 'received_at_station', 'inspection', 'available', 'ownership_transferred', 'exception', 'cancelled')),
  purchase_amount numeric(20,8) not null default 0
    check (purchase_amount >= 0),
  rental_amount numeric(20,8) not null default 0
    check (rental_amount >= 0),
  refundable_deposit_amount numeric(20,8) not null default 0
    check (refundable_deposit_amount >= 0),
  currency_code text not null references public.currency_definitions(code),
  reserved_at timestamptz not null default timezone('utc', now()),
  delivered_at timestamptz,
  returned_at timestamptz,
  received_at_station_at timestamptz,
  closed_at timestamptz,
  source text not null default 'platform.fuel_container'
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key),
  check (
    (allocation_mode = 'purchase' and rental_amount = 0 and refundable_deposit_amount = 0)
    or (allocation_mode = 'rental' and purchase_amount = 0)
  )
);

create unique index if not exists fuel_container_allocations_one_open_container
on public.fuel_container_allocations (container_profile_id)
where status not in ('available', 'ownership_transferred', 'cancelled');

create index if not exists fuel_container_allocations_order_status_idx
on public.fuel_container_allocations (order_id, status);

create table if not exists public.fuel_container_custody_events (
  id uuid primary key default gen_random_uuid(),
  allocation_id uuid not null references public.fuel_container_allocations(id) on delete restrict,
  container_profile_id uuid not null references public.fuel_container_profiles(id) on delete restrict,
  order_id uuid not null references public.order_records(id) on delete restrict,
  event_key text not null
    check (event_key in ('reserved', 'station_filled', 'handed_to_driver', 'delivered_to_customer', 'returned_to_driver', 'received_at_station', 'inspection_passed', 'inspection_failed', 'ownership_transferred', 'marked_damaged', 'marked_lost', 'reservation_released')),
  from_holder_type text
    check (from_holder_type is null or from_holder_type in ('station', 'driver', 'customer', 'platform')),
  from_holder_id uuid,
  to_holder_type text
    check (to_holder_type is null or to_holder_type in ('station', 'driver', 'customer', 'platform')),
  to_holder_id uuid,
  actor_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  verification_reference text,
  evidence_asset_ids uuid[] not null default array[]::uuid[],
  note text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  idempotency_key text not null unique,
  occurred_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.fuel_order_commercial_snapshots (
  id uuid primary key default gen_random_uuid(),
  service_request_id uuid not null unique references public.service_requests(id) on delete cascade,
  order_id uuid unique references public.order_records(id) on delete set null,
  product_key text not null references public.fuel_products(key) on update cascade on delete restrict,
  requested_litres numeric(16,3) not null
    check (requested_litres > 0),
  container_mode text not null
    check (container_mode in ('purchase', 'rental')),
  container_count integer not null
    check (container_count > 0),
  currency_code text not null references public.currency_definitions(code),
  fuel_unit_price numeric(20,8) not null check (fuel_unit_price >= 0),
  fuel_amount numeric(20,8) not null check (fuel_amount >= 0),
  container_amount numeric(20,8) not null default 0 check (container_amount >= 0),
  driver_amount numeric(20,8) not null default 0 check (driver_amount >= 0),
  platform_fee_amount numeric(20,8) not null default 0 check (platform_fee_amount >= 0),
  tax_amount numeric(20,8) not null default 0 check (tax_amount >= 0),
  refundable_deposit_amount numeric(20,8) not null default 0 check (refundable_deposit_amount >= 0),
  grand_total numeric(20,8) not null check (grand_total >= 0),
  component_snapshot jsonb not null
    check (jsonb_typeof(component_snapshot) = 'object'),
  status text not null default 'quoted'
    check (status in ('quoted', 'accepted', 'cancelled', 'expired', 'settled', 'disputed')),
  check (abs(fuel_amount - requested_litres * fuel_unit_price) < 0.001),
  check (grand_total = fuel_amount + container_amount + driver_amount + platform_fee_amount + tax_amount + refundable_deposit_amount),
  valid_until timestamptz,
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists fuel_products_status_idx
on public.fuel_products (status, key);

create index if not exists fuel_station_storage_units_branch_product_status_idx
on public.fuel_station_storage_units (branch_id, product_key, status);

create index if not exists fuel_station_stock_movements_storage_created_idx
on public.fuel_station_stock_movements (storage_unit_id, created_at desc);

create index if not exists fuel_container_profiles_status_idx
on public.fuel_container_profiles (status, ownership_mode);

create index if not exists fuel_container_custody_events_container_created_idx
on public.fuel_container_custody_events (container_profile_id, occurred_at desc);

create index if not exists fuel_commercial_snapshots_product_created_idx
on public.fuel_order_commercial_snapshots (product_key, created_at desc);

create or replace function public.can_manage_fuel_platform()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or public.is_platform_super_admin()
    or public.has_permission('platform.fuel.manage', null);
$$;

create or replace function public.can_read_fuel_branch(target_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or public.can_manage_fuel_platform()
    or exists (
      select 1
      from public.organization_branches branch_record
      where branch_record.id = target_branch_id
        and (
          public.is_organization_member(branch_record.organization_id)
          or public.has_permission('business.fuel.inventory.read', branch_record.organization_id)
          or public.has_permission('business.fuel.inventory.manage', branch_record.organization_id)
          or public.has_permission('business.catalog.read', branch_record.organization_id)
        )
    );
$$;

create or replace function public.can_manage_fuel_branch(target_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or public.can_manage_fuel_platform()
    or exists (
      select 1
      from public.organization_branches branch_record
      where branch_record.id = target_branch_id
        and (
          public.has_permission('business.fuel.inventory.manage', branch_record.organization_id)
          or public.has_permission('business.catalog.manage', branch_record.organization_id)
        )
    );
$$;

create or replace function public.can_read_fuel_order(target_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or exists (
      select 1
      from public.order_records order_record
      where order_record.id = target_order_id
        and (
          order_record.requester_user_id = auth.uid()
          or public.can_read_business_order(order_record.organization_id, order_record.branch_id)
        )
    );
$$;

create or replace function public.prevent_fuel_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'fuel events and stock movements are append-only';
end;
$$;

create or replace function public.validate_fuel_container_asset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  asset_record public.assets%rowtype;
  type_record public.fuel_container_types%rowtype;
begin
  select * into asset_record
  from public.assets
  where id = new.asset_id;

  if not found or asset_record.asset_type_key <> 'asset.fuel-container' then
    raise exception using errcode = '23514', message = 'fuel container profile requires an asset.fuel-container asset';
  end if;

  select * into type_record
  from public.fuel_container_types
  where id = new.container_type_id;

  if not found then
    raise exception using errcode = '23503', message = 'fuel container type was not found';
  end if;

  if new.capacity_litres > type_record.nominal_capacity_litres then
    raise exception using errcode = '23514', message = 'container capacity cannot exceed its configured type capacity';
  end if;

  if new.ownership_mode = 'customer' and asset_record.owner_user_id is null then
    raise exception using errcode = '23514', message = 'customer-owned fuel container must have a customer asset owner';
  end if;

  if new.ownership_mode = 'skima' and asset_record.owner_user_id is not null then
    raise exception using errcode = '23514', message = 'SKIMA-owned fuel container cannot have a customer asset owner';
  end if;

  return new;
end;
$$;

create or replace function public.validate_fuel_station_storage_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $
declare
  branch_organization_id uuid;
begin
  select branch.organization_id into branch_organization_id
  from public.organization_branches branch
  where branch.id = new.branch_id;

  if not found or branch_organization_id is distinct from new.organization_id then
    raise exception using errcode = '23514', message = 'fuel storage organization must match its station branch';
  end if;

  return new;
end;
$;

create or replace function public.validate_fuel_container_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $
declare
  profile_record record;
  order_record record;
  snapshot_record record;
  already_allocated_litres numeric(16,3);
  already_allocated_count integer;
begin
  -- Serialise multi-container allocations for the same order.
  perform pg_advisory_xact_lock(hashtextextended(new.order_id::text, 0));

  select profile.id, profile.ownership_mode, profile.capacity_litres,
         profile.status as profile_status, container_type.supported_product_keys
  into profile_record
  from public.fuel_container_profiles profile
  join public.fuel_container_types container_type on container_type.id = profile.container_type_id
  where profile.id = new.container_profile_id;

  if not found then
    raise exception using errcode = '23503', message = 'fuel container profile was not found';
  end if;

  if profile_record.ownership_mode <> 'skima' then
    raise exception using errcode = '23514', message = 'fuel order allocation requires a SKIMA-controlled container';
  end if;

  if profile_record.profile_status not in ('available', 'reserved') then
    raise exception using errcode = '23514', message = 'fuel container is not available for allocation';
  end if;

  if not (new.product_key = any(profile_record.supported_product_keys)) then
    raise exception using errcode = '23514', message = 'container type is not compatible with the ordered fuel product';
  end if;

  if new.allocated_litres > profile_record.capacity_litres then
    raise exception using errcode = '23514', message = 'allocated fuel quantity exceeds container capacity';
  end if;

  select order_row.id, order_row.branch_id, order_row.requester_user_id, module_record.key as module_key,
         order_row.service_request_id
  into order_record
  from public.order_records order_row
  join public.business_modules module_record on module_record.id = order_row.module_id
  where order_row.id = new.order_id;

  if not found or order_record.module_key <> 'fuel' then
    raise exception using errcode = '23514', message = 'container allocation must belong to a Fuel order';
  end if;

  if order_record.branch_id is distinct from new.station_branch_id
     or order_record.requester_user_id is distinct from new.customer_user_id then
    raise exception using errcode = '23514', message = 'container station and customer must match the Fuel order';
  end if;

  select snapshot.product_key, snapshot.container_mode, snapshot.requested_litres, snapshot.container_count
  into snapshot_record
  from public.fuel_order_commercial_snapshots snapshot
  where snapshot.service_request_id = order_record.service_request_id;

  if not found
     or snapshot_record.product_key <> new.product_key
     or snapshot_record.container_mode <> new.allocation_mode then
    raise exception using errcode = '23514', message = 'container product and purchase/rental mode must match the locked order quote';
  end if;

  select coalesce(sum(allocation.allocated_litres), 0), count(*)
  into already_allocated_litres, already_allocated_count
  from public.fuel_container_allocations allocation
  where allocation.order_id = new.order_id
    and allocation.status <> 'cancelled'
    and allocation.id is distinct from new.id;

  if already_allocated_count >= snapshot_record.container_count
     or already_allocated_litres + new.allocated_litres > snapshot_record.requested_litres then
    raise exception using errcode = '23514', message = 'container allocations exceed the quoted container count or fuel quantity';
  end if;

  return new;
end;
$;

create or replace function public.set_fuel_product_status(
  target_product_key text,
  target_status text,
  target_reason text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  product_record public.fuel_products%rowtype;
  existing_event public.fuel_product_events%rowtype;
begin
  if auth.role() <> 'service_role' and not public.can_manage_fuel_platform() then
    raise exception using errcode = '42501', message = 'platform fuel management permission is required';
  end if;

  if target_product_key not in ('fuel.pms', 'fuel.ago', 'fuel.dpk') then
    raise exception using errcode = '22023', message = 'a supported fuel product key is required';
  end if;

  if target_status is null or target_status not in ('disabled', 'enabled', 'paused', 'retired') then
    raise exception using errcode = '22023', message = 'target_status is not supported';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception using errcode = '22023', message = 'target_idempotency_key is required';
  end if;

  select * into existing_event
  from public.fuel_product_events
  where idempotency_key = target_idempotency_key;

  if found then
    if existing_event.to_status <> target_status
       or not exists (
         select 1 from public.fuel_products
         where id = existing_event.fuel_product_id
           and key = target_product_key
       ) then
      raise exception using errcode = '23505', message = 'idempotency key was already used for another fuel product change';
    end if;
    return existing_event.fuel_product_id;
  end if;

  select * into product_record
  from public.fuel_products
  where key = target_product_key
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'fuel product was not found';
  end if;

  if target_status = 'enabled' and not exists (
    select 1 from public.business_modules
    where key = 'fuel' and status = 'active'
  ) then
    raise exception using errcode = '55000', message = 'the Fuel business module must be activated before enabling a product';
  end if;

  update public.fuel_products
  set status = target_status,
      updated_by = auth.uid(),
      updated_at = timezone('utc', now())
  where id = product_record.id;

  insert into public.fuel_product_events (
    fuel_product_id,
    from_status,
    to_status,
    reason,
    idempotency_key,
    actor_user_id,
    metadata
  )
  values (
    product_record.id,
    product_record.status,
    target_status,
    nullif(btrim(target_reason), ''),
    target_idempotency_key,
    auth.uid(),
    jsonb_build_object('product_key', target_product_key)
  );

  return product_record.id;
end;
$$;

-- All fuel tables are protected by RLS. User-facing writes will go through
-- permission-checked API/RPC operations, not arbitrary direct table mutation.
alter table public.fuel_products enable row level security;
alter table public.fuel_product_events enable row level security;
alter table public.fuel_container_types enable row level security;
alter table public.fuel_container_profiles enable row level security;
alter table public.fuel_station_storage_units enable row level security;
alter table public.fuel_station_stock_movements enable row level security;
alter table public.fuel_order_stock_reservations enable row level security;
alter table public.fuel_container_allocations enable row level security;
alter table public.fuel_container_custody_events enable row level security;
alter table public.fuel_order_commercial_snapshots enable row level security;

drop policy if exists fuel_products_read_enabled_or_admin on public.fuel_products;
create policy fuel_products_read_enabled_or_admin
on public.fuel_products for select to authenticated
using (status = 'enabled' or public.can_manage_fuel_platform());

drop policy if exists fuel_product_events_admin_read on public.fuel_product_events;
create policy fuel_product_events_admin_read
on public.fuel_product_events for select to authenticated
using (public.can_manage_fuel_platform());

drop policy if exists fuel_container_types_read_active_or_admin on public.fuel_container_types;
create policy fuel_container_types_read_active_or_admin
on public.fuel_container_types for select to authenticated
using (status = 'active' or public.can_manage_fuel_platform());

drop policy if exists fuel_container_profiles_read_accessible on public.fuel_container_profiles;
create policy fuel_container_profiles_read_accessible
on public.fuel_container_profiles for select to authenticated
using (
  public.can_manage_fuel_platform()
  or exists (
    select 1
    from public.assets asset_record
    where asset_record.id = asset_id
      and (
        asset_record.owner_user_id = auth.uid()
        or (asset_record.organization_id is not null and public.is_organization_member(asset_record.organization_id))
      )
  )
  or exists (
    select 1
    from public.fuel_container_allocations allocation
    where allocation.container_profile_id = id
      and public.can_read_fuel_order(allocation.order_id)
  )
);

drop policy if exists fuel_station_storage_units_read_branch on public.fuel_station_storage_units;
create policy fuel_station_storage_units_read_branch
on public.fuel_station_storage_units for select to authenticated
using (public.can_read_fuel_branch(branch_id));

drop policy if exists fuel_station_stock_movements_read_branch on public.fuel_station_stock_movements;
create policy fuel_station_stock_movements_read_branch
on public.fuel_station_stock_movements for select to authenticated
using (
  exists (
    select 1 from public.fuel_station_storage_units storage_unit
    where storage_unit.id = storage_unit_id
      and public.can_read_fuel_branch(storage_unit.branch_id)
  )
);

drop policy if exists fuel_order_stock_reservations_read_order on public.fuel_order_stock_reservations;
create policy fuel_order_stock_reservations_read_order
on public.fuel_order_stock_reservations for select to authenticated
using (public.can_read_fuel_order(order_id));

drop policy if exists fuel_container_allocations_read_order on public.fuel_container_allocations;
create policy fuel_container_allocations_read_order
on public.fuel_container_allocations for select to authenticated
using (public.can_read_fuel_order(order_id));

drop policy if exists fuel_container_custody_events_read_order on public.fuel_container_custody_events;
create policy fuel_container_custody_events_read_order
on public.fuel_container_custody_events for select to authenticated
using (public.can_read_fuel_order(order_id));

drop policy if exists fuel_order_commercial_snapshots_read_order on public.fuel_order_commercial_snapshots;
create policy fuel_order_commercial_snapshots_read_order
on public.fuel_order_commercial_snapshots for select to authenticated
using (
  exists (
    select 1
    from public.service_requests request_record
    where request_record.id = service_request_id
      and (
        request_record.requester_user_id = auth.uid()
        or public.can_read_platform_runtime()
      )
  )
  or (order_id is not null and public.can_read_fuel_order(order_id))
);

-- Authenticated users can read rows allowed by policies. Writes are performed
-- by the authenticated API gateway/service role after application permission checks.
grant select on
  public.fuel_products,
  public.fuel_product_events,
  public.fuel_container_types,
  public.fuel_container_profiles,
  public.fuel_station_storage_units,
  public.fuel_station_stock_movements,
  public.fuel_order_stock_reservations,
  public.fuel_container_allocations,
  public.fuel_container_custody_events,
  public.fuel_order_commercial_snapshots
to authenticated, service_role;

drop trigger if exists fuel_products_set_updated_at on public.fuel_products;
create trigger fuel_products_set_updated_at
before update on public.fuel_products
for each row execute function public.set_updated_at();

drop trigger if exists fuel_products_audit on public.fuel_products;
create trigger fuel_products_audit
after insert or update or delete on public.fuel_products
for each row execute function public.record_table_audit();

drop trigger if exists fuel_container_types_set_updated_at on public.fuel_container_types;
create trigger fuel_container_types_set_updated_at
before update on public.fuel_container_types
for each row execute function public.set_updated_at();

drop trigger if exists fuel_container_types_audit on public.fuel_container_types;
create trigger fuel_container_types_audit
after insert or update or delete on public.fuel_container_types
for each row execute function public.record_table_audit();

drop trigger if exists fuel_container_profiles_set_updated_at on public.fuel_container_profiles;
create trigger fuel_container_profiles_set_updated_at
before update on public.fuel_container_profiles
for each row execute function public.set_updated_at();

drop trigger if exists fuel_container_profiles_validate_asset on public.fuel_container_profiles;
create trigger fuel_container_profiles_validate_asset
before insert or update on public.fuel_container_profiles
for each row execute function public.validate_fuel_container_asset();

drop trigger if exists fuel_station_storage_units_validate_scope on public.fuel_station_storage_units;
create trigger fuel_station_storage_units_validate_scope
before insert or update on public.fuel_station_storage_units
for each row execute function public.validate_fuel_station_storage_scope();

drop trigger if exists fuel_container_allocations_validate on public.fuel_container_allocations;
create trigger fuel_container_allocations_validate
before insert or update on public.fuel_container_allocations
for each row execute function public.validate_fuel_container_allocation();

drop trigger if exists fuel_container_profiles_audit on public.fuel_container_profiles;
create trigger fuel_container_profiles_audit
after insert or update or delete on public.fuel_container_profiles
for each row execute function public.record_table_audit();

drop trigger if exists fuel_station_storage_units_set_updated_at on public.fuel_station_storage_units;
create trigger fuel_station_storage_units_set_updated_at
before update on public.fuel_station_storage_units
for each row execute function public.set_updated_at();

drop trigger if exists fuel_station_storage_units_audit on public.fuel_station_storage_units;
create trigger fuel_station_storage_units_audit
after insert or update or delete on public.fuel_station_storage_units
for each row execute function public.record_table_audit();

drop trigger if exists fuel_station_stock_movements_immutable on public.fuel_station_stock_movements;
create trigger fuel_station_stock_movements_immutable
before update or delete on public.fuel_station_stock_movements
for each row execute function public.prevent_fuel_event_mutation();

drop trigger if exists fuel_container_custody_events_immutable on public.fuel_container_custody_events;
create trigger fuel_container_custody_events_immutable
before update or delete on public.fuel_container_custody_events
for each row execute function public.prevent_fuel_event_mutation();

drop trigger if exists fuel_product_events_immutable on public.fuel_product_events;
create trigger fuel_product_events_immutable
before update or delete on public.fuel_product_events
for each row execute function public.prevent_fuel_event_mutation();

drop trigger if exists fuel_order_stock_reservations_set_updated_at on public.fuel_order_stock_reservations;
create trigger fuel_order_stock_reservations_set_updated_at
before update on public.fuel_order_stock_reservations
for each row execute function public.set_updated_at();

drop trigger if exists fuel_order_stock_reservations_audit on public.fuel_order_stock_reservations;
create trigger fuel_order_stock_reservations_audit
after insert or update or delete on public.fuel_order_stock_reservations
for each row execute function public.record_table_audit();

drop trigger if exists fuel_container_allocations_set_updated_at on public.fuel_container_allocations;
create trigger fuel_container_allocations_set_updated_at
before update on public.fuel_container_allocations
for each row execute function public.set_updated_at();

drop trigger if exists fuel_container_allocations_audit on public.fuel_container_allocations;
create trigger fuel_container_allocations_audit
after insert or update or delete on public.fuel_container_allocations
for each row execute function public.record_table_audit();

drop trigger if exists fuel_order_commercial_snapshots_set_updated_at on public.fuel_order_commercial_snapshots;
create trigger fuel_order_commercial_snapshots_set_updated_at
before update on public.fuel_order_commercial_snapshots
for each row execute function public.set_updated_at();

drop trigger if exists fuel_order_commercial_snapshots_audit on public.fuel_order_commercial_snapshots;
create trigger fuel_order_commercial_snapshots_audit
after insert or update or delete on public.fuel_order_commercial_snapshots
for each row execute function public.record_table_audit();

revoke all on function public.can_manage_fuel_platform() from public;
revoke all on function public.can_read_fuel_branch(uuid) from public;
revoke all on function public.can_manage_fuel_branch(uuid) from public;
revoke all on function public.can_read_fuel_order(uuid) from public;
revoke all on function public.prevent_fuel_event_mutation() from public;
revoke all on function public.validate_fuel_container_asset() from public;
revoke all on function public.validate_fuel_station_storage_scope() from public;
revoke all on function public.validate_fuel_container_allocation() from public;
revoke all on function public.set_fuel_product_status(text, text, text, text) from public, anon;
grant execute on function public.can_manage_fuel_platform() to authenticated, service_role;
grant execute on function public.can_read_fuel_branch(uuid) to authenticated, service_role;
grant execute on function public.can_manage_fuel_branch(uuid) to authenticated, service_role;
grant execute on function public.can_read_fuel_order(uuid) to authenticated, service_role;
grant execute on function public.set_fuel_product_status(text, text, text, text) to authenticated, service_role;

commit;
