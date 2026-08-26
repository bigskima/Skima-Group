begin;

alter table public.dispatch_location_decision_snapshots
  add column if not exists service_policy_snapshot jsonb not null default '{"provenance":"legacy_snapshot_unavailable"}'::jsonb,
  add column if not exists coverage_assignment_snapshots jsonb not null default '[]'::jsonb,
  add column if not exists candidate_decision_snapshots jsonb not null default '[]'::jsonb;

create or replace function public.enrich_dispatch_location_decision_snapshot()
returns trigger language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare policy_id uuid; all_coverage_ids uuid[]; station_ids uuid[];
begin
  policy_id:=nullif(new.decision_metadata->>'servicePolicyId','')::uuid;
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into station_ids
  from jsonb_array_elements_text(coalesce(new.decision_metadata->'stationCoverageAssignmentIds','[]'::jsonb)) value;
  all_coverage_ids:=new.matched_coverage_assignment_ids||station_ids;
  select case when policy.id is null then jsonb_build_object('policyId',policy_id,'provenance','policy_not_found_at_decision') else jsonb_build_object('id',policy.id,'serviceKey',policy.service_key,'capabilityKey',policy.capability_key,
    'effect',policy.effect,'priority',policy.priority,'status',policy.status,'startsAt',policy.starts_at,'endsAt',policy.ends_at,
    'configuration',policy.configuration,'geography',jsonb_build_object('id',geography.id,'name',geography.canonical_name,
      'levelKey',level.key,'specificity',level.specificity_rank,
      'boundaryGeoJSON',extensions.st_asgeojson(geography.boundary_geometry::extensions.geometry,6)::jsonb)) end
  into new.service_policy_snapshot from (select 1) source left join public.service_coverage_policies policy on policy.id=policy_id
    left join public.geographies geography on geography.id=policy.target_geography_id
    left join public.geography_levels level on level.id=geography.geography_level_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',assignment.id,'entityType',assignment.entity_type,'entityId',assignment.entity_id,
    'serviceKey',assignment.service_key,'coverageType',assignment.coverage_type,'geographyId',assignment.geography_id,
    'centerGeoJSON',case when assignment.center_point is null then null else extensions.st_asgeojson(assignment.center_point::extensions.geometry,6)::jsonb end,
    'radiusMeters',assignment.radius_meters,'coverageGeoJSON',case when assignment.coverage_geometry is null then null else extensions.st_asgeojson(assignment.coverage_geometry::extensions.geometry,6)::jsonb end,
    'status',assignment.status,'validFrom',assignment.valid_from,'validTo',assignment.valid_to,'approvedAt',assignment.approved_at,
    'metadata',assignment.metadata) order by assignment.id),'[]'::jsonb) into new.coverage_assignment_snapshots
  from public.operational_coverage_assignments assignment where assignment.id=any(all_coverage_ids);
  select coalesce(jsonb_agg(jsonb_build_object('id',candidate.id,'entityType',candidate.candidate_entity_type,
    'entityId',candidate.candidate_entity_id,'score',candidate.score,'rank',candidate.rank,'status',candidate.status,
    'rationale',candidate.rationale,'createdAt',candidate.created_at) order by candidate.rank nulls last,candidate.id),'[]'::jsonb)
  into new.candidate_decision_snapshots from public.dispatch_candidates candidate where candidate.dispatch_request_id=new.dispatch_request_id;
  new.decision_metadata:=new.decision_metadata||jsonb_build_object('snapshotSchemaVersion',1,'coverageSnapshotCount',jsonb_array_length(new.coverage_assignment_snapshots),
    'candidateSnapshotCount',jsonb_array_length(new.candidate_decision_snapshots));
  return new;
end $$;
create trigger enrich_dispatch_location_decision_before_insert before insert on public.dispatch_location_decision_snapshots
for each row execute function public.enrich_dispatch_location_decision_snapshot();

create or replace function public.read_dispatch_location_diagnostics(
  p_dispatch_request_id uuid default null,p_subject_type text default null,p_subject_id uuid default null,p_limit integer default 100
) returns table(id uuid,dispatch_request_id uuid,subject_type text,subject_id uuid,service_key text,pickup_geojson jsonb,
  selected_entity_type text,selected_entity_id uuid,selected_entity_geojson jsonb,distance_meters numeric,authority_mode text,
  service_policy_snapshot jsonb,coverage_assignment_snapshots jsonb,candidate_decision_snapshots jsonb,decision_metadata jsonb,decided_at timestamptz)
language sql stable security definer set search_path=public,extensions,pg_temp as $$
  select snapshot.id,snapshot.dispatch_request_id,snapshot.subject_type,snapshot.subject_id,snapshot.service_key,
    extensions.st_asgeojson(snapshot.pickup_point::extensions.geometry,6)::jsonb,snapshot.selected_entity_type,snapshot.selected_entity_id,
    extensions.st_asgeojson(snapshot.selected_entity_point::extensions.geometry,6)::jsonb,snapshot.distance_meters,snapshot.authority_mode,
    snapshot.service_policy_snapshot,snapshot.coverage_assignment_snapshots,snapshot.candidate_decision_snapshots,
    snapshot.decision_metadata,snapshot.decided_at from public.dispatch_location_decision_snapshots snapshot
  where (public.has_permission('platform.dispatch.read',null) or public.has_permission('platform.dispatch.manage',null) or coalesce(auth.role(),'')='service_role')
    and (p_dispatch_request_id is null or snapshot.dispatch_request_id=p_dispatch_request_id)
    and (p_subject_type is null or snapshot.subject_type=p_subject_type)
    and (p_subject_id is null or snapshot.subject_id=p_subject_id)
  order by snapshot.decided_at desc,snapshot.id limit greatest(1,least(coalesce(p_limit,100),500));
$$;

revoke all on function public.enrich_dispatch_location_decision_snapshot() from public,anon,authenticated;
revoke all on function public.read_dispatch_location_diagnostics(uuid,text,uuid,integer) from public,anon;
grant execute on function public.read_dispatch_location_diagnostics(uuid,text,uuid,integer) to authenticated,service_role;

commit;
