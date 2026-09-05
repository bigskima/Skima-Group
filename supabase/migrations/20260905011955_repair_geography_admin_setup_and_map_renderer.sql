begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- Repair the reusable global geography hierarchy in place. This restores only
-- platform-owned structural fields; it does not invent boundaries, coverage
-- policies, or advance the geography authority cutover.
do $$
declare
  country_level_id uuid;
  admin_level_1_id uuid;
  admin_level_2_id uuid;
  locality_level_id uuid;
begin
  insert into public.geography_levels (
    key,
    country_code,
    display_name,
    plural_display_name,
    depth,
    specificity_rank,
    parent_level_id,
    is_service_selectable,
    is_address_level,
    status,
    metadata
  )
  values (
    'country', null, 'Country', 'Countries', 0, 10, null, true, true, 'active',
    jsonb_build_object('scope', 'global', 'managedBy', 'platform.geography')
  )
  on conflict do nothing;

  select level.id
  into country_level_id
  from public.geography_levels level
  where level.key = 'country'
    and level.country_code is null;

  if country_level_id is null then
    raise exception using errcode = 'P0001', message = 'global country geography level could not be repaired';
  end if;

  update public.geography_levels
  set parent_level_id = null,
      depth = 0,
      specificity_rank = 10,
      status = 'active',
      metadata = metadata || jsonb_build_object(
        'scope', 'global',
        'managedBy', 'platform.geography',
        'seedVersion', 2
      ),
      updated_at = timezone('utc', now())
  where id = country_level_id;

  insert into public.geography_levels (
    key,
    country_code,
    display_name,
    plural_display_name,
    depth,
    specificity_rank,
    parent_level_id,
    is_service_selectable,
    is_address_level,
    status,
    metadata
  )
  values (
    'admin_level_1', null, 'Region level 1', 'Region level 1 areas', 1, 20,
    country_level_id, true, true, 'active',
    jsonb_build_object('scope', 'global', 'managedBy', 'platform.geography')
  )
  on conflict do nothing;

  select level.id
  into admin_level_1_id
  from public.geography_levels level
  where level.key = 'admin_level_1'
    and level.country_code is null;

  if admin_level_1_id is null then
    raise exception using errcode = 'P0001', message = 'global region level 1 could not be repaired';
  end if;

  update public.geography_levels
  set parent_level_id = country_level_id,
      depth = 1,
      specificity_rank = 20,
      status = 'active',
      metadata = metadata || jsonb_build_object(
        'scope', 'global',
        'managedBy', 'platform.geography',
        'seedVersion', 2
      ),
      updated_at = timezone('utc', now())
  where id = admin_level_1_id;

  insert into public.geography_levels (
    key,
    country_code,
    display_name,
    plural_display_name,
    depth,
    specificity_rank,
    parent_level_id,
    is_service_selectable,
    is_address_level,
    status,
    metadata
  )
  values (
    'admin_level_2', null, 'Region level 2', 'Region level 2 areas', 2, 30,
    admin_level_1_id, true, true, 'active',
    jsonb_build_object('scope', 'global', 'managedBy', 'platform.geography')
  )
  on conflict do nothing;

  select level.id
  into admin_level_2_id
  from public.geography_levels level
  where level.key = 'admin_level_2'
    and level.country_code is null;

  if admin_level_2_id is null then
    raise exception using errcode = 'P0001', message = 'global region level 2 could not be repaired';
  end if;

  update public.geography_levels
  set parent_level_id = admin_level_1_id,
      depth = 2,
      specificity_rank = 30,
      status = 'active',
      metadata = metadata || jsonb_build_object(
        'scope', 'global',
        'managedBy', 'platform.geography',
        'seedVersion', 2
      ),
      updated_at = timezone('utc', now())
  where id = admin_level_2_id;

  insert into public.geography_levels (
    key,
    country_code,
    display_name,
    plural_display_name,
    depth,
    specificity_rank,
    parent_level_id,
    is_service_selectable,
    is_address_level,
    status,
    metadata
  )
  values (
    'locality', null, 'Locality', 'Localities', 3, 40,
    admin_level_2_id, true, true, 'active',
    jsonb_build_object('scope', 'global', 'managedBy', 'platform.geography')
  )
  on conflict do nothing;

  select level.id
  into locality_level_id
  from public.geography_levels level
  where level.key = 'locality'
    and level.country_code is null;

  if locality_level_id is null then
    raise exception using errcode = 'P0001', message = 'global locality level could not be repaired';
  end if;

  update public.geography_levels
  set parent_level_id = admin_level_2_id,
      depth = 3,
      specificity_rank = 40,
      status = 'active',
      metadata = metadata || jsonb_build_object(
        'scope', 'global',
        'managedBy', 'platform.geography',
        'seedVersion', 2
      ),
      updated_at = timezone('utc', now())
  where id = locality_level_id;

  insert into public.geography_levels (
    key,
    country_code,
    display_name,
    plural_display_name,
    depth,
    specificity_rank,
    parent_level_id,
    is_service_selectable,
    is_address_level,
    status,
    metadata
  )
  values (
    'sublocality', null, 'Sublocality', 'Sublocalities', 4, 50,
    locality_level_id, true, true, 'active',
    jsonb_build_object('scope', 'global', 'managedBy', 'platform.geography')
  )
  on conflict do nothing;

  update public.geography_levels
  set parent_level_id = locality_level_id,
      depth = 4,
      specificity_rank = 50,
      status = 'active',
      metadata = metadata || jsonb_build_object(
        'scope', 'global',
        'managedBy', 'platform.geography',
        'seedVersion', 2
      ),
      updated_at = timezone('utc', now())
  where key = 'sublocality'
    and country_code is null;
