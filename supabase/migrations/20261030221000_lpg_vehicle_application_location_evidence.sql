begin;

-- A vehicle application belongs to the driver's operating workspace, but its
-- service coverage is inherited from the already-approved driver profile.
-- Vehicle approval still requires its own version-bound location evidence;
-- only driver onboarding applications must submit driver coverage requests.
create or replace function public.enforce_lpg_partner_location_before_approval()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  application_type_record record;
  active_version_id uuid;
  workspace_key text;
  location_purpose_key text;
  coverage_request_count integer := 0;
  invalid_geography_count integer := 0;
begin
  if new.status <> 'approved' or old.status is not distinct from new.status then
    return new;
  end if;

  select application_type.*
  into application_type_record
  from public.application_type_definitions application_type
  where application_type.id = new.application_type_id;

  if not found
     or coalesce(application_type_record.metadata ->> 'bounded_context', '') <> 'lpg' then
    return new;
  end if;

  workspace_key := application_type_record.metadata ->> 'workspace';
  if workspace_key not in ('driver', 'station') then
    return new;
  end if;

  select version.id
  into active_version_id
  from public.application_versions version
  where version.application_id = new.id
    and version.version = new.active_version;

  if active_version_id is null then
    raise exception using errcode = '23514',
      message = 'The current application version could not be verified.';
  end if;

  location_purpose_key := case workspace_key
    when 'driver' then 'driver.base_location'
    when 'station' then 'station.facility_location'
  end;

  if not exists (
    select 1
    from public.application_location_verifications verification
    where verification.application_id = new.id
      and verification.application_version_id = active_version_id
      and verification.location_purpose = location_purpose_key
      and verification.status = 'verified'
  ) then
    raise exception using errcode = '23514',
      message = case
        when workspace_key = 'driver'
          and application_type_record.application_category = 'vehicle'
          then 'Verify the vehicle operating location in Admin Location Review before approving this application.'
        when workspace_key = 'driver'
          then 'Verify the driver operating location before approving this application.'
        else 'Verify the station facility location before approving this application.'
      end;
  end if;

  -- Coverage belongs to the driver profile application, not every vehicle
  -- later registered by that approved driver. Vehicle applications require
  -- their own verified operating-location evidence above, but must not create
  -- duplicate service-coverage assignments.
  if workspace_key = 'driver'
     and application_type_record.application_category = 'driver' then
    select count(*)
    into coverage_request_count
    from public.application_operational_coverage_requests request
    where request.application_id = new.id
      and request.application_version_id = active_version_id
      and request.entity_type = 'DRIVER'
      and request.service_key = 'lpg'
      and request.status in ('REQUESTED', 'APPROVED');

    if coverage_request_count < 1 then
      raise exception using errcode = '23514',
        message = 'Choose at least one driver service geography before approving this application.';
    end if;

    select count(*)
    into invalid_geography_count
    from public.application_operational_coverage_requests request
    left join public.geographies geography on geography.id = request.geography_id
    where request.application_id = new.id
      and request.application_version_id = active_version_id
      and request.entity_type = 'DRIVER'
      and request.service_key = 'lpg'
      and request.status in ('REQUESTED', 'APPROVED')
      and request.coverage_type = 'ADMIN_GEOGRAPHY'
      and (
        geography.id is null
        or geography.status <> 'active'
        or geography.boundary_geometry is null
        or not extensions.st_isvalid(geography.boundary_geometry::extensions.geometry)
      );

    if invalid_geography_count > 0 then
      raise exception using errcode = '23514',
        message = 'One or more requested driver service geographies are no longer active or bounded. Update the application before approval.';
    end if;
  end if;

  return new;
end;
$$;

