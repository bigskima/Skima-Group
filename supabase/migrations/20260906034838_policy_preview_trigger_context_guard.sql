begin;

-- preview_universal_service_policy is used both as an authenticated admin RPC
-- and internally by the service_coverage_policies write trigger. Direct RPC
-- calls must keep their permission check, while trigger-internal validation
-- must also work for trusted database migrations that do not carry a JWT.

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
  if pg_trigger_depth() = 0
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.has_permission('platform.coverage.read', null)
     and not public.has_permission('platform.coverage.manage', null) then
    raise exception using errcode = '42501', message = 'coverage read permission required';
  end if;

  if p_service_key !~ '^[a-z][a-z0-9_.:-]{2,120}$'
     or p_capability_key !~ '^[a-z][a-z0-9_.:-]{2,120}$'
     or (p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at) then
    raise exception using errcode = '22023', message = 'valid policy preview fields are required';
  end if;

  select geography.*, level.specificity_rank
  into target
  from public.geographies geography
  join public.geography_levels level on level.id = geography.geography_level_id
  where geography.id = p_geography_id
    and geography.status = 'active'
    and level.status = 'active'
    and geography.boundary_geometry is not null;

  if not found then
    raise exception using errcode = 'P0002', message = 'active bounded target geography was not found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'policyId', policy.id,
    'geographyId', geography.id,
    'geographyName', geography.canonical_name,
    'effect', policy.effect,
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
    'policyId', policy.id,
    'geographyId', geography.id,
    'geographyName', geography.canonical_name,
    'effect', policy.effect,
    'specificity', level.specificity_rank,
    'priority', policy.priority
  ) order by level.specificity_rank desc, policy.priority desc, policy.id), '[]'::jsonb)
  into broader
  from public.service_coverage_policies policy
  join public.geographies geography on geography.id = policy.target_geography_id
  join public.geography_levels level on level.id = geography.geography_level_id
  where policy.id is distinct from p_policy_id
    and policy.service_key = p_service_key
    and policy.capability_key = p_capability_key
    and policy.status = 'active'
    and level.specificity_rank < target.specificity_rank
    and extensions.st_covers(geography.boundary_geometry, target.boundary_geometry);

  select coalesce(jsonb_agg(jsonb_build_object(
    'policyId', policy.id,
    'geographyId', geography.id,
    'geographyName', geography.canonical_name,
    'effect', policy.effect,
    'specificity', level.specificity_rank,
    'priority', policy.priority
  ) order by level.specificity_rank, policy.priority desc, policy.id), '[]'::jsonb)
  into narrower
  from public.service_coverage_policies policy
  join public.geographies geography on geography.id = policy.target_geography_id
  join public.geography_levels level on level.id = geography.geography_level_id
  where policy.id is distinct from p_policy_id
    and policy.service_key = p_service_key
    and policy.capability_key = p_capability_key
    and policy.status = 'active'
    and level.specificity_rank > target.specificity_rank
    and extensions.st_covers(target.boundary_geometry, geography.boundary_geometry);

  return jsonb_build_object(
    'canActivate', jsonb_array_length(conflicts) = 0,
    'target', jsonb_build_object(
      'geographyId', target.id,
      'geographyName', target.canonical_name,
      'specificity', target.specificity_rank
    ),
    'conflicts', conflicts,
    'broaderPolicies', broader,
    'narrowerPolicies', narrower
  );
end;
$$;

revoke all on function public.preview_universal_service_policy(
  uuid, text, text, uuid, integer, timestamptz, timestamptz
) from public, anon;

grant execute on function public.preview_universal_service_policy(
  uuid, text, text, uuid, integer, timestamptz, timestamptz
) to authenticated, service_role;

comment on function public.preview_universal_service_policy(
  uuid, text, text, uuid, integer, timestamptz, timestamptz
) is
  'Previews service-area policy conflicts. Direct calls require coverage permission; trigger-internal validation can run during trusted database migrations.';

commit;
