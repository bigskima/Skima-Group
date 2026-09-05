begin;

-- SKIMA Dispatch Intelligence -- shadow mode.
-- The canonical LPG dispatcher remains the only assignment authority.
-- This runtime reads existing eligible dispatch candidates after canonical dispatch and computes
-- a separate fairness-aware advisory ranking for audit/tuning. It never edits dispatch candidates,
-- dispatch requests, LPG orders, station capacity, driver eligibility, or financial state.

create table if not exists public.ai_dispatch_rules (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  status text not null default 'active'
    check (status in ('draft','active','paused','retired')),
  config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ai_dispatch_run_assessments (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.ai_dispatch_rules(id) on delete restrict,
  dispatch_request_id uuid not null references public.dispatch_requests(id) on delete cascade,
  order_id uuid references public.lpg_refill_orders(id) on delete set null,
  canonical_selected_driver_id uuid references public.driver_profiles(id) on delete set null,
  advisory_selected_driver_id uuid references public.driver_profiles(id) on delete set null,
  candidate_count integer not null default 0 check (candidate_count >= 0),
  selection_agreement boolean,
  control_mode text not null default 'shadow_only'
    check (control_mode = 'shadow_only'),
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  generated_at timestamptz not null default timezone('utc', now()),
  valid_until timestamptz not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (rule_id, dispatch_request_id)
);

create table if not exists public.ai_dispatch_candidate_assessments (
  id uuid primary key default gen_random_uuid(),
  run_assessment_id uuid not null references public.ai_dispatch_run_assessments(id) on delete cascade,
  dispatch_candidate_id uuid not null references public.dispatch_candidates(id) on delete cascade,
  driver_profile_id uuid not null references public.driver_profiles(id) on delete cascade,
  canonical_rank integer,
  canonical_score numeric(14,4),
  canonical_cost numeric(16,4) not null check (canonical_cost >= 0),
  recent_assignment_count integer not null default 0 check (recent_assignment_count >= 0),
  fairness_penalty numeric(16,4) not null default 0 check (fairness_penalty >= 0),
  advisory_cost numeric(16,4) not null check (advisory_cost >= 0),
  advisory_rank integer not null check (advisory_rank > 0),
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (run_assessment_id, dispatch_candidate_id)
);

create index if not exists ai_dispatch_run_assessments_generated_idx
on public.ai_dispatch_run_assessments (generated_at desc);

create index if not exists ai_dispatch_run_assessments_agreement_idx
on public.ai_dispatch_run_assessments (selection_agreement, generated_at desc);

create index if not exists ai_dispatch_candidate_assessments_rank_idx
on public.ai_dispatch_candidate_assessments (run_assessment_id, advisory_rank);

alter table public.ai_dispatch_rules enable row level security;
alter table public.ai_dispatch_run_assessments enable row level security;
alter table public.ai_dispatch_candidate_assessments enable row level security;

drop policy if exists ai_dispatch_rules_read_privileged on public.ai_dispatch_rules;
create policy ai_dispatch_rules_read_privileged
on public.ai_dispatch_rules
for select to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
  or public.has_permission('platform.dispatch.read', null)
  or public.has_permission('platform.dispatch.manage', null)
);

drop policy if exists ai_dispatch_rules_manage_privileged on public.ai_dispatch_rules;
create policy ai_dispatch_rules_manage_privileged
on public.ai_dispatch_rules
for all to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.manage', null)
)
with check (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.manage', null)
);

drop policy if exists ai_dispatch_runs_read_privileged on public.ai_dispatch_run_assessments;
create policy ai_dispatch_runs_read_privileged
on public.ai_dispatch_run_assessments
for select to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
  or public.has_permission('platform.dispatch.read', null)
  or public.has_permission('platform.dispatch.manage', null)
);

drop policy if exists ai_dispatch_candidates_read_privileged on public.ai_dispatch_candidate_assessments;
create policy ai_dispatch_candidates_read_privileged
on public.ai_dispatch_candidate_assessments
for select to authenticated
using (
  exists (
    select 1
    from public.ai_dispatch_run_assessments run
    where run.id = ai_dispatch_candidate_assessments.run_assessment_id
  )
);

drop policy if exists ai_dispatch_runs_no_direct_insert on public.ai_dispatch_run_assessments;
create policy ai_dispatch_runs_no_direct_insert
on public.ai_dispatch_run_assessments
for insert to authenticated with check (false);

drop policy if exists ai_dispatch_runs_no_direct_update on public.ai_dispatch_run_assessments;
create policy ai_dispatch_runs_no_direct_update
on public.ai_dispatch_run_assessments
for update to authenticated using (false) with check (false);

