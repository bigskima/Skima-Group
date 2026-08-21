begin;

-- ---------------------------------------------------------------------------
-- SKIMA revenue posting runtime
-- - gives the actual wallet owner access to customer / driver / station money
-- - keeps organization finance access permission-scoped
-- - calculates deposit fees from governed financial policy
-- - records successful deposit fees as SKIMA revenue
-- - records successful withdrawal fees as SKIMA revenue
-- - fully reverses principal + fee when a provider reverses a payout/payment
-- - accepts Paystack's asynchronous `processing` transfer state
-- ---------------------------------------------------------------------------

alter table public.payment_deposit_requests
  add column if not exists fee_amount numeric(28, 8) not null default 0;

alter table public.payment_deposit_requests
  add column if not exists financial_policy_snapshot jsonb not null default '{}'::jsonb;

alter table public.payment_deposit_requests
  add column if not exists total_charge_amount numeric(28, 8)
  generated always as (amount + fee_amount) stored;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payment_deposit_requests'::regclass
      and conname = 'payment_deposit_requests_fee_amount_check'
  ) then
    alter table public.payment_deposit_requests
      add constraint payment_deposit_requests_fee_amount_check
      check (fee_amount >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payment_deposit_requests'::regclass
      and conname = 'payment_deposit_requests_financial_policy_snapshot_check'
  ) then
    alter table public.payment_deposit_requests
      add constraint payment_deposit_requests_financial_policy_snapshot_check
      check (jsonb_typeof(financial_policy_snapshot) = 'object');
  end if;
end;
$$;

alter table public.transfer_executions
  drop constraint if exists transfer_executions_status_check;

alter table public.transfer_executions
  add constraint transfer_executions_status_check
  check (status = any (array[
    'queued'::text,
    'processing'::text,
    'succeeded'::text,
    'failed'::text,
    'reversed'::text
  ]));

-- A wallet is owned by the signed-in user only when the entity relation really
-- points to that user. Organization wallets additionally require a finance role;
-- mere organization membership is not enough to expose money.
create or replace function public.is_wallet_owner(target_wallet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.wallet_accounts wallet
    where wallet.id = target_wallet_id
      and (
        (
          wallet.owner_entity_type = 'user'
          and wallet.owner_entity_id = auth.uid()
        )
        or (
          wallet.owner_entity_type = 'driver'
          and exists (
            select 1
            from public.driver_profiles driver
            where driver.id = wallet.owner_entity_id
              and driver.user_id = auth.uid()
          )
        )
        or (
          wallet.owner_entity_type = 'organization'
          and public.is_organization_member(wallet.owner_entity_id)
          and (
            public.has_permission('business.finance.read', wallet.owner_entity_id)
            or public.has_permission('business.finance.manage', wallet.owner_entity_id)
            or public.has_permission('business.settlements.read', wallet.owner_entity_id)
          )
        )
        or (
          wallet.owner_entity_type = 'partner'
          and exists (
            select 1
            from public.partner_profiles partner
            where partner.id = wallet.owner_entity_id
              and public.is_organization_member(partner.organization_id)
              and (
                public.has_permission('business.finance.read', partner.organization_id)
                or public.has_permission('business.finance.manage', partner.organization_id)
                or public.has_permission('business.settlements.read', partner.organization_id)
              )
          )
        )
      )
  );
$$;

