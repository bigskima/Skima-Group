begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- Location providers remain swappable platform adapters. LocationIQ is the only
-- active external maps API for this release; Google Maps and Mapbox stay in the
-- catalog so a future, explicit change can reuse their existing configuration.
insert into public.provider_adapters (
  provider_kind,
  key,
  display_name,
  status,
  config,
  secret_ref
)
values (
  'maps',
  'provider.maps.locationiq',
  'LocationIQ',
  'active',
  jsonb_build_object(
    'provider', 'locationiq',
    'product', 'location_platform',
    'supports', jsonb_build_array('autocomplete', 'geocode', 'reverse_geocode', 'route_estimate'),
    'runtime_supported', true,
    'enabled_by_configuration', true,
    'geocoding_base_url', 'https://eu1.locationiq.com/v1',
    'autocomplete_base_url', 'https://api.locationiq.com/v1',
    'routing_base_url', 'https://eu1.locationiq.com/v1',
    'attribution', 'LocationIQ; OpenStreetMap contributors'
  ),
  'SUPABASE_SECRET:LOCATIONIQ_ACCESS_TOKEN'
)
on conflict (provider_kind, key) do update
set display_name = excluded.display_name,
    status = excluded.status,
    config = public.provider_adapters.config || excluded.config,
    secret_ref = excluded.secret_ref,
    updated_at = timezone('utc', now());

update public.provider_adapters
set status = case when key = 'provider.maps.locationiq' then 'active' else 'inactive' end,
    config = case
      when key = 'provider.maps.google-maps'
        then config || jsonb_build_object('runtime_supported', true, 'preserved', true)
      when key = 'provider.maps.mapbox'
        then config || jsonb_build_object('runtime_supported', false, 'preserved', true)
      else config
    end,
    updated_at = timezone('utc', now())
where provider_kind = 'maps';

update public.configuration_entries
set value = value || jsonb_build_object(
      'active_provider_key', 'provider.maps.locationiq',
      'supported_provider_keys', jsonb_build_array(
        'provider.maps.locationiq',
        'provider.maps.google-maps',
        'provider.maps.mapbox',
        'provider.maps.here',
        'provider.maps.openstreetmap',
        'provider.maps.sandbox'
      ),
      'selection_source', 'admin_configuration',
      'automatic_paid_fallback', false,
      'modules_call_provider_directly', false,
      'search_country_codes', jsonb_build_array('ng'),
      'search_language', 'en',
      'autocomplete_minimum_characters', 3,
      'autocomplete_result_limit', 6,
      'provider_timeout_milliseconds', 8000,
      'provider_retry_count', 1,
      'geocode_cache_ttl_seconds', 604800,
      'reverse_geocode_cache_ttl_seconds', 604800,
      'reverse_geocode_grid_decimals', 4,
      'autocomplete_cache_ttl_seconds', 21600,
      'route_cache_ttl_seconds', 900,
      'route_cache_grid_decimals', 5,
      'route_candidate_limit', 5,
      'attribution', 'LocationIQ; OpenStreetMap contributors'
    ),
    updated_by = auth.uid(),
    updated_at = timezone('utc', now())
where namespace = 'platform.maps'
  and key = 'provider_selection'
  and scope_type = 'global'
  and scope_id is null
  and status = 'active';

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
  'platform.maps',
  'provider_selection',
  'global',
  jsonb_build_object(
    'active_provider_key', 'provider.maps.locationiq',
    'supported_provider_keys', jsonb_build_array(
      'provider.maps.locationiq',
      'provider.maps.google-maps',
      'provider.maps.mapbox',
      'provider.maps.here',
      'provider.maps.openstreetmap',
      'provider.maps.sandbox'
    ),
    'selection_source', 'admin_configuration',
    'automatic_paid_fallback', false,
    'modules_call_provider_directly', false,
    'search_country_codes', jsonb_build_array('ng'),
    'search_language', 'en',
    'autocomplete_minimum_characters', 3,
    'autocomplete_result_limit', 6,
    'provider_timeout_milliseconds', 8000,
    'provider_retry_count', 1,
    'geocode_cache_ttl_seconds', 604800,
    'reverse_geocode_cache_ttl_seconds', 604800,
    'reverse_geocode_grid_decimals', 4,
    'autocomplete_cache_ttl_seconds', 21600,
    'route_cache_ttl_seconds', 900,
    'route_cache_grid_decimals', 5,
    'route_candidate_limit', 5,
    'attribution', 'LocationIQ; OpenStreetMap contributors'
  ),
  false,
  'active',
  1,
  timezone('utc', now())
