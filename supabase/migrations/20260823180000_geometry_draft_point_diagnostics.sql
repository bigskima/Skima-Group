begin;

create table public.coverage_geometry_drafts (
  id uuid primary key default gen_random_uuid(),
  draft_type text not null check (draft_type in ('GEOGRAPHY_BOUNDARY','OPERATIONAL_COVERAGE')),
  target_id uuid,
  parent_geography_id uuid references public.geographies(id) on delete restrict,
  geometry extensions.geography(MultiPolygon,4326) not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','PREVIEWED','ACTIVATED','ABANDONED')),
  validation_snapshot jsonb not null check (jsonb_typeof(validation_snapshot) = 'object'),
  activation_reason text,
  created_by uuid references public.profiles(id) on delete restrict default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  activated_at timestamptz,
  check ((status = 'ACTIVATED') = (activated_at is not null and nullif(btrim(activation_reason),'') is not null))
);
create index coverage_geometry_drafts_owner_idx on public.coverage_geometry_drafts(created_by,status,updated_at desc);
create index coverage_geometry_drafts_target_idx on public.coverage_geometry_drafts(draft_type,target_id,status);
create index coverage_geometry_drafts_geometry_gist_idx on public.coverage_geometry_drafts using gist(geometry);
alter table public.coverage_geometry_drafts enable row level security;
revoke all on public.coverage_geometry_drafts from public,anon,authenticated;
grant select on public.coverage_geometry_drafts to authenticated;
grant all on public.coverage_geometry_drafts to service_role;
create policy coverage_geometry_draft_read on public.coverage_geometry_drafts for select to authenticated
using(created_by=auth.uid() or public.has_permission('platform.coverage.read',null));
create trigger set_coverage_geometry_drafts_updated_at before update on public.coverage_geometry_drafts
for each row execute function public.set_updated_at();
create trigger audit_coverage_geometry_drafts after insert or update or delete on public.coverage_geometry_drafts
for each row execute function public.record_table_audit();

create or replace function public.require_previewed_geometry_draft()
returns trigger language plpgsql set search_path=public,extensions,pg_temp as $$
declare draft record; draft_id uuid;
begin
  if tg_table_name='geographies' and new.status='active' and new.metadata->>'sourceSurface'='admin_geography' then
    draft_id:=nullif(new.metadata->>'geometryDraftId','')::uuid;
  elsif tg_table_name='operational_coverage_assignments' and new.status='active' and new.coverage_type='CUSTOM_ZONE'
        and new.metadata->>'sourceSurface'='admin_operational_coverage'
        and (tg_op='INSERT' or new.coverage_geometry is distinct from old.coverage_geometry) then
    draft_id:=nullif(new.metadata->>'geometryDraftId','')::uuid;
  else return new; end if;
  select * into draft from public.coverage_geometry_drafts where id=draft_id and status='PREVIEWED';
  if not found then raise exception using errcode='23514',message='active geometry requires a previewed preserved draft'; end if;
  if tg_table_name='geographies' and not extensions.st_equals(draft.geometry::extensions.geometry,new.boundary_geometry::extensions.geometry) then
    raise exception using errcode='23514',message='active geography does not match its previewed geometry draft';
  elsif tg_table_name='operational_coverage_assignments' and not extensions.st_equals(draft.geometry::extensions.geometry,new.coverage_geometry::extensions.geometry) then
    raise exception using errcode='23514',message='active coverage does not match its previewed geometry draft';
  end if;
  return new;
end $$;
create trigger require_geography_geometry_preview before insert or update on public.geographies
for each row execute function public.require_previewed_geometry_draft();
create trigger require_operational_geometry_preview before insert or update on public.operational_coverage_assignments
for each row execute function public.require_previewed_geometry_draft();

