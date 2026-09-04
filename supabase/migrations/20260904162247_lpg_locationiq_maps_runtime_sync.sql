begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- The LPG module consumes the platform maps selection through this local
-- policy projection. Core provider configuration remains unaware of LPG.
update public.lpg_operation_policies as runtime_policy
set policy = runtime_policy.policy || jsonb_build_object(
      'active_provider_key', selection.value->>'active_provider_key',
      'operations', jsonb_build_array('geocode', 'reverse_geocode', 'route_estimate', 'autocomplete'),
      'automatic_paid_fallback', false,
      'search_country_codes', selection.value->'search_country_codes',
      'search_language', selection.value->>'search_language',
      'autocomplete_minimum_characters', selection.value->'autocomplete_minimum_characters',
      'autocomplete_result_limit', selection.value->'autocomplete_result_limit',
      'provider_timeout_milliseconds', selection.value->'provider_timeout_milliseconds',
      'provider_retry_count', selection.value->'provider_retry_count',
      'geocode_cache_ttl_seconds', selection.value->'geocode_cache_ttl_seconds',
      'reverse_geocode_cache_ttl_seconds', selection.value->'reverse_geocode_cache_ttl_seconds',
      'reverse_geocode_grid_decimals', selection.value->'reverse_geocode_grid_decimals',
      'autocomplete_cache_ttl_seconds', selection.value->'autocomplete_cache_ttl_seconds',
      'route_cache_ttl_seconds', selection.value->'route_cache_ttl_seconds',
      'route_cache_grid_decimals', selection.value->'route_cache_grid_decimals',
      'route_candidate_limit', selection.value->'route_candidate_limit',
      'attribution', selection.value->>'attribution'
    ),
    metadata = runtime_policy.metadata || jsonb_build_object(
      'provider_migration', 'locationiq',
      'provider_selection_managed_by', 'platform.maps'
    ),
    updated_at = timezone('utc', now())
from (
  select entry.value
  from public.configuration_entries entry
  where entry.namespace = 'platform.maps'
    and entry.key = 'provider_selection'
    and entry.scope_type = 'global'
    and entry.scope_id is null
    and entry.status = 'active'
  order by entry.version desc
  limit 1
) selection
where runtime_policy.key = 'lpg.maps.phase_one';

create or replace function public.sync_lpg_maps_provider_selection()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status <> 'active' then
    return new;
  end if;

  update public.lpg_operation_policies as runtime_policy
  set policy = runtime_policy.policy || jsonb_build_object(
        'active_provider_key', new.value->>'active_provider_key',
        'automatic_paid_fallback', false,
        'search_country_codes', new.value->'search_country_codes',
        'search_language', new.value->>'search_language',
        'autocomplete_minimum_characters', new.value->'autocomplete_minimum_characters',
        'autocomplete_result_limit', new.value->'autocomplete_result_limit',
        'provider_timeout_milliseconds', new.value->'provider_timeout_milliseconds',
        'provider_retry_count', new.value->'provider_retry_count',
        'geocode_cache_ttl_seconds', new.value->'geocode_cache_ttl_seconds',
        'reverse_geocode_cache_ttl_seconds', new.value->'reverse_geocode_cache_ttl_seconds',
        'reverse_geocode_grid_decimals', new.value->'reverse_geocode_grid_decimals',
        'autocomplete_cache_ttl_seconds', new.value->'autocomplete_cache_ttl_seconds',
        'route_cache_ttl_seconds', new.value->'route_cache_ttl_seconds',
        'route_cache_grid_decimals', new.value->'route_cache_grid_decimals',
        'route_candidate_limit', new.value->'route_candidate_limit',
        'attribution', new.value->>'attribution'
      ),
      metadata = runtime_policy.metadata || jsonb_build_object(
        'provider_selection_managed_by', 'platform.maps',
        'provider_selection_synced_at', timezone('utc', now())
      ),
      updated_at = timezone('utc', now())
  where runtime_policy.key = 'lpg.maps.phase_one';

  return new;
end;
$$;

revoke all on function public.sync_lpg_maps_provider_selection() from public, anon, authenticated;

