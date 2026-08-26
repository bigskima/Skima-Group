begin;

create table public.operational_coverage_change_events (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.operational_coverage_assignments(id) on delete restrict,
  entity_type text not null,
  entity_id uuid not null,
  service_key text not null,
  event_type text not null check (event_type in ('CREATED','UPDATED','PAUSED','RETIRED')),
  old_coverage jsonb,
  new_coverage jsonb not null check (jsonb_typeof(new_coverage) = 'object'),
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  check (old_coverage is null or jsonb_typeof(old_coverage) = 'object')
);
create index operational_coverage_change_assignment_idx
  on public.operational_coverage_change_events(assignment_id, created_at desc);
create index operational_coverage_change_entity_idx
  on public.operational_coverage_change_events(entity_type, entity_id, service_key, created_at desc);

alter table public.operational_coverage_change_events enable row level security;
revoke all on public.operational_coverage_change_events from public, anon, authenticated;
grant select on public.operational_coverage_change_events to authenticated;
grant all on public.operational_coverage_change_events to service_role;
create policy operational_coverage_change_read on public.operational_coverage_change_events
for select to authenticated using (public.has_permission('platform.coverage.read', null));
create trigger protect_operational_coverage_change_events
before update or delete on public.operational_coverage_change_events
for each row execute function public.prevent_immutable_location_evidence_mutation();

-- Coverage management is RPC-only for authenticated actors so every material
-- change is validated and receives an immutable reasoned event.
revoke insert, update, delete on public.operational_coverage_assignments from authenticated;

create or replace function public.configure_operational_coverage_assignment(
  p_assignment_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_service_key text,
  p_coverage_type text,
  p_geography_id uuid,
  p_center_longitude double precision,
  p_center_latitude double precision,
  p_radius_meters numeric,
  p_coverage_geojson jsonb,
  p_status text,
  p_valid_from timestamptz,
  p_valid_to timestamptz,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  existing public.operational_coverage_assignments%rowtype;
  saved public.operational_coverage_assignments%rowtype;
  center extensions.geography(Point, 4326);
  polygon extensions.geography(MultiPolygon, 4326);
  event_type text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_permission('platform.coverage.manage', null) then
    raise exception using errcode = '42501', message = 'coverage management permission required';
  end if;
  if p_entity_type !~ '^[A-Z][A-Z0-9_]{1,79}$' or p_entity_id is null
     or p_service_key !~ '^[a-z][a-z0-9_.:-]{2,120}$'
     or p_coverage_type not in ('ADMIN_GEOGRAPHY','RADIUS','CUSTOM_ZONE')
     or p_status not in ('active','paused','retired')
     or nullif(btrim(p_reason), '') is null
     or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object'
     or (p_valid_from is not null and p_valid_to is not null and p_valid_to <= p_valid_from) then
    raise exception using errcode = '22023', message = 'valid coverage fields and a change reason are required';
  end if;

  if p_coverage_type = 'ADMIN_GEOGRAPHY' then
    if p_geography_id is null or p_center_longitude is not null or p_center_latitude is not null
       or p_radius_meters is not null or p_coverage_geojson is not null
       or not exists(select 1 from public.geographies where id = p_geography_id and status = 'active' and boundary_geometry is not null) then
      raise exception using errcode = '22023', message = 'administrative coverage requires one active bounded geography';
    end if;
  elsif p_coverage_type = 'RADIUS' then
    if p_geography_id is not null or p_coverage_geojson is not null or p_radius_meters is null or p_radius_meters <= 0
       or p_radius_meters > 1000000 or p_center_latitude not between -90 and 90
       or p_center_longitude not between -180 and 180 then
      raise exception using errcode = '22023', message = 'radius coverage requires a valid center and radius no greater than 1,000 km';
    end if;
    center := extensions.st_setsrid(extensions.st_makepoint(p_center_longitude, p_center_latitude), 4326)::extensions.geography;
  else
    if p_geography_id is not null or p_center_longitude is not null or p_center_latitude is not null
       or p_radius_meters is not null or p_coverage_geojson is null then
      raise exception using errcode = '22023', message = 'custom coverage requires only a Polygon or MultiPolygon';
    end if;
    begin
      polygon := extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson(p_coverage_geojson::text), 4326))::extensions.geography;
    exception when others then
      raise exception using errcode = '22023', message = 'custom coverage must be valid Polygon or MultiPolygon GeoJSON';
    end;
    if extensions.st_isempty(polygon::extensions.geometry) or not extensions.st_isvalid(polygon::extensions.geometry)
       or extensions.st_area(polygon) <= 0 then
      raise exception using errcode = '22023', message = 'custom coverage must be a non-empty valid polygon with positive area';
    end if;
  end if;

  if p_assignment_id is null then
    insert into public.operational_coverage_assignments(
      entity_type, entity_id, service_key, coverage_type, geography_id,
      center_point, radius_meters, coverage_geometry, status, source,
      valid_from, valid_to, approved_by, approved_at, metadata
    ) values (
      p_entity_type, p_entity_id, p_service_key, p_coverage_type, p_geography_id,
      center, p_radius_meters, polygon, p_status, 'ADMIN_ASSIGNED',
      p_valid_from, p_valid_to, auth.uid(), timezone('utc', now()), coalesce(p_metadata, '{}'::jsonb)
    ) returning * into saved;
    event_type := 'CREATED';
  else
    select * into existing from public.operational_coverage_assignments where id = p_assignment_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'coverage assignment was not found'; end if;
    update public.operational_coverage_assignments set
      entity_type = p_entity_type, entity_id = p_entity_id, service_key = p_service_key,
      coverage_type = p_coverage_type, geography_id = p_geography_id,
      center_point = center, radius_meters = p_radius_meters, coverage_geometry = polygon,
      status = p_status, valid_from = p_valid_from, valid_to = p_valid_to,
      approved_by = auth.uid(), approved_at = timezone('utc', now()),
      metadata = coalesce(p_metadata, '{}'::jsonb), updated_at = timezone('utc', now())
    where id = p_assignment_id returning * into saved;
    event_type := case p_status when 'paused' then 'PAUSED' when 'retired' then 'RETIRED' else 'UPDATED' end;
  end if;

  insert into public.operational_coverage_change_events(
    assignment_id, entity_type, entity_id, service_key, event_type,
    old_coverage, new_coverage, reason, changed_by
  ) values (
    saved.id, saved.entity_type, saved.entity_id, saved.service_key, event_type,
    case when p_assignment_id is null then null else to_jsonb(existing) end,
    to_jsonb(saved), btrim(p_reason), auth.uid()
  );
  return saved.id;
