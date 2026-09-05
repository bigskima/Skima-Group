begin;

-- SKIMA Support Triage Intelligence.
-- Advisory only: this runtime prioritizes active LPG service complaints for human review.
-- It never changes complaint status, resolves/dismisses a case, suspends a partner,
-- changes dispatch, moves funds, posts ledger entries, or certifies LPG safety.

create table if not exists public.ai_support_triage_rules (
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

create table if not exists public.ai_support_triage_assessments (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.ai_support_triage_rules(id) on delete restrict,
  complaint_id uuid not null references public.lpg_service_complaints(id) on delete cascade,
  priority_score numeric(6,2) not null check (priority_score between 0 and 100),
  priority_level text not null
    check (priority_level in ('routine','elevated','urgent','critical')),
  sla_status text not null
    check (sla_status in ('on_track','due_soon','overdue')),
  attention_by timestamptz not null,
  related_open_cases integer not null default 0 check (related_open_cases >= 0),
  assessment_status text not null default 'active'
    check (assessment_status in ('active','closed')),
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  recommended_action text not null,
  generated_at timestamptz not null default timezone('utc', now()),
  valid_until timestamptz not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (rule_id, complaint_id)
);

create index if not exists ai_support_triage_active_priority_idx
on public.ai_support_triage_assessments
  (assessment_status, priority_score desc, attention_by asc);

create index if not exists ai_support_triage_complaint_idx
on public.ai_support_triage_assessments (complaint_id, generated_at desc);

alter table public.ai_support_triage_rules enable row level security;
alter table public.ai_support_triage_assessments enable row level security;

drop policy if exists ai_support_triage_rules_read_privileged
on public.ai_support_triage_rules;
create policy ai_support_triage_rules_read_privileged
on public.ai_support_triage_rules
for select to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
  or public.has_permission('lpg.quality.read', null)
  or public.has_permission('lpg.quality.manage', null)
);

drop policy if exists ai_support_triage_rules_manage_privileged
on public.ai_support_triage_rules;
create policy ai_support_triage_rules_manage_privileged
on public.ai_support_triage_rules
for all to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.manage', null)
)
with check (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.manage', null)
);

drop policy if exists ai_support_triage_assessments_read_privileged
on public.ai_support_triage_assessments;
create policy ai_support_triage_assessments_read_privileged
on public.ai_support_triage_assessments
for select to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
  or public.has_permission('lpg.quality.read', null)
  or public.has_permission('lpg.quality.manage', null)
);

drop policy if exists ai_support_triage_assessments_no_direct_insert
on public.ai_support_triage_assessments;
create policy ai_support_triage_assessments_no_direct_insert
on public.ai_support_triage_assessments
for insert to authenticated
with check (false);

drop policy if exists ai_support_triage_assessments_no_direct_update
on public.ai_support_triage_assessments;
create policy ai_support_triage_assessments_no_direct_update
on public.ai_support_triage_assessments
for update to authenticated
using (false)
with check (false);

drop policy if exists ai_support_triage_assessments_no_direct_delete
on public.ai_support_triage_assessments;
create policy ai_support_triage_assessments_no_direct_delete
on public.ai_support_triage_assessments
for delete to authenticated
using (false);

grant select, insert, update, delete on public.ai_support_triage_rules to authenticated;
grant select on public.ai_support_triage_assessments to authenticated;
grant all on public.ai_support_triage_rules, public.ai_support_triage_assessments to service_role;

insert into public.ai_support_triage_rules (
  key,
  display_name,
  status,
  config
)
values (
  'ai.support.lpg.complaint_triage',
  'LPG complaint triage',
  'active',
  '{
    "control": "advisory_only",
    "valid_minutes": 60,
    "related_history_days": 90,
    "due_soon_hours": 2,
    "sla_hours": {
      "standard": 24,
      "high": 8,
      "critical": 2
    },
    "thresholds": {
      "elevated": 30,
      "urgent": 55,
      "critical": 80
    },
    "weights": {
      "severity_standard": 5,
      "severity_high": 30,
      "severity_critical": 60,
      "category_safety": 30,
      "category_fraud": 25,
      "category_lost_cylinder": 18,
      "category_switched_cylinder": 20,
      "category_damaged_cylinder": 18,
      "category_delivery": 8,
      "category_payment": 10,
      "category_conduct": 12,
      "category_underfill": 10,
      "category_pricing": 5,
      "category_other": 0,
      "age_per_6_hours": 2,
      "age_max": 20,
      "related_open_case": 5,
      "related_open_max": 15
    }
  }'::jsonb
)
on conflict (key) do update
set display_name = excluded.display_name,
    config = public.ai_support_triage_rules.config || excluded.config,
    updated_at = timezone('utc', now());

