begin;

insert into public.location_runtime_controls(key,mode,configuration)
values('location.production_readiness','preparing',jsonb_build_object(
  'driverLocationFreshnessSeconds',300,'blockOnUnmappedCoordinates',false,
  'blockOnLegacyDispatchSnapshots',false,'requiredRetentionPolicyCount',2
)) on conflict(key) do nothing;

create or replace function public.read_location_platform_production_readiness()
returns jsonb language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
declare config jsonb; retention jsonb; dispatch_incomplete bigint; conflicts bigint; uncovered_drivers bigint; uncovered_stations bigint;
  stale_drivers bigint; unmapped bigint; alerts jsonb:='[]'::jsonb; ready boolean; freshness integer; block_unmapped boolean; block_legacy boolean;
begin
  if coalesce(auth.role(),'')<>'service_role' and not public.has_permission('platform.coverage.read',null)
     and not public.has_permission('platform.geography.read',null) then raise exception using errcode='42501',message='location readiness permission required'; end if;
  select controls.configuration into config from public.location_runtime_controls controls where controls.key='location.production_readiness';
  config:=coalesce(config,'{}'::jsonb); freshness:=coalesce((config->>'driverLocationFreshnessSeconds')::integer,300);
  block_unmapped:=coalesce((config->>'blockOnUnmappedCoordinates')::boolean,false); block_legacy:=coalesce((config->>'blockOnLegacyDispatchSnapshots')::boolean,false);
  select jsonb_build_object('healthy',failed=0 and active_policies>=coalesce((config->>'requiredRetentionPolicyCount')::integer,2)
      and queued+running>0 and (last_completed is null or last_completed>=timezone('utc',now())-interval '48 hours'),
    'activePolicies',active_policies,'lastCompletedAt',last_completed,'queuedJobs',queued,'runningJobs',running,'failedJobs',failed)
  into retention from (select (select count(*) from public.location_retention_policies where status='active') active_policies,
    (select max(completed_at) from public.location_retention_runs where status='completed') last_completed,
    (select count(*) from public.background_jobs where job_type_key='platform.location_retention.run' and status='queued') queued,
    (select count(*) from public.background_jobs where job_type_key='platform.location_retention.run' and status='running') running,
    (select count(*) from public.background_jobs where job_type_key='platform.location_retention.run' and status='failed') failed) metrics;
  select count(*) into dispatch_incomplete from public.dispatch_location_decision_snapshots snapshot
    where snapshot.service_policy_snapshot->>'provenance'='legacy_snapshot_unavailable'
      or jsonb_array_length(snapshot.coverage_assignment_snapshots)=0 or jsonb_array_length(snapshot.candidate_decision_snapshots)=0;
  select count(*) into conflicts from(
    select least(a.id,b.id),greatest(a.id,b.id) from public.service_coverage_policies a
    join public.geographies ga on ga.id=a.target_geography_id join public.geography_levels la on la.id=ga.geography_level_id
    join public.service_coverage_policies b on b.id>a.id and b.service_key=a.service_key and b.capability_key=a.capability_key
      and b.priority=a.priority and b.status='active'
    join public.geographies gb on gb.id=b.target_geography_id join public.geography_levels lb on lb.id=gb.geography_level_id
    where a.status='active' and la.specificity_rank=lb.specificity_rank
      and (a.ends_at is null or b.starts_at is null or a.ends_at>b.starts_at) and (b.ends_at is null or a.starts_at is null or b.ends_at>a.starts_at)
      and extensions.st_intersects(ga.boundary_geometry,gb.boundary_geometry)
  ) unresolved;
  select count(*) into uncovered_drivers from public.driver_profiles driver where driver.verification_status='approved' and not exists(
    select 1 from public.operational_coverage_assignments coverage where coverage.entity_type='DRIVER' and coverage.entity_id=driver.id
      and coverage.status in('approved','active') and coverage.approved_at is not null);
  select count(*) into uncovered_stations from public.lpg_station_branches station where station.approval_status='approved' and not exists(
    select 1 from public.operational_coverage_assignments coverage where coverage.entity_type='STATION' and coverage.entity_id=station.id
      and coverage.status in('approved','active') and coverage.approved_at is not null);
  select count(*) into stale_drivers from public.driver_profiles driver where driver.verification_status='approved' and driver.operational_status in('available','busy')
    and not exists(select 1 from public.driver_location_state state where state.driver_id=driver.id and state.status='available'
      and state.captured_at>=timezone('utc',now())-make_interval(secs=>freshness));
  select count(*) into unmapped from public.locations location where not exists(select 1 from public.geographies geography
    where geography.status='active' and geography.boundary_geometry is not null and extensions.st_covers(geography.boundary_geometry,location.point));
  if not coalesce((retention->>'healthy')::boolean,false) then alerts:=alerts||jsonb_build_array(jsonb_build_object('code','RETENTION_UNHEALTHY','severity','BLOCKER')); end if;
  if conflicts>0 then alerts:=alerts||jsonb_build_array(jsonb_build_object('code','POLICY_CONFLICTS','severity','BLOCKER','count',conflicts)); end if;
  if uncovered_drivers+uncovered_stations>0 then alerts:=alerts||jsonb_build_array(jsonb_build_object('code','APPROVED_ENTITIES_WITHOUT_COVERAGE','severity','BLOCKER','count',uncovered_drivers+uncovered_stations)); end if;
  if stale_drivers>0 then alerts:=alerts||jsonb_build_array(jsonb_build_object('code','STALE_LIVE_DRIVER_STATE','severity','WARNING','count',stale_drivers)); end if;
  if unmapped>0 then alerts:=alerts||jsonb_build_array(jsonb_build_object('code','UNMAPPED_CANONICAL_COORDINATES','severity',case when block_unmapped then 'BLOCKER' else 'WARNING' end,'count',unmapped)); end if;
  if dispatch_incomplete>0 then alerts:=alerts||jsonb_build_array(jsonb_build_object('code','INCOMPLETE_DISPATCH_SNAPSHOTS','severity',case when block_legacy then 'BLOCKER' else 'WARNING' end,'count',dispatch_incomplete)); end if;
  ready:=not exists(select 1 from jsonb_array_elements(alerts) alert where alert->>'severity'='BLOCKER');
  return jsonb_build_object('ready',ready,'checkedAt',timezone('utc',now()),'configuration',config,'alerts',alerts,'metrics',jsonb_build_object(
    'retention',retention,'incompleteDispatchSnapshots',dispatch_incomplete,'unresolvedPolicyConflicts',conflicts,
    'approvedDriversWithoutCoverage',uncovered_drivers,'approvedStationsWithoutCoverage',uncovered_stations,
    'staleLiveDrivers',stale_drivers,'unmappedCanonicalCoordinates',unmapped));
