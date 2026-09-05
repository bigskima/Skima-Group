begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- The Admin shell and geography setup RPC both treat an active Super Admin as
-- coverage-authorized. Keep the coverage-request RLS surface consistent with
-- that rule so the review queue does not disappear for Super Admin sessions.
drop policy if exists application_coverage_request_read
on public.application_operational_coverage_requests;

create policy application_coverage_request_read
on public.application_operational_coverage_requests
for select
to authenticated
using (
  applicant_user_id = auth.uid()
  or public.is_platform_super_admin()
  or public.has_permission('platform.coverage.read', null)
  or public.has_permission('platform.coverage.manage', null)
  or public.has_permission('platform.location_evidence.read', null)
);

comment on policy application_coverage_request_read
on public.application_operational_coverage_requests is
  'Allows applicants and authorized Admin coverage/location reviewers, including active Super Admins, to read universal partner coverage requests.';

commit;