where not exists (
  select 1
  from public.configuration_entries entry
  where entry.namespace = 'platform.maps'
    and entry.key = 'provider_selection'
    and entry.scope_type = 'global'
    and entry.scope_id is null
    and entry.status = 'active'
);

insert into public.rate_limit_policies (
  key,
  scope_type,
  limit_count,
  window_seconds,
  status,
  metadata
)
values
  (
    'maps.locationiq.autocomplete.user',
    'user',
    30,
    60,
    'active',
    '{"surface":"maps","operation":"autocomplete","configurable":true}'::jsonb
  ),
  (
    'maps.locationiq.geocode.user',
    'user',
    20,
    60,
    'active',
    '{"surface":"maps","operation":"geocode","configurable":true}'::jsonb
  ),
  (
    'maps.locationiq.reverse_geocode.user',
    'user',
    30,
    60,
    'active',
    '{"surface":"maps","operation":"reverse_geocode","configurable":true}'::jsonb
  ),
  (
    'maps.locationiq.route_estimate.user',
    'user',
    20,
    60,
    'active',
    '{"surface":"maps","operation":"route_estimate","configurable":true}'::jsonb
  ),
  (
    'maps.locationiq.provider.daily',
    'global',
    4500,
    86400,
    'active',
    '{"surface":"maps","purpose":"provider-cost-guard","configurable":true}'::jsonb
  )
on conflict (key) do update
set scope_type = excluded.scope_type,
    limit_count = excluded.limit_count,
    window_seconds = excluded.window_seconds,
    status = excluded.status,
    metadata = public.rate_limit_policies.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

insert into public.health_checks (key, status, details, checked_at)
values (
  'platform.maps.locationiq',
  'unknown',
  jsonb_build_object(
    'provider', 'locationiq',
    'message', 'Waiting for the first provider request',
    'secret_exposed_to_clients', false
  ),
  timezone('utc', now())
)
on conflict (key) do update
set details = public.health_checks.details || excluded.details,
    updated_at = timezone('utc', now());

create index if not exists provider_execution_logs_maps_created_idx
on public.provider_execution_logs (created_at desc)
where provider_kind = 'maps';

create index if not exists cache_entries_maps_expiry_idx
on public.cache_entries (namespace, expires_at desc)
where namespace like 'platform.maps.%';

create or replace function public.read_maps_location_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  provider_selection jsonb;
  active_provider_key text;
  provider_rows jsonb;
  health_row jsonb;
  metrics_row jsonb;
  cache_row jsonb;
  recent_changes jsonb;