end $$;

create or replace function public.read_recoverable_geometry_drafts(p_limit integer default 100)
returns table(id uuid,draft_type text,target_id uuid,parent_geography_id uuid,status text,geometry_geojson jsonb,validation_snapshot jsonb,created_at timestamptz,updated_at timestamptz)
language sql stable security definer set search_path=public,extensions,pg_temp as $$
  select draft.id,draft.draft_type,draft.target_id,draft.parent_geography_id,draft.status,
    extensions.st_asgeojson(draft.geometry::extensions.geometry,6)::jsonb,draft.validation_snapshot,draft.created_at,draft.updated_at
  from public.coverage_geometry_drafts draft where (draft.created_by=auth.uid() or public.has_permission('platform.coverage.manage',null)
    or coalesce(auth.role(),'')='service_role') and draft.status in('DRAFT','PREVIEWED')
  order by draft.updated_at desc,draft.id limit greatest(1,least(coalesce(p_limit,100),500));
$$;
create or replace function public.abandon_coverage_geometry_draft(p_draft_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if nullif(btrim(p_reason),'') is null then raise exception using errcode='22023',message='abandonment reason required'; end if;
  update public.coverage_geometry_drafts set status='ABANDONED',activation_reason=btrim(p_reason),updated_by=auth.uid()
  where id=p_draft_id and status in('DRAFT','PREVIEWED') and (created_by=auth.uid() or public.has_permission('platform.coverage.manage',null) or coalesce(auth.role(),'')='service_role');
  if not found then raise exception using errcode='P0002',message='recoverable geometry draft not found'; end if;
end $$;

revoke all on function public.read_location_platform_production_readiness() from public,anon;
revoke all on function public.read_recoverable_geometry_drafts(integer) from public,anon;
revoke all on function public.abandon_coverage_geometry_draft(uuid,text) from public,anon;
grant execute on function public.read_location_platform_production_readiness() to authenticated,service_role;
grant execute on function public.read_recoverable_geometry_drafts(integer) to authenticated,service_role;
grant execute on function public.abandon_coverage_geometry_draft(uuid,text) to authenticated,service_role;

commit;
