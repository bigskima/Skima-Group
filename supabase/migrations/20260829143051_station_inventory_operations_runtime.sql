begin;

-- Operational controls build on the normalized inventory foundation. They do
-- not create a second stock source of truth and never place provider secrets in
-- public tables or API responses.

insert into public.permissions (key, description, risk_level)
values
  ('station.inventory.availability.manage', 'Pause or restore branch inventory dispatch without rewriting stock.', 'high'),
  ('station.inventory.operational_capacity.manage', 'Manage branch refill processing capacity and congestion.', 'high'),
  ('station.inventory.issue.report', 'Report an operational inventory issue without editing stock.', 'standard'),
  ('platform.inventory.override', 'Apply audited exceptional inventory availability controls.', 'critical')
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    updated_at = timezone('utc', now());

alter table public.station_inventory_provider_connections
  add column if not exists last_sync_attempt_at timestamptz,
  add column if not exists next_sync_at timestamptz,
  add column if not exists sync_latency_ms integer check (sync_latency_ms is null or sync_latency_ms >= 0),
  add column if not exists sync_failure_count integer not null default 0 check (sync_failure_count >= 0),
  add column if not exists last_error_code text,
  add column if not exists last_health_check_at timestamptz;

alter table public.station_inventory_telemetry_devices
  add column if not exists battery_percentage numeric(6, 3)
    check (battery_percentage is null or battery_percentage between 0 and 100),
  add column if not exists signal_quality text
    check (signal_quality is null or signal_quality in ('excellent', 'good', 'fair', 'poor', 'unknown')),
  add column if not exists temperature_c numeric(9, 3),
  add column if not exists pressure_kpa numeric(12, 3)
    check (pressure_kpa is null or pressure_kpa >= 0),
  add column if not exists last_health_check_at timestamptz,
  add column if not exists normalization_version integer not null default 1
    check (normalization_version > 0);

alter table public.station_inventory_observations
  add column if not exists normalization_version integer not null default 1
    check (normalization_version > 0);

create table if not exists public.station_inventory_alert_states (
  id uuid primary key default gen_random_uuid(),
  station_branch_id uuid not null references public.lpg_station_branches(id) on delete cascade,
  alert_key text not null check (alert_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  state_fingerprint text not null,
  severity text not null check (severity in ('info', 'warning', 'high', 'critical')),
  first_observed_at timestamptz not null default timezone('utc', now()),
  last_observed_at timestamptz not null default timezone('utc', now()),
  last_notified_at timestamptz,
  notification_count integer not null default 0 check (notification_count >= 0),
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (station_branch_id, alert_key)
);

create table if not exists public.station_inventory_provider_webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  provider_connection_id uuid not null references public.station_inventory_provider_connections(id) on delete cascade,
  provider_event_reference text not null,
  provider_timestamp timestamptz not null,
  signature_digest text not null,
  payload_digest text not null,
  status text not null default 'received'
    check (status in ('received', 'accepted', 'duplicate', 'rejected', 'failed')),
  rejection_code text,
  observation_id uuid references public.station_inventory_observations(id) on delete set null,
  source_ip_hash text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  received_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz,
  unique (provider_connection_id, provider_event_reference)
);

create index if not exists station_inventory_provider_sync_due_idx
on public.station_inventory_provider_connections (status, next_sync_at)
where status in ('active', 'degraded');

create index if not exists station_inventory_device_health_idx
on public.station_inventory_telemetry_devices (status, last_reading_at)
where status in ('active', 'degraded', 'offline');

create index if not exists station_inventory_alert_active_idx
on public.station_inventory_alert_states (severity, last_observed_at desc)
where resolved_at is null;

create index if not exists station_inventory_webhook_received_idx
on public.station_inventory_provider_webhook_receipts (received_at desc);

drop trigger if exists set_station_inventory_alert_states_updated_at
on public.station_inventory_alert_states;
create trigger set_station_inventory_alert_states_updated_at
before update on public.station_inventory_alert_states
for each row execute function public.set_updated_at();

insert into public.job_queues (key, status, concurrency_limit, retry_policy)
values (
  'platform.inventory',
  'active',
  4,
  '{"max_attempts":5,"backoff_seconds":[30,120,300,900,1800]}'::jsonb
)
on conflict (key) do update
set status = excluded.status,
    concurrency_limit = excluded.concurrency_limit,
    retry_policy = excluded.retry_policy,
    updated_at = timezone('utc', now());

insert into public.rate_limit_policies (
  key, scope_type, limit_count, window_seconds, status, metadata
)
values (
  'webhook.inventory-provider.default',
  'ip',
  120,
  60,
  'active',
  '{"surface":"inventory-provider-webhook","configurable":true}'::jsonb
)
on conflict (key) do update
set scope_type = excluded.scope_type,
    limit_count = excluded.limit_count,
    window_seconds = excluded.window_seconds,
    status = excluded.status,
    metadata = public.rate_limit_policies.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

-- Keep existing role presets and already-provisioned station roles aligned.
update public.lpg_station_role_presets preset
set permission_keys = array(
      select distinct permission_key
      from unnest(
        preset.permission_keys || case preset.key
          when 'lpg.station.owner' then array[
            'station.inventory.availability.manage',
            'station.inventory.operational_capacity.manage',
            'station.inventory.issue.report'
          ]::text[]
          when 'lpg.station.admin' then array[
            'station.inventory.availability.manage',
            'station.inventory.operational_capacity.manage',
            'station.inventory.issue.report'
          ]::text[]
          when 'lpg.station.operations' then array[
            'station.inventory.availability.manage',
            'station.inventory.operational_capacity.manage',
            'station.inventory.issue.report'
          ]::text[]
          when 'lpg.station.pump' then array['station.inventory.issue.report']::text[]
          else array[]::text[]
        end
      ) permission_key
      order by permission_key
    ),
    updated_at = timezone('utc', now())
where preset.key in (
  'lpg.station.owner', 'lpg.station.admin', 'lpg.station.operations', 'lpg.station.pump'
);

with configured(role_key, permission_keys) as (
  values
    ('lpg.station.owner', array[
      'station.inventory.availability.manage',
      'station.inventory.operational_capacity.manage',
      'station.inventory.issue.report'
    ]::text[]),
    ('lpg.station.admin', array[
      'station.inventory.availability.manage',
      'station.inventory.operational_capacity.manage',
      'station.inventory.issue.report'
    ]::text[]),
    ('lpg.station.operations', array[
      'station.inventory.availability.manage',
      'station.inventory.operational_capacity.manage',
      'station.inventory.issue.report'
    ]::text[]),
    ('lpg.station.pump', array['station.inventory.issue.report']::text[])
)
insert into public.role_permissions (role_id, permission_id, conditions)
select role_record.id, permission_record.id, coalesce(existing_conditions.conditions, '{}'::jsonb)
from configured
join public.roles role_record on role_record.key = configured.role_key and role_record.status = 'active'
cross join lateral unnest(configured.permission_keys) permission_key
join public.permissions permission_record on permission_record.key = permission_key
left join lateral (
  select jsonb_build_object('branch_id', role_record.metadata ->> 'branch_id') conditions
  where nullif(role_record.metadata ->> 'branch_id', '') is not null
) existing_conditions on true
on conflict (role_id, permission_id) do nothing;

-- Extend the shared authorization helper without teaching the inventory engine
-- about particular staff-role names.
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
      'station.inventory.reconciliation.manage',
      'station.inventory.availability.manage',
      'station.inventory.operational_capacity.manage',
      'station.inventory.issue.report'
    ]::text[])
    and (
      auth.role() = 'service_role'
      or public.can_manage_lpg_operations()
      or public.has_permission('platform.inventory.manage', null)
      or public.has_permission('platform.inventory.override', null)
      or public.can_operate_lpg_station_branch(target_station_branch_id, target_permission_key)
    );
$$;

