begin;

alter table public.driver_profiles
add column if not exists identity_profile jsonb not null default '{}'::jsonb
  check (jsonb_typeof(identity_profile) = 'object');

alter table public.driver_profiles
add column if not exists license_profile jsonb not null default '{}'::jsonb
  check (jsonb_typeof(license_profile) = 'object');

alter table public.driver_profiles
add column if not exists service_profile jsonb not null default '{}'::jsonb
  check (jsonb_typeof(service_profile) = 'object');

alter table public.driver_profiles
add column if not exists approved_at timestamptz;

alter table public.vehicles
add column if not exists ownership_type text not null default 'driver_owned'
  check (ownership_type in (
    'driver_owned',
    'business_owned',
    'leased',
    'rented',
    'third_party_authorized',
    'fleet_assigned',
    'other'
  ));

alter table public.vehicles
add column if not exists manufacturer text;

alter table public.vehicles
add column if not exists model text;

alter table public.vehicles
add column if not exists model_year integer
  check (model_year is null or model_year between 1900 and 2100);

alter table public.vehicles
add column if not exists registration_number text;

alter table public.vehicles
add column if not exists vin text;

alter table public.vehicles
add column if not exists color text;

alter table public.vehicles
add column if not exists max_load_kg numeric(14, 4)
  check (max_load_kg is null or max_load_kg >= 0);

alter table public.vehicles
add column if not exists cargo_volume_m3 numeric(14, 4)
  check (cargo_volume_m3 is null or cargo_volume_m3 >= 0);

alter table public.vehicles
add column if not exists passenger_capacity integer
  check (passenger_capacity is null or passenger_capacity >= 0);

alter table public.vehicles
add column if not exists fuel_type text;

alter table public.vehicles
add column if not exists insurance_expires_at date;

alter table public.vehicles
add column if not exists inspection_expires_at date;

alter table public.vehicles
add column if not exists roadworthiness_expires_at date;

create unique index if not exists vehicles_registration_number_unique
on public.vehicles (lower(registration_number))
where registration_number is not null;

create index if not exists vehicles_operational_lookup_idx
on public.vehicles (status, vehicle_type_id, owner_user_id);

create table if not exists public.driver_vehicle_links (
  id uuid primary key default gen_random_uuid(),
  driver_profile_id uuid not null references public.driver_profiles(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  relationship_type text not null default 'driver_owned'
    check (relationship_type in (
      'driver_owned',
      'business_owned',
      'leased',
      'rented',
      'third_party_authorized',
      'fleet_assigned',
      'other'
    )),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'suspended', 'revoked', 'expired')),
  authorized_by uuid references public.profiles(id) on delete set null default auth.uid(),
  starts_at timestamptz not null default timezone('utc', now()),
  ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (driver_profile_id, vehicle_id, relationship_type),
  check (ends_at is null or ends_at > starts_at)
);

create index if not exists driver_vehicle_links_driver_lookup_idx
on public.driver_vehicle_links (driver_profile_id, status, starts_at, ends_at);

create index if not exists driver_vehicle_links_vehicle_lookup_idx
on public.driver_vehicle_links (vehicle_id, status, starts_at, ends_at);

create or replace function public.hydrate_driver_profile_from_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  source_application_id uuid;
  application_payload jsonb;
