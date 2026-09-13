begin;

-- Notify applicants only for verification states that materially change what
-- they need to know. Intermediate provider states remain silent to avoid noisy
-- notifications during ordinary webhook polling/reconciliation.
create or replace function public.notify_application_verification_session_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  application_record record;
  application_type_record record;
  requirement_record record;
  definition_record record;
  workspace_key text;
  notification_title text;
  notification_body text;
  notification_path text;
  purpose_key text;
  message_key text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  if new.status not in ('failed','manual_review','expired') then
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

  select requirement.* into requirement_record
  from public.application_verification_requirements requirement
  where requirement.id = new.application_verification_requirement_id;

  if requirement_record.verification_definition_id is not null then
    select definition.* into definition_record
    from public.verification_definitions definition
    where definition.id = requirement_record.verification_definition_id;
  end if;

  workspace_key := coalesce(
    nullif(application_type_record.metadata ->> 'workspace', ''),
    case
      when application_type_record.application_category = 'driver' then 'driver'
      when application_type_record.application_category = 'business'
        and application_type_record.key like '%.station.%' then 'station'
      else 'customer'
    end
  );

  notification_path := case
    when workspace_key = 'driver' then '/(customer)/driver-application'
    when workspace_key = 'station' then '/(customer)/station-application'
    else '/(customer)'
  end;

  if new.status = 'failed' then
    purpose_key := 'application.' || workspace_key || '.verification_failed';
    notification_title := coalesce(definition_record.display_name, 'Verification') || ' needs attention';
    notification_body := 'This verification did not complete successfully. Open your application to retry or use an available manual fallback.';
  elsif new.status = 'expired' then
    purpose_key := 'application.' || workspace_key || '.verification_expired';
    notification_title := coalesce(definition_record.display_name, 'Verification') || ' expired';
    notification_body := 'The verification session expired before completion. Open your application to start a new verification session.';
  else
    purpose_key := 'application.' || workspace_key || '.verification_manual_review';
    notification_title := coalesce(definition_record.display_name, 'Verification') || ' is under review';
    notification_body := 'SKIMA is reviewing this verification manually. No further action is needed unless we ask you for more information.';
  end if;

  message_key := 'verification-session:' || new.id::text || ':' || new.status;

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
        'applicationId', new.application_id,
        'verificationSessionId', new.id
      ),
      'skima.verification.status',
      message_key,
      jsonb_strip_nulls(jsonb_build_object(
        'category', 'partner',
        'workspace', workspace_key,
        'applicationId', new.application_id,
        'applicationTypeKey', application_type_record.key,
        'verificationSessionId', new.id,
        'verificationDefinitionKey', definition_record.key,
        'verificationStatus', new.status,
        'providerStatus', new.provider_status,
        'failureCode', new.failure_code
      )),
      auth.uid()
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
    -- Provider/webhook processing is authoritative. Never fail verification
    -- reconciliation solely because the notification read model is unavailable.
    raise warning 'verification status notification could not be queued for session %: %',
      new.id,
      sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function public.notify_application_verification_session_status()
  from public, anon, authenticated;
grant execute on function public.notify_application_verification_session_status()
  to service_role;

drop trigger if exists application_verification_status_notification_trigger
  on public.application_verification_sessions;

create trigger application_verification_status_notification_trigger
after insert or update of status on public.application_verification_sessions
for each row
execute function public.notify_application_verification_session_status();

commit;
