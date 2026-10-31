begin;

CREATE OR REPLACE FUNCTION public.post_financial_transaction(target_transaction_type text, target_currency_code text, target_source text, target_subject_type text, target_subject_id uuid, target_entries jsonb, target_idempotency_key text, target_provider_adapter_id uuid DEFAULT NULL::uuid, target_external_reference text DEFAULT NULL::text, target_policy_snapshot jsonb DEFAULT '{}'::jsonb, target_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  existing_transaction record;
  parsed_entry record;
  target_wallet record;
  transaction_id uuid;
  debit_total numeric(28, 8) := 0;
  credit_total numeric(28, 8) := 0;
  entry_wallet_id uuid;
  entry_direction text;
  entry_amount numeric(28, 8);
  entry_type text;
  entry_metadata jsonb;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.financial.manage', null)
    and not (
      (
      pg_trigger_depth() > 0
      and target_source = 'lpg.settlement_engine'
      and target_metadata ->> 'automatic_refill_settlement' = 'true'
      and target_subject_type = 'service_request'
      and exists (
        select 1
        from public.lpg_refill_orders lpg_order
        join public.lpg_order_events refill_event
          on refill_event.lpg_order_id = lpg_order.id
         and refill_event.id::text = target_metadata ->> 'source_event_id'
         and refill_event.event_type = 'lpg.refill.confirmed'
         and refill_event.to_status = 'refill_confirmed'
        join public.lpg_refill_records refill_record
          on refill_record.lpg_order_id = lpg_order.id
         and refill_record.id::text = refill_event.metadata ->> 'refill_record_id'
        where lpg_order.id::text = target_metadata ->> 'lpg_order_id'
          and lpg_order.service_request_id = target_subject_id
          and lpg_order.status = 'refill_confirmed'
          and lpg_order.actual_kg = refill_record.actual_kg
      )
    )
      or
      (
      pg_trigger_depth() > 0
      and target_source = 'lpg.revenue_classifier'
      and target_subject_type = 'lpg_refill_order'
      and exists (
        select 1
        from public.lpg_refill_orders lpg_order
        join public.settlement_executions settlement
          on settlement.id = lpg_order.station_settlement_execution_id
         and settlement.status = 'posted'
         and settlement.source = 'lpg.settlement_engine'
        join public.lpg_order_events refill_event
          on refill_event.lpg_order_id = lpg_order.id
         and refill_event.event_type = 'lpg.refill.confirmed'
         and refill_event.to_status = 'refill_confirmed'
        join public.lpg_refill_records refill_record
          on refill_record.lpg_order_id = lpg_order.id
         and refill_record.id::text = refill_event.metadata ->> 'refill_record_id'
        where lpg_order.id = target_subject_id
          and lpg_order.id::text = target_metadata ->> 'lpg_order_id'
          and lpg_order.station_settlement_execution_id::text = target_metadata ->> 'station_settlement_execution_id'
          and lpg_order.status = 'station_settled'
          and lpg_order.actual_kg = refill_record.actual_kg
      )
    )
    ) then
    raise exception 'platform financial management permission is required';
  end if;

  if target_transaction_type not in (
    'payment',
    'transfer',
    'hold',
    'release',
    'refund',
    'commission',
    'fee',
    'adjustment'
  ) then
    raise exception 'target_transaction_type is not supported';
  end if;

  if target_currency_code is null
    or target_currency_code !~ '^[A-Z0-9]{3,12}$' then
    raise exception 'target_currency_code must be a valid configured currency code';
  end if;

  if not exists (
    select 1
    from public.currency_definitions currency_record
    where currency_record.code = target_currency_code
      and currency_record.status = 'enabled'
  ) then
    raise exception 'target_currency_code must reference an enabled currency';
  end if;

  if target_source is null
    or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_subject_type is null
    or target_subject_type !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_subject_type must be a valid platform key';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_policy_snapshot is null
    or jsonb_typeof(target_policy_snapshot) <> 'object' then
    raise exception 'target_policy_snapshot must be a JSON object';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  if target_entries is null
    or jsonb_typeof(target_entries) <> 'array'
    or jsonb_array_length(target_entries) < 2 then
    raise exception 'target_entries must contain at least two ledger entries';
  end if;

  if target_provider_adapter_id is not null
    and not exists (
      select 1
      from public.provider_adapters provider_record
      where provider_record.id = target_provider_adapter_id
        and provider_record.status = 'active'
    ) then
    raise exception 'target_provider_adapter_id must reference an active provider adapter';
  end if;

  drop table if exists pg_temp.financial_posting_entries;

  create temporary table financial_posting_entries (
    wallet_id uuid not null,
    direction text not null,
    amount numeric(28, 8) not null,
    entry_type text not null,
    metadata jsonb not null,
    ordinal bigint not null
  ) on commit drop;

  for parsed_entry in
    select parsed.value, parsed.ordinality
    from jsonb_array_elements(target_entries) with ordinality as parsed(value, ordinality)
  loop
    begin
      entry_wallet_id := (parsed_entry.value ->> 'wallet_id')::uuid;
    exception
      when others then
        raise exception 'each ledger entry must include a valid wallet_id';
    end;

    entry_direction := parsed_entry.value ->> 'direction';

    if entry_direction not in ('debit', 'credit') then
      raise exception 'each ledger entry direction must be debit or credit';
    end if;

    begin
      entry_amount := (parsed_entry.value ->> 'amount')::numeric(28, 8);
    exception
      when others then
        raise exception 'each ledger entry amount must be numeric';
    end;

    if entry_amount <= 0 then
      raise exception 'each ledger entry amount must be greater than zero';
    end if;

    entry_type := coalesce(parsed_entry.value ->> 'entry_type', 'principal');

    if entry_type not in ('principal', 'fee', 'commission', 'tax', 'discount', 'adjustment') then
      raise exception 'each ledger entry type is not supported';
    end if;

    entry_metadata := coalesce(parsed_entry.value -> 'metadata', '{}'::jsonb);

    if jsonb_typeof(entry_metadata) <> 'object' then
      raise exception 'each ledger entry metadata must be a JSON object';
    end if;

    select wallet_record.id, wallet_record.currency_code, wallet_record.status
    into target_wallet
    from public.wallet_accounts wallet_record
    where wallet_record.id = entry_wallet_id;

    if not found then
      raise exception 'each ledger entry wallet_id must reference an existing wallet';
    end if;

    if target_wallet.status <> 'active' then
      raise exception 'each ledger entry wallet must be active';
    end if;

    if target_wallet.currency_code <> target_currency_code then
      raise exception 'each ledger entry wallet currency must match target_currency_code';
    end if;

    if entry_direction = 'debit' then
      debit_total := debit_total + entry_amount;
    else
      credit_total := credit_total + entry_amount;
    end if;

    insert into financial_posting_entries (
      wallet_id,
      direction,
      amount,
      entry_type,
      metadata,
      ordinal
    )
    values (
      entry_wallet_id,
      entry_direction,
      entry_amount,
      entry_type,
      entry_metadata,
      parsed_entry.ordinality
    );
  end loop;

  if debit_total <> credit_total then
    raise exception 'financial transaction ledger entries must balance';
  end if;

  insert into public.financial_transactions (
    transaction_type,
    status,
    currency_code,
    total_amount,
    idempotency_key,
    source,
    subject_type,
    subject_id,
    actor_user_id,
    provider_adapter_id,
    external_reference,
    policy_snapshot,
    metadata
  )
  values (
    target_transaction_type,
    'posted',
    target_currency_code,
    debit_total,
    target_idempotency_key,
    target_source,
    target_subject_type,
    target_subject_id,
    auth.uid(),
    target_provider_adapter_id,
    target_external_reference,
    target_policy_snapshot,
    target_metadata
  )
  on conflict (source, idempotency_key) do nothing
  returning id into transaction_id;

  if transaction_id is null then
    select existing_record.*
    into existing_transaction
    from public.financial_transactions existing_record
    where existing_record.source = target_source
      and existing_record.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'financial transaction idempotency lookup failed';
    end if;

    if existing_transaction.transaction_type <> target_transaction_type
      or existing_transaction.status <> 'posted'
      or existing_transaction.currency_code <> target_currency_code
      or existing_transaction.total_amount <> debit_total
      or existing_transaction.subject_type <> target_subject_type
      or existing_transaction.subject_id is distinct from target_subject_id
      or existing_transaction.provider_adapter_id is distinct from target_provider_adapter_id
      or existing_transaction.external_reference is distinct from target_external_reference
      or existing_transaction.policy_snapshot <> target_policy_snapshot
      or existing_transaction.metadata <> target_metadata then
      raise exception 'target_idempotency_key has already been used with different transaction details';
    end if;

    return existing_transaction.id;
  end if;

  insert into public.wallet_ledger_entries (
    wallet_id,
    transaction_id,
    direction,
    amount,
    currency_code,
    entry_type,
    idempotency_key,
    metadata
  )
  select
    posting_entry.wallet_id,
    transaction_id,
    posting_entry.direction,
    posting_entry.amount,
    target_currency_code,
    posting_entry.entry_type,
    target_idempotency_key || ':' || posting_entry.ordinal::text,
    posting_entry.metadata
  from financial_posting_entries posting_entry
  order by posting_entry.ordinal;

  return transaction_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.classify_lpg_platform_settlement_revenue(target_lpg_order_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    and not public.has_permission('platform.settlement.execute', null)
    and not (
      pg_trigger_depth() > 0
      and exists (
        select 1
        from public.lpg_refill_orders lpg_order
        join public.settlement_executions settlement
          on settlement.id = lpg_order.station_settlement_execution_id
         and settlement.status = 'posted'
         and settlement.source = 'lpg.settlement_engine'
        join public.lpg_order_events refill_event
          on refill_event.lpg_order_id = lpg_order.id
         and refill_event.event_type = 'lpg.refill.confirmed'
         and refill_event.to_status = 'refill_confirmed'
        join public.lpg_refill_records refill_record
          on refill_record.lpg_order_id = lpg_order.id
         and refill_record.id::text = refill_event.metadata ->> 'refill_record_id'
        where lpg_order.id = target_lpg_order_id
          and lpg_order.status = 'station_settled'
          and lpg_order.actual_kg = refill_record.actual_kg
      )
    ) then
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
  delivery_margin_amount := case
    when coalesce(order_record.fulfillment_mode, quote_record.fulfillment_mode, 'independent_driver') = 'station_managed' then 0
    else quote_record.delivery_fee_amount - quote_record.driver_commission_amount
  end;
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
$function$
;

comment on function public.post_financial_transaction(text,text,text,text,uuid,jsonb,text,uuid,text,jsonb,jsonb) is
  'Posts balanced financial entries only for authorized platform actors, verified automatic LPG refill settlement triggers, or the matching station-settlement revenue-classification trigger.';
comment on function public.classify_lpg_platform_settlement_revenue(uuid) is
  'Classifies revenue only for authorized platform actors or from the matching station-settlement status trigger backed by a posted LPG settlement and confirmed refill evidence.';

commit;
