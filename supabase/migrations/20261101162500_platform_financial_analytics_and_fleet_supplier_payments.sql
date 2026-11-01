begin;

-- Keep supplier disbursements in a dedicated platform account type rather than
-- reusing the customer, revenue, or generic clearing account.
alter table public.wallet_accounts
  drop constraint if exists wallet_accounts_wallet_type_check;
alter table public.wallet_accounts
  add constraint wallet_accounts_wallet_type_check
  check (wallet_type = any (array[
    'customer'::text,'driver'::text,'partner'::text,'platform'::text,
    'platform_clearing'::text,'platform_revenue'::text,'platform_liability'::text,
    'platform_provider'::text,'platform_campaign'::text,'platform_supplier'::text,
    'escrow'::text,'commission'::text,'refund'::text,'bonus'::text,
    'loyalty'::text,'generic'::text
  ]));

-- Immutable evidence for supplier payments made by SKIMA outside the customer wallet flow.
-- Procurement confirmation is not proof that a supplier has actually been paid.
create table if not exists public.lpg_internal_supplier_payments (
  id uuid primary key default gen_random_uuid(),
  procurement_id uuid not null references public.lpg_internal_refill_procurements(id) on delete restrict,
  financial_transaction_id uuid not null references public.financial_transactions(id) on delete restrict,
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  amount numeric(28,8) not null check (amount > 0),
  payment_method text not null check (payment_method in ('cash','bank_transfer')),
  payment_reference text,
  evidence_media_asset_id uuid references public.media_assets(id) on delete restrict,
  paid_by uuid references public.profiles(id) on delete set null,
  paid_at timestamptz not null default timezone('utc',now()),
  note text,
  source text not null default 'lpg.internal_supplier_payment',
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default timezone('utc',now()),
  unique(source,idempotency_key),
  check (payment_method <> 'bank_transfer' or nullif(btrim(payment_reference),'') is not null)
);

create index if not exists lpg_internal_supplier_payments_procurement_idx
  on public.lpg_internal_supplier_payments(procurement_id,paid_at desc);
create index if not exists lpg_internal_supplier_payments_transaction_idx
  on public.lpg_internal_supplier_payments(financial_transaction_id);
alter table public.lpg_internal_supplier_payments enable row level security;
revoke all on table public.lpg_internal_supplier_payments from public,anon,authenticated;
grant all on table public.lpg_internal_supplier_payments to service_role;

-- Financial evidence remains available only through the audited finance RPCs.
drop policy if exists lpg_internal_supplier_payments_deny_direct_authenticated
  on public.lpg_internal_supplier_payments;
create policy lpg_internal_supplier_payments_deny_direct_authenticated
  on public.lpg_internal_supplier_payments
  for all
  to authenticated
  using (false)
  with check (false);

drop trigger if exists audit_lpg_internal_supplier_payments on public.lpg_internal_supplier_payments;
create trigger audit_lpg_internal_supplier_payments
after insert on public.lpg_internal_supplier_payments
for each row execute function public.record_table_audit();

