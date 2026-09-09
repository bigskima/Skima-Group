begin;

set local lock_timeout='10s';
set local statement_timeout='0';

drop policy if exists utility_route_economics_read on public.utility_route_economics;
create policy utility_route_economics_read
on public.utility_route_economics
for select
to authenticated
using (
  public.has_permission('platform.billing.read',null)
  or public.has_permission('platform.billing.manage',null)
  or public.is_platform_super_admin()
);

drop policy if exists utility_route_economics_manage on public.utility_route_economics;
create policy utility_route_economics_manage
on public.utility_route_economics
for all
to authenticated
using (
  public.has_permission('platform.billing.manage',null)
  or public.is_platform_super_admin()
)
with check (
  public.has_permission('platform.billing.manage',null)
  or public.is_platform_super_admin()
);

drop policy if exists utility_provider_catalog_sync_runs_read
  on public.utility_provider_catalog_sync_runs;
create policy utility_provider_catalog_sync_runs_read
on public.utility_provider_catalog_sync_runs
for select
to authenticated
using (
  public.has_permission('platform.billing.read',null)
  or public.has_permission('platform.billing.manage',null)
  or public.is_platform_super_admin()
);

drop policy if exists utility_provider_catalog_sync_runs_manage
  on public.utility_provider_catalog_sync_runs;
create policy utility_provider_catalog_sync_runs_manage
on public.utility_provider_catalog_sync_runs
for all
to authenticated
using (
  public.has_permission('platform.billing.manage',null)
  or public.is_platform_super_admin()
)
with check (
  public.has_permission('platform.billing.manage',null)
  or public.is_platform_super_admin()
);

drop policy if exists utility_provider_catalog_items_read
  on public.utility_provider_catalog_items;
create policy utility_provider_catalog_items_read
on public.utility_provider_catalog_items
for select
to authenticated
using (
  public.has_permission('platform.billing.read',null)
  or public.has_permission('platform.billing.manage',null)
  or public.is_platform_super_admin()
);

drop policy if exists utility_provider_catalog_items_manage
  on public.utility_provider_catalog_items;
create policy utility_provider_catalog_items_manage
on public.utility_provider_catalog_items
for all
to authenticated
using (
  public.has_permission('platform.billing.manage',null)
  or public.is_platform_super_admin()
)
with check (
  public.has_permission('platform.billing.manage',null)
  or public.is_platform_super_admin()
);

commit;