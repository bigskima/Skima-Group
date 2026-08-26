begin;

create or replace function public.read_coverage_evidence_map_features(
  p_service_key text default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_application_id uuid default null,
  p_at timestamptz default timezone('utc',now()),
  p_limit integer default 500,
  p_simplify_tolerance double precision default 0.00001
) returns jsonb language sql stable security definer set search_path=public,extensions,pg_temp as $$
  with permitted as(
    select public.has_permission('platform.coverage.read',null) or coalesce(auth.role(),'')='service_role' coverage_allowed,
      public.has_permission('platform.tracking.admin.read',null) or coalesce(auth.role(),'')='service_role' tracking_allowed
  ), requested as(
    select jsonb_build_object('type','Feature','id',request.id,
      'geometry',extensions.st_asgeojson(extensions.st_simplifypreservetopology(
        case request.coverage_type when 'ADMIN_GEOGRAPHY' then geography.boundary_geometry::extensions.geometry
          when 'RADIUS' then extensions.st_buffer(request.center_point,request.radius_meters)::extensions.geometry
          else request.coverage_geometry::extensions.geometry end,
        greatest(0,least(coalesce(p_simplify_tolerance,0.00001),1))),6)::jsonb,
      'properties',jsonb_build_object('layer','REQUESTED_COVERAGE','name',request.coverage_type,
        'applicationId',request.application_id,'entityType',request.entity_type,'serviceKey',request.service_key,
        'coverageType',request.coverage_type,'status',request.status)) feature
    from permitted join public.application_operational_coverage_requests request on permitted.coverage_allowed
    left join public.geographies geography on geography.id=request.geography_id
    where request.status='REQUESTED' and (p_service_key is null or request.service_key=p_service_key)
      and (p_entity_type is null or request.entity_type=p_entity_type)
      and (p_application_id is null or request.application_id=p_application_id)
  ), evidence as(
    select jsonb_build_object('type','Feature','id',relationship.id,
      'geometry',extensions.st_asgeojson(location.point::extensions.geometry,6)::jsonb,
      'properties',jsonb_build_object('layer',case relationship.purpose
          when 'DRIVER_BASE' then 'OPERATING_BASE' when 'APPLICATION_OPERATING_BASE' then 'OPERATING_BASE'
          when 'STATION_PHYSICAL' then 'STATION_PHYSICAL' when 'APPLICATION_SUBMISSION' then 'APPLICATION_SUBMISSION'
          else 'LOCATION_EVIDENCE' end,
        'name',coalesce(location.formatted_address,relationship.purpose),'entityType',relationship.entity_type,
        'entityId',relationship.entity_id,'purpose',relationship.purpose,'accuracyMeters',location.accuracy_meters,
        'captureSource',location.capture_source,'status',case when relationship.is_current then 'current' else 'historical' end)) feature
    from permitted join public.entity_locations relationship on permitted.coverage_allowed
    join public.locations location on location.id=relationship.location_id
    where relationship.is_current and (p_entity_type is null or relationship.entity_type=p_entity_type)
      and (p_entity_id is null or relationship.entity_id=p_entity_id)
      and (p_application_id is null or (relationship.entity_type='APPLICATION' and relationship.entity_id=p_application_id))
      and relationship.purpose in('DRIVER_BASE','APPLICATION_OPERATING_BASE','STATION_PHYSICAL','APPLICATION_SUBMISSION','APPLICATION_DECLARED')
  ), live_driver as(
    select jsonb_build_object('type','Feature','id',state.driver_id,
      'geometry',extensions.st_asgeojson(state.point::extensions.geometry,6)::jsonb,
      'properties',jsonb_build_object('layer','LIVE_LOCATION','name','Current driver location','entityType','DRIVER',
        'entityId',state.driver_id,'accuracyMeters',state.accuracy_meters,'capturedAt',state.captured_at,'status',state.status)) feature
    from permitted join public.driver_location_state state on permitted.tracking_allowed
    where (p_entity_type is null or p_entity_type='DRIVER') and (p_entity_id is null or state.driver_id=p_entity_id)
      and state.status in('available','unavailable') and state.captured_at>=p_at-interval '30 minutes'
  ), combined as(
    select feature from requested union all select feature from evidence union all select feature from live_driver
  ), bounded as(
    select feature from combined order by feature->'properties'->>'layer',feature->>'id'
    limit greatest(1,least(coalesce(p_limit,500),2000))+1
  ), numbered as(select feature,row_number() over() n,count(*) over() total from bounded)
  select jsonb_build_object('type','FeatureCollection','generatedAt',p_at,
    'truncated',coalesce(max(total),0)>greatest(1,least(coalesce(p_limit,500),2000)),
    'features',coalesce(jsonb_agg(feature order by n) filter(where n<=greatest(1,least(coalesce(p_limit,500),2000))),'[]'::jsonb))
  from numbered;
$$;

revoke all on function public.read_coverage_evidence_map_features(text,text,uuid,uuid,timestamptz,integer,double precision) from public,anon;
grant execute on function public.read_coverage_evidence_map_features(text,text,uuid,uuid,timestamptz,integer,double precision) to authenticated,service_role;

commit;
