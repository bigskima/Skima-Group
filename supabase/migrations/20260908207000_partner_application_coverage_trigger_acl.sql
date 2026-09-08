begin;

-- Trigger-only helper: it must never be callable as a public RPC.
revoke all on function public.normalize_partner_application_coverage_for_location()
  from public, anon, authenticated, service_role;

commit;
