create policy service_role_manage_temporary_test_funding_batches
on public.wallet_test_funding_batches
for all
to service_role
using (true)
with check (true);

create policy service_role_manage_temporary_test_funding_allocations
on public.wallet_test_funding_allocations
for all
to service_role
using (true)
with check (true);