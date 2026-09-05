begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- The mobile driver application now writes universal service.coverageRequests.
-- Remove the superseded legacy serviceAreaIds/primaryServiceAreaId submission
-- requirements so the backend validates the same geography contract as mobile.
do $$
declare
  current_fields jsonb;
  reconciled_fields jsonb;
begin
  select coalesce(metadata -> 'submission_required_fields', '[]'::jsonb)
  into current_fields
  from public.application_type_definitions
  where key = 'application.lpg.driver.phase-one'
  for update;

  if current_fields is null then
    return;
  end if;

  select coalesce(jsonb_agg(item.value order by item.ordinality), '[]'::jsonb)
  into reconciled_fields
  from jsonb_array_elements(
    case when jsonb_typeof(current_fields) = 'array' then current_fields else '[]'::jsonb end
  ) with ordinality as item(value, ordinality)
  where item.value ->> 'path' not in (
    'service.serviceAreaIds',
    'service.primaryServiceAreaId'
  );

  if not exists (
    select 1
    from jsonb_array_elements(reconciled_fields) field(value)
    where field.value ->> 'path' = 'service.coverageRequests'
  ) then
    reconciled_fields := reconciled_fields || jsonb_build_array(
      jsonb_build_object(
        'path', 'service.coverageRequests',
        'step', 2,
        'label', 'Service coverage'
      )
    );
  end if;

  update public.application_type_definitions
  set metadata = jsonb_set(
        coalesce(metadata, '{}'::jsonb),
        '{submission_required_fields}',
        reconciled_fields,
        true
      ),
      updated_at = timezone('utc', now())
  where key = 'application.lpg.driver.phase-one';
end;
$$;

-- Keep verified location evidence as the approval gate, but validate the
-- universal coverage request projection instead of the retired legacy
-- application_service_area_selections table.
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
      message = case workspace_key
        when 'driver' then 'Verify the driver operating location before approving this application.'
        else 'Verify the station facility location before approving this application.'
      end;
  end if;

  if workspace_key = 'driver' then
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

