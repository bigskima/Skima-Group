begin;

-- Map polygons remain optional for named LPG Managed Driver areas. When a
-- geography has no boundary, dispatch matches the customer's saved locality,
-- LGA and state hierarchy instead of treating a state as the selected locality.
create or replace function public.managed_driver_geography_matches_location(
  target_geography_id uuid,
  target_location_metadata jsonb,
  target_formatted_address text default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $function$
declare
  geography_record record;
  components jsonb := coalesce(
    target_location_metadata->'addressComponents',
    target_location_metadata->'address_components',
    '{}'::jsonb
  );
  snapshot jsonb := coalesce(
    target_location_metadata->'addressSnapshot',
    target_location_metadata->'address_snapshot',
    '{}'::jsonb
  );
  country_code_value text;
  country_name_value text;
  state_name_value text;
  lga_name_value text;
  locality_name_value text;
  sublocality_name_value text;
  normalized_address text;
  own_name_matches boolean := false;
  parent_name_matches boolean := false;
  grandparent_name_matches boolean := false;
begin
  if target_geography_id is null then
    return false;
  end if;

  select
    geography.id,
    geography.normalized_name,
    geography.country_code,
    level.key as level_key,
    parent.normalized_name as parent_normalized_name,
    parent_level.key as parent_level_key,
    grandparent.normalized_name as grandparent_normalized_name,
    grandparent_level.key as grandparent_level_key
  into geography_record
  from public.geographies geography
  join public.geography_levels level on level.id = geography.geography_level_id
  left join public.geographies parent on parent.id = geography.parent_id
  left join public.geography_levels parent_level on parent_level.id = parent.geography_level_id
  left join public.geographies grandparent on grandparent.id = parent.parent_id
  left join public.geography_levels grandparent_level on grandparent_level.id = grandparent.geography_level_id
  where geography.id = target_geography_id
    and geography.status = 'active'
    and level.status = 'active';

  if not found then
    return false;
  end if;

  country_code_value := upper(nullif(btrim(coalesce(
    snapshot->>'countryCode', snapshot->>'country_code',
    components->>'countryCode', components->>'country_code'
  )), ''));
  country_name_value := nullif(btrim(coalesce(snapshot->>'country', components->>'country')), '');
  state_name_value := nullif(btrim(coalesce(
    snapshot->>'state', snapshot->>'region',
    components->>'state', components->>'region'
  )), '');
  lga_name_value := nullif(btrim(coalesce(
    snapshot->>'lga', snapshot->>'district',
    components->>'lga', components->>'district'
  )), '');
  locality_name_value := nullif(btrim(coalesce(
    snapshot->>'city', snapshot->>'town', snapshot->>'locality',
    components->>'city', components->>'town', components->>'locality'
  )), '');
  sublocality_name_value := nullif(btrim(coalesce(
    snapshot->>'neighbourhood', snapshot->>'neighborhood',
    snapshot->>'subLocality', snapshot->>'sublocality', snapshot->>'village',
    components->>'neighbourhood', components->>'neighborhood',
    components->>'subLocality', components->>'sublocality', components->>'village'
  )), '');
  normalized_address := public.normalize_geography_token(coalesce(target_formatted_address, ''));

  if country_code_value is not null and country_code_value <> upper(geography_record.country_code) then
    return false;
  end if;
  if country_name_value is not null and geography_record.level_key = 'country'
     and public.normalize_geography_token(country_name_value) <> geography_record.normalized_name then
    return false;
  end if;

  own_name_matches := case geography_record.level_key
    when 'country' then
      (country_code_value is not null and country_code_value = upper(geography_record.country_code))
      or (country_name_value is not null and public.normalize_geography_token(country_name_value) = geography_record.normalized_name)
    when 'admin_level_1' then
      (state_name_value is not null and public.normalize_geography_token(state_name_value) = geography_record.normalized_name)
      or (
        state_name_value is null and normalized_address is not null
        and position(' ' || geography_record.normalized_name || ' ' in ' ' || normalized_address || ' ') > 0
      )
    when 'admin_level_2' then
      (lga_name_value is not null and public.normalize_geography_token(lga_name_value) = geography_record.normalized_name)
      or (
        lga_name_value is null and normalized_address is not null
        and position(' ' || geography_record.normalized_name || ' ' in ' ' || normalized_address || ' ') > 0
      )
    when 'locality' then
      (locality_name_value is not null and public.normalize_geography_token(locality_name_value) = geography_record.normalized_name)
      or (
        locality_name_value is null and normalized_address is not null
        and position(' ' || geography_record.normalized_name || ' ' in ' ' || normalized_address || ' ') > 0
      )
    when 'sublocality' then
      (sublocality_name_value is not null and public.normalize_geography_token(sublocality_name_value) = geography_record.normalized_name)
      or (
        sublocality_name_value is null and normalized_address is not null
        and position(' ' || geography_record.normalized_name || ' ' in ' ' || normalized_address || ' ') > 0
      )
    else false
  end;

  if not own_name_matches then
    return false;
  end if;

  parent_name_matches := case geography_record.parent_level_key
    when 'admin_level_1' then
      (state_name_value is not null and public.normalize_geography_token(state_name_value) = geography_record.parent_normalized_name)
      or (
        state_name_value is null and normalized_address is not null
        and position(' ' || geography_record.parent_normalized_name || ' ' in ' ' || normalized_address || ' ') > 0
      )
    when 'admin_level_2' then
      (lga_name_value is not null and public.normalize_geography_token(lga_name_value) = geography_record.parent_normalized_name)
      or (
        lga_name_value is null and normalized_address is not null
        and position(' ' || geography_record.parent_normalized_name || ' ' in ' ' || normalized_address || ' ') > 0
      )
    when 'locality' then
      (locality_name_value is not null and public.normalize_geography_token(locality_name_value) = geography_record.parent_normalized_name)
      or (
        locality_name_value is null and normalized_address is not null
        and position(' ' || geography_record.parent_normalized_name || ' ' in ' ' || normalized_address || ' ') > 0
      )
    else false
  end;

  grandparent_name_matches := case geography_record.grandparent_level_key
    when 'admin_level_1' then
      (state_name_value is not null and public.normalize_geography_token(state_name_value) = geography_record.grandparent_normalized_name)
      or (
        state_name_value is null and normalized_address is not null
        and position(' ' || geography_record.grandparent_normalized_name || ' ' in ' ' || normalized_address || ' ') > 0
      )
    else false
  end;

  -- The area name must match its own level. Where a parent or state is available
  -- in the saved address, it must also agree with the selected hierarchy.
  if geography_record.level_key = 'admin_level_2'
     and geography_record.parent_level_key = 'admin_level_1'
     and (state_name_value is not null or normalized_address is not null)
     and not parent_name_matches then
    return false;
  end if;

  if geography_record.level_key = 'locality' then
    if geography_record.parent_level_key = 'admin_level_2' then
      if lga_name_value is not null and not parent_name_matches then
        return false;
      end if;
      if lga_name_value is null and state_name_value is null and normalized_address is null then
        return false;
      end if;
      if state_name_value is not null and geography_record.grandparent_level_key = 'admin_level_1'
         and not grandparent_name_matches then
        return false;
      end if;
      if state_name_value is null and geography_record.grandparent_level_key = 'admin_level_1'
         and normalized_address is not null and not grandparent_name_matches then
        return false;
      end if;
    elsif geography_record.parent_level_key = 'admin_level_1' then
      if state_name_value is not null and not parent_name_matches then
        return false;
      end if;
    end if;
  end if;

  if geography_record.level_key = 'sublocality' then
    if geography_record.parent_level_key = 'locality'
       and locality_name_value is not null and not parent_name_matches then
      return false;
    end if;
  end if;

  return true;
end
$function$;

revoke all on function public.managed_driver_geography_matches_location(uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.managed_driver_geography_matches_location(uuid,jsonb,text) to service_role;


CREATE OR REPLACE FUNCTION public.configure_operational_coverage_assignment(p_assignment_id uuid, p_entity_type text, p_entity_id uuid, p_service_key text, p_coverage_type text, p_geography_id uuid, p_center_longitude double precision, p_center_latitude double precision, p_radius_meters numeric, p_coverage_geojson jsonb, p_status text, p_valid_from timestamp with time zone, p_valid_to timestamp with time zone, p_reason text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  existing public.operational_coverage_assignments%rowtype;
  saved public.operational_coverage_assignments%rowtype;
  center extensions.geography(Point, 4326);
  polygon extensions.geography(MultiPolygon, 4326);
  event_type text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_permission('platform.coverage.manage', null)
     and not public.is_platform_super_admin()
     and not (
       p_entity_type = 'DRIVER'
       and p_service_key = 'lpg'
       and (
         public.has_permission('platform.drivers.manage', null)
         or public.can_manage_lpg_operations()
       )
     ) then
    raise exception using errcode = '42501', message = 'coverage management permission required';
  end if;

  if p_entity_type !~ '^[A-Z][A-Z0-9_]{1,79}$' or p_entity_id is null
     or p_service_key !~ '^[a-z][a-z0-9_.:-]{2,120}$'
     or p_coverage_type not in ('ADMIN_GEOGRAPHY','RADIUS','CUSTOM_ZONE')
     or p_status not in ('active','paused','retired')
     or nullif(btrim(p_reason), '') is null
     or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object'
     or (p_valid_from is not null and p_valid_to is not null and p_valid_to <= p_valid_from) then
    raise exception using errcode = '22023', message = 'valid coverage fields and a change reason are required';
  end if;

  if p_coverage_type = 'ADMIN_GEOGRAPHY' then
    if p_geography_id is null or p_center_longitude is not null or p_center_latitude is not null
       or p_radius_meters is not null or p_coverage_geojson is not null
       or not exists(
         select 1
         from public.geographies geography
         join public.geography_levels level on level.id = geography.geography_level_id
         where geography.id = p_geography_id
           and geography.status = 'active'
           and (
             geography.boundary_geometry is not null
             or (
               p_entity_type = 'DRIVER'
               and p_service_key = 'lpg'
               and coalesce(p_metadata->>'managedDriverSetup','false') = 'true'
               and level.status = 'active'
               and level.is_service_selectable = true
             )
           )
       ) then
      raise exception using errcode = '22023', message = 'administrative coverage requires one active bounded geography';
    end if;
  elsif p_coverage_type = 'RADIUS' then
    if p_geography_id is not null or p_coverage_geojson is not null or p_radius_meters is null or p_radius_meters <= 0
       or p_radius_meters > 1000000 or p_center_latitude not between -90 and 90
       or p_center_longitude not between -180 and 180 then
      raise exception using errcode = '22023', message = 'radius coverage requires a valid center and radius no greater than 1,000 km';
    end if;
    center := extensions.st_setsrid(extensions.st_makepoint(p_center_longitude, p_center_latitude), 4326)::extensions.geography;
  else
    if p_geography_id is not null or p_center_longitude is not null or p_center_latitude is not null
       or p_radius_meters is not null or p_coverage_geojson is null then
      raise exception using errcode = '22023', message = 'custom coverage requires only a Polygon or MultiPolygon GeoJSON';
    end if;
    begin
      polygon := extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson(p_coverage_geojson::text), 4326))::extensions.geography;
    exception when others then
      raise exception using errcode = '22023', message = 'custom coverage must be valid Polygon or MultiPolygon GeoJSON';
    end;
    if extensions.st_isempty(polygon::extensions.geometry) or not extensions.st_isvalid(polygon::extensions.geometry)
       or extensions.st_area(polygon) <= 0 then
      raise exception using errcode = '22023', message = 'custom coverage must be a non-empty valid polygon with positive area';
    end if;
  end if;

  if p_assignment_id is null then
    insert into public.operational_coverage_assignments(
      entity_type, entity_id, service_key, coverage_type, geography_id,
      center_point, radius_meters, coverage_geometry, status, source,
      valid_from, valid_to, approved_by, approved_at, metadata
    ) values (
      p_entity_type, p_entity_id, p_service_key, p_coverage_type, p_geography_id,
      center, p_radius_meters, polygon, p_status, 'ADMIN_ASSIGNED',
      p_valid_from, p_valid_to, auth.uid(), timezone('utc', now()), coalesce(p_metadata, '{}'::jsonb)
    ) returning * into saved;
    event_type := 'CREATED';
  else
    select * into existing from public.operational_coverage_assignments where id = p_assignment_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'coverage assignment was not found'; end if;
    update public.operational_coverage_assignments set
      entity_type = p_entity_type, entity_id = p_entity_id, service_key = p_service_key,
      coverage_type = p_coverage_type, geography_id = p_geography_id,
      center_point = center, radius_meters = p_radius_meters, coverage_geometry = polygon,
      status = p_status, valid_from = p_valid_from, valid_to = p_valid_to,
      approved_by = auth.uid(), approved_at = timezone('utc', now()),
      metadata = coalesce(p_metadata, '{}'::jsonb), updated_at = timezone('utc', now())
    where id = p_assignment_id returning * into saved;
    event_type := case p_status when 'paused' then 'PAUSED' when 'retired' then 'RETIRED' else 'UPDATED' end;
  end if;

  insert into public.operational_coverage_change_events(
    assignment_id, entity_type, entity_id, service_key, event_type,
    old_coverage, new_coverage, reason, changed_by
  ) values (
    saved.id, saved.entity_type, saved.entity_id, saved.service_key, event_type,
    case when p_assignment_id is null then null else to_jsonb(existing) end,
    to_jsonb(saved), btrim(p_reason), auth.uid()
  );
  return saved.id;
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
  coverage_record public.operational_coverage_assignments%rowtype;
  resolved_geography_id uuid;
  legacy_area_id uuid;
  legacy_mapping_count integer := 0;
  geography_mapping_count integer := 0;
  coverage_assignment_id uuid;
  managed_key text;
  service_area_key text := btrim(coalesce(target_service_area_key,''));
  service_area_label text;
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

  if target_driver_profile_id is null or service_area_key = '' then
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

  select * into coverage_record
  from public.operational_coverage_assignments coverage
  where coverage.entity_type = 'DRIVER'
    and coverage.entity_id = driver_record.id
    and coverage.service_key = 'lpg'
    and coalesce(
      coverage.metadata->>'managedDriverServiceAreaKey',
      coverage.metadata->>'serviceAreaKey'
    ) = service_area_key
  order by
    case when coverage.status = 'active' then 0 else 1 end,
    coverage.updated_at desc
  limit 1;
  assignment_found := found;

  if target_active then
    if left(service_area_key,10) = 'geography:' then
      begin
        resolved_geography_id := substring(service_area_key from 11)::uuid;
      exception when others then
        raise exception using errcode='22023',message='service-area geography identifier is invalid';
      end;

      select geography.canonical_name
      into service_area_label
      from public.geographies geography
      join public.geography_levels level
        on level.id=geography.geography_level_id
        and level.status='active'
        and level.is_service_selectable=true
      where geography.id=resolved_geography_id
        and geography.status='active';

      if not found then
        raise exception using errcode='55000',
          message='Add a verified map boundary to this named area before assigning it to a physical Managed Driver.';
      end if;
    else
      select area.id,area.display_name
      into legacy_area_id,service_area_label
      from public.service_areas area
      where area.key=service_area_key
        and area.status='active';

      if not found then
        raise exception using errcode='22023',message='Service area was not found';
      end if;

      select
        count(distinct mapping.geography_id)::integer,
        min(mapping.geography_id::text)::uuid
      into legacy_mapping_count,resolved_geography_id
      from public.geography_migration_mappings mapping
      where mapping.legacy_source='service_areas'
        and mapping.legacy_id=legacy_area_id
        and mapping.migration_status='verified';

      if legacy_mapping_count=1 then
        select count(distinct mapping.legacy_id)::integer
        into geography_mapping_count
        from public.geography_migration_mappings mapping
        where mapping.legacy_source='service_areas'
          and mapping.geography_id=resolved_geography_id
          and mapping.migration_status='verified';
      else
        geography_mapping_count:=0;
      end if;

      if legacy_mapping_count<>1 or geography_mapping_count<>1 or not exists (
        select 1 from public.geographies geography
        where geography.id=resolved_geography_id
          and geography.status='active'
      ) then
        resolved_geography_id:=null;
      end if;

      if resolved_geography_id is null then
        raise exception using errcode='55000',
          message='Add a verified map boundary to this area before assigning it to a physical Managed Driver.';
      end if;
    end if;
  else
    if not assignment_found then
      return jsonb_build_object(
        'driverProfileId',driver_record.id,
        'serviceAreaKey',service_area_key,
        'serviceAreaLabel',service_area_key,
        'active',false,
        'primary',false,
        'coverageAssignmentId',null
      );
    end if;
    resolved_geography_id := coverage_record.geography_id;
    service_area_label := coalesce(
      coverage_record.metadata->>'managedDriverServiceAreaLabel',
      coverage_record.metadata->>'serviceAreaName',
      'Managed service area'
    );
  end if;

  effective_reason := coalesce(
    nullif(btrim(target_reason),''),
    case when target_active
      then 'Added '||service_area_label||' to SKIMA Managed Driver coverage by an authorized administrator.'
      else 'Removed '||service_area_label||' from SKIMA Managed Driver coverage by an authorized administrator.'
    end
  );

  if assignment_found then
    coverage_assignment_id := coverage_record.id;
    effective_metadata := coalesce(coverage_record.metadata,'{}'::jsonb);
  else
    coverage_assignment_id := null;
    effective_metadata := '{}'::jsonb;
  end if;

  effective_metadata := effective_metadata || target_metadata || jsonb_build_object(
    'source','skima_managed_driver_setup',
    'serviceAreaKey',service_area_key,
    'serviceAreaName',service_area_label,
    'managedDriverServiceAreaKey',service_area_key,
    'managedDriverServiceAreaLabel',service_area_label,
    'managedDriverServiceAreaPrimary',case when target_active then target_primary else false end,
    'managedDriverSetup',true,
    'idempotencyKey',target_idempotency_key
  );

  if target_active then
    if target_primary then
      update public.operational_coverage_assignments other_assignment
      set metadata=jsonb_set(
        jsonb_set(coalesce(other_assignment.metadata,'{}'::jsonb),'{managedDriverServiceAreaPrimary}','false'::jsonb,true),
        '{isPrimary}','false'::jsonb,true
      )
      where other_assignment.entity_type='DRIVER'
        and other_assignment.entity_id=driver_record.id
        and other_assignment.service_key='lpg'
        and other_assignment.status='active'
        and other_assignment.id is distinct from coverage_assignment_id
        and coalesce(
          other_assignment.metadata->>'managedDriverServiceAreaKey',
          other_assignment.metadata->>'serviceAreaKey'
        ) is not null;
    end if;

    coverage_assignment_id := public.configure_operational_coverage_assignment(
      coverage_assignment_id,'DRIVER',driver_record.id,'lpg','ADMIN_GEOGRAPHY',resolved_geography_id,
      null,null,null,null,'active',timezone('utc',now()),null,effective_reason,effective_metadata
    );
  elsif coverage_assignment_id is not null then
    retire_valid_from := coalesce(coverage_record.valid_from,coverage_record.created_at,timezone('utc',now()));
    retire_valid_to := greatest(timezone('utc',now()),retire_valid_from+interval '1 microsecond');
    effective_metadata := effective_metadata || jsonb_build_object(
      'deactivatedReason',effective_reason,
      'deactivatedAt',timezone('utc',now()),
      'managedDriverServiceAreaPrimary',false,
      'isPrimary',false
    );

    coverage_assignment_id := public.configure_operational_coverage_assignment(
      coverage_assignment_id,'DRIVER',driver_record.id,'lpg','ADMIN_GEOGRAPHY',resolved_geography_id,
      null,null,null,null,'retired',retire_valid_from,retire_valid_to,effective_reason,effective_metadata
    );
  end if;

  return jsonb_build_object(
    'driverProfileId',driver_record.id,
    'serviceAreaKey',service_area_key,
    'serviceAreaLabel',service_area_label,
    'active',target_active,
    'primary',case when target_active then target_primary else false end,
    'coverageAssignmentId',coverage_assignment_id
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.dispatch_lpg_internal_order(target_lpg_order_id uuid, target_candidate_limit integer DEFAULT NULL::integer, target_idempotency_key text DEFAULT NULL::text, target_source text DEFAULT 'lpg.internal_dispatch_api'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  order_record record;
  dispatch_request_id uuid;
  candidate_record record;
  candidate_rank integer:=0;
  selected_driver_profile_id uuid;
  selected_vehicle_id uuid;
  selected_driver_point extensions.geography(Point,4326);
  selected_driver_distance numeric;
  selected_coverage_assignment_ids uuid[]:='{}';
  existing_dispatch_request_id uuid;
  dispatch_policy jsonb;
  config jsonb;
  v_program_key text;
  policy_candidate_limit integer;
  freshness_seconds integer;
  max_driver_distance_meters numeric;
  offer_ttl_seconds integer;
  driver_required jsonb;
  vehicle_required jsonb;
  allow_concurrent boolean;
  max_driver_orders integer;
  max_vehicle_orders integer;
  workload_penalty numeric;
  dispatch_policy_key text;
  service_resolution jsonb;
begin
  if auth.role()<>'service_role'
    and not public.has_permission('lpg.dispatch.execute',null)
    and not public.can_manage_lpg_operations() then
    raise exception using errcode='42501',message='LPG dispatch permission is required';
  end if;
  if target_lpg_order_id is null or coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='LPG order and idempotency key are required';
  end if;

  config:=public.lpg_policy_config('lpg.fulfillment.launch_assurance');
  if not coalesce((config->>'enabled')::boolean,false)
    or coalesce(config->>'mode','hybrid')='marketplace_only' then
    raise exception using errcode='55000',message='SKIMA internal fulfillment is not enabled';
  end if;
  v_program_key:=coalesce(config->>'internal_driver_program_key','driver.skima_special');

  dispatch_policy:=public.lpg_policy_config('lpg.dispatch.phase_one');
  policy_candidate_limit:=coalesce(nullif(dispatch_policy->>'candidate_limit','')::integer,5);
  freshness_seconds:=coalesce(nullif(dispatch_policy->>'driver_location_freshness_seconds','')::integer,300);
  max_driver_distance_meters:=coalesce(nullif(dispatch_policy->>'max_driver_distance_meters','')::numeric,25000);
  offer_ttl_seconds:=coalesce(nullif(dispatch_policy->>'offer_ttl_seconds','')::integer,180);
  driver_required:=coalesce(dispatch_policy->'required_driver_capabilities','[]'::jsonb);
  vehicle_required:=coalesce(dispatch_policy->'required_vehicle_capabilities','[]'::jsonb);
  allow_concurrent:=coalesce((dispatch_policy->>'allow_concurrent_assignments')::boolean,true);
  max_driver_orders:=coalesce(nullif(dispatch_policy->>'max_concurrent_orders_per_driver','')::integer,12);
  max_vehicle_orders:=coalesce(nullif(dispatch_policy->>'max_concurrent_orders_per_vehicle','')::integer,max_driver_orders);
  workload_penalty:=coalesce(nullif(dispatch_policy->>'workload_penalty_meters_per_order','')::numeric,650);
  if not allow_concurrent then max_driver_orders:=1; max_vehicle_orders:=1; end if;
  target_candidate_limit:=least(coalesce(target_candidate_limit,policy_candidate_limit),policy_candidate_limit);
  if target_candidate_limit<1 or target_candidate_limit>25 then
    raise exception using errcode='22023',message='candidate limit must be between 1 and 25';
  end if;

  select policy.key into dispatch_policy_key
  from public.dispatch_policies policy
  where policy.key=public.lpg_policy_config('lpg.quote.phase_one')->>'dispatch_policy_key'
    and policy.status='active'
  limit 1;
  if dispatch_policy_key is null then
    raise exception using errcode='55000',message='active LPG dispatch policy is required';
  end if;

  select target_order.*,
         pickup.latitude pickup_latitude,pickup.longitude pickup_longitude,
         pickup.metadata pickup_metadata,pickup.formatted_address pickup_formatted_address,
         delivery.latitude delivery_latitude,delivery.longitude delivery_longitude
  into order_record
  from public.lpg_refill_orders target_order
  join public.lpg_customer_locations pickup on pickup.id=target_order.pickup_location_id
  join public.lpg_customer_locations delivery on delivery.id=target_order.delivery_location_id
  where target_order.id=target_lpg_order_id
  for update of target_order;
  if not found then raise exception using errcode='22023',message='LPG order was not found'; end if;
  if order_record.fulfillment_channel<>'skima_internal' then
    raise exception using errcode='22023',message='order is not a SKIMA internal fulfillment';
  end if;

  existing_dispatch_request_id:=nullif(order_record.metadata->>'dispatch_request_id','')::uuid;
  if existing_dispatch_request_id is not null
    and order_record.metadata->>'dispatch_idempotency_key'=target_idempotency_key then
    return existing_dispatch_request_id;
  end if;
  if order_record.status not in ('payment_reserved','matching_driver','driver_offered') then
    raise exception using errcode='55000',message='SKIMA internal order must be funded before dispatch';
  end if;

  service_resolution:=public.resolve_service_availability(
    'lpg','customer_ordering',order_record.pickup_longitude,order_record.pickup_latitude,timezone('utc',now())
  );
  if not coalesce((service_resolution->>'available')::boolean,false) then
    raise exception using errcode='P0001',message='pickup location is outside current LPG service coverage';
  end if;

  dispatch_request_id:=public.create_dispatch_request(
    dispatch_policy_key,target_source,'lpg_order',order_record.id,
    jsonb_build_object('driver_required_capabilities',driver_required,'vehicle_required_capabilities',vehicle_required),
    jsonb_build_object('latitude',order_record.pickup_latitude,'longitude',order_record.pickup_longitude),
    jsonb_build_object('latitude',order_record.delivery_latitude,'longitude',order_record.delivery_longitude),
    100,
    jsonb_build_object(
      'bounded_context','lpg',
      'fulfillment_channel','skima_internal',
      'driver_program_key',v_program_key,
      'candidate_limit',target_candidate_limit,
      'max_driver_distance_meters',max_driver_distance_meters
    ),
    target_idempotency_key||':dispatch-request'
  );

  for candidate_record in
    select candidate.* from (
      select
        driver.id driver_profile_id,
        vehicle.id vehicle_id,
        state.point driver_point,
        state.captured_at,
        extensions.st_y(state.point::extensions.geometry) latitude,
        extensions.st_x(state.point::extensions.geometry) longitude,
        public.lpg_distance_meters(
          order_record.pickup_latitude,order_record.pickup_longitude,
          extensions.st_y(state.point::extensions.geometry),extensions.st_x(state.point::extensions.geometry)
        ) distance_meters,
        coalesce(coverage_match.assignment_ids,'{}'::uuid[]) coverage_assignment_ids,
        workload.active_order_count,
        workload.active_vehicle_order_count,
        greatest(
          public.lpg_distance_meters(
            order_record.pickup_latitude,order_record.pickup_longitude,
            extensions.st_y(state.point::extensions.geometry),extensions.st_x(state.point::extensions.geometry)
          ) + workload.active_order_count*workload_penalty,
          0
        ) dispatch_cost
      from public.driver_profiles driver
      join public.driver_program_memberships membership
        on membership.driver_profile_id=driver.id
       and membership.program_key=v_program_key
       and membership.status='active'
       and membership.starts_at<=timezone('utc',now())
       and (membership.ends_at is null or membership.ends_at>timezone('utc',now()))
      join public.driver_vehicle_links link
        on link.driver_profile_id=driver.id
       and link.relationship_type='fleet_owned'
       and link.status='active'
       and link.starts_at<=timezone('utc',now())
       and (link.ends_at is null or link.ends_at>timezone('utc',now()))
      join public.vehicles vehicle
        on vehicle.id=link.vehicle_id
       and vehicle.platform_owned
       and vehicle.status='active'
      join lateral (
        select public.evaluate_driver_vehicle_eligibility(driver.id,vehicle.id,'lpg') result
      ) eligibility on coalesce((eligibility.result->>'eligible')::boolean,false)
      join public.driver_location_state state
        on state.driver_id=driver.id
       and state.status='available'
       
and (
        state.captured_at>=timezone('utc',now())-make_interval(secs=>freshness_seconds)
        or (
          coalesce(driver.metadata->>'temporary_lpg_test_fixture','false')='true'
          and exists (
            select 1
            from public.wallet_accounts test_wallet
            join public.wallet_test_funding_allocations test_allocation on test_allocation.wallet_id=test_wallet.id
            join public.wallet_test_funding_batches test_batch on test_batch.id=test_allocation.batch_id
            where test_wallet.owner_entity_type='user'
              and test_wallet.owner_entity_id=order_record.customer_user_id
              and test_wallet.wallet_type='customer'
              and test_wallet.currency_code=order_record.currency_code
              and test_batch.status='active'
              
and (
  test_allocation.remaining_amount>0
  or exists (
    select 1
    from public.escrow_holds test_hold
    join public.wallet_test_funding_allocations test_escrow_allocation
      on test_escrow_allocation.wallet_id=test_hold.wallet_id
     and test_escrow_allocation.batch_id=test_batch.id
     and test_escrow_allocation.remaining_amount>0
    where test_hold.id=order_record.escrow_hold_id
      and test_hold.status in ('pending','held','partially_released')
  )
)

          )
        )
      )

      join lateral (
        select coalesce(array_agg(coverage.id order by coverage.id),'{}'::uuid[]) assignment_ids
        from public.operational_coverage_assignments coverage
        left join public.geographies geography on geography.id=coverage.geography_id
        where coverage.entity_type='DRIVER'
          and coverage.entity_id=driver.id
          and coverage.service_key='lpg'
          and coverage.status in ('approved','active')
          and coverage.approved_at is not null
          and (coverage.valid_from is null or coverage.valid_from<=timezone('utc',now()))
          and (coverage.valid_to is null or coverage.valid_to>timezone('utc',now()))
          and case coverage.coverage_type
            when 'ADMIN_GEOGRAPHY' then geography.status='active'
              and case
                when geography.boundary_geometry is not null then extensions.st_covers(
                  geography.boundary_geometry,
                  extensions.st_setsrid(extensions.st_makepoint(order_record.pickup_longitude,order_record.pickup_latitude),4326)::extensions.geography
                )
                else coverage.metadata->>'managedDriverSetup'='true'
                  and public.managed_driver_geography_matches_location(
                    geography.id,order_record.pickup_metadata,order_record.pickup_formatted_address
                  )
              end
            when 'RADIUS' then extensions.st_dwithin(
              coverage.center_point,
              extensions.st_setsrid(extensions.st_makepoint(order_record.pickup_longitude,order_record.pickup_latitude),4326)::extensions.geography,
              coverage.radius_meters
            )
            when 'CUSTOM_ZONE' then extensions.st_covers(
              coverage.coverage_geometry,
              extensions.st_setsrid(extensions.st_makepoint(order_record.pickup_longitude,order_record.pickup_latitude),4326)::extensions.geography
            )
            else false
          end
      ) coverage_match on cardinality(coverage_match.assignment_ids)>0
      join lateral (
        select count(*)::integer active_order_count,
               count(*) filter(where active.vehicle_id=vehicle.id)::integer active_vehicle_order_count
        from public.lpg_refill_orders active
        where active.driver_profile_id=driver.id
          and active.id<>order_record.id
          and active.status not in ('completed','cancelled','refunded','failed','expired')
      ) workload on true
      
where (
        coalesce(driver.metadata->>'temporary_lpg_test_fixture','false') <> 'true'
        or exists (
          select 1
          from public.wallet_accounts test_wallet
          join public.wallet_test_funding_allocations test_allocation on test_allocation.wallet_id=test_wallet.id
          join public.wallet_test_funding_batches test_batch on test_batch.id=test_allocation.batch_id
          where test_wallet.owner_entity_type='user'
            and test_wallet.owner_entity_id=order_record.customer_user_id
            and test_wallet.wallet_type='customer'
            and test_wallet.currency_code=order_record.currency_code
            and test_batch.status='active'
            
and (
  test_allocation.remaining_amount>0
  or exists (
    select 1
    from public.escrow_holds test_hold
    join public.wallet_test_funding_allocations test_escrow_allocation
      on test_escrow_allocation.wallet_id=test_hold.wallet_id
     and test_escrow_allocation.batch_id=test_batch.id
     and test_escrow_allocation.remaining_amount>0
    where test_hold.id=order_record.escrow_hold_id
      and test_hold.status in ('pending','held','partially_released')
  )
)

        )
      )
      and driver.verification_status='approved'

        and driver.operational_status in ('available','busy')
        and workload.active_order_count<max_driver_orders
        and workload.active_vehicle_order_count<max_vehicle_orders
        and not exists(
          select 1 from jsonb_array_elements_text(driver_required) required(capability_key)
          where not exists(
            select 1 from public.entity_capabilities capability
            where capability.entity_type='driver'
              and capability.entity_id=driver.id
              and capability.capability_key=required.capability_key
              and capability.status='active'
          )
        )
        and not exists(
          select 1 from jsonb_array_elements_text(vehicle_required) required(capability_key)
          where not exists(
            select 1 from public.entity_capabilities capability
            where capability.entity_type='vehicle'
              and capability.entity_id=vehicle.id
              and capability.capability_key=required.capability_key
              and capability.status='active'
          )
        )
        and public.lpg_distance_meters(
          order_record.pickup_latitude,order_record.pickup_longitude,
          extensions.st_y(state.point::extensions.geometry),extensions.st_x(state.point::extensions.geometry)
        )<=max_driver_distance_meters
    ) candidate
    order by candidate.dispatch_cost,candidate.distance_meters,candidate.captured_at desc,candidate.driver_profile_id
    limit target_candidate_limit
  loop
    candidate_rank:=candidate_rank+1;
    if candidate_rank=1 then
      selected_driver_profile_id:=candidate_record.driver_profile_id;
      selected_vehicle_id:=candidate_record.vehicle_id;
      selected_driver_point:=candidate_record.driver_point;
      selected_driver_distance:=candidate_record.distance_meters;
      selected_coverage_assignment_ids:=candidate_record.coverage_assignment_ids;
    end if;

    perform public.upsert_dispatch_candidate(
      dispatch_request_id,'driver',candidate_record.driver_profile_id,
      least(999999.9999,greatest(1000000-candidate_record.dispatch_cost,1)),candidate_rank,
      jsonb_build_object(
        'vehicle_id',candidate_record.vehicle_id,
        'distance_meters',candidate_record.distance_meters,
        'coverage_assignment_ids',candidate_record.coverage_assignment_ids,
        'active_order_count',candidate_record.active_order_count,
        'active_vehicle_order_count',candidate_record.active_vehicle_order_count,
        'participation_program_key',v_program_key,
        'fulfillment_channel','skima_internal',
        'selection_mode','skima_internal_managed_driver'
      ),
      case when candidate_rank=1 then 'offered' else 'suggested' end,
      target_idempotency_key||':candidate:'||candidate_rank::text
    );
  end loop;

  if candidate_rank=0 then
    raise exception using errcode='P0001',message='no available SKIMA internal driver currently covers this pickup location';
  end if;

  update public.dispatch_requests
  set assigned_entity_type='driver',assigned_entity_id=selected_driver_profile_id,
      metadata=metadata||jsonb_build_object(
        'vehicle_id',selected_vehicle_id,
        'driver_program_key',v_program_key,
        'fulfillment_channel','skima_internal'
      ),updated_at=timezone('utc',now())
  where id=dispatch_request_id;

  update public.lpg_refill_orders
  set driver_profile_id=selected_driver_profile_id,
      vehicle_id=selected_vehicle_id,
      station_branch_id=null,
      status='driver_offered',
      assignment_status='driver_offered',
      metadata=metadata||jsonb_build_object(
        'dispatch_request_id',dispatch_request_id,
        'dispatch_idempotency_key',target_idempotency_key,
        'dispatch_candidate_count',candidate_rank,
        'driver_offer_expires_at',timezone('utc',now())+make_interval(secs=>offer_ttl_seconds),
        'driver_participation_program_key',v_program_key,
        'fulfillmentChannel','skima_internal'
      ),updated_at=timezone('utc',now())
  where id=order_record.id;

  update public.service_requests
  set status='matching',
      participants=participants||jsonb_build_object(
        'driver_profile_id',selected_driver_profile_id,
        'vehicle_id',selected_vehicle_id,
        'fulfillment_channel','skima_internal'
      ),updated_at=timezone('utc',now())
  where id=order_record.service_request_id;

  perform public.record_lpg_order_event(
    order_record.id,'lpg.dispatch.driver_offered',order_record.status,'driver_offered',
    target_idempotency_key||':event',
    jsonb_build_object(
      'dispatch_request_id',dispatch_request_id,
      'driver_profile_id',selected_driver_profile_id,
      'vehicle_id',selected_vehicle_id,
      'driver_program_key',v_program_key,
      'fulfillment_channel','skima_internal'
    )
  );

  insert into public.dispatch_location_decision_snapshots(
    dispatch_request_id,subject_type,subject_id,service_key,pickup_point,
    selected_entity_type,selected_entity_id,selected_entity_point,
    matched_coverage_assignment_ids,distance_meters,authority_mode,decision_metadata
  ) values(
    dispatch_request_id,'lpg_order',order_record.id,'lpg',
    extensions.st_setsrid(extensions.st_makepoint(order_record.pickup_longitude,order_record.pickup_latitude),4326)::extensions.geography,
    'DRIVER',selected_driver_profile_id,selected_driver_point,selected_coverage_assignment_ids,
    selected_driver_distance,'universal',
    jsonb_build_object(
      'vehicleId',selected_vehicle_id,
      'candidateCount',candidate_rank,
      'participationProgramKey',v_program_key,
      'fulfillmentChannel','skima_internal',
      'dispatchPolicyKey',dispatch_policy_key,
      'servicePolicyId',service_resolution->>'matchedPolicyId',
      'serviceGeographyId',service_resolution->>'matchedGeographyId'
    )
  ) ON CONFLICT ON CONSTRAINT dispatch_location_decision_snapshots_dispatch_request_id_key DO NOTHING;

  return dispatch_request_id;
end
$function$
;

-- Rename the PL/pgSQL variable so catalog_availability_rules.reserved_quantity
-- is unambiguous in the UPDATE statement.
CREATE OR REPLACE FUNCTION public.update_storefront_product(target_item_id uuid, target_display_name text, target_description text, target_category_key text, target_category_name text, target_amount numeric, target_compare_at_amount numeric, target_stock_quantity numeric, target_status text, target_idempotency_key text, target_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  settings public.storefront_settings%rowtype;
  item_record public.catalog_items%rowtype;
  resolved_category_id uuid;
  reserved_quantity_value numeric(20,8) := 0;
  price_id uuid;
  availability_id uuid;
  current_availability_rule_id uuid;
begin
  if auth.uid() is null
    or not public.is_platform_super_admin()
      and not public.has_permission('platform.store.manage', null) then
    raise exception 'platform Store management permission is required';
  end if;

  select * into settings
  from public.storefront_settings
  where module_id = (select id from public.business_modules where key = 'store')
  limit 1;

  if not found or settings.status <> 'active' then
    raise exception 'Configure and activate the SKIMA Store before editing products';
  end if;

  select * into item_record
  from public.catalog_items
  where id = target_item_id
    and organization_id = settings.organization_id
    and module_id = settings.module_id
  for update;

  if not found or coalesce(item_record.metadata->>'sales_channel', '') <> 'skima_store' then
    raise exception 'The selected item is not a SKIMA Store listing';
  end if;

  if target_display_name is null or btrim(target_display_name) = ''
    or target_amount is null or target_amount < 0
    or target_stock_quantity is null or target_stock_quantity < 0
    or target_status not in ('draft', 'active') then
    raise exception 'Enter a valid product name, price, stock quantity and listing status';
  end if;

  if target_compare_at_amount is not null and target_compare_at_amount <= target_amount then
    raise exception 'The crossed-out price must be greater than the selling price';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'An idempotency key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'Product metadata must be a JSON object';
  end if;

  if target_category_key is null or btrim(target_category_key) = '' then
    target_category_key := 'store.category.general';
  end if;

  select category.id into resolved_category_id
  from public.catalog_categories category
  where category.organization_id = settings.organization_id
    and category.key = target_category_key
    and category.status = 'active'
  limit 1;

  if resolved_category_id is null then
    perform public.configure_catalog_category(
      settings.organization_id,
      target_category_key,
      coalesce(nullif(target_category_name, ''), 'General'),
      'product',
      'store',
      null,
      'Products available from SKIMA Store.',
      'active',
      'platform.storefront',
      target_idempotency_key || ':category',
      jsonb_build_object('channel', 'skima_store')
    );
    select category.id into resolved_category_id
    from public.catalog_categories category
    where category.organization_id = settings.organization_id
      and category.key = target_category_key
      and category.status = 'active'
    limit 1;
  end if;

  if resolved_category_id is null then
    raise exception 'The selected Store product category could not be created';
  end if;

  select rule.id, rule.reserved_quantity
  into current_availability_rule_id, reserved_quantity_value
  from public.catalog_availability_rules rule
  where rule.item_id = target_item_id
    and rule.variant_id is null
    and rule.status = 'active'
  order by rule.created_at desc
  limit 1
  for update;
  reserved_quantity_value := coalesce(reserved_quantity_value, 0);

  if target_stock_quantity < reserved_quantity_value then
    raise exception 'Stock cannot be lower than units already reserved for customer orders';
  end if;

  update public.catalog_items
  set category_id = resolved_category_id,
      display_name = btrim(target_display_name),
      description = nullif(btrim(target_description), ''),
      status = target_status,
      metadata = item_record.metadata || target_metadata || jsonb_build_object(
        'storefront', true,
        'sales_channel', 'skima_store'
      ),
      updated_at = timezone('utc', now())
  where id = target_item_id;

  update public.catalog_prices
  set status = 'retired', updated_at = timezone('utc', now())
  where item_id = target_item_id
    and variant_id is null
    and currency_code = settings.currency_code
    and status in ('active', 'scheduled');

  price_id := public.configure_catalog_price(
    target_item_id, null, settings.currency_code, target_amount,
    target_compare_at_amount, null, 'exclusive', 'active',
    timezone('utc', now()), null, 'platform.storefront',
    target_idempotency_key || ':price',
    jsonb_build_object('storefront', true, 'edited_by_admin', true)
  );

  if current_availability_rule_id is not null then
    -- Keep the existing availability row id so outstanding order reservations
    -- can still be released against the exact rule they reserved.
    update public.catalog_availability_rules
    set availability_status = case
          when target_status <> 'active' then 'unavailable'
          when target_stock_quantity > reserved_quantity then 'available'
          else 'out_of_stock' end,
        stock_quantity = target_stock_quantity,
        updated_at = timezone('utc', now())
    where id = current_availability_rule_id;
    availability_id := current_availability_rule_id;
  else
    availability_id := public.set_catalog_availability(
      target_item_id, null, settings.branch_id,
      case when target_status = 'active' and target_stock_quantity > 0 then 'available'
           when target_status = 'active' then 'out_of_stock'
           else 'unavailable' end,
      '{}'::jsonb, target_stock_quantity, 0,
      null, 0, 'active', timezone('utc', now()), null,
      'platform.storefront', target_idempotency_key || ':availability',
      jsonb_build_object('storefront', true, 'edited_by_admin', true)
    );
  end if;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, after_state, metadata
  )
  values (
    auth.uid(), 'storefront.product_updated', 'catalog_items', target_item_id,
    jsonb_build_object(
      'display_name', target_display_name,
      'category_id', resolved_category_id,
      'amount', target_amount,
      'compare_at_amount', target_compare_at_amount,
      'stock_quantity', target_stock_quantity,
      'status', target_status
    ),
    jsonb_build_object('source', 'platform.storefront', 'idempotency_key', target_idempotency_key)
  );

  return jsonb_build_object(
    'itemId', target_item_id,
    'priceId', price_id,
    'availabilityRuleId', availability_id
  );
end;
$function$
;

-- Wallet funding is not Store operational acceptance. Keep Store orders in
-- 'received' until an authorized Store operator performs store.order.accept.
CREATE OR REPLACE FUNCTION public.fund_order_from_wallet(target_order_id uuid DEFAULT NULL::uuid, target_customer_wallet_id uuid DEFAULT NULL::uuid, target_escrow_wallet_id uuid DEFAULT NULL::uuid, target_source text DEFAULT 'platform.payment_engine'::text, target_idempotency_key text DEFAULT NULL::text, target_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  order_record record;
  customer_wallet record;
  escrow_wallet_id uuid;
  current_balance numeric(28, 8);
  hold_transaction_id uuid;
  created_escrow_hold_id uuid;
  existing_hold record;
begin
  if not public.can_execute_financial_runtime() then
    raise exception 'payment execution permission is required';
  end if;

  if target_order_id is null or target_customer_wallet_id is null then
    raise exception 'target_order_id and target_customer_wallet_id are required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select hold.*
  into existing_hold
  from public.escrow_holds hold
  where hold.source = target_source
    and hold.idempotency_key = target_idempotency_key;

  if found then
    return existing_hold.id;
  end if;

  select order_record_inner.*
  into order_record
  from public.order_records order_record_inner
  where order_record_inner.id = target_order_id
  for update;

  if not found then
    raise exception 'target_order_id must reference an existing order';
  end if;

  if order_record.total_amount <= 0 then
    raise exception 'order total must be greater than zero';
  end if;

  select wallet.*
  into customer_wallet
  from public.wallet_accounts wallet
  where wallet.id = target_customer_wallet_id
    and wallet.status = 'active'
    and wallet.currency_code = order_record.currency_code;

  if not found then
    raise exception 'target_customer_wallet_id must reference an active wallet with matching currency';
  end if;

  select coalesce(balance.balance, 0)
  into current_balance
  from public.wallet_balances balance
  where balance.wallet_id = target_customer_wallet_id;

  if coalesce(current_balance, 0) < order_record.total_amount then
    raise exception 'insufficient available wallet balance';
  end if;

  escrow_wallet_id := coalesce(
    target_escrow_wallet_id,
    public.ensure_wallet_account(
      'escrow',
      'escrow',
      target_order_id,
      order_record.currency_code,
      'platform.wallet_engine',
      '{"wallet_purpose":"order_escrow"}'::jsonb,
      target_idempotency_key || ':escrow-wallet'
    )
  );

  hold_transaction_id := public.post_financial_transaction(
    'hold',
    order_record.currency_code,
    target_source,
    'service_request',
    order_record.service_request_id,
    jsonb_build_array(
      jsonb_build_object(
        'wallet_id',
        target_customer_wallet_id,
        'direction',
        'debit',
        'amount',
        order_record.total_amount,
        'entry_type',
        'principal',
        'metadata',
        jsonb_build_object('role', 'customer_wallet')
      ),
      jsonb_build_object(
        'wallet_id',
        escrow_wallet_id,
        'direction',
        'credit',
        'amount',
        order_record.total_amount,
        'entry_type',
        'principal',
        'metadata',
        jsonb_build_object('role', 'escrow')
      )
    ),
    target_idempotency_key || ':financial',
    null,
    null,
    jsonb_build_object('order_id', order_record.id, 'service_request_id', order_record.service_request_id),
    target_metadata
  );

  insert into public.escrow_holds (
    settlement_policy_id,
    wallet_id,
    source_transaction_id,
    status,
    currency_code,
    hold_amount,
    released_amount,
    subject_type,
    subject_id,
    release_conditions,
    beneficiaries,
    expires_at,
    created_by,
    source,
    idempotency_key
  )
  values (
    null,
    escrow_wallet_id,
    hold_transaction_id,
    'held',
    order_record.currency_code,
    order_record.total_amount,
    0,
    'service_request',
    order_record.service_request_id,
    target_metadata || jsonb_build_object('order_id', order_record.id),
    '[]'::jsonb,
    null,
    auth.uid(),
    target_source,
    target_idempotency_key
  )
  returning id into created_escrow_hold_id;

  update public.service_requests
  set escrow_hold_id = created_escrow_hold_id,
      status = 'payment_reserved',
      updated_at = timezone('utc', now())
  where id = order_record.service_request_id;

  update public.order_records
  set status = case
        when status = 'received'
          and not (
            exists (
              select 1
              from public.business_modules module
              where module.id = order_record.module_id
                and module.key = 'store'
            )
            and order_record.order_payload->>'channel' = 'skima_store'
          )
          then 'accepted'
        else status
      end,
      metadata = metadata || jsonb_build_object('escrow_hold_id', created_escrow_hold_id),
      updated_at = timezone('utc', now())
  where id = order_record.id;

  return created_escrow_hold_id;
end;
$function$
;

do $seed$
declare
  nigeria_id uuid;
  country_level_id uuid;
  state_level_id uuid;
  delta_state_id uuid;
  lga_level_id uuid;
  locality_level_id uuid;
  lga_id uuid;
  locality_id uuid;
begin
  select id into country_level_id
  from public.geography_levels
  where key='country' and status='active';

  select id into state_level_id
  from public.geography_levels
  where key='admin_level_1' and status='active';

  select geography.id into nigeria_id
  from public.geographies geography
  join public.geography_levels level on level.id=geography.geography_level_id
  where geography.normalized_name='nigeria'
    and level.key='country'
    and geography.country_code='NG'
    and geography.status='active'
  order by geography.created_at
  limit 1;

  select id into lga_level_id from public.geography_levels where key='admin_level_2' and status='active';
  select id into locality_level_id from public.geography_levels where key='locality' and status='active';

  if nigeria_id is null or country_level_id is null or state_level_id is null
     or lga_level_id is null or locality_level_id is null then
    raise exception 'Nigeria and active country, state, LGA and locality geography levels are required to seed Asaba';
  end if;

  select geography.id into delta_state_id
  from public.geographies geography
  where geography.parent_id=nigeria_id
    and geography.geography_level_id=state_level_id
    and geography.normalized_name='delta state'
    and geography.country_code='NG'
    and geography.status <> 'retired'
  order by case geography.status when 'active' then 0 when 'draft' then 1 when 'inactive' then 2 else 3 end,
           geography.created_at
  limit 1
  for update;

  if delta_state_id is null then
    insert into public.geographies (
      parent_id,geography_level_id,canonical_name,normalized_name,country_code,
      source,external_reference,aliases,metadata,status
    ) values (
      nigeria_id,state_level_id,'Delta State','delta state','NG',
      'admin.named_geography','skima:nigeria:delta',
      '["Delta"]'::jsonb,
      '{"sourceSurface":"admin_geography_seed","country":"Nigeria","coverageMeaning":"state parent only; not a selected locality"}'::jsonb,
      'active'
    ) returning id into delta_state_id;
  else
    update public.geographies
    set canonical_name='Delta State',
        aliases=aliases || '["Delta"]'::jsonb,
        metadata=metadata || '{"sourceSurface":"admin_geography_seed","country":"Nigeria","coverageMeaning":"state parent only; not a selected locality"}'::jsonb,
        status='active',
        updated_at=timezone('utc',now())
    where id=delta_state_id;
  end if;

  select id into lga_id
  from public.geographies
  where parent_id=delta_state_id
    and geography_level_id=lga_level_id
    and country_code='NG'
    and normalized_name='oshimili south'
    and status <> 'retired'
  order by case status when 'active' then 0 when 'draft' then 1 else 2 end,created_at
  limit 1
  for update;

  if lga_id is null then
    insert into public.geographies (
      parent_id,geography_level_id,canonical_name,normalized_name,country_code,
      source,external_reference,aliases,metadata,status
    ) values (
      delta_state_id,lga_level_id,'Oshimili South','oshimili south','NG',
      'admin.named_geography','skima:nigeria:delta:oshimili-south',
      '["Oshimili South LGA","Oshimili South Local Government Area"]'::jsonb,
      '{"sourceSurface":"admin_geography_seed","state":"Delta State"}'::jsonb,
      'active'
    ) returning id into lga_id;
  else
    update public.geographies
    set canonical_name='Oshimili South',
        aliases=aliases || '["Oshimili South LGA","Oshimili South Local Government Area"]'::jsonb,
        metadata=metadata || '{"sourceSurface":"admin_geography_seed","state":"Delta State"}'::jsonb,
        status='active',
        updated_at=timezone('utc',now())
    where id=lga_id;
  end if;

  select id into locality_id
  from public.geographies
  where parent_id=lga_id
    and geography_level_id=locality_level_id
    and country_code='NG'
    and normalized_name='asaba'
    and status <> 'retired'
  order by case status when 'active' then 0 when 'draft' then 1 else 2 end,created_at
  limit 1
  for update;

  if locality_id is null then
    insert into public.geographies (
      parent_id,geography_level_id,canonical_name,normalized_name,country_code,
      source,external_reference,aliases,metadata,status
    ) values (
      lga_id,locality_level_id,'Asaba','asaba','NG',
      'admin.named_geography','skima:nigeria:delta:asaba',
      '["Asaba City"]'::jsonb,
      '{"sourceSurface":"admin_geography_seed","lga":"Oshimili South","state":"Delta State","coverageMeaning":"named locality; not entire state"}'::jsonb,
      'active'
    ) returning id into locality_id;
  else
    update public.geographies
    set canonical_name='Asaba',
        aliases=aliases || '["Asaba City"]'::jsonb,
        metadata=metadata || '{"sourceSurface":"admin_geography_seed","lga":"Oshimili South","state":"Delta State","coverageMeaning":"named locality; not entire state"}'::jsonb,
        status='active',
        updated_at=timezone('utc',now())
    where id=locality_id;
  end if;
end
$seed$;


-- Repair only Store orders whose persisted status was advanced by payment,
-- while their workflow instance is still waiting at 'received'.
update public.order_records order_record
set status='received',
    metadata=order_record.metadata || jsonb_build_object(
      'paymentAcceptanceReconciled',true,
      'paymentAcceptanceReconciledAt',timezone('utc',now()),
      'paymentAcceptanceReconciledReason','Store checkout payment must not bypass manual business acceptance workflow'
    ),
    updated_at=timezone('utc',now())
from public.business_modules module, public.workflow_instances workflow
where module.id=order_record.module_id
  and module.key='store'
  and order_record.order_payload->>'channel'='skima_store'
  and workflow.id=order_record.workflow_instance_id
  and workflow.current_state_key='received'
  and order_record.status='accepted'
  and order_record.accepted_at is null;


commit;
