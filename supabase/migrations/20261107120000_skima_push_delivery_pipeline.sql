begin;

alter table public.push_notification_outbox
  add column if not exists last_receipt_checked_at timestamptz;

-- Native push is dispatched from the same notification_messages queue used by
-- in-app, SMS, email and WhatsApp. Only a user recipient with an explicit
-- SKIMA app key is copied into the Expo outbox.
create or replace function public.enqueue_skima_push_from_notification_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  app_value text;
  title_value text;
  body_value text;
  data_value jsonb;
begin
  if new.channel <> 'push' or new.status = 'cancelled'
    or new.recipient_entity_type <> 'user'
    or new.recipient_entity_id is null then
    return new;
  end if;

  app_value := lower(coalesce(
    new.payload->>'app_key',
    new.payload->>'appKey',
    new.payload->>'module_key',
    new.payload->>'moduleKey'
  ));
  if app_value in ('lpg','refill') then app_value := 'refill'; end if;
  if app_value not in ('refill','store','logistics','bills') then
    return new;
  end if;

  title_value := nullif(btrim(coalesce(new.payload->>'title', new.payload->>'subject')), '');
  body_value := nullif(btrim(coalesce(new.payload->>'body', new.payload->>'message', new.payload->>'text')), '');
  if title_value is null or body_value is null then
    return new;
  end if;

  data_value := case
    when jsonb_typeof(new.payload->'data') = 'object' then new.payload->'data'
    else jsonb_build_object()
  end;
  data_value := data_value || jsonb_strip_nulls(jsonb_build_object(
    'appKey', app_value,
    'path', coalesce(new.payload->>'path', new.payload->>'deep_link', new.payload->>'deepLink', data_value->>'path'),
    'notificationId', new.id
  ));

  insert into public.push_notification_outbox (
    notification_message_id, registration_id, user_id, app_key,
    expo_push_token, expo_project_id, title, body, data, idempotency_key
  )
  select
    new.id,
    registration.id,
    new.recipient_entity_id,
    app_value,
    registration.expo_push_token,
    registration.expo_project_id,
    title_value,
    body_value,
    data_value,
    'notification:' || new.id::text || ':device:' || registration.id::text
  from public.push_device_registrations registration
  where registration.user_id = new.recipient_entity_id
    and registration.app_key = app_value
    and registration.is_active = true
    and registration.permission_status = 'granted'
  on conflict (idempotency_key) do nothing;

  return new;
end;
$$;

drop trigger if exists enqueue_skima_push_from_notification_message on public.notification_messages;
create trigger enqueue_skima_push_from_notification_message
after insert on public.notification_messages
for each row execute function public.enqueue_skima_push_from_notification_message();

-- Service-only atomic claim operation prevents two dispatcher invocations from
-- sending the same push rows at the same time.
create or replace function public.claim_skima_push_outbox(target_limit integer default 100)
returns setof public.push_notification_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role is required to dispatch push notifications';
  end if;

  return query
  with candidates as (
    select outbox.id
    from public.push_notification_outbox outbox
    where outbox.status in ('queued','failed')
      and outbox.next_attempt_at <= timezone('utc', now())
      and outbox.attempts < 8
    order by outbox.next_attempt_at, outbox.created_at
    for update skip locked
    limit greatest(1, least(coalesce(target_limit,100),500))
  )
  update public.push_notification_outbox outbox
  set status = 'sending',
      attempts = outbox.attempts + 1,
      updated_at = timezone('utc', now()),
      last_error = null
  from candidates
  where outbox.id = candidates.id
  returning outbox.*;
end;
$$;

revoke all on function public.enqueue_skima_push_from_notification_message() from public, anon, authenticated;
revoke all on function public.claim_skima_push_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_skima_push_outbox(integer) to service_role;

-- Activate one-minute dispatch automatically when the project administrator
-- has added the endpoint and service-role JWT to Supabase Vault. The secrets
-- are not committed to Git and are never returned by this migration.
do $$
declare
  endpoint_value text;
  service_role_value text;
  existing_job bigint;
begin
  select decrypted_secret into endpoint_value
  from vault.decrypted_secrets
  where name = 'skima_supabase_url'
  limit 1;
  select decrypted_secret into service_role_value
  from vault.decrypted_secrets
  where name = 'skima_service_role_key'
  limit 1;

  select jobid into existing_job
  from cron.job
  where jobname = 'skima-push-outbox-dispatch'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  if endpoint_value is not null and service_role_value is not null then
    perform cron.schedule(
      'skima-push-outbox-dispatch',
      '* * * * *',
      format(
        $job$select net.http_post(
          url := %L,
          headers := jsonb_build_object('Authorization', 'Bearer ' || %L, 'Content-Type', 'application/json'),
          body := '{"batchSize":100}'::jsonb,
          timeout_milliseconds := 15000
        );$job$,
        rtrim(endpoint_value,'/') || '/functions/v1/skima-push-dispatch',
        service_role_value
      )
    );
  end if;
end;
$$;

commit;
