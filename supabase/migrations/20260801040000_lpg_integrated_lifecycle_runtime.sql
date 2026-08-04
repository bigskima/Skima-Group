begin;

insert into public.permissions (key, description, risk_level)
values
  ('lpg.config.read', 'Read LPG runtime configuration, policies, and cylinder profiles.', 'standard'),
  ('lpg.config.manage', 'Manage LPG runtime configuration, policies, and pricing.', 'critical'),
  ('lpg.orders.finance', 'Execute LPG order financial settlement, refunds, and commission workflows.', 'critical'),
  ('lpg.stations.scan', 'Perform branch-scoped LPG cylinder receipt, release, and inspection scans.', 'high'),
  ('lpg.stations.pump', 'Confirm branch-scoped LPG refill and pump-side inspection results.', 'high')
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    updated_at = timezone('utc', now());

select public.configure_platform_admin_role(
  'platform.lpg_operations_admin',
  'LPG Operations Admin',
  'Operates LPG cylinders, stations, orders, safety incidents, dispatch, verification, config, and financial closeout.',
  array[
    'platform.runtime.read',
    'platform.runtime.manage',
    'platform.dispatch.execute',
    'platform.tracking.manage',
    'platform.verification.manage',
    'platform.settlement.read',
    'platform.financial.manage',
    'platform.communications.manage',
    'lpg.config.read',
    'lpg.config.manage',
    'lpg.cylinders.read',
    'lpg.cylinders.manage',
    'lpg.orders.read',
    'lpg.orders.manage',
    'lpg.orders.finance',
    'lpg.stations.read',
    'lpg.stations.manage',
    'lpg.stations.scan',
    'lpg.stations.pump',
    'lpg.dispatch.execute',
    'lpg.safety.manage'
  ],
  '{"system_template":true,"category":"lpg"}'::jsonb,
  'active'
);

alter table public.media_assets
add column if not exists source text not null default 'platform.media_registry'
  check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$');

alter table public.media_assets
add column if not exists idempotency_key text;

alter table public.media_assets
add column if not exists asset_type_key text not null default 'media.generic'
  check (asset_type_key ~ '^[a-z][a-z0-9_.:-]{2,120}$');

create unique index if not exists media_assets_source_idempotency_unique
on public.media_assets (source, idempotency_key)
where idempotency_key is not null;

