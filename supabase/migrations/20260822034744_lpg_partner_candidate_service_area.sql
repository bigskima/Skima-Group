insert into public.configuration_entries (
  namespace,
  key,
  scope_type,
  value,
  is_secret,
  status,
  version,
  effective_from
)
select
  'lpg.partner_onboarding',
  'candidate_area_radius_meters',
  'global',
  jsonb_build_object('meters', 5000),
  false,
  'active',
  1,
  timezone('utc', now())
where not exists (
  select 1
  from public.configuration_entries configuration
  where configuration.namespace = 'lpg.partner_onboarding'
    and configuration.key = 'candidate_area_radius_meters'
    and configuration.scope_type = 'global'
);

create or replace function public.resolve_or_create_lpg_partner_candidate_area(
  target_latitude double precision,
  target_longitude double precision,
  target_geography jsonb default '{}'::jsonb,
  target_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  geography_root jsonb := coalesce(target_geography, '{}'::jsonb);
  geography_input jsonb;
  formatted_address text;
  target_country_code text;
  target_country text;
  target_state text;
  target_lga text;
  target_city text;
  target_town text;
  target_locality text;
  candidate_radius double precision := 5000;
  display_token text;
  display_name_value text;
  generated_key text;
  resolved_area record;
  created_area_id uuid;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;

  if target_latitude is null or target_longitude is null
     or target_latitude not between -90 and 90
     or target_longitude not between -180 and 180 then
    raise exception using errcode = '22023', message = 'Valid latitude and longitude are required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception using errcode = '22023', message = 'Idempotency key is required';
  end if;

  if jsonb_typeof(geography_root) <> 'object' then
    geography_root := '{}'::jsonb;
  end if;

  geography_input := case
    when jsonb_typeof(geography_root -> 'addressComponents') = 'object'
      then geography_root -> 'addressComponents'
    when jsonb_typeof(geography_root -> 'address_components') = 'object'
      then geography_root -> 'address_components'
    when jsonb_typeof(geography_root -> 'address') = 'object'
      then geography_root -> 'address'
    else geography_root
  end;

  formatted_address := coalesce(
    geography_root ->> 'formattedAddress',
    geography_root ->> 'formatted_address',
    geography_input ->> 'formattedAddress',
    geography_input ->> 'formatted_address'
  );

  target_country_code := public.normalize_geography_token(coalesce(
    geography_input ->> 'countryCode',
    geography_input ->> 'country_code'
  ));
  target_country := public.normalize_geography_token(geography_input ->> 'country');
  target_state := public.normalize_geography_token(coalesce(
    geography_input ->> 'state',
    geography_input ->> 'region'
  ));
  target_lga := public.normalize_geography_token(coalesce(
    geography_input ->> 'lga',
    geography_input ->> 'district'
  ));
  target_city := public.normalize_geography_token(coalesce(
    geography_input ->> 'city',
    geography_input ->> 'municipality'
  ));
  target_town := public.normalize_geography_token(coalesce(
    geography_input ->> 'town',
    geography_input ->> 'city'
  ));
  target_locality := public.normalize_geography_token(coalesce(
    geography_input ->> 'locality',
    geography_input ->> 'village',
    geography_input ->> 'district'
  ));

  -- Partner application matching deliberately ignores the customer service rules.
  -- This lets a partner apply in a configured area even when LPG ordering is off there.
  select area.*
  into resolved_area
  from public.service_areas area
  where area.status = 'active'
    and coalesce(area.metadata ->> 'partnerSelectable', 'true') <> 'false'
    and (
      (
        area.area_type in ('country','state','lga','city','town','locality')
        and (area.country_code is null or target_country_code is null or public.normalize_geography_token(area.country_code) = target_country_code)
        and public.geography_component_matches(area.country_name, target_country, formatted_address)
        and public.geography_component_matches(area.state_name, target_state, formatted_address)
        and public.geography_component_matches(area.lga_name, target_lga, formatted_address)
        and public.geography_component_matches(area.city_name, target_city, formatted_address)
        and public.geography_component_matches(area.town_name, target_town, formatted_address)
        and public.geography_component_matches(area.locality_name, target_locality, formatted_address)
      )
      or (
        area.area_type = 'radius'
        and public.geo_distance_meters(area.center_latitude, area.center_longitude, target_latitude, target_longitude) <= area.radius_meters
      )
      or (
        area.area_type = 'polygon'
        and public.geojson_polygon_contains_point(area.polygon_geojson, target_latitude, target_longitude)
      )
    )
  order by
    case area.area_type
      when 'country' then 10
      when 'state' then 20
      when 'lga' then 30
      when 'city' then 40
      when 'town' then 50
      when 'locality' then 60
      when 'radius' then 70
      when 'polygon' then 80
      else 0
    end desc,
    case when coalesce((area.metadata ->> 'partnerCandidate')::boolean, false) then 0 else 1 end desc,
    area.priority desc,
    area.created_at asc
  limit 1;

  if found then
    return jsonb_build_object(
      'areaId', resolved_area.id,
      'displayName', resolved_area.display_name,
      'areaType', resolved_area.area_type,
      'candidate', coalesce((resolved_area.metadata ->> 'partnerCandidate')::boolean, false),
      'created', false
    );
  end if;

  select coalesce(
    nullif(configuration.value ->> 'meters', '')::double precision,
    5000
  )
  into candidate_radius
  from public.configuration_entries configuration
  where configuration.namespace = 'lpg.partner_onboarding'
    and configuration.key = 'candidate_area_radius_meters'
    and configuration.scope_type = 'global'
    and configuration.status = 'active'
    and (configuration.effective_from is null or configuration.effective_from <= timezone('utc', now()))
    and (configuration.effective_until is null or configuration.effective_until > timezone('utc', now()))
  order by configuration.version desc, configuration.updated_at desc
  limit 1;

  candidate_radius := greatest(500, least(coalesce(candidate_radius, 5000), 50000));

  -- Reuse a nearby candidate before creating another one so early applications
  -- do not produce a large set of overlapping geography records.
  select area.*
  into resolved_area
  from public.service_areas area
  where area.status = 'active'
    and area.area_type = 'radius'
    and coalesce((area.metadata ->> 'partnerCandidate')::boolean, false)
    and public.geo_distance_meters(area.center_latitude, area.center_longitude, target_latitude, target_longitude)
      <= greatest(500, least(area.radius_meters, candidate_radius) * 0.5)
  order by public.geo_distance_meters(area.center_latitude, area.center_longitude, target_latitude, target_longitude), area.created_at
  limit 1;

  if found then
    return jsonb_build_object(
      'areaId', resolved_area.id,
      'displayName', resolved_area.display_name,
      'areaType', resolved_area.area_type,
      'candidate', true,
      'created', false
    );
  end if;

  display_token := coalesce(
    nullif(btrim(geography_input ->> 'locality'), ''),
    nullif(btrim(geography_input ->> 'village'), ''),
    nullif(btrim(geography_input ->> 'town'), ''),
    nullif(btrim(geography_input ->> 'city'), ''),
    nullif(btrim(geography_input ->> 'district'), ''),
    nullif(btrim(geography_input ->> 'region'), ''),
    'Requested service area'
  );
  display_token := left(regexp_replace(display_token, '[[:cntrl:]]', '', 'g'), 100);
  display_name_value := case
    when lower(display_token) like '% area' then display_token
    else display_token || ' area'
  end;

  generated_key := 'geo.partner-candidate.' || substr(md5(concat_ws(':',
    round(target_latitude::numeric, 4)::text,
    round(target_longitude::numeric, 4)::text,
    lower(display_token)
  )), 1, 20);

  insert into public.service_areas (
    key,
    display_name,
    area_type,
    country_code,
    country_name,
    state_name,
    lga_name,
    city_name,
    town_name,
    locality_name,
    center_latitude,
    center_longitude,
    radius_meters,
    priority,
    status,
    metadata,
    source,
    idempotency_key
  ) values (
    generated_key,
    display_name_value,
    'radius',
    upper(nullif(btrim(coalesce(geography_input ->> 'countryCode', geography_input ->> 'country_code')), '')),
    nullif(btrim(geography_input ->> 'country'), ''),
    nullif(btrim(coalesce(geography_input ->> 'state', geography_input ->> 'region')), ''),
    nullif(btrim(coalesce(geography_input ->> 'lga', geography_input ->> 'district')), ''),
    nullif(btrim(geography_input ->> 'city'), ''),
    nullif(btrim(geography_input ->> 'town'), ''),
    nullif(btrim(coalesce(geography_input ->> 'locality', geography_input ->> 'village')), ''),
    target_latitude,
    target_longitude,
    candidate_radius,
    -100,
    'active',
    jsonb_build_object(
      'partnerCandidate', true,
      'partnerSelectable', true,
      'customerServiceEnabled', false,
      'createdFromUserId', auth.uid(),
      'createdFromDetectedLocation', true
    ),
    'skima.lpg.partner_candidate',
    btrim(target_idempotency_key)
  )
  on conflict (key) do update
  set updated_at = timezone('utc', now())
  returning id into created_area_id;

  select area.* into resolved_area
  from public.service_areas area
  where area.id = created_area_id;

  return jsonb_build_object(
    'areaId', resolved_area.id,
    'displayName', resolved_area.display_name,
    'areaType', resolved_area.area_type,
    'candidate', true,
    'created', true
  );
end;
$$;

revoke all on function public.resolve_or_create_lpg_partner_candidate_area(double precision,double precision,jsonb,text) from public, anon;
grant execute on function public.resolve_or_create_lpg_partner_candidate_area(double precision,double precision,jsonb,text) to authenticated, service_role;
