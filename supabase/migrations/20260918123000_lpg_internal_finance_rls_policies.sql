begin;

-- Internal procurement and driver earning records are intentionally exposed
-- through audited SECURITY DEFINER functions, not direct client table access.
-- Keep direct authenticated access denied while making the RLS posture explicit.

drop policy if exists lpg_internal_refill_procurements_deny_direct_authenticated
  on public.lpg_internal_refill_procurements;

create policy lpg_internal_refill_procurements_deny_direct_authenticated
  on public.lpg_internal_refill_procurements
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists lpg_internal_driver_earnings_deny_direct_authenticated
  on public.lpg_internal_driver_earnings;

create policy lpg_internal_driver_earnings_deny_direct_authenticated
  on public.lpg_internal_driver_earnings
  for all
  to authenticated
  using (false)
  with check (false);

notify pgrst, 'reload schema';

commit;
