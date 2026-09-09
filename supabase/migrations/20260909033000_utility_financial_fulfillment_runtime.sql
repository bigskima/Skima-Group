begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

alter table public.utility_payment_requests
  add column if not exists reservation_transaction_id uuid references public.financial_transactions(id) on delete set null,
  add column if not exists settlement_transaction_id uuid references public.financial_transactions(id) on delete set null,
  add column if not exists refund_transaction_id uuid references public.financial_transactions(id) on delete set null,
  add column if not exists clearing_wallet_id uuid references public.wallet_accounts(id) on delete set null,
  add column if not exists campaign_funding_wallet_id uuid references public.wallet_accounts(id) on delete set null,
  add column if not exists reserved_customer_amount numeric(20,8) not null default 0,
  add column if not exists reserved_campaign_amount numeric(20,8) not null default 0,
  add column if not exists fulfillment_attempts integer not null default 0,
  add column if not exists reconciliation_attempts integer not null default 0,
  add column if not exists provider_attempted_at timestamptz,
  add column if not exists processing_started_at timestamptz,
  add column if not exists next_reconcile_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists last_error_message text;

alter table public.utility_payment_requests
  drop constraint if exists utility_payment_requests_runtime_amounts_check;
alter table public.utility_payment_requests
  add constraint utility_payment_requests_runtime_amounts_check
  check (
    reserved_customer_amount >= 0
    and reserved_campaign_amount >= 0
    and fulfillment_attempts >= 0
    and reconciliation_attempts >= 0
  );

create index if not exists utility_payment_requests_worker_idx
  on public.utility_payment_requests(status,next_reconcile_at,created_at);

