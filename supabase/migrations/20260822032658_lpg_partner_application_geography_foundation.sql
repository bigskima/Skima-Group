create table if not exists public.application_location_verifications (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.application_records(id) on delete restrict,
  application_version_id uuid not null references public.application_versions(id) on delete restrict,
  location_purpose text not null,
  formatted_address text,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_meters double precision,
  provider_source text,
  provider_place_id text,
  recorded_at timestamptz,
  status text not null default 'pending',
  reviewer_user_id uuid,
  reviewed_at timestamptz,
  review_reason text,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  source text not null default 'skima.application.location',
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint application_location_verifications_purpose_format check (location_purpose ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  constraint application_location_verifications_latitude_range check (latitude between -90 and 90),
  constraint application_location_verifications_longitude_range check (longitude between -180 and 180),
  constraint application_location_verifications_accuracy_nonnegative check (accuracy_meters is null or accuracy_meters >= 0),
  constraint application_location_verifications_status_check check (status in ('pending','verified','rejected')),
  constraint application_location_verifications_snapshot_object check (jsonb_typeof(evidence_snapshot) = 'object'),
  constraint application_location_verifications_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint application_location_verifications_version_purpose_unique unique (application_version_id, location_purpose),
  constraint application_location_verifications_source_idempotency_unique unique (source, idempotency_key)
);

create index if not exists application_location_verifications_application_idx
  on public.application_location_verifications(application_id, application_version_id);
create index if not exists application_location_verifications_status_idx
  on public.application_location_verifications(status, updated_at desc);

create table if not exists public.application_location_review_events (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid not null references public.application_location_verifications(id) on delete restrict,
  application_id uuid not null references public.application_records(id) on delete restrict,
  application_version_id uuid not null references public.application_versions(id) on delete restrict,
  decision text not null,
  reviewer_user_id uuid,
  reason text,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  source text not null default 'skima.application.location_review',
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint application_location_review_events_decision_check check (decision in ('verified','rejected')),
  constraint application_location_review_events_snapshot_object check (jsonb_typeof(evidence_snapshot) = 'object'),
  constraint application_location_review_events_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint application_location_review_events_source_idempotency_unique unique (source, idempotency_key)
);

create index if not exists application_location_review_events_application_idx
  on public.application_location_review_events(application_id, created_at desc);

create table if not exists public.application_service_area_selections (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.application_records(id) on delete restrict,
  application_version_id uuid not null references public.application_versions(id) on delete restrict,
  service_area_id uuid not null references public.service_areas(id) on delete restrict,
  selection_role text not null default 'driver_service_area',
  is_primary boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  source text not null default 'skima.application.service_area',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint application_service_area_selections_role_format check (selection_role ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  constraint application_service_area_selections_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint application_service_area_selections_version_area_role_unique unique (application_version_id, service_area_id, selection_role)
);

create unique index if not exists application_service_area_selections_one_primary_idx
  on public.application_service_area_selections(application_version_id, selection_role)
  where is_primary;
create index if not exists application_service_area_selections_application_idx
  on public.application_service_area_selections(application_id, application_version_id);
create index if not exists application_service_area_selections_area_idx
  on public.application_service_area_selections(service_area_id);

create table if not exists public.driver_service_areas (
  id uuid primary key default gen_random_uuid(),
  driver_profile_id uuid not null references public.driver_profiles(id) on delete restrict,
  service_area_id uuid not null references public.service_areas(id) on delete restrict,
  is_primary boolean not null default false,
  status text not null default 'active',
  source_application_id uuid references public.application_records(id) on delete restrict,
  source_application_version_id uuid references public.application_versions(id) on delete restrict,
  approved_by uuid,
  effective_from timestamptz not null default timezone('utc', now()),
  effective_until timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint driver_service_areas_status_check check (status in ('active','inactive')),
  constraint driver_service_areas_effective_window_check check (effective_until is null or effective_until > effective_from),
  constraint driver_service_areas_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint driver_service_areas_driver_area_unique unique (driver_profile_id, service_area_id)
);

create unique index if not exists driver_service_areas_one_active_primary_idx
  on public.driver_service_areas(driver_profile_id)
  where is_primary and status = 'active';
create index if not exists driver_service_areas_driver_status_idx
  on public.driver_service_areas(driver_profile_id, status);
create index if not exists driver_service_areas_area_status_idx
  on public.driver_service_areas(service_area_id, status);

alter table public.application_location_verifications enable row level security;
alter table public.application_location_review_events enable row level security;
alter table public.application_service_area_selections enable row level security;
alter table public.driver_service_areas enable row level security;

revoke all on public.application_location_verifications from anon, authenticated;
revoke all on public.application_location_review_events from anon, authenticated;
revoke all on public.application_service_area_selections from anon, authenticated;
revoke all on public.driver_service_areas from anon, authenticated;

grant select on public.application_location_verifications to authenticated;
grant select on public.application_location_review_events to authenticated;
grant select on public.application_service_area_selections to authenticated;
grant select on public.driver_service_areas to authenticated;
grant all on public.application_location_verifications to service_role;
grant all on public.application_location_review_events to service_role;
grant all on public.application_service_area_selections to service_role;
grant all on public.driver_service_areas to service_role;

create policy application_location_verifications_select_actor_or_privileged
on public.application_location_verifications
for select to authenticated
using (public.can_read_application_record(application_id));

create policy application_location_review_events_select_privileged
on public.application_location_review_events
for select to authenticated
using (public.can_review_applications() or public.can_manage_applications());

create policy application_service_area_selections_select_actor_or_privileged
on public.application_service_area_selections
for select to authenticated
using (public.can_read_application_record(application_id));

create policy driver_service_areas_select_self_or_privileged
on public.driver_service_areas
for select to authenticated
using (
  exists (
    select 1
    from public.driver_profiles driver
    where driver.id = driver_profile_id
      and (
        driver.user_id = auth.uid()
        or public.has_permission('platform.drivers.read', driver.organization_id)
        or public.has_permission('platform.drivers.manage', driver.organization_id)
      )
  )
);

create or replace function public.sync_application_geography_for_version(target_application_version_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  version_record record;
  application_record record;
  application_type_record record;
  workspace_key text;
  location_purpose_key text;
  location_payload jsonb;
  station_payload jsonb;
  service_payload jsonb;
  service_area_values jsonb;
  latitude_text text;
  longitude_text text;
  accuracy_text text;
  recorded_at_text text;
  latitude_value double precision;
  longitude_value double precision;
  accuracy_value double precision;
  recorded_at_value timestamptz;
  formatted_address_value text;
  provider_source_value text;
  provider_place_id_value text;
  primary_area_text text;
  selected_area_text text;
  selected_area_id uuid;
  selected_count integer := 0;
begin
  select version.*
  into version_record
  from public.application_versions version
  where version.id = target_application_version_id;

  if not found then
    raise exception 'application version was not found';
  end if;

  select application.*
  into application_record
  from public.application_records application
  where application.id = version_record.application_id;

  select application_type.*
  into application_type_record
  from public.application_type_definitions application_type
  where application_type.id = application_record.application_type_id;

  workspace_key := application_type_record.metadata ->> 'workspace';
  if coalesce(application_type_record.metadata ->> 'bounded_context', '') <> 'lpg'
     or workspace_key not in ('driver','station') then
    return;
  end if;

  station_payload := coalesce(version_record.payload -> 'station', '{}'::jsonb);
  location_payload := coalesce(version_record.payload -> 'location', '{}'::jsonb);
  service_payload := coalesce(version_record.payload -> 'service', '{}'::jsonb);
  location_purpose_key := case workspace_key
    when 'driver' then 'driver.base_location'
    when 'station' then 'station.facility_location'
  end;

  latitude_text := coalesce(
    nullif(location_payload ->> 'latitude', ''),
    case when workspace_key = 'station' then nullif(station_payload ->> 'latitude', '') end
  );
  longitude_text := coalesce(
    nullif(location_payload ->> 'longitude', ''),
    case when workspace_key = 'station' then nullif(station_payload ->> 'longitude', '') end
  );

  if latitude_text is null and longitude_text is null then
    delete from public.application_location_verifications verification
    where verification.application_version_id = target_application_version_id
      and verification.location_purpose = location_purpose_key
      and verification.status = 'pending';
  else
    if latitude_text is null or longitude_text is null
       or latitude_text !~ '^-?[0-9]+([.][0-9]+)?$'
       or longitude_text !~ '^-?[0-9]+([.][0-9]+)?$' then
      raise exception 'application location must contain valid latitude and longitude';
    end if;

    latitude_value := latitude_text::double precision;
    longitude_value := longitude_text::double precision;
    if latitude_value < -90 or latitude_value > 90 or longitude_value < -180 or longitude_value > 180 then
      raise exception 'application location coordinates are outside the valid range';
    end if;

    accuracy_text := nullif(location_payload ->> 'accuracyMeters', '');
    if accuracy_text is not null and accuracy_text ~ '^[0-9]+([.][0-9]+)?$' then
      accuracy_value := accuracy_text::double precision;
    else
      accuracy_value := null;
    end if;

    recorded_at_text := nullif(location_payload ->> 'recordedAt', '');
    recorded_at_value := null;
    if recorded_at_text is not null then
      begin
        recorded_at_value := recorded_at_text::timestamptz;
      exception when others then
        recorded_at_value := null;
      end;
    end if;

    formatted_address_value := coalesce(
      nullif(location_payload ->> 'formattedAddress', ''),
      case when workspace_key = 'station' then nullif(station_payload ->> 'formattedAddress', '') end
    );
    provider_source_value := nullif(location_payload ->> 'providerSource', '');
    provider_place_id_value := nullif(location_payload ->> 'providerPlaceId', '');

    insert into public.application_location_verifications (
      application_id,
      application_version_id,
      location_purpose,
      formatted_address,
      latitude,
      longitude,
      accuracy_meters,
      provider_source,
      provider_place_id,
      recorded_at,
      status,
      evidence_snapshot,
      metadata,
      source,
      idempotency_key
    ) values (
      application_record.id,
      version_record.id,
      location_purpose_key,
      formatted_address_value,
      latitude_value,
      longitude_value,
      accuracy_value,
      provider_source_value,
      provider_place_id_value,
      recorded_at_value,
      'pending',
      jsonb_build_object(
        'location', location_payload,
        'station', case when workspace_key = 'station' then station_payload else null end
      ),
      jsonb_build_object('workspace', workspace_key, 'applicationVersion', version_record.version),
      'skima.application.location_sync',
      concat('application-version:', version_record.id, ':', location_purpose_key)
    )
    on conflict (application_version_id, location_purpose) do update
    set formatted_address = excluded.formatted_address,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        accuracy_meters = excluded.accuracy_meters,
        provider_source = excluded.provider_source,
        provider_place_id = excluded.provider_place_id,
        recorded_at = excluded.recorded_at,
        status = case
          when public.application_location_verifications.latitude is distinct from excluded.latitude
            or public.application_location_verifications.longitude is distinct from excluded.longitude
            or public.application_location_verifications.accuracy_meters is distinct from excluded.accuracy_meters
            or public.application_location_verifications.formatted_address is distinct from excluded.formatted_address
            then 'pending'
          else public.application_location_verifications.status
        end,
        reviewer_user_id = case
          when public.application_location_verifications.latitude is distinct from excluded.latitude
            or public.application_location_verifications.longitude is distinct from excluded.longitude
            or public.application_location_verifications.formatted_address is distinct from excluded.formatted_address
            then null
          else public.application_location_verifications.reviewer_user_id
        end,
        reviewed_at = case
          when public.application_location_verifications.latitude is distinct from excluded.latitude
            or public.application_location_verifications.longitude is distinct from excluded.longitude
            or public.application_location_verifications.formatted_address is distinct from excluded.formatted_address
            then null
          else public.application_location_verifications.reviewed_at
        end,
        review_reason = case
          when public.application_location_verifications.latitude is distinct from excluded.latitude
            or public.application_location_verifications.longitude is distinct from excluded.longitude
            or public.application_location_verifications.formatted_address is distinct from excluded.formatted_address
            then null
          else public.application_location_verifications.review_reason
        end,
        evidence_snapshot = excluded.evidence_snapshot,
        metadata = public.application_location_verifications.metadata || excluded.metadata,
        updated_at = timezone('utc', now());
  end if;

  if workspace_key <> 'driver' then
    return;
  end if;

  delete from public.application_service_area_selections selection
  where selection.application_version_id = target_application_version_id
    and selection.selection_role = 'driver_service_area';

  service_area_values := service_payload -> 'serviceAreaIds';
  primary_area_text := nullif(service_payload ->> 'primaryServiceAreaId', '');

  if service_area_values is null then
    return;
  end if;

  if jsonb_typeof(service_area_values) <> 'array' then
    raise exception 'driver service areas must be an array';
  end if;

  for selected_area_text in
    select distinct value
    from jsonb_array_elements_text(service_area_values) as area(value)
  loop
    if selected_area_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'driver service area contains an invalid identifier';
    end if;

    selected_area_id := selected_area_text::uuid;
    if not exists (
      select 1
      from public.service_areas area
      where area.id = selected_area_id
        and area.status = 'active'
        and area.area_type in ('state','lga','city','town','locality','radius','polygon')
    ) then
      raise exception 'driver service area is not available for selection';
    end if;

    insert into public.application_service_area_selections (
      application_id,
      application_version_id,
      service_area_id,
      selection_role,
      is_primary,
      metadata,
      source
    ) values (
      application_record.id,
      version_record.id,
      selected_area_id,
      'driver_service_area',
      primary_area_text = selected_area_text,
      jsonb_build_object('applicationVersion', version_record.version),
      'skima.application.service_area_sync'
    );
    selected_count := selected_count + 1;
  end loop;

  if selected_count > 0 and primary_area_text is null then
    raise exception 'choose one primary driver service area';
  end if;

  if primary_area_text is not null and not exists (
    select 1
    from public.application_service_area_selections selection
    where selection.application_version_id = target_application_version_id
      and selection.selection_role = 'driver_service_area'
      and selection.is_primary
  ) then
    raise exception 'primary driver service area must be one of the selected areas';
  end if;
end;
$$;

revoke all on function public.sync_application_geography_for_version(uuid) from public, anon, authenticated;
grant execute on function public.sync_application_geography_for_version(uuid) to service_role;

create or replace function public.sync_application_geography_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.sync_application_geography_for_version(new.id);
  return new;
end;
$$;

revoke all on function public.sync_application_geography_trigger() from public, anon, authenticated;
grant execute on function public.sync_application_geography_trigger() to service_role;

drop trigger if exists application_versions_sync_geography on public.application_versions;
create trigger application_versions_sync_geography
after insert or update of payload on public.application_versions
for each row execute function public.sync_application_geography_trigger();

create or replace function public.read_selectable_lpg_service_areas()
returns table (
  area_id uuid,
  display_name text,
  area_type text,
  parent_area_id uuid,
  country_code text,
  country_name text,
  state_name text,
  lga_name text,
  city_name text,
  town_name text,
  locality_name text,
  radius_meters double precision
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() not in ('authenticated','service_role') then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;

  return query
  select
    area.id,
    area.display_name,
    area.area_type,
    area.parent_area_id,
    area.country_code,
    area.country_name,
    area.state_name,
    area.lga_name,
    area.city_name,
    area.town_name,
    area.locality_name,
    area.radius_meters
  from public.service_areas area
  where area.status = 'active'
    and area.area_type in ('state','lga','city','town','locality','radius','polygon')
    and coalesce(area.metadata ->> 'partnerSelectable', 'true') <> 'false'
  order by
    case area.area_type
      when 'state' then 10
      when 'lga' then 20
      when 'city' then 30
      when 'town' then 40
      when 'locality' then 50
      when 'radius' then 60
      when 'polygon' then 70
      else 80
    end,
    area.display_name;
end;
$$;

revoke all on function public.read_selectable_lpg_service_areas() from public, anon;
grant execute on function public.read_selectable_lpg_service_areas() to authenticated, service_role;

create or replace function public.read_partner_application_location_reviews()
returns table (
  application_id uuid,
  application_version_id uuid,
  application_type_key text,
  workspace text,
  applicant_user_id uuid,
  applicant_display_name text,
  application_status text,
  operational_status text,
  location_purpose text,
  formatted_address text,
  latitude double precision,
  longitude double precision,
  accuracy_meters double precision,
  provider_source text,
  provider_place_id text,
  recorded_at timestamptz,
  verification_status text,
  reviewer_user_id uuid,
  reviewed_at timestamptz,
  review_reason text,
  service_areas jsonb,
  submitted_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role'
     and not public.can_review_applications()
     and not public.can_manage_applications() then
    raise exception using errcode = '42501', message = 'Application review permission is required';
  end if;

  return query
  select
    application.id,
    version.id,
    application_type.key,
    application_type.metadata ->> 'workspace',
    application.applicant_user_id,
    profile.display_name,
    application.status,
    application.operational_status,
    verification.location_purpose,
    verification.formatted_address,
    verification.latitude,
    verification.longitude,
    verification.accuracy_meters,
    verification.provider_source,
    verification.provider_place_id,
    verification.recorded_at,
    verification.status,
    verification.reviewer_user_id,
    verification.reviewed_at,
    verification.review_reason,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'areaId', area.id,
        'displayName', area.display_name,
        'areaType', area.area_type,
        'isPrimary', selection.is_primary,
        'stateName', area.state_name,
        'lgaName', area.lga_name,
        'cityName', area.city_name,
        'townName', area.town_name,
        'localityName', area.locality_name
      ) order by selection.is_primary desc, area.display_name)
      from public.application_service_area_selections selection
      join public.service_areas area on area.id = selection.service_area_id
      where selection.application_version_id = version.id
        and selection.selection_role = 'driver_service_area'
    ), '[]'::jsonb),
    application.submitted_at,
    greatest(application.updated_at, version.updated_at, coalesce(verification.updated_at, version.updated_at))
  from public.application_records application
  join public.application_type_definitions application_type
    on application_type.id = application.application_type_id
  join public.application_versions version
    on version.application_id = application.id
   and version.version = application.active_version
  left join public.profiles profile on profile.id = application.applicant_user_id
  left join public.application_location_verifications verification
    on verification.application_version_id = version.id
   and verification.location_purpose = case application_type.metadata ->> 'workspace'
      when 'driver' then 'driver.base_location'
      when 'station' then 'station.facility_location'
      else ''
    end
  where application_type.metadata ->> 'bounded_context' = 'lpg'
    and application_type.metadata ->> 'workspace' in ('driver','station')
  order by application.created_at desc;
end;
$$;

revoke all on function public.read_partner_application_location_reviews() from public, anon;
grant execute on function public.read_partner_application_location_reviews() to authenticated, service_role;

create or replace function public.review_application_location(
  target_application_id uuid,
  target_application_version_id uuid,
  target_decision text,
  target_reason text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  application_record record;
  verification_record record;
  existing_event record;
begin
  if auth.role() <> 'service_role'
     and not public.can_review_applications()
     and not public.can_manage_applications() then
    raise exception using errcode = '42501', message = 'Application review permission is required';
  end if;

  if target_decision not in ('verified','rejected') then
    raise exception using errcode = '22023', message = 'Location review decision is not supported';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception using errcode = '22023', message = 'Idempotency key is required';
  end if;
  if target_decision = 'rejected' and (target_reason is null or btrim(target_reason) = '') then
    raise exception using errcode = '22023', message = 'A reason is required when location evidence is rejected';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception using errcode = '22023', message = 'Location review metadata must be an object';
  end if;

  select application.*
  into application_record
  from public.application_records application
  where application.id = target_application_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'Application was not found';
  end if;

  if not exists (
    select 1
    from public.application_versions version
    where version.id = target_application_version_id
      and version.application_id = target_application_id
      and version.version = application_record.active_version
  ) then
    raise exception using errcode = '22023', message = 'Location review must reference the current application version';
  end if;

  select verification.*
  into verification_record
  from public.application_location_verifications verification
  where verification.application_id = target_application_id
    and verification.application_version_id = target_application_version_id
  limit 1
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'No detected location evidence is available for this application version';
  end if;

  select event.*
  into existing_event
  from public.application_location_review_events event
  where event.source = 'skima.application.location_review'
    and event.idempotency_key = btrim(target_idempotency_key)
  limit 1;

  if found then
    if existing_event.application_id <> target_application_id
       or existing_event.application_version_id <> target_application_version_id
       or existing_event.decision <> target_decision then
      raise exception using errcode = '23505', message = 'Idempotency key was already used for another location review';
    end if;
    return verification_record.id;
  end if;

  insert into public.application_location_review_events (
    verification_id,
    application_id,
    application_version_id,
    decision,
    reviewer_user_id,
    reason,
    evidence_snapshot,
    metadata,
    source,
    idempotency_key
  ) values (
    verification_record.id,
    target_application_id,
    target_application_version_id,
    target_decision,
    auth.uid(),
    nullif(btrim(coalesce(target_reason, '')), ''),
    verification_record.evidence_snapshot,
    target_metadata,
    'skima.application.location_review',
    btrim(target_idempotency_key)
  );

  update public.application_location_verifications
  set status = target_decision,
      reviewer_user_id = auth.uid(),
      reviewed_at = timezone('utc', now()),
      review_reason = nullif(btrim(coalesce(target_reason, '')), ''),
      metadata = metadata || target_metadata,
      updated_at = timezone('utc', now())
  where id = verification_record.id;

  return verification_record.id;
end;
$$;

revoke all on function public.review_application_location(uuid,uuid,text,text,text,jsonb) from public, anon;
grant execute on function public.review_application_location(uuid,uuid,text,text,text,jsonb) to authenticated, service_role;

create or replace function public.project_driver_service_areas_from_application(
  target_driver_profile_id uuid,
  target_application_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  application_record record;
  active_version_id uuid;
  selection_count integer;
  primary_count integer;
  primary_area_id uuid;
  primary_area_name text;
  area_ids jsonb;
  area_names jsonb;
begin
  select application.*
  into application_record
  from public.application_records application
  where application.id = target_application_id;

  if not found then
    raise exception 'application was not found';
  end if;

  if not exists (
    select 1
    from public.driver_profiles driver
    where driver.id = target_driver_profile_id
      and driver.user_id = application_record.applicant_user_id
  ) then
    raise exception 'driver profile does not belong to the application applicant';
  end if;

  select version.id
  into active_version_id
  from public.application_versions version
  where version.application_id = target_application_id
    and version.version = application_record.active_version;

  select count(*), count(*) filter (where selection.is_primary)
  into selection_count, primary_count
  from public.application_service_area_selections selection
  where selection.application_version_id = active_version_id
    and selection.selection_role = 'driver_service_area';

  if selection_count = 0 then
    return 0;
  end if;
  if primary_count <> 1 then
    raise exception 'driver application must have exactly one primary service area';
  end if;

  update public.driver_service_areas assignment
  set status = 'inactive',
      is_primary = false,
      effective_until = coalesce(assignment.effective_until, timezone('utc', now())),
      updated_at = timezone('utc', now())
  where assignment.driver_profile_id = target_driver_profile_id
    and assignment.status = 'active'
    and not exists (
      select 1
      from public.application_service_area_selections selection
      where selection.application_version_id = active_version_id
        and selection.selection_role = 'driver_service_area'
        and selection.service_area_id = assignment.service_area_id
    );

  insert into public.driver_service_areas (
    driver_profile_id,
    service_area_id,
    is_primary,
    status,
    source_application_id,
    source_application_version_id,
    approved_by,
    effective_from,
    effective_until,
    metadata
  )
  select
    target_driver_profile_id,
    selection.service_area_id,
    selection.is_primary,
    'active',
    target_application_id,
    active_version_id,
    auth.uid(),
    timezone('utc', now()),
    null,
    jsonb_build_object('selectionRole', selection.selection_role)
  from public.application_service_area_selections selection
  where selection.application_version_id = active_version_id
    and selection.selection_role = 'driver_service_area'
  on conflict (driver_profile_id, service_area_id) do update
  set is_primary = excluded.is_primary,
      status = 'active',
      source_application_id = excluded.source_application_id,
      source_application_version_id = excluded.source_application_version_id,
      approved_by = excluded.approved_by,
      effective_from = case
        when public.driver_service_areas.status = 'active' then public.driver_service_areas.effective_from
        else timezone('utc', now())
      end,
      effective_until = null,
      metadata = public.driver_service_areas.metadata || excluded.metadata,
      updated_at = timezone('utc', now());

  select assignment.service_area_id, area.display_name
  into primary_area_id, primary_area_name
  from public.driver_service_areas assignment
  join public.service_areas area on area.id = assignment.service_area_id
  where assignment.driver_profile_id = target_driver_profile_id
    and assignment.status = 'active'
    and assignment.is_primary
  limit 1;

  select
    coalesce(jsonb_agg(area.id order by assignment.is_primary desc, area.display_name), '[]'::jsonb),
    coalesce(jsonb_agg(area.display_name order by assignment.is_primary desc, area.display_name), '[]'::jsonb)
  into area_ids, area_names
  from public.driver_service_areas assignment
  join public.service_areas area on area.id = assignment.service_area_id
  where assignment.driver_profile_id = target_driver_profile_id
    and assignment.status = 'active';

  update public.driver_profiles
  set service_profile = (coalesce(service_profile, '{}'::jsonb) - 'primaryCity') || jsonb_build_object(
        'serviceAreaIds', area_ids,
        'primaryServiceAreaId', primary_area_id,
        'primaryServiceAreaName', primary_area_name,
        'zones', area_names
      ),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'serviceAreasProjectedFromApplicationId', target_application_id,
        'serviceAreasProjectedFromApplicationVersionId', active_version_id,
        'serviceAreasProjectedAt', timezone('utc', now())
      ),
      updated_at = timezone('utc', now())
  where id = target_driver_profile_id;

  return selection_count;
end;
$$;

revoke all on function public.project_driver_service_areas_from_application(uuid,uuid) from public, anon, authenticated;
grant execute on function public.project_driver_service_areas_from_application(uuid,uuid) to service_role;

create or replace function public.project_driver_service_areas_on_activation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.operational_status = 'active'
     and old.operational_status is distinct from new.operational_status
     and new.activated_subject_type = 'driver'
     and new.activated_subject_id is not null then
    perform public.project_driver_service_areas_from_application(new.activated_subject_id, new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.project_driver_service_areas_on_activation() from public, anon, authenticated;
grant execute on function public.project_driver_service_areas_on_activation() to service_role;

drop trigger if exists application_records_project_driver_service_areas on public.application_records;
create trigger application_records_project_driver_service_areas
after update of operational_status on public.application_records
for each row execute function public.project_driver_service_areas_on_activation();

create or replace function public.read_driver_service_areas(target_driver_profile_id uuid default null)
returns table (
  driver_profile_id uuid,
  service_area_id uuid,
  display_name text,
  area_type text,
  is_primary boolean,
  state_name text,
  lga_name text,
  city_name text,
  town_name text,
  locality_name text,
  effective_from timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  resolved_driver_profile_id uuid;
begin
  if target_driver_profile_id is null then
    select driver.id into resolved_driver_profile_id
    from public.driver_profiles driver
    where driver.user_id = auth.uid()
    limit 1;
  else
    resolved_driver_profile_id := target_driver_profile_id;
  end if;

  if resolved_driver_profile_id is null then
    return;
  end if;

  if auth.role() <> 'service_role' and not exists (
    select 1
    from public.driver_profiles driver
    where driver.id = resolved_driver_profile_id
      and (
        driver.user_id = auth.uid()
        or public.has_permission('platform.drivers.read', driver.organization_id)
        or public.has_permission('platform.drivers.manage', driver.organization_id)
      )
  ) then
    raise exception using errcode = '42501', message = 'Driver service areas are not available to this account';
  end if;

  return query
  select
    assignment.driver_profile_id,
    assignment.service_area_id,
    area.display_name,
    area.area_type,
    assignment.is_primary,
    area.state_name,
    area.lga_name,
    area.city_name,
    area.town_name,
    area.locality_name,
    assignment.effective_from
  from public.driver_service_areas assignment
  join public.service_areas area on area.id = assignment.service_area_id
  where assignment.driver_profile_id = resolved_driver_profile_id
    and assignment.status = 'active'
    and area.status = 'active'
  order by assignment.is_primary desc, area.display_name;
end;
$$;

revoke all on function public.read_driver_service_areas(uuid) from public, anon;
grant execute on function public.read_driver_service_areas(uuid) to authenticated, service_role;

drop trigger if exists application_location_verifications_set_updated_at on public.application_location_verifications;
create trigger application_location_verifications_set_updated_at
before update on public.application_location_verifications
for each row execute function public.set_updated_at();

drop trigger if exists application_service_area_selections_set_updated_at on public.application_service_area_selections;
create trigger application_service_area_selections_set_updated_at
before update on public.application_service_area_selections
for each row execute function public.set_updated_at();

drop trigger if exists driver_service_areas_set_updated_at on public.driver_service_areas;
create trigger driver_service_areas_set_updated_at
before update on public.driver_service_areas
for each row execute function public.set_updated_at();

do $$
declare
  version_id uuid;
begin
  for version_id in
    select version.id
    from public.application_versions version
    join public.application_records application on application.id = version.application_id
    join public.application_type_definitions application_type on application_type.id = application.application_type_id
    where application_type.metadata ->> 'bounded_context' = 'lpg'
      and application_type.metadata ->> 'workspace' in ('driver','station')
  loop
    perform public.sync_application_geography_for_version(version_id);
  end loop;
end;
$$;