begin;

insert into public.location_retention_policies(key,sample_source,retention_days,preserve_linked_records,status,configuration)
values('coverage.geometry_drafts','coverage_geometry_drafts',30,true,'active',jsonb_build_object('batchSize',1000,'eligibleStatuses',jsonb_build_array('DRAFT','PREVIEWED')))
on conflict(key) do nothing;

create table public.location_retention_runs(
  id uuid primary key default gen_random_uuid(),
  job_key text not null,
  policy_snapshot jsonb not null check(jsonb_typeof(policy_snapshot)='object'),
  deleted_counts jsonb not null check(jsonb_typeof(deleted_counts)='object'),
  status text not null check(status in('completed','skipped')),
  started_at timestamptz not null,
  completed_at timestamptz not null,
  created_at timestamptz not null default timezone('utc',now()),
  check(completed_at>=started_at)
);
create index location_retention_runs_time_idx on public.location_retention_runs(created_at desc);
alter table public.location_retention_runs enable row level security;
revoke all on public.location_retention_runs from public,anon,authenticated;
grant select on public.location_retention_runs to authenticated;
grant all on public.location_retention_runs to service_role;
create policy location_retention_runs_read on public.location_retention_runs for select to authenticated
using(public.has_permission('platform.tracking.manage',null) or public.has_permission('platform.coverage.manage',null));
create trigger protect_location_retention_runs before update or delete on public.location_retention_runs
for each row execute function public.prevent_immutable_location_evidence_mutation();

create or replace function public.purge_expired_coverage_geometry_drafts(p_limit integer default 1000)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare deleted_count integer; policy record; configured_limit integer;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='service authority required'; end if;
  if p_limit not between 1 and 10000 then raise exception using errcode='22023',message='purge limit must be between 1 and 10000'; end if;
  select * into policy from public.location_retention_policies where key='coverage.geometry_drafts' and status='active';
  if not found then return 0; end if;
  configured_limit:=least(p_limit,coalesce((policy.configuration->>'batchSize')::integer,p_limit));
  delete from public.coverage_geometry_drafts draft where draft.id in(
    select candidate.id from public.coverage_geometry_drafts candidate
    where candidate.status in('DRAFT','PREVIEWED')
      and candidate.updated_at<timezone('utc',now())-make_interval(days=>policy.retention_days)
    order by candidate.updated_at,candidate.id limit configured_limit
  );
  get diagnostics deleted_count=row_count;
  return deleted_count;
end $$;

create or replace function public.run_location_retention(p_limit integer default 5000)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare started timestamptz:=clock_timestamp(); samples integer; drafts integer; policies jsonb; run_id uuid;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='service authority required'; end if;
  select coalesce(jsonb_agg(to_jsonb(policy) order by policy.key),'[]'::jsonb) into policies
  from public.location_retention_policies policy where policy.status='active';
  samples:=public.purge_expired_driver_location_samples(least(p_limit,50000));
  drafts:=public.purge_expired_coverage_geometry_drafts(least(p_limit,10000));
  insert into public.location_retention_runs(job_key,policy_snapshot,deleted_counts,status,started_at,completed_at)
  values('platform.location_retention.run',jsonb_build_object('policies',policies),
    jsonb_build_object('driverLocationSamples',samples,'geometryDrafts',drafts),'completed',started,clock_timestamp()) returning id into run_id;
  return jsonb_build_object('runId',run_id,'driverLocationSamples',samples,'geometryDrafts',drafts);
end $$;

create or replace function public.read_location_retention_health()
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  with metrics as(select
    (select count(*) from public.location_retention_policies where status='active') active_policies,
    (select max(completed_at) from public.location_retention_runs where status='completed') last_completed,
    (select count(*) from public.background_jobs where job_type_key='platform.location_retention.run' and status='queued') queued,
    (select count(*) from public.background_jobs where job_type_key='platform.location_retention.run' and status='running') running,
    (select count(*) from public.background_jobs where job_type_key='platform.location_retention.run' and status='failed') failed)
  select jsonb_build_object(
    'healthy',failed=0 and active_policies>=2 and queued+running>0 and (last_completed is null or last_completed>=timezone('utc',now())-interval '48 hours'),
    'activePolicies',active_policies,
    'lastCompletedAt',last_completed,
    'lastDeletedCounts',(select deleted_counts from public.location_retention_runs where status='completed' order by completed_at desc limit 1),
    'queuedJobs',queued,'runningJobs',running,'failedJobs',failed,
    'overdue',coalesce(last_completed<timezone('utc',now())-interval '48 hours',false)
  ) from metrics where coalesce(auth.role(),'')='service_role' or public.has_permission('platform.tracking.manage',null) or public.has_permission('platform.coverage.manage',null);
$$;

revoke all on function public.purge_expired_coverage_geometry_drafts(integer) from public,anon,authenticated;
revoke all on function public.run_location_retention(integer) from public,anon,authenticated;
revoke all on function public.read_location_retention_health() from public,anon;
grant execute on function public.purge_expired_coverage_geometry_drafts(integer) to service_role;
grant execute on function public.run_location_retention(integer) to service_role;
grant execute on function public.read_location_retention_health() to authenticated,service_role;

insert into public.job_queues(key,status,concurrency_limit,retry_policy)
values('platform.location_retention','active',1,jsonb_build_object('maxAttempts',3,'backoffSeconds',300))
on conflict(key) do nothing;
insert into public.background_jobs(queue_id,job_type_key,status,payload,attempts,max_attempts,run_at,source,idempotency_key)
select queue.id,'platform.location_retention.run','queued',jsonb_build_object('limit',5000,'intervalHours',24),0,3,
  timezone('utc',now())+interval '5 minutes','platform.location_retention.scheduler','location-retention:bootstrap'
from public.job_queues queue where queue.key='platform.location_retention'
on conflict(source,idempotency_key) where idempotency_key is not null do nothing;

commit;
