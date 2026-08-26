begin;

create table if not exists public.dispatch_location_decision_snapshots (
  id uuid primary key default gen_random_uuid(),
  dispatch_request_id uuid not null references public.dispatch_requests(id) on delete restrict unique,
  subject_type text not null,
  subject_id uuid not null,
  service_key text not null,
  pickup_point extensions.geography(Point,4326) not null,
  selected_entity_type text not null,
  selected_entity_id uuid not null,
  selected_entity_point extensions.geography(Point,4326) not null,
  matched_coverage_assignment_ids uuid[] not null default '{}',
  distance_meters numeric not null check(distance_meters>=0),
  authority_mode text not null check(authority_mode in('preparing','universal','retired')),
  decision_metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(decision_metadata)='object'),
  decided_at timestamptz not null default timezone('utc',now()),
  created_at timestamptz not null default timezone('utc',now())
);
create index if not exists dispatch_location_decision_subject_idx on public.dispatch_location_decision_snapshots(subject_type,subject_id,decided_at desc);
create index if not exists dispatch_location_decision_pickup_gist_idx on public.dispatch_location_decision_snapshots using gist(pickup_point);
alter table public.dispatch_location_decision_snapshots enable row level security;
revoke all on public.dispatch_location_decision_snapshots from public,anon,authenticated;
grant select on public.dispatch_location_decision_snapshots to authenticated;
grant all on public.dispatch_location_decision_snapshots to service_role;
create policy dispatch_location_decision_admin_read on public.dispatch_location_decision_snapshots for select to authenticated
  using(public.has_permission('platform.dispatch.read',null) or public.has_permission('platform.dispatch.manage',null));
create trigger audit_dispatch_location_decision_snapshots after insert or update or delete on public.dispatch_location_decision_snapshots
for each row execute function public.record_table_audit();

create or replace function public.prevent_dispatch_location_snapshot_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception using errcode='55000',message='dispatch location decision snapshots are immutable';
end $$;
create trigger protect_dispatch_location_decision_snapshots before update or delete on public.dispatch_location_decision_snapshots
for each row execute function public.prevent_dispatch_location_snapshot_mutation();

create or replace function public.record_operational_driver_location(
  target_driver_profile_id uuid,target_latitude numeric,target_longitude numeric,target_online_status text,
  target_lpg_order_id uuid default null,target_accuracy_meters numeric default null,target_heading_degrees numeric default null,
  target_speed_meters_per_second numeric default null,target_recorded_at timestamptz default timezone('utc',now()),
  target_metadata jsonb default '{}'::jsonb,target_source text default 'skima.driver_location_api',target_idempotency_key text default null
) returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare legacy_id uuid;
begin
  legacy_id:=public.record_lpg_driver_location(target_driver_profile_id,target_latitude,target_longitude,target_idempotency_key,
    target_lpg_order_id,target_accuracy_meters,target_heading_degrees,target_speed_meters_per_second,target_online_status,
    target_recorded_at,target_metadata,target_source);
  insert into public.driver_location_state(driver_id,point,accuracy_meters,heading,speed,captured_at,received_at,status,metadata)
  values(target_driver_profile_id,extensions.st_setsrid(extensions.st_makepoint(target_longitude,target_latitude),4326)::extensions.geography,
    target_accuracy_meters,target_heading_degrees,target_speed_meters_per_second,target_recorded_at,timezone('utc',now()),
    case when target_online_status='online' then 'available' else 'unavailable' end,
    coalesce(target_metadata,'{}'::jsonb)||jsonb_build_object('source',target_source,'legacyLocationId',legacy_id))
  on conflict(driver_id) do update set point=excluded.point,accuracy_meters=excluded.accuracy_meters,heading=excluded.heading,
    speed=excluded.speed,captured_at=excluded.captured_at,received_at=excluded.received_at,status=excluded.status,metadata=excluded.metadata
  where excluded.captured_at>=public.driver_location_state.captured_at;
  return legacy_id;
end $$;

revoke all on function public.prevent_dispatch_location_snapshot_mutation() from public,anon,authenticated;
revoke all on function public.record_operational_driver_location(uuid,numeric,numeric,text,uuid,numeric,numeric,numeric,timestamptz,jsonb,text,text) from public,anon;
grant execute on function public.record_operational_driver_location(uuid,numeric,numeric,text,uuid,numeric,numeric,numeric,timestamptz,jsonb,text,text) to authenticated,service_role;

create table if not exists public.operational_coverage_legacy_mappings(
  id uuid primary key default gen_random_uuid(),
  legacy_source text not null,
  legacy_id uuid not null,
  coverage_assignment_id uuid not null references public.operational_coverage_assignments(id) on delete restrict,
  migrated_at timestamptz not null default timezone('utc',now()),
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  unique(legacy_source,legacy_id),unique(coverage_assignment_id)
);
alter table public.operational_coverage_legacy_mappings enable row level security;
revoke all on public.operational_coverage_legacy_mappings from public,anon,authenticated;
grant select on public.operational_coverage_legacy_mappings to authenticated;
grant all on public.operational_coverage_legacy_mappings to service_role;
create policy operational_coverage_legacy_mapping_read on public.operational_coverage_legacy_mappings for select to authenticated
  using(public.has_permission('platform.coverage.read',null));
