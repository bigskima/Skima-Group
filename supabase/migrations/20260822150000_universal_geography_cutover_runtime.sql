begin;

insert into public.geography_levels(key,country_code,display_name,plural_display_name,depth,specificity_rank,is_service_selectable,is_address_level,status,metadata)
values('country',null,'Country','Countries',0,10,true,true,'active',jsonb_build_object('scope','global'))
on conflict do nothing;
insert into public.geography_levels(key,country_code,display_name,plural_display_name,depth,specificity_rank,parent_level_id,is_service_selectable,is_address_level,status,metadata)
select 'admin_level_1',null,'Region level 1','Region level 1 areas',1,20,id,true,true,'active',jsonb_build_object('scope','global')
from public.geography_levels where key='country' and country_code is null on conflict do nothing;
insert into public.geography_levels(key,country_code,display_name,plural_display_name,depth,specificity_rank,parent_level_id,is_service_selectable,is_address_level,status,metadata)
select 'admin_level_2',null,'Region level 2','Region level 2 areas',2,30,id,true,true,'active',jsonb_build_object('scope','global')
from public.geography_levels where key='admin_level_1' and country_code is null on conflict do nothing;
insert into public.geography_levels(key,country_code,display_name,plural_display_name,depth,specificity_rank,parent_level_id,is_service_selectable,is_address_level,status,metadata)
select 'locality',null,'Locality','Localities',3,40,id,true,true,'active',jsonb_build_object('scope','global')
from public.geography_levels where key='admin_level_2' and country_code is null on conflict do nothing;
insert into public.geography_levels(key,country_code,display_name,plural_display_name,depth,specificity_rank,parent_level_id,is_service_selectable,is_address_level,status,metadata)
select 'sublocality',null,'Sublocality','Sublocalities',4,50,id,true,true,'active',jsonb_build_object('scope','global')
from public.geography_levels where key='locality' and country_code is null on conflict do nothing;

create table public.geography_migration_mappings (
  id uuid primary key default gen_random_uuid(),
  legacy_source text not null,
  legacy_id uuid not null,
  geography_id uuid references public.geographies(id) on delete restrict,
  migration_status text not null check (migration_status in ('pending','migrated','blocked','verified','retired')),
  validation_code text not null,
  geometry_source text,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object'),
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  unique(legacy_source,legacy_id),
  check ((migration_status='verified')=(verified_at is not null)),
  check (migration_status<>'verified' or (geography_id is not null and geometry_source is not null and verified_by is not null))
);

create table public.location_runtime_controls (
  key text primary key check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  mode text not null check (mode in ('preparing','universal','retired')),
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration)='object'),
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now())
);

insert into public.location_runtime_controls(key,mode,configuration)
values ('geography.authority','preparing',jsonb_build_object(
  'legacyWritesAllowed',false,
  'activationRequiresVerifiedMappings',true
)) on conflict(key) do nothing;

create index geography_migration_mapping_status_idx
  on public.geography_migration_mappings(migration_status,validation_code);
create index geography_migration_mapping_geography_idx
  on public.geography_migration_mappings(geography_id) where geography_id is not null;

alter table public.geography_migration_mappings enable row level security;
alter table public.location_runtime_controls enable row level security;
revoke all on public.geography_migration_mappings,public.location_runtime_controls from public,anon,authenticated;
grant select,insert,update on public.geography_migration_mappings to authenticated;
grant select,update on public.location_runtime_controls to authenticated;
grant all on public.geography_migration_mappings,public.location_runtime_controls to service_role;

create policy geography_migration_read on public.geography_migration_mappings for select to authenticated
  using(public.has_permission('platform.geography.read',null));
create policy geography_migration_manage on public.geography_migration_mappings for all to authenticated
  using(public.has_permission('platform.geography.manage',null))
  with check(public.has_permission('platform.geography.manage',null));
create policy location_runtime_control_read on public.location_runtime_controls for select to authenticated
  using(public.has_permission('platform.geography.read',null));
create policy location_runtime_control_manage on public.location_runtime_controls for update to authenticated
  using(public.has_permission('platform.geography.manage',null))
  with check(public.has_permission('platform.geography.manage',null));