drop trigger if exists configuration_entries_sync_lpg_maps_provider on public.configuration_entries;
create trigger configuration_entries_sync_lpg_maps_provider
after insert or update of value, status
on public.configuration_entries
for each row
when (
  new.namespace = 'platform.maps'
  and new.key = 'provider_selection'
  and new.scope_type = 'global'
  and new.scope_id is null
)
execute function public.sync_lpg_maps_provider_selection();

-- Keep the established review RPC intact for older Admin builds. The v2 shape
-- adds structured address context and the coordinate-based LPG coverage result.
create or replace function public.read_partner_application_location_reviews_v2()
returns table (
  application_id uuid,
  application_version_id uuid,
  application_type_key text,
  workspace text,
  applicant_user_id uuid,
  applicant_display_name text,
  application_status text,
  operational_status text,
  location_purpose text,
  formatted_address text,
  latitude double precision,
  longitude double precision,
  accuracy_meters double precision,
  provider_source text,
  provider_place_id text,
  recorded_at timestamptz,
  verification_status text,
  reviewer_user_id uuid,
  reviewed_at timestamptz,
  review_reason text,
  service_areas jsonb,
  submitted_at timestamptz,
  updated_at timestamptz,
  address_details jsonb,
  service_zone_result jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role'
     and not public.can_review_applications()
     and not public.can_manage_applications() then
    raise exception using errcode = '42501', message = 'Application review permission is required';
  end if;

  return query
  select
    review.application_id,
    review.application_version_id,
    review.application_type_key,
    review.workspace,
    review.applicant_user_id,
    review.applicant_display_name,
    review.application_status,
    review.operational_status,
    review.location_purpose,
    review.formatted_address,
    review.latitude,
    review.longitude,
    review.accuracy_meters,
    review.provider_source,
    review.provider_place_id,
    review.recorded_at,
    review.verification_status,
    review.reviewer_user_id,
    review.reviewed_at,
    review.review_reason,
    review.service_areas,
    review.submitted_at,
    review.updated_at,
    jsonb_strip_nulls(jsonb_build_object(
      'state', coalesce(
        verification.evidence_snapshot->'location'->'address'->>'state',
        verification.evidence_snapshot->'location'->'address'->>'region'
      ),
      'stateCode', verification.evidence_snapshot->'location'->'address'->>'stateCode',
      'lga', coalesce(
        verification.evidence_snapshot->'location'->'address'->>'lga',
        verification.evidence_snapshot->'location'->'address'->>'district'
      ),
      'city', verification.evidence_snapshot->'location'->'address'->>'city',
      'town', coalesce(
        verification.evidence_snapshot->'location'->'address'->>'town',
        verification.evidence_snapshot->'location'->'address'->>'village'
      ),
      'district', verification.evidence_snapshot->'location'->'address'->>'district',
      'country', verification.evidence_snapshot->'location'->'address'->>'country',
      'countryCode', verification.evidence_snapshot->'location'->'address'->>'countryCode'
    )),
    jsonb_strip_nulls(jsonb_build_object(
      'available', service_resolution.result->'available',
      'reason', service_resolution.result->>'reason',
      'matchedGeographyId', service_resolution.result->>'matchedGeographyId',
      'matchedPolicyId', service_resolution.result->>'matchedPolicyId',
      'matchedGeographyName', matched_geography.canonical_name,
      'matchedGeographyLevel', matched_level.display_name
    ))
  from public.read_partner_application_location_reviews() review
  left join public.application_location_verifications verification
    on verification.application_version_id = review.application_version_id
   and verification.location_purpose = review.location_purpose
  cross join lateral (
    select case
      when review.latitude is null or review.longitude is null then
        jsonb_build_object('available', false, 'reason', 'LOCATION_REQUIRED')
      else public.resolve_service_availability(
        'lpg',
        case review.workspace
          when 'station' then 'station_onboarding'
          when 'driver' then 'driver_onboarding'
          else 'customer_ordering'
        end,
        review.longitude,
        review.latitude,
        timezone('utc', now())
      )
    end as result
  ) service_resolution
  left join public.geographies matched_geography
    on matched_geography.id::text = service_resolution.result->>'matchedGeographyId'
  left join public.geography_levels matched_level
    on matched_level.id = matched_geography.geography_level_id;
end;
$$;

revoke all on function public.read_partner_application_location_reviews_v2() from public, anon;
grant execute on function public.read_partner_application_location_reviews_v2() to authenticated, service_role;

commit;
