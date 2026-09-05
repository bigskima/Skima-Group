begin;

-- Deterministic exception detection for SKIMA Intelligence.
-- Detection is rule/config driven; AI may explain insights but never creates authoritative business state.

create table if not exists public.ai_operational_rules (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  description text,
  domain text not null check (domain in ('lpg_orders','applications','ai_runtime','finance','dispatch','inventory','custom')),
  severity text not null default 'warning'
    check (severity in ('info','warning','high','critical')),
  status text not null default 'active'
    check (status in ('draft','active','paused','retired')),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ai_operational_insights (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.ai_operational_rules(id) on delete restrict,
  insight_key text not null unique,
  subject_type text not null check (subject_type ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  subject_id uuid,
  severity text not null check (severity in ('info','warning','high','critical')),
  status text not null default 'open'
    check (status in ('open','acknowledged','resolved','dismissed')),
  title text not null,
  summary text not null,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  recommended_action text,
  first_detected_at timestamptz not null default timezone('utc', now()),
  last_detected_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_operational_insights_open_idx
on public.ai_operational_insights (status, severity, last_detected_at desc);

create index if not exists ai_operational_insights_subject_idx
on public.ai_operational_insights (subject_type, subject_id, status);

alter table public.ai_operational_rules enable row level security;
alter table public.ai_operational_insights enable row level security;

drop policy if exists ai_operational_rules_read_privileged on public.ai_operational_rules;
create policy ai_operational_rules_read_privileged
on public.ai_operational_rules for select to authenticated
using (
  public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
  or public.is_platform_super_admin()
);

drop policy if exists ai_operational_rules_manage_privileged on public.ai_operational_rules;
create policy ai_operational_rules_manage_privileged
on public.ai_operational_rules for all to authenticated
using (
  public.has_permission('platform.ai.manage', null)
  or public.is_platform_super_admin()
)
with check (
  public.has_permission('platform.ai.manage', null)
  or public.is_platform_super_admin()
);

drop policy if exists ai_operational_insights_read_privileged on public.ai_operational_insights;
create policy ai_operational_insights_read_privileged
on public.ai_operational_insights for select to authenticated
using (
  public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
  or public.is_platform_super_admin()
);

drop policy if exists ai_operational_insights_update_privileged on public.ai_operational_insights;
create policy ai_operational_insights_update_privileged
on public.ai_operational_insights for update to authenticated
using (
  public.has_permission('platform.ai.manage', null)
  or public.is_platform_super_admin()
)
with check (
  public.has_permission('platform.ai.manage', null)
  or public.is_platform_super_admin()
);

grant select on public.ai_operational_rules, public.ai_operational_insights to authenticated;
grant update on public.ai_operational_insights to authenticated;
grant all on public.ai_operational_rules, public.ai_operational_insights to service_role;

insert into public.ai_operational_rules (
  key, display_name, description, domain, severity, status, config
)
values
  (
    'lpg.order.stale_active',
    'Active LPG order taking unusually long',
    'Flags active LPG orders whose state has not changed within the configured attention window.',
    'lpg_orders',
    'warning',
    'active',
    '{
      "threshold_minutes": 60,
      "statuses": ["created","quoted","payment_pending","payment_authorized","assigned","pickup_en_route","picked_up","station_en_route","station_verified","refill_started","refill_in_progress","return_en_route"],
      "recommended_action": "Review the order timeline, current assignment and latest tracking event before contacting the affected party."
    }'::jsonb
  ),
  (
    'ai.task.failed_recent',
    'AI task failed recently',
    'Flags failed AI background tasks so provider or runtime issues can be investigated without affecting LPG operations.',
    'ai_runtime',
    'warning',
    'active',
    '{
      "lookback_hours": 24,
      "recommended_action": "Review the AI task error and provider route. Do not modify the underlying LPG record unless a separate business issue is confirmed."
    }'::jsonb
  ),
  (
    'application.review.waiting',
    'Application waiting for review',
    'Flags submitted applications that have remained in a reviewable state beyond the configured window.',
    'applications',
    'info',
    'active',
    '{
      "threshold_hours": 24,
      "statuses": ["submitted","resubmitted","under_review"],
      "recommended_action": "Open the application and continue the normal review workflow."
    }'::jsonb
  )
on conflict (key) do update
set display_name = excluded.display_name,
    description = excluded.description,
    domain = excluded.domain,
    severity = excluded.severity,
    status = excluded.status,
    config = public.ai_operational_rules.config || excluded.config,
    updated_at = timezone('utc', now());

create or replace function public.refresh_ai_operational_insights()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rule_record public.ai_operational_rules%rowtype;
  detected_keys text[] := array[]::text[];
  detected_count integer := 0;
  resolved_count integer := 0;
  threshold_minutes integer;
  threshold_hours integer;
  recommended_action text;
  order_record record;
  task_record record;
  application_record record;
  insight_key_value text;
