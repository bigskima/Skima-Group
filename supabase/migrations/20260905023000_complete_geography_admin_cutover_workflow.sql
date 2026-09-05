begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

create or replace function public.read_geography_migration_reviews()
returns table (
  mapping_id uuid,
  legacy_id uuid,
  legacy_name text,
  migration_status text,
  validation_code text,
  geography_id uuid,
  geography_name text,
  country_code text,
  has_boundary boolean,
  geometry_source text,
  details jsonb,
  updated_at timestamptz
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
    mapping.legacy_id,
    area.display_name,
    mapping.migration_status,
    mapping.validation_code,
    mapping.geography_id,
    geography.canonical_name,
    coalesce(geography.country_code, area.country_code),
    geography.boundary_geometry is not null,
    mapping.geometry_source,
    mapping.details,
    mapping.updated_at
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

create or replace function public.review_geography_migration_mapping(
  p_mapping_id uuid,
  p_decision text,
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
  decision text := upper(btrim(coalesce(p_decision, '')));
  reason text := nullif(btrim(p_reason), '');
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_platform_super_admin()
     and not public.has_permission('platform.geography.manage', null) then
    raise exception using errcode = '42501', message = 'geography management permission required';
  end if;

  if p_mapping_id is null or decision not in ('VERIFIED', 'BLOCKED') or reason is null then
    raise exception using errcode = '22023', message = 'mapping, decision, and review reason are required';
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

  if decision = 'VERIFIED' then
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
          'reviewReason', reason,
          'reviewedAt', timezone('utc', now())
        ),
        updated_at = timezone('utc', now())
    where id = p_mapping_id;
  else
    update public.geography_migration_mappings
    set migration_status = 'blocked',
        validation_code = 'ADMIN_BLOCKED',
        verified_by = null,
        verified_at = null,
        details = coalesce(details, '{}'::jsonb) || jsonb_build_object(
          'reviewReason', reason,
          'reviewedAt', timezone('utc', now())
        ),
        updated_at = timezone('utc', now())
    where id = p_mapping_id;
  end if;

  return jsonb_build_object(
    'mappingId', p_mapping_id,
    'status', lower(decision),
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

revoke all on function public.read_geography_migration_reviews() from public, anon, authenticated;
revoke all on function public.review_geography_migration_mapping(uuid, text, text) from public, anon, authenticated;
revoke all on function public.migrate_verified_legacy_lpg_coverage_policies() from public, anon, authenticated;

grant execute on function public.read_geography_migration_reviews() to authenticated, service_role;
grant execute on function public.review_geography_migration_mapping(uuid, text, text) to authenticated, service_role;
grant execute on function public.migrate_verified_legacy_lpg_coverage_policies() to authenticated, service_role;

comment on function public.review_geography_migration_mapping(uuid, text, text) is
  'Admin review gate for imported legacy service-area boundaries. Verification never occurs automatically.';
comment on function public.migrate_verified_legacy_lpg_coverage_policies() is
  'Idempotently projects verified legacy LPG customer service-area rules into universal customer_ordering policies.';

commit;