begin
  if auth.role() <> 'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.providers.read', null)
    and not public.has_permission('platform.providers.manage', null) then
    raise exception 'maps and location status permission is required';
  end if;

  select entry.value
  into provider_selection
  from public.configuration_entries entry
  where entry.namespace = 'platform.maps'
    and entry.key = 'provider_selection'
    and entry.scope_type = 'global'
    and entry.scope_id is null
    and entry.status = 'active'
  order by entry.version desc
  limit 1;

  active_provider_key := provider_selection->>'active_provider_key';

  select coalesce(jsonb_agg(jsonb_build_object(
    'key', adapter.key,
    'displayName', adapter.display_name,
    'status', adapter.status,
    'active', adapter.key = active_provider_key,
    'preserved', coalesce((adapter.config->>'preserved')::boolean, false),
    'runtimeSupported', coalesce((adapter.config->>'runtime_supported')::boolean, false),
    'supports', coalesce(adapter.config->'supports', '[]'::jsonb),
    'attribution', adapter.config->>'attribution',
    'updatedAt', adapter.updated_at
  ) order by (adapter.key = active_provider_key) desc, adapter.display_name), '[]'::jsonb)
  into provider_rows
  from public.provider_adapters adapter
  where adapter.provider_kind = 'maps';

  select case when health.id is null then null else jsonb_build_object(
    'status', health.status,
    'details', health.details,
    'checkedAt', health.checked_at,
    'updatedAt', health.updated_at
  ) end
  into health_row
  from (select 1) seed
  left join public.health_checks health
    on health.key = 'platform.maps.locationiq';

  select jsonb_build_object(
    'requests24h', count(*),
    'succeeded24h', count(*) filter (where execution.status = 'succeeded'),
    'failed24h', count(*) filter (where execution.status = 'failed'),
    'cacheHits24h', count(*) filter (where execution.response_payload->>'cache' = 'hit'),
    'cacheMisses24h', count(*) filter (where execution.response_payload->>'cache' = 'miss'),
    'rateLimitEvents24h', count(*) filter (where execution.error_message = 'maps_rate_limited'),
    'averageLatencyMs24h', round(avg(
      case when jsonb_typeof(execution.response_payload->'latencyMs') = 'number'
        then (execution.response_payload->>'latencyMs')::numeric
        else null end
    ), 2),
    'lastRequestAt', max(execution.created_at)
  )
  into metrics_row
  from public.provider_execution_logs execution
  where execution.provider_kind = 'maps'
    and execution.created_at >= timezone('utc', now()) - interval '24 hours';

  select jsonb_build_object(
    'activeEntries', count(*) filter (where entry.expires_at is null or entry.expires_at > timezone('utc', now())),
    'expiredEntries', count(*) filter (where entry.expires_at <= timezone('utc', now())),
    'lastUpdatedAt', max(entry.updated_at)
  )
  into cache_row
  from public.cache_entries entry
  where entry.namespace like 'platform.maps.%';

  select coalesce(jsonb_agg(change_record order by created_at desc), '[]'::jsonb)
  into recent_changes
  from (
    select jsonb_build_object(
      'action', audit.action,
      'changedBy', coalesce(profile.display_name, 'Platform administrator'),
      'reason', audit.metadata->>'reason',
      'fromProviderKey', audit.before_state->>'activeProviderKey',
      'toProviderKey', audit.after_state->>'activeProviderKey',
      'createdAt', audit.created_at
    ) as change_record,
    audit.created_at
    from public.audit_logs audit
    left join public.profiles profile on profile.id = audit.actor_user_id
    where audit.entity_type = 'maps_provider_configuration'
    order by audit.created_at desc
    limit 20
  ) recent;

  return jsonb_build_object(
    'activeGeocoderKey', active_provider_key,
    'activeRouterKey', active_provider_key,
    'automaticPaidFallback', coalesce((provider_selection->>'automatic_paid_fallback')::boolean, false),
    'attribution', provider_selection->>'attribution',
    'policy', jsonb_build_object(
      'autocompleteMinimumCharacters', provider_selection->'autocomplete_minimum_characters',
      'autocompleteResultLimit', provider_selection->'autocomplete_result_limit',
      'routeCandidateLimit', provider_selection->'route_candidate_limit'
    ),
    'providers', provider_rows,
    'health', health_row,
    'metrics', metrics_row,
    'cache', cache_row,
    'recentChanges', recent_changes
  );
end;
$$;