create trigger audit_operational_coverage_legacy_mappings after insert or update or delete on public.operational_coverage_legacy_mappings
for each row execute function public.record_table_audit();

create or replace function public.migrate_verified_operational_coverage()
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare driver_count integer:=0; station_count integer:=0;
begin
  if coalesce(auth.role(),'')<>'service_role' and not public.has_permission('platform.coverage.manage',null) then
    raise exception using errcode='42501',message='coverage management permission required';
  end if;
  with inserted as(
    insert into public.operational_coverage_assignments(entity_type,entity_id,service_key,coverage_type,geography_id,status,source,
      valid_from,valid_to,approved_by,approved_at,metadata)
    select 'DRIVER',legacy.driver_profile_id,'lpg','ADMIN_GEOGRAPHY',mapping.geography_id,
      case legacy.status when 'active' then 'active' else 'retired' end,'SYSTEM_ASSIGNED',legacy.effective_from,legacy.effective_until,
      legacy.approved_by,coalesce(legacy.effective_from,legacy.created_at),
      jsonb_build_object('legacyDriverServiceAreaId',legacy.id,'legacyPrimary',legacy.is_primary,'sourceApplicationId',legacy.source_application_id)
    from public.driver_service_areas legacy
    join public.geography_migration_mappings mapping on mapping.legacy_source='service_areas'
      and mapping.legacy_id=legacy.service_area_id and mapping.migration_status='verified'
    where not exists(select 1 from public.operational_coverage_legacy_mappings old where old.legacy_source='driver_service_areas' and old.legacy_id=legacy.id)
    returning id,metadata
  )
  insert into public.operational_coverage_legacy_mappings(legacy_source,legacy_id,coverage_assignment_id,metadata)
  select 'driver_service_areas',(metadata->>'legacyDriverServiceAreaId')::uuid,id,jsonb_build_object('migration','verified_geography') from inserted;
  get diagnostics driver_count=row_count;

  with inserted as(
    insert into public.operational_coverage_assignments(entity_type,entity_id,service_key,coverage_type,center_point,radius_meters,status,source,approved_at,metadata)
    select 'STATION',station.id,'lpg','RADIUS',extensions.st_setsrid(extensions.st_makepoint(station.longitude,station.latitude),4326)::extensions.geography,
      station.service_radius_meters,'active','SYSTEM_ASSIGNED',timezone('utc',now()),jsonb_build_object('legacyStationBranchId',station.id)
    from public.lpg_station_branches station
    where station.latitude is not null and station.longitude is not null and station.service_radius_meters>0
      and station.approval_status='approved'
      and not exists(select 1 from public.operational_coverage_legacy_mappings old where old.legacy_source='lpg_station_branches' and old.legacy_id=station.id)
    returning id,metadata
  )
  insert into public.operational_coverage_legacy_mappings(legacy_source,legacy_id,coverage_assignment_id,metadata)
  select 'lpg_station_branches',(metadata->>'legacyStationBranchId')::uuid,id,jsonb_build_object('migration','station_radius') from inserted;
  get diagnostics station_count=row_count;
  return jsonb_build_object('driverAssignmentsMigrated',driver_count,'stationAssignmentsMigrated',station_count);
end $$;

revoke all on function public.migrate_verified_operational_coverage() from public,anon;
grant execute on function public.migrate_verified_operational_coverage() to authenticated,service_role;

create table if not exists public.location_retention_policies(
  key text primary key check(key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  sample_source text not null,
  retention_days integer not null check(retention_days between 1 and 3650),
  preserve_linked_records boolean not null default true,
  status text not null check(status in('active','paused','retired')),
  configuration jsonb not null default '{}'::jsonb check(jsonb_typeof(configuration)='object'),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now())
);
insert into public.location_retention_policies(key,sample_source,retention_days,preserve_linked_records,status,configuration)
values('driver.location_samples','lpg_driver_locations',30,true,'active',jsonb_build_object('batchSize',5000))
on conflict(key) do nothing;
alter table public.location_retention_policies enable row level security;
revoke all on public.location_retention_policies from public,anon,authenticated;
grant select,insert,update,delete on public.location_retention_policies to authenticated;
grant all on public.location_retention_policies to service_role;
create policy location_retention_read on public.location_retention_policies for select to authenticated
  using(public.has_permission('platform.tracking.read',null) or public.has_permission('platform.tracking.manage',null));
create policy location_retention_manage on public.location_retention_policies for all to authenticated
  using(public.has_permission('platform.tracking.manage',null)) with check(public.has_permission('platform.tracking.manage',null));
create trigger set_location_retention_policies_updated_at before update on public.location_retention_policies
for each row execute function public.set_updated_at();
create trigger audit_location_retention_policies after insert or update or delete on public.location_retention_policies
for each row execute function public.record_table_audit();

create or replace function public.purge_expired_driver_location_samples(p_limit integer default 5000)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare deleted_count integer; policy record;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='service authority required'; end if;
  if p_limit not between 1 and 50000 then raise exception using errcode='22023',message='purge limit must be between 1 and 50000'; end if;
  select * into policy from public.location_retention_policies where key='driver.location_samples' and status='active';
  if not found then return 0; end if;
  delete from public.lpg_driver_locations sample where sample.id in(
    select candidate.id from public.lpg_driver_locations candidate
    where candidate.recorded_at<timezone('utc',now())-make_interval(days=>policy.retention_days)
      and (not policy.preserve_linked_records or candidate.lpg_order_id is null)
    order by candidate.recorded_at limit p_limit
  );
  get diagnostics deleted_count=row_count;
  return deleted_count;
