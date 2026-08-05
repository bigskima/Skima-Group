create table if not exists public.lpg_station_branch_events (
  id uuid primary key default gen_random_uuid(),
  station_branch_id uuid not null references public.lpg_station_branches(id) on delete cascade,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  source text not null check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create index if not exists lpg_station_branch_events_branch_created_idx
on public.lpg_station_branch_events (station_branch_id, created_at desc);

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
    'lpg.station_staff.phase_one',
    'LPG Station Staff Policy',
    'config',
    '{"invitation_ttl_hours":168}'::jsonb,
    '{"phase":"one"}'::jsonb,
    'lpg.config_seed',
    'policy-station-staff-phase-one-v1'
  ),
  (
    'lpg.station_activation.phase_one',
    'LPG Station Activation Policy',
    'config',
    '{"service_radius_meters":8000}'::jsonb,
    '{"phase":"one"}'::jsonb,
    'lpg.config_seed',
    'policy-station-activation-phase-one-v1'
  )
on conflict (key) do update
set display_name = excluded.display_name,
    policy_kind = excluded.policy_kind,
    policy = excluded.policy,
    status = 'active',
    metadata = public.lpg_operation_policies.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

update public.lpg_operation_policies
set policy = policy || jsonb_build_object(
      'sandbox_route_speed_kph', 30,
      'sandbox_origin_latitude', 6.5244,
      'sandbox_origin_longitude', 3.3792
    ),
    updated_at = timezone('utc', now())
where key = 'lpg.maps.phase_one';

