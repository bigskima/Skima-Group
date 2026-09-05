begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- Super Admin revenue payouts are deliberately separate from customer/driver/
-- partner withdrawals. The shared withdrawal/clearing/transfer lifecycle is
-- reused after the request is created, but consumer withdrawal eligibility is
-- not widened to platform treasury wallets.

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
            and wallet.owner_entity_type = 'platform'
            and (
              public.is_platform_super_admin()
              or public.has_permission('platform.revenue.read', null)
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

create or replace function public.read_platform_revenue_payout_context(
  target_currency_code text default 'NGN'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  revenue_wallet_id uuid;
  available_balance numeric(28,8) := 0;
  result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_platform_super_admin() then
    raise exception using errcode = '42501',
      message = 'Super Admin access is required for SKIMA revenue payouts';
  end if;

  select wallet.id, coalesce(balance.balance, 0)
  into revenue_wallet_id, available_balance
  from public.wallet_accounts wallet
  left join public.wallet_balances balance
    on balance.wallet_id = wallet.id
   and balance.currency_code = wallet.currency_code
  where wallet.wallet_type = 'platform_revenue'
    and wallet.owner_entity_type = 'platform'
    and wallet.currency_code = upper(target_currency_code)
    and wallet.status = 'active'
  order by wallet.created_at
  limit 1;

  if revenue_wallet_id is null then
    return jsonb_build_object(
      'currencyCode', upper(target_currency_code),
      'walletId', null,
      'availableBalance', 0,
      'beneficiaries', '[]'::jsonb,
      'recentPayouts', '[]'::jsonb
    );
  end if;

  select jsonb_build_object(
    'currencyCode', upper(target_currency_code),
    'walletId', revenue_wallet_id,
    'availableBalance', available_balance,
    'beneficiaries', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', beneficiary.id,
          'bankCode', beneficiary.bank_code,
          'accountName', beneficiary.account_name,
          'accountNumberLast4', beneficiary.account_number_last4,
          'status', beneficiary.status,
          'verifiedAt', beneficiary.verified_at,
          'createdAt', beneficiary.created_at
        )
        order by beneficiary.created_at desc
      )
      from public.withdrawal_beneficiaries beneficiary
      where beneficiary.wallet_id = revenue_wallet_id
        and beneficiary.beneficiary_type = 'bank_account'
        and beneficiary.status = 'verified'
    ), '[]'::jsonb),
    'recentPayouts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', payout.id,
          'publicReference', payout.public_reference,
          'beneficiaryId', payout.beneficiary_id,
          'amount', payout.amount,
          'currencyCode', payout.currency_code,
          'status', payout.status,
          'providerReference', payout.provider_reference,
          'requestedAt', payout.requested_at,
          'processedAt', payout.processed_at,
          'failedAt', payout.failed_at,
          'reversedAt', payout.reversed_at
        )
        order by payout.created_at desc
      )
      from (
        select withdrawal.*
        from public.withdrawal_requests withdrawal
        where withdrawal.wallet_id = revenue_wallet_id
          and withdrawal.source = 'platform.revenue_payout'
        order by withdrawal.created_at desc
        limit 30
      ) payout
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

