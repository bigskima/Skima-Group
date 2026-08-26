begin;

create or replace function public.validate_geography_hierarchy_and_geometry()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  child_level record;
  parent record;
begin
  if new.parent_id = new.id then
    raise exception using errcode = '23514', message = 'geography cannot be its own parent';
  end if;
  if new.parent_id is not null and exists(
    with recursive descendants as (
      select id from public.geographies where parent_id = new.id
      union all
      select child.id from public.geographies child join descendants on child.parent_id = descendants.id
    )
    select 1 from descendants where id = new.parent_id
  ) then
    raise exception using errcode = '23514', message = 'geography hierarchy cycle is not allowed';
  end if;

  select * into child_level from public.geography_levels where id = new.geography_level_id;
  if not found or child_level.status <> 'active' then
    raise exception using errcode = '23514', message = 'geography requires an active configured level';
  end if;

  if new.parent_id is not null then
    select geography.*, level.specificity_rank parent_specificity
    into parent
    from public.geographies geography
    join public.geography_levels level on level.id = geography.geography_level_id
    where geography.id = new.parent_id;
    if not found then
      raise exception using errcode = '23514', message = 'parent geography was not found';
    end if;
    if parent.country_code <> new.country_code then
      raise exception using errcode = '23514', message = 'parent and child geographies must use the same country code';
    end if;
    if parent.parent_specificity >= child_level.specificity_rank then
      raise exception using errcode = '23514', message = 'child geography must use a more-specific configured level than its parent';
    end if;
  end if;

  if new.status = 'active' and new.boundary_geometry is null then
    raise exception using errcode = '23514', message = 'active geography requires a boundary';
  end if;
  if new.boundary_geometry is not null then
    if extensions.st_isempty(new.boundary_geometry::extensions.geometry)
       or not extensions.st_isvalid(new.boundary_geometry::extensions.geometry)
       or extensions.st_area(new.boundary_geometry) <= 0 then
      raise exception using errcode = '23514', message = 'geography boundary must be a non-empty valid polygon with positive area';
    end if;
    if new.parent_id is not null and parent.boundary_geometry is not null
       and child_level.key <> 'custom_zone'
       and not extensions.st_covers(parent.boundary_geometry, new.boundary_geometry) then
      raise exception using errcode = '23514', message = 'administrative child boundary must be covered by its parent boundary';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.preview_universal_service_policy(
  p_policy_id uuid,
  p_service_key text,
  p_capability_key text,
  p_geography_id uuid,
  p_priority integer,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  target record;
  conflicts jsonb;
  broader jsonb;
  narrower jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_permission('platform.coverage.read', null)
     and not public.has_permission('platform.coverage.manage', null) then
    raise exception using errcode = '42501', message = 'coverage read permission required';
  end if;
  if p_service_key !~ '^[a-z][a-z0-9_.:-]{2,120}$'
     or p_capability_key !~ '^[a-z][a-z0-9_.:-]{2,120}$'
     or (p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at) then
    raise exception using errcode = '22023', message = 'valid policy preview fields are required';
  end if;

  select geography.*, level.specificity_rank into target
  from public.geographies geography
  join public.geography_levels level on level.id = geography.geography_level_id
  where geography.id = p_geography_id and geography.status = 'active'
    and level.status = 'active' and geography.boundary_geometry is not null;
  if not found then
    raise exception using errcode = 'P0002', message = 'active bounded target geography was not found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'policyId', policy.id, 'geographyId', geography.id,
    'geographyName', geography.canonical_name, 'effect', policy.effect,
    'priority', policy.priority
  ) order by geography.canonical_name, policy.id), '[]'::jsonb)
  into conflicts
  from public.service_coverage_policies policy
  join public.geographies geography on geography.id = policy.target_geography_id
  join public.geography_levels level on level.id = geography.geography_level_id
  where policy.id is distinct from p_policy_id
    and policy.service_key = p_service_key
    and policy.capability_key = p_capability_key
    and policy.status = 'active'
    and geography.status = 'active'
    and level.specificity_rank = target.specificity_rank
    and policy.priority = coalesce(p_priority, 0)
    and (policy.ends_at is null or p_starts_at is null or policy.ends_at > p_starts_at)
    and (p_ends_at is null or policy.starts_at is null or p_ends_at > policy.starts_at)
    and extensions.st_intersects(geography.boundary_geometry, target.boundary_geometry);

  select coalesce(jsonb_agg(jsonb_build_object(
    'policyId', policy.id, 'geographyId', geography.id,
    'geographyName', geography.canonical_name, 'effect', policy.effect,
    'specificity', level.specificity_rank, 'priority', policy.priority
  ) order by level.specificity_rank desc, policy.priority desc, policy.id), '[]'::jsonb)
  into broader
  from public.service_coverage_policies policy
  join public.geographies geography on geography.id = policy.target_geography_id
  join public.geography_levels level on level.id = geography.geography_level_id
  where policy.id is distinct from p_policy_id
    and policy.service_key = p_service_key and policy.capability_key = p_capability_key
    and policy.status = 'active' and level.specificity_rank < target.specificity_rank
    and extensions.st_covers(geography.boundary_geometry, target.boundary_geometry);

  select coalesce(jsonb_agg(jsonb_build_object(
    'policyId', policy.id, 'geographyId', geography.id,
    'geographyName', geography.canonical_name, 'effect', policy.effect,
    'specificity', level.specificity_rank, 'priority', policy.priority
  ) order by level.specificity_rank, policy.priority desc, policy.id), '[]'::jsonb)
  into narrower
  from public.service_coverage_policies policy
  join public.geographies geography on geography.id = policy.target_geography_id
  join public.geography_levels level on level.id = geography.geography_level_id
  where policy.id is distinct from p_policy_id
    and policy.service_key = p_service_key and policy.capability_key = p_capability_key
    and policy.status = 'active' and level.specificity_rank > target.specificity_rank
    and extensions.st_covers(target.boundary_geometry, geography.boundary_geometry);

  return jsonb_build_object(
    'canActivate', jsonb_array_length(conflicts) = 0,
    'target', jsonb_build_object('geographyId', target.id, 'geographyName', target.canonical_name,
      'specificity', target.specificity_rank),
    'conflicts', conflicts,
    'broaderPolicies', broader,
    'narrowerPolicies', narrower
  );
end;
$$;

create or replace function public.validate_service_coverage_policy_write()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  preview jsonb;
begin
  if new.status = 'active' and nullif(btrim(new.reason), '') is null then
    raise exception using errcode = '23514', message = 'active coverage policy requires a reason';
  end if;
  if new.status = 'active' then
    preview := public.preview_universal_service_policy(
      case when tg_op = 'UPDATE' then old.id else null end,
      new.service_key, new.capability_key, new.target_geography_id,
      new.priority, new.starts_at, new.ends_at
    );
    if not coalesce((preview->>'canActivate')::boolean, false) then
      raise exception using errcode = '23514',
        message = 'coverage policy conflicts with an active policy at identical specificity and priority',
        detail = (preview->'conflicts')::text;
    end if;
  end if;
  new.updated_by := auth.uid();
  return new;
end;
$$;

revoke all on function public.preview_universal_service_policy(uuid,text,text,uuid,integer,timestamptz,timestamptz) from public, anon;
grant execute on function public.preview_universal_service_policy(uuid,text,text,uuid,integer,timestamptz,timestamptz) to authenticated, service_role;

commit;