create or replace function public.configure_maps_provider(
  target_provider_key text,
  target_reason text,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  provider_record public.provider_adapters%rowtype;
  provider_selection_id uuid;
  previous_provider_key text;
  existing_audit public.audit_logs%rowtype;
  audit_id uuid;
begin
  if auth.role() <> 'service_role' and not public.is_platform_super_admin() then
    raise exception 'only an active platform super admin can change the maps provider';
  end if;

  if target_provider_key is null or target_provider_key !~ '^provider[.]maps[.][a-z0-9-]+$' then
    raise exception 'choose a supported maps provider';
  end if;

  if target_reason is null or length(btrim(target_reason)) < 10 then
    raise exception 'a change reason of at least 10 characters is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'an idempotency key is required';
  end if;

  select adapter.*
  into provider_record
  from public.provider_adapters adapter
  where adapter.provider_kind = 'maps'
    and adapter.key = target_provider_key;

  if not found then
    raise exception 'the selected maps provider is not registered';
  end if;

  if not coalesce((provider_record.config->>'runtime_supported')::boolean, false) then
    raise exception 'the selected maps provider is preserved but is not enabled for runtime traffic';
  end if;

  select entry.id, entry.value->>'active_provider_key'
  into provider_selection_id, previous_provider_key
  from public.configuration_entries entry
  where entry.namespace = 'platform.maps'
    and entry.key = 'provider_selection'
    and entry.scope_type = 'global'
    and entry.scope_id is null
    and entry.status = 'active'
  order by entry.version desc
  limit 1
  for update;

  if not found then
    raise exception 'the maps provider selection is not configured';
  end if;

  -- Serialize retries on the active policy row, then re-check idempotency so
  -- concurrent duplicate requests cannot create duplicate audit entries.
  select audit.*
  into existing_audit
  from public.audit_logs audit
  where audit.entity_type = 'maps_provider_configuration'
    and audit.metadata->>'idempotencyKey' = target_idempotency_key
  order by audit.created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'activeProviderKey', existing_audit.after_state->>'activeProviderKey',
      'changed', false,
      'auditId', existing_audit.id
    );
  end if;

  if previous_provider_key = target_provider_key then
    return jsonb_build_object(
      'activeProviderKey', target_provider_key,
      'previousProviderKey', previous_provider_key,
      'changed', false,
      'auditId', null
    );
  end if;

  update public.provider_adapters
  set status = case when key = target_provider_key then 'active' else 'inactive' end,
      updated_at = timezone('utc', now())
  where provider_kind = 'maps';

  update public.configuration_entries
  set value = value || jsonb_build_object(
        'active_provider_key', target_provider_key,
        'selection_source', 'admin_configuration',
        'automatic_paid_fallback', false
      ),
      updated_by = auth.uid(),
      updated_at = timezone('utc', now())
  where id = provider_selection_id;

  insert into public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before_state,
    after_state,
    metadata
  )
  values (
    auth.uid(),
    'ACTIVATE_PROVIDER',
    'maps_provider_configuration',
    provider_record.id,
    jsonb_build_object('activeProviderKey', previous_provider_key),
    jsonb_build_object('activeProviderKey', target_provider_key),
    jsonb_build_object(
      'reason', btrim(target_reason),
      'idempotencyKey', target_idempotency_key,
      'automaticPaidFallback', false
    )
  )
  returning id into audit_id;

  return jsonb_build_object(
    'activeProviderKey', target_provider_key,
    'previousProviderKey', previous_provider_key,
    'changed', previous_provider_key is distinct from target_provider_key,
    'auditId', audit_id
  );
end;
$$;

revoke all on function public.read_maps_location_status() from public, anon;
revoke all on function public.configure_maps_provider(text, text, text) from public, anon;
grant execute on function public.read_maps_location_status() to authenticated, service_role;
grant execute on function public.configure_maps_provider(text, text, text) to authenticated, service_role;

commit;
