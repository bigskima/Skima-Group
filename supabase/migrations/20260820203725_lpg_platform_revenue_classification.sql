begin;

-- The existing LPG settlement releases the station principal correctly and
-- places the platform portion into settlement clearing. Reclassify that exact
-- platform credit immediately, inside the same database transaction, into:
--   * SKIMA revenue: LPG/refill platform markup
--   * SKIMA revenue: delivery/logistics margin
--   * platform liability: tax/pass-through amounts
-- This preserves the already-tested escrow settlement engine while making
-- company revenue explicit and auditable.

create or replace function public.classify_lpg_platform_settlement_revenue(
  target_lpg_order_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record public.lpg_refill_orders%rowtype;
  quote_record public.lpg_refill_quotes%rowtype;
  markup_policy jsonb;
  locked_markup_per_kg numeric(28, 8);
  actual_platform_markup numeric(28, 8);
  delivery_margin_amount numeric(28, 8);
  tax_amount_value numeric(28, 8);
  classification_total numeric(28, 8);
  clearing_wallet_id uuid;
  clearing_credit_amount numeric(28, 8);
  revenue_wallet_id uuid;
  liability_wallet_id uuid;
  transaction_entries jsonb;
  classification_transaction_id uuid;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.revenue.manage', null)
    and not public.has_permission('platform.settlement.execute', null) then
    raise exception 'LPG revenue classification permission is required';
  end if;

  select * into order_record
  from public.lpg_refill_orders
  where id = target_lpg_order_id
  for update;

  if not found then
    raise exception 'target_lpg_order_id must reference an LPG order';
  end if;

  if order_record.status <> 'station_settled'
    or order_record.station_settlement_execution_id is null
    or order_record.actual_kg is null then
    raise exception 'LPG revenue classification requires a completed station settlement';
  end if;

  if order_record.metadata ->> 'platform_revenue_classification_transaction_id' is not null then
    return (order_record.metadata ->> 'platform_revenue_classification_transaction_id')::uuid;
  end if;

  select * into quote_record
  from public.lpg_refill_quotes
  where id = order_record.lpg_refill_quote_id;

  if not found or quote_record.status <> 'accepted' then
    raise exception 'accepted LPG quote is required for revenue classification';
  end if;

  markup_policy := order_record.financial_policy_snapshot -> 'platformMarkup';
  locked_markup_per_kg := nullif(markup_policy -> 'configuration' ->> 'amount_per_kg', '')::numeric;

  if markup_policy is null or jsonb_typeof(markup_policy) <> 'object'
    or markup_policy ->> 'policyVersionId' is null
    or locked_markup_per_kg is null
    or locked_markup_per_kg < 0 then
    raise exception 'locked LPG platform markup policy is required for revenue classification';
  end if;

  actual_platform_markup := round(order_record.actual_kg * locked_markup_per_kg, 2);
  delivery_margin_amount := quote_record.delivery_fee_amount - quote_record.driver_commission_amount;
  tax_amount_value := quote_record.tax_amount;

  if delivery_margin_amount < 0 or tax_amount_value < 0 then
    raise exception 'LPG settlement classification amounts cannot be negative';
  end if;

  classification_total := actual_platform_markup + delivery_margin_amount + tax_amount_value;

  if classification_total = 0 then
    return null;
  end if;

  select ledger.wallet_id, sum(ledger.amount)::numeric(28, 8)
  into clearing_wallet_id, clearing_credit_amount
  from public.settlement_executions execution
  join public.wallet_ledger_entries ledger
    on ledger.transaction_id = execution.transaction_id
  join public.wallet_accounts wallet
    on wallet.id = ledger.wallet_id
  where execution.id = order_record.station_settlement_execution_id
    and wallet.wallet_type = 'platform_clearing'
    and wallet.owner_entity_type = 'platform'
    and ledger.direction = 'credit'
    and ledger.metadata ->> 'role' = 'platform'
  group by ledger.wallet_id;

  if clearing_wallet_id is null then
    raise exception 'LPG station settlement is missing its platform clearing credit';
  end if;

  if clearing_credit_amount <> classification_total then
    raise exception 'LPG platform settlement classification does not match the posted clearing amount';
  end if;

  transaction_entries := jsonb_build_array(
    jsonb_build_object(
      'wallet_id', clearing_wallet_id,
      'direction', 'debit',
      'amount', classification_total,
      'entry_type', 'principal',
      'metadata', jsonb_build_object(
        'role', 'platform_settlement_classification',
        'lpg_order_id', order_record.id,
        'platform_markup_amount', actual_platform_markup,
        'delivery_margin_amount', delivery_margin_amount,
        'tax_amount', tax_amount_value
      )
    )
  );

  if actual_platform_markup > 0 or delivery_margin_amount > 0 then
    revenue_wallet_id := public.ensure_platform_revenue_wallet(
      order_record.currency_code,
      'lpg.revenue_classifier',
      'lpg-order:' || order_record.id::text || ':revenue-wallet'
    );
  end if;

  if actual_platform_markup > 0 then
    transaction_entries := transaction_entries || jsonb_build_array(
      jsonb_build_object(
        'wallet_id', revenue_wallet_id,
        'direction', 'credit',
        'amount', actual_platform_markup,
        'entry_type', 'fee',
        'metadata', jsonb_build_object(
          'role', 'skima_revenue',
          'revenue_stream', 'refill',
          'revenue_component', 'lpg_platform_markup',
          'module', 'lpg',
          'lpg_order_id', order_record.id,
          'actual_kg', order_record.actual_kg,
          'markup_policy_version_id', markup_policy ->> 'policyVersionId'
        )
      )
    );
  end if;

  if delivery_margin_amount > 0 then
    transaction_entries := transaction_entries || jsonb_build_array(
      jsonb_build_object(
        'wallet_id', revenue_wallet_id,
        'direction', 'credit',
        'amount', delivery_margin_amount,
        'entry_type', 'fee',
        'metadata', jsonb_build_object(
          'role', 'skima_revenue',
          'revenue_stream', 'delivery',
          'revenue_component', 'delivery_margin',
          'module', 'lpg',
          'lpg_order_id', order_record.id,
          'customer_delivery_fee_amount', quote_record.delivery_fee_amount,
          'driver_payout_amount', quote_record.driver_commission_amount
        )
      )
    );
  end if;

  if tax_amount_value > 0 then
    liability_wallet_id := public.ensure_platform_liability_wallet(
      order_record.currency_code,
      'lpg.revenue_classifier',
      'lpg-order:' || order_record.id::text || ':liability-wallet'
    );

    transaction_entries := transaction_entries || jsonb_build_array(
      jsonb_build_object(
        'wallet_id', liability_wallet_id,
        'direction', 'credit',
        'amount', tax_amount_value,
        'entry_type', 'tax',
        'metadata', jsonb_build_object(
          'role', 'platform_liability',
          'liability_component', 'tax',
          'module', 'lpg',
          'lpg_order_id', order_record.id
        )
      )
    );
  end if;

  classification_transaction_id := public.post_financial_transaction(
    'transfer',
    order_record.currency_code,
    'lpg.revenue_classifier',
    'lpg_refill_order',
    order_record.id,
    transaction_entries,
    'lpg-order:' || order_record.id::text || ':platform-classification',
    null,
    order_record.public_reference,
    order_record.financial_policy_snapshot,
    jsonb_build_object(
      'lpg_order_id', order_record.id,
      'station_settlement_execution_id', order_record.station_settlement_execution_id,
      'platform_markup_amount', actual_platform_markup,
      'delivery_margin_amount', delivery_margin_amount,
      'tax_amount', tax_amount_value
    )
  );

  update public.lpg_refill_orders
  set metadata = metadata || jsonb_build_object(
        'platform_revenue_classification_transaction_id', classification_transaction_id,
        'platform_revenue_classified_at', timezone('utc', now()),
        'platform_revenue_breakdown', jsonb_build_object(
          'refill', actual_platform_markup,
          'delivery', delivery_margin_amount,
          'tax_liability', tax_amount_value
        )
      ),
      updated_at = timezone('utc', now())
  where id = order_record.id;

  if order_record.station_settlement_statement_id is not null then
    update public.settlement_statements
    set metadata = metadata || jsonb_build_object(
          'platform_revenue_classification_transaction_id', classification_transaction_id,
          'platform_revenue_not_deducted_from_station', true,
          'platform_revenue_breakdown', jsonb_build_object(
            'refill', actual_platform_markup,
            'delivery', delivery_margin_amount
          ),
          'tax_liability_amount', tax_amount_value
        ),
        updated_at = timezone('utc', now())
    where id = order_record.station_settlement_statement_id;
  end if;

  return classification_transaction_id;
end;
$$;

create or replace function public.classify_lpg_revenue_after_station_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.classify_lpg_platform_settlement_revenue(new.id);
  return new;
end;
$$;

drop trigger if exists classify_lpg_revenue_after_station_settlement
on public.lpg_refill_orders;

create trigger classify_lpg_revenue_after_station_settlement
after update on public.lpg_refill_orders
for each row
when (
  old.status is distinct from new.status
  and new.status = 'station_settled'
)
execute function public.classify_lpg_revenue_after_station_settlement();

revoke all on function public.classify_lpg_platform_settlement_revenue(uuid) from public;
grant execute on function public.classify_lpg_platform_settlement_revenue(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
