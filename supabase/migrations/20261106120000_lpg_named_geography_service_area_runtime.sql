begin;

-- Make universal geographies the service-area catalogue for Managed LPG.
-- Verified legacy keys remain valid for existing financial policies; new
-- named geographies use stable geography:<uuid> keys and never require a
-- drawn boundary for address-based serviceability or price configuration.

create or replace function public.read_lpg_internal_service_area_options()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  result jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role'
    and not public.has_permission('platform.dispatch.read',null)
    and not public.has_permission('platform.dispatch.manage',null)
    and not public.has_permission('platform.financial_policy.read',null)
    and not public.has_permission('platform.financial_policy.manage',null)
    and not public.has_permission('platform.drivers.manage',null)
    and not public.can_manage_lpg_operations()
    and not public.is_platform_super_admin() then
    raise exception using errcode='42501',message='LPG setup read permission is required';
  end if;

  with verified_legacy_mapping_counts as (
    select
      mapping.legacy_id,
      count(distinct mapping.geography_id)::integer as mapping_count,
      min(mapping.geography_id::text)::uuid as geography_id
    from public.geography_migration_mappings mapping
    where mapping.legacy_source='service_areas'
      and mapping.migration_status='verified'
      and mapping.geography_id is not null
    group by mapping.legacy_id
  ),
  verified_geography_mapping_counts as (
    select
      mapping.geography_id,
      count(distinct mapping.legacy_id)::integer as mapping_count
    from public.geography_migration_mappings mapping
    where mapping.legacy_source='service_areas'
      and mapping.migration_status='verified'
      and mapping.geography_id is not null
    group by mapping.geography_id
  ),
  legacy_areas as (
    select
      area.key::text as key,
      area.display_name as label,
      coalesce(level.key,area.area_type) as area_type,
      area.state_name,
      area.lga_name,
      area.city_name,
      area.town_name,
      geography.id as geography_id,
      (geography.boundary_geometry is not null) as has_boundary
    from public.service_areas area
    join verified_legacy_mapping_counts mapping
      on mapping.legacy_id=area.id and mapping.mapping_count=1
    join public.geographies geography
      on geography.id=mapping.geography_id and geography.status='active'
    join verified_geography_mapping_counts geography_mapping
      on geography_mapping.geography_id=geography.id and geography_mapping.mapping_count=1
    join public.geography_levels level
      on level.id=geography.geography_level_id and level.status='active'
    where area.status='active'
  ),
  named_geographies as (
    select
      'geography:'||geography.id::text as key,
      geography.canonical_name as label,
      level.key as area_type,
      null::text as state_name,
      null::text as lga_name,
      null::text as city_name,
      null::text as town_name,
      geography.id as geography_id,
      (geography.boundary_geometry is not null) as has_boundary
    from public.geographies geography
    join public.geography_levels level
      on level.id=geography.geography_level_id
      and level.status='active'
      and level.is_service_selectable=true
    left join verified_geography_mapping_counts mapping
      on mapping.geography_id=geography.id
    where geography.status='active'
      and (
        coalesce(mapping.mapping_count,0)<>1
        or not exists (
          select 1
          from public.geography_migration_mappings legacy_mapping
          join public.service_areas legacy_area on legacy_area.id=legacy_mapping.legacy_id
          join verified_legacy_mapping_counts legacy_count
            on legacy_count.legacy_id=legacy_area.id and legacy_count.mapping_count=1
          where legacy_mapping.legacy_source='service_areas'
            and legacy_mapping.migration_status='verified'
            and legacy_mapping.geography_id=geography.id
            and legacy_area.status='active'
        )
      )
  ),
  areas as (
    select * from legacy_areas
    union all
    select * from named_geographies
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'key',area.key,
    'label',area.label,
    'areaType',area.area_type,
    'stateName',area.state_name,
    'lgaName',area.lga_name,
    'cityName',area.city_name,
    'townName',area.town_name,
    'geographyId',area.geography_id,
    'hasBoundary',area.has_boundary,
    'referencePricePerKg',nullif(policy.configuration->>'amount_per_kg','')::numeric,
    'estimatedRouteKm',nullif(policy.configuration->>'estimated_route_km','')::numeric,
    'maxSupplierVariancePercent',nullif(policy.configuration->>'max_supplier_variance_percent','')::numeric,
    'priceConfigured',policy.id is not null
  ) order by area.label asc),'[]'::jsonb)
  into result
  from areas area
  left join lateral (
    select version.id,version.configuration
    from public.financial_policy_versions version
    join public.financial_policy_definitions definition
      on definition.id=version.policy_definition_id
    join public.business_modules module on module.id=version.module_id
    where definition.key='pricing.lpg.internal_reference_per_kg'
      and module.key='lpg'
      and version.service_key='lpg.refill.internal'
      and version.currency_code='NGN'
      and version.geography_type='service_area'
      and version.geography_key=area.key
      and version.lifecycle_status='active'
      and version.effective_from<=timezone('utc',now())
      and (version.effective_until is null or version.effective_until>timezone('utc',now()))
    order by version.version desc
    limit 1
  ) policy on true;

  return result;
