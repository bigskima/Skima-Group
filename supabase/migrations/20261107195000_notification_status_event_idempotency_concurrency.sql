begin;

-- Serialize notification status transitions and recheck the event after
-- acquiring the message lock. Concurrent worker retries for the same
-- message/idempotency key now return the original result instead of failing
-- the entire worker batch with a duplicate unique-key violation.

create or replace function public.update_notification_message_status(
  target_notification_message_id uuid default null,
  target_status text default null,
  target_provider_message_id text default null,
  target_error_message text default null,
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  message_record record;
  existing_event record;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.notifications.manage', null) then
    raise exception 'platform notification management permission is required';
  end if;

  if target_notification_message_id is null then
    raise exception 'target_notification_message_id is required';
  end if;

  if target_status is null
    or target_status not in ('queued', 'sent', 'delivered', 'failed', 'cancelled') then
    raise exception 'target_status is not supported';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  -- Fast path for an already committed event.
  select event.*
  into existing_event
  from public.notification_message_events event
  where event.notification_message_id = target_notification_message_id
    and event.idempotency_key = target_idempotency_key;

  if found then
    if existing_event.status <> target_status
      or existing_event.provider_message_id is distinct from target_provider_message_id
      or existing_event.error_message is distinct from target_error_message
      or existing_event.metadata <> target_metadata then
      raise exception 'target_idempotency_key has already been used with different notification status details';
    end if;

    return target_notification_message_id;
  end if;

  -- A second worker may have inserted the event after the fast-path lookup.
  -- Locking the parent row serializes all status transitions for this message.
  select message.*
  into message_record
  from public.notification_messages message
  where message.id = target_notification_message_id
  for update;

  if not found then
    raise exception 'target_notification_message_id must reference an existing notification message';
  end if;

  -- Recheck after acquiring the row lock. The previous function skipped this
  -- step, allowing a waiting worker to race into the same unique event insert.
  select event.*
  into existing_event
  from public.notification_message_events event
  where event.notification_message_id = target_notification_message_id
    and event.idempotency_key = target_idempotency_key;

  if found then
    if existing_event.status <> target_status
      or existing_event.provider_message_id is distinct from target_provider_message_id
      or existing_event.error_message is distinct from target_error_message
      or existing_event.metadata <> target_metadata then
      raise exception 'target_idempotency_key has already been used with different notification status details';
    end if;

    return target_notification_message_id;
  end if;

  if message_record.status in ('delivered', 'failed', 'cancelled')
    and message_record.status <> target_status then
    raise exception 'terminal notification messages cannot change status';
  end if;

  if message_record.status = 'queued'
    and target_status not in ('queued', 'sent', 'failed', 'cancelled') then
    raise exception 'queued notification messages cannot move to target_status';
  end if;

  if message_record.status = 'sent'
    and target_status not in ('sent', 'delivered', 'failed', 'cancelled') then
    raise exception 'sent notification messages cannot move to target_status';
  end if;

  update public.notification_messages
  set status = target_status,
      provider_message_id = coalesce(target_provider_message_id, provider_message_id),
      error_message = target_error_message,
      sent_at = case
        when target_status = 'sent' and sent_at is null then timezone('utc', now())
        else sent_at
      end,
      delivered_at = case
        when target_status = 'delivered' and delivered_at is null then timezone('utc', now())
        else delivered_at
      end,
      updated_at = timezone('utc', now())
  where id = target_notification_message_id;

  insert into public.notification_message_events (
    notification_message_id,
    status,
    provider_message_id,
    error_message,
    idempotency_key,
    metadata
  )
  values (
    target_notification_message_id,
    target_status,
    target_provider_message_id,
    target_error_message,
    target_idempotency_key,
    target_metadata
  )
  on conflict (notification_message_id, idempotency_key) do nothing;

  -- Defend against a concurrent writer that committed between our locked
  -- recheck and insert, and preserve strict same-key/same-payload semantics.
  if not found then
    select event.*
    into existing_event
    from public.notification_message_events event
    where event.notification_message_id = target_notification_message_id
      and event.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'notification status event idempotency lookup failed';
    end if;

    if existing_event.status <> target_status
      or existing_event.provider_message_id is distinct from target_provider_message_id
      or existing_event.error_message is distinct from target_error_message
      or existing_event.metadata <> target_metadata then
      raise exception 'target_idempotency_key has already been used with different notification status details';
    end if;
  end if;

  return target_notification_message_id;
end;
$$;

commit;
