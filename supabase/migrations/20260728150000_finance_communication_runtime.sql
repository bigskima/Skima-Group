begin;

create extension if not exists pgcrypto with schema extensions;

insert into public.permissions (key, description, risk_level)
values
  ('platform.payments.read', 'Read payment deposit and provider verification records.', 'critical'),
  ('platform.payments.execute', 'Execute payment deposit verification and reversals.', 'critical'),
  ('platform.withdrawals.read', 'Read withdrawal beneficiary, request, and transfer records.', 'critical'),
  ('platform.withdrawals.execute', 'Approve, process, fail, or reverse withdrawal transfers.', 'critical'),
  ('platform.commissions.execute', 'Execute configured commission policies.', 'critical'),
  ('platform.communications.read', 'Read communication and OTP operational records.', 'high'),
  ('platform.communications.manage', 'Queue and manage communication messages and OTP challenges.', 'high')
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    updated_at = timezone('utc', now());

insert into public.provider_adapters (provider_kind, key, display_name, status, config, secret_ref)
values
  (
    'payment',
    'provider.payment.sandbox',
    'Sandbox NGN Payment Adapter',
    'active',
    '{
      "currency":"NGN",
      "mode":"sandbox",
      "supports":["initialize_payment","verify_transaction","process_webhook","resolve_bank_account","create_transfer_recipient","initiate_transfer","verify_transfer"]
    }'::jsonb,
    'SKIMA_PAYMENT_SANDBOX_SECRET'
  ),
  (
    'notification',
    'provider.communication.sandbox',
    'Sandbox Communication Adapter',
    'active',
    '{
      "mode":"sandbox",
      "channels":["email","sms","whatsapp","in_app","push"],
      "delivery":"runtime-worker"
    }'::jsonb,
    'SKIMA_COMMUNICATION_SANDBOX_SECRET'
  )
on conflict (provider_kind, key) do update
set display_name = excluded.display_name,
    status = excluded.status,
    config = public.provider_adapters.config || excluded.config,
    secret_ref = excluded.secret_ref,
    updated_at = timezone('utc', now());

create table if not exists public.payment_deposit_requests (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallet_accounts(id) on delete restrict,
  customer_user_id uuid not null references public.profiles(id) on delete restrict,
  provider_adapter_id uuid references public.provider_adapters(id) on delete set null,
  provider_execution_log_id uuid references public.provider_execution_logs(id) on delete set null,
  transaction_id uuid references public.financial_transactions(id) on delete set null,
  reversal_transaction_id uuid references public.financial_transactions(id) on delete set null,
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  amount numeric(28, 8) not null check (amount > 0),
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed', 'reversed', 'cancelled')),
  provider_reference text not null,
  checkout_url text,
  source text not null
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  initialized_at timestamptz not null default timezone('utc', now()),
  verified_at timestamptz,
  failed_at timestamptz,
  reversed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key),
  unique (provider_adapter_id, provider_reference)
);

create table if not exists public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  deposit_request_id uuid references public.payment_deposit_requests(id) on delete set null,
  provider_adapter_id uuid references public.provider_adapters(id) on delete set null,
  event_type text not null
    check (event_type in ('deposit.succeeded', 'deposit.failed', 'deposit.reversed', 'provider.unknown')),
  provider_reference text,
  signature_verified boolean not null default false,
  status text not null default 'received'
    check (status in ('received', 'processed', 'duplicate', 'rejected')),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  source text not null
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create table if not exists public.withdrawal_beneficiaries (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete restrict,
  wallet_id uuid not null references public.wallet_accounts(id) on delete restrict,
  provider_adapter_id uuid references public.provider_adapters(id) on delete set null,
  provider_execution_log_id uuid references public.provider_execution_logs(id) on delete set null,
  beneficiary_type text not null default 'bank_account'
    check (beneficiary_type in ('bank_account', 'mobile_money', 'other')),
  bank_code text,
  account_number_last4 text,
  account_reference_hash text not null,
  account_name text not null,
  provider_recipient_code text,
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'disabled', 'failed')),
  source text not null
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  verified_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key),
  unique (wallet_id, account_reference_hash)
);

create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallet_accounts(id) on delete restrict,
  beneficiary_id uuid not null references public.withdrawal_beneficiaries(id) on delete restrict,
  provider_adapter_id uuid references public.provider_adapters(id) on delete set null,
  reserve_transaction_id uuid references public.financial_transactions(id) on delete set null,
  reversal_transaction_id uuid references public.financial_transactions(id) on delete set null,
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  amount numeric(28, 8) not null check (amount > 0),
  fee_amount numeric(28, 8) not null default 0 check (fee_amount >= 0),
  total_debit_amount numeric(28, 8) generated always as (amount + fee_amount) stored,
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'processing', 'succeeded', 'failed', 'reversed', 'cancelled')),
  provider_reference text,
  source text not null
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  requested_by uuid references public.profiles(id) on delete set null default auth.uid(),
  approved_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default timezone('utc', now()),
  approved_at timestamptz,
  processed_at timestamptz,
  failed_at timestamptz,
  reversed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create table if not exists public.transfer_executions (
  id uuid primary key default gen_random_uuid(),
  withdrawal_request_id uuid not null references public.withdrawal_requests(id) on delete cascade,
  provider_adapter_id uuid references public.provider_adapters(id) on delete set null,
  provider_execution_log_id uuid references public.provider_execution_logs(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'succeeded', 'failed', 'reversed')),
  provider_reference text,
  response_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(response_payload) = 'object'),
  source text not null
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create table if not exists public.withdrawal_events (
  id uuid primary key default gen_random_uuid(),
  withdrawal_request_id uuid not null references public.withdrawal_requests(id) on delete cascade,
  event_type text not null
    check (event_type in ('requested', 'approved', 'processing', 'succeeded', 'failed', 'reversed', 'cancelled')),
  status text not null,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  unique (withdrawal_request_id, idempotency_key)
);

create table if not exists public.commission_policies (
  id uuid primary key default gen_random_uuid(),
  key text not null
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  scope_type text not null default 'global'
    check (scope_type in ('global', 'module', 'organization', 'driver', 'vehicle')),
  scope_id uuid,
  calculation_mode text not null
    check (calculation_mode in ('fixed', 'percentage', 'hybrid')),
  fixed_amount numeric(28, 8) not null default 0 check (fixed_amount >= 0),
  percentage_rate numeric(10, 6) not null default 0 check (percentage_rate >= 0),
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  trigger_event_key text references public.event_types(key) on delete set null,
  status text not null default 'active'
    check (status in ('draft', 'active', 'retired')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists commission_policies_scope_key_unique
on public.commission_policies (
  key,
  scope_type,
  coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

create table if not exists public.commission_executions (
  id uuid primary key default gen_random_uuid(),
  service_request_id uuid references public.service_requests(id) on delete set null,
  order_id uuid references public.order_records(id) on delete set null,
  escrow_hold_id uuid not null references public.escrow_holds(id) on delete restrict,
  driver_wallet_id uuid not null references public.wallet_accounts(id) on delete restrict,
  commission_policy_id uuid references public.commission_policies(id) on delete set null,
  transaction_id uuid references public.financial_transactions(id) on delete set null,
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  amount numeric(28, 8) not null check (amount > 0),
  status text not null default 'posted'
    check (status in ('pending', 'posted', 'failed', 'reversed')),
  policy_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(policy_snapshot) = 'object'),
  source text not null
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create table if not exists public.settlement_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  wallet_id uuid not null references public.wallet_accounts(id) on delete restrict,
  beneficiary_id uuid references public.withdrawal_beneficiaries(id) on delete set null,
  settlement_mode text not null default 'manual'
    check (settlement_mode in ('manual', 'scheduled', 'automatic')),
  status text not null default 'active'
    check (status in ('pending', 'active', 'suspended', 'disabled')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  source text not null
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key),
  unique (organization_id, wallet_id)
);

create table if not exists public.settlement_statements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  service_request_id uuid references public.service_requests(id) on delete set null,
  order_id uuid references public.order_records(id) on delete set null,
  escrow_hold_id uuid not null references public.escrow_holds(id) on delete restrict,
  settlement_execution_id uuid references public.settlement_executions(id) on delete set null,
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  gross_amount numeric(28, 8) not null check (gross_amount >= 0),
  platform_fee_amount numeric(28, 8) not null default 0 check (platform_fee_amount >= 0),
  net_amount numeric(28, 8) not null check (net_amount >= 0),
  status text not null default 'posted'
    check (status in ('pending', 'posted', 'failed', 'reversed')),
  period_start timestamptz,
  period_end timestamptz,
  source text not null
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key),
  check (gross_amount = platform_fee_amount + net_amount)
);

