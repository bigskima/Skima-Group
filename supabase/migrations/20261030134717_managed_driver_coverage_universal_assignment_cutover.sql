begin;

-- Keep Managed Driver service-area operations on universal operational coverage.
-- This replaces all legacy driver_service_areas writes and reads in this workflow.

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
       or not exists(select 1 from public.geographies where id = p_geography_id and status = 'active' and boundary_geometry is not null) then
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
$function$;

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

  if coalesce(auth.role(), '') <> 'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.drivers.read', null)
    and not public.has_permission('platform.drivers.manage', null)
    and not public.has_permission('platform.coverage.read', null)
    and not public.has_permission('platform.coverage.manage', null)
    and not public.can_manage_lpg_operations() then
    raise exception using errcode = '42501', message = 'Driver coverage read permission is required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'serviceAreaKey', coalesce(assignment.metadata->>'managedDriverServiceAreaKey', assignment.metadata->>'serviceAreaKey'),
    'label', coalesce(assignment.metadata->>'managedDriverServiceAreaLabel', assignment.metadata->>'serviceAreaName', geography.canonical_name),
    'isPrimary', case
      when assignment.metadata->>'managedDriverServiceAreaPrimary' in ('true','false')
        then (assignment.metadata->>'managedDriverServiceAreaPrimary')::boolean
      when assignment.metadata->>'isPrimary' in ('true','false')
        then (assignment.metadata->>'isPrimary')::boolean
      else false
    end,
    'effectiveFrom', coalesce(assignment.valid_from, assignment.created_at)
  ) order by
    case
      when assignment.metadata->>'managedDriverServiceAreaPrimary' = 'true'
        or assignment.metadata->>'isPrimary' = 'true' then 0
      else 1
    end,
    coalesce(assignment.metadata->>'managedDriverServiceAreaLabel', assignment.metadata->>'serviceAreaName', geography.canonical_name)
  ), '[]'::jsonb)
  into result
  from public.operational_coverage_assignments assignment
  join public.geographies geography on geography.id = assignment.geography_id
  where assignment.entity_type = 'DRIVER'
    and assignment.entity_id = target_driver_profile_id
    and assignment.service_key = 'lpg'
    and assignment.coverage_type = 'ADMIN_GEOGRAPHY'
    and assignment.status = 'active'
    and assignment.approved_at is not null
    and (assignment.valid_from is null or assignment.valid_from <= timezone('utc', now()))
    and (assignment.valid_to is null or assignment.valid_to > timezone('utc', now()))
    and coalesce(assignment.metadata->>'managedDriverServiceAreaKey', assignment.metadata->>'serviceAreaKey') is not null;

  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_lpg_managed_driver_service_area(target_driver_profile_id uuid, target_service_area_key text, target_active boolean, target_primary boolean, target_reason text, target_idempotency_key text, target_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  driver_record public.driver_profiles%rowtype;
  service_area public.service_areas%rowtype;
  coverage_record public.operational_coverage_assignments%rowtype;
  geography_id uuid;
  coverage_assignment_id uuid;
  managed_key text;
  effective_reason text;
  effective_metadata jsonb;
  retire_valid_from timestamptz;
  retire_valid_to timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.coverage.manage', null)
    and not public.has_permission('platform.drivers.manage', null)
    and not public.can_manage_lpg_operations() then
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

  select * into coverage_record
  from public.operational_coverage_assignments coverage
  where coverage.entity_type = 'DRIVER'
    and coverage.entity_id = driver_record.id
    and coverage.service_key = 'lpg'
    and coalesce(
      coverage.metadata->>'managedDriverServiceAreaKey',
      coverage.metadata->>'serviceAreaKey'
    ) = service_area.key
  order by
    case when coverage.status = 'active' then 0 else 1 end,
    coverage.updated_at desc
  limit 1;

  if found then
    coverage_assignment_id := coverage_record.id;
    effective_metadata := coalesce(coverage_record.metadata, '{}'::jsonb);
  else
    coverage_assignment_id := null;
    effective_metadata := '{}'::jsonb;
  end if;

  effective_metadata := effective_metadata || target_metadata || jsonb_build_object(
    'source', 'skima_managed_driver_setup',
    'serviceAreaKey', service_area.key,
    'serviceAreaName', service_area.display_name,
    'managedDriverServiceAreaKey', service_area.key,
    'managedDriverServiceAreaLabel', service_area.display_name,
    'managedDriverServiceAreaPrimary', case when target_active then target_primary else false end,
    'managedDriverSetup', true,
    'idempotencyKey', target_idempotency_key
  );

  if target_active then
    if target_primary then
      update public.operational_coverage_assignments other_assignment
      set metadata = jsonb_set(
        jsonb_set(coalesce(other_assignment.metadata, '{}'::jsonb), '{managedDriverServiceAreaPrimary}', 'false'::jsonb, true),
        '{isPrimary}', 'false'::jsonb, true
      )
      where other_assignment.entity_type = 'DRIVER'
        and other_assignment.entity_id = driver_record.id
        and other_assignment.service_key = 'lpg'
        and other_assignment.status = 'active'
        and other_assignment.id is distinct from coverage_assignment_id
        and coalesce(
          other_assignment.metadata->>'managedDriverServiceAreaKey',
          other_assignment.metadata->>'serviceAreaKey'
        ) is not null;
    end if;

    coverage_assignment_id := public.configure_operational_coverage_assignment(
      coverage_assignment_id, 'DRIVER', driver_record.id, 'lpg', 'ADMIN_GEOGRAPHY', geography_id,
      null, null, null, null, 'active', timezone('utc', now()), null, effective_reason,
      effective_metadata
    );
  elsif coverage_assignment_id is not null then
    retire_valid_from := coalesce(coverage_record.valid_from, coverage_record.created_at, timezone('utc', now()));
    retire_valid_to := greatest(timezone('utc', now()), retire_valid_from + interval '1 microsecond');
    effective_metadata := effective_metadata || jsonb_build_object(
      'deactivatedReason', effective_reason,
      'deactivatedAt', timezone('utc', now()),
      'managedDriverServiceAreaPrimary', false,
      'isPrimary', false
    );

    coverage_assignment_id := public.configure_operational_coverage_assignment(
      coverage_assignment_id, 'DRIVER', driver_record.id, 'lpg', 'ADMIN_GEOGRAPHY', geography_id,
      null, null, null, null, 'retired', retire_valid_from, retire_valid_to, effective_reason,
      effective_metadata
    );
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
$function$;

CREATE OR REPLACE FUNCTION public.read_lpg_managed_driver_admin(target_driver_profile_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  result jsonb;
  managed_key text;
begin
  if coalesce(auth.role(),'') <> 'service_role'
    and not public.has_permission('platform.drivers.read',null)
    and not public.has_permission('platform.drivers.manage',null)
    and not public.has_permission('platform.financial.read',null)
    and not public.has_permission('platform.financial.manage',null)
    and not public.can_manage_lpg_operations()
    and not public.is_platform_super_admin() then
    raise exception using errcode='42501',message='managed Driver read permission is required';
  end if;

  managed_key:=coalesce(public.lpg_policy_config('lpg.fulfillment.launch_assurance')->>'internal_driver_program_key','driver.skima_special');

  select coalesce(jsonb_agg(row_data order by display_name asc),'[]'::jsonb)
  into result
  from (
    select
      coalesce(driver.driver_display_name,driver.public_driver_id,'SKIMA Driver') as display_name,
      jsonb_build_object(
        'driverProfileId',driver.id,
        'userId',driver.user_id,
        'displayName',coalesce(driver.driver_display_name,'SKIMA Driver'),
        'publicDriverId',driver.public_driver_id,
        'verificationStatus',driver.verification_status,
        'operationalStatus',driver.operational_status,
        'isManaged',coalesce(membership.program_key=managed_key,false),
        'driverTypeLabel',case when membership.program_key=managed_key then 'SKIMA Managed Driver' else 'Independent Driver' end,
        'managedSince',case when membership.program_key=managed_key then membership.starts_at else null end,
        'activeVehicleCount',coalesce(vehicle_summary.active_vehicle_count,0),
        'serviceAreaCount',coalesce(area_summary.service_area_count,0),
        'vehicleReady',coalesce(vehicle_summary.vehicle_ready,false),
        'coverageReady',coalesce(coverage_summary.coverage_ready,false),
        'pendingEarnings',coalesce(earnings.pending_earnings,0),
        'availableForPayout',coalesce(earnings.available_for_payout,0),
        'paidToWallet',coalesce(earnings.paid_to_wallet,0),
        'lifetimeEarnings',coalesce(earnings.lifetime_earnings,0),
        'driverWalletId',wallet.id,
        'driverWalletBalance',coalesce(balance.balance,0),
        'currencyCode','NGN',
        'lastPaidAt',payout.last_paid_at
      ) as row_data
    from public.driver_profiles driver
    left join lateral (
      select m.*
      from public.driver_program_memberships m
      where m.driver_profile_id=driver.id
        and m.status='active'
        and m.starts_at<=timezone('utc',now())
        and (m.ends_at is null or m.ends_at>timezone('utc',now()))
      order by m.starts_at desc
      limit 1
    ) membership on true
    left join lateral (
      select
        count(*)::integer as active_vehicle_count,
        coalesce(bool_or(
          vehicle.status='active'
          and (
            membership.program_key is distinct from managed_key
            or (vehicle.platform_owned and link.relationship_type='fleet_owned')
          )
          and coalesce((public.evaluate_driver_vehicle_eligibility(driver.id,vehicle.id,'lpg')->>'eligible')::boolean,false)
        ),false) as vehicle_ready
      from public.driver_vehicle_links link
      join public.vehicles vehicle on vehicle.id=link.vehicle_id
      where link.driver_profile_id=driver.id
        and link.status='active'
        and link.starts_at<=timezone('utc',now())
        and (link.ends_at is null or link.ends_at>timezone('utc',now()))
    ) vehicle_summary on true
    left join lateral (
      select count(*)::integer as service_area_count
      from public.operational_coverage_assignments area
      where area.entity_type='DRIVER'
        and area.entity_id=driver.id
        and area.service_key='lpg'
        and area.coverage_type='ADMIN_GEOGRAPHY'
        and area.status='active'
        and area.approved_at is not null
        and (area.valid_from is null or area.valid_from<=timezone('utc',now()))
        and (area.valid_to is null or area.valid_to>timezone('utc',now()))
        and coalesce(area.metadata->>'managedDriverServiceAreaKey',area.metadata->>'serviceAreaKey') is not null
    ) area_summary on true
    left join lateral (
      select exists(
        select 1
        from public.operational_coverage_assignments coverage
        where coverage.entity_type='DRIVER'
          and coverage.entity_id=driver.id
          and coverage.service_key='lpg'
          and coverage.status in ('approved','active')
          and coverage.approved_at is not null
          and (coverage.valid_from is null or coverage.valid_from<=timezone('utc',now()))
          and (coverage.valid_to is null or coverage.valid_to>timezone('utc',now()))
      ) as coverage_ready
    ) coverage_summary on true
    left join lateral (
      select
        coalesce(sum(case when e.status='accrued' then greatest(e.earning_amount-e.paid_amount,0) else 0 end),0) as pending_earnings,
        coalesce(sum(case when e.status='approved' then greatest(e.earning_amount-e.paid_amount,0) else 0 end),0) as available_for_payout,
        coalesce(sum(e.paid_amount),0) as paid_to_wallet,
        coalesce(sum(e.earning_amount),0) as lifetime_earnings
      from public.lpg_internal_driver_earnings e
      where e.driver_profile_id=driver.id and e.currency_code='NGN' and e.status<>'void'
    ) earnings on true
    left join lateral (
      select w.* from public.wallet_accounts w
      where w.wallet_type='driver' and w.owner_entity_type='driver'
        and w.owner_entity_id=driver.id and w.currency_code='NGN' and w.status='active'
      order by w.created_at asc limit 1
    ) wallet on true
    left join public.wallet_balances balance on balance.wallet_id=wallet.id
    left join lateral (
      select max(p.paid_at) as last_paid_at
      from public.lpg_internal_driver_payouts p
      where p.driver_profile_id=driver.id and p.currency_code='NGN' and p.status='posted'
    ) payout on true
    where target_driver_profile_id is null or driver.id=target_driver_profile_id
  ) rows;

  return result;
end
$function$;

CREATE OR REPLACE FUNCTION public.read_lpg_internal_service_area_options()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare result jsonb;
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

  select coalesce(jsonb_agg(jsonb_build_object(
    'key',area.key,
    'label',area.display_name,
    'areaType',area.area_type,
    'stateName',area.state_name,
    'lgaName',area.lga_name,
    'cityName',area.city_name,
    'townName',area.town_name,
    'referencePricePerKg',nullif(policy.configuration->>'amount_per_kg','')::numeric,
    'estimatedRouteKm',nullif(policy.configuration->>'estimated_route_km','')::numeric,
    'maxSupplierVariancePercent',nullif(policy.configuration->>'max_supplier_variance_percent','')::numeric,
    'priceConfigured',policy.id is not null
  ) order by area.priority desc,area.display_name asc),'[]'::jsonb)
  into result
  from public.service_areas area
  left join lateral (
    select version.id,version.configuration
    from public.financial_policy_versions version
    join public.financial_policy_definitions definition on definition.id=version.policy_definition_id
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
  ) policy on true
  where area.status='active';

  return result;
end
$function$;

commit;
