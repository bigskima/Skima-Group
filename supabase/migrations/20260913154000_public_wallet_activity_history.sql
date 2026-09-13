begin;

create or replace function public.read_wallet_activity(
  target_wallet_id uuid,
  target_limit integer default 25,
  target_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  resolved_limit integer := least(greatest(coalesce(target_limit, 25), 1), 100);
  resolved_offset integer := greatest(coalesce(target_offset, 0), 0);
  total_count integer := 0;
  visible_count integer := 0;
  result_items jsonb := '[]'::jsonb;
begin
  if auth.uid() is null and auth.role() <> 'service_role' then
    raise exception 'authenticated user context is required';
  end if;

  if target_wallet_id is null then
    raise exception 'target_wallet_id is required';
  end if;

  if not public.can_access_wallet_account(target_wallet_id) then
    raise exception 'wallet access permission is required';
  end if;

  with activity as (
    -- Top-up attempts are included even when they never produced a ledger entry,
    -- so pending/cancelled/failed outcomes remain visible to the customer.
    select
      deposit.created_at as occurred_at,
      'deposit:' || deposit.id::text as activity_key,
      'wallet_top_up'::text as activity_type,
      'credit'::text as direction,
      deposit.amount as amount,
      deposit.currency_code,
      deposit.status,
      deposit.public_reference,
      case
        when deposit.status in ('succeeded','completed','posted') then 'Funds added to your SKIMA wallet.'
        when deposit.status in ('cancelled','canceled') then 'This top-up was cancelled and no funds were added.'
        when deposit.status in ('failed','declined','rejected') then 'This top-up attempt was unsuccessful.'
        when deposit.status in ('reversed','refunded') then 'This top-up was reversed after processing.'
        when deposit.status = 'expired' then 'The top-up payment window expired before completion.'
        else 'Your wallet top-up is awaiting payment confirmation.'
      end as description,
      provider.display_name as payment_method,
      null::text as counterparty,
      jsonb_build_object('depositRequestId', deposit.id) as navigation
    from public.payment_deposit_requests deposit
    left join public.provider_adapters provider on provider.id = deposit.provider_adapter_id
    where deposit.wallet_id = target_wallet_id

    union all

    select
      withdrawal.created_at as occurred_at,
      'withdrawal:' || withdrawal.id::text as activity_key,
      'withdrawal'::text as activity_type,
      'debit'::text as direction,
      coalesce(withdrawal.total_debit_amount, withdrawal.amount) as amount,
      withdrawal.currency_code,
      withdrawal.status,
      withdrawal.public_reference,
      case
        when withdrawal.status in ('succeeded','completed','processed','posted') then 'Withdrawal sent from your SKIMA wallet.'
        when withdrawal.status in ('failed','rejected','declined') then 'This withdrawal was unsuccessful.'
        when withdrawal.status in ('cancelled','canceled') then 'This withdrawal was cancelled.'
        when withdrawal.status in ('reversed','refunded') then 'This withdrawal was reversed and funds were returned.'
        else 'Your withdrawal is being processed.'
      end as description,
      provider.display_name as payment_method,
      null::text as counterparty,
      jsonb_build_object('withdrawalRequestId', withdrawal.id) as navigation
    from public.withdrawal_requests withdrawal
    left join public.provider_adapters provider on provider.id = withdrawal.provider_adapter_id
    where withdrawal.wallet_id = target_wallet_id

    union all

    select
      utility.created_at as occurred_at,
      'utility:' || utility.id::text as activity_key,
      'utility_payment'::text as activity_type,
      'debit'::text as direction,
      utility.total_amount as amount,
      utility.currency_code,
      utility.status,
      utility.public_reference,
      case
        when utility.status in ('succeeded','completed','fulfilled') then 'Utility payment completed.'
        when utility.status in ('failed','rejected','declined') then 'Utility payment failed.'
        when utility.status in ('refunded','reversed') then 'Utility payment was refunded.'
        when utility.status in ('cancelled','canceled') then 'Utility payment was cancelled.'
        else 'Utility payment is being processed.'
      end as description,
      null::text as payment_method,
      case
        when utility.recipient_phone is not null then utility.recipient_phone
        else null
      end as counterparty,
      jsonb_build_object('utilityPaymentId', utility.id) as navigation
    from public.utility_payment_requests utility
    where utility.wallet_id = target_wallet_id

    union all

    -- Ledger-backed movements are projected into public language. Internal
    -- accounts, policy snapshots, provider diagnostics, raw webhooks and ledger
    -- metadata are deliberately not returned.
    select
      ledger.created_at as occurred_at,
      'movement:' || ledger.id::text as activity_key,
      case
        when transaction.transaction_type = 'hold' and coalesce(transaction.metadata ->> 'bounded_context','') = 'lpg' then 'escrow_hold'
        when transaction.transaction_type in ('release','settlement') and ledger.direction = 'credit' then 'earnings'
        when transaction.transaction_type = 'commission' and ledger.direction = 'credit' then 'driver_earnings'
        when transaction.transaction_type in ('refund','reimbursement') then 'refund'
        when transaction.transaction_type in ('reversal','reverse') then 'reversal'
        when transaction.transaction_type = 'payment' then 'payment'
        else transaction.transaction_type
      end as activity_type,
      ledger.direction,
      ledger.amount,
      ledger.currency_code,
      case
        when transaction.transaction_type = 'hold' then 'reserved'
        when transaction.transaction_type in ('refund','reimbursement') and transaction.status = 'posted' then 'refunded'
        when transaction.transaction_type in ('reversal','reverse') and transaction.status = 'posted' then 'reversed'
        else transaction.status
      end as status,
      coalesce(
        nullif(transaction.metadata ->> 'lpg_public_reference',''),
        nullif(transaction.metadata ->> 'public_reference',''),
        nullif(transaction.external_reference,'')
      ) as public_reference,
      case
        when transaction.transaction_type = 'hold' and coalesce(transaction.metadata ->> 'bounded_context','') = 'lpg' and ledger.direction = 'debit'
          then 'Funds reserved securely for your LPG order.'
        when transaction.transaction_type = 'hold' and ledger.direction = 'credit'
          then 'Funds reserved for an active transaction.'
        when transaction.transaction_type = 'commission' and ledger.direction = 'credit'
          then 'Driver earnings added to your wallet.'
        when transaction.transaction_type in ('release','settlement') and ledger.direction = 'credit'
          then 'Earnings released to your wallet.'
        when transaction.transaction_type in ('refund','reimbursement') and ledger.direction = 'credit'
          then 'Refund returned to your wallet.'
        when transaction.transaction_type in ('reversal','reverse') and ledger.direction = 'credit'
          then 'Funds returned after a reversal.'
        when transaction.transaction_type = 'payment' and ledger.direction = 'debit'
          then 'Payment made from your SKIMA wallet.'
        when ledger.direction = 'credit'
          then 'Funds added to your SKIMA wallet.'
        else 'Funds moved from your SKIMA wallet.'
      end as description,
      provider.display_name as payment_method,
      null::text as counterparty,
      jsonb_strip_nulls(jsonb_build_object(
        'lpgOrderReference', nullif(transaction.metadata ->> 'lpg_public_reference','')
      )) as navigation
    from public.wallet_ledger_entries ledger
    join public.financial_transactions transaction on transaction.id = ledger.transaction_id
    left join public.provider_adapters provider on provider.id = transaction.provider_adapter_id
    where ledger.wallet_id = target_wallet_id
      and not exists (
        select 1
        from public.payment_deposit_requests deposit
        where deposit.wallet_id = target_wallet_id
          and ledger.transaction_id in (deposit.transaction_id, deposit.reversal_transaction_id)
      )
      and not exists (
        select 1
        from public.withdrawal_requests withdrawal
        where withdrawal.wallet_id = target_wallet_id
          and ledger.transaction_id in (withdrawal.reserve_transaction_id, withdrawal.reversal_transaction_id)
      )
      and not exists (
        select 1
        from public.utility_payment_requests utility
        where utility.wallet_id = target_wallet_id
          and ledger.transaction_id in (utility.reservation_transaction_id, utility.settlement_transaction_id, utility.refund_transaction_id)
      )
  ), counted as (
    select count(*)::integer as total from activity
  ), paged as (
    select *
    from activity
    order by occurred_at desc, activity_key desc
    offset resolved_offset
    limit resolved_limit
  )
  select
    counted.total,
    count(paged.activity_key)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'activityKey', paged.activity_key,
      'type', paged.activity_type,
      'direction', paged.direction,
      'amount', paged.amount,
      'currencyCode', paged.currency_code,
      'status', paged.status,
      'publicReference', paged.public_reference,
      'description', paged.description,
      'paymentMethod', paged.payment_method,
      'counterparty', paged.counterparty,
      'occurredAt', paged.occurred_at,
      'navigation', paged.navigation
    ) order by paged.occurred_at desc, paged.activity_key desc) filter (where paged.activity_key is not null), '[]'::jsonb)
  into total_count, visible_count, result_items
  from counted
  left join paged on true
  group by counted.total;

  return jsonb_build_object(
    'items', result_items,
    'totalCount', coalesce(total_count, 0),
    'offset', resolved_offset,
    'limit', resolved_limit,
    'hasMore', resolved_offset + coalesce(visible_count, 0) < coalesce(total_count, 0)
  );
end;
$$;

revoke all on function public.read_wallet_activity(uuid,integer,integer) from public, anon;
grant execute on function public.read_wallet_activity(uuid,integer,integer) to authenticated, service_role;

commit;
