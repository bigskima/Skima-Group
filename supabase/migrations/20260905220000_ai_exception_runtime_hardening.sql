begin;

-- Harden the deterministic SKIMA Intelligence exception runtime against the canonical LPG/AI schemas.
-- This migration preserves the original detector tables and only corrects configuration/runtime behavior.

update public.ai_operational_rules
set config = jsonb_set(
      config,
      '{statuses}',
      '[
        "awaiting_payment",
        "payment_reserved",
        "matching_station",
        "matching_driver",
        "driver_offered",
        "driver_accepted",
        "pickup_en_route",
        "pickup_verified",
        "station_en_route",
        "station_verified",
        "refill_in_progress",
        "refill_confirmed",
        "station_settled",
        "return_en_route",
        "delivery_verification_pending",
        "disputed"
      ]'::jsonb,
      true
    ),
    updated_at = timezone('utc', now())
where key = 'lpg.order.stale_active';

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
    threshold_minutes := greatest(
      5,
      least(
        1440,
        case
          when coalesce(rule_record.config ->> 'threshold_minutes', '') ~ '^[0-9]+$'
            then (rule_record.config ->> 'threshold_minutes')::integer
          else 60
        end
      )
    );
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
            when public.ai_operational_insights.status in ('dismissed','acknowledged')
              then public.ai_operational_insights.status
            else 'open'
          end,
          summary = excluded.summary,
          evidence = excluded.evidence,
          recommended_action = excluded.recommended_action,
          last_detected_at = timezone('utc', now()),
          resolved_at = case
            when public.ai_operational_insights.status = 'dismissed'
              then public.ai_operational_insights.resolved_at
            else null
          end,
          updated_at = timezone('utc', now());
    end loop;
  end if;

  select * into rule_record
  from public.ai_operational_rules
  where key = 'ai.task.failed_recent'
    and status = 'active';

  if rule_record.id is not null then
    threshold_hours := greatest(
      1,
      least(
        720,
        case
          when coalesce(rule_record.config ->> 'lookback_hours', '') ~ '^[0-9]+$'
            then (rule_record.config ->> 'lookback_hours')::integer
          else 24
        end
      )
    );
    recommended_action := nullif(btrim(rule_record.config ->> 'recommended_action'), '');

    for task_record in
      select
        task.id,
        task.subject_type,
        task.subject_id,
        task.source,
        task.completed_at as failure_at,
        task.updated_at
      from public.ai_task_runs task
      where task.status = 'failed'
        and coalesce(task.completed_at, task.updated_at) >=
          timezone('utc', now()) - make_interval(hours => threshold_hours)
      order by coalesce(task.completed_at, task.updated_at) desc
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
          'failedAt', task_record.failure_at,
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
            when public.ai_operational_insights.status in ('dismissed','acknowledged')
              then public.ai_operational_insights.status
            else 'open'
          end,
          summary = excluded.summary,
          evidence = excluded.evidence,
          recommended_action = excluded.recommended_action,
          last_detected_at = timezone('utc', now()),
          resolved_at = case
            when public.ai_operational_insights.status = 'dismissed'
              then public.ai_operational_insights.resolved_at
            else null
          end,
          updated_at = timezone('utc', now());
    end loop;
  end if;

  select * into rule_record
  from public.ai_operational_rules
  where key = 'application.review.waiting'
    and status = 'active';

  if rule_record.id is not null then
    threshold_hours := greatest(
      1,
      least(
        720,
        case
          when coalesce(rule_record.config ->> 'threshold_hours', '') ~ '^[0-9]+$'
            then (rule_record.config ->> 'threshold_hours')::integer
          else 24
        end
      )
    );
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
            when public.ai_operational_insights.status in ('dismissed','acknowledged')
              then public.ai_operational_insights.status
            else 'open'
          end,
          summary = excluded.summary,
          evidence = excluded.evidence,
          recommended_action = excluded.recommended_action,
          last_detected_at = timezone('utc', now()),
          resolved_at = case
            when public.ai_operational_insights.status = 'dismissed'
              then public.ai_operational_insights.resolved_at
            else null
          end,
          updated_at = timezone('utc', now());
    end loop;
  end if;

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

commit;
