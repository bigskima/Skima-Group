begin;

-- SKIMA Trust & Risk Intelligence.
-- Internal advisory signal only. This runtime MUST NOT suspend accounts, hold funds,
-- alter dispatch eligibility, change permissions, rewrite reputation, or mutate workflow state.

create table if not exists public.ai_risk_rules (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  subject_type text not null check (subject_type in ('driver','station')),
  status text not null default 'active'
    check (status in ('draft','active','paused','retired')),
  config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ai_risk_assessments (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.ai_risk_rules(id) on delete restrict,
  subject_type text not null check (subject_type in ('driver','station')),
  subject_id uuid not null,
  score numeric(6,2) not null check (score between 0 and 100),
  risk_level text not null check (risk_level in ('low','medium','high','critical')),
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  recommended_action text,
  generated_at timestamptz not null default timezone('utc', now()),
  valid_until timestamptz not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (rule_id, subject_type, subject_id)
);

create index if not exists ai_risk_assessments_level_idx
on public.ai_risk_assessments (risk_level, score desc, generated_at desc);

create index if not exists ai_risk_assessments_subject_idx
on public.ai_risk_assessments (subject_type, subject_id);

alter table public.ai_risk_rules enable row level security;
alter table public.ai_risk_assessments enable row level security;

drop policy if exists ai_risk_rules_read_privileged on public.ai_risk_rules;
create policy ai_risk_rules_read_privileged
on public.ai_risk_rules
for select to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
);

drop policy if exists ai_risk_rules_manage_privileged on public.ai_risk_rules;
create policy ai_risk_rules_manage_privileged
on public.ai_risk_rules
for all to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.manage', null)
)
with check (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.manage', null)
);

drop policy if exists ai_risk_assessments_read_privileged on public.ai_risk_assessments;
create policy ai_risk_assessments_read_privileged
on public.ai_risk_assessments
for select to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
);

drop policy if exists ai_risk_assessments_no_direct_insert on public.ai_risk_assessments;
create policy ai_risk_assessments_no_direct_insert
on public.ai_risk_assessments
for insert to authenticated
with check (false);

drop policy if exists ai_risk_assessments_no_direct_update on public.ai_risk_assessments;
create policy ai_risk_assessments_no_direct_update
on public.ai_risk_assessments
for update to authenticated
using (false)
with check (false);

drop policy if exists ai_risk_assessments_no_direct_delete on public.ai_risk_assessments;
create policy ai_risk_assessments_no_direct_delete
on public.ai_risk_assessments
for delete to authenticated
using (false);

grant select, insert, update, delete on public.ai_risk_rules to authenticated;
grant select on public.ai_risk_assessments to authenticated;
grant all on public.ai_risk_rules, public.ai_risk_assessments to service_role;

insert into public.ai_risk_rules (
  key, display_name, subject_type, status, config
)
values
  (
    'ai.risk.lpg.driver.trust',
    'Driver trust review',
    'driver',
    'active',
    '{
      "lookback_days": 90,
      "valid_minutes": 360,
      "weights": {
        "standard_open_complaint": 4,
        "high_open_complaint": 12,
        "critical_open_complaint": 25,
        "fraud_open_complaint": 20,
        "safety_open_complaint": 12,
        "conduct_open_complaint": 8,
        "disputed_order": 8,
        "complaint_rate_max": 20
      },
      "thresholds": {
        "medium": 20,
        "high": 45,
        "critical": 70
      },
      "minimum_orders_for_rate": 5,
      "control": "advisory_only"
    }'::jsonb
  ),
  (
    'ai.risk.lpg.station.trust',
    'Station trust review',
    'station',
    'active',
    '{
      "lookback_days": 90,
      "valid_minutes": 360,
      "weights": {
        "standard_open_complaint": 4,
        "high_open_complaint": 12,
        "critical_open_complaint": 25,
        "fraud_open_complaint": 20,
        "safety_open_complaint": 12,
        "underfill_open_complaint": 10,
        "disputed_order": 8,
        "complaint_rate_max": 20
      },
      "thresholds": {
        "medium": 20,
        "high": 45,
        "critical": 70
      },
      "minimum_orders_for_rate": 5,
      "control": "advisory_only"
    }'::jsonb
  )