create or replace function public.can_access_wallet_account(target_wallet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.role() = 'service_role'
    or exists (
      select 1
      from public.wallet_accounts wallet
      where wallet.id = target_wallet_id
        and (
          (
            wallet.wallet_type = 'platform_revenue'
            and (
              public.has_permission('platform.revenue.read', null)
              or public.has_permission('platform.revenue.manage', null)
            )
          )
          or (
            wallet.wallet_type <> 'platform_revenue'
            and (
              public.is_wallet_owner(wallet.id)
              or public.has_permission('platform.wallets.read', null)
              or public.has_permission('platform.wallets.manage', null)
              or public.has_permission('platform.financial.manage', null)
            )
          )
        )
    );
$$;

create or replace function public.calculate_deposit_fee_from_policy(
  target_wallet_id uuid,
  target_amount numeric,
  target_at timestamp with time zone default timezone('utc', now())
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  wallet_record public.wallet_accounts%rowtype;
  resolved_policy jsonb;
  configuration jsonb;
  fee_amount numeric(28, 8);
  fixed_amount numeric(28, 8);
  percentage_rate numeric(28, 8);
  minimum_fee numeric(28, 8);
  maximum_fee numeric(28, 8);
  minimum_deposit numeric(28, 8);
  maximum_deposit numeric(28, 8);
begin
  if target_amount is null or target_amount <= 0 then
    raise exception 'target_amount must be greater than zero';
  end if;

  select * into wallet_record
  from public.wallet_accounts
  where id = target_wallet_id and status = 'active';

  if not found then
    raise exception 'target_wallet_id must reference an active wallet';
  end if;

  if not public.can_access_wallet_account(target_wallet_id) then
    raise exception 'wallet access permission is required';
  end if;

  resolved_policy := public.resolve_financial_policy(
    'fees.deposit.default',
    wallet_record.currency_code,
    target_at,
    null,
    null,
    'wallet.deposit',
    'global',
    null
  );

  configuration := resolved_policy -> 'configuration';
  fixed_amount := coalesce(nullif(configuration ->> 'fixed_amount', '')::numeric, 0);
  percentage_rate := coalesce(nullif(configuration ->> 'percentage_rate', '')::numeric, 0);
  minimum_fee := coalesce(nullif(configuration ->> 'minimum_fee_amount', '')::numeric, 0);
  maximum_fee := nullif(configuration ->> 'maximum_fee_amount', '')::numeric;
  minimum_deposit := coalesce(nullif(configuration ->> 'minimum_deposit_amount', '')::numeric, 0);
  maximum_deposit := nullif(configuration ->> 'maximum_deposit_amount', '')::numeric;

  if target_amount < minimum_deposit then
    raise exception 'deposit amount is below the configured minimum';
  end if;

  if maximum_deposit is not null and target_amount > maximum_deposit then
    raise exception 'deposit amount exceeds the configured maximum';
  end if;

  if fixed_amount < 0 or percentage_rate < 0 or minimum_fee < 0
    or (maximum_fee is not null and maximum_fee < 0) then
    raise exception 'deposit fee policy values cannot be negative';
  end if;

  fee_amount := round(fixed_amount + (target_amount * percentage_rate / 100), 2);
  fee_amount := greatest(fee_amount, minimum_fee);

  if maximum_fee is not null then
    fee_amount := least(fee_amount, maximum_fee);
  end if;

  return resolved_policy || jsonb_build_object(
    'calculatedFeeAmount', fee_amount,
    'walletCreditAmount', target_amount,
    'totalChargeAmount', target_amount + fee_amount
  );
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
  fee_snapshot jsonb;
  calculated_fee_amount numeric(28, 8);
  total_charge numeric(28, 8);
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

  select existing.* into existing_record
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

  select wallet.* into target_wallet
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

  fee_snapshot := public.calculate_deposit_fee_from_policy(target_wallet_id, target_amount);
  calculated_fee_amount := (fee_snapshot ->> 'calculatedFeeAmount')::numeric(28, 8);
  total_charge := (fee_snapshot ->> 'totalChargeAmount')::numeric(28, 8);

  select provider.* into provider_record
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
    jsonb_build_object(
      'wallet_id', target_wallet_id,
      'wallet_credit_amount', target_amount,
      'fee_amount', calculated_fee_amount,
      'total_charge_amount', total_charge,
      'currency', target_currency_code
    ),
    jsonb_build_object(
      'provider_reference', deposit_reference,
      'checkout_url', 'https://sandbox.skima.local/payments/' || deposit_id::text
    ),
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
    fee_amount,
    financial_policy_snapshot,
    status,
    provider_reference,
    checkout_url,
    source,
    idempotency_key,
    metadata,
    created_by
  ) values (
    deposit_id,
    target_wallet_id,
    auth.uid(),
    provider_record.id,
    provider_log_id,
    target_currency_code,
    target_amount,
    calculated_fee_amount,
    fee_snapshot,
    'pending',
    deposit_reference,
    'https://sandbox.skima.local/payments/' || deposit_id::text,
    target_source,
    target_idempotency_key,
    target_metadata || jsonb_build_object(
      'adapter_key', provider_record.key,
      'financialPolicySnapshot', fee_snapshot
    ),
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
  revenue_wallet_id uuid;
  posted_transaction_id uuid;
  posted_reversal_transaction_id uuid;
  webhook_event_id uuid;
  event_type_value text;
  transaction_entries jsonb;
  deposit_fee numeric(28, 8);
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
    select deposit.* into deposit_record
    from public.payment_deposit_requests deposit
    where deposit.id = target_deposit_request_id
    for update;
  else
    select deposit.* into deposit_record
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
  ) values (
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

  deposit_fee := coalesce(deposit_record.fee_amount, 0);

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
      'deposit:' || deposit_record.id::text || ':clearing-wallet'
    );

    transaction_entries := jsonb_build_array(
      jsonb_build_object(
        'wallet_id', clearing_wallet_id,
        'direction', 'debit',
        'amount', deposit_record.total_charge_amount,
        'entry_type', 'principal',
        'metadata', jsonb_build_object(
          'role', 'external_payment_clearing',
          'deposit_request_id', deposit_record.id
        )
      ),
      jsonb_build_object(
        'wallet_id', deposit_record.wallet_id,
        'direction', 'credit',
        'amount', deposit_record.amount,
        'entry_type', 'principal',
        'metadata', jsonb_build_object(
          'role', 'customer_wallet',
          'deposit_request_id', deposit_record.id
        )
      )
    );

    if deposit_fee > 0 then
      revenue_wallet_id := public.ensure_platform_revenue_wallet(
        deposit_record.currency_code,
        'platform.deposit_revenue',
        'deposit:' || deposit_record.id::text || ':revenue-wallet'
      );

      transaction_entries := transaction_entries || jsonb_build_array(
        jsonb_build_object(
          'wallet_id', revenue_wallet_id,
          'direction', 'credit',
          'amount', deposit_fee,
          'entry_type', 'fee',
          'metadata', jsonb_build_object(
            'role', 'skima_revenue',
            'revenue_stream', 'deposit',
            'revenue_component', 'deposit_fee',
            'deposit_request_id', deposit_record.id
          )
        )
      );
    end if;

    posted_transaction_id := public.post_financial_transaction(
      'payment',
      deposit_record.currency_code,
      'platform.payment_engine',
      'wallet_deposit',
      deposit_record.id,
      transaction_entries,
      'deposit:' || deposit_record.id::text || ':succeeded',
      deposit_record.provider_adapter_id,
      coalesce(target_provider_reference, deposit_record.provider_reference),
      deposit_record.financial_policy_snapshot,
      target_metadata || jsonb_build_object(
        'deposit_request_id', deposit_record.id,
        'wallet_credit_amount', deposit_record.amount,
        'deposit_fee_amount', deposit_fee,
        'total_charge_amount', deposit_record.total_charge_amount
      )
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
    if deposit_record.status = 'reversed' then
      return deposit_record.id;
    end if;

    if deposit_record.status <> 'succeeded' then
      raise exception 'only succeeded deposits can be reversed';
    end if;

    clearing_wallet_id := public.ensure_platform_clearing_wallet(
      deposit_record.currency_code,
      'platform.payment_engine',
      'deposit:' || deposit_record.id::text || ':clearing-wallet'
    );

    transaction_entries := jsonb_build_array(
      jsonb_build_object(
        'wallet_id', deposit_record.wallet_id,
        'direction', 'debit',
        'amount', deposit_record.amount,
        'entry_type', 'principal',
        'metadata', jsonb_build_object(
          'role', 'customer_wallet_reversal',
          'deposit_request_id', deposit_record.id
        )
      )
    );

    if deposit_fee > 0 then
      revenue_wallet_id := public.ensure_platform_revenue_wallet(
        deposit_record.currency_code,
        'platform.deposit_revenue',
        'deposit:' || deposit_record.id::text || ':revenue-wallet'
      );

      transaction_entries := transaction_entries || jsonb_build_array(
        jsonb_build_object(
          'wallet_id', revenue_wallet_id,
          'direction', 'debit',
          'amount', deposit_fee,
          'entry_type', 'fee',
          'metadata', jsonb_build_object(
            'role', 'skima_revenue_reversal',
            'revenue_stream', 'deposit',
            'revenue_component', 'deposit_fee',
            'deposit_request_id', deposit_record.id,
            'reversal_of_transaction_id', deposit_record.transaction_id
          )
        )
      );
    end if;

    transaction_entries := transaction_entries || jsonb_build_array(
      jsonb_build_object(
        'wallet_id', clearing_wallet_id,
        'direction', 'credit',
        'amount', deposit_record.total_charge_amount,
        'entry_type', 'principal',
        'metadata', jsonb_build_object(
          'role', 'external_payment_clearing_reversal',
          'deposit_request_id', deposit_record.id
        )
      )
    );

    posted_reversal_transaction_id := public.post_financial_transaction(
      'refund',
      deposit_record.currency_code,
      'platform.payment_engine',
      'wallet_deposit',
      deposit_record.id,
      transaction_entries,
      'deposit:' || deposit_record.id::text || ':reversed',
      deposit_record.provider_adapter_id,
      coalesce(target_provider_reference, deposit_record.provider_reference),
      deposit_record.financial_policy_snapshot,
      target_metadata || jsonb_build_object(
        'deposit_request_id', deposit_record.id,
        'reversal_of_transaction_id', deposit_record.transaction_id,
        'wallet_credit_amount', deposit_record.amount,
        'deposit_fee_amount', deposit_fee,
        'total_charge_amount', deposit_record.total_charge_amount
      )
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

-- Runtime withdrawals are for customer / driver / partner money. Platform
-- treasury wallets are deliberately excluded from this consumer payout path.
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

  select existing.* into existing_record
  from public.withdrawal_requests existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if found then
    return existing_record.id;
  end if;

  if not public.can_access_wallet_account(target_wallet_id) then
    raise exception 'wallet access permission is required';
  end if;

  select wallet.* into wallet_record
  from public.wallet_accounts wallet
  where wallet.id = target_wallet_id
    and wallet.status = 'active';

  if not found then
    raise exception 'target_wallet_id must reference an active wallet';
  end if;

  if wallet_record.wallet_type not in ('customer', 'driver', 'partner', 'commission', 'refund', 'generic')
    or wallet_record.owner_entity_type in ('platform', 'escrow', 'module') then
    raise exception 'this wallet is not eligible for runtime withdrawal';
  end if;

  select beneficiary.* into beneficiary_record
  from public.withdrawal_beneficiaries beneficiary
  where beneficiary.id = target_beneficiary_id
    and beneficiary.wallet_id = target_wallet_id
    and beneficiary.status = 'verified';

  if not found then
    raise exception 'target_beneficiary_id must reference a verified beneficiary for the wallet';
  end if;

  select coalesce(balance.balance, 0) into current_balance
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
  ) values (
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
    target_metadata || jsonb_build_object(
      'withdrawal_amount', target_amount,
      'fee_amount', coalesce(target_fee_amount, 0),
      'total_debit_amount', target_amount + coalesce(target_fee_amount, 0)
    )
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

  select withdrawal.* into withdrawal_record
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

  select coalesce(balance.balance, 0) into current_balance
  from public.wallet_balances balance
  where balance.wallet_id = withdrawal_record.wallet_id;

  if coalesce(current_balance, 0) < withdrawal_record.total_debit_amount then
    raise exception 'insufficient available wallet balance';
  end if;

  clearing_wallet_id := public.ensure_platform_clearing_wallet(
    withdrawal_record.currency_code,
    'platform.withdrawal_engine',
    'withdrawal:' || withdrawal_record.id::text || ':clearing-wallet'
  );

  -- The full debit is reserved in clearing. The SKIMA fee is recognized as
  -- revenue only when the provider confirms the transfer succeeded.
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
        'metadata', jsonb_build_object(
          'role', 'withdrawal_source',
          'withdrawal_amount', withdrawal_record.amount,
          'fee_amount', withdrawal_record.fee_amount
        )
      ),
      jsonb_build_object(
        'wallet_id', clearing_wallet_id,
        'direction', 'credit',
        'amount', withdrawal_record.total_debit_amount,
        'entry_type', 'principal',
        'metadata', jsonb_build_object(
          'role', 'withdrawal_clearing',
          'withdrawal_amount', withdrawal_record.amount,
          'fee_amount', withdrawal_record.fee_amount
        )
      )
    ),
    'withdrawal:' || withdrawal_record.id::text || ':reserve',
    withdrawal_record.provider_adapter_id,
    null,
    coalesce(withdrawal_record.metadata -> 'financialPolicySnapshot', '{}'::jsonb),
    target_metadata || jsonb_build_object(
      'withdrawal_request_id', withdrawal_record.id,
      'withdrawal_amount', withdrawal_record.amount,
      'fee_amount', withdrawal_record.fee_amount,
      'total_debit_amount', withdrawal_record.total_debit_amount
    )
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
    target_metadata || jsonb_build_object(
      'reserve_transaction_id', reserved_transaction_id,
      'withdrawal_amount', withdrawal_record.amount,
      'fee_amount', withdrawal_record.fee_amount
    )
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
  revenue_wallet_id uuid;
  transfer_execution_id uuid;
  provider_log_id uuid;
  fee_revenue_transaction_id uuid;
  posted_reversal_transaction_id uuid;
  reversal_entries jsonb;
  provider_log_status text;
begin
  if not public.can_execute_financial_runtime() then
    raise exception 'withdrawal execution permission is required';
  end if;

  if target_withdrawal_request_id is null then
    raise exception 'target_withdrawal_request_id is required';
  end if;

  if target_provider_status not in ('processing', 'succeeded', 'failed', 'reversed') then
    raise exception 'target_provider_status is not supported';
  end if;

  if target_response_payload is null or jsonb_typeof(target_response_payload) <> 'object'
    or target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'withdrawal transfer JSON inputs must be objects';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select withdrawal.* into withdrawal_record
  from public.withdrawal_requests withdrawal
  where withdrawal.id = target_withdrawal_request_id
  for update;

  if not found then
    raise exception 'target_withdrawal_request_id must reference a withdrawal request';
  end if;

  if withdrawal_record.status = target_provider_status then
    return withdrawal_record.id;
  end if;

  if target_provider_status in ('processing', 'succeeded', 'failed')
    and withdrawal_record.status not in ('approved', 'processing') then
    raise exception 'withdrawal transfer cannot move to this provider status from its current status';
  end if;

  if target_provider_status = 'reversed'
    and withdrawal_record.status not in ('approved', 'processing', 'succeeded') then
    raise exception 'withdrawal transfer cannot be reversed from its current status';
  end if;

  provider_log_status := case
    when target_provider_status = 'processing' then 'queued'
    when target_provider_status = 'failed' then 'failed'
    else 'succeeded'
  end;

  provider_log_id := public.insert_provider_execution_log(
    withdrawal_record.provider_adapter_id,
    'payment',
    'provider.payment.transfer',
    provider_log_status,
    jsonb_build_object(
      'withdrawal_request_id', withdrawal_record.id,
      'amount', withdrawal_record.amount,
      'fee_amount', withdrawal_record.fee_amount,
      'total_debit_amount', withdrawal_record.total_debit_amount
    ),
    target_response_payload || jsonb_build_object(
      'provider_reference', target_provider_reference,
      'status', target_provider_status
    ),
    target_idempotency_key || ':provider',
    case when target_provider_status = 'failed' then 'payment provider transfer failed' else null end
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
  ) values (
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

  if target_provider_status = 'processing' then
    update public.withdrawal_requests
    set status = 'processing',
        provider_reference = coalesce(target_provider_reference, provider_reference),
        updated_at = timezone('utc', now())
    where id = withdrawal_record.id;

    perform public.record_withdrawal_event(
      withdrawal_record.id,
      'processing',
      'processing',
      target_idempotency_key || ':processing',
      target_metadata || jsonb_build_object('provider_reference', target_provider_reference)
    );

    return withdrawal_record.id;
  end if;

  clearing_wallet_id := public.ensure_platform_clearing_wallet(
    withdrawal_record.currency_code,
    'platform.withdrawal_engine',
    'withdrawal:' || withdrawal_record.id::text || ':clearing-wallet'
  );

  if target_provider_status = 'succeeded' then
    if withdrawal_record.fee_amount > 0 then
      revenue_wallet_id := public.ensure_platform_revenue_wallet(
        withdrawal_record.currency_code,
        'platform.withdrawal_revenue',
        'withdrawal:' || withdrawal_record.id::text || ':revenue-wallet'
      );

      fee_revenue_transaction_id := public.post_financial_transaction(
        'fee',
        withdrawal_record.currency_code,
        'platform.withdrawal_revenue',
        'wallet_withdrawal',
        withdrawal_record.id,
        jsonb_build_array(
          jsonb_build_object(
            'wallet_id', clearing_wallet_id,
            'direction', 'debit',
            'amount', withdrawal_record.fee_amount,
            'entry_type', 'fee',
            'metadata', jsonb_build_object(
              'role', 'withdrawal_fee_clearing',
              'withdrawal_request_id', withdrawal_record.id
            )
          ),
          jsonb_build_object(
            'wallet_id', revenue_wallet_id,
            'direction', 'credit',
            'amount', withdrawal_record.fee_amount,
            'entry_type', 'fee',
            'metadata', jsonb_build_object(
              'role', 'skima_revenue',
              'revenue_stream', 'withdrawal',
              'revenue_component', 'withdrawal_fee',
              'withdrawal_request_id', withdrawal_record.id
            )
          )
        ),
        'withdrawal:' || withdrawal_record.id::text || ':fee-earned',
        withdrawal_record.provider_adapter_id,
        target_provider_reference,
        coalesce(withdrawal_record.metadata -> 'financialPolicySnapshot', '{}'::jsonb),
        target_metadata || jsonb_build_object(
          'withdrawal_request_id', withdrawal_record.id,
          'withdrawal_amount', withdrawal_record.amount,
          'fee_amount', withdrawal_record.fee_amount
        )
      );
    end if;

    update public.withdrawal_requests
    set status = 'succeeded',
        provider_reference = target_provider_reference,
        processed_at = timezone('utc', now()),
        metadata = metadata || jsonb_build_object(
          'withdrawal_fee_revenue_transaction_id', fee_revenue_transaction_id
        ),
        updated_at = timezone('utc', now())
    where id = withdrawal_record.id;

    perform public.record_withdrawal_event(
      withdrawal_record.id,
      'succeeded',
      'succeeded',
      target_idempotency_key || ':succeeded',
      target_metadata || jsonb_build_object(
        'provider_reference', target_provider_reference,
        'withdrawal_fee_revenue_transaction_id', fee_revenue_transaction_id
      )
    );

    return withdrawal_record.id;
  end if;

  if target_provider_status = 'failed' then
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
          'metadata', jsonb_build_object(
            'role', 'withdrawal_clearing_release',
            'withdrawal_request_id', withdrawal_record.id
          )
        ),
        jsonb_build_object(
          'wallet_id', withdrawal_record.wallet_id,
          'direction', 'credit',
          'amount', withdrawal_record.total_debit_amount,
          'entry_type', 'principal',
          'metadata', jsonb_build_object(
            'role', 'withdrawal_source_refund',
            'withdrawal_request_id', withdrawal_record.id
          )
        )
      ),
      'withdrawal:' || withdrawal_record.id::text || ':failed-refund',
      withdrawal_record.provider_adapter_id,
      target_provider_reference,
      coalesce(withdrawal_record.metadata -> 'financialPolicySnapshot', '{}'::jsonb),
      target_metadata || jsonb_build_object(
        'withdrawal_request_id', withdrawal_record.id,
        'reserve_transaction_id', withdrawal_record.reserve_transaction_id
      )
    );

    update public.withdrawal_requests
    set status = 'failed',
        provider_reference = target_provider_reference,
        reversal_transaction_id = posted_reversal_transaction_id,
        failed_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = withdrawal_record.id;

    perform public.record_withdrawal_event(
      withdrawal_record.id,
      'failed',
      'failed',
      target_idempotency_key || ':failed',
      target_metadata || jsonb_build_object(
        'reversal_transaction_id', posted_reversal_transaction_id
      )
    );

    return withdrawal_record.id;
  end if;

  -- Provider reversal after a successful payout restores the principal from
  -- external clearing and also removes the previously earned SKIMA fee.
  if withdrawal_record.status = 'succeeded' then
    reversal_entries := jsonb_build_array(
      jsonb_build_object(
        'wallet_id', clearing_wallet_id,
        'direction', 'debit',
        'amount', withdrawal_record.amount,
        'entry_type', 'principal',
        'metadata', jsonb_build_object(
          'role', 'withdrawal_principal_reversal',
          'withdrawal_request_id', withdrawal_record.id
        )
      )
    );

    if withdrawal_record.fee_amount > 0 then
      revenue_wallet_id := public.ensure_platform_revenue_wallet(
        withdrawal_record.currency_code,
        'platform.withdrawal_revenue',
        'withdrawal:' || withdrawal_record.id::text || ':revenue-wallet'
      );

      reversal_entries := reversal_entries || jsonb_build_array(
        jsonb_build_object(
          'wallet_id', revenue_wallet_id,
          'direction', 'debit',
          'amount', withdrawal_record.fee_amount,
          'entry_type', 'fee',
          'metadata', jsonb_build_object(
            'role', 'skima_revenue_reversal',
            'revenue_stream', 'withdrawal',
            'revenue_component', 'withdrawal_fee',
            'withdrawal_request_id', withdrawal_record.id
          )
        )
      );
    end if;

    reversal_entries := reversal_entries || jsonb_build_array(
      jsonb_build_object(
        'wallet_id', withdrawal_record.wallet_id,
        'direction', 'credit',
        'amount', withdrawal_record.total_debit_amount,
        'entry_type', 'principal',
        'metadata', jsonb_build_object(
          'role', 'withdrawal_source_reversal',
          'withdrawal_request_id', withdrawal_record.id
        )
      )
    );
  else
    reversal_entries := jsonb_build_array(
      jsonb_build_object(
        'wallet_id', clearing_wallet_id,
        'direction', 'debit',
        'amount', withdrawal_record.total_debit_amount,
        'entry_type', 'principal',
        'metadata', jsonb_build_object(
          'role', 'withdrawal_clearing_release',
          'withdrawal_request_id', withdrawal_record.id
        )
      ),
      jsonb_build_object(
        'wallet_id', withdrawal_record.wallet_id,
        'direction', 'credit',
        'amount', withdrawal_record.total_debit_amount,
        'entry_type', 'principal',
        'metadata', jsonb_build_object(
          'role', 'withdrawal_source_reversal',
          'withdrawal_request_id', withdrawal_record.id
        )
      )
    );
  end if;

  posted_reversal_transaction_id := public.post_financial_transaction(
    'refund',
    withdrawal_record.currency_code,
    'platform.withdrawal_engine',
    'wallet_withdrawal',
    withdrawal_record.id,
    reversal_entries,
    'withdrawal:' || withdrawal_record.id::text || ':provider-reversal',
    withdrawal_record.provider_adapter_id,
    target_provider_reference,
    coalesce(withdrawal_record.metadata -> 'financialPolicySnapshot', '{}'::jsonb),
    target_metadata || jsonb_build_object(
      'withdrawal_request_id', withdrawal_record.id,
      'reserve_transaction_id', withdrawal_record.reserve_transaction_id,
      'withdrawal_fee_reversed', withdrawal_record.status = 'succeeded' and withdrawal_record.fee_amount > 0
    )
  );

  update public.withdrawal_requests
  set status = 'reversed',
      provider_reference = target_provider_reference,
      reversal_transaction_id = posted_reversal_transaction_id,
      reversed_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = withdrawal_record.id;

  perform public.record_withdrawal_event(
    withdrawal_record.id,
    'reversed',
    'reversed',
    target_idempotency_key || ':reversed',
    target_metadata || jsonb_build_object(
      'reversal_transaction_id', posted_reversal_transaction_id
    )
  );

  return withdrawal_record.id;
