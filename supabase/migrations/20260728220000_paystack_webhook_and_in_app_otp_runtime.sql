begin;

create extension if not exists pgcrypto with schema extensions;

insert into public.provider_adapters (provider_kind, key, display_name, status, config, secret_ref)
values (
  'payment',
  'provider.payment.paystack',
  'Paystack NGN Payment Adapter',
  'active',
  '{
    "provider":"paystack",
    "currency":"NGN",
    "mode":"live_or_test_by_secret",
    "country":"NG",
    "supports":["initialize_payment","verify_transaction","process_webhook","resolve_bank_account","create_transfer_recipient","initiate_transfer","verify_transfer"],
    "initialize_endpoint":"https://api.paystack.co/transaction/initialize",
    "webhook_signature":{"header":"x-paystack-signature","algorithm":"hmac_sha512","secret_ref":"SUPABASE_SECRET:PAYSTACK_SECRET_KEY"},
    "secret_refs":{"secret_key":"SUPABASE_SECRET:PAYSTACK_SECRET_KEY","public_key":"SUPABASE_SECRET:PAYSTACK_PUBLIC_KEY"},
    "amount_unit":"kobo"
  }'::jsonb,
  'SUPABASE_SECRET:PAYSTACK_SECRET_KEY'
)
on conflict (provider_kind, key) do update
set display_name = excluded.display_name,
    status = excluded.status,
    config = public.provider_adapters.config || excluded.config,
    secret_ref = excluded.secret_ref,
    updated_at = timezone('utc', now());

create or replace function public.require_verified_payment_webhook_event()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.signature_verified is distinct from true then
    raise exception 'payment webhook signature verification is required';
  end if;

  return new;
end;
$$;

drop trigger if exists require_verified_payment_webhook_event_insert
on public.payment_webhook_events;

create trigger require_verified_payment_webhook_event_insert
before insert on public.payment_webhook_events
for each row execute function public.require_verified_payment_webhook_event();

create table if not exists public.otp_delivery_codes (
  otp_challenge_id uuid primary key references public.otp_challenges(id) on delete cascade,
  code text not null
    check (code ~ '^[0-9]{4,10}$'),
  delivery_view_count integer not null default 0
    check (delivery_view_count >= 0),
  max_delivery_views integer not null default 3
    check (max_delivery_views > 0 and max_delivery_views <= 10),
  expires_at timestamptz not null,
  first_delivered_at timestamptz,
  last_delivered_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.otp_delivery_code_accesses (
  id uuid primary key default gen_random_uuid(),
  otp_challenge_id uuid not null references public.otp_challenges(id) on delete cascade,
  communication_message_id uuid references public.communication_messages(id) on delete set null,
  actor_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  status text not null default 'delivered'
    check (status in ('delivered', 'denied', 'expired', 'locked')),
  source text not null default 'platform.otp_delivery'
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (otp_challenge_id, idempotency_key)
);

create index if not exists otp_delivery_code_accesses_challenge_idx
on public.otp_delivery_code_accesses (otp_challenge_id, created_at desc);

drop trigger if exists set_otp_delivery_codes_updated_at on public.otp_delivery_codes;
create trigger set_otp_delivery_codes_updated_at
before update on public.otp_delivery_codes
for each row execute function public.set_updated_at();

drop trigger if exists prevent_otp_delivery_code_accesses_update on public.otp_delivery_code_accesses;
create trigger prevent_otp_delivery_code_accesses_update
before update on public.otp_delivery_code_accesses
for each row execute function public.prevent_finance_communication_event_mutation();

drop trigger if exists prevent_otp_delivery_code_accesses_delete on public.otp_delivery_code_accesses;
create trigger prevent_otp_delivery_code_accesses_delete
before delete on public.otp_delivery_code_accesses
for each row execute function public.prevent_finance_communication_event_mutation();

alter table public.otp_delivery_codes enable row level security;
alter table public.otp_delivery_code_accesses enable row level security;

revoke all on public.otp_delivery_codes from anon, authenticated;
revoke all on public.otp_delivery_code_accesses from anon, authenticated;

create policy otp_delivery_codes_no_direct_select on public.otp_delivery_codes
for select to authenticated using (false);
create policy otp_delivery_codes_no_direct_insert on public.otp_delivery_codes
for insert to authenticated with check (false);
create policy otp_delivery_codes_no_direct_update on public.otp_delivery_codes
for update to authenticated using (false) with check (false);
create policy otp_delivery_codes_no_direct_delete on public.otp_delivery_codes
for delete to authenticated using (false);

create policy otp_delivery_code_accesses_select_owner_or_privileged
on public.otp_delivery_code_accesses
for select to authenticated
using (
  exists (
    select 1
    from public.otp_challenges challenge
    where challenge.id = otp_delivery_code_accesses.otp_challenge_id
      and (
        challenge.user_id = auth.uid()
        or public.has_permission('platform.communications.manage', null)
      )
  )
);
create policy otp_delivery_code_accesses_no_direct_insert
on public.otp_delivery_code_accesses
for insert to authenticated with check (false);
create policy otp_delivery_code_accesses_no_direct_update
on public.otp_delivery_code_accesses
for update to authenticated using (false) with check (false);
create policy otp_delivery_code_accesses_no_direct_delete
on public.otp_delivery_code_accesses
for delete to authenticated using (false);

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
      abs(
        ('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint
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
        'purpose',
        target_purpose,
        'expires_in_seconds',
        target_ttl_seconds,
        'redacted',
        true,
        'delivery_mode',
        'backend_in_app_fetch'
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
    target_metadata || jsonb_build_object('otp_delivery', true, 'otp_redacted', true)
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
        true,
        'delivery_mode',
        'backend_in_app_fetch',
        'fetch_path',
        '/runtime/otp/delivery'
      )
    ),
    target_source,
    target_idempotency_key || ':communication',
    target_metadata || jsonb_build_object('otp_delivery', true, 'otp_redacted', true),
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
    target_metadata || jsonb_build_object('otp_delivery', true, 'otp_redacted', true)
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
    target_metadata || jsonb_build_object('otp_delivery_mode', 'backend_in_app_fetch'),
    auth.uid()
  )
  returning id into challenge_id;

  insert into public.otp_delivery_codes (
    otp_challenge_id,
    code,
    expires_at,
    created_by
  )
  values (
    challenge_id,
    otp_code,
    timezone('utc', now()) + make_interval(secs => target_ttl_seconds),
    auth.uid()
  );

  return challenge_id;