create or replace function public.validate_ai_support_triage_rule_config()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  valid_minutes integer;
  history_days integer;
  due_soon_hours integer;
  standard_sla numeric;
  high_sla numeric;
  critical_sla numeric;
  elevated_threshold numeric;
  urgent_threshold numeric;
  critical_threshold numeric;
  weight_entry record;
begin
  if jsonb_typeof(new.config) <> 'object' then
    raise exception 'support triage configuration must be an object';
  end if;

  if coalesce(new.config ->> 'control', '') <> 'advisory_only' then
    raise exception 'support triage control must remain advisory_only';
  end if;

  if coalesce(new.config ->> 'valid_minutes', '') !~ '^[0-9]+$'
    or coalesce(new.config ->> 'related_history_days', '') !~ '^[0-9]+$'
    or coalesce(new.config ->> 'due_soon_hours', '') !~ '^[0-9]+$' then
    raise exception 'support triage timing settings must be whole numbers';
  end if;

  valid_minutes := (new.config ->> 'valid_minutes')::integer;
  history_days := (new.config ->> 'related_history_days')::integer;
  due_soon_hours := (new.config ->> 'due_soon_hours')::integer;

  if valid_minutes not between 15 and 1440 then
    raise exception 'support triage validity must be between 15 and 1440 minutes';
  end if;

  if history_days not between 7 and 365 then
    raise exception 'support triage related history must be between 7 and 365 days';
  end if;

  if due_soon_hours not between 1 and 24 then
    raise exception 'support triage due-soon window must be between 1 and 24 hours';
  end if;

  if jsonb_typeof(new.config -> 'sla_hours') <> 'object'
    or jsonb_typeof(new.config -> 'thresholds') <> 'object'
    or jsonb_typeof(new.config -> 'weights') <> 'object' then
    raise exception 'support triage SLA, thresholds and weights must be objects';
  end if;

  standard_sla := (new.config #>> '{sla_hours,standard}')::numeric;
  high_sla := (new.config #>> '{sla_hours,high}')::numeric;
  critical_sla := (new.config #>> '{sla_hours,critical}')::numeric;

  if standard_sla <= 0 or high_sla <= 0 or critical_sla <= 0
    or critical_sla > high_sla or high_sla > standard_sla then
    raise exception 'support triage SLA hours must be positive and tighten from standard to critical';
  end if;

  elevated_threshold := (new.config #>> '{thresholds,elevated}')::numeric;
  urgent_threshold := (new.config #>> '{thresholds,urgent}')::numeric;
  critical_threshold := (new.config #>> '{thresholds,critical}')::numeric;

  if elevated_threshold < 0
    or urgent_threshold <= elevated_threshold
    or critical_threshold <= urgent_threshold
    or critical_threshold > 100 then
    raise exception 'support triage thresholds must increase from elevated to urgent to critical within 0 to 100';
  end if;

  for weight_entry in
    select key, value
    from jsonb_each_text(new.config -> 'weights')
  loop
    if weight_entry.value !~ '^[0-9]+([.][0-9]+)?$'
      or weight_entry.value::numeric < 0
      or weight_entry.value::numeric > 100 then
      raise exception 'support triage weights must be numbers between 0 and 100';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists validate_ai_support_triage_rule_config
on public.ai_support_triage_rules;

create trigger validate_ai_support_triage_rule_config
before insert or update of config
on public.ai_support_triage_rules
for each row
execute function public.validate_ai_support_triage_rule_config();

update public.ai_support_triage_rules
set config = config,
    updated_at = updated_at
where key = 'ai.support.lpg.complaint_triage';

create or replace function public.refresh_ai_support_triage_assessments()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rule_record public.ai_support_triage_rules%rowtype;
  complaint_record record;
  now_at timestamptz := timezone('utc', now());
  valid_minutes integer;
  history_days integer;
  due_soon_hours integer;
  sla_hours numeric;
  attention_at timestamptz;
  age_hours numeric;
  age_component numeric;
  severity_component numeric;
  category_component numeric;
  related_component numeric;
  related_count integer;
  score_value numeric;
  priority_value text;
  sla_value text;
  recommendation text;
  refreshed_count integer := 0;
  closed_count integer := 0;
begin
  select *
  into rule_record
  from public.ai_support_triage_rules
  where key = 'ai.support.lpg.complaint_triage'
    and status = 'active';

  if rule_record.id is null then
    return jsonb_build_object(
      'status', 'skipped',
      'reason', 'support_triage_rule_inactive',
      'refreshedCount', 0,
      'closedCount', 0,
      'refreshedAt', now_at,
      'control', 'advisory_only'
    );
  end if;

  valid_minutes := (rule_record.config ->> 'valid_minutes')::integer;
  history_days := (rule_record.config ->> 'related_history_days')::integer;
  due_soon_hours := (rule_record.config ->> 'due_soon_hours')::integer;

  for complaint_record in
    select
      complaint.id,
      complaint.order_id,
      complaint.subject_type,
      complaint.driver_profile_id,
      complaint.station_branch_id,
      complaint.category,
      complaint.severity,
      complaint.status,
      complaint.created_at,
      complaint.updated_at
    from public.lpg_service_complaints complaint
    where complaint.status in ('open','triaged','under_review')
    order by complaint.created_at asc, complaint.id
  loop
    age_hours := greatest(
      extract(epoch from (now_at - complaint_record.created_at)) / 3600.0,
      0
    );

    sla_hours := case complaint_record.severity
      when 'critical' then (rule_record.config #>> '{sla_hours,critical}')::numeric
      when 'high' then (rule_record.config #>> '{sla_hours,high}')::numeric
      else (rule_record.config #>> '{sla_hours,standard}')::numeric
    end;

    attention_at := complaint_record.created_at + make_interval(
      secs => greatest(round(sla_hours * 3600)::integer, 1)
    );

    sla_value := case
      when now_at > attention_at then 'overdue'
      when now_at + make_interval(hours => due_soon_hours) >= attention_at then 'due_soon'
      else 'on_track'
    end;

    severity_component := case complaint_record.severity
      when 'critical' then (rule_record.config #>> '{weights,severity_critical}')::numeric
      when 'high' then (rule_record.config #>> '{weights,severity_high}')::numeric
      else (rule_record.config #>> '{weights,severity_standard}')::numeric
    end;

    category_component := case complaint_record.category
      when 'safety' then (rule_record.config #>> '{weights,category_safety}')::numeric
      when 'fraud' then (rule_record.config #>> '{weights,category_fraud}')::numeric
      when 'lost_cylinder' then (rule_record.config #>> '{weights,category_lost_cylinder}')::numeric
      when 'switched_cylinder' then (rule_record.config #>> '{weights,category_switched_cylinder}')::numeric
      when 'damaged_cylinder' then (rule_record.config #>> '{weights,category_damaged_cylinder}')::numeric
      when 'delivery' then (rule_record.config #>> '{weights,category_delivery}')::numeric
      when 'payment' then (rule_record.config #>> '{weights,category_payment}')::numeric
      when 'conduct' then (rule_record.config #>> '{weights,category_conduct}')::numeric
      when 'underfill' then (rule_record.config #>> '{weights,category_underfill}')::numeric
      when 'pricing' then (rule_record.config #>> '{weights,category_pricing}')::numeric
      else (rule_record.config #>> '{weights,category_other}')::numeric
    end;

    age_component := least(
      floor(age_hours / 6.0) * (rule_record.config #>> '{weights,age_per_6_hours}')::numeric,
      (rule_record.config #>> '{weights,age_max}')::numeric
    );

    if complaint_record.subject_type = 'driver' then
      select count(*)::integer
      into related_count
      from public.lpg_service_complaints related
      where related.driver_profile_id = complaint_record.driver_profile_id
        and related.status in ('open','triaged','under_review')
        and related.created_at >= now_at - make_interval(days => history_days);
    elsif complaint_record.subject_type = 'station' then
      select count(*)::integer
      into related_count
      from public.lpg_service_complaints related
      where related.station_branch_id = complaint_record.station_branch_id
        and related.status in ('open','triaged','under_review')
        and related.created_at >= now_at - make_interval(days => history_days);
    else
      related_count := 1;
    end if;

    related_component := least(
      greatest(coalesce(related_count, 1) - 1, 0)
        * (rule_record.config #>> '{weights,related_open_case}')::numeric,
      (rule_record.config #>> '{weights,related_open_max}')::numeric
    );

    score_value := least(
      100::numeric,
      greatest(
        0::numeric,
        severity_component + category_component + age_component + related_component
      )
    );

    priority_value := case
      when score_value >= (rule_record.config #>> '{thresholds,critical}')::numeric then 'critical'
      when score_value >= (rule_record.config #>> '{thresholds,urgent}')::numeric then 'urgent'
      when score_value >= (rule_record.config #>> '{thresholds,elevated}')::numeric then 'elevated'
      else 'routine'
    end;

    recommendation := case complaint_record.category
      when 'safety' then
        'Review the complaint and available safety/custody evidence promptly. Do not certify cylinder safety from complaint text or AI triage.'
      when 'fraud' then
        'Review order, payment, location, scan and account evidence before any enforcement or financial decision.'
      when 'lost_cylinder' then
        'Review cylinder custody, scan history, driver handoffs and the order timeline before deciding responsibility.'
      when 'switched_cylinder' then
        'Review cylinder identity, custody scans and order history before deciding whether a cylinder was switched.'
      when 'damaged_cylinder' then
        'Review cylinder media, custody events and refill/delivery history. Visual evidence alone does not certify safety.'
      when 'payment' then
        'Review provider payment events, order finance state and ledger references. Triage must not alter money or ledger records.'
      when 'underfill' then
        'Review requested kg, actual filled kg, station records and any refund workflow before deciding the complaint.'
      when 'conduct' then
        'Review the service timeline and available communication/operational evidence before deciding the conduct complaint.'
      when 'delivery' then
        'Review dispatch, tracking, handoff and delivery-confirmation evidence before deciding the complaint.'
      else
        'Review the complaint together with the canonical order and supporting SKIMA records before making a decision.'
    end;

    insert into public.ai_support_triage_assessments (
      rule_id,
      complaint_id,
      priority_score,
      priority_level,
      sla_status,
      attention_by,
      related_open_cases,
      assessment_status,
      evidence,
      recommended_action,
      generated_at,
      valid_until,
      version
    )
    values (
      rule_record.id,
      complaint_record.id,
      round(score_value, 2),
      priority_value,
      sla_value,
      attention_at,
      coalesce(related_count, 1),
      'active',
      jsonb_build_object(
        'advisoryOnly', true,
        'complaintStatus', complaint_record.status,
        'complaintSeverity', complaint_record.severity,
        'complaintCategory', complaint_record.category,
        'subjectType', complaint_record.subject_type,
        'orderId', complaint_record.order_id,
        'driverProfileId', complaint_record.driver_profile_id,
        'stationBranchId', complaint_record.station_branch_id,
        'ageHours', round(age_hours, 2),
        'severityComponent', severity_component,
        'categoryComponent', category_component,
        'ageComponent', age_component,
        'relatedOpenCaseComponent', related_component,
        'relatedOpenCases', coalesce(related_count, 1),
        'attentionBy', attention_at,
        'doesNotChangeComplaintStatus', true,
        'doesNotResolveOrDismiss', true,
        'doesNotSuspendPartner', true,
        'doesNotChangeDispatch', true,
        'doesNotMoveFunds', true,
        'doesNotPostLedger', true
      ),
      recommendation,
      now_at,
      now_at + make_interval(mins => valid_minutes),
      1
    )
    on conflict (rule_id, complaint_id)
    do update set
      priority_score = excluded.priority_score,
      priority_level = excluded.priority_level,
      sla_status = excluded.sla_status,
      attention_by = excluded.attention_by,
      related_open_cases = excluded.related_open_cases,
      assessment_status = 'active',
      evidence = excluded.evidence,
      recommended_action = excluded.recommended_action,
      generated_at = excluded.generated_at,
      valid_until = excluded.valid_until,
      version = public.ai_support_triage_assessments.version + 1,
      updated_at = timezone('utc', now());

    refreshed_count := refreshed_count + 1;
  end loop;

  with closed as (
    update public.ai_support_triage_assessments assessment
    set assessment_status = 'closed',
        generated_at = now_at,
        valid_until = now_at,
        updated_at = now_at,
        version = assessment.version + 1
    where assessment.rule_id = rule_record.id
      and assessment.assessment_status = 'active'
      and not exists (
        select 1
        from public.lpg_service_complaints complaint
        where complaint.id = assessment.complaint_id
          and complaint.status in ('open','triaged','under_review')
      )
    returning assessment.id
  )
  select count(*)::integer into closed_count from closed;

  return jsonb_build_object(
    'status', 'completed',
    'refreshedCount', refreshed_count,
    'closedCount', closed_count,
    'refreshedAt', now_at,
    'control', 'advisory_only'
  );
end;
$$;

revoke all on function public.refresh_ai_support_triage_assessments()
from public, anon, authenticated;
grant execute on function public.refresh_ai_support_triage_assessments()
to service_role;

create or replace function public.read_ai_support_triage_assessments(
  target_minimum_priority text default 'routine',
  target_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  minimum_rank integer;
  result jsonb;
begin
  if not (
    auth.role() = 'service_role'
    or public.is_platform_super_admin()
    or public.has_permission('platform.ai.read', null)
    or public.has_permission('platform.ai.manage', null)
    or public.has_permission('lpg.quality.read', null)
    or public.has_permission('lpg.quality.manage', null)
  ) then
    raise exception using errcode = '42501', message = 'support triage read permission is required';
  end if;

  minimum_rank := case target_minimum_priority
    when 'routine' then 1
    when 'elevated' then 2
    when 'urgent' then 3
    when 'critical' then 4
    else -1
  end;

  if minimum_rank < 0 then
    raise exception using errcode = '22023', message = 'unsupported minimum support triage priority';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', assessment.id,
        'complaintId', assessment.complaint_id,
        'priorityScore', assessment.priority_score,
        'priorityLevel', assessment.priority_level,
        'slaStatus', assessment.sla_status,
        'attentionBy', assessment.attention_by,
        'relatedOpenCases', assessment.related_open_cases,
        'evidence', assessment.evidence,
        'recommendedAction', assessment.recommended_action,
        'generatedAt', assessment.generated_at,
        'validUntil', assessment.valid_until,
        'version', assessment.version
      )
      order by assessment.priority_score desc, assessment.attention_by asc
    ),
    '[]'::jsonb
  )
  into result
  from (
    select triage.*
    from public.ai_support_triage_assessments triage
    where triage.assessment_status = 'active'
      and (
        case triage.priority_level
          when 'routine' then 1
          when 'elevated' then 2
          when 'urgent' then 3
          when 'critical' then 4
        end
      ) >= minimum_rank
    order by triage.priority_score desc, triage.attention_by asc
    limit least(greatest(coalesce(target_limit, 100), 1), 500)
  ) assessment;

  return result;
end;
$$;

revoke all on function public.read_ai_support_triage_assessments(text,integer)
from public, anon;
grant execute on function public.read_ai_support_triage_assessments(text,integer)
to authenticated, service_role;

comment on function public.read_ai_support_triage_assessments(text,integer) is
  'Returns advisory-only LPG complaint triage for authorized Quality/AI administrators. It never changes complaint workflow state or financial/dispatch state.';

commit;
