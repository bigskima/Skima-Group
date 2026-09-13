begin;

-- Review decisions must notify applicants even when they are produced by an
-- automated/backend path rather than the Admin UI. Keep the notification on the
-- append-only review event boundary and reuse the existing frontend idempotency
-- suffix so the legacy gateway notice becomes a harmless no-op instead of a
-- duplicate message.
create or replace function public.notify_application_review_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  application_record record;
  application_type_record record;
  workspace_key text;
  workspace_label text;
  purpose_key text;
  notification_title text;
  notification_body text;
  notification_path text;
  notification_idempotency_key text;
  notification_metadata jsonb;
begin
  if new.decision not in ('approved','rejected','correction_requested','suspended','reactivated') then
    return new;
  end if;

  select app.* into application_record
  from public.application_records app
  where app.id = new.application_id;

  if not found or application_record.applicant_user_id is null then
    return new;
  end if;

  select app_type.* into application_type_record
  from public.application_type_definitions app_type
  where app_type.id = application_record.application_type_id;

  workspace_key := coalesce(
    nullif(application_type_record.metadata ->> 'workspace', ''),
    case
      when application_type_record.application_category = 'driver' then 'driver'
      when application_type_record.application_category = 'business'
        and application_type_record.key like '%.station.%' then 'station'
      else 'customer'
    end
  );

  workspace_label := case
    when workspace_key = 'driver' then 'Driver'
    when workspace_key = 'station' then 'Station'
    else coalesce(
      nullif(regexp_replace(application_type_record.display_name, '\s*application\s*$', '', 'i'), ''),
      'SKIMA'
    )
  end;

  -- The verification reconciliation runtime already sends one aggregate
  -- "verification complete" notice before separate operational activation.
  if new.decision = 'approved'
     and coalesce(new.metadata ->> 'decision_source', '') = 'automated_verification' then
    return new;
  end if;

  if new.decision = 'approved' then
    purpose_key := 'application.' || workspace_key || '.approved';
    notification_title := 'Your ' || workspace_label || ' application has been approved';
    notification_body := case
      when workspace_key = 'driver' then
        'Your Driver application is approved. Open your Driver workspace to review the next activation or work-readiness steps.'
      when workspace_key = 'station' then
        'Your Station application is approved. Open your Station workspace to review the next activation or operating steps.'
      else 'Your SKIMA application has been approved.'
    end;
    notification_path := case
      when workspace_key = 'driver' then '/(driver)'
      when workspace_key = 'station' then '/(station)'
      else '/(customer)'
    end;
    notification_idempotency_key := new.idempotency_key || ':application-notice';
  elsif new.decision = 'rejected' then
    purpose_key := 'application.' || workspace_key || '.rejected';
    notification_title := 'Your ' || workspace_label || ' application was not approved';
    notification_body := coalesce(
      nullif(btrim(new.applicant_message), ''),
      'Review your application status for the decision details and any available next steps.'
    );
    notification_path := case
      when workspace_key = 'driver' then '/(customer)/driver-application'
      when workspace_key = 'station' then '/(customer)/station-application'
      else '/(customer)'
    end;
    notification_idempotency_key := new.idempotency_key || ':application-notice';
  elsif new.decision = 'correction_requested' then
    purpose_key := 'application.' || workspace_key || '.correction_required';
    notification_title := workspace_label || ' application needs an update';
    notification_body := coalesce(
      nullif(btrim(new.applicant_message), ''),
      'SKIMA needs an update before this application can continue. Open the application to review what is required.'
    );
    notification_path := case
      when workspace_key = 'driver' then '/(customer)/driver-application'
      when workspace_key = 'station' then '/(customer)/station-application'
      else '/(customer)'
    end;
    notification_idempotency_key := new.idempotency_key || ':applicant-correction-notice';
  elsif new.decision = 'suspended' then
    purpose_key := 'application.' || workspace_key || '.suspended';
    notification_title := workspace_label || ' access suspended';
    notification_body := coalesce(
      nullif(btrim(new.applicant_message), ''),
      'Your SKIMA partner access has been suspended. Review your application status or contact SKIMA Support for the next step.'
    );
    notification_path := case
      when workspace_key = 'driver' then '/(driver)/application'
      when workspace_key = 'station' then '/(station)/application'
      else '/(customer)'
    end;
    notification_idempotency_key := new.idempotency_key || ':application-state-notice';
  else
    purpose_key := 'application.' || workspace_key || '.reactivated';
    notification_title := workspace_label || ' application reactivated';
    notification_body := coalesce(
      nullif(btrim(new.applicant_message), ''),
      'Your SKIMA application has been reactivated. Open your workspace to review the current status and continue.'
    );
    notification_path := case
      when workspace_key = 'driver' then '/(driver)'
      when workspace_key = 'station' then '/(station)'
      else '/(customer)'
    end;
    notification_idempotency_key := new.idempotency_key || ':application-state-notice';
  end if;

  notification_metadata := jsonb_strip_nulls(jsonb_build_object(
    'category', 'partner',
    'applicationId', new.application_id,
    'applicationTypeKey', application_type_record.key,
    'decision', new.decision,
    'reviewEventId', new.id,
    'workspace', workspace_key,
    'reviewTaskId', new.review_task_id
  ));

  begin
    insert into public.communication_messages (
      channel,
      purpose,
      recipient_entity_type,
      recipient_entity_id,
      status,
      payload,
      source,
      idempotency_key,
      metadata,
      created_by
    )
    values (
      'in_app',
      purpose_key,
      'user',
      application_record.applicant_user_id,
      'queued',
      jsonb_build_object(
        'title', notification_title,
        'body', notification_body,
        'category', 'partner',
        'path', notification_path,
        'route', notification_path,
        'deepLink', notification_path,
        'applicationId', new.application_id
      ),
      'skima.application.review',
      notification_idempotency_key,
      notification_metadata,
      coalesce(new.reviewer_user_id, auth.uid())
    )
    on conflict (source, idempotency_key) do update
    set purpose = excluded.purpose,
        recipient_entity_type = excluded.recipient_entity_type,
        recipient_entity_id = excluded.recipient_entity_id,
        status = case
          when public.communication_messages.status in ('sent','delivered')
            then public.communication_messages.status
          else excluded.status
        end,
        payload = excluded.payload,
        metadata = public.communication_messages.metadata || excluded.metadata,
        updated_at = timezone('utc', now());
  exception when others then
    -- A notification provider/read-model issue must never roll back a review
    -- decision. The applicant can still see the canonical application status.
    raise warning 'application review notification could not be queued for application %: %',
      new.application_id,
      sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function public.notify_application_review_event() from public, anon, authenticated;
grant execute on function public.notify_application_review_event() to service_role;

drop trigger if exists application_review_event_notification_trigger
  on public.application_review_events;

create trigger application_review_event_notification_trigger
after insert on public.application_review_events
for each row
execute function public.notify_application_review_event();

commit;