end;
$$;

create or replace function public.fetch_in_app_otp_code(
  target_challenge_id uuid default null,
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  challenge_record record;
  delivery_record record;
  access_status text := 'delivered';
begin
  if auth.uid() is null
    and auth.role() <> 'service_role'
    and not public.has_permission('platform.communications.manage', null) then
    raise exception 'authenticated user is required';
  end if;

  if target_challenge_id is null then
    raise exception 'target_challenge_id is required';
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

  if challenge_record.channel <> 'in_app' then
    raise exception 'OTP in-app delivery is only available for in_app challenges';
  end if;

  select delivery.*
  into delivery_record
  from public.otp_delivery_codes delivery
  where delivery.otp_challenge_id = challenge_record.id
  for update;

  if not found then
    raise exception 'OTP delivery code is unavailable';
  end if;

  if challenge_record.status in ('verified', 'cancelled') then
    access_status := 'locked';
  elsif challenge_record.status in ('expired', 'locked') then
    access_status := challenge_record.status;
  elsif challenge_record.expires_at <= timezone('utc', now())
    or delivery_record.expires_at <= timezone('utc', now()) then
    access_status := 'expired';

    update public.otp_challenges
    set status = 'expired',
        updated_at = timezone('utc', now())
    where id = challenge_record.id;
  elsif delivery_record.delivery_view_count >= delivery_record.max_delivery_views then
    access_status := 'locked';
  end if;

  insert into public.otp_delivery_code_accesses (
    otp_challenge_id,
    communication_message_id,
    actor_user_id,
    status,
    source,
    idempotency_key,
    metadata
  )
  values (
    challenge_record.id,
    challenge_record.communication_message_id,
    auth.uid(),
    access_status,
    'platform.otp_delivery',
    target_idempotency_key,
    target_metadata
  )
  on conflict do nothing;

  if access_status <> 'delivered' then
    raise exception 'OTP delivery is not available';
  end if;

  update public.otp_delivery_codes
  set delivery_view_count = delivery_view_count + 1,
      first_delivered_at = coalesce(first_delivered_at, timezone('utc', now())),
      last_delivered_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where otp_challenge_id = challenge_record.id
  returning * into delivery_record;

  update public.communication_messages
  set status = 'delivered',
      sent_at = coalesce(sent_at, timezone('utc', now())),
      delivered_at = coalesce(delivered_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
  where id = challenge_record.communication_message_id
    and status in ('queued', 'sent');

  insert into public.communication_events (
    communication_message_id,
    status,
    provider_message_id,
    idempotency_key,
    metadata,
    created_by
  )
  values (
    challenge_record.communication_message_id,
    'delivered',
    'supabase-in-app-otp',
    target_idempotency_key || ':communication:delivered',
    target_metadata || jsonb_build_object('otp_delivery', true, 'delivery_mode', 'backend_in_app_fetch'),
    auth.uid()
  )
  on conflict do nothing;

  return jsonb_build_object(
    'challengeId',
    challenge_record.id,
    'code',
    delivery_record.code,
    'expiresAt',
    challenge_record.expires_at,
    'purpose',
    challenge_record.purpose,
    'remainingDeliveryViews',
    greatest(delivery_record.max_delivery_views - delivery_record.delivery_view_count, 0)
  );
end;
$$;

revoke all on function public.fetch_in_app_otp_code(uuid, text, jsonb) from public;
grant execute on function public.fetch_in_app_otp_code(uuid, text, jsonb) to authenticated;

commit;