end
$$;

create or replace function public.set_lpg_managed_driver_service_area(
  target_driver_profile_id uuid,
  target_service_area_key text,
  target_active boolean,
  target_primary boolean,
  target_reason text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $function$
declare
  driver_record public.driver_profiles%rowtype;
  coverage_record public.operational_coverage_assignments%rowtype;
  geography_id uuid;
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
        geography_id := substring(service_area_key from 11)::uuid;
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
      where geography.id=geography_id
        and geography.status='active'
        and geography.boundary_geometry is not null;

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
      into legacy_mapping_count,geography_id
      from public.geography_migration_mappings mapping
      where mapping.legacy_source='service_areas'
        and mapping.legacy_id=legacy_area_id
        and mapping.migration_status='verified';

      if legacy_mapping_count=1 then
        select count(distinct mapping.legacy_id)::integer
        into geography_mapping_count
        from public.geography_migration_mappings mapping
        where mapping.legacy_source='service_areas'
          and mapping.geography_id=geography_id
          and mapping.migration_status='verified';
      else
        geography_mapping_count:=0;
      end if;

      if legacy_mapping_count<>1 or geography_mapping_count<>1 or not exists (
        select 1 from public.geographies geography
        where geography.id=geography_id
          and geography.status='active'
          and geography.boundary_geometry is not null
      ) then
        geography_id:=null;
      end if;

      if geography_id is null then
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
    geography_id := coverage_record.geography_id;
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
      coverage_assignment_id,'DRIVER',driver_record.id,'lpg','ADMIN_GEOGRAPHY',geography_id,
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
      coverage_assignment_id,'DRIVER',driver_record.id,'lpg','ADMIN_GEOGRAPHY',geography_id,
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
$function$;

create or replace function public.resolve_lpg_internal_reference_policy(
  target_pickup_location_id uuid,
  target_at timestamptz default timezone('utc',now())
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  location_record public.lpg_customer_locations%rowtype;
  managed_resolution jsonb;
  matched_geography_id uuid;
  geography_key text;
  mapping_count integer := 0;
  result jsonb;
begin
  if auth.uid() is null and coalesce(auth.role(),'') <> 'service_role' then
    raise exception using errcode='42501',message='authentication required';
  end if;

  select * into location_record
  from public.lpg_customer_locations
  where id=target_pickup_location_id
    and (coalesce(auth.role(),'')='service_role' or owner_user_id=auth.uid())
    and status<>'deleted';

  if not found then
    raise exception using errcode='42501',message='pickup location is not available to this customer';
  end if;

  managed_resolution:=public.resolve_lpg_location_capability(
    'lpg',
    'skima_managed_fulfillment',
    location_record.longitude,
    location_record.latitude,
    coalesce(location_record.metadata,'{}'::jsonb)
      || jsonb_build_object('formattedAddress',location_record.formatted_address),
    target_at
  );

  if not coalesce((managed_resolution->>'available')::boolean,false) then
    raise exception using errcode='P0001',
      message='SKIMA Managed fulfilment is not enabled for the pickup location';
  end if;

  matched_geography_id:=nullif(managed_resolution->>'matchedGeographyId','')::uuid;
  if matched_geography_id is null then
    raise exception using errcode='55000',
      message='SKIMA Managed coverage must resolve to a named service area before pricing';
  end if;

  select count(distinct mapping.legacy_id)::integer into mapping_count
  from public.geography_migration_mappings mapping
  where mapping.legacy_source='service_areas'
    and mapping.migration_status='verified'
    and mapping.geography_id=matched_geography_id;

  geography_key:=null;
  if mapping_count=1 then
    select area.key into geography_key
    from public.geography_migration_mappings mapping
    join public.service_areas area on area.id=mapping.legacy_id
    where mapping.legacy_source='service_areas'
      and mapping.migration_status='verified'
      and mapping.geography_id=matched_geography_id
      and area.status='active'
    order by mapping.verified_at desc,area.key
    limit 1;
  end if;
  if geography_key is null then
    geography_key:='geography:'||matched_geography_id::text;
  end if;

  result:=public.resolve_financial_policy(
    'pricing.lpg.internal_reference_per_kg',
    'NGN',
    target_at,
    'lpg',
    null,
    'lpg.refill.internal',
    'service_area',
    geography_key
  );

  return result || jsonb_build_object(
    'serviceability',managed_resolution,
    'resolvedGeographyType','service_area',
    'resolvedGeographyKey',geography_key,
    'matchedGeographyId',matched_geography_id
  );
end
$$;

notify pgrst,'reload schema';
commit;
