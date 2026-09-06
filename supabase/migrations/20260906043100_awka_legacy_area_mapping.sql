begin;

-- The existing launch-area row is name-only ("Awka") and cannot be used as a
-- spatial authority. The owner explicitly selected Awka / Awka South for the
-- LPG pilot, so link that legacy row to the bounded Awka South geography
-- already sourced from OpenStreetMap relation 3715511.
--
-- This does not guess a boundary and does not create a second customer rule.
-- It only records the explicit legacy-to-bounded mapping so cutover/readiness
-- screens no longer treat the existing Awka launch row as unmapped.

insert into public.geography_migration_mappings (
  legacy_source,
  legacy_id,
  geography_id,
  migration_status,
  validation_code,
  geometry_source,
  details,
  verified_by,
  verified_at
)
select
  'service_areas',
  area.id,
  geography.id,
  'verified',
  'VERIFIED_OWNER_DIRECTIVE',
  'skima.openstreetmap.pilot:relation/3715511',
  jsonb_build_object(
    'mappingReason', 'Owner selected Awka / Awka South, Anambra, Nigeria for LPG pilot testing.',
    'legacyAreaKey', area.key,
    'legacyAreaName', area.display_name,
    'boundedGeographyName', geography.canonical_name,
    'boundedGeographyReference', geography.external_reference,
    'verifiedThrough', 'migration.owner_directive',
    'verifiedAt', timezone('utc', now())
  ),
  null,
  timezone('utc', now())
from public.service_areas area
join public.geographies geography
  on geography.source = 'skima.openstreetmap.pilot'
 and geography.external_reference = 'relation/3715511'
 and geography.status = 'active'
 and geography.boundary_geometry is not null
where area.key = 'lpg.ng.anambra.awka'
on conflict (legacy_source, legacy_id) do update
set geography_id = excluded.geography_id,
    migration_status = excluded.migration_status,
    validation_code = excluded.validation_code,
    geometry_source = excluded.geometry_source,
    details = coalesce(public.geography_migration_mappings.details, '{}'::jsonb) || excluded.details,
    verified_at = excluded.verified_at,
    updated_at = timezone('utc', now());

commit;