create or replace function public.upsert_lpg_inventory_telemetry_device(
  target_station_branch_id uuid,
  target_tank_public_reference text,
  target_connection_public_reference text,
  target_provider_device_reference text,
  target_display_name text,
  target_measurement_kind text,
  target_idempotency_key text,
  target_calibration jsonb default '{}'::jsonb,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.inventory.telemetry_device'
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  tank_record public.station_lpg_tanks%rowtype;
  connection_record public.station_inventory_provider_connections%rowtype;
  device_record public.station_inventory_telemetry_devices%rowtype;
  inventory_event_id uuid;
begin
  if not public.can_manage_lpg_station_inventory(target_station_branch_id, 'station.inventory.providers.manage') then
    raise exception 'branch-scoped inventory provider management permission is required';
  end if;
  if nullif(btrim(target_tank_public_reference), '') is null
     or nullif(btrim(target_connection_public_reference), '') is null
     or nullif(btrim(target_provider_device_reference), '') is null then
    raise exception 'tank, provider connection, and device references are required';
  end if;
  if target_display_name is null or char_length(btrim(target_display_name)) not between 2 and 120 then
    raise exception 'device name must be between 2 and 120 characters';
  end if;
  if target_measurement_kind not in (
    'mass_kg', 'fill_percentage', 'level_distance', 'volume_litres', 'pressure', 'multi_metric'
  ) then
    raise exception 'select a supported telemetry measurement type';
  end if;
  if nullif(btrim(target_idempotency_key), '') is null then
    raise exception 'target_idempotency_key is required';
  end if;
  if target_calibration is null or jsonb_typeof(target_calibration) <> 'object'
     or target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'device calibration and metadata must be JSON objects';
  end if;

  select tank.* into tank_record
  from public.station_lpg_tanks tank
  where tank.station_branch_id = target_station_branch_id
    and tank.public_reference = target_tank_public_reference
    and tank.status <> 'decommissioned'
  for update;
  if not found then raise exception 'selected tank was not found for this station'; end if;

  select connection.* into connection_record
  from public.station_inventory_provider_connections connection
  where connection.station_branch_id = target_station_branch_id
    and connection.public_reference = target_connection_public_reference
    and connection.source_type_key = 'telemetry'
    and connection.status not in ('disconnected', 'revoked')
  for update;
  if not found then raise exception 'active telemetry provider setup is required'; end if;

  select device.* into device_record
  from public.station_inventory_telemetry_devices device
  where device.source = target_source
    and device.idempotency_key = target_idempotency_key;
  if found then return device_record.public_reference; end if;

  insert into public.station_inventory_telemetry_devices (
    station_branch_id, tank_id, provider_connection_id,
    provider_device_reference, display_name, measurement_kind,
    status, health_status, calibration, metadata, source, idempotency_key
  )
  values (
    target_station_branch_id, tank_record.id, connection_record.id,
    btrim(target_provider_device_reference), btrim(target_display_name), target_measurement_kind,
    'pending', 'unknown', target_calibration, target_metadata, target_source, target_idempotency_key
  )
  on conflict (tank_id) do update
  set provider_connection_id = excluded.provider_connection_id,
      provider_device_reference = excluded.provider_device_reference,
      display_name = excluded.display_name,
      measurement_kind = excluded.measurement_kind,
      status = 'pending',
      health_status = 'unknown',
      calibration = excluded.calibration,
      metadata = public.station_inventory_telemetry_devices.metadata || excluded.metadata,
      source = excluded.source,
      idempotency_key = excluded.idempotency_key,
      updated_by = auth.uid(),
      updated_at = timezone('utc', now())
  returning * into device_record;

  update public.station_lpg_tanks
  set telemetry_capable = true,
      updated_by = auth.uid(),
      updated_at = timezone('utc', now())
  where id = tank_record.id;

  select device.public_reference into device_record.public_reference
  from public.station_inventory_telemetry_devices device
  where device.id = device_record.id;

  insert into public.station_inventory_events (
    station_branch_id, tank_id, event_type, stock_delta_kg,
    reason_key, related_entity_type, related_entity_id,
    metadata, source, idempotency_key
  )
  values (
    target_station_branch_id, tank_record.id, 'telemetry_device_mapped', 0,
    'inventory.telemetry_device_mapped', 'inventory.telemetry_device', device_record.id,
    jsonb_build_object(
      'devicePublicReference', device_record.public_reference,
      'connectionPublicReference', connection_record.public_reference,
      'measurementKind', target_measurement_kind
    ),
    target_source || '.event', target_idempotency_key
  )
  on conflict (source, idempotency_key) do nothing
  returning id into inventory_event_id;

  return device_record.public_reference;
end;
$$;

create or replace function public.configure_lpg_station_operational_capacity(
  target_station_branch_id uuid,
  target_filling_points integer,
  target_maximum_concurrent_jobs integer,
  target_idempotency_key text,
  target_estimated_processing_minutes numeric default null,
  target_congestion_status text default 'normal',
  target_paused_until timestamptz default null,
  target_pause_reason text default null,
  target_expected_version integer default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.inventory.operational_capacity'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  capacity_record public.station_inventory_operational_capacity%rowtype;
  event_id uuid;
  result jsonb;
begin
  if not public.can_manage_lpg_station_inventory(target_station_branch_id, 'station.inventory.operational_capacity.manage') then
    raise exception 'branch-scoped operational capacity permission is required';
  end if;
  if target_filling_points is null or target_filling_points <= 0 or target_filling_points > 100
     or target_maximum_concurrent_jobs is null or target_maximum_concurrent_jobs <= 0
     or target_maximum_concurrent_jobs > 500 then
    raise exception 'filling points and concurrent job limit must be positive and reasonable';
  end if;
  if target_estimated_processing_minutes is not null and target_estimated_processing_minutes < 0 then
    raise exception 'estimated processing time cannot be negative';
  end if;
  if target_congestion_status not in ('normal', 'busy', 'congested', 'paused', 'unknown') then
    raise exception 'select a supported congestion status';
  end if;
  if target_congestion_status = 'paused' and nullif(btrim(target_pause_reason), '') is null then
    raise exception 'explain why refill processing is paused';
  end if;
  if nullif(btrim(target_idempotency_key), '') is null then
    raise exception 'target_idempotency_key is required';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select * into capacity_record
  from public.station_inventory_operational_capacity
  where station_branch_id = target_station_branch_id
  for update;
  if not found then raise exception 'station operational capacity is required'; end if;
  if target_expected_version is not null and capacity_record.version <> target_expected_version then
    raise exception 'processing capacity changed while this form was open; refresh and review the latest settings';
  end if;
  if exists (
    select 1 from public.station_inventory_events event
    where event.source = target_source and event.idempotency_key = target_idempotency_key
  ) then return capacity_record.id; end if;

  update public.station_inventory_operational_capacity
  set filling_points = target_filling_points,
      maximum_concurrent_jobs = target_maximum_concurrent_jobs,
      estimated_processing_minutes = target_estimated_processing_minutes,
      congestion_status = target_congestion_status,
      paused_until = case when target_congestion_status = 'paused' then target_paused_until else null end,
      pause_reason = case when target_congestion_status = 'paused' then btrim(target_pause_reason) else null end,
      version = version + 1,
      metadata = metadata || target_metadata,
      updated_by = auth.uid(),
      updated_at = timezone('utc', now())
  where id = capacity_record.id
  returning * into capacity_record;

  perform set_config('skima.inventory_runtime', 'true', true);
  result := public.recalculate_lpg_station_inventory(target_station_branch_id, 'operational_capacity_changed');
  perform set_config('skima.inventory_runtime', 'false', true);

  insert into public.station_inventory_events (
    station_branch_id, event_type, stock_delta_kg,
    resulting_dispatchable_kg, reason_key, related_entity_type,
    related_entity_id, metadata, source, idempotency_key
  )
  values (
    target_station_branch_id, 'operational_capacity_changed', 0,
    (result ->> 'dispatchableKg')::numeric, 'inventory.operational_capacity_changed',
    'inventory.operational_capacity', capacity_record.id,
    target_metadata || jsonb_build_object(
      'fillingPoints', capacity_record.filling_points,
      'maximumConcurrentJobs', capacity_record.maximum_concurrent_jobs,
      'congestionStatus', capacity_record.congestion_status
    ),
    target_source, target_idempotency_key
  )
  returning id into event_id;

  return event_id;
end;
$$;

create or replace function public.set_lpg_station_inventory_availability(
  target_station_branch_id uuid,
  target_action text,
  target_reason text,
  target_idempotency_key text,
  target_until timestamptz default null,
  target_expected_version bigint default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.inventory.availability'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  state_record public.station_lpg_inventory_state%rowtype;
  event_id uuid;
  result jsonb;
  maximum_pause_hours integer;
begin
  if not public.can_manage_lpg_station_inventory(target_station_branch_id, 'station.inventory.availability.manage') then
    raise exception 'branch-scoped inventory availability permission is required';
  end if;
  if target_action not in ('temporarily_unavailable', 'out_of_stock', 'restore') then
    raise exception 'select a supported inventory availability action';
  end if;
  if target_action <> 'restore' and (target_reason is null or char_length(btrim(target_reason)) < 5) then
    raise exception 'explain why inventory availability is changing';
  end if;
  maximum_pause_hours := coalesce(
    nullif(public.inventory_runtime_policy() ->> 'maximumAvailabilityPauseHours', '')::integer,
    168
  );
  if target_action = 'temporarily_unavailable'
     and (
       target_until is null
       or target_until <= timezone('utc', now())
       or target_until > timezone('utc', now()) + make_interval(hours => maximum_pause_hours)
     ) then
    raise exception 'temporary unavailability must end within the configured limit';
  end if;
  if nullif(btrim(target_idempotency_key), '') is null then
    raise exception 'target_idempotency_key is required';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select * into state_record
  from public.station_lpg_inventory_state
  where station_branch_id = target_station_branch_id
  for update;
  if not found then raise exception 'station inventory state is required'; end if;
  if target_expected_version is not null and state_record.version <> target_expected_version then
    raise exception 'inventory changed while this action was open; refresh and review the latest status';
  end if;
  select event.id into event_id
  from public.station_inventory_events event
  where event.source = target_source and event.idempotency_key = target_idempotency_key;
  if found then return event_id; end if;

  if target_action = 'restore' then
    if state_record.physical_stock_kg is null or state_record.last_verified_at is null then
      raise exception 'confirm physical stock before restoring inventory availability';
    end if;
    if state_record.reconciliation_status in ('open', 'blocked') then
      raise exception 'resolve the inventory discrepancy before restoring dispatch';
    end if;
    update public.station_lpg_inventory_state
    set dispatch_blocked_until = null,
        dispatch_block_reason = null,
        rollout_status = 'active',
        metadata = metadata - 'inventoryAvailabilityOverride',
        version = version + 1,
        updated_at = timezone('utc', now())
    where station_branch_id = target_station_branch_id;

    perform set_config('skima.inventory_projection', 'true', true);
    update public.lpg_station_branches
    set availability_status = 'available',
        updated_at = timezone('utc', now())
    where id = target_station_branch_id
      and availability_status in ('paused', 'unavailable', 'capacity_reached');
    perform set_config('skima.inventory_projection', 'false', true);
  else
    update public.station_lpg_inventory_state
    set dispatch_blocked_until = case
          when target_action = 'out_of_stock' then 'infinity'::timestamptz
          else target_until
        end,
        dispatch_block_reason = case
          when target_action = 'out_of_stock' then 'station_reported_out_of_stock'
          else 'station_temporarily_unavailable'
        end,
        metadata = metadata || jsonb_build_object(
          'inventoryAvailabilityOverride', target_action,
          'inventoryAvailabilityReason', btrim(target_reason),
          'inventoryAvailabilityChangedBy', auth.uid(),
          'inventoryAvailabilityChangedAt', timezone('utc', now())
        ),
        version = version + 1,
        updated_at = timezone('utc', now())
    where station_branch_id = target_station_branch_id;

    perform set_config('skima.inventory_projection', 'true', true);
    update public.lpg_station_branches
    set availability_status = case
          when target_action = 'temporarily_unavailable' then 'paused'
          else 'capacity_reached'
        end,
        updated_at = timezone('utc', now())
    where id = target_station_branch_id;
    perform set_config('skima.inventory_projection', 'false', true);
  end if;

  perform set_config('skima.inventory_runtime', 'true', true);
  result := public.recalculate_lpg_station_inventory(target_station_branch_id, 'inventory_availability_' || target_action);
  perform set_config('skima.inventory_runtime', 'false', true);

  insert into public.station_inventory_events (
    station_branch_id, event_type, stock_delta_kg,
    resulting_physical_stock_kg, resulting_allocation_kg,
    resulting_reserved_kg, resulting_dispatchable_kg,
    reason_key, note, metadata, source, idempotency_key
  )
  values (
    target_station_branch_id, 'availability_' || target_action, 0,
    nullif(result ->> 'physicalStockKg', '')::numeric,
    (result ->> 'skimaAllocationKg')::numeric,
    (result ->> 'reservedKg')::numeric,
    (result ->> 'dispatchableKg')::numeric,
    'inventory.availability_' || target_action,
    nullif(btrim(target_reason), ''),
    target_metadata || jsonb_build_object('until', target_until),
    target_source, target_idempotency_key
  )
  returning id into event_id;

  return event_id;
end;
$$;

create or replace function public.disconnect_lpg_inventory_provider(
  target_connection_public_reference text,
  target_reason text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.inventory.provider_disconnect'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  connection_record public.station_inventory_provider_connections%rowtype;
  config_record public.station_inventory_configurations%rowtype;
  event_id uuid;
begin
  select * into connection_record
  from public.station_inventory_provider_connections connection
  where connection.public_reference = target_connection_public_reference
  for update;
  if not found then raise exception 'inventory provider connection was not found'; end if;
  if not public.can_manage_lpg_station_inventory(connection_record.station_branch_id, 'station.inventory.providers.manage') then
    raise exception 'branch-scoped inventory provider management permission is required';
  end if;
  if target_reason is null or char_length(btrim(target_reason)) < 5 then
    raise exception 'explain why the provider is being disconnected';
  end if;
  if nullif(btrim(target_idempotency_key), '') is null then
    raise exception 'target_idempotency_key is required';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select event.id into event_id
  from public.station_inventory_events event
  where event.source = target_source and event.idempotency_key = target_idempotency_key;
  if found then return event_id; end if;

  select * into config_record
  from public.station_inventory_configurations configuration
  where configuration.station_branch_id = connection_record.station_branch_id
  for update;

  if config_record.primary_source_key = connection_record.source_type_key
     and config_record.fallback_source_key is null
     and (config_record.manual_fallback_until is null
       or config_record.manual_fallback_until <= timezone('utc', now())) then
    raise exception 'choose a fallback source or pause the station before disconnecting its active inventory provider';
  end if;

  update public.station_inventory_provider_connections
  set status = 'disconnected',
      health_status = 'offline',
      credential_secret_ref = null,
      last_failure_at = timezone('utc', now()),
      last_error_code = 'disconnected_by_station',
      next_sync_at = null,
      metadata = metadata || target_metadata || jsonb_build_object(
        'disconnectReason', btrim(target_reason),
        'disconnectedAt', timezone('utc', now()),
        'disconnectedBy', auth.uid()
      ),
      updated_by = auth.uid(),
      updated_at = timezone('utc', now())
  where id = connection_record.id;

  update public.station_lpg_inventory_state
  set source_health = case
        when active_source_key = connection_record.source_type_key then 'offline'
        else source_health
      end,
      reconciliation_status = case
        when active_source_key = connection_record.source_type_key then 'review_required'
        else reconciliation_status
      end,
      version = version + 1,
      updated_at = timezone('utc', now())
  where station_branch_id = connection_record.station_branch_id;

  perform set_config('skima.inventory_runtime', 'true', true);
  perform public.recalculate_lpg_station_inventory(connection_record.station_branch_id, 'provider_disconnected');
  perform set_config('skima.inventory_runtime', 'false', true);

  insert into public.station_inventory_events (
    station_branch_id, event_type, stock_delta_kg, reason_key,
    note, related_entity_type, related_entity_id,
    metadata, source, idempotency_key
  )
  values (
    connection_record.station_branch_id, 'provider_disconnected', 0,
    'inventory.provider_disconnected', btrim(target_reason),
    'inventory.provider_connection', connection_record.id,
    target_metadata || jsonb_build_object('connectionPublicReference', connection_record.public_reference),
    target_source, target_idempotency_key
  )
  returning id into event_id;

  return event_id;
end;
$$;

create or replace function public.end_lpg_station_inventory_manual_fallback(
  target_station_branch_id uuid,
  target_reason text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.inventory.manual_fallback_end'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  config_record public.station_inventory_configurations%rowtype;
  provider_observation public.station_inventory_observations%rowtype;
  fallback_started_at timestamptz;
  event_id uuid;
begin
  if not public.can_manage_lpg_station_inventory(target_station_branch_id, 'station.inventory.sources.manage') then
    raise exception 'branch-scoped inventory source management permission is required';
  end if;
  if target_reason is null or char_length(btrim(target_reason)) < 5 then
    raise exception 'explain why manual fallback is ending';
  end if;
  if nullif(btrim(target_idempotency_key), '') is null then
    raise exception 'target_idempotency_key is required';
  end if;

  select * into config_record
  from public.station_inventory_configurations configuration
  where configuration.station_branch_id = target_station_branch_id
  for update;
  if not found or config_record.manual_fallback_until is null then
    raise exception 'manual fallback is not active';
  end if;
  select event.id into event_id
  from public.station_inventory_events event
  where event.source = target_source and event.idempotency_key = target_idempotency_key;
  if found then return event_id; end if;

  select coalesce(max(event.occurred_at), config_record.updated_at)
  into fallback_started_at
  from public.station_inventory_events event
  where event.station_branch_id = target_station_branch_id
    and event.event_type = 'manual_fallback_enabled';

  select observation.* into provider_observation
  from public.station_inventory_observations observation
  where observation.station_branch_id = target_station_branch_id
    and observation.source_type_key = config_record.primary_source_key
    and observation.disposition = 'accepted'
    and observation.observed_at >= fallback_started_at
  order by observation.observed_at desc
  limit 1;
  if provider_observation.id is null then
    raise exception 'a fresh reading from the primary provider is required before manual fallback can end';
  end if;

  update public.station_inventory_configurations
  set manual_fallback_until = null,
      status = 'setup_required',
      version = version + 1,
      metadata = metadata || target_metadata || jsonb_build_object(
        'fallbackEndedAt', timezone('utc', now()),
        'fallbackEndedBy', auth.uid(),
        'fallbackEndReason', btrim(target_reason)
      ),
      updated_by = auth.uid(),
      updated_at = timezone('utc', now())
  where station_branch_id = target_station_branch_id;

  insert into public.station_inventory_reconciliation_cases (
    station_branch_id, case_type, status, severity,
    expected_stock_kg, observed_stock_kg, difference_kg,
    source_observation_ids, summary, metadata, source, idempotency_key
  )
  select
    target_station_branch_id, 'cross_source_disagreement', 'open',
    case when abs(state.physical_stock_kg - provider_observation.normalized_stock_kg)
      > coalesce((public.inventory_runtime_policy() ->> 'discrepancyToleranceKg')::numeric, 0) * 3
      then 'high' else 'medium' end,
    state.physical_stock_kg, provider_observation.normalized_stock_kg,
    abs(state.physical_stock_kg - provider_observation.normalized_stock_kg),
    array[provider_observation.id],
    'Manual fallback ended. The recovered provider reading must be reconciled before it becomes authoritative.',
    target_metadata,
    target_source || '.reconciliation', target_idempotency_key
  from public.station_lpg_inventory_state state
  where state.station_branch_id = target_station_branch_id
  on conflict (source, idempotency_key) do nothing;

  update public.station_lpg_inventory_state
  set reconciliation_status = 'open',
      source_health = 'degraded',
      version = version + 1,
      updated_at = timezone('utc', now())
  where station_branch_id = target_station_branch_id;

  perform set_config('skima.inventory_runtime', 'true', true);
  perform public.recalculate_lpg_station_inventory(target_station_branch_id, 'manual_fallback_ended');
  perform set_config('skima.inventory_runtime', 'false', true);

  insert into public.station_inventory_events (
    station_branch_id, observation_id, event_type, stock_delta_kg,
    reason_key, note, metadata, source, idempotency_key
  )
  values (
    target_station_branch_id, provider_observation.id, 'manual_fallback_ended', 0,
    'inventory.manual_fallback_ended', btrim(target_reason), target_metadata,
    target_source, target_idempotency_key
  )
  returning id into event_id;

  return event_id;
end;
$$;

-- Only backend workers may resolve provider execution details. Client-facing
-- catalog/read models intentionally omit credential references and private
-- adapter configuration.
create or replace function public.read_lpg_inventory_provider_runtime_context(
  target_connection_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  connection_record public.station_inventory_provider_connections%rowtype;
  adapter_record public.provider_adapters%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'backend inventory provider context is required';
  end if;

  select connection.* into connection_record
  from public.station_inventory_provider_connections connection
  where connection.id = target_connection_id;
  if not found then
    raise exception 'inventory provider connection was not found';
  end if;

  select adapter.* into adapter_record
  from public.provider_adapters adapter
  where adapter.id = connection_record.provider_adapter_id
    and adapter.provider_kind = 'inventory';
  if not found then
    raise exception 'inventory provider adapter was not found';
  end if;

  return jsonb_build_object(
    'connectionId', connection_record.id,
    'connectionPublicReference', connection_record.public_reference,
    'stationBranchId', connection_record.station_branch_id,
    'providerKey', adapter_record.key,
    'sourceTypeKey', connection_record.source_type_key,
    'connectionMethod', connection_record.connection_method,
    'connectionStatus', connection_record.status,
    'healthStatus', connection_record.health_status,
    'credentialSecretRef', coalesce(connection_record.credential_secret_ref, adapter_record.secret_ref),
    'adapterConfig', adapter_record.config,
    'connectionSettings', connection_record.settings,
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'deviceId', device.id,
        'devicePublicReference', device.public_reference,
        'providerDeviceReference', device.provider_device_reference,
        'tankId', device.tank_id,
        'tankPublicReference', tank.public_reference,
        'measurementKind', device.measurement_kind,
        'calibration', device.calibration,
        'normalizationVersion', device.normalization_version
      ) order by device.id)
      from public.station_inventory_telemetry_devices device
      join public.station_lpg_tanks tank on tank.id = device.tank_id
      where device.provider_connection_id = connection_record.id
        and device.status <> 'retired'
    ), '[]'::jsonb),
    'nextSyncAt', connection_record.next_sync_at
  );
end;
$$;

create or replace function public.read_lpg_inventory_provider_webhook_context(
  target_connection_public_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  connection_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'backend inventory webhook context is required';
  end if;
  if nullif(btrim(target_connection_public_reference), '') is null then
    raise exception 'provider connection reference is required';
  end if;

  select connection.id into connection_id
  from public.station_inventory_provider_connections connection
  where connection.public_reference = upper(btrim(target_connection_public_reference))
    and connection.connection_method in ('webhook', 'device_gateway', 'managed')
    and connection.status in ('active', 'degraded');
  if not found then
    raise exception 'active inventory webhook connection was not found';
  end if;

  return public.read_lpg_inventory_provider_runtime_context(connection_id);
end;
$$;

create or replace function public.record_lpg_inventory_provider_sync_result(
  target_connection_id uuid,
  target_succeeded boolean,
  target_latency_ms integer default null,
  target_error_code text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  connection_record public.station_inventory_provider_connections%rowtype;
  runtime_policy jsonb;
  retry_base_seconds integer;
  maximum_attempts integer;
  sync_interval_minutes integer;
  next_attempt_at timestamptz;
  resolved_failure_count integer;
  resolved_health text;
  resolved_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'backend inventory provider health update is required';
  end if;
  if target_succeeded is null then
    raise exception 'target_succeeded is required';
  end if;
  if target_latency_ms is not null and target_latency_ms < 0 then
    raise exception 'target_latency_ms cannot be negative';
  end if;
  if target_error_code is not null
     and target_error_code !~ '^[A-Za-z0-9_.:-]{2,120}$' then
    raise exception 'target_error_code must be a safe machine-readable code';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select connection.* into connection_record
  from public.station_inventory_provider_connections connection
  where connection.id = target_connection_id
  for update;
  if not found then
    raise exception 'inventory provider connection was not found';
  end if;

  runtime_policy := public.inventory_runtime_policy();
  retry_base_seconds := coalesce(nullif(runtime_policy ->> 'providerRetryBaseSeconds', '')::integer, 60);
  maximum_attempts := coalesce(nullif(runtime_policy ->> 'providerRetryMaximumAttempts', '')::integer, 5);
  sync_interval_minutes := coalesce(nullif(runtime_policy ->> 'providerSyncIntervalMinutes', '')::integer, 5);

  if target_succeeded then
    resolved_failure_count := 0;
    resolved_health := 'healthy';
    resolved_status := 'active';
    next_attempt_at := timezone('utc', now()) + make_interval(mins => sync_interval_minutes);
  else
    resolved_failure_count := connection_record.sync_failure_count + 1;
    resolved_health := case
      when resolved_failure_count >= maximum_attempts then 'offline'
      else 'degraded'
    end;
    resolved_status := case
      when resolved_failure_count >= maximum_attempts then 'failed'
      else 'degraded'
    end;
    next_attempt_at := timezone('utc', now()) + make_interval(
      secs => least(
        retry_base_seconds * power(2::numeric, least(resolved_failure_count - 1, 10))::integer,
        86400
      )
    );
  end if;

  update public.station_inventory_provider_connections
  set status = resolved_status,
      health_status = resolved_health,
      last_sync_attempt_at = timezone('utc', now()),
      last_successful_sync_at = case
        when target_succeeded then timezone('utc', now())
        else last_successful_sync_at
      end,
      last_failure_at = case
        when target_succeeded then last_failure_at
        else timezone('utc', now())
      end,
      next_sync_at = next_attempt_at,
      sync_latency_ms = target_latency_ms,
      sync_failure_count = resolved_failure_count,
      last_error_code = case when target_succeeded then null else target_error_code end,
      last_health_check_at = timezone('utc', now()),
      metadata = metadata || target_metadata,
      updated_at = timezone('utc', now())
  where id = target_connection_id
  returning * into connection_record;

  update public.station_lpg_inventory_state state
  set source_health = connection_record.health_status,
      updated_at = timezone('utc', now())
  where state.station_branch_id = connection_record.station_branch_id
    and state.active_source_key = connection_record.source_type_key;

  perform set_config('skima.inventory_runtime', 'true', true);
  perform public.recalculate_lpg_station_inventory(
    connection_record.station_branch_id,
    case when target_succeeded then 'provider_sync_succeeded' else 'provider_sync_failed' end
  );
  perform set_config('skima.inventory_runtime', 'false', true);

  return jsonb_build_object(
    'connectionId', connection_record.id,
    'status', connection_record.status,
    'healthStatus', connection_record.health_status,
    'failureCount', connection_record.sync_failure_count,
    'nextSyncAt', connection_record.next_sync_at
  );
end;
$$;

create or replace function public.begin_lpg_inventory_provider_webhook(
  target_connection_id uuid,
  target_provider_event_reference text,
  target_provider_timestamp timestamptz,
  target_signature_digest text,
  target_payload_digest text,
  target_source_ip_hash text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  connection_record public.station_inventory_provider_connections%rowtype;
  receipt_record public.station_inventory_provider_webhook_receipts%rowtype;
  replay_age_hours integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'backend inventory webhook receipt is required';
  end if;
  if nullif(btrim(target_provider_event_reference), '') is null then
    raise exception 'provider event reference is required';
  end if;
  if target_provider_timestamp is null then
    raise exception 'provider timestamp is required';
  end if;
  if target_signature_digest !~ '^[A-Fa-f0-9]{32,128}$'
     or target_payload_digest !~ '^[A-Fa-f0-9]{32,128}$' then
    raise exception 'webhook digests are invalid';
  end if;
  if target_source_ip_hash is not null
     and target_source_ip_hash !~ '^[A-Fa-f0-9]{32,128}$' then
    raise exception 'source IP hash is invalid';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select connection.* into connection_record
  from public.station_inventory_provider_connections connection
  where connection.id = target_connection_id
    and connection.connection_method in ('webhook', 'device_gateway', 'managed')
    and connection.status in ('active', 'degraded');
  if not found then
    raise exception 'active webhook inventory provider connection is required';
  end if;

  replay_age_hours := coalesce(
    nullif(public.inventory_runtime_policy() ->> 'maximumProviderReplayAgeHours', '')::integer,
    72
  );
  if target_provider_timestamp < timezone('utc', now()) - make_interval(hours => replay_age_hours)
     or target_provider_timestamp > timezone('utc', now()) + interval '5 minutes' then
    raise exception 'provider webhook timestamp is outside the accepted window';
  end if;

  select receipt.* into receipt_record
  from public.station_inventory_provider_webhook_receipts receipt
  where receipt.provider_connection_id = target_connection_id
    and receipt.provider_event_reference = btrim(target_provider_event_reference);
  if found then
    return jsonb_build_object(
      'receiptId', receipt_record.id,
      'status', receipt_record.status,
      'duplicate', true,
      'observationId', receipt_record.observation_id
    );
  end if;

  insert into public.station_inventory_provider_webhook_receipts (
    provider_connection_id, provider_event_reference, provider_timestamp,
    signature_digest, payload_digest, source_ip_hash, metadata
  )
  values (
    target_connection_id, btrim(target_provider_event_reference), target_provider_timestamp,
    lower(target_signature_digest), lower(target_payload_digest), lower(target_source_ip_hash),
    target_metadata
  )
  on conflict (provider_connection_id, provider_event_reference) do nothing
  returning * into receipt_record;

  if receipt_record.id is null then
    select receipt.* into receipt_record
    from public.station_inventory_provider_webhook_receipts receipt
    where receipt.provider_connection_id = target_connection_id
      and receipt.provider_event_reference = btrim(target_provider_event_reference);
  end if;

  return jsonb_build_object(
    'receiptId', receipt_record.id,
    'status', receipt_record.status,
    'duplicate', receipt_record.status <> 'received',
    'observationId', receipt_record.observation_id
  );
end;
$$;

create or replace function public.complete_lpg_inventory_provider_webhook(
  target_receipt_id uuid,
  target_status text,
  target_observation_id uuid default null,
  target_rejection_code text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  receipt_record public.station_inventory_provider_webhook_receipts%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'backend inventory webhook completion is required';
  end if;
  if target_status not in ('accepted', 'duplicate', 'rejected', 'failed') then
    raise exception 'webhook completion status is invalid';
  end if;
  if target_rejection_code is not null
     and target_rejection_code !~ '^[A-Za-z0-9_.:-]{2,120}$' then
    raise exception 'target_rejection_code must be a safe machine-readable code';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select receipt.* into receipt_record
  from public.station_inventory_provider_webhook_receipts receipt
  where receipt.id = target_receipt_id
  for update;
  if not found then
    raise exception 'inventory webhook receipt was not found';
  end if;
  if receipt_record.status <> 'received' then
    return receipt_record.id;
  end if;

  if target_observation_id is not null and not exists (
    select 1
    from public.station_inventory_observations observation
    join public.station_inventory_provider_connections connection
      on connection.id = receipt_record.provider_connection_id
    where observation.id = target_observation_id
      and observation.station_branch_id = connection.station_branch_id
  ) then
    raise exception 'webhook observation does not belong to this provider connection';
  end if;

  update public.station_inventory_provider_webhook_receipts
  set status = target_status,
      observation_id = target_observation_id,
      rejection_code = target_rejection_code,
      metadata = metadata || target_metadata,
      processed_at = timezone('utc', now())
  where id = target_receipt_id;

  return target_receipt_id;
end;
$$;

-- Operational issue reporting never rewrites measured stock. It immediately
-- removes the station from dispatch, creates a reconciliation case, and leaves
-- the physical ledger available for a controlled correction.
create or replace function public.report_lpg_inventory_unexpected_stockout(
  target_station_branch_id uuid,
  target_order_public_reference text,
  target_reason text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.inventory.unexpected_stockout'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  order_record public.lpg_refill_orders%rowtype;
  state_record public.station_lpg_inventory_state%rowtype;
  reconciliation_id uuid;
  event_id uuid;
  reliability_penalty numeric;
begin
  if nullif(btrim(target_reason), '') is null or char_length(btrim(target_reason)) < 5 then
    raise exception 'explain the unexpected stockout';
  end if;
  if nullif(btrim(target_idempotency_key), '') is null then
    raise exception 'target_idempotency_key is required';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  if nullif(btrim(target_order_public_reference), '') is not null then
    select target_order.* into order_record
    from public.lpg_refill_orders target_order
    where target_order.public_reference = upper(btrim(target_order_public_reference));
    if not found then
      raise exception 'refill order was not found';
    end if;
    if target_station_branch_id is not null
       and order_record.station_branch_id is distinct from target_station_branch_id then
      raise exception 'refill order does not belong to the selected station';
    end if;
    target_station_branch_id := order_record.station_branch_id;
  end if;

  if target_station_branch_id is null then
    raise exception 'station branch is required';
  end if;
  if auth.role() <> 'service_role'
     and not public.has_permission('platform.inventory.override', null)
     and not public.can_manage_lpg_station_inventory(
       target_station_branch_id,
       'station.inventory.issue.report'
     )
     and not exists (
       select 1
       from public.driver_profiles driver
       where driver.id = order_record.driver_profile_id
         and driver.user_id = auth.uid()
     ) then
    raise exception 'inventory issue reporting permission is required';
  end if;

  select event.id into event_id
  from public.station_inventory_events event
  where event.source = target_source
    and event.idempotency_key = target_idempotency_key;
  if found then return event_id; end if;

  select state.* into state_record
  from public.station_lpg_inventory_state state
  where state.station_branch_id = target_station_branch_id
  for update;
  if not found then
    raise exception 'station inventory state is required';
  end if;

  reliability_penalty := coalesce(
    nullif(public.inventory_runtime_policy() ->> 'unexpectedStockoutReliabilityPenalty', '')::numeric,
    5
  );

  insert into public.station_inventory_reconciliation_cases (
    station_branch_id, case_type, status, severity,
    expected_stock_kg, observed_stock_kg, difference_kg,
    summary, metadata, source, idempotency_key
  )
  values (
    target_station_branch_id, 'unexpected_stockout', 'open', 'critical',
    state_record.physical_stock_kg, 0, state_record.physical_stock_kg,
    'An assigned refill could not proceed because the station reported an unexpected stockout.',
    target_metadata || jsonb_strip_nulls(jsonb_build_object(
      'orderId', order_record.id,
      'orderPublicReference', order_record.public_reference,
      'reportedBy', auth.uid()
    )),
    target_source || '.reconciliation', target_idempotency_key
  )
  on conflict (source, idempotency_key) do update
  set metadata = public.station_inventory_reconciliation_cases.metadata || excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into reconciliation_id;

  update public.station_lpg_inventory_state
  set reconciliation_status = 'blocked',
      dispatch_blocked_until = 'infinity'::timestamptz,
      dispatch_block_reason = 'unexpected_stockout',
      reliability_score = greatest(reliability_score - reliability_penalty, 0),
      source_confidence = case
        when source_confidence = 'HIGH' then 'MEDIUM'
        else source_confidence
      end,
      metadata = metadata || target_metadata || jsonb_strip_nulls(jsonb_build_object(
        'unexpectedStockoutAt', timezone('utc', now()),
        'unexpectedStockoutOrderId', order_record.id
      )),
      version = version + 1,
      updated_at = timezone('utc', now())
  where station_branch_id = target_station_branch_id;

  perform set_config('skima.inventory_projection', 'true', true);
  update public.lpg_station_branches
  set availability_status = 'capacity_reached',
      updated_at = timezone('utc', now())
  where id = target_station_branch_id;
  perform set_config('skima.inventory_projection', 'false', true);

  perform set_config('skima.inventory_runtime', 'true', true);
  perform public.recalculate_lpg_station_inventory(target_station_branch_id, 'unexpected_stockout');
  perform set_config('skima.inventory_runtime', 'false', true);

  insert into public.station_inventory_events (
    station_branch_id, event_type, stock_delta_kg,
    resulting_physical_stock_kg, resulting_allocation_kg,
    resulting_reserved_kg, resulting_dispatchable_kg,
    reason_key, note, related_entity_type, related_entity_id,
    metadata, source, idempotency_key
  )
  select
    target_station_branch_id, 'unexpected_stockout_reported', 0,
    state.physical_stock_kg, state.skima_allocation_kg,
    state.reserved_kg, state.dispatchable_kg,
    'inventory.unexpected_stockout', btrim(target_reason),
    case when order_record.id is null then 'inventory.reconciliation' else 'lpg.order' end,
    coalesce(order_record.id, reconciliation_id),
    target_metadata || jsonb_build_object('reconciliationCaseId', reconciliation_id),
    target_source, target_idempotency_key
  from public.station_lpg_inventory_state state
  where state.station_branch_id = target_station_branch_id
  returning id into event_id;

  return event_id;
end;
$$;

create or replace function public.apply_lpg_inventory_admin_override(
  target_station_branch_id uuid,
  target_action text,
  target_reason text,
  target_idempotency_key text,
  target_until timestamptz default null,
  target_expected_version bigint default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.admin.inventory.override'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  state_record public.station_lpg_inventory_state%rowtype;
  reconciliation_id uuid;
  event_id uuid;
begin
  if auth.role() <> 'service_role'
     and not public.has_permission('platform.inventory.override', null) then
    raise exception 'platform inventory override permission is required';
  end if;
  if target_action not in (
    'temporarily_unavailable', 'out_of_stock', 'restore', 'require_reconciliation'
  ) then
    raise exception 'select a supported inventory override';
  end if;
  if nullif(btrim(target_reason), '') is null or char_length(btrim(target_reason)) < 5 then
    raise exception 'explain why this inventory override is required';
  end if;
  if nullif(btrim(target_idempotency_key), '') is null then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_action <> 'require_reconciliation' then
    return public.set_lpg_station_inventory_availability(
      target_station_branch_id,
      target_action,
      target_reason,
      target_idempotency_key,
      target_until,
      target_expected_version,
      target_metadata || jsonb_build_object('adminOverride', true),
      target_source
    );
  end if;

  select state.* into state_record
  from public.station_lpg_inventory_state state
  where state.station_branch_id = target_station_branch_id
  for update;
  if not found then raise exception 'station inventory state is required'; end if;
  if target_expected_version is not null and state_record.version <> target_expected_version then
    raise exception 'inventory changed while this override was open; refresh and review the latest status';
  end if;
  select event.id into event_id
  from public.station_inventory_events event
  where event.source = target_source and event.idempotency_key = target_idempotency_key;
  if found then return event_id; end if;

  insert into public.station_inventory_reconciliation_cases (
    station_branch_id, case_type, status, severity,
    expected_stock_kg, observed_stock_kg, difference_kg,
    summary, metadata, source, idempotency_key
  )
  values (
    target_station_branch_id, 'other', 'open', 'high',
    state_record.physical_stock_kg, state_record.observed_stock_kg,
    abs(coalesce(state_record.physical_stock_kg, 0) - coalesce(state_record.observed_stock_kg, 0)),
    btrim(target_reason),
    target_metadata || jsonb_build_object('adminOverride', true, 'requestedBy', auth.uid()),
    target_source || '.reconciliation', target_idempotency_key
  )
  on conflict (source, idempotency_key) do update
  set metadata = public.station_inventory_reconciliation_cases.metadata || excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into reconciliation_id;

  update public.station_lpg_inventory_state
  set reconciliation_status = 'blocked',
      dispatch_blocked_until = 'infinity'::timestamptz,
      dispatch_block_reason = 'admin_reconciliation_required',
      metadata = metadata || target_metadata || jsonb_build_object(
        'adminOverride', 'require_reconciliation',
        'adminOverrideAt', timezone('utc', now()),
        'adminOverrideBy', auth.uid()
      ),
      version = version + 1,
      updated_at = timezone('utc', now())
  where station_branch_id = target_station_branch_id;

  perform set_config('skima.inventory_runtime', 'true', true);
  perform public.recalculate_lpg_station_inventory(target_station_branch_id, 'admin_reconciliation_required');
  perform set_config('skima.inventory_runtime', 'false', true);

  insert into public.station_inventory_events (
    station_branch_id, event_type, stock_delta_kg,
    resulting_physical_stock_kg, resulting_allocation_kg,
    resulting_reserved_kg, resulting_dispatchable_kg,
    reason_key, note, related_entity_type, related_entity_id,
    metadata, source, idempotency_key
  )
  select
    target_station_branch_id, 'admin_reconciliation_required', 0,
    state.physical_stock_kg, state.skima_allocation_kg,
    state.reserved_kg, state.dispatchable_kg,
    'inventory.admin_reconciliation_required', btrim(target_reason),
    'inventory.reconciliation', reconciliation_id,
    target_metadata, target_source, target_idempotency_key
  from public.station_lpg_inventory_state state
  where state.station_branch_id = target_station_branch_id
  returning id into event_id;

  return event_id;
end;
$$;

create or replace function public.refresh_lpg_inventory_alert(
  target_station_branch_id uuid,
  target_alert_key text,
  target_state_fingerprint text,
  target_severity text,
  target_title text,
  target_body text,
  target_resolved boolean default false,
  target_metadata jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  alert_record public.station_inventory_alert_states%rowtype;
  station_record public.lpg_station_branches%rowtype;
  reminder_minutes integer;
  should_notify boolean := false;
  notified_count integer := 0;
  recipient record;
begin
  if auth.role() <> 'service_role' then
    raise exception 'backend inventory alert refresh is required';
  end if;
  if target_alert_key is null
     or target_alert_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_alert_key must be a valid key';
  end if;
  if nullif(btrim(target_state_fingerprint), '') is null then
    raise exception 'target_state_fingerprint is required';
  end if;
  if target_severity not in ('info', 'warning', 'high', 'critical') then
    raise exception 'target_severity is invalid';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select station.* into station_record
  from public.lpg_station_branches station
  where station.id = target_station_branch_id;
  if not found then
    raise exception 'station branch was not found';
  end if;

  select alert.* into alert_record
  from public.station_inventory_alert_states alert
  where alert.station_branch_id = target_station_branch_id
    and alert.alert_key = target_alert_key
  for update;

  if target_resolved then
    if alert_record.id is not null and alert_record.resolved_at is null then
      update public.station_inventory_alert_states
      set resolved_at = timezone('utc', now()),
          last_observed_at = timezone('utc', now()),
          metadata = metadata || target_metadata,
          updated_at = timezone('utc', now())
      where id = alert_record.id;
    end if;
    return 0;
  end if;

  reminder_minutes := coalesce(
    nullif(public.inventory_runtime_policy() ->> 'alertReminderIntervalMinutes', '')::integer,
    240
  );
  should_notify := alert_record.id is null
    or alert_record.resolved_at is not null
    or alert_record.state_fingerprint <> target_state_fingerprint
    or alert_record.last_notified_at is null
    or alert_record.last_notified_at <= timezone('utc', now()) - make_interval(mins => reminder_minutes);

  insert into public.station_inventory_alert_states (
    station_branch_id, alert_key, state_fingerprint, severity,
    first_observed_at, last_observed_at, last_notified_at,
    notification_count, resolved_at, metadata
  )
  values (
    target_station_branch_id, target_alert_key, target_state_fingerprint,
    target_severity, timezone('utc', now()), timezone('utc', now()),
    case when should_notify then timezone('utc', now()) else null end,
    case when should_notify then 1 else 0 end,
    null, target_metadata
  )
  on conflict (station_branch_id, alert_key) do update
  set state_fingerprint = excluded.state_fingerprint,
      severity = excluded.severity,
      first_observed_at = case
        when public.station_inventory_alert_states.resolved_at is not null
          then timezone('utc', now())
        else public.station_inventory_alert_states.first_observed_at
      end,
      last_observed_at = timezone('utc', now()),
      last_notified_at = case
        when should_notify then timezone('utc', now())
        else public.station_inventory_alert_states.last_notified_at
      end,
      notification_count = public.station_inventory_alert_states.notification_count
        + case when should_notify then 1 else 0 end,
      resolved_at = null,
      metadata = public.station_inventory_alert_states.metadata || excluded.metadata,
      updated_at = timezone('utc', now())
  returning * into alert_record;

  if not should_notify then
    return 0;
  end if;

  for recipient in
    select distinct assigned_role.user_id
    from public.user_roles assigned_role
    where assigned_role.organization_id = station_record.organization_id
      and assigned_role.status = 'active'
      and assigned_role.starts_at <= timezone('utc', now())
      and (assigned_role.ends_at is null or assigned_role.ends_at > timezone('utc', now()))
      and (assigned_role.branch_id is null or assigned_role.branch_id = station_record.branch_id)
      and public.user_can_operate_lpg_station_branch(
        assigned_role.user_id,
        target_station_branch_id,
        'station.inventory.read'
      )
  loop
    insert into public.communication_messages (
      channel, purpose, recipient_entity_type, recipient_entity_id,
      status, payload, source, idempotency_key, metadata, created_by
    )
    values (
      'in_app', 'station.inventory.alert', 'user', recipient.user_id,
      'queued',
      jsonb_build_object(
        'title', target_title,
        'body', target_body,
        'category', 'partner',
        'stationBranchId', target_station_branch_id,
        'stationName', station_record.display_name,
        'alertKey', target_alert_key,
        'severity', target_severity,
        'deepLink', '/(station)/inventory'
      ) || target_metadata,
      'skima.inventory.alert',
      alert_record.id::text || ':' || alert_record.notification_count::text || ':' || recipient.user_id::text,
      jsonb_build_object(
        'stationBranchId', target_station_branch_id,
        'alertId', alert_record.id,
        'alertKey', target_alert_key
      ),
      null
    )
    on conflict (source, idempotency_key) do nothing;
    if found then notified_count := notified_count + 1; end if;
  end loop;

  return notified_count;
end;
$$;

create or replace function public.run_lpg_inventory_maintenance(
  target_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  runtime_policy jsonb;
  sync_interval_minutes integer;
  provider_degraded_minutes integer;
  provider_offline_minutes integer;
  telemetry_warning_minutes integer;
  telemetry_stale_minutes integer;
  provider_maximum_attempts integer;
  expired_reservations integer := 0;
  expired_fallbacks integer := 0;
  provider_jobs integer := 0;
  recalculated_stations integer := 0;
  notifications_queued integer := 0;
  provider_record record;
  fallback_record record;
  state_record record;
  stock_alert_active boolean;
  freshness_alert_active boolean;
  source_alert_active boolean;
  reconciliation_alert_active boolean;
  fallback_alert_active boolean;
  capacity_alert_active boolean;
  fallback_key text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'backend inventory maintenance is required';
  end if;
  if target_limit is null or target_limit < 1 or target_limit > 1000 then
    raise exception 'target_limit must be between 1 and 1000';
  end if;

  runtime_policy := public.inventory_runtime_policy();
  sync_interval_minutes := coalesce(nullif(runtime_policy ->> 'providerSyncIntervalMinutes', '')::integer, 5);
  provider_degraded_minutes := coalesce(nullif(runtime_policy ->> 'providerDegradedIntervalMinutes', '')::integer, 15);
  provider_offline_minutes := coalesce(nullif(runtime_policy ->> 'providerOfflineIntervalMinutes', '')::integer, 30);
  telemetry_warning_minutes := coalesce(nullif(runtime_policy ->> 'telemetryWarningIntervalMinutes', '')::integer, 10);
  telemetry_stale_minutes := coalesce(nullif(runtime_policy ->> 'telemetryStaleIntervalMinutes', '')::integer, 20);
  provider_maximum_attempts := coalesce(nullif(runtime_policy ->> 'providerRetryMaximumAttempts', '')::integer, 5);

  if sync_interval_minutes <= 0
     or provider_degraded_minutes <= sync_interval_minutes
     or provider_offline_minutes <= provider_degraded_minutes
     or telemetry_warning_minutes <= 0
     or telemetry_stale_minutes <= telemetry_warning_minutes then
    raise exception 'inventory maintenance policy intervals are invalid';
  end if;

  -- The compatibility trigger mirrors each legacy status transition into the
  -- normalized reservation ledger and recalculates dispatchable stock.
  with due as (
    select reservation.id
    from public.lpg_station_capacity_reservations reservation
    where reservation.status = 'reserved'
      and reservation.expires_at is not null
      and reservation.expires_at <= timezone('utc', now())
    order by reservation.expires_at, reservation.id
    for update skip locked
    limit target_limit
  )
  update public.lpg_station_capacity_reservations reservation
  set status = 'expired',
      metadata = reservation.metadata || jsonb_build_object(
        'expiredBy', 'inventory_maintenance',
        'expiredAt', timezone('utc', now())
      ),
      updated_at = timezone('utc', now())
  from due
  where reservation.id = due.id;
  get diagnostics expired_reservations = row_count;

  update public.station_inventory_provider_connections connection
  set health_status = case
        when coalesce(connection.last_successful_sync_at, connection.last_connected_at, connection.updated_at)
          <= timezone('utc', now()) - make_interval(mins => provider_offline_minutes)
          then 'offline'
        when coalesce(connection.last_successful_sync_at, connection.last_connected_at, connection.updated_at)
          <= timezone('utc', now()) - make_interval(mins => provider_degraded_minutes)
          then 'degraded'
        else 'healthy'
      end,
      status = case
        when coalesce(connection.last_successful_sync_at, connection.last_connected_at, connection.updated_at)
          <= timezone('utc', now()) - make_interval(mins => provider_degraded_minutes)
          then 'degraded'
        else 'active'
      end,
      last_health_check_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where connection.status in ('active', 'degraded')
    and connection.connection_method in ('polling', 'managed', 'device_gateway');

  update public.station_inventory_telemetry_devices device
  set health_status = case
        when device.last_reading_at is null
          or device.last_reading_at <= timezone('utc', now()) - make_interval(mins => telemetry_stale_minutes)
          then 'offline'
        when device.last_reading_at <= timezone('utc', now()) - make_interval(mins => telemetry_warning_minutes)
          then 'degraded'
        else 'healthy'
      end,
      status = case
        when device.last_reading_at is null
          or device.last_reading_at <= timezone('utc', now()) - make_interval(mins => telemetry_stale_minutes)
          then 'offline'
        when device.last_reading_at <= timezone('utc', now()) - make_interval(mins => telemetry_warning_minutes)
          then 'degraded'
        else 'active'
      end,
      last_health_check_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where device.status in ('active', 'degraded', 'offline');

  for fallback_record in
    select configuration.*
    from public.station_inventory_configurations configuration
    where configuration.manual_fallback_until is not null
      and configuration.manual_fallback_until <= timezone('utc', now())
    order by configuration.manual_fallback_until, configuration.id
    for update skip locked
    limit target_limit
  loop
    fallback_key := 'fallback-expired:' || fallback_record.id::text || ':' || fallback_record.version::text;

    update public.station_inventory_configurations
    set manual_fallback_until = null,
        status = 'setup_required',
        version = version + 1,
        metadata = metadata || jsonb_build_object(
          'manualFallbackExpiredAt', timezone('utc', now())
        ),
        updated_at = timezone('utc', now())
    where id = fallback_record.id;

    update public.station_lpg_inventory_state
    set reconciliation_status = 'review_required',
        source_health = 'degraded',
        dispatch_blocked_until = 'infinity'::timestamptz,
        dispatch_block_reason = 'manual_fallback_expired',
        version = version + 1,
        updated_at = timezone('utc', now())
    where station_branch_id = fallback_record.station_branch_id;

    insert into public.station_inventory_events (
      station_branch_id, event_type, stock_delta_kg, reason_key,
      note, related_entity_type, related_entity_id,
      metadata, source, idempotency_key
    )
    values (
      fallback_record.station_branch_id, 'manual_fallback_expired', 0,
      'inventory.manual_fallback_expired',
      'The temporary manual fallback expired and requires source reconciliation.',
      'inventory.configuration', fallback_record.id,
      jsonb_build_object('expiredAt', fallback_record.manual_fallback_until),
      'inventory.maintenance', fallback_key
    )
    on conflict (source, idempotency_key) do nothing;

    perform set_config('skima.inventory_runtime', 'true', true);
    perform public.recalculate_lpg_station_inventory(
      fallback_record.station_branch_id,
      'manual_fallback_expired'
    );
    perform set_config('skima.inventory_runtime', 'false', true);
    expired_fallbacks := expired_fallbacks + 1;
  end loop;

  for provider_record in
    select connection.id
    from public.station_inventory_provider_connections connection
    join public.provider_adapters adapter
      on adapter.id = connection.provider_adapter_id
     and adapter.provider_kind = 'inventory'
     and adapter.status = 'active'
    where connection.status in ('active', 'degraded')
      and connection.connection_method = 'polling'
      and coalesce(connection.credential_secret_ref, adapter.secret_ref) is not null
      and (connection.next_sync_at is null or connection.next_sync_at <= timezone('utc', now()))
    order by connection.next_sync_at nulls first, connection.id
    for update of connection skip locked
    limit target_limit
  loop
    perform public.enqueue_background_job(
      'platform.inventory',
      'platform.inventory.provider_sync',
      jsonb_build_object('connectionId', provider_record.id),
      'inventory.provider_schedule',
      provider_record.id::text || ':' || floor(
        extract(epoch from timezone('utc', now())) / (sync_interval_minutes * 60)
      )::bigint::text,
      timezone('utc', now()),
      provider_maximum_attempts
    );

    update public.station_inventory_provider_connections
    set last_sync_attempt_at = timezone('utc', now()),
        next_sync_at = timezone('utc', now()) + make_interval(mins => sync_interval_minutes),
        updated_at = timezone('utc', now())
    where id = provider_record.id;
    provider_jobs := provider_jobs + 1;
  end loop;

  for state_record in
    select
      state.*,
      station.display_name station_display_name,
      configuration.manual_fallback_until,
      capacity.congestion_status
    from public.station_lpg_inventory_state state
    join public.lpg_station_branches station on station.id = state.station_branch_id
    join public.station_inventory_configurations configuration
      on configuration.station_branch_id = state.station_branch_id
    left join public.station_inventory_operational_capacity capacity
      on capacity.station_branch_id = state.station_branch_id
    where state.rollout_status in ('active', 'legacy_shadow')
    order by state.updated_at, state.station_branch_id
    limit target_limit
  loop
    perform set_config('skima.inventory_runtime', 'true', true);
    perform public.recalculate_lpg_station_inventory(state_record.station_branch_id, 'scheduled_maintenance');
    perform set_config('skima.inventory_runtime', 'false', true);
    recalculated_stations := recalculated_stations + 1;

    select state.*, configuration.manual_fallback_until, capacity.congestion_status
    into state_record
    from public.station_lpg_inventory_state state
    join public.station_inventory_configurations configuration
      on configuration.station_branch_id = state.station_branch_id
    left join public.station_inventory_operational_capacity capacity
      on capacity.station_branch_id = state.station_branch_id
    where state.station_branch_id = state_record.station_branch_id;

    stock_alert_active := state_record.inventory_status in ('LOW', 'CRITICAL', 'OUT_OF_STOCK');
    notifications_queued := notifications_queued + public.refresh_lpg_inventory_alert(
      state_record.station_branch_id,
      'inventory.stock_status',
      state_record.inventory_status,
      case state_record.inventory_status
        when 'OUT_OF_STOCK' then 'critical'
        when 'CRITICAL' then 'critical'
        else 'warning'
      end,
      case state_record.inventory_status
        when 'OUT_OF_STOCK' then 'Station LPG is out of stock'
        when 'CRITICAL' then 'Station LPG stock is critical'
        else 'Station LPG stock is low'
      end,
      case state_record.inventory_status
        when 'OUT_OF_STOCK' then 'Dispatch is paused until stock is confirmed and restored.'
        when 'CRITICAL' then 'Available LPG is below the configured critical threshold.'
        else 'Available LPG is below the configured low-stock threshold.'
      end,
      not stock_alert_active,
      jsonb_build_object(
        'inventoryStatus', state_record.inventory_status,
        'physicalStockKg', state_record.physical_stock_kg,
        'dispatchableKg', state_record.dispatchable_kg
      )
    );

    freshness_alert_active := state_record.freshness_status in ('LOW', 'STALE', 'UNKNOWN');
    notifications_queued := notifications_queued + public.refresh_lpg_inventory_alert(
      state_record.station_branch_id,
      'inventory.reading_freshness',
      state_record.freshness_status,
      case when state_record.freshness_status in ('STALE', 'UNKNOWN') then 'high' else 'warning' end,
      'Inventory reading needs attention',
      'Confirm stock or restore the configured inventory source before dispatch can rely on this reading.',
      not freshness_alert_active,
      jsonb_build_object('freshnessStatus', state_record.freshness_status)
    );

    source_alert_active := state_record.source_health in ('degraded', 'offline', 'unknown');
    notifications_queued := notifications_queued + public.refresh_lpg_inventory_alert(
      state_record.station_branch_id,
      'inventory.source_health',
      state_record.source_health,
      case when state_record.source_health = 'offline' then 'high' else 'warning' end,
      'Inventory source needs attention',
      'The connected stock source is not reporting normally. Review its connection or use a controlled fallback.',
      not source_alert_active,
      jsonb_build_object('sourceHealth', state_record.source_health)
    );

    reconciliation_alert_active := state_record.reconciliation_status <> 'current';
    notifications_queued := notifications_queued + public.refresh_lpg_inventory_alert(
      state_record.station_branch_id,
      'inventory.reconciliation',
      state_record.reconciliation_status,
      case when state_record.reconciliation_status = 'blocked' then 'critical' else 'high' end,
      'Inventory reconciliation required',
      'Review the conflicting inventory evidence before restoring normal dispatch.',
      not reconciliation_alert_active,
      jsonb_build_object('reconciliationStatus', state_record.reconciliation_status)
    );

    fallback_alert_active := state_record.manual_fallback_until is not null;
    notifications_queued := notifications_queued + public.refresh_lpg_inventory_alert(
      state_record.station_branch_id,
      'inventory.manual_fallback',
      coalesce(state_record.manual_fallback_until::text, 'inactive'),
      'warning',
      'Manual inventory fallback is active',
      'Automatic stock authority is temporarily suspended. Reconnect and reconcile the provider before fallback ends.',
      not fallback_alert_active,
      jsonb_build_object('manualFallbackUntil', state_record.manual_fallback_until)
    );

    capacity_alert_active := state_record.congestion_status in ('congested', 'paused');
    notifications_queued := notifications_queued + public.refresh_lpg_inventory_alert(
      state_record.station_branch_id,
      'inventory.operational_capacity',
      coalesce(state_record.congestion_status, 'normal'),
      'warning',
      'Station refill capacity is paused',
      'Review station processing capacity before accepting more refill work.',
      not capacity_alert_active,
      jsonb_build_object('congestionStatus', state_record.congestion_status)
    );
  end loop;

  return jsonb_build_object(
    'expiredReservations', expired_reservations,
    'expiredFallbacks', expired_fallbacks,
    'providerJobsQueued', provider_jobs,
    'stationsRecalculated', recalculated_stations,
    'notificationsQueued', notifications_queued
  );
end;
$$;

-- Generic queue claims are atomic and reusable by every runtime module. A
-- unique worker lease prevents a slow worker from completing a job after a
-- newer worker has reclaimed its expired lock.
create or replace function public.claim_background_jobs(
  target_limit integer default 25,
  target_worker_id text default 'runtime-worker',
  target_lock_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed_jobs jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role is required to claim background jobs';
  end if;
  if target_limit is null or target_limit < 1 or target_limit > 100 then
    raise exception 'target_limit must be between 1 and 100';
  end if;
  if nullif(btrim(target_worker_id), '') is null or char_length(target_worker_id) > 180 then
    raise exception 'target_worker_id is invalid';
  end if;
  if target_lock_seconds is null or target_lock_seconds < 30 or target_lock_seconds > 900 then
    raise exception 'target_lock_seconds must be between 30 and 900';
  end if;

  with candidates as (
    select job.id
    from public.background_jobs job
    join public.job_queues queue on queue.id = job.queue_id
    where queue.status = 'active'
      and job.attempts < job.max_attempts
      and (
        (job.status = 'queued' and job.run_at <= timezone('utc', now()))
        or (
          job.status = 'running'
          and job.locked_until is not null
          and job.locked_until <= timezone('utc', now())
        )
      )
    order by job.run_at, job.created_at, job.id
    for update of job skip locked
    limit target_limit
  ), claimed as (
    update public.background_jobs job
    set status = 'running',
        attempts = job.attempts + 1,
        locked_by = btrim(target_worker_id),
        locked_until = timezone('utc', now()) + make_interval(secs => target_lock_seconds),
        updated_at = timezone('utc', now())
    from candidates
    where job.id = candidates.id
    returning job.*
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', claimed.id,
      'jobTypeKey', claimed.job_type_key,
      'payload', claimed.payload,
      'attempts', claimed.attempts,
      'maxAttempts', claimed.max_attempts,
      'source', claimed.source,
      'idempotencyKey', claimed.idempotency_key,
      'runAt', claimed.run_at,
      'lockedUntil', claimed.locked_until
    ) order by claimed.run_at, claimed.created_at, claimed.id
  ), '[]'::jsonb)
  into claimed_jobs
  from claimed;

  return claimed_jobs;
end;
$$;

create or replace function public.finish_background_job(
  target_job_id uuid,
  target_worker_id text,
  target_succeeded boolean,
  target_error_message text default null,
  target_retry_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  job_record record;
  backoff_values jsonb;
  backoff_index integer;
  backoff_seconds integer := 60;
  resolved_status text;
  resolved_retry_at timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role is required to finish background jobs';
  end if;
  if target_job_id is null or nullif(btrim(target_worker_id), '') is null then
    raise exception 'job and worker identifiers are required';
  end if;
  if target_succeeded is null then
    raise exception 'target_succeeded is required';
  end if;

  select job.*, queue.retry_policy
  into job_record
  from public.background_jobs job
  join public.job_queues queue on queue.id = job.queue_id
  where job.id = target_job_id
    and job.status = 'running'
    and job.locked_by = btrim(target_worker_id)
  for update of job;
  if not found then
    raise exception 'background job lease is no longer owned by this worker';
  end if;

  if target_succeeded then
    resolved_status := 'completed';
    resolved_retry_at := job_record.run_at;
  elsif job_record.attempts >= job_record.max_attempts then
    resolved_status := 'failed';
    resolved_retry_at := job_record.run_at;
  else
    resolved_status := 'queued';
    backoff_values := job_record.retry_policy -> 'backoff_seconds';
    if jsonb_typeof(backoff_values) = 'array' and jsonb_array_length(backoff_values) > 0 then
      backoff_index := least(job_record.attempts - 1, jsonb_array_length(backoff_values) - 1);
      backoff_seconds := greatest(coalesce((backoff_values ->> backoff_index)::integer, 60), 1);
    end if;
    resolved_retry_at := coalesce(
      target_retry_at,
      timezone('utc', now()) + make_interval(secs => backoff_seconds)
    );
  end if;

  update public.background_jobs
  set status = resolved_status,
      run_at = resolved_retry_at,
      locked_by = null,
      locked_until = null,
      last_error = case
        when target_succeeded then null
        else left(coalesce(target_error_message, 'background job failed'), 2000)
      end,
      updated_at = timezone('utc', now())
  where id = target_job_id;

  return jsonb_build_object(
    'jobId', target_job_id,
    'status', resolved_status,
    'attempts', job_record.attempts,
    'maxAttempts', job_record.max_attempts,
    'retryAt', case when resolved_status = 'queued' then resolved_retry_at else null end
  );
end;
$$;

create or replace function public.configure_inventory_automation_policy(
  target_provider_sync_interval_minutes integer,
  target_provider_health_check_interval_minutes integer,
  target_provider_degraded_interval_minutes integer,
  target_provider_offline_interval_minutes integer,
  target_provider_retry_maximum_attempts integer,
  target_provider_retry_base_seconds integer,
  target_telemetry_warning_interval_minutes integer,
  target_telemetry_stale_interval_minutes integer,
  target_alert_reminder_interval_minutes integer,
  target_maximum_availability_pause_hours integer,
  target_source_disagreement_warning_percentage numeric,
  target_source_disagreement_critical_percentage numeric,
  target_actual_fill_tolerance_kg numeric,
  target_maximum_actual_fill_overage_kg numeric,
  target_unexpected_stockout_reliability_penalty numeric,
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
  new_value jsonb;
begin
  if auth.role() <> 'service_role'
     and not public.is_platform_super_admin()
     and not public.has_permission('platform.inventory.manage', null) then
    raise exception 'platform inventory policy permission is required';
  end if;
  if target_provider_sync_interval_minutes < 1
     or target_provider_health_check_interval_minutes < 1
     or target_provider_degraded_interval_minutes <= target_provider_health_check_interval_minutes
     or target_provider_offline_interval_minutes <= target_provider_degraded_interval_minutes then
    raise exception 'provider health intervals must increase from sync through offline';
  end if;
  if target_provider_retry_maximum_attempts not between 1 and 10
     or target_provider_retry_base_seconds not between 5 and 3600 then
    raise exception 'provider retry settings are outside the supported limits';
  end if;
  if target_telemetry_warning_interval_minutes < 1
     or target_telemetry_stale_interval_minutes <= target_telemetry_warning_interval_minutes
     or target_alert_reminder_interval_minutes < 5
     or target_maximum_availability_pause_hours not between 1 and 720 then
    raise exception 'telemetry and alert intervals are invalid';
  end if;
  if target_source_disagreement_warning_percentage <= 0
     or target_source_disagreement_critical_percentage <= target_source_disagreement_warning_percentage
     or target_source_disagreement_critical_percentage > 100 then
    raise exception 'source disagreement thresholds are invalid';
  end if;
  if target_actual_fill_tolerance_kg < 0
     or target_maximum_actual_fill_overage_kg < target_actual_fill_tolerance_kg
     or target_unexpected_stockout_reliability_penalty < 0
     or target_unexpected_stockout_reliability_penalty > 100 then
    raise exception 'fill tolerance or reliability penalty is invalid';
  end if;
  if target_change_reason is null or char_length(btrim(target_change_reason)) < 5 then
    raise exception 'explain why the inventory automation policy is changing';
  end if;
  if nullif(btrim(target_idempotency_key), '') is null then
    raise exception 'target_idempotency_key is required';
  end if;

  select entry.id into existing_entry_id
  from public.configuration_entries entry
  where entry.namespace = 'module.inventory'
    and entry.key = 'lpg.runtime-policy'
    and entry.value ->> 'automationChangeIdempotencyKey' = target_idempotency_key
  order by entry.version desc
  limit 1;
  if found then return existing_entry_id; end if;

  select entry.* into current_entry
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

  new_value := current_entry.value || jsonb_build_object(
    'providerSyncIntervalMinutes', target_provider_sync_interval_minutes,
    'providerHealthCheckIntervalMinutes', target_provider_health_check_interval_minutes,
    'providerDegradedIntervalMinutes', target_provider_degraded_interval_minutes,
    'providerOfflineIntervalMinutes', target_provider_offline_interval_minutes,
    'providerRetryMaximumAttempts', target_provider_retry_maximum_attempts,
    'providerRetryBaseSeconds', target_provider_retry_base_seconds,
    'telemetryWarningIntervalMinutes', target_telemetry_warning_interval_minutes,
    'telemetryStaleIntervalMinutes', target_telemetry_stale_interval_minutes,
    'alertReminderIntervalMinutes', target_alert_reminder_interval_minutes,
    'maximumAvailabilityPauseHours', target_maximum_availability_pause_hours,
    'sourceDisagreementWarningPercentage', target_source_disagreement_warning_percentage,
    'sourceDisagreementCriticalPercentage', target_source_disagreement_critical_percentage,
    'actualFillToleranceKg', target_actual_fill_tolerance_kg,
    'maximumActualFillOverageKg', target_maximum_actual_fill_overage_kg,
    'unexpectedStockoutReliabilityPenalty', target_unexpected_stockout_reliability_penalty,
    'automationChangeReason', btrim(target_change_reason),
    'automationChangeIdempotencyKey', target_idempotency_key,
    'automationChangedBy', auth.uid(),
    'automationChangedAt', timezone('utc', now())
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
    false, 'active', current_entry.version + 1, timezone('utc', now()), auth.uid(), auth.uid()
  )
  returning id into new_entry_id;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id,
    before_state, after_state, metadata
  )
  values (
    auth.uid(), 'inventory.automation_policy.activated', 'configuration_entry', new_entry_id,
    to_jsonb(current_entry),
    (select to_jsonb(entry) from public.configuration_entries entry where entry.id = new_entry_id),
    jsonb_build_object('reason', btrim(target_change_reason), 'previousVersionId', current_entry.id)
  );

  return new_entry_id;
end;
$$;

alter function public.read_lpg_station_inventory(uuid, integer)
rename to read_lpg_station_inventory_base;

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
  base_payload jsonb;
  station_id uuid;
  state_record public.station_lpg_inventory_state%rowtype;
  capacity_record public.station_inventory_operational_capacity%rowtype;
  can_manage_sources boolean;
  can_manage_providers boolean;
  can_manage_availability boolean;
  can_manage_capacity boolean;
  can_report_issue boolean;
  can_read_telemetry boolean;
begin
  base_payload := public.read_lpg_station_inventory_base(
    target_station_branch_id,
    target_limit
  );
  station_id := nullif(base_payload #>> '{station,stationBranchId}', '')::uuid;
  if station_id is null then
    raise exception 'station inventory could not be resolved';
  end if;

  select state.* into state_record
  from public.station_lpg_inventory_state state
  where state.station_branch_id = station_id;
  select capacity.* into capacity_record
  from public.station_inventory_operational_capacity capacity
  where capacity.station_branch_id = station_id;

  can_manage_sources := public.can_manage_lpg_station_inventory(
    station_id,
    'station.inventory.sources.manage'
  );
  can_manage_providers := public.can_manage_lpg_station_inventory(
    station_id,
    'station.inventory.providers.manage'
  );
  can_manage_availability := public.can_manage_lpg_station_inventory(
    station_id,
    'station.inventory.availability.manage'
  );
  can_manage_capacity := public.can_manage_lpg_station_inventory(
    station_id,
    'station.inventory.operational_capacity.manage'
  );
  can_report_issue := public.can_manage_lpg_station_inventory(
    station_id,
    'station.inventory.issue.report'
  );
  can_read_telemetry := auth.role() = 'service_role'
    or public.can_manage_lpg_operations()
    or public.has_permission('platform.inventory.manage', null)
    or public.can_operate_lpg_station_branch(station_id, 'station.inventory.telemetry.read')
    or can_manage_providers;

  return base_payload || jsonb_build_object(
    'inventory', coalesce(base_payload -> 'inventory', '{}'::jsonb) || jsonb_build_object(
      'dispatchBlockedUntil', state_record.dispatch_blocked_until,
      'dispatchBlockReason', state_record.dispatch_block_reason
    ),
    'operationalCapacity', coalesce(base_payload -> 'operationalCapacity', '{}'::jsonb)
      || jsonb_build_object(
        'pauseReason', capacity_record.pause_reason,
        'version', capacity_record.version
      ),
    'actions', coalesce(base_payload -> 'actions', '{}'::jsonb) || jsonb_build_object(
      'canManageAvailability', can_manage_availability,
      'canManageOperationalCapacity', can_manage_capacity,
      'canReportIssue', can_report_issue,
      'canManageTelemetry', can_manage_providers,
      'canReadTelemetry', can_read_telemetry
    ),
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
        'credentialConfigured', coalesce(connection.credential_secret_ref, adapter.secret_ref) is not null,
        'lastConnectedAt', connection.last_connected_at,
        'lastSyncAttemptAt', connection.last_sync_attempt_at,
        'lastSuccessfulSyncAt', connection.last_successful_sync_at,
        'nextSyncAt', connection.next_sync_at,
        'syncLatencyMs', connection.sync_latency_ms,
        'syncFailureCount', connection.sync_failure_count,
        'lastErrorCode', connection.last_error_code,
        'lastFailureAt', connection.last_failure_at,
        'lastHealthCheckAt', connection.last_health_check_at
      ) order by connection.created_at)
      from public.station_inventory_provider_connections connection
      join public.provider_adapters adapter on adapter.id = connection.provider_adapter_id
      where connection.station_branch_id = station_id
    ), '[]'::jsonb) else '[]'::jsonb end,
    'devices', case when can_read_telemetry then coalesce((
      select jsonb_agg(jsonb_build_object(
        'publicReference', device.public_reference,
        'tankPublicReference', tank.public_reference,
        'connectionPublicReference', connection.public_reference,
        'displayName', device.display_name,
        'measurementKind', device.measurement_kind,
        'status', device.status,
        'healthStatus', device.health_status,
        'lastReadingAt', device.last_reading_at,
        'batteryPercentage', device.battery_percentage,
        'signalQuality', device.signal_quality,
        'temperatureC', device.temperature_c,
        'pressureKpa', device.pressure_kpa,
        'lastHealthCheckAt', device.last_health_check_at,
        'normalizationVersion', device.normalization_version
      ) order by device.display_name, device.id)
      from public.station_inventory_telemetry_devices device
      join public.station_lpg_tanks tank on tank.id = device.tank_id
      left join public.station_inventory_provider_connections connection
        on connection.id = device.provider_connection_id
      where device.station_branch_id = station_id
        and device.status <> 'retired'
    ), '[]'::jsonb) else '[]'::jsonb end,
    'alerts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', alert.alert_key,
        'severity', alert.severity,
        'firstObservedAt', alert.first_observed_at,
        'lastObservedAt', alert.last_observed_at,
        'lastNotifiedAt', alert.last_notified_at
      ) order by
        case alert.severity when 'critical' then 0 when 'high' then 1 when 'warning' then 2 else 3 end,
        alert.first_observed_at)
      from public.station_inventory_alert_states alert
      where alert.station_branch_id = station_id
        and alert.resolved_at is null
    ), '[]'::jsonb),
    'limits', jsonb_build_object(
      'manualFallbackMaximumHours', (public.inventory_runtime_policy() ->> 'manualFallbackMaximumHours')::numeric,
      'maximumAvailabilityPauseHours', (public.inventory_runtime_policy() ->> 'maximumAvailabilityPauseHours')::integer
    )
  );
end;
$$;

alter function public.read_lpg_admin_inventory_operations(uuid, integer)
rename to read_lpg_admin_inventory_operations_base;

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
  base_payload jsonb;
  runtime_policy jsonb;
  enriched_stations jsonb;
begin
  if auth.role() <> 'service_role'
     and not public.can_manage_lpg_operations()
     and not public.has_permission('platform.inventory.manage', null)
     and not public.has_permission('platform.inventory.override', null) then
    raise exception 'platform inventory operations permission is required';
  end if;

  base_payload := public.read_lpg_admin_inventory_operations_base(
    target_station_branch_id,
    target_limit
  );
  runtime_policy := public.inventory_runtime_policy();

  select coalesce(jsonb_agg(
    station_payload || jsonb_build_object(
      'dispatchBlockedUntil', state.dispatch_blocked_until,
      'dispatchBlockReason', state.dispatch_block_reason,
      'configurationVersion', configuration.version,
      'inventoryVersion', state.version,
      'operationalCapacityVersion', capacity.version,
      'manualFallbackUntil', configuration.manual_fallback_until,
      'configurationStatus', configuration.status,
      'congestionStatus', capacity.congestion_status
    ) order by station_payload ->> 'stationName'
  ), '[]'::jsonb)
  into enriched_stations
  from jsonb_array_elements(coalesce(base_payload -> 'stations', '[]'::jsonb)) station_payload
  join public.station_lpg_inventory_state state
    on state.station_branch_id = (station_payload ->> 'stationBranchId')::uuid
  join public.station_inventory_configurations configuration
    on configuration.station_branch_id = state.station_branch_id
  join public.station_inventory_operational_capacity capacity
    on capacity.station_branch_id = state.station_branch_id;

  return base_payload || jsonb_build_object(
    'stations', enriched_stations,
    'selectedStation', case when target_station_branch_id is null then null
      else public.read_lpg_station_inventory(target_station_branch_id, target_limit)
    end,
    'policy', coalesce(base_payload -> 'policy', '{}'::jsonb) || jsonb_build_object(
      'providerSyncIntervalMinutes', (runtime_policy ->> 'providerSyncIntervalMinutes')::integer,
      'providerHealthCheckIntervalMinutes', (runtime_policy ->> 'providerHealthCheckIntervalMinutes')::integer,
      'providerDegradedIntervalMinutes', (runtime_policy ->> 'providerDegradedIntervalMinutes')::integer,
      'providerOfflineIntervalMinutes', (runtime_policy ->> 'providerOfflineIntervalMinutes')::integer,
      'providerRetryMaximumAttempts', (runtime_policy ->> 'providerRetryMaximumAttempts')::integer,
      'providerRetryBaseSeconds', (runtime_policy ->> 'providerRetryBaseSeconds')::integer,
      'telemetryWarningIntervalMinutes', (runtime_policy ->> 'telemetryWarningIntervalMinutes')::integer,
      'telemetryStaleIntervalMinutes', (runtime_policy ->> 'telemetryStaleIntervalMinutes')::integer,
      'alertReminderIntervalMinutes', (runtime_policy ->> 'alertReminderIntervalMinutes')::integer,
      'maximumAvailabilityPauseHours', (runtime_policy ->> 'maximumAvailabilityPauseHours')::integer,
      'sourceDisagreementWarningPercentage', (runtime_policy ->> 'sourceDisagreementWarningPercentage')::numeric,
      'sourceDisagreementCriticalPercentage', (runtime_policy ->> 'sourceDisagreementCriticalPercentage')::numeric,
      'actualFillToleranceKg', (runtime_policy ->> 'actualFillToleranceKg')::numeric,
      'maximumActualFillOverageKg', (runtime_policy ->> 'maximumActualFillOverageKg')::numeric,
      'unexpectedStockoutReliabilityPenalty', (runtime_policy ->> 'unexpectedStockoutReliabilityPenalty')::numeric
    ),
    'activeAlerts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'stationBranchId', alert.station_branch_id,
        'stationName', station.display_name,
        'key', alert.alert_key,
        'severity', alert.severity,
        'firstObservedAt', alert.first_observed_at,
        'lastObservedAt', alert.last_observed_at,
        'notificationCount', alert.notification_count
      ) order by
        case alert.severity when 'critical' then 0 when 'high' then 1 when 'warning' then 2 else 3 end,
        alert.first_observed_at)
      from public.station_inventory_alert_states alert
      join public.lpg_station_branches station on station.id = alert.station_branch_id
      where alert.resolved_at is null
        and (target_station_branch_id is null or alert.station_branch_id = target_station_branch_id)
    ), '[]'::jsonb)
  );
