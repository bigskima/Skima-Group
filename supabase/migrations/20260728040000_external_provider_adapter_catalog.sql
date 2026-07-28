begin;

insert into public.provider_adapters (provider_kind, key, display_name, status, config, secret_ref)
values
  (
    'ai',
    'provider.ai.google-gemini',
    'Google Gemini AI Adapter',
    'inactive',
    '{"provider":"google","product":"gemini","execution":"official_api","control":"assist_only","enabled_by_configuration":true}'::jsonb,
    'SUPABASE_SECRET:GEMINI_API_KEY'
  ),
  (
    'ai',
    'provider.ai.openai',
    'OpenAI AI Adapter',
    'inactive',
    '{"provider":"openai","execution":"official_api","control":"assist_only","enabled_by_configuration":true}'::jsonb,
    'SUPABASE_SECRET:OPENAI_API_KEY'
  ),
  (
    'ai',
    'provider.ai.anthropic-claude',
    'Anthropic Claude AI Adapter',
    'inactive',
    '{"provider":"anthropic","product":"claude","execution":"official_api","control":"assist_only","enabled_by_configuration":true}'::jsonb,
    'SUPABASE_SECRET:ANTHROPIC_API_KEY'
  ),
  (
    'maps',
    'provider.maps.google-maps',
    'Google Maps Platform Adapter',
    'inactive',
    '{"provider":"google","product":"maps_platform","supports":["geocode","reverse_geocode","route","distance_matrix","eta","geofence"],"enabled_by_configuration":true}'::jsonb,
    'SUPABASE_SECRET:GOOGLE_MAPS_API_KEY'
  ),
  (
    'maps',
    'provider.maps.mapbox',
    'Mapbox Adapter',
    'inactive',
    '{"provider":"mapbox","supports":["geocode","reverse_geocode","route","distance_matrix","eta"],"enabled_by_configuration":true}'::jsonb,
    'SUPABASE_SECRET:MAPBOX_ACCESS_TOKEN'
  ),
  (
    'maps',
    'provider.maps.here',
    'HERE Maps Adapter',
    'inactive',
    '{"provider":"here","supports":["geocode","reverse_geocode","route","distance_matrix","eta"],"enabled_by_configuration":true}'::jsonb,
    'SUPABASE_SECRET:HERE_API_KEY'
  ),
  (
    'maps',
    'provider.maps.openstreetmap',
    'OpenStreetMap Adapter',
    'inactive',
    '{"provider":"openstreetmap","supports":["geocode","reverse_geocode","route"],"enabled_by_configuration":true}'::jsonb,
    null
  )
on conflict (provider_kind, key) do update
set display_name = excluded.display_name,
    status = excluded.status,
    config = excluded.config,
    secret_ref = excluded.secret_ref,
    updated_at = timezone('utc', now());

insert into public.configuration_entries (
  namespace,
  key,
  scope_type,
  scope_id,
  value,
  is_secret,
  status,
  version
)
values
  (
    'platform.ai',
    'provider_selection',
    'global',
    null,
    '{"active_provider_key":"provider.ai.sandbox","production_target_provider_key":"provider.ai.google-gemini","selection_source":"configuration","modules_call_provider_directly":false}'::jsonb,
    false,
    'active',
    1
  ),
  (
    'platform.maps',
    'provider_selection',
    'global',
    null,
    '{"active_provider_key":"provider.maps.sandbox","supported_provider_keys":["provider.maps.google-maps","provider.maps.mapbox","provider.maps.here","provider.maps.openstreetmap"],"selection_source":"configuration","modules_call_provider_directly":false}'::jsonb,
    false,
    'active',
    1
  )
on conflict do nothing;

commit;