-- Supplier payment entries use a dedicated, platform-owned counter-account.
-- This does not represent a station/customer wallet or a customer settlement.
create or replace function public.record_lpg_internal_supplier_payment(
  target_procurement_id uuid,
  target_amount numeric,
  target_payment_method text,
  target_payment_reference text default null,
  target_evidence_media_asset_id uuid default null,
  target_note text default null,
  target_idempotency_key text default null,
  target_paid_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  procurement public.lpg_internal_refill_procurements%rowtype;
  existing_payment public.lpg_internal_supplier_payments%rowtype;
  order_record public.lpg_refill_orders%rowtype;
  settlement public.settlement_executions%rowtype;
  funding_wallet_id uuid;
  supplier_wallet_id uuid;
  transaction_id uuid;
  payment_id uuid;
  payment_reference text;
  paid_at_value timestamptz;
  prior_paid numeric(28,8);
  available_balance numeric(28,8);
  remaining_amount numeric(28,8);
begin
  if auth.role()<>'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.financial.manage',null) then
    raise exception using errcode='42501',message='platform financial management permission is required to record a supplier disbursement';
  end if;

  if target_procurement_id is null
    or target_amount is null or target_amount<=0
    or target_payment_method not in ('cash','bank_transfer')
    or coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='supplier, positive amount, payment method and idempotency key are required';
  end if;
  if nullif(btrim(coalesce(target_payment_reference,'')),'') is null then
    raise exception using errcode='22023',
      message=case when target_payment_method='bank_transfer'
        then 'bank transfer reference is required'
        else 'cash voucher or receipt reference is required for auditability'
      end;
  end if;
  if target_paid_at is not null and target_paid_at>timezone('utc',now())+interval '5 minutes' then
    raise exception using errcode='22023',message='supplier payment time cannot be in the future';
  end if;
  if target_evidence_media_asset_id is not null and not exists(
    select 1 from public.media_assets media
    where media.id=target_evidence_media_asset_id and media.status='active'
  ) then
    raise exception using errcode='22023',message='payment evidence must reference an active media asset';
  end if;

  select * into procurement
  from public.lpg_internal_refill_procurements
  where id=target_procurement_id
  for update;
  if not found then
    raise exception using errcode='22023',message='SKIMA Fleet procurement was not found';
  end if;

  -- Return an existing successful payment before recalculating its remaining balance.
  -- This preserves true idempotency, including retries after the final partial payment.
  select * into existing_payment
  from public.lpg_internal_supplier_payments
  where source='lpg.internal_supplier_payment'
    and idempotency_key=target_idempotency_key;
  if found then
    if existing_payment.procurement_id is distinct from target_procurement_id
      or existing_payment.amount<>round(target_amount,2)
      or existing_payment.payment_method is distinct from target_payment_method
      or existing_payment.payment_reference is distinct from nullif(btrim(coalesce(target_payment_reference,'')),'')
      or existing_payment.evidence_media_asset_id is distinct from target_evidence_media_asset_id
      or existing_payment.paid_at is distinct from coalesce(target_paid_at,timezone('utc',now()))
      or existing_payment.note is distinct from nullif(btrim(coalesce(target_note,'')),'') then
      raise exception using errcode='22023',message='supplier payment idempotency key was reused with different payment details';
    end if;

    select * into procurement
    from public.lpg_internal_refill_procurements
    where id=target_procurement_id;
    if not found then raise exception using errcode='22023',message='approved SKIMA Fleet procurement was not found'; end if;

    select * into order_record from public.lpg_refill_orders where id=procurement.lpg_order_id;
    select coalesce(sum(payment.amount),0) into prior_paid
    from public.lpg_internal_supplier_payments payment
    where payment.procurement_id=procurement.id;

    return jsonb_build_object(
      'paymentId',existing_payment.id,
      'financialTransactionId',existing_payment.financial_transaction_id,
      'procurementId',procurement.id,
      'orderId',order_record.id,
      'orderReference',order_record.public_reference,
      'amount',existing_payment.amount,
      'currencyCode',existing_payment.currency_code,
      'paymentMethod',existing_payment.payment_method,
      'paymentReference',existing_payment.payment_reference,
      'paidAt',existing_payment.paid_at,
      'remainingSupplierBalance',greatest(round(procurement.procurement_amount-prior_paid,2),0)
    );
  end if;

  if procurement.status<>'approved' then
    raise exception using errcode='22023',message='approved SKIMA Fleet procurement was not found';
  end if;

  select * into order_record
  from public.lpg_refill_orders
  where id=procurement.lpg_order_id
  for update;
  if not found or order_record.fulfillment_channel<>'skima_internal'
    or order_record.internal_settlement_execution_id is null then
    raise exception using errcode='55000',message='a settled SKIMA Fleet order is required before recording its supplier payment';
  end if;

  select * into settlement
  from public.settlement_executions
  where id=order_record.internal_settlement_execution_id and status='posted';
  if not found then
    raise exception using errcode='55000',message='posted SKIMA Fleet customer collection was not found';
  end if;

  select nullif(entry.value->>'wallet_id','')::uuid into funding_wallet_id
  from jsonb_array_elements(settlement.distribution) entry(value)
  where entry.value->>'role'='internal_lpg_cost_recovery'
  limit 1;
  if funding_wallet_id is null then
    raise exception using errcode='55000',message='SKIMA Fleet customer funds allocation is missing from the order settlement';
  end if;

  select coalesce(sum(payment.amount),0) into prior_paid
  from public.lpg_internal_supplier_payments payment
  where payment.procurement_id=procurement.id;
  remaining_amount:=round(procurement.procurement_amount-prior_paid,2);
  if round(target_amount,2)>remaining_amount then
    raise exception using errcode='22023',message=format('payment exceeds the remaining supplier balance of %s',remaining_amount);
  end if;

  select coalesce(balance.balance,0) into available_balance
  from public.wallet_accounts wallet
  left join public.wallet_balances balance
    on balance.wallet_id=wallet.id and balance.currency_code=wallet.currency_code
  where wallet.id=funding_wallet_id and wallet.currency_code=order_record.currency_code
    and wallet.wallet_type='platform_clearing' and wallet.owner_entity_type='platform'
    and wallet.status='active';
  if not found or available_balance<round(target_amount,2) then
    raise exception using errcode='55000',
      message='SKIMA platform clearing funds are insufficient for this disbursement. Reconcile the collection wallet before recording payment.';
  end if;

  select wallet.id into supplier_wallet_id
  from public.wallet_accounts wallet
  where wallet.wallet_type='platform_supplier'
    and wallet.owner_entity_type='platform'
    and wallet.owner_entity_id is null
    and wallet.currency_code=order_record.currency_code
    and wallet.status='active'
    and wallet.metadata->>'wallet_purpose'='lpg_supplier_disbursements'
  limit 1;

  if supplier_wallet_id is null then
    insert into public.wallet_accounts(
      wallet_type,owner_entity_type,owner_entity_id,currency_code,status,metadata,created_by,source,idempotency_key
    ) values(
      'platform_supplier','platform',null,order_record.currency_code,'active',
      jsonb_build_object('wallet_purpose','lpg_supplier_disbursements','platform_internal',true,'accounting_only',true),
      auth.uid(),'lpg.internal_supplier_payment','lpg-supplier-disbursements:'||lower(order_record.currency_code)
    )
    on conflict do nothing
    returning id into supplier_wallet_id;

    if supplier_wallet_id is null then
      select wallet.id into supplier_wallet_id
      from public.wallet_accounts wallet
      where wallet.wallet_type='platform_supplier' and wallet.owner_entity_type='platform'
        and wallet.owner_entity_id is null and wallet.currency_code=order_record.currency_code
        and wallet.status='active' and wallet.metadata->>'wallet_purpose'='lpg_supplier_disbursements'
      limit 1;
    end if;
  end if;
  if supplier_wallet_id is null then
    raise exception using errcode='55000',message='SKIMA supplier-disbursement account could not be initialized';
  end if;

  paid_at_value:=coalesce(target_paid_at,timezone('utc',now()));
  payment_reference:=nullif(btrim(coalesce(target_payment_reference,'')),'');

  transaction_id:=public.post_financial_transaction(
    'transfer',
    order_record.currency_code,
    'lpg.internal_supplier_payment',
    'lpg_internal_refill_procurement',
    procurement.id,
    jsonb_build_array(
      jsonb_build_object(
        'wallet_id',funding_wallet_id,'direction','debit','amount',round(target_amount,2),
        'entry_type','principal',
        'metadata',jsonb_build_object(
          'role','skima_fleet_funds_disbursed_to_supplier',
          'procurement_id',procurement.id,'lpg_order_id',order_record.id,
          'payment_method',target_payment_method
        )
      ),
      jsonb_build_object(
        'wallet_id',supplier_wallet_id,'direction','credit','amount',round(target_amount,2),
        'entry_type','principal',
        'metadata',jsonb_build_object(
          'role','skima_fleet_supplier_disbursement',
          'procurement_id',procurement.id,'lpg_order_id',order_record.id,
          'supplier_name',procurement.supplier_name,'payment_method',target_payment_method
        )
      )
    ),
    target_idempotency_key,
    null,
    payment_reference,
    coalesce(order_record.financial_policy_snapshot,'{}'::jsonb),
    jsonb_build_object(
      'fulfillment_channel','skima_internal',
      'fulfillment_mode','skima_fleet',
      'procurement_id',procurement.id,
      'lpg_order_id',order_record.id,
      'supplier_name',procurement.supplier_name,
      'payment_method',target_payment_method,
      'payment_reference',payment_reference,
      'evidence_media_asset_id',target_evidence_media_asset_id,
      'paid_at',paid_at_value,
      'note',nullif(btrim(coalesce(target_note,'')),'')
    )
  );

  insert into public.lpg_internal_supplier_payments(
    procurement_id,financial_transaction_id,currency_code,amount,payment_method,
    payment_reference,evidence_media_asset_id,paid_by,paid_at,note,source,idempotency_key,metadata
  ) values(
    procurement.id,transaction_id,order_record.currency_code,round(target_amount,2),target_payment_method,
    payment_reference,target_evidence_media_asset_id,auth.uid(),paid_at_value,
    nullif(btrim(coalesce(target_note,'')),''),
    'lpg.internal_supplier_payment',target_idempotency_key,
    jsonb_build_object('lpgOrderId',order_record.id,'supplierName',procurement.supplier_name)
  )
  on conflict(source,idempotency_key) do nothing
  returning id into payment_id;

  if payment_id is null then
    select id into payment_id from public.lpg_internal_supplier_payments
    where source='lpg.internal_supplier_payment' and idempotency_key=target_idempotency_key;
  end if;

  return jsonb_build_object(
    'paymentId',payment_id,
    'financialTransactionId',transaction_id,
    'procurementId',procurement.id,
    'orderId',order_record.id,
    'orderReference',order_record.public_reference,
    'amount',round(target_amount,2),
    'currencyCode',order_record.currency_code,
    'paymentMethod',target_payment_method,
    'paymentReference',payment_reference,
    'paidAt',paid_at_value,
    'remainingSupplierBalance',round(remaining_amount-target_amount,2)
  );
