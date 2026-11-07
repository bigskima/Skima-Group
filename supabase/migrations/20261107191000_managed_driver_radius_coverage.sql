begin;

-- Managed LPG drivers may use a verified mapped geography OR a real dispatch
-- centre with a radius. The radius path uses the shared operational coverage
-- engine and retains the existing approved-driver/program/permission gates.

create or replace function public.read_lpg_managed_driver_service_areas(
  target_driver_profile_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  result jsonb;
begin
  if target_driver_profile_id is null then
    raise exception using errcode = '22023', message = 'Driver is required';
  end if;

  if coalesce(auth.role(), '') <> 'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.drivers.read', null)
    and not public.has_permission('platform.drivers.manage', null)
    and not public.has_permission('platform.coverage.read', null)
    and not public.has_permission('platform.coverage.manage', null)
    and not public.can_manage_lpg_operations() then
    raise exception using errcode = '42501', message = 'Driver coverage read permission is required';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'serviceAreaKey', coalesce(
        assignment.metadata->>'managedDriverServiceAreaKey',
        assignment.metadata->>'serviceAreaKey',
        'coverage:' || assignment.id::text
      ),
      'label', coalesce(
        assignment.metadata->>'managedDriverServiceAreaLabel',
        assignment.metadata->>'serviceAreaName',
        geography.canonical_name,
        case when assignment.coverage_type = 'RADIUS' then 'Custom radius coverage' else 'Managed service area' end
      ),
      'isPrimary', case
        when assignment.metadata->>'managedDriverServiceAreaPrimary' in ('true','false')
          then (assignment.metadata->>'managedDriverServiceAreaPrimary')::boolean
        when assignment.metadata->>'isPrimary' in ('true','false')
          then (assignment.metadata->>'isPrimary')::boolean
        else false
      end,
      'effectiveFrom', coalesce(assignment.valid_from, assignment.created_at),
      'coverageAssignmentId', assignment.id,
      'coverageType', assignment.coverage_type,
      'centerLatitude', case when assignment.center_point is not null
        then extensions.st_y(assignment.center_point::extensions.geometry) end,
      'centerLongitude', case when assignment.center_point is not null
        then extensions.st_x(assignment.center_point::extensions.geometry) end,
      'radiusMeters', assignment.radius_meters
    )
    order by
      case
        when assignment.metadata->>'managedDriverServiceAreaPrimary' = 'true'
          or assignment.metadata->>'isPrimary' = 'true' then 0
        else 1
      end,
      coalesce(
        assignment.metadata->>'managedDriverServiceAreaLabel',
        assignment.metadata->>'serviceAreaName',
        geography.canonical_name,
        assignment.id::text
      )
  ), '[]'::jsonb)
  into result
  from public.operational_coverage_assignments assignment
  left join public.geographies geography on geography.id = assignment.geography_id
  where assignment.entity_type = 'DRIVER'
    and assignment.entity_id = target_driver_profile_id
    and assignment.service_key = 'lpg'
    and assignment.status = 'active'
    and assignment.approved_at is not null
    and (assignment.valid_from is null or assignment.valid_from <= timezone('utc', now()))
    and (assignment.valid_to is null or assignment.valid_to > timezone('utc', now()))
    and (
      assignment.metadata->>'managedDriverSetup' = 'true'
      or coalesce(
        assignment.metadata->>'managedDriverServiceAreaKey',
        assignment.metadata->>'serviceAreaKey'
      ) is not null
    );

  return result;
end;
$$;