create table if not exists public.communication_messages (
  id uuid primary key default gen_random_uuid(),
  notification_message_id uuid references public.notification_messages(id) on delete set null,
  provider_adapter_id uuid references public.provider_adapters(id) on delete set null,
  channel text not null
    check (channel in ('push', 'sms', 'email', 'whatsapp', 'voice', 'in_app', 'future')),
  purpose text not null
    check (purpose ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  recipient_entity_type text not null
    check (recipient_entity_type ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  recipient_entity_id uuid,
  recipient_address text,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'failed', 'cancelled', 'dead_lettered')),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  source text not null
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  queued_at timestamptz not null default timezone('utc', now()),
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create table if not exists public.communication_events (
  id uuid primary key default gen_random_uuid(),
  communication_message_id uuid not null references public.communication_messages(id) on delete cascade,
  status text not null
    check (status in ('queued', 'sent', 'delivered', 'failed', 'cancelled', 'dead_lettered')),
  provider_message_id text,
  error_message text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  unique (communication_message_id, idempotency_key)
);

create table if not exists public.otp_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  communication_message_id uuid references public.communication_messages(id) on delete set null,
  purpose text not null
    check (purpose ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  channel text not null
    check (channel in ('sms', 'email', 'whatsapp', 'in_app')),
  recipient_address text not null,
  code_hash text not null,
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'expired', 'locked', 'cancelled')),
  expires_at timestamptz not null,
  max_attempts integer not null default 5 check (max_attempts > 0 and max_attempts <= 10),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  verified_at timestamptz,
  source text not null
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create table if not exists public.otp_attempts (
  id uuid primary key default gen_random_uuid(),
  otp_challenge_id uuid not null references public.otp_challenges(id) on delete cascade,
  status text not null
    check (status in ('accepted', 'rejected', 'expired', 'locked')),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  unique (otp_challenge_id, idempotency_key)
);

create index if not exists payment_deposit_requests_wallet_status_idx
on public.payment_deposit_requests (wallet_id, status, created_at desc);

create index if not exists withdrawal_requests_wallet_status_idx
on public.withdrawal_requests (wallet_id, status, created_at desc);

create index if not exists commission_executions_order_status_idx
on public.commission_executions (order_id, status, created_at desc);

create index if not exists communication_messages_status_idx
on public.communication_messages (status, queued_at);

create index if not exists otp_challenges_user_status_idx
on public.otp_challenges (user_id, purpose, status, expires_at desc);

