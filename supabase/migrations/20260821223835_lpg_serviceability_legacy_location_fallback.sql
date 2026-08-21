create or replace function public.geography_component_matches(
  expected_value text,
  target_value text,
  formatted_address text
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when expected_value is null then true
    when public.normalize_geography_token(target_value) is not null then
      public.normalize_geography_token(expected_value) = public.normalize_geography_token(target_value)
    when public.normalize_geography_token(formatted_address) is not null then
      (' ' || public.normalize_geography_token(formatted_address) || ' ')
        like ('% ' || public.normalize_geography_token(expected_value) || ' %')
    else false
  end;
$$;

create or replace function public.resolve_lpg_serviceability(
  p_latitude double precision,
  p_longitude double precision,
  p_geography jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  geography_root jsonb := coalesce(p_geography, '{}'::jsonb);
  geography_input jsonb;
  formatted_address text;
  target_country_code text;
  target_country text;
  target_state text;
  target_lga text;
  target_city text;
  target_town text;
  target_locality text;
  matched record;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90
     or p_longitude not between -180 and 180 then
    raise exception using errcode = '22023', message = 'valid latitude and longitude are required';
  end if;

  if jsonb_typeof(geography_root) <> 'object' then
    geography_root := '{}'::jsonb;
  end if;

  geography_input := case
    when jsonb_typeof(geography_root -> 'addressComponents') = 'object'
      then geography_root -> 'addressComponents'
    when jsonb_typeof(geography_root -> 'address_components') = 'object'
      then geography_root -> 'address_components'
    else geography_root
  end;

  formatted_address := coalesce(
    geography_root ->> 'formattedAddress',
    geography_root ->> 'formatted_address',
    geography_input ->> 'formattedAddress',
    geography_input ->> 'formatted_address'
  );

  target_country_code := public.normalize_geography_token(coalesce(geography_input ->> 'countryCode', geography_input ->> 'country_code'));
  target_country := public.normalize_geography_token(geography_input ->> 'country');
  target_state := public.normalize_geography_token(coalesce(geography_input ->> 'state', geography_input ->> 'region'));
  target_lga := public.normalize_geography_token(coalesce(geography_input ->> 'lga', geography_input ->> 'district'));
  target_city := public.normalize_geography_token(coalesce(geography_input ->> 'city', geography_input ->> 'municipality'));
  target_town := public.normalize_geography_token(coalesce(geography_input ->> 'town', geography_input ->> 'city'));
  target_locality := public.normalize_geography_token(coalesce(geography_input ->> 'locality', geography_input ->> 'village', geography_input ->> 'district'));

  select
    rule.effect,
    area.key,
    area.display_name,
    area.area_type
  into matched
  from public.lpg_service_area_rules rule
  join public.service_areas area on area.id = rule.area_id
  where rule.status = 'active'
    and area.status = 'active'
    and (rule.effective_from is null or rule.effective_from <= timezone('utc', now()))
    and (rule.effective_until is null or rule.effective_until > timezone('utc', now()))
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
        and public.geo_distance_meters(area.center_latitude, area.center_longitude, p_latitude, p_longitude) <= area.radius_meters
      )
      or (
        area.area_type = 'polygon'
        and public.geojson_polygon_contains_point(area.polygon_geojson, p_latitude, p_longitude)
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
    rule.priority desc,
    case rule.effect when 'exclude' then 1 else 0 end desc,
    area.priority desc,
    rule.created_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'serviceable', false,
      'status', 'unavailable',
      'reason', 'outside_enabled_area',
      'matchedArea', null,
      'partnerOpportunity', true
    );
  end if;

  return jsonb_build_object(
    'serviceable', matched.effect = 'include',
    'status', case when matched.effect = 'include' then 'available' else 'unavailable' end,
    'reason', case when matched.effect = 'include' then 'included_area' else 'excluded_area' end,
    'matchedArea', jsonb_build_object(
      'key', matched.key,
      'displayName', matched.display_name,
      'type', matched.area_type
    ),
    'partnerOpportunity', matched.effect <> 'include'
  );
end;
$$;

revoke all on function public.geography_component_matches(text, text, text) from public, anon, authenticated;

create or replace function public.enforce_lpg_refill_quote_serviceability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pickup_record record;
  delivery_record record;
  pickup_resolution jsonb;
  delivery_resolution jsonb;
begin
  select location.latitude, location.longitude, location.formatted_address, location.metadata
  into pickup_record
  from public.lpg_customer_locations location
  where location.id = new.pickup_location_id;

  if not found then
    raise exception using errcode = '23503', message = 'pickup location is missing for LPG serviceability verification';
  end if;

  select location.latitude, location.longitude, location.formatted_address, location.metadata
  into delivery_record
  from public.lpg_customer_locations location
  where location.id = new.delivery_location_id;

  if not found then
    raise exception using errcode = '23503', message = 'delivery location is missing for LPG serviceability verification';
  end if;

  pickup_resolution := public.resolve_lpg_serviceability(
    pickup_record.latitude,
    pickup_record.longitude,
    coalesce(pickup_record.metadata, '{}'::jsonb)
      || jsonb_build_object('formattedAddress', pickup_record.formatted_address)
  );

  if not coalesce((pickup_resolution ->> 'serviceable')::boolean, false) then
    raise exception using
      errcode = 'P0001',
      message = 'pickup location is outside enabled LPG service coverage';
  end if;

  delivery_resolution := public.resolve_lpg_serviceability(
    delivery_record.latitude,
    delivery_record.longitude,
    coalesce(delivery_record.metadata, '{}'::jsonb)
      || jsonb_build_object('formattedAddress', delivery_record.formatted_address)
  );

  if not coalesce((delivery_resolution ->> 'serviceable')::boolean, false) then
    raise exception using
      errcode = 'P0001',
      message = 'return location is outside enabled LPG service coverage';
  end if;

  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'serviceabilitySnapshot',
    jsonb_build_object(
      'verifiedAt', timezone('utc', now()),
      'pickup', pickup_resolution,
      'return', delivery_resolution
    )
  );

  return new;
end;
$$;