end;
$$;

create or replace function public.read_operational_coverage_admin(
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_service_key text default null
)
returns table(
  id uuid, entity_type text, entity_id uuid, service_key text,
  coverage_type text, geography_id uuid, geography_name text,
  center_longitude double precision, center_latitude double precision,
  radius_meters numeric, coverage_geojson jsonb, status text,
  valid_from timestamptz, valid_to timestamptz, approved_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select assignment.id, assignment.entity_type, assignment.entity_id,
    assignment.service_key, assignment.coverage_type, assignment.geography_id,
    geography.canonical_name,
    extensions.st_x(assignment.center_point::extensions.geometry),
    extensions.st_y(assignment.center_point::extensions.geometry),
    assignment.radius_meters,
    case when assignment.coverage_geometry is null then null
      else extensions.st_asgeojson(assignment.coverage_geometry::extensions.geometry)::jsonb end,
    assignment.status, assignment.valid_from, assignment.valid_to,
    assignment.approved_at, assignment.updated_at
  from public.operational_coverage_assignments assignment
  left join public.geographies geography on geography.id = assignment.geography_id
  where (public.has_permission('platform.coverage.read', null) or coalesce(auth.role(), '') = 'service_role')
    and (p_entity_type is null or assignment.entity_type = p_entity_type)
    and (p_entity_id is null or assignment.entity_id = p_entity_id)
    and (p_service_key is null or assignment.service_key = p_service_key)
  order by assignment.updated_at desc, assignment.id;
$$;

revoke all on function public.configure_operational_coverage_assignment(uuid,text,uuid,text,text,uuid,double precision,double precision,numeric,jsonb,text,timestamptz,timestamptz,text,jsonb) from public, anon;
revoke all on function public.read_operational_coverage_admin(text,uuid,text) from public, anon;
grant execute on function public.configure_operational_coverage_assignment(uuid,text,uuid,text,text,uuid,double precision,double precision,numeric,jsonb,text,timestamptz,timestamptz,text,jsonb) to authenticated, service_role;
grant execute on function public.read_operational_coverage_admin(text,uuid,text) to authenticated, service_role;

commit;