drop policy if exists ai_dispatch_runs_no_direct_delete on public.ai_dispatch_run_assessments;
create policy ai_dispatch_runs_no_direct_delete
on public.ai_dispatch_run_assessments
for delete to authenticated using (false);

drop policy if exists ai_dispatch_candidates_no_direct_insert on public.ai_dispatch_candidate_assessments;
create policy ai_dispatch_candidates_no_direct_insert
on public.ai_dispatch_candidate_assessments
for insert to authenticated with check (false);

drop policy if exists ai_dispatch_candidates_no_direct_update on public.ai_dispatch_candidate_assessments;
create policy ai_dispatch_candidates_no_direct_update
on public.ai_dispatch_candidate_assessments
for update to authenticated using (false) with check (false);

drop policy if exists ai_dispatch_candidates_no_direct_delete on public.ai_dispatch_candidate_assessments;
create policy ai_dispatch_candidates_no_direct_delete
on public.ai_dispatch_candidate_assessments
for delete to authenticated using (false);

grant select, insert, update, delete on public.ai_dispatch_rules to authenticated;
grant select on public.ai_dispatch_run_assessments, public.ai_dispatch_candidate_assessments to authenticated;
grant all on public.ai_dispatch_rules, public.ai_dispatch_run_assessments, public.ai_dispatch_candidate_assessments to service_role;

insert into public.ai_dispatch_rules (
  key, display_name, status, config
)
values (
  'ai.dispatch.lpg.shadow_fairness',
  'LPG dispatch shadow fairness review',
  'active',
  '{
    "control": "shadow_only",
    "lookback_hours": 24,
    "request_limit": 100,
    "valid_minutes": 360,
    "recent_assignment_penalty_meters": 250,
    "maximum_fairness_penalty_meters": 3000,
    "risk_signal": "review_only",
    "risk_does_not_change_rank": true
  }'::jsonb
)
on conflict (key) do update
set display_name = excluded.display_name,
    config = public.ai_dispatch_rules.config || excluded.config,
    updated_at = timezone('utc', now());

create or replace function public.refresh_ai_dispatch_shadow_assessments()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rule_record public.ai_dispatch_rules%rowtype;
  request_record record;
  run_id uuid;
  lookback_hours integer;
  request_limit integer;
  valid_minutes integer;
  recent_assignment_penalty numeric;
  maximum_fairness_penalty numeric;
  canonical_driver_id uuid;
  advisory_driver_id uuid;
  candidate_total integer;
  disagreement_count integer := 0;
  refreshed_count integer := 0;
  now_at timestamptz := timezone('utc', now());