begin
  if new.metadata ? 'source_application_id'
    and (new.metadata ->> 'source_application_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    source_application_id := (new.metadata ->> 'source_application_id')::uuid;

    select application_version.payload
    into application_payload
    from public.application_records application_record
    join public.application_type_definitions application_type
      on application_type.id = application_record.application_type_id
    join public.application_versions application_version
      on application_version.application_id = application_record.id
      and application_version.version = application_record.active_version
    where application_record.id = source_application_id
      and application_type.application_category = 'driver';

    if found then
      if new.identity_profile = '{}'::jsonb then
        new.identity_profile := coalesce(
          application_payload -> 'identity',
          application_payload -> 'personal',
          '{}'::jsonb
        );
      end if;

      if new.license_profile = '{}'::jsonb then
        new.license_profile := coalesce(application_payload -> 'licence', application_payload -> 'license', '{}'::jsonb);
      end if;

      if new.service_profile = '{}'::jsonb then
        new.service_profile := jsonb_build_object(
          'capabilityKeys',
          coalesce(application_payload -> 'capabilityKeys', '[]'::jsonb),
          'zones',
          coalesce(application_payload -> 'zones', '[]'::jsonb),
          'workingHours',
          coalesce(application_payload -> 'workingHours', '{}'::jsonb)
        );
      end if;
    end if;
  end if;

  if new.verification_status = 'approved' and new.approved_at is null then
    new.approved_at := timezone('utc', now());
  end if;

  if new.operational_status = 'available' and new.verification_status <> 'approved' then
    raise exception 'driver must be approved before becoming available';
  end if;

  if auth.role() <> 'service_role'
    and auth.uid() = new.user_id
    and not public.has_permission('platform.drivers.manage', new.organization_id)
    and not public.has_permission('platform.drivers.verify', new.organization_id) then
    if tg_op = 'INSERT' and new.verification_status not in ('unverified', 'pending') then
      raise exception 'driver verification cannot be self-assigned';
    end if;

    if tg_op = 'UPDATE' and new.verification_status is distinct from old.verification_status then
      raise exception 'driver verification cannot be self-assigned';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.hydrate_vehicle_from_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  source_application_id uuid;
  vehicle_payload jsonb;
  ownership_value text;
begin
  if new.metadata ? 'source_application_id'
    and (new.metadata ->> 'source_application_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    source_application_id := (new.metadata ->> 'source_application_id')::uuid;

    select coalesce(application_version.payload -> 'vehicle', '{}'::jsonb)
    into vehicle_payload
    from public.application_records application_record
    join public.application_type_definitions application_type
      on application_type.id = application_record.application_type_id
    join public.application_versions application_version
      on application_version.application_id = application_record.id
      and application_version.version = application_record.active_version
    where application_record.id = source_application_id
      and application_type.application_category = 'vehicle';

    if found then
      ownership_value := coalesce(
        nullif(vehicle_payload ->> 'ownershipType', ''),
        nullif(vehicle_payload ->> 'ownership_type', '')
      );

      if ownership_value in (
        'driver_owned',
        'business_owned',
        'leased',
        'rented',
        'third_party_authorized',
        'fleet_assigned',
        'other'
      ) then
        new.ownership_type := ownership_value;
      end if;

      new.manufacturer := coalesce(new.manufacturer, nullif(vehicle_payload ->> 'manufacturer', ''));
      new.model := coalesce(new.model, nullif(vehicle_payload ->> 'model', ''));
      new.registration_number := coalesce(
        new.registration_number,
        nullif(vehicle_payload ->> 'registrationNumber', ''),
        nullif(vehicle_payload ->> 'registration_number', '')
      );
      new.vin := coalesce(new.vin, nullif(vehicle_payload ->> 'vin', ''), nullif(vehicle_payload ->> 'chassisNumber', ''));
      new.color := coalesce(new.color, nullif(vehicle_payload ->> 'color', ''));
      new.fuel_type := coalesce(new.fuel_type, nullif(vehicle_payload ->> 'fuelType', ''), nullif(vehicle_payload ->> 'fuel_type', ''));

      if new.model_year is null and coalesce(vehicle_payload ->> 'year', vehicle_payload ->> 'modelYear') ~ '^[0-9]{4}$' then
        new.model_year := coalesce(vehicle_payload ->> 'year', vehicle_payload ->> 'modelYear')::integer;
      end if;

      if new.max_load_kg is null and coalesce(vehicle_payload ->> 'maxLoadKg', vehicle_payload ->> 'max_load_kg') ~ '^[0-9]+(\.[0-9]+)?$' then
        new.max_load_kg := coalesce(vehicle_payload ->> 'maxLoadKg', vehicle_payload ->> 'max_load_kg')::numeric;
      end if;

      if new.cargo_volume_m3 is null and coalesce(vehicle_payload ->> 'cargoVolumeM3', vehicle_payload ->> 'cargo_volume_m3') ~ '^[0-9]+(\.[0-9]+)?$' then
        new.cargo_volume_m3 := coalesce(vehicle_payload ->> 'cargoVolumeM3', vehicle_payload ->> 'cargo_volume_m3')::numeric;
      end if;

      if new.passenger_capacity is null and coalesce(vehicle_payload ->> 'passengerCapacity', vehicle_payload ->> 'passenger_capacity') ~ '^[0-9]+$' then
        new.passenger_capacity := coalesce(vehicle_payload ->> 'passengerCapacity', vehicle_payload ->> 'passenger_capacity')::integer;
      end if;

      if new.insurance_expires_at is null and (vehicle_payload ->> 'insuranceExpiresAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        new.insurance_expires_at := (vehicle_payload ->> 'insuranceExpiresAt')::date;
      end if;

      if new.inspection_expires_at is null and (vehicle_payload ->> 'inspectionExpiresAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        new.inspection_expires_at := (vehicle_payload ->> 'inspectionExpiresAt')::date;
      end if;

      if new.roadworthiness_expires_at is null and (vehicle_payload ->> 'roadworthinessExpiresAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        new.roadworthiness_expires_at := (vehicle_payload ->> 'roadworthinessExpiresAt')::date;
      end if;
    end if;
  end if;

  if new.status = 'active' and new.vehicle_type_id is null then
    raise exception 'vehicle type is required before activation';
  end if;

  if new.status = 'active' and new.owner_user_id is null and new.organization_id is null then
    raise exception 'vehicle owner or organization is required before activation';
  end if;

  if auth.role() <> 'service_role'
    and auth.uid() = new.owner_user_id
    and not public.has_permission('platform.vehicles.manage', new.organization_id) then
    if tg_op = 'INSERT' and new.status = 'active' then
      raise exception 'vehicle approval cannot be self-assigned';
    end if;

    if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status = 'active' then
      raise exception 'vehicle approval cannot be self-assigned';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.sync_driver_vehicle_link_from_approved_vehicle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  source_application_id uuid;
  application_record record;
  vehicle_payload jsonb;
  target_driver_profile_id uuid;
  relationship_value text;
begin
  if new.status <> 'active' then
    return new;
  end if;

  if not (
    new.metadata ? 'source_application_id'
    and (new.metadata ->> 'source_application_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    return new;
  end if;

  source_application_id := (new.metadata ->> 'source_application_id')::uuid;

  select application_record_table.*, application_version.payload
  into application_record
  from public.application_records application_record_table
  join public.application_type_definitions application_type
    on application_type.id = application_record_table.application_type_id
  join public.application_versions application_version
    on application_version.application_id = application_record_table.id
    and application_version.version = application_record_table.active_version
  where application_record_table.id = source_application_id
    and application_type.application_category = 'vehicle';

  if not found then
    return new;
  end if;

  vehicle_payload := coalesce(application_record.payload -> 'vehicle', '{}'::jsonb);

  if vehicle_payload ? 'driverProfileId'
    and (vehicle_payload ->> 'driverProfileId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select driver.id
    into target_driver_profile_id
    from public.driver_profiles driver
    where driver.id = (vehicle_payload ->> 'driverProfileId')::uuid
      and driver.user_id = application_record.applicant_user_id
      and driver.verification_status = 'approved';
  else
    select driver.id
    into target_driver_profile_id
    from public.driver_profiles driver
    where driver.user_id = application_record.applicant_user_id
      and driver.verification_status = 'approved'
    order by driver.created_at asc
    limit 1;
  end if;

  if target_driver_profile_id is null then
    return new;
  end if;

  relationship_value := coalesce(
    nullif(vehicle_payload ->> 'ownershipType', ''),
    nullif(vehicle_payload ->> 'ownership_type', ''),
    new.ownership_type,
    'driver_owned'
  );

  if relationship_value not in (
    'driver_owned',
    'business_owned',
    'leased',
    'rented',
    'third_party_authorized',
    'fleet_assigned',
    'other'
  ) then
    relationship_value := 'other';
  end if;

  insert into public.driver_vehicle_links (
    driver_profile_id,
    vehicle_id,
    relationship_type,
    status,
    authorized_by,
    metadata,
    created_by
  )
  values (
    target_driver_profile_id,
    new.id,
    relationship_value,
    'active',
    auth.uid(),
    jsonb_build_object('source_application_id', source_application_id),
    auth.uid()
  )
  on conflict (driver_profile_id, vehicle_id, relationship_type) do update
  set status = 'active',
      authorized_by = excluded.authorized_by,
      metadata = public.driver_vehicle_links.metadata || excluded.metadata,
      updated_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists hydrate_driver_profile_from_application on public.driver_profiles;
create trigger hydrate_driver_profile_from_application
before insert or update on public.driver_profiles
for each row execute function public.hydrate_driver_profile_from_application();

drop trigger if exists hydrate_vehicle_from_application on public.vehicles;
create trigger hydrate_vehicle_from_application
before insert or update on public.vehicles
for each row execute function public.hydrate_vehicle_from_application();

drop trigger if exists sync_driver_vehicle_link_from_approved_vehicle on public.vehicles;
create trigger sync_driver_vehicle_link_from_approved_vehicle
after insert or update on public.vehicles
for each row execute function public.sync_driver_vehicle_link_from_approved_vehicle();

drop trigger if exists set_driver_vehicle_links_updated_at on public.driver_vehicle_links;
create trigger set_driver_vehicle_links_updated_at
before update on public.driver_vehicle_links
for each row execute function public.set_updated_at();

drop trigger if exists audit_driver_vehicle_links_mutations on public.driver_vehicle_links;
create trigger audit_driver_vehicle_links_mutations
after insert or update or delete on public.driver_vehicle_links
for each row execute function public.record_table_audit();

alter table public.driver_vehicle_links enable row level security;

drop policy if exists driver_profiles_insert_self on public.driver_profiles;
drop policy if exists driver_profiles_update_self_or_privileged on public.driver_profiles;
drop policy if exists driver_profiles_manage_privileged on public.driver_profiles;
drop policy if exists vehicles_manage_owner_or_privileged on public.vehicles;
drop policy if exists vehicles_insert_owner_pending on public.vehicles;
drop policy if exists vehicles_update_owner_pending_or_privileged on public.vehicles;
drop policy if exists vehicles_delete_owner_pending_or_privileged on public.vehicles;
drop policy if exists vehicles_manage_privileged on public.vehicles;
drop policy if exists driver_vehicle_links_select_related_or_privileged on public.driver_vehicle_links;
drop policy if exists driver_vehicle_links_manage_privileged on public.driver_vehicle_links;

create policy driver_profiles_insert_self on public.driver_profiles
for insert to authenticated
with check (
  user_id = auth.uid()
  and verification_status in ('unverified', 'pending')
  and operational_status <> 'available'
);

create policy driver_profiles_update_self_or_privileged on public.driver_profiles
for update to authenticated
using (
  user_id = auth.uid()
  or public.has_permission('platform.drivers.manage', organization_id)
)
with check (
  user_id = auth.uid()
  or public.has_permission('platform.drivers.manage', organization_id)
);

create policy driver_profiles_manage_privileged on public.driver_profiles
for all to authenticated
using (public.has_permission('platform.drivers.manage', organization_id))
with check (public.has_permission('platform.drivers.manage', organization_id));

create policy vehicles_insert_owner_pending on public.vehicles
for insert to authenticated
with check (
  owner_user_id = auth.uid()
  and status = 'pending'
);

create policy vehicles_update_owner_pending_or_privileged on public.vehicles
for update to authenticated
using (
  (owner_user_id = auth.uid() and status <> 'active')
  or public.has_permission('platform.vehicles.manage', organization_id)
)
with check (
  (owner_user_id = auth.uid() and status <> 'active')
  or public.has_permission('platform.vehicles.manage', organization_id)
);

create policy vehicles_delete_owner_pending_or_privileged on public.vehicles
for delete to authenticated
using (
  (owner_user_id = auth.uid() and status = 'pending')
  or public.has_permission('platform.vehicles.manage', organization_id)
);

create policy vehicles_manage_privileged on public.vehicles
for all to authenticated
using (public.has_permission('platform.vehicles.manage', organization_id))
with check (public.has_permission('platform.vehicles.manage', organization_id));

create policy driver_vehicle_links_select_related_or_privileged on public.driver_vehicle_links
for select to authenticated
using (
  exists (
    select 1
    from public.driver_profiles driver
    where driver.id = driver_vehicle_links.driver_profile_id
      and driver.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.vehicles vehicle
    where vehicle.id = driver_vehicle_links.vehicle_id
      and (
        vehicle.owner_user_id = auth.uid()
        or (vehicle.organization_id is not null and public.is_organization_member(vehicle.organization_id))
      )
  )
  or public.has_permission('platform.drivers.read', null)
  or public.has_permission('platform.vehicles.manage', null)
);

create policy driver_vehicle_links_manage_privileged on public.driver_vehicle_links
for all to authenticated
using (
  public.has_permission('platform.drivers.manage', null)
  or public.has_permission('platform.vehicles.manage', null)
)
with check (
  public.has_permission('platform.drivers.manage', null)
  or public.has_permission('platform.vehicles.manage', null)
);

create or replace function public.dispatch_service_request(
  target_service_request_id uuid,
  target_dispatch_policy_key text default null,
  target_candidate_limit integer default 5,
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request_record record;
  policy_record record;
  dispatch_request_id uuid;
  candidate_record record;
  candidate_rank integer := 0;
  driver_required_capabilities text[];
  vehicle_required_capabilities text[];
  legacy_required_capabilities text[];
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.dispatch.execute', null)
    and not public.can_execute_platform_runtime() then
    raise exception 'dispatch execution permission is required';
  end if;

  if target_service_request_id is null then
    raise exception 'target_service_request_id is required';
  end if;

  if target_candidate_limit is null or target_candidate_limit <= 0 or target_candidate_limit > 50 then
    raise exception 'target_candidate_limit must be between 1 and 50';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select request.*
  into request_record
  from public.service_requests request
  where request.id = target_service_request_id
  for update;

  if not found then
    raise exception 'target_service_request_id must reference an existing service request';
  end if;

  if target_dispatch_policy_key is not null then
    select policy.*
    into policy_record
    from public.dispatch_policies policy
    where policy.key = target_dispatch_policy_key
      and policy.status = 'active';
  elsif request_record.dispatch_policy_id is not null then
    select policy.*
    into policy_record
    from public.dispatch_policies policy
    where policy.id = request_record.dispatch_policy_id
      and policy.status = 'active';
  else
    select policy.*
    into policy_record
    from public.dispatch_policies policy
    where policy.status = 'active'
    order by policy.created_at asc
    limit 1;
  end if;

  if not found then
    raise exception 'an active dispatch policy is required for this service request';
  end if;

  select array_agg(required.value)
  into driver_required_capabilities
  from jsonb_array_elements_text(
    coalesce(policy_record.rules -> 'driver_required_capabilities', '[]'::jsonb)
  ) as required(value);

  select array_agg(required.value)
  into vehicle_required_capabilities
  from jsonb_array_elements_text(
    coalesce(policy_record.rules -> 'vehicle_required_capabilities', '[]'::jsonb)
  ) as required(value);

  select array_agg(required.value)
  into legacy_required_capabilities
  from jsonb_array_elements_text(
    coalesce(policy_record.rules -> 'required_capabilities', '[]'::jsonb)
  ) as required(value);

  driver_required_capabilities := coalesce(driver_required_capabilities, array[]::text[]);
  vehicle_required_capabilities := coalesce(vehicle_required_capabilities, array[]::text[]);
  legacy_required_capabilities := coalesce(legacy_required_capabilities, array[]::text[]);

  if array_length(driver_required_capabilities, 1) is null
    and array_length(vehicle_required_capabilities, 1) is null then
    driver_required_capabilities := legacy_required_capabilities;
  end if;

  dispatch_request_id := public.create_dispatch_request(
    policy_record.key,
    'platform.dispatch_engine',
    'service_request',
    target_service_request_id,
    jsonb_build_object(
      'driver_required_capabilities',
      driver_required_capabilities,
      'vehicle_required_capabilities',
      vehicle_required_capabilities
    ),
    coalesce(request_record.request_payload -> 'pickup_location', '{}'::jsonb),
    coalesce(request_record.request_payload -> 'dropoff_location', '{}'::jsonb),
    coalesce((request_record.request_payload ->> 'priority')::integer, 100),
    jsonb_build_object('module_id', request_record.module_id),
    target_idempotency_key || ':request'
  );

  for candidate_record in
    select
      driver.id as driver_id,
      driver.user_id,
      count(distinct driver_capability.id) as matching_driver_capability_count,
      count(distinct vehicle_capability.id) as matching_vehicle_capability_count,
      selected_vehicle.id as vehicle_id
    from public.driver_profiles driver
    join public.driver_vehicle_links vehicle_link
      on vehicle_link.driver_profile_id = driver.id
      and vehicle_link.status = 'active'
      and vehicle_link.starts_at <= timezone('utc', now())
      and (vehicle_link.ends_at is null or vehicle_link.ends_at > timezone('utc', now()))
    join public.vehicles selected_vehicle
      on selected_vehicle.id = vehicle_link.vehicle_id
      and selected_vehicle.status = 'active'
    left join public.entity_capabilities driver_capability
      on driver_capability.entity_type = 'driver'
      and driver_capability.entity_id = driver.id
      and driver_capability.status = 'active'
      and (
        array_length(driver_required_capabilities, 1) is null
        or driver_capability.capability_key = any(driver_required_capabilities)
      )
    left join public.entity_capabilities vehicle_capability
      on vehicle_capability.entity_type = 'vehicle'
      and vehicle_capability.entity_id = selected_vehicle.id
      and vehicle_capability.status = 'active'
      and (
        array_length(vehicle_required_capabilities, 1) is null
        or vehicle_capability.capability_key = any(vehicle_required_capabilities)
      )
    where driver.verification_status = 'approved'
      and driver.operational_status = 'available'
    group by driver.id, driver.user_id, selected_vehicle.id
    having (
        array_length(driver_required_capabilities, 1) is null
        or count(distinct driver_capability.id) >= array_length(driver_required_capabilities, 1)
      )
      and (
        array_length(vehicle_required_capabilities, 1) is null
        or count(distinct vehicle_capability.id) >= array_length(vehicle_required_capabilities, 1)
      )
    order by
      count(distinct driver_capability.id) desc,
      count(distinct vehicle_capability.id) desc,
      driver.created_at asc
    limit target_candidate_limit
  loop
    candidate_rank := candidate_rank + 1;

    perform public.upsert_dispatch_candidate(
      dispatch_request_id,
      'driver',
      candidate_record.driver_id,
      greatest(100 - (candidate_rank - 1) * 5, 1),
      candidate_rank,
      jsonb_build_object(
        'matching_driver_capability_count',
        candidate_record.matching_driver_capability_count,
        'matching_vehicle_capability_count',
        candidate_record.matching_vehicle_capability_count,
        'vehicle_id',
        candidate_record.vehicle_id,
        'selection_mode',
        policy_record.matching_strategy
      ),
      case when candidate_rank = 1 then 'offered' else 'suggested' end,
      target_idempotency_key || ':candidate:' || candidate_rank::text
    );
  end loop;

  if candidate_rank = 0 then
    raise exception 'no eligible dispatch candidates found';
  end if;

  update public.service_requests
  set dispatch_policy_id = policy_record.id,
      status = 'matching',
      updated_at = timezone('utc', now())
  where id = target_service_request_id;

  insert into public.service_request_events (
    service_request_id,
    event_type_key,
    status,
    idempotency_key,
    metadata
  )
  values (
    target_service_request_id,
    'event.driver.matched',
    'matching',
    target_idempotency_key || ':matched',
    jsonb_build_object('dispatch_request_id', dispatch_request_id, 'candidate_count', candidate_rank)
  )
  on conflict do nothing;

  return dispatch_request_id;
end;
$$;

grant select, insert, update, delete on public.driver_vehicle_links to authenticated;
grant select, insert, update, delete on public.driver_vehicle_links to service_role;

revoke all on function public.hydrate_driver_profile_from_application() from public;
revoke all on function public.hydrate_vehicle_from_application() from public;
revoke all on function public.sync_driver_vehicle_link_from_approved_vehicle() from public;
revoke all on function public.dispatch_service_request(uuid, text, integer, text) from public;
revoke all on function public.dispatch_service_request(uuid, text, integer, text) from anon;
grant execute on function public.dispatch_service_request(uuid, text, integer, text)
to authenticated, service_role;

commit;