end $$;
revoke all on function public.purge_expired_driver_location_samples(integer) from public,anon,authenticated;
grant execute on function public.purge_expired_driver_location_samples(integer) to service_role;

create or replace function public.read_universal_geography_cutover_readiness()
returns jsonb language sql stable security definer set search_path=public,extensions,pg_temp as $$
  with metrics as(
    select
      (select count(*) from public.service_areas) legacy_count,
      (select count(*) from public.geography_migration_mappings) mapping_count,
      (select count(*) from public.geography_migration_mappings where geography_id is not null) mapped_count,
      (select count(*) from public.geography_migration_mappings where migration_status='verified') verified_count,
      (select count(*) from public.geography_migration_mappings where migration_status='blocked') blocked_count,
      (select count(*) from public.service_coverage_policies where status='active') policy_count,
      (select count(*) from public.driver_profiles driver where driver.verification_status='approved' and not exists(
        select 1 from public.operational_coverage_assignments coverage where coverage.entity_type='DRIVER' and coverage.entity_id=driver.id
          and coverage.service_key='lpg' and coverage.status in('approved','active') and coverage.approved_at is not null
      )) uncovered_drivers,
      (select count(*) from public.lpg_station_branches station where station.approval_status='approved' and not exists(
        select 1 from public.operational_coverage_assignments coverage where coverage.entity_type='STATION' and coverage.entity_id=station.id
          and coverage.service_key='lpg' and coverage.status in('approved','active') and coverage.approved_at is not null
      )) uncovered_stations
  )
  select jsonb_build_object(
    'authorityMode',(select mode from public.location_runtime_controls where key='geography.authority'),
    'legacyAreaCount',legacy_count,'mappedCount',mapped_count,'verifiedCount',verified_count,'blockedCount',blocked_count,
    'activeUniversalPolicyCount',policy_count,'approvedDriversWithoutCoverage',uncovered_drivers,
    'approvedStationsWithoutCoverage',uncovered_stations,
    'ready',mapping_count=legacy_count and blocked_count=0 and verified_count=legacy_count and policy_count>0
      and uncovered_drivers=0 and uncovered_stations=0
  ) from metrics;
$$;
revoke all on function public.read_universal_geography_cutover_readiness() from public,anon;
grant execute on function public.read_universal_geography_cutover_readiness() to authenticated,service_role;

create or replace function public.resolve_lpg_serviceability(
  p_latitude double precision,p_longitude double precision,p_geography jsonb default '{}'::jsonb
) returns jsonb language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
declare customer jsonb; driver_onboarding jsonb; station_onboarding jsonb;
begin
  customer:=public.resolve_service_availability('lpg','customer_ordering',p_longitude,p_latitude,timezone('utc',now()));
  driver_onboarding:=public.resolve_service_availability('lpg','driver_onboarding',p_longitude,p_latitude,timezone('utc',now()));
  station_onboarding:=public.resolve_service_availability('lpg','station_onboarding',p_longitude,p_latitude,timezone('utc',now()));
  return jsonb_build_object(
    'serviceable',coalesce((customer->>'available')::boolean,false),
    'status',case when coalesce((customer->>'available')::boolean,false) then 'available' else 'unavailable' end,
    'reason',customer->>'reason',
    'matchedArea',case when customer->>'matchedGeographyId' is null then null else jsonb_build_object('id',customer->>'matchedGeographyId','policyId',customer->>'matchedPolicyId') end,
    'partnerOpportunity',coalesce((driver_onboarding->>'available')::boolean,false) or coalesce((station_onboarding->>'available')::boolean,false),
    'partnerOpportunities',jsonb_build_object('driver',coalesce((driver_onboarding->>'available')::boolean,false),'station',coalesce((station_onboarding->>'available')::boolean,false))
  );
end $$;
revoke all on function public.resolve_lpg_serviceability(double precision,double precision,jsonb) from public,anon;
grant execute on function public.resolve_lpg_serviceability(double precision,double precision,jsonb) to authenticated,service_role;

-- Universal coverage and current-position state are authoritative after the guarded cutover.
-- Fleet compliance is evaluated while constructing driver/vehicle candidates, before ranking.
create or replace function public.dispatch_lpg_order(
  target_lpg_order_id uuid,
  target_candidate_limit integer default null,
  target_idempotency_key text default null,
  target_source text default 'lpg.dispatch_api'
)
returns uuid
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  order_record record;
  station_record record;
  dispatch_request_id uuid;
  candidate_record record;
  candidate_rank integer := 0;
  selected_driver_profile_id uuid;
  selected_vehicle_id uuid;
  selected_active_order_count integer := 0;
  selected_program_key text := 'driver.independent';
  selected_priority_bonus numeric := 0;
  existing_dispatch_request_id uuid;
  dispatch_policy jsonb;
  policy_candidate_limit integer;
  freshness_seconds integer;
  max_driver_distance_meters numeric;
  offer_ttl_seconds integer;
  reservation_ttl_seconds integer;
  driver_required jsonb;
  vehicle_required jsonb;
  configured_dispatch_policy_key text;
  dispatch_policy_key text;
  reservation_id uuid;
  allow_concurrent boolean;
  max_driver_orders integer;
  max_vehicle_orders integer;
  workload_penalty numeric;
  same_station_bonus numeric;
  same_customer_bonus numeric;
  special_priority_enabled boolean;
  special_priority_bonus numeric;
  geography_authority_mode text;
  selected_driver_point extensions.geography(Point,4326);
  selected_driver_distance numeric;
  selected_coverage_assignment_ids uuid[]:='{}';
  selected_station_coverage_assignment_ids uuid[]:='{}';
  service_resolution jsonb;
