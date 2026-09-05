begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- Preserve two distinct legacy decisions during universal cutover:
-- 1) LPG customer ordering follows lpg_service_area_rules.
-- 2) Driver/station onboarding follows service_areas.partnerSelectable and is
--    intentionally independent of whether customer ordering is launched there.
create or replace function public.migrate_verified_legacy_lpg_coverage_policies()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  customer_policy_count integer := 0;
  partner_policy_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_platform_super_admin()
     and not public.has_permission('platform.coverage.manage', null) then
    raise exception using errcode = '42501',
      message = 'coverage management permission required';
  end if;

  insert into public.service_coverage_policies (
    service_key,
    capability_key,
    target_geography_id,
    effect,
    priority,
    status,
    starts_at,
    ends_at,
    reason,
    configuration,
    created_by,
    updated_by
  )
  select
    'lpg',
    'customer_ordering',
    mapping.geography_id,
    case rule.effect when 'include' then 'ALLOW' else 'DENY' end,
    rule.priority,
    'active',
    rule.effective_from,
    rule.effective_until,
    'Migrated from verified legacy LPG customer service coverage.',
    jsonb_build_object(
      'migrationSource', 'lpg_service_area_rules',
      'legacyRuleId', rule.id,
      'legacyAreaId', rule.area_id,
      'legacySource', rule.source
    ),
    auth.uid(),
    auth.uid()
  from public.lpg_service_area_rules rule
  join public.geography_migration_mappings mapping
    on mapping.legacy_source = 'service_areas'
   and mapping.legacy_id = rule.area_id
   and mapping.migration_status = 'verified'
   and mapping.geography_id is not null
  join public.geographies geography
    on geography.id = mapping.geography_id
   and geography.status = 'active'
   and geography.boundary_geometry is not null
  where rule.status = 'active'
    and not exists (
      select 1
      from public.service_coverage_policies policy
      where policy.service_key = 'lpg'
        and policy.capability_key = 'customer_ordering'
        and policy.target_geography_id = mapping.geography_id
        and policy.status in ('draft', 'active', 'paused')
    );

  get diagnostics customer_policy_count = row_count;

  insert into public.service_coverage_policies (
    service_key,
    capability_key,
    target_geography_id,
    effect,
    priority,
    status,
    reason,
    configuration,
    created_by,
    updated_by
  )
  select
    'lpg',
    capability.key,
    mapping.geography_id,
    case
      when lower(coalesce(area.metadata ->> 'partnerSelectable', 'true')) = 'false'
        then 'DENY'
      else 'ALLOW'
    end,
    area.priority,
    'active',
    case
      when lower(coalesce(area.metadata ->> 'partnerSelectable', 'true')) = 'false'
        then 'Migrated legacy partner onboarding exclusion.'
      else 'Migrated legacy partner onboarding availability.'
    end,
    jsonb_build_object(
      'migrationSource', 'service_areas.partnerSelectable',
      'legacyPartnerAreaId', area.id,
      'legacyPartnerSelectable',
        lower(coalesce(area.metadata ->> 'partnerSelectable', 'true')) <> 'false',
      'legacyPartnerCandidate',
        lower(coalesce(area.metadata ->> 'partnerCandidate', 'false')) = 'true'
    ),
    auth.uid(),
    auth.uid()
  from public.service_areas area
  join public.geography_migration_mappings mapping
    on mapping.legacy_source = 'service_areas'
   and mapping.legacy_id = area.id
   and mapping.migration_status = 'verified'
   and mapping.geography_id is not null
  join public.geographies geography
    on geography.id = mapping.geography_id
   and geography.status = 'active'
   and geography.boundary_geometry is not null
  cross join (
    values ('driver_onboarding'::text), ('station_onboarding'::text)
  ) capability(key)
  where area.status = 'active'
    and not exists (
      select 1
      from public.service_coverage_policies policy
      where policy.service_key = 'lpg'
        and policy.capability_key = capability.key
        and policy.target_geography_id = mapping.geography_id
        and policy.status in ('draft', 'active', 'paused')
    );

  get diagnostics partner_policy_count = row_count;

  return jsonb_build_object(
    'inserted', customer_policy_count + partner_policy_count,
    'customerPoliciesInserted', customer_policy_count,
    'partnerOnboardingPoliciesInserted', partner_policy_count,
    'readiness', public.read_universal_geography_cutover_readiness()
  );
end;
$$;

revoke all on function public.migrate_verified_legacy_lpg_coverage_policies()
  from public, anon, authenticated;
grant execute on function public.migrate_verified_legacy_lpg_coverage_policies()
  to authenticated, service_role;

comment on function public.migrate_verified_legacy_lpg_coverage_policies() is
  'Idempotently migrates verified legacy LPG customer coverage and independent driver/station partnerSelectable decisions into universal service coverage policies without overriding an existing universal policy for the same geography/capability.';

commit;