begin
  select *
  into rule_record
  from public.ai_dispatch_rules
  where key = 'ai.dispatch.lpg.shadow_fairness'
    and status = 'active';

  if rule_record.id is null then
    return jsonb_build_object(
      'status', 'skipped',
      'reason', 'dispatch_shadow_rule_inactive',
      'refreshedCount', 0,
      'refreshedAt', now_at,
      'control', 'shadow_only'
    );
  end if;

  lookback_hours := greatest(
    1,
    least(
      168,
      case
        when coalesce(rule_record.config ->> 'lookback_hours', '') ~ '^[0-9]+$'
          then (rule_record.config ->> 'lookback_hours')::integer
        else 24
      end
    )
  );
  request_limit := greatest(
    1,
    least(
      500,
      case
        when coalesce(rule_record.config ->> 'request_limit', '') ~ '^[0-9]+$'
          then (rule_record.config ->> 'request_limit')::integer
        else 100
      end
    )
  );
  valid_minutes := greatest(
    15,
    least(
      1440,
      case
        when coalesce(rule_record.config ->> 'valid_minutes', '') ~ '^[0-9]+$'
          then (rule_record.config ->> 'valid_minutes')::integer
        else 360
      end
    )
  );
  recent_assignment_penalty := greatest(
    0,
    least(
      5000,
      coalesce(
        nullif(rule_record.config ->> 'recent_assignment_penalty_meters', '')::numeric,
        250
      )
    )
  );
  maximum_fairness_penalty := greatest(
    0,
    least(
      20000,
      coalesce(
        nullif(rule_record.config ->> 'maximum_fairness_penalty_meters', '')::numeric,
        3000
      )
    )
  );

  for request_record in
    select
      request.id,
      request.subject_id as order_id,
      request.assigned_entity_id as canonical_selected_driver_id,
      request.created_at
    from public.dispatch_requests request
    where request.subject_type = 'lpg_order'
      and request.assigned_entity_type = 'driver'
      and request.assigned_entity_id is not null
      and request.created_at >= now_at - make_interval(hours => lookback_hours)
      and exists (
        select 1
        from public.dispatch_candidates candidate
        where candidate.dispatch_request_id = request.id
          and candidate.candidate_entity_type = 'driver'
      )
    order by request.created_at desc
    limit request_limit
  loop
    canonical_driver_id := request_record.canonical_selected_driver_id;

    insert into public.ai_dispatch_run_assessments (
      rule_id,
      dispatch_request_id,
      order_id,
      canonical_selected_driver_id,
      advisory_selected_driver_id,
      candidate_count,
      selection_agreement,
      control_mode,
      evidence,
      generated_at,
      valid_until,
      version
    )
    values (
      rule_record.id,
      request_record.id,
      request_record.order_id,
      canonical_driver_id,
      null,
      0,
      null,
      'shadow_only',
      jsonb_build_object(
        'shadowOnly', true,
        'canonicalDispatchRemainsAuthoritative', true,
        'fairnessWindowHours', lookback_hours,
        'recentAssignmentPenaltyMeters', recent_assignment_penalty,
        'maximumFairnessPenaltyMeters', maximum_fairness_penalty,
        'riskSignalMode', 'review_only',
        'riskDoesNotChangeRank', true
      ),
      now_at,
      now_at + make_interval(mins => valid_minutes),
      1
    )
    on conflict (rule_id, dispatch_request_id)
    do update set
      order_id = excluded.order_id,
      canonical_selected_driver_id = excluded.canonical_selected_driver_id,
      advisory_selected_driver_id = null,
      candidate_count = 0,
      selection_agreement = null,
      control_mode = 'shadow_only',
      evidence = excluded.evidence,
      generated_at = excluded.generated_at,
      valid_until = excluded.valid_until,
      version = public.ai_dispatch_run_assessments.version + 1,
      updated_at = timezone('utc', now())
    returning id into run_id;

    delete from public.ai_dispatch_candidate_assessments
    where run_assessment_id = run_id;

    insert into public.ai_dispatch_candidate_assessments (
      run_assessment_id,
      dispatch_candidate_id,
      driver_profile_id,
      canonical_rank,
      canonical_score,
      canonical_cost,
      recent_assignment_count,
      fairness_penalty,
      advisory_cost,
      advisory_rank,
      evidence
    )
    select
      run_id,
      ranked.dispatch_candidate_id,
      ranked.driver_profile_id,
      ranked.canonical_rank,
      ranked.canonical_score,
      ranked.canonical_cost,
      ranked.recent_assignment_count,
      ranked.fairness_penalty,
      ranked.advisory_cost,
      ranked.advisory_rank,
      jsonb_build_object(
        'shadowOnly', true,
        'canonicalRationale', ranked.canonical_rationale,
        'recentAssignmentsInWindow', ranked.recent_assignment_count,
        'fairnessPenaltyMeters', ranked.fairness_penalty,
        'canonicalCost', ranked.canonical_cost,
        'advisoryCost', ranked.advisory_cost,
        'riskReview', case
          when ranked.risk_level is null then null
          else jsonb_build_object(
            'level', ranked.risk_level,
            'score', ranked.risk_score,
            'rankingEffect', 'none',
            'reason', 'Risk is review-only in shadow dispatch.'
          )
        end,
        'doesNotChangeCandidateEligibility', true,
        'doesNotChangeCanonicalRank', true,
        'doesNotAssignDriver', true
      )
    from (
      select
        scored.*,
        row_number() over (
          order by scored.advisory_cost asc,
                   scored.canonical_rank asc nulls last,
                   scored.driver_profile_id asc
        )::integer as advisory_rank
      from (
        select
          candidate.id as dispatch_candidate_id,
          candidate.candidate_entity_id as driver_profile_id,
          candidate.rank as canonical_rank,
          candidate.score as canonical_score,
          coalesce(
            nullif(candidate.rationale ->> 'dispatch_cost', '')::numeric,
            greatest(1000000 - candidate.score, 0)
          ) as canonical_cost,
          candidate.rationale as canonical_rationale,
          assignment_history.recent_assignment_count,
          least(
            assignment_history.recent_assignment_count * recent_assignment_penalty,
            maximum_fairness_penalty
          ) as fairness_penalty,
          greatest(
            coalesce(
              nullif(candidate.rationale ->> 'dispatch_cost', '')::numeric,
              greatest(1000000 - candidate.score, 0)
            )
            + least(
              assignment_history.recent_assignment_count * recent_assignment_penalty,
              maximum_fairness_penalty
            ),
            0
          ) as advisory_cost,
          risk.risk_level,
          risk.score as risk_score
        from public.dispatch_candidates candidate
        join lateral (
          select count(*)::integer as recent_assignment_count
          from public.dispatch_requests history
          where history.subject_type = 'lpg_order'
            and history.assigned_entity_type = 'driver'
            and history.assigned_entity_id = candidate.candidate_entity_id
            and history.id <> request_record.id
            and history.created_at >= now_at - make_interval(hours => lookback_hours)
        ) assignment_history on true
        left join lateral (
          select assessment.risk_level, assessment.score
          from public.ai_risk_assessments assessment
          where assessment.subject_type = 'driver'
            and assessment.subject_id = candidate.candidate_entity_id
          order by assessment.generated_at desc
          limit 1
        ) risk on true
        where candidate.dispatch_request_id = request_record.id
          and candidate.candidate_entity_type = 'driver'
      ) scored
    ) ranked;

    select count(*)::integer
    into candidate_total
    from public.ai_dispatch_candidate_assessments candidate_assessment
    where candidate_assessment.run_assessment_id = run_id;

    select candidate_assessment.driver_profile_id
    into advisory_driver_id
    from public.ai_dispatch_candidate_assessments candidate_assessment
    where candidate_assessment.run_assessment_id = run_id
      and candidate_assessment.advisory_rank = 1
    limit 1;

    update public.ai_dispatch_run_assessments
    set advisory_selected_driver_id = advisory_driver_id,
        candidate_count = candidate_total,
        selection_agreement = (
          advisory_driver_id is not null
          and canonical_driver_id = advisory_driver_id
        ),
        evidence = evidence || jsonb_build_object(
          'candidateCount', candidate_total,
          'canonicalSelectedDriverId', canonical_driver_id,
          'advisorySelectedDriverId', advisory_driver_id,
          'selectionAgreement',
            advisory_driver_id is not null and canonical_driver_id = advisory_driver_id
        ),
        updated_at = timezone('utc', now())
    where id = run_id;

    if advisory_driver_id is distinct from canonical_driver_id then
      disagreement_count := disagreement_count + 1;
    end if;

    refreshed_count := refreshed_count + 1;
  end loop;

  return jsonb_build_object(
    'status', 'completed',
    'refreshedCount', refreshed_count,
    'disagreementCount', disagreement_count,
    'refreshedAt', now_at,
    'control', 'shadow_only'
  );