create table if not exists public.lpg_cylinder_type_profiles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  size_kg numeric(12, 3) not null check (size_kg > 0),
  max_capacity_kg numeric(12, 3) not null check (max_capacity_kg >= size_kg),
  refill_tolerance_kg numeric(12, 3) not null default 0 check (refill_tolerance_kg >= 0),
  status text not null default 'active'
    check (status in ('draft', 'active', 'retired')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  source text not null default 'lpg.config_seed'
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create table if not exists public.lpg_operation_policies (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  policy_kind text not null
    check (policy_kind in ('quote', 'dispatch', 'scan', 'tracking', 'refill', 'refund', 'settlement', 'notification', 'maps', 'config')),
  priority integer not null default 100 check (priority between 0 and 10000),
  policy jsonb not null default '{}'::jsonb
    check (jsonb_typeof(policy) = 'object'),
  status text not null default 'active'
    check (status in ('draft', 'active', 'retired')),
  source text not null default 'lpg.config_seed'
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create table if not exists public.lpg_station_role_presets (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  role_key text not null
    check (role_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  membership_type text not null default 'member'
    check (membership_type in ('owner', 'admin', 'member', 'viewer')),
  permission_keys text[] not null default '{}',
  status text not null default 'active'
    check (status in ('draft', 'active', 'retired')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  source text not null default 'lpg.config_seed'
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create table if not exists public.lpg_station_capacity_reservations (
  id uuid primary key default gen_random_uuid(),
  lpg_order_id uuid not null references public.lpg_refill_orders(id) on delete cascade,
  station_branch_id uuid not null references public.lpg_station_branches(id) on delete restrict,
  requested_kg numeric(12, 3) not null check (requested_kg > 0),
  reserved_kg numeric(12, 3) not null check (reserved_kg > 0),
  consumed_kg numeric(12, 3) not null default 0 check (consumed_kg >= 0),
  status text not null default 'reserved'
    check (status in ('reserved', 'consumed', 'released', 'cancelled', 'expired')),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  source text not null
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (lpg_order_id),
  unique (source, idempotency_key),
  check (consumed_kg <= reserved_kg)
);

create table if not exists public.lpg_order_financial_adjustments (
  id uuid primary key default gen_random_uuid(),
  lpg_order_id uuid not null references public.lpg_refill_orders(id) on delete cascade,
  adjustment_type text not null
    check (adjustment_type in ('underfill_refund', 'cancellation_refund', 'manual_refund', 'dispute_hold', 'overfill_blocked')),
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  amount numeric(28, 8) not null default 0 check (amount >= 0),
  transaction_id uuid references public.financial_transactions(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'posted', 'blocked', 'cancelled')),
  reason_key text
    check (reason_key is null or reason_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  source text not null
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create table if not exists public.lpg_cylinder_inspections (
  id uuid primary key default gen_random_uuid(),
  lpg_order_id uuid references public.lpg_refill_orders(id) on delete cascade,
  cylinder_id uuid not null references public.lpg_cylinders(id) on delete restrict,
  station_branch_id uuid references public.lpg_station_branches(id) on delete set null,
  inspected_by_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  verification_event_id uuid references public.verification_events(id) on delete set null,
  result text not null
    check (result in ('safe', 'unsafe', 'manual_review', 'rejected')),
  evidence_media_asset_ids uuid[] not null default array[]::uuid[],
  observations jsonb not null default '{}'::jsonb
    check (jsonb_typeof(observations) = 'object'),
  source text not null
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create table if not exists public.lpg_order_action_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  from_statuses text[] not null,
  to_status text,
  actor_scope text not null default 'any'
    check (actor_scope in ('customer', 'assigned_driver', 'station_scanner', 'station_pump', 'station_finance', 'station_ops', 'lpg_admin', 'system', 'any')),
  event_type text not null,
  requires_verified_challenge boolean not null default false,
  status text not null default 'active'
    check (status in ('draft', 'active', 'retired')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  source text not null default 'lpg.config_seed'
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

alter table public.lpg_cylinders
add column if not exists cylinder_type_profile_id uuid references public.lpg_cylinder_type_profiles(id) on delete set null;

alter table public.lpg_cylinders
add column if not exists ownership_proof_media_asset_id uuid references public.media_assets(id) on delete set null;

alter table public.lpg_refill_orders
add column if not exists order_record_id uuid references public.order_records(id) on delete set null;

alter table public.lpg_refill_orders
add column if not exists station_settlement_execution_id uuid references public.settlement_executions(id) on delete set null;

alter table public.lpg_refill_orders
add column if not exists station_settlement_statement_id uuid references public.settlement_statements(id) on delete set null;

alter table public.lpg_refill_orders
add column if not exists driver_commission_execution_id uuid references public.commission_executions(id) on delete set null;

alter table public.lpg_refill_orders
add column if not exists underfill_refund_transaction_id uuid references public.financial_transactions(id) on delete set null;

alter table public.lpg_refill_orders
add column if not exists delivery_challenge_id uuid references public.otp_challenges(id) on delete set null;

create unique index if not exists lpg_refill_orders_order_record_unique
on public.lpg_refill_orders (order_record_id)
where order_record_id is not null;

create index if not exists lpg_capacity_reservations_station_status_idx
on public.lpg_station_capacity_reservations (station_branch_id, status, created_at desc);

create index if not exists lpg_financial_adjustments_order_idx
on public.lpg_order_financial_adjustments (lpg_order_id, created_at desc);

create index if not exists lpg_inspections_order_idx
on public.lpg_cylinder_inspections (lpg_order_id, created_at desc);

drop trigger if exists set_lpg_cylinder_type_profiles_updated_at on public.lpg_cylinder_type_profiles;
drop trigger if exists set_lpg_operation_policies_updated_at on public.lpg_operation_policies;
drop trigger if exists set_lpg_station_role_presets_updated_at on public.lpg_station_role_presets;
drop trigger if exists set_lpg_station_capacity_reservations_updated_at on public.lpg_station_capacity_reservations;
drop trigger if exists set_lpg_order_financial_adjustments_updated_at on public.lpg_order_financial_adjustments;
drop trigger if exists set_lpg_cylinder_inspections_updated_at on public.lpg_cylinder_inspections;
drop trigger if exists set_lpg_order_action_definitions_updated_at on public.lpg_order_action_definitions;

create trigger set_lpg_cylinder_type_profiles_updated_at
before update on public.lpg_cylinder_type_profiles
for each row execute function public.set_updated_at();

create trigger set_lpg_operation_policies_updated_at
before update on public.lpg_operation_policies
for each row execute function public.set_updated_at();

create trigger set_lpg_station_role_presets_updated_at
before update on public.lpg_station_role_presets
for each row execute function public.set_updated_at();

create trigger set_lpg_station_capacity_reservations_updated_at
before update on public.lpg_station_capacity_reservations
for each row execute function public.set_updated_at();

create trigger set_lpg_order_financial_adjustments_updated_at
before update on public.lpg_order_financial_adjustments
for each row execute function public.set_updated_at();

create trigger set_lpg_cylinder_inspections_updated_at
before update on public.lpg_cylinder_inspections
for each row execute function public.set_updated_at();

create trigger set_lpg_order_action_definitions_updated_at
before update on public.lpg_order_action_definitions
for each row execute function public.set_updated_at();

insert into public.lpg_cylinder_type_profiles (
  key,
  display_name,
  size_kg,
  max_capacity_kg,
  refill_tolerance_kg,
  metadata,
  source,
  idempotency_key
)
values
  ('lpg.cylinder.3kg.phase_one', '3 kg LPG Cylinder', 3, 3, 0.05, '{"phase":"one"}'::jsonb, 'lpg.config_seed', 'cylinder-type-3kg-v1'),
  ('lpg.cylinder.6kg.phase_one', '6 kg LPG Cylinder', 6, 6, 0.05, '{"phase":"one"}'::jsonb, 'lpg.config_seed', 'cylinder-type-6kg-v1'),
  ('lpg.cylinder.12_5kg.phase_one', '12.5 kg LPG Cylinder', 12.5, 12.5, 0.05, '{"phase":"one"}'::jsonb, 'lpg.config_seed', 'cylinder-type-12-5kg-v1'),
  ('lpg.cylinder.25kg.phase_one', '25 kg LPG Cylinder', 25, 25, 0.1, '{"phase":"one"}'::jsonb, 'lpg.config_seed', 'cylinder-type-25kg-v1'),
  ('lpg.cylinder.50kg.phase_one', '50 kg LPG Cylinder', 50, 50, 0.1, '{"phase":"one"}'::jsonb, 'lpg.config_seed', 'cylinder-type-50kg-v1')
on conflict (key) do update
set display_name = excluded.display_name,
    size_kg = excluded.size_kg,
    max_capacity_kg = excluded.max_capacity_kg,
    refill_tolerance_kg = excluded.refill_tolerance_kg,
    status = 'active',
    metadata = public.lpg_cylinder_type_profiles.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

insert into public.lpg_operation_policies (
  key,
  display_name,
  policy_kind,
  policy,
  metadata,
  source,
  idempotency_key
)
values
  (
    'lpg.quote.phase_one',
    'LPG Phase One Quote Policy',
    'quote',
    '{"currency_code":"NGN","quote_expiry_seconds":900,"pricing_policy_key":"pricing.lpg.fixed.v1","settlement_policy_key":"settlement.lpg.escrow.station-driver.v1","dispatch_policy_key":"dispatch.lpg.nearest-qualified-driver.v1"}'::jsonb,
    '{"phase":"one"}'::jsonb,
    'lpg.config_seed',
    'policy-quote-phase-one-v1'
  ),
  (
    'lpg.dispatch.phase_one',
    'LPG Phase One Dispatch Policy',
    'dispatch',
    '{"candidate_limit":5,"driver_location_freshness_seconds":1800,"max_driver_distance_meters":20000,"offer_ttl_seconds":600,"required_driver_capabilities":["capability.driver.cylinder-handling"],"required_vehicle_capabilities":["capability.cargo.pressurized-cylinder"],"capacity_reservation_ttl_seconds":3600}'::jsonb,
    '{"phase":"one"}'::jsonb,
    'lpg.config_seed',
    'policy-dispatch-phase-one-v1'
  ),
  (
    'lpg.scan.phase_one',
    'LPG Phase One Scan Policy',
    'scan',
    '{"delivery_challenge_required":true,"delivery_challenge_ttl_seconds":600,"station_scan_permission":"lpg.stations.scan","station_pump_permission":"lpg.stations.pump","driver_pickup_required":true}'::jsonb,
    '{"phase":"one"}'::jsonb,
    'lpg.config_seed',
    'policy-scan-phase-one-v1'
  ),
  (
    'lpg.tracking.phase_one',
    'LPG Phase One Tracking Policy',
    'tracking',
    '{"freshness_seconds":300,"record_generic_points":true,"start_on_driver_acceptance":true}'::jsonb,
    '{"phase":"one"}'::jsonb,
    'lpg.config_seed',
    'policy-tracking-phase-one-v1'
  ),
  (
    'lpg.refill.phase_one',
    'LPG Phase One Refill Policy',
    'refill',
    '{"underfill_tolerance_kg":0.001,"overfill_tolerance_kg":0,"overfill_behavior":"manual_review","unsafe_result_blocks_refill":true}'::jsonb,
    '{"phase":"one"}'::jsonb,
    'lpg.config_seed',
    'policy-refill-phase-one-v1'
  ),
  (
    'lpg.refund.phase_one',
    'LPG Phase One Refund Policy',
    'refund',
    '{"underfill_refund_mode":"automatic","cancellation_refund_mode":"remaining_escrow","refund_wallet_type":"customer"}'::jsonb,
    '{"phase":"one"}'::jsonb,
    'lpg.config_seed',
    'policy-refund-phase-one-v1'
  ),
  (
    'lpg.settlement.phase_one',
    'LPG Phase One Settlement Policy',
    'settlement',
    '{"driver_commission_policy_key":"commission.lpg.driver.exact.v1","station_gets_actual_refill_amount":true,"platform_gets_platform_fee_tax_and_delivery_margin":true,"overfill_behavior":"manual_review"}'::jsonb,
    '{"phase":"one"}'::jsonb,
    'lpg.config_seed',
    'policy-settlement-phase-one-v1'
  ),
  (
    'lpg.notification.phase_one',
    'LPG Phase One Notification Policy',
    'notification',
    '{"channel":"in_app","provider_adapter_key":"provider.communication.sandbox","notify_statuses":["payment_reserved","driver_offered","driver_accepted","pickup_verified","station_verified","refill_confirmed","station_settled","delivery_verification_pending","delivered","completed","refunded","disputed"]}'::jsonb,
    '{"phase":"one"}'::jsonb,
    'lpg.config_seed',
    'policy-notification-phase-one-v1'
  ),
  (
    'lpg.maps.phase_one',
    'LPG Phase One Maps Adapter Policy',
    'maps',
    '{"active_provider_key":"provider.maps.sandbox","sandbox_enabled":true,"operations":["geocode","reverse_geocode","route_estimate","autocomplete"]}'::jsonb,
    '{"phase":"one"}'::jsonb,
    'lpg.config_seed',
    'policy-maps-phase-one-v1'
  )
on conflict (key) do update
set display_name = excluded.display_name,
    policy_kind = excluded.policy_kind,
    policy = excluded.policy,
    status = 'active',
    metadata = public.lpg_operation_policies.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

insert into public.lpg_station_role_presets (
  key,
  display_name,
  role_key,
  membership_type,
  permission_keys,
  metadata,
  source,
  idempotency_key
)
values
  ('lpg.station.owner', 'LPG Station Owner', 'lpg.station.owner', 'owner', array['lpg.config.read','lpg.cylinders.read','lpg.orders.read','lpg.orders.manage','lpg.orders.finance','lpg.stations.read','lpg.stations.manage','lpg.stations.scan','lpg.stations.pump','lpg.safety.manage','business.staff.manage','business.orders.read','business.orders.process','business.orders.manage','business.finance.read','business.settlements.read'], '{"preset":"owner"}'::jsonb, 'lpg.config_seed', 'station-role-owner-v1'),
  ('lpg.station.admin', 'LPG Station Admin', 'lpg.station.admin', 'admin', array['lpg.config.read','lpg.cylinders.read','lpg.orders.read','lpg.orders.manage','lpg.orders.finance','lpg.stations.read','lpg.stations.manage','lpg.stations.scan','lpg.stations.pump','lpg.safety.manage','business.staff.manage','business.orders.read','business.orders.process','business.finance.read','business.settlements.read'], '{"preset":"admin"}'::jsonb, 'lpg.config_seed', 'station-role-admin-v1'),
  ('lpg.station.operations', 'LPG Station Operations', 'lpg.station.operations', 'member', array['lpg.config.read','lpg.cylinders.read','lpg.orders.read','lpg.orders.manage','lpg.stations.read','lpg.stations.scan','lpg.stations.pump','lpg.safety.manage','business.orders.read','business.orders.process'], '{"preset":"operations"}'::jsonb, 'lpg.config_seed', 'station-role-operations-v1'),
  ('lpg.station.finance', 'LPG Station Finance', 'lpg.station.finance', 'member', array['lpg.config.read','lpg.orders.read','lpg.orders.finance','lpg.stations.read','business.finance.read','business.settlements.read'], '{"preset":"finance"}'::jsonb, 'lpg.config_seed', 'station-role-finance-v1'),
  ('lpg.station.pump', 'LPG Station Pump Operator', 'lpg.station.pump', 'member', array['lpg.config.read','lpg.cylinders.read','lpg.orders.read','lpg.stations.read','lpg.stations.pump','lpg.stations.scan'], '{"preset":"pump"}'::jsonb, 'lpg.config_seed', 'station-role-pump-v1'),
  ('lpg.station.scanner', 'LPG Station Scanner', 'lpg.station.scanner', 'member', array['lpg.config.read','lpg.cylinders.read','lpg.orders.read','lpg.stations.read','lpg.stations.scan'], '{"preset":"scanner"}'::jsonb, 'lpg.config_seed', 'station-role-scanner-v1'),
  ('lpg.station.viewer', 'LPG Station Viewer', 'lpg.station.viewer', 'viewer', array['lpg.config.read','lpg.cylinders.read','lpg.orders.read','lpg.stations.read','business.orders.read'], '{"preset":"viewer"}'::jsonb, 'lpg.config_seed', 'station-role-viewer-v1')
on conflict (key) do update
set display_name = excluded.display_name,
    role_key = excluded.role_key,
    membership_type = excluded.membership_type,
    permission_keys = excluded.permission_keys,
    status = 'active',
    metadata = public.lpg_station_role_presets.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

insert into public.lpg_order_action_definitions (
  key,
  display_name,
  from_statuses,
  to_status,
  actor_scope,
  event_type,
  requires_verified_challenge,
  metadata,
  source,
  idempotency_key
)
values
  ('lpg.pickup.start', 'Start LPG Pickup', array['driver_accepted'], 'pickup_en_route', 'assigned_driver', 'lpg.order.pickup_started', false, '{"phase":"one"}'::jsonb, 'lpg.config_seed', 'action-pickup-start-v1'),
  ('lpg.station.start', 'Start LPG Station Transit', array['pickup_verified'], 'station_en_route', 'assigned_driver', 'lpg.order.station_transit_started', false, '{"phase":"one"}'::jsonb, 'lpg.config_seed', 'action-station-start-v1'),
  ('lpg.refill.start', 'Start LPG Refill', array['station_verified'], 'refill_in_progress', 'station_pump', 'lpg.order.refill_started', false, '{"phase":"one"}'::jsonb, 'lpg.config_seed', 'action-refill-start-v1'),
  ('lpg.return.start', 'Start LPG Return', array['refill_confirmed','station_settled'], 'return_en_route', 'assigned_driver', 'lpg.order.return_started', false, '{"phase":"one"}'::jsonb, 'lpg.config_seed', 'action-return-start-v1'),
  ('lpg.delivery.pending', 'Request LPG Delivery Verification', array['return_en_route'], 'delivery_verification_pending', 'assigned_driver', 'lpg.order.delivery_pending', false, '{"phase":"one"}'::jsonb, 'lpg.config_seed', 'action-delivery-pending-v1'),
  ('lpg.complete', 'Complete LPG Order', array['delivered'], 'completed', 'system', 'lpg.order.completed', false, '{"phase":"one"}'::jsonb, 'lpg.config_seed', 'action-complete-v1'),
  ('lpg.cancel', 'Cancel LPG Order', array['awaiting_payment','payment_reserved','matching_station','matching_driver','driver_offered','driver_accepted','pickup_en_route'], 'cancelled', 'customer', 'lpg.order.cancelled', false, '{"phase":"one"}'::jsonb, 'lpg.config_seed', 'action-cancel-v1')
on conflict (key) do update
set display_name = excluded.display_name,
    from_statuses = excluded.from_statuses,
    to_status = excluded.to_status,
    actor_scope = excluded.actor_scope,
    event_type = excluded.event_type,
    requires_verified_challenge = excluded.requires_verified_challenge,
    status = 'active',
    metadata = public.lpg_order_action_definitions.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

insert into public.commission_policies (
  key,
  display_name,
  scope_type,
  calculation_mode,
  fixed_amount,
  percentage_rate,
  currency_code,
  trigger_event_key,
  status,
  metadata
)
values (
  'commission.lpg.driver.exact.v1',
  'LPG Exact Driver Commission',
  'global',
  'percentage',
  0,
  100,
  'NGN',
  'event.delivery.completed',
  'active',
  '{"bounded_context":"lpg","uses_target_base_amount":true,"phase":"one"}'::jsonb
)
on conflict do nothing;

update public.commission_policies
set display_name = 'LPG Exact Driver Commission',
    calculation_mode = 'percentage',
    fixed_amount = 0,
    percentage_rate = 100,
    currency_code = 'NGN',
    trigger_event_key = 'event.delivery.completed',
    status = 'active',
    metadata = metadata || '{"bounded_context":"lpg","uses_target_base_amount":true,"phase":"one"}'::jsonb,
    updated_at = timezone('utc', now())
where key = 'commission.lpg.driver.exact.v1'
  and scope_type = 'global'
  and scope_id is null;

create or replace function public.lpg_policy_config(target_policy_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  policy_record record;
begin
  if target_policy_key is null or target_policy_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_policy_key must be a valid platform key';
  end if;

  select policy.*
  into policy_record
  from public.lpg_operation_policies policy
  where policy.key = target_policy_key
    and policy.status = 'active'
  order by policy.priority asc, policy.updated_at desc
  limit 1;

  if not found then
    raise exception 'active LPG operation policy is required: %', target_policy_key;
  end if;

  return policy_record.policy;
end;
$$;

create or replace function public.user_has_permission_for_branch(
  target_user_id uuid,
  target_permission text,
  target_organization_id uuid,
  target_branch_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles assigned_role
    join public.roles role_record on role_record.id = assigned_role.role_id
    join public.role_permissions role_permission on role_permission.role_id = role_record.id
    join public.permissions permission_record on permission_record.id = role_permission.permission_id
    join public.organization_memberships membership
      on membership.organization_id = assigned_role.organization_id
      and membership.user_id = assigned_role.user_id
      and membership.status = 'active'
    where assigned_role.user_id = target_user_id
      and assigned_role.organization_id = target_organization_id
      and assigned_role.status = 'active'
      and role_record.organization_id = target_organization_id
      and role_record.status = 'active'
      and permission_record.key = target_permission
      and (assigned_role.ends_at is null or assigned_role.ends_at > timezone('utc', now()))
      and (
        target_branch_id is null
        or assigned_role.branch_id is null
        or assigned_role.branch_id = target_branch_id
      )
  );
$$;

create or replace function public.user_can_operate_lpg_station_branch(
  target_user_id uuid,
  target_station_branch_id uuid,
  target_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.lpg_station_branches station
    where station.id = target_station_branch_id
      and (
        public.user_has_permission_for_branch(
          target_user_id,
          target_permission_key,
          station.organization_id,
          station.branch_id
        )
        or public.user_has_permission_for_branch(
          target_user_id,
          'lpg.stations.manage',
          station.organization_id,
          station.branch_id
        )
        or public.user_has_permission_for_branch(
          target_user_id,
          'lpg.orders.manage',
          station.organization_id,
          station.branch_id
        )
      )
  );
$$;

create or replace function public.can_operate_lpg_station_branch(
  target_station_branch_id uuid,
  target_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or public.can_manage_lpg_operations()
    or public.user_can_operate_lpg_station_branch(auth.uid(), target_station_branch_id, target_permission_key);
$$;

create or replace function public.read_lpg_runtime_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role'
    and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  return jsonb_build_object(
    'cylinderTypeProfiles',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', profile.id,
          'key', profile.key,
          'displayName', profile.display_name,
          'sizeKg', profile.size_kg,
          'maxCapacityKg', profile.max_capacity_kg,
          'refillToleranceKg', profile.refill_tolerance_kg,
          'status', profile.status,
          'metadata', profile.metadata
        )
        order by profile.size_kg asc
      )
      from public.lpg_cylinder_type_profiles profile
      where profile.status = 'active'
    ), '[]'::jsonb),
    'policies',
    coalesce((
      select jsonb_object_agg(
        policy.key,
        jsonb_build_object(
          'kind', policy.policy_kind,
          'displayName', policy.display_name,
          'policy', policy.policy,
          'metadata', policy.metadata
        )
      )
      from public.lpg_operation_policies policy
      where policy.status = 'active'
    ), '{}'::jsonb),
    'stationRolePresets',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'key', preset.key,
          'displayName', preset.display_name,
          'roleKey', preset.role_key,
          'membershipType', preset.membership_type,
          'permissionKeys', preset.permission_keys,
          'metadata', preset.metadata
        )
        order by preset.key
      )
      from public.lpg_station_role_presets preset
      where preset.status = 'active'
    ), '[]'::jsonb),
    'pricing',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', pricing.id,
          'stationBranchId', pricing.station_branch_id,
          'currencyCode', pricing.currency_code,
          'pricePerKg', pricing.price_per_kg,
          'deliveryBaseFee', pricing.delivery_base_fee,
          'platformFeeAmount', pricing.platform_fee_amount,
          'taxRatePercent', pricing.tax_rate_percent,
          'driverCommissionAmount', pricing.driver_commission_amount,
          'minKg', pricing.min_kg,
          'maxKg', pricing.max_kg,
          'status', pricing.status
        )
        order by pricing.station_branch_id nulls last, pricing.effective_from desc
      )
      from public.lpg_refill_pricing pricing
      where pricing.status = 'active'
        and pricing.effective_from <= timezone('utc', now())
        and (pricing.effective_until is null or pricing.effective_until > timezone('utc', now()))
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.configure_lpg_operation_policy(
  target_policy_key text,
  target_display_name text,
  target_policy_kind text,
  target_policy jsonb,
  target_idempotency_key text,
  target_priority integer default 100,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'lpg.config_api'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  policy_id uuid;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('lpg.config.manage', null)
    and not public.can_manage_lpg_operations() then
    raise exception 'LPG configuration management permission is required';
  end if;

  if target_policy_key is null or target_policy_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_policy_key must be a valid platform key';
  end if;

  if target_display_name is null or btrim(target_display_name) = '' then
    raise exception 'target_display_name is required';
  end if;

  if target_policy_kind not in ('quote', 'dispatch', 'scan', 'tracking', 'refill', 'refund', 'settlement', 'notification', 'maps', 'config') then
    raise exception 'target_policy_kind is not supported';
  end if;

  if target_policy is null or jsonb_typeof(target_policy) <> 'object'
    or target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'policy JSON inputs must be objects';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  insert into public.lpg_operation_policies (
    key,
    display_name,
    policy_kind,
    priority,
    policy,
    metadata,
    source,
    idempotency_key
  )
  values (
    target_policy_key,
    btrim(target_display_name),
    target_policy_kind,
    coalesce(target_priority, 100),
    target_policy,
    target_metadata,
    target_source,
    target_idempotency_key
  )
  on conflict (key) do update
  set display_name = excluded.display_name,
      policy_kind = excluded.policy_kind,
      priority = excluded.priority,
      policy = excluded.policy,
      status = 'active',
      metadata = public.lpg_operation_policies.metadata || excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into policy_id;

  return policy_id;
end;
$$;

create or replace function public.configure_lpg_cylinder_type_profile(
  target_key text,
  target_display_name text,
  target_size_kg numeric,
  target_max_capacity_kg numeric,
  target_idempotency_key text,
  target_refill_tolerance_kg numeric default 0,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'lpg.config_api'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_id uuid;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('lpg.config.manage', null)
    and not public.can_manage_lpg_operations() then
    raise exception 'LPG configuration management permission is required';
  end if;

  if target_key is null or target_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_key must be a valid platform key';
  end if;

  if target_display_name is null or btrim(target_display_name) = '' then
    raise exception 'target_display_name is required';
  end if;

  if target_size_kg is null or target_size_kg <= 0 then
    raise exception 'target_size_kg must be greater than zero';
  end if;

  if target_max_capacity_kg is null or target_max_capacity_kg < target_size_kg then
    raise exception 'target_max_capacity_kg must be at least target_size_kg';
  end if;

  if coalesce(target_refill_tolerance_kg, 0) < 0 then
    raise exception 'target_refill_tolerance_kg must be greater than or equal to zero';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  insert into public.lpg_cylinder_type_profiles (
    key,
    display_name,
    size_kg,
    max_capacity_kg,
    refill_tolerance_kg,
    metadata,
    source,
    idempotency_key
  )
  values (
    target_key,
    btrim(target_display_name),
    target_size_kg,
    target_max_capacity_kg,
    coalesce(target_refill_tolerance_kg, 0),
    target_metadata,
    target_source,
    target_idempotency_key
  )
  on conflict (key) do update
  set display_name = excluded.display_name,
      size_kg = excluded.size_kg,
      max_capacity_kg = excluded.max_capacity_kg,
      refill_tolerance_kg = excluded.refill_tolerance_kg,
      status = 'active',
      metadata = public.lpg_cylinder_type_profiles.metadata || excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into profile_id;

  return profile_id;
end;
$$;

create or replace function public.configure_lpg_refill_pricing(
  target_station_branch_id uuid,
  target_currency_code text,
  target_price_per_kg numeric,
  target_delivery_base_fee numeric,
  target_platform_fee_amount numeric,
  target_tax_rate_percent numeric,
  target_driver_commission_amount numeric,
  target_min_kg numeric,
  target_max_kg numeric,
  target_idempotency_key text,
  target_effective_from timestamptz default timezone('utc', now()),
  target_effective_until timestamptz default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'lpg.pricing_api'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pricing_id uuid;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('lpg.config.manage', null)
    and not public.can_manage_lpg_operations()
    and (
      target_station_branch_id is null
      or not public.can_operate_lpg_station_branch(target_station_branch_id, 'lpg.stations.manage')
    ) then
    raise exception 'LPG pricing management permission is required';
  end if;

  if target_currency_code is null or target_currency_code !~ '^[A-Z0-9]{3,12}$' then
    raise exception 'target_currency_code must be a valid currency code';
  end if;

  if target_price_per_kg is null or target_price_per_kg <= 0 then
    raise exception 'target_price_per_kg must be greater than zero';
  end if;

  if coalesce(target_delivery_base_fee, 0) < 0
    or coalesce(target_platform_fee_amount, 0) < 0
    or coalesce(target_tax_rate_percent, 0) < 0
    or coalesce(target_driver_commission_amount, 0) < 0 then
    raise exception 'price components must be greater than or equal to zero';
  end if;

  if coalesce(target_driver_commission_amount, 0) > coalesce(target_delivery_base_fee, 0) then
    raise exception 'driver commission cannot exceed delivery base fee in phase one';
  end if;

  if target_min_kg is null or target_min_kg <= 0
    or target_max_kg is null or target_max_kg < target_min_kg then
    raise exception 'target_min_kg and target_max_kg are invalid';
  end if;

  if target_effective_until is not null
    and target_effective_until <= coalesce(target_effective_from, timezone('utc', now())) then
    raise exception 'target_effective_until must be after target_effective_from';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  insert into public.lpg_refill_pricing (
    station_branch_id,
    currency_code,
    price_per_kg,
    delivery_base_fee,
    platform_fee_amount,
    tax_rate_percent,
    driver_commission_amount,
    min_kg,
    max_kg,
    effective_from,
    effective_until,
    metadata,
    source,
    idempotency_key
  )
  values (
    target_station_branch_id,
    target_currency_code,
    target_price_per_kg,
    coalesce(target_delivery_base_fee, 0),
    coalesce(target_platform_fee_amount, 0),
    coalesce(target_tax_rate_percent, 0),
    coalesce(target_driver_commission_amount, 0),
    target_min_kg,
    target_max_kg,
    coalesce(target_effective_from, timezone('utc', now())),
    target_effective_until,
    target_metadata,
    target_source,
    target_idempotency_key
  )
  on conflict (source, idempotency_key) do update
  set station_branch_id = excluded.station_branch_id,
      currency_code = excluded.currency_code,
      price_per_kg = excluded.price_per_kg,
      delivery_base_fee = excluded.delivery_base_fee,
      platform_fee_amount = excluded.platform_fee_amount,
      tax_rate_percent = excluded.tax_rate_percent,
      driver_commission_amount = excluded.driver_commission_amount,
      min_kg = excluded.min_kg,
      max_kg = excluded.max_kg,
      effective_from = excluded.effective_from,
      effective_until = excluded.effective_until,
      status = 'active',
      metadata = public.lpg_refill_pricing.metadata || excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into pricing_id;

  return pricing_id;
end;
$$;

create or replace function public.register_media_asset(
  target_storage_bucket text,
  target_storage_path text,
  target_content_type text,
  target_byte_size bigint,
  target_idempotency_key text,
  target_checksum text default null,
  target_owner_user_id uuid default null,
  target_organization_id uuid default null,
  target_asset_type_key text default 'media.generic',
  target_status text default 'active',
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'platform.media_registry'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  media_id uuid;
  resolved_owner_user_id uuid;
  existing_record record;
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  if target_storage_bucket is null
    or target_storage_bucket not in ('skima-platform-documents', 'skima-platform-media') then
    raise exception 'target_storage_bucket must reference an approved platform storage bucket';
  end if;

  if target_storage_path is null or char_length(btrim(target_storage_path)) < 3 then
    raise exception 'target_storage_path is required';
  end if;

  if target_byte_size is not null and target_byte_size < 0 then
    raise exception 'target_byte_size must be greater than or equal to zero';
  end if;

  if target_status not in ('pending', 'active', 'quarantined', 'deleted') then
    raise exception 'target_status is not supported';
  end if;

  if target_asset_type_key is null or target_asset_type_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_asset_type_key must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  resolved_owner_user_id := coalesce(target_owner_user_id, auth.uid());

  if auth.role() <> 'service_role'
    and resolved_owner_user_id is distinct from auth.uid()
    and not public.has_permission('platform.documents.manage', null) then
    raise exception 'media owner must be the authenticated user';
  end if;

  if auth.role() <> 'service_role'
    and target_organization_id is not null
    and not public.is_organization_member(target_organization_id)
    and not public.has_permission('platform.documents.manage', null) then
    raise exception 'media organization must be accessible to the authenticated user';
  end if;

  if auth.role() <> 'service_role'
    and split_part(target_storage_path, '/', 1) <> auth.uid()::text
    and not public.has_permission('platform.documents.manage', null) then
    raise exception 'media storage paths must be scoped under the authenticated user';
  end if;

  insert into public.media_assets (
    organization_id,
    owner_user_id,
    storage_bucket,
    storage_path,
    content_type,
    byte_size,
    checksum,
    status,
    metadata,
    source,
    idempotency_key,
    asset_type_key
  )
  values (
    target_organization_id,
    resolved_owner_user_id,
    target_storage_bucket,
    btrim(target_storage_path),
    target_content_type,
    target_byte_size,
    target_checksum,
    target_status,
    target_metadata,
    target_source,
    target_idempotency_key,
    target_asset_type_key
  )
  on conflict (source, idempotency_key)
  where idempotency_key is not null
  do nothing
  returning id into media_id;

  if media_id is null then
    select existing.*
    into existing_record
    from public.media_assets existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'media asset idempotency lookup failed';
    end if;

    if existing_record.storage_bucket <> target_storage_bucket
      or existing_record.storage_path <> btrim(target_storage_path)
      or existing_record.owner_user_id is distinct from resolved_owner_user_id
      or existing_record.organization_id is distinct from target_organization_id
      or existing_record.asset_type_key <> target_asset_type_key then
      raise exception 'target_idempotency_key has already been used with different media details';
    end if;

    return existing_record.id;
  end if;

  return media_id;
end;
$$;

create or replace function public.return_escrow_hold_amount(
  target_escrow_hold_id uuid,
  target_refund_wallet_id uuid,
  target_amount numeric,
  target_idempotency_key text,
  target_source text default 'platform.escrow_engine',
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hold_record record;
  refund_wallet record;
  remaining_amount numeric(28, 8);
  transaction_id uuid;
  existing_transaction record;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.escrow.execute', null)
    and not public.has_permission('platform.settlement.execute', null)
    and not public.can_execute_platform_runtime() then
    raise exception 'escrow execution permission is required';
  end if;

  if target_escrow_hold_id is null or target_refund_wallet_id is null then
    raise exception 'target_escrow_hold_id and target_refund_wallet_id are required';
  end if;

  if target_amount is null or target_amount <= 0 then
    raise exception 'target_amount must be greater than zero';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select existing.*
  into existing_transaction
  from public.financial_transactions existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key || ':financial';

  if found then
    return existing_transaction.id;
  end if;

  select hold.*
  into hold_record
  from public.escrow_holds hold
  where hold.id = target_escrow_hold_id
  for update;

  if not found then
    raise exception 'target_escrow_hold_id must reference an existing escrow hold';
  end if;

  if hold_record.status not in ('held', 'partially_released', 'disputed', 'expired') then
    raise exception 'escrow hold cannot be refunded from its current status';
  end if;

  remaining_amount := hold_record.hold_amount - hold_record.released_amount;

  if target_amount > remaining_amount then
    raise exception 'target_amount exceeds available escrow balance';
  end if;

  select wallet.*
  into refund_wallet
  from public.wallet_accounts wallet
  where wallet.id = target_refund_wallet_id
    and wallet.status = 'active'
    and wallet.currency_code = hold_record.currency_code;

  if not found then
    raise exception 'target_refund_wallet_id must reference an active wallet with matching currency';
  end if;

  transaction_id := public.post_financial_transaction(
    'refund',
    hold_record.currency_code,
    target_source,
    hold_record.subject_type,
    hold_record.subject_id,
    jsonb_build_array(
      jsonb_build_object(
        'wallet_id', hold_record.wallet_id,
        'direction', 'debit',
        'amount', target_amount,
        'entry_type', 'principal',
        'metadata', jsonb_build_object('role', 'escrow')
      ),
      jsonb_build_object(
        'wallet_id', target_refund_wallet_id,
        'direction', 'credit',
        'amount', target_amount,
        'entry_type', 'principal',
        'metadata', jsonb_build_object('role', 'refund')
      )
    ),
    target_idempotency_key || ':financial',
    null,
    null,
    jsonb_build_object('escrow_hold_id', hold_record.id),
    target_metadata
  );

  update public.escrow_holds
  set released_amount = released_amount + target_amount,
      status = case
        when released_amount + target_amount = hold_amount then 'refunded'
        else 'partially_released'
      end,
      updated_at = timezone('utc', now())
  where id = hold_record.id;

  if target_amount = remaining_amount then
    update public.service_requests
    set status = 'refunded',
        updated_at = timezone('utc', now())
    where escrow_hold_id = hold_record.id;
  end if;

  insert into public.service_request_events (
    service_request_id,
    status,
    idempotency_key,
    metadata
  )
  select
    request.id,
    case when target_amount = remaining_amount then 'refunded' else 'partially_refunded' end,
    target_idempotency_key,
    target_metadata || jsonb_build_object(
      'escrow_hold_id',
      hold_record.id,
      'transaction_id',
      transaction_id,
      'amount',
      target_amount
    )
  from public.service_requests request
  where request.escrow_hold_id = hold_record.id
  on conflict do nothing;

  return transaction_id;
end;
$$;

create or replace function public.assign_lpg_station_role(
  target_station_branch_id uuid,
  target_user_id uuid,
  target_preset_key text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  station_record record;
  preset_record record;
  resolved_role_id uuid;
  assigned_user_role_id uuid;
begin
  if target_station_branch_id is null or target_user_id is null then
    raise exception 'target_station_branch_id and target_user_id are required';
  end if;

  if target_preset_key is null or target_preset_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_preset_key must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select station.*
  into station_record
  from public.lpg_station_branches station
  where station.id = target_station_branch_id;

  if not found then
    raise exception 'target_station_branch_id must reference an LPG station branch';
  end if;

  if auth.role() <> 'service_role'
    and not public.can_operate_lpg_station_branch(target_station_branch_id, 'lpg.stations.manage')
    and not public.has_permission('business.staff.manage', station_record.organization_id) then
    raise exception 'station staff management permission is required';
  end if;

  select preset.*
  into preset_record
  from public.lpg_station_role_presets preset
  where preset.key = target_preset_key
    and preset.status = 'active';

  if not found then
    raise exception 'target_preset_key must reference an active LPG station role preset';
  end if;

  select role.id
  into resolved_role_id
  from public.roles role
  where role.organization_id = station_record.organization_id
    and role.key = preset_record.role_key
    and role.status = 'active';

  if not found then
    raise exception 'station role preset has not been configured for this organization';
  end if;

  insert into public.organization_memberships (
    organization_id,
    user_id,
    membership_type,
    status,
    metadata,
    created_by
  )
  values (
    station_record.organization_id,
    target_user_id,
    preset_record.membership_type,
    'active',
    target_metadata || jsonb_build_object(
      'station_branch_id',
      target_station_branch_id,
      'preset_key',
      target_preset_key
    ),
    auth.uid()
  )
  on conflict (organization_id, user_id) do update
  set membership_type = case
        when public.organization_memberships.membership_type = 'owner' then 'owner'
        else excluded.membership_type
      end,
      status = 'active',
      metadata = public.organization_memberships.metadata || excluded.metadata,
      updated_at = timezone('utc', now());

  insert into public.user_roles (
    organization_id,
    user_id,
    role_id,
    branch_id,
    status,
    created_by
  )
  values (
    station_record.organization_id,
    target_user_id,
    resolved_role_id,
    station_record.branch_id,
    'active',
    auth.uid()
  )
  on conflict (organization_id, user_id, role_id) do update
  set branch_id = coalesce(public.user_roles.branch_id, excluded.branch_id),
      status = 'active',
      updated_at = timezone('utc', now())
  returning id into assigned_user_role_id;

  perform public.record_organization_staff_event(
    station_record.organization_id,
    'event.organization.role.assigned',
    target_idempotency_key || ':event',
    target_user_id,
    null,
    resolved_role_id,
    station_record.branch_id,
    null,
    'active',
    target_metadata || jsonb_build_object(
      'station_branch_id',
      target_station_branch_id,
      'preset_key',
      target_preset_key
    )
  );

  return assigned_user_role_id;
end;
$$;

create or replace function public.activate_lpg_station_branch(
  target_application_id uuid default null,
  target_organization_id uuid default null,
  target_branch_id uuid default null,
  target_display_name text default null,
  target_formatted_address text default null,
  target_latitude numeric default null,
  target_longitude numeric default null,
  target_idempotency_key text default null,
  target_owner_user_id uuid default null,
  target_branch_key text default null,
  target_service_radius_meters integer default 8000,
  target_supported_cylinder_sizes_kg numeric[] default array[]::numeric[],
  target_refill_capacity_kg numeric default 0,
  target_current_available_kg numeric default null,
  target_operating_hours jsonb default '{}'::jsonb,
  target_geofence jsonb default '{}'::jsonb,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'lpg.station_activation_api'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  application_record record;
  application_type_record record;
  version_record record;
  activation_result jsonb;
  station_payload jsonb := '{}'::jsonb;
  organization_id uuid;
  branch_id uuid;
  station_branch_id uuid;
  resolved_owner_user_id uuid;
  resolved_branch_key text;
  resolved_display_name text;
  resolved_address text;
  resolved_latitude numeric;
  resolved_longitude numeric;
  resolved_capacity numeric;
  preset_record record;
begin
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object'
    or target_operating_hours is null or jsonb_typeof(target_operating_hours) <> 'object'
    or target_geofence is null or jsonb_typeof(target_geofence) <> 'object' then
    raise exception 'station JSON inputs must be objects';
  end if;

  if target_application_id is not null then
    select application.*
    into application_record
    from public.application_records application
    where application.id = target_application_id
    for update;

    if not found then
      raise exception 'target_application_id must reference an application';
    end if;

    if application_record.status <> 'approved' then
      raise exception 'only approved LPG station applications can be activated';
    end if;

    select application_type.*
    into application_type_record
    from public.application_type_definitions application_type
    where application_type.id = application_record.application_type_id;

    if application_type_record.application_category <> 'business' then
      raise exception 'LPG station activation requires an approved business application';
    end if;

    select version.*
    into version_record
    from public.application_versions version
    where version.application_id = application_record.id
      and version.version = application_record.active_version;

    station_payload := coalesce(
      version_record.payload -> 'lpgStation',
      version_record.payload -> 'lpg_station',
      version_record.payload -> 'station',
      version_record.payload -> 'business',
      '{}'::jsonb
    );

    if application_record.activated_subject_type is null then
      activation_result := public.activate_approved_application(target_application_id);
      organization_id := nullif(activation_result ->> 'organization_id', '')::uuid;
    else
      organization_id := application_record.organization_id;
    end if;

    if organization_id is null then
      select application.organization_id
      into organization_id
      from public.application_records application
      where application.id = target_application_id;
    end if;

    resolved_owner_user_id := coalesce(target_owner_user_id, application_record.applicant_user_id);
  else
    organization_id := target_organization_id;
    resolved_owner_user_id := coalesce(target_owner_user_id, auth.uid());
  end if;

  if organization_id is null then
    raise exception 'target_organization_id or an approved station application is required';
  end if;

  if auth.role() <> 'service_role'
    and not public.has_permission('lpg.stations.manage', organization_id)
    and not public.has_permission('business.staff.manage', organization_id)
    and not public.can_manage_lpg_operations() then
    raise exception 'LPG station activation permission is required';
  end if;

  resolved_display_name := coalesce(
    nullif(target_display_name, ''),
    nullif(station_payload ->> 'displayName', ''),
    nullif(station_payload ->> 'display_name', '')
  );
  resolved_address := coalesce(
    nullif(target_formatted_address, ''),
    nullif(station_payload ->> 'formattedAddress', ''),
    nullif(station_payload ->> 'formatted_address', ''),
    nullif(station_payload ->> 'address', '')
  );
  resolved_latitude := coalesce(target_latitude, nullif(station_payload ->> 'latitude', '')::numeric);
  resolved_longitude := coalesce(target_longitude, nullif(station_payload ->> 'longitude', '')::numeric);
  resolved_capacity := coalesce(target_refill_capacity_kg, nullif(station_payload ->> 'refillCapacityKg', '')::numeric, 0);

  if resolved_display_name is null or char_length(btrim(resolved_display_name)) < 2 then
    raise exception 'station display name is required';
  end if;

  if resolved_address is null or char_length(btrim(resolved_address)) < 5 then
    raise exception 'station formatted address is required';
  end if;

  if resolved_latitude is null or resolved_latitude < -90 or resolved_latitude > 90
    or resolved_longitude is null or resolved_longitude < -180 or resolved_longitude > 180 then
    raise exception 'station latitude and longitude must be valid coordinates';
  end if;

  if coalesce(target_service_radius_meters, 0) <= 0 then
    raise exception 'target_service_radius_meters must be greater than zero';
  end if;

  if resolved_capacity < 0 or coalesce(target_current_available_kg, resolved_capacity) < 0 then
    raise exception 'station capacity values must be greater than or equal to zero';
  end if;

  resolved_branch_key := coalesce(
    nullif(target_branch_key, ''),
    nullif(station_payload ->> 'branchKey', ''),
    nullif(station_payload ->> 'branch_key', ''),
    'lpg.station.' || substr(replace(target_idempotency_key, '-', ''), 1, 24)
  );

  if resolved_branch_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'resolved branch key must be a valid platform key';
  end if;

  if target_branch_id is not null then
    select branch.id
    into branch_id
    from public.organization_branches branch
    where branch.id = target_branch_id
      and branch.organization_id = organization_id
      and branch.status = 'active';

    if not found then
      raise exception 'target_branch_id must reference an active branch for the organization';
    end if;
  else
    branch_id := public.create_organization_branch(
      organization_id,
      resolved_branch_key,
      resolved_display_name,
      jsonb_build_object('formatted_address', resolved_address),
      jsonb_build_object('latitude', resolved_latitude, 'longitude', resolved_longitude),
      'active',
      target_source,
      target_idempotency_key || ':branch',
      target_metadata || jsonb_build_object('bounded_context', 'lpg')
    );
  end if;

  insert into public.lpg_station_branches (
    organization_id,
    branch_id,
    display_name,
    formatted_address,
    latitude,
    longitude,
    service_radius_meters,
    operating_hours,
    supported_cylinder_sizes_kg,
    refill_capacity_kg,
    current_available_kg,
    geofence,
    availability_status,
    approval_status,
    compliance_status,
    metadata,
    source,
    idempotency_key
  )
  values (
    organization_id,
    branch_id,
    btrim(resolved_display_name),
    btrim(resolved_address),
    resolved_latitude,
    resolved_longitude,
    target_service_radius_meters,
    target_operating_hours,
    coalesce(target_supported_cylinder_sizes_kg, array[]::numeric[]),
    resolved_capacity,
    coalesce(target_current_available_kg, resolved_capacity),
    target_geofence,
    'available',
    'approved',
    'approved',
    target_metadata || jsonb_build_object(
      'activated_from_application_id',
      target_application_id,
      'owner_user_id',
      resolved_owner_user_id
    ),
    target_source,
    target_idempotency_key
  )
  on conflict (source, idempotency_key) do update
  set organization_id = excluded.organization_id,
      branch_id = excluded.branch_id,
      display_name = excluded.display_name,
      formatted_address = excluded.formatted_address,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      service_radius_meters = excluded.service_radius_meters,
      operating_hours = excluded.operating_hours,
      supported_cylinder_sizes_kg = excluded.supported_cylinder_sizes_kg,
      refill_capacity_kg = excluded.refill_capacity_kg,
      current_available_kg = excluded.current_available_kg,
      geofence = excluded.geofence,
      availability_status = 'available',
      approval_status = 'approved',
      compliance_status = 'approved',
      metadata = public.lpg_station_branches.metadata || excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into station_branch_id;

  for preset_record in
    select preset.*
    from public.lpg_station_role_presets preset
    where preset.status = 'active'
    order by preset.key
  loop
    perform public.configure_organization_role(
      organization_id,
      preset_record.role_key,
      preset_record.display_name,
      preset_record.permission_keys,
      'Branch-scoped preset for LPG station operations.',
      branch_id,
      target_source,
      target_idempotency_key || ':role:' || preset_record.key,
      preset_record.metadata || jsonb_build_object('station_branch_id', station_branch_id)
    );
  end loop;

  if resolved_owner_user_id is not null then
    perform public.assign_lpg_station_role(
      station_branch_id,
      resolved_owner_user_id,
      'lpg.station.owner',
      target_idempotency_key || ':owner-role',
      target_metadata
    );
  end if;

  return station_branch_id;
end;
$$;

create or replace function public.ensure_lpg_order_record(
  target_lpg_order_id uuid,
  target_idempotency_key text,
  target_source text default 'lpg.order_projection',
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  lpg_order record;
  station_record record;
  module_record record;
  order_id uuid;
  existing_record record;
  tax_amount numeric(28, 8);
begin
  if auth.role() <> 'service_role'
    and not public.can_access_lpg_order(target_lpg_order_id) then
    raise exception 'LPG order access permission is required';
  end if;

  if target_lpg_order_id is null then
    raise exception 'target_lpg_order_id is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select target_order.*
  into lpg_order
  from public.lpg_refill_orders target_order
  where target_order.id = target_lpg_order_id
  for update;

  if not found then
    raise exception 'target_lpg_order_id must reference an LPG order';
  end if;

  if lpg_order.order_record_id is not null then
    return lpg_order.order_record_id;
  end if;

  if lpg_order.station_branch_id is null then
    raise exception 'station branch must be assigned before projecting LPG order into generic orders';
  end if;

  select station.*
  into station_record
  from public.lpg_station_branches station
  where station.id = lpg_order.station_branch_id
    and station.approval_status = 'approved'
    and station.compliance_status = 'approved';

  if not found then
    raise exception 'LPG station must be approved before generic order projection';
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

  select existing.*
  into existing_record
  from public.order_records existing
  where existing.service_request_id = lpg_order.service_request_id;

  if found then
    update public.lpg_refill_orders
    set order_record_id = existing_record.id,
        updated_at = timezone('utc', now())
    where id = lpg_order.id;

    return existing_record.id;
  end if;

  tax_amount := greatest(
    lpg_order.total_amount - lpg_order.station_amount - lpg_order.delivery_fee_amount - lpg_order.platform_fee_amount,
    0
  );

  insert into public.order_records (
    service_request_id,
    module_id,
    module_version_id,
    organization_id,
    branch_id,
    requester_user_id,
    workflow_instance_id,
    status,
    fulfillment_method,
    currency_code,
    subtotal_amount,
    fee_amount,
    discount_amount,
    tax_amount,
    total_amount,
    order_payload,
    source,
    idempotency_key,
    metadata,
    accepted_at,
    created_by
  )
  values (
    lpg_order.service_request_id,
    module_record.id,
    module_record.version_id,
    station_record.organization_id,
    station_record.branch_id,
    lpg_order.customer_user_id,
    null,
    case
      when lpg_order.status in ('delivered', 'completed') then 'fulfilled'
      when lpg_order.status in ('cancelled', 'refunded') then 'cancelled'
      else 'accepted'
    end,
    'lpg.refill.delivery',
    lpg_order.currency_code,
    lpg_order.station_amount + lpg_order.delivery_fee_amount,
    lpg_order.platform_fee_amount,
    0,
    tax_amount,
    lpg_order.total_amount,
    jsonb_build_object(
      'bounded_context',
      'lpg',
      'lpg_order_id',
      lpg_order.id,
      'cylinder_id',
      lpg_order.cylinder_id,
      'requested_kg',
      lpg_order.requested_kg,
      'station_branch_id',
      lpg_order.station_branch_id
    ),
    target_source,
    target_idempotency_key,
    target_metadata || jsonb_build_object('lpg_order_id', lpg_order.id),
    timezone('utc', now()),
    auth.uid()
  )
  on conflict (source, idempotency_key) do nothing
  returning id into order_id;

  if order_id is null then
    select existing.id
    into order_id
    from public.order_records existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    if order_id is null then
      raise exception 'LPG order projection idempotency lookup failed';
    end if;
  end if;

  update public.lpg_refill_orders
  set order_record_id = order_id,
      updated_at = timezone('utc', now())
  where id = lpg_order.id;

  update public.service_requests
  set organization_id = station_record.organization_id,
      participants = participants || jsonb_build_object(
        'station_branch_id',
        lpg_order.station_branch_id,
        'organization_id',
        station_record.organization_id,
        'organization_branch_id',
        station_record.branch_id
      ),
      updated_at = timezone('utc', now())
  where id = lpg_order.service_request_id;

  return order_id;
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
  profile_id uuid;
  ownership_media_asset_id uuid;
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

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select profile.id
  into profile_id
  from public.lpg_cylinder_type_profiles profile
  where profile.status = 'active'
    and profile.size_kg = target_size_kg
    and profile.max_capacity_kg >= target_max_capacity_kg
  order by profile.max_capacity_kg asc, profile.created_at asc
  limit 1;

  if profile_id is null then
    raise exception 'target_size_kg must match an active LPG cylinder type profile';
  end if;

  if target_image_asset_ids is not null
    and array_length(target_image_asset_ids, 1) is not null
    and exists (
      select 1
      from unnest(target_image_asset_ids) media_id
      left join public.media_assets media on media.id = media_id
      where media.id is null
        or media.status <> 'active'
        or (
          media.owner_user_id is distinct from auth.uid()
          and not public.can_manage_lpg_operations()
        )
    ) then
    raise exception 'target_image_asset_ids must reference active media assets owned by the cylinder owner';
  end if;

  if target_metadata ? 'ownershipProofMediaAssetId' then
    ownership_media_asset_id := nullif(target_metadata ->> 'ownershipProofMediaAssetId', '')::uuid;

    if ownership_media_asset_id is not null
      and not exists (
        select 1
        from public.media_assets media
        where media.id = ownership_media_asset_id
          and media.status = 'active'
          and (
            media.owner_user_id = auth.uid()
            or public.can_manage_lpg_operations()
          )
      ) then
      raise exception 'ownership proof media asset must be active and owned by the cylinder owner';
    end if;
  end if;

  insert into public.lpg_cylinders (
    cylinder_identifier,
    qr_payload,
    barcode_payload,
    size_kg,
    max_capacity_kg,
    cylinder_type_profile_id,
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
    ownership_proof_media_asset_id,
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
    profile_id,
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
    ownership_media_asset_id,
    coalesce(target_image_asset_ids, array[]::uuid[]),
    case when target_condition_status in ('damaged', 'unsafe', 'expired') then target_condition_status else 'active' end,
    target_notes,
    target_metadata || jsonb_build_object('cylinder_type_profile_id', profile_id),
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
    target_metadata || jsonb_build_object('cylinder_type_profile_id', profile_id),
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
  quote_policy jsonb;
  resolved_currency_code text;
  quote_expiry_seconds integer;
  pricing_policy_key text;
  settlement_policy_key text;
  resolved_dispatch_policy_key text;
  quote_expires_at timestamptz;
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

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  quote_policy := public.lpg_policy_config('lpg.quote.phase_one');
  resolved_currency_code := quote_policy ->> 'currency_code';
  quote_expiry_seconds := nullif(quote_policy ->> 'quote_expiry_seconds', '')::integer;
  pricing_policy_key := quote_policy ->> 'pricing_policy_key';
  settlement_policy_key := quote_policy ->> 'settlement_policy_key';
  resolved_dispatch_policy_key := quote_policy ->> 'dispatch_policy_key';

  if resolved_currency_code is null
    or quote_expiry_seconds is null
    or quote_expiry_seconds <= 0
    or pricing_policy_key is null
    or settlement_policy_key is null
    or resolved_dispatch_policy_key is null then
    raise exception 'LPG quote policy is incomplete';
  end if;

  quote_expires_at := timezone('utc', now()) + make_interval(secs => quote_expiry_seconds);

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
      and station.availability_status = 'available'
      and station.current_available_kg >= target_requested_kg
      and (
        array_length(station.supported_cylinder_sizes_kg, 1) is null
        or cylinder_record.size_kg = any(station.supported_cylinder_sizes_kg)
      );

    if not found then
      raise exception 'target_station_branch_id must reference an available approved station with sufficient capacity';
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
    and pricing.currency_code = resolved_currency_code
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

  if pricing_record.driver_commission_amount > pricing_record.delivery_base_fee then
    raise exception 'active LPG pricing would over-allocate delivery fee';
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
  where policy.key = pricing_policy_key
    and policy.status = 'active'
  order by policy.version desc
  limit 1;

  if not found then
    raise exception 'active LPG pricing policy is required';
  end if;

  select policy.id
  into settlement_policy_id
  from public.settlement_policies policy
  where policy.key = settlement_policy_key
    and policy.status = 'active'
  order by policy.version desc
  limit 1;

  if settlement_policy_id is null then
    raise exception 'active LPG settlement policy is required';
  end if;

  select policy.id
  into dispatch_policy_id
  from public.dispatch_policies policy
  where policy.key = resolved_dispatch_policy_key
    and policy.status = 'active'
  limit 1;

  if dispatch_policy_id is null then
    raise exception 'active LPG dispatch policy is required';
  end if;

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
    target_metadata || jsonb_build_object('quote_policy_key', 'lpg.quote.phase_one')
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
    jsonb_build_object('requested_kg', target_requested_kg, 'pricing_record_id', pricing_record.id),
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
    quote_expires_at,
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
    expires_at,
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
    quote_expires_at,
    jsonb_build_object(
      'requested_kg',
      target_requested_kg,
      'station_amount',
      lpg_amount,
      'pricing_record_id',
      pricing_record.id,
      'quote_policy_key',
      'lpg.quote.phase_one'
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

create or replace function public.dispatch_lpg_order(
  target_lpg_order_id uuid,
  target_candidate_limit integer default null,
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
  dispatch_request_id uuid;
  candidate_record record;
  candidate_rank integer := 0;
  selected_driver_profile_id uuid;
  selected_vehicle_id uuid;
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
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('lpg.dispatch.execute', null)
    and not public.can_manage_lpg_operations() then
    raise exception 'LPG dispatch permission is required';
  end if;

  if target_lpg_order_id is null then
    raise exception 'target_lpg_order_id is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  dispatch_policy := public.lpg_policy_config('lpg.dispatch.phase_one');
  policy_candidate_limit := nullif(dispatch_policy ->> 'candidate_limit', '')::integer;
  freshness_seconds := nullif(dispatch_policy ->> 'driver_location_freshness_seconds', '')::integer;
  max_driver_distance_meters := nullif(dispatch_policy ->> 'max_driver_distance_meters', '')::numeric;
  offer_ttl_seconds := nullif(dispatch_policy ->> 'offer_ttl_seconds', '')::integer;
  reservation_ttl_seconds := nullif(dispatch_policy ->> 'capacity_reservation_ttl_seconds', '')::integer;
  driver_required := coalesce(dispatch_policy -> 'required_driver_capabilities', '[]'::jsonb);
  vehicle_required := coalesce(dispatch_policy -> 'required_vehicle_capabilities', '[]'::jsonb);

  if policy_candidate_limit is null or policy_candidate_limit <= 0 or policy_candidate_limit > 25
    or freshness_seconds is null or freshness_seconds <= 0
    or max_driver_distance_meters is null or max_driver_distance_meters <= 0
    or offer_ttl_seconds is null or offer_ttl_seconds <= 0
    or reservation_ttl_seconds is null or reservation_ttl_seconds <= 0
    or jsonb_typeof(driver_required) <> 'array'
    or jsonb_typeof(vehicle_required) <> 'array' then
    raise exception 'LPG dispatch policy is incomplete';
  end if;

  target_candidate_limit := coalesce(target_candidate_limit, policy_candidate_limit);

  if target_candidate_limit <= 0 or target_candidate_limit > 25 then
    raise exception 'target_candidate_limit must be between 1 and 25';
  end if;

  target_candidate_limit := least(target_candidate_limit, policy_candidate_limit);

  configured_dispatch_policy_key := public.lpg_policy_config('lpg.quote.phase_one') ->> 'dispatch_policy_key';

  if configured_dispatch_policy_key is null then
    raise exception 'LPG quote policy must define dispatch_policy_key';
  end if;

  select policy.key
  into dispatch_policy_key
  from public.dispatch_policies policy
  where policy.key = configured_dispatch_policy_key
    and policy.status = 'active'
  limit 1;

  if dispatch_policy_key is null then
    raise exception 'active LPG dispatch policy is required';
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

  existing_dispatch_request_id := nullif(order_record.metadata ->> 'dispatch_request_id', '')::uuid;

  if existing_dispatch_request_id is not null
    and order_record.metadata ->> 'dispatch_idempotency_key' = target_idempotency_key then
    return existing_dispatch_request_id;
  end if;

  if order_record.status not in ('payment_reserved', 'matching_station', 'matching_driver', 'driver_offered') then
    raise exception 'LPG order must be funded before dispatch';
  end if;

  if order_record.station_branch_id is not null then
    select station.*
    into station_record
    from public.lpg_station_branches station
    where station.id = order_record.station_branch_id
      and station.approval_status = 'approved'
      and station.compliance_status = 'approved'
      and station.availability_status = 'available'
      and station.current_available_kg >= order_record.requested_kg
    for update;
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
    limit 1
    for update;
  end if;

  if not found then
    raise exception 'no eligible LPG station is available for this order';
  end if;

  dispatch_request_id := public.create_dispatch_request(
    dispatch_policy_key,
    target_source,
    'lpg_order',
    order_record.id,
    jsonb_build_object(
      'driver_required_capabilities',
      driver_required,
      'vehicle_required_capabilities',
      vehicle_required
    ),
    jsonb_build_object('latitude', order_record.pickup_latitude, 'longitude', order_record.pickup_longitude),
    jsonb_build_object('latitude', order_record.delivery_latitude, 'longitude', order_record.delivery_longitude),
    100,
    jsonb_build_object(
      'bounded_context',
      'lpg',
      'station_branch_id',
      station_record.id,
      'candidate_limit',
      target_candidate_limit,
      'max_driver_distance_meters',
      max_driver_distance_meters
    ),
    target_idempotency_key || ':dispatch-request'
  );

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
    join lateral (
      select location.latitude, location.longitude, location.recorded_at
      from public.lpg_driver_locations location
      where location.driver_profile_id = driver.id
        and location.online_status = 'online'
        and location.recorded_at >= timezone('utc', now()) - make_interval(secs => freshness_seconds)
      order by location.recorded_at desc
      limit 1
    ) latest_location on true
    where driver.verification_status = 'approved'
      and driver.operational_status = 'available'
      and not exists (
        select 1
        from jsonb_array_elements_text(driver_required) required_capability(capability_key)
        where not exists (
          select 1
          from public.entity_capabilities driver_capability
          where driver_capability.entity_type = 'driver'
            and driver_capability.entity_id = driver.id
            and driver_capability.capability_key = required_capability.capability_key
            and driver_capability.status = 'active'
        )
      )
      and not exists (
        select 1
        from jsonb_array_elements_text(vehicle_required) required_capability(capability_key)
        where not exists (
          select 1
          from public.entity_capabilities vehicle_capability
          where vehicle_capability.entity_type = 'vehicle'
            and vehicle_capability.entity_id = selected_vehicle.id
            and vehicle_capability.capability_key = required_capability.capability_key
            and vehicle_capability.status = 'active'
        )
      )
      and public.lpg_distance_meters(
        order_record.pickup_latitude,
        order_record.pickup_longitude,
        latest_location.latitude,
        latest_location.longitude
      ) <= max_driver_distance_meters
    order by distance_meters asc, latest_location.recorded_at desc, driver.created_at asc
    limit target_candidate_limit
  loop
    candidate_rank := candidate_rank + 1;

    if candidate_rank = 1 then
      selected_driver_profile_id := candidate_record.driver_profile_id;
      selected_vehicle_id := candidate_record.vehicle_id;
    end if;

    perform public.upsert_dispatch_candidate(
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
      case when candidate_rank = 1 then 'offered' else 'suggested' end,
      target_idempotency_key || ':candidate:' || candidate_rank::text
    );
  end loop;

  if candidate_rank = 0 then
    raise exception 'no fresh eligible LPG driver location is available for dispatch';
  end if;

  update public.lpg_station_branches
  set current_available_kg = current_available_kg - order_record.requested_kg,
      availability_status = case
        when current_available_kg - order_record.requested_kg <= 0 then 'capacity_reached'
        else availability_status
      end,
      updated_at = timezone('utc', now())
  where id = station_record.id
    and current_available_kg >= order_record.requested_kg;

  if not found then
    raise exception 'station capacity could not be reserved';
  end if;

  insert into public.lpg_station_capacity_reservations (
    lpg_order_id,
    station_branch_id,
    requested_kg,
    reserved_kg,
    status,
    expires_at,
    metadata,
    source,
    idempotency_key
  )
  values (
    order_record.id,
    station_record.id,
    order_record.requested_kg,
    order_record.requested_kg,
    'reserved',
    timezone('utc', now()) + make_interval(secs => reservation_ttl_seconds),
    jsonb_build_object('dispatch_request_id', dispatch_request_id),
    target_source,
    target_idempotency_key || ':capacity'
  )
  on conflict (lpg_order_id) do update
  set station_branch_id = excluded.station_branch_id,
      requested_kg = excluded.requested_kg,
      reserved_kg = excluded.reserved_kg,
      status = 'reserved',
      expires_at = excluded.expires_at,
      metadata = public.lpg_station_capacity_reservations.metadata || excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into reservation_id;

  update public.dispatch_requests
  set assigned_entity_type = 'driver',
      assigned_entity_id = selected_driver_profile_id,
      metadata = metadata || jsonb_build_object('vehicle_id', selected_vehicle_id, 'capacity_reservation_id', reservation_id),
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
        candidate_rank,
        'driver_offer_expires_at',
        timezone('utc', now()) + make_interval(secs => offer_ttl_seconds),
        'capacity_reservation_id',
        reservation_id
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

  perform public.ensure_lpg_order_record(
    order_record.id,
    target_idempotency_key || ':order-record',
    'lpg.order_projection',
    jsonb_build_object('dispatch_request_id', dispatch_request_id)
  );

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
      selected_vehicle_id,
      'capacity_reservation_id',
      reservation_id
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
  resolved_tracking_session_id uuid;
  existing_tracking record;
  actor_user_id uuid;
  public_metadata jsonb;
begin
  if target_lpg_order_id is null then
    raise exception 'target_lpg_order_id is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  actor_user_id := auth.uid();

  if auth.role() = 'service_role' then
    actor_user_id := nullif(target_metadata ->> 'server_actor_user_id', '')::uuid;
  end if;

  if actor_user_id is null then
    raise exception 'authenticated user is required';
  end if;

  public_metadata := target_metadata - 'server_actor_user_id';

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
    and driver.user_id = actor_user_id
    and driver.verification_status = 'approved';

  if not found then
    raise exception 'assigned approved LPG driver is required';
  end if;

  accepted_dispatch_request_id := nullif(order_record.metadata ->> 'dispatch_request_id', '')::uuid;

  if order_record.tracking_session_id is not null then
    resolved_tracking_session_id := order_record.tracking_session_id;
  else
    select existing.*
    into existing_tracking
    from public.tracking_sessions existing
    where existing.source = 'lpg.tracking_engine'
      and existing.idempotency_key = target_idempotency_key || ':tracking-session';

    if found then
      resolved_tracking_session_id := existing_tracking.id;
    else
      insert into public.tracking_sessions (
        subject_type,
        subject_id,
        status,
        started_by,
        metadata,
        source,
        idempotency_key
      )
      values (
        'lpg_order',
        order_record.id,
        'active',
        actor_user_id,
        public_metadata || jsonb_build_object('driver_profile_id', order_record.driver_profile_id),
        'lpg.tracking_engine',
        target_idempotency_key || ':tracking-session'
      )
      returning id into resolved_tracking_session_id;

      insert into public.tracking_session_events (
        resolved_tracking_session_id,
        status,
        idempotency_key,
        metadata
      )
      values (
        tracking_session_id,
        'active',
        target_idempotency_key || ':tracking-session:started',
        jsonb_build_object('source', target_source, 'lpg_order_id', order_record.id)
      )
      on conflict do nothing;
    end if;
  end if;

  update public.lpg_refill_orders
  set status = 'driver_accepted',
      assignment_status = 'driver_assigned',
      tracking_session_id = resolved_tracking_session_id,
      metadata = metadata || public_metadata || jsonb_build_object(
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

  if order_record.order_record_id is not null then
    update public.order_records
    set status = 'accepted',
        accepted_at = coalesce(accepted_at, timezone('utc', now())),
        updated_at = timezone('utc', now())
    where id = order_record.order_record_id;
  end if;

  if accepted_dispatch_request_id is not null then
    perform public.assign_dispatch_request(
      accepted_dispatch_request_id,
      'driver',
      order_record.driver_profile_id,
      target_idempotency_key || ':dispatch-assigned',
      jsonb_build_object('vehicle_id', order_record.vehicle_id)
    );

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
    public_metadata || jsonb_build_object('tracking_session_id', resolved_tracking_session_id)
  );

  return order_record.id;
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
  active_order record;
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

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
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

  if target_lpg_order_id is not null then
    select target_order.*
    into active_order
    from public.lpg_refill_orders target_order
    where target_order.id = target_lpg_order_id
      and target_order.driver_profile_id = target_driver_profile_id;

    if not found then
      raise exception 'target_lpg_order_id must reference an active order assigned to the driver';
    end if;
  else
    select target_order.*
    into active_order
    from public.lpg_refill_orders target_order
    where target_order.driver_profile_id = target_driver_profile_id
      and target_order.status in ('driver_accepted','pickup_en_route','pickup_verified','station_en_route','station_verified','refill_in_progress','refill_confirmed','station_settled','return_en_route','delivery_verification_pending')
    order by target_order.updated_at desc
    limit 1;
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
    coalesce(target_lpg_order_id, active_order.id),
    target_latitude,
    target_longitude,
    target_accuracy_meters,
    target_heading_degrees,
    target_speed_meters_per_second,
    target_online_status,
    coalesce(target_recorded_at, timezone('utc', now())),
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

  if active_order.id is not null
    and active_order.tracking_session_id is not null
    and target_online_status = 'online' then
    perform public.record_tracking_point(
      active_order.tracking_session_id,
      target_latitude,
      target_longitude,
      target_accuracy_meters,
      target_speed_meters_per_second,
      target_heading_degrees,
      target_metadata || jsonb_build_object('lpg_driver_location_id', location_id),
      coalesce(target_recorded_at, timezone('utc', now())),
      target_idempotency_key || ':tracking-point'
    );
  end if;

  return location_id;
end;
$$;

create or replace function public.lpg_delivery_challenge_is_verified(
  target_lpg_order_id uuid,
  target_challenge_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.otp_challenges challenge
    join public.lpg_refill_orders target_order on target_order.id = target_lpg_order_id
    where challenge.id = target_challenge_id
      and challenge.status = 'verified'
      and challenge.user_id = target_order.customer_user_id
      and challenge.purpose = 'lpg.delivery.verification'
      and (
        challenge.metadata ->> 'lpg_order_id' = target_lpg_order_id::text
        or target_order.delivery_challenge_id = challenge.id
      )
  );
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
  driver_record record;
  scan_id uuid;
  new_status text;
  history_event text;
  verification_definition_key text;
  verification_event_id uuid;
  result_status text := 'passed';
  delivery_challenge_id uuid;
begin
  if target_scan_type not in ('customer_pickup', 'station_receipt', 'station_release', 'customer_delivery', 'inspection') then
    raise exception 'target_scan_type is not supported';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_payload is null or jsonb_typeof(target_payload) <> 'object' then
    raise exception 'target_payload must be a JSON object';
  end if;

  select existing.id
  into scan_id
  from public.lpg_cylinder_scans existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if found then
    return scan_id;
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

  select driver.*
  into driver_record
  from public.driver_profiles driver
  where driver.id = order_record.driver_profile_id;

  if target_scan_type = 'customer_pickup' then
    if order_record.status not in ('driver_accepted', 'pickup_en_route') then
      raise exception 'customer pickup scan is not valid for the current order status';
    end if;
    if auth.role() <> 'service_role'
      and (driver_record.user_id is distinct from auth.uid())
      and not public.can_manage_lpg_operations() then
      raise exception 'assigned driver is required for pickup scan';
    end if;
    new_status := 'pickup_verified';
    history_event := 'pickup_scan';
    verification_definition_key := 'verification.lpg.pickup.asset_scan';
  elsif target_scan_type = 'station_receipt' then
    if order_record.status not in ('pickup_verified', 'station_en_route') then
      raise exception 'station receipt scan is not valid for the current order status';
    end if;
    if not public.can_operate_lpg_station_branch(order_record.station_branch_id, 'lpg.stations.scan') then
      raise exception 'branch-scoped LPG scanner permission is required';
    end if;
    new_status := 'station_verified';
    history_event := 'station_scan';
    verification_definition_key := 'verification.lpg.partner.fulfillment_scan';
  elsif target_scan_type = 'station_release' then
    if order_record.status not in ('refill_confirmed', 'station_settled') then
      raise exception 'station release scan is not valid for the current order status';
    end if;
    if not public.can_operate_lpg_station_branch(order_record.station_branch_id, 'lpg.stations.scan') then
      raise exception 'branch-scoped LPG scanner permission is required';
    end if;
    new_status := 'return_en_route';
    history_event := 'station_scan';
    verification_definition_key := 'verification.lpg.partner.fulfillment_scan';
  elsif target_scan_type = 'customer_delivery' then
    if order_record.status not in ('return_en_route', 'delivery_verification_pending') then
      raise exception 'customer delivery scan is not valid for the current order status';
    end if;

    if target_payload ? 'deliveryChallengeId' then
      delivery_challenge_id := nullif(target_payload ->> 'deliveryChallengeId', '')::uuid;
    else
      delivery_challenge_id := order_record.delivery_challenge_id;
    end if;

    if auth.role() <> 'service_role'
      and auth.uid() is distinct from order_record.customer_user_id
      and (driver_record.user_id is distinct from auth.uid())
      and not public.can_manage_lpg_operations() then
      raise exception 'customer or assigned driver is required for delivery scan';
    end if;

    if delivery_challenge_id is null
      or not public.lpg_delivery_challenge_is_verified(order_record.id, delivery_challenge_id) then
      raise exception 'verified LPG delivery challenge is required';
    end if;

    new_status := 'delivered';
    history_event := 'delivery_verified';
    verification_definition_key := 'verification.lpg.delivery.asset_scan';
  else
    if not public.can_operate_lpg_station_branch(order_record.station_branch_id, 'lpg.stations.scan')
      and not public.can_operate_lpg_station_branch(order_record.station_branch_id, 'lpg.stations.pump')
      and not public.can_manage_lpg_operations() then
      raise exception 'branch-scoped LPG inspection permission is required';
    end if;
    new_status := order_record.status;
    history_event := 'inspection';
    verification_definition_key := 'verification.lpg.partner.fulfillment_scan';
  end if;

  verification_event_id := public.record_verification_event(
    verification_definition_key,
    target_source,
    'asset',
    order_record.cylinder_id,
    'lpg.scan.' || target_scan_type,
    jsonb_build_object('latitude', target_latitude, 'longitude', target_longitude, 'accuracy_meters', target_accuracy_meters),
    'passed',
    target_payload || jsonb_build_object('lpg_order_id', order_record.id, 'scan_type', target_scan_type),
    target_idempotency_key || ':verification',
    timezone('utc', now())
  );

  insert into public.lpg_cylinder_scans (
    lpg_order_id,
    cylinder_id,
    scan_type,
    driver_profile_id,
    station_branch_id,
    verification_event_id,
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
    verification_event_id,
    target_latitude,
    target_longitude,
    target_accuracy_meters,
    result_status,
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
      when new_status = 'delivered' then 'completed'
      when new_status in ('pickup_verified', 'station_verified', 'return_en_route') then 'in_progress'
      else status
    end,
        updated_at = timezone('utc', now())
    where id = order_record.service_request_id;

    if order_record.order_record_id is not null then
      update public.order_records
      set status = case
            when new_status = 'delivered' then 'fulfilled'
            when new_status in ('cancelled', 'refunded') then 'cancelled'
            else status
          end,
          fulfilled_at = case when new_status = 'delivered' then timezone('utc', now()) else fulfilled_at end,
          updated_at = timezone('utc', now())
      where id = order_record.order_record_id;
    end if;
  end if;

  perform public.record_lpg_order_event(
    order_record.id,
    'lpg.scan.' || target_scan_type,
    order_record.status,
    new_status,
    target_idempotency_key || ':event',
    target_payload || jsonb_build_object(
      'scan_id',
      scan_id,
      'verification_event_id',
      verification_event_id
    )
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

  if target_scan_type = 'customer_delivery'
    and order_record.tracking_session_id is not null then
    update public.tracking_sessions
    set status = 'completed',
        ended_at = coalesce(ended_at, timezone('utc', now())),
        updated_at = timezone('utc', now())
    where id = order_record.tracking_session_id
      and status <> 'completed';

    insert into public.tracking_session_events (
      tracking_session_id,
      status,
      idempotency_key,
      metadata
    )
    values (
      order_record.tracking_session_id,
      'completed',
      target_idempotency_key || ':tracking-completed',
      jsonb_build_object('lpg_order_id', order_record.id)
    )
    on conflict do nothing;
  end if;

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
  quote_record record;
  pricing_record record;
  refill_id uuid;
  refill_amount numeric(28, 8);
  refill_policy jsonb;
  overfill_tolerance_kg numeric;
  effective_price_per_kg numeric(28, 8);
begin
  if target_actual_kg is null or target_actual_kg <= 0 then
    raise exception 'target_actual_kg must be greater than zero';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_safety_observations is null or jsonb_typeof(target_safety_observations) <> 'object' then
    raise exception 'target_safety_observations must be a JSON object';
  end if;

  select existing.id
  into refill_id
  from public.lpg_refill_records existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if found then
    return refill_id;
  end if;

  refill_policy := public.lpg_policy_config('lpg.refill.phase_one');
  overfill_tolerance_kg := coalesce(nullif(refill_policy ->> 'overfill_tolerance_kg', '')::numeric, 0);

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

  if not public.can_operate_lpg_station_branch(order_record.station_branch_id, 'lpg.stations.pump') then
    raise exception 'branch-scoped LPG pump permission is required';
  end if;

  if order_record.status not in ('station_verified', 'refill_in_progress') then
    raise exception 'refill cannot be confirmed from the current order status';
  end if;

  select quote.*
  into quote_record
  from public.lpg_refill_quotes quote
  where quote.id = order_record.lpg_refill_quote_id;

  select pricing.*
  into pricing_record
  from public.lpg_refill_pricing pricing
  where pricing.id = quote_record.pricing_id;

  if not found then
    raise exception 'order pricing record is required for refill confirmation';
  end if;

  effective_price_per_kg := pricing_record.price_per_kg;

  if target_price_per_kg is not null and target_price_per_kg <> effective_price_per_kg then
    raise exception 'refill prices are server-managed and must match configured pricing';
  end if;

  if target_actual_kg > order_record.requested_kg + overfill_tolerance_kg then
    insert into public.lpg_order_financial_adjustments (
      lpg_order_id,
      adjustment_type,
      currency_code,
      amount,
      status,
      reason_key,
      metadata,
      source,
      idempotency_key
    )
    values (
      order_record.id,
      'overfill_blocked',
      order_record.currency_code,
      round((target_actual_kg - order_record.requested_kg) * effective_price_per_kg, 2),
      'blocked',
      'lpg.overfill.manual_review',
      target_safety_observations,
      target_source,
      target_idempotency_key || ':overfill'
    )
    on conflict (source, idempotency_key) do nothing;

    raise exception 'LPG overfill is blocked for manual review in phase one';
  end if;

  if coalesce(target_safety_observations ->> 'result', target_safety_observations ->> 'safetyStatus') in ('unsafe', 'rejected') then
    update public.lpg_refill_orders
    set status = 'disputed',
        updated_at = timezone('utc', now())
    where id = order_record.id;

    update public.service_requests
    set status = 'disputed',
        updated_at = timezone('utc', now())
    where id = order_record.service_request_id;

    raise exception 'unsafe LPG inspection result blocks refill confirmation';
  end if;

  refill_amount := round(target_actual_kg * effective_price_per_kg, 2);

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
    effective_price_per_kg,
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

  update public.lpg_station_capacity_reservations
  set consumed_kg = target_actual_kg,
      status = 'consumed',
      updated_at = timezone('utc', now())
  where lpg_order_id = order_record.id
    and status = 'reserved';

  if target_actual_kg < order_record.requested_kg then
    update public.lpg_station_branches
    set current_available_kg = current_available_kg + (order_record.requested_kg - target_actual_kg),
        availability_status = case
          when availability_status = 'capacity_reached' then 'available'
          else availability_status
        end,
        updated_at = timezone('utc', now())
    where id = order_record.station_branch_id;
  end if;

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

create or replace function public.record_lpg_cylinder_inspection(
  target_lpg_order_id uuid,
  target_result text,
  target_idempotency_key text,
  target_evidence_media_asset_ids uuid[] default array[]::uuid[],
  target_observations jsonb default '{}'::jsonb,
  target_source text default 'lpg.inspection_api'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record record;
  inspection_id uuid;
  verification_event_id uuid;
begin
  if target_result not in ('safe', 'unsafe', 'manual_review', 'rejected') then
    raise exception 'target_result is not supported';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_observations is null or jsonb_typeof(target_observations) <> 'object' then
    raise exception 'target_observations must be a JSON object';
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
    raise exception 'a station must be assigned before inspection';
  end if;

  if not public.can_operate_lpg_station_branch(order_record.station_branch_id, 'lpg.stations.pump')
    and not public.can_operate_lpg_station_branch(order_record.station_branch_id, 'lpg.stations.scan') then
    raise exception 'branch-scoped LPG inspection permission is required';
  end if;

  if target_evidence_media_asset_ids is not null
    and array_length(target_evidence_media_asset_ids, 1) is not null
    and exists (
      select 1
      from unnest(target_evidence_media_asset_ids) media_id
      left join public.media_assets media on media.id = media_id
      where media.id is null
        or media.status <> 'active'
    ) then
    raise exception 'target_evidence_media_asset_ids must reference active media assets';
  end if;

  verification_event_id := public.record_verification_event(
    'verification.lpg.partner.fulfillment_scan',
    target_source,
    'asset',
    order_record.cylinder_id,
    'lpg.inspection',
    '{}'::jsonb,
    case when target_result = 'safe' then 'passed' when target_result = 'manual_review' then 'flagged' else 'failed' end,
    target_observations || jsonb_build_object('lpg_order_id', order_record.id, 'inspection_result', target_result),
    target_idempotency_key || ':verification',
    timezone('utc', now())
  );

  insert into public.lpg_cylinder_inspections (
    lpg_order_id,
    cylinder_id,
    station_branch_id,
    verification_event_id,
    result,
    evidence_media_asset_ids,
    observations,
    source,
    idempotency_key
  )
  values (
    order_record.id,
    order_record.cylinder_id,
    order_record.station_branch_id,
    verification_event_id,
    target_result,
    coalesce(target_evidence_media_asset_ids, array[]::uuid[]),
    target_observations,
    target_source,
    target_idempotency_key
  )
  on conflict (source, idempotency_key) do nothing
  returning id into inspection_id;

  if inspection_id is null then
    select existing.id
    into inspection_id
    from public.lpg_cylinder_inspections existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    return inspection_id;
  end if;

  if target_result in ('unsafe', 'rejected') then
    update public.lpg_cylinders
    set condition_status = 'unsafe',
        status = 'unsafe',
        updated_at = timezone('utc', now())
    where id = order_record.cylinder_id;

    update public.lpg_refill_orders
    set status = 'disputed',
        updated_at = timezone('utc', now())
    where id = order_record.id;

    update public.service_requests
    set status = 'disputed',
        updated_at = timezone('utc', now())
    where id = order_record.service_request_id;
  end if;

  perform public.record_lpg_order_event(
    order_record.id,
    'lpg.inspection.recorded',
    order_record.status,
    case when target_result in ('unsafe', 'rejected') then 'disputed' else order_record.status end,
    target_idempotency_key || ':event',
    target_observations || jsonb_build_object(
      'inspection_id',
      inspection_id,
      'verification_event_id',
      verification_event_id,
      'result',
      target_result
    )
  );

  perform public.record_lpg_cylinder_history(
    order_record.cylinder_id,
    'inspection',
    target_idempotency_key || ':cylinder-history',
    order_record.id,
    order_record.station_branch_id,
    order_record.driver_profile_id,
    null,
    target_observations || jsonb_build_object('result', target_result),
    '{}'::jsonb
  );

  return inspection_id;
end;
$$;

create or replace function public.process_lpg_order_action(
  target_lpg_order_id uuid,
  target_action_key text,
  target_idempotency_key text,
  target_payload jsonb default '{}'::jsonb,
  target_source text default 'lpg.order_action_api'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record record;
  action_record record;
  driver_record record;
  existing_event record;
  next_status text;
begin
  if target_lpg_order_id is null then
    raise exception 'target_lpg_order_id is required';
  end if;

  if target_action_key is null or target_action_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_action_key must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_payload is null or jsonb_typeof(target_payload) <> 'object' then
    raise exception 'target_payload must be a JSON object';
  end if;

  select event.*
  into existing_event
  from public.lpg_order_events event
  where event.lpg_order_id = target_lpg_order_id
    and event.idempotency_key = target_idempotency_key || ':event';

  if found then
    return target_lpg_order_id;
  end if;

  select action.*
  into action_record
  from public.lpg_order_action_definitions action
  where action.key = target_action_key
    and action.status = 'active';

  if not found then
    raise exception 'target_action_key must reference an active LPG order action definition';
  end if;

  select target_order.*
  into order_record
  from public.lpg_refill_orders target_order
  where target_order.id = target_lpg_order_id
  for update;

  if not found then
    raise exception 'target_lpg_order_id must reference an LPG order';
  end if;

  if not order_record.status = any(action_record.from_statuses) then
    raise exception 'LPG order action is not valid from the current status';
  end if;

  select driver.*
  into driver_record
  from public.driver_profiles driver
  where driver.id = order_record.driver_profile_id;

  if action_record.actor_scope = 'system' then
    if auth.role() <> 'service_role'
      and not public.can_manage_lpg_operations() then
      raise exception 'system LPG action permission is required';
    end if;
  elsif action_record.actor_scope = 'customer' then
    if auth.role() <> 'service_role'
      and auth.uid() is distinct from order_record.customer_user_id
      and not public.can_manage_lpg_operations() then
      raise exception 'customer LPG action permission is required';
    end if;
  elsif action_record.actor_scope = 'assigned_driver' then
    if auth.role() <> 'service_role'
      and driver_record.user_id is distinct from auth.uid()
      and not public.can_manage_lpg_operations() then
      raise exception 'assigned driver LPG action permission is required';
    end if;
  elsif action_record.actor_scope = 'station_scanner' then
    if not public.can_operate_lpg_station_branch(order_record.station_branch_id, 'lpg.stations.scan') then
      raise exception 'branch-scoped LPG scanner permission is required';
    end if;
  elsif action_record.actor_scope = 'station_pump' then
    if not public.can_operate_lpg_station_branch(order_record.station_branch_id, 'lpg.stations.pump') then
      raise exception 'branch-scoped LPG pump permission is required';
    end if;
  elsif action_record.actor_scope = 'station_finance' then
    if not public.can_operate_lpg_station_branch(order_record.station_branch_id, 'lpg.orders.finance') then
      raise exception 'branch-scoped LPG finance permission is required';
    end if;
  elsif action_record.actor_scope = 'station_ops' then
    if not public.can_operate_lpg_station_branch(order_record.station_branch_id, 'lpg.orders.manage') then
      raise exception 'branch-scoped LPG operations permission is required';
    end if;
  elsif action_record.actor_scope = 'lpg_admin' then
    if not public.can_manage_lpg_operations() then
      raise exception 'LPG operations permission is required';
    end if;
  elsif action_record.actor_scope = 'any' then
    if not public.can_access_lpg_order(order_record.id) then
      raise exception 'LPG order access permission is required';
    end if;
  end if;

  if action_record.requires_verified_challenge then
    if not public.lpg_delivery_challenge_is_verified(
      order_record.id,
      nullif(target_payload ->> 'deliveryChallengeId', '')::uuid
    ) then
      raise exception 'verified LPG delivery challenge is required';
    end if;
  end if;

  next_status := coalesce(action_record.to_status, order_record.status);

  update public.lpg_refill_orders
  set status = next_status,
      updated_at = timezone('utc', now())
  where id = order_record.id;

  update public.service_requests
  set status = case
        when next_status = 'completed' then 'completed'
        when next_status = 'cancelled' then 'cancelled'
        when next_status in ('pickup_en_route','station_en_route','refill_in_progress','return_en_route','delivery_verification_pending') then 'in_progress'
        else status
      end,
      updated_at = timezone('utc', now())
  where id = order_record.service_request_id;

  if order_record.order_record_id is not null then
    update public.order_records
    set status = case
          when next_status = 'completed' then 'completed'
          when next_status = 'cancelled' then 'cancelled'
          when next_status in ('refill_in_progress','station_verified') then 'preparing'
          when next_status = 'delivered' then 'fulfilled'
          else status
        end,
        preparing_at = case when next_status in ('refill_in_progress','station_verified') then coalesce(preparing_at, timezone('utc', now())) else preparing_at end,
        completed_at = case when next_status = 'completed' then timezone('utc', now()) else completed_at end,
        cancelled_at = case when next_status = 'cancelled' then timezone('utc', now()) else cancelled_at end,
        updated_at = timezone('utc', now())
    where id = order_record.order_record_id;
  end if;

  perform public.record_lpg_order_event(
    order_record.id,
    action_record.event_type,
    order_record.status,
    next_status,
    target_idempotency_key || ':event',
    target_payload || jsonb_build_object('action_key', target_action_key)
  );

  if target_action_key = 'lpg.cancel' then
    update public.lpg_station_capacity_reservations
    set status = case when status = 'consumed' then status else 'cancelled' end,
        updated_at = timezone('utc', now())
    where lpg_order_id = order_record.id
      and status in ('reserved', 'expired');

    update public.lpg_station_branches station
    set current_available_kg = station.current_available_kg + reservation.reserved_kg,
        availability_status = case when station.availability_status = 'capacity_reached' then 'available' else station.availability_status end,
        updated_at = timezone('utc', now())
    from public.lpg_station_capacity_reservations reservation
    where reservation.lpg_order_id = order_record.id
      and reservation.station_branch_id = station.id
      and reservation.status = 'cancelled';
  end if;

  return order_record.id;
end;
$$;

create or replace function public.request_lpg_delivery_challenge(
  target_lpg_order_id uuid,
  target_recipient_address text,
  target_idempotency_key text,
  target_channel text default 'in_app',
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'lpg.delivery_challenge_api'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record record;
  scan_policy jsonb;
  ttl_seconds integer;
  challenge_id uuid;
begin
  if target_lpg_order_id is null then
    raise exception 'target_lpg_order_id is required';
  end if;

  if target_recipient_address is null or btrim(target_recipient_address) = '' then
    raise exception 'target_recipient_address is required';
  end if;

  if target_channel not in ('sms', 'email', 'whatsapp', 'in_app') then
    raise exception 'target_channel is not supported for delivery challenges';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select target_order.*
  into order_record
  from public.lpg_refill_orders target_order
  where target_order.id = target_lpg_order_id
  for update;

  if not found then
    raise exception 'target_lpg_order_id must reference an LPG order';
  end if;

  if auth.role() <> 'service_role'
    and auth.uid() is distinct from order_record.customer_user_id
    and not public.can_manage_lpg_operations() then
    raise exception 'delivery challenge must be requested by the LPG order customer';
  end if;

  if order_record.status not in ('return_en_route', 'delivery_verification_pending') then
    raise exception 'delivery challenge cannot be requested from the current order status';
  end if;

  scan_policy := public.lpg_policy_config('lpg.scan.phase_one');
  ttl_seconds := nullif(scan_policy ->> 'delivery_challenge_ttl_seconds', '')::integer;

  if ttl_seconds is null or ttl_seconds < 60 or ttl_seconds > 1800 then
    raise exception 'LPG scan policy must define a valid delivery challenge TTL';
  end if;

  challenge_id := public.request_otp_challenge(
    'lpg.delivery.verification',
    target_channel,
    target_recipient_address,
    ttl_seconds,
    5,
    target_source,
    target_idempotency_key,
    target_metadata || jsonb_build_object(
      'lpg_order_id',
      order_record.id,
      'customer_user_id',
      order_record.customer_user_id
    )
  );

  update public.lpg_refill_orders
  set delivery_challenge_id = challenge_id,
      status = case when status = 'return_en_route' then 'delivery_verification_pending' else status end,
      updated_at = timezone('utc', now())
  where id = order_record.id;

  perform public.record_lpg_order_event(
    order_record.id,
    'lpg.delivery.challenge_requested',
    order_record.status,
    'delivery_verification_pending',
    target_idempotency_key || ':event',
    jsonb_build_object('challenge_id', challenge_id)
  );

  return challenge_id;
end;
$$;

create or replace function public.verify_lpg_delivery_challenge(
  target_lpg_order_id uuid,
  target_challenge_id uuid,
  target_code text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record record;
  verified_challenge_id uuid;
begin
  if target_lpg_order_id is null or target_challenge_id is null then
    raise exception 'target_lpg_order_id and target_challenge_id are required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select target_order.*
  into order_record
  from public.lpg_refill_orders target_order
  where target_order.id = target_lpg_order_id
  for update;

  if not found then
    raise exception 'target_lpg_order_id must reference an LPG order';
  end if;

  if auth.role() <> 'service_role'
    and auth.uid() is distinct from order_record.customer_user_id
    and not public.can_manage_lpg_operations() then
    raise exception 'delivery challenge can only be verified by the LPG order customer';
  end if;

  verified_challenge_id := public.verify_otp_challenge(
    target_challenge_id,
    target_code,
    target_idempotency_key,
    target_metadata || jsonb_build_object('lpg_order_id', order_record.id)
  );

  if not public.lpg_delivery_challenge_is_verified(order_record.id, target_challenge_id) then
    raise exception 'verified challenge does not belong to the LPG order';
  end if;

  update public.lpg_refill_orders
  set delivery_challenge_id = target_challenge_id,
      updated_at = timezone('utc', now())
  where id = order_record.id;

  perform public.record_lpg_order_event(
    order_record.id,
    'lpg.delivery.challenge_verified',
    order_record.status,
    order_record.status,
    target_idempotency_key || ':event',
    jsonb_build_object('challenge_id', verified_challenge_id)
  );

  return verified_challenge_id;
end;
$$;

create or replace function public.settle_lpg_station_order(
  target_lpg_order_id uuid,
  target_idempotency_key text,
  target_station_wallet_id uuid default null,
  target_platform_wallet_id uuid default null,
  target_actor_user_id uuid default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'lpg.station_settlement_api'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record record;
  station_record record;
  actor_user_id uuid;
  order_record_id uuid;
  station_wallet_id uuid;
  platform_wallet_id uuid;
  customer_wallet_id uuid;
  quote_station_amount numeric(28, 8);
  actual_station_amount numeric(28, 8);
  tax_amount numeric(28, 8);
  delivery_margin_amount numeric(28, 8);
  platform_release_amount numeric(28, 8);
  underfill_refund_amount numeric(28, 8);
  refund_transaction_id uuid;
  settlement_execution_id uuid;
  settlement_statement_id uuid;
  distribution jsonb := '[]'::jsonb;
begin
  if target_lpg_order_id is null then
    raise exception 'target_lpg_order_id is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  actor_user_id := coalesce(target_actor_user_id, auth.uid());

  select target_order.*
  into order_record
  from public.lpg_refill_orders target_order
  where target_order.id = target_lpg_order_id
  for update;

  if not found then
    raise exception 'target_lpg_order_id must reference an LPG order';
  end if;

  if order_record.station_settlement_execution_id is not null then
    return order_record.station_settlement_execution_id;
  end if;

  if order_record.status <> 'refill_confirmed' then
    raise exception 'LPG station settlement requires a confirmed refill';
  end if;

  if order_record.escrow_hold_id is null then
    raise exception 'LPG order must have a reserved escrow hold before settlement';
  end if;

  select station.*
  into station_record
  from public.lpg_station_branches station
  where station.id = order_record.station_branch_id;

  if not found then
    raise exception 'LPG station branch is required before settlement';
  end if;

  if auth.role() = 'service_role' then
    if actor_user_id is not null
      and not public.user_can_operate_lpg_station_branch(actor_user_id, station_record.id, 'lpg.orders.finance')
      and not public.user_can_operate_lpg_station_branch(actor_user_id, station_record.id, 'lpg.stations.manage') then
      raise exception 'branch-scoped LPG finance actor permission is required';
    end if;
  elsif not public.can_operate_lpg_station_branch(station_record.id, 'lpg.orders.finance') then
    raise exception 'branch-scoped LPG finance permission is required';
  end if;

  select quote.lpg_amount
  into quote_station_amount
  from public.lpg_refill_quotes quote
  where quote.id = order_record.lpg_refill_quote_id;

  if quote_station_amount is null then
    raise exception 'LPG quote amount is required for settlement';
  end if;

  if order_record.station_amount > quote_station_amount then
    insert into public.lpg_order_financial_adjustments (
      lpg_order_id,
      adjustment_type,
      currency_code,
      amount,
      status,
      reason_key,
      metadata,
      source,
      idempotency_key
    )
    values (
      order_record.id,
      'overfill_blocked',
      order_record.currency_code,
      order_record.station_amount - quote_station_amount,
      'blocked',
      'lpg.overfill.manual_review',
      target_metadata,
      target_source,
      target_idempotency_key || ':overfill'
    )
    on conflict (source, idempotency_key) do nothing;

    raise exception 'LPG overfill is blocked for manual review in phase one';
  end if;

  order_record_id := public.ensure_lpg_order_record(
    order_record.id,
    target_idempotency_key || ':order-record',
    'lpg.order_projection',
    target_metadata
  );

  station_wallet_id := coalesce(
    target_station_wallet_id,
    public.ensure_wallet_account(
      'partner',
      'organization',
      station_record.organization_id,
      order_record.currency_code,
      'lpg.wallet_engine',
      jsonb_build_object('wallet_purpose', 'lpg_station_settlement', 'station_branch_id', station_record.id),
      target_idempotency_key || ':station-wallet'
    )
  );

  platform_wallet_id := coalesce(
    target_platform_wallet_id,
    public.ensure_platform_clearing_wallet(
      order_record.currency_code,
      'lpg.wallet_engine',
      target_idempotency_key || ':platform-wallet'
    )
  );

  select wallet.id
  into customer_wallet_id
  from public.wallet_accounts wallet
  where wallet.wallet_type = 'customer'
    and wallet.owner_entity_type = 'user'
    and wallet.owner_entity_id = order_record.customer_user_id
    and wallet.currency_code = order_record.currency_code
    and wallet.status = 'active'
  order by wallet.created_at asc
  limit 1;

  if customer_wallet_id is null then
    customer_wallet_id := public.ensure_wallet_account(
      'customer',
      'user',
      order_record.customer_user_id,
      order_record.currency_code,
      'lpg.wallet_engine',
      '{"wallet_purpose":"lpg_refund"}'::jsonb,
      target_idempotency_key || ':customer-wallet'
    );
  end if;

  actual_station_amount := order_record.station_amount;
  underfill_refund_amount := greatest(quote_station_amount - actual_station_amount, 0);
  tax_amount := greatest(order_record.total_amount - quote_station_amount - order_record.delivery_fee_amount - order_record.platform_fee_amount, 0);
  delivery_margin_amount := greatest(order_record.delivery_fee_amount - order_record.driver_commission_amount, 0);
  platform_release_amount := order_record.platform_fee_amount + tax_amount + delivery_margin_amount;

  if underfill_refund_amount > 0 then
    refund_transaction_id := public.return_escrow_hold_amount(
      order_record.escrow_hold_id,
      customer_wallet_id,
      underfill_refund_amount,
      target_idempotency_key || ':underfill-refund',
      'lpg.refund_engine',
      target_metadata || jsonb_build_object('refund_reason', 'lpg.underfill')
    );

    insert into public.lpg_order_financial_adjustments (
      lpg_order_id,
      adjustment_type,
      currency_code,
      amount,
      transaction_id,
      status,
      reason_key,
      metadata,
      source,
      idempotency_key
    )
    values (
      order_record.id,
      'underfill_refund',
      order_record.currency_code,
      underfill_refund_amount,
      refund_transaction_id,
      'posted',
      'lpg.underfill.automatic',
      target_metadata,
      'lpg.refund_engine',
      target_idempotency_key || ':underfill-adjustment'
    )
    on conflict (source, idempotency_key) do nothing;
  end if;

  if actual_station_amount > 0 then
    distribution := distribution || jsonb_build_array(
      jsonb_build_object(
        'wallet_id', station_wallet_id,
        'amount', actual_station_amount,
        'entry_type', 'principal',
        'metadata', jsonb_build_object('role', 'station_refill')
      )
    );
  end if;

  if platform_release_amount > 0 then
    distribution := distribution || jsonb_build_array(
      jsonb_build_object(
        'wallet_id', platform_wallet_id,
        'amount', platform_release_amount,
        'entry_type', 'fee',
        'metadata', jsonb_build_object(
          'role',
          'platform',
          'platform_fee_amount',
          order_record.platform_fee_amount,
          'tax_amount',
          tax_amount,
          'delivery_margin_amount',
          delivery_margin_amount
        )
      )
    );
  end if;

  if jsonb_array_length(distribution) = 0 then
    raise exception 'station settlement distribution cannot be empty';
  end if;

  settlement_execution_id := public.execute_service_request_settlement(
    order_record.service_request_id,
    order_record.escrow_hold_id,
    distribution,
    target_idempotency_key || ':settlement',
    'lpg.settlement_engine',
    target_metadata || jsonb_build_object(
      'lpg_order_id',
      order_record.id,
      'policy_snapshot',
      public.lpg_policy_config('lpg.settlement.phase_one')
    )
  );

  insert into public.settlement_statements (
    organization_id,
    service_request_id,
    order_id,
    escrow_hold_id,
    settlement_execution_id,
    currency_code,
    gross_amount,
    platform_fee_amount,
    net_amount,
    status,
    period_start,
    period_end,
    source,
    idempotency_key,
    metadata,
    created_by
  )
  values (
    station_record.organization_id,
    order_record.service_request_id,
    order_record_id,
    order_record.escrow_hold_id,
    settlement_execution_id,
    order_record.currency_code,
    actual_station_amount,
    0,
    actual_station_amount,
    'posted',
    timezone('utc', now()),
    timezone('utc', now()),
    target_source,
    target_idempotency_key || ':statement',
    target_metadata || jsonb_build_object('lpg_order_id', order_record.id),
    actor_user_id
  )
  on conflict (source, idempotency_key) do nothing
  returning id into settlement_statement_id;

  if settlement_statement_id is null then
    select statement.id
    into settlement_statement_id
    from public.settlement_statements statement
    where statement.source = target_source
      and statement.idempotency_key = target_idempotency_key || ':statement';
  end if;

  update public.lpg_refill_orders
  set status = 'station_settled',
      station_settlement_execution_id = settlement_execution_id,
      station_settlement_statement_id = settlement_statement_id,
      underfill_refund_transaction_id = refund_transaction_id,
      updated_at = timezone('utc', now())
  where id = order_record.id;

  perform public.record_lpg_order_event(
    order_record.id,
    'lpg.station.settled',
    order_record.status,
    'station_settled',
    target_idempotency_key || ':event',
    target_metadata || jsonb_build_object(
      'settlement_execution_id',
      settlement_execution_id,
      'settlement_statement_id',
      settlement_statement_id,
      'underfill_refund_transaction_id',
      refund_transaction_id
    )
  );

  return settlement_execution_id;
end;
$$;

create or replace function public.execute_lpg_driver_commission(
  target_lpg_order_id uuid,
  target_idempotency_key text,
  target_driver_wallet_id uuid default null,
  target_actor_user_id uuid default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'lpg.driver_commission_api'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record record;
  driver_record record;
  actor_user_id uuid;
  order_record_id uuid;
  driver_wallet_id uuid;
  commission_execution_id uuid;
  commission_policy_key text;
begin
  if target_lpg_order_id is null then
    raise exception 'target_lpg_order_id is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  actor_user_id := coalesce(target_actor_user_id, auth.uid());

  select target_order.*
  into order_record
  from public.lpg_refill_orders target_order
  where target_order.id = target_lpg_order_id
  for update;

  if not found then
    raise exception 'target_lpg_order_id must reference an LPG order';
  end if;

  if order_record.driver_commission_execution_id is not null then
    return order_record.driver_commission_execution_id;
  end if;

  if order_record.status <> 'delivered' then
    raise exception 'driver commission requires verified LPG delivery';
  end if;

  if order_record.station_settlement_execution_id is null then
    raise exception 'station settlement must be posted before driver commission';
  end if;

  select driver.*
  into driver_record
  from public.driver_profiles driver
  where driver.id = order_record.driver_profile_id;

  if not found then
    raise exception 'assigned LPG driver is required';
  end if;

  if auth.role() = 'service_role' then
    if actor_user_id is not null
      and actor_user_id is distinct from driver_record.user_id
      and not exists (
        select 1
        from public.lpg_station_branches station
        where station.id = order_record.station_branch_id
          and public.user_can_operate_lpg_station_branch(actor_user_id, station.id, 'lpg.orders.finance')
      ) then
      raise exception 'driver or branch finance actor is required for LPG commission execution';
    end if;
  elsif auth.uid() is distinct from driver_record.user_id
    and not public.can_operate_lpg_station_branch(order_record.station_branch_id, 'lpg.orders.finance')
    and not public.can_manage_lpg_operations() then
    raise exception 'driver or LPG finance permission is required';
  end if;

  order_record_id := public.ensure_lpg_order_record(
    order_record.id,
    target_idempotency_key || ':order-record',
    'lpg.order_projection',
    target_metadata
  );

  driver_wallet_id := coalesce(
    target_driver_wallet_id,
    public.ensure_wallet_account(
      'driver',
      'driver',
      order_record.driver_profile_id,
      order_record.currency_code,
      'lpg.wallet_engine',
      jsonb_build_object('wallet_purpose', 'lpg_driver_commission'),
      target_idempotency_key || ':driver-wallet'
    )
  );

  commission_policy_key := public.lpg_policy_config('lpg.settlement.phase_one') ->> 'driver_commission_policy_key';

  if commission_policy_key is null then
    raise exception 'LPG settlement policy must define driver commission policy key';
  end if;

  commission_execution_id := public.execute_driver_commission(
    order_record_id,
    order_record.escrow_hold_id,
    driver_wallet_id,
    commission_policy_key,
    order_record.driver_commission_amount,
    'lpg.commission_engine',
    target_idempotency_key || ':commission',
    target_metadata || jsonb_build_object('lpg_order_id', order_record.id)
  );

  update public.lpg_refill_orders
  set driver_commission_execution_id = commission_execution_id,
      status = 'completed',
      updated_at = timezone('utc', now())
  where id = order_record.id;

  update public.order_records
  set status = 'completed',
      completed_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = order_record_id;

  update public.service_requests
  set status = 'settled',
      updated_at = timezone('utc', now())
  where id = order_record.service_request_id;

  perform public.record_lpg_order_event(
    order_record.id,
    'lpg.driver.commission_executed',
    order_record.status,
    'completed',
    target_idempotency_key || ':event',
    target_metadata || jsonb_build_object('commission_execution_id', commission_execution_id)
  );

  return commission_execution_id;
end;
$$;

create or replace function public.refund_lpg_order_payment(
  target_lpg_order_id uuid,
  target_idempotency_key text,
  target_refund_amount numeric default null,
  target_reason_key text default 'lpg.refund.manual',
  target_actor_user_id uuid default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'lpg.refund_api'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record record;
  actor_user_id uuid;
  customer_wallet_id uuid;
  hold_record record;
  remaining_amount numeric(28, 8);
  refund_amount numeric(28, 8);
  refund_transaction_id uuid;
begin
  if target_lpg_order_id is null then
    raise exception 'target_lpg_order_id is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_reason_key is null or target_reason_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_reason_key must be a valid platform key';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  actor_user_id := coalesce(target_actor_user_id, auth.uid());

  select target_order.*
  into order_record
  from public.lpg_refill_orders target_order
  where target_order.id = target_lpg_order_id
  for update;

  if not found then
    raise exception 'target_lpg_order_id must reference an LPG order';
  end if;

  if auth.role() = 'service_role' then
    if actor_user_id is not null
      and actor_user_id is distinct from order_record.customer_user_id
      and not exists (
        select 1
        from public.lpg_station_branches station
        where station.id = order_record.station_branch_id
          and public.user_can_operate_lpg_station_branch(actor_user_id, station.id, 'lpg.orders.finance')
      ) then
      raise exception 'customer or LPG finance actor is required for refunds';
    end if;
  elsif auth.uid() is distinct from order_record.customer_user_id
    and not public.can_operate_lpg_station_branch(order_record.station_branch_id, 'lpg.orders.finance')
    and not public.can_manage_lpg_operations() then
    raise exception 'customer or LPG finance permission is required';
  end if;

  if order_record.escrow_hold_id is null then
    raise exception 'LPG order does not have an escrow hold';
  end if;

  select hold.*
  into hold_record
  from public.escrow_holds hold
  where hold.id = order_record.escrow_hold_id;

  if not found then
    raise exception 'LPG order escrow hold was not found';
  end if;

  remaining_amount := hold_record.hold_amount - hold_record.released_amount;
  refund_amount := coalesce(target_refund_amount, remaining_amount);

  if refund_amount <= 0 or refund_amount > remaining_amount then
    raise exception 'target_refund_amount must be within the refundable escrow balance';
  end if;

  select wallet.id
  into customer_wallet_id
  from public.wallet_accounts wallet
  where wallet.wallet_type = 'customer'
    and wallet.owner_entity_type = 'user'
    and wallet.owner_entity_id = order_record.customer_user_id
    and wallet.currency_code = order_record.currency_code
    and wallet.status = 'active'
  order by wallet.created_at asc
  limit 1;

  if customer_wallet_id is null then
    customer_wallet_id := public.ensure_wallet_account(
      'customer',
      'user',
      order_record.customer_user_id,
      order_record.currency_code,
      'lpg.wallet_engine',
      '{"wallet_purpose":"lpg_refund"}'::jsonb,
      target_idempotency_key || ':customer-wallet'
    );
  end if;

  if refund_amount = remaining_amount then
    refund_transaction_id := public.refund_escrow_hold(
      order_record.escrow_hold_id,
      customer_wallet_id,
      target_idempotency_key || ':refund',
      target_metadata || jsonb_build_object('refund_reason_key', target_reason_key)
    );
  else
    refund_transaction_id := public.return_escrow_hold_amount(
      order_record.escrow_hold_id,
      customer_wallet_id,
      refund_amount,
      target_idempotency_key || ':refund',
      'lpg.refund_engine',
      target_metadata || jsonb_build_object('refund_reason_key', target_reason_key)
    );
  end if;

  insert into public.lpg_order_financial_adjustments (
    lpg_order_id,
    adjustment_type,
    currency_code,
    amount,
    transaction_id,
    status,
    reason_key,
    metadata,
    source,
    idempotency_key
  )
  values (
    order_record.id,
    case when target_reason_key = 'lpg.refund.cancellation' then 'cancellation_refund' else 'manual_refund' end,
    order_record.currency_code,
    refund_amount,
    refund_transaction_id,
    'posted',
    target_reason_key,
    target_metadata,
    target_source,
    target_idempotency_key || ':adjustment'
  )
  on conflict (source, idempotency_key) do nothing;

  if refund_amount = remaining_amount then
    update public.lpg_refill_orders
    set status = 'refunded',
        payment_status = 'refunded',
        updated_at = timezone('utc', now())
    where id = order_record.id;

    update public.lpg_station_capacity_reservations
    set status = case when status = 'consumed' then status else 'released' end,
        updated_at = timezone('utc', now())
    where lpg_order_id = order_record.id
      and status in ('reserved', 'cancelled', 'expired');
  end if;

  perform public.record_lpg_order_event(
    order_record.id,
    'lpg.refund.executed',
    order_record.status,
    case when refund_amount = remaining_amount then 'refunded' else order_record.status end,
    target_idempotency_key || ':event',
    target_metadata || jsonb_build_object('refund_transaction_id', refund_transaction_id, 'amount', refund_amount)
  );

  return refund_transaction_id;
end;
$$;

create or replace function public.reconcile_lpg_order_financials(target_lpg_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record record;
  generic_summary jsonb;
  adjustment_total numeric(28, 8);
begin
  if target_lpg_order_id is null then
    raise exception 'target_lpg_order_id is required';
  end if;

  select target_order.*
  into order_record
  from public.lpg_refill_orders target_order
  where target_order.id = target_lpg_order_id;

  if not found then
    raise exception 'target_lpg_order_id must reference an LPG order';
  end if;

  if auth.role() <> 'service_role'
    and not public.can_access_lpg_order(order_record.id)
    and not public.has_permission('platform.settlement.read', null) then
    raise exception 'LPG order financial summary permission is required';
  end if;

  generic_summary := public.reconcile_service_request_financials(order_record.service_request_id);

  select coalesce(sum(adjustment.amount), 0)
  into adjustment_total
  from public.lpg_order_financial_adjustments adjustment
  where adjustment.lpg_order_id = order_record.id
    and adjustment.status = 'posted';

  return generic_summary || jsonb_build_object(
    'lpg_order_id', order_record.id,
    'order_record_id', order_record.order_record_id,
    'public_reference', order_record.public_reference,
    'lpg_status', order_record.status,
    'requested_kg', order_record.requested_kg,
    'actual_kg', order_record.actual_kg,
    'station_amount', order_record.station_amount,
    'delivery_fee_amount', order_record.delivery_fee_amount,
    'platform_fee_amount', order_record.platform_fee_amount,
    'driver_commission_amount', order_record.driver_commission_amount,
    'posted_adjustment_total', adjustment_total,
    'station_settlement_execution_id', order_record.station_settlement_execution_id,
    'driver_commission_execution_id', order_record.driver_commission_execution_id
  );
end;
$$;

create or replace function public.read_lpg_jobs(
  target_queue text default null,
  target_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_limit integer;
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  if target_queue is not null
    and target_queue not in ('customer', 'driver', 'station', 'admin') then
    raise exception 'target_queue is not supported';
  end if;

  resolved_limit := least(greatest(coalesce(target_limit, 50), 1), 200);

  return coalesce((
    select jsonb_agg(job_payload order by (job_payload ->> 'updatedAt') desc)
    from (
      select jsonb_build_object(
        'queue', resolved.queue_name,
        'lpgOrderId', resolved.id,
        'publicReference', resolved.public_reference,
        'status', resolved.status,
        'assignmentStatus', resolved.assignment_status,
        'stationBranchId', resolved.station_branch_id,
        'driverProfileId', resolved.driver_profile_id,
        'requestedKg', resolved.requested_kg,
        'actualKg', resolved.actual_kg,
        'updatedAt', resolved.updated_at,
        'metadata', resolved.metadata
      ) as job_payload
      from (
        select 'customer' as queue_name, target_order.*
        from public.lpg_refill_orders target_order
        where (target_queue is null or target_queue = 'customer')
          and target_order.customer_user_id = auth.uid()
          and target_order.status not in ('completed', 'cancelled', 'refunded', 'failed')

        union all

        select 'driver' as queue_name, target_order.*
        from public.lpg_refill_orders target_order
        join public.driver_profiles driver on driver.id = target_order.driver_profile_id
        where (target_queue is null or target_queue = 'driver')
          and driver.user_id = auth.uid()
          and target_order.status not in ('completed', 'cancelled', 'refunded', 'failed')

        union all

        select 'station' as queue_name, target_order.*
        from public.lpg_refill_orders target_order
        join public.lpg_station_branches station on station.id = target_order.station_branch_id
        where (target_queue is null or target_queue = 'station')
          and public.user_can_operate_lpg_station_branch(auth.uid(), station.id, 'lpg.orders.read')
          and target_order.status not in ('completed', 'cancelled', 'refunded', 'failed')

        union all

        select 'admin' as queue_name, target_order.*
        from public.lpg_refill_orders target_order
        where (target_queue is null or target_queue = 'admin')
          and (auth.role() = 'service_role' or public.can_manage_lpg_operations())
          and target_order.status not in ('completed', 'cancelled', 'refunded', 'failed')
      ) resolved
      order by resolved.updated_at desc
      limit resolved_limit
    ) jobs
  ), '[]'::jsonb);
end;
$$;

create or replace function public.queue_lpg_order_status_notifications(
  target_lpg_order_id uuid,
  target_idempotency_key text,
  target_source text default 'lpg.lifecycle_worker'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record record;
  driver_user_id uuid;
  station_org_id uuid;
  notification_policy jsonb;
  channel_name text;
  provider_key text;
  queued_count integer := 0;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.communications.manage', null)
    and not public.can_manage_lpg_operations() then
    raise exception 'communication management permission is required';
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
  where target_order.id = target_lpg_order_id;

  if not found then
    raise exception 'target_lpg_order_id must reference an LPG order';
  end if;

  notification_policy := public.lpg_policy_config('lpg.notification.phase_one');
  channel_name := notification_policy ->> 'channel';
  provider_key := notification_policy ->> 'provider_adapter_key';

  if channel_name is null or provider_key is null then
    raise exception 'LPG notification policy is incomplete';
  end if;

  select driver.user_id
  into driver_user_id
  from public.driver_profiles driver
  where driver.id = order_record.driver_profile_id;

  select station.organization_id
  into station_org_id
  from public.lpg_station_branches station
  where station.id = order_record.station_branch_id;

  perform public.queue_communication_message(
    channel_name,
    'lpg.order.' || order_record.status,
    'user',
    order_record.customer_user_id,
    null,
    jsonb_build_object('lpg_order_id', order_record.id, 'public_reference', order_record.public_reference, 'status', order_record.status),
    provider_key,
    target_source,
    target_idempotency_key || ':customer:' || order_record.status,
    jsonb_build_object('recipient_role', 'customer')
  );
  queued_count := queued_count + 1;

  if driver_user_id is not null and order_record.status in ('driver_offered','driver_accepted','pickup_en_route','return_en_route','delivery_verification_pending','delivered','completed') then
    perform public.queue_communication_message(
      channel_name,
      'lpg.order.' || order_record.status,
      'user',
      driver_user_id,
      null,
      jsonb_build_object('lpg_order_id', order_record.id, 'public_reference', order_record.public_reference, 'status', order_record.status),
      provider_key,
      target_source,
      target_idempotency_key || ':driver:' || order_record.status,
      jsonb_build_object('recipient_role', 'driver')
    );
    queued_count := queued_count + 1;
  end if;

  if station_org_id is not null and order_record.status in ('driver_offered','driver_accepted','pickup_verified','station_verified','refill_confirmed','station_settled','completed','refunded','disputed') then
    perform public.queue_communication_message(
      channel_name,
      'lpg.order.' || order_record.status,
      'organization',
      station_org_id,
      null,
      jsonb_build_object('lpg_order_id', order_record.id, 'public_reference', order_record.public_reference, 'status', order_record.status),
      provider_key,
      target_source,
      target_idempotency_key || ':station:' || order_record.status,
      jsonb_build_object('recipient_role', 'station')
    );
    queued_count := queued_count + 1;
  end if;

  return queued_count;
end;
$$;

create or replace function public.process_lpg_order_lifecycle(target_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_limit integer;
  order_record record;
  processed_dispatch_count integer := 0;
  expired_offer_count integer := 0;
  notification_count integer := 0;
  dispatch_error text;
begin
  if auth.role() <> 'service_role'
    and not public.can_manage_lpg_operations()
    and not public.can_execute_platform_runtime() then
    raise exception 'LPG lifecycle worker permission is required';
  end if;

  resolved_limit := least(greatest(coalesce(target_limit, 50), 1), 200);

  for order_record in
    select target_order.*
    from public.lpg_refill_orders target_order
    where target_order.status = 'payment_reserved'
      and not (target_order.metadata ? 'dispatch_request_id')
    order by target_order.updated_at asc
    limit resolved_limit
  loop
    begin
      perform public.dispatch_lpg_order(
        order_record.id,
        (public.lpg_policy_config('lpg.dispatch.phase_one') ->> 'candidate_limit')::integer,
        'lpg.lifecycle:' || order_record.id::text || ':dispatch',
        'lpg.lifecycle_worker'
      );
      processed_dispatch_count := processed_dispatch_count + 1;
    exception when others then
      dispatch_error := sqlerrm;
      perform public.record_lpg_order_event(
        order_record.id,
        'lpg.lifecycle.dispatch_deferred',
        order_record.status,
        order_record.status,
        'lpg.lifecycle:' || order_record.id::text || ':dispatch-deferred',
        jsonb_build_object('error', dispatch_error)
      );
    end;
  end loop;

  for order_record in
    select target_order.*
    from public.lpg_refill_orders target_order
    where target_order.status = 'driver_offered'
      and nullif(target_order.metadata ->> 'driver_offer_expires_at', '')::timestamptz <= timezone('utc', now())
    order by target_order.updated_at asc
    limit resolved_limit
  loop
    update public.dispatch_candidates
    set status = 'expired',
        updated_at = timezone('utc', now())
    where dispatch_request_id = nullif(order_record.metadata ->> 'dispatch_request_id', '')::uuid
      and candidate_entity_type = 'driver'
      and status = 'offered';

    update public.dispatch_requests
    set status = 'expired',
        updated_at = timezone('utc', now())
    where id = nullif(order_record.metadata ->> 'dispatch_request_id', '')::uuid;

    update public.lpg_station_capacity_reservations
    set status = 'expired',
        updated_at = timezone('utc', now())
    where lpg_order_id = order_record.id
      and status = 'reserved';

    update public.lpg_station_branches station
    set current_available_kg = station.current_available_kg + reservation.reserved_kg,
        availability_status = case when station.availability_status = 'capacity_reached' then 'available' else station.availability_status end,
        updated_at = timezone('utc', now())
    from public.lpg_station_capacity_reservations reservation
    where reservation.lpg_order_id = order_record.id
      and reservation.station_branch_id = station.id
      and reservation.status = 'expired';

    update public.lpg_refill_orders
    set status = 'payment_reserved',
        assignment_status = 'station_assigned',
        driver_profile_id = null,
        vehicle_id = null,
        metadata = metadata - 'dispatch_request_id' - 'dispatch_idempotency_key' - 'driver_offer_expires_at' - 'capacity_reservation_id',
        updated_at = timezone('utc', now())
    where id = order_record.id;

    perform public.record_lpg_order_event(
      order_record.id,
      'lpg.dispatch.offer_expired',
      'driver_offered',
      'payment_reserved',
      'lpg.lifecycle:' || order_record.id::text || ':offer-expired',
      jsonb_build_object('expired_at', timezone('utc', now()))
    );

    expired_offer_count := expired_offer_count + 1;
  end loop;

  for order_record in
    select target_order.*
    from public.lpg_refill_orders target_order
    where target_order.status in ('payment_reserved','driver_offered','driver_accepted','pickup_verified','station_verified','refill_confirmed','station_settled','delivery_verification_pending','delivered','completed','refunded','disputed')
    order by target_order.updated_at desc
    limit resolved_limit
  loop
    notification_count := notification_count + public.queue_lpg_order_status_notifications(
      order_record.id,
      'lpg.lifecycle:' || order_record.id::text || ':notify:' || order_record.status,
      'lpg.lifecycle_worker'
    );
  end loop;

  return jsonb_build_object(
    'dispatched', processed_dispatch_count,
    'expiredOffers', expired_offer_count,
    'notificationsQueued', notification_count
  );
end;
$$;

alter table public.lpg_cylinder_type_profiles enable row level security;
alter table public.lpg_operation_policies enable row level security;
alter table public.lpg_station_role_presets enable row level security;
alter table public.lpg_station_capacity_reservations enable row level security;
alter table public.lpg_order_financial_adjustments enable row level security;
alter table public.lpg_cylinder_inspections enable row level security;
alter table public.lpg_order_action_definitions enable row level security;

drop policy if exists lpg_cylinder_type_profiles_select_active_or_config on public.lpg_cylinder_type_profiles;
drop policy if exists lpg_cylinder_type_profiles_no_direct_insert on public.lpg_cylinder_type_profiles;
drop policy if exists lpg_cylinder_type_profiles_no_direct_update on public.lpg_cylinder_type_profiles;
drop policy if exists lpg_cylinder_type_profiles_no_direct_delete on public.lpg_cylinder_type_profiles;
drop policy if exists lpg_operation_policies_select_active_or_config on public.lpg_operation_policies;
drop policy if exists lpg_operation_policies_no_direct_insert on public.lpg_operation_policies;
drop policy if exists lpg_operation_policies_no_direct_update on public.lpg_operation_policies;
drop policy if exists lpg_operation_policies_no_direct_delete on public.lpg_operation_policies;
drop policy if exists lpg_station_role_presets_select_active_or_config on public.lpg_station_role_presets;
drop policy if exists lpg_station_role_presets_no_direct_insert on public.lpg_station_role_presets;
drop policy if exists lpg_station_role_presets_no_direct_update on public.lpg_station_role_presets;
drop policy if exists lpg_station_role_presets_no_direct_delete on public.lpg_station_role_presets;
drop policy if exists lpg_capacity_reservations_select_related on public.lpg_station_capacity_reservations;
drop policy if exists lpg_capacity_reservations_no_direct_insert on public.lpg_station_capacity_reservations;
drop policy if exists lpg_capacity_reservations_no_direct_update on public.lpg_station_capacity_reservations;
drop policy if exists lpg_capacity_reservations_no_direct_delete on public.lpg_station_capacity_reservations;
drop policy if exists lpg_financial_adjustments_select_related on public.lpg_order_financial_adjustments;
drop policy if exists lpg_financial_adjustments_no_direct_insert on public.lpg_order_financial_adjustments;
drop policy if exists lpg_financial_adjustments_no_direct_update on public.lpg_order_financial_adjustments;
drop policy if exists lpg_financial_adjustments_no_direct_delete on public.lpg_order_financial_adjustments;
drop policy if exists lpg_cylinder_inspections_select_related on public.lpg_cylinder_inspections;
drop policy if exists lpg_cylinder_inspections_no_direct_insert on public.lpg_cylinder_inspections;
drop policy if exists lpg_cylinder_inspections_no_direct_update on public.lpg_cylinder_inspections;
drop policy if exists lpg_cylinder_inspections_no_direct_delete on public.lpg_cylinder_inspections;
drop policy if exists lpg_order_action_definitions_select_active_or_config on public.lpg_order_action_definitions;
drop policy if exists lpg_order_action_definitions_no_direct_insert on public.lpg_order_action_definitions;
drop policy if exists lpg_order_action_definitions_no_direct_update on public.lpg_order_action_definitions;
drop policy if exists lpg_order_action_definitions_no_direct_delete on public.lpg_order_action_definitions;

create policy lpg_cylinder_type_profiles_select_active_or_config
on public.lpg_cylinder_type_profiles
for select to authenticated
using (status = 'active' or public.has_permission('lpg.config.read', null) or public.can_manage_lpg_operations());

create policy lpg_cylinder_type_profiles_no_direct_insert
on public.lpg_cylinder_type_profiles
for insert to authenticated
with check (false);

create policy lpg_cylinder_type_profiles_no_direct_update
on public.lpg_cylinder_type_profiles
for update to authenticated
using (false)
with check (false);

create policy lpg_cylinder_type_profiles_no_direct_delete
on public.lpg_cylinder_type_profiles
for delete to authenticated
using (false);

create policy lpg_operation_policies_select_active_or_config
on public.lpg_operation_policies
for select to authenticated
using (status = 'active' or public.has_permission('lpg.config.read', null) or public.can_manage_lpg_operations());

create policy lpg_operation_policies_no_direct_insert
on public.lpg_operation_policies
for insert to authenticated
with check (false);

create policy lpg_operation_policies_no_direct_update
on public.lpg_operation_policies
for update to authenticated
using (false)
with check (false);

create policy lpg_operation_policies_no_direct_delete
on public.lpg_operation_policies
for delete to authenticated
using (false);

create policy lpg_station_role_presets_select_active_or_config
on public.lpg_station_role_presets
for select to authenticated
using (status = 'active' or public.has_permission('lpg.config.read', null) or public.can_manage_lpg_operations());

create policy lpg_station_role_presets_no_direct_insert
on public.lpg_station_role_presets
for insert to authenticated
with check (false);

create policy lpg_station_role_presets_no_direct_update
on public.lpg_station_role_presets
for update to authenticated
using (false)
with check (false);

create policy lpg_station_role_presets_no_direct_delete
on public.lpg_station_role_presets
for delete to authenticated
using (false);

create policy lpg_capacity_reservations_select_related
on public.lpg_station_capacity_reservations
for select to authenticated
using (
  public.can_access_lpg_order(lpg_order_id)
  or public.can_operate_lpg_station_branch(station_branch_id, 'lpg.orders.read')
);

create policy lpg_capacity_reservations_no_direct_insert
on public.lpg_station_capacity_reservations
for insert to authenticated
with check (false);

create policy lpg_capacity_reservations_no_direct_update
on public.lpg_station_capacity_reservations
for update to authenticated
using (false)
with check (false);

create policy lpg_capacity_reservations_no_direct_delete
on public.lpg_station_capacity_reservations
for delete to authenticated
using (false);

create policy lpg_financial_adjustments_select_related
on public.lpg_order_financial_adjustments
for select to authenticated
using (public.can_access_lpg_order(lpg_order_id));

create policy lpg_financial_adjustments_no_direct_insert
on public.lpg_order_financial_adjustments
for insert to authenticated
with check (false);

create policy lpg_financial_adjustments_no_direct_update
on public.lpg_order_financial_adjustments
for update to authenticated
using (false)
with check (false);

create policy lpg_financial_adjustments_no_direct_delete
on public.lpg_order_financial_adjustments
for delete to authenticated
using (false);

create policy lpg_cylinder_inspections_select_related
on public.lpg_cylinder_inspections
for select to authenticated
using (
  (lpg_order_id is not null and public.can_access_lpg_order(lpg_order_id))
  or exists (
    select 1
    from public.lpg_cylinders cylinder
    where cylinder.id = lpg_cylinder_inspections.cylinder_id
      and cylinder.owner_user_id = auth.uid()
  )
  or (station_branch_id is not null and public.can_operate_lpg_station_branch(station_branch_id, 'lpg.orders.read'))
);

create policy lpg_cylinder_inspections_no_direct_insert
on public.lpg_cylinder_inspections
for insert to authenticated
with check (false);

create policy lpg_cylinder_inspections_no_direct_update
on public.lpg_cylinder_inspections
for update to authenticated
using (false)
with check (false);

create policy lpg_cylinder_inspections_no_direct_delete
on public.lpg_cylinder_inspections
for delete to authenticated
using (false);

create policy lpg_order_action_definitions_select_active_or_config
on public.lpg_order_action_definitions
for select to authenticated
using (status = 'active' or public.has_permission('lpg.config.read', null) or public.can_manage_lpg_operations());

create policy lpg_order_action_definitions_no_direct_insert
on public.lpg_order_action_definitions
for insert to authenticated
with check (false);

create policy lpg_order_action_definitions_no_direct_update
on public.lpg_order_action_definitions
for update to authenticated
using (false)
with check (false);

create policy lpg_order_action_definitions_no_direct_delete
on public.lpg_order_action_definitions
for delete to authenticated
using (false);

grant select on public.lpg_cylinder_type_profiles to authenticated, service_role;
grant select on public.lpg_operation_policies to authenticated, service_role;
grant select on public.lpg_station_role_presets to authenticated, service_role;
grant select on public.lpg_station_capacity_reservations to authenticated, service_role;
grant select on public.lpg_order_financial_adjustments to authenticated, service_role;
grant select on public.lpg_cylinder_inspections to authenticated, service_role;
grant select on public.lpg_order_action_definitions to authenticated, service_role;

grant all on public.lpg_cylinder_type_profiles to service_role;
grant all on public.lpg_operation_policies to service_role;
grant all on public.lpg_station_role_presets to service_role;
grant all on public.lpg_station_capacity_reservations to service_role;
grant all on public.lpg_order_financial_adjustments to service_role;
grant all on public.lpg_cylinder_inspections to service_role;
grant all on public.lpg_order_action_definitions to service_role;

revoke all on function public.lpg_policy_config(text) from public;
revoke all on function public.user_has_permission_for_branch(uuid, text, uuid, uuid) from public;
revoke all on function public.user_can_operate_lpg_station_branch(uuid, uuid, text) from public;
revoke all on function public.can_operate_lpg_station_branch(uuid, text) from public;
revoke all on function public.read_lpg_runtime_config() from public;
revoke all on function public.configure_lpg_operation_policy(text, text, text, jsonb, text, integer, jsonb, text) from public;
revoke all on function public.configure_lpg_cylinder_type_profile(text, text, numeric, numeric, text, numeric, jsonb, text) from public;
revoke all on function public.configure_lpg_refill_pricing(uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, timestamptz, timestamptz, jsonb, text) from public;
revoke all on function public.register_media_asset(text, text, text, bigint, text, text, uuid, uuid, text, text, jsonb, text) from public;
revoke all on function public.return_escrow_hold_amount(uuid, uuid, numeric, text, text, jsonb) from public;
revoke all on function public.assign_lpg_station_role(uuid, uuid, text, text, jsonb) from public;
revoke all on function public.activate_lpg_station_branch(uuid, uuid, uuid, text, text, numeric, numeric, text, uuid, text, integer, numeric[], numeric, numeric, jsonb, jsonb, jsonb, text) from public;
revoke all on function public.ensure_lpg_order_record(uuid, text, text, jsonb) from public;
revoke all on function public.lpg_delivery_challenge_is_verified(uuid, uuid) from public;
revoke all on function public.record_lpg_cylinder_inspection(uuid, text, text, uuid[], jsonb, text) from public;
revoke all on function public.process_lpg_order_action(uuid, text, text, jsonb, text) from public;
revoke all on function public.request_lpg_delivery_challenge(uuid, text, text, text, jsonb, text) from public;
revoke all on function public.verify_lpg_delivery_challenge(uuid, uuid, text, text, jsonb) from public;
revoke all on function public.settle_lpg_station_order(uuid, text, uuid, uuid, uuid, jsonb, text) from public;
revoke all on function public.execute_lpg_driver_commission(uuid, text, uuid, uuid, jsonb, text) from public;
revoke all on function public.refund_lpg_order_payment(uuid, text, numeric, text, uuid, jsonb, text) from public;
revoke all on function public.reconcile_lpg_order_financials(uuid) from public;
revoke all on function public.read_lpg_jobs(text, integer) from public;
revoke all on function public.queue_lpg_order_status_notifications(uuid, text, text) from public;
revoke all on function public.process_lpg_order_lifecycle(integer) from public;

grant execute on function public.lpg_policy_config(text) to authenticated, service_role;
grant execute on function public.user_has_permission_for_branch(uuid, text, uuid, uuid) to authenticated, service_role;
grant execute on function public.user_can_operate_lpg_station_branch(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.can_operate_lpg_station_branch(uuid, text) to authenticated, service_role;
grant execute on function public.read_lpg_runtime_config() to authenticated, service_role;
grant execute on function public.configure_lpg_operation_policy(text, text, text, jsonb, text, integer, jsonb, text) to authenticated, service_role;
grant execute on function public.configure_lpg_cylinder_type_profile(text, text, numeric, numeric, text, numeric, jsonb, text) to authenticated, service_role;
grant execute on function public.configure_lpg_refill_pricing(uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, timestamptz, timestamptz, jsonb, text) to authenticated, service_role;
grant execute on function public.register_media_asset(text, text, text, bigint, text, text, uuid, uuid, text, text, jsonb, text) to authenticated, service_role;
grant execute on function public.return_escrow_hold_amount(uuid, uuid, numeric, text, text, jsonb) to authenticated, service_role;
grant execute on function public.assign_lpg_station_role(uuid, uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function public.activate_lpg_station_branch(uuid, uuid, uuid, text, text, numeric, numeric, text, uuid, text, integer, numeric[], numeric, numeric, jsonb, jsonb, jsonb, text) to authenticated, service_role;
grant execute on function public.ensure_lpg_order_record(uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function public.lpg_delivery_challenge_is_verified(uuid, uuid) to authenticated, service_role;
grant execute on function public.record_lpg_cylinder_inspection(uuid, text, text, uuid[], jsonb, text) to authenticated, service_role;
grant execute on function public.process_lpg_order_action(uuid, text, text, jsonb, text) to authenticated, service_role;
grant execute on function public.request_lpg_delivery_challenge(uuid, text, text, text, jsonb, text) to authenticated, service_role;
grant execute on function public.verify_lpg_delivery_challenge(uuid, uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function public.settle_lpg_station_order(uuid, text, uuid, uuid, uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.execute_lpg_driver_commission(uuid, text, uuid, uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.refund_lpg_order_payment(uuid, text, numeric, text, uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.reconcile_lpg_order_financials(uuid) to authenticated, service_role;
grant execute on function public.read_lpg_jobs(text, integer) to authenticated, service_role;
grant execute on function public.queue_lpg_order_status_notifications(uuid, text, text) to authenticated, service_role;
grant execute on function public.process_lpg_order_lifecycle(integer) to authenticated, service_role;

commit;