end;
$$;

create or replace function public.platform_revenue_activity(
  target_currency_code text default 'NGN',
  target_from timestamp with time zone default null,
  target_until timestamp with time zone default null,
  target_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  resolved_limit integer;
  result jsonb;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.revenue.read', null)
    and not public.has_permission('platform.revenue.manage', null) then
    raise exception 'platform revenue read permission is required';
  end if;

  if target_until is not null and target_from is not null and target_until <= target_from then
    raise exception 'target_until must be after target_from';
  end if;

  resolved_limit := least(greatest(coalesce(target_limit, 100), 1), 500);

  select coalesce(jsonb_agg(activity.payload order by activity.created_at desc), '[]'::jsonb)
  into result
  from (
    select
      ledger.created_at,
      jsonb_build_object(
        'ledgerEntryId', ledger.id,
        'transactionId', ledger.transaction_id,
        'createdAt', ledger.created_at,
        'direction', ledger.direction,
        'amount', ledger.amount,
        'signedAmount', case when ledger.direction = 'credit' then ledger.amount else -ledger.amount end,
        'currencyCode', ledger.currency_code,
        'revenueStream', coalesce(nullif(ledger.metadata ->> 'revenue_stream', ''), 'uncategorized'),
        'revenueComponent', coalesce(nullif(ledger.metadata ->> 'revenue_component', ''), 'uncategorized'),
        'transactionType', transaction.transaction_type,
        'source', transaction.source,
        'subjectType', transaction.subject_type,
        'subjectId', transaction.subject_id,
        'externalReference', transaction.external_reference,
        'metadata', ledger.metadata
      ) as payload
    from public.wallet_ledger_entries ledger
    join public.wallet_accounts wallet on wallet.id = ledger.wallet_id
    join public.financial_transactions transaction on transaction.id = ledger.transaction_id
    where wallet.wallet_type = 'platform_revenue'
      and wallet.owner_entity_type = 'platform'
      and wallet.currency_code = target_currency_code
      and (target_from is null or ledger.created_at >= target_from)
      and (target_until is null or ledger.created_at < target_until)
    order by ledger.created_at desc
    limit resolved_limit
  ) activity;

  return result;
end;
$$;

revoke all on function public.calculate_deposit_fee_from_policy(uuid, numeric, timestamp with time zone) from public;
grant execute on function public.calculate_deposit_fee_from_policy(uuid, numeric, timestamp with time zone) to authenticated, service_role;

revoke all on function public.platform_revenue_activity(text, timestamp with time zone, timestamp with time zone, integer) from public;
grant execute on function public.platform_revenue_activity(text, timestamp with time zone, timestamp with time zone, integer) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
