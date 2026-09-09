begin;

set local lock_timeout='10s';
set local statement_timeout='0';

-- Keep protected utility economics reflected in the ledger: collection-cost
-- allocation and operating reserve remain in platform clearing instead of
-- being misclassified as withdrawable SKIMA revenue.
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
  cost_reserve_amount numeric(28,8);
  revenue_amount numeric(28,8);
  expected_contribution numeric(28,8);
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

  reserved_total := request_record.reserved_customer_amount
    + request_record.reserved_campaign_amount;

  if reserved_total <= 0 or request_record.clearing_wallet_id is null then
    raise exception 'utility payment reservation is incomplete';
  end if;

  if target_provider_status='succeeded' then
    provider_cost := coalesce(
      request_record.provider_cost_amount,
      request_record.subtotal_amount
    );
    cashback := coalesce(request_record.expected_cashback_amount,0);
    cost_reserve_amount :=
      coalesce(request_record.collection_cost_amount,0)
      + coalesce(request_record.operating_reserve_amount,0);
    revenue_amount := reserved_total
      - provider_cost
      - cashback
      - cost_reserve_amount;
    expected_contribution := coalesce(
      request_record.contribution_profit_amount,
      revenue_amount
    );

    if provider_cost < 0
       or cashback < 0
       or cost_reserve_amount < 0
       or revenue_amount < 0 then
      raise exception 'utility settlement economics are invalid';
    end if;

    if abs(revenue_amount - expected_contribution) > 0.01 then
      raise exception 'utility settlement no longer matches its protected contribution snapshot';
    end if;

    if revenue_amount + 0.01 < coalesce(request_record.minimum_profit_amount,0) then
      raise exception 'utility settlement would fall below the protected SKIMA profit floor';
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

    if cost_reserve_amount > 0 then
      entries := entries || jsonb_build_array(
        jsonb_build_object(
          'wallet_id',request_record.clearing_wallet_id,
          'direction','credit',
          'amount',cost_reserve_amount,
          'entry_type','adjustment',
          'metadata',jsonb_build_object(
            'utilityPaymentRequestId',request_record.id,
            'settlementPart','utility_cost_reserve',
            'collectionCost',coalesce(request_record.collection_cost_amount,0),
            'operatingReserve',coalesce(request_record.operating_reserve_amount,0)
          )
        )
      );
    end if;

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
            'settlementPart','protected_skima_contribution'
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
      null,
      coalesce(
        nullif(btrim(target_provider_reference),''),
        request_record.provider_reference,
        request_record.public_reference
      ),
      request_record.economics_snapshot,
      jsonb_build_object(
        'utilityPaymentRequestId',request_record.id,
        'providerKey',provider_record.key,
        'providerStatus','succeeded',
        'providerCost',provider_cost,
        'cashback',cashback,
        'costReserve',cost_reserve_amount,
        'protectedContribution',revenue_amount
      )
    );

    update public.utility_payment_requests
    set status='succeeded',
        provider_reference=coalesce(
          nullif(btrim(target_provider_reference),''),
          provider_reference,
          public_reference
        ),
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
      null,
      coalesce(
        nullif(btrim(target_provider_reference),''),
        request_record.provider_reference,
        request_record.public_reference
      ),
      request_record.economics_snapshot,
      jsonb_build_object(
        'utilityPaymentRequestId',request_record.id,
        'providerKey',provider_record.key,
        'providerStatus',target_provider_status,
        'errorCode',target_error_code
      )
    );

    update public.utility_payment_requests
    set status=target_provider_status,
        provider_reference=coalesce(
          nullif(btrim(target_provider_reference),''),
          provider_reference,
          public_reference
        ),
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
    'providerReference',coalesce(
      nullif(btrim(target_provider_reference),''),
      request_record.provider_reference,
      request_record.public_reference
    )
  );
end;
$$;

notify pgrst,'reload schema';

commit;