create or replace function public.can_access_wallet_account(target_wallet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.role() = 'service_role'
    or public.has_permission('platform.wallets.read', null)
    or public.has_permission('platform.wallets.manage', null)
    or public.has_permission('platform.financial.manage', null)
    or exists (
      select 1
      from public.wallet_accounts wallet
      where wallet.id = target_wallet_id
        and wallet.owner_entity_type = 'user'
        and wallet.owner_entity_id = auth.uid()
    )
    or exists (
      select 1
      from public.wallet_accounts wallet
      join public.organization_memberships membership
        on membership.organization_id = wallet.owner_entity_id
       and membership.user_id = auth.uid()
       and membership.status = 'active'
      where wallet.id = target_wallet_id
        and wallet.owner_entity_type = 'organization'
        and (
          public.has_permission('business.finance.read', wallet.owner_entity_id)
          or public.has_permission('business.finance.manage', wallet.owner_entity_id)
          or public.has_permission('business.settlements.read', wallet.owner_entity_id)
        )
    );
$$;

create or replace function public.can_execute_financial_runtime()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.role() = 'service_role'
    or public.has_permission('platform.financial.manage', null)
    or public.has_permission('platform.payments.execute', null)
    or public.has_permission('platform.withdrawals.execute', null)
    or public.has_permission('platform.settlement.execute', null)
    or public.has_permission('platform.commissions.execute', null)
    or public.can_execute_platform_runtime();
$$;

create or replace function public.prevent_finance_communication_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'finance and communication runtime event records are append-only';
end;
$$;

create or replace function public.ensure_platform_clearing_wallet(
  target_currency_code text default 'NGN',
  target_source text default 'platform.financial_gateway',
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  wallet_id uuid;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.financial.manage', null)
    and not public.can_execute_platform_runtime() then
    raise exception 'platform financial management permission is required';
  end if;

  wallet_id := public.ensure_wallet_account(
    'platform',
    'platform',
    null,
    coalesce(target_currency_code, 'NGN'),
    coalesce(target_source, 'platform.financial_gateway'),
    '{"wallet_purpose":"settlement_clearing"}'::jsonb,
    coalesce(target_idempotency_key, 'platform-clearing:' || coalesce(target_currency_code, 'NGN'))
  );

  return wallet_id;
end;
$$;

create or replace function public.record_withdrawal_event(
  target_withdrawal_request_id uuid,
  target_event_type text,
  target_status text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  event_id uuid;
begin
  if target_withdrawal_request_id is null then
    raise exception 'target_withdrawal_request_id is required';
  end if;

  if target_event_type not in ('requested', 'approved', 'processing', 'succeeded', 'failed', 'reversed', 'cancelled') then
    raise exception 'target_event_type is not supported';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  insert into public.withdrawal_events (
    withdrawal_request_id,
    event_type,
    status,
    idempotency_key,
    metadata,
    created_by
  )
  values (
    target_withdrawal_request_id,
    target_event_type,
    target_status,
    target_idempotency_key,
    target_metadata,
    auth.uid()
  )
  on conflict (withdrawal_request_id, idempotency_key) do nothing
  returning id into event_id;

  if event_id is null then
    select event.id
    into event_id
    from public.withdrawal_events event
    where event.withdrawal_request_id = target_withdrawal_request_id
      and event.idempotency_key = target_idempotency_key;
  end if;

  return event_id;
end;
$$;

create or replace function public.insert_provider_execution_log(
  target_provider_adapter_id uuid,
  target_provider_kind text,
  target_operation_key text,
  target_status text,
  target_request_payload jsonb,
  target_response_payload jsonb,
  target_idempotency_key text,
  target_error_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  provider_log_id uuid;
  existing_record record;
begin
  if target_provider_kind not in ('payment', 'storage', 'maps', 'notification', 'ai', 'queue', 'cache', 'observability') then
    raise exception 'target_provider_kind is not supported';
  end if;

  if target_operation_key is null or target_operation_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_operation_key must be a valid platform key';
  end if;

  if target_status not in ('queued', 'succeeded', 'failed', 'dead_lettered') then
    raise exception 'target_status is not supported';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_request_payload is null or jsonb_typeof(target_request_payload) <> 'object'
    or target_response_payload is null or jsonb_typeof(target_response_payload) <> 'object' then
    raise exception 'provider execution payloads must be JSON objects';
  end if;

  insert into public.provider_execution_logs (
    provider_adapter_id,
    provider_kind,
    operation_key,
    status,
    request_payload,
    response_payload,
    idempotency_key,
    error_message,
    created_by
  )
  values (
    target_provider_adapter_id,
    target_provider_kind,
    target_operation_key,
    target_status,
    target_request_payload,
    target_response_payload,
    target_idempotency_key,
    target_error_message,
    auth.uid()
  )
  on conflict (provider_kind, operation_key, idempotency_key) do nothing
  returning id into provider_log_id;

  if provider_log_id is null then
    select existing.*
    into existing_record
    from public.provider_execution_logs existing
    where existing.provider_kind = target_provider_kind
      and existing.operation_key = target_operation_key
      and existing.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'provider execution idempotency lookup failed';
    end if;

    return existing_record.id;
  end if;

  return provider_log_id;
end;
$$;

create or replace function public.initialize_wallet_deposit(
  target_wallet_id uuid default null,
  target_amount numeric default null,
  target_currency_code text default 'NGN',
  target_provider_adapter_key text default 'provider.payment.sandbox',
  target_source text default 'platform.payment_engine',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_wallet record;
  provider_record record;
  deposit_id uuid := gen_random_uuid();
  deposit_reference text;
  provider_log_id uuid;
  existing_record record;
begin
  if auth.uid() is null then
    raise exception 'authenticated user is required';
  end if;

  if target_amount is null or target_amount <= 0 then
    raise exception 'target_amount must be greater than zero';
  end if;

  if target_currency_code is null or target_currency_code <> 'NGN' then
    raise exception 'NGN is the only enabled phase-one deposit currency';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select existing.*
  into existing_record
  from public.payment_deposit_requests existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if found then
    if existing_record.customer_user_id <> auth.uid()
      or existing_record.amount <> target_amount
      or existing_record.currency_code <> target_currency_code then
      raise exception 'target_idempotency_key has already been used with different deposit details';
    end if;

    return existing_record.id;
  end if;

  if target_wallet_id is null then
    target_wallet_id := public.ensure_wallet_account(
      'customer',
      'user',
      auth.uid(),
      target_currency_code,
      'platform.wallet_engine',
      '{"wallet_purpose":"customer_deposit"}'::jsonb,
      target_idempotency_key || ':wallet'
    );
  end if;

  select wallet.*
  into target_wallet
  from public.wallet_accounts wallet
  where wallet.id = target_wallet_id
    and wallet.status = 'active';

  if not found then
    raise exception 'target_wallet_id must reference an active wallet';
  end if;

  if target_wallet.owner_entity_type <> 'user'
    or target_wallet.owner_entity_id <> auth.uid()
    or target_wallet.wallet_type <> 'customer' then
    raise exception 'deposits can only fund the authenticated user customer wallet';
  end if;

  if target_wallet.currency_code <> target_currency_code then
    raise exception 'target_wallet_id currency must match target_currency_code';
  end if;

  select provider.*
  into provider_record
  from public.provider_adapters provider
  where provider.provider_kind = 'payment'
    and provider.key = target_provider_adapter_key
    and provider.status = 'active';

  if not found then
    raise exception 'target_provider_adapter_key must reference an active payment provider adapter';
  end if;

  deposit_reference := 'skima-deposit-' || replace(deposit_id::text, '-', '');

  provider_log_id := public.insert_provider_execution_log(
    provider_record.id,
    'payment',
    'provider.payment.initialize',
    'queued',
    jsonb_build_object('wallet_id', target_wallet_id, 'amount', target_amount, 'currency', target_currency_code),
    jsonb_build_object('provider_reference', deposit_reference, 'checkout_url', 'https://sandbox.skima.local/payments/' || deposit_id::text),
    target_idempotency_key || ':provider'
  );

  insert into public.payment_deposit_requests (
    id,
    wallet_id,
    customer_user_id,
    provider_adapter_id,
    provider_execution_log_id,
    currency_code,
    amount,
    status,
    provider_reference,
    checkout_url,
    source,
    idempotency_key,
    metadata,
    created_by
  )
  values (
    deposit_id,
    target_wallet_id,
    auth.uid(),
    provider_record.id,
    provider_log_id,
    target_currency_code,
    target_amount,
    'pending',
    deposit_reference,
    'https://sandbox.skima.local/payments/' || deposit_id::text,
    target_source,
    target_idempotency_key,
    target_metadata || jsonb_build_object('adapter_key', provider_record.key),
    auth.uid()
  );

  return deposit_id;
end;
$$;

create or replace function public.process_wallet_deposit_provider_event(
  target_deposit_request_id uuid default null,
  target_provider_reference text default null,
  target_provider_status text default null,
  target_signature_verified boolean default false,
  target_payload jsonb default '{}'::jsonb,
  target_source text default 'platform.payment_webhook',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  deposit_record record;
  clearing_wallet_id uuid;
  posted_transaction_id uuid;
  posted_reversal_transaction_id uuid;
  webhook_event_id uuid;
  event_type_value text;
begin
  if not public.can_execute_financial_runtime() then
    raise exception 'payment execution permission is required';
  end if;

  if target_provider_status not in ('succeeded', 'failed', 'reversed') then
    raise exception 'target_provider_status is not supported';
  end if;

  if target_payload is null or jsonb_typeof(target_payload) <> 'object'
    or target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'payment webhook JSON inputs must be objects';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_deposit_request_id is not null then
    select deposit.*
    into deposit_record
    from public.payment_deposit_requests deposit
    where deposit.id = target_deposit_request_id
    for update;
  else
    select deposit.*
    into deposit_record
    from public.payment_deposit_requests deposit
    where deposit.provider_reference = target_provider_reference
    for update;
  end if;

  if not found then
    raise exception 'target_deposit_request_id or target_provider_reference must reference a deposit request';
  end if;

  event_type_value := case target_provider_status
    when 'succeeded' then 'deposit.succeeded'
    when 'failed' then 'deposit.failed'
    when 'reversed' then 'deposit.reversed'
    else 'provider.unknown'
  end;

  insert into public.payment_webhook_events (
    deposit_request_id,
    provider_adapter_id,
    event_type,
    provider_reference,
    signature_verified,
    status,
    payload,
    source,
    idempotency_key,
    metadata,
    created_by
  )
  values (
    deposit_record.id,
    deposit_record.provider_adapter_id,
    event_type_value,
    coalesce(target_provider_reference, deposit_record.provider_reference),
    coalesce(target_signature_verified, false),
    'processed',
    target_payload,
    target_source,
    target_idempotency_key,
    target_metadata,
    auth.uid()
  )
  on conflict (source, idempotency_key) do nothing
  returning id into webhook_event_id;

  if webhook_event_id is null then
    return deposit_record.id;
  end if;

  if target_provider_status = 'succeeded' then
    if deposit_record.status = 'succeeded' then
      return deposit_record.id;
    end if;

    if deposit_record.status <> 'pending' then
      raise exception 'deposit request cannot be marked succeeded from its current status';
    end if;

    clearing_wallet_id := public.ensure_platform_clearing_wallet(
      deposit_record.currency_code,
      'platform.payment_engine',
      target_idempotency_key || ':clearing-wallet'
    );

    posted_transaction_id := public.post_financial_transaction(
      'payment',
      deposit_record.currency_code,
      'platform.payment_engine',
      'wallet_deposit',
      deposit_record.id,
      jsonb_build_array(
        jsonb_build_object(
          'wallet_id', clearing_wallet_id,
          'direction', 'debit',
          'amount', deposit_record.amount,
          'entry_type', 'principal',
          'metadata', jsonb_build_object('role', 'external_payment_clearing')
        ),
        jsonb_build_object(
          'wallet_id', deposit_record.wallet_id,
          'direction', 'credit',
          'amount', deposit_record.amount,
          'entry_type', 'principal',
          'metadata', jsonb_build_object('role', 'customer_wallet')
        )
      ),
      target_idempotency_key || ':financial',
      deposit_record.provider_adapter_id,
      coalesce(target_provider_reference, deposit_record.provider_reference),
      jsonb_build_object('deposit_request_id', deposit_record.id),
      target_metadata
    );

    update public.payment_deposit_requests
    set status = 'succeeded',
        transaction_id = posted_transaction_id,
        verified_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = deposit_record.id;

    return deposit_record.id;
  end if;

  if target_provider_status = 'failed' then
    if deposit_record.status = 'pending' then
      update public.payment_deposit_requests
      set status = 'failed',
          failed_at = timezone('utc', now()),
          updated_at = timezone('utc', now())
      where id = deposit_record.id;
    end if;

    return deposit_record.id;
  end if;

  if target_provider_status = 'reversed' then
    if deposit_record.status <> 'succeeded' then
      raise exception 'only succeeded deposits can be reversed';
    end if;

    clearing_wallet_id := public.ensure_platform_clearing_wallet(
      deposit_record.currency_code,
      'platform.payment_engine',
      target_idempotency_key || ':clearing-wallet'
    );

    posted_reversal_transaction_id := public.post_financial_transaction(
      'refund',
      deposit_record.currency_code,
      'platform.payment_engine',
      'wallet_deposit',
      deposit_record.id,
      jsonb_build_array(
        jsonb_build_object(
          'wallet_id', deposit_record.wallet_id,
          'direction', 'debit',
          'amount', deposit_record.amount,
          'entry_type', 'principal',
          'metadata', jsonb_build_object('role', 'customer_wallet_reversal')
        ),
        jsonb_build_object(
          'wallet_id', clearing_wallet_id,
          'direction', 'credit',
          'amount', deposit_record.amount,
          'entry_type', 'principal',
          'metadata', jsonb_build_object('role', 'external_payment_clearing')
        )
      ),
      target_idempotency_key || ':financial',
      deposit_record.provider_adapter_id,
      coalesce(target_provider_reference, deposit_record.provider_reference),
      jsonb_build_object('deposit_request_id', deposit_record.id, 'reversal_of_transaction_id', deposit_record.transaction_id),
      target_metadata
    );

    update public.payment_deposit_requests
    set status = 'reversed',
        reversal_transaction_id = posted_reversal_transaction_id,
        reversed_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = deposit_record.id;

    return deposit_record.id;
  end if;

  return deposit_record.id;
end;
$$;

create or replace function public.verify_wallet_deposit(
  target_deposit_request_id uuid default null,
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  deposit_record record;
begin
  if not public.can_execute_financial_runtime() then
    raise exception 'payment execution permission is required';
  end if;

  if target_deposit_request_id is null then
    raise exception 'target_deposit_request_id is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select deposit.*
  into deposit_record
  from public.payment_deposit_requests deposit
  where deposit.id = target_deposit_request_id;

  if not found then
    raise exception 'target_deposit_request_id must reference an existing deposit request';
  end if;

  perform public.insert_provider_execution_log(
    deposit_record.provider_adapter_id,
    'payment',
    'provider.payment.verify',
    'succeeded',
    jsonb_build_object('deposit_request_id', deposit_record.id, 'provider_reference', deposit_record.provider_reference),
    jsonb_build_object('status', 'succeeded', 'verified', true),
    target_idempotency_key || ':provider'
  );

  return public.process_wallet_deposit_provider_event(
    deposit_record.id,
    deposit_record.provider_reference,
    'succeeded',
    true,
    jsonb_build_object('provider_reference', deposit_record.provider_reference, 'sandbox_verified', true),
    'platform.payment_verification',
    target_idempotency_key || ':webhook',
    target_metadata
  );
end;
$$;

create or replace function public.configure_withdrawal_beneficiary(
  target_wallet_id uuid default null,
  target_beneficiary_type text default 'bank_account',
  target_bank_code text default null,
  target_account_number text default null,
  target_account_name text default null,
  target_provider_adapter_key text default 'provider.payment.sandbox',
  target_source text default 'platform.withdrawal_engine',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  wallet_record record;
  provider_record record;
  beneficiary_id uuid;
  existing_record record;
  account_hash text;
  provider_log_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authenticated user is required';
  end if;

  if target_wallet_id is null then
    raise exception 'target_wallet_id is required';
  end if;

  if not public.can_access_wallet_account(target_wallet_id) then
    raise exception 'wallet access permission is required';
  end if;

  if target_beneficiary_type not in ('bank_account', 'mobile_money', 'other') then
    raise exception 'target_beneficiary_type is not supported';
  end if;

  if target_account_number is null or btrim(target_account_number) = '' then
    raise exception 'target_account_number is required';
  end if;

  if target_account_name is null or btrim(target_account_name) = '' then
    raise exception 'target_account_name is required';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select wallet.*
  into wallet_record
  from public.wallet_accounts wallet
  where wallet.id = target_wallet_id
    and wallet.status = 'active';

  if not found then
    raise exception 'target_wallet_id must reference an active wallet';
  end if;

  select provider.*
  into provider_record
  from public.provider_adapters provider
  where provider.provider_kind = 'payment'
    and provider.key = target_provider_adapter_key
    and provider.status = 'active';

  if not found then
    raise exception 'target_provider_adapter_key must reference an active payment provider adapter';
  end if;

  account_hash := encode(
    extensions.digest(
      convert_to(coalesce(target_bank_code, '') || ':' || target_account_number, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select existing.*
  into existing_record
  from public.withdrawal_beneficiaries existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if found then
    return existing_record.id;
  end if;

  provider_log_id := public.insert_provider_execution_log(
    provider_record.id,
    'payment',
    'provider.payment.resolve_bank_account',
    'succeeded',
    jsonb_build_object('bank_code', target_bank_code, 'account_number_last4', right(target_account_number, 4)),
    jsonb_build_object('account_name', target_account_name, 'verified', true),
    target_idempotency_key || ':provider'
  );

  insert into public.withdrawal_beneficiaries (
    owner_user_id,
    wallet_id,
    provider_adapter_id,
    provider_execution_log_id,
    beneficiary_type,
    bank_code,
    account_number_last4,
    account_reference_hash,
    account_name,
    provider_recipient_code,
    status,
    source,
    idempotency_key,
    metadata,
    verified_at,
    created_by
  )
  values (
    auth.uid(),
    target_wallet_id,
    provider_record.id,
    provider_log_id,
    target_beneficiary_type,
    target_bank_code,
    right(target_account_number, 4),
    account_hash,
    target_account_name,
    'sandbox-recipient-' || substr(account_hash, 1, 16),
    'verified',
    target_source,
    target_idempotency_key,
    target_metadata,
    timezone('utc', now()),
    auth.uid()
  )
  returning id into beneficiary_id;

  return beneficiary_id;
end;
$$;

create or replace function public.request_wallet_withdrawal(
  target_wallet_id uuid default null,
  target_beneficiary_id uuid default null,
  target_amount numeric default null,
  target_fee_amount numeric default 0,
  target_source text default 'platform.withdrawal_engine',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  wallet_record record;
  beneficiary_record record;
  current_balance numeric(28, 8);
  withdrawal_id uuid;
  existing_record record;
begin
  if auth.uid() is null then
    raise exception 'authenticated user is required';
  end if;

  if target_wallet_id is null or target_beneficiary_id is null then
    raise exception 'target_wallet_id and target_beneficiary_id are required';
  end if;

  if target_amount is null or target_amount <= 0 then
    raise exception 'target_amount must be greater than zero';
  end if;

  if coalesce(target_fee_amount, 0) < 0 then
    raise exception 'target_fee_amount cannot be negative';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select existing.*
  into existing_record
  from public.withdrawal_requests existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if found then
    return existing_record.id;
  end if;

  if not public.can_access_wallet_account(target_wallet_id) then
    raise exception 'wallet access permission is required';
  end if;

  select wallet.*
  into wallet_record
  from public.wallet_accounts wallet
  where wallet.id = target_wallet_id
    and wallet.status = 'active';

  if not found then
    raise exception 'target_wallet_id must reference an active wallet';
  end if;

  select beneficiary.*
  into beneficiary_record
  from public.withdrawal_beneficiaries beneficiary
  where beneficiary.id = target_beneficiary_id
    and beneficiary.wallet_id = target_wallet_id
    and beneficiary.status = 'verified';

  if not found then
    raise exception 'target_beneficiary_id must reference a verified beneficiary for the wallet';
  end if;

  select coalesce(balance.balance, 0)
  into current_balance
  from public.wallet_balances balance
  where balance.wallet_id = target_wallet_id;

  if coalesce(current_balance, 0) < target_amount + coalesce(target_fee_amount, 0) then
    raise exception 'insufficient available wallet balance';
  end if;

  insert into public.withdrawal_requests (
    wallet_id,
    beneficiary_id,
    provider_adapter_id,
    currency_code,
    amount,
    fee_amount,
    status,
    source,
    idempotency_key,
    metadata,
    requested_by
  )
  values (
    target_wallet_id,
    target_beneficiary_id,
    beneficiary_record.provider_adapter_id,
    wallet_record.currency_code,
    target_amount,
    coalesce(target_fee_amount, 0),
    'requested',
    target_source,
    target_idempotency_key,
    target_metadata,
    auth.uid()
  )
  returning id into withdrawal_id;

  perform public.record_withdrawal_event(
    withdrawal_id,
    'requested',
    'requested',
    target_idempotency_key || ':requested',
    target_metadata
  );

  return withdrawal_id;
end;
$$;

create or replace function public.approve_wallet_withdrawal(
  target_withdrawal_request_id uuid default null,
  target_source text default 'platform.withdrawal_engine',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  withdrawal_record record;
  clearing_wallet_id uuid;
  current_balance numeric(28, 8);
  reserved_transaction_id uuid;
begin
  if not public.can_execute_financial_runtime() then
    raise exception 'withdrawal execution permission is required';
  end if;

  if target_withdrawal_request_id is null then
    raise exception 'target_withdrawal_request_id is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select withdrawal.*
  into withdrawal_record
  from public.withdrawal_requests withdrawal
  where withdrawal.id = target_withdrawal_request_id
  for update;

  if not found then
    raise exception 'target_withdrawal_request_id must reference a withdrawal request';
  end if;

  if withdrawal_record.status in ('approved', 'processing', 'succeeded') then
    return withdrawal_record.id;
  end if;

  if withdrawal_record.status <> 'requested' then
    raise exception 'withdrawal request cannot be approved from its current status';
  end if;

  select coalesce(balance.balance, 0)
  into current_balance
  from public.wallet_balances balance
  where balance.wallet_id = withdrawal_record.wallet_id;

  if coalesce(current_balance, 0) < withdrawal_record.total_debit_amount then
    raise exception 'insufficient available wallet balance';
  end if;

  clearing_wallet_id := public.ensure_platform_clearing_wallet(
    withdrawal_record.currency_code,
    'platform.withdrawal_engine',
    target_idempotency_key || ':clearing-wallet'
  );

  reserved_transaction_id := public.post_financial_transaction(
    'transfer',
    withdrawal_record.currency_code,
    'platform.withdrawal_engine',
    'wallet_withdrawal',
    withdrawal_record.id,
    jsonb_build_array(
      jsonb_build_object(
        'wallet_id', withdrawal_record.wallet_id,
        'direction', 'debit',
        'amount', withdrawal_record.total_debit_amount,
        'entry_type', 'principal',
        'metadata', jsonb_build_object('role', 'withdrawal_source')
      ),
      jsonb_build_object(
        'wallet_id', clearing_wallet_id,
        'direction', 'credit',
        'amount', withdrawal_record.total_debit_amount,
        'entry_type', 'principal',
        'metadata', jsonb_build_object('role', 'withdrawal_clearing')
      )
    ),
    target_idempotency_key || ':reserve',
    withdrawal_record.provider_adapter_id,
    null,
    jsonb_build_object('withdrawal_request_id', withdrawal_record.id),
    target_metadata
  );

  update public.withdrawal_requests
  set status = 'approved',
      reserve_transaction_id = reserved_transaction_id,
      approved_by = auth.uid(),
      approved_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = withdrawal_record.id;

  perform public.record_withdrawal_event(
    withdrawal_record.id,
    'approved',
    'approved',
    target_idempotency_key || ':approved',
    target_metadata || jsonb_build_object('reserve_transaction_id', reserved_transaction_id)
  );

  return withdrawal_record.id;
end;
$$;

create or replace function public.process_wallet_withdrawal_transfer(
  target_withdrawal_request_id uuid default null,
  target_provider_status text default null,
  target_provider_reference text default null,
  target_response_payload jsonb default '{}'::jsonb,
  target_source text default 'platform.withdrawal_engine',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  withdrawal_record record;
  clearing_wallet_id uuid;
  transfer_execution_id uuid;
  provider_log_id uuid;
  posted_reversal_transaction_id uuid;
begin
  if not public.can_execute_financial_runtime() then
    raise exception 'withdrawal execution permission is required';
  end if;

  if target_withdrawal_request_id is null then
    raise exception 'target_withdrawal_request_id is required';
  end if;

  if target_provider_status not in ('succeeded', 'failed', 'reversed') then
    raise exception 'target_provider_status is not supported';
  end if;

  if target_response_payload is null or jsonb_typeof(target_response_payload) <> 'object'
    or target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'withdrawal transfer JSON inputs must be objects';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select withdrawal.*
  into withdrawal_record
  from public.withdrawal_requests withdrawal
  where withdrawal.id = target_withdrawal_request_id
  for update;

  if not found then
    raise exception 'target_withdrawal_request_id must reference a withdrawal request';
  end if;

  if withdrawal_record.status = target_provider_status then
    return withdrawal_record.id;
  end if;

  if withdrawal_record.status not in ('approved', 'processing') then
    raise exception 'withdrawal transfer cannot be processed from its current status';
  end if;

  provider_log_id := public.insert_provider_execution_log(
    withdrawal_record.provider_adapter_id,
    'payment',
    'provider.payment.transfer',
    case when target_provider_status = 'succeeded' then 'succeeded' else 'failed' end,
    jsonb_build_object('withdrawal_request_id', withdrawal_record.id, 'amount', withdrawal_record.amount),
    target_response_payload || jsonb_build_object('provider_reference', target_provider_reference, 'status', target_provider_status),
    target_idempotency_key || ':provider',
    case when target_provider_status = 'succeeded' then null else 'sandbox transfer failed' end
  );

  insert into public.transfer_executions (
    withdrawal_request_id,
    provider_adapter_id,
    provider_execution_log_id,
    status,
    provider_reference,
    response_payload,
    source,
    idempotency_key,
    metadata,
    created_by
  )
  values (
    withdrawal_record.id,
    withdrawal_record.provider_adapter_id,
    provider_log_id,
    target_provider_status,
    target_provider_reference,
    target_response_payload,
    target_source,
    target_idempotency_key,
    target_metadata,
    auth.uid()
  )
  on conflict (source, idempotency_key) do nothing
  returning id into transfer_execution_id;

  if target_provider_status = 'succeeded' then
    update public.withdrawal_requests
    set status = 'succeeded',
        provider_reference = target_provider_reference,
        processed_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = withdrawal_record.id;

    perform public.record_withdrawal_event(
      withdrawal_record.id,
      'succeeded',
      'succeeded',
      target_idempotency_key || ':succeeded',
      target_metadata || jsonb_build_object('provider_reference', target_provider_reference)
    );

    return withdrawal_record.id;
  end if;

  clearing_wallet_id := public.ensure_platform_clearing_wallet(
    withdrawal_record.currency_code,
    'platform.withdrawal_engine',
    target_idempotency_key || ':clearing-wallet'
  );

  posted_reversal_transaction_id := public.post_financial_transaction(
    'refund',
    withdrawal_record.currency_code,
    'platform.withdrawal_engine',
    'wallet_withdrawal',
    withdrawal_record.id,
    jsonb_build_array(
      jsonb_build_object(
        'wallet_id', clearing_wallet_id,
        'direction', 'debit',
        'amount', withdrawal_record.total_debit_amount,
        'entry_type', 'principal',
        'metadata', jsonb_build_object('role', 'withdrawal_clearing_reversal')
      ),
      jsonb_build_object(
        'wallet_id', withdrawal_record.wallet_id,
        'direction', 'credit',
        'amount', withdrawal_record.total_debit_amount,
        'entry_type', 'principal',
        'metadata', jsonb_build_object('role', 'withdrawal_source_reversal')
      )
    ),
    target_idempotency_key || ':reversal',
    withdrawal_record.provider_adapter_id,
    target_provider_reference,
    jsonb_build_object('withdrawal_request_id', withdrawal_record.id, 'reserve_transaction_id', withdrawal_record.reserve_transaction_id),
    target_metadata
  );

  update public.withdrawal_requests
  set status = case when target_provider_status = 'reversed' then 'reversed' else 'failed' end,
      provider_reference = target_provider_reference,
      reversal_transaction_id = posted_reversal_transaction_id,
      failed_at = case when target_provider_status = 'failed' then timezone('utc', now()) else failed_at end,
      reversed_at = case when target_provider_status = 'reversed' then timezone('utc', now()) else reversed_at end,
      updated_at = timezone('utc', now())
  where id = withdrawal_record.id;

  perform public.record_withdrawal_event(
    withdrawal_record.id,
    case when target_provider_status = 'reversed' then 'reversed' else 'failed' end,
    case when target_provider_status = 'reversed' then 'reversed' else 'failed' end,
    target_idempotency_key || ':failed',
    target_metadata || jsonb_build_object('reversal_transaction_id', posted_reversal_transaction_id)
  );

  return withdrawal_record.id;
end;
$$;

create or replace function public.fund_order_from_wallet(
  target_order_id uuid default null,
  target_customer_wallet_id uuid default null,
  target_escrow_wallet_id uuid default null,
  target_source text default 'platform.payment_engine',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record record;
  customer_wallet record;
  escrow_wallet_id uuid;
  current_balance numeric(28, 8);
  hold_transaction_id uuid;
  created_escrow_hold_id uuid;
  existing_hold record;
begin
  if not public.can_execute_financial_runtime() then
    raise exception 'payment execution permission is required';
  end if;

  if target_order_id is null or target_customer_wallet_id is null then
    raise exception 'target_order_id and target_customer_wallet_id are required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select hold.*
  into existing_hold
  from public.escrow_holds hold
  where hold.source = target_source
    and hold.idempotency_key = target_idempotency_key;

  if found then
    return existing_hold.id;
  end if;

  select order_record_inner.*
  into order_record
  from public.order_records order_record_inner
  where order_record_inner.id = target_order_id
  for update;

  if not found then
    raise exception 'target_order_id must reference an existing order';
  end if;

  if order_record.total_amount <= 0 then
    raise exception 'order total must be greater than zero';
  end if;

  select wallet.*
  into customer_wallet
  from public.wallet_accounts wallet
  where wallet.id = target_customer_wallet_id
    and wallet.status = 'active'
    and wallet.currency_code = order_record.currency_code;

  if not found then
    raise exception 'target_customer_wallet_id must reference an active wallet with matching currency';
  end if;

  select coalesce(balance.balance, 0)
  into current_balance
  from public.wallet_balances balance
  where balance.wallet_id = target_customer_wallet_id;

  if coalesce(current_balance, 0) < order_record.total_amount then
    raise exception 'insufficient available wallet balance';
  end if;

  escrow_wallet_id := coalesce(
    target_escrow_wallet_id,
    public.ensure_wallet_account(
      'escrow',
      'escrow',
      target_order_id,
      order_record.currency_code,
      'platform.wallet_engine',
      '{"wallet_purpose":"order_escrow"}'::jsonb,
      target_idempotency_key || ':escrow-wallet'
    )
  );

  hold_transaction_id := public.post_financial_transaction(
    'hold',
    order_record.currency_code,
    target_source,
    'service_request',
    order_record.service_request_id,
    jsonb_build_array(
      jsonb_build_object(
        'wallet_id', target_customer_wallet_id,
        'direction', 'debit',
        'amount', order_record.total_amount,
        'entry_type', 'principal',
        'metadata', jsonb_build_object('role', 'customer_wallet')
      ),
      jsonb_build_object(
        'wallet_id', escrow_wallet_id,
        'direction', 'credit',
        'amount', order_record.total_amount,
        'entry_type', 'principal',
        'metadata', jsonb_build_object('role', 'escrow')
      )
    ),
    target_idempotency_key || ':financial',
    null,
    null,
    jsonb_build_object('order_id', order_record.id, 'service_request_id', order_record.service_request_id),
    target_metadata
  );

  insert into public.escrow_holds (
    settlement_policy_id,
    wallet_id,
    source_transaction_id,
    status,
    currency_code,
    hold_amount,
    released_amount,
    subject_type,
    subject_id,
    release_conditions,
    beneficiaries,
    expires_at,
    created_by,
    source,
    idempotency_key
  )
  values (
    null,
    escrow_wallet_id,
    hold_transaction_id,
    'held',
    order_record.currency_code,
    order_record.total_amount,
    0,
    'service_request',
    order_record.service_request_id,
    target_metadata || jsonb_build_object('order_id', order_record.id),
    '[]'::jsonb,
    null,
    auth.uid(),
    target_source,
    target_idempotency_key
  )
  returning id into created_escrow_hold_id;

  update public.service_requests
  set escrow_hold_id = created_escrow_hold_id,
      status = 'payment_reserved',
      updated_at = timezone('utc', now())
  where id = order_record.service_request_id;

  update public.order_records
  set status = case when status = 'received' then 'accepted' else status end,
      metadata = metadata || jsonb_build_object('escrow_hold_id', created_escrow_hold_id),
      updated_at = timezone('utc', now())
  where id = order_record.id;

  return created_escrow_hold_id;
end;
$$;

create or replace function public.execute_driver_commission(
  target_order_id uuid default null,
  target_escrow_hold_id uuid default null,
  target_driver_wallet_id uuid default null,
  target_commission_policy_key text default 'commission.driver.percentage.default',
  target_base_amount numeric default null,
  target_source text default 'platform.commission_engine',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record record;
  hold_record record;
  policy_record record;
  commission_amount numeric(28, 8);
  release_transaction_id uuid;
  execution_id uuid;
  existing_record record;
begin
  if not public.can_execute_financial_runtime() then
    raise exception 'commission execution permission is required';
  end if;

  if target_order_id is null or target_escrow_hold_id is null or target_driver_wallet_id is null then
    raise exception 'target_order_id, target_escrow_hold_id, and target_driver_wallet_id are required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select existing.*
  into existing_record
  from public.commission_executions existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if found then
    return existing_record.id;
  end if;

  select order_record_inner.*
  into order_record
  from public.order_records order_record_inner
  where order_record_inner.id = target_order_id;

  if not found then
    raise exception 'target_order_id must reference an existing order';
  end if;

  select hold.*
  into hold_record
  from public.escrow_holds hold
  where hold.id = target_escrow_hold_id
    and hold.subject_id = order_record.service_request_id;

  if not found then
    raise exception 'target_escrow_hold_id must reference an escrow hold for the order service request';
  end if;

  select policy.*
  into policy_record
  from public.commission_policies policy
  where policy.key = target_commission_policy_key
    and policy.currency_code = order_record.currency_code
    and policy.status = 'active'
  order by case policy.scope_type when 'global' then 10 else 1 end
  limit 1;

  if not found then
    raise exception 'target_commission_policy_key must reference an active commission policy';
  end if;

  commission_amount := round(
    case policy_record.calculation_mode
      when 'fixed' then policy_record.fixed_amount
      when 'percentage' then coalesce(target_base_amount, order_record.total_amount) * policy_record.percentage_rate / 100
      else policy_record.fixed_amount + coalesce(target_base_amount, order_record.total_amount) * policy_record.percentage_rate / 100
    end,
    2
  );

  if commission_amount <= 0 then
    raise exception 'calculated commission amount must be greater than zero';
  end if;

  release_transaction_id := public.release_escrow_hold(
    target_escrow_hold_id,
    jsonb_build_array(
      jsonb_build_object(
        'wallet_id', target_driver_wallet_id,
        'amount', commission_amount,
        'entry_type', 'commission',
        'metadata', jsonb_build_object('role', 'driver_commission')
      )
    ),
    target_idempotency_key || ':release',
    target_source,
    target_metadata || jsonb_build_object('commission_policy_id', policy_record.id)
  );

  insert into public.commission_executions (
    service_request_id,
    order_id,
    escrow_hold_id,
    driver_wallet_id,
    commission_policy_id,
    release_transaction_id,
    currency_code,
    amount,
    status,
    policy_snapshot,
    source,
    idempotency_key,
    metadata,
    created_by
  )
  values (
    order_record.service_request_id,
    order_record.id,
    target_escrow_hold_id,
    target_driver_wallet_id,
    policy_record.id,
    transaction_id,
    order_record.currency_code,
    commission_amount,
    'posted',
    to_jsonb(policy_record),
    target_source,
    target_idempotency_key,
    target_metadata,
    auth.uid()
  )
  returning id into execution_id;

  return execution_id;
end;
$$;

create or replace function public.execute_order_business_settlement(
  target_order_id uuid default null,
  target_escrow_hold_id uuid default null,
  target_business_wallet_id uuid default null,
  target_platform_fee_wallet_id uuid default null,
  target_platform_fee_amount numeric default 0,
  target_source text default 'platform.settlement_engine',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record record;
  hold_record record;
  remaining_amount numeric(28, 8);
  net_amount numeric(28, 8);
  distribution jsonb := '[]'::jsonb;
  settlement_execution_id uuid;
  statement_id uuid;
  existing_record record;
begin
  if not public.can_execute_financial_runtime() then
    raise exception 'settlement execution permission is required';
  end if;

  if target_order_id is null or target_escrow_hold_id is null or target_business_wallet_id is null then
    raise exception 'target_order_id, target_escrow_hold_id, and target_business_wallet_id are required';
  end if;

  if coalesce(target_platform_fee_amount, 0) < 0 then
    raise exception 'target_platform_fee_amount cannot be negative';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select existing.*
  into existing_record
  from public.settlement_statements existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if found then
    return existing_record.id;
  end if;

  select order_record_inner.*
  into order_record
  from public.order_records order_record_inner
  where order_record_inner.id = target_order_id;

  if not found then
    raise exception 'target_order_id must reference an existing order';
  end if;

  select hold.*
  into hold_record
  from public.escrow_holds hold
  where hold.id = target_escrow_hold_id
    and hold.subject_id = order_record.service_request_id
  for update;

  if not found then
    raise exception 'target_escrow_hold_id must reference an escrow hold for the order service request';
  end if;

  remaining_amount := hold_record.hold_amount - hold_record.released_amount;

  if remaining_amount <= 0 then
    raise exception 'escrow hold has no remaining settlement balance';
  end if;

  if coalesce(target_platform_fee_amount, 0) > remaining_amount then
    raise exception 'platform fee cannot exceed remaining settlement balance';
  end if;

  net_amount := remaining_amount - coalesce(target_platform_fee_amount, 0);

  if coalesce(target_platform_fee_amount, 0) > 0 then
    if target_platform_fee_wallet_id is null then
      raise exception 'target_platform_fee_wallet_id is required when platform fee is greater than zero';
    end if;

    distribution := distribution || jsonb_build_array(
      jsonb_build_object(
        'wallet_id', target_platform_fee_wallet_id,
        'amount', target_platform_fee_amount,
        'entry_type', 'fee',
        'metadata', jsonb_build_object('role', 'platform_fee')
      )
    );
  end if;

  if net_amount > 0 then
    distribution := distribution || jsonb_build_array(
      jsonb_build_object(
        'wallet_id', target_business_wallet_id,
        'amount', net_amount,
        'entry_type', 'principal',
        'metadata', jsonb_build_object('role', 'business_settlement')
      )
    );
  end if;

  settlement_execution_id := public.execute_service_request_settlement(
    order_record.service_request_id,
    target_escrow_hold_id,
    distribution,
    target_idempotency_key || ':settlement',
    target_source,
    target_metadata || jsonb_build_object('order_id', order_record.id)
  );

  insert into public.settlement_statements (
    organization_id,
    service_request_id,
    order_id,
    escrow_hold_id,
    settlement_execution_id,
    currency_code,
    gross_amount,
    platform_fee_amount,
    net_amount,
    status,
    period_start,
    period_end,
    source,
    idempotency_key,
    metadata,
    created_by
  )
  values (
    order_record.organization_id,
    order_record.service_request_id,
    order_record.id,
    target_escrow_hold_id,
    settlement_execution_id,
    order_record.currency_code,
    remaining_amount,
    coalesce(target_platform_fee_amount, 0),
    net_amount,
    'posted',
    timezone('utc', now()),
    timezone('utc', now()),
    target_source,
    target_idempotency_key,
    target_metadata,
    auth.uid()
  )
  returning id into statement_id;

  return statement_id;
end;
$$;

create or replace function public.reconcile_service_request_financials(
  target_service_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_record record;
  quote_total numeric(28, 8);
  order_total numeric(28, 8);
  expected_total numeric(28, 8);
  hold_total numeric(28, 8);
  release_total numeric(28, 8);
  refund_total numeric(28, 8);
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.financial.manage', null)
    and not public.has_permission('platform.settlement.read', null)
    and not public.can_execute_platform_runtime() then
    raise exception 'financial reconciliation permission is required';
  end if;

  if target_service_request_id is null then
    raise exception 'target_service_request_id is required';
  end if;

  select request.*
  into request_record
  from public.service_requests request
  where request.id = target_service_request_id;

  if not found then
    raise exception 'target_service_request_id must reference an existing service request';
  end if;

  select coalesce(max(quote.total_amount), 0)
  into quote_total
  from public.price_quotes quote
  where quote.service_request_id = target_service_request_id
    and quote.status = 'accepted';

  select coalesce(max(order_record.total_amount), 0)
  into order_total
  from public.order_records order_record
  where order_record.service_request_id = target_service_request_id;

  expected_total := greatest(coalesce(quote_total, 0), coalesce(order_total, 0));

  select coalesce(sum(transaction.total_amount), 0)
  into hold_total
  from public.financial_transactions transaction
  where transaction.subject_type = 'service_request'
    and transaction.subject_id = target_service_request_id
    and transaction.transaction_type = 'hold'
    and transaction.status = 'posted';

  select coalesce(sum(transaction.total_amount), 0)
  into release_total
  from public.financial_transactions transaction
  where transaction.subject_type = 'service_request'
    and transaction.subject_id = target_service_request_id
    and transaction.transaction_type = 'release'
    and transaction.status = 'posted';

  select coalesce(sum(transaction.total_amount), 0)
  into refund_total
  from public.financial_transactions transaction
  where transaction.subject_type = 'service_request'
    and transaction.subject_id = target_service_request_id
    and transaction.transaction_type = 'refund'
    and transaction.status = 'posted';

  return jsonb_build_object(
    'service_request_id', target_service_request_id,
    'status', request_record.status,
    'quote_total', quote_total,
    'order_total', order_total,
    'expected_total', expected_total,
    'hold_total', hold_total,
    'release_total', release_total,
    'refund_total', refund_total,
    'balanced', hold_total = expected_total and hold_total = release_total + refund_total
  );
end;
$$;

create or replace function public.queue_communication_message(
  target_channel text default null,
  target_purpose text default null,
  target_recipient_entity_type text default null,
  target_recipient_entity_id uuid default null,
  target_recipient_address text default null,
  target_payload jsonb default '{}'::jsonb,
  target_provider_adapter_key text default 'provider.communication.sandbox',
  target_source text default 'platform.communication_engine',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  provider_record record;
  communication_id uuid;
  notification_id uuid;
  existing_record record;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.communications.manage', null)
    and not (
      auth.uid() is not null
      and target_recipient_entity_type = 'user'
      and target_recipient_entity_id = auth.uid()
    ) then
    raise exception 'communication management permission is required';
  end if;

  if target_channel is null
    or target_channel not in ('push', 'sms', 'email', 'whatsapp', 'voice', 'in_app', 'future') then
    raise exception 'target_channel is not supported';
  end if;

  if target_purpose is null or target_purpose !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_purpose must be a valid platform key';
  end if;

  if target_recipient_entity_type is null
    or target_recipient_entity_type !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_recipient_entity_type must be a valid platform key';
  end if;

  if target_recipient_entity_id is null
    and (target_recipient_address is null or btrim(target_recipient_address) = '') then
    raise exception 'target_recipient_entity_id or target_recipient_address is required';
  end if;

  if target_payload is null or jsonb_typeof(target_payload) <> 'object'
    or target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'communication JSON inputs must be objects';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select existing.*
  into existing_record
  from public.communication_messages existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if found then
    return existing_record.id;
  end if;

  select provider.*
  into provider_record
  from public.provider_adapters provider
  where provider.provider_kind = 'notification'
    and provider.key = target_provider_adapter_key
    and provider.status = 'active';

  if not found then
    raise exception 'target_provider_adapter_key must reference an active communication provider adapter';
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
    target_recipient_entity_type,
    target_recipient_entity_id,
    target_recipient_address,
    'queued',
    provider_record.id,
    target_payload || jsonb_build_object('purpose', target_purpose),
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
    target_metadata
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
    target_recipient_entity_type,
    target_recipient_entity_id,
    target_recipient_address,
    'queued',
    target_payload,
    target_source,
    target_idempotency_key,
    target_metadata,
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
    target_idempotency_key || ':queued',
    target_metadata
  );

  return communication_id;
end;
$$;

create or replace function public.sync_communication_message_statuses(target_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  synced_count integer := 0;
  message_record record;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.communications.manage', null) then
    raise exception 'communication management permission is required';
  end if;

  for message_record in
    select communication.id,
           communication.status as communication_status,
           notification.status as notification_status,
           notification.provider_message_id,
           notification.error_message,
           communication.idempotency_key
    from public.communication_messages communication
    join public.notification_messages notification
      on notification.id = communication.notification_message_id
    where communication.status <> case
      when notification.status = 'sent' then 'sent'
      when notification.status = 'delivered' then 'delivered'
      when notification.status = 'failed' then 'failed'
      when notification.status = 'cancelled' then 'cancelled'
      else communication.status
    end
    order by communication.queued_at asc
    limit least(greatest(coalesce(target_limit, 100), 1), 500)
  loop
    update public.communication_messages
    set status = case
          when message_record.notification_status = 'sent' then 'sent'
          when message_record.notification_status = 'delivered' then 'delivered'
          when message_record.notification_status = 'failed' then 'failed'
          when message_record.notification_status = 'cancelled' then 'cancelled'
          else status
        end,
        sent_at = case when message_record.notification_status in ('sent', 'delivered') and sent_at is null then timezone('utc', now()) else sent_at end,
        delivered_at = case when message_record.notification_status = 'delivered' and delivered_at is null then timezone('utc', now()) else delivered_at end,
        failed_at = case when message_record.notification_status = 'failed' and failed_at is null then timezone('utc', now()) else failed_at end,
        updated_at = timezone('utc', now())
    where id = message_record.id;

    insert into public.communication_events (
      communication_message_id,
      status,
      provider_message_id,
      error_message,
      idempotency_key,
      metadata
    )
    values (
      message_record.id,
      case
        when message_record.notification_status = 'sent' then 'sent'
        when message_record.notification_status = 'delivered' then 'delivered'
        when message_record.notification_status = 'failed' then 'failed'
        when message_record.notification_status = 'cancelled' then 'cancelled'
        else message_record.communication_status
      end,
      message_record.provider_message_id,
      message_record.error_message,
      message_record.idempotency_key || ':sync:' || message_record.notification_status,
      '{"source":"platform.communication_engine"}'::jsonb
    )
    on conflict do nothing;

    synced_count := synced_count + 1;
  end loop;

  return synced_count;
end;
$$;

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

insert into public.commission_policies (
  key,
  display_name,
  scope_type,
  calculation_mode,
  fixed_amount,
  percentage_rate,
  currency_code,
  trigger_event_key,
  status,
  metadata
)
values (
  'commission.driver.percentage.default',
  'Default Driver Percentage Commission',
  'global',
  'percentage',
  0,
  10,
  'NGN',
  'event.delivery.completed',
  'active',
  '{"phase_one_default":true,"configurable":true}'::jsonb
)
on conflict do nothing;

update public.commission_policies
set display_name = 'Default Driver Percentage Commission',
    calculation_mode = 'percentage',
    fixed_amount = 0,
    percentage_rate = 10,
    currency_code = 'NGN',
    trigger_event_key = 'event.delivery.completed',
    status = 'active',
    metadata = metadata || '{"phase_one_default":true,"configurable":true}'::jsonb,
    updated_at = timezone('utc', now())
where key = 'commission.driver.percentage.default'
  and scope_type = 'global'
  and scope_id is null;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'payment_deposit_requests',
    'withdrawal_beneficiaries',
    'withdrawal_requests',
    'commission_policies',
    'commission_executions',
    'settlement_accounts',
    'settlement_statements',
    'communication_messages',
    'otp_challenges'
  ]
  loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I', target_table, target_table);
    execute format(
      'create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      target_table,
      target_table
    );
  end loop;

  foreach target_table in array array[
    'payment_webhook_events',
    'withdrawal_events',
    'transfer_executions',
    'communication_events',
    'otp_attempts'
  ]
  loop
    execute format('drop trigger if exists prevent_%I_update on public.%I', target_table, target_table);
    execute format(
      'create trigger prevent_%I_update before update on public.%I for each row execute function public.prevent_finance_communication_event_mutation()',
      target_table,
      target_table
    );
    execute format('drop trigger if exists prevent_%I_delete on public.%I', target_table, target_table);
    execute format(
      'create trigger prevent_%I_delete before delete on public.%I for each row execute function public.prevent_finance_communication_event_mutation()',
      target_table,
      target_table
    );
  end loop;
end $$;

alter table public.payment_deposit_requests enable row level security;
alter table public.payment_webhook_events enable row level security;
alter table public.withdrawal_beneficiaries enable row level security;
alter table public.withdrawal_requests enable row level security;
alter table public.transfer_executions enable row level security;
alter table public.withdrawal_events enable row level security;
alter table public.commission_policies enable row level security;
alter table public.commission_executions enable row level security;
alter table public.settlement_accounts enable row level security;
alter table public.settlement_statements enable row level security;
alter table public.communication_messages enable row level security;
alter table public.communication_events enable row level security;
alter table public.otp_challenges enable row level security;
alter table public.otp_attempts enable row level security;

create policy payment_deposit_requests_select_owner_or_privileged on public.payment_deposit_requests
for select to authenticated
using (customer_user_id = auth.uid() or public.has_permission('platform.payments.read', null) or public.has_permission('platform.payments.execute', null));

create policy payment_deposit_requests_no_direct_insert on public.payment_deposit_requests
for insert to authenticated with check (false);
create policy payment_deposit_requests_no_direct_update on public.payment_deposit_requests
for update to authenticated using (false) with check (false);
create policy payment_deposit_requests_no_direct_delete on public.payment_deposit_requests
for delete to authenticated using (false);

create policy payment_webhook_events_select_privileged on public.payment_webhook_events
for select to authenticated
using (public.has_permission('platform.payments.read', null) or public.has_permission('platform.payments.execute', null));
create policy payment_webhook_events_no_direct_insert on public.payment_webhook_events
for insert to authenticated with check (false);
create policy payment_webhook_events_no_direct_update on public.payment_webhook_events
for update to authenticated using (false) with check (false);
create policy payment_webhook_events_no_direct_delete on public.payment_webhook_events
for delete to authenticated using (false);

create policy withdrawal_beneficiaries_select_owner_or_privileged on public.withdrawal_beneficiaries
for select to authenticated
using (owner_user_id = auth.uid() or public.has_permission('platform.withdrawals.read', null) or public.has_permission('platform.withdrawals.execute', null));
create policy withdrawal_beneficiaries_no_direct_insert on public.withdrawal_beneficiaries
for insert to authenticated with check (false);
create policy withdrawal_beneficiaries_no_direct_update on public.withdrawal_beneficiaries
for update to authenticated using (false) with check (false);
create policy withdrawal_beneficiaries_no_direct_delete on public.withdrawal_beneficiaries
for delete to authenticated using (false);

create policy withdrawal_requests_select_owner_or_privileged on public.withdrawal_requests
for select to authenticated
using (
  public.can_access_wallet_account(wallet_id)
  or public.has_permission('platform.withdrawals.read', null)
  or public.has_permission('platform.withdrawals.execute', null)
);
create policy withdrawal_requests_no_direct_insert on public.withdrawal_requests
for insert to authenticated with check (false);
create policy withdrawal_requests_no_direct_update on public.withdrawal_requests
for update to authenticated using (false) with check (false);
create policy withdrawal_requests_no_direct_delete on public.withdrawal_requests
for delete to authenticated using (false);

create policy transfer_executions_select_owner_or_privileged on public.transfer_executions
for select to authenticated
using (
  exists (
    select 1
    from public.withdrawal_requests withdrawal
    where withdrawal.id = transfer_executions.withdrawal_request_id
      and public.can_access_wallet_account(withdrawal.wallet_id)
  )
  or public.has_permission('platform.withdrawals.read', null)
  or public.has_permission('platform.withdrawals.execute', null)
);
create policy transfer_executions_no_direct_insert on public.transfer_executions
for insert to authenticated with check (false);
create policy transfer_executions_no_direct_update on public.transfer_executions
for update to authenticated using (false) with check (false);
create policy transfer_executions_no_direct_delete on public.transfer_executions
for delete to authenticated using (false);

create policy withdrawal_events_select_owner_or_privileged on public.withdrawal_events
for select to authenticated
using (
  exists (
    select 1
    from public.withdrawal_requests withdrawal
    where withdrawal.id = withdrawal_events.withdrawal_request_id
      and public.can_access_wallet_account(withdrawal.wallet_id)
  )
  or public.has_permission('platform.withdrawals.read', null)
  or public.has_permission('platform.withdrawals.execute', null)
);
create policy withdrawal_events_no_direct_insert on public.withdrawal_events
for insert to authenticated with check (false);
create policy withdrawal_events_no_direct_update on public.withdrawal_events
for update to authenticated using (false) with check (false);
create policy withdrawal_events_no_direct_delete on public.withdrawal_events
for delete to authenticated using (false);

create policy commission_policies_select_authenticated on public.commission_policies
for select to authenticated
using (status = 'active' or public.has_permission('platform.commissions.execute', null));
create policy commission_policies_no_direct_insert on public.commission_policies
for insert to authenticated with check (false);
create policy commission_policies_no_direct_update on public.commission_policies
for update to authenticated using (false) with check (false);
create policy commission_policies_no_direct_delete on public.commission_policies
for delete to authenticated using (false);

create policy commission_executions_select_privileged on public.commission_executions
for select to authenticated
using (public.has_permission('platform.commissions.execute', null) or public.has_permission('platform.settlement.read', null));
create policy commission_executions_no_direct_insert on public.commission_executions
for insert to authenticated with check (false);
create policy commission_executions_no_direct_update on public.commission_executions
for update to authenticated using (false) with check (false);
create policy commission_executions_no_direct_delete on public.commission_executions
for delete to authenticated using (false);

create policy settlement_accounts_select_privileged on public.settlement_accounts
for select to authenticated
using (public.has_permission('business.settlements.read', organization_id) or public.has_permission('platform.settlement.read', null));
create policy settlement_accounts_no_direct_insert on public.settlement_accounts
for insert to authenticated with check (false);
create policy settlement_accounts_no_direct_update on public.settlement_accounts
for update to authenticated using (false) with check (false);
create policy settlement_accounts_no_direct_delete on public.settlement_accounts
for delete to authenticated using (false);

create policy settlement_statements_select_privileged on public.settlement_statements
for select to authenticated
using (public.has_permission('business.settlements.read', organization_id) or public.has_permission('platform.settlement.read', null));
create policy settlement_statements_no_direct_insert on public.settlement_statements
for insert to authenticated with check (false);
create policy settlement_statements_no_direct_update on public.settlement_statements
for update to authenticated using (false) with check (false);
create policy settlement_statements_no_direct_delete on public.settlement_statements
for delete to authenticated using (false);

create policy communication_messages_select_owner_or_privileged on public.communication_messages
for select to authenticated
using (
  (recipient_entity_type = 'user' and recipient_entity_id = auth.uid())
  or public.has_permission('platform.communications.read', null)
  or public.has_permission('platform.communications.manage', null)
);
create policy communication_messages_no_direct_insert on public.communication_messages
for insert to authenticated with check (false);
create policy communication_messages_no_direct_update on public.communication_messages
for update to authenticated using (false) with check (false);
create policy communication_messages_no_direct_delete on public.communication_messages
for delete to authenticated using (false);

create policy communication_events_select_owner_or_privileged on public.communication_events
for select to authenticated
using (
  exists (
    select 1
    from public.communication_messages message
    where message.id = communication_events.communication_message_id
      and (
        (message.recipient_entity_type = 'user' and message.recipient_entity_id = auth.uid())
        or public.has_permission('platform.communications.read', null)
        or public.has_permission('platform.communications.manage', null)
      )
  )
);
create policy communication_events_no_direct_insert on public.communication_events
for insert to authenticated with check (false);
create policy communication_events_no_direct_update on public.communication_events
for update to authenticated using (false) with check (false);
create policy communication_events_no_direct_delete on public.communication_events
for delete to authenticated using (false);

create policy otp_challenges_select_owner_or_privileged on public.otp_challenges
for select to authenticated
using (user_id = auth.uid() or public.has_permission('platform.communications.manage', null));
create policy otp_challenges_no_direct_insert on public.otp_challenges
for insert to authenticated with check (false);
create policy otp_challenges_no_direct_update on public.otp_challenges
for update to authenticated using (false) with check (false);
create policy otp_challenges_no_direct_delete on public.otp_challenges
for delete to authenticated using (false);

create policy otp_attempts_select_owner_or_privileged on public.otp_attempts
for select to authenticated
using (
  exists (
    select 1
    from public.otp_challenges challenge
    where challenge.id = otp_attempts.otp_challenge_id
      and (challenge.user_id = auth.uid() or public.has_permission('platform.communications.manage', null))
  )
);
create policy otp_attempts_no_direct_insert on public.otp_attempts
for insert to authenticated with check (false);
create policy otp_attempts_no_direct_update on public.otp_attempts
for update to authenticated using (false) with check (false);
create policy otp_attempts_no_direct_delete on public.otp_attempts
for delete to authenticated using (false);

grant select, insert, update, delete on
  public.payment_deposit_requests,
  public.payment_webhook_events,
  public.withdrawal_beneficiaries,
  public.withdrawal_requests,
  public.transfer_executions,
  public.withdrawal_events,
  public.commission_policies,
  public.commission_executions,
  public.settlement_accounts,
  public.settlement_statements,
  public.communication_messages,
  public.communication_events,
  public.otp_challenges,
  public.otp_attempts
to authenticated, service_role;

revoke all on function public.can_access_wallet_account(uuid) from public;
revoke all on function public.can_execute_financial_runtime() from public;
revoke all on function public.prevent_finance_communication_event_mutation() from public;
revoke all on function public.ensure_platform_clearing_wallet(text, text, text) from public;
revoke all on function public.record_withdrawal_event(uuid, text, text, text, jsonb) from public;
revoke all on function public.insert_provider_execution_log(uuid, text, text, text, jsonb, jsonb, text, text) from public;
revoke all on function public.initialize_wallet_deposit(uuid, numeric, text, text, text, text, jsonb) from public;
revoke all on function public.process_wallet_deposit_provider_event(uuid, text, text, boolean, jsonb, text, text, jsonb) from public;
revoke all on function public.verify_wallet_deposit(uuid, text, jsonb) from public;
revoke all on function public.configure_withdrawal_beneficiary(uuid, text, text, text, text, text, text, text, jsonb) from public;
revoke all on function public.request_wallet_withdrawal(uuid, uuid, numeric, numeric, text, text, jsonb) from public;
revoke all on function public.approve_wallet_withdrawal(uuid, text, text, jsonb) from public;
revoke all on function public.process_wallet_withdrawal_transfer(uuid, text, text, jsonb, text, text, jsonb) from public;
revoke all on function public.fund_order_from_wallet(uuid, uuid, uuid, text, text, jsonb) from public;
revoke all on function public.execute_driver_commission(uuid, uuid, uuid, text, numeric, text, text, jsonb) from public;
revoke all on function public.execute_order_business_settlement(uuid, uuid, uuid, uuid, numeric, text, text, jsonb) from public;
revoke all on function public.queue_communication_message(text, text, text, uuid, text, jsonb, text, text, text, jsonb) from public;
revoke all on function public.sync_communication_message_statuses(integer) from public;
revoke all on function public.request_otp_challenge(text, text, text, integer, integer, text, text, jsonb) from public;
revoke all on function public.verify_otp_challenge(uuid, text, text, jsonb) from public;

grant execute on function public.can_access_wallet_account(uuid) to authenticated, service_role;
grant execute on function public.can_execute_financial_runtime() to authenticated, service_role;
grant execute on function public.ensure_platform_clearing_wallet(text, text, text) to authenticated, service_role;
grant execute on function public.record_withdrawal_event(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.insert_provider_execution_log(uuid, text, text, text, jsonb, jsonb, text, text) to service_role;
grant execute on function public.initialize_wallet_deposit(uuid, numeric, text, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.process_wallet_deposit_provider_event(uuid, text, text, boolean, jsonb, text, text, jsonb) to authenticated, service_role;
grant execute on function public.verify_wallet_deposit(uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.configure_withdrawal_beneficiary(uuid, text, text, text, text, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.request_wallet_withdrawal(uuid, uuid, numeric, numeric, text, text, jsonb) to authenticated, service_role;
grant execute on function public.approve_wallet_withdrawal(uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function public.process_wallet_withdrawal_transfer(uuid, text, text, jsonb, text, text, jsonb) to authenticated, service_role;
grant execute on function public.fund_order_from_wallet(uuid, uuid, uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function public.execute_driver_commission(uuid, uuid, uuid, text, numeric, text, text, jsonb) to authenticated, service_role;
grant execute on function public.execute_order_business_settlement(uuid, uuid, uuid, uuid, numeric, text, text, jsonb) to authenticated, service_role;
grant execute on function public.queue_communication_message(text, text, text, uuid, text, jsonb, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.sync_communication_message_statuses(integer) to authenticated, service_role;
grant execute on function public.request_otp_challenge(text, text, text, integer, integer, text, text, jsonb) to authenticated, service_role;
grant execute on function public.verify_otp_challenge(uuid, text, text, jsonb) to authenticated, service_role;

commit;