create or replace function public.preview_coverage_geometry(
  p_geojson jsonb,p_parent_geography_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
declare polygon extensions.geography(MultiPolygon,4326); parent record; valid boolean; reason text;
begin
  if coalesce(auth.role(),'')<>'service_role' and not public.has_permission('platform.coverage.manage',null) then
    raise exception using errcode='42501',message='coverage management permission required';
  end if;
  begin
    polygon:=extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson(p_geojson::text),4326))::extensions.geography;
  exception when others then
    return jsonb_build_object('valid',false,'code','INVALID_GEOJSON','message','Geometry must be Polygon or MultiPolygon GeoJSON.');
  end;
  valid:=not extensions.st_isempty(polygon::extensions.geometry) and extensions.st_isvalid(polygon::extensions.geometry)
    and extensions.st_area(polygon)>0;
  if not valid then
    reason:=extensions.st_isvalidreason(polygon::extensions.geometry);
    return jsonb_build_object('valid',false,'code','INVALID_GEOMETRY','message',reason);
  end if;
  if p_parent_geography_id is not null then
    select * into parent from public.geographies where id=p_parent_geography_id and status='active' and boundary_geometry is not null;
    if not found then return jsonb_build_object('valid',false,'code','PARENT_NOT_FOUND','message','Active bounded parent geography was not found.'); end if;
    if not extensions.st_covers(parent.boundary_geometry,polygon) then
      return jsonb_build_object('valid',false,'code','OUTSIDE_PARENT','message','Boundary is not fully covered by its configured parent.');
    end if;
  end if;
  return jsonb_build_object('valid',true,'code','VALID','message','Geometry is valid.',
    'areaSquareMeters',extensions.st_area(polygon),'centroid',jsonb_build_object(
      'longitude',extensions.st_x(extensions.st_pointonsurface(polygon::extensions.geometry)),
      'latitude',extensions.st_y(extensions.st_pointonsurface(polygon::extensions.geometry))));
end $$;

create or replace function public.save_coverage_geometry_draft(
  p_draft_id uuid,p_draft_type text,p_target_id uuid,p_parent_geography_id uuid,p_geojson jsonb
) returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare preview jsonb; polygon extensions.geography(MultiPolygon,4326); saved_id uuid;
begin
  if coalesce(auth.role(),'')<>'service_role' and not public.has_permission('platform.coverage.manage',null) then
    raise exception using errcode='42501',message='coverage management permission required';
  end if;
  if p_draft_type not in('GEOGRAPHY_BOUNDARY','OPERATIONAL_COVERAGE') then raise exception using errcode='22023',message='valid draft type required'; end if;
  preview:=public.preview_coverage_geometry(p_geojson,p_parent_geography_id);
  if not coalesce((preview->>'valid')::boolean,false) then
    raise exception using errcode='22023',message=preview->>'message',detail=preview::text;
  end if;
  polygon:=extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson(p_geojson::text),4326))::extensions.geography;
  if p_draft_id is null then
    insert into public.coverage_geometry_drafts(draft_type,target_id,parent_geography_id,geometry,status,validation_snapshot,created_by,updated_by)
    values(p_draft_type,p_target_id,p_parent_geography_id,polygon,'PREVIEWED',preview,auth.uid(),auth.uid()) returning id into saved_id;
  else
    update public.coverage_geometry_drafts set draft_type=p_draft_type,target_id=p_target_id,parent_geography_id=p_parent_geography_id,
      geometry=polygon,status='PREVIEWED',validation_snapshot=preview,updated_by=auth.uid(),activation_reason=null,activated_at=null
    where id=p_draft_id and created_by=auth.uid() and status in('DRAFT','PREVIEWED') returning id into saved_id;
    if saved_id is null then raise exception using errcode='P0002',message='editable geometry draft was not found'; end if;
  end if;
  return saved_id;
end $$;