end;
$function$;

-- Read-only finance analytics. Revenue detail is independently protected from general finance reads.
create or replace function public.read_platform_financial_analytics(
  target_currency_code text default 'NGN',
  target_from timestamptz default null,
  target_until timestamptz default null,
  target_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
declare
  currency_code_value text:=upper(coalesce(target_currency_code,'NGN'));
  from_value timestamptz:=target_from;
  until_value timestamptz:=target_until;
  limit_value integer:=least(greatest(coalesce(target_limit,100),1),250);
  can_read_finance boolean;
  can_read_revenue boolean;
  revenue_summary jsonb:='{}'::jsonb;
  result jsonb;
begin
  can_read_finance:=auth.role()='service_role'
    or public.is_platform_super_admin()
    or public.has_permission('platform.financial.read',null)
    or public.has_permission('platform.financial.manage',null);
  can_read_revenue:=auth.role()='service_role'
    or public.is_platform_super_admin()
    or public.has_permission('platform.revenue.read',null)
    or public.has_permission('platform.revenue.manage',null);

  if not can_read_finance and not can_read_revenue then
    raise exception using errcode='42501',message='platform finance or revenue read permission is required';
  end if;
  if from_value is not null and until_value is not null and until_value<=from_value then
    raise exception using errcode='22023',message='target_until must be after target_from';
  end if;
  if not exists(select 1 from public.currency_definitions where code=currency_code_value and status='enabled') then
    raise exception using errcode='22023',message='requested currency is not enabled';
  end if;

  if can_read_revenue then
    revenue_summary:=public.platform_revenue_summary(currency_code_value,from_value,until_value);
  end if;

  select jsonb_build_object(
    'currencyCode',currency_code_value,
    'from',from_value,
    'until',until_value,
    'canReadFinance',can_read_finance,
    'canReadRevenue',can_read_revenue,
    'revenue',case when can_read_revenue then revenue_summary else null end,
    'walletBalances',case when can_read_finance then coalesce((
      select jsonb_agg(jsonb_build_object(
        'walletId',wallet.id,'walletType',wallet.wallet_type,
        'walletPurpose',wallet.metadata->>'wallet_purpose',
        'currencyCode',wallet.currency_code,'balance',coalesce(balance.balance,0)
      ) order by wallet.wallet_type,wallet.metadata->>'wallet_purpose')
      from public.wallet_accounts wallet
      left join public.wallet_balances balance
        on balance.wallet_id=wallet.id and balance.currency_code=wallet.currency_code
      where wallet.owner_entity_type='platform' and wallet.status='active'
        and wallet.currency_code=currency_code_value
        and (wallet.wallet_type<>'platform_revenue' or can_read_revenue)
    ),'[]'::jsonb) else '[]'::jsonb end,
    'transactionSummary',case when can_read_finance then coalesce((
      select jsonb_agg(jsonb_build_object(
        'transactionType',grouped.transaction_type,'status',grouped.status,
        'count',grouped.entry_count,'amount',grouped.total_amount
      ) order by grouped.transaction_type,grouped.status)
      from (
        select transaction.transaction_type,transaction.status,
          count(*) entry_count,sum(transaction.total_amount)::numeric(28,8) total_amount
        from public.financial_transactions transaction
        where transaction.currency_code=currency_code_value
          and (from_value is null or transaction.created_at>=from_value)
          and (until_value is null or transaction.created_at<until_value)
          and (can_read_revenue or not public.financial_transaction_touches_revenue(transaction.id))
        group by transaction.transaction_type,transaction.status
      ) grouped
    ),'[]'::jsonb) else '[]'::jsonb end,
    'transactionSources',case when can_read_finance then coalesce((
      select jsonb_agg(jsonb_build_object(
        'source',grouped.source,'transactionType',grouped.transaction_type,
        'status',grouped.status,'currencyCode',currency_code_value,
        'count',grouped.entry_count,'amount',grouped.total_amount
      ) order by grouped.total_amount desc,grouped.source)
      from (
        select transaction.source,transaction.transaction_type,transaction.status,
          count(*) entry_count,sum(transaction.total_amount)::numeric(28,8) total_amount
        from public.financial_transactions transaction
        where transaction.currency_code=currency_code_value
          and (from_value is null or transaction.created_at>=from_value)
          and (until_value is null or transaction.created_at<until_value)
          and (can_read_revenue or not public.financial_transaction_touches_revenue(transaction.id))
        group by transaction.source,transaction.transaction_type,transaction.status
      ) grouped
    ),'[]'::jsonb) else '[]'::jsonb end,
    'platformAccountMovements',case when can_read_finance then coalesce((
      select jsonb_agg(jsonb_build_object(
        'walletType',grouped.wallet_type,'walletPurpose',grouped.wallet_purpose,
        'direction',grouped.direction,'entryType',grouped.entry_type,
        'source',grouped.source,'currencyCode',currency_code_value,
        'count',grouped.entry_count,'amount',grouped.total_amount
      ) order by grouped.total_amount desc,grouped.wallet_type,grouped.direction)
      from (
        select wallet.wallet_type,wallet.metadata->>'wallet_purpose' wallet_purpose,
          ledger.direction,ledger.entry_type,transaction.source,
          count(*) entry_count,sum(ledger.amount)::numeric(28,8) total_amount
        from public.wallet_ledger_entries ledger
        join public.wallet_accounts wallet on wallet.id=ledger.wallet_id
        join public.financial_transactions transaction on transaction.id=ledger.transaction_id
        where wallet.owner_entity_type='platform'
          and ledger.currency_code=currency_code_value
          and (from_value is null or ledger.created_at>=from_value)
          and (until_value is null or ledger.created_at<until_value)
          and (can_read_revenue or wallet.wallet_type<>'platform_revenue')
        group by wallet.wallet_type,wallet.metadata->>'wallet_purpose',
          ledger.direction,ledger.entry_type,transaction.source
      ) grouped
    ),'[]'::jsonb) else '[]'::jsonb end,
    'withdrawals',case when can_read_finance then coalesce((
      select jsonb_build_object(
        'count',count(*),
        'requestedAmount',coalesce(sum(withdrawal.amount),0),
        'feeAmount',coalesce(sum(withdrawal.fee_amount),0),
        'totalDebitAmount',coalesce(sum(withdrawal.total_debit_amount),0),
        'processedAmount',coalesce(sum(withdrawal.amount) filter(where withdrawal.status='processed'),0),
        'pendingAmount',coalesce(sum(withdrawal.amount) filter(where withdrawal.status in ('requested','pending','approved','processing')),0),
        'failedAmount',coalesce(sum(withdrawal.amount) filter(where withdrawal.status in ('failed','reversed')),0)
      )
      from public.withdrawal_requests withdrawal
      join public.wallet_accounts wallet on wallet.id=withdrawal.wallet_id
      where withdrawal.currency_code=currency_code_value
        and (from_value is null or withdrawal.created_at>=from_value)
        and (until_value is null or withdrawal.created_at<until_value)
        and (wallet.wallet_type<>'platform_revenue' or can_read_revenue)
    ),'{}'::jsonb) else '{}'::jsonb end,
    'settlements',case when can_read_finance then coalesce((
      select jsonb_build_object(
        'count',count(*),'grossAmount',coalesce(sum(settlement.gross_amount),0),
        'postedAmount',coalesce(sum(settlement.gross_amount) filter(where settlement.status='posted'),0),
        'pendingAmount',coalesce(sum(settlement.gross_amount) filter(where settlement.status in ('pending','processing')),0),
        'failedAmount',coalesce(sum(settlement.gross_amount) filter(where settlement.status in ('failed','reversed')),0)
      )
      from public.settlement_executions settlement
      where settlement.currency_code=currency_code_value
        and (from_value is null or settlement.created_at>=from_value)
        and (until_value is null or settlement.created_at<until_value)
    ),'{}'::jsonb) else '{}'::jsonb end,
    'settlementStatements',case when can_read_finance then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',item.id,'publicReference',item.public_reference,
        'orderId',item.order_id,'serviceRequestId',item.service_request_id,
        'settlementExecutionId',item.settlement_execution_id,
        'currencyCode',item.currency_code,'grossAmount',item.gross_amount,
        'platformFeeAmount',item.platform_fee_amount,'netAmount',item.net_amount,
        'status',item.status,'source',item.source,
        'periodStart',item.period_start,'periodEnd',item.period_end,'createdAt',item.created_at
      ) order by item.created_at desc)
      from (
        select statement.* from public.settlement_statements statement
        where statement.currency_code=currency_code_value
          and (from_value is null or statement.created_at>=from_value)
          and (until_value is null or statement.created_at<until_value)
        order by statement.created_at desc limit limit_value
      ) item
    ),'[]'::jsonb) else '[]'::jsonb end,
    'financialAdjustments',case when can_read_finance then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',item.id,'orderId',item.lpg_order_id,'orderReference',item.public_reference,
        'adjustmentType',item.adjustment_type,'currencyCode',item.currency_code,
        'amount',item.amount,'transactionId',item.transaction_id,
        'status',item.status,'reasonKey',item.reason_key,
        'metadata',item.metadata,'source',item.source,
        'createdAt',item.created_at
      ) order by item.created_at desc)
      from (
        select adjustment.*,order_record.public_reference
        from public.lpg_order_financial_adjustments adjustment
        left join public.lpg_refill_orders order_record on order_record.id=adjustment.lpg_order_id
        where adjustment.currency_code=currency_code_value
          and (from_value is null or adjustment.created_at>=from_value)
          and (until_value is null or adjustment.created_at<until_value)
        order by adjustment.created_at desc limit limit_value
      ) item
    ),'[]'::jsonb) else '[]'::jsonb end,
    'reconciliationFindings',case when can_read_finance
      then public.read_ai_finance_reconciliation_findings('info',least(limit_value,100))
      else '[]'::jsonb end,
    'fleet',case when can_read_finance then jsonb_build_object(
      'orderCount',(
        select count(*) from public.lpg_refill_orders order_record
        join public.settlement_executions settlement on settlement.id=order_record.internal_settlement_execution_id and settlement.status='posted'
        where order_record.fulfillment_channel='skima_internal' and order_record.currency_code=currency_code_value
          and (from_value is null or settlement.created_at>=from_value)
          and (until_value is null or settlement.created_at<until_value)
      ),
      'customerCollections',coalesce((
        select sum(settlement.gross_amount)
        from public.lpg_refill_orders order_record
        join public.settlement_executions settlement on settlement.id=order_record.internal_settlement_execution_id and settlement.status='posted'
        where order_record.fulfillment_channel='skima_internal' and order_record.currency_code=currency_code_value
          and (from_value is null or settlement.created_at>=from_value)
          and (until_value is null or settlement.created_at<until_value)
      ),0),
      'customerLpgPrincipal',coalesce((
        select sum(order_record.station_amount)
        from public.lpg_refill_orders order_record
        join public.settlement_executions settlement
          on settlement.id=order_record.internal_settlement_execution_id and settlement.status='posted'
        where order_record.fulfillment_channel='skima_internal'
          and order_record.currency_code=currency_code_value
          and (from_value is null or settlement.created_at>=from_value)
          and (until_value is null or settlement.created_at<until_value)
      ),0),
      'procurementSpread',coalesce((
        select sum(order_record.station_amount-procurement.procurement_amount)
        from public.lpg_refill_orders order_record
        join public.settlement_executions settlement
          on settlement.id=order_record.internal_settlement_execution_id and settlement.status='posted'
        join public.lpg_internal_refill_procurements procurement on procurement.lpg_order_id=order_record.id
        where order_record.fulfillment_channel='skima_internal'
          and order_record.currency_code=currency_code_value
          and (from_value is null or settlement.created_at>=from_value)
          and (until_value is null or settlement.created_at<until_value)
      ),0),
      'fundsAllocatedToFleet',coalesce((
        select sum(ledger.amount)
        from public.wallet_ledger_entries ledger
        join public.wallet_accounts wallet on wallet.id=ledger.wallet_id
        join public.financial_transactions transaction on transaction.id=ledger.transaction_id
        where wallet.wallet_type='platform_clearing' and wallet.owner_entity_type='platform'
          and ledger.currency_code=currency_code_value and ledger.direction='credit'
          and ledger.metadata->>'role'='internal_lpg_cost_recovery'
          and (from_value is null or ledger.created_at>=from_value)
          and (until_value is null or ledger.created_at<until_value)
      ),0),
      'platformMarkupCollected',coalesce((
        select sum(order_record.platform_fee_amount)
        from public.lpg_refill_orders order_record
        join public.settlement_executions settlement on settlement.id=order_record.internal_settlement_execution_id and settlement.status='posted'
        where order_record.fulfillment_channel='skima_internal' and order_record.currency_code=currency_code_value
          and (from_value is null or settlement.created_at>=from_value)
          and (until_value is null or settlement.created_at<until_value)
      ),0),
      'deliveryFeesCollected',coalesce((
        select sum(order_record.delivery_fee_amount)
        from public.lpg_refill_orders order_record
        join public.settlement_executions settlement on settlement.id=order_record.internal_settlement_execution_id and settlement.status='posted'
        where order_record.fulfillment_channel='skima_internal' and order_record.currency_code=currency_code_value
          and (from_value is null or settlement.created_at>=from_value)
          and (until_value is null or settlement.created_at<until_value)
      ),0),
      'procurementCost',coalesce((
        select sum(procurement.procurement_amount)
        from public.lpg_internal_refill_procurements procurement
        join public.lpg_refill_orders order_record on order_record.id=procurement.lpg_order_id
        where order_record.currency_code=currency_code_value
          and (from_value is null or procurement.created_at>=from_value)
          and (until_value is null or procurement.created_at<until_value)
      ),0),
      'supplierPaid',coalesce((
        select sum(payment.amount)
        from public.lpg_internal_supplier_payments payment
        where payment.currency_code=currency_code_value
          and (from_value is null or payment.paid_at>=from_value)
          and (until_value is null or payment.paid_at<until_value)
      ),0),
      'supplierOutstanding',coalesce((
        select sum(greatest(procurement.procurement_amount-coalesce(paid.amount,0),0))
        from public.lpg_internal_refill_procurements procurement
        join public.lpg_refill_orders order_record on order_record.id=procurement.lpg_order_id
        left join lateral (
          select sum(payment.amount) amount from public.lpg_internal_supplier_payments payment
          where payment.procurement_id=procurement.id
        ) paid on true
        where order_record.currency_code=currency_code_value
          and (from_value is null or procurement.created_at>=from_value)
          and (until_value is null or procurement.created_at<until_value)
      ),0),
      'driverEarnings',coalesce((
        select sum(earning.earning_amount)
        from public.lpg_internal_driver_earnings earning
        join public.lpg_refill_orders order_record on order_record.id=earning.lpg_order_id
        where earning.currency_code=currency_code_value
          and (from_value is null or earning.created_at>=from_value)
          and (until_value is null or earning.created_at<until_value)
      ),0),
      'driverPaidToWallet',coalesce((
        select sum(payout.total_amount)
        from public.lpg_internal_driver_payouts payout
        where payout.currency_code=currency_code_value and payout.status='posted'
          and (from_value is null or payout.paid_at>=from_value)
          and (until_value is null or payout.paid_at<until_value)
      ),0),
      'driverUnpaidEarnings',coalesce((
        select sum(greatest(earning.earning_amount-coalesce(earning.paid_amount,0),0))
        from public.lpg_internal_driver_earnings earning
        join public.lpg_refill_orders order_record on order_record.id=earning.lpg_order_id
        where earning.currency_code=currency_code_value
          and (from_value is null or earning.created_at>=from_value)
          and (until_value is null or earning.created_at<until_value)
      ),0),
      'orders',coalesce((
        select jsonb_agg(jsonb_build_object(
          'orderId',item.id,'procurementId',item.procurement_id,'orderReference',item.public_reference,
          'createdAt',item.created_at,'completedAt',item.updated_at,
          'actualKg',item.actual_kg,'customerTotal',item.total_amount,'currencyCode',item.currency_code,
          'lpgPrincipalAllocated',item.station_amount,'procurementSpread',item.station_amount-item.procurement_amount,
          'platformMarkup',item.platform_fee_amount,'deliveryFee',item.delivery_fee_amount,
          'driverEarning',item.driver_commission_amount,
          'supplierName',item.supplier_name,'supplierPricePerKg',item.supplier_price_per_kg,
          'referencePricePerKg',item.reference_price_per_kg,'supplierVariancePercent',item.variance_percent,
          'procurementCost',item.procurement_amount,'supplierPaid',item.supplier_paid,
          'supplierOutstanding',greatest(item.procurement_amount-item.supplier_paid,0),
          'settlementId',item.internal_settlement_execution_id
        ) order by item.created_at desc)
        from (
          select order_record.id,procurement.id procurement_id,order_record.public_reference,order_record.created_at,order_record.updated_at,
            order_record.actual_kg,order_record.total_amount,order_record.station_amount,order_record.platform_fee_amount,
            order_record.delivery_fee_amount,order_record.driver_commission_amount,
            order_record.internal_settlement_execution_id,order_record.currency_code,procurement.supplier_name,
            procurement.supplier_price_per_kg,procurement.reference_price_per_kg,procurement.variance_percent,
            procurement.procurement_amount,coalesce(paid.amount,0) supplier_paid
          from public.lpg_refill_orders order_record
          join public.lpg_internal_refill_procurements procurement on procurement.lpg_order_id=order_record.id
          left join lateral (
            select sum(payment.amount) amount from public.lpg_internal_supplier_payments payment
            where payment.procurement_id=procurement.id
          ) paid on true
          where order_record.fulfillment_channel='skima_internal'
            and order_record.currency_code=currency_code_value
            and (from_value is null or order_record.created_at>=from_value)
            and (until_value is null or order_record.created_at<until_value)
          order by order_record.created_at desc limit 100
        ) item
      ),'[]'::jsonb),
      'supplierPayments',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',item.id,'procurementId',item.procurement_id,
          'orderReference',item.public_reference,'supplierName',item.supplier_name,
          'amount',item.amount,'currencyCode',item.currency_code,
          'paymentMethod',item.payment_method,'paymentReference',item.payment_reference,
          'paidAt',item.paid_at,'paidBy',item.display_name,
          'evidenceMediaAssetId',item.evidence_media_asset_id,
          'financialTransactionId',item.financial_transaction_id,'note',item.note
        ) order by item.paid_at desc)
        from (
          select payment.id,payment.procurement_id,order_record.public_reference,procurement.supplier_name,
            payment.amount,payment.currency_code,payment.payment_method,payment.payment_reference,
            payment.paid_at,profile.display_name,payment.evidence_media_asset_id,
            payment.financial_transaction_id,payment.note
          from public.lpg_internal_supplier_payments payment
          join public.lpg_internal_refill_procurements procurement on procurement.id=payment.procurement_id
          join public.lpg_refill_orders order_record on order_record.id=procurement.lpg_order_id
          left join public.profiles profile on profile.id=payment.paid_by
          where payment.currency_code=currency_code_value
            and (from_value is null or payment.paid_at>=from_value)
            and (until_value is null or payment.paid_at<until_value)
          order by payment.paid_at desc limit 100
        ) item
      ),'[]'::jsonb),
      'driverPayouts',coalesce((
        select jsonb_agg(jsonb_build_object(
          'payoutId',item.id,'payoutReference',item.payout_reference,
          'batchReference',item.batch_reference,'driverName',item.driver_name,
          'amount',item.total_amount,'currencyCode',item.currency_code,
          'status',item.status,'paidAt',item.paid_at,
          'financialTransactionId',item.financial_transaction_id,
          'allocationCount',item.allocation_count
        ) order by item.paid_at desc)
        from (
          select payout.id,payout.payout_reference,batch.batch_reference,profile.display_name driver_name,
            payout.total_amount,payout.currency_code,payout.status,payout.paid_at,
            payout.financial_transaction_id,
            (select count(*) from public.lpg_internal_driver_payout_allocations allocation
              where allocation.payout_id=payout.id) allocation_count
          from public.lpg_internal_driver_payouts payout
          left join public.lpg_internal_driver_payout_batches batch on batch.id=payout.batch_id
          left join public.driver_profiles driver on driver.id=payout.driver_profile_id
          left join public.profiles profile on profile.id=driver.user_id
          where payout.currency_code=currency_code_value
            and (from_value is null or payout.paid_at>=from_value)
            and (until_value is null or payout.paid_at<until_value)
          order by payout.paid_at desc limit 100
        ) item
      ),'[]'::jsonb),
      'earningRecords',coalesce((
        select jsonb_agg(jsonb_build_object(
          'earningId',item.id,'orderReference',item.public_reference,
          'driverName',item.driver_name,'basisAmount',item.basis_amount,
          'ratePercent',item.rate_percent,'earningAmount',item.earning_amount,
          'paidAmount',item.paid_amount,'unpaidAmount',greatest(item.earning_amount-coalesce(item.paid_amount,0),0),
          'currencyCode',item.currency_code,'status',item.status,'createdAt',item.created_at,'paidAt',item.paid_at
        ) order by item.created_at desc)
        from (
          select earning.id,order_record.public_reference,profile.display_name driver_name,
            earning.basis_amount,earning.rate_percent,earning.earning_amount,earning.paid_amount,
            earning.currency_code,earning.status,earning.created_at,earning.paid_at
          from public.lpg_internal_driver_earnings earning
          join public.lpg_refill_orders order_record on order_record.id=earning.lpg_order_id
          left join public.driver_profiles driver on driver.id=earning.driver_profile_id
          left join public.profiles profile on profile.id=driver.user_id
          where earning.currency_code=currency_code_value
            and (from_value is null or earning.created_at>=from_value)
            and (until_value is null or earning.created_at<until_value)
          order by earning.created_at desc limit 100
        ) item
      ),'[]'::jsonb)
    ) else '{}'::jsonb end,
    'recentTransactions',case when can_read_finance then coalesce((
      select jsonb_agg(jsonb_build_object(
        'transactionId',item.id,'createdAt',item.created_at,'transactionType',item.transaction_type,
        'status',item.status,'currencyCode',item.currency_code,'amount',item.total_amount,
        'source',item.source,'subjectType',item.subject_type,'subjectId',item.subject_id,
        'externalReference',item.external_reference,'metadata',item.metadata
      ) order by item.created_at desc)
      from (
        select transaction.* from public.financial_transactions transaction
        where transaction.currency_code=currency_code_value
          and (from_value is null or transaction.created_at>=from_value)
          and (until_value is null or transaction.created_at<until_value)
          and (can_read_revenue or not public.financial_transaction_touches_revenue(transaction.id))
        order by transaction.created_at desc limit limit_value
      ) item
    ),'[]'::jsonb) else '[]'::jsonb end,
    'recentLedgerEntries',case when can_read_finance then coalesce((
      select jsonb_agg(jsonb_build_object(
        'ledgerEntryId',item.id,'transactionId',item.transaction_id,
        'createdAt',item.created_at,'walletType',item.wallet_type,'walletPurpose',item.wallet_purpose,
        'direction',item.direction,'amount',item.amount,'entryType',item.entry_type,
        'source',item.source,'transactionStatus',item.transaction_status,'reference',item.external_reference,
        'metadata',item.metadata
      ) order by item.created_at desc)
      from (
        select ledger.id,ledger.transaction_id,ledger.created_at,ledger.direction,ledger.amount,ledger.entry_type,
          ledger.metadata,wallet.wallet_type,wallet.metadata->>'wallet_purpose' wallet_purpose,
          transaction.source,transaction.status transaction_status,transaction.external_reference
        from public.wallet_ledger_entries ledger
        join public.wallet_accounts wallet on wallet.id=ledger.wallet_id
        join public.financial_transactions transaction on transaction.id=ledger.transaction_id
        where ledger.currency_code=currency_code_value
          and (from_value is null or ledger.created_at>=from_value)
          and (until_value is null or ledger.created_at<until_value)
          and (can_read_revenue or wallet.wallet_type<>'platform_revenue')
        order by ledger.created_at desc limit limit_value
      ) item
    ),'[]'::jsonb) else '[]'::jsonb end
  ) into result;

  return result;
end;
$function$;

revoke all on function public.record_lpg_internal_supplier_payment(uuid,numeric,text,text,uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.record_lpg_internal_supplier_payment(uuid,numeric,text,text,uuid,text,text,timestamptz) to authenticated,service_role;

revoke all on function public.read_platform_financial_analytics(text,timestamptz,timestamptz,integer) from public,anon;
grant execute on function public.read_platform_financial_analytics(text,timestamptz,timestamptz,integer) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
