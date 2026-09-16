begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

create index if not exists utility_service_fee_settings_updated_by_idx
  on public.utility_service_fee_settings(updated_by)
  where updated_by is not null;

drop policy if exists utility_service_fee_settings_no_direct_access
  on public.utility_service_fee_settings;
create policy utility_service_fee_settings_no_direct_access
  on public.utility_service_fee_settings
  for all
  to authenticated
  using (false)
  with check (false);

commit;