create or replace function public.activate_coverage_geometry_draft(p_draft_id uuid,p_target_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public,extensions,pg_temp as $$
begin
  if coalesce(auth.role(),'')<>'service_role' and not public.has_permission('platform.coverage.manage',null) then
    raise exception using errcode='42501',message='coverage management permission required';
  end if;
  if p_target_id is null or nullif(btrim(p_reason),'') is null then raise exception using errcode='22023',message='target and activation reason required'; end if;
  update public.coverage_geometry_drafts set target_id=p_target_id,status='ACTIVATED',activation_reason=btrim(p_reason),activated_at=timezone('utc',now()),updated_by=auth.uid()
  where id=p_draft_id and status='PREVIEWED' and (created_by=auth.uid() or coalesce(auth.role(),'')='service_role');
  if not found then raise exception using errcode='P0002',message='previewed geometry draft was not found'; end if;
end $$;

create or replace function public.diagnose_coverage_point(
  p_service_key text,p_capability_key text,p_longitude double precision,p_latitude double precision,
  p_entity_type text default null,p_entity_id uuid default null,p_at timestamptz default timezone('utc',now())
) returns jsonb language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
declare point extensions.geography(Point,4326); availability jsonb; geographies jsonb; assignments jsonb; requests jsonb; evidence jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' and not public.has_permission('platform.coverage.read',null) then
    raise exception using errcode='42501',message='coverage read permission required';
  end if;
  if p_longitude not between -180 and 180 or p_latitude not between -90 and 90 then raise exception using errcode='22023',message='valid diagnostic point required'; end if;
  point:=extensions.st_setsrid(extensions.st_makepoint(p_longitude,p_latitude),4326)::extensions.geography;
  availability:=public.resolve_service_availability(p_service_key,p_capability_key,p_longitude,p_latitude,p_at);
  select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',g.canonical_name,'level',l.key,'specificity',l.specificity_rank,
    'onBoundary',extensions.st_touches(g.boundary_geometry::extensions.geometry,point::extensions.geometry)) order by l.specificity_rank desc,g.id),'[]'::jsonb)
    into geographies from public.geographies g join public.geography_levels l on l.id=g.geography_level_id
    where g.status='active' and g.boundary_geometry is not null and extensions.st_covers(g.boundary_geometry,point);
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'entityType',a.entity_type,'entityId',a.entity_id,'coverageType',a.coverage_type,
    'serviceKey',a.service_key) order by a.entity_type,a.entity_id,a.id),'[]'::jsonb) into assignments
    from public.operational_coverage_assignments a left join public.geographies g on g.id=a.geography_id
    where a.status in('approved','active') and a.approved_at is not null and a.service_key=p_service_key
      and (p_entity_type is null or a.entity_type=p_entity_type) and (p_entity_id is null or a.entity_id=p_entity_id)
      and (a.valid_from is null or a.valid_from<=p_at) and (a.valid_to is null or a.valid_to>p_at)
      and case a.coverage_type when 'ADMIN_GEOGRAPHY' then extensions.st_covers(g.boundary_geometry,point)
        when 'RADIUS' then extensions.st_dwithin(a.center_point,point,a.radius_meters)
        else extensions.st_covers(a.coverage_geometry,point) end;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'entityType',r.entity_type,'applicationId',r.application_id,'coverageType',r.coverage_type)
    order by r.created_at,r.id),'[]'::jsonb) into requests from public.application_operational_coverage_requests r
    left join public.geographies g on g.id=r.geography_id where r.status='REQUESTED' and r.service_key=p_service_key
    and case r.coverage_type when 'ADMIN_GEOGRAPHY' then extensions.st_covers(g.boundary_geometry,point)
      when 'RADIUS' then extensions.st_dwithin(r.center_point,point,r.radius_meters) else extensions.st_covers(r.coverage_geometry,point) end;
  select coalesce(jsonb_agg(jsonb_build_object('entityType',e.entity_type,'entityId',e.entity_id,'purpose',e.purpose,'locationId',e.location_id,
    'longitude',extensions.st_x(l.point::extensions.geometry),'latitude',extensions.st_y(l.point::extensions.geometry)) order by e.purpose),'[]'::jsonb)
    into evidence from public.entity_locations e join public.locations l on l.id=e.location_id
    where e.is_current and (p_entity_id is not null and e.entity_id=p_entity_id) and (p_entity_type is null or e.entity_type=p_entity_type);
  return jsonb_build_object('point',jsonb_build_object('longitude',p_longitude,'latitude',p_latitude),'availability',availability,
    'matchedGeographies',geographies,'approvedAssignments',assignments,'requestedCoverage',requests,'currentLocationEvidence',evidence,
    'boundaryStrategy','ST_COVERS_INCLUSIVE');
end $$;

revoke all on function public.preview_coverage_geometry(jsonb,uuid) from public,anon;
revoke all on function public.require_previewed_geometry_draft() from public,anon,authenticated;
revoke all on function public.save_coverage_geometry_draft(uuid,text,uuid,uuid,jsonb) from public,anon;
revoke all on function public.activate_coverage_geometry_draft(uuid,uuid,text) from public,anon;
revoke all on function public.diagnose_coverage_point(text,text,double precision,double precision,text,uuid,timestamptz) from public,anon;
grant execute on function public.preview_coverage_geometry(jsonb,uuid) to authenticated,service_role;
grant execute on function public.save_coverage_geometry_draft(uuid,text,uuid,uuid,jsonb) to authenticated,service_role;
grant execute on function public.activate_coverage_geometry_draft(uuid,uuid,text) to authenticated,service_role;
grant execute on function public.diagnose_coverage_point(text,text,double precision,double precision,text,uuid,timestamptz) to authenticated,service_role;

commit;
