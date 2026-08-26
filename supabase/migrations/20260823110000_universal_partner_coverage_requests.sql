begin;

revoke all on function public.read_selectable_lpg_service_areas() from authenticated;
revoke all on function public.resolve_or_create_lpg_partner_candidate_area(double precision,double precision,jsonb,text) from authenticated;

create table public.application_operational_coverage_requests(
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.application_records(id) on delete restrict,
  application_version_id uuid not null references public.application_versions(id) on delete restrict,
  applicant_user_id uuid not null references public.profiles(id) on delete restrict,
  entity_type text not null check(entity_type in('DRIVER','STATION')),
  service_key text not null check(service_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  coverage_type text not null check(coverage_type in('ADMIN_GEOGRAPHY','RADIUS','CUSTOM_ZONE')),
  geography_id uuid references public.geographies(id) on delete restrict,
  center_point extensions.geography(Point,4326),
  radius_meters numeric,
  coverage_geometry extensions.geography(MultiPolygon,4326),
  status text not null default 'REQUESTED' check(status in('REQUESTED','APPROVED','REJECTED','WITHDRAWN')),
  request_snapshot jsonb not null check(jsonb_typeof(request_snapshot)='object'),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default timezone('utc',now()),
  check((coverage_type='ADMIN_GEOGRAPHY' and geography_id is not null and center_point is null and radius_meters is null and coverage_geometry is null)
    or (coverage_type='RADIUS' and geography_id is null and center_point is not null and radius_meters>0 and coverage_geometry is null)
    or (coverage_type='CUSTOM_ZONE' and geography_id is null and center_point is null and radius_meters is null and coverage_geometry is not null)),
  check((status='REQUESTED' and reviewed_at is null) or (status<>'REQUESTED' and reviewed_at is not null and nullif(btrim(review_reason),'') is not null))
);
create index application_coverage_requests_application_idx on public.application_operational_coverage_requests(application_id,application_version_id,status);
create index application_coverage_requests_geography_idx on public.application_operational_coverage_requests(geography_id) where geography_id is not null;
create index application_coverage_requests_center_gist_idx on public.application_operational_coverage_requests using gist(center_point);
create index application_coverage_requests_geometry_gist_idx on public.application_operational_coverage_requests using gist(coverage_geometry);

alter table public.application_operational_coverage_requests enable row level security;
revoke all on public.application_operational_coverage_requests from public,anon,authenticated;
grant select on public.application_operational_coverage_requests to authenticated;
grant all on public.application_operational_coverage_requests to service_role;
create policy application_coverage_request_read on public.application_operational_coverage_requests for select to authenticated
using(applicant_user_id=auth.uid() or public.has_permission('platform.coverage.read',null) or public.has_permission('platform.location_evidence.read',null));
create trigger audit_application_operational_coverage_requests after insert or update or delete on public.application_operational_coverage_requests
for each row execute function public.record_table_audit();

create or replace function public.read_selectable_operational_geographies()
returns table(area_id uuid,display_name text,area_type text,parent_area_id uuid,country_code text,country_name text,state_name text,lga_name text,city_name text,town_name text,locality_name text,radius_meters numeric)
language sql stable security definer set search_path=public,extensions,pg_temp as $$
  select geography.id,geography.canonical_name,level.key,geography.parent_id,geography.country_code,null::text,null::text,null::text,null::text,null::text,null::text,null::numeric
  from public.geographies geography join public.geography_levels level on level.id=geography.geography_level_id
  where geography.status='active' and geography.boundary_geometry is not null and level.status='active' and level.is_service_selectable
  order by level.specificity_rank,geography.canonical_name;
$$;
revoke all on function public.read_selectable_operational_geographies() from public,anon;
grant execute on function public.read_selectable_operational_geographies() to authenticated,service_role;

create or replace function public.sync_universal_application_location_and_coverage()
returns trigger language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare app record; service jsonb; item jsonb; point extensions.geography(Point,4326); polygon extensions.geography(MultiPolygon,4326); coverage_config jsonb; configured_entity_type text; configured_service_key text;
begin
  select record.*,definition.key application_type_key,definition.metadata application_type_metadata into app from public.application_records record join public.application_type_definitions definition on definition.id=record.application_type_id where record.id=new.application_id;
  if not found then return new; end if;
  service:=coalesce(new.payload->'service','{}'::jsonb);
  if jsonb_typeof(service->'coverageRequests')='array' then
    coverage_config:=app.application_type_metadata->'operationalCoverage';
    configured_entity_type:=nullif(coverage_config->>'entityType','');
    configured_service_key:=nullif(coverage_config->>'serviceKey','');
    if configured_entity_type is null or configured_service_key is null then
      raise exception using errcode='23514',message='application type is not configured for operational coverage projection';
    end if;
    delete from public.application_operational_coverage_requests where application_id=new.application_id and status='REQUESTED';
    for item in select value from jsonb_array_elements(service->'coverageRequests') loop
      point:=null; polygon:=null;
      if item->>'type'='RADIUS' then point:=extensions.st_setsrid(extensions.st_makepoint((item->>'longitude')::numeric,(item->>'latitude')::numeric),4326)::extensions.geography; end if;
      if item->>'type'='CUSTOM_ZONE' then polygon:=extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson((item->'geometry')::text),4326))::extensions.geography; end if;
      insert into public.application_operational_coverage_requests(application_id,application_version_id,applicant_user_id,entity_type,service_key,coverage_type,geography_id,center_point,radius_meters,coverage_geometry,request_snapshot)
      values(new.application_id,new.id,app.applicant_user_id,configured_entity_type,
        configured_service_key,item->>'type',nullif(item->>'geographyId','')::uuid,point,nullif(item->>'radiusMeters','')::numeric,polygon,item);
    end loop;
  end if;
  return new;
