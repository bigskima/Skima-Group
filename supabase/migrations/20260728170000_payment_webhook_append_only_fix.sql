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

commit;
