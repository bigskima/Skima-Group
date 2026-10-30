begin;

CREATE OR REPLACE FUNCTION public.review_application_coverage_request(p_request_id uuid, p_decision text, p_reason text, p_valid_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_valid_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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

  if p_decision is null
     or p_decision not in ('APPROVED', 'REJECTED')
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

  if p_decision = 'APPROVED' then
    select *
    into app
    from public.application_records
    where id = request.application_id;

    if not found then
      raise exception using errcode = '23503', message = 'coverage request application was not found';
    end if;

    if request.entity_type = 'DRIVER' then
      target_entity_id := app.activated_subject_id;
      if target_entity_id is null then
        raise exception using errcode = '23514',
          message = 'driver application must be activated before coverage approval';
      end if;
    elsif request.entity_type = 'STATION' then
      select count(*), min(station.id)
      into station_count, target_entity_id
      from public.lpg_station_branches station
      where station.organization_id = app.organization_id;

      if station_count <> 1 then
        raise exception using errcode = '23514',
          message = 'station application must resolve to exactly one station branch before coverage approval';
      end if;
    else
      raise exception using errcode = '23514', message = 'unsupported coverage request entity type';
    end if;
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
    values (
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
    )
    returning id into assignment_id;
  end if;

  return assignment_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.read_lpg_managed_driver_service_areas(target_driver_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  result jsonb;
begin
  if target_driver_profile_id is null then
    raise exception using errcode = '22023', message = 'Driver is required';
  end if;

  if auth.role() <> 'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.drivers.read', null)
    and not public.has_permission('platform.drivers.manage', null)
    and not public.has_permission('platform.coverage.read', null)
    and not public.has_permission('platform.coverage.manage', null)
    and not public.can_manage_lpg_operations() then
    raise exception using errcode = '42501', message = 'Driver coverage read permission is required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'serviceAreaKey', area.key,
    'label', area.display_name,
    'isPrimary', assignment.is_primary,
    'effectiveFrom', assignment.effective_from
  ) order by assignment.is_primary desc, area.display_name), '[]'::jsonb)
  into result
  from public.driver_service_areas assignment
  join public.service_areas area on area.id = assignment.service_area_id
  where assignment.driver_profile_id = target_driver_profile_id
    and assignment.status = 'active'
    and area.status = 'active';

  return result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_lpg_managed_driver_service_area(target_driver_profile_id uuid, target_service_area_key text, target_active boolean, target_primary boolean, target_reason text, target_idempotency_key text, target_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  driver_record public.driver_profiles%rowtype;
  service_area public.service_areas%rowtype;
  geography_id uuid;
  coverage_assignment_id uuid;
  managed_key text;
  effective_reason text;
begin
  if auth.role() <> 'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.coverage.manage', null)
    and not public.has_permission('platform.drivers.manage', null) then
    raise exception using errcode = '42501', message = 'coverage management permission is required';
  end if;

  if target_driver_profile_id is null or coalesce(btrim(target_service_area_key), '') = '' then
    raise exception using errcode = '22023', message = 'Driver and service area are required';
  end if;
  if target_active is null or target_primary is null then
    raise exception using errcode = '22023', message = 'coverage state is required';
  end if;
  if coalesce(btrim(target_idempotency_key), '') = '' then
    raise exception using errcode = '22023', message = 'idempotency key is required';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception using errcode = '22023', message = 'metadata must be an object';
  end if;

  select * into driver_record
  from public.driver_profiles
  where id = target_driver_profile_id;
  if not found then
    raise exception using errcode = '22023', message = 'Driver profile was not found';
  end if;
  if driver_record.verification_status <> 'approved' then
    raise exception using errcode = '55000', message = 'Only an approved Driver can receive managed coverage';
  end if;

  managed_key := coalesce(
    public.lpg_policy_config('lpg.fulfillment.launch_assurance')->>'internal_driver_program_key',
    'driver.skima_special'
  );
  if not exists (
    select 1
    from public.driver_program_memberships membership
    where membership.driver_profile_id = driver_record.id
      and membership.program_key = managed_key
      and membership.status = 'active'
      and membership.starts_at <= timezone('utc', now())
      and (membership.ends_at is null or membership.ends_at > timezone('utc', now()))
  ) then
    raise exception using errcode = '55000', message = 'Driver must first be added as a SKIMA Managed Driver';
  end if;

  select * into service_area
  from public.service_areas
  where key = target_service_area_key
    and status = 'active';
  if not found then
    raise exception using errcode = '22023', message = 'Service area was not found';
  end if;

  effective_reason := coalesce(
    nullif(btrim(target_reason), ''),
    case when target_active
      then 'Added ' || service_area.display_name || ' to Managed Driver coverage by an authorized administrator.'
      else 'Removed ' || service_area.display_name || ' from Managed Driver coverage by an authorized administrator.'
    end
  );

  select mapping.geography_id into geography_id
  from public.geography_migration_mappings mapping
  join public.geographies geography on geography.id = mapping.geography_id
  where mapping.legacy_source = 'service_areas'
    and mapping.legacy_id = service_area.id
    and mapping.migration_status = 'verified'
    and geography.status = 'active'
    and geography.boundary_geometry is not null
  order by mapping.verified_at desc nulls last, mapping.created_at desc
  limit 1;

  if geography_id is null then
    raise exception using errcode = '55000',
      message = 'This service area does not yet have a verified map boundary. Complete its service-area map setup first.';
  end if;

  select coverage.id into coverage_assignment_id
  from public.operational_coverage_assignments coverage
  where coverage.entity_type = 'DRIVER'
    and coverage.entity_id = driver_record.id
    and coverage.service_key = 'lpg'
    and coverage.metadata->>'managedDriverServiceAreaKey' = service_area.key
  order by coverage.updated_at desc
  limit 1;

  if target_active then
    if target_primary then
      update public.driver_service_areas
      set is_primary = false,
          updated_at = timezone('utc', now())
      where driver_profile_id = driver_record.id
        and status = 'active';
    end if;

    insert into public.driver_service_areas (
      driver_profile_id, service_area_id, is_primary, status, approved_by,
      effective_from, effective_until, metadata
    ) values (
      driver_record.id, service_area.id, target_primary, 'active', auth.uid(),
      timezone('utc', now()), null,
      target_metadata || jsonb_build_object(
        'source', 'skima_managed_driver_setup',
        'serviceAreaKey', service_area.key
      )
    )
    on conflict (driver_profile_id, service_area_id) do update
    set is_primary = excluded.is_primary,
        status = 'active',
        approved_by = auth.uid(),
        effective_from = timezone('utc', now()),
        effective_until = null,
        metadata = public.driver_service_areas.metadata || excluded.metadata,
        updated_at = timezone('utc', now());

    coverage_assignment_id := public.configure_operational_coverage_assignment(
      coverage_assignment_id, 'DRIVER', driver_record.id, 'lpg', 'ADMIN_GEOGRAPHY', geography_id,
      null, null, null, null, 'active', timezone('utc', now()), null, effective_reason,
      target_metadata || jsonb_build_object(
        'managedDriverServiceAreaKey', service_area.key,
        'managedDriverServiceAreaLabel', service_area.display_name,
        'managedDriverSetup', true,
        'idempotencyKey', target_idempotency_key
      )
    );
  else
    update public.driver_service_areas
    set status = 'inactive',
        is_primary = false,
        effective_until = timezone('utc', now()),
        metadata = metadata || jsonb_build_object(
          'deactivatedReason', effective_reason,
          'deactivatedAt', timezone('utc', now())
        ),
        updated_at = timezone('utc', now())
    where driver_profile_id = driver_record.id
      and service_area_id = service_area.id
      and status = 'active';

    if coverage_assignment_id is not null then
      coverage_assignment_id := public.configure_operational_coverage_assignment(
        coverage_assignment_id, 'DRIVER', driver_record.id, 'lpg', 'ADMIN_GEOGRAPHY', geography_id,
        null, null, null, null, 'retired', null, timezone('utc', now()), effective_reason,
        target_metadata || jsonb_build_object(
          'managedDriverServiceAreaKey', service_area.key,
          'managedDriverServiceAreaLabel', service_area.display_name,
          'managedDriverSetup', true,
          'idempotencyKey', target_idempotency_key
        )
      );
    end if;
  end if;

  return jsonb_build_object(
    'driverProfileId', driver_record.id,
    'serviceAreaKey', service_area.key,
    'serviceAreaLabel', service_area.display_name,
    'active', target_active,
    'primary', case when target_active then target_primary else false end,
    'coverageAssignmentId', coverage_assignment_id
  );
end;
$function$
;

insert into public.configuration_entries (
  namespace, key, scope_type, scope_id, value, is_secret, status, version,
  effective_from, effective_until, created_by, updated_by
)
select
  'platform.maps', 'renderer_selection', 'global', null,
  jsonb_build_object(
    'active_renderer_key', 'renderer.maps.openstreetmap-standard',
    'display_name', 'OpenStreetMap Standard',
    'tile_url_template', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    'attribution', '© OpenStreetMap contributors',
    'attribution_url', 'https://www.openstreetmap.org/copyright',
    'minimum_zoom', 1, 'maximum_zoom', 19, 'default_zoom', 6,
    'default_center', jsonb_build_object('longitude', 8.6753, 'latitude', 9.082),
    'operational_tier', 'keyless_launch',
    'selection_source', 'platform_configuration',
    'public_client_safe', true
  ),
  false, 'active', coalesce(max(version), 0) + 1,
  null, null, null, null
from public.configuration_entries
where namespace = 'platform.maps'
  and key = 'renderer_selection'
  and scope_type = 'global'
  and scope_id is null;

commit;
