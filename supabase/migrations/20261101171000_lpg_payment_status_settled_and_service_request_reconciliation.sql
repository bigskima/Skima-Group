begin;

-- A completed payment lifecycle needs an explicit terminal state. The escrow and
-- settlement records remain the source of truth; this order field now reflects them.
alter table public.lpg_refill_orders
  drop constraint if exists lpg_refill_orders_payment_status_check;

alter table public.lpg_refill_orders
  add constraint lpg_refill_orders_payment_status_check
  check (payment_status = any (array[
    'pending'::text,
    'reserved'::text,
    'settled'::text,
    'failed'::text,
    'refunded'::text,
    'expired'::text
  ]));

-- A service request can be fulfilled by the LPG context without creating a
-- generic order_records row. Reconcile its service-request hold against the
-- linked LPG order and the settlement transaction recorded by that order.
create or replace function public.read_service_request_financial_reconciliation_projection(
  target_service_request_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $function$
with linked_orders as materialized (
  select
    order_record.id,
    order_record.total_amount,
    order_record.escrow_hold_id,
    order_record.internal_settlement_execution_id,
    order_record.station_settlement_execution_id,
    order_record.underfill_refund_transaction_id
  from public.lpg_refill_orders order_record
  where order_record.service_request_id=target_service_request_id
),
hold_transactions as (
  select transaction.id,transaction.total_amount
  from public.financial_transactions transaction
  where transaction.subject_type='service_request'
    and transaction.subject_id=target_service_request_id
    and transaction.transaction_type='hold'
    and transaction.status='posted'
  union
  select transaction.id,transaction.total_amount
  from linked_orders order_record
  join public.escrow_holds hold_record on hold_record.id=order_record.escrow_hold_id
  join public.financial_transactions transaction on transaction.id=hold_record.source_transaction_id
  where transaction.transaction_type='hold'
    and transaction.status='posted'
),
lpg_release_transactions as (
  select transaction.id,transaction.total_amount
  from linked_orders order_record
  join public.settlement_executions settlement
    on settlement.id=any(array_remove(array[
      order_record.internal_settlement_execution_id,
      order_record.station_settlement_execution_id
    ],null::uuid))
   and settlement.status='posted'
  join public.financial_transactions transaction on transaction.id=settlement.transaction_id
  where transaction.status='posted'
),
release_transactions as (
  select transaction.id,transaction.total_amount
  from public.financial_transactions transaction
  where transaction.subject_type='service_request'
    and transaction.subject_id=target_service_request_id
    and transaction.transaction_type='release'
    and transaction.status='posted'
  union
  select id,total_amount from lpg_release_transactions
),
lpg_refund_transactions as (
  select transaction.id,transaction.total_amount
  from linked_orders order_record
  join public.financial_transactions transaction
    on transaction.id=order_record.underfill_refund_transaction_id
  where transaction.transaction_type='refund'
    and transaction.status='posted'
),
refund_transactions as (
  select transaction.id,transaction.total_amount
  from public.financial_transactions transaction
  where transaction.subject_type='service_request'
    and transaction.subject_id=target_service_request_id
    and transaction.transaction_type='refund'
    and transaction.status='posted'
  union
  select id,total_amount from lpg_refund_transactions
),
totals as (
  select
    (select count(*)::integer from linked_orders) as lpg_order_count,
    (select coalesce(sum(order_record.total_amount),0)::numeric(28,8) from linked_orders order_record) as lpg_order_total,
    (select coalesce(max(quote.total_amount),0)::numeric(28,8)
       from public.price_quotes quote
      where quote.service_request_id=target_service_request_id
        and quote.status='accepted') as quote_total,
    (select coalesce(max(order_record.total_amount),0)::numeric(28,8)
       from public.order_records order_record
      where order_record.service_request_id=target_service_request_id) as generic_order_total,
    (select coalesce(sum(total_amount),0)::numeric(28,8) from hold_transactions) as hold_total,
    (select coalesce(sum(total_amount),0)::numeric(28,8) from release_transactions) as release_total,
    (select coalesce(sum(total_amount),0)::numeric(28,8) from refund_transactions) as refund_total,
    (select coalesce(sum(total_amount),0)::numeric(28,8) from lpg_release_transactions) as lpg_release_total,
    (select coalesce(sum(total_amount),0)::numeric(28,8) from lpg_refund_transactions) as lpg_refund_total
)
select jsonb_build_object(
  'lpgOrderCount',totals.lpg_order_count,
  'lpgOrderTotal',totals.lpg_order_total,
  'quoteTotal',totals.quote_total,
  'genericOrderTotal',totals.generic_order_total,
  'orderTotal',greatest(totals.generic_order_total,totals.lpg_order_total),
  'expectedTotal',greatest(totals.quote_total,totals.generic_order_total,totals.lpg_order_total),
  'holdTotal',totals.hold_total,
  'releaseTotal',totals.release_total,
  'refundTotal',totals.refund_total,
  'lpgReleaseTotal',totals.lpg_release_total,
  'lpgRefundTotal',totals.lpg_refund_total,
  'balanced',(
    greatest(totals.quote_total,totals.generic_order_total,totals.lpg_order_total)>0
    and totals.hold_total=greatest(totals.quote_total,totals.generic_order_total,totals.lpg_order_total)
    and totals.hold_total=totals.release_total+totals.refund_total
  )
)
from totals;
$function$;

revoke all on function public.read_service_request_financial_reconciliation_projection(uuid) from public,anon,authenticated;
grant execute on function public.read_service_request_financial_reconciliation_projection(uuid) to service_role;

create or replace function public.reconcile_service_request_financials(target_service_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $function$
declare
  request_record public.service_requests%rowtype;
  projection jsonb;
  quote_total numeric(28,8);
  order_total numeric(28,8);
  expected_total numeric(28,8);
  hold_total numeric(28,8);
  release_total numeric(28,8);
  refund_total numeric(28,8);
begin
  if auth.role()<>'service_role'
    and not public.has_permission('platform.financial.manage',null)
    and not public.has_permission('platform.settlement.read',null)
    and not public.can_execute_platform_runtime() then
    raise exception 'financial reconciliation permission is required';
  end if;

  if target_service_request_id is null then
    raise exception 'target_service_request_id is required';
  end if;

  select * into request_record
  from public.service_requests request
  where request.id=target_service_request_id;

  if not found then
    raise exception 'target_service_request_id must reference an existing service request';
  end if;

  projection:=public.read_service_request_financial_reconciliation_projection(target_service_request_id);
  quote_total:=coalesce((projection->>'quoteTotal')::numeric,0);
  order_total:=coalesce((projection->>'orderTotal')::numeric,0);
  expected_total:=coalesce((projection->>'expectedTotal')::numeric,0);
  hold_total:=coalesce((projection->>'holdTotal')::numeric,0);
  release_total:=coalesce((projection->>'releaseTotal')::numeric,0);
  refund_total:=coalesce((projection->>'refundTotal')::numeric,0);

  return jsonb_build_object(
    'service_request_id',target_service_request_id,
    'status',request_record.status,
    'quote_total',quote_total,
    'order_total',order_total,
    'lpg_order_total',coalesce((projection->>'lpgOrderTotal')::numeric,0),
    'expected_total',expected_total,
    'hold_total',hold_total,
    'release_total',release_total,
    'refund_total',refund_total,
    'lpg_release_total',coalesce((projection->>'lpgReleaseTotal')::numeric,0),
    'lpg_refund_total',coalesce((projection->>'lpgRefundTotal')::numeric,0),
    'balanced',hold_total=expected_total and hold_total=release_total+refund_total
  );
end;
$function$;

-- Rebuild advisory reconciliation from the same projection used by the
-- authoritative service-request reconciliation RPC. This prevents LPG orders
-- from being omitted merely because their release transaction is typed to the
-- LPG order rather than to the generic service request.
-- Use a stable function definition instead of mutating pg_get_functiondef text.
create or replace function public.refresh_ai_finance_reconciliation_findings()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rule_record public.ai_finance_reconciliation_rules%rowtype;
  detected_keys text[] := array[]::text[];
  now_at timestamptz := timezone('utc', now());
  lookback_days integer;
  minimum_variance numeric;
  finding_record record;
  finding_key_value text;
  finding_severity text;
  refreshed_count integer := 0;
  resolved_count integer := 0;
begin
  select * into rule_record
  from public.ai_finance_reconciliation_rules
  where key = 'ai.finance.reconciliation.health'
    and status = 'active';

  if rule_record.id is null then
    return jsonb_build_object(
      'status', 'skipped',
      'reason', 'finance_reconciliation_rule_inactive',
      'refreshedCount', 0,
      'resolvedCount', 0,
      'refreshedAt', now_at,
      'control', 'advisory_only'
    );
  end if;

  lookback_days := greatest(
    1,
    least(365, (rule_record.config ->> 'lookback_days')::integer)
  );
  minimum_variance := greatest(
    0::numeric,
    (rule_record.config ->> 'minimum_variance')::numeric
  );

  for finding_record in
    with request_scope as (
      select request.id, request.status, request.updated_at
      from public.service_requests request
      where request.updated_at >= now_at - make_interval(days => lookback_days)
        and exists (
          select 1
          from jsonb_array_elements_text(rule_record.config -> 'terminal_service_statuses') allowed(status)
          where allowed.status = request.status
        )
    ),
    reconciled as (
      select
        request.id as service_request_id,
        request.status as service_status,
        coalesce((projection.financial->>'quoteTotal')::numeric,0)::numeric(28,8) as quote_total,
        coalesce((projection.financial->>'orderTotal')::numeric,0)::numeric(28,8) as order_total,
        coalesce((projection.financial->>'holdTotal')::numeric,0)::numeric(28,8) as hold_total,
        coalesce((projection.financial->>'releaseTotal')::numeric,0)::numeric(28,8) as release_total,
        coalesce((projection.financial->>'refundTotal')::numeric,0)::numeric(28,8) as refund_total,
        coalesce((projection.financial->>'lpgOrderTotal')::numeric,0)::numeric(28,8) as lpg_order_total,
        coalesce((projection.financial->>'lpgReleaseTotal')::numeric,0)::numeric(28,8) as lpg_release_total,
        coalesce((projection.financial->>'lpgRefundTotal')::numeric,0)::numeric(28,8) as lpg_refund_total,
        request.updated_at
      from request_scope request
      cross join lateral (
        select public.read_service_request_financial_reconciliation_projection(request.id) as financial
      ) projection
    )
    select
      reconciliation.service_request_id,
      reconciliation.service_status,
      reconciliation.quote_total,
      reconciliation.order_total,
      greatest(reconciliation.quote_total, reconciliation.order_total)::numeric(28,8) as expected_total,
      reconciliation.hold_total,
      reconciliation.release_total,
      reconciliation.refund_total,
      reconciliation.lpg_order_total,
      reconciliation.lpg_release_total,
      reconciliation.lpg_refund_total,
      greatest(
        abs(reconciliation.hold_total - greatest(reconciliation.quote_total, reconciliation.order_total)),
        abs(reconciliation.hold_total - (reconciliation.release_total + reconciliation.refund_total))
      )::numeric(28,8) as variance_amount,
      reconciliation.updated_at
    from reconciled reconciliation
    where greatest(reconciliation.quote_total, reconciliation.order_total) > 0
      and not (
        reconciliation.hold_total = greatest(reconciliation.quote_total, reconciliation.order_total)
        and reconciliation.hold_total = reconciliation.release_total + reconciliation.refund_total
      )
    order by variance_amount desc, reconciliation.updated_at desc
    limit 250
  loop
    if finding_record.variance_amount < minimum_variance then
      continue;
    end if;

    finding_key_value :=
      'ai.finance.service_request.unbalanced:' || finding_record.service_request_id::text;
    detected_keys := array_append(detected_keys, finding_key_value);
    finding_severity := case
      when finding_record.service_status in ('completed','settled')
        and finding_record.variance_amount >= greatest(finding_record.expected_total * 0.25, 1000::numeric)
        then 'critical'
      when finding_record.service_status in ('completed','settled') then 'high'
      else 'warning'
    end;

    insert into public.ai_finance_reconciliation_findings (
      rule_id, finding_key, finding_type, subject_type, subject_id, currency_code,
      severity, status, expected_amount, observed_amount, variance_amount, evidence,
      recommended_action, generated_at, last_detected_at, resolved_at, version
    )
    values (
      rule_record.id,
      finding_key_value,
      'service_request_unbalanced',
      'service_request',
      finding_record.service_request_id,
      null,
      finding_severity,
      'open',
      finding_record.expected_total,
      finding_record.release_total + finding_record.refund_total,
      finding_record.variance_amount,
      jsonb_build_object(
        'advisoryOnly', true,
        'serviceStatus', finding_record.service_status,
        'quoteTotal', finding_record.quote_total,
        'orderTotal', finding_record.order_total,
        'expectedTotal', finding_record.expected_total,
        'holdTotal', finding_record.hold_total,
        'releaseTotal', finding_record.release_total,
        'refundTotal', finding_record.refund_total,
        'lpgOrderTotal', finding_record.lpg_order_total,
        'lpgReleaseTotal', finding_record.lpg_release_total,
        'lpgRefundTotal', finding_record.lpg_refund_total,
        'authoritativeCheck', 'reconcile_service_request_financials',
        'doesNotPostLedger', true,
        'doesNotMoveFunds', true
      ),
      'Run the existing service-request reconciliation view and review the underlying quote, hold, release and refund records before making any financial correction.',
      now_at,
      now_at,
      null,
      1
    )
    on conflict (finding_key) do update
    set severity = excluded.severity,
        status = 'open',
        expected_amount = excluded.expected_amount,
        observed_amount = excluded.observed_amount,
        variance_amount = excluded.variance_amount,
        evidence = excluded.evidence,
        recommended_action = excluded.recommended_action,
        generated_at = excluded.generated_at,
        last_detected_at = excluded.last_detected_at,
        resolved_at = null,
        version = public.ai_finance_reconciliation_findings.version + 1,
        updated_at = timezone('utc', now());

    refreshed_count := refreshed_count + 1;
  end loop;

  for finding_record in
    select
      settlement.id,
      settlement.service_request_id,
      settlement.currency_code,
      settlement.gross_amount,
      settlement.created_at
    from public.settlement_executions settlement
    where settlement.status = 'posted'
      and settlement.transaction_id is null
      and settlement.created_at >= now_at - make_interval(days => lookback_days)
    order by settlement.created_at desc
    limit 250
  loop
    finding_key_value :=
      'ai.finance.settlement.missing_transaction:' || finding_record.id::text;
    detected_keys := array_append(detected_keys, finding_key_value);

    insert into public.ai_finance_reconciliation_findings (
      rule_id, finding_key, finding_type, subject_type, subject_id, currency_code,
      severity, status, expected_amount, observed_amount, variance_amount, evidence,
      recommended_action, generated_at, last_detected_at, resolved_at, version
    )
    values (
      rule_record.id,
      finding_key_value,
      'settlement_missing_transaction',
      'settlement_execution',
      finding_record.id,
      finding_record.currency_code,
      'high',
      'open',
      finding_record.gross_amount,
      null,
      finding_record.gross_amount,
      jsonb_build_object(
        'advisoryOnly', true,
        'serviceRequestId', finding_record.service_request_id,
        'settlementGrossAmount', finding_record.gross_amount,
        'postedWithoutTransactionId', true,
        'doesNotPostLedger', true,
        'doesNotMoveFunds', true
      ),
      'Review this posted settlement against its escrow and ledger transaction. Do not create an adjustment until the authoritative settlement and ledger records have been investigated.',
      now_at,
      now_at,
      null,
      1
    )
    on conflict (finding_key) do update
    set severity = excluded.severity,
        status = 'open',
        expected_amount = excluded.expected_amount,
        observed_amount = excluded.observed_amount,
        variance_amount = excluded.variance_amount,
        evidence = excluded.evidence,
        recommended_action = excluded.recommended_action,
        generated_at = excluded.generated_at,
        last_detected_at = excluded.last_detected_at,
        resolved_at = null,
        version = public.ai_finance_reconciliation_findings.version + 1,
        updated_at = timezone('utc', now());

    refreshed_count := refreshed_count + 1;
  end loop;

  for finding_record in
    select
      deposit.id,
      deposit.currency_code,
      deposit.amount,
      deposit.provider_reference,
      deposit.created_at
    from public.payment_deposit_requests deposit
    where deposit.status = 'succeeded'
      and deposit.transaction_id is null
      and deposit.created_at >= now_at - make_interval(days => lookback_days)
    order by deposit.created_at desc
    limit 250
  loop
    finding_key_value :=
      'ai.finance.deposit.missing_transaction:' || finding_record.id::text;
    detected_keys := array_append(detected_keys, finding_key_value);

    insert into public.ai_finance_reconciliation_findings (
      rule_id, finding_key, finding_type, subject_type, subject_id, currency_code,
      severity, status, expected_amount, observed_amount, variance_amount, evidence,
      recommended_action, generated_at, last_detected_at, resolved_at, version
    )
    values (
      rule_record.id,
      finding_key_value,
      'deposit_missing_transaction',
      'payment_deposit',
      finding_record.id,
      finding_record.currency_code,
      'high',
      'open',
      finding_record.amount,
      null,
      finding_record.amount,
      jsonb_build_object(
        'advisoryOnly', true,
        'providerReference', finding_record.provider_reference,
        'depositSucceededWithoutTransactionId', true,
        'doesNotPostLedger', true,
        'doesNotMoveFunds', true
      ),
      'Review the payment provider receipt and deposit event trail against the ledger before any manual correction is considered.',
      now_at,
      now_at,
      null,
      1
    )
    on conflict (finding_key) do update
    set severity = excluded.severity,
        status = 'open',
        expected_amount = excluded.expected_amount,
        observed_amount = excluded.observed_amount,
        variance_amount = excluded.variance_amount,
        evidence = excluded.evidence,
        recommended_action = excluded.recommended_action,
        generated_at = excluded.generated_at,
        last_detected_at = excluded.last_detected_at,
        resolved_at = null,
        version = public.ai_finance_reconciliation_findings.version + 1,
        updated_at = timezone('utc', now());

    refreshed_count := refreshed_count + 1;
  end loop;

  with resolved as (
    update public.ai_finance_reconciliation_findings finding
    set status = 'resolved',
        resolved_at = now_at,
        updated_at = now_at
    where finding.status = 'open'
      and finding.rule_id = rule_record.id
      and finding.finding_key <> all(coalesce(detected_keys, array[]::text[]))
    returning finding.id
  )
  select count(*) into resolved_count from resolved;

  return jsonb_build_object(
    'status', 'completed',
    'refreshedCount', refreshed_count,
    'resolvedCount', resolved_count,
    'refreshedAt', now_at,
    'control', 'advisory_only'
  );
end;
$$;

-- A posted LPG settlement (and any linked refund) completes the customer
-- payment lifecycle. Keep historical records aligned with their posted escrow
-- and settlement evidence; do not change ledger transactions or balances.
do $settle_lpg_payment_status$
declare
  function_sql text;
  old_block text;
  new_block text;
begin
  function_sql:=pg_get_functiondef('public.settle_lpg_internal_order(uuid,text,text)'::regprocedure);
  old_block:=$old$set internal_settlement_execution_id=settlement_execution_id,status='completed',$old$;
  new_block:=$new$set internal_settlement_execution_id=settlement_execution_id,status='completed',payment_status='settled',$new$;
  if position(old_block in function_sql)=0 then
    raise exception 'Could not locate internal LPG settlement order update';
  end if;
  execute replace(function_sql,old_block,new_block);

  function_sql:=pg_get_functiondef('public.settle_lpg_station_order(uuid,text,uuid,uuid,uuid,jsonb,text)'::regprocedure);
  old_block:=$old$set status = 'station_settled',
      station_settlement_execution_id = settlement_execution_id,$old$;
  new_block:=$new$set status = 'station_settled',
      payment_status = case
        when underfill_refund_amount >= order_record.total_amount then 'refunded'
        else 'settled'
      end,
      station_settlement_execution_id = settlement_execution_id,$new$;
  if position(old_block in function_sql)=0 then
    raise exception 'Could not locate marketplace LPG station settlement order update';
  end if;
  execute replace(function_sql,old_block,new_block);
end;
$settle_lpg_payment_status$;

update public.lpg_refill_orders order_record
set payment_status=case
  when coalesce((
    select sum(refund.total_amount)
    from public.financial_transactions refund
    where refund.id=order_record.underfill_refund_transaction_id
      and refund.transaction_type='refund'
      and refund.status='posted'
  ),0)>=order_record.total_amount then 'refunded'
  else 'settled'
end,
updated_at=timezone('utc',now())
from public.escrow_holds hold_record
where order_record.payment_status='reserved'
  and hold_record.id=order_record.escrow_hold_id
  and hold_record.status='released'
  and hold_record.released_amount=hold_record.hold_amount
  and exists (
    select 1
    from public.settlement_executions settlement
    join public.financial_transactions release_transaction
      on release_transaction.id=settlement.transaction_id
     and release_transaction.status='posted'
    where settlement.status='posted'
      and settlement.id in (
        order_record.internal_settlement_execution_id,
        order_record.station_settlement_execution_id
      )
  );

-- Refresh advisory findings after replacing both the authoritative and batch
-- reconciliation projections. This only updates finding status/evidence.
select public.refresh_ai_finance_reconciliation_findings();

notify pgrst,'reload schema';
commit;
