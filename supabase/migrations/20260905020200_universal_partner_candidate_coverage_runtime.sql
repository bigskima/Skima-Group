begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- Preserve SKIMA's expansion model after universal geography cutover. A partner
-- may apply from an area where customer LPG ordering is not yet launched. The
-- fallback is a universal RADIUS coverage request centered on verified device/
-- map coordinates; it does not create or reactivate legacy service-area rows.
insert into public.configuration_entries (
  namespace,
  key,
  scope_type,
  scope_id,
  value,
  is_secret,
  status,
  version,
  effective_from
)
select
  'lpg.partner_onboarding',
  'universal_candidate_coverage',
  'global',
  null,
  jsonb_build_object(
    'enabled', true,
    'driverEnabled', true,
    'stationEnabled', true,
    'radiusMeters', coalesce(
      (
        select nullif(entry.value ->> 'meters', '')::integer
        from public.configuration_entries entry
        where entry.namespace = 'lpg.partner_onboarding'
          and entry.key = 'candidate_area_radius_meters'
          and entry.scope_type = 'global'
          and entry.scope_id is null
          and entry.status = 'active'
          and entry.is_secret = false
          and (entry.effective_from is null or entry.effective_from <= timezone('utc', now()))
          and (entry.effective_until is null or entry.effective_until > timezone('utc', now()))
        order by entry.version desc, entry.updated_at desc
        limit 1
      ),
      5000
    ),
    'minimumRadiusMeters', 500,
    'maximumRadiusMeters', 50000,
    'source', 'legacy_partner_candidate_policy'
  ),
  false,
  'active',
  coalesce((
    select max(entry.version) + 1
    from public.configuration_entries entry
    where entry.namespace = 'lpg.partner_onboarding'
      and entry.key = 'universal_candidate_coverage'
      and entry.scope_type = 'global'
      and entry.scope_id is null
  ), 1),
  timezone('utc', now())
where not exists (
  select 1
  from public.configuration_entries entry
  where entry.namespace = 'lpg.partner_onboarding'
    and entry.key = 'universal_candidate_coverage'
    and entry.scope_type = 'global'
    and entry.scope_id is null
    and entry.status = 'active'
    and entry.is_secret = false
    and (entry.effective_from is null or entry.effective_from <= timezone('utc', now()))
    and (entry.effective_until is null or entry.effective_until > timezone('utc', now()))
);

create or replace function public.read_lpg_partner_candidate_coverage_configuration()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  configuration jsonb := '{}'::jsonb;
  enabled boolean := false;
  driver_enabled boolean := false;
  station_enabled boolean := false;
  radius_meters integer := 5000;
  minimum_radius integer := 500;
  maximum_radius integer := 50000;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  select entry.value
  into configuration
  from public.configuration_entries entry
  where entry.namespace = 'lpg.partner_onboarding'
    and entry.key = 'universal_candidate_coverage'
    and entry.scope_type = 'global'
    and entry.scope_id is null
    and entry.status = 'active'
    and entry.is_secret = false
    and (entry.effective_from is null or entry.effective_from <= timezone('utc', now()))
    and (entry.effective_until is null or entry.effective_until > timezone('utc', now()))
  order by entry.version desc, entry.updated_at desc
  limit 1;

  if found then
    enabled := coalesce((configuration ->> 'enabled')::boolean, true);
    driver_enabled := coalesce((configuration ->> 'driverEnabled')::boolean, true);
    station_enabled := coalesce((configuration ->> 'stationEnabled')::boolean, true);
    minimum_radius := greatest(
      100,
      least(coalesce(nullif(configuration ->> 'minimumRadiusMeters', '')::integer, 500), 50000)
    );
    maximum_radius := greatest(
      minimum_radius,
      least(coalesce(nullif(configuration ->> 'maximumRadiusMeters', '')::integer, 50000), 200000)
    );
    radius_meters := greatest(
      minimum_radius,
      least(coalesce(nullif(configuration ->> 'radiusMeters', '')::integer, 5000), maximum_radius)
    );
  end if;

  return jsonb_build_object(
    'enabled', enabled,
    'driverEnabled', driver_enabled,
    'stationEnabled', station_enabled,
    'radiusMeters', radius_meters,
    'minimumRadiusMeters', minimum_radius,
    'maximumRadiusMeters', maximum_radius,
    'source', 'platform_configuration'
  );
end;
$$;