end;
$$;

revoke all on function public.refresh_ai_dispatch_shadow_assessments()
from public, anon, authenticated;
grant execute on function public.refresh_ai_dispatch_shadow_assessments()
to service_role;

create or replace function public.read_ai_dispatch_shadow_assessments(
  target_disagreement_only boolean default false,
  target_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if not (
    public.is_platform_super_admin()
    or public.has_permission('platform.ai.read', null)
    or public.has_permission('platform.ai.manage', null)
    or public.has_permission('platform.dispatch.read', null)
    or public.has_permission('platform.dispatch.manage', null)
  ) then
    raise exception using errcode = '42501', message = 'dispatch intelligence read permission is required';
  end if;

  select coalesce(
    jsonb_agg(row_data order by generated_at desc),
    '[]'::jsonb
  )
  into result
  from (
    select
      run.generated_at,
      jsonb_build_object(
        'id', run.id,
        'dispatchRequestId', run.dispatch_request_id,
        'orderId', run.order_id,
        'canonicalSelectedDriverId', run.canonical_selected_driver_id,
        'advisorySelectedDriverId', run.advisory_selected_driver_id,
        'candidateCount', run.candidate_count,
        'selectionAgreement', run.selection_agreement,
        'controlMode', run.control_mode,
        'evidence', run.evidence,
        'generatedAt', run.generated_at,
        'validUntil', run.valid_until,
        'version', run.version,
        'candidates', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'driverProfileId', candidate.driver_profile_id,
              'canonicalRank', candidate.canonical_rank,
              'canonicalScore', candidate.canonical_score,
              'canonicalCost', candidate.canonical_cost,
              'recentAssignmentCount', candidate.recent_assignment_count,
              'fairnessPenalty', candidate.fairness_penalty,
              'advisoryCost', candidate.advisory_cost,
              'advisoryRank', candidate.advisory_rank,
              'evidence', candidate.evidence
            )
            order by candidate.advisory_rank
          )
          from public.ai_dispatch_candidate_assessments candidate
          where candidate.run_assessment_id = run.id
        ), '[]'::jsonb)
      ) as row_data
    from public.ai_dispatch_run_assessments run
    where (
      not coalesce(target_disagreement_only, false)
      or run.selection_agreement = false
    )
    order by run.generated_at desc
    limit least(greatest(coalesce(target_limit, 50), 1), 250)
  ) recent;

  return result;
end;
$$;

revoke all on function public.read_ai_dispatch_shadow_assessments(boolean,integer)
from public, anon;
grant execute on function public.read_ai_dispatch_shadow_assessments(boolean,integer)
to authenticated, service_role;

commit;