end;
$$;

-- Map rendering is a separate, swappable concern from geocoding and routing.
-- This public-client-safe default needs no credential and keeps the Admin map
-- usable if a paid renderer has not been configured. A future active version
-- can replace it without a frontend build.
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
  'platform.maps',
  'renderer_selection',
  'global',
  null,
  jsonb_build_object(
    'active_renderer_key', 'renderer.maps.openstreetmap-standard',
    'display_name', 'OpenStreetMap Standard',
    'tile_url_template', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    'attribution', chr(169) || ' OpenStreetMap contributors',
    'attribution_url', 'https://www.openstreetmap.org/copyright',
    'minimum_zoom', 1,
    'maximum_zoom', 19,
    'default_center', jsonb_build_object('longitude', 8.6753, 'latitude', 9.0820),
    'default_zoom', 6,
    'public_client_safe', true,
    'selection_source', 'platform_configuration',
    'operational_tier', 'best_effort'
  ),
  false,
  'active',
  coalesce((
    select max(entry.version) + 1
    from public.configuration_entries entry
    where entry.namespace = 'platform.maps'
      and entry.key = 'renderer_selection'
      and entry.scope_type = 'global'
      and entry.scope_id is null
  ), 1),
  timezone('utc', now())
where not exists (
  select 1
  from public.configuration_entries entry
  where entry.namespace = 'platform.maps'
    and entry.key = 'renderer_selection'
    and entry.scope_type = 'global'
    and entry.scope_id is null
    and entry.status = 'active'
    and (entry.effective_from is null or entry.effective_from <= timezone('utc', now()))
    and (entry.effective_until is null or entry.effective_until > timezone('utc', now()))
);

create or replace function public.read_maps_renderer_configuration()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  renderer_record record;
  renderer_value jsonb := '{}'::jsonb;
  tile_url_template text;
  renderer_key text;
  display_name text;
  attribution text;
  attribution_url text;
  minimum_zoom integer := 1;
  maximum_zoom integer := 19;
  default_zoom integer := 6;
  default_longitude double precision := 8.6753;
  default_latitude double precision := 9.0820;
  using_fallback boolean := false;