create or replace function public.resolve_lpg_partner_candidate_coverage(
  p_partner_type text,
  p_latitude double precision,
  p_longitude double precision
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  partner_type text := upper(btrim(coalesce(p_partner_type, '')));
  configuration jsonb;
  onboarding_resolution jsonb;
  enabled boolean;
  radius_meters integer;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if partner_type not in ('DRIVER', 'STATION') then
    raise exception using errcode = '22023', message = 'partner type must be DRIVER or STATION';
  end if;

  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90
     or p_longitude not between -180 and 180 then
    raise exception using errcode = '22023', message = 'valid latitude and longitude are required';
  end if;

  configuration := public.read_lpg_partner_candidate_coverage_configuration();
  enabled := coalesce((configuration ->> 'enabled')::boolean, false)
    and case partner_type
      when 'DRIVER' then coalesce((configuration ->> 'driverEnabled')::boolean, false)
      when 'STATION' then coalesce((configuration ->> 'stationEnabled')::boolean, false)
      else false
    end;

  onboarding_resolution := public.resolve_service_availability(
    'lpg',
    case partner_type
      when 'DRIVER' then 'driver_onboarding'
      else 'station_onboarding'
    end,
    p_longitude,
    p_latitude,
    timezone('utc', now())
  );

  -- An explicit universal DENY always wins. The fallback exists only where no
  -- onboarding policy is configured for this point.
  if onboarding_resolution ->> 'reason' = 'AREA_EXCLUDED' then
    return jsonb_build_object(
      'available', false,
      'reason', 'AREA_EXCLUDED',
      'partnerType', partner_type,
      'request', null,
      'configuration', configuration
    );
  end if;

  if coalesce((onboarding_resolution ->> 'available')::boolean, false) then
    return jsonb_build_object(
      'available', true,
      'reason', 'CONFIGURED_GEOGRAPHY_AVAILABLE',
      'partnerType', partner_type,
      'matchedGeographyId', onboarding_resolution ->> 'matchedGeographyId',
      'request', null,
      'configuration', configuration
    );
  end if;

  if not enabled then
    return jsonb_build_object(
      'available', false,
      'reason', 'CANDIDATE_COVERAGE_DISABLED',
      'partnerType', partner_type,
      'request', null,
      'configuration', configuration
    );
  end if;

  radius_meters := (configuration ->> 'radiusMeters')::integer;

  return jsonb_build_object(
    'available', true,
    'reason', 'UNCONFIGURED_CANDIDATE_AREA',
    'partnerType', partner_type,
    'candidate', true,
    'request', jsonb_build_object(
      'type', 'RADIUS',
      'latitude', p_latitude,
      'longitude', p_longitude,
      'radiusMeters', radius_meters,
      'source', 'universal_candidate_coverage'
    ),
    'configuration', configuration
  );
end;
$$;

-- Preserve the former "partnerOpportunity outside launch coverage" behavior,
-- but make it governed and explicitly deny-able. Customer service availability
-- remains completely separate and is never enabled by this fallback.
create or replace function public.resolve_lpg_serviceability(
  p_latitude double precision,
  p_longitude double precision,
  p_geography jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  customer jsonb;
  driver_onboarding jsonb;
  station_onboarding jsonb;
  candidate_configuration jsonb;
  candidate_enabled boolean;
  driver_candidate_enabled boolean;
  station_candidate_enabled boolean;
  driver_available boolean;
  station_available boolean;
begin
  customer := public.resolve_service_availability(
    'lpg', 'customer_ordering', p_longitude, p_latitude, timezone('utc', now())
  );
  driver_onboarding := public.resolve_service_availability(
    'lpg', 'driver_onboarding', p_longitude, p_latitude, timezone('utc', now())
  );
  station_onboarding := public.resolve_service_availability(
    'lpg', 'station_onboarding', p_longitude, p_latitude, timezone('utc', now())
  );

  candidate_configuration := public.read_lpg_partner_candidate_coverage_configuration();
  candidate_enabled := coalesce((candidate_configuration ->> 'enabled')::boolean, false);
  driver_candidate_enabled := candidate_enabled
    and coalesce((candidate_configuration ->> 'driverEnabled')::boolean, false);
  station_candidate_enabled := candidate_enabled
    and coalesce((candidate_configuration ->> 'stationEnabled')::boolean, false);

  driver_available := coalesce((driver_onboarding ->> 'available')::boolean, false)
    or (
      customer ->> 'reason' <> 'AVAILABLE'
      and driver_onboarding ->> 'reason' = 'SERVICE_NOT_LAUNCHED'
      and driver_candidate_enabled
    );
  station_available := coalesce((station_onboarding ->> 'available')::boolean, false)
    or (
      customer ->> 'reason' <> 'AVAILABLE'
      and station_onboarding ->> 'reason' = 'SERVICE_NOT_LAUNCHED'
      and station_candidate_enabled
    );

  return jsonb_build_object(
    'serviceable', coalesce((customer ->> 'available')::boolean, false),
    'status', case
      when coalesce((customer ->> 'available')::boolean, false) then 'available'
      else 'unavailable'
    end,
    'reason', customer ->> 'reason',
    'matchedArea', case
      when customer ->> 'matchedGeographyId' is null then null
      else jsonb_build_object(
        'id', customer ->> 'matchedGeographyId',
        'policyId', customer ->> 'matchedPolicyId'
      )
    end,
    'partnerOpportunity', driver_available or station_available,
    'partnerOpportunities', jsonb_build_object(
      'driver', driver_available,
      'station', station_available
    ),
    'candidateCoverage', case
      when not coalesce((customer ->> 'available')::boolean, false)
        then jsonb_build_object(
          'enabled', candidate_enabled,
          'radiusMeters', candidate_configuration -> 'radiusMeters'
        )
      else null
    end
  );
end;
$$;

revoke all on function public.read_lpg_partner_candidate_coverage_configuration()
  from public, anon;
revoke all on function public.resolve_lpg_partner_candidate_coverage(text, double precision, double precision)
  from public, anon;
revoke all on function public.resolve_lpg_serviceability(double precision, double precision, jsonb)
  from public, anon;

grant execute on function public.read_lpg_partner_candidate_coverage_configuration()
  to authenticated, service_role;
grant execute on function public.resolve_lpg_partner_candidate_coverage(text, double precision, double precision)
  to authenticated, service_role;
grant execute on function public.resolve_lpg_serviceability(double precision, double precision, jsonb)
  to authenticated, service_role;

comment on function public.resolve_lpg_partner_candidate_coverage(text, double precision, double precision) is
  'Returns a DB-configured universal partner coverage fallback for an unconfigured area. Explicit universal onboarding DENY policies override this fallback.';

comment on function public.resolve_lpg_serviceability(double precision, double precision, jsonb) is
  'Resolves customer LPG service separately from governed driver/station partner opportunities, preserving expansion applications in unconfigured areas without enabling customer service.';

commit;