end;
$$;

alter table public.station_inventory_alert_states enable row level security;
alter table public.station_inventory_provider_webhook_receipts enable row level security;

drop policy if exists station_inventory_alert_states_read
on public.station_inventory_alert_states;
create policy station_inventory_alert_states_read
on public.station_inventory_alert_states
for select to authenticated
using (public.can_read_lpg_station_inventory(station_branch_id));

drop policy if exists station_inventory_alert_states_no_insert
on public.station_inventory_alert_states;
create policy station_inventory_alert_states_no_insert
on public.station_inventory_alert_states
for insert to authenticated
with check (false);

drop policy if exists station_inventory_alert_states_no_update
on public.station_inventory_alert_states;
create policy station_inventory_alert_states_no_update
on public.station_inventory_alert_states
for update to authenticated
using (false)
with check (false);

drop policy if exists station_inventory_alert_states_no_delete
on public.station_inventory_alert_states;
create policy station_inventory_alert_states_no_delete
on public.station_inventory_alert_states
for delete to authenticated
using (false);

alter table public.station_lpg_inventory_state replica identity full;
alter table public.station_inventory_provider_connections replica identity full;
alter table public.station_inventory_telemetry_devices replica identity full;
alter table public.station_inventory_reservations replica identity full;
alter table public.station_inventory_reconciliation_cases replica identity full;
alter table public.station_inventory_operational_capacity replica identity full;
alter table public.station_inventory_alert_states replica identity full;