begin
  if auth.role()<>'service_role'
    and not public.has_permission('lpg.dispatch.execute',null)
    and not public.can_manage_lpg_operations() then
    raise exception 'LPG dispatch permission is required';
  end if;

  select mode into geography_authority_mode from public.location_runtime_controls where key='geography.authority';
  geography_authority_mode:=coalesce(geography_authority_mode,'preparing');

  if target_lpg_order_id is null then raise exception 'target_lpg_order_id is required'; end if;
  if target_idempotency_key is null or btrim(target_idempotency_key)='' then raise exception 'target_idempotency_key is required'; end if;

  dispatch_policy:=public.lpg_policy_config('lpg.dispatch.phase_one');
  policy_candidate_limit:=nullif(dispatch_policy->>'candidate_limit','')::integer;
  freshness_seconds:=nullif(dispatch_policy->>'driver_location_freshness_seconds','')::integer;
  max_driver_distance_meters:=nullif(dispatch_policy->>'max_driver_distance_meters','')::numeric;
  offer_ttl_seconds:=nullif(dispatch_policy->>'offer_ttl_seconds','')::integer;
  reservation_ttl_seconds:=nullif(dispatch_policy->>'capacity_reservation_ttl_seconds','')::integer;
  driver_required:=coalesce(dispatch_policy->'required_driver_capabilities','[]'::jsonb);
  vehicle_required:=coalesce(dispatch_policy->'required_vehicle_capabilities','[]'::jsonb);
  allow_concurrent:=coalesce((dispatch_policy->>'allow_concurrent_assignments')::boolean,true);
  max_driver_orders:=coalesce(nullif(dispatch_policy->>'max_concurrent_orders_per_driver','')::integer,12);
  max_vehicle_orders:=coalesce(nullif(dispatch_policy->>'max_concurrent_orders_per_vehicle','')::integer,max_driver_orders);
  workload_penalty:=coalesce(nullif(dispatch_policy->>'workload_penalty_meters_per_order','')::numeric,650);
  same_station_bonus:=coalesce(nullif(dispatch_policy->>'same_station_bundle_bonus_meters','')::numeric,900);
  same_customer_bonus:=coalesce(nullif(dispatch_policy->>'same_customer_bundle_bonus_meters','')::numeric,1400);
  special_priority_enabled:=coalesce((dispatch_policy->>'special_driver_priority_enabled')::boolean,true);
  special_priority_bonus:=coalesce(nullif(dispatch_policy->>'special_driver_priority_bonus_meters','')::numeric,1000);

  if not allow_concurrent then max_driver_orders:=1; max_vehicle_orders:=1; end if;

  if policy_candidate_limit is null or policy_candidate_limit<=0 or policy_candidate_limit>25
    or freshness_seconds is null or freshness_seconds<=0
    or max_driver_distance_meters is null or max_driver_distance_meters<=0
    or offer_ttl_seconds is null or offer_ttl_seconds<=0
    or reservation_ttl_seconds is null or reservation_ttl_seconds<=0
    or max_driver_orders<=0 or max_driver_orders>100
    or max_vehicle_orders<=0 or max_vehicle_orders>100
    or workload_penalty<0 or same_station_bonus<0 or same_customer_bonus<0
    or special_priority_bonus<0 or special_priority_bonus>5000
    or jsonb_typeof(driver_required)<>'array'
    or jsonb_typeof(vehicle_required)<>'array' then
    raise exception 'LPG dispatch policy is incomplete';
  end if;

  target_candidate_limit:=least(coalesce(target_candidate_limit,policy_candidate_limit),policy_candidate_limit);
  if target_candidate_limit<=0 or target_candidate_limit>25 then raise exception 'target_candidate_limit must be between 1 and 25'; end if;

  configured_dispatch_policy_key:=public.lpg_policy_config('lpg.quote.phase_one')->>'dispatch_policy_key';
  if configured_dispatch_policy_key is null then raise exception 'LPG quote policy must define dispatch_policy_key'; end if;

  select policy.key into dispatch_policy_key
  from public.dispatch_policies policy
  where policy.key=configured_dispatch_policy_key and policy.status='active'
  limit 1;
  if dispatch_policy_key is null then raise exception 'active LPG dispatch policy is required'; end if;

  select target_order.*,
         pickup.latitude as pickup_latitude,
         pickup.longitude as pickup_longitude,
         delivery.latitude as delivery_latitude,
         delivery.longitude as delivery_longitude,
         cylinder.size_kg as cylinder_size_kg
  into order_record
  from public.lpg_refill_orders target_order
  join public.lpg_customer_locations pickup on pickup.id=target_order.pickup_location_id
  join public.lpg_customer_locations delivery on delivery.id=target_order.delivery_location_id
  join public.lpg_cylinders cylinder on cylinder.id=target_order.cylinder_id
  where target_order.id=target_lpg_order_id
  for update of target_order;
  if not found then raise exception 'target_lpg_order_id must reference an LPG order'; end if;

  existing_dispatch_request_id:=nullif(order_record.metadata->>'dispatch_request_id','')::uuid;
  if existing_dispatch_request_id is not null and order_record.metadata->>'dispatch_idempotency_key'=target_idempotency_key then
    return existing_dispatch_request_id;
  end if;

  if order_record.status not in ('payment_reserved','matching_station','matching_driver','driver_offered') then
    raise exception 'LPG order must be funded before dispatch';
  end if;

  service_resolution:=public.resolve_service_availability('lpg','customer_ordering',order_record.pickup_longitude,order_record.pickup_latitude,timezone('utc',now()));
  if not coalesce((service_resolution->>'available')::boolean,false) then
    raise exception using errcode='P0001',message='pickup location is outside current universal service coverage';
  end if;

  if order_record.station_branch_id is not null then
    select station.* into station_record
    from public.lpg_station_branches station
    where station.id=order_record.station_branch_id
      and station.approval_status='approved'
      and station.compliance_status='approved'
      and station.availability_status='available'
      and station.current_available_kg>=order_record.requested_kg
      and (exists(
        select 1 from public.operational_coverage_assignments coverage
        left join public.geographies geography on geography.id=coverage.geography_id
        where coverage.entity_type='STATION' and coverage.entity_id=station.id and coverage.service_key='lpg'
          and coverage.status in('approved','active') and coverage.approved_at is not null
          and (coverage.valid_from is null or coverage.valid_from<=timezone('utc',now()))
          and (coverage.valid_to is null or coverage.valid_to>timezone('utc',now()))
          and case coverage.coverage_type
            when 'ADMIN_GEOGRAPHY' then extensions.st_covers(geography.boundary_geometry,extensions.st_setsrid(extensions.st_makepoint(order_record.pickup_longitude,order_record.pickup_latitude),4326)::extensions.geography)
            when 'RADIUS' then extensions.st_dwithin(coverage.center_point,extensions.st_setsrid(extensions.st_makepoint(order_record.pickup_longitude,order_record.pickup_latitude),4326)::extensions.geography,coverage.radius_meters)
            when 'CUSTOM_ZONE' then extensions.st_covers(coverage.coverage_geometry,extensions.st_setsrid(extensions.st_makepoint(order_record.pickup_longitude,order_record.pickup_latitude),4326)::extensions.geography)
            else false end
      ))
    for update;
  else
    select station.* into station_record
    from public.lpg_station_branches station
    where station.approval_status='approved'
      and station.compliance_status='approved'
      and station.availability_status='available'
      and station.current_available_kg>=order_record.requested_kg
      and (array_length(station.supported_cylinder_sizes_kg,1) is null or order_record.cylinder_size_kg=any(station.supported_cylinder_sizes_kg))
      and (exists(
        select 1 from public.operational_coverage_assignments coverage
        left join public.geographies geography on geography.id=coverage.geography_id
        where coverage.entity_type='STATION' and coverage.entity_id=station.id and coverage.service_key='lpg'
          and coverage.status in('approved','active') and coverage.approved_at is not null
          and (coverage.valid_from is null or coverage.valid_from<=timezone('utc',now()))
          and (coverage.valid_to is null or coverage.valid_to>timezone('utc',now()))
          and case coverage.coverage_type
            when 'ADMIN_GEOGRAPHY' then extensions.st_covers(geography.boundary_geometry,extensions.st_setsrid(extensions.st_makepoint(order_record.pickup_longitude,order_record.pickup_latitude),4326)::extensions.geography)
            when 'RADIUS' then extensions.st_dwithin(coverage.center_point,extensions.st_setsrid(extensions.st_makepoint(order_record.pickup_longitude,order_record.pickup_latitude),4326)::extensions.geography,coverage.radius_meters)
            when 'CUSTOM_ZONE' then extensions.st_covers(coverage.coverage_geometry,extensions.st_setsrid(extensions.st_makepoint(order_record.pickup_longitude,order_record.pickup_latitude),4326)::extensions.geography)
            else false end
      ))
      and public.lpg_distance_meters(order_record.pickup_latitude,order_record.pickup_longitude,station.latitude,station.longitude)<=station.service_radius_meters
    order by public.lpg_distance_meters(order_record.pickup_latitude,order_record.pickup_longitude,station.latitude,station.longitude) asc,
             station.current_available_kg desc,
             station.created_at asc
    limit 1
    for update;
  end if;
  if not found then raise exception 'no eligible LPG station is available for this order'; end if;

  select coalesce(array_agg(coverage.id order by coverage.id),'{}'::uuid[])
  into selected_station_coverage_assignment_ids
  from public.operational_coverage_assignments coverage
  left join public.geographies geography on geography.id=coverage.geography_id
  where coverage.entity_type='STATION' and coverage.entity_id=station_record.id and coverage.service_key='lpg'
    and coverage.status in('approved','active') and coverage.approved_at is not null
    and (coverage.valid_from is null or coverage.valid_from<=timezone('utc',now()))
    and (coverage.valid_to is null or coverage.valid_to>timezone('utc',now()))
    and case coverage.coverage_type
      when 'ADMIN_GEOGRAPHY' then extensions.st_covers(geography.boundary_geometry,extensions.st_setsrid(extensions.st_makepoint(order_record.pickup_longitude,order_record.pickup_latitude),4326)::extensions.geography)
      when 'RADIUS' then extensions.st_dwithin(coverage.center_point,extensions.st_setsrid(extensions.st_makepoint(order_record.pickup_longitude,order_record.pickup_latitude),4326)::extensions.geography,coverage.radius_meters)
      when 'CUSTOM_ZONE' then extensions.st_covers(coverage.coverage_geometry,extensions.st_setsrid(extensions.st_makepoint(order_record.pickup_longitude,order_record.pickup_latitude),4326)::extensions.geography)
      else false end;

  dispatch_request_id:=public.create_dispatch_request(
    dispatch_policy_key,target_source,'lpg_order',order_record.id,
    jsonb_build_object('driver_required_capabilities',driver_required,'vehicle_required_capabilities',vehicle_required),
    jsonb_build_object('latitude',order_record.pickup_latitude,'longitude',order_record.pickup_longitude),
    jsonb_build_object('latitude',order_record.delivery_latitude,'longitude',order_record.delivery_longitude),
    100,
    jsonb_build_object(
      'bounded_context','lpg',
      'station_branch_id',station_record.id,
      'candidate_limit',target_candidate_limit,
      'max_driver_distance_meters',max_driver_distance_meters,
      'allow_concurrent_assignments',allow_concurrent,
      'max_concurrent_orders_per_driver',max_driver_orders,
      'max_concurrent_orders_per_vehicle',max_vehicle_orders,
      'special_driver_priority_enabled',special_priority_enabled,
      'special_driver_priority_bonus_meters',special_priority_bonus
    ),
    target_idempotency_key||':dispatch-request'
  );

  for candidate_record in
    select candidate.*
    from (
      select
        driver.id as driver_profile_id,
        selected_vehicle.id as vehicle_id,
        latest_location.recorded_at,
        latest_location.point as driver_point,
        coalesce(coverage_match.assignment_ids,'{}'::uuid[]) as coverage_assignment_ids,
        public.lpg_distance_meters(order_record.pickup_latitude,order_record.pickup_longitude,latest_location.latitude,latest_location.longitude) as distance_meters,
        workload.active_order_count,
        workload.active_vehicle_order_count,
        workload.same_station_order_count,
        workload.same_customer_order_count,
        coalesce(participation.program_key,'driver.independent') as participation_program_key,
        case when special_priority_enabled and coalesce(participation.program_key,'driver.independent')='driver.skima_special'
          then special_priority_bonus else 0 end as participation_priority_bonus_meters,
        greatest(
          public.lpg_distance_meters(order_record.pickup_latitude,order_record.pickup_longitude,latest_location.latitude,latest_location.longitude)
          + workload.active_order_count*workload_penalty
          - workload.same_station_order_count*same_station_bonus
          - workload.same_customer_order_count*same_customer_bonus
          - case when special_priority_enabled and coalesce(participation.program_key,'driver.independent')='driver.skima_special'
              then special_priority_bonus else 0 end,
          0
        ) as dispatch_cost
      from public.driver_profiles driver
      join public.driver_vehicle_links vehicle_link
        on vehicle_link.driver_profile_id=driver.id
        and vehicle_link.status='active'
        and vehicle_link.starts_at<=timezone('utc',now())
        and (vehicle_link.ends_at is null or vehicle_link.ends_at>timezone('utc',now()))
      join public.vehicles selected_vehicle
        on selected_vehicle.id=vehicle_link.vehicle_id
        and selected_vehicle.status='active'
      join lateral (
        select public.evaluate_driver_vehicle_eligibility(driver.id,selected_vehicle.id,'lpg') as result
      ) fleet_eligibility on coalesce((fleet_eligibility.result->>'eligible')::boolean,false)
      join lateral (
        select source.latitude,source.longitude,source.recorded_at,source.point
        from (
          select extensions.st_y(state.point::extensions.geometry) latitude,
                 extensions.st_x(state.point::extensions.geometry) longitude,
                 state.captured_at recorded_at,state.point,0 source_priority
          from public.driver_location_state state
          where state.driver_id=driver.id and state.status='available'
            and state.captured_at>=timezone('utc',now())-make_interval(secs=>freshness_seconds)
        ) source order by source.source_priority,source.recorded_at desc limit 1
      ) latest_location on true
      join lateral (
        select coalesce(array_agg(coverage.id order by coverage.id),'{}'::uuid[]) assignment_ids
        from public.operational_coverage_assignments coverage
        left join public.geographies geography on geography.id=coverage.geography_id
        where coverage.entity_type='DRIVER' and coverage.entity_id=driver.id and coverage.service_key='lpg'
          and coverage.status in('approved','active') and coverage.approved_at is not null
          and (coverage.valid_from is null or coverage.valid_from<=timezone('utc',now()))
          and (coverage.valid_to is null or coverage.valid_to>timezone('utc',now()))
          and case coverage.coverage_type
            when 'ADMIN_GEOGRAPHY' then extensions.st_covers(geography.boundary_geometry,extensions.st_setsrid(extensions.st_makepoint(order_record.pickup_longitude,order_record.pickup_latitude),4326)::extensions.geography)
            when 'RADIUS' then extensions.st_dwithin(coverage.center_point,extensions.st_setsrid(extensions.st_makepoint(order_record.pickup_longitude,order_record.pickup_latitude),4326)::extensions.geography,coverage.radius_meters)
            when 'CUSTOM_ZONE' then extensions.st_covers(coverage.coverage_geometry,extensions.st_setsrid(extensions.st_makepoint(order_record.pickup_longitude,order_record.pickup_latitude),4326)::extensions.geography)
            else false end
      ) coverage_match on cardinality(coverage_match.assignment_ids)>0
      join lateral (
        select count(*)::integer as active_order_count,
               count(*) filter(where active.vehicle_id=selected_vehicle.id)::integer as active_vehicle_order_count,
               count(*) filter(where active.station_branch_id=station_record.id)::integer as same_station_order_count,
               count(*) filter(where active.customer_user_id=order_record.customer_user_id)::integer as same_customer_order_count
        from public.lpg_refill_orders active
        where active.driver_profile_id=driver.id
          and active.id<>order_record.id
          and active.status not in ('completed','cancelled','refunded','failed')
      ) workload on true
      left join lateral (
        select membership.program_key
        from public.driver_program_memberships membership
        join public.driver_participation_programs program on program.key=membership.program_key and program.status='active'
        where membership.driver_profile_id=driver.id
          and membership.status='active'
          and membership.ends_at is null
          and membership.starts_at<=timezone('utc',now())
        order by membership.starts_at desc
        limit 1
      ) participation on true
      where driver.verification_status='approved'
        and driver.operational_status in ('available','busy')
        and workload.active_order_count<max_driver_orders
        and workload.active_vehicle_order_count<max_vehicle_orders
        and not exists (
          select 1 from jsonb_array_elements_text(driver_required) required_capability(capability_key)
          where not exists (
            select 1 from public.entity_capabilities driver_capability
            where driver_capability.entity_type='driver'
              and driver_capability.entity_id=driver.id
              and driver_capability.capability_key=required_capability.capability_key
              and driver_capability.status='active'
          )
        )
        and not exists (
          select 1 from jsonb_array_elements_text(vehicle_required) required_capability(capability_key)
          where not exists (
            select 1 from public.entity_capabilities vehicle_capability
            where vehicle_capability.entity_type='vehicle'
              and vehicle_capability.entity_id=selected_vehicle.id
              and vehicle_capability.capability_key=required_capability.capability_key
              and vehicle_capability.status='active'
          )
        )
        and public.lpg_distance_meters(order_record.pickup_latitude,order_record.pickup_longitude,latest_location.latitude,latest_location.longitude)<=max_driver_distance_meters
    ) candidate
    order by candidate.dispatch_cost asc,candidate.distance_meters asc,candidate.recorded_at desc,candidate.driver_profile_id asc
    limit target_candidate_limit
  loop
    candidate_rank:=candidate_rank+1;

    if candidate_rank=1 then
      selected_driver_profile_id:=candidate_record.driver_profile_id;
      selected_vehicle_id:=candidate_record.vehicle_id;
      selected_active_order_count:=candidate_record.active_order_count;
      selected_program_key:=candidate_record.participation_program_key;
      selected_priority_bonus:=candidate_record.participation_priority_bonus_meters;
      selected_driver_point:=candidate_record.driver_point;
      selected_driver_distance:=candidate_record.distance_meters;
      selected_coverage_assignment_ids:=candidate_record.coverage_assignment_ids;
    end if;

    perform public.upsert_dispatch_candidate(
      dispatch_request_id,'driver',candidate_record.driver_profile_id,
      greatest(1000000-coalesce(candidate_record.dispatch_cost,1000000),1),candidate_rank,
      jsonb_build_object(
        'vehicle_id',candidate_record.vehicle_id,
        'distance_meters',candidate_record.distance_meters,
        'coverage_assignment_ids',candidate_record.coverage_assignment_ids,
        'geography_authority_mode',geography_authority_mode,
        'location_recorded_at',candidate_record.recorded_at,
        'active_order_count',candidate_record.active_order_count,
        'active_vehicle_order_count',candidate_record.active_vehicle_order_count,
        'same_station_order_count',candidate_record.same_station_order_count,
        'same_customer_order_count',candidate_record.same_customer_order_count,
        'remaining_driver_slots_before_assignment',greatest(max_driver_orders-candidate_record.active_order_count,0),
        'remaining_vehicle_slots_before_assignment',greatest(max_vehicle_orders-candidate_record.active_vehicle_order_count,0),
        'participation_program_key',candidate_record.participation_program_key,
        'participation_priority_bonus_meters',candidate_record.participation_priority_bonus_meters,
        'dispatch_cost',candidate_record.dispatch_cost,
        'selection_mode','lpg_capacity_route_bundle_with_bounded_driver_priority'
      ),
      case when candidate_rank=1 then 'offered' else 'suggested' end,
      target_idempotency_key||':candidate:'||candidate_rank::text
    );
  end loop;

  if candidate_rank=0 then raise exception 'no eligible LPG driver has fresh location and remaining assignment capacity'; end if;

  update public.lpg_station_branches
  set current_available_kg=current_available_kg-order_record.requested_kg,
      availability_status=case when current_available_kg-order_record.requested_kg<=0 then 'capacity_reached' else availability_status end,
      updated_at=timezone('utc',now())
  where id=station_record.id and current_available_kg>=order_record.requested_kg;
  if not found then raise exception 'station capacity could not be reserved'; end if;

  insert into public.lpg_station_capacity_reservations(
    lpg_order_id,station_branch_id,requested_kg,reserved_kg,status,expires_at,metadata,source,idempotency_key
  ) values (
    order_record.id,station_record.id,order_record.requested_kg,order_record.requested_kg,'reserved',
    timezone('utc',now())+make_interval(secs=>reservation_ttl_seconds),
    jsonb_build_object('dispatch_request_id',dispatch_request_id),target_source,target_idempotency_key||':capacity'
  )
  on conflict(lpg_order_id) do update
  set station_branch_id=excluded.station_branch_id,
      requested_kg=excluded.requested_kg,
      reserved_kg=excluded.reserved_kg,
      status='reserved',
      expires_at=excluded.expires_at,
      metadata=public.lpg_station_capacity_reservations.metadata||excluded.metadata,
      updated_at=timezone('utc',now())
  returning id into reservation_id;

  update public.dispatch_requests
  set assigned_entity_type='driver',
      assigned_entity_id=selected_driver_profile_id,
      metadata=metadata||jsonb_build_object(
        'vehicle_id',selected_vehicle_id,
        'capacity_reservation_id',reservation_id,
        'driver_active_orders_before_assignment',selected_active_order_count,
        'concurrent_assignment',selected_active_order_count>0,
        'driver_participation_program_key',selected_program_key,
        'driver_priority_bonus_meters',selected_priority_bonus
      ),
      updated_at=timezone('utc',now())
  where id=dispatch_request_id;

  update public.lpg_refill_orders
  set station_branch_id=station_record.id,
      driver_profile_id=selected_driver_profile_id,
      vehicle_id=selected_vehicle_id,
      status='driver_offered',
      assignment_status='driver_offered',
      metadata=metadata||jsonb_build_object(
        'dispatch_request_id',dispatch_request_id,
        'dispatch_idempotency_key',target_idempotency_key,
        'dispatch_candidate_count',candidate_rank,
        'driver_offer_expires_at',timezone('utc',now())+make_interval(secs=>offer_ttl_seconds),
        'capacity_reservation_id',reservation_id,
        'driver_active_orders_before_assignment',selected_active_order_count,
        'concurrent_assignment',selected_active_order_count>0,
        'driver_participation_program_key',selected_program_key,
        'driver_priority_bonus_meters',selected_priority_bonus
      ),
      updated_at=timezone('utc',now())
  where id=order_record.id;

  update public.service_requests
  set status='matching',
      participants=participants||jsonb_build_object(
        'station_branch_id',station_record.id,
        'driver_profile_id',selected_driver_profile_id,
        'vehicle_id',selected_vehicle_id
      ),
      updated_at=timezone('utc',now())
  where id=order_record.service_request_id;

  perform public.ensure_lpg_order_record(
    order_record.id,target_idempotency_key||':order-record','lpg.order_projection',jsonb_build_object('dispatch_request_id',dispatch_request_id)
  );

  perform public.record_lpg_order_event(
    order_record.id,'lpg.dispatch.driver_offered',order_record.status,'driver_offered',target_idempotency_key||':event',
    jsonb_build_object(
      'dispatch_request_id',dispatch_request_id,
      'station_branch_id',station_record.id,
      'driver_profile_id',selected_driver_profile_id,
      'vehicle_id',selected_vehicle_id,
      'capacity_reservation_id',reservation_id,
      'driver_active_orders_before_assignment',selected_active_order_count,
      'concurrent_assignment',selected_active_order_count>0,
      'driver_participation_program_key',selected_program_key,
      'driver_priority_bonus_meters',selected_priority_bonus
    )
  );


  insert into public.dispatch_location_decision_snapshots(
    dispatch_request_id,subject_type,subject_id,service_key,pickup_point,selected_entity_type,selected_entity_id,
    selected_entity_point,matched_coverage_assignment_ids,distance_meters,authority_mode,decision_metadata
  ) values(
    dispatch_request_id,'lpg_order',order_record.id,'lpg',
    extensions.st_setsrid(extensions.st_makepoint(order_record.pickup_longitude,order_record.pickup_latitude),4326)::extensions.geography,
    'DRIVER',selected_driver_profile_id,selected_driver_point,selected_coverage_assignment_ids,selected_driver_distance,geography_authority_mode,
    jsonb_build_object('vehicleId',selected_vehicle_id,'stationBranchId',station_record.id,'candidateCount',candidate_rank,
      'activeOrdersBeforeAssignment',selected_active_order_count,'participationProgramKey',selected_program_key,
      'priorityBonusMeters',selected_priority_bonus,'dispatchPolicyKey',dispatch_policy_key,
      'stationCoverageAssignmentIds',selected_station_coverage_assignment_ids,
      'servicePolicyId',service_resolution->>'matchedPolicyId','serviceGeographyId',service_resolution->>'matchedGeographyId')
  ) on conflict(dispatch_request_id) do nothing;

  return dispatch_request_id;
end;
$$;

commit;
