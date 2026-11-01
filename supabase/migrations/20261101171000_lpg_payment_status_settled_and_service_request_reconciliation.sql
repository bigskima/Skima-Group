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
do $refresh_lpg_aware_reconciliation$
declare
  function_sql text;
  old_cte text;
  new_cte text;
  old_select text;
  new_select text;
  old_evidence text;
  new_evidence text;
begin
  function_sql:=pg_get_functiondef('public.refresh_ai_finance_reconciliation_findings()'::regprocedure);

  old_cte:=$old$
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
        coalesce((
          select max(quote.total_amount)
          from public.price_quotes quote
          where quote.service_request_id = request.id
            and quote.status = 'accepted'
        ), 0)::numeric(28,8) as quote_total,
        coalesce((
          select max(order_record.total_amount)
          from public.order_records order_record
          where order_record.service_request_id = request.id
        ), 0)::numeric(28,8) as order_total,
        coalesce((
          select sum(transaction.total_amount)
          from public.financial_transactions transaction
          where transaction.subject_type = 'service_request'
            and transaction.subject_id = request.id
            and transaction.transaction_type = 'hold'
            and transaction.status = 'posted'
        ), 0)::numeric(28,8) as hold_total,
        coalesce((
          select sum(transaction.total_amount)
          from public.financial_transactions transaction
          where transaction.subject_type = 'service_request'
            and transaction.subject_id = request.id
            and transaction.transaction_type = 'release'
            and transaction.status = 'posted'
        ), 0)::numeric(28,8) as release_total,
        coalesce((
          select sum(transaction.total_amount)
          from public.financial_transactions transaction
          where transaction.subject_type = 'service_request'
            and transaction.subject_id = request.id
            and transaction.transaction_type = 'refund'
            and transaction.status = 'posted'
        ), 0)::numeric(28,8) as refund_total,
        request.updated_at
      from request_scope request
    )
$old$;

  new_cte:=$new$
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
$new$;

  if position(old_cte in function_sql)=0 then
    raise exception 'Could not locate service-request reconciliation CTE in refresh function';
  end if;
  function_sql:=replace(function_sql,old_cte,new_cte);

  old_select:=$old$
      reconciliation.refund_total,
      greatest(
$old$;
  new_select:=$new$
      reconciliation.refund_total,
      reconciliation.lpg_order_total,
      reconciliation.lpg_release_total,
      reconciliation.lpg_refund_total,
      greatest(
$new$;
  if position(old_select in function_sql)=0 then
    raise exception 'Could not locate service-request reconciliation select projection';
  end if;
  function_sql:=replace(function_sql,old_select,new_select);

  old_evidence:=$old$
        'refundTotal', finding_record.refund_total,
        'authoritativeCheck', 'reconcile_service_request_financials',
$old$;
  new_evidence:=$new$
        'refundTotal', finding_record.refund_total,
        'lpgOrderTotal', finding_record.lpg_order_total,
        'lpgReleaseTotal', finding_record.lpg_release_total,
        'lpgRefundTotal', finding_record.lpg_refund_total,
        'authoritativeCheck', 'reconcile_service_request_financials',
$new$;
  if position(old_evidence in function_sql)=0 then
    raise exception 'Could not locate service-request financial reconciliation evidence fields';
  end if;
  function_sql:=replace(function_sql,old_evidence,new_evidence);

  execute function_sql;
end;
$refresh_lpg_aware_reconciliation$;

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
  when coalesce(refund.total_amount,0)>=order_record.total_amount then 'refunded'
  else 'settled'
end,
updated_at=timezone('utc',now())
from public.escrow_holds hold_record
join public.settlement_executions settlement
  on settlement.status='posted'
join public.financial_transactions release_transaction
  on release_transaction.id=settlement.transaction_id
 and release_transaction.status='posted'
left join public.financial_transactions refund
  on refund.id=order_record.underfill_refund_transaction_id
 and refund.transaction_type='refund'
 and refund.status='posted'
where order_record.payment_status='reserved'
  and hold_record.id=order_record.escrow_hold_id
  and hold_record.status='released'
  and hold_record.released_amount=hold_record.hold_amount
  and settlement.id in (
    order_record.internal_settlement_execution_id,
    order_record.station_settlement_execution_id
  )
  and release_transaction.transaction_type in ('release','transfer');

-- Refresh advisory findings after replacing both the authoritative and batch
-- reconciliation projections. This only updates finding status/evidence.
select public.refresh_ai_finance_reconciliation_findings();

notify pgrst,'reload schema';
commit;
