begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- Keep the browser/admin basemap on a credential-free raster source. LocationIQ
-- remains server-side for geocoding/routing and is never exposed as a public
-- tile credential. The frontend also validates the host and falls back to this
-- same keyless renderer if an old Vercel environment still contains a paid
-- provider tile URL.
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
    'active_renderer_key', 'renderer.maps.carto-voyager-keyless',
    'display_name', 'CARTO Voyager (OpenStreetMap data)',
    'tile_url_template', 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
    'attribution', chr(169) || ' OpenStreetMap contributors, ' || chr(169) || ' CARTO',
    'attribution_url', 'https://www.openstreetmap.org/copyright',
    'minimum_zoom', 1,
    'maximum_zoom', 19,
    'default_center', jsonb_build_object('longitude', 8.6753, 'latitude', 9.0820),
    'default_zoom', 6,
    'public_client_safe', true,
    'credential_required', false,
    'selection_source', 'platform_configuration',
    'operational_tier', 'keyless_launch'
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
  timezone('utc', now());

commit;
