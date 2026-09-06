begin;

-- Awka / Awka South pilot coverage.
-- This is intentionally a bounded pilot zone, not a name-only service-area guess.
-- Boundary source: OpenStreetMap relation 3715511 (Awka South LGA).
-- The universal resolver remains coordinate based; "Awka" is an operator-facing alias only.

insert into public.geography_levels (
  key, country_code, display_name, plural_display_name, depth, specificity_rank,
  parent_level_id, is_service_selectable, is_address_level, status, metadata
)
values (
  'custom_zone', null, 'Service area', 'Service areas', 1000, 1000,
  null, true, false, 'active',
  jsonb_build_object('managedBy', 'platform.geography', 'operatorLabel', 'Service area')
)
on conflict do nothing;

do $$
declare
  zone_level_id uuid;
  awka_geography_id uuid;
  boundary extensions.geography(MultiPolygon, 4326);
  capability text;
  existing_policy_id uuid;
begin
  select id into zone_level_id
  from public.geography_levels
  where key = 'custom_zone'
    and country_code is null
    and status = 'active'
  order by created_at
  limit 1;

  if zone_level_id is null then
    raise exception using errcode = 'P0001', message = 'service-area geography level is unavailable';
  end if;

  boundary := extensions.st_multi(
    extensions.st_setsrid(
      extensions.st_geomfromgeojson(
        '{"type":"Polygon","coordinates":[[[7.0395246,6.158321],[7.03691,6.150913],[7.0395246,6.1448116],[7.045626,6.136968],[7.0613136,6.1265087],[7.066979,6.1234584],[7.07308,6.1195364],[7.0774384,6.1182294],[7.0817957,6.115178],[7.0809245,6.112564],[7.0892043,6.1147428],[7.0992274,6.1217155],[7.108815,6.1282516],[7.11448,6.1330457],[7.116659,6.138711],[7.1201453,6.1439404],[7.1249385,6.1491694],[7.13104,6.1535277],[7.137141,6.1570144],[7.1397552,6.1596284],[7.144331,6.174881],[7.1508684,6.1853404],[7.1526117,6.199285],[7.1517396,6.226304],[7.150997,6.2326117],[7.14772,6.2424564],[7.1316934,6.241121],[7.117313,6.241121],[7.1116476,6.2441716],[7.1020603,6.252451],[7.0920367,6.260295],[7.078528,6.2672677],[7.0667615,6.2690105],[7.0571737,6.26596],[7.0475864,6.2585526],[7.038435,6.2515798],[7.0284123,6.242864],[7.0188627,6.238191],[7.018607,6.2315335],[7.0203505,6.2284827],[7.0238366,6.2245607],[7.0260158,6.2202034],[7.03168,6.208437],[7.0356026,6.1997213],[7.0377812,6.1888266],[7.039961,6.1805463],[7.0412674,6.170959],[7.039961,6.163115],[7.0395246,6.158321]]]}'
      ),
      4326
    )
  )::extensions.geography;

  select id into awka_geography_id
  from public.geographies
  where source = 'skima.openstreetmap.pilot'
    and external_reference = 'relation/3715511'
  limit 1;

  if awka_geography_id is null then
    insert into public.geographies (
      parent_id, geography_level_id, canonical_name, normalized_name, country_code,
      boundary_geometry, centroid, source, external_reference, aliases, metadata, status
    )
    values (
      null,
      zone_level_id,
      'Awka South',
      public.normalize_geography_token('Awka South'),
      'NG',
      boundary,
      extensions.st_pointonsurface(boundary::extensions.geometry)::extensions.geography,
      'skima.openstreetmap.pilot',
      'relation/3715511',
      jsonb_build_array('Awka', 'Awka South LGA', 'Awka, Anambra'),
      jsonb_build_object(
        'pilotKey', 'lpg.awka_south.2026',
        'country', 'Nigeria',
        'state', 'Anambra',
        'lga', 'Awka South',
        'primaryCity', 'Awka',
        'boundarySource', 'OpenStreetMap',
        'boundaryReference', 'relation/3715511',
        'testingScope', true
      ),
      'active'
    )
    returning id into awka_geography_id;
  else
    update public.geographies
    set geography_level_id = zone_level_id,
        canonical_name = 'Awka South',
        normalized_name = public.normalize_geography_token('Awka South'),
        country_code = 'NG',
        boundary_geometry = boundary,
        centroid = extensions.st_pointonsurface(boundary::extensions.geometry)::extensions.geography,
        aliases = jsonb_build_array('Awka', 'Awka South LGA', 'Awka, Anambra'),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'pilotKey', 'lpg.awka_south.2026',
          'country', 'Nigeria',
          'state', 'Anambra',
          'lga', 'Awka South',
          'primaryCity', 'Awka',
          'boundarySource', 'OpenStreetMap',
          'boundaryReference', 'relation/3715511',
          'testingScope', true
        ),
        status = 'active',
        updated_at = timezone('utc', now())
    where id = awka_geography_id;
  end if;

  foreach capability in array array['customer_ordering', 'driver_onboarding', 'station_onboarding']
  loop
    existing_policy_id := null;

    select id into existing_policy_id
    from public.service_coverage_policies
    where service_key = 'lpg'
      and capability_key = capability
      and target_geography_id = awka_geography_id
    order by created_at, id
    limit 1;

    if existing_policy_id is not null then
      update public.service_coverage_policies
      set status = 'retired',
          updated_at = timezone('utc', now())
      where service_key = 'lpg'
        and capability_key = capability
        and target_geography_id = awka_geography_id
        and id <> existing_policy_id
        and status <> 'retired';

      update public.service_coverage_policies
      set effect = 'ALLOW',
          priority = 50,
          status = 'active',
          starts_at = null,
          ends_at = null,
          reason = 'Awka / Awka South LPG pilot testing',
          configuration = coalesce(configuration, '{}'::jsonb) || jsonb_build_object(
            'pilotKey', 'lpg.awka_south.2026',
            'operatorLabel', 'Awka South pilot',
            'testingScope', true
          ),
          updated_at = timezone('utc', now())
      where id = existing_policy_id;
    else
      insert into public.service_coverage_policies (
        service_key, capability_key, target_geography_id, effect, priority, status,
        starts_at, ends_at, reason, configuration
      )
      values (
        'lpg', capability, awka_geography_id, 'ALLOW', 50, 'active',
        null, null, 'Awka / Awka South LPG pilot testing',
        jsonb_build_object(
          'pilotKey', 'lpg.awka_south.2026',
          'operatorLabel', 'Awka South pilot',
          'testingScope', true
        )
      );
    end if;
  end loop;
end
$$;

comment on table public.service_coverage_policies is
  'Coordinate-based service permissions. The Awka South pilot is a real bounded test service area and must not be replaced with name-only matching.';

commit;
