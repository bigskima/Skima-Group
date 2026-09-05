begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- Re-adding the same bank account for a wallet must be idempotent by the
-- resolved bank/account identity, not fail on the wallet/account hash unique
-- constraint. Provider verification still happens server-side before this RPC.

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
set search_path = public, extensions
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
    raise exception using errcode = '42501', message = 'authenticated user is required';
  end if;

  if target_wallet_id is null then
    raise exception using errcode = '22023', message = 'target_wallet_id is required';
  end if;

  if not public.can_access_wallet_account(target_wallet_id) then
    raise exception using errcode = '42501', message = 'wallet access permission is required';
  end if;

  if target_beneficiary_type not in ('bank_account', 'mobile_money', 'other') then
    raise exception using errcode = '22023', message = 'target_beneficiary_type is not supported';
  end if;

  if nullif(btrim(target_account_number), '') is null then
    raise exception using errcode = '22023', message = 'target_account_number is required';
  end if;

  if nullif(btrim(target_account_name), '') is null then
    raise exception using errcode = '22023', message = 'target_account_name is required';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception using errcode = '22023', message = 'target_source must be a valid platform key';
  end if;

  if nullif(btrim(target_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception using errcode = '22023', message = 'target_metadata must be a JSON object';
  end if;

  select wallet.*
  into wallet_record
  from public.wallet_accounts wallet
  where wallet.id = target_wallet_id
    and wallet.status = 'active';

  if not found then
    raise exception using errcode = '23514', message = 'target_wallet_id must reference an active wallet';
  end if;

  select provider.*
  into provider_record
  from public.provider_adapters provider
  where provider.provider_kind = 'payment'
    and provider.key = target_provider_adapter_key
    and provider.status = 'active';

  if not found then
    raise exception using errcode = '23514',
      message = 'target_provider_adapter_key must reference an active payment provider adapter';
  end if;

  select existing.*
  into existing_record
  from public.withdrawal_beneficiaries existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if found then
    return existing_record.id;
  end if;

  account_hash := encode(
    extensions.digest(
      convert_to(coalesce(target_bank_code, '') || ':' || btrim(target_account_number), 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  -- A bank account is reusable for the same wallet. This also lets a failed or
  -- previously disabled beneficiary be re-verified by the server-side provider
  -- adapter without creating a duplicate beneficiary row.
  select existing.*
  into existing_record
  from public.withdrawal_beneficiaries existing
  where existing.wallet_id = target_wallet_id
    and existing.account_reference_hash = account_hash
  order by existing.created_at
  limit 1;

  if found then
    update public.withdrawal_beneficiaries
    set account_name = btrim(target_account_name),
        bank_code = target_bank_code,
        provider_adapter_id = provider_record.id,
        metadata = coalesce(metadata, '{}'::jsonb) || target_metadata || jsonb_build_object(
          'lastReverifiedAt', timezone('utc', now()),
          'lastReverifiedSource', target_source
        ),
        updated_at = timezone('utc', now())
    where id = existing_record.id;

    return existing_record.id;
  end if;

  provider_log_id := public.insert_provider_execution_log(
    provider_record.id,
    'payment',
    'provider.payment.resolve_bank_account',
    'succeeded',
    jsonb_build_object(
      'bank_code', target_bank_code,
      'account_number_last4', right(btrim(target_account_number), 4)
    ),
    jsonb_build_object(
      'account_name', btrim(target_account_name),
      'verified', true
    ),
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
    right(btrim(target_account_number), 4),
    account_hash,
    btrim(target_account_name),
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

revoke all on function public.configure_withdrawal_beneficiary(
  uuid, text, text, text, text, text, text, text, jsonb
) from public, anon;

grant execute on function public.configure_withdrawal_beneficiary(
  uuid, text, text, text, text, text, text, text, jsonb
) to authenticated, service_role;

comment on function public.configure_withdrawal_beneficiary(
  uuid, text, text, text, text, text, text, text, jsonb
) is
  'Configures or reuses a wallet payout beneficiary after server-side bank-account verification; duplicate bank accounts for the same wallet return the canonical beneficiary row.';

notify pgrst, 'reload schema';

commit;
