begin;

create table if not exists public.lpg_safety_incident_type_definitions (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{2,80}$'),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 120),
  priority integer not null default 100 check (priority between 0 and 10000),
  status text not null default 'active' check (status in ('active', 'inactive')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.lpg_safety_severity_definitions (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{2,80}$'),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 120),
  priority integer not null default 100 check (priority between 0 and 10000),
  status text not null default 'active' check (status in ('active', 'inactive')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.lpg_safety_incident_type_definitions (key, display_name, priority, metadata)
values
  ('leak', 'Suspected Leak', 10, '{"emergency":true}'::jsonb),
  ('damage', 'Cylinder Damage', 20, '{}'::jsonb),
  ('unsafe_valve', 'Unsafe Valve', 30, '{}'::jsonb),
  ('expired_cylinder', 'Expired Cylinder', 40, '{}'::jsonb),
  ('accident', 'Transport Accident', 50, '{"emergency":true}'::jsonb),
  ('lost', 'Lost Cylinder', 60, '{}'::jsonb),
  ('stolen', 'Stolen Cylinder', 70, '{}'::jsonb),
  ('other', 'Other Safety Issue', 100, '{}'::jsonb)
on conflict (key) do update
set display_name = excluded.display_name,
    priority = excluded.priority,
    status = 'active',
    metadata = excluded.metadata,
    updated_at = timezone('utc', now());

insert into public.lpg_safety_severity_definitions (key, display_name, priority, metadata)
values
  ('low', 'Low', 10, '{}'::jsonb),
  ('medium', 'Medium', 20, '{}'::jsonb),
  ('high', 'High', 30, '{"operations_alert":true}'::jsonb),
  ('critical', 'Critical', 40, '{"operations_alert":true,"emergency":true}'::jsonb)
on conflict (key) do update
set display_name = excluded.display_name,
    priority = excluded.priority,
    status = 'active',
    metadata = excluded.metadata,
    updated_at = timezone('utc', now());

drop trigger if exists set_lpg_safety_incident_type_definitions_updated_at on public.lpg_safety_incident_type_definitions;
create trigger set_lpg_safety_incident_type_definitions_updated_at
before update on public.lpg_safety_incident_type_definitions
for each row execute function public.set_updated_at();

drop trigger if exists set_lpg_safety_severity_definitions_updated_at on public.lpg_safety_severity_definitions;
create trigger set_lpg_safety_severity_definitions_updated_at
before update on public.lpg_safety_severity_definitions
for each row execute function public.set_updated_at();

alter table public.lpg_safety_incident_type_definitions enable row level security;
alter table public.lpg_safety_severity_definitions enable row level security;

revoke all on table public.lpg_safety_incident_type_definitions from public, anon, authenticated;
revoke all on table public.lpg_safety_severity_definitions from public, anon, authenticated;

alter table public.lpg_safety_incidents
drop constraint if exists lpg_safety_incidents_incident_type_check;

alter table public.lpg_safety_incidents
drop constraint if exists lpg_safety_incidents_severity_check;

alter table public.lpg_safety_incidents
drop constraint if exists lpg_safety_incidents_incident_type_fkey;

alter table public.lpg_safety_incidents
add constraint lpg_safety_incidents_incident_type_fkey
foreign key (incident_type) references public.lpg_safety_incident_type_definitions(key) on update cascade;

alter table public.lpg_safety_incidents
drop constraint if exists lpg_safety_incidents_severity_fkey;

alter table public.lpg_safety_incidents
add constraint lpg_safety_incidents_severity_fkey
foreign key (severity) references public.lpg_safety_severity_definitions(key) on update cascade;

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

  if not exists (
    select 1 from public.lpg_safety_incident_type_definitions definition
    where definition.key = target_incident_type and definition.status = 'active'
  ) then
    raise exception 'target_incident_type is not configured';
  end if;

  if not exists (
    select 1 from public.lpg_safety_severity_definitions definition
    where definition.key = target_severity and definition.status = 'active'
  ) then
    raise exception 'target_severity is not configured';
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
      select 1 from public.lpg_cylinders cylinder
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
    select existing.id into incident_id
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
        'incident_type', target_incident_type,
        'severity', target_severity,
        'description', target_description
      ),
      '{}'::jsonb
    );
  end if;

  return incident_id;
end;
$$;

create or replace function public.read_lpg_runtime_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  return jsonb_build_object(
    'cylinderTypeProfiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', profile.id,
        'key', profile.key,
        'displayName', profile.display_name,
        'sizeKg', profile.size_kg,
        'maxCapacityKg', profile.max_capacity_kg,
        'refillToleranceKg', profile.refill_tolerance_kg,
        'status', profile.status,
        'metadata', profile.metadata
      ) order by profile.size_kg asc)
      from public.lpg_cylinder_type_profiles profile where profile.status = 'active'
    ), '[]'::jsonb),
    'policies', coalesce((
      select jsonb_object_agg(policy.key, jsonb_build_object(
        'kind', policy.policy_kind,
        'displayName', policy.display_name,
        'policy', policy.policy,
        'metadata', policy.metadata
      )) from public.lpg_operation_policies policy where policy.status = 'active'
    ), '{}'::jsonb),
    'stationRolePresets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', preset.key,
        'displayName', preset.display_name,
        'roleKey', preset.role_key,
        'membershipType', preset.membership_type,
        'permissionKeys', preset.permission_keys,
        'metadata', preset.metadata
      ) order by preset.key)
      from public.lpg_station_role_presets preset where preset.status = 'active'
    ), '[]'::jsonb),
    'pricing', coalesce((
      select jsonb_agg(jsonb_build_object(
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
      ) order by pricing.station_branch_id nulls last, pricing.effective_from desc)
      from public.lpg_refill_pricing pricing
      where pricing.status = 'active'
        and pricing.effective_from <= timezone('utc', now())
        and (pricing.effective_until is null or pricing.effective_until > timezone('utc', now()))
    ), '[]'::jsonb),
    'safetyIncidentTypes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', definition.key,
        'displayName', definition.display_name,
        'priority', definition.priority,
        'metadata', definition.metadata
      ) order by definition.priority, definition.key)
      from public.lpg_safety_incident_type_definitions definition where definition.status = 'active'
    ), '[]'::jsonb),
    'safetySeverities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', definition.key,
        'displayName', definition.display_name,
        'priority', definition.priority,
        'metadata', definition.metadata
      ) order by definition.priority, definition.key)
      from public.lpg_safety_severity_definitions definition where definition.status = 'active'
    ), '[]'::jsonb)
  );
end;
$$;

grant select on public.lpg_safety_incident_type_definitions, public.lpg_safety_severity_definitions to service_role;

commit;