-- Admin coverage review treats an active Super Admin as an authority even when
-- the role template has not separately materialized platform.coverage.manage.
create or replace function public.review_application_coverage_request(
  p_request_id uuid,
  p_decision text,
  p_reason text,
  p_valid_from timestamptz default null,
  p_valid_to timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  request record;
  app record;
  assignment_id uuid;
  target_entity_id uuid;
  station_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_platform_super_admin()
     and not public.has_permission('platform.coverage.manage', null) then
    raise exception using errcode = '42501', message = 'coverage management permission required';
  end if;

  if p_decision not in ('APPROVED', 'REJECTED')
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'decision and reason are required';
  end if;

  select *
  into request
  from public.application_operational_coverage_requests
  where id = p_request_id
    and status = 'REQUESTED'
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'requested coverage was not found';
  end if;

  select *
  into app
  from public.application_records
  where id = request.application_id;

  if request.entity_type = 'DRIVER' then
    target_entity_id := app.activated_subject_id;
  else
    select count(*), min(station.id)
    into station_count, target_entity_id
    from public.lpg_station_branches station
    where station.organization_id = app.organization_id;

    if station_count <> 1 then
      raise exception using errcode = '23514',
        message = 'station application must resolve to exactly one station branch before coverage approval';
    end if;
  end if;

  if target_entity_id is null then
    raise exception using errcode = '23514',
      message = 'application subject must be activated before coverage approval';
  end if;

  update public.application_operational_coverage_requests
  set status = p_decision,
      reviewed_by = auth.uid(),
      reviewed_at = timezone('utc', now()),
      review_reason = btrim(p_reason)
  where id = p_request_id;

  if p_decision = 'APPROVED' then
    insert into public.operational_coverage_assignments (
      entity_type,
      entity_id,
      service_key,
      coverage_type,
      geography_id,
      center_point,
      radius_meters,
      coverage_geometry,
      status,
      source,
      valid_from,
      valid_to,
      approved_by,
      approved_at,
      metadata
    )
    select
      request.entity_type,
      target_entity_id,
      request.service_key,
      request.coverage_type,
      request.geography_id,
      request.center_point,
      request.radius_meters,
      request.coverage_geometry,
      'active',
      'ADMIN_ASSIGNED',
      p_valid_from,
      p_valid_to,
      auth.uid(),
      timezone('utc', now()),
      jsonb_build_object(
        'applicationCoverageRequestId', request.id,
        'applicationId', request.application_id
      )
    returning id into assignment_id;
  end if;

  return assignment_id;
end;
$$;

-- The readiness repair action exposed in Admin must use the same Super Admin
-- authority semantics as the rest of the geography/coverage workspace.
create or replace function public.migrate_verified_operational_coverage()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  driver_count integer := 0;
  station_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_platform_super_admin()
     and not public.has_permission('platform.coverage.manage', null) then
    raise exception using errcode = '42501', message = 'coverage management permission required';
  end if;

  with inserted as (
    insert into public.operational_coverage_assignments (
      entity_type, entity_id, service_key, coverage_type, geography_id, status, source,
      valid_from, valid_to, approved_by, approved_at, metadata
    )
    select
      'DRIVER',
      legacy.driver_profile_id,
      'lpg',
      'ADMIN_GEOGRAPHY',
      mapping.geography_id,
      case legacy.status when 'active' then 'active' else 'retired' end,
      'SYSTEM_ASSIGNED',
      legacy.effective_from,
      legacy.effective_until,
      legacy.approved_by,
      coalesce(legacy.effective_from, legacy.created_at),
      jsonb_build_object(
        'legacyDriverServiceAreaId', legacy.id,
        'legacyPrimary', legacy.is_primary,
        'sourceApplicationId', legacy.source_application_id
      )
    from public.driver_service_areas legacy
    join public.geography_migration_mappings mapping
      on mapping.legacy_source = 'service_areas'
     and mapping.legacy_id = legacy.service_area_id
     and mapping.migration_status = 'verified'
    where not exists (
      select 1
      from public.operational_coverage_legacy_mappings old
      where old.legacy_source = 'driver_service_areas'
        and old.legacy_id = legacy.id
    )
    returning id, metadata
  )
  insert into public.operational_coverage_legacy_mappings (
    legacy_source, legacy_id, coverage_assignment_id, metadata
  )
  select
    'driver_service_areas',
    (metadata ->> 'legacyDriverServiceAreaId')::uuid,
    id,
    jsonb_build_object('migration', 'verified_geography')
  from inserted;
  get diagnostics driver_count = row_count;

  with inserted as (
    insert into public.operational_coverage_assignments (
      entity_type, entity_id, service_key, coverage_type, center_point, radius_meters,
      status, source, approved_at, metadata
    )
    select
      'STATION',
      station.id,
      'lpg',
      'RADIUS',
      extensions.st_setsrid(
        extensions.st_makepoint(station.longitude, station.latitude),
        4326
      )::extensions.geography,
      station.service_radius_meters,
      'active',
      'SYSTEM_ASSIGNED',
      timezone('utc', now()),
      jsonb_build_object('legacyStationBranchId', station.id)
    from public.lpg_station_branches station
    where station.latitude is not null
      and station.longitude is not null
      and station.service_radius_meters > 0
      and station.approval_status = 'approved'
      and not exists (
        select 1
        from public.operational_coverage_legacy_mappings old
        where old.legacy_source = 'lpg_station_branches'
          and old.legacy_id = station.id
      )
    returning id, metadata
  )
  insert into public.operational_coverage_legacy_mappings (
    legacy_source, legacy_id, coverage_assignment_id, metadata
  )
  select
    'lpg_station_branches',
    (metadata ->> 'legacyStationBranchId')::uuid,
    id,
    jsonb_build_object('migration', 'station_radius')
  from inserted;
  get diagnostics station_count = row_count;

  return jsonb_build_object(
    'driverAssignmentsMigrated', driver_count,
    'stationAssignmentsMigrated', station_count
  );
end;
$$;

revoke all on function public.enforce_lpg_partner_location_before_approval() from public, anon, authenticated;
grant execute on function public.enforce_lpg_partner_location_before_approval() to service_role;

revoke all on function public.review_application_coverage_request(uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.review_application_coverage_request(uuid, text, text, timestamptz, timestamptz) to authenticated, service_role;

revoke all on function public.migrate_verified_operational_coverage() from public, anon, authenticated;
grant execute on function public.migrate_verified_operational_coverage() to authenticated, service_role;

comment on function public.enforce_lpg_partner_location_before_approval() is
  'Requires verified driver/station location evidence and universal driver coverage requests before LPG partner approval.';
comment on function public.review_application_coverage_request(uuid, text, text, timestamptz, timestamptz) is
  'Reviews universal partner coverage requests after the application subject is activated; Super Admin and coverage managers are authorized.';
comment on function public.migrate_verified_operational_coverage() is
  'Idempotently migrates legacy driver service areas and approved station radii into universal operational coverage with Super Admin support.';

commit;