create trigger set_geography_migration_mappings_updated_at before update on public.geography_migration_mappings
for each row execute function public.set_updated_at();
create trigger set_location_runtime_controls_updated_at before update on public.location_runtime_controls
for each row execute function public.set_updated_at();
create trigger audit_geography_migration_mappings after insert or update or delete on public.geography_migration_mappings
for each row execute function public.record_table_audit();

create or replace function public.validate_geography_hierarchy_and_geometry()
returns trigger language plpgsql set search_path=public,extensions,pg_temp as $$
begin
  if new.parent_id=new.id then
    raise exception using errcode='23514',message='geography cannot be its own parent';
  end if;
  if new.parent_id is not null and exists(
    with recursive descendants as(
      select id from public.geographies where parent_id=new.id
      union all select child.id from public.geographies child join descendants d on child.parent_id=d.id
    ) select 1 from descendants where id=new.parent_id
  ) then
    raise exception using errcode='23514',message='geography hierarchy cycle is not allowed';
  end if;
  if new.status='active' and new.boundary_geometry is null then
    raise exception using errcode='23514',message='active geography requires a boundary';
  end if;
  if new.boundary_geometry is not null and not extensions.st_isvalid(new.boundary_geometry::extensions.geometry) then
    raise exception using errcode='23514',message='geography boundary is invalid';
  end if;
  return new;
end $$;

create trigger validate_geography_before_write before insert or update on public.geographies
for each row execute function public.validate_geography_hierarchy_and_geometry();

create or replace function public.validate_service_coverage_policy_write()
returns trigger language plpgsql set search_path=public,extensions,pg_temp as $$
begin
  if new.status='active' and nullif(btrim(new.reason),'') is null then
    raise exception using errcode='23514',message='active coverage policy requires a reason';
  end if;
  if new.status='active' and not exists(
    select 1 from public.geographies where id=new.target_geography_id and status='active' and boundary_geometry is not null
  ) then
    raise exception using errcode='23514',message='active coverage policy requires an active bounded geography';
  end if;
  new.updated_by:=auth.uid();
  return new;
end $$;

create trigger validate_service_coverage_policy_before_write before insert or update on public.service_coverage_policies
for each row execute function public.validate_service_coverage_policy_write();

create or replace function public.configure_universal_geography(
  p_geography_id uuid,p_parent_id uuid,p_level_id uuid,p_canonical_name text,p_country_code text,
  p_boundary_geojson jsonb,p_source text,p_external_reference text,p_status text default 'draft',
  p_aliases jsonb default '[]'::jsonb,p_metadata jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare resolved_id uuid; boundary extensions.geography(MultiPolygon,4326);
begin
  if coalesce(auth.role(),'')<>'service_role' and not public.has_permission('platform.geography.manage',null) then
    raise exception using errcode='42501',message='geography management permission required';
  end if;
  if nullif(btrim(p_canonical_name),'') is null or p_country_code is null or p_country_code !~ '^[A-Z]{2}$'
     or nullif(btrim(p_source),'') is null or p_status not in('draft','active','inactive','retired')
     or jsonb_typeof(coalesce(p_aliases,'[]'::jsonb))<>'array' or jsonb_typeof(coalesce(p_metadata,'{}'::jsonb))<>'object' then
    raise exception using errcode='22023',message='valid geography fields are required';
  end if;
  if not exists(select 1 from public.geography_levels where id=p_level_id and status='active') then
    raise exception using errcode='22023',message='active geography level is required';
  end if;
  if p_boundary_geojson is not null then
    begin
      boundary:=extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson(p_boundary_geojson::text),4326))::extensions.geography;
    exception when others then
      raise exception using errcode='22023',message='boundary must be valid Polygon or MultiPolygon GeoJSON';
    end;
  end if;
  if p_geography_id is null then
    insert into public.geographies(parent_id,geography_level_id,canonical_name,normalized_name,country_code,boundary_geometry,centroid,source,external_reference,aliases,metadata,status)
    values(p_parent_id,p_level_id,btrim(p_canonical_name),public.normalize_geography_token(p_canonical_name),p_country_code,boundary,
      case when boundary is null then null else extensions.st_pointonsurface(boundary::extensions.geometry)::extensions.geography end,
      btrim(p_source),nullif(btrim(p_external_reference),''),coalesce(p_aliases,'[]'::jsonb),coalesce(p_metadata,'{}'::jsonb),p_status)
    returning id into resolved_id;
  else
    update public.geographies set parent_id=p_parent_id,geography_level_id=p_level_id,canonical_name=btrim(p_canonical_name),
      normalized_name=public.normalize_geography_token(p_canonical_name),country_code=p_country_code,boundary_geometry=coalesce(boundary,boundary_geometry),
      centroid=case when boundary is null then centroid else extensions.st_pointonsurface(boundary::extensions.geometry)::extensions.geography end,
      source=btrim(p_source),external_reference=nullif(btrim(p_external_reference),''),aliases=coalesce(p_aliases,'[]'::jsonb),
      metadata=coalesce(p_metadata,'{}'::jsonb),status=p_status
    where id=p_geography_id returning id into resolved_id;
    if resolved_id is null then raise exception using errcode='P0002',message='geography was not found'; end if;
  end if;
  return resolved_id;