create or replace function public.ensure_utility_campaign_funding_wallet(
  target_currency_code text default 'NGN'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  wallet_id uuid;
begin
  if auth.role() <> 'service_role'
     and not (
       public.has_permission('platform.billing.manage', null)
       and public.has_permission('platform.revenue.manage', null)
     )
     and not public.is_platform_super_admin() then
    raise exception using errcode='42501',
      message='utility campaign funding management permission is required';
  end if;

  wallet_id := public.ensure_platform_purpose_wallet(
    'platform_liability',
    'utility_campaign_funding',
    target_currency_code,
    'platform.utility_billing',
    'utility-campaign-funding:' || lower(target_currency_code)
  );

  return wallet_id;
end;
$$;

revoke all on function public.ensure_utility_campaign_funding_wallet(text)
from public, anon;
grant execute on function public.ensure_utility_campaign_funding_wallet(text)
to authenticated, service_role;

create or replace function public.fund_utility_campaign_pool(
  target_amount numeric,
  target_currency_code text default 'NGN',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source_wallet_id uuid;
  campaign_wallet_id uuid;
  current_balance numeric(28,8) := 0;
  transaction_id uuid;
  resolved_key text;
begin
  if auth.role() <> 'service_role'
     and not (
       public.has_permission('platform.billing.manage', null)
       and public.has_permission('platform.revenue.manage', null)
     )
     and not public.is_platform_super_admin() then
    raise exception using errcode='42501',
      message='utility campaign funding management permission is required';
  end if;

  if target_amount is null or target_amount <= 0 then
    raise exception 'campaign funding amount must be greater than zero';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'campaign funding metadata must be a JSON object';
  end if;

  source_wallet_id := public.ensure_platform_revenue_wallet(
    target_currency_code,
    'platform.utility_billing',
    'utility-campaign-source:' || lower(target_currency_code)
  );
  campaign_wallet_id := public.ensure_utility_campaign_funding_wallet(target_currency_code);

  select coalesce(balance.balance, 0)
  into current_balance
  from public.wallet_balances balance
  where balance.wallet_id = source_wallet_id;

  if current_balance < target_amount then
    raise exception 'SKIMA revenue balance is insufficient to fund this utility campaign pool';
  end if;

  resolved_key := coalesce(
    nullif(btrim(target_idempotency_key), ''),
    'utility-campaign-fund:' || gen_random_uuid()::text
  );

  transaction_id := public.post_financial_transaction(
    'transfer',
    target_currency_code,
    'platform.utility_billing',
    'utility_campaign_pool',
    campaign_wallet_id,
    jsonb_build_array(
      jsonb_build_object(
        'wallet_id', source_wallet_id,
        'direction', 'debit',
        'amount', target_amount,
        'entry_type', 'principal',
        'metadata', jsonb_build_object('purpose','utility_campaign_funding')
      ),
      jsonb_build_object(
        'wallet_id', campaign_wallet_id,
        'direction', 'credit',
        'amount', target_amount,
        'entry_type', 'principal',
        'metadata', jsonb_build_object('purpose','utility_campaign_funding')
      )
    ),
    resolved_key,
    null,
    null,
    '{}'::jsonb,
    target_metadata || jsonb_build_object('purpose','utility_campaign_funding')
  );

  return transaction_id;
end;
$$;

revoke all on function public.fund_utility_campaign_pool(numeric,text,text,jsonb)
from public, anon;
grant execute on function public.fund_utility_campaign_pool(numeric,text,text,jsonb)
to authenticated, service_role;

create or replace function public.reserve_utility_payment_request(
  target_request_id uuid,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_record public.utility_payment_requests%rowtype;
  current_customer_balance numeric(28,8) := 0;
  current_campaign_balance numeric(28,8) := 0;
  clearing_wallet_id uuid;
  campaign_wallet_id uuid := null;
  reservation_id uuid;
  entries jsonb;
  reserved_total numeric(28,8);
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode='42501',
      message='utility payment reservation is server-only';
  end if;

  if coalesce(btrim(target_idempotency_key),'') = '' then
    raise exception 'reservation idempotency key is required';
  end if;

  select *
  into request_record
  from public.utility_payment_requests
  where id = target_request_id
  for update;

  if not found then raise exception 'utility payment request was not found'; end if;

  if request_record.status in ('payment_reserved','processing','succeeded') then
    return jsonb_build_object(
      'requestId', request_record.id,
      'status', request_record.status,
      'reservationTransactionId', request_record.reservation_transaction_id,
      'reservedCustomerAmount', request_record.reserved_customer_amount,
      'reservedCampaignAmount', request_record.reserved_campaign_amount
    );
  end if;

  if request_record.status <> 'awaiting_payment' then
    raise exception 'utility payment request cannot be reserved in its current state';
  end if;

  select coalesce(balance.balance,0)
  into current_customer_balance
  from public.wallet_balances balance
  where balance.wallet_id = request_record.wallet_id;

  if current_customer_balance < request_record.total_amount then
    raise exception using errcode='23514',
      message='insufficient available wallet balance';
  end if;

  clearing_wallet_id := public.ensure_platform_clearing_wallet(
    request_record.currency_code,
    'platform.utility_billing',
    'utility-clearing:' || lower(request_record.currency_code)
  );

  if request_record.subsidized_campaign_cost_amount > 0 then
    campaign_wallet_id := public.ensure_utility_campaign_funding_wallet(
      request_record.currency_code
    );

    select coalesce(balance.balance,0)
    into current_campaign_balance
    from public.wallet_balances balance
    where balance.wallet_id = campaign_wallet_id;

    if current_campaign_balance < request_record.subsidized_campaign_cost_amount then
      raise exception using errcode='23514',
        message='utility campaign funding pool is insufficient for this promotion';
    end if;
  end if;

  entries := jsonb_build_array(
    jsonb_build_object(
      'wallet_id', request_record.wallet_id,
      'direction', 'debit',
      'amount', request_record.total_amount,
      'entry_type', 'principal',
      'metadata', jsonb_build_object(
        'utilityPaymentRequestId', request_record.id,
        'reservationPart', 'customer'
      )
    ),
    jsonb_build_object(
      'wallet_id', clearing_wallet_id,
      'direction', 'credit',
      'amount', request_record.total_amount,
      'entry_type', 'principal',
      'metadata', jsonb_build_object(
        'utilityPaymentRequestId', request_record.id,
        'reservationPart', 'customer'
      )
    )
  );

  if request_record.subsidized_campaign_cost_amount > 0 then
    entries := entries || jsonb_build_array(
      jsonb_build_object(
        'wallet_id', campaign_wallet_id,
        'direction', 'debit',
        'amount', request_record.subsidized_campaign_cost_amount,
        'entry_type', 'discount',
        'metadata', jsonb_build_object(
          'utilityPaymentRequestId', request_record.id,
          'reservationPart', 'campaign_subsidy'
        )
      ),
      jsonb_build_object(
        'wallet_id', clearing_wallet_id,
        'direction', 'credit',
        'amount', request_record.subsidized_campaign_cost_amount,
        'entry_type', 'discount',
        'metadata', jsonb_build_object(
          'utilityPaymentRequestId', request_record.id,
          'reservationPart', 'campaign_subsidy'
        )
      )
    );
  end if;

  reservation_id := public.post_financial_transaction(
    'hold',
    request_record.currency_code,
    'platform.utility_billing',
    'utility_payment_request',
    request_record.id,
    entries,
    target_idempotency_key,
    null,
    request_record.public_reference,
    request_record.economics_snapshot,
    jsonb_build_object(
      'utilityPaymentRequestId', request_record.id,
      'customerAmount', request_record.total_amount,
      'campaignAmount', request_record.subsidized_campaign_cost_amount
    )
  );

  reserved_total := request_record.total_amount + request_record.subsidized_campaign_cost_amount;

  update public.utility_payment_requests
  set status = 'payment_reserved',
      reservation_transaction_id = reservation_id,
      clearing_wallet_id = clearing_wallet_id,
      campaign_funding_wallet_id = campaign_wallet_id,
      reserved_customer_amount = request_record.total_amount,
      reserved_campaign_amount = request_record.subsidized_campaign_cost_amount,
      provider_response = provider_response || jsonb_build_object(
        'reservation', jsonb_build_object(
          'transactionId', reservation_id,
          'totalReserved', reserved_total
        )
      ),
      updated_at = timezone('utc',now())
  where id = request_record.id;

  return jsonb_build_object(
    'requestId', request_record.id,
    'status', 'payment_reserved',
    'reservationTransactionId', reservation_id,
    'reservedCustomerAmount', request_record.total_amount,
    'reservedCampaignAmount', request_record.subsidized_campaign_cost_amount
  );
end;
$$;

revoke all on function public.reserve_utility_payment_request(uuid,text)
from public, anon, authenticated;
grant execute on function public.reserve_utility_payment_request(uuid,text)
to service_role;

create or replace function public.claim_utility_payment_requests(
  target_limit integer default 25
)
returns table(
  request_id uuid,
  action text,
  provider_key text,
  provider_biller_code text,
  provider_product_code text,
  customer_identifier text,
  amount numeric,
  public_reference text,
  provider_reference text,
  fulfillment_attempts integer,
  reconciliation_attempts integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode='42501',
      message='utility fulfillment claiming is server-only';
  end if;

  if target_limit is null or target_limit < 1 or target_limit > 100 then
    raise exception 'target_limit must be between 1 and 100';
  end if;

  return query
  with candidates as (
    select request.id
    from public.utility_payment_requests request
    where
      request.status = 'payment_reserved'
      or (
        request.status = 'processing'
        and coalesce(request.next_reconcile_at, timezone('utc',now())) <= timezone('utc',now())
      )
    order by
      case when request.status='payment_reserved' then 0 else 1 end,
      request.created_at
    for update skip locked
    limit target_limit
  ),
  claimed as (
    update public.utility_payment_requests request
    set
      status = 'processing',
      processing_started_at = coalesce(request.processing_started_at, timezone('utc',now())),
      fulfillment_attempts = request.fulfillment_attempts
        + case when request.status='payment_reserved' then 1 else 0 end,
      reconciliation_attempts = request.reconciliation_attempts
        + case when request.status='processing' then 1 else 0 end,
      provider_attempted_at = case
        when request.status='payment_reserved' then timezone('utc',now())
        else request.provider_attempted_at
      end,
      next_reconcile_at = timezone('utc',now()) + interval '2 minutes',
      updated_at = timezone('utc',now())
    from candidates
    where request.id = candidates.id
    returning request.*
  )
  select
    request.id,
    case
      when request.provider_reference is null
        and request.reconciliation_attempts = 0 then 'purchase'
      else 'status'
    end,
    provider.key,
    coalesce(
      nullif(product.metadata->>'providerBillerCode',''),
      nullif(route.metadata->>'providerBillerCode','')
    ),
    route.provider_product_code,
    request.customer_identifier,
    request.subtotal_amount,
    request.public_reference,
    request.provider_reference,
    request.fulfillment_attempts,
    request.reconciliation_attempts
  from claimed request
  join public.utility_provider_routes route on route.id=request.provider_route_id
  join public.provider_adapters provider on provider.id=route.provider_adapter_id
  join public.utility_products product on product.id=request.product_id;
end;
$$;

revoke all on function public.claim_utility_payment_requests(integer)
from public, anon, authenticated;
grant execute on function public.claim_utility_payment_requests(integer)
to service_role;

create or replace function public.mark_utility_payment_processing(
  target_request_id uuid,
  target_provider_reference text,
  target_provider_response jsonb,
  target_error_code text default null,
  target_error_message text default null,
  target_retry_after_seconds integer default 120
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode='42501',
      message='utility fulfillment updates are server-only';
  end if;

  if target_retry_after_seconds is null
     or target_retry_after_seconds < 30
     or target_retry_after_seconds > 3600 then
    raise exception 'retry delay must be between 30 and 3600 seconds';
  end if;

  update public.utility_payment_requests
  set status='processing',
      provider_reference=coalesce(nullif(btrim(target_provider_reference),''),provider_reference,public_reference),
      provider_response=provider_response || coalesce(target_provider_response,'{}'::jsonb),
      last_error_code=nullif(btrim(target_error_code),''),
      last_error_message=nullif(btrim(target_error_message),''),
      next_reconcile_at=timezone('utc',now()) + make_interval(secs => target_retry_after_seconds),
      updated_at=timezone('utc',now())
  where id=target_request_id
    and status in ('payment_reserved','processing');

  if not found then
    raise exception 'utility payment request cannot be marked processing';
  end if;
end;
$$;

revoke all on function public.mark_utility_payment_processing(uuid,text,jsonb,text,text,integer)
from public, anon, authenticated;
grant execute on function public.mark_utility_payment_processing(uuid,text,jsonb,text,text,integer)
to service_role;

create or replace function public.finalize_utility_payment_request(
  target_request_id uuid,
  target_provider_status text,
  target_provider_reference text,
  target_provider_response jsonb,
  target_error_code text default null,
  target_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_record public.utility_payment_requests%rowtype;
  route_record public.utility_provider_routes%rowtype;
  provider_record public.provider_adapters%rowtype;
  provider_wallet_id uuid;
  revenue_wallet_id uuid;
  transaction_id uuid;
  entries jsonb := '[]'::jsonb;
  reserved_total numeric(28,8);
  provider_cost numeric(28,8);
  cashback numeric(28,8);
  revenue_amount numeric(28,8);
  final_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode='42501',
      message='utility fulfillment finalization is server-only';
  end if;

  if target_provider_status not in ('succeeded','failed','reversed') then
    raise exception 'provider final status must be succeeded, failed or reversed';
  end if;

  select *
  into request_record
  from public.utility_payment_requests
  where id=target_request_id
  for update;

  if not found then raise exception 'utility payment request was not found'; end if;

  if request_record.status in ('succeeded','failed','reversed') then
    return jsonb_build_object(
      'requestId',request_record.id,
      'status',request_record.status,
      'settlementTransactionId',request_record.settlement_transaction_id,
      'refundTransactionId',request_record.refund_transaction_id
    );
  end if;

  if request_record.status not in ('payment_reserved','processing') then
    raise exception 'utility payment request is not reserved for finalization';
  end if;

  select *
  into route_record
  from public.utility_provider_routes
  where id=request_record.provider_route_id;

  select *
  into provider_record
  from public.provider_adapters
  where id=route_record.provider_adapter_id;

  reserved_total := request_record.reserved_customer_amount + request_record.reserved_campaign_amount;

  if reserved_total <= 0 or request_record.clearing_wallet_id is null then
    raise exception 'utility payment reservation is incomplete';
  end if;

  if target_provider_status='succeeded' then
    provider_cost := coalesce(request_record.provider_cost_amount,request_record.subtotal_amount);
    cashback := coalesce(request_record.expected_cashback_amount,0);
    revenue_amount := reserved_total - provider_cost - cashback;

    if provider_cost < 0 or cashback < 0 or revenue_amount < 0 then
      raise exception 'utility settlement economics are invalid';
    end if;

    provider_wallet_id := public.ensure_platform_provider_wallet(
      request_record.currency_code,
      'platform.utility_billing',
      'utility-provider-wallet:' || lower(request_record.currency_code)
    );
    revenue_wallet_id := public.ensure_platform_revenue_wallet(
      request_record.currency_code,
      'platform.utility_billing',
      'utility-revenue-wallet:' || lower(request_record.currency_code)
    );

    entries := jsonb_build_array(
      jsonb_build_object(
        'wallet_id',request_record.clearing_wallet_id,
        'direction','debit',
        'amount',reserved_total,
        'entry_type','principal',
        'metadata',jsonb_build_object(
          'utilityPaymentRequestId',request_record.id,
          'settlementPart','clearing'
        )
      ),
      jsonb_build_object(
        'wallet_id',provider_wallet_id,
        'direction','credit',
        'amount',provider_cost,
        'entry_type','principal',
        'metadata',jsonb_build_object(
          'utilityPaymentRequestId',request_record.id,
          'settlementPart','provider_cost',
          'providerKey',provider_record.key
        )
      )
    );

    if cashback > 0 then
      entries := entries || jsonb_build_array(
        jsonb_build_object(
          'wallet_id',request_record.wallet_id,
          'direction','credit',
          'amount',cashback,
          'entry_type','discount',
          'metadata',jsonb_build_object(
            'utilityPaymentRequestId',request_record.id,
            'settlementPart','cashback'
          )
        )
      );
    end if;

    if revenue_amount > 0 then
      entries := entries || jsonb_build_array(
        jsonb_build_object(
          'wallet_id',revenue_wallet_id,
          'direction','credit',
          'amount',revenue_amount,
          'entry_type','commission',
          'metadata',jsonb_build_object(
            'utilityPaymentRequestId',request_record.id,
            'settlementPart','skima_revenue'
          )
        )
      );
    end if;

    transaction_id := public.post_financial_transaction(
      'release',
      request_record.currency_code,
      'platform.utility_billing',
      'utility_payment_request',
      request_record.id,
      entries,
      'utility-settle:' || request_record.id::text,
      provider_record.id,
      coalesce(nullif(btrim(target_provider_reference),''),request_record.provider_reference,request_record.public_reference),
      request_record.economics_snapshot,
      jsonb_build_object(
        'utilityPaymentRequestId',request_record.id,
        'providerStatus','succeeded',
        'providerCost',provider_cost,
        'cashback',cashback,
        'revenue',revenue_amount
      )
    );

    update public.utility_payment_requests
    set status='succeeded',
        provider_reference=coalesce(nullif(btrim(target_provider_reference),''),provider_reference,public_reference),
        provider_response=provider_response || coalesce(target_provider_response,'{}'::jsonb),
        settlement_transaction_id=transaction_id,
        last_error_code=null,
        last_error_message=null,
        next_reconcile_at=null,
        completed_at=timezone('utc',now()),
        updated_at=timezone('utc',now())
    where id=request_record.id;

    update public.utility_reward_awards
    set status='credited',
        credit_transaction_id=transaction_id,
        updated_at=timezone('utc',now())
    where payment_request_id=request_record.id
      and status in ('pending','earned');

    final_status := 'succeeded';
  else
    entries := jsonb_build_array(
      jsonb_build_object(
        'wallet_id',request_record.clearing_wallet_id,
        'direction','debit',
        'amount',reserved_total,
        'entry_type','principal',
        'metadata',jsonb_build_object(
          'utilityPaymentRequestId',request_record.id,
          'refundPart','clearing'
        )
      ),
      jsonb_build_object(
        'wallet_id',request_record.wallet_id,
        'direction','credit',
        'amount',request_record.reserved_customer_amount,
        'entry_type','principal',
        'metadata',jsonb_build_object(
          'utilityPaymentRequestId',request_record.id,
          'refundPart','customer'
        )
      )
    );

    if request_record.reserved_campaign_amount > 0 then
      if request_record.campaign_funding_wallet_id is null then
        raise exception 'utility campaign reservation wallet is missing';
      end if;
      entries := entries || jsonb_build_array(
        jsonb_build_object(
          'wallet_id',request_record.campaign_funding_wallet_id,
          'direction','credit',
          'amount',request_record.reserved_campaign_amount,
          'entry_type','discount',
          'metadata',jsonb_build_object(
            'utilityPaymentRequestId',request_record.id,
            'refundPart','campaign_subsidy'
          )
        )
      );
    end if;

    transaction_id := public.post_financial_transaction(
      'refund',
      request_record.currency_code,
      'platform.utility_billing',
      'utility_payment_request',
      request_record.id,
      entries,
      'utility-refund:' || request_record.id::text,
      provider_record.id,
      coalesce(nullif(btrim(target_provider_reference),''),request_record.provider_reference,request_record.public_reference),
      request_record.economics_snapshot,
      jsonb_build_object(
        'utilityPaymentRequestId',request_record.id,
        'providerStatus',target_provider_status,
        'errorCode',target_error_code
      )
    );

    update public.utility_payment_requests
    set status=target_provider_status,
        provider_reference=coalesce(nullif(btrim(target_provider_reference),''),provider_reference,public_reference),
        provider_response=provider_response || coalesce(target_provider_response,'{}'::jsonb),
        refund_transaction_id=transaction_id,
        last_error_code=nullif(btrim(target_error_code),''),
        last_error_message=nullif(btrim(target_error_message),''),
        next_reconcile_at=null,
        completed_at=timezone('utc',now()),
        updated_at=timezone('utc',now())
    where id=request_record.id;

    final_status := target_provider_status;
  end if;

  return jsonb_build_object(
    'requestId',request_record.id,
    'status',final_status,
    'transactionId',transaction_id,
    'providerReference',coalesce(nullif(btrim(target_provider_reference),''),request_record.provider_reference,request_record.public_reference)
  );
end;
$$;

revoke all on function public.finalize_utility_payment_request(uuid,text,text,jsonb,text,text)
from public, anon, authenticated;
grant execute on function public.finalize_utility_payment_request(uuid,text,text,jsonb,text,text)
to service_role;

create or replace function public.read_utility_campaign_pool_balance(
  target_currency_code text default 'NGN'
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  wallet_id uuid;
  balance_amount numeric(28,8) := 0;
begin
  if not (
    public.has_permission('platform.billing.read',null)
    or public.has_permission('platform.billing.manage',null)
    or public.is_platform_super_admin()
  ) then
    raise exception using errcode='42501',
      message='bill service access is required';
  end if;

  select wallet.id,coalesce(balance.balance,0)
  into wallet_id,balance_amount
  from public.wallet_accounts wallet
  left join public.wallet_balances balance on balance.wallet_id=wallet.id
  where wallet.wallet_type='platform_liability'
    and wallet.owner_entity_type='platform'
    and wallet.owner_entity_id is null
    and wallet.currency_code=target_currency_code
    and wallet.status='active'
  limit 1;

  return jsonb_build_object(
    'currencyCode',target_currency_code,
    'walletId',wallet_id,
    'balance',coalesce(balance_amount,0)
  );
end;
$$;

revoke all on function public.read_utility_campaign_pool_balance(text)
from public, anon;
grant execute on function public.read_utility_campaign_pool_balance(text)
to authenticated, service_role;

notify pgrst,'reload schema';

commit;