begin
  -- Service runtime or AI managers can refresh deterministic exception state.
  if coalesce(auth.role(), '') <> 'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.ai.manage', null) then
    raise exception 'AI operations management permission is required';
  end if;

  select * into rule_record
  from public.ai_operational_rules
  where key = 'lpg.order.stale_active'
    and status = 'active';

  if rule_record.id is not null then
    threshold_minutes := greatest(5, least(1440, coalesce((rule_record.config ->> 'threshold_minutes')::integer, 60)));
    recommended_action := nullif(btrim(rule_record.config ->> 'recommended_action'), '');

    for order_record in
      select
        orders.id,
        orders.public_reference,
        orders.status,
        orders.payment_status,
        orders.assignment_status,
        orders.updated_at
      from public.lpg_refill_orders orders
      where orders.updated_at <= timezone('utc', now()) - make_interval(mins => threshold_minutes)
        and exists (
          select 1
          from jsonb_array_elements_text(coalesce(rule_record.config -> 'statuses', '[]'::jsonb)) status_value
          where status_value = orders.status
        )
      order by orders.updated_at asc
      limit 250
    loop
      insight_key_value := rule_record.key || ':' || order_record.id::text;
      detected_keys := array_append(detected_keys, insight_key_value);
      detected_count := detected_count + 1;

      insert into public.ai_operational_insights (
        rule_id, insight_key, subject_type, subject_id, severity, status,
        title, summary, evidence, recommended_action, first_detected_at,
        last_detected_at, resolved_at, metadata
      )
      values (
        rule_record.id,
        insight_key_value,
        'lpg_order',
        order_record.id,
        rule_record.severity,
        'open',
        'LPG order needs attention',
        'An active LPG order has not changed state within the configured attention window.',
        jsonb_build_object(
          'publicReference', order_record.public_reference,
          'status', order_record.status,
          'paymentStatus', order_record.payment_status,
          'assignmentStatus', order_record.assignment_status,
          'lastUpdatedAt', order_record.updated_at,
          'thresholdMinutes', threshold_minutes
        ),
        recommended_action,
        timezone('utc', now()),
        timezone('utc', now()),
        null,
        jsonb_build_object('detector', 'deterministic')
      )
      on conflict (insight_key) do update
      set severity = excluded.severity,
          status = case
            when public.ai_operational_insights.status = 'dismissed'
              then public.ai_operational_insights.status
            else 'open'
          end,
          summary = excluded.summary,
          evidence = excluded.evidence,
          recommended_action = excluded.recommended_action,
          last_detected_at = timezone('utc', now()),
          resolved_at = null,
          updated_at = timezone('utc', now());
    end loop;
  end if;

  select * into rule_record
  from public.ai_operational_rules
  where key = 'ai.task.failed_recent'
    and status = 'active';

  if rule_record.id is not null then
    threshold_hours := greatest(1, least(720, coalesce((rule_record.config ->> 'lookback_hours')::integer, 24)));
    recommended_action := nullif(btrim(rule_record.config ->> 'recommended_action'), '');

    for task_record in
      select
        task.id,
        task.subject_type,
        task.subject_id,
        task.source,
        task.failed_at,
        task.updated_at
      from public.ai_task_runs task
      where task.status = 'failed'
        and coalesce(task.failed_at, task.updated_at) >= timezone('utc', now()) - make_interval(hours => threshold_hours)
      order by coalesce(task.failed_at, task.updated_at) desc
      limit 250
    loop
      insight_key_value := rule_record.key || ':' || task_record.id::text;
      detected_keys := array_append(detected_keys, insight_key_value);
      detected_count := detected_count + 1;

      insert into public.ai_operational_insights (
        rule_id, insight_key, subject_type, subject_id, severity, status,
        title, summary, evidence, recommended_action, first_detected_at,
        last_detected_at, resolved_at, metadata
      )
      values (
        rule_record.id,
        insight_key_value,
        'ai_task',
        task_record.id,
        rule_record.severity,
        'open',
        'AI task needs attention',
        'An AI background task failed within the configured review window.',
        jsonb_build_object(
          'taskId', task_record.id,
          'subjectType', task_record.subject_type,
          'subjectId', task_record.subject_id,
          'source', task_record.source,
          'failedAt', task_record.failed_at,
          'lookbackHours', threshold_hours
        ),
        recommended_action,
        timezone('utc', now()),
        timezone('utc', now()),
        null,
        jsonb_build_object('detector', 'deterministic')
      )
      on conflict (insight_key) do update
      set severity = excluded.severity,
          status = case
            when public.ai_operational_insights.status = 'dismissed'
              then public.ai_operational_insights.status
            else 'open'
          end,
          summary = excluded.summary,
          evidence = excluded.evidence,
          recommended_action = excluded.recommended_action,
          last_detected_at = timezone('utc', now()),
          resolved_at = null,
          updated_at = timezone('utc', now());
    end loop;
  end if;

  select * into rule_record
  from public.ai_operational_rules
  where key = 'application.review.waiting'
    and status = 'active';

  if rule_record.id is not null then
    threshold_hours := greatest(1, least(720, coalesce((rule_record.config ->> 'threshold_hours')::integer, 24)));
    recommended_action := nullif(btrim(rule_record.config ->> 'recommended_action'), '');

    for application_record in
      select
        application.id,
        application.status,
        application.organization_id,
        application.created_at,
        application.updated_at
      from public.application_records application
      where application.updated_at <= timezone('utc', now()) - make_interval(hours => threshold_hours)
        and exists (
          select 1
          from jsonb_array_elements_text(coalesce(rule_record.config -> 'statuses', '[]'::jsonb)) status_value
          where status_value = application.status
        )
      order by application.updated_at asc
      limit 250
    loop
      insight_key_value := rule_record.key || ':' || application_record.id::text;
      detected_keys := array_append(detected_keys, insight_key_value);
      detected_count := detected_count + 1;

      insert into public.ai_operational_insights (
        rule_id, insight_key, subject_type, subject_id, severity, status,
        title, summary, evidence, recommended_action, first_detected_at,
        last_detected_at, resolved_at, metadata
      )
      values (
        rule_record.id,
        insight_key_value,
        'application',
        application_record.id,
        rule_record.severity,
        'open',
        'Application waiting for review',
        'An application has remained in a reviewable state beyond the configured attention window.',
        jsonb_build_object(
          'applicationId', application_record.id,
          'status', application_record.status,
          'organizationId', application_record.organization_id,
          'lastUpdatedAt', application_record.updated_at,
          'thresholdHours', threshold_hours
        ),
        recommended_action,
        timezone('utc', now()),
        timezone('utc', now()),
        null,
        jsonb_build_object('detector', 'deterministic')
      )
      on conflict (insight_key) do update
      set severity = excluded.severity,
          status = case
            when public.ai_operational_insights.status = 'dismissed'
              then public.ai_operational_insights.status
            else 'open'
          end,
          summary = excluded.summary,
          evidence = excluded.evidence,
          recommended_action = excluded.recommended_action,
          last_detected_at = timezone('utc', now()),
          resolved_at = null,
          updated_at = timezone('utc', now());
    end loop;
  end if;

  -- Resolve stale detector insights when the underlying exception is no longer present.
  with resolved as (
    update public.ai_operational_insights insight
    set status = 'resolved',
        resolved_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where insight.status in ('open','acknowledged')
      and insight.metadata ->> 'detector' = 'deterministic'
      and insight.insight_key <> all(coalesce(detected_keys, array[]::text[]))
    returning insight.id
  )
  select count(*) into resolved_count from resolved;

  return jsonb_build_object(
    'detectedCount', detected_count,
    'resolvedCount', resolved_count,
    'refreshedAt', timezone('utc', now())
  );
