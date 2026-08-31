begin;

-- Inventory is an operational bounded context. Installed storage, observed stock,
-- station allocation, and order reservations are deliberately separate records.

insert into public.permissions (key, description, risk_level)
values
  ('station.inventory.read', 'Read branch-scoped operational inventory.', 'standard'),
  ('station.inventory.confirm', 'Confirm an unchanged branch inventory reading.', 'high'),
  ('station.inventory.update', 'Report current physical stock for a branch.', 'high'),
  ('station.inventory.adjust', 'Record auditable branch inventory movements.', 'high'),
  ('station.inventory.history.read', 'Read branch inventory observations and event history.', 'standard'),
  ('station.inventory.allocations.manage', 'Manage the amount of safely usable stock allocated to SKIMA.', 'high'),
  ('station.inventory.sources.read', 'Read branch inventory-source and provider health.', 'standard'),
  ('station.inventory.sources.manage', 'Configure branch inventory-source priority and fallback.', 'high'),
  ('station.inventory.providers.manage', 'Manage branch inventory provider connections without reading credentials.', 'critical'),
  ('station.inventory.telemetry.read', 'Read branch tank telemetry health and normalized observations.', 'standard'),
  ('station.inventory.reconciliation.read', 'Read branch inventory discrepancies and reconciliation cases.', 'high'),
  ('station.inventory.reconciliation.manage', 'Resolve inventory discrepancies with an audit trail.', 'critical'),
  ('platform.inventory.manage', 'Manage inventory policies, providers, rollout, and exceptional overrides.', 'critical')
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    updated_at = timezone('utc', now());

-- Provider adapters remain a platform abstraction. Inventory providers describe
-- capabilities in config; LPG code never branches on a provider name.
alter table public.provider_adapters
drop constraint if exists provider_adapters_provider_kind_check;

alter table public.provider_adapters
add constraint provider_adapters_provider_kind_check
check (provider_kind in (
  'payment', 'storage', 'maps', 'notification', 'ai', 'queue', 'cache',
  'observability', 'inventory'
));

insert into public.configuration_entries (
  namespace,
  key,
  scope_type,
  scope_id,
  value,
  status,
  version,
  effective_from
)
select
  'module.inventory',
  'lpg.runtime-policy',
  'global',
  null,
  jsonb_build_object(
    'manualConfirmationIntervalMinutes', 240,
    'manualWarningIntervalMinutes', 180,
    'manualStaleIntervalMinutes', 360,
    'dispatchBlockingIntervalMinutes', 480,
    'lowStockPercentage', 25,
    'criticalStockPercentage', 10,
    'platformSafetyReserveMode', 'percentage',
    'platformSafetyReserveValue', 5,
    'defaultAllocationMode', 'percentage',
    'defaultAllocationValue', 50,
    'reservationExpiryMinutes', 15,
    'discrepancyToleranceKg', 25,
    'manualFallbackMaximumHours', 24,
    'maximumAvailabilityPauseHours', 168,
    'minimumDispatchConfidence', 'MEDIUM',
    'unknownSourceDispatchMode', 'block',
    'defaultMaximumConcurrentJobs', 4,
    'maximumObservationFutureSkewSeconds', 300,
    'maximumProviderReplayAgeHours', 72,
    'providerSyncIntervalMinutes', 5,
    'providerHealthCheckIntervalMinutes', 5,
    'providerDegradedIntervalMinutes', 15,
    'providerOfflineIntervalMinutes', 30,
    'providerRetryMaximumAttempts', 5,
    'providerRetryBaseSeconds', 60,
    'telemetryWarningIntervalMinutes', 10,
    'telemetryStaleIntervalMinutes', 20,
    'alertReminderIntervalMinutes', 240,
    'sourceDisagreementWarningPercentage', 3,
    'sourceDisagreementCriticalPercentage', 10,
    'actualFillToleranceKg', 0.5,
    'maximumActualFillOverageKg', 1,
    'unexpectedStockoutReliabilityPenalty', 5
  ),
  'active',
  1,
  timezone('utc', now())
where not exists (
  select 1
  from public.configuration_entries entry
  where entry.namespace = 'module.inventory'
    and entry.key = 'lpg.runtime-policy'
    and entry.scope_type = 'global'
    and entry.scope_id is null
    and entry.version = 1
);