-- Applicants may add or correct only the operating-location evidence on a
-- submitted/under-review LPG vehicle application. Vehicle details, documents,
-- owner, driver identity and workflow status remain unchanged. A new
-- application version is created so Admin's location decision is bound to
-- the exact evidence version later approved.
create or replace function public.update_lpg_vehicle_application_location(
  target_application_id uuid,
  target_location jsonb,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  application_record record;
  application_type_record record;
  current_version record;
  existing_version_id uuid;
  next_version integer;
  next_version_id uuid;
  latitude_text text;
  longitude_text text;
  accuracy_text text;
  recorded_at_text text;
  latitude_value double precision;
  longitude_value double precision;
  accuracy_value double precision;
  recorded_at_value timestamptz;
  location_payload jsonb;
  next_payload jsonb;
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authenticated user context is required';
  end if;

  if target_application_id is null then
    raise exception using errcode = '22023', message = 'Application is required';
  end if;

  if target_location is null or jsonb_typeof(target_location) <> 'object' then
    raise exception using errcode = '22023', message = 'Operating location must be a JSON object';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception using errcode = '22023', message = 'Location update metadata must be a JSON object';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception using errcode = '22023', message = 'Idempotency key is required';
  end if;

  select application.*
  into application_record
  from public.application_records application
  where application.id = target_application_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Vehicle application was not found';
  end if;

  if auth.role() <> 'service_role'
     and application_record.applicant_user_id <> auth.uid() then
    raise exception using errcode = '42501', message = 'Only the applicant can update this vehicle location';
  end if;

  select application_type.*
  into application_type_record
  from public.application_type_definitions application_type
  where application_type.id = application_record.application_type_id;

  if not found
     or application_type_record.application_category <> 'vehicle'
     or application_type_record.key <> 'application.lpg.vehicle.phase-one'
     or coalesce(application_type_record.metadata ->> 'bounded_context', '') <> 'lpg'
     or coalesce(application_type_record.metadata ->> 'workspace', '') <> 'driver' then
    raise exception using errcode = '22023', message = 'This location update is only available for an LPG independent-driver vehicle application';
  end if;

  if application_record.status not in (
    'draft',
    'incomplete',
    'additional_info_required',
    'resubmitted',
    'submitted',
    'under_review'
  ) then
    raise exception using errcode = '55000', message = 'This vehicle application can no longer accept a location update';
  end if;

  if exists (
    select 1
    from public.application_versions version
    where version.application_id = target_application_id
      and version.idempotency_key = target_idempotency_key
  ) then
    return target_application_id;
  end if;

  select version.*
  into current_version
  from public.application_versions version
  where version.application_id = target_application_id
    and version.version = application_record.active_version
  for update;

  if not found then
    raise exception using errcode = '23514', message = 'The active vehicle application version could not be found';
  end if;

  latitude_text := nullif(target_location ->> 'latitude', '');
  longitude_text := nullif(target_location ->> 'longitude', '');

  if latitude_text is null or longitude_text is null
     or latitude_text !~ '^-?[0-9]+([.][0-9]+)?$'
     or longitude_text !~ '^-?[0-9]+([.][0-9]+)?$' then
    raise exception using errcode = '22023', message = 'Operating location must contain valid GPS coordinates';
  end if;

  latitude_value := latitude_text::double precision;
  longitude_value := longitude_text::double precision;
  if latitude_value < -90 or latitude_value > 90
     or longitude_value < -180 or longitude_value > 180 then
    raise exception using errcode = '22023', message = 'Operating location coordinates are outside the valid range';
  end if;

  accuracy_text := nullif(target_location ->> 'accuracyMeters', '');
  if accuracy_text is not null then
    if accuracy_text !~ '^[0-9]+([.][0-9]+)?$' then
      raise exception using errcode = '22023', message = 'GPS accuracy is invalid';
    end if;
    accuracy_value := accuracy_text::double precision;
  else
    accuracy_value := null;
  end if;

  recorded_at_text := nullif(target_location ->> 'recordedAt', '');
  if recorded_at_text is not null then
    begin
      recorded_at_value := recorded_at_text::timestamptz;
    exception when others then
      recorded_at_value := null;
    end;
  end if;

  location_payload := jsonb_build_object(
    'latitude', latitude_value,
    'longitude', longitude_value,
    'accuracyMeters', accuracy_value,
    'recordedAt', coalesce(recorded_at_value, timezone('utc', now())),
    'formattedAddress', coalesce(nullif(btrim(target_location ->> 'formattedAddress'), ''), 'GPS location captured'),
    'providerPlaceId', nullif(btrim(target_location ->> 'providerPlaceId'), ''),
    'providerSource', coalesce(nullif(btrim(target_location ->> 'providerSource'), ''), 'device_coordinates'),
    'address', case
      when jsonb_typeof(target_location -> 'address') = 'object' then target_location -> 'address'
      else '{}'::jsonb
    end
  );

  next_version := application_record.active_version + 1;
  next_payload := jsonb_set(
    current_version.payload,
    '{location}',
    location_payload,
    true
  );

  update public.application_versions
  set status = 'superseded',
      updated_at = timezone('utc', now())
  where id = current_version.id;

  insert into public.application_versions (
    application_id,
    version,
    payload,
    status,
    idempotency_key,
    created_by
  )
  values (
    target_application_id,
    next_version,
    next_payload,
    case when application_record.status in ('submitted', 'under_review') then 'submitted' else 'draft' end,
    btrim(target_idempotency_key),
    auth.uid()
  )
  returning id into next_version_id;

  -- This helper creates the pending application_location_verifications row
  -- for driver.base_location, keyed to the new vehicle application version.
  perform public.sync_application_geography_for_version(next_version_id);

  update public.application_records
  set active_version = next_version,
      updated_at = timezone('utc', now())
  where id = target_application_id;

  insert into public.application_events (
    application_id,
    event_type_key,
    from_status,
    to_status,
    actor_user_id,
    idempotency_key,
    metadata
  )
  values (
    target_application_id,
    'event.application.updated',
    application_record.status,
    application_record.status,
    auth.uid(),
    btrim(target_idempotency_key) || ':location-updated',
    target_metadata || jsonb_build_object(
      'locationSupplement', true,
      'applicationVersion', next_version
    )
  )
  on conflict do nothing;

  return target_application_id;
end;
$$;

revoke all on function public.update_lpg_vehicle_application_location(uuid,jsonb,text,jsonb) from public, anon;
grant execute on function public.update_lpg_vehicle_application_location(uuid,jsonb,text,jsonb) to authenticated, service_role;

comment on function public.update_lpg_vehicle_application_location(uuid,jsonb,text,jsonb) is
  'Allows an LPG vehicle applicant to append only version-bound operating-location evidence without modifying submitted vehicle details or bypassing Admin location review.';

commit;