end;
$$;

revoke all on function public.refresh_ai_operational_insights() from public, anon, authenticated;
grant execute on function public.refresh_ai_operational_insights() to service_role;

create or replace function public.acknowledge_ai_operational_insight(
  target_insight_id uuid,
  target_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  insight_record public.ai_operational_insights%rowtype;
begin
  if not (
    public.is_platform_super_admin()
    or public.has_permission('platform.ai.manage', null)
  ) then
    raise exception 'AI operations management permission is required';
  end if;

  if target_action not in ('acknowledge','dismiss','reopen') then
    raise exception 'unsupported insight action';
  end if;

  update public.ai_operational_insights
  set status = case target_action
        when 'acknowledge' then 'acknowledged'
        when 'dismiss' then 'dismissed'
        else 'open'
      end,
      acknowledged_at = case target_action
        when 'acknowledge' then timezone('utc', now())
        else acknowledged_at
      end,
      acknowledged_by = case target_action
        when 'acknowledge' then auth.uid()
        else acknowledged_by
      end,
      resolved_at = case target_action
        when 'reopen' then null
        when 'dismiss' then timezone('utc', now())
        else resolved_at
      end,
      updated_at = timezone('utc', now())
  where id = target_insight_id
  returning * into insight_record;

  if insight_record.id is null then
    raise exception 'AI operational insight was not found';
  end if;

  return to_jsonb(insight_record);
end;
$$;

revoke all on function public.acknowledge_ai_operational_insight(uuid,text) from public, anon;
grant execute on function public.acknowledge_ai_operational_insight(uuid,text) to authenticated, service_role;

commit;
