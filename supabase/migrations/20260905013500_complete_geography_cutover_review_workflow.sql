begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- Finish the universal geography cutover without guessing boundaries.
-- Legacy spatial rows are imported, name-only/blocked rows may be explicitly
-- linked to a real canonical bounded geography, and every mapping still needs
-- an explicit Admin verification before it can count toward readiness.
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
    coalesce(area.display_name, mapping.details->>'displayName', geography.canonical_name, mapping.legacy_id::text),
    area.area_type,
    mapping.geography_id,
    geography.canonical_name,
    coalesce(geography.country_code, area.country_code),
    mapping.migration_status,
    mapping.validation_code,
    mapping.geometry_source,
    coalesce(
      mapping.geography_id is not null
      and mapping.geometry_source is not null
      and geography.status = 'active'
      and geography.boundary_geometry is not null
      and geography.country_code ~ '^[A-Z]{2}$'
      and extensions.st_isvalid(geography.boundary_geometry::extensions.geometry),
      false
    ) as boundary_ready,
    mapping.verified_at,
    coalesce(mapping.details, '{}'::jsonb)
  from public.geography_migration_mappings mapping
  left join public.service_areas area
    on mapping.legacy_source = 'service_areas'
   and area.id = mapping.legacy_id
  left join public.geographies geography
    on geography.id = mapping.geography_id
  order by
    case mapping.migration_status
      when 'blocked' then 0
      when 'migrated' then 1
      when 'pending' then 2
      when 'verified' then 3
      else 4
    end,
    coalesce(area.display_name, geography.canonical_name, mapping.legacy_id::text),
    mapping.id;
end;
$$;

create or replace function public.link_geography_migration_mapping(
  p_mapping_id uuid,
  p_geography_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  mapping_record public.geography_migration_mappings%rowtype;
  geography_record public.geographies%rowtype;
  now_at timestamptz := timezone('utc', now());
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_platform_super_admin()
     and not public.has_permission('platform.geography.manage', null) then
    raise exception using errcode = '42501', message = 'geography management permission required';
  end if;

  if p_mapping_id is null or p_geography_id is null then
    raise exception using errcode = '22023',
      message = 'mapping id and canonical geography id are required';
  end if;

  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'link reason is required';
  end if;

  select *
  into mapping_record
  from public.geography_migration_mappings
  where id = p_mapping_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'geography migration mapping was not found';
  end if;

  if mapping_record.migration_status in ('verified', 'retired') then
    raise exception using errcode = '55000',
      message = 'verified or retired geography mappings cannot be relinked';
  end if;

  select *
  into geography_record
  from public.geographies
  where id = p_geography_id;

  if not found
     or geography_record.status <> 'active'
     or geography_record.boundary_geometry is null
     or geography_record.country_code !~ '^[A-Z]{2}$'
     or not extensions.st_isvalid(geography_record.boundary_geometry::extensions.geometry) then
    raise exception using errcode = '55000',
      message = 'choose an active canonical geography with a valid boundary and country code';
  end if;

  update public.geography_migration_mappings
  set geography_id = p_geography_id,
      migration_status = 'migrated',
      validation_code = 'READY_FOR_VERIFICATION',
      geometry_source = 'admin_linked_canonical_boundary',
      verified_by = null,
      verified_at = null,
      details = coalesce(details, '{}'::jsonb) || jsonb_build_object(
        'linkReason', btrim(p_reason),
        'linkedAt', now_at,
        'linkedBy', auth.uid(),
        'linkedThrough', 'admin.geography_cutover'
      ),
      updated_at = now_at
  where id = p_mapping_id;

  return public.read_universal_geography_cutover_readiness();
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
  mapping_record public.geography_migration_mappings%rowtype;
  geography_record public.geographies%rowtype;
  now_at timestamptz := timezone('utc', now());
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_platform_super_admin()
     and not public.has_permission('platform.geography.manage', null) then
    raise exception using errcode = '42501', message = 'geography management permission required';
  end if;

  if p_mapping_id is null then
    raise exception using errcode = '22023', message = 'mapping id is required';
  end if;

  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'verification reason is required';
  end if;

  select *
  into mapping_record
  from public.geography_migration_mappings
  where id = p_mapping_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'geography migration mapping was not found';
  end if;

  if mapping_record.migration_status = 'verified' then
    return public.read_universal_geography_cutover_readiness();
  end if;

  if mapping_record.migration_status <> 'migrated' then
    raise exception using errcode = '55000',
      message = 'only a successfully imported or explicitly linked geography mapping can be verified';
  end if;

  if mapping_record.geography_id is null or mapping_record.geometry_source is null then
    raise exception using errcode = '55000',
      message = 'mapping is missing its canonical geography or geometry provenance';
  end if;

  select *
  into geography_record
  from public.geographies
  where id = mapping_record.geography_id;

  if not found
     or geography_record.status <> 'active'
     or geography_record.boundary_geometry is null
     or geography_record.country_code !~ '^[A-Z]{2}$'
     or not extensions.st_isvalid(geography_record.boundary_geometry::extensions.geometry) then
    raise exception using errcode = '55000',
      message = 'canonical geography boundary must be active, valid, and have a country code before verification';
  end if;

  update public.geography_migration_mappings
  set migration_status = 'verified',
      validation_code = 'VERIFIED_BY_ADMIN',
      verified_by = auth.uid(),
      verified_at = now_at,
      details = coalesce(details, '{}'::jsonb) || jsonb_build_object(
        'verificationReason', btrim(p_reason),
        'verifiedAt', now_at,
        'verifiedThrough', 'admin.geography_cutover'
      ),
      updated_at = now_at
  where id = p_mapping_id;

  return public.read_universal_geography_cutover_readiness();
end;
$$;

-- Preserve the already configured customer launch/exclusion behavior when
-- moving from legacy LPG service-area rules to universal coverage. This is
-- idempotent and only projects rules whose geography mapping was explicitly
-- verified by an Admin.
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

comment on function public.read_geography_migration_review_queue() is
  'Returns legacy-to-canonical geography mappings requiring explicit Admin review before universal cutover.';
comment on function public.link_geography_migration_mapping(uuid, uuid, text) is
  'Explicitly links a legacy area to an existing active canonical bounded geography without guessing a boundary or matching by place name.';
comment on function public.verify_geography_migration_mapping(uuid, text) is
  'Verifies one successfully imported or explicitly linked canonical geography mapping after an explicit Admin review reason.';
comment on function public.migrate_verified_legacy_lpg_coverage_policies() is
  'Idempotently projects verified legacy LPG customer service-area rules into universal customer_ordering policies.';

revoke all on function public.read_geography_migration_review_queue() from public, anon, authenticated;
revoke all on function public.link_geography_migration_mapping(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.verify_geography_migration_mapping(uuid, text) from public, anon, authenticated;
revoke all on function public.migrate_verified_legacy_lpg_coverage_policies() from public, anon, authenticated;

grant execute on function public.read_geography_migration_review_queue() to authenticated, service_role;
grant execute on function public.link_geography_migration_mapping(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.verify_geography_migration_mapping(uuid, text) to authenticated, service_role;
grant execute on function public.migrate_verified_legacy_lpg_coverage_policies() to authenticated, service_role;

commit;