do $$
declare
  target_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach target_table in array array[
      'station_lpg_inventory_state',
      'station_inventory_events',
      'station_inventory_reservations',
      'station_inventory_provider_connections',
      'station_inventory_telemetry_devices',
      'station_inventory_reconciliation_cases',
      'station_inventory_operational_capacity',
      'station_inventory_alert_states'
    ]
    loop
      if not exists (
        select 1
        from pg_publication_tables publication_table
        where publication_table.pubname = 'supabase_realtime'
          and publication_table.schemaname = 'public'
          and publication_table.tablename = target_table
      ) then
        execute format(
          'alter publication supabase_realtime add table public.%I',
          target_table
        );
      end if;
    end loop;
  end if;
end $$;

update public.station_inventory_provider_connections connection
set next_sync_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
where connection.status in ('active', 'degraded')
  and connection.connection_method = 'polling'
  and connection.next_sync_at is null;

insert into public.background_jobs (
  queue_id, job_type_key, status, payload, max_attempts,
  run_at, source, idempotency_key
)
select
  queue.id,
  'platform.inventory.maintenance',
  'queued',
  '{"limit":200,"intervalMinutes":1}'::jsonb,
  5,
  timezone('utc', now()),
  'inventory.maintenance_schedule',
  'inventory-maintenance:initial-v1'
