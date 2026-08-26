begin;

create or replace function public.read_coverage_map_features(
  p_service_key text default null,
  p_capability_key text default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_at timestamptz default timezone('utc', now()),
  p_limit integer default 500,
  p_simplify_tolerance double precision default 0.00001
)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with permitted as (
    select 1 allowed
    where public.has_permission('platform.coverage.read', null)
       or coalesce(auth.role(), '') = 'service_role'
  ), policy_features as (
    select jsonb_build_object(
      'type', 'Feature',
      'id', policy.id,
      'geometry', extensions.st_asgeojson(extensions.st_simplifypreservetopology(
        geography.boundary_geometry::extensions.geometry,
        greatest(0, least(coalesce(p_simplify_tolerance, 0.00001), 1))
      ), 6)::jsonb,
      'properties', jsonb_build_object(
        'layer', 'SERVICE_POLICY', 'policyId', policy.id,
        'geographyId', geography.id, 'name', geography.canonical_name,
        'serviceKey', policy.service_key, 'capabilityKey', policy.capability_key,
        'effect', policy.effect, 'priority', policy.priority,
        'specificity', level.specificity_rank, 'status', policy.status
      )
    ) feature
    from permitted
    join public.service_coverage_policies policy on true
    join public.geographies geography on geography.id = policy.target_geography_id
    join public.geography_levels level on level.id = geography.geography_level_id
    where policy.status = 'active' and geography.status = 'active'
      and geography.boundary_geometry is not null
      and (policy.starts_at is null or policy.starts_at <= p_at)
      and (policy.ends_at is null or policy.ends_at > p_at)
      and (p_service_key is null or policy.service_key = p_service_key)
      and (p_capability_key is null or policy.capability_key = p_capability_key)
  ), operational_features as (
    select jsonb_build_object(
      'type', 'Feature',
      'id', assignment.id,
      'geometry', extensions.st_asgeojson(extensions.st_simplifypreservetopology(
        (case assignment.coverage_type
          when 'ADMIN_GEOGRAPHY' then geography.boundary_geometry::extensions.geometry
          when 'RADIUS' then extensions.st_buffer(assignment.center_point, assignment.radius_meters)::extensions.geometry
          else assignment.coverage_geometry::extensions.geometry
        end), greatest(0, least(coalesce(p_simplify_tolerance, 0.00001), 1))
      ), 6)::jsonb,
      'properties', jsonb_build_object(
        'layer', 'OPERATIONAL_COVERAGE', 'assignmentId', assignment.id,
        'entityType', assignment.entity_type, 'entityId', assignment.entity_id,
        'serviceKey', assignment.service_key, 'coverageType', assignment.coverage_type,
        'name', coalesce(geography.canonical_name, assignment.coverage_type),
        'status', assignment.status, 'radiusMeters', assignment.radius_meters
      )
    ) feature
    from permitted
    join public.operational_coverage_assignments assignment on true
    left join public.geographies geography on geography.id = assignment.geography_id
    where assignment.status in ('approved','active') and assignment.approved_at is not null
      and (assignment.valid_from is null or assignment.valid_from <= p_at)
      and (assignment.valid_to is null or assignment.valid_to > p_at)
      and (p_service_key is null or assignment.service_key = p_service_key)
      and (p_entity_type is null or assignment.entity_type = p_entity_type)
      and (p_entity_id is null or assignment.entity_id = p_entity_id)
  ), features as (
    select feature from policy_features
    union all
    select feature from operational_features
  ), bounded as (
    select feature from features
    order by feature->'properties'->>'layer', feature->>'id'
    limit greatest(1, least(coalesce(p_limit, 500), 2000)) + 1
  ), counted as (
    select feature, row_number() over () feature_number, count(*) over () bounded_count
    from bounded
  )
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'generatedAt', p_at,
    'truncated', coalesce(max(bounded_count), 0) > greatest(1, least(coalesce(p_limit, 500), 2000)),
    'features', coalesce(jsonb_agg(feature order by feature_number)
      filter (where feature_number <= greatest(1, least(coalesce(p_limit, 500), 2000))), '[]'::jsonb)
  )
  from counted;
$$;

revoke all on function public.read_coverage_map_features(text,text,text,uuid,timestamptz,integer,double precision) from public, anon;
grant execute on function public.read_coverage_map_features(text,text,text,uuid,timestamptz,integer,double precision) to authenticated, service_role;

commit;