begin
  if coalesce(auth.role(), '') not in ('anon', 'authenticated', 'service_role') then
    raise exception using errcode = '42501', message = 'map renderer configuration is unavailable';
  end if;

  select entry.id, entry.version, entry.value, entry.updated_at
  into renderer_record
  from public.configuration_entries entry
  where entry.namespace = 'platform.maps'
    and entry.key = 'renderer_selection'
    and entry.scope_type = 'global'
    and entry.scope_id is null
    and entry.status = 'active'
    and entry.is_secret = false
    and (entry.effective_from is null or entry.effective_from <= timezone('utc', now()))
    and (entry.effective_until is null or entry.effective_until > timezone('utc', now()))
  order by entry.version desc, entry.updated_at desc
  limit 1;

  if found then
    renderer_value := renderer_record.value;
  else
    using_fallback := true;
  end if;

  tile_url_template := nullif(btrim(renderer_value->>'tile_url_template'), '');
  if coalesce((renderer_value->>'public_client_safe')::boolean, false) is not true
     or tile_url_template is null
     or tile_url_template !~ '^https://[^[:space:]]+$'
     or position('{z}' in tile_url_template) = 0
     or position('{x}' in tile_url_template) = 0
     or position('{y}' in tile_url_template) = 0 then
    renderer_value := '{}'::jsonb;
    tile_url_template := 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    using_fallback := true;
  end if;

  renderer_key := coalesce(
    nullif(btrim(renderer_value->>'active_renderer_key'), ''),
    'renderer.maps.openstreetmap-standard'
  );
  display_name := coalesce(
    nullif(btrim(renderer_value->>'display_name'), ''),
    'OpenStreetMap Standard'
  );
  attribution := coalesce(
    nullif(btrim(renderer_value->>'attribution'), ''),
    chr(169) || ' OpenStreetMap contributors'
  );
  attribution_url := coalesce(
    nullif(btrim(renderer_value->>'attribution_url'), ''),
    'https://www.openstreetmap.org/copyright'
  );

  if jsonb_typeof(renderer_value->'minimum_zoom') = 'number' then
    minimum_zoom := greatest(0, least(20, (renderer_value->>'minimum_zoom')::integer));
  end if;
  if jsonb_typeof(renderer_value->'maximum_zoom') = 'number' then
    maximum_zoom := greatest(minimum_zoom, least(22, (renderer_value->>'maximum_zoom')::integer));
  end if;
  if jsonb_typeof(renderer_value->'default_zoom') = 'number' then
    default_zoom := greatest(minimum_zoom, least(maximum_zoom, (renderer_value->>'default_zoom')::integer));
  end if;
  if jsonb_typeof(renderer_value->'default_center') = 'object'
     and jsonb_typeof(renderer_value->'default_center'->'longitude') = 'number'
     and jsonb_typeof(renderer_value->'default_center'->'latitude') = 'number'
     and (renderer_value->'default_center'->>'longitude')::double precision between -180 and 180
     and (renderer_value->'default_center'->>'latitude')::double precision between -85.051129 and 85.051129 then
    default_longitude := (renderer_value->'default_center'->>'longitude')::double precision;
    default_latitude := (renderer_value->'default_center'->>'latitude')::double precision;
  end if;

  return jsonb_build_object(
    'version', coalesce(renderer_record.version, 0),
    'active_renderer_key', renderer_key,
    'display_name', display_name,
    'tile_url_template', tile_url_template,
    'attribution', attribution,
    'attribution_url', attribution_url,
    'min_zoom', minimum_zoom,
    'max_zoom', maximum_zoom,
    'default_center', jsonb_build_object(
      'longitude', default_longitude,
      'latitude', default_latitude
    ),
    'default_zoom', default_zoom,
    'using_fallback', using_fallback,
    'source', case when using_fallback then 'safe_fallback' else 'platform_configuration' end,
    'updated_at', renderer_record.updated_at
  );
end;
$$;

comment on function public.read_maps_renderer_configuration() is
  'Returns only public-client-safe map renderer settings. Never returns map provider credentials or unrestricted adapter configuration.';

create or replace function public.read_geography_admin_setup()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  can_read_geography boolean;
  can_manage_geography boolean;
  can_read_coverage boolean;
  can_manage_coverage boolean;
  level_rows jsonb;
  geography_rows jsonb;
  policy_rows jsonb;
  readiness jsonb;
  default_country_code text;
