begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- Partner location review must show the same universal coverage requests that
-- onboarding and approval validate. Keep the legacy service-area JSON only as
-- a rolling-compatibility fallback for old application versions.
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
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_platform_super_admin()
     and not public.can_review_applications()
     and not public.can_manage_applications() then
    raise exception using errcode = '42501',
      message = 'Application review permission is required';
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
    case
      when universal_coverage.service_areas is not null
        then universal_coverage.service_areas
      else coalesce(review.service_areas, '[]'::jsonb)
    end,
    review.submitted_at,
    review.updated_at,
    jsonb_strip_nulls(jsonb_build_object(
      'state', coalesce(
        verification.evidence_snapshot -> 'location' -> 'address' ->> 'state',
        verification.evidence_snapshot -> 'location' -> 'address' ->> 'region'
      ),
      'stateCode', verification.evidence_snapshot -> 'location' -> 'address' ->> 'stateCode',
      'lga', coalesce(
        verification.evidence_snapshot -> 'location' -> 'address' ->> 'lga',
        verification.evidence_snapshot -> 'location' -> 'address' ->> 'district'
      ),
      'city', verification.evidence_snapshot -> 'location' -> 'address' ->> 'city',
      'town', coalesce(
        verification.evidence_snapshot -> 'location' -> 'address' ->> 'town',
        verification.evidence_snapshot -> 'location' -> 'address' ->> 'village'
      ),
      'district', verification.evidence_snapshot -> 'location' -> 'address' ->> 'district',
      'country', verification.evidence_snapshot -> 'location' -> 'address' ->> 'country',
      'countryCode', verification.evidence_snapshot -> 'location' -> 'address' ->> 'countryCode'
    )),
    jsonb_strip_nulls(jsonb_build_object(
      'available', service_resolution.result -> 'available',
      'reason', service_resolution.result ->> 'reason',
      'matchedGeographyId', service_resolution.result ->> 'matchedGeographyId',
      'matchedPolicyId', service_resolution.result ->> 'matchedPolicyId',
      'matchedGeographyName', matched_geography.canonical_name,
      'matchedGeographyLevel', matched_level.display_name
    ))
  from public.read_partner_application_location_reviews() review
  left join public.application_location_verifications verification
    on verification.application_version_id = review.application_version_id
   and verification.location_purpose = review.location_purpose
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'areaId', coalesce(request.geography_id, request.id),
        'displayName', coalesce(
          geography.canonical_name,
          nullif(btrim(request.request_snapshot ->> 'displayName'), ''),
          case request.coverage_type
            when 'RADIUS' then 'Requested operating radius'
            when 'CUSTOM_ZONE' then 'Requested custom zone'
            else 'Requested service geography'
          end
        ),
        'areaType', coalesce(level.key, lower(request.coverage_type)),
        'isPrimary', false,
        'stateName', null,
        'lgaName', null,
        'cityName', null,
        'townName', null,
        'localityName', null
      )
      order by
        coalesce(level.specificity_rank, 999999),
        coalesce(geography.canonical_name, request.coverage_type),
        request.id
    ) as service_areas
    from public.application_operational_coverage_requests request
    left join public.geographies geography
      on geography.id = request.geography_id
    left join public.geography_levels level
      on level.id = geography.geography_level_id
    where request.application_id = review.application_id
      and request.application_version_id = review.application_version_id
      and request.service_key = 'lpg'
      and request.status in ('REQUESTED', 'APPROVED')
  ) universal_coverage on true
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
    on matched_geography.id::text = service_resolution.result ->> 'matchedGeographyId'
  left join public.geography_levels matched_level
    on matched_level.id = matched_geography.geography_level_id;
end;
$$;

revoke all on function public.read_partner_application_location_reviews_v2()
  from public, anon;
grant execute on function public.read_partner_application_location_reviews_v2()
  to authenticated, service_role;

comment on function public.read_partner_application_location_reviews_v2() is
  'Reads partner location evidence with universal operational coverage requests as the primary Admin service-area projection and legacy selections only as a compatibility fallback.';

commit;