create or replace function public.can_read_lpg_station_branch(
  target_station_branch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or public.can_manage_lpg_operations()
    or public.user_can_operate_lpg_station_branch(auth.uid(), target_station_branch_id, 'lpg.stations.read')
    or public.user_can_operate_lpg_station_branch(auth.uid(), target_station_branch_id, 'lpg.orders.read')
    or public.user_can_operate_lpg_station_branch(auth.uid(), target_station_branch_id, 'lpg.stations.scan')
    or public.user_can_operate_lpg_station_branch(auth.uid(), target_station_branch_id, 'lpg.stations.pump')
    or public.user_can_operate_lpg_station_branch(auth.uid(), target_station_branch_id, 'lpg.orders.finance')
    or public.user_can_operate_lpg_station_branch(auth.uid(), target_station_branch_id, 'business.finance.read')
    or public.user_can_operate_lpg_station_branch(auth.uid(), target_station_branch_id, 'business.settlements.read');
$$;

create or replace function public.read_lpg_station_runtime(
  target_station_branch_id uuid default null,
  target_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  station_record record;
  resolved_limit integer;
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  resolved_limit := least(greatest(coalesce(target_limit, 100), 1), 200);

  select station.*
  into station_record
  from public.lpg_station_branches station
  where (target_station_branch_id is null or station.id = target_station_branch_id)
    and public.can_read_lpg_station_branch(station.id)
  order by station.created_at asc
  limit 1;

  if not found then
    raise exception 'branch-scoped LPG station access is required';
  end if;

  return jsonb_build_object(
    'branch', jsonb_build_object(
      'id', station_record.id,
      'organizationId', station_record.organization_id,
      'branchId', station_record.branch_id,
      'displayName', station_record.display_name,
      'formattedAddress', station_record.formatted_address,
      'latitude', station_record.latitude,
      'longitude', station_record.longitude,
      'serviceRadiusMeters', station_record.service_radius_meters,
      'operatingHours', station_record.operating_hours,
      'supportedCylinderSizesKg', station_record.supported_cylinder_sizes_kg,
      'refillCapacityKg', station_record.refill_capacity_kg,
      'currentAvailableKg', station_record.current_available_kg,
      'availabilityStatus', station_record.availability_status,
      'approvalStatus', station_record.approval_status,
      'complianceStatus', station_record.compliance_status,
      'metadata', station_record.metadata,
      'updatedAt', station_record.updated_at
    ),
    'summary', jsonb_build_object(
      'activeJobs', (
        select count(*)
        from public.lpg_refill_orders target_order
        where target_order.station_branch_id = station_record.id
          and target_order.status not in ('completed', 'cancelled', 'refunded', 'failed')
      ),
      'atStationJobs', (
        select count(*)
        from public.lpg_refill_orders target_order
        where target_order.station_branch_id = station_record.id
          and target_order.status in ('station_verified', 'refill_in_progress', 'refill_confirmed', 'station_settled')
      ),
      'completedJobs', (
        select count(*)
        from public.lpg_refill_orders target_order
        where target_order.station_branch_id = station_record.id
          and target_order.status in ('delivered', 'completed')
      ),
      'totalRefilledKg', coalesce((
        select sum(refill.actual_kg)
        from public.lpg_refill_records refill
        where refill.station_branch_id = station_record.id
          and refill.status = 'confirmed'
      ), 0),
      'activeReservedKg', coalesce((
        select sum(reservation.reserved_kg)
        from public.lpg_station_capacity_reservations reservation
        where reservation.station_branch_id = station_record.id
          and reservation.status = 'reserved'
      ), 0)
    ),
    'orders', coalesce((
      select jsonb_agg(order_payload order by (order_payload ->> 'updatedAt') desc)
      from (
        select jsonb_build_object(
          'id', target_order.id,
          'publicReference', target_order.public_reference,
          'status', target_order.status,
          'paymentStatus', target_order.payment_status,
          'assignmentStatus', target_order.assignment_status,
          'requestedKg', target_order.requested_kg,
          'actualKg', target_order.actual_kg,
          'currencyCode', target_order.currency_code,
          'stationAmount', target_order.station_amount,
          'driverProfileId', target_order.driver_profile_id,
          'cylinder', jsonb_build_object(
            'id', cylinder.id,
            'publicReference', cylinder.public_reference,
            'sizeKg', cylinder.size_kg,
            'conditionStatus', cylinder.condition_status,
            'status', cylinder.status,
            'imageAssetIds', cylinder.image_asset_ids
          ),
          'createdAt', target_order.created_at,
          'updatedAt', target_order.updated_at
        ) as order_payload
        from public.lpg_refill_orders target_order
        join public.lpg_cylinders cylinder on cylinder.id = target_order.cylinder_id
        where target_order.station_branch_id = station_record.id
        order by target_order.updated_at desc
        limit resolved_limit
      ) recent_orders
    ), '[]'::jsonb),
    'reservations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', reservation.id,
          'lpgOrderId', reservation.lpg_order_id,
          'requestedKg', reservation.requested_kg,
          'reservedKg', reservation.reserved_kg,
          'consumedKg', reservation.consumed_kg,
          'status', reservation.status,
          'expiresAt', reservation.expires_at,
          'createdAt', reservation.created_at,
          'updatedAt', reservation.updated_at
        ) order by reservation.created_at desc
      )
      from public.lpg_station_capacity_reservations reservation
      where reservation.station_branch_id = station_record.id
    ), '[]'::jsonb),
    'pricing', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', pricing.id,
          'currencyCode', pricing.currency_code,
          'pricePerKg', pricing.price_per_kg,
          'deliveryBaseFee', pricing.delivery_base_fee,
          'platformFeeAmount', pricing.platform_fee_amount,
          'taxRatePercent', pricing.tax_rate_percent,
          'driverCommissionAmount', pricing.driver_commission_amount,
          'minKg', pricing.min_kg,
          'maxKg', pricing.max_kg,
          'status', pricing.status,
          'effectiveFrom', pricing.effective_from,
          'effectiveUntil', pricing.effective_until
        ) order by pricing.effective_from desc
      )
      from public.lpg_refill_pricing pricing
      where pricing.station_branch_id = station_record.id
        and pricing.status = 'active'
        and pricing.effective_from <= timezone('utc', now())
        and (pricing.effective_until is null or pricing.effective_until > timezone('utc', now()))
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', branch_event.id,
          'eventType', branch_event.event_type,
          'payload', branch_event.payload,
          'createdAt', branch_event.created_at
        ) order by branch_event.created_at desc
      )
      from (
        select event_record.*
        from public.lpg_station_branch_events event_record
        where event_record.station_branch_id = station_record.id
        order by event_record.created_at desc
        limit resolved_limit
      ) branch_event
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.update_lpg_station_settings(
  target_station_branch_id uuid,
  target_idempotency_key text,
  target_availability_status text default null,
  target_operating_hours jsonb default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.station_settings'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  station_id uuid;
begin
  if not public.can_operate_lpg_station_branch(target_station_branch_id, 'lpg.stations.manage') then
    raise exception 'branch-scoped LPG station management permission is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_availability_status is not null
    and target_availability_status not in ('available', 'unavailable', 'paused', 'closed') then
    raise exception 'target_availability_status is not supported';
  end if;

  if target_operating_hours is not null and jsonb_typeof(target_operating_hours) <> 'object' then
    raise exception 'target_operating_hours must be a JSON object';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select branch_event.station_branch_id
  into station_id
  from public.lpg_station_branch_events branch_event
  where branch_event.source = target_source
    and branch_event.idempotency_key = target_idempotency_key;

  if found then
    return station_id;
  end if;

  update public.lpg_station_branches station
  set availability_status = coalesce(target_availability_status, station.availability_status),
      operating_hours = coalesce(target_operating_hours, station.operating_hours),
      metadata = station.metadata || target_metadata,
      updated_at = timezone('utc', now())
  where station.id = target_station_branch_id
  returning station.id into station_id;

  if station_id is null then
    raise exception 'target_station_branch_id must reference an LPG station branch';
  end if;

  insert into public.lpg_station_branch_events (
    station_branch_id,
    event_type,
    payload,
    source,
    idempotency_key
  )
  values (
    station_id,
    'lpg.station.settings.updated',
    jsonb_build_object(
      'availabilityStatus', target_availability_status,
      'operatingHours', target_operating_hours,
      'metadata', target_metadata
    ),
    target_source,
    target_idempotency_key
  );

  return station_id;
end;
$$;

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
set search_path = public
as $$
declare
  station_record record;
  branch_event_id uuid;
  resulting_available_kg numeric;
begin
  if not public.can_operate_lpg_station_branch(target_station_branch_id, 'lpg.stations.manage') then
    raise exception 'branch-scoped LPG station management permission is required';
  end if;

  if target_adjustment_kg is null or target_adjustment_kg = 0 then
    raise exception 'target_adjustment_kg must be non-zero';
  end if;

  if target_reason_key is null or target_reason_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_reason_key must be a valid key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select branch_event.id
  into branch_event_id
  from public.lpg_station_branch_events branch_event
  where branch_event.source = target_source
    and branch_event.idempotency_key = target_idempotency_key;

  if found then
    return branch_event_id;
  end if;

  select station.*
  into station_record
  from public.lpg_station_branches station
  where station.id = target_station_branch_id
  for update;

  if not found then
    raise exception 'target_station_branch_id must reference an LPG station branch';
  end if;

  resulting_available_kg := station_record.current_available_kg + target_adjustment_kg;
  if resulting_available_kg < 0 or resulting_available_kg > station_record.refill_capacity_kg then
    raise exception 'capacity adjustment must keep available kilograms between zero and configured refill capacity';
  end if;

  update public.lpg_station_branches
  set current_available_kg = resulting_available_kg,
      availability_status = case
        when resulting_available_kg = 0 then 'capacity_reached'
        when availability_status = 'capacity_reached' then 'available'
        else availability_status
      end,
      updated_at = timezone('utc', now())
  where id = station_record.id;

  insert into public.lpg_station_branch_events (
    station_branch_id,
    event_type,
    payload,
    source,
    idempotency_key
  )
  values (
    station_record.id,
    'lpg.station.capacity.adjusted',
    jsonb_build_object(
      'adjustmentKg', target_adjustment_kg,
      'previousAvailableKg', station_record.current_available_kg,
      'resultingAvailableKg', resulting_available_kg,
      'reasonKey', target_reason_key,
      'metadata', target_metadata
    ),
    target_source,
    target_idempotency_key
  )
  returning id into branch_event_id;

  return branch_event_id;
end;
$$;

create or replace function public.enforce_lpg_station_pricing_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  baseline record;
begin
  if auth.role() = 'service_role'
    or public.has_permission('lpg.config.manage', null)
    or public.can_manage_lpg_operations() then
    return new;
  end if;

  if new.station_branch_id is null
    or not public.can_operate_lpg_station_branch(new.station_branch_id, 'lpg.stations.manage') then
    raise exception 'LPG pricing management permission is required';
  end if;

  select pricing.*
  into baseline
  from public.lpg_refill_pricing pricing
  where pricing.status = 'active'
    and (pricing.station_branch_id = new.station_branch_id or pricing.station_branch_id is null)
    and pricing.effective_from <= timezone('utc', now())
    and (pricing.effective_until is null or pricing.effective_until > timezone('utc', now()))
    and (tg_op = 'INSERT' or pricing.id <> new.id)
  order by (pricing.station_branch_id = new.station_branch_id) desc, pricing.effective_from desc
  limit 1;

  if not found then
    raise exception 'active platform pricing configuration is required before a station price can be changed';
  end if;

  if new.currency_code is distinct from baseline.currency_code
    or new.delivery_base_fee is distinct from baseline.delivery_base_fee
    or new.platform_fee_amount is distinct from baseline.platform_fee_amount
    or new.tax_rate_percent is distinct from baseline.tax_rate_percent
    or new.driver_commission_amount is distinct from baseline.driver_commission_amount
    or new.min_kg is distinct from baseline.min_kg
    or new.max_kg is distinct from baseline.max_kg
    or new.effective_until is not null
    or new.status <> 'active' then
    raise exception 'station users may change only the configured branch price per kilogram';
  end if;

  return new;
end;
$$;

drop trigger if exists lpg_refill_pricing_enforce_station_scope on public.lpg_refill_pricing;
create trigger lpg_refill_pricing_enforce_station_scope
before insert or update on public.lpg_refill_pricing
for each row execute function public.enforce_lpg_station_pricing_scope();

create or replace function public.configure_lpg_station_price(
  target_station_branch_id uuid,
  target_price_per_kg numeric,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.station_price'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  baseline record;
begin
  if not public.can_operate_lpg_station_branch(target_station_branch_id, 'lpg.stations.manage') then
    raise exception 'branch-scoped LPG station management permission is required';
  end if;

  if target_price_per_kg is null or target_price_per_kg <= 0 then
    raise exception 'target_price_per_kg must be greater than zero';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select pricing.*
  into baseline
  from public.lpg_refill_pricing pricing
  where pricing.status = 'active'
    and (pricing.station_branch_id = target_station_branch_id or pricing.station_branch_id is null)
    and pricing.effective_from <= timezone('utc', now())
    and (pricing.effective_until is null or pricing.effective_until > timezone('utc', now()))
  order by (pricing.station_branch_id = target_station_branch_id) desc, pricing.effective_from desc
  limit 1;

  if not found then
    raise exception 'active platform pricing configuration is required before a station price can be changed';
  end if;

  return public.configure_lpg_refill_pricing(
    target_station_branch_id,
    baseline.currency_code,
    target_price_per_kg,
    baseline.delivery_base_fee,
    baseline.platform_fee_amount,
    baseline.tax_rate_percent,
    baseline.driver_commission_amount,
    baseline.min_kg,
    baseline.max_kg,
    target_idempotency_key,
    timezone('utc', now()),
    null,
    target_metadata || jsonb_build_object('managed_field', 'price_per_kg'),
    target_source
  );
end;
$$;

create or replace function public.activate_configured_lpg_station_branch(
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
  target_supported_cylinder_sizes_kg numeric[] default array[]::numeric[],
  target_refill_capacity_kg numeric default null,
  target_current_available_kg numeric default null,
  target_operating_hours jsonb default '{}'::jsonb,
  target_geofence jsonb default '{}'::jsonb,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.station_activation_api'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  activation_policy jsonb;
  configured_service_radius_meters integer;
begin
  activation_policy := public.lpg_policy_config('lpg.station_activation.phase_one');
  configured_service_radius_meters := nullif(
    activation_policy ->> 'service_radius_meters',
    ''
  )::integer;

  if configured_service_radius_meters is null or configured_service_radius_meters <= 0 then
    raise exception 'LPG station activation policy must define a positive service_radius_meters';
  end if;

  return public.activate_lpg_station_branch(
    target_application_id => target_application_id,
    target_organization_id => target_organization_id,
    target_branch_id => target_branch_id,
    target_display_name => target_display_name,
    target_formatted_address => target_formatted_address,
    target_latitude => target_latitude,
    target_longitude => target_longitude,
    target_idempotency_key => target_idempotency_key,
    target_owner_user_id => target_owner_user_id,
    target_branch_key => target_branch_key,
    target_service_radius_meters => configured_service_radius_meters,
    target_supported_cylinder_sizes_kg => target_supported_cylinder_sizes_kg,
    target_refill_capacity_kg => target_refill_capacity_kg,
    target_current_available_kg => target_current_available_kg,
    target_operating_hours => target_operating_hours,
    target_geofence => target_geofence,
    target_metadata => target_metadata,
    target_source => target_source
  );
end;
$$;

create or replace function public.enforce_lpg_safe_inspection_before_refill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('refill_in_progress', 'refill_confirmed')
    and new.status is distinct from old.status
    and not exists (
      select 1
      from public.lpg_cylinder_inspections inspection
      where inspection.lpg_order_id = new.id
        and inspection.result = 'safe'
    ) then
    raise exception 'a safe LPG cylinder inspection is required before refill';
  end if;

  return new;
end;
$$;

drop trigger if exists lpg_refill_orders_require_safe_inspection on public.lpg_refill_orders;
create trigger lpg_refill_orders_require_safe_inspection
before update of status on public.lpg_refill_orders
for each row execute function public.enforce_lpg_safe_inspection_before_refill();

alter table public.lpg_station_branch_events enable row level security;

drop policy if exists lpg_station_branch_events_select_scoped on public.lpg_station_branch_events;
drop policy if exists lpg_station_branch_events_no_direct_insert on public.lpg_station_branch_events;
drop policy if exists lpg_station_branch_events_no_direct_update on public.lpg_station_branch_events;
drop policy if exists lpg_station_branch_events_no_direct_delete on public.lpg_station_branch_events;

create policy lpg_station_branch_events_select_scoped
on public.lpg_station_branch_events
for select to authenticated
using (public.can_read_lpg_station_branch(station_branch_id));

create policy lpg_station_branch_events_no_direct_insert
on public.lpg_station_branch_events
for insert to authenticated
with check (false);

create policy lpg_station_branch_events_no_direct_update
on public.lpg_station_branch_events
for update to authenticated
using (false)
with check (false);

create policy lpg_station_branch_events_no_direct_delete
on public.lpg_station_branch_events
for delete to authenticated
using (false);

revoke all on table public.lpg_station_branch_events from public, anon, authenticated;
grant select on table public.lpg_station_branch_events to authenticated, service_role;
grant all on table public.lpg_station_branch_events to service_role;

revoke all on function public.can_read_lpg_station_branch(uuid) from public;
revoke all on function public.read_lpg_station_runtime(uuid, integer) from public;
revoke all on function public.update_lpg_station_settings(uuid, text, text, jsonb, jsonb, text) from public;
revoke all on function public.adjust_lpg_station_capacity(uuid, numeric, text, text, jsonb, text) from public;
revoke all on function public.enforce_lpg_safe_inspection_before_refill() from public;
revoke all on function public.enforce_lpg_station_pricing_scope() from public;
revoke all on function public.configure_lpg_station_price(uuid, numeric, text, jsonb, text) from public;
revoke all on function public.activate_configured_lpg_station_branch(uuid, uuid, uuid, text, text, numeric, numeric, text, uuid, text, numeric[], numeric, numeric, jsonb, jsonb, jsonb, text) from public;
revoke execute on function public.activate_lpg_station_branch(uuid, uuid, uuid, text, text, numeric, numeric, text, uuid, text, integer, numeric[], numeric, numeric, jsonb, jsonb, jsonb, text) from authenticated;

grant execute on function public.can_read_lpg_station_branch(uuid) to authenticated, service_role;
grant execute on function public.read_lpg_station_runtime(uuid, integer) to authenticated, service_role;
grant execute on function public.update_lpg_station_settings(uuid, text, text, jsonb, jsonb, text) to authenticated, service_role;
grant execute on function public.adjust_lpg_station_capacity(uuid, numeric, text, text, jsonb, text) to authenticated, service_role;
grant execute on function public.configure_lpg_station_price(uuid, numeric, text, jsonb, text) to authenticated, service_role;
grant execute on function public.activate_configured_lpg_station_branch(uuid, uuid, uuid, text, text, numeric, numeric, text, uuid, text, numeric[], numeric, numeric, jsonb, jsonb, jsonb, text) to authenticated, service_role;
