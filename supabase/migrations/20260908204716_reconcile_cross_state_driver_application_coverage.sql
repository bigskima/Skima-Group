begin;

-- Repair editable partner drafts that accidentally carried an old service-area
-- selection across a newly detected location in another state. This is the
-- exact failure mode that can leave a Lagos GPS point paired with Awka South.
with candidate_policy as (
  select
    greatest(
      500,
      least(
        coalesce(nullif(entry.value ->> 'radiusMeters', '')::integer, 5000),
        50000
      )
    ) as radius_meters
  from public.configuration_entries entry
  where entry.namespace = 'lpg.partner_onboarding'
    and entry.key = 'universal_candidate_coverage'
    and entry.scope_type = 'global'
    and entry.scope_id is null
    and entry.status = 'active'
    and entry.is_secret = false
    and coalesce((entry.value ->> 'enabled')::boolean, false)
    and coalesce((entry.value ->> 'driverEnabled')::boolean, false)
    and (entry.effective_from is null or entry.effective_from <= timezone('utc', now()))
    and (entry.effective_until is null or entry.effective_until > timezone('utc', now()))
  order by entry.version desc, entry.updated_at desc
  limit 1
),
targets as (
  select
    version.id as version_id,
    (version.payload -> 'location' ->> 'latitude')::double precision as latitude,
    (version.payload -> 'location' ->> 'longitude')::double precision as longitude,
    policy.radius_meters
  from public.application_records application
  join public.application_type_definitions application_type
    on application_type.id = application.application_type_id
  join public.application_versions version
    on version.application_id = application.id
   and version.version = application.active_version
  cross join candidate_policy policy
  cross join lateral jsonb_array_elements(
    coalesce(version.payload -> 'service' -> 'coverageRequests', '[]'::jsonb)
  ) request
  join public.geographies geography
    on geography.id::text = request ->> 'geographyId'
  where application.status in ('draft', 'incomplete', 'additional_info_required', 'resubmitted')
    and application_type.key = 'application.lpg.driver.phase-one'
    and jsonb_array_length(
      coalesce(version.payload -> 'service' -> 'coverageRequests', '[]'::jsonb)
    ) = 1
    and request ->> 'type' = 'ADMIN_GEOGRAPHY'
    and jsonb_typeof(version.payload -> 'location') = 'object'
    and nullif(version.payload -> 'location' ->> 'latitude', '') is not null
    and nullif(version.payload -> 'location' ->> 'longitude', '') is not null
    and nullif(
      coalesce(
        version.payload -> 'location' -> 'address' ->> 'state',
        version.payload -> 'location' -> 'address' ->> 'region'
      ),
      ''
    ) is not null
    and nullif(geography.metadata ->> 'state', '') is not null
    and regexp_replace(
      lower(coalesce(
        version.payload -> 'location' -> 'address' ->> 'state',
        version.payload -> 'location' -> 'address' ->> 'region'
      )),
      '\\s+state$',
      ''
    ) <> regexp_replace(
      lower(geography.metadata ->> 'state'),
      '\\s+state$',
      ''
    )
)
update public.application_versions version
set
  payload = jsonb_set(
    version.payload,
    '{service,coverageRequests}',
    jsonb_build_array(
      jsonb_build_object(
        'type', 'RADIUS',
        'latitude', target.latitude,
        'longitude', target.longitude,
        'radiusMeters', target.radius_meters,
        'source', 'universal_candidate_coverage'
      )
    ),
    true
  ),
  updated_at = timezone('utc', now())
from targets target
where version.id = target.version_id;

commit;