from public.job_queues queue
where queue.key = 'platform.inventory'
  and queue.status = 'active'
on conflict (source, idempotency_key)
where idempotency_key is not null
do nothing;

revoke all on table public.station_inventory_alert_states
from public, anon, authenticated;
revoke all on table public.station_inventory_provider_webhook_receipts
from public, anon, authenticated;
grant select on table public.station_inventory_alert_states to authenticated;
grant all on table public.station_inventory_alert_states to service_role;
grant all on table public.station_inventory_provider_webhook_receipts to service_role;

revoke all on function public.read_lpg_station_inventory_base(uuid, integer)
from public, anon, authenticated;
revoke all on function public.read_lpg_admin_inventory_operations_base(uuid, integer)
from public, anon, authenticated;
revoke all on function public.read_lpg_station_inventory(uuid, integer)
from public, anon;
revoke all on function public.read_lpg_admin_inventory_operations(uuid, integer)
from public, anon;
revoke all on function public.upsert_lpg_inventory_telemetry_device(uuid, text, text, text, text, text, text, jsonb, jsonb, text)
from public, anon;
revoke all on function public.configure_lpg_station_operational_capacity(uuid, integer, integer, text, numeric, text, timestamptz, text, integer, jsonb, text)
from public, anon;
revoke all on function public.set_lpg_station_inventory_availability(uuid, text, text, text, timestamptz, bigint, jsonb, text)
from public, anon;
revoke all on function public.disconnect_lpg_inventory_provider(text, text, text, jsonb, text)
from public, anon;
revoke all on function public.end_lpg_station_inventory_manual_fallback(uuid, text, text, jsonb, text)
from public, anon;
revoke all on function public.report_lpg_inventory_unexpected_stockout(uuid, text, text, text, jsonb, text)
from public, anon;
revoke all on function public.apply_lpg_inventory_admin_override(uuid, text, text, text, timestamptz, bigint, jsonb, text)
from public, anon;
revoke all on function public.configure_inventory_automation_policy(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, numeric, numeric, numeric, numeric, numeric, text, text)
from public, anon;

