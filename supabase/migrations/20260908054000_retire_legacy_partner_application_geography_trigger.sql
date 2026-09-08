begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- Partner onboarding moved to application_operational_coverage_requests in the
-- universal coverage cutover. The older driver-only projector still listened
-- to every application_versions payload update and interpreted service-area
-- identifiers as legacy service_areas IDs. Current mobile clients correctly
-- submit universal geography IDs through service.coverageRequests, so leaving
-- both projectors active can reject an otherwise valid Driver application.
--
-- Preserve the legacy tables/functions for historical reads and migrations,
-- but stop projecting new application payloads into the retired selection
-- model. The universal trigger remains authoritative.
drop trigger if exists application_versions_sync_geography
  on public.application_versions;

comment on function public.sync_application_geography_for_version(uuid) is
  'Legacy LPG partner geography projector retained for historical compatibility. New application payloads are projected by sync_universal_application_location_and_coverage.';

-- Reinstall the universal projector idempotently so restored or partially
-- migrated environments cannot be left without a coverage projection trigger.
drop trigger if exists sync_universal_application_geography
  on public.application_versions;

create trigger sync_universal_application_geography
after insert or update of payload on public.application_versions
for each row
execute function public.sync_universal_application_location_and_coverage();

comment on trigger sync_universal_application_geography
on public.application_versions is
  'Authoritative Driver/Station onboarding projector for universal operational coverage requests and operating-location evidence.';

commit;