end $$;

create or replace function public.configure_universal_service_policy(
  p_policy_id uuid,p_service_key text,p_capability_key text,p_geography_id uuid,p_effect text,p_priority integer,
  p_status text,p_starts_at timestamptz,p_ends_at timestamptz,p_reason text,p_configuration jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare resolved_id uuid;
begin
  if coalesce(auth.role(),'')<>'service_role' and not public.has_permission('platform.coverage.manage',null) then
    raise exception using errcode='42501',message='coverage management permission required';
  end if;
  if p_service_key is null or p_capability_key is null
     or p_service_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' or p_capability_key !~ '^[a-z][a-z0-9_.:-]{2,120}$'
     or p_effect not in('ALLOW','DENY') or p_status not in('draft','active','paused','retired')
     or (p_ends_at is not null and p_starts_at is not null and p_ends_at<=p_starts_at)
     or jsonb_typeof(coalesce(p_configuration,'{}'::jsonb))<>'object' then
    raise exception using errcode='22023',message='valid coverage policy fields are required';
  end if;
  if p_status='active' and nullif(btrim(p_reason),'') is null then
    raise exception using errcode='22023',message='active coverage policy requires a reason';
  end if;
  if not exists(select 1 from public.geographies where id=p_geography_id and status='active' and boundary_geometry is not null) then
    raise exception using errcode='22023',message='active bounded geography is required';
  end if;
  if p_policy_id is null then
    insert into public.service_coverage_policies(service_key,capability_key,target_geography_id,effect,priority,status,starts_at,ends_at,reason,configuration,created_by,updated_by)
    values(p_service_key,p_capability_key,p_geography_id,p_effect,coalesce(p_priority,0),p_status,p_starts_at,p_ends_at,nullif(btrim(p_reason),''),coalesce(p_configuration,'{}'::jsonb),auth.uid(),auth.uid())
    returning id into resolved_id;
  else
    update public.service_coverage_policies set service_key=p_service_key,capability_key=p_capability_key,target_geography_id=p_geography_id,
      effect=p_effect,priority=coalesce(p_priority,0),status=p_status,starts_at=p_starts_at,ends_at=p_ends_at,
      reason=nullif(btrim(p_reason),''),configuration=coalesce(p_configuration,'{}'::jsonb),updated_by=auth.uid()
    where id=p_policy_id returning id into resolved_id;
    if resolved_id is null then raise exception using errcode='P0002',message='coverage policy was not found'; end if;
  end if;
  return resolved_id;
end $$;

create or replace function public.import_legacy_spatial_geographies()
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
  custom_level_id uuid;
  area record;
  imported_id uuid;
  imported_count integer:=0;
  blocked_count integer:=0;
  boundary extensions.geography(MultiPolygon,4326);
begin
  if coalesce(auth.role(),'')<>'service_role' and not public.has_permission('platform.geography.manage',null) then
    raise exception using errcode='42501',message='geography management permission required';
  end if;

  insert into public.geography_levels(key,country_code,display_name,plural_display_name,depth,specificity_rank,is_service_selectable,is_address_level,status,metadata)
  values('custom_zone',null,'Custom zone','Custom zones',1000,1000,true,false,'active',jsonb_build_object('managedBy','universal_geography_import'))
  on conflict do nothing;
  if custom_level_id is null then
    select id into custom_level_id from public.geography_levels where country_code is null and key='custom_zone';
  end if;

  for area in select * from public.service_areas order by created_at,id loop
    boundary:=null;
    begin
      if area.area_type='polygon' and area.polygon_geojson is not null then
        boundary:=extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson(area.polygon_geojson::text),4326))::extensions.geography;
      elsif area.area_type='radius' and area.center_latitude is not null and area.center_longitude is not null and area.radius_meters>0 then
        boundary:=extensions.st_multi(extensions.st_buffer(
          extensions.st_setsrid(extensions.st_makepoint(area.center_longitude,area.center_latitude),4326)::extensions.geography,
          area.radius_meters
        )::extensions.geometry)::extensions.geography;
      end if;
      if boundary is not null and not extensions.st_isvalid(boundary::extensions.geometry) then boundary:=null; end if;
    exception when others then boundary:=null; end;

    if area.country_code is null or area.country_code !~ '^[A-Z]{2}$' then
      insert into public.geography_migration_mappings(legacy_source,legacy_id,migration_status,validation_code,details)
      values('service_areas',area.id,'blocked','COUNTRY_CODE_REQUIRED',jsonb_build_object('legacyType',area.area_type,'displayName',area.display_name))
      on conflict(legacy_source,legacy_id) do update set migration_status='blocked',validation_code='COUNTRY_CODE_REQUIRED',details=excluded.details;
      blocked_count:=blocked_count+1;
      continue;
    end if;

    if boundary is null then
      insert into public.geography_migration_mappings(legacy_source,legacy_id,migration_status,validation_code,details)
      values('service_areas',area.id,'blocked','BOUNDARY_REQUIRED',jsonb_build_object('legacyType',area.area_type,'displayName',area.display_name))
      on conflict(legacy_source,legacy_id) do update set migration_status='blocked',validation_code='BOUNDARY_REQUIRED',details=excluded.details;
      blocked_count:=blocked_count+1;
      continue;
    end if;

    select geography_id into imported_id from public.geography_migration_mappings
    where legacy_source='service_areas' and legacy_id=area.id;
    if imported_id is null then
      insert into public.geographies(geography_level_id,canonical_name,normalized_name,country_code,boundary_geometry,centroid,source,external_reference,metadata,status)
      values(custom_level_id,area.display_name,public.normalize_geography_token(area.display_name),area.country_code,boundary,
        extensions.st_pointonsurface(boundary::extensions.geometry)::extensions.geography,'legacy.service_areas',area.id::text,
        jsonb_build_object('legacyAreaId',area.id,'legacyType',area.area_type),'active')
      on conflict(source,external_reference) do update set boundary_geometry=excluded.boundary_geometry,centroid=excluded.centroid,updated_at=timezone('utc',now())
      returning id into imported_id;
    end if;
    insert into public.geography_migration_mappings(legacy_source,legacy_id,geography_id,migration_status,validation_code,geometry_source,details)
    values('service_areas',area.id,imported_id,'migrated','READY_FOR_VERIFICATION','LEGACY_SPATIAL_DEFINITION',jsonb_build_object('legacyType',area.area_type))
    on conflict(legacy_source,legacy_id) do update set geography_id=excluded.geography_id,migration_status='migrated',validation_code='READY_FOR_VERIFICATION',geometry_source=excluded.geometry_source,details=excluded.details;
    imported_count:=imported_count+1;
  end loop;
  return jsonb_build_object('imported',imported_count,'blocked',blocked_count);
