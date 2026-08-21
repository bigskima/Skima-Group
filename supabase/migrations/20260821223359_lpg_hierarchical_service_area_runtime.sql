create table if not exists public.service_areas (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  display_name text not null,
  parent_area_id uuid null references public.service_areas(id) on delete restrict,
  area_type text not null check (area_type in ('country','state','lga','city','town','locality','radius','polygon')),
  country_code text null,
  country_name text null,
  state_name text null,
  lga_name text null,
  city_name text null,
  town_name text null,
  locality_name text null,
  center_latitude double precision null,
  center_longitude double precision null,
  radius_meters double precision null,
  polygon_geojson jsonb null,
  priority integer not null default 0,
  status text not null default 'active' check (status in ('active','inactive')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  source text not null default 'skima.platform.geography',
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint service_areas_source_idempotency_unique unique (source, idempotency_key),
  constraint service_areas_key_format check (key ~ '^[a-z][a-z0-9_.:-]{2,160}$'),
  constraint service_areas_country_code_format check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  constraint service_areas_latitude_range check (center_latitude is null or center_latitude between -90 and 90),
  constraint service_areas_longitude_range check (center_longitude is null or center_longitude between -180 and 180),
  constraint service_areas_radius_positive check (radius_meters is null or radius_meters > 0),
  constraint service_areas_shape_requirements check (
    (area_type = 'radius' and center_latitude is not null and center_longitude is not null and radius_meters is not null)
    or (area_type = 'polygon' and polygon_geojson is not null and jsonb_typeof(polygon_geojson) = 'object')
    or area_type in ('country','state','lga','city','town','locality')
  ),
  constraint service_areas_admin_requirements check (
    (area_type = 'country' and (country_code is not null or country_name is not null))
    or (area_type = 'state' and state_name is not null)
    or (area_type = 'lga' and state_name is not null and lga_name is not null)
    or (area_type = 'city' and state_name is not null and city_name is not null)
    or (area_type = 'town' and state_name is not null and town_name is not null)
    or (area_type = 'locality' and state_name is not null and locality_name is not null)
    or area_type in ('radius','polygon')
  )
);

create table if not exists public.lpg_service_area_rules (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.service_areas(id) on delete restrict,
  effect text not null check (effect in ('include','exclude')),
  priority integer not null default 0,
  status text not null default 'active' check (status in ('active','inactive')),
  effective_from timestamptz null,
  effective_until timestamptz null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  source text not null default 'skima.lpg.serviceability',
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint lpg_service_area_rules_source_idempotency_unique unique (source, idempotency_key),
  constraint lpg_service_area_rules_window_valid check (effective_until is null or effective_from is null or effective_until > effective_from)
);

create index if not exists service_areas_parent_idx on public.service_areas(parent_area_id);
create index if not exists service_areas_active_type_idx on public.service_areas(status, area_type, priority desc);
create index if not exists service_areas_admin_match_idx on public.service_areas(country_code, state_name, lga_name, city_name, town_name, locality_name) where status = 'active';
create index if not exists lpg_service_area_rules_active_area_idx on public.lpg_service_area_rules(area_id, status, priority desc);

alter table public.service_areas enable row level security;
alter table public.lpg_service_area_rules enable row level security;

revoke all on table public.service_areas from public, anon, authenticated;
revoke all on table public.lpg_service_area_rules from public, anon, authenticated;
grant select, insert, update, delete on table public.service_areas to authenticated;
grant select, insert, update, delete on table public.lpg_service_area_rules to authenticated;
grant all on table public.service_areas to service_role;
grant all on table public.lpg_service_area_rules to service_role;

drop policy if exists service_areas_manage_lpg_operations on public.service_areas;
create policy service_areas_manage_lpg_operations
on public.service_areas
for all
to authenticated
using (public.can_manage_lpg_operations())
with check (public.can_manage_lpg_operations());

drop policy if exists lpg_service_area_rules_manage_lpg_operations on public.lpg_service_area_rules;
create policy lpg_service_area_rules_manage_lpg_operations
on public.lpg_service_area_rules
for all
to authenticated
using (public.can_manage_lpg_operations())
with check (public.can_manage_lpg_operations());

drop trigger if exists set_service_areas_updated_at on public.service_areas;
create trigger set_service_areas_updated_at
before update on public.service_areas
for each row execute function public.set_updated_at();

drop trigger if exists set_lpg_service_area_rules_updated_at on public.lpg_service_area_rules;
create trigger set_lpg_service_area_rules_updated_at
before update on public.lpg_service_area_rules
for each row execute function public.set_updated_at();

create or replace function public.normalize_geography_token(input_value text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(btrim(regexp_replace(lower(coalesce(input_value, '')), '[^a-z0-9]+', ' ', 'g')), '');
$$;

create or replace function public.geo_distance_meters(
  latitude_one double precision,
  longitude_one double precision,
  latitude_two double precision,
  longitude_two double precision
)
returns double precision
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when latitude_one is null or longitude_one is null or latitude_two is null or longitude_two is null then null
    else 2.0 * 6371000.0 * asin(
      least(1.0, sqrt(
        power(sin(radians(latitude_two - latitude_one) / 2.0), 2)
        + cos(radians(latitude_one)) * cos(radians(latitude_two))
          * power(sin(radians(longitude_two - longitude_one) / 2.0), 2)
      ))
    )
  end;
$$;

create or replace function public.geojson_polygon_contains_point(
  polygon_geojson jsonb,
  latitude_value double precision,
  longitude_value double precision
)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  ring jsonb;
  point_count integer;
  i integer;
  j integer;
  xi double precision;
  yi double precision;
  xj double precision;
  yj double precision;
  intersects boolean;
  inside boolean := false;
begin
  if polygon_geojson is null
     or latitude_value is null
     or longitude_value is null
     or polygon_geojson ->> 'type' <> 'Polygon'
     or jsonb_typeof(polygon_geojson -> 'coordinates') <> 'array' then
    return false;
  end if;

  ring := polygon_geojson #> '{coordinates,0}';
  if ring is null or jsonb_typeof(ring) <> 'array' then
    return false;
  end if;

  point_count := jsonb_array_length(ring);
  if point_count < 4 then
    return false;
  end if;

  j := point_count - 1;
  for i in 0..point_count - 1 loop
    xi := (ring -> i ->> 0)::double precision;
    yi := (ring -> i ->> 1)::double precision;
    xj := (ring -> j ->> 0)::double precision;
    yj := (ring -> j ->> 1)::double precision;

    intersects := ((yi > latitude_value) <> (yj > latitude_value))
      and longitude_value < ((xj - xi) * (latitude_value - yi) / nullif(yj - yi, 0.0) + xi);
    if intersects then
      inside := not inside;
    end if;
    j := i;
  end loop;

  return inside;
exception
  when others then
    return false;
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
  geography_input jsonb := case
    when jsonb_typeof(coalesce(p_geography, '{}'::jsonb) -> 'addressComponents') = 'object'
      then coalesce(p_geography, '{}'::jsonb) -> 'addressComponents'
    else coalesce(p_geography, '{}'::jsonb)
  end;
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

  if jsonb_typeof(geography_input) <> 'object' then
    geography_input := '{}'::jsonb;
  end if;

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
        and (area.country_code is null or public.normalize_geography_token(area.country_code) = target_country_code)
        and (area.country_name is null or public.normalize_geography_token(area.country_name) = target_country)
        and (area.state_name is null or public.normalize_geography_token(area.state_name) = target_state)
        and (area.lga_name is null or public.normalize_geography_token(area.lga_name) = target_lga)
        and (area.city_name is null or public.normalize_geography_token(area.city_name) = target_city)
        and (area.town_name is null or public.normalize_geography_token(area.town_name) = target_town)
        and (area.locality_name is null or public.normalize_geography_token(area.locality_name) = target_locality)
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

revoke all on function public.normalize_geography_token(text) from public, anon, authenticated;
revoke all on function public.geo_distance_meters(double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function public.geojson_polygon_contains_point(jsonb, double precision, double precision) from public, anon, authenticated;
revoke all on function public.resolve_lpg_serviceability(double precision, double precision, jsonb) from public, anon;
grant execute on function public.resolve_lpg_serviceability(double precision, double precision, jsonb) to authenticated, service_role;

insert into public.service_areas (
  key,
  display_name,
  area_type,
  country_code,
  country_name,
  state_name,
  city_name,
  priority,
  status,
  metadata,
  source,
  idempotency_key
)
values (
  'lpg.ng.anambra.awka',
  'Awka',
  'city',
  'NG',
  'Nigeria',
  'Anambra',
  'Awka',
  100,
  'active',
  jsonb_build_object('policy', 'launch_area', 'managedBy', 'platform_geography'),
  'skima.lpg.serviceability',
  'launch-area-awka-v1'
)
on conflict (key) do nothing;

insert into public.lpg_service_area_rules (
  area_id,
  effect,
  priority,
  status,
  metadata,
  source,
  idempotency_key
)
select
  area.id,
  'include',
  100,
  'active',
  jsonb_build_object('policy', 'launch_area'),
  'skima.lpg.serviceability',
  'launch-area-awka-include-v1'
from public.service_areas area
where area.key = 'lpg.ng.anambra.awka'
on conflict (source, idempotency_key) do nothing;