end $$;

update public.application_type_definitions
set metadata=metadata||jsonb_build_object('operationalCoverage',jsonb_build_object(
  'entityType',case when key='application.lpg.station.phase-one' then 'STATION' else 'DRIVER' end,
  'serviceKey','lpg'
))
where key in('application.lpg.driver.phase-one','application.lpg.station.phase-one');
create trigger sync_universal_application_geography after insert or update of payload on public.application_versions
for each row execute function public.sync_universal_application_location_and_coverage();

create or replace function public.review_application_coverage_request(p_request_id uuid,p_decision text,p_reason text,p_valid_from timestamptz default null,p_valid_to timestamptz default null)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare request record; app record; assignment_id uuid; target_entity_id uuid; station_count integer;
begin
  if not public.has_permission('platform.coverage.manage',null) then raise exception using errcode='42501',message='coverage management permission required'; end if;
  if p_decision not in('APPROVED','REJECTED') or nullif(btrim(p_reason),'') is null then raise exception using errcode='22023',message='decision and reason are required'; end if;
  select * into request from public.application_operational_coverage_requests where id=p_request_id and status='REQUESTED' for update;
  if not found then raise exception using errcode='P0002',message='requested coverage was not found'; end if;
  select * into app from public.application_records where id=request.application_id;
  if request.entity_type='DRIVER' then
    target_entity_id:=app.activated_subject_id;
  else
    select count(*),min(station.id) into station_count,target_entity_id from public.lpg_station_branches station where station.organization_id=app.organization_id;
    if station_count<>1 then raise exception using errcode='23514',message='station application must resolve to exactly one station branch before coverage approval'; end if;
  end if;
  if target_entity_id is null then raise exception using errcode='23514',message='application subject must be activated before coverage approval'; end if;
  update public.application_operational_coverage_requests set status=p_decision,reviewed_by=auth.uid(),reviewed_at=timezone('utc',now()),review_reason=btrim(p_reason) where id=p_request_id;
  if p_decision='APPROVED' then
    insert into public.operational_coverage_assignments(entity_type,entity_id,service_key,coverage_type,geography_id,center_point,radius_meters,coverage_geometry,status,source,valid_from,valid_to,approved_by,approved_at,metadata)
    select request.entity_type,target_entity_id,request.service_key,request.coverage_type,request.geography_id,request.center_point,request.radius_meters,request.coverage_geometry,
      'active','ADMIN_ASSIGNED',p_valid_from,p_valid_to,auth.uid(),timezone('utc',now()),jsonb_build_object('applicationCoverageRequestId',request.id,'applicationId',request.application_id)
    returning id into assignment_id;
  end if;
  return assignment_id;
end $$;

revoke all on function public.sync_universal_application_location_and_coverage() from public,anon,authenticated;
revoke all on function public.review_application_coverage_request(uuid,text,text,timestamptz,timestamptz) from public,anon;
grant execute on function public.review_application_coverage_request(uuid,text,text,timestamptz,timestamptz) to authenticated,service_role;

commit;
