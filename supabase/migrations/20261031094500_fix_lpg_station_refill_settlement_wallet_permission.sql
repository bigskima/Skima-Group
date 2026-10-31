begin;

create or replace function public.ensure_lpg_station_settlement_wallet(
  target_station_branch_id uuid,
  target_organization_id uuid,
  target_currency_code text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  resolved_wallet_id uuid;
  matching_wallet_status text;
begin
  if target_station_branch_id is null
    or target_organization_id is null
    or target_currency_code is null
    or target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'station settlement wallet identity is incomplete';
  end if;

  if not exists (
    select 1
    from public.lpg_station_branches station
    where station.id = target_station_branch_id
      and station.organization_id = target_organization_id
      and station.approval_status = 'approved'
      and station.compliance_status = 'approved'
  ) then
    raise exception 'an approved and compliant LPG station is required for settlement wallet reuse';
  end if;

  select wallet.id, wallet.status
  into resolved_wallet_id, matching_wallet_status
  from public.wallet_accounts wallet
  where wallet.wallet_type = 'partner'
    and wallet.owner_entity_type = 'organization'
    and wallet.owner_entity_id = target_organization_id
    and wallet.currency_code = target_currency_code
  order by case when wallet.status = 'active' then 0 else 1 end,
    wallet.created_at asc
  limit 1
  for update;

  if found then
    if matching_wallet_status <> 'active' then
      raise exception 'the LPG station settlement wallet exists but is not active';
    end if;
    return resolved_wallet_id;
  end if;

  -- This helper is intentionally private. Only the SECURITY DEFINER
  -- settlement function can invoke it after its branch/trigger authorization.
  insert into public.wallet_accounts (
    wallet_type,
    owner_entity_type,
    owner_entity_id,
    currency_code,
    status,
    metadata,
    created_by,
    source,
    idempotency_key
  )
  values (
    'partner',
    'organization',
    target_organization_id,
    target_currency_code,
    'active',
    jsonb_build_object(
      'wallet_purpose', 'lpg_station_settlement',
      'station_branch_id', target_station_branch_id,
      'provisioned_by', 'lpg_station_settlement'
    ),
    auth.uid(),
    'lpg.wallet_engine',
    target_idempotency_key
  )
  on conflict do nothing
  returning id into resolved_wallet_id;

  if resolved_wallet_id is null then
    select wallet.id, wallet.status
    into resolved_wallet_id, matching_wallet_status
    from public.wallet_accounts wallet
    where wallet.wallet_type = 'partner'
      and wallet.owner_entity_type = 'organization'
      and wallet.owner_entity_id = target_organization_id
      and wallet.currency_code = target_currency_code
    order by case when wallet.status = 'active' then 0 else 1 end,
      wallet.created_at asc
    limit 1
    for update;

    if not found or matching_wallet_status <> 'active' then
      raise exception 'active LPG station settlement wallet could not be ensured';
    end if;
    return resolved_wallet_id;
  end if;

  insert into public.wallet_account_events (
    wallet_account_id,
    event_type,
    status,
    idempotency_key,
    metadata
  )
  values (
    resolved_wallet_id,
    'created',
    'active',
    target_idempotency_key || ':created',
    jsonb_build_object(
      'source', 'lpg.wallet_engine',
      'wallet_purpose', 'lpg_station_settlement',
      'station_branch_id', target_station_branch_id
    )
  )
  on conflict (wallet_account_id, idempotency_key) do nothing;

  return resolved_wallet_id;
end;
$function$;

revoke all on function public.ensure_lpg_station_settlement_wallet(uuid,uuid,text,text) from public, anon, authenticated;


CREATE OR REPLACE FUNCTION public.settle_lpg_station_order(target_lpg_order_id uuid, target_idempotency_key text, target_station_wallet_id uuid DEFAULT NULL::uuid, target_platform_wallet_id uuid DEFAULT NULL::uuid, target_actor_user_id uuid DEFAULT NULL::uuid, target_metadata jsonb DEFAULT '{}'::jsonb, target_source text DEFAULT 'lpg.station_settlement_api'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  order_record public.lpg_refill_orders%rowtype;
  quote_record public.lpg_refill_quotes%rowtype;
  station_record public.lpg_station_branches%rowtype;
  actor_user_id uuid;
  order_record_id uuid;
  station_wallet_id uuid;
  platform_wallet_id uuid;
  customer_wallet_id uuid;
  settlement_policy jsonb;
  settlement_configuration jsonb;
  markup_policy jsonb;
  locked_markup_per_kg numeric(28, 8);
  quote_station_amount numeric(28, 8);
  quote_platform_markup numeric(28, 8);
  actual_station_amount numeric(28, 8);
  actual_platform_markup numeric(28, 8);
  tax_amount numeric(28, 8);
  delivery_margin_amount numeric(28, 8);
  platform_release_amount numeric(28, 8);
  station_underfill_refund numeric(28, 8);
  markup_underfill_refund numeric(28, 8);
  underfill_refund_amount numeric(28, 8);
  refund_transaction_id uuid;
  settlement_execution_id uuid;
  settlement_statement_id uuid;
  distribution jsonb := '[]'::jsonb;
begin
  if target_lpg_order_id is null
    or target_idempotency_key is null or btrim(target_idempotency_key) = ''
    or target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'LPG order, idempotency key, and valid metadata are required';
  end if;

  actor_user_id := coalesce(target_actor_user_id, auth.uid());

  select * into order_record
  from public.lpg_refill_orders
  where id = target_lpg_order_id
  for update;

  if not found then raise exception 'target_lpg_order_id must reference an LPG order'; end if;
  if order_record.station_settlement_execution_id is not null then
    return order_record.station_settlement_execution_id;
  end if;
  if order_record.status <> 'refill_confirmed' then
    raise exception 'LPG station settlement requires a confirmed refill';
  end if;
  if order_record.escrow_hold_id is null or order_record.actual_kg is null then
    raise exception 'LPG station settlement requires reserved escrow and confirmed actual kilograms';
  end if;

  select * into quote_record
  from public.lpg_refill_quotes
  where id = order_record.lpg_refill_quote_id;

  if not found or quote_record.status <> 'accepted' then
    raise exception 'an accepted LPG quote is required for settlement';
  end if;

  select * into station_record
  from public.lpg_station_branches
  where id = order_record.station_branch_id;

  if not found then raise exception 'LPG station branch is required before settlement'; end if;

  if coalesce((target_metadata ->> 'automatic_refill_settlement')::boolean, false) then
    -- Automatic station settlement is trusted only while executing the
    -- AFTER INSERT trigger for the matching, already-recorded refill event.
    if pg_trigger_depth() = 0
      or not exists (
        select 1
        from public.lpg_order_events refill_event
        where refill_event.id::text = target_metadata ->> 'source_event_id'
          and refill_event.lpg_order_id = order_record.id
          and refill_event.event_type = 'lpg.refill.confirmed'
      ) then
      raise exception 'automatic LPG station settlement must originate from a verified refill event trigger';
    end if;
    if actor_user_id is null then
      actor_user_id := auth.uid();
    end if;
  elsif auth.role() = 'service_role' then
    if actor_user_id is not null
      and not public.user_can_operate_lpg_station_branch(actor_user_id, station_record.id, 'lpg.orders.finance')
      and not public.user_can_operate_lpg_station_branch(actor_user_id, station_record.id, 'lpg.stations.manage') then
      raise exception 'branch-scoped LPG finance actor permission is required';
    end if;
  elsif not public.can_operate_lpg_station_branch(station_record.id, 'lpg.orders.finance') then
    raise exception 'branch-scoped LPG finance permission is required';
  end if;

  settlement_policy := order_record.financial_policy_snapshot -> 'settlement';
  markup_policy := order_record.financial_policy_snapshot -> 'platformMarkup';

  if settlement_policy is null or jsonb_typeof(settlement_policy) <> 'object'
    or settlement_policy ->> 'policyVersionId' is null
    or settlement_policy ->> 'currencyCode' <> order_record.currency_code
    or markup_policy is null or jsonb_typeof(markup_policy) <> 'object'
    or markup_policy ->> 'policyVersionId' is null
    or markup_policy ->> 'currencyCode' <> order_record.currency_code then
    raise exception 'complete currency-matched locked settlement and markup policy snapshots are required';
  end if;

  settlement_configuration := settlement_policy -> 'configuration';
  if jsonb_typeof(settlement_configuration -> 'station_settlement_components') <> 'array'
    or not (settlement_configuration -> 'station_settlement_components' @>
      '["station_lpg_principal","platform_lpg_markup","platform_logistics_margin","tax"]'::jsonb)
    or jsonb_typeof(settlement_configuration -> 'underfill_refund_components') <> 'array'
    or not (settlement_configuration -> 'underfill_refund_components' @>
      '["station_lpg_principal","platform_lpg_markup"]'::jsonb)
    or settlement_configuration ->> 'driver_payout_release_event' <> 'lpg.delivery.verified' then
    raise exception 'locked LPG settlement policy is missing required beneficiary and reconciliation controls';
  end if;

  locked_markup_per_kg := nullif(markup_policy -> 'configuration' ->> 'amount_per_kg', '')::numeric;
  if locked_markup_per_kg is null or locked_markup_per_kg < 0 then
    raise exception 'locked LPG markup policy must define non-negative amount_per_kg';
  end if;

  quote_station_amount := quote_record.lpg_amount - case when order_record.fulfillment_mode = 'station_managed' and quote_record.delivery_pricing_mode = 'included' then quote_record.station_delivery_fee_amount else 0 end;
  quote_platform_markup := quote_record.platform_fee_amount;
  actual_station_amount := order_record.station_amount;
  actual_platform_markup := round(order_record.actual_kg * locked_markup_per_kg, 2);
  tax_amount := quote_record.tax_amount;

  if round(quote_record.quoted_kg * locked_markup_per_kg, 2) <> quote_platform_markup then
    raise exception 'accepted quote platform markup does not match its locked policy snapshot';
  end if;

  if order_record.actual_kg > quote_record.quoted_kg
    or actual_station_amount > quote_station_amount
    or actual_platform_markup > quote_platform_markup then
    insert into public.lpg_order_financial_adjustments (
      lpg_order_id, adjustment_type, currency_code, amount, status,
      reason_key, metadata, source, idempotency_key
    ) values (
      order_record.id, 'overfill_blocked', order_record.currency_code,
      greatest(actual_station_amount + actual_platform_markup - quote_station_amount - quote_platform_markup, 0),
      'blocked', 'lpg.overfill.manual_review',
      target_metadata || jsonb_build_object(
        'quoted_kg', quote_record.quoted_kg,
        'actual_kg', order_record.actual_kg,
        'policy_version_id', markup_policy ->> 'policyVersionId'
      ),
      target_source, target_idempotency_key || ':overfill'
    ) on conflict (source, idempotency_key) do nothing;

    raise exception 'LPG overfill is blocked for manual review';
  end if;

  station_underfill_refund := greatest(quote_station_amount - actual_station_amount, 0);
  markup_underfill_refund := greatest(quote_platform_markup - actual_platform_markup, 0);
  underfill_refund_amount := station_underfill_refund + markup_underfill_refund;
  delivery_margin_amount := quote_record.delivery_fee_amount - quote_record.driver_commission_amount;
  if order_record.fulfillment_mode = 'station_managed' then delivery_margin_amount := 0; end if;

  if delivery_margin_amount < 0 then
    raise exception 'locked driver payout exceeds the accepted delivery fee';
  end if;

  platform_release_amount := actual_platform_markup + tax_amount + delivery_margin_amount;

  order_record_id := public.ensure_lpg_order_record(
    order_record.id,
    target_idempotency_key || ':order-record',
    'lpg.order_projection',
    target_metadata || jsonb_build_object(
      'financial_policy_snapshot', order_record.financial_policy_snapshot
    )
  );

  station_wallet_id := coalesce(
    target_station_wallet_id,
    public.ensure_lpg_station_settlement_wallet(
      station_record.id,
      station_record.organization_id,
      order_record.currency_code,
      target_idempotency_key || ':station-wallet'
    )
  );

  platform_wallet_id := coalesce(
    target_platform_wallet_id,
    public.ensure_platform_clearing_wallet(
      order_record.currency_code, 'lpg.wallet_engine', target_idempotency_key || ':platform-wallet'
    )
  );

  select wallet.id into customer_wallet_id
  from public.wallet_accounts wallet
  where wallet.wallet_type = 'customer'
    and wallet.owner_entity_type = 'user'
    and wallet.owner_entity_id = order_record.customer_user_id
    and wallet.currency_code = order_record.currency_code
    and wallet.status = 'active'
  order by wallet.created_at asc
  limit 1;

  if customer_wallet_id is null then
    customer_wallet_id := public.ensure_wallet_account(
      'customer', 'user', order_record.customer_user_id,
      order_record.currency_code, 'lpg.wallet_engine',
      '{"wallet_purpose":"lpg_refund"}'::jsonb,
      target_idempotency_key || ':customer-wallet'
    );
  end if;

  if underfill_refund_amount > 0 then
    refund_transaction_id := public.return_escrow_hold_amount(
      order_record.escrow_hold_id,
      customer_wallet_id,
      underfill_refund_amount,
      target_idempotency_key || ':underfill-refund',
      'lpg.refund_engine',
      target_metadata || jsonb_build_object(
        'refund_reason', 'lpg.underfill',
        'station_principal_refund', station_underfill_refund,
        'platform_markup_refund', markup_underfill_refund,
        'financial_policy_snapshot', order_record.financial_policy_snapshot
      )
    );

    insert into public.lpg_order_financial_adjustments (
      lpg_order_id, adjustment_type, currency_code, amount, transaction_id,
      status, reason_key, metadata, source, idempotency_key
    ) values (
      order_record.id, 'underfill_refund', order_record.currency_code,
      underfill_refund_amount, refund_transaction_id, 'posted',
      'lpg.underfill.automatic',
      target_metadata || jsonb_build_object(
        'station_principal_refund', station_underfill_refund,
        'platform_markup_refund', markup_underfill_refund,
        'markup_policy_version_id', markup_policy ->> 'policyVersionId'
      ),
      'lpg.refund_engine', target_idempotency_key || ':underfill-adjustment'
    ) on conflict (source, idempotency_key) do nothing;
  end if;

  if actual_station_amount > 0 then
    distribution := distribution || jsonb_build_array(jsonb_build_object(
      'wallet_id', station_wallet_id,
      'amount', actual_station_amount + case when order_record.fulfillment_mode = 'station_managed' and quote_record.delivery_pricing_mode in ('separate','included') then quote_record.station_delivery_fee_amount else 0 end,
      'entry_type', 'principal',
      'metadata', jsonb_build_object('role', 'station_lpg_principal', 'station_delivery_fee_amount', case when order_record.fulfillment_mode = 'station_managed' and quote_record.delivery_pricing_mode in ('separate','included') then quote_record.station_delivery_fee_amount else 0 end)
    ));
  end if;

  if platform_release_amount > 0 then
    distribution := distribution || jsonb_build_array(jsonb_build_object(
      'wallet_id', platform_wallet_id,
      'amount', platform_release_amount,
      'entry_type', 'fee',
      'metadata', jsonb_build_object(
        'role', 'platform',
        'platform_markup_amount', actual_platform_markup,
        'tax_amount', tax_amount,
        'delivery_margin_amount', delivery_margin_amount,
        'markup_policy_version_id', markup_policy ->> 'policyVersionId'
      )
    ));
  end if;

  if jsonb_array_length(distribution) = 0 then
    raise exception 'station settlement distribution cannot be empty';
  end if;

  settlement_execution_id := public.execute_service_request_settlement(
    order_record.service_request_id,
    order_record.escrow_hold_id,
    distribution,
    target_idempotency_key || ':settlement',
    'lpg.settlement_engine',
    target_metadata || jsonb_build_object(
      'lpg_order_id', order_record.id,
      'policy_snapshot', settlement_policy,
      'financial_policy_snapshot', order_record.financial_policy_snapshot
    )
  );

  insert into public.settlement_statements (
    organization_id, service_request_id, order_id, escrow_hold_id,
    settlement_execution_id, currency_code, gross_amount, platform_fee_amount,
    net_amount, status, period_start, period_end, source, idempotency_key,
    metadata, created_by
  ) values (
    station_record.organization_id, order_record.service_request_id, order_record_id,
    order_record.escrow_hold_id, settlement_execution_id, order_record.currency_code,
    actual_station_amount + case when order_record.fulfillment_mode = 'station_managed' and quote_record.delivery_pricing_mode in ('separate','included') then quote_record.station_delivery_fee_amount else 0 end, 0, actual_station_amount + case when order_record.fulfillment_mode = 'station_managed' and quote_record.delivery_pricing_mode in ('separate','included') then quote_record.station_delivery_fee_amount else 0 end, 'posted',
    timezone('utc', now()), timezone('utc', now()), target_source,
    target_idempotency_key || ':statement',
    target_metadata || jsonb_build_object(
      'lpg_order_id', order_record.id,
      'financial_policy_snapshot', order_record.financial_policy_snapshot
    ),
    actor_user_id
  ) on conflict (source, idempotency_key) do nothing
  returning id into settlement_statement_id;

  if settlement_statement_id is null then
    select id into settlement_statement_id
    from public.settlement_statements
    where source = target_source and idempotency_key = target_idempotency_key || ':statement';
  end if;

  -- The generic projection records the accepted snapshot plus the governed
  -- quantity adjustment, never a newly-resolved policy.
  update public.order_records
  set subtotal_amount = actual_station_amount + case when order_record.fulfillment_mode = 'station_managed' then quote_record.station_delivery_fee_amount else quote_record.delivery_fee_amount end,
      fee_amount = actual_platform_markup,
      tax_amount = tax_amount,
      total_amount = actual_station_amount + actual_platform_markup
        + case when order_record.fulfillment_mode = 'station_managed' then quote_record.station_delivery_fee_amount else quote_record.delivery_fee_amount end + tax_amount,
      order_payload = order_payload || jsonb_build_object(
        'financial_policy_snapshot', order_record.financial_policy_snapshot,
        'accepted_quote_amounts', order_record.financial_policy_snapshot -> 'acceptedQuote',
        'fulfilled_financial_amounts', jsonb_build_object(
          'stationAmount', actual_station_amount,
          'platformMarkupAmount', actual_platform_markup,
          'deliveryFeeAmount', case when order_record.fulfillment_mode = 'station_managed' then quote_record.station_delivery_fee_amount else quote_record.delivery_fee_amount end,
          'driverPayoutAmount', quote_record.driver_commission_amount,
          'taxAmount', tax_amount,
          'totalAmount', actual_station_amount + actual_platform_markup
            + case when order_record.fulfillment_mode = 'station_managed' then quote_record.station_delivery_fee_amount else quote_record.delivery_fee_amount end + tax_amount
        )
      ),
      metadata = metadata || jsonb_build_object(
        'financial_policy_snapshot', order_record.financial_policy_snapshot,
        'underfill_adjustment_transaction_id', refund_transaction_id
      ),
      updated_at = timezone('utc', now())
  where id = order_record_id;

  update public.lpg_refill_orders
  set status = 'station_settled',
      station_settlement_execution_id = settlement_execution_id,
      station_settlement_statement_id = settlement_statement_id,
      underfill_refund_transaction_id = refund_transaction_id,
      updated_at = timezone('utc', now())
  where id = order_record.id;

  perform public.record_lpg_order_event(
    order_record.id, 'lpg.station.settled', order_record.status, 'station_settled',
    target_idempotency_key || ':event',
    target_metadata || jsonb_build_object(
      'settlement_execution_id', settlement_execution_id,
      'settlement_statement_id', settlement_statement_id,
      'underfill_refund_transaction_id', refund_transaction_id,
      'station_principal_refund', station_underfill_refund,
      'platform_markup_refund', markup_underfill_refund,
      'financial_policy_version_ids', jsonb_build_object(
        'settlement', settlement_policy ->> 'policyVersionId',
        'platformMarkup', markup_policy ->> 'policyVersionId'
      )
    )
  );

  return settlement_execution_id;
end;
$function$


comment on function public.ensure_lpg_station_settlement_wallet(uuid,uuid,text,text) is
  'Private station settlement wallet resolver. Reuses an active organization partner wallet and creates one only from the authorized LPG station settlement path.';
comment on function public.settle_lpg_station_order(uuid,text,uuid,uuid,uuid,jsonb,text) is
  'Settles a confirmed LPG refill. Automatic settlement is accepted only from the matching refill-event trigger; station partner wallets are resolved through the private LPG settlement wallet helper.';

commit;