begin
  can_manage_geography := coalesce(auth.role(), '') = 'service_role'
    or public.is_platform_super_admin()
    or public.has_permission('platform.geography.manage', null);
  can_read_geography := can_manage_geography
    or public.has_permission('platform.geography.read', null);
  can_manage_coverage := coalesce(auth.role(), '') = 'service_role'
    or public.is_platform_super_admin()
    or public.has_permission('platform.coverage.manage', null);
  can_read_coverage := can_manage_coverage
    or public.has_permission('platform.coverage.read', null);

  if not can_read_geography or not can_read_coverage then
    raise exception using errcode = '42501', message = 'geography and coverage read permissions are required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', level.id,
    'key', level.key,
    'country_code', level.country_code,
    'display_name', level.display_name,
    'plural_display_name', level.plural_display_name,
    'depth', level.depth,
    'specificity_rank', level.specificity_rank,
    'parent_level_id', level.parent_level_id,
    'is_service_selectable', level.is_service_selectable,
    'is_address_level', level.is_address_level,
    'status', level.status
  ) order by level.depth, level.specificity_rank, level.display_name), '[]'::jsonb)
  into level_rows
  from public.geography_levels level
  where level.status = 'active';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', geography.id,
    'parent_id', geography.parent_id,
    'geography_level_id', geography.geography_level_id,
    'canonical_name', geography.canonical_name,
    'country_code', geography.country_code,
    'status', geography.status,
    'has_boundary', geography.boundary_geometry is not null,
    'boundary_geojson', case
      when geography.boundary_geometry is null then null
      else extensions.st_asgeojson(geography.boundary_geometry::extensions.geometry)::jsonb
    end,
    'geography_levels', jsonb_build_object(
      'key', level.key,
      'display_name', level.display_name,
      'depth', level.depth,
      'specificity_rank', level.specificity_rank,
      'parent_level_id', level.parent_level_id
    )
  ) order by level.depth, geography.canonical_name), '[]'::jsonb)
  into geography_rows
  from public.geographies geography
  join public.geography_levels level on level.id = geography.geography_level_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', policy.id,
    'service_key', policy.service_key,
    'capability_key', policy.capability_key,
    'target_geography_id', policy.target_geography_id,
    'effect', policy.effect,
    'priority', policy.priority,
    'status', policy.status,
    'starts_at', policy.starts_at,
    'ends_at', policy.ends_at,
    'reason', policy.reason,
    'geographies', jsonb_build_object('canonical_name', geography.canonical_name)
  ) order by policy.created_at desc), '[]'::jsonb)
  into policy_rows
  from public.service_coverage_policies policy
  join public.geographies geography on geography.id = policy.target_geography_id;

  readiness := public.read_universal_geography_cutover_readiness();

  select upper(entry.value->>'default_country_code')
  into default_country_code
  from public.configuration_entries entry
  where entry.namespace = 'platform.geography'
    and entry.key = 'search_policy'
    and entry.scope_type = 'global'
    and entry.scope_id is null
    and entry.status = 'active'
    and entry.is_secret = false
    and (entry.effective_from is null or entry.effective_from <= timezone('utc', now()))
    and (entry.effective_until is null or entry.effective_until > timezone('utc', now()))
  order by entry.version desc, entry.updated_at desc
  limit 1;

  return jsonb_build_object(
    'levels', level_rows,
    'geographies', geography_rows,
    'policies', policy_rows,
    'readiness', readiness,
    'defaultCountryCode', default_country_code,
    'permissions', jsonb_build_object(
      'canManageGeographies', can_manage_geography,
      'canManageCoverage', can_manage_coverage
    ),
    'setup', jsonb_build_object(
      'hasConfiguredLevels', jsonb_array_length(level_rows) > 0,
      'hasCanonicalGeographies', jsonb_array_length(geography_rows) > 0,
      'hasActivePolicies', exists(
        select 1 from public.service_coverage_policies where status = 'active'
      ),
      'authorityCanBeActivated', coalesce((readiness->>'ready')::boolean, false)
    )
  );
end;
$$;

comment on function public.read_geography_admin_setup() is
  'Returns the permission-scoped geography hierarchy, configured boundaries, coverage policies, and guarded cutover readiness for the Admin setup workflow.';

revoke all on function public.read_maps_renderer_configuration() from public, anon, authenticated;
revoke all on function public.read_geography_admin_setup() from public, anon, authenticated;
grant execute on function public.read_maps_renderer_configuration() to anon, authenticated, service_role;
grant execute on function public.read_geography_admin_setup() to authenticated, service_role;

commit;