revoke all on function public.read_lpg_inventory_provider_runtime_context(uuid)
from public, anon, authenticated;
revoke all on function public.read_lpg_inventory_provider_webhook_context(text)
from public, anon, authenticated;
revoke all on function public.record_lpg_inventory_provider_sync_result(uuid, boolean, integer, text, jsonb)
from public, anon, authenticated;
revoke all on function public.begin_lpg_inventory_provider_webhook(uuid, text, timestamptz, text, text, text, jsonb)
from public, anon, authenticated;
revoke all on function public.complete_lpg_inventory_provider_webhook(uuid, text, uuid, text, jsonb)
from public, anon, authenticated;
revoke all on function public.refresh_lpg_inventory_alert(uuid, text, text, text, text, text, boolean, jsonb)
from public, anon, authenticated;
revoke all on function public.run_lpg_inventory_maintenance(integer)
from public, anon, authenticated;
revoke all on function public.claim_background_jobs(integer, text, integer)
from public, anon, authenticated;
revoke all on function public.finish_background_job(uuid, text, boolean, text, timestamptz)
from public, anon, authenticated;

grant execute on function public.read_lpg_station_inventory(uuid, integer)
to authenticated, service_role;
grant execute on function public.read_lpg_admin_inventory_operations(uuid, integer)
to authenticated, service_role;
grant execute on function public.upsert_lpg_inventory_telemetry_device(uuid, text, text, text, text, text, text, jsonb, jsonb, text)
to authenticated, service_role;
grant execute on function public.configure_lpg_station_operational_capacity(uuid, integer, integer, text, numeric, text, timestamptz, text, integer, jsonb, text)
to authenticated, service_role;
grant execute on function public.set_lpg_station_inventory_availability(uuid, text, text, text, timestamptz, bigint, jsonb, text)
to authenticated, service_role;
grant execute on function public.disconnect_lpg_inventory_provider(text, text, text, jsonb, text)
to authenticated, service_role;
grant execute on function public.end_lpg_station_inventory_manual_fallback(uuid, text, text, jsonb, text)
to authenticated, service_role;
grant execute on function public.report_lpg_inventory_unexpected_stockout(uuid, text, text, text, jsonb, text)
to authenticated, service_role;
grant execute on function public.apply_lpg_inventory_admin_override(uuid, text, text, text, timestamptz, bigint, jsonb, text)
to authenticated, service_role;
grant execute on function public.configure_inventory_automation_policy(integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, numeric, numeric, numeric, numeric, numeric, text, text)
to authenticated, service_role;

grant execute on function public.read_lpg_station_inventory_base(uuid, integer) to service_role;
grant execute on function public.read_lpg_admin_inventory_operations_base(uuid, integer) to service_role;
grant execute on function public.read_lpg_inventory_provider_runtime_context(uuid) to service_role;
grant execute on function public.read_lpg_inventory_provider_webhook_context(text) to service_role;
grant execute on function public.record_lpg_inventory_provider_sync_result(uuid, boolean, integer, text, jsonb) to service_role;
grant execute on function public.begin_lpg_inventory_provider_webhook(uuid, text, timestamptz, text, text, text, jsonb) to service_role;
grant execute on function public.complete_lpg_inventory_provider_webhook(uuid, text, uuid, text, jsonb) to service_role;
grant execute on function public.refresh_lpg_inventory_alert(uuid, text, text, text, text, text, boolean, jsonb) to service_role;
grant execute on function public.run_lpg_inventory_maintenance(integer) to service_role;
grant execute on function public.claim_background_jobs(integer, text, integer) to service_role;
grant execute on function public.finish_background_job(uuid, text, boolean, text, timestamptz) to service_role;

notify pgrst, 'reload schema';

commit;
