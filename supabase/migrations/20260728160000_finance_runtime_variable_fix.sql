begin;

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
          'wallet_id',
          clearing_wallet_id,
          'direction',
          'debit',
          'amount',
          deposit_record.amount,
          'entry_type',
          'principal',
          'metadata',
          jsonb_build_object('role', 'external_payment_clearing')
        ),
        jsonb_build_object(
          'wallet_id',
          deposit_record.wallet_id,
          'direction',
          'credit',
          'amount',
          deposit_record.amount,
          'entry_type',
          'principal',
          'metadata',
          jsonb_build_object('role', 'customer_wallet')
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
          'wallet_id',
          deposit_record.wallet_id,
          'direction',
          'debit',
          'amount',
          deposit_record.amount,
          'entry_type',
          'principal',
          'metadata',
          jsonb_build_object('role', 'customer_wallet_reversal')
        ),
        jsonb_build_object(
          'wallet_id',
          clearing_wallet_id,
          'direction',
          'credit',
          'amount',
          deposit_record.amount,
          'entry_type',
          'principal',
          'metadata',
          jsonb_build_object('role', 'external_payment_clearing')
        )
      ),
      target_idempotency_key || ':financial',
      deposit_record.provider_adapter_id,
      coalesce(target_provider_reference, deposit_record.provider_reference),
      jsonb_build_object(
        'deposit_request_id',
        deposit_record.id,
        'reversal_of_transaction_id',
        deposit_record.transaction_id
      ),
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
        'wallet_id',
        withdrawal_record.wallet_id,
        'direction',
        'debit',
        'amount',
        withdrawal_record.total_debit_amount,
        'entry_type',
        'principal',
        'metadata',
        jsonb_build_object('role', 'withdrawal_source')
      ),
      jsonb_build_object(
        'wallet_id',
        clearing_wallet_id,
        'direction',
        'credit',
        'amount',
        withdrawal_record.total_debit_amount,
        'entry_type',
        'principal',
        'metadata',
        jsonb_build_object('role', 'withdrawal_clearing')
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
    target_response_payload || jsonb_build_object(
      'provider_reference',
      target_provider_reference,
      'status',
      target_provider_status
    ),
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
        'wallet_id',
        clearing_wallet_id,
        'direction',
        'debit',
        'amount',
        withdrawal_record.total_debit_amount,
        'entry_type',
        'principal',
        'metadata',
        jsonb_build_object('role', 'withdrawal_clearing_reversal')
      ),
      jsonb_build_object(
        'wallet_id',
        withdrawal_record.wallet_id,
        'direction',
        'credit',
        'amount',
        withdrawal_record.total_debit_amount,
        'entry_type',
        'principal',
        'metadata',
        jsonb_build_object('role', 'withdrawal_source_reversal')
      )
    ),
    target_idempotency_key || ':reversal',
    withdrawal_record.provider_adapter_id,
    target_provider_reference,
    jsonb_build_object(
      'withdrawal_request_id',
      withdrawal_record.id,
      'reserve_transaction_id',
      withdrawal_record.reserve_transaction_id
    ),
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
        'wallet_id',
        target_customer_wallet_id,
        'direction',
        'debit',
        'amount',
        order_record.total_amount,
        'entry_type',
        'principal',
        'metadata',
        jsonb_build_object('role', 'customer_wallet')
      ),
      jsonb_build_object(
        'wallet_id',
        escrow_wallet_id,
        'direction',
        'credit',
        'amount',
        order_record.total_amount,
        'entry_type',
        'principal',
        'metadata',
        jsonb_build_object('role', 'escrow')
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

commit;
