-- Tighten the customer-owned saved biller table after its initial rollout.
-- Authenticated customers use the Data API; anonymous clients do not need direct table access.
revoke all on table public.utility_saved_beneficiaries from anon, public;
grant select, insert, update, delete
  on table public.utility_saved_beneficiaries
  to authenticated, service_role;

drop policy if exists utility_saved_beneficiaries_owner_select
  on public.utility_saved_beneficiaries;
drop policy if exists utility_saved_beneficiaries_owner_insert
  on public.utility_saved_beneficiaries;
drop policy if exists utility_saved_beneficiaries_owner_update
  on public.utility_saved_beneficiaries;
drop policy if exists utility_saved_beneficiaries_owner_delete
  on public.utility_saved_beneficiaries;

create policy utility_saved_beneficiaries_owner_select
  on public.utility_saved_beneficiaries
  for select to authenticated
  using ((select auth.uid()) = customer_user_id);

create policy utility_saved_beneficiaries_owner_insert
  on public.utility_saved_beneficiaries
  for insert to authenticated
  with check ((select auth.uid()) = customer_user_id);

create policy utility_saved_beneficiaries_owner_update
  on public.utility_saved_beneficiaries
  for update to authenticated
  using ((select auth.uid()) = customer_user_id)
  with check ((select auth.uid()) = customer_user_id);

create policy utility_saved_beneficiaries_owner_delete
  on public.utility_saved_beneficiaries
  for delete to authenticated
  using ((select auth.uid()) = customer_user_id);