create or replace function public.set_lpg_managed_driver_radius_coverage(
  target_driver_profile_id uuid,
  target_coverage_assignment_id uuid,
  target_active boolean,
  target_primary boolean,
  target_center_latitude double precision,
  target_center_longitude double precision,
  target_radius_meters numeric,
  target_reason text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $function$
declare
  driver_record public.driver_profiles%rowtype;
  coverage_record public.operational_coverage_assignments%rowtype;
  managed_key text;
  coverage_assignment_id uuid;
  service_area_label text;
  service_area_key text;
  center_latitude double precision;
  center_longitude double precision;
  radius_value numeric;
  effective_reason text;
  effective_metadata jsonb;
  retire_valid_from timestamptz;
  retire_valid_to timestamptz;
  assignment_found boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.coverage.manage', null)
    and not public.has_permission('platform.drivers.manage', null)
    and not public.can_manage_lpg_operations() then
    raise exception using errcode = '42501', message = 'coverage management permission is required';
  end if;

  if target_driver_profile_id is null
    or target_active is null
    or target_primary is null
    or nullif(btrim(target_idempotency_key), '') is null
    or target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception using errcode = '22023', message = 'Driver, coverage state, idempotency key and object metadata are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    target_driver_profile_id::text || ':' || target_idempotency_key,
    0
  ));

  select * into driver_record
  from public.driver_profiles
  where id = target_driver_profile_id
  for update;
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

  if target_coverage_assignment_id is not null then
    select * into coverage_record
    from public.operational_coverage_assignments assignment
    where assignment.id = target_coverage_assignment_id
      and assignment.entity_type = 'DRIVER'
      and assignment.entity_id = driver_record.id
      and assignment.service_key = 'lpg'
      and assignment.coverage_type = 'RADIUS'
      and assignment.metadata->>'managedDriverSetup' = 'true'
    for update;
    if not found then
      raise exception using errcode = '22023', message = 'Managed Driver radius assignment was not found';
    end if;
    assignment_found := true;
    coverage_assignment_id := coverage_record.id;
  elsif target_active then
    select * into coverage_record
    from public.operational_coverage_assignments assignment
    where assignment.entity_type = 'DRIVER'
      and assignment.entity_id = driver_record.id
      and assignment.service_key = 'lpg'
      and assignment.coverage_type = 'RADIUS'
      and assignment.status = 'active'
      and assignment.metadata->>'managedDriverSetup' = 'true'
      and assignment.metadata->>'idempotencyKey' = target_idempotency_key
    order by assignment.updated_at desc
    limit 1
    for update;
    assignment_found := found;
    if assignment_found then coverage_assignment_id := coverage_record.id; end if;
  end if;

  if target_active then
    if target_center_latitude is null or target_center_longitude is null
      or target_center_latitude < -90 or target_center_latitude > 90
      or target_center_longitude < -180 or target_center_longitude > 180
      or target_radius_meters is null or target_radius_meters <= 0
      or target_radius_meters > 1000000 then
      raise exception using errcode = '22023', message = 'Radius coverage requires valid centre coordinates and a radius up to 1,000 km';
    end if;
    center_latitude := target_center_latitude;
    center_longitude := target_center_longitude;
    radius_value := target_radius_meters;
  else
    if not assignment_found then
      return jsonb_build_object(
        'driverProfileId', driver_record.id,
        'active', false,
        'primary', false,
        'coverageAssignmentId', null
      );
    end if;
    if coverage_record.status <> 'active' then
      return jsonb_build_object(
        'driverProfileId', driver_record.id,
        'active', false,
        'primary', false,
        'coverageAssignmentId', coverage_record.id
      );
    end if;
    center_latitude := extensions.st_y(coverage_record.center_point::extensions.geometry);
    center_longitude := extensions.st_x(coverage_record.center_point::extensions.geometry);
    radius_value := coverage_record.radius_meters;
  end if;

  service_area_label := coalesce(
    nullif(btrim(target_metadata->>'label'), ''),
    coverage_record.metadata->>'managedDriverServiceAreaLabel',
    'Custom radius coverage'
  );
  if char_length(service_area_label) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'Coverage label must be between 2 and 120 characters';
  end if;

  service_area_key := coalesce(
    coverage_record.metadata->>'managedDriverServiceAreaKey',
    'radius:' || md5(driver_record.id::text || ':' || target_idempotency_key)
  );
  effective_reason := coalesce(
    nullif(btrim(target_reason), ''),
    case when target_active
      then 'Added ' || service_area_label || ' to SKIMA Managed Driver radius coverage.'
      else 'Removed ' || service_area_label || ' from SKIMA Managed Driver radius coverage.'
    end
  );
  effective_metadata := coalesce(coverage_record.metadata, '{}'::jsonb)
    || target_metadata
    || jsonb_build_object(
      'source', 'skima_managed_driver_setup',
      'surface', 'managed_driver_coverage',
      'managedDriverSetup', true,
      'managedDriverCoverageType', 'RADIUS',
      'managedDriverServiceAreaKey', service_area_key,
      'managedDriverServiceAreaLabel', service_area_label,
      'managedDriverServiceAreaPrimary', case when target_active then target_primary else false end,
      'isPrimary', case when target_active then target_primary else false end,
      'idempotencyKey', target_idempotency_key
    );

  if target_active and target_primary then
    update public.operational_coverage_assignments other_assignment
    set metadata = jsonb_set(
      jsonb_set(coalesce(other_assignment.metadata, '{}'::jsonb), '{managedDriverServiceAreaPrimary}', 'false'::jsonb, true),
      '{isPrimary}', 'false'::jsonb, true
    ),
    updated_at = timezone('utc', now())
    where other_assignment.entity_type = 'DRIVER'
      and other_assignment.entity_id = driver_record.id
      and other_assignment.service_key = 'lpg'
      and other_assignment.status = 'active'
      and other_assignment.id is distinct from coverage_assignment_id
      and other_assignment.metadata->>'managedDriverSetup' = 'true';
  end if;

  if target_active then
    coverage_assignment_id := public.configure_operational_coverage_assignment(
      coverage_assignment_id, 'DRIVER', driver_record.id, 'lpg', 'RADIUS',
      null, center_longitude, center_latitude, radius_value, null,
      'active', timezone('utc', now()), null, effective_reason, effective_metadata
    );
  else
    retire_valid_from := coalesce(coverage_record.valid_from, coverage_record.created_at, timezone('utc', now()));
    retire_valid_to := greatest(timezone('utc', now()), retire_valid_from + interval '1 microsecond');
    effective_metadata := effective_metadata || jsonb_build_object(
      'deactivatedReason', effective_reason,
      'deactivatedAt', timezone('utc', now()),
      'managedDriverServiceAreaPrimary', false,
      'isPrimary', false
    );
    coverage_assignment_id := public.configure_operational_coverage_assignment(
      coverage_assignment_id, 'DRIVER', driver_record.id, 'lpg', 'RADIUS',
      null, center_longitude, center_latitude, radius_value, null,
      'retired', retire_valid_from, retire_valid_to, effective_reason, effective_metadata
    );
  end if;

  return jsonb_build_object(
    'driverProfileId', driver_record.id,
    'serviceAreaKey', service_area_key,
    'serviceAreaLabel', service_area_label,
    'active', target_active,
    'primary', case when target_active then target_primary else false end,
    'coverageAssignmentId', coverage_assignment_id,
    'coverageType', 'RADIUS',
    'centerLatitude', center_latitude,
    'centerLongitude', center_longitude,
    'radiusMeters', radius_value
  );
end;
$function$;

revoke all on function public.set_lpg_managed_driver_radius_coverage(
  uuid, uuid, boolean, boolean, double precision, double precision, numeric, text, text, jsonb
) from public, anon;
grant execute on function public.set_lpg_managed_driver_radius_coverage(
  uuid, uuid, boolean, boolean, double precision, double precision, numeric, text, text, jsonb
) to authenticated, service_role;

commit;