on conflict (key) do update
set display_name = excluded.display_name,
    subject_type = excluded.subject_type,
    config = public.ai_risk_rules.config || excluded.config,
    updated_at = timezone('utc', now());

create or replace function public.refresh_ai_partner_risk_assessments()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rule_record public.ai_risk_rules%rowtype;
  subject_record record;
  lookback_days integer;
  valid_minutes integer;
  minimum_orders_for_rate integer;
  medium_threshold numeric;
  high_threshold numeric;
  critical_threshold numeric;
  standard_weight numeric;
  high_weight numeric;
  critical_weight numeric;
  fraud_weight numeric;
  safety_weight numeric;
  conduct_weight numeric;
  underfill_weight numeric;
  disputed_weight numeric;
  complaint_rate_max numeric;
  recent_orders integer;
  disputed_orders integer;
  standard_open integer;
  high_open integer;
  critical_open integer;
  fraud_open integer;
  safety_open integer;
  conduct_open integer;
  underfill_open integer;
  open_total integer;
  complaint_rate_component numeric;
  score_value numeric;
  level_value text;
  recommendation text;
  refreshed_count integer := 0;
  now_at timestamptz := timezone('utc', now());
begin
  for rule_record in
    select *
    from public.ai_risk_rules
    where status = 'active'
      and subject_type in ('driver','station')
    order by key
  loop
    lookback_days := greatest(
      7,
      least(
        365,
        case
          when coalesce(rule_record.config ->> 'lookback_days', '') ~ '^[0-9]+$'
            then (rule_record.config ->> 'lookback_days')::integer
          else 90
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
    minimum_orders_for_rate := greatest(
      1,
      case
        when coalesce(rule_record.config ->> 'minimum_orders_for_rate', '') ~ '^[0-9]+$'
          then (rule_record.config ->> 'minimum_orders_for_rate')::integer
        else 5
      end
    );

    medium_threshold := coalesce((rule_record.config #>> '{thresholds,medium}')::numeric, 20);
    high_threshold := coalesce((rule_record.config #>> '{thresholds,high}')::numeric, 45);
    critical_threshold := coalesce((rule_record.config #>> '{thresholds,critical}')::numeric, 70);

    standard_weight := coalesce((rule_record.config #>> '{weights,standard_open_complaint}')::numeric, 4);
    high_weight := coalesce((rule_record.config #>> '{weights,high_open_complaint}')::numeric, 12);
    critical_weight := coalesce((rule_record.config #>> '{weights,critical_open_complaint}')::numeric, 25);
    fraud_weight := coalesce((rule_record.config #>> '{weights,fraud_open_complaint}')::numeric, 20);
    safety_weight := coalesce((rule_record.config #>> '{weights,safety_open_complaint}')::numeric, 12);
    conduct_weight := coalesce((rule_record.config #>> '{weights,conduct_open_complaint}')::numeric, 0);
    underfill_weight := coalesce((rule_record.config #>> '{weights,underfill_open_complaint}')::numeric, 0);
    disputed_weight := coalesce((rule_record.config #>> '{weights,disputed_order}')::numeric, 8);
    complaint_rate_max := coalesce((rule_record.config #>> '{weights,complaint_rate_max}')::numeric, 20);

    for subject_record in
      select subject.id, subject.display_name
      from (
        select
          driver.id,
          coalesce(profile.display_name, 'Driver') as display_name
        from public.driver_profiles driver
        left join public.profiles profile on profile.id = driver.user_id
        where rule_record.subject_type = 'driver'
          and driver.verification_status = 'approved'
        union all
        select
          station.id,
          coalesce(station.display_name, 'Station') as display_name
        from public.lpg_station_branches station
        where rule_record.subject_type = 'station'
          and station.approval_status = 'approved'
      ) subject
    loop
      if rule_record.subject_type = 'driver' then
        select
          count(*)::integer,
          count(*) filter (where orders.status = 'disputed')::integer
        into recent_orders, disputed_orders
        from public.lpg_refill_orders orders
        where orders.driver_profile_id = subject_record.id
          and orders.created_at >= now_at - make_interval(days => lookback_days);

        select
          count(*) filter (where complaint.severity = 'standard')::integer,
          count(*) filter (where complaint.severity = 'high')::integer,
          count(*) filter (where complaint.severity = 'critical')::integer,
          count(*) filter (where complaint.category = 'fraud')::integer,
          count(*) filter (where complaint.category = 'safety')::integer,
          count(*) filter (where complaint.category = 'conduct')::integer,
          count(*) filter (where complaint.category = 'underfill')::integer,
          count(*)::integer
        into
          standard_open,
          high_open,
          critical_open,
          fraud_open,
          safety_open,
          conduct_open,
          underfill_open,
          open_total
        from public.lpg_service_complaints complaint
        where complaint.driver_profile_id = subject_record.id
          and complaint.status in ('open','triaged','under_review')
          and complaint.created_at >= now_at - make_interval(days => lookback_days);
      else
        select
          count(*)::integer,
          count(*) filter (where orders.status = 'disputed')::integer
        into recent_orders, disputed_orders
        from public.lpg_refill_orders orders
        where orders.station_branch_id = subject_record.id
          and orders.created_at >= now_at - make_interval(days => lookback_days);

        select
          count(*) filter (where complaint.severity = 'standard')::integer,
          count(*) filter (where complaint.severity = 'high')::integer,
          count(*) filter (where complaint.severity = 'critical')::integer,
          count(*) filter (where complaint.category = 'fraud')::integer,
          count(*) filter (where complaint.category = 'safety')::integer,
          count(*) filter (where complaint.category = 'conduct')::integer,
          count(*) filter (where complaint.category = 'underfill')::integer,
          count(*)::integer
        into
          standard_open,
          high_open,
          critical_open,
          fraud_open,
          safety_open,
          conduct_open,
          underfill_open,
          open_total
        from public.lpg_service_complaints complaint
        where complaint.station_branch_id = subject_record.id
          and complaint.status in ('open','triaged','under_review')
          and complaint.created_at >= now_at - make_interval(days => lookback_days);
      end if;

      complaint_rate_component := case
        when coalesce(recent_orders, 0) < minimum_orders_for_rate then 0
        else least(
          complaint_rate_max,
          complaint_rate_max
            * (coalesce(open_total, 0)::numeric / greatest(recent_orders, 1)::numeric)
        )
      end;

      score_value := least(
        100::numeric,
        greatest(
          0::numeric,
          coalesce(standard_open, 0) * standard_weight
          + coalesce(high_open, 0) * high_weight
          + coalesce(critical_open, 0) * critical_weight
          + coalesce(fraud_open, 0) * fraud_weight
          + coalesce(safety_open, 0) * safety_weight
          + coalesce(conduct_open, 0) * conduct_weight
          + coalesce(underfill_open, 0) * underfill_weight
          + coalesce(disputed_orders, 0) * disputed_weight
          + complaint_rate_component
        )
      );

      level_value := case
        when score_value >= critical_threshold then 'critical'
        when score_value >= high_threshold then 'high'
        when score_value >= medium_threshold then 'medium'
        else 'low'
      end;

      recommendation := case
        when level_value = 'critical' then 'Review the underlying complaints and disputed orders before making any operational decision.'
        when level_value = 'high' then 'Review recent complaint evidence and operational history.'
        when level_value = 'medium' then 'Monitor the evidence and review if new complaints or disputes appear.'
        else 'No special action is suggested from this advisory assessment.'
      end;

      insert into public.ai_risk_assessments (
        rule_id,
        subject_type,
        subject_id,
        score,
        risk_level,
        evidence,
        recommended_action,
        generated_at,
        valid_until,
        version
      )
      values (
        rule_record.id,
        rule_record.subject_type,
        subject_record.id,
        round(score_value, 2),
        level_value,
        jsonb_build_object(
          'advisoryOnly', true,
          'subjectDisplayName', subject_record.display_name,
          'lookbackDays', lookback_days,
          'recentOrders', coalesce(recent_orders, 0),
          'disputedOrders', coalesce(disputed_orders, 0),
          'openComplaints', coalesce(open_total, 0),
          'standardOpenComplaints', coalesce(standard_open, 0),
          'highOpenComplaints', coalesce(high_open, 0),
          'criticalOpenComplaints', coalesce(critical_open, 0),
          'fraudOpenComplaints', coalesce(fraud_open, 0),
          'safetyOpenComplaints', coalesce(safety_open, 0),
          'conductOpenComplaints', coalesce(conduct_open, 0),
          'underfillOpenComplaints', coalesce(underfill_open, 0),
          'complaintRateComponent', round(complaint_rate_component, 2),
          'minimumOrdersForRate', minimum_orders_for_rate,
          'doesNotChangeEligibility', true,
          'doesNotHoldFunds', true,
          'doesNotChangeDispatch', true
        ),
        recommendation,
        now_at,
        now_at + make_interval(mins => valid_minutes),
        1
      )
      on conflict (rule_id, subject_type, subject_id)
      do update set
        score = excluded.score,
        risk_level = excluded.risk_level,
        evidence = excluded.evidence,
        recommended_action = excluded.recommended_action,
        generated_at = excluded.generated_at,
        valid_until = excluded.valid_until,
        version = public.ai_risk_assessments.version + 1,
        updated_at = timezone('utc', now());

      refreshed_count := refreshed_count + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'status', 'completed',
    'refreshedCount', refreshed_count,
    'refreshedAt', now_at,
    'control', 'advisory_only'
  );
end;
$$;

revoke all on function public.refresh_ai_partner_risk_assessments()
from public, anon, authenticated;
grant execute on function public.refresh_ai_partner_risk_assessments()
to service_role;

create or replace function public.read_ai_partner_risk_assessments(
  target_subject_type text default null,
  target_minimum_level text default null,
  target_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  minimum_rank integer := 0;
  result jsonb;
begin
  if not (
    public.is_platform_super_admin()
    or public.has_permission('platform.ai.read', null)
    or public.has_permission('platform.ai.manage', null)
  ) then
    raise exception using errcode = '42501', message = 'AI risk read permission is required';
  end if;

  if target_subject_type is not null and target_subject_type not in ('driver','station') then
    raise exception using errcode = '22023', message = 'unsupported risk subject type';
  end if;

  minimum_rank := case
    when target_minimum_level is null then 0
    when target_minimum_level = 'low' then 1
    when target_minimum_level = 'medium' then 2
    when target_minimum_level = 'high' then 3
    when target_minimum_level = 'critical' then 4
    else -1
  end;

  if minimum_rank < 0 then
    raise exception using errcode = '22023', message = 'unsupported minimum risk level';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', assessment.id,
        'subjectType', assessment.subject_type,
        'subjectId', assessment.subject_id,
        'score', assessment.score,
        'riskLevel', assessment.risk_level,
        'evidence', assessment.evidence,
        'recommendedAction', assessment.recommended_action,
        'generatedAt', assessment.generated_at,
        'validUntil', assessment.valid_until,
        'version', assessment.version
      )
      order by assessment.score desc, assessment.generated_at desc
    ),
    '[]'::jsonb
  )
  into result
  from (
    select risk.*
    from public.ai_risk_assessments risk
    where (target_subject_type is null or risk.subject_type = target_subject_type)
      and (
        case risk.risk_level
          when 'low' then 1
          when 'medium' then 2
          when 'high' then 3
          when 'critical' then 4
        end
      ) >= minimum_rank
    order by risk.score desc, risk.generated_at desc
    limit least(greatest(coalesce(target_limit, 100), 1), 500)
  ) assessment;

  return result;
end;
$$;

revoke all on function public.read_ai_partner_risk_assessments(text,text,integer)
from public, anon;
grant execute on function public.read_ai_partner_risk_assessments(text,text,integer)
to authenticated, service_role;

commit;