create table if not exists public.inventory_source_types (
  key text primary key check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  description text not null,
  supports_provider boolean not null default false,
  supports_push boolean not null default false,
  supports_polling boolean not null default false,
  status text not null default 'active' check (status in ('draft', 'active', 'retired')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.inventory_source_types (
  key, display_name, description, supports_provider, supports_push, supports_polling, metadata
)
values
  ('manual', 'Manual tracking', 'Update and confirm LPG stock directly in SKIMA.', false, false, false, '{"initial":true,"sortOrder":10}'::jsonb),
  ('pos', 'POS or inventory integration', 'Connect a supported stock or point-of-sale provider.', true, true, true, '{"initial":true,"sortOrder":20}'::jsonb),
  ('telemetry', 'Tank telemetry', 'Connect supported tank monitoring equipment.', true, true, true, '{"initial":true,"sortOrder":30}'::jsonb)
on conflict (key) do update
set display_name = excluded.display_name,
    description = excluded.description,
    supports_provider = excluded.supports_provider,
    supports_push = excluded.supports_push,
    supports_polling = excluded.supports_polling,
    status = 'active',
    metadata = public.inventory_source_types.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

create table if not exists public.inventory_measurement_methods (
  key text primary key check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  description text not null,
  requires_evidence boolean not null default false,
  status text not null default 'active' check (status in ('draft', 'active', 'retired')),
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.inventory_measurement_methods (
  key, display_name, description, requires_evidence, sort_order
)
values
  ('tank_gauge', 'Tank gauge', 'Reading taken from a tank gauge.', false, 10),
  ('weight_measurement', 'Weight measurement', 'Stock measured using calibrated weight equipment.', false, 20),
  ('dip_measurement', 'Dip measurement', 'Stock measured using an approved tank dip method.', false, 30),
  ('delivery_invoice', 'Delivery document', 'Quantity confirmed from a supplier delivery document.', true, 40),
  ('operator_estimate', 'Operator estimate', 'Best current estimate from an authorised operator.', false, 50),
  ('physical_meter', 'Physical meter', 'Reading taken from a station meter.', false, 60),
  ('other', 'Other method', 'Another measurement method explained in the note.', false, 100)
on conflict (key) do update
set display_name = excluded.display_name,
    description = excluded.description,
    requires_evidence = excluded.requires_evidence,
    status = 'active',
    sort_order = excluded.sort_order,
    updated_at = timezone('utc', now());

create table if not exists public.inventory_adjustment_types (
  key text primary key check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  direction text not null check (direction in ('increase', 'decrease', 'either', 'neutral')),
  description text not null,
  evidence_recommended boolean not null default false,
  status text not null default 'active' check (status in ('draft', 'active', 'retired')),
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.inventory_adjustment_types (
  key, display_name, direction, description, evidence_recommended, sort_order
)
values
  ('off_platform_sale', 'Off-platform sales', 'decrease', 'Record LPG sold outside SKIMA.', false, 10),
  ('supplier_delivery', 'Supplier delivery', 'increase', 'Record LPG physically received from a supplier.', true, 20),
  ('bulk_customer_sale', 'Bulk customer sale', 'decrease', 'Record a bulk sale outside SKIMA.', true, 30),
  ('tank_transfer', 'Tank transfer', 'neutral', 'Move LPG between station tanks without changing station total.', false, 40),
  ('loss', 'Loss', 'decrease', 'Record verified LPG loss.', true, 50),
  ('correction', 'Inventory correction', 'either', 'Correct a verified stock discrepancy.', true, 60),
  ('other', 'Other adjustment', 'either', 'Record another explained inventory movement.', false, 100)
on conflict (key) do update
set display_name = excluded.display_name,
    direction = excluded.direction,
    description = excluded.description,
    evidence_recommended = excluded.evidence_recommended,
    status = 'active',
    sort_order = excluded.sort_order,
    updated_at = timezone('utc', now());

create table if not exists public.station_lpg_tanks (
  id uuid primary key default gen_random_uuid(),
  public_reference text,
  station_branch_id uuid not null references public.lpg_station_branches(id) on delete cascade,
  tank_name text not null check (char_length(btrim(tank_name)) between 2 and 120),
  tank_code text not null check (tank_code ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{1,79}$'),
  rated_capacity_kg numeric(14, 3) not null check (rated_capacity_kg > 0),
  usable_capacity_kg numeric(14, 3) not null check (usable_capacity_kg > 0 and usable_capacity_kg <= rated_capacity_kg),
  minimum_safe_stock_kg numeric(14, 3) not null default 0 check (minimum_safe_stock_kg >= 0 and minimum_safe_stock_kg <= usable_capacity_kg),
  maximum_safe_fill_percentage numeric(7, 4) not null default 85 check (maximum_safe_fill_percentage > 0 and maximum_safe_fill_percentage <= 100),
  status text not null default 'active' check (status in ('active', 'inactive', 'maintenance', 'inspection_required', 'decommissioned', 'unknown')),
  inspection_status text not null default 'unknown' check (inspection_status in ('unknown', 'current', 'due_soon', 'overdue', 'failed', 'not_required')),
  telemetry_capable boolean not null default false,
  installation_date date,
  last_verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  source text not null check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (station_branch_id, tank_code),
  unique (source, idempotency_key)
);

create unique index if not exists station_lpg_tanks_public_reference_unique
on public.station_lpg_tanks (public_reference) where public_reference is not null;

create table if not exists public.station_inventory_configurations (
  id uuid primary key default gen_random_uuid(),
  station_branch_id uuid not null unique references public.lpg_station_branches(id) on delete cascade,
  tracking_mode text not null default 'manual' check (tracking_mode in ('manual', 'pos', 'telemetry', 'multi')),
  primary_source_key text not null default 'manual' references public.inventory_source_types(key) on delete restrict,
  secondary_source_key text references public.inventory_source_types(key) on delete restrict,
  fallback_source_key text references public.inventory_source_types(key) on delete restrict,
  allocation_mode text not null default 'percentage' check (allocation_mode in ('fixed_kg', 'percentage', 'dynamic')),
  allocation_value numeric(14, 3) not null default 50 check (allocation_value >= 0),
  safety_reserve_mode text not null default 'platform' check (safety_reserve_mode in ('platform', 'fixed_kg', 'percentage', 'tank_specific')),
  safety_reserve_value numeric(14, 3) check (safety_reserve_value is null or safety_reserve_value >= 0),
  manual_fallback_until timestamptz,
  status text not null default 'active' check (status in ('active', 'paused', 'setup_required', 'retired')),
  version integer not null default 1 check (version > 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (secondary_source_key is null or secondary_source_key <> primary_source_key),
  check (fallback_source_key is null or fallback_source_key <> primary_source_key),
  check (allocation_mode <> 'percentage' or allocation_value <= 100),
  check (safety_reserve_mode <> 'percentage' or coalesce(safety_reserve_value, 0) <= 100)
);

create table if not exists public.station_inventory_provider_connections (
  id uuid primary key default gen_random_uuid(),
  public_reference text,
  station_branch_id uuid not null references public.lpg_station_branches(id) on delete cascade,
  provider_adapter_id uuid not null references public.provider_adapters(id) on delete restrict,
  source_type_key text not null references public.inventory_source_types(key) on delete restrict,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 120),
  connection_method text not null check (connection_method in ('oauth', 'api_key', 'webhook', 'polling', 'device_gateway', 'managed')),
  credential_secret_ref text,
  status text not null default 'pending' check (status in ('pending', 'connecting', 'active', 'degraded', 'disconnected', 'revoked', 'failed')),
  health_status text not null default 'unknown' check (health_status in ('healthy', 'degraded', 'offline', 'unknown')),
  last_connected_at timestamptz,
  last_successful_sync_at timestamptz,
  last_failure_at timestamptz,
  credential_rotated_at timestamptz,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  source text not null check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (station_branch_id, provider_adapter_id, source_type_key),
  unique (source, idempotency_key)
);

create unique index if not exists station_inventory_connections_public_reference_unique
on public.station_inventory_provider_connections (public_reference) where public_reference is not null;

create table if not exists public.station_inventory_telemetry_devices (
  id uuid primary key default gen_random_uuid(),
  public_reference text,
  station_branch_id uuid not null references public.lpg_station_branches(id) on delete cascade,
  tank_id uuid not null references public.station_lpg_tanks(id) on delete cascade,
  provider_connection_id uuid references public.station_inventory_provider_connections(id) on delete set null,
  provider_device_reference text,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 120),
  measurement_kind text not null check (measurement_kind in ('mass_kg', 'fill_percentage', 'level_distance', 'volume_litres', 'pressure', 'multi_metric')),
  status text not null default 'pending' check (status in ('pending', 'active', 'degraded', 'offline', 'maintenance', 'retired')),
  health_status text not null default 'unknown' check (health_status in ('healthy', 'degraded', 'offline', 'unknown')),
  last_reading_at timestamptz,
  calibration jsonb not null default '{}'::jsonb check (jsonb_typeof(calibration) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  source text not null check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (tank_id),
  unique (provider_connection_id, provider_device_reference),
  unique (source, idempotency_key)
);

create unique index if not exists station_inventory_devices_public_reference_unique
on public.station_inventory_telemetry_devices (public_reference) where public_reference is not null;

create table if not exists public.station_lpg_inventory_state (
  id uuid primary key default gen_random_uuid(),
  station_branch_id uuid not null unique references public.lpg_station_branches(id) on delete cascade,
  physical_stock_kg numeric(14, 3) check (physical_stock_kg is null or physical_stock_kg >= 0),
  reported_stock_kg numeric(14, 3) check (reported_stock_kg is null or reported_stock_kg >= 0),
  observed_stock_kg numeric(14, 3) check (observed_stock_kg is null or observed_stock_kg >= 0),
  calculated_stock_kg numeric(14, 3) check (calculated_stock_kg is null or calculated_stock_kg >= 0),
  safe_stock_kg numeric(14, 3) not null default 0 check (safe_stock_kg >= 0),
  skima_allocation_kg numeric(14, 3) not null default 0 check (skima_allocation_kg >= 0),
  reserved_kg numeric(14, 3) not null default 0 check (reserved_kg >= 0),
  dispatchable_kg numeric(14, 3) not null default 0 check (dispatchable_kg >= 0),
  inventory_status text not null default 'UNKNOWN' check (inventory_status in ('NORMAL', 'LOW', 'CRITICAL', 'OUT_OF_STOCK', 'UNKNOWN', 'STALE')),
  active_source_key text references public.inventory_source_types(key) on delete restrict,
  primary_source_key text references public.inventory_source_types(key) on delete restrict,
  source_confidence text not null default 'UNTRUSTED' check (source_confidence in ('HIGH', 'MEDIUM', 'LOW', 'STALE', 'UNTRUSTED')),
  freshness_status text not null default 'UNKNOWN' check (freshness_status in ('FRESH', 'AGING', 'LOW', 'STALE', 'UNKNOWN')),
  source_health text not null default 'unknown' check (source_health in ('healthy', 'degraded', 'offline', 'unknown')),
  reconciliation_status text not null default 'current' check (reconciliation_status in ('current', 'review_required', 'open', 'blocked')),
  reliability_score numeric(7, 3) not null default 100 check (reliability_score between 0 and 100),
  rollout_status text not null default 'setup_required' check (rollout_status in ('setup_required', 'legacy_shadow', 'active', 'paused')),
  dispatch_blocked_until timestamptz,
  dispatch_block_reason text,
  last_source_update_at timestamptz,
  last_verified_at timestamptz,
  version bigint not null default 1 check (version > 0),
  legacy_available_kg numeric(14, 3) check (legacy_available_kg is null or legacy_available_kg >= 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.station_lpg_tank_inventory_state (
  id uuid primary key default gen_random_uuid(),
  station_branch_id uuid not null references public.lpg_station_branches(id) on delete cascade,
  tank_id uuid not null unique references public.station_lpg_tanks(id) on delete cascade,
  physical_stock_kg numeric(14, 3) check (physical_stock_kg is null or physical_stock_kg >= 0),
  observed_stock_kg numeric(14, 3) check (observed_stock_kg is null or observed_stock_kg >= 0),
  active_source_key text references public.inventory_source_types(key) on delete restrict,
  source_confidence text not null default 'UNTRUSTED' check (source_confidence in ('HIGH', 'MEDIUM', 'LOW', 'STALE', 'UNTRUSTED')),
  freshness_status text not null default 'UNKNOWN' check (freshness_status in ('FRESH', 'AGING', 'LOW', 'STALE', 'UNKNOWN')),
  last_source_update_at timestamptz,
  last_verified_at timestamptz,
  version bigint not null default 1 check (version > 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (station_branch_id, tank_id)
);

create table if not exists public.station_inventory_observations (
  id uuid primary key default gen_random_uuid(),
  station_branch_id uuid not null references public.lpg_station_branches(id) on delete cascade,
  tank_id uuid references public.station_lpg_tanks(id) on delete set null,
  provider_connection_id uuid references public.station_inventory_provider_connections(id) on delete set null,
  telemetry_device_id uuid references public.station_inventory_telemetry_devices(id) on delete set null,
  source_type_key text not null references public.inventory_source_types(key) on delete restrict,
  measurement_method_key text references public.inventory_measurement_methods(key) on delete restrict,
  raw_value numeric,
  raw_unit text,
  normalized_stock_kg numeric(14, 3) check (normalized_stock_kg is null or normalized_stock_kg >= 0),
  skima_allocation_kg numeric(14, 3) check (skima_allocation_kg is null or skima_allocation_kg >= 0),
  provider_event_reference text,
  provider_sequence bigint,
  observed_at timestamptz not null,
  received_at timestamptz not null default timezone('utc', now()),
  disposition text not null default 'accepted' check (disposition in ('accepted', 'duplicate', 'out_of_order', 'ignored', 'reconciliation_required', 'rejected')),
  confidence text not null default 'LOW' check (confidence in ('HIGH', 'MEDIUM', 'LOW', 'STALE', 'UNTRUSTED')),
  note text,
  evidence_asset_ids uuid[] not null default array[]::uuid[],
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  source text not null check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create unique index if not exists station_inventory_observation_provider_event_unique
on public.station_inventory_observations (provider_connection_id, provider_event_reference)
where provider_connection_id is not null and provider_event_reference is not null;

create index if not exists station_inventory_observations_station_time_idx
on public.station_inventory_observations (station_branch_id, observed_at desc);

create table if not exists public.station_inventory_events (
  id uuid primary key default gen_random_uuid(),
  public_reference text,
  station_branch_id uuid not null references public.lpg_station_branches(id) on delete cascade,
  tank_id uuid references public.station_lpg_tanks(id) on delete set null,
  linked_event_id uuid references public.station_inventory_events(id) on delete set null,
  observation_id uuid references public.station_inventory_observations(id) on delete set null,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  stock_delta_kg numeric(14, 3) not null default 0,
  resulting_physical_stock_kg numeric(14, 3) check (resulting_physical_stock_kg is null or resulting_physical_stock_kg >= 0),
  resulting_allocation_kg numeric(14, 3) check (resulting_allocation_kg is null or resulting_allocation_kg >= 0),
  resulting_reserved_kg numeric(14, 3) check (resulting_reserved_kg is null or resulting_reserved_kg >= 0),
  resulting_dispatchable_kg numeric(14, 3) check (resulting_dispatchable_kg is null or resulting_dispatchable_kg >= 0),
  reason_key text check (reason_key is null or reason_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  note text,
  evidence_asset_ids uuid[] not null default array[]::uuid[],
  related_entity_type text,
  related_entity_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  source text not null check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  actor_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  occurred_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create unique index if not exists station_inventory_events_public_reference_unique
on public.station_inventory_events (public_reference) where public_reference is not null;

create index if not exists station_inventory_events_station_time_idx
on public.station_inventory_events (station_branch_id, occurred_at desc);

create table if not exists public.station_inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  public_reference text,
  station_branch_id uuid not null references public.lpg_station_branches(id) on delete restrict,
  lpg_order_id uuid not null references public.lpg_refill_orders(id) on delete cascade,
  legacy_reservation_id uuid unique references public.lpg_station_capacity_reservations(id) on delete set null,
  requested_kg numeric(14, 3) not null check (requested_kg > 0),
  reserved_kg numeric(14, 3) not null check (reserved_kg > 0),
  consumed_kg numeric(14, 3) not null default 0 check (consumed_kg >= 0),
  status text not null default 'reserved' check (status in ('pending', 'reserved', 'consumed', 'partially_consumed', 'released', 'expired', 'cancelled')),
  expires_at timestamptz,
  consumed_at timestamptz,
  released_at timestamptz,
  release_reason text,
  version integer not null default 1 check (version > 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  source text not null check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (lpg_order_id),
  unique (source, idempotency_key),
  check (consumed_kg <= reserved_kg)
);

create unique index if not exists station_inventory_reservations_public_reference_unique
on public.station_inventory_reservations (public_reference) where public_reference is not null;

create index if not exists station_inventory_reservations_station_status_idx
on public.station_inventory_reservations (station_branch_id, status, expires_at);

create table if not exists public.station_inventory_reconciliation_cases (
  id uuid primary key default gen_random_uuid(),
  public_reference text,
  station_branch_id uuid not null references public.lpg_station_branches(id) on delete cascade,
  case_type text not null check (case_type in ('pos_mismatch', 'telemetry_mismatch', 'manual_mismatch', 'unexpected_stockout', 'actual_kg_discrepancy', 'supplier_delivery_discrepancy', 'large_adjustment', 'cross_source_disagreement', 'other')),
  status text not null default 'open' check (status in ('open', 'investigating', 'awaiting_station', 'awaiting_provider', 'resolved', 'dismissed', 'escalated')),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  expected_stock_kg numeric(14, 3),
  observed_stock_kg numeric(14, 3),
  difference_kg numeric(14, 3),
  source_observation_ids uuid[] not null default array[]::uuid[],
  summary text not null,
  resolution text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  source text not null check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create unique index if not exists station_inventory_reconciliation_public_reference_unique
on public.station_inventory_reconciliation_cases (public_reference) where public_reference is not null;

create index if not exists station_inventory_reconciliation_station_status_idx
on public.station_inventory_reconciliation_cases (station_branch_id, status, created_at desc);

create table if not exists public.station_inventory_operational_capacity (
  id uuid primary key default gen_random_uuid(),
  station_branch_id uuid not null unique references public.lpg_station_branches(id) on delete cascade,
  filling_points integer not null default 1 check (filling_points > 0),
  maximum_concurrent_jobs integer not null default 4 check (maximum_concurrent_jobs > 0),
  estimated_processing_minutes numeric(10, 2) check (estimated_processing_minutes is null or estimated_processing_minutes >= 0),
  congestion_status text not null default 'normal' check (congestion_status in ('normal', 'busy', 'congested', 'paused', 'unknown')),
  paused_until timestamptz,
  pause_reason text,
  version integer not null default 1 check (version > 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.reference_namespaces (
  key, display_name, description, subject_type, prefix, separator,
  sequence_padding, status, metadata, source
)
values
  ('reference.inventory.tank', 'Inventory tank references', 'Backend-owned public references for station storage tanks.', 'inventory.tank', 'TNK', '-', 8, 'active', '{"module":"inventory"}'::jsonb, 'inventory.runtime_seed'),
  ('reference.inventory.connection', 'Inventory connection references', 'Backend-owned public references for inventory provider connections.', 'inventory.connection', 'IPC', '-', 8, 'active', '{"module":"inventory"}'::jsonb, 'inventory.runtime_seed'),
  ('reference.inventory.device', 'Inventory device references', 'Backend-owned public references for inventory telemetry devices.', 'inventory.device', 'DEV', '-', 8, 'active', '{"module":"inventory"}'::jsonb, 'inventory.runtime_seed'),
  ('reference.inventory.event', 'Inventory event references', 'Backend-owned public references for operational stock ledger events.', 'inventory.event', 'INV', '-', 10, 'active', '{"module":"inventory"}'::jsonb, 'inventory.runtime_seed'),
  ('reference.inventory.reservation', 'Inventory reservation references', 'Backend-owned public references for inventory reservations.', 'inventory.reservation', 'RSV', '-', 10, 'active', '{"module":"inventory"}'::jsonb, 'inventory.runtime_seed'),
  ('reference.inventory.reconciliation', 'Inventory reconciliation references', 'Backend-owned public references for inventory reconciliation cases.', 'inventory.reconciliation', 'REC', '-', 8, 'active', '{"module":"inventory"}'::jsonb, 'inventory.runtime_seed')
on conflict (key) do update
set display_name = excluded.display_name,
    description = excluded.description,
    subject_type = excluded.subject_type,
    prefix = excluded.prefix,
    separator = excluded.separator,
    sequence_padding = excluded.sequence_padding,
    status = 'active',
    metadata = public.reference_namespaces.metadata || excluded.metadata,
    source = excluded.source,
    updated_at = timezone('utc', now());

do $$
declare
  binding record;
begin
  for binding in
    select *
    from (values
      ('station_lpg_tanks', 'reference.inventory.tank', 'inventory.tank'),
      ('station_inventory_provider_connections', 'reference.inventory.connection', 'inventory.connection'),
      ('station_inventory_telemetry_devices', 'reference.inventory.device', 'inventory.device'),
      ('station_inventory_events', 'reference.inventory.event', 'inventory.event'),
      ('station_inventory_reservations', 'reference.inventory.reservation', 'inventory.reservation'),
      ('station_inventory_reconciliation_cases', 'reference.inventory.reconciliation', 'inventory.reconciliation')
    ) as reference_binding(table_name, namespace_key, subject_type)
  loop
    execute format('drop trigger if exists assign_public_reference_on_insert on public.%I', binding.table_name);
    execute format(
      'create trigger assign_public_reference_on_insert after insert on public.%I for each row execute function public.assign_public_reference_after_insert(%L, %L)',
      binding.table_name,
      binding.namespace_key,
      binding.subject_type
    );
    execute format('drop trigger if exists validate_public_reference_on_insert on public.%I', binding.table_name);
    execute format(
      'create trigger validate_public_reference_on_insert after insert on public.%I for each row execute function public.validate_public_reference_after_insert()',
      binding.table_name
    );
    execute format('drop trigger if exists prevent_public_reference_update on public.%I', binding.table_name);
    execute format(
      'create trigger prevent_public_reference_update before update on public.%I for each row execute function public.prevent_subject_public_reference_update()',
      binding.table_name
    );
  end loop;
end $$;

create or replace function public.inventory_runtime_policy()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  resolved_policy jsonb;
begin
  select entry.value
  into resolved_policy
  from public.configuration_entries entry
  where entry.namespace = 'module.inventory'
    and entry.key = 'lpg.runtime-policy'
    and entry.scope_type = 'global'
    and entry.scope_id is null
    and entry.status = 'active'
    and (entry.effective_from is null or entry.effective_from <= timezone('utc', now()))
    and (entry.effective_until is null or entry.effective_until > timezone('utc', now()))
  order by entry.version desc, entry.updated_at desc
  limit 1;

  if resolved_policy is null or jsonb_typeof(resolved_policy) <> 'object' then
    raise exception 'active inventory runtime policy is required';
  end if;

  return resolved_policy;
end;
$$;

create or replace function public.can_read_lpg_station_inventory(target_station_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select target_station_branch_id is not null
    and (
      auth.role() = 'service_role'
      or public.can_manage_lpg_operations()
      or public.has_permission('platform.inventory.manage', null)
      or public.can_operate_lpg_station_branch(target_station_branch_id, 'station.inventory.read')
      or public.can_operate_lpg_station_branch(target_station_branch_id, 'lpg.stations.read')
    );
$$;

create or replace function public.can_manage_lpg_station_inventory(
  target_station_branch_id uuid,
  target_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select target_station_branch_id is not null
    and target_permission_key = any(array[
      'station.inventory.confirm',
      'station.inventory.update',
      'station.inventory.adjust',
      'station.inventory.allocations.manage',
      'station.inventory.sources.manage',
      'station.inventory.providers.manage',
      'station.inventory.reconciliation.manage'
    ]::text[])
    and (
      auth.role() = 'service_role'
      or public.can_manage_lpg_operations()
      or public.has_permission('platform.inventory.manage', null)
      or public.can_operate_lpg_station_branch(target_station_branch_id, target_permission_key)
    );
$$;

create or replace function public.can_read_lpg_station_inventory_history(target_station_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select target_station_branch_id is not null and (
    auth.role() = 'service_role'
    or public.can_manage_lpg_operations()
    or public.has_permission('platform.inventory.manage', null)
    or public.can_operate_lpg_station_branch(target_station_branch_id, 'station.inventory.history.read')
  );
$$;

create or replace function public.can_read_lpg_inventory_reconciliation(target_station_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select target_station_branch_id is not null and (
    auth.role() = 'service_role'
    or public.can_manage_lpg_operations()
    or public.has_permission('platform.inventory.manage', null)
    or public.can_operate_lpg_station_branch(target_station_branch_id, 'station.inventory.reconciliation.read')
    or public.can_operate_lpg_station_branch(target_station_branch_id, 'station.inventory.reconciliation.manage')
  );
$$;

create or replace function public.recalculate_lpg_station_inventory(
  target_station_branch_id uuid,
  target_reason_key text default 'inventory.recalculated'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  state_record public.station_lpg_inventory_state%rowtype;
  config_record public.station_inventory_configurations%rowtype;
  branch_record public.lpg_station_branches%rowtype;
  capacity_record public.station_inventory_operational_capacity%rowtype;
  runtime_policy jsonb;
  installed_usable_kg numeric := 0;
  configured_safe_stock_kg numeric := 0;
  resolved_safe_stock_kg numeric := 0;
  safely_usable_kg numeric := 0;
  desired_allocation_kg numeric := 0;
  resolved_allocation_kg numeric := 0;
  active_reserved_kg numeric := 0;
  base_dispatchable_kg numeric := 0;
  resolved_dispatchable_kg numeric := 0;
  stock_percentage numeric := 0;
  low_percentage numeric;
  critical_percentage numeric;
  warning_minutes integer;
  stale_minutes integer;
  blocking_minutes integer;
  reading_age_minutes numeric;
  resolved_freshness text := 'UNKNOWN';
  resolved_confidence text := 'UNTRUSTED';
  resolved_status text := 'UNKNOWN';
  minimum_confidence text;
  confidence_rank integer;
  minimum_confidence_rank integer;
  active_jobs integer := 0;
  processing_available boolean := true;
  dispatch_allowed boolean := false;
begin
  if coalesce(current_setting('skima.inventory_runtime', true), '') <> 'true'
     and auth.role() <> 'service_role'
     and not public.can_manage_lpg_operations()
     and not public.has_permission('platform.inventory.manage', null) then
    raise exception 'backend-owned inventory recalculation is required';
  end if;

  runtime_policy := public.inventory_runtime_policy();
  low_percentage := nullif(runtime_policy ->> 'lowStockPercentage', '')::numeric;
  critical_percentage := nullif(runtime_policy ->> 'criticalStockPercentage', '')::numeric;
  warning_minutes := nullif(runtime_policy ->> 'manualWarningIntervalMinutes', '')::integer;
  stale_minutes := nullif(runtime_policy ->> 'manualStaleIntervalMinutes', '')::integer;
  blocking_minutes := nullif(runtime_policy ->> 'dispatchBlockingIntervalMinutes', '')::integer;
  minimum_confidence := upper(coalesce(runtime_policy ->> 'minimumDispatchConfidence', 'MEDIUM'));

  if low_percentage is null or critical_percentage is null
     or critical_percentage < 0 or low_percentage <= critical_percentage or low_percentage > 100
     or warning_minutes is null or stale_minutes is null or blocking_minutes is null
     or warning_minutes <= 0 or stale_minutes < warning_minutes or blocking_minutes < stale_minutes
     or minimum_confidence not in ('HIGH', 'MEDIUM', 'LOW') then
    raise exception 'inventory runtime policy thresholds are invalid';
  end if;

  select * into branch_record
  from public.lpg_station_branches
  where id = target_station_branch_id
  for update;
  if not found then
    raise exception 'target_station_branch_id must reference an LPG station branch';
  end if;
  select * into config_record
  from public.station_inventory_configurations
  where station_branch_id = target_station_branch_id
  for update;
  if not found then
    raise exception 'station inventory configuration is required';
  end if;

  select * into state_record
  from public.station_lpg_inventory_state
  where station_branch_id = target_station_branch_id
  for update;
  if not found then
    raise exception 'station inventory state is required';
  end if;

  select * into capacity_record
  from public.station_inventory_operational_capacity
  where station_branch_id = target_station_branch_id
  for update;

  select coalesce(sum(tank.usable_capacity_kg), branch_record.refill_capacity_kg, 0)
  into installed_usable_kg
  from public.station_lpg_tanks tank
  where tank.station_branch_id = target_station_branch_id
    and tank.status in ('active', 'maintenance', 'inspection_required');

  if config_record.safety_reserve_mode = 'fixed_kg' then
    configured_safe_stock_kg := coalesce(config_record.safety_reserve_value, 0);
  elsif config_record.safety_reserve_mode = 'percentage' then
    configured_safe_stock_kg := coalesce(state_record.physical_stock_kg, 0)
      * coalesce(config_record.safety_reserve_value, 0) / 100;
  elsif config_record.safety_reserve_mode = 'tank_specific' then
    select coalesce(sum(tank.minimum_safe_stock_kg), 0)
    into configured_safe_stock_kg
    from public.station_lpg_tanks tank
    where tank.station_branch_id = target_station_branch_id
      and tank.status in ('active', 'maintenance', 'inspection_required');
  elsif runtime_policy ->> 'platformSafetyReserveMode' = 'fixed_kg' then
    configured_safe_stock_kg := coalesce(nullif(runtime_policy ->> 'platformSafetyReserveValue', '')::numeric, 0);
  else
    configured_safe_stock_kg := coalesce(state_record.physical_stock_kg, 0)
      * coalesce(nullif(runtime_policy ->> 'platformSafetyReserveValue', '')::numeric, 0) / 100;
  end if;

  resolved_safe_stock_kg := least(greatest(configured_safe_stock_kg, 0), coalesce(state_record.physical_stock_kg, 0));
  safely_usable_kg := greatest(coalesce(state_record.physical_stock_kg, 0) - resolved_safe_stock_kg, 0);

  if config_record.allocation_mode = 'fixed_kg' then
    desired_allocation_kg := config_record.allocation_value;
  elsif config_record.allocation_mode = 'percentage' then
    desired_allocation_kg := safely_usable_kg * config_record.allocation_value / 100;
  else
    desired_allocation_kg := safely_usable_kg
      * coalesce(nullif(runtime_policy ->> 'defaultAllocationValue', '')::numeric, 0) / 100;
  end if;
  resolved_allocation_kg := least(greatest(desired_allocation_kg, 0), safely_usable_kg);

  select coalesce(sum(reservation.reserved_kg - reservation.consumed_kg), 0)
  into active_reserved_kg
  from public.station_inventory_reservations reservation
  where reservation.station_branch_id = target_station_branch_id
    and reservation.status in ('pending', 'reserved');

  base_dispatchable_kg := greatest(least(resolved_allocation_kg, safely_usable_kg) - active_reserved_kg, 0);

  if state_record.last_source_update_at is not null then
    reading_age_minutes := extract(epoch from (timezone('utc', now()) - state_record.last_source_update_at)) / 60;
    if reading_age_minutes <= warning_minutes then
      resolved_freshness := 'FRESH';
    elsif reading_age_minutes <= stale_minutes then
      resolved_freshness := 'AGING';
    elsif reading_age_minutes <= blocking_minutes then
      resolved_freshness := 'LOW';
    else
      resolved_freshness := 'STALE';
    end if;
  end if;

  resolved_confidence := state_record.source_confidence;
  if resolved_freshness = 'AGING' and resolved_confidence = 'HIGH' then
    resolved_confidence := 'MEDIUM';
  elsif resolved_freshness = 'LOW' and resolved_confidence in ('HIGH', 'MEDIUM') then
    resolved_confidence := 'LOW';
  elsif resolved_freshness = 'STALE' then
    resolved_confidence := 'STALE';
  elsif resolved_freshness = 'UNKNOWN' then
    resolved_confidence := 'UNTRUSTED';
  end if;

  if state_record.physical_stock_kg is null then
    resolved_status := 'UNKNOWN';
  elsif resolved_freshness = 'STALE' then
    resolved_status := 'STALE';
  elsif state_record.physical_stock_kg <= 0 then
    resolved_status := 'OUT_OF_STOCK';
  else
    stock_percentage := case when installed_usable_kg > 0
      then state_record.physical_stock_kg / installed_usable_kg * 100
      else 0
    end;
    if stock_percentage <= critical_percentage then
      resolved_status := 'CRITICAL';
    elsif stock_percentage <= low_percentage then
      resolved_status := 'LOW';
    else
      resolved_status := 'NORMAL';
    end if;
  end if;

  select count(*)::integer
  into active_jobs
  from public.lpg_refill_orders target_order
  where target_order.station_branch_id = target_station_branch_id
    and target_order.status not in ('completed', 'cancelled', 'refunded', 'failed');

  if capacity_record.id is not null then
    processing_available := capacity_record.congestion_status not in ('congested', 'paused')
      and (capacity_record.paused_until is null or capacity_record.paused_until <= timezone('utc', now()))
      and active_jobs < capacity_record.maximum_concurrent_jobs;
  end if;

  confidence_rank := case resolved_confidence when 'HIGH' then 3 when 'MEDIUM' then 2 when 'LOW' then 1 else 0 end;
  minimum_confidence_rank := case minimum_confidence when 'HIGH' then 3 when 'MEDIUM' then 2 else 1 end;
  dispatch_allowed := state_record.rollout_status = 'active'
    and config_record.status = 'active'
    and state_record.physical_stock_kg is not null
    and resolved_freshness not in ('STALE', 'UNKNOWN')
    and confidence_rank >= minimum_confidence_rank
    and state_record.source_health <> 'offline'
    and state_record.reconciliation_status <> 'blocked'
    and (state_record.dispatch_blocked_until is null or state_record.dispatch_blocked_until <= timezone('utc', now()))
    and resolved_status not in ('CRITICAL', 'OUT_OF_STOCK', 'STALE', 'UNKNOWN')
    and processing_available;

  resolved_dispatchable_kg := case when dispatch_allowed then base_dispatchable_kg else 0 end;

  update public.station_lpg_inventory_state
  set safe_stock_kg = round(resolved_safe_stock_kg, 3),
      skima_allocation_kg = round(resolved_allocation_kg, 3),
      reserved_kg = round(active_reserved_kg, 3),
      dispatchable_kg = round(resolved_dispatchable_kg, 3),
      inventory_status = resolved_status,
      primary_source_key = config_record.primary_source_key,
      source_confidence = resolved_confidence,
      freshness_status = resolved_freshness,
      version = version + case when row(
        safe_stock_kg,
        skima_allocation_kg,
        reserved_kg,
        dispatchable_kg,
        inventory_status,
        primary_source_key,
        source_confidence,
        freshness_status
      ) is distinct from row(
        round(resolved_safe_stock_kg, 3),
        round(resolved_allocation_kg, 3),
        round(active_reserved_kg, 3),
        round(resolved_dispatchable_kg, 3),
        resolved_status,
        config_record.primary_source_key,
        resolved_confidence,
        resolved_freshness
      ) then 1 else 0 end,
      metadata = metadata || jsonb_build_object(
        'installedUsableKg', round(installed_usable_kg, 3),
        'baseDispatchableKg', round(base_dispatchable_kg, 3),
        'dispatchEligible', dispatch_allowed,
        'processingAvailable', processing_available,
        'activeJobs', active_jobs,
        'maximumConcurrentJobs', capacity_record.maximum_concurrent_jobs,
        'lastRecalculationReason', target_reason_key,
        'lastRecalculatedAt', timezone('utc', now())
      ),
      updated_at = timezone('utc', now())
  where station_branch_id = target_station_branch_id
  returning * into state_record;

  if state_record.rollout_status = 'active' then
    perform set_config('skima.inventory_projection', 'true', true);
    update public.lpg_station_branches
    set current_available_kg = state_record.dispatchable_kg,
        availability_status = case
          when availability_status in ('paused', 'closed', 'unavailable') then availability_status
          when state_record.dispatchable_kg <= 0 then 'capacity_reached'
          when availability_status = 'capacity_reached' then 'available'
          else availability_status
        end,
        metadata = metadata || jsonb_build_object(
          'inventory_runtime', 'v2',
          'inventory_rollout_status', state_record.rollout_status,
          'inventory_state_version', state_record.version
        ),
        updated_at = timezone('utc', now())
    where id = target_station_branch_id;
    perform set_config('skima.inventory_projection', 'false', true);
  end if;

  return jsonb_build_object(
    'physicalStockKg', state_record.physical_stock_kg,
    'safeStockKg', state_record.safe_stock_kg,
    'skimaAllocationKg', state_record.skima_allocation_kg,
    'reservedKg', state_record.reserved_kg,
    'dispatchableKg', state_record.dispatchable_kg,
    'inventoryStatus', state_record.inventory_status,
    'freshnessStatus', state_record.freshness_status,
    'sourceConfidence', state_record.source_confidence,
    'dispatchEligible', coalesce((state_record.metadata ->> 'dispatchEligible')::boolean, false),
    'version', state_record.version
  );
end;
$$;

-- Existing values remain available to the legacy runtime during a controlled
-- shadow period, but are never promoted to physical stock without confirmation.
insert into public.station_inventory_configurations (
  station_branch_id,
  tracking_mode,
  primary_source_key,
  allocation_mode,
  allocation_value,
  safety_reserve_mode,
  status,
  metadata
)
select
  station.id,
  'manual',
  'manual',
  'percentage',
  50,
  'platform',
  'setup_required',
  jsonb_build_object(
    'migrationState', 'legacy_shadow',
    'requiresPhysicalStockConfirmation', true
  )
from public.lpg_station_branches station
on conflict (station_branch_id) do nothing;

insert into public.station_lpg_inventory_state (
  station_branch_id,
  inventory_status,
  active_source_key,
  primary_source_key,
  source_confidence,
  freshness_status,
  source_health,
  reconciliation_status,
  rollout_status,
  legacy_available_kg,
  metadata
)
select
  station.id,
  'UNKNOWN',
  null,
  'manual',
  'UNTRUSTED',
  'UNKNOWN',
  'unknown',
  'review_required',
  'legacy_shadow',
  station.current_available_kg,
  jsonb_build_object(
    'legacyValueCapturedAt', timezone('utc', now()),
    'legacyValueIsNotPhysicalStock', true,
    'requiresPhysicalStockConfirmation', true
  )
from public.lpg_station_branches station
on conflict (station_branch_id) do nothing;

insert into public.station_inventory_operational_capacity (
  station_branch_id,
  filling_points,
  maximum_concurrent_jobs,
  metadata
)
select
  station.id,
  1,
  coalesce(nullif(public.inventory_runtime_policy() ->> 'defaultMaximumConcurrentJobs', '')::integer, 4),
  '{"source":"inventory_runtime_migration"}'::jsonb
from public.lpg_station_branches station
on conflict (station_branch_id) do nothing;

create or replace function public.initialize_lpg_station_inventory_runtime()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  runtime_policy jsonb;
begin
  runtime_policy := public.inventory_runtime_policy();

  insert into public.station_inventory_configurations (
    station_branch_id,
    tracking_mode,
    primary_source_key,
    allocation_mode,
    allocation_value,
    safety_reserve_mode,
    status,
    metadata
  )
  values (
    new.id,
    'manual',
    'manual',
    coalesce(runtime_policy ->> 'defaultAllocationMode', 'percentage'),
    coalesce(nullif(runtime_policy ->> 'defaultAllocationValue', '')::numeric, 0),
    'platform',
    'setup_required',
    '{"requiresPhysicalStockConfirmation":true}'::jsonb
  )
  on conflict (station_branch_id) do nothing;

  insert into public.station_lpg_inventory_state (
    station_branch_id,
    inventory_status,
    primary_source_key,
    source_confidence,
    freshness_status,
    source_health,
    reconciliation_status,
    rollout_status,
    legacy_available_kg,
    metadata
  )
  values (
    new.id,
    'UNKNOWN',
    'manual',
    'UNTRUSTED',
    'UNKNOWN',
    'unknown',
    'review_required',
    'setup_required',
    new.current_available_kg,
    jsonb_build_object(
      'capacityWasNotPromotedToStock', true,
      'requiresPhysicalStockConfirmation', true
    )
  )
  on conflict (station_branch_id) do nothing;

  insert into public.station_inventory_operational_capacity (
    station_branch_id,
    filling_points,
    maximum_concurrent_jobs,
    metadata
  )
  values (
    new.id,
    1,
    coalesce(nullif(runtime_policy ->> 'defaultMaximumConcurrentJobs', '')::integer, 4),
    '{"source":"inventory_runtime_initializer"}'::jsonb
  )
  on conflict (station_branch_id) do nothing;

  -- Activation payloads historically supplied storage capacity as available
  -- stock. New branches always begin with unknown stock and zero dispatchability.
  perform set_config('skima.inventory_projection', 'true', true);
  update public.lpg_station_branches
  set current_available_kg = 0,
      availability_status = case when availability_status = 'available' then 'capacity_reached' else availability_status end,
      metadata = metadata || jsonb_build_object(
        'inventory_runtime', 'v2',
        'inventory_rollout_status', 'setup_required',
        'physical_stock_confirmation_required', true
      ),
      updated_at = timezone('utc', now())
  where id = new.id;
  perform set_config('skima.inventory_projection', 'false', true);

  return new;
end;
$$;

drop trigger if exists initialize_lpg_station_inventory_after_insert on public.lpg_station_branches;
create trigger initialize_lpg_station_inventory_after_insert
after insert on public.lpg_station_branches
for each row execute function public.initialize_lpg_station_inventory_runtime();

create or replace function public.guard_lpg_inventory_compatibility_projection()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('skima.inventory_projection', true), '') = 'true' then
    return new;
  end if;

  if exists (
    select 1
    from public.station_lpg_inventory_state state
    where state.station_branch_id = old.id
      and state.rollout_status = 'active'
  ) then
    new.current_available_kg := old.current_available_kg;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_lpg_inventory_projection_update on public.lpg_station_branches;
create trigger guard_lpg_inventory_projection_update
before update of current_available_kg on public.lpg_station_branches
for each row execute function public.guard_lpg_inventory_compatibility_projection();

create or replace function public.report_lpg_station_inventory(
  target_station_branch_id uuid,
  target_physical_stock_kg numeric,
  target_measurement_method_key text,
  target_idempotency_key text,
  target_skima_allocation_kg numeric default null,
  target_tank_id uuid default null,
  target_note text default null,
  target_evidence_asset_ids uuid[] default array[]::uuid[],
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.inventory.manual',
  target_expected_version bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  existing_event_id uuid;
  observation_id uuid;
  inventory_event_id uuid;
  branch_record public.lpg_station_branches%rowtype;
  tank_record public.station_lpg_tanks%rowtype;
  state_record public.station_lpg_inventory_state%rowtype;
  previous_physical_kg numeric;
  reported_input_kg numeric;
  installed_usable_kg numeric;
  result jsonb;
begin
  if not public.can_manage_lpg_station_inventory(target_station_branch_id, 'station.inventory.update') then
    raise exception 'branch-scoped inventory update permission is required';
  end if;
  if target_physical_stock_kg is null or target_physical_stock_kg < 0 then
    raise exception 'current physical stock must be zero or greater';
  end if;
  if target_skima_allocation_kg is not null and target_skima_allocation_kg < 0 then
    raise exception 'SKIMA allocation must be zero or greater';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;
  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid key';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;
  reported_input_kg := target_physical_stock_kg;
  if not exists (
    select 1 from public.inventory_measurement_methods method
    where method.key = target_measurement_method_key and method.status = 'active'
  ) then
    raise exception 'select a supported inventory measurement method';
  end if;

  select event.id into existing_event_id
  from public.station_inventory_events event
  where event.source = target_source
    and event.idempotency_key = target_idempotency_key;
  if found then
    return existing_event_id;
  end if;

  select * into branch_record
  from public.lpg_station_branches
  where id = target_station_branch_id
  for update;
  if not found then
    raise exception 'target_station_branch_id must reference an LPG station branch';
  end if;
  select event.id into existing_event_id
  from public.station_inventory_events event
  where event.source = target_source
    and event.idempotency_key = target_idempotency_key;
  if found then
    return existing_event_id;
  end if;

  if target_tank_id is not null then
    select * into tank_record
    from public.station_lpg_tanks
    where id = target_tank_id and station_branch_id = target_station_branch_id
    for update;
    if not found then
      raise exception 'selected tank does not belong to this station';
    end if;
    if target_physical_stock_kg > tank_record.usable_capacity_kg then
      raise exception 'reported tank stock exceeds its usable capacity';
    end if;
  end if;

  select coalesce(sum(tank.usable_capacity_kg), branch_record.refill_capacity_kg, 0)
  into installed_usable_kg
  from public.station_lpg_tanks tank
  where tank.station_branch_id = target_station_branch_id
    and tank.status in ('active', 'maintenance', 'inspection_required');

  if installed_usable_kg <= 0 then
    raise exception 'configure station storage capacity before reporting stock';
  end if;
  if target_tank_id is null and target_physical_stock_kg > installed_usable_kg then
    raise exception 'reported physical stock exceeds installed usable capacity';
  end if;

  select state.* into state_record
  from public.station_lpg_inventory_state state
  where state.station_branch_id = target_station_branch_id
  for update;
  if not found then
    raise exception 'station inventory state is required';
  end if;
  if target_expected_version is not null and state_record.version <> target_expected_version then
    raise exception 'inventory changed while this form was open; refresh and review the latest stock';
  end if;
  previous_physical_kg := state_record.physical_stock_kg;

  if target_tank_id is not null then
    insert into public.station_lpg_tank_inventory_state (
      station_branch_id, tank_id, physical_stock_kg, observed_stock_kg,
      active_source_key, source_confidence, freshness_status,
      last_source_update_at, last_verified_at, metadata
    )
    values (
      target_station_branch_id, target_tank_id, target_physical_stock_kg, target_physical_stock_kg,
      'manual', 'HIGH', 'FRESH', timezone('utc', now()), timezone('utc', now()),
      jsonb_build_object('measurementMethodKey', target_measurement_method_key)
    )
    on conflict (tank_id) do update
    set physical_stock_kg = excluded.physical_stock_kg,
        observed_stock_kg = excluded.observed_stock_kg,
        active_source_key = excluded.active_source_key,
        source_confidence = excluded.source_confidence,
        freshness_status = excluded.freshness_status,
        last_source_update_at = excluded.last_source_update_at,
        last_verified_at = excluded.last_verified_at,
        version = public.station_lpg_tank_inventory_state.version + 1,
        metadata = public.station_lpg_tank_inventory_state.metadata || excluded.metadata,
        updated_at = timezone('utc', now());

    select coalesce(sum(tank_state.physical_stock_kg), 0)
    into target_physical_stock_kg
    from public.station_lpg_tank_inventory_state tank_state
    join public.station_lpg_tanks tank on tank.id = tank_state.tank_id
    where tank_state.station_branch_id = target_station_branch_id
      and tank.status in ('active', 'maintenance', 'inspection_required')
      and tank_state.physical_stock_kg is not null;
  end if;

  if target_skima_allocation_kg is not null then
    update public.station_inventory_configurations
    set allocation_mode = 'fixed_kg',
        allocation_value = target_skima_allocation_kg,
        status = 'active',
        version = version + 1,
        updated_by = auth.uid(),
        updated_at = timezone('utc', now())
    where station_branch_id = target_station_branch_id;
  else
    update public.station_inventory_configurations
    set status = 'active',
        version = version + 1,
        updated_by = auth.uid(),
        updated_at = timezone('utc', now())
    where station_branch_id = target_station_branch_id;
  end if;

  update public.station_lpg_inventory_state
  set physical_stock_kg = target_physical_stock_kg,
      reported_stock_kg = target_physical_stock_kg,
      observed_stock_kg = target_physical_stock_kg,
      calculated_stock_kg = target_physical_stock_kg,
      active_source_key = 'manual',
      source_confidence = 'HIGH',
      freshness_status = 'FRESH',
      source_health = 'healthy',
      reconciliation_status = 'current',
      rollout_status = 'active',
      last_source_update_at = timezone('utc', now()),
      last_verified_at = timezone('utc', now()),
      legacy_available_kg = coalesce(legacy_available_kg, branch_record.current_available_kg),
      metadata = metadata || jsonb_build_object(
        'lastMeasurementMethodKey', target_measurement_method_key,
        'lastManualReporterUserId', auth.uid(),
        'physicalStockConfirmed', true
      ),
      version = version + 1,
      updated_at = timezone('utc', now())
  where station_branch_id = target_station_branch_id;

  insert into public.station_inventory_observations (
    station_branch_id, tank_id, source_type_key, measurement_method_key,
    raw_value, raw_unit, normalized_stock_kg, skima_allocation_kg,
    observed_at, disposition, confidence, note, evidence_asset_ids,
    payload, source, idempotency_key
  )
  values (
    target_station_branch_id, target_tank_id, 'manual', target_measurement_method_key,
    reported_input_kg, 'kg', reported_input_kg, target_skima_allocation_kg,
    timezone('utc', now()), 'accepted', 'HIGH', nullif(btrim(target_note), ''),
    coalesce(target_evidence_asset_ids, array[]::uuid[]), target_metadata,
    target_source, target_idempotency_key || ':observation'
  )
  returning id into observation_id;

  perform set_config('skima.inventory_runtime', 'true', true);
  result := public.recalculate_lpg_station_inventory(target_station_branch_id, 'manual_stock_report');
  perform set_config('skima.inventory_runtime', 'false', true);

  if target_skima_allocation_kg is not null
     and (result ->> 'skimaAllocationKg')::numeric < target_skima_allocation_kg then
    raise exception 'SKIMA allocation exceeds safely usable stock after the configured safety reserve';
  end if;

  insert into public.station_inventory_events (
    station_branch_id, tank_id, observation_id, event_type, stock_delta_kg,
    resulting_physical_stock_kg, resulting_allocation_kg,
    resulting_reserved_kg, resulting_dispatchable_kg,
    reason_key, note, evidence_asset_ids, metadata, source, idempotency_key
  )
  values (
    target_station_branch_id, target_tank_id, observation_id, 'manual_stock_report',
    target_physical_stock_kg - coalesce(previous_physical_kg, 0),
    target_physical_stock_kg,
    (result ->> 'skimaAllocationKg')::numeric,
    (result ->> 'reservedKg')::numeric,
    (result ->> 'dispatchableKg')::numeric,
    'inventory.manual_stock_report', nullif(btrim(target_note), ''),
    coalesce(target_evidence_asset_ids, array[]::uuid[]), target_metadata,
    target_source, target_idempotency_key
  )
  returning id into inventory_event_id;

  return inventory_event_id;
end;
$$;

create or replace function public.confirm_lpg_station_inventory(
  target_station_branch_id uuid,
  target_idempotency_key text,
  target_note text default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.inventory.confirmation',
  target_expected_version bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  state_record public.station_lpg_inventory_state%rowtype;
  existing_event_id uuid;
  observation_id uuid;
  inventory_event_id uuid;
  result jsonb;
begin
  if not public.can_manage_lpg_station_inventory(target_station_branch_id, 'station.inventory.confirm') then
    raise exception 'branch-scoped inventory confirmation permission is required';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select event.id into existing_event_id
  from public.station_inventory_events event
  where event.source = target_source and event.idempotency_key = target_idempotency_key;
  if found then return existing_event_id; end if;

  select * into state_record
  from public.station_lpg_inventory_state
  where station_branch_id = target_station_branch_id
  for update;
  if not found or state_record.physical_stock_kg is null then
    raise exception 'report current physical stock before confirming inventory';
  end if;
  select event.id into existing_event_id
  from public.station_inventory_events event
  where event.source = target_source and event.idempotency_key = target_idempotency_key;
  if found then return existing_event_id; end if;
  if target_expected_version is not null and state_record.version <> target_expected_version then
    raise exception 'inventory changed before confirmation; refresh and review the latest stock';
  end if;

  update public.station_lpg_inventory_state
  set reported_stock_kg = physical_stock_kg,
      observed_stock_kg = physical_stock_kg,
      active_source_key = 'manual',
      source_confidence = 'HIGH',
      freshness_status = 'FRESH',
      source_health = 'healthy',
      rollout_status = 'active',
      last_source_update_at = timezone('utc', now()),
      last_verified_at = timezone('utc', now()),
      metadata = metadata || jsonb_build_object('lastManualConfirmationUserId', auth.uid()),
      version = version + 1,
      updated_at = timezone('utc', now())
  where station_branch_id = target_station_branch_id;

  insert into public.station_inventory_observations (
    station_branch_id, source_type_key, raw_value, raw_unit,
    normalized_stock_kg, observed_at, disposition, confidence,
    note, payload, source, idempotency_key
  )
  values (
    target_station_branch_id, 'manual', state_record.physical_stock_kg, 'kg',
    state_record.physical_stock_kg, timezone('utc', now()), 'accepted', 'HIGH',
    nullif(btrim(target_note), ''), target_metadata,
    target_source, target_idempotency_key || ':observation'
  )
  returning id into observation_id;

  perform set_config('skima.inventory_runtime', 'true', true);
  result := public.recalculate_lpg_station_inventory(target_station_branch_id, 'manual_confirmation');
  perform set_config('skima.inventory_runtime', 'false', true);

  insert into public.station_inventory_events (
    station_branch_id, observation_id, event_type, stock_delta_kg,
    resulting_physical_stock_kg, resulting_allocation_kg,
    resulting_reserved_kg, resulting_dispatchable_kg,
    reason_key, note, metadata, source, idempotency_key
  )
  values (
    target_station_branch_id, observation_id, 'manual_confirmation', 0,
    state_record.physical_stock_kg,
    (result ->> 'skimaAllocationKg')::numeric,
    (result ->> 'reservedKg')::numeric,
    (result ->> 'dispatchableKg')::numeric,
    'inventory.manual_confirmation', nullif(btrim(target_note), ''), target_metadata,
    target_source, target_idempotency_key
  )
  returning id into inventory_event_id;

  return inventory_event_id;
end;
$$;

create or replace function public.adjust_lpg_station_inventory(
  target_station_branch_id uuid,
  target_adjustment_kg numeric,
  target_adjustment_type_key text,
  target_idempotency_key text,
  target_tank_id uuid default null,
  target_note text default null,
  target_evidence_asset_ids uuid[] default array[]::uuid[],
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.inventory.adjustment',
  target_expected_version bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  adjustment_record public.inventory_adjustment_types%rowtype;
  state_record public.station_lpg_inventory_state%rowtype;
  config_record public.station_inventory_configurations%rowtype;
  tank_record public.station_lpg_tanks%rowtype;
  tank_state_record public.station_lpg_tank_inventory_state%rowtype;
  existing_event_id uuid;
  inventory_event_id uuid;
  resulting_physical_kg numeric;
  installed_usable_kg numeric;
  result jsonb;
begin
  if not public.can_manage_lpg_station_inventory(target_station_branch_id, 'station.inventory.adjust') then
    raise exception 'branch-scoped inventory adjustment permission is required';
  end if;
  if target_adjustment_kg is null or target_adjustment_kg = 0 then
    raise exception 'inventory adjustment must be non-zero';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select * into adjustment_record
  from public.inventory_adjustment_types adjustment
  where adjustment.key = target_adjustment_type_key and adjustment.status = 'active';
  if not found then
    raise exception 'select a supported inventory adjustment type';
  end if;
  if adjustment_record.direction = 'increase' and target_adjustment_kg < 0 then
    raise exception 'this adjustment type must increase stock';
  end if;
  if adjustment_record.direction = 'decrease' and target_adjustment_kg > 0 then
    raise exception 'this adjustment type must decrease stock';
  end if;
  if adjustment_record.direction = 'neutral' then
    raise exception 'use the tank transfer action for an internal tank transfer';
  end if;

  select event.id into existing_event_id
  from public.station_inventory_events event
  where event.source = target_source and event.idempotency_key = target_idempotency_key;
  if found then return existing_event_id; end if;

  select * into config_record
  from public.station_inventory_configurations
  where station_branch_id = target_station_branch_id
  for update;
  if not found then raise exception 'station inventory configuration is required'; end if;

  if config_record.primary_source_key <> 'manual'
     and (config_record.manual_fallback_until is null or config_record.manual_fallback_until <= timezone('utc', now())) then
    raise exception 'enable a time-limited manual fallback before changing provider-managed inventory';
  end if;

  select * into state_record
  from public.station_lpg_inventory_state
  where station_branch_id = target_station_branch_id
  for update;
  if not found or state_record.rollout_status <> 'active' or state_record.physical_stock_kg is null then
    raise exception 'report current physical stock before recording an adjustment';
  end if;
  select event.id into existing_event_id
  from public.station_inventory_events event
  where event.source = target_source and event.idempotency_key = target_idempotency_key;
  if found then return existing_event_id; end if;
  if target_expected_version is not null and state_record.version <> target_expected_version then
    raise exception 'inventory changed before this adjustment; refresh and review the latest stock';
  end if;

  resulting_physical_kg := state_record.physical_stock_kg + target_adjustment_kg;
  if resulting_physical_kg < 0 then
    raise exception 'inventory adjustment cannot reduce physical stock below zero';
  end if;

  select coalesce(sum(tank.usable_capacity_kg), station.refill_capacity_kg, 0)
  into installed_usable_kg
  from public.lpg_station_branches station
  left join public.station_lpg_tanks tank
    on tank.station_branch_id = station.id
   and tank.status in ('active', 'maintenance', 'inspection_required')
  where station.id = target_station_branch_id
  group by station.refill_capacity_kg;
  if resulting_physical_kg > installed_usable_kg then
    raise exception 'inventory adjustment cannot exceed installed usable capacity';
  end if;

  if target_tank_id is not null then
    select tank.*
    into tank_record
    from public.station_lpg_tanks tank
    join public.station_lpg_tank_inventory_state tank_state on tank_state.tank_id = tank.id
    where tank.id = target_tank_id and tank.station_branch_id = target_station_branch_id
    for update of tank, tank_state;
    if not found then
      raise exception 'selected tank needs a current tank-level stock reading';
    end if;

    select * into tank_state_record
    from public.station_lpg_tank_inventory_state
    where tank_id = target_tank_id
    for update;
    if tank_state_record.physical_stock_kg + target_adjustment_kg < 0
       or tank_state_record.physical_stock_kg + target_adjustment_kg > tank_record.usable_capacity_kg then
      raise exception 'tank adjustment must remain between zero and its usable capacity';
    end if;

    update public.station_lpg_tank_inventory_state
    set physical_stock_kg = physical_stock_kg + target_adjustment_kg,
        observed_stock_kg = physical_stock_kg + target_adjustment_kg,
        active_source_key = 'manual',
        source_confidence = 'HIGH',
        freshness_status = 'FRESH',
        last_source_update_at = timezone('utc', now()),
        last_verified_at = timezone('utc', now()),
        version = version + 1,
        updated_at = timezone('utc', now())
    where tank_id = target_tank_id;
  end if;

  update public.station_lpg_inventory_state
  set physical_stock_kg = resulting_physical_kg,
      reported_stock_kg = resulting_physical_kg,
      observed_stock_kg = resulting_physical_kg,
      calculated_stock_kg = resulting_physical_kg,
      active_source_key = 'manual',
      source_confidence = 'HIGH',
      freshness_status = 'FRESH',
      source_health = 'healthy',
      last_source_update_at = timezone('utc', now()),
      last_verified_at = timezone('utc', now()),
      version = version + 1,
      updated_at = timezone('utc', now())
  where station_branch_id = target_station_branch_id;

  perform set_config('skima.inventory_runtime', 'true', true);
  result := public.recalculate_lpg_station_inventory(target_station_branch_id, target_adjustment_type_key);
  perform set_config('skima.inventory_runtime', 'false', true);

  insert into public.station_inventory_events (
    station_branch_id, tank_id, event_type, stock_delta_kg,
    resulting_physical_stock_kg, resulting_allocation_kg,
    resulting_reserved_kg, resulting_dispatchable_kg,
    reason_key, note, evidence_asset_ids, metadata, source, idempotency_key
  )
  values (
    target_station_branch_id, target_tank_id, target_adjustment_type_key, target_adjustment_kg,
    resulting_physical_kg,
    (result ->> 'skimaAllocationKg')::numeric,
    (result ->> 'reservedKg')::numeric,
    (result ->> 'dispatchableKg')::numeric,
    'inventory.' || target_adjustment_type_key, nullif(btrim(target_note), ''),
    coalesce(target_evidence_asset_ids, array[]::uuid[]), target_metadata,
    target_source, target_idempotency_key
  )
  returning id into inventory_event_id;

  return inventory_event_id;
end;
$$;

create or replace function public.transfer_lpg_station_tank_stock(
  target_station_branch_id uuid,
  target_from_tank_id uuid,
  target_to_tank_id uuid,
  target_quantity_kg numeric,
  target_idempotency_key text,
  target_note text default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.inventory.tank_transfer'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  from_state public.station_lpg_tank_inventory_state%rowtype;
  to_state public.station_lpg_tank_inventory_state%rowtype;
  to_tank public.station_lpg_tanks%rowtype;
  first_event_id uuid;
  second_event_id uuid;
  existing_event_id uuid;
begin
  if not public.can_manage_lpg_station_inventory(target_station_branch_id, 'station.inventory.adjust') then
    raise exception 'branch-scoped inventory adjustment permission is required';
  end if;
  if target_from_tank_id is null or target_to_tank_id is null or target_from_tank_id = target_to_tank_id then
    raise exception 'choose two different station tanks';
  end if;
  if target_quantity_kg is null or target_quantity_kg <= 0 then
    raise exception 'transfer quantity must be greater than zero';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select event.id into existing_event_id
  from public.station_inventory_events event
  where event.source = target_source and event.idempotency_key = target_idempotency_key || ':out';
  if found then return existing_event_id; end if;

  -- Lock both tank-state rows in stable UUID order to avoid deadlocks.
  perform 1
  from public.station_lpg_tank_inventory_state tank_state
  where tank_state.tank_id in (target_from_tank_id, target_to_tank_id)
  order by tank_state.tank_id
  for update;

  select * into from_state
  from public.station_lpg_tank_inventory_state
  where tank_id = target_from_tank_id and station_branch_id = target_station_branch_id;
  select * into to_state
  from public.station_lpg_tank_inventory_state
  where tank_id = target_to_tank_id and station_branch_id = target_station_branch_id;
  select * into to_tank
  from public.station_lpg_tanks
  where id = target_to_tank_id and station_branch_id = target_station_branch_id;

  if from_state.id is null or to_state.id is null or to_tank.id is null
     or from_state.physical_stock_kg is null or to_state.physical_stock_kg is null then
    raise exception 'both tanks need current stock readings before a transfer';
  end if;
  if from_state.physical_stock_kg < target_quantity_kg then
    raise exception 'source tank does not contain enough recorded LPG';
  end if;
  if to_state.physical_stock_kg + target_quantity_kg > to_tank.usable_capacity_kg then
    raise exception 'destination tank does not have enough usable capacity';
  end if;

  update public.station_lpg_tank_inventory_state
  set physical_stock_kg = case
        when tank_id = target_from_tank_id then physical_stock_kg - target_quantity_kg
        else physical_stock_kg + target_quantity_kg
      end,
      observed_stock_kg = case
        when tank_id = target_from_tank_id then physical_stock_kg - target_quantity_kg
        else physical_stock_kg + target_quantity_kg
      end,
      active_source_key = 'manual',
      source_confidence = 'HIGH',
      freshness_status = 'FRESH',
      last_source_update_at = timezone('utc', now()),
      last_verified_at = timezone('utc', now()),
      version = version + 1,
      updated_at = timezone('utc', now())
  where tank_id in (target_from_tank_id, target_to_tank_id);

  insert into public.station_inventory_events (
    station_branch_id, tank_id, event_type, stock_delta_kg,
    resulting_physical_stock_kg, reason_key, note, metadata, source, idempotency_key
  )
  values (
    target_station_branch_id, target_from_tank_id, 'tank_transfer', -target_quantity_kg,
    from_state.physical_stock_kg - target_quantity_kg, 'inventory.tank_transfer',
    nullif(btrim(target_note), ''), target_metadata || jsonb_build_object('direction', 'out'),
    target_source, target_idempotency_key || ':out'
  )
  returning id into first_event_id;

  insert into public.station_inventory_events (
    station_branch_id, tank_id, linked_event_id, event_type, stock_delta_kg,
    resulting_physical_stock_kg, reason_key, note, metadata, source, idempotency_key
  )
  values (
    target_station_branch_id, target_to_tank_id, first_event_id, 'tank_transfer', target_quantity_kg,
    to_state.physical_stock_kg + target_quantity_kg, 'inventory.tank_transfer',
    nullif(btrim(target_note), ''), target_metadata || jsonb_build_object('direction', 'in'),
    target_source, target_idempotency_key || ':in'
  )
  returning id into second_event_id;

  return first_event_id;
end;
$$;

create or replace function public.configure_lpg_station_inventory(
  target_station_branch_id uuid,
  target_tracking_mode text,
  target_primary_source_key text,
  target_idempotency_key text,
  target_secondary_source_key text default null,
  target_fallback_source_key text default null,
  target_allocation_mode text default null,
  target_allocation_value numeric default null,
  target_safety_reserve_mode text default null,
  target_safety_reserve_value numeric default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.inventory.configuration',
  target_expected_version bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  config_record public.station_inventory_configurations%rowtype;
  inventory_event_id uuid;
  result jsonb;
begin
  if not public.can_manage_lpg_station_inventory(target_station_branch_id, 'station.inventory.sources.manage') then
    raise exception 'branch-scoped inventory source management permission is required';
  end if;
  if target_tracking_mode not in ('manual', 'pos', 'telemetry', 'multi') then
    raise exception 'select a supported inventory tracking mode';
  end if;
  if target_tracking_mode <> 'multi' and target_primary_source_key <> target_tracking_mode then
    raise exception 'primary inventory source must match the selected tracking mode';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;
  if not exists (
    select 1 from public.inventory_source_types source_type
    where source_type.key = target_primary_source_key and source_type.status = 'active'
  ) then
    raise exception 'primary inventory source is not available';
  end if;
  if target_primary_source_key <> 'manual' and not exists (
    select 1
    from public.provider_adapters adapter
    where adapter.provider_kind = 'inventory'
      and adapter.status = 'active'
      and adapter.config ->> 'inventory_source_type' = target_primary_source_key
  ) then
    raise exception 'no supported provider is currently available for the selected inventory source';
  end if;
  if target_secondary_source_key is not null and not exists (
    select 1 from public.inventory_source_types source_type
    where source_type.key = target_secondary_source_key and source_type.status = 'active'
  ) then
    raise exception 'secondary inventory source is not available';
  end if;
  if target_fallback_source_key is not null and not exists (
    select 1 from public.inventory_source_types source_type
    where source_type.key = target_fallback_source_key and source_type.status = 'active'
  ) then
    raise exception 'fallback inventory source is not available';
  end if;
  if target_primary_source_key = target_secondary_source_key
     or target_primary_source_key = target_fallback_source_key
     or (target_secondary_source_key is not null and target_secondary_source_key = target_fallback_source_key) then
    raise exception 'primary, secondary, and fallback inventory sources must be different';
  end if;
  if target_allocation_mode is not null and target_allocation_mode not in ('fixed_kg', 'percentage', 'dynamic') then
    raise exception 'select a supported SKIMA allocation mode';
  end if;
  if target_allocation_value is not null and target_allocation_value < 0 then
    raise exception 'allocation value must be zero or greater';
  end if;
  if coalesce(target_allocation_mode, '') = 'percentage' and target_allocation_value > 100 then
    raise exception 'allocation percentage cannot exceed 100';
  end if;
  if target_safety_reserve_mode is not null and target_safety_reserve_mode not in ('platform', 'fixed_kg', 'percentage', 'tank_specific') then
    raise exception 'select a supported safety reserve mode';
  end if;
  if target_safety_reserve_value is not null and target_safety_reserve_value < 0 then
    raise exception 'safety reserve value must be zero or greater';
  end if;
  if coalesce(target_safety_reserve_mode, '') = 'percentage' and target_safety_reserve_value > 100 then
    raise exception 'safety reserve percentage cannot exceed 100';
  end if;

  select * into config_record
  from public.station_inventory_configurations
  where station_branch_id = target_station_branch_id
  for update;
  if not found then raise exception 'station inventory configuration is required'; end if;
  if target_expected_version is not null and config_record.version <> target_expected_version then
    raise exception 'inventory settings changed while this form was open; refresh and review the latest setup';
  end if;

  if exists (
    select 1 from public.station_inventory_events event
    where event.source = target_source and event.idempotency_key = target_idempotency_key
  ) then
    return config_record.id;
  end if;

  update public.station_inventory_configurations
  set tracking_mode = target_tracking_mode,
      primary_source_key = target_primary_source_key,
      secondary_source_key = target_secondary_source_key,
      fallback_source_key = target_fallback_source_key,
      allocation_mode = coalesce(target_allocation_mode, allocation_mode),
      allocation_value = coalesce(target_allocation_value, allocation_value),
      safety_reserve_mode = coalesce(target_safety_reserve_mode, safety_reserve_mode),
      safety_reserve_value = case
        when target_safety_reserve_mode = 'platform' then null
        else coalesce(target_safety_reserve_value, safety_reserve_value)
      end,
      status = case
        when target_primary_source_key = 'manual'
          and exists (
            select 1 from public.station_lpg_inventory_state state
            where state.station_branch_id = target_station_branch_id and state.physical_stock_kg is not null
          ) then 'active'
        else 'setup_required'
      end,
      version = version + 1,
      metadata = metadata || target_metadata,
      updated_by = auth.uid(),
      updated_at = timezone('utc', now())
  where station_branch_id = target_station_branch_id
  returning * into config_record;

  update public.station_lpg_inventory_state
  set primary_source_key = target_primary_source_key,
      active_source_key = case when target_primary_source_key = 'manual' then active_source_key else null end,
      source_confidence = case when target_primary_source_key = 'manual' then source_confidence else 'UNTRUSTED' end,
      freshness_status = case when target_primary_source_key = 'manual' then freshness_status else 'UNKNOWN' end,
      source_health = case when target_primary_source_key = 'manual' then source_health else 'unknown' end,
      reconciliation_status = case when target_primary_source_key = 'manual' then reconciliation_status else 'review_required' end,
      version = version + 1,
      updated_at = timezone('utc', now())
  where station_branch_id = target_station_branch_id;

  perform set_config('skima.inventory_runtime', 'true', true);
  result := public.recalculate_lpg_station_inventory(target_station_branch_id, 'source_configuration_changed');
  perform set_config('skima.inventory_runtime', 'false', true);

  insert into public.station_inventory_events (
    station_branch_id, event_type, stock_delta_kg,
    resulting_physical_stock_kg, resulting_allocation_kg,
    resulting_reserved_kg, resulting_dispatchable_kg,
    reason_key, metadata, source, idempotency_key
  )
  values (
    target_station_branch_id, 'source_configuration_changed', 0,
    nullif(result ->> 'physicalStockKg', '')::numeric,
    (result ->> 'skimaAllocationKg')::numeric,
    (result ->> 'reservedKg')::numeric,
    (result ->> 'dispatchableKg')::numeric,
    'inventory.source_configuration_changed',
    target_metadata || jsonb_build_object(
      'trackingMode', target_tracking_mode,
      'primarySource', target_primary_source_key,
      'secondarySource', target_secondary_source_key,
      'fallbackSource', target_fallback_source_key
    ),
    target_source, target_idempotency_key
  )
  returning id into inventory_event_id;

  return config_record.id;
end;
$$;

create or replace function public.upsert_lpg_station_tank(
  target_station_branch_id uuid,
  target_tank_name text,
  target_tank_code text,
  target_rated_capacity_kg numeric,
  target_usable_capacity_kg numeric,
  target_idempotency_key text,
  target_tank_id uuid default null,
  target_minimum_safe_stock_kg numeric default 0,
  target_maximum_safe_fill_percentage numeric default 85,
  target_status text default 'active',
  target_inspection_status text default 'unknown',
  target_telemetry_capable boolean default false,
  target_installation_date date default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.inventory.tank_configuration'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  tank_record public.station_lpg_tanks%rowtype;
  state_record public.station_lpg_inventory_state%rowtype;
  installed_rated_kg numeric;
  installed_usable_kg numeric;
  inventory_event_id uuid;
begin
  if not public.can_manage_lpg_station_inventory(target_station_branch_id, 'station.inventory.sources.manage') then
    raise exception 'branch-scoped inventory setup permission is required';
  end if;
  if target_tank_name is null or char_length(btrim(target_tank_name)) < 2 then
    raise exception 'tank name is required';
  end if;
  if target_tank_code is null or target_tank_code !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{1,79}$' then
    raise exception 'tank code must use letters, numbers, dots, dashes, or underscores';
  end if;
  if target_rated_capacity_kg is null or target_rated_capacity_kg <= 0
     or target_usable_capacity_kg is null or target_usable_capacity_kg <= 0
     or target_usable_capacity_kg > target_rated_capacity_kg then
    raise exception 'usable capacity must be positive and cannot exceed rated capacity';
  end if;
  if coalesce(target_minimum_safe_stock_kg, 0) < 0
     or coalesce(target_minimum_safe_stock_kg, 0) > target_usable_capacity_kg then
    raise exception 'minimum safe stock must fit within usable capacity';
  end if;
  if target_maximum_safe_fill_percentage is null
     or target_maximum_safe_fill_percentage <= 0
     or target_maximum_safe_fill_percentage > 100 then
    raise exception 'maximum safe fill percentage must be between 0 and 100';
  end if;
  if target_status not in ('active', 'inactive', 'maintenance', 'inspection_required', 'decommissioned', 'unknown') then
    raise exception 'select a supported tank status';
  end if;
  if target_inspection_status not in ('unknown', 'current', 'due_soon', 'overdue', 'failed', 'not_required') then
    raise exception 'select a supported tank inspection status';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;
  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,105}$' then
    raise exception 'target_source must be a valid key';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  if target_tank_id is not null and exists (
    select 1
    from public.station_inventory_events event
    where event.source = target_source || '.event'
      and event.idempotency_key = target_idempotency_key
      and event.related_entity_id = target_tank_id
  ) then
    return target_tank_id;
  end if;

  select * into tank_record
  from public.station_lpg_tanks tank
  where tank.source = target_source and tank.idempotency_key = target_idempotency_key;
  if found then return tank_record.id; end if;

  if target_tank_id is null then
    insert into public.station_lpg_tanks (
      station_branch_id, tank_name, tank_code, rated_capacity_kg,
      usable_capacity_kg, minimum_safe_stock_kg, maximum_safe_fill_percentage,
      status, inspection_status, telemetry_capable, installation_date,
      metadata, source, idempotency_key
    )
    values (
      target_station_branch_id, btrim(target_tank_name), upper(btrim(target_tank_code)),
      target_rated_capacity_kg, target_usable_capacity_kg,
      coalesce(target_minimum_safe_stock_kg, 0), target_maximum_safe_fill_percentage,
      target_status, target_inspection_status, coalesce(target_telemetry_capable, false),
      target_installation_date, target_metadata, target_source, target_idempotency_key
    )
    returning * into tank_record;

    insert into public.station_lpg_tank_inventory_state (
      station_branch_id, tank_id, metadata
    )
    values (
      target_station_branch_id, tank_record.id, '{"requiresStockReading":true}'::jsonb
    );
  else
    select * into tank_record
    from public.station_lpg_tanks tank
    where tank.id = target_tank_id and tank.station_branch_id = target_station_branch_id
    for update;
    if not found then raise exception 'selected tank does not belong to this station'; end if;

    update public.station_lpg_tanks
    set tank_name = btrim(target_tank_name),
        tank_code = upper(btrim(target_tank_code)),
        rated_capacity_kg = target_rated_capacity_kg,
        usable_capacity_kg = target_usable_capacity_kg,
        minimum_safe_stock_kg = coalesce(target_minimum_safe_stock_kg, 0),
        maximum_safe_fill_percentage = target_maximum_safe_fill_percentage,
        status = target_status,
        inspection_status = target_inspection_status,
        telemetry_capable = coalesce(target_telemetry_capable, false),
        installation_date = target_installation_date,
        metadata = metadata || target_metadata,
        updated_by = auth.uid(),
        updated_at = timezone('utc', now())
    where id = target_tank_id
    returning * into tank_record;
  end if;

  select coalesce(sum(tank.rated_capacity_kg), 0), coalesce(sum(tank.usable_capacity_kg), 0)
  into installed_rated_kg, installed_usable_kg
  from public.station_lpg_tanks tank
  where tank.station_branch_id = target_station_branch_id
    and tank.status in ('active', 'maintenance', 'inspection_required');

  select * into state_record
  from public.station_lpg_inventory_state
  where station_branch_id = target_station_branch_id
  for update;
  if state_record.physical_stock_kg is not null and state_record.physical_stock_kg > installed_usable_kg then
    raise exception 'tank configuration cannot place confirmed physical stock above total usable capacity';
  end if;

  update public.lpg_station_branches
  set refill_capacity_kg = installed_rated_kg,
      metadata = metadata || jsonb_build_object(
        'installed_tank_count', (
          select count(*) from public.station_lpg_tanks tank
          where tank.station_branch_id = target_station_branch_id and tank.status <> 'decommissioned'
        ),
        'installed_usable_capacity_kg', installed_usable_kg
      ),
      updated_at = timezone('utc', now())
  where id = target_station_branch_id;

  insert into public.station_inventory_events (
    station_branch_id, tank_id, event_type, stock_delta_kg,
    resulting_physical_stock_kg, reason_key, related_entity_type,
    related_entity_id, metadata, source, idempotency_key
  )
  values (
    target_station_branch_id, tank_record.id, 'tank_configuration_updated', 0,
    state_record.physical_stock_kg, 'inventory.tank_configuration_updated',
    'inventory.tank', tank_record.id,
    target_metadata || jsonb_build_object(
      'tankPublicReference', tank_record.public_reference,
      'installedRatedCapacityKg', installed_rated_kg,
      'installedUsableCapacityKg', installed_usable_kg
    ),
    target_source || '.event', target_idempotency_key
  )
  returning id into inventory_event_id;

  if state_record.rollout_status = 'active' then
    perform set_config('skima.inventory_runtime', 'true', true);
    perform public.recalculate_lpg_station_inventory(target_station_branch_id, 'tank_configuration_updated');
    perform set_config('skima.inventory_runtime', 'false', true);
  end if;

  return tank_record.id;
end;
$$;

create or replace function public.enable_lpg_station_inventory_manual_fallback(
  target_station_branch_id uuid,
  target_duration_hours numeric,
  target_reason text,
  target_idempotency_key text,
  target_source text default 'skima.lpg.inventory.manual_fallback'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  config_id uuid;
  maximum_hours numeric;
  inventory_event_id uuid;
begin
  if not public.can_manage_lpg_station_inventory(target_station_branch_id, 'station.inventory.sources.manage') then
    raise exception 'branch-scoped inventory source management permission is required';
  end if;
  maximum_hours := nullif(public.inventory_runtime_policy() ->> 'manualFallbackMaximumHours', '')::numeric;
  if target_duration_hours is null or target_duration_hours <= 0 or target_duration_hours > maximum_hours then
    raise exception 'manual fallback duration must be within the configured limit';
  end if;
  if target_reason is null or char_length(btrim(target_reason)) < 5 then
    raise exception 'explain why manual fallback is needed';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select event.id into inventory_event_id
  from public.station_inventory_events event
  where event.source = target_source and event.idempotency_key = target_idempotency_key;
  if found then return inventory_event_id; end if;

  update public.station_inventory_configurations
  set manual_fallback_until = timezone('utc', now()) + make_interval(secs => (target_duration_hours * 3600)::double precision),
      fallback_source_key = 'manual',
      version = version + 1,
      updated_by = auth.uid(),
      updated_at = timezone('utc', now())
  where station_branch_id = target_station_branch_id
  returning id into config_id;
  if config_id is null then raise exception 'station inventory configuration is required'; end if;

  insert into public.station_inventory_events (
    station_branch_id, event_type, stock_delta_kg, reason_key, note,
    related_entity_type, related_entity_id, metadata, source, idempotency_key
  )
  values (
    target_station_branch_id, 'manual_fallback_enabled', 0,
    'inventory.manual_fallback_enabled', btrim(target_reason),
    'inventory.configuration', config_id,
    jsonb_build_object('durationHours', target_duration_hours),
    target_source, target_idempotency_key
  )
  returning id into inventory_event_id;

  return inventory_event_id;
end;
$$;

create or replace function public.read_inventory_provider_catalog(
  target_source_type_key text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'providerKey', adapter.key,
      'providerName', adapter.display_name,
      'providerLogoUrl', adapter.config ->> 'logo_url',
      'providerType', adapter.config ->> 'inventory_source_type',
      'description', adapter.config ->> 'description',
      'connectionMethod', adapter.config ->> 'connection_method',
      'supportedCapabilities', coalesce(adapter.config -> 'supported_capabilities', '[]'::jsonb),
      'documentationUrl', adapter.config ->> 'documentation_url',
      'enabled', adapter.status = 'active',
      'countries', coalesce(adapter.config -> 'countries', '[]'::jsonb),
      'requirements', coalesce(adapter.config -> 'requirements', '[]'::jsonb)
    ) order by adapter.display_name
  ), '[]'::jsonb)
  from public.provider_adapters adapter
  where adapter.provider_kind = 'inventory'
    and adapter.status = 'active'
    and (
      target_source_type_key is null
      or adapter.config ->> 'inventory_source_type' = target_source_type_key
    );
$$;

create or replace function public.configure_lpg_inventory_provider_connection(
  target_station_branch_id uuid,
  target_provider_key text,
  target_display_name text,
  target_idempotency_key text,
  target_settings jsonb default '{}'::jsonb,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.inventory.provider_connection'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  adapter_record public.provider_adapters%rowtype;
  connection_record public.station_inventory_provider_connections%rowtype;
  source_type_key text;
  connection_method text;
begin
  if not public.can_manage_lpg_station_inventory(target_station_branch_id, 'station.inventory.providers.manage') then
    raise exception 'branch-scoped inventory provider management permission is required';
  end if;
  if target_display_name is null or char_length(btrim(target_display_name)) < 2 then
    raise exception 'connection name is required';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;
  if target_settings is null or jsonb_typeof(target_settings) <> 'object'
     or target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'connection settings and metadata must be JSON objects';
  end if;

  select * into connection_record
  from public.station_inventory_provider_connections connection
  where connection.source = target_source and connection.idempotency_key = target_idempotency_key;
  if found then return connection_record.id; end if;

  select * into adapter_record
  from public.provider_adapters adapter
  where adapter.provider_kind = 'inventory'
    and adapter.key = target_provider_key
    and adapter.status = 'active';
  if not found then raise exception 'selected inventory provider is not available'; end if;

  source_type_key := adapter_record.config ->> 'inventory_source_type';
  connection_method := adapter_record.config ->> 'connection_method';
  if source_type_key not in ('pos', 'telemetry')
     or connection_method not in ('oauth', 'api_key', 'webhook', 'polling', 'device_gateway', 'managed') then
    raise exception 'inventory provider catalog configuration is incomplete';
  end if;

  -- Secrets are deliberately absent here. A backend provider-connection handler
  -- stores credentials in the configured secret store, then binds only its ref.
  insert into public.station_inventory_provider_connections (
    station_branch_id, provider_adapter_id, source_type_key, display_name,
    connection_method, status, health_status, settings, metadata,
    source, idempotency_key
  )
  values (
    target_station_branch_id, adapter_record.id, source_type_key,
    btrim(target_display_name), connection_method, 'pending', 'unknown',
    target_settings, target_metadata, target_source, target_idempotency_key
  )
  returning * into connection_record;

  return connection_record.id;
end;
$$;

create or replace function public.bind_lpg_inventory_provider_secret(
  target_connection_id uuid,
  target_credential_secret_ref text,
  target_status text default 'active',
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  connection_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'backend provider credential binding is required';
  end if;
  if target_credential_secret_ref is null
     or target_credential_secret_ref !~ '^(SUPABASE_SECRET|VAULT_SECRET|PROVIDER_SECRET):[A-Za-z0-9_.:-]{3,180}$' then
    raise exception 'credential secret reference is invalid';
  end if;
  if target_status not in ('active', 'connecting') then
    raise exception 'provider connection status is invalid';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  update public.station_inventory_provider_connections
  set credential_secret_ref = target_credential_secret_ref,
      status = target_status,
      health_status = case when target_status = 'active' then 'healthy' else 'unknown' end,
      last_connected_at = case when target_status = 'active' then timezone('utc', now()) else last_connected_at end,
      credential_rotated_at = timezone('utc', now()),
      metadata = metadata || target_metadata,
      updated_at = timezone('utc', now())
  where id = target_connection_id
  returning id into connection_id;

  if connection_id is null then raise exception 'inventory provider connection was not found'; end if;
  return connection_id;
end;
$$;

create or replace function public.ingest_lpg_inventory_provider_observation(
  target_connection_id uuid,
  target_stock_kg numeric,
  target_observed_at timestamptz,
  target_provider_event_reference text,
  target_idempotency_key text,
  target_provider_sequence bigint default null,
  target_tank_id uuid default null,
  target_telemetry_device_id uuid default null,
  target_raw_value numeric default null,
  target_raw_unit text default null,
  target_payload jsonb default '{}'::jsonb,
  target_source text default 'inventory.provider_adapter'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  connection_record public.station_inventory_provider_connections%rowtype;
  config_record public.station_inventory_configurations%rowtype;
  state_record public.station_lpg_inventory_state%rowtype;
  latest_observation public.station_inventory_observations%rowtype;
  comparison_observation public.station_inventory_observations%rowtype;
  observation_id uuid;
  existing_observation_id uuid;
  disposition text := 'accepted';
  should_apply boolean := false;
  normalized_stock_kg numeric;
  discrepancy_kg numeric := 0;
  tolerance_kg numeric;
  future_skew_seconds integer;
  replay_age_hours integer;
  installed_usable_kg numeric;
  result jsonb;
begin
  if auth.role() <> 'service_role'
     and coalesce(current_setting('skima.inventory_provider_ingest', true), '') <> 'true' then
    raise exception 'backend inventory provider ingestion is required';
  end if;
  if target_stock_kg is null or target_stock_kg < 0 then
    raise exception 'normalized provider stock must be zero or greater';
  end if;
  if target_observed_at is null then raise exception 'target_observed_at is required'; end if;
  if target_provider_event_reference is null or btrim(target_provider_event_reference) = '' then
    raise exception 'provider event reference is required';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;
  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,105}$' then
    raise exception 'target_source must be a valid key';
  end if;
  if target_payload is null or jsonb_typeof(target_payload) <> 'object' then
    raise exception 'target_payload must be a JSON object';
  end if;

  select observation.id into existing_observation_id
  from public.station_inventory_observations observation
  where (observation.source = target_source and observation.idempotency_key = target_idempotency_key)
     or (
       observation.provider_connection_id = target_connection_id
       and observation.provider_event_reference = btrim(target_provider_event_reference)
     )
  order by case
    when observation.source = target_source and observation.idempotency_key = target_idempotency_key then 0
    else 1
  end
  limit 1;
  if found then return existing_observation_id; end if;

  select * into connection_record
  from public.station_inventory_provider_connections connection
  where connection.id = target_connection_id
  for update;
  if not found or connection_record.status not in ('active', 'degraded') then
    raise exception 'active inventory provider connection is required';
  end if;

  future_skew_seconds := nullif(public.inventory_runtime_policy() ->> 'maximumObservationFutureSkewSeconds', '')::integer;
  replay_age_hours := nullif(public.inventory_runtime_policy() ->> 'maximumProviderReplayAgeHours', '')::integer;
  tolerance_kg := nullif(public.inventory_runtime_policy() ->> 'discrepancyToleranceKg', '')::numeric;
  if target_observed_at > timezone('utc', now()) + make_interval(secs => future_skew_seconds)
     or target_observed_at < timezone('utc', now()) - make_interval(hours => replay_age_hours) then
    raise exception 'provider observation timestamp is outside the accepted window';
  end if;

  if target_tank_id is not null and not exists (
    select 1 from public.station_lpg_tanks tank
    where tank.id = target_tank_id and tank.station_branch_id = connection_record.station_branch_id
  ) then
    raise exception 'provider tank does not belong to the connected station';
  end if;
  if target_telemetry_device_id is not null and not exists (
    select 1 from public.station_inventory_telemetry_devices device
    where device.id = target_telemetry_device_id
      and device.station_branch_id = connection_record.station_branch_id
      and device.provider_connection_id = connection_record.id
  ) then
    raise exception 'telemetry device does not belong to this provider connection';
  end if;

  select coalesce(sum(tank.usable_capacity_kg), station.refill_capacity_kg, 0)
  into installed_usable_kg
  from public.lpg_station_branches station
  left join public.station_lpg_tanks tank
    on tank.station_branch_id = station.id
   and tank.status in ('active', 'maintenance', 'inspection_required')
  where station.id = connection_record.station_branch_id
  group by station.refill_capacity_kg;
  if target_stock_kg > installed_usable_kg then
    raise exception 'normalized provider stock exceeds installed usable capacity';
  end if;

  select * into latest_observation
  from public.station_inventory_observations observation
  where observation.provider_connection_id = connection_record.id
    and observation.disposition = 'accepted'
  order by observation.observed_at desc, observation.received_at desc
  limit 1;

  if latest_observation.id is not null and (
    target_observed_at < latest_observation.observed_at
    or (target_provider_sequence is not null
      and latest_observation.provider_sequence is not null
      and target_provider_sequence <= latest_observation.provider_sequence)
  ) then
    disposition := 'out_of_order';
  end if;

  normalized_stock_kg := round(target_stock_kg, 3);
  insert into public.station_inventory_observations (
    station_branch_id, tank_id, provider_connection_id, telemetry_device_id,
    source_type_key, raw_value, raw_unit, normalized_stock_kg,
    provider_event_reference, provider_sequence, observed_at, disposition,
    confidence, payload, source, idempotency_key
  )
  values (
    connection_record.station_branch_id, target_tank_id, connection_record.id,
    target_telemetry_device_id, connection_record.source_type_key,
    coalesce(target_raw_value, target_stock_kg), coalesce(target_raw_unit, 'kg'),
    normalized_stock_kg, btrim(target_provider_event_reference), target_provider_sequence,
    target_observed_at, disposition,
    case when connection_record.health_status = 'healthy' then 'HIGH' else 'MEDIUM' end,
    target_payload, target_source, target_idempotency_key
  )
  on conflict do nothing
  returning id into observation_id;

  if observation_id is null then
    select observation.id into existing_observation_id
    from public.station_inventory_observations observation
    where (observation.source = target_source and observation.idempotency_key = target_idempotency_key)
       or (
         observation.provider_connection_id = target_connection_id
         and observation.provider_event_reference = btrim(target_provider_event_reference)
       )
    order by observation.received_at asc
    limit 1;
    if existing_observation_id is null then
      raise exception 'provider observation could not be recorded safely';
    end if;
    return existing_observation_id;
  end if;

  if disposition = 'out_of_order' then
    return observation_id;
  end if;

  select * into config_record
  from public.station_inventory_configurations
  where station_branch_id = connection_record.station_branch_id
  for update;
  select * into state_record
  from public.station_lpg_inventory_state
  where station_branch_id = connection_record.station_branch_id
  for update;

  should_apply := connection_record.source_type_key = config_record.primary_source_key
    or (
      connection_record.source_type_key = config_record.secondary_source_key
      and (state_record.active_source_key is null or state_record.freshness_status in ('STALE', 'UNKNOWN') or state_record.source_health = 'offline')
    )
    or (
      connection_record.source_type_key = config_record.fallback_source_key
      and (state_record.active_source_key is null or state_record.freshness_status = 'STALE' or state_record.source_health = 'offline')
    );

  if should_apply then
    select observation.* into comparison_observation
    from public.station_inventory_observations observation
    where observation.station_branch_id = connection_record.station_branch_id
      and observation.id <> observation_id
      and observation.source_type_key <> connection_record.source_type_key
      and observation.disposition = 'accepted'
      and observation.observed_at >= timezone('utc', now()) - make_interval(mins => nullif(public.inventory_runtime_policy() ->> 'manualStaleIntervalMinutes', '')::integer)
    order by observation.observed_at desc
    limit 1;

    if comparison_observation.id is not null then
      discrepancy_kg := abs(normalized_stock_kg - comparison_observation.normalized_stock_kg);
      if discrepancy_kg > tolerance_kg then
        normalized_stock_kg := least(normalized_stock_kg, comparison_observation.normalized_stock_kg);
        update public.station_inventory_observations
        set disposition = 'reconciliation_required'
        where id = observation_id;

        insert into public.station_inventory_reconciliation_cases (
          station_branch_id, case_type, status, severity, expected_stock_kg,
          observed_stock_kg, difference_kg, source_observation_ids,
          summary, metadata, source, idempotency_key
        )
        values (
          connection_record.station_branch_id, 'cross_source_disagreement', 'open',
          case when discrepancy_kg > tolerance_kg * 3 then 'high' else 'medium' end,
          comparison_observation.normalized_stock_kg, target_stock_kg, discrepancy_kg,
          array[comparison_observation.id, observation_id],
          'Connected inventory sources reported materially different stock levels.',
          jsonb_build_object('conservativeStockKg', normalized_stock_kg),
          target_source || '.reconciliation', target_idempotency_key
        )
        on conflict (source, idempotency_key) do nothing;
      end if;
    end if;

    if target_tank_id is not null then
      insert into public.station_lpg_tank_inventory_state (
        station_branch_id, tank_id, physical_stock_kg, observed_stock_kg,
        active_source_key, source_confidence, freshness_status,
        last_source_update_at, last_verified_at, metadata
      )
      values (
        connection_record.station_branch_id, target_tank_id, normalized_stock_kg,
        normalized_stock_kg, connection_record.source_type_key,
        case when connection_record.health_status = 'healthy' then 'HIGH' else 'MEDIUM' end,
        'FRESH', target_observed_at, target_observed_at,
        jsonb_build_object('providerConnectionId', connection_record.id)
      )
      on conflict (tank_id) do update
      set physical_stock_kg = excluded.physical_stock_kg,
          observed_stock_kg = excluded.observed_stock_kg,
          active_source_key = excluded.active_source_key,
          source_confidence = excluded.source_confidence,
          freshness_status = excluded.freshness_status,
          last_source_update_at = excluded.last_source_update_at,
          last_verified_at = excluded.last_verified_at,
          version = public.station_lpg_tank_inventory_state.version + 1,
          metadata = public.station_lpg_tank_inventory_state.metadata || excluded.metadata,
          updated_at = timezone('utc', now());

      select coalesce(sum(tank_state.physical_stock_kg), 0)
      into normalized_stock_kg
      from public.station_lpg_tank_inventory_state tank_state
      join public.station_lpg_tanks tank on tank.id = tank_state.tank_id
      where tank_state.station_branch_id = connection_record.station_branch_id
        and tank.status in ('active', 'maintenance', 'inspection_required')
        and tank_state.physical_stock_kg is not null;
    end if;

    update public.station_lpg_inventory_state
    set physical_stock_kg = normalized_stock_kg,
        observed_stock_kg = normalized_stock_kg,
        calculated_stock_kg = normalized_stock_kg,
        active_source_key = connection_record.source_type_key,
        source_confidence = case when connection_record.health_status = 'healthy' then 'HIGH' else 'MEDIUM' end,
        freshness_status = 'FRESH',
        source_health = connection_record.health_status,
        reconciliation_status = case when discrepancy_kg > tolerance_kg then 'open' else 'current' end,
        rollout_status = 'active',
        last_source_update_at = target_observed_at,
        last_verified_at = timezone('utc', now()),
        version = version + 1,
        updated_at = timezone('utc', now())
    where station_branch_id = connection_record.station_branch_id;

    update public.station_inventory_configurations
    set status = 'active', version = version + 1, updated_at = timezone('utc', now())
    where station_branch_id = connection_record.station_branch_id;

    perform set_config('skima.inventory_runtime', 'true', true);
    result := public.recalculate_lpg_station_inventory(connection_record.station_branch_id, 'provider_observation');
    perform set_config('skima.inventory_runtime', 'false', true);

    insert into public.station_inventory_events (
      station_branch_id, tank_id, observation_id, event_type, stock_delta_kg,
      resulting_physical_stock_kg, resulting_allocation_kg,
      resulting_reserved_kg, resulting_dispatchable_kg,
      reason_key, related_entity_type, related_entity_id,
      metadata, source, idempotency_key
    )
    values (
      connection_record.station_branch_id, target_tank_id, observation_id,
      connection_record.source_type_key || '_observation',
      normalized_stock_kg - coalesce(state_record.physical_stock_kg, 0),
      normalized_stock_kg,
      (result ->> 'skimaAllocationKg')::numeric,
      (result ->> 'reservedKg')::numeric,
      (result ->> 'dispatchableKg')::numeric,
      'inventory.provider_observation', 'inventory.provider_connection', connection_record.id,
      jsonb_build_object('providerEventReference', target_provider_event_reference),
      target_source || '.event', target_idempotency_key
    );
  end if;

  update public.station_inventory_provider_connections
  set status = 'active',
      health_status = 'healthy',
      last_successful_sync_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = connection_record.id;

  if target_telemetry_device_id is not null then
    update public.station_inventory_telemetry_devices
    set status = 'active', health_status = 'healthy', last_reading_at = target_observed_at,
        updated_at = timezone('utc', now())
    where id = target_telemetry_device_id;
  end if;

  return observation_id;
end;
$$;

create or replace function public.sync_lpg_inventory_reservation_from_legacy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  state_record public.station_lpg_inventory_state%rowtype;
  reservation_record public.station_inventory_reservations%rowtype;
  result jsonb;
  event_key text;
  event_source text := 'inventory.legacy_reservation';
  release_status text;
  previous_station_branch_id uuid;
  consumption_delta numeric := 0;
begin
  select * into state_record
  from public.station_lpg_inventory_state state
  where state.station_branch_id = new.station_branch_id
  for update;

  if not found or state_record.rollout_status <> 'active' then
    return new;
  end if;

  select * into reservation_record
  from public.station_inventory_reservations reservation
  where reservation.legacy_reservation_id = new.id
     or reservation.lpg_order_id = new.lpg_order_id
  order by case when reservation.legacy_reservation_id = new.id then 0 else 1 end
  limit 1
  for update;

  if tg_op = 'INSERT' or new.status = 'reserved' then
    if reservation_record.id is null then
      if state_record.dispatchable_kg < new.reserved_kg then
        raise exception 'station inventory could not reserve the requested kilograms';
      end if;

      insert into public.station_inventory_reservations (
        station_branch_id, lpg_order_id, legacy_reservation_id,
        requested_kg, reserved_kg, consumed_kg, status, expires_at,
        metadata, source, idempotency_key
      )
      values (
        new.station_branch_id, new.lpg_order_id, new.id,
        new.requested_kg, new.reserved_kg, 0, 'reserved', new.expires_at,
        new.metadata || jsonb_build_object('compatibilitySource', 'lpg_station_capacity_reservations'),
        event_source, new.id::text
      )
      returning * into reservation_record;
    elsif reservation_record.status <> 'reserved'
       or reservation_record.station_branch_id <> new.station_branch_id
       or reservation_record.reserved_kg <> new.reserved_kg then
      if state_record.dispatchable_kg < new.reserved_kg then
        raise exception 'station inventory could not reserve the requested kilograms';
      end if;
      previous_station_branch_id := reservation_record.station_branch_id;
      update public.station_inventory_reservations
      set station_branch_id = new.station_branch_id,
          legacy_reservation_id = new.id,
          requested_kg = new.requested_kg,
          reserved_kg = new.reserved_kg,
          consumed_kg = 0,
          status = 'reserved',
          expires_at = new.expires_at,
          consumed_at = null,
          released_at = null,
          release_reason = null,
          version = version + 1,
          metadata = metadata || new.metadata,
          updated_at = timezone('utc', now())
      where id = reservation_record.id
      returning * into reservation_record;
    else
      update public.station_inventory_reservations
      set expires_at = new.expires_at,
          metadata = metadata || new.metadata,
          version = version + 1,
          updated_at = timezone('utc', now())
      where id = reservation_record.id
      returning * into reservation_record;
    end if;

    perform set_config('skima.inventory_runtime', 'true', true);
    result := public.recalculate_lpg_station_inventory(new.station_branch_id, 'skima_reservation');
    if previous_station_branch_id is not null and previous_station_branch_id <> new.station_branch_id
       and exists (
         select 1 from public.station_lpg_inventory_state state
         where state.station_branch_id = previous_station_branch_id and state.rollout_status = 'active'
       ) then
      perform public.recalculate_lpg_station_inventory(previous_station_branch_id, 'reservation_reassigned');
    end if;
    perform set_config('skima.inventory_runtime', 'false', true);

    event_key := new.id::text || ':reserved:' || reservation_record.version::text;
    insert into public.station_inventory_events (
      station_branch_id, event_type, stock_delta_kg,
      resulting_physical_stock_kg, resulting_allocation_kg,
      resulting_reserved_kg, resulting_dispatchable_kg,
      reason_key, related_entity_type, related_entity_id,
      metadata, source, idempotency_key
    )
    values (
      new.station_branch_id, 'skima_reservation', 0,
      nullif(result ->> 'physicalStockKg', '')::numeric,
      (result ->> 'skimaAllocationKg')::numeric,
      (result ->> 'reservedKg')::numeric,
      (result ->> 'dispatchableKg')::numeric,
      'inventory.skima_reservation', 'inventory.reservation', reservation_record.id,
      jsonb_build_object('lpgOrderId', new.lpg_order_id, 'reservedKg', new.reserved_kg),
      event_source, event_key
    )
    on conflict (source, idempotency_key) do nothing;

    return new;
  end if;

  if reservation_record.id is null then
    return new;
  end if;

  if new.status = 'consumed' and (
    reservation_record.status not in ('consumed', 'partially_consumed')
    or reservation_record.consumed_kg <> new.consumed_kg
  ) then
    consumption_delta := new.consumed_kg - reservation_record.consumed_kg;
    if consumption_delta > coalesce(state_record.physical_stock_kg, 0) then
      raise exception 'actual filled kilograms exceed recorded physical stock';
    end if;

    update public.station_lpg_inventory_state
    set physical_stock_kg = physical_stock_kg - consumption_delta,
        calculated_stock_kg = greatest(coalesce(calculated_stock_kg, physical_stock_kg) - consumption_delta, 0),
        version = version + 1,
        updated_at = timezone('utc', now())
    where station_branch_id = new.station_branch_id;

    update public.station_inventory_reservations
    set consumed_kg = new.consumed_kg,
        status = case when new.consumed_kg < reserved_kg then 'partially_consumed' else 'consumed' end,
        consumed_at = timezone('utc', now()),
        version = version + 1,
        metadata = metadata || new.metadata,
        updated_at = timezone('utc', now())
    where id = reservation_record.id
    returning * into reservation_record;

    perform set_config('skima.inventory_runtime', 'true', true);
    result := public.recalculate_lpg_station_inventory(new.station_branch_id, 'skima_refill_consumption');
    perform set_config('skima.inventory_runtime', 'false', true);

    event_key := new.id::text || ':consumed:' || reservation_record.version::text;
    insert into public.station_inventory_events (
      station_branch_id, event_type, stock_delta_kg,
      resulting_physical_stock_kg, resulting_allocation_kg,
      resulting_reserved_kg, resulting_dispatchable_kg,
      reason_key, related_entity_type, related_entity_id,
      metadata, source, idempotency_key
    )
    values (
      new.station_branch_id, 'skima_refill_consumption', -consumption_delta,
      nullif(result ->> 'physicalStockKg', '')::numeric,
      (result ->> 'skimaAllocationKg')::numeric,
      (result ->> 'reservedKg')::numeric,
      (result ->> 'dispatchableKg')::numeric,
      'inventory.skima_refill_consumption', 'inventory.reservation', reservation_record.id,
      jsonb_build_object(
        'lpgOrderId', new.lpg_order_id,
        'reservedKg', new.reserved_kg,
        'actualFilledKg', new.consumed_kg,
        'consumptionCorrectionKg', consumption_delta,
        'releasedDifferenceKg', greatest(new.reserved_kg - new.consumed_kg, 0)
      ),
      event_source, event_key
    )
    on conflict (source, idempotency_key) do nothing;

    return new;
  end if;

  if new.status in ('released', 'cancelled', 'expired')
     and reservation_record.status in ('pending', 'reserved') then
    release_status := case new.status
      when 'expired' then 'expired'
      when 'cancelled' then 'cancelled'
      else 'released'
    end;

    update public.station_inventory_reservations
    set status = release_status,
        released_at = timezone('utc', now()),
        release_reason = coalesce(new.metadata ->> 'release_reason', 'legacy_' || new.status),
        version = version + 1,
        metadata = metadata || new.metadata,
        updated_at = timezone('utc', now())
    where id = reservation_record.id
    returning * into reservation_record;

    perform set_config('skima.inventory_runtime', 'true', true);
    result := public.recalculate_lpg_station_inventory(new.station_branch_id, 'reservation_' || release_status);
    perform set_config('skima.inventory_runtime', 'false', true);

    event_key := new.id::text || ':' || release_status;
    insert into public.station_inventory_events (
      station_branch_id, event_type, stock_delta_kg,
      resulting_physical_stock_kg, resulting_allocation_kg,
      resulting_reserved_kg, resulting_dispatchable_kg,
      reason_key, related_entity_type, related_entity_id,
      metadata, source, idempotency_key
    )
    values (
      new.station_branch_id, 'reservation_release', 0,
      nullif(result ->> 'physicalStockKg', '')::numeric,
      (result ->> 'skimaAllocationKg')::numeric,
      (result ->> 'reservedKg')::numeric,
      (result ->> 'dispatchableKg')::numeric,
      'inventory.reservation_' || release_status,
      'inventory.reservation', reservation_record.id,
      jsonb_build_object('lpgOrderId', new.lpg_order_id, 'releaseStatus', release_status),
      event_source, event_key
    )
    on conflict (source, idempotency_key) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_inventory_reservation_after_legacy_change on public.lpg_station_capacity_reservations;
create trigger sync_inventory_reservation_after_legacy_change
after insert or update of station_branch_id, requested_kg, reserved_kg, consumed_kg, status, expires_at
on public.lpg_station_capacity_reservations
for each row execute function public.sync_lpg_inventory_reservation_from_legacy();

create or replace function public.adjust_lpg_station_capacity(
  target_station_branch_id uuid,
  target_adjustment_kg numeric,
  target_reason_key text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.station_capacity'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rollout_status text;
  adjustment_type_key text;
begin
  select state.rollout_status into rollout_status
  from public.station_lpg_inventory_state state
  where state.station_branch_id = target_station_branch_id;

  if rollout_status is null or rollout_status <> 'active' then
    raise exception 'confirm current physical LPG stock before recording a stock movement';
  end if;

  adjustment_type_key := case
    when target_reason_key in ('lpg.capacity.replenishment', 'inventory.supplier_delivery') then 'supplier_delivery'
    when target_adjustment_kg < 0 then 'off_platform_sale'
    else 'correction'
  end;

  return public.adjust_lpg_station_inventory(
    target_station_branch_id,
    target_adjustment_kg,
    adjustment_type_key,
    target_idempotency_key,
    null,
    target_metadata ->> 'note',
    array[]::uuid[],
    target_metadata || jsonb_build_object('legacyReasonKey', target_reason_key),
    target_source
  );
end;
$$;

create or replace function public.read_lpg_station_inventory(
  target_station_branch_id uuid default null,
  target_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  station_record public.lpg_station_branches%rowtype;
  config_record public.station_inventory_configurations%rowtype;
  state_record public.station_lpg_inventory_state%rowtype;
  capacity_record public.station_inventory_operational_capacity%rowtype;
  runtime_policy jsonb;
  resolved_limit integer;
  installed_rated_kg numeric;
  installed_usable_kg numeric;
  active_jobs integer;
  can_confirm boolean;
  can_update boolean;
  can_adjust boolean;
  can_allocate boolean;
  can_manage_sources boolean;
  can_manage_providers boolean;
  can_reconcile boolean;
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  resolved_limit := least(greatest(coalesce(target_limit, 50), 1), 200);
  select station.* into station_record
  from public.lpg_station_branches station
  where (target_station_branch_id is null or station.id = target_station_branch_id)
    and public.can_read_lpg_station_inventory(station.id)
  order by station.created_at asc
  limit 1;
  if not found then raise exception 'branch-scoped inventory access is required'; end if;

  select * into config_record
  from public.station_inventory_configurations
  where station_branch_id = station_record.id;
  select * into state_record
  from public.station_lpg_inventory_state
  where station_branch_id = station_record.id;
  select * into capacity_record
  from public.station_inventory_operational_capacity
  where station_branch_id = station_record.id;
  runtime_policy := public.inventory_runtime_policy();

  select coalesce(sum(tank.rated_capacity_kg), station_record.refill_capacity_kg, 0),
         coalesce(sum(tank.usable_capacity_kg), station_record.refill_capacity_kg, 0)
  into installed_rated_kg, installed_usable_kg
  from public.station_lpg_tanks tank
  where tank.station_branch_id = station_record.id
    and tank.status in ('active', 'maintenance', 'inspection_required');

  select count(*)::integer into active_jobs
  from public.lpg_refill_orders target_order
  where target_order.station_branch_id = station_record.id
    and target_order.status not in ('completed', 'cancelled', 'refunded', 'failed');

  can_confirm := public.can_manage_lpg_station_inventory(station_record.id, 'station.inventory.confirm');
  can_update := public.can_manage_lpg_station_inventory(station_record.id, 'station.inventory.update');
  can_adjust := public.can_manage_lpg_station_inventory(station_record.id, 'station.inventory.adjust');
  can_allocate := public.can_manage_lpg_station_inventory(station_record.id, 'station.inventory.allocations.manage');
  can_manage_sources := public.can_manage_lpg_station_inventory(station_record.id, 'station.inventory.sources.manage');
  can_manage_providers := public.can_manage_lpg_station_inventory(station_record.id, 'station.inventory.providers.manage');
  can_reconcile := public.can_manage_lpg_station_inventory(station_record.id, 'station.inventory.reconciliation.manage');

  return jsonb_build_object(
    'station', jsonb_build_object(
      'stationBranchId', station_record.id,
      'displayName', station_record.display_name,
      'installedCapacityKg', installed_rated_kg,
      'installedUsableCapacityKg', installed_usable_kg,
      'availabilityStatus', station_record.availability_status
    ),
    'configuration', jsonb_build_object(
      'trackingMode', config_record.tracking_mode,
      'primarySource', config_record.primary_source_key,
      'secondarySource', config_record.secondary_source_key,
      'fallbackSource', config_record.fallback_source_key,
      'allocationMode', config_record.allocation_mode,
      'allocationValue', config_record.allocation_value,
      'safetyReserveMode', config_record.safety_reserve_mode,
      'safetyReserveValue', config_record.safety_reserve_value,
      'manualFallbackUntil', config_record.manual_fallback_until,
      'status', config_record.status,
      'version', config_record.version
    ),
    'inventory', jsonb_build_object(
      'physicalStockKg', state_record.physical_stock_kg,
      'reportedStockKg', state_record.reported_stock_kg,
      'observedStockKg', state_record.observed_stock_kg,
      'calculatedStockKg', state_record.calculated_stock_kg,
      'safetyReserveKg', state_record.safe_stock_kg,
      'skimaAllocationKg', state_record.skima_allocation_kg,
      'reservedKg', state_record.reserved_kg,
      'dispatchableKg', state_record.dispatchable_kg,
      'inventoryStatus', state_record.inventory_status,
      'activeSource', state_record.active_source_key,
      'sourceConfidence', state_record.source_confidence,
      'freshnessStatus', state_record.freshness_status,
      'sourceHealth', state_record.source_health,
      'reconciliationStatus', state_record.reconciliation_status,
      'reliabilityScore', state_record.reliability_score,
      'rolloutStatus', state_record.rollout_status,
      'dispatchEligible', coalesce((state_record.metadata ->> 'dispatchEligible')::boolean, false),
      'lastSourceUpdateAt', state_record.last_source_update_at,
      'lastVerifiedAt', state_record.last_verified_at,
      'confirmationDueAt', case when state_record.last_verified_at is null then null else
        state_record.last_verified_at + make_interval(mins => nullif(runtime_policy ->> 'manualConfirmationIntervalMinutes', '')::integer) end,
      'staleAt', case when state_record.last_source_update_at is null then null else
        state_record.last_source_update_at + make_interval(mins => nullif(runtime_policy ->> 'manualStaleIntervalMinutes', '')::integer) end,
      'version', state_record.version
    ),
    'operationalCapacity', jsonb_build_object(
      'fillingPoints', capacity_record.filling_points,
      'maximumConcurrentJobs', capacity_record.maximum_concurrent_jobs,
      'activeJobs', active_jobs,
      'estimatedProcessingMinutes', capacity_record.estimated_processing_minutes,
      'congestionStatus', capacity_record.congestion_status,
      'pausedUntil', capacity_record.paused_until
    ),
    'actions', jsonb_build_object(
      'canConfirm', can_confirm,
      'canUpdate', can_update,
      'canAdjust', can_adjust,
      'canManageAllocation', can_allocate,
      'canManageSources', can_manage_sources,
      'canManageProviders', can_manage_providers,
      'canResolveReconciliation', can_reconcile
    ),
    'sourceTypes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', source_type.key,
        'name', source_type.display_name,
        'description', source_type.description,
        'supportsProvider', source_type.supports_provider
      ) order by coalesce((source_type.metadata ->> 'sortOrder')::integer, 100), source_type.display_name)
      from public.inventory_source_types source_type
      where source_type.status = 'active'
    ), '[]'::jsonb),
    'measurementMethods', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', method.key,
        'name', method.display_name,
        'description', method.description,
        'requiresEvidence', method.requires_evidence
      ) order by method.sort_order, method.display_name)
      from public.inventory_measurement_methods method
      where method.status = 'active'
    ), '[]'::jsonb),
    'adjustmentTypes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', adjustment.key,
        'name', adjustment.display_name,
        'direction', adjustment.direction,
        'description', adjustment.description,
        'evidenceRecommended', adjustment.evidence_recommended
      ) order by adjustment.sort_order, adjustment.display_name)
      from public.inventory_adjustment_types adjustment
      where adjustment.status = 'active'
    ), '[]'::jsonb),
    'providers', public.read_inventory_provider_catalog(null),
    'connections', case when can_manage_sources or can_manage_providers then coalesce((
      select jsonb_agg(jsonb_build_object(
        'publicReference', connection.public_reference,
        'providerKey', adapter.key,
        'providerName', adapter.display_name,
        'sourceType', connection.source_type_key,
        'displayName', connection.display_name,
        'connectionMethod', connection.connection_method,
        'status', connection.status,
        'healthStatus', connection.health_status,
        'credentialConfigured', connection.credential_secret_ref is not null,
        'lastSuccessfulSyncAt', connection.last_successful_sync_at,
        'lastFailureAt', connection.last_failure_at
      ) order by connection.created_at)
      from public.station_inventory_provider_connections connection
      join public.provider_adapters adapter on adapter.id = connection.provider_adapter_id
      where connection.station_branch_id = station_record.id
    ), '[]'::jsonb) else '[]'::jsonb end,
    'tanks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tankId', tank.id,
        'publicReference', tank.public_reference,
        'name', tank.tank_name,
        'code', tank.tank_code,
        'ratedCapacityKg', tank.rated_capacity_kg,
        'usableCapacityKg', tank.usable_capacity_kg,
        'minimumSafeStockKg', tank.minimum_safe_stock_kg,
        'maximumSafeFillPercentage', tank.maximum_safe_fill_percentage,
        'status', tank.status,
        'inspectionStatus', tank.inspection_status,
        'telemetryCapable', tank.telemetry_capable,
        'physicalStockKg', tank_state.physical_stock_kg,
        'sourceConfidence', tank_state.source_confidence,
        'freshnessStatus', tank_state.freshness_status,
        'lastSourceUpdateAt', tank_state.last_source_update_at
      ) order by tank.tank_name)
      from public.station_lpg_tanks tank
      left join public.station_lpg_tank_inventory_state tank_state on tank_state.tank_id = tank.id
      where tank.station_branch_id = station_record.id
        and tank.status <> 'decommissioned'
    ), '[]'::jsonb),
    'reservations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'publicReference', reservation.public_reference,
        'orderReference', target_order.public_reference,
        'requestedKg', reservation.requested_kg,
        'reservedKg', reservation.reserved_kg,
        'consumedKg', reservation.consumed_kg,
        'status', reservation.status,
        'expiresAt', reservation.expires_at,
        'createdAt', reservation.created_at
      ) order by reservation.created_at desc)
      from (
        select * from public.station_inventory_reservations reservation
        where reservation.station_branch_id = station_record.id
        order by reservation.created_at desc limit resolved_limit
      ) reservation
      join public.lpg_refill_orders target_order on target_order.id = reservation.lpg_order_id
    ), '[]'::jsonb),
    'history', case when public.can_read_lpg_station_inventory_history(station_record.id) then coalesce((
      select jsonb_agg(jsonb_build_object(
        'publicReference', event.public_reference,
        'eventType', event.event_type,
        'stockDeltaKg', event.stock_delta_kg,
        'physicalStockKg', event.resulting_physical_stock_kg,
        'skimaAllocationKg', event.resulting_allocation_kg,
        'reservedKg', event.resulting_reserved_kg,
        'dispatchableKg', event.resulting_dispatchable_kg,
        'reason', event.reason_key,
        'note', event.note,
        'occurredAt', event.occurred_at
      ) order by event.occurred_at desc)
      from (
        select * from public.station_inventory_events event
        where event.station_branch_id = station_record.id
        order by event.occurred_at desc limit resolved_limit
      ) event
    ), '[]'::jsonb) else '[]'::jsonb end,
    'reconciliationCases', case when public.can_read_lpg_inventory_reconciliation(station_record.id) then coalesce((
      select jsonb_agg(jsonb_build_object(
        'publicReference', reconciliation.public_reference,
        'caseType', reconciliation.case_type,
        'status', reconciliation.status,
        'severity', reconciliation.severity,
        'expectedStockKg', reconciliation.expected_stock_kg,
        'observedStockKg', reconciliation.observed_stock_kg,
        'differenceKg', reconciliation.difference_kg,
        'summary', reconciliation.summary,
        'createdAt', reconciliation.created_at
      ) order by reconciliation.created_at desc)
      from (
        select * from public.station_inventory_reconciliation_cases reconciliation
        where reconciliation.station_branch_id = station_record.id
          and reconciliation.status not in ('resolved', 'dismissed')
        order by reconciliation.created_at desc limit resolved_limit
      ) reconciliation
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

create or replace function public.read_lpg_admin_inventory_operations(
  target_station_branch_id uuid default null,
  target_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  resolved_limit integer;
begin
  if auth.role() <> 'service_role'
     and not public.can_manage_lpg_operations()
     and not public.has_permission('platform.inventory.manage', null) then
    raise exception 'platform inventory operations permission is required';
  end if;
  resolved_limit := least(greatest(coalesce(target_limit, 100), 1), 250);

  return jsonb_build_object(
    'stations', coalesce((
      select jsonb_agg(station_payload order by station_payload ->> 'stationName')
      from (
        select jsonb_build_object(
          'stationBranchId', station.id,
          'stationName', station.display_name,
          'installedCapacityKg', coalesce(tank_totals.rated_capacity_kg, station.refill_capacity_kg),
          'installedUsableCapacityKg', coalesce(tank_totals.usable_capacity_kg, station.refill_capacity_kg),
          'physicalStockKg', state.physical_stock_kg,
          'skimaAllocationKg', state.skima_allocation_kg,
          'reservedKg', state.reserved_kg,
          'dispatchableKg', state.dispatchable_kg,
          'primarySource', config.primary_source_key,
          'secondarySource', config.secondary_source_key,
          'fallbackSource', config.fallback_source_key,
          'activeSource', state.active_source_key,
          'freshness', state.freshness_status,
          'confidence', state.source_confidence,
          'providerHealth', state.source_health,
          'lastUpdateAt', state.last_source_update_at,
          'lowStockState', state.inventory_status,
          'reconciliationState', state.reconciliation_status,
          'inventoryReliability', state.reliability_score,
          'rolloutStatus', state.rollout_status,
          'dispatchEligible', coalesce((state.metadata ->> 'dispatchEligible')::boolean, false),
          'activeJobs', coalesce(job_totals.active_jobs, 0),
          'maximumConcurrentJobs', capacity.maximum_concurrent_jobs,
          'openReconciliationCases', coalesce(reconciliation_totals.open_cases, 0)
        ) as station_payload
        from public.lpg_station_branches station
        join public.station_inventory_configurations config on config.station_branch_id = station.id
        join public.station_lpg_inventory_state state on state.station_branch_id = station.id
        join public.station_inventory_operational_capacity capacity on capacity.station_branch_id = station.id
        left join lateral (
          select sum(tank.rated_capacity_kg) as rated_capacity_kg,
                 sum(tank.usable_capacity_kg) as usable_capacity_kg
          from public.station_lpg_tanks tank
          where tank.station_branch_id = station.id and tank.status <> 'decommissioned'
        ) tank_totals on true
        left join lateral (
          select count(*)::integer as active_jobs
          from public.lpg_refill_orders target_order
          where target_order.station_branch_id = station.id
            and target_order.status not in ('completed', 'cancelled', 'refunded', 'failed')
        ) job_totals on true
        left join lateral (
          select count(*)::integer as open_cases
          from public.station_inventory_reconciliation_cases reconciliation
          where reconciliation.station_branch_id = station.id
            and reconciliation.status not in ('resolved', 'dismissed')
        ) reconciliation_totals on true
        where target_station_branch_id is null or station.id = target_station_branch_id
        order by station.display_name
        limit resolved_limit
      ) inventory_station
    ), '[]'::jsonb),
    'policy', jsonb_build_object(
      'manualConfirmationIntervalMinutes', (public.inventory_runtime_policy() ->> 'manualConfirmationIntervalMinutes')::integer,
      'manualWarningIntervalMinutes', (public.inventory_runtime_policy() ->> 'manualWarningIntervalMinutes')::integer,
      'manualStaleIntervalMinutes', (public.inventory_runtime_policy() ->> 'manualStaleIntervalMinutes')::integer,
      'dispatchBlockingIntervalMinutes', (public.inventory_runtime_policy() ->> 'dispatchBlockingIntervalMinutes')::integer,
      'safetyReserveMode', public.inventory_runtime_policy() ->> 'platformSafetyReserveMode',
      'safetyReserveValue', (public.inventory_runtime_policy() ->> 'platformSafetyReserveValue')::numeric,
      'lowStockPercentage', (public.inventory_runtime_policy() ->> 'lowStockPercentage')::numeric,
      'criticalStockPercentage', (public.inventory_runtime_policy() ->> 'criticalStockPercentage')::numeric,
      'reservationExpiryMinutes', (public.inventory_runtime_policy() ->> 'reservationExpiryMinutes')::integer,
      'discrepancyToleranceKg', (public.inventory_runtime_policy() ->> 'discrepancyToleranceKg')::numeric,
      'manualFallbackMaximumHours', (public.inventory_runtime_policy() ->> 'manualFallbackMaximumHours')::numeric,
      'minimumDispatchConfidence', public.inventory_runtime_policy() ->> 'minimumDispatchConfidence'
    )
  );
end;
$$;

create or replace function public.configure_inventory_runtime_policy(
  target_manual_confirmation_interval_minutes integer,
  target_manual_warning_interval_minutes integer,
  target_manual_stale_interval_minutes integer,
  target_dispatch_blocking_interval_minutes integer,
  target_safety_reserve_mode text,
  target_safety_reserve_value numeric,
  target_low_stock_percentage numeric,
  target_critical_stock_percentage numeric,
  target_reservation_expiry_minutes integer,
  target_discrepancy_tolerance_kg numeric,
  target_manual_fallback_maximum_hours numeric,
  target_minimum_dispatch_confidence text,
  target_change_reason text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_entry public.configuration_entries%rowtype;
  existing_entry_id uuid;
  new_entry_id uuid;
  next_version integer;
  new_value jsonb;
begin
  if auth.role() <> 'service_role'
     and not public.is_platform_super_admin()
     and not public.has_permission('platform.inventory.manage', null) then
    raise exception 'platform inventory policy permission is required';
  end if;
  if target_manual_confirmation_interval_minutes <= 0
     or target_manual_warning_interval_minutes <= 0
     or target_manual_warning_interval_minutes > target_manual_confirmation_interval_minutes
     or target_manual_stale_interval_minutes < target_manual_confirmation_interval_minutes
     or target_dispatch_blocking_interval_minutes < target_manual_stale_interval_minutes then
    raise exception 'inventory confirmation and freshness intervals are invalid';
  end if;
  if target_safety_reserve_mode not in ('fixed_kg', 'percentage')
     or target_safety_reserve_value < 0
     or (target_safety_reserve_mode = 'percentage' and target_safety_reserve_value > 100) then
    raise exception 'platform safety reserve policy is invalid';
  end if;
  if target_critical_stock_percentage < 0
     or target_low_stock_percentage <= target_critical_stock_percentage
     or target_low_stock_percentage > 100 then
    raise exception 'low and critical stock thresholds are invalid';
  end if;
  if target_reservation_expiry_minutes <= 0
     or target_discrepancy_tolerance_kg < 0
     or target_manual_fallback_maximum_hours <= 0 then
    raise exception 'inventory runtime limits must be positive';
  end if;
  if upper(target_minimum_dispatch_confidence) not in ('HIGH', 'MEDIUM', 'LOW') then
    raise exception 'minimum dispatch confidence is invalid';
  end if;
  if target_change_reason is null or char_length(btrim(target_change_reason)) < 5 then
    raise exception 'explain why the inventory policy is changing';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select entry.id into existing_entry_id
  from public.configuration_entries entry
  where entry.namespace = 'module.inventory'
    and entry.key = 'lpg.runtime-policy'
    and entry.value ->> 'changeIdempotencyKey' = target_idempotency_key
  order by entry.version desc
  limit 1;
  if found then return existing_entry_id; end if;

  select * into current_entry
  from public.configuration_entries entry
  where entry.namespace = 'module.inventory'
    and entry.key = 'lpg.runtime-policy'
    and entry.scope_type = 'global'
    and entry.scope_id is null
    and entry.status = 'active'
  order by entry.version desc
  limit 1
  for update;
  if not found then raise exception 'active inventory runtime policy is required'; end if;

  next_version := current_entry.version + 1;
  new_value := current_entry.value || jsonb_build_object(
    'manualConfirmationIntervalMinutes', target_manual_confirmation_interval_minutes,
    'manualWarningIntervalMinutes', target_manual_warning_interval_minutes,
    'manualStaleIntervalMinutes', target_manual_stale_interval_minutes,
    'dispatchBlockingIntervalMinutes', target_dispatch_blocking_interval_minutes,
    'platformSafetyReserveMode', target_safety_reserve_mode,
    'platformSafetyReserveValue', target_safety_reserve_value,
    'lowStockPercentage', target_low_stock_percentage,
    'criticalStockPercentage', target_critical_stock_percentage,
    'reservationExpiryMinutes', target_reservation_expiry_minutes,
    'discrepancyToleranceKg', target_discrepancy_tolerance_kg,
    'manualFallbackMaximumHours', target_manual_fallback_maximum_hours,
    'minimumDispatchConfidence', upper(target_minimum_dispatch_confidence),
    'changeReason', btrim(target_change_reason),
    'changeIdempotencyKey', target_idempotency_key,
    'changedBy', auth.uid(),
    'changedAt', timezone('utc', now())
  );

  update public.configuration_entries
  set status = 'retired',
      effective_until = timezone('utc', now()),
      updated_by = auth.uid(),
      updated_at = timezone('utc', now())
  where id = current_entry.id;

  insert into public.configuration_entries (
    namespace, key, scope_type, scope_id, value, is_secret, status,
    version, effective_from, created_by, updated_by
  )
  values (
    'module.inventory', 'lpg.runtime-policy', 'global', null, new_value,
    false, 'active', next_version, timezone('utc', now()), auth.uid(), auth.uid()
  )
  returning id into new_entry_id;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id,
    before_state, after_state, metadata
  )
  values (
    auth.uid(), 'inventory.runtime_policy.activated', 'configuration_entry', new_entry_id,
    to_jsonb(current_entry),
    (select to_jsonb(entry) from public.configuration_entries entry where entry.id = new_entry_id),
    jsonb_build_object('reason', btrim(target_change_reason), 'previousVersionId', current_entry.id)
  );

  return new_entry_id;
end;
$$;

create or replace function public.resolve_lpg_inventory_reconciliation_case(
  target_reconciliation_public_reference text,
  target_resolution text,
  target_status text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.inventory.reconciliation'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  case_record public.station_inventory_reconciliation_cases%rowtype;
  inventory_event_id uuid;
begin
  select * into case_record
  from public.station_inventory_reconciliation_cases reconciliation
  where reconciliation.public_reference = target_reconciliation_public_reference
  for update;
  if not found then raise exception 'inventory reconciliation case was not found'; end if;
  if not public.can_manage_lpg_station_inventory(case_record.station_branch_id, 'station.inventory.reconciliation.manage') then
    raise exception 'inventory reconciliation management permission is required';
  end if;
  if target_status not in ('resolved', 'dismissed', 'escalated', 'investigating', 'awaiting_station', 'awaiting_provider') then
    raise exception 'select a supported reconciliation status';
  end if;
  if target_resolution is null or char_length(btrim(target_resolution)) < 5 then
    raise exception 'explain the reconciliation decision';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select event.id into inventory_event_id
  from public.station_inventory_events event
  where event.source = target_source and event.idempotency_key = target_idempotency_key;
  if found then return inventory_event_id; end if;

  update public.station_inventory_reconciliation_cases
  set status = target_status,
      resolution = btrim(target_resolution),
      resolved_by = case when target_status in ('resolved', 'dismissed') then auth.uid() else resolved_by end,
      resolved_at = case when target_status in ('resolved', 'dismissed') then timezone('utc', now()) else null end,
      metadata = metadata || target_metadata,
      updated_at = timezone('utc', now())
  where id = case_record.id;

  update public.station_lpg_inventory_state
  set reconciliation_status = case
        when target_status in ('resolved', 'dismissed') and not exists (
          select 1 from public.station_inventory_reconciliation_cases other_case
          where other_case.station_branch_id = case_record.station_branch_id
            and other_case.id <> case_record.id
            and other_case.status not in ('resolved', 'dismissed')
        ) then 'current'
        when target_status = 'escalated' then 'blocked'
        else 'open'
      end,
      version = version + 1,
      updated_at = timezone('utc', now())
  where station_branch_id = case_record.station_branch_id;

  perform set_config('skima.inventory_runtime', 'true', true);
  perform public.recalculate_lpg_station_inventory(case_record.station_branch_id, 'reconciliation_' || target_status);
  perform set_config('skima.inventory_runtime', 'false', true);

  insert into public.station_inventory_events (
    station_branch_id, event_type, stock_delta_kg, reason_key, note,
    related_entity_type, related_entity_id, metadata, source, idempotency_key
  )
  values (
    case_record.station_branch_id, 'reconciliation_' || target_status, 0,
    'inventory.reconciliation_' || target_status, btrim(target_resolution),
    'inventory.reconciliation', case_record.id, target_metadata,
    target_source, target_idempotency_key
  )
  returning id into inventory_event_id;

  return inventory_event_id;
end;
$$;

create or replace function public.prevent_station_inventory_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and coalesce(current_setting('skima.reference_assignment', true), '') = 'true' then
    return new;
  end if;
  raise exception 'station inventory events are append-only';
end;
$$;

drop trigger if exists prevent_station_inventory_event_update on public.station_inventory_events;
create trigger prevent_station_inventory_event_update
before update on public.station_inventory_events
for each row execute function public.prevent_station_inventory_event_mutation();

drop trigger if exists prevent_station_inventory_event_delete on public.station_inventory_events;
create trigger prevent_station_inventory_event_delete
before delete on public.station_inventory_events
for each row execute function public.prevent_station_inventory_event_mutation();

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'inventory_source_types',
    'inventory_measurement_methods',
    'inventory_adjustment_types',
    'station_lpg_tanks',
    'station_inventory_configurations',
    'station_inventory_provider_connections',
    'station_inventory_telemetry_devices',
    'station_lpg_inventory_state',
    'station_lpg_tank_inventory_state',
    'station_inventory_reservations',
    'station_inventory_reconciliation_cases',
    'station_inventory_operational_capacity'
  ] loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I', target_table, target_table);
    execute format(
      'create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      target_table,
      target_table
    );
  end loop;
end $$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'station_lpg_tanks',
    'station_inventory_configurations',
    'station_inventory_provider_connections',
    'station_inventory_telemetry_devices',
    'station_inventory_reconciliation_cases',
    'station_inventory_operational_capacity'
  ] loop
    execute format('drop trigger if exists audit_%I_mutations on public.%I', target_table, target_table);
    execute format(
      'create trigger audit_%I_mutations after insert or update or delete on public.%I for each row execute function public.record_table_audit()',
      target_table,
      target_table
    );
  end loop;
end $$;

-- Keep role presets capability-driven, then extend already-provisioned branch roles.
update public.lpg_station_role_presets preset
set permission_keys = case preset.key
      when 'lpg.station.owner' then preset.permission_keys || array[
        'station.inventory.read','station.inventory.confirm','station.inventory.update',
        'station.inventory.adjust','station.inventory.history.read',
        'station.inventory.allocations.manage','station.inventory.sources.read',
        'station.inventory.sources.manage','station.inventory.providers.manage',
        'station.inventory.telemetry.read','station.inventory.reconciliation.read',
        'station.inventory.reconciliation.manage'
      ]::text[]
      when 'lpg.station.admin' then preset.permission_keys || array[
        'station.inventory.read','station.inventory.confirm','station.inventory.update',
        'station.inventory.adjust','station.inventory.history.read',
        'station.inventory.allocations.manage','station.inventory.sources.read',
        'station.inventory.sources.manage','station.inventory.providers.manage',
        'station.inventory.telemetry.read','station.inventory.reconciliation.read',
        'station.inventory.reconciliation.manage'
      ]::text[]
      when 'lpg.station.operations' then preset.permission_keys || array[
        'station.inventory.read','station.inventory.confirm','station.inventory.update',
        'station.inventory.adjust','station.inventory.history.read',
        'station.inventory.allocations.manage','station.inventory.sources.read',
        'station.inventory.telemetry.read','station.inventory.reconciliation.read'
      ]::text[]
      when 'lpg.station.finance' then preset.permission_keys || array[
        'station.inventory.read','station.inventory.history.read'
      ]::text[]
      when 'lpg.station.pump' then preset.permission_keys || array[
        'station.inventory.read','station.inventory.confirm'
      ]::text[]
      when 'lpg.station.scanner' then preset.permission_keys || array['station.inventory.read']::text[]
      when 'lpg.station.viewer' then preset.permission_keys || array['station.inventory.read']::text[]
      else preset.permission_keys
    end,
    updated_at = timezone('utc', now())
where preset.key in (
  'lpg.station.owner','lpg.station.admin','lpg.station.operations',
  'lpg.station.finance','lpg.station.pump','lpg.station.scanner','lpg.station.viewer'
);

update public.lpg_station_role_presets preset
set permission_keys = array(
  select distinct permission_key
  from unnest(preset.permission_keys) permission_key
  order by permission_key
),
updated_at = timezone('utc', now())
where preset.key like 'lpg.station.%';

with role_inventory_permissions(role_key, permission_keys) as (
  values
    ('lpg.station.owner', array[
      'station.inventory.read','station.inventory.confirm','station.inventory.update',
      'station.inventory.adjust','station.inventory.history.read',
      'station.inventory.allocations.manage','station.inventory.sources.read',
      'station.inventory.sources.manage','station.inventory.providers.manage',
      'station.inventory.telemetry.read','station.inventory.reconciliation.read',
      'station.inventory.reconciliation.manage'
    ]::text[]),
    ('lpg.station.admin', array[
      'station.inventory.read','station.inventory.confirm','station.inventory.update',
      'station.inventory.adjust','station.inventory.history.read',
      'station.inventory.allocations.manage','station.inventory.sources.read',
      'station.inventory.sources.manage','station.inventory.providers.manage',
      'station.inventory.telemetry.read','station.inventory.reconciliation.read',
      'station.inventory.reconciliation.manage'
    ]::text[]),
    ('lpg.station.operations', array[
      'station.inventory.read','station.inventory.confirm','station.inventory.update',
      'station.inventory.adjust','station.inventory.history.read',
      'station.inventory.allocations.manage','station.inventory.sources.read',
      'station.inventory.telemetry.read','station.inventory.reconciliation.read'
    ]::text[]),
    ('lpg.station.finance', array['station.inventory.read','station.inventory.history.read']::text[]),
    ('lpg.station.pump', array['station.inventory.read','station.inventory.confirm']::text[]),
    ('lpg.station.scanner', array['station.inventory.read']::text[]),
    ('lpg.station.viewer', array['station.inventory.read']::text[])
)
insert into public.role_permissions (role_id, permission_id, conditions)
select
  role_record.id,
  permission_record.id,
  case
    when coalesce(role_record.metadata ->> 'branch_id', '') ~ '^[0-9a-fA-F-]{36}$'
      then jsonb_build_object('branch_id', (role_record.metadata ->> 'branch_id')::uuid)
    else '{}'::jsonb
  end
from public.roles role_record
join role_inventory_permissions mapping on mapping.role_key = role_record.key
join public.permissions permission_record on permission_record.key = any(mapping.permission_keys)
where role_record.organization_id is not null
on conflict (role_id, permission_id) do nothing;

alter table public.inventory_source_types enable row level security;
alter table public.inventory_measurement_methods enable row level security;
alter table public.inventory_adjustment_types enable row level security;
alter table public.station_lpg_tanks enable row level security;
alter table public.station_inventory_configurations enable row level security;
alter table public.station_inventory_provider_connections enable row level security;
alter table public.station_inventory_telemetry_devices enable row level security;
alter table public.station_lpg_inventory_state enable row level security;
alter table public.station_lpg_tank_inventory_state enable row level security;
alter table public.station_inventory_observations enable row level security;
alter table public.station_inventory_events enable row level security;
alter table public.station_inventory_reservations enable row level security;
alter table public.station_inventory_reconciliation_cases enable row level security;
alter table public.station_inventory_operational_capacity enable row level security;

create policy inventory_source_types_read_active on public.inventory_source_types
for select to authenticated using (status = 'active' or public.has_permission('platform.inventory.manage', null));
create policy inventory_measurement_methods_read_active on public.inventory_measurement_methods
for select to authenticated using (status = 'active' or public.has_permission('platform.inventory.manage', null));
create policy inventory_adjustment_types_read_active on public.inventory_adjustment_types
for select to authenticated using (status = 'active' or public.has_permission('platform.inventory.manage', null));

create policy station_lpg_tanks_read_scoped on public.station_lpg_tanks
for select to authenticated using (public.can_read_lpg_station_inventory(station_branch_id));
create policy station_inventory_config_read_scoped on public.station_inventory_configurations
for select to authenticated using (public.can_read_lpg_station_inventory(station_branch_id));
create policy station_inventory_connections_read_managers on public.station_inventory_provider_connections
for select to authenticated using (
  public.can_manage_lpg_station_inventory(station_branch_id, 'station.inventory.providers.manage')
  or public.has_permission('platform.inventory.manage', null)
);
create policy station_inventory_devices_read_scoped on public.station_inventory_telemetry_devices
for select to authenticated using (
  public.can_operate_lpg_station_branch(station_branch_id, 'station.inventory.telemetry.read')
  or public.has_permission('platform.inventory.manage', null)
  or public.can_manage_lpg_operations()
);
create policy station_inventory_state_read_scoped on public.station_lpg_inventory_state
for select to authenticated using (public.can_read_lpg_station_inventory(station_branch_id));
create policy station_tank_inventory_state_read_scoped on public.station_lpg_tank_inventory_state
for select to authenticated using (public.can_read_lpg_station_inventory(station_branch_id));
create policy station_inventory_observations_read_scoped on public.station_inventory_observations
for select to authenticated using (
  public.can_read_lpg_station_inventory_history(station_branch_id)
  or public.can_operate_lpg_station_branch(station_branch_id, 'station.inventory.telemetry.read')
);
create policy station_inventory_events_read_scoped on public.station_inventory_events
for select to authenticated using (public.can_read_lpg_station_inventory_history(station_branch_id));
create policy station_inventory_reservations_read_scoped on public.station_inventory_reservations
for select to authenticated using (public.can_read_lpg_station_inventory(station_branch_id));
create policy station_inventory_reconciliation_read_scoped on public.station_inventory_reconciliation_cases
for select to authenticated using (public.can_read_lpg_inventory_reconciliation(station_branch_id));
create policy station_inventory_operational_capacity_read_scoped on public.station_inventory_operational_capacity
for select to authenticated using (public.can_read_lpg_station_inventory(station_branch_id));

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'inventory_source_types',
    'inventory_measurement_methods',
    'inventory_adjustment_types',
    'station_lpg_tanks',
    'station_inventory_configurations',
    'station_inventory_provider_connections',
    'station_inventory_telemetry_devices',
    'station_lpg_inventory_state',
    'station_lpg_tank_inventory_state',
    'station_inventory_observations',
    'station_inventory_events',
    'station_inventory_reservations',
    'station_inventory_reconciliation_cases',
    'station_inventory_operational_capacity'
  ] loop
    execute format('create policy inventory_no_direct_insert on public.%I for insert to authenticated with check (false)', target_table);
    execute format('create policy inventory_no_direct_update on public.%I for update to authenticated using (false) with check (false)', target_table);
    execute format('create policy inventory_no_direct_delete on public.%I for delete to authenticated using (false)', target_table);
  end loop;
end $$;

revoke all on table public.inventory_source_types from public, anon, authenticated;
revoke all on table public.inventory_measurement_methods from public, anon, authenticated;
revoke all on table public.inventory_adjustment_types from public, anon, authenticated;
revoke all on table public.station_lpg_tanks from public, anon, authenticated;
revoke all on table public.station_inventory_configurations from public, anon, authenticated;
revoke all on table public.station_inventory_provider_connections from public, anon, authenticated;
revoke all on table public.station_inventory_telemetry_devices from public, anon, authenticated;
revoke all on table public.station_lpg_inventory_state from public, anon, authenticated;
revoke all on table public.station_lpg_tank_inventory_state from public, anon, authenticated;
revoke all on table public.station_inventory_observations from public, anon, authenticated;
revoke all on table public.station_inventory_events from public, anon, authenticated;
revoke all on table public.station_inventory_reservations from public, anon, authenticated;
revoke all on table public.station_inventory_reconciliation_cases from public, anon, authenticated;
revoke all on table public.station_inventory_operational_capacity from public, anon, authenticated;

grant select on table public.inventory_source_types to authenticated;
grant select on table public.inventory_measurement_methods to authenticated;
grant select on table public.inventory_adjustment_types to authenticated;
grant select on table public.station_lpg_tanks to authenticated;
grant select on table public.station_inventory_configurations to authenticated;
grant select on table public.station_inventory_provider_connections to authenticated;
grant select on table public.station_inventory_telemetry_devices to authenticated;
grant select on table public.station_lpg_inventory_state to authenticated;
grant select on table public.station_lpg_tank_inventory_state to authenticated;
grant select on table public.station_inventory_observations to authenticated;
grant select on table public.station_inventory_events to authenticated;
grant select on table public.station_inventory_reservations to authenticated;
grant select on table public.station_inventory_reconciliation_cases to authenticated;
grant select on table public.station_inventory_operational_capacity to authenticated;

grant all on table public.inventory_source_types to service_role;
grant all on table public.inventory_measurement_methods to service_role;
grant all on table public.inventory_adjustment_types to service_role;
grant all on table public.station_lpg_tanks to service_role;
grant all on table public.station_inventory_configurations to service_role;
grant all on table public.station_inventory_provider_connections to service_role;
grant all on table public.station_inventory_telemetry_devices to service_role;
grant all on table public.station_lpg_inventory_state to service_role;
grant all on table public.station_lpg_tank_inventory_state to service_role;
grant all on table public.station_inventory_observations to service_role;
grant all on table public.station_inventory_events to service_role;
grant all on table public.station_inventory_reservations to service_role;
grant all on table public.station_inventory_reconciliation_cases to service_role;
grant all on table public.station_inventory_operational_capacity to service_role;

revoke all on function public.inventory_runtime_policy() from public, anon, authenticated;
revoke all on function public.can_read_lpg_station_inventory(uuid) from public, anon;
revoke all on function public.can_manage_lpg_station_inventory(uuid, text) from public, anon;
revoke all on function public.can_read_lpg_station_inventory_history(uuid) from public, anon;
revoke all on function public.can_read_lpg_inventory_reconciliation(uuid) from public, anon;
revoke all on function public.recalculate_lpg_station_inventory(uuid, text) from public, anon, authenticated;
revoke all on function public.initialize_lpg_station_inventory_runtime() from public, anon, authenticated;
revoke all on function public.guard_lpg_inventory_compatibility_projection() from public, anon, authenticated;
revoke all on function public.prevent_station_inventory_event_mutation() from public, anon, authenticated;
revoke all on function public.sync_lpg_inventory_reservation_from_legacy() from public, anon, authenticated;
revoke all on function public.bind_lpg_inventory_provider_secret(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.ingest_lpg_inventory_provider_observation(uuid, numeric, timestamptz, text, text, bigint, uuid, uuid, numeric, text, jsonb, text) from public, anon, authenticated;

revoke all on function public.read_inventory_provider_catalog(text) from public, anon;
revoke all on function public.read_lpg_station_inventory(uuid, integer) from public, anon;
revoke all on function public.read_lpg_admin_inventory_operations(uuid, integer) from public, anon;
revoke all on function public.report_lpg_station_inventory(uuid, numeric, text, text, numeric, uuid, text, uuid[], jsonb, text, bigint) from public, anon;
revoke all on function public.confirm_lpg_station_inventory(uuid, text, text, jsonb, text, bigint) from public, anon;
revoke all on function public.adjust_lpg_station_inventory(uuid, numeric, text, text, uuid, text, uuid[], jsonb, text, bigint) from public, anon;
revoke all on function public.transfer_lpg_station_tank_stock(uuid, uuid, uuid, numeric, text, text, jsonb, text) from public, anon;
revoke all on function public.configure_lpg_station_inventory(uuid, text, text, text, text, text, text, numeric, text, numeric, jsonb, text, bigint) from public, anon;
revoke all on function public.upsert_lpg_station_tank(uuid, text, text, numeric, numeric, text, uuid, numeric, numeric, text, text, boolean, date, jsonb, text) from public, anon;
revoke all on function public.enable_lpg_station_inventory_manual_fallback(uuid, numeric, text, text, text) from public, anon;
revoke all on function public.configure_lpg_inventory_provider_connection(uuid, text, text, text, jsonb, jsonb, text) from public, anon;
revoke all on function public.configure_inventory_runtime_policy(integer, integer, integer, integer, text, numeric, numeric, numeric, integer, numeric, numeric, text, text, text) from public, anon;
revoke all on function public.resolve_lpg_inventory_reconciliation_case(text, text, text, text, jsonb, text) from public, anon;
revoke all on function public.adjust_lpg_station_capacity(uuid, numeric, text, text, jsonb, text) from public, anon;

grant execute on function public.can_read_lpg_station_inventory(uuid) to authenticated, service_role;
grant execute on function public.can_manage_lpg_station_inventory(uuid, text) to authenticated, service_role;
grant execute on function public.can_read_lpg_station_inventory_history(uuid) to authenticated, service_role;
grant execute on function public.can_read_lpg_inventory_reconciliation(uuid) to authenticated, service_role;
grant execute on function public.read_inventory_provider_catalog(text) to authenticated, service_role;
grant execute on function public.read_lpg_station_inventory(uuid, integer) to authenticated, service_role;
grant execute on function public.read_lpg_admin_inventory_operations(uuid, integer) to authenticated, service_role;
grant execute on function public.report_lpg_station_inventory(uuid, numeric, text, text, numeric, uuid, text, uuid[], jsonb, text, bigint) to authenticated, service_role;
grant execute on function public.confirm_lpg_station_inventory(uuid, text, text, jsonb, text, bigint) to authenticated, service_role;
grant execute on function public.adjust_lpg_station_inventory(uuid, numeric, text, text, uuid, text, uuid[], jsonb, text, bigint) to authenticated, service_role;
grant execute on function public.transfer_lpg_station_tank_stock(uuid, uuid, uuid, numeric, text, text, jsonb, text) to authenticated, service_role;
grant execute on function public.configure_lpg_station_inventory(uuid, text, text, text, text, text, text, numeric, text, numeric, jsonb, text, bigint) to authenticated, service_role;
grant execute on function public.upsert_lpg_station_tank(uuid, text, text, numeric, numeric, text, uuid, numeric, numeric, text, text, boolean, date, jsonb, text) to authenticated, service_role;
grant execute on function public.enable_lpg_station_inventory_manual_fallback(uuid, numeric, text, text, text) to authenticated, service_role;
grant execute on function public.configure_lpg_inventory_provider_connection(uuid, text, text, text, jsonb, jsonb, text) to authenticated, service_role;
grant execute on function public.configure_inventory_runtime_policy(integer, integer, integer, integer, text, numeric, numeric, numeric, integer, numeric, numeric, text, text, text) to authenticated, service_role;
grant execute on function public.resolve_lpg_inventory_reconciliation_case(text, text, text, text, jsonb, text) to authenticated, service_role;
grant execute on function public.adjust_lpg_station_capacity(uuid, numeric, text, text, jsonb, text) to authenticated, service_role;

grant execute on function public.inventory_runtime_policy() to service_role;
grant execute on function public.recalculate_lpg_station_inventory(uuid, text) to service_role;
grant execute on function public.bind_lpg_inventory_provider_secret(uuid, text, text, jsonb) to service_role;
grant execute on function public.ingest_lpg_inventory_provider_observation(uuid, numeric, timestamptz, text, text, bigint, uuid, uuid, numeric, text, jsonb, text) to service_role;

notify pgrst, 'reload schema';

commit;