create or replace function public.request_platform_revenue_withdrawal(
  target_beneficiary_id uuid,
  target_amount numeric,
  target_idempotency_key text,
  target_currency_code text default 'NGN',
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  revenue_wallet public.wallet_accounts%rowtype;
  beneficiary public.withdrawal_beneficiaries%rowtype;
  current_balance numeric(28,8) := 0;
  existing_id uuid;
  withdrawal_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_platform_super_admin() then
    raise exception using errcode = '42501',
      message = 'Super Admin access is required for SKIMA revenue payouts';
  end if;

  if target_beneficiary_id is null then
    raise exception using errcode = '22023', message = 'payout beneficiary is required';
  end if;

  if target_amount is null or target_amount <= 0 then
    raise exception using errcode = '22023', message = 'payout amount must be greater than zero';
  end if;

  if nullif(btrim(target_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'idempotency key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception using errcode = '22023', message = 'payout metadata must be a JSON object';
  end if;

  select withdrawal.id
  into existing_id
  from public.withdrawal_requests withdrawal
  where withdrawal.source = 'platform.revenue_payout'
    and withdrawal.idempotency_key = target_idempotency_key;

  if existing_id is not null then
    return existing_id;
  end if;

  select *
  into revenue_wallet
  from public.wallet_accounts wallet
  where wallet.wallet_type = 'platform_revenue'
    and wallet.owner_entity_type = 'platform'
    and wallet.currency_code = upper(target_currency_code)
    and wallet.status = 'active'
  order by wallet.created_at
  limit 1
  for update;

  if revenue_wallet.id is null then
    raise exception using errcode = '23514', message = 'SKIMA revenue wallet is not available';
  end if;

  select *
  into beneficiary
  from public.withdrawal_beneficiaries candidate
  where candidate.id = target_beneficiary_id
    and candidate.wallet_id = revenue_wallet.id
    and candidate.beneficiary_type = 'bank_account'
    and candidate.status = 'verified';

  if beneficiary.id is null then
    raise exception using errcode = '23514',
      message = 'Choose a verified SKIMA revenue payout account';
  end if;

  select coalesce(balance.balance, 0)
  into current_balance
  from public.wallet_balances balance
  where balance.wallet_id = revenue_wallet.id;

  if current_balance < target_amount then
    raise exception using errcode = '23514',
      message = 'SKIMA revenue balance is insufficient for this payout';
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
    revenue_wallet.id,
    beneficiary.id,
    beneficiary.provider_adapter_id,
    revenue_wallet.currency_code,
    target_amount,
    0,
    'requested',
    'platform.revenue_payout',
    target_idempotency_key,
    target_metadata || jsonb_build_object(
      'payoutKind', 'platform_revenue_treasury',
      'withdrawalFeeAmount', 0,
      'requestedBySuperAdmin', auth.uid()
    ),
    auth.uid()
  )
  returning id into withdrawal_id;

  perform public.record_withdrawal_event(
    withdrawal_id,
    'requested',
    'requested',
    target_idempotency_key || ':requested',
    target_metadata || jsonb_build_object(
      'payoutKind', 'platform_revenue_treasury',
      'withdrawal_amount', target_amount,
      'fee_amount', 0,
      'total_debit_amount', target_amount
    )
  );

  return withdrawal_id;
end;
$$;

-- Revenue reporting must distinguish earned revenue from treasury movements.
-- A payout decreases the cash remaining in the platform revenue wallet but must
-- never be reported as negative revenue earned by SKIMA.
create or replace function public.platform_revenue_summary(
  target_currency_code text default 'NGN',
  target_from timestamptz default null,
  target_until timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
  current_balance numeric(28,8) := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.revenue.read', null)
    and not public.has_permission('platform.revenue.manage', null) then
    raise exception using errcode = '42501',
      message = 'platform revenue read permission is required';
  end if;

  if target_until is not null and target_from is not null and target_until <= target_from then
    raise exception using errcode = '22023', message = 'target_until must be after target_from';
  end if;

  select coalesce(sum(balance.balance), 0)::numeric(28,8)
  into current_balance
  from public.wallet_accounts wallet
  left join public.wallet_balances balance
    on balance.wallet_id = wallet.id
   and balance.currency_code = wallet.currency_code
  where wallet.wallet_type = 'platform_revenue'
    and wallet.owner_entity_type = 'platform'
    and wallet.currency_code = upper(target_currency_code)
    and wallet.status = 'active';

  with all_entries as (
    select
      ledger.id,
      ledger.transaction_id,
      ledger.created_at,
      ledger.direction,
      ledger.amount,
      case when ledger.direction = 'credit' then ledger.amount else -ledger.amount end as signed_amount,
      ledger.metadata,
      transaction.subject_type,
      transaction.subject_id,
      withdrawal.source as withdrawal_source
    from public.wallet_ledger_entries ledger
    join public.wallet_accounts wallet on wallet.id = ledger.wallet_id
    join public.financial_transactions transaction on transaction.id = ledger.transaction_id
    left join public.withdrawal_requests withdrawal
      on transaction.subject_type = 'wallet_withdrawal'
     and withdrawal.id = transaction.subject_id
    where wallet.wallet_type = 'platform_revenue'
      and wallet.owner_entity_type = 'platform'
      and wallet.currency_code = upper(target_currency_code)
      and (target_from is null or ledger.created_at >= target_from)
      and (target_until is null or ledger.created_at < target_until)
  ),
  earned_entries as (
    select
      *,
      coalesce(nullif(metadata ->> 'revenue_stream', ''), 'uncategorized') as revenue_stream,
      coalesce(nullif(metadata ->> 'revenue_component', ''), 'uncategorized') as revenue_component
    from all_entries
    where coalesce(withdrawal_source, '') <> 'platform.revenue_payout'
  ),
  treasury_entries as (
    select *
    from all_entries
    where withdrawal_source = 'platform.revenue_payout'
  ),
  stream_totals as (
    select revenue_stream, sum(signed_amount)::numeric(28,8) as amount
    from earned_entries
    group by revenue_stream
  ),
  component_totals as (
    select revenue_stream, revenue_component, sum(signed_amount)::numeric(28,8) as amount
    from earned_entries
    group by revenue_stream, revenue_component
  )
  select jsonb_build_object(
    'currencyCode', upper(target_currency_code),
    'from', target_from,
    'until', target_until,
    'currentRevenueBalance', current_balance,
    'netRevenue', coalesce((select sum(signed_amount) from earned_entries), 0),
    'grossCredits', coalesce((select sum(amount) from earned_entries where direction = 'credit'), 0),
    'reversalsAndDebits', coalesce((select sum(amount) from earned_entries where direction = 'debit'), 0),
    'entryCount', (select count(*) from earned_entries),
    'treasuryNetOutflow', greatest(
      coalesce(-(select sum(signed_amount) from treasury_entries), 0),
      0
    ),
    'treasuryEntryCount', (select count(*) from treasury_entries),
    'byStream', coalesce((
      select jsonb_agg(
        jsonb_build_object('key', revenue_stream, 'amount', amount)
        order by revenue_stream
      )
      from stream_totals
    ), '[]'::jsonb),
    'byComponent', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'stream', revenue_stream,
          'component', revenue_component,
          'amount', amount
        )
        order by revenue_stream, revenue_component
      )
      from component_totals
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

create or replace function public.platform_revenue_activity(
  target_currency_code text default 'NGN',
  target_from timestamptz default null,
  target_until timestamptz default null,
  target_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  resolved_limit integer;
  result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.revenue.read', null)
    and not public.has_permission('platform.revenue.manage', null) then
    raise exception using errcode = '42501',
      message = 'platform revenue read permission is required';
  end if;

  if target_until is not null and target_from is not null and target_until <= target_from then
    raise exception using errcode = '22023', message = 'target_until must be after target_from';
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
        'signedAmount', case
          when ledger.direction = 'credit' then ledger.amount
          else -ledger.amount
        end,
        'currencyCode', ledger.currency_code,
        'activityKind', case
          when withdrawal.source = 'platform.revenue_payout' then 'treasury_payout'
          else 'earned_revenue'
        end,
        'revenueStream', case
          when withdrawal.source = 'platform.revenue_payout' then 'treasury'
          else coalesce(nullif(ledger.metadata ->> 'revenue_stream', ''), 'uncategorized')
        end,
        'revenueComponent', case
          when withdrawal.source = 'platform.revenue_payout' then 'revenue_withdrawal'
          else coalesce(nullif(ledger.metadata ->> 'revenue_component', ''), 'uncategorized')
        end,
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
    left join public.withdrawal_requests withdrawal
      on transaction.subject_type = 'wallet_withdrawal'
     and withdrawal.id = transaction.subject_id
    where wallet.wallet_type = 'platform_revenue'
      and wallet.owner_entity_type = 'platform'
      and wallet.currency_code = upper(target_currency_code)
      and (target_from is null or ledger.created_at >= target_from)
      and (target_until is null or ledger.created_at < target_until)
    order by ledger.created_at desc
    limit resolved_limit
  ) activity;

  return result;
end;
$$;

revoke all on function public.read_platform_revenue_payout_context(text)
  from public, anon, authenticated;
revoke all on function public.request_platform_revenue_withdrawal(uuid, numeric, text, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.read_platform_revenue_payout_context(text)
  to authenticated, service_role;
grant execute on function public.request_platform_revenue_withdrawal(uuid, numeric, text, text, jsonb)
  to authenticated, service_role;

comment on function public.request_platform_revenue_withdrawal(uuid, numeric, text, text, jsonb) is
  'Creates a zero-fee Super Admin treasury payout request from the protected SKIMA platform_revenue wallet without widening consumer withdrawal eligibility.';

comment on function public.read_platform_revenue_payout_context(text) is
  'Returns the protected platform revenue wallet payout balance, verified payout accounts, and recent treasury payout requests for Super Admin UI.';

notify pgrst, 'reload schema';

commit;
