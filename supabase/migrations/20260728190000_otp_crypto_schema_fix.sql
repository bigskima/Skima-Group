begin;

create extension if not exists pgcrypto with schema extensions;

create or replace function public.request_otp_challenge(
  target_purpose text default null,
  target_channel text default null,
  target_recipient_address text default null,
  target_ttl_seconds integer default 600,
  target_max_attempts integer default 5,
  target_source text default 'platform.otp_engine',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  otp_code text;
  challenge_id uuid := gen_random_uuid();
  communication_id uuid;
  notification_id uuid;
  provider_record record;
  existing_record record;
begin
  if auth.uid() is null then
    raise exception 'authenticated user is required';
  end if;

  if target_purpose is null or target_purpose !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_purpose must be a valid platform key';
  end if;

  if target_channel not in ('sms', 'email', 'whatsapp', 'in_app') then
    raise exception 'target_channel is not supported for OTP';
  end if;

  if target_recipient_address is null or btrim(target_recipient_address) = '' then
    raise exception 'target_recipient_address is required';
  end if;

  if target_ttl_seconds is null or target_ttl_seconds < 60 or target_ttl_seconds > 1800 then
    raise exception 'target_ttl_seconds must be between 60 and 1800';
  end if;

  if target_max_attempts is null or target_max_attempts < 1 or target_max_attempts > 10 then
    raise exception 'target_max_attempts must be between 1 and 10';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select existing.*
  into existing_record
  from public.otp_challenges existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if found then
    return existing_record.id;
  end if;

  otp_code := lpad(
    (
      (
        ('x' || substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 8))::bit(32)::bigint
      ) % 1000000
    )::text,
    6,
    '0'
  );

  select provider.*
  into provider_record
  from public.provider_adapters provider
  where provider.provider_kind = 'notification'
    and provider.key = 'provider.communication.sandbox'
    and provider.status = 'active';

  if not found then
    raise exception 'active communication provider adapter is required for OTP delivery';
  end if;

  insert into public.notification_messages (
    channel,
    recipient_entity_type,
    recipient_entity_id,
    recipient_address,
    status,
    provider_adapter_id,
    payload,
    created_by,
    source,
    idempotency_key
  )
  values (
    target_channel,
    'platform.otp_delivery',
    challenge_id,
    target_recipient_address,
    'queued',
    provider_record.id,
    jsonb_build_object(
      'otp',
      jsonb_build_object(
        'code',
        otp_code,
        'purpose',
        target_purpose,
        'expires_in_seconds',
        target_ttl_seconds
      )
    ),
    auth.uid(),
    target_source,
    target_idempotency_key || ':notification'
  )
  returning id into notification_id;

  insert into public.notification_message_events (
    notification_message_id,
    status,
    idempotency_key,
    metadata
  )
  values (
    notification_id,
    'queued',
    target_idempotency_key || ':notification:queued',
    target_metadata || jsonb_build_object('otp_delivery', true)
  )
  on conflict do nothing;

  insert into public.communication_messages (
    notification_message_id,
    provider_adapter_id,
    channel,
    purpose,
    recipient_entity_type,
    recipient_entity_id,
    recipient_address,
    status,
    payload,
    source,
    idempotency_key,
    metadata,
    created_by
  )
  values (
    notification_id,
    provider_record.id,
    target_channel,
    target_purpose,
    'user',
    auth.uid(),
    target_recipient_address,
    'queued',
    jsonb_build_object(
      'otp',
      jsonb_build_object(
        'purpose',
        target_purpose,
        'expires_in_seconds',
        target_ttl_seconds,
        'redacted',
        true
      )
    ),
    target_source,
    target_idempotency_key || ':communication',
    target_metadata || jsonb_build_object('otp_delivery', true),
    auth.uid()
  )
  returning id into communication_id;

  insert into public.communication_events (
    communication_message_id,
    status,
    idempotency_key,
    metadata
  )
  values (
    communication_id,
    'queued',
    target_idempotency_key || ':communication:queued',
    target_metadata || jsonb_build_object('otp_delivery', true)
  );

  insert into public.otp_challenges (
    id,
    user_id,
    communication_message_id,
    purpose,
    channel,
    recipient_address,
    code_hash,
    status,
    expires_at,
    max_attempts,
    attempt_count,
    source,
    idempotency_key,
    metadata,
    created_by
  )
  values (
    challenge_id,
    auth.uid(),
    communication_id,
    target_purpose,
    target_channel,
    target_recipient_address,
    extensions.crypt(otp_code, extensions.gen_salt('bf'::text)),
    'pending',
    timezone('utc', now()) + make_interval(secs => target_ttl_seconds),
    target_max_attempts,
    0,
    target_source,
    target_idempotency_key,
    target_metadata,
    auth.uid()
  )
  returning id into challenge_id;

  return challenge_id;
end;
$$;

create or replace function public.verify_otp_challenge(
  target_challenge_id uuid default null,
  target_code text default null,
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  challenge_record record;
  attempt_status text;
begin
  if auth.uid() is null
    and auth.role() <> 'service_role'
    and not public.has_permission('platform.communications.manage', null) then
    raise exception 'authenticated user is required';
  end if;

  if target_challenge_id is null then
    raise exception 'target_challenge_id is required';
  end if;

  if target_code is null or target_code !~ '^[0-9]{4,10}$' then
    raise exception 'target_code must be a numeric OTP code';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select challenge.*
  into challenge_record
  from public.otp_challenges challenge
  where challenge.id = target_challenge_id
  for update;

  if not found then
    raise exception 'target_challenge_id must reference an OTP challenge';
  end if;

  if auth.role() <> 'service_role'
    and not public.has_permission('platform.communications.manage', null)
    and challenge_record.user_id <> auth.uid() then
    raise exception 'OTP challenge access permission is required';
  end if;

  if challenge_record.status = 'verified' then
    return challenge_record.id;
  end if;

  if challenge_record.status in ('expired', 'locked', 'cancelled') then
    attempt_status := case when challenge_record.status = 'cancelled' then 'locked' else challenge_record.status end;
  elsif challenge_record.expires_at <= timezone('utc', now()) then
    attempt_status := 'expired';
    update public.otp_challenges
    set status = 'expired',
        updated_at = timezone('utc', now())
    where id = challenge_record.id;
  elsif challenge_record.attempt_count >= challenge_record.max_attempts then
    attempt_status := 'locked';
    update public.otp_challenges
    set status = 'locked',
        updated_at = timezone('utc', now())
    where id = challenge_record.id;
  elsif extensions.crypt(target_code, challenge_record.code_hash) = challenge_record.code_hash then
    attempt_status := 'accepted';
    update public.otp_challenges
    set status = 'verified',
        attempt_count = attempt_count + 1,
        verified_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = challenge_record.id;
  else
    attempt_status := 'rejected';
    update public.otp_challenges
    set attempt_count = attempt_count + 1,
        status = case when attempt_count + 1 >= max_attempts then 'locked' else status end,
        updated_at = timezone('utc', now())
    where id = challenge_record.id;
  end if;

  insert into public.otp_attempts (
    otp_challenge_id,
    status,
    idempotency_key,
    metadata,
    created_by
  )
  values (
    challenge_record.id,
    attempt_status,
    target_idempotency_key,
    target_metadata,
    auth.uid()
  )
  on conflict do nothing;

  if attempt_status <> 'accepted' then
    raise exception 'OTP verification failed';
  end if;

  return challenge_record.id;
end;
$$;

commit;
