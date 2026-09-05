begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

create or replace function public.read_geography_migration_review_queue()
returns table (
  id uuid,
  legacy_source text,
  legacy_id uuid,
  legacy_display_name text,
  legacy_area_type text,
  geography_id uuid,
  geography_name text,
  geography_country_code text,
  migration_status text,
  validation_code text,
  geometry_source text,
  boundary_ready boolean,
  verified_at timestamptz,
  details jsonb
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_platform_super_admin()
     and not public.has_permission('platform.geography.read', null) then
    raise exception using errcode = '42501', message = 'geography read permission required';
  end if;

  return query
  select
    mapping.id,
    mapping.legacy_source,
    mapping.legacy_id,
    coalesce(area.display_name, geography.canonical_name, mapping.legacy_id::text),
    area.area_type,
    mapping.geography_id,
    geography.canonical_name,
    coalesce(geography.country_code, area.country_code),
    mapping.migration_status,
    mapping.validation_code,
    mapping.geometry_source,
    coalesce(
      geography.boundary_geometry is not null
      and geography.status = 'active'
      and geography.country_code ~ '^[A-Z]{2}$'
      and extensions.st_isvalid(geography.boundary_geometry::extensions.geometry),
      false
    ),
    mapping.verified_at,
    coalesce(mapping.details, '{}'::jsonb)
  from public.geography_migration_mappings mapping
  left join public.service_areas area
    on mapping.legacy_source = 'service_areas'
   and area.id = mapping.legacy_id
  left join public.geographies geography
    on geography.id = mapping.geography_id
  where mapping.legacy_source = 'service_areas'
  order by
    case mapping.migration_status
      when 'blocked' then 0
      when 'migrated' then 1
      when 'pending' then 2
      when 'verified' then 3
      else 4
    end,
    coalesce(area.display_name, geography.canonical_name, mapping.legacy_id::text);
end;
$$;

create or replace function public.verify_geography_migration_mapping(
  p_mapping_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  mapping_record record;
  geography_record record;
  review_reason text := nullif(btrim(p_reason), '');
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_platform_super_admin()
     and not public.has_permission('platform.geography.manage', null) then
    raise exception using errcode = '42501', message = 'geography management permission required';
  end if;

  if p_mapping_id is null or review_reason is null then
    raise exception using errcode = '22023', message = 'mapping and review reason are required';
  end if;

  select *
  into mapping_record
  from public.geography_migration_mappings
  where id = p_mapping_id
    and legacy_source = 'service_areas'
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'geography migration mapping was not found';
  end if;

  if mapping_record.geography_id is null then
    raise exception using errcode = '23514', message = 'a mapped geography is required before verification';
  end if;

  select *
  into geography_record
  from public.geographies
  where id = mapping_record.geography_id;

  if not found
     or geography_record.status <> 'active'
     or geography_record.boundary_geometry is null
     or not extensions.st_isvalid(geography_record.boundary_geometry::extensions.geometry)
     or geography_record.country_code !~ '^[A-Z]{2}$' then
    raise exception using errcode = '23514',
      message = 'the mapped geography must be active, bounded, valid, and have a country code before verification';
  end if;

  update public.geography_migration_mappings
  set migration_status = 'verified',
      validation_code = 'VERIFIED_BY_ADMIN',
      verified_by = auth.uid(),
      verified_at = timezone('utc', now()),
      details = coalesce(details, '{}'::jsonb) || jsonb_build_object(
        'reviewReason', review_reason,
        'reviewedAt', timezone('utc', now())
      ),
      updated_at = timezone('utc', now())
  where id = p_mapping_id;

  return jsonb_build_object(
    'mappingId', p_mapping_id,
    'status', 'verified',
    'readiness', public.read_universal_geography_cutover_readiness()
  );
end;
$$;

create or replace function public.migrate_verified_legacy_lpg_coverage_policies()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  inserted_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_platform_super_admin()
     and not public.has_permission('platform.coverage.manage', null) then
    raise exception using errcode = '42501', message = 'coverage management permission required';
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
    'Migrated from verified legacy LPG service coverage.',
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
        and policy.configuration->>'legacyRuleId' = rule.id::text
    );

  get diagnostics inserted_count = row_count;

  return jsonb_build_object(
    'inserted', inserted_count,
    'readiness', public.read_universal_geography_cutover_readiness()
  );
end;
$$;

revoke all on function public.read_geography_migration_review_queue() from public, anon, authenticated;
revoke all on function public.verify_geography_migration_mapping(uuid, text) from public, anon, authenticated;
revoke all on function public.migrate_verified_legacy_lpg_coverage_policies() from public, anon, authenticated;

grant execute on function public.read_geography_migration_review_queue() to authenticated, service_role;
grant execute on function public.verify_geography_migration_mapping(uuid, text) to authenticated, service_role;
grant execute on function public.migrate_verified_legacy_lpg_coverage_policies() to authenticated, service_role;

comment on function public.verify_geography_migration_mapping(uuid, text) is
  'Admin review gate for imported legacy service-area boundaries. Verification never occurs automatically.';

comment on function public.migrate_verified_legacy_lpg_coverage_policies() is
  'Idempotently projects verified legacy LPG customer service-area rules into universal customer_ordering policies.';

commit;