end $$;

create or replace function public.read_universal_geography_cutover_readiness()
returns jsonb language sql stable security definer set search_path=public,extensions,pg_temp as $$
  select jsonb_build_object(
    'authorityMode',(select mode from public.location_runtime_controls where key='geography.authority'),
    'legacyAreaCount',(select count(*) from public.service_areas),
    'mappedCount',(select count(*) from public.geography_migration_mappings where geography_id is not null),
    'verifiedCount',(select count(*) from public.geography_migration_mappings where migration_status='verified'),
    'blockedCount',(select count(*) from public.geography_migration_mappings where migration_status='blocked'),
    'activeUniversalPolicyCount',(select count(*) from public.service_coverage_policies where status='active'),
    'ready',(select count(*) from public.geography_migration_mappings)=(select count(*) from public.service_areas)
      and not exists(select 1 from public.geography_migration_mappings where migration_status in('pending','blocked','migrated'))
      and exists(select 1 from public.service_coverage_policies where status='active')
  );
$$;

create or replace function public.set_universal_geography_authority(p_mode text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare readiness jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' and not public.has_permission('platform.geography.manage',null) then
    raise exception using errcode='42501',message='geography management permission required';
  end if;
  if p_mode not in('preparing','universal','retired') or nullif(btrim(p_reason),'') is null then
    raise exception using errcode='22023',message='valid mode and reason are required';
  end if;
  readiness:=public.read_universal_geography_cutover_readiness();
  if p_mode in('universal','retired') and not coalesce((readiness->>'ready')::boolean,false) then
    raise exception using errcode='P0001',message='universal geography cutover is not ready';
  end if;
  update public.location_runtime_controls set mode=p_mode,changed_by=auth.uid(),changed_at=timezone('utc',now()),
    configuration=configuration||jsonb_build_object('legacyWritesAllowed',false,'changeReason',btrim(p_reason))
  where key='geography.authority';
  return readiness||jsonb_build_object('authorityMode',p_mode);
end $$;

create or replace function public.validate_location_authority_transition()
returns trigger language plpgsql set search_path=public,extensions,pg_temp as $$
declare readiness jsonb;
begin
  if new.mode in('universal','retired') and new.mode is distinct from old.mode then
    readiness:=public.read_universal_geography_cutover_readiness();
    if not coalesce((readiness->>'ready')::boolean,false) then
      raise exception using errcode='23514',message='universal geography cutover is not ready';
    end if;
    if nullif(btrim(new.configuration->>'changeReason'),'') is null then
      raise exception using errcode='23514',message='geography authority transition requires a reason';
    end if;
    new.configuration:=new.configuration||jsonb_build_object('legacyWritesAllowed',false);
  end if;
  new.changed_by:=auth.uid();
  new.changed_at:=timezone('utc',now());
  return new;
end $$;

create trigger validate_location_authority_transition_before_update
before update on public.location_runtime_controls
for each row execute function public.validate_location_authority_transition();

create or replace function public.prevent_legacy_geography_write_after_cutover()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception using errcode='55000',message='legacy geography is permanently read-only; use universal geography';
end $$;

create trigger freeze_legacy_service_areas before insert or update or delete on public.service_areas
for each row execute function public.prevent_legacy_geography_write_after_cutover();
create trigger freeze_legacy_service_area_rules before insert or update or delete on public.lpg_service_area_rules
for each row execute function public.prevent_legacy_geography_write_after_cutover();
create trigger freeze_legacy_driver_service_areas before insert or update or delete on public.driver_service_areas
for each row execute function public.prevent_legacy_geography_write_after_cutover();

revoke all on function public.import_legacy_spatial_geographies() from public,anon;
revoke all on function public.read_universal_geography_cutover_readiness() from public,anon;
revoke all on function public.set_universal_geography_authority(text,text) from public,anon;
revoke all on function public.prevent_legacy_geography_write_after_cutover() from public,anon,authenticated;
revoke all on function public.validate_location_authority_transition() from public,anon,authenticated;
revoke all on function public.validate_geography_hierarchy_and_geometry() from public,anon,authenticated;
revoke all on function public.validate_service_coverage_policy_write() from public,anon,authenticated;
revoke all on function public.configure_universal_geography(uuid,uuid,uuid,text,text,jsonb,text,text,text,jsonb,jsonb) from public,anon;
revoke all on function public.configure_universal_service_policy(uuid,text,text,uuid,text,integer,text,timestamptz,timestamptz,text,jsonb) from public,anon;
grant execute on function public.import_legacy_spatial_geographies() to authenticated,service_role;
grant execute on function public.read_universal_geography_cutover_readiness() to authenticated,service_role;
grant execute on function public.set_universal_geography_authority(text,text) to authenticated,service_role;
grant execute on function public.configure_universal_geography(uuid,uuid,uuid,text,text,jsonb,text,text,text,jsonb,jsonb) to authenticated,service_role;
grant execute on function public.configure_universal_service_policy(uuid,text,text,uuid,text,integer,text,timestamptz,timestamptz,text,jsonb) to authenticated,service_role;

commit;
