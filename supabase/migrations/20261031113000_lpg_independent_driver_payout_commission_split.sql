begin;

-- Independent-driver compensation is a different commercial model from
-- SKIMA Fleet and Station Managed. Activate a new immutable payout-policy
-- version. The existing generic 10% driver commission policy is the launch
-- default; the Admin policy editor can change it prospectively.
do $policy$
declare
  definition_record public.financial_policy_definitions%rowtype;
  current_version public.financial_policy_versions%rowtype;
  next_version integer;
  new_version_id uuid;
  now_at timestamptz := now();
  target_module_id uuid;
  commission_percent numeric(10, 6);
  next_configuration jsonb;
begin
  select id into target_module_id from public.business_modules where key = 'lpg';

  select * into definition_record
  from public.financial_policy_definitions
  where key = 'payout.lpg.driver' and status = 'active'
  for update;

  if definition_record.id is null then
    raise exception 'active payout.lpg.driver policy definition is required';
  end if;

  select * into current_version
  from public.financial_policy_versions version
  where version.policy_definition_id = definition_record.id
    and version.currency_code = 'NGN'
    and version.module_id is not distinct from target_module_id
    and service_key = 'lpg.refill.delivery'
    and organization_id is null
    and geography_type = 'global'
    and geography_key is null
    and lifecycle_status = 'active'
    and effective_from <= now_at
    and (effective_until is null or effective_until > now_at)
  order by priority desc, effective_from desc, version desc
  limit 1
  for update;

  if current_version.id is null then
    raise exception 'active global NGN LPG driver payout policy version is required';
  end if;

  if current_version.configuration ->> 'payout_basis' is null
    or current_version.configuration ->> 'platform_commission_percent' is null
    or coalesce((current_version.configuration ->> 'explicit_zero_development_configuration')::boolean, false) then

    select percentage_rate into commission_percent
    from public.commission_policies
    where key = 'commission.driver.percentage.default'
      and currency_code = 'NGN'
      and scope_type = 'global'
      and scope_id is null
      and status = 'active'
    order by updated_at desc
    limit 1;

    commission_percent := coalesce(commission_percent, 10);
    if commission_percent < 0 or commission_percent >= 100 then
      commission_percent := 10;
    end if;

    next_configuration :=
      (current_version.configuration - 'explicit_zero_development_configuration')
      || jsonb_build_object(
        'payout_basis', coalesce(current_version.configuration ->> 'payout_basis', 'delivery_fee'),
        'platform_commission_percent', commission_percent,
        'not_linked_to_lpg_value', true
      );

    perform public.validate_financial_policy_configuration('payout', next_configuration);

    update public.financial_policy_versions
    set lifecycle_status = 'superseded',
        effective_until = now_at,
        updated_at = now_at
    where id = current_version.id;

    select coalesce(max(version), 0) + 1
    into next_version
    from public.financial_policy_versions
    where policy_definition_id = definition_record.id;

    insert into public.financial_policy_versions (
      policy_definition_id, version, lifecycle_status,
      organization_id, module_id, service_key,
      geography_type, geography_key, currency_code, priority,
      configuration, effective_from, effective_until, change_reason,
      validation_snapshot, based_on_version_id, supersedes_version_id,
      submitted_at, approved_at, activated_at
    ) values (
      definition_record.id, next_version, 'active',
      current_version.organization_id, current_version.module_id, current_version.service_key,
      current_version.geography_type, current_version.geography_key, current_version.currency_code, current_version.priority,
      next_configuration, now_at, null,
      'Independent driver gross earnings are separated from SKIMA commission. Default basis is the customer delivery fee, less the configured platform percentage. SKIMA Fleet and Station Managed remain separate payout models.',
      public.validate_financial_policy_configuration('payout', next_configuration),
      current_version.id, current_version.id,
      now_at, now_at, now_at
    ) returning id into new_version_id;

    perform public.assert_financial_policy_no_conflict(new_version_id);

    insert into public.financial_policy_events (
      policy_version_id, event_type, previous_state, new_state, reason, idempotency_key
    ) values (
      current_version.id, 'superseded', to_jsonb(current_version),
      jsonb_build_object('lifecycle_status','superseded','effective_until',now_at,'superseded_by_policy_version_id',new_version_id),
      'Replaced the development zero-rate independent-driver payout policy with a gross payout / platform commission split.',
      'seed:lpg-independent-driver-payout:v2:superseded'
    ) on conflict (policy_version_id, idempotency_key) do nothing;

    insert into public.financial_policy_events (
      policy_version_id, event_type, previous_state, new_state, reason, idempotency_key
    ) values (
      new_version_id, 'activated', null,
      jsonb_build_object(
        'policyKey', definition_record.key,
        'policyVersionId', new_version_id,
        'version', next_version,
        'currencyCode', 'NGN',
        'configuration', next_configuration,
        'effectiveFrom', now_at
      ),
      'Activated independent driver gross earnings and configurable SKIMA percentage deduction.',
      'seed:lpg-independent-driver-payout:v2:activated'
    ) on conflict (policy_version_id, idempotency_key) do nothing;
  end if;
end;
$policy$;

-- Quote engine: gross driver earnings and SKIMA's percentage share are
-- calculated separately. driverPayout remains the NET driver wallet amount,
-- preserving the existing quote/order and escrow settlement contract.
do $quote$
declare
  function_sql text;
  old_declarations text := $old$
  customer_delivery_fee numeric(28, 8);
  driver_payout numeric(28, 8);
  logistics_margin numeric(28, 8);
$old$;
  new_declarations text := $new$
  customer_delivery_fee numeric(28, 8);
  driver_payout numeric(28, 8);
  gross_driver_payout numeric(28, 8);
  platform_driver_commission numeric(28, 8);
  platform_commission_percent numeric(10, 6);
  payout_basis text;
  logistics_margin numeric(28, 8);
$new$;
  old_calculation text := $old$
  driver_payout := round(
    coalesce(nullif(payout_configuration ->> 'base_amount', '')::numeric, 0)
    + route_distance_km * coalesce(nullif(payout_configuration ->> 'per_km_amount', '')::numeric, 0)
    + target_requested_kg * coalesce(nullif(payout_configuration ->> 'load_amount_per_kg', '')::numeric, 0)
    + coalesce(nullif(distance_band ->> 'driver_surcharge_amount', '')::numeric, 0),
    2
  );

  if driver_payout < 0 or driver_payout > customer_delivery_fee then
    raise exception 'configured LPG driver payout must be between zero and the customer delivery fee';
  end if;

  station_lpg_amount := round(target_requested_kg * station_price_per_kg, 2);
  platform_lpg_markup := round(target_requested_kg * markup_per_kg, 2);
  logistics_margin := customer_delivery_fee - driver_payout;
$old$;
  new_calculation text := $new$
  payout_basis := coalesce(nullif(payout_configuration ->> 'payout_basis', ''), 'delivery_fee');
  platform_commission_percent := coalesce(
    nullif(payout_configuration ->> 'platform_commission_percent', '')::numeric,
    10
  );

  if platform_commission_percent < 0 or platform_commission_percent >= 100 then
    raise exception 'independent driver SKIMA commission percentage must be at least 0 and less than 100';
  end if;

  if payout_basis = 'delivery_fee' then
    gross_driver_payout := customer_delivery_fee;
  elsif payout_basis = 'route_formula' then
    gross_driver_payout := round(
      coalesce(nullif(payout_configuration ->> 'base_amount', '')::numeric, 0)
      + route_distance_km * coalesce(nullif(payout_configuration ->> 'per_km_amount', '')::numeric, 0)
      + target_requested_kg * coalesce(nullif(payout_configuration ->> 'load_amount_per_kg', '')::numeric, 0)
      + coalesce(nullif(distance_band ->> 'driver_surcharge_amount', '')::numeric, 0),
      2
    );
  else
    raise exception 'unsupported independent driver payout basis';
  end if;

  if gross_driver_payout < 0 or gross_driver_payout > customer_delivery_fee then
    raise exception 'gross independent driver earnings must be between zero and the customer delivery fee';
  end if;

  platform_driver_commission := round(gross_driver_payout * platform_commission_percent / 100, 2);
  driver_payout := round(gross_driver_payout - platform_driver_commission, 2);
  logistics_margin := round(customer_delivery_fee - gross_driver_payout, 2);

  station_lpg_amount := round(target_requested_kg * station_price_per_kg, 2);
  platform_lpg_markup := round(target_requested_kg * markup_per_kg, 2);
$new$;
  old_json text := $old$
    'customerDeliveryFee', customer_delivery_fee,
    'driverPayout', driver_payout,
    'platformLogisticsMargin', logistics_margin,
$old$;
  new_json text := $new$
    'customerDeliveryFee', customer_delivery_fee,
    'driverGrossPayout', gross_driver_payout,
    'platformDriverCommission', platform_driver_commission,
    'platformDriverCommissionPercent', platform_commission_percent,
    'driverPayoutBasis', payout_basis,
    'driverPayout', driver_payout,
    'platformLogisticsMargin', logistics_margin,
$new$;
begin
  select pg_get_functiondef(
    'public.calculate_lpg_commercial_quote(uuid,numeric,jsonb,timestamptz)'::regprocedure
  ) into function_sql;

  if position(old_declarations in function_sql) = 0
    or position(old_calculation in function_sql) = 0
    or position(old_json in function_sql) = 0 then
    raise exception 'LPG commercial quote function changed; refusing unsafe independent commission patch';
  end if;

  function_sql := replace(function_sql, old_declarations, new_declarations);
  function_sql := replace(function_sql, old_calculation, new_calculation);
  function_sql := replace(function_sql, old_json, new_json);
  execute function_sql;
end;
$quote$;

-- Revenue classification: delivery margin and the independent-driver
-- commission are separate SKIMA revenue components. The combined total still
-- reconciles exactly to the platform clearing credit made at station settlement.
do $classifier$
declare
  function_sql text;
  old_declarations text := $old$
  actual_platform_markup numeric(28, 8);
  delivery_margin_amount numeric(28, 8);
  tax_amount_value numeric(28, 8);
$old$;
  new_declarations text := $new$
  actual_platform_markup numeric(28, 8);
  gross_driver_payout_amount numeric(28, 8);
  independent_driver_commission_amount numeric(28, 8);
  delivery_margin_amount numeric(28, 8);
  tax_amount_value numeric(28, 8);
$new$;
  old_calculation text := $old$
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
$old$;
  new_calculation text := $new$
  actual_platform_markup := round(order_record.actual_kg * locked_markup_per_kg, 2);
  gross_driver_payout_amount := 0;
  independent_driver_commission_amount := 0;

  if coalesce(order_record.fulfillment_mode, quote_record.fulfillment_mode, 'independent_driver') = 'station_managed' then
    -- Station Managed drivers are paid by their station and never by SKIMA.
    delivery_margin_amount := 0;
  elsif coalesce(order_record.fulfillment_channel, quote_record.fulfillment_channel, 'marketplace') = 'marketplace'
    and coalesce(order_record.fulfillment_mode, quote_record.fulfillment_mode, 'independent_driver') = 'independent_driver' then
    gross_driver_payout_amount := coalesce(
      nullif(quote_record.breakdown ->> 'driverGrossPayout', '')::numeric,
      quote_record.delivery_fee_amount - quote_record.driver_commission_amount
    );
    independent_driver_commission_amount := coalesce(
      nullif(quote_record.breakdown ->> 'platformDriverCommission', '')::numeric,
      0
    );
    delivery_margin_amount := round(quote_record.delivery_fee_amount - gross_driver_payout_amount, 2);

    if gross_driver_payout_amount < 0
      or gross_driver_payout_amount > quote_record.delivery_fee_amount
      or independent_driver_commission_amount < 0
      or independent_driver_commission_amount > gross_driver_payout_amount
      or round(gross_driver_payout_amount - independent_driver_commission_amount, 2) <> quote_record.driver_commission_amount then
      raise exception 'independent driver gross earnings, SKIMA commission and net payout do not reconcile';
    end if;
  else
    -- SKIMA Fleet/Managed work uses its own payout/settlement policy. Do not
    -- apply the independent-driver percentage deduction to that workflow.
    delivery_margin_amount := quote_record.delivery_fee_amount - quote_record.driver_commission_amount;
  end if;

  tax_amount_value := quote_record.tax_amount;

  if delivery_margin_amount < 0 or tax_amount_value < 0 then
    raise exception 'LPG settlement classification amounts cannot be negative';
  end if;

  classification_total := actual_platform_markup
    + delivery_margin_amount
    + independent_driver_commission_amount
    + tax_amount_value;
$new$;
  old_wallet_condition text := $old$
  if actual_platform_markup > 0 or delivery_margin_amount > 0 then
$old$;
  new_wallet_condition text := $new$
  if actual_platform_markup > 0 or delivery_margin_amount > 0 or independent_driver_commission_amount > 0 then
$new$;
  old_revenue_entry text := $old$
  if tax_amount_value > 0 then
    liability_wallet_id := public.ensure_platform_liability_wallet(
$old$;
  commission_entry text := $entry$
  if independent_driver_commission_amount > 0 then
    transaction_entries := transaction_entries || jsonb_build_array(
      jsonb_build_object(
        'wallet_id', revenue_wallet_id,
        'direction', 'credit',
        'amount', independent_driver_commission_amount,
        'entry_type', 'commission',
        'metadata', jsonb_build_object(
          'role', 'skima_revenue',
          'revenue_stream', 'driver_commission',
          'revenue_component', 'independent_driver_commission',
          'module', 'lpg',
          'lpg_order_id', order_record.id,
          'gross_driver_payout_amount', gross_driver_payout_amount,
          'driver_net_payout_amount', quote_record.driver_commission_amount,
          'platform_driver_commission_percent', quote_record.breakdown ->> 'platformDriverCommissionPercent'
        )
      )
    );
  end if;

$entry$;
  old_metadata text := $old$
      'platform_markup_amount', actual_platform_markup,
      'delivery_margin_amount', delivery_margin_amount,
      'tax_amount', tax_amount_value
$old$;
  new_metadata text := $new$
      'platform_markup_amount', actual_platform_markup,
      'delivery_margin_amount', delivery_margin_amount,
      'independent_driver_commission_amount', independent_driver_commission_amount,
      'gross_driver_payout_amount', gross_driver_payout_amount,
      'net_driver_payout_amount', quote_record.driver_commission_amount,
      'tax_amount', tax_amount_value
$new$;
  old_order_breakdown text := $old$
          'refill', actual_platform_markup,
          'delivery', delivery_margin_amount,
          'tax_liability', tax_amount_value
$old$;
  new_order_breakdown text := $new$
          'refill', actual_platform_markup,
          'delivery', delivery_margin_amount,
          'driver_commission', independent_driver_commission_amount,
          'tax_liability', tax_amount_value
$new$;
  old_statement_breakdown text := $old$
            'refill', actual_platform_markup,
            'delivery', delivery_margin_amount
$old$;
  new_statement_breakdown text := $new$
            'refill', actual_platform_markup,
            'delivery', delivery_margin_amount,
            'driver_commission', independent_driver_commission_amount
$new$;
begin
  select pg_get_functiondef(
    'public.classify_lpg_platform_settlement_revenue(uuid)'::regprocedure
  ) into function_sql;

  if position(old_declarations in function_sql) = 0
    or position(old_calculation in function_sql) = 0
    or position(old_wallet_condition in function_sql) = 0
    or position(old_metadata in function_sql) = 0
    or position(old_order_breakdown in function_sql) = 0
    or position(old_statement_breakdown in function_sql) = 0 then
    raise exception 'LPG revenue classifier changed; refusing unsafe independent commission patch';
  end if;

  function_sql := replace(function_sql, old_declarations, new_declarations);
  function_sql := replace(function_sql, old_calculation, new_calculation);
  function_sql := replace(function_sql, old_wallet_condition, new_wallet_condition);
  function_sql := replace(function_sql, old_metadata, new_metadata);
  function_sql := replace(function_sql, old_order_breakdown, new_order_breakdown);
  function_sql := replace(function_sql, old_statement_breakdown, new_statement_breakdown);

  -- Insert the driver commission revenue entry immediately before tax allocation.
  if position(old_revenue_entry in function_sql) = 0 then
    raise exception 'LPG revenue tax allocation anchor changed; refusing unsafe patch';
  end if;
  function_sql := replace(function_sql, old_revenue_entry, commission_entry || old_revenue_entry);
  execute function_sql;
end;
$classifier$;

-- Allow only the trusted delivery-event trigger to post an independent driver
-- escrow release or the one-time zero-policy correction. Ordinary authenticated
-- callers still require financial-management permission.
do $posting_guard$
declare
  function_sql text;
  gate_start integer;
  gate_end integer;
  gate_relative_end integer;
  new_gate text := $gate$
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
      or (
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
      or (
        pg_trigger_depth() > 0
        and target_source = 'lpg.driver_payout.auto_delivery'
        and target_metadata ->> 'automatic_delivery_release' = 'true'
        and target_subject_type = 'service_request'
        and exists (
          select 1
          from public.lpg_refill_orders payout_order
          join public.lpg_order_events delivery_event
            on delivery_event.id::text = target_metadata ->> 'source_event_id'
           and delivery_event.lpg_order_id = payout_order.id
           and delivery_event.event_type = 'lpg.delivery.completed'
           and delivery_event.to_status = 'delivered'
          join public.escrow_holds payout_hold on payout_hold.id = payout_order.escrow_hold_id
          where payout_order.id::text = target_metadata ->> 'lpg_order_id'
            and payout_order.service_request_id = target_subject_id
            and payout_order.status = 'delivered'
            and payout_order.fulfillment_channel = 'marketplace'
            and payout_order.fulfillment_mode = 'independent_driver'
            and payout_order.station_settlement_execution_id is not null
            and payout_order.driver_commission_execution_id is null
            and public.lpg_delivery_challenge_is_verified(payout_order.id, payout_order.delivery_challenge_id)
            and exists (
              select 1
              from jsonb_array_elements(target_entries) entry
              join public.wallet_accounts driver_wallet
                on driver_wallet.id = (entry.value ->> 'wallet_id')::uuid
              where entry.value ->> 'direction' = 'credit'
                and driver_wallet.wallet_type = 'driver'
                and driver_wallet.owner_entity_type = 'driver'
                and driver_wallet.owner_entity_id = payout_order.driver_profile_id
                and (entry.value ->> 'amount')::numeric = payout_order.driver_commission_amount
            )
            and exists (
              select 1
              from jsonb_array_elements(target_entries) entry
              where entry.value ->> 'direction' = 'debit'
                and (entry.value ->> 'amount')::numeric = payout_order.driver_commission_amount
                and exists (
                  select 1 from public.wallet_accounts escrow_wallet
                  where escrow_wallet.id = (entry.value ->> 'wallet_id')::uuid
                    and escrow_wallet.id = payout_hold.wallet_id
                    and escrow_wallet.wallet_type = 'escrow'
                )
            )
        )
      )
      or (
        pg_trigger_depth() > 0
        and target_source = 'lpg.driver_payout.correction'
        and target_subject_type = 'lpg_refill_order'
        and target_metadata ->> 'legacy_zero_payout_correction' = 'true'
        and exists (
          select 1
          from public.lpg_refill_orders payout_order
          join public.lpg_order_events delivery_event
            on delivery_event.id::text = target_metadata ->> 'source_event_id'
           and delivery_event.lpg_order_id = payout_order.id
           and delivery_event.event_type = 'lpg.delivery.completed'
           and delivery_event.to_status = 'delivered'
          join public.financial_policy_versions payout_version
            on payout_version.id::text = target_policy_snapshot ->> 'policyVersionId'
           and payout_version.lifecycle_status = 'active'
           and payout_version.currency_code = target_currency_code
          where payout_order.id = target_subject_id
            and payout_order.status = 'delivered'
            and payout_order.fulfillment_channel = 'marketplace'
            and payout_order.fulfillment_mode = 'independent_driver'
            and payout_order.driver_commission_execution_id is null
            and payout_order.station_settlement_execution_id is not null
            and payout_order.metadata ->> 'platform_revenue_classification_transaction_id' is not null
            and payout_order.financial_policy_snapshot #>> '{driverPayout,configuration,explicit_zero_development_configuration}' = 'true'
            and public.lpg_delivery_challenge_is_verified(payout_order.id, payout_order.delivery_challenge_id)
            and target_metadata ->> 'driver_profile_id' = payout_order.driver_profile_id::text
            and exists (
              select 1
              from jsonb_array_elements(target_entries) entry
              join public.wallet_accounts driver_wallet
                on driver_wallet.id = (entry.value ->> 'wallet_id')::uuid
              where entry.value ->> 'direction' = 'credit'
                and driver_wallet.wallet_type = 'driver'
                and driver_wallet.owner_entity_type = 'driver'
                and driver_wallet.owner_entity_id = payout_order.driver_profile_id
            )
            and exists (
              select 1
              from jsonb_array_elements(target_entries) entry
              join public.wallet_accounts revenue_wallet
                on revenue_wallet.id = (entry.value ->> 'wallet_id')::uuid
              where entry.value ->> 'direction' = 'debit'
                and revenue_wallet.wallet_type = 'platform_revenue'
                and revenue_wallet.owner_entity_type = 'platform'
            )
        )
      )
    ) then
    raise exception 'platform financial management permission is required';
  end if;
$gate$;
begin
  select pg_get_functiondef(
    'public.post_financial_transaction(text,text,text,text,uuid,jsonb,text,uuid,text,jsonb,jsonb)'::regprocedure
  ) into function_sql;

  gate_start := strpos(function_sql, '  if auth.role() <> ''service_role''');
  if gate_start = 0 then
    raise exception 'financial posting permission gate could not be located';
  end if;

  gate_relative_end := strpos(substring(function_sql from gate_start), '  end if;');
  if gate_relative_end = 0 then
    raise exception 'financial posting permission gate terminator could not be located';
  end if;

  gate_end := gate_start + gate_relative_end + char_length('  end if;') - 2;
  function_sql :=
    substring(function_sql from 1 for gate_start - 1)
    || new_gate
    || substring(function_sql from gate_end + 1);

  execute function_sql;
end;
$posting_guard$;


-- The new quote path stores the driver's NET earnings in the existing
-- driver_commission_amount field. For the one already-settled legacy test order
-- whose old accepted snapshot was explicitly zero-rate, use a narrowly-scoped
-- compensating transfer from SKIMA revenue after verified customer delivery.
-- The accepted order/quote snapshots and the earlier settlement are not rewritten.
do $commission_executor$
declare
  function_sql text;
  old_declarations text := $old$
  payout_amount numeric(28, 8);
  release_transaction_id uuid;
  commission_execution_id uuid;
  existing_execution public.commission_executions%rowtype;
$old$;
  new_declarations text := $new$
  payout_amount numeric(28, 8);
  gross_payout_amount numeric(28, 8);
  platform_commission_amount numeric(28, 8);
  platform_commission_percent numeric(10, 6);
  payout_basis text;
  route_distance_km numeric(28, 8);
  organization_id uuid;
  legacy_zero_correction boolean := false;
  correction_policy jsonb;
  correction_configuration jsonb;
  revenue_wallet_id uuid;
  release_transaction_id uuid;
  commission_execution_id uuid;
  existing_execution public.commission_executions%rowtype;
$new$;
  old_assignment text := $old$
  payout_policy := order_record.financial_policy_snapshot -> 'driverPayout';
  payout_configuration := payout_policy -> 'configuration';
  payout_amount := order_record.driver_commission_amount;

  if payout_policy is null or jsonb_typeof(payout_policy) <> 'object'
    or payout_policy ->> 'policyVersionId' is null
    or payout_policy ->> 'currencyCode' <> order_record.currency_code
    or payout_configuration is null or jsonb_typeof(payout_configuration) <> 'object'
    or payout_amount is null or payout_amount < 0
    or payout_amount <> quote_record.driver_commission_amount then
    raise exception 'a currency-matched locked driver payout policy and amount are required';
  end if;

  if payout_amount = 0 and not (
    coalesce((payout_configuration ->> 'allow_zero_amount')::boolean, false)
    or coalesce((payout_configuration ->> 'explicit_zero_authorized')::boolean, false)
    or coalesce((payout_configuration ->> 'explicit_zero_development_configuration')::boolean, false)
  ) then
    raise exception 'zero driver payout must be explicitly authorized by the locked policy';
  end if;
$old$;
  new_assignment text := $new$
  payout_policy := order_record.financial_policy_snapshot -> 'driverPayout';
  payout_configuration := payout_policy -> 'configuration';
  payout_amount := order_record.driver_commission_amount;
  gross_payout_amount := coalesce(
    nullif(quote_record.breakdown ->> 'driverGrossPayout', '')::numeric,
    payout_amount
  );
  platform_commission_amount := coalesce(
    nullif(quote_record.breakdown ->> 'platformDriverCommission', '')::numeric,
    0
  );
  platform_commission_percent := coalesce(
    nullif(quote_record.breakdown ->> 'platformDriverCommissionPercent', '')::numeric,
    nullif(payout_configuration ->> 'platform_commission_percent', '')::numeric,
    0
  );

  legacy_zero_correction :=
    order_record.fulfillment_channel = 'marketplace'
    and order_record.fulfillment_mode = 'independent_driver'
    and payout_amount = 0
    and coalesce((payout_configuration ->> 'explicit_zero_development_configuration')::boolean, false)
    and coalesce((target_metadata ->> 'automatic_delivery_release')::boolean, false)
    and order_record.metadata ->> 'platform_revenue_classification_transaction_id' is not null;

  if legacy_zero_correction then
    select station.organization_id into organization_id
    from public.lpg_station_branches station
    where station.id = order_record.station_branch_id;

    correction_policy := public.resolve_financial_policy(
      'payout.lpg.driver',
      order_record.currency_code,
      timezone('utc', now()),
      'lpg',
      organization_id,
      'lpg.refill.delivery',
      'global',
      null
    );
    correction_configuration := correction_policy -> 'configuration';
    payout_basis := coalesce(nullif(correction_configuration ->> 'payout_basis', ''), 'delivery_fee');
    platform_commission_percent := coalesce(nullif(correction_configuration ->> 'platform_commission_percent', '')::numeric, 10);

    if platform_commission_percent < 0 or platform_commission_percent >= 100 then
      raise exception 'active independent driver commission percentage must be at least 0 and less than 100';
    end if;

    if payout_basis = 'delivery_fee' then
      gross_payout_amount := quote_record.delivery_fee_amount;
    elsif payout_basis = 'route_formula' then
      route_distance_km := coalesce(
        nullif(quote_record.breakdown #>> '{route,distanceKilometers}', '')::numeric,
        nullif(quote_record.breakdown #>> '{route,distanceMeters}', '')::numeric / 1000,
        0
      );
      gross_payout_amount := round(
        coalesce(nullif(correction_configuration ->> 'base_amount', '')::numeric, 0)
        + route_distance_km * coalesce(nullif(correction_configuration ->> 'per_km_amount', '')::numeric, 0)
        + order_record.requested_kg * coalesce(nullif(correction_configuration ->> 'load_amount_per_kg', '')::numeric, 0)
        + coalesce(nullif(quote_record.breakdown #>> '{distanceBand,driver_surcharge_amount}', '')::numeric, 0),
        2
      );
    else
      raise exception 'active independent driver payout basis is unsupported';
    end if;

    if gross_payout_amount < 0 or gross_payout_amount > quote_record.delivery_fee_amount then
      raise exception 'legacy correction gross driver earnings exceed the accepted delivery fee';
    end if;

    platform_commission_amount := round(gross_payout_amount * platform_commission_percent / 100, 2);
    payout_amount := round(gross_payout_amount - platform_commission_amount, 2);
    payout_policy := correction_policy;
    payout_configuration := correction_configuration;
  end if;

  if payout_policy is null or jsonb_typeof(payout_policy) <> 'object'
    or payout_policy ->> 'policyVersionId' is null
    or payout_policy ->> 'currencyCode' <> order_record.currency_code
    or payout_configuration is null or jsonb_typeof(payout_configuration) <> 'object'
    or payout_amount is null or payout_amount < 0
    or (not legacy_zero_correction and payout_amount <> quote_record.driver_commission_amount)
    or (legacy_zero_correction and (payout_amount <= 0 or payout_amount > quote_record.delivery_fee_amount)) then
    raise exception 'a currency-matched locked driver payout policy and amount are required';
  end if;

  if payout_amount = 0 and not (
    coalesce((payout_configuration ->> 'allow_zero_amount')::boolean, false)
    or coalesce((payout_configuration ->> 'explicit_zero_authorized')::boolean, false)
    or coalesce((payout_configuration ->> 'explicit_zero_development_configuration')::boolean, false)
  ) then
    raise exception 'zero driver payout must be explicitly authorized by the locked policy';
  end if;
$new$;
  old_release text := $old$
  if payout_amount > 0 then
    release_transaction_id := public.release_escrow_hold(
      order_record.escrow_hold_id,
      jsonb_build_array(jsonb_build_object(
        'wallet_id', driver_wallet_id,
        'amount', payout_amount,
        'entry_type', 'commission',
        'metadata', jsonb_build_object('role', 'driver_payout')
      )),
      target_idempotency_key || ':release',
      target_source,
      target_metadata || jsonb_build_object(
        'financial_policy_snapshot', payout_policy,
        'lpg_order_id', order_record.id
      )
    );
  end if;
$old$;
  new_release text := $new$
  if legacy_zero_correction then
    revenue_wallet_id := public.ensure_platform_revenue_wallet(
      order_record.currency_code,
      'lpg.driver_payout.correction',
      target_idempotency_key || ':revenue-wallet'
    );

    release_transaction_id := public.post_financial_transaction(
      'commission',
      order_record.currency_code,
      'lpg.driver_payout.correction',
      'lpg_refill_order',
      order_record.id,
      jsonb_build_array(
        jsonb_build_object(
          'wallet_id', revenue_wallet_id,
          'direction', 'debit',
          'amount', payout_amount,
          'entry_type', 'commission',
          'metadata', jsonb_build_object('role', 'legacy_driver_payout_correction', 'lpg_order_id', order_record.id)
        ),
        jsonb_build_object(
          'wallet_id', driver_wallet_id,
          'direction', 'credit',
          'amount', payout_amount,
          'entry_type', 'commission',
          'metadata', jsonb_build_object('role', 'driver_payout', 'lpg_order_id', order_record.id)
        )
      ),
      target_idempotency_key || ':legacy-correction',
      null,
      order_record.public_reference,
      payout_policy,
      target_metadata || jsonb_build_object(
        'lpg_order_id', order_record.id,
        'source_event_id', target_metadata ->> 'source_event_id',
        'legacy_zero_payout_correction', true,
        'driver_profile_id', order_record.driver_profile_id,
        'gross_driver_earning_amount', gross_payout_amount,
        'platform_driver_commission_amount', platform_commission_amount,
        'platform_driver_commission_percent', platform_commission_percent,
        'net_driver_payout_amount', payout_amount
      )
    );

    insert into public.lpg_order_financial_adjustments (
      lpg_order_id, adjustment_type, currency_code, amount, transaction_id, status,
      reason_key, metadata, source, idempotency_key, created_by
    ) values (
      order_record.id, 'driver_payout_correction', order_record.currency_code, payout_amount,
      release_transaction_id, 'posted', 'lpg.driver_payout.legacy_zero_policy_correction',
      jsonb_build_object(
        'gross_driver_earning_amount', gross_payout_amount,
        'platform_driver_commission_amount', platform_commission_amount,
        'platform_driver_commission_percent', platform_commission_percent,
        'net_driver_payout_amount', payout_amount,
        'policy_snapshot', payout_policy
      ),
      'lpg.driver_payout.correction',
      target_idempotency_key || ':legacy-adjustment',
      actor_user_id
    ) on conflict (source, idempotency_key) do nothing;
  elsif payout_amount > 0 then
    release_transaction_id := public.release_escrow_hold(
      order_record.escrow_hold_id,
      jsonb_build_array(jsonb_build_object(
        'wallet_id', driver_wallet_id,
        'amount', payout_amount,
        'entry_type', 'commission',
        'metadata', jsonb_build_object('role', 'driver_payout')
      )),
      target_idempotency_key || ':release',
      target_source,
      target_metadata || jsonb_build_object(
        'financial_policy_snapshot', payout_policy,
        'lpg_order_id', order_record.id
      )
    );
  end if;
$new$;
  old_exec_metadata text := $old$
      target_metadata || jsonb_build_object(
        'lpg_order_id', order_record.id,
        'zero_amount_execution', payout_amount = 0,
        'policy_version_id', payout_policy ->> 'policyVersionId'
      ),
$old$;
  new_exec_metadata text := $new$
      target_metadata || jsonb_build_object(
        'lpg_order_id', order_record.id,
        'zero_amount_execution', payout_amount = 0,
        'policy_version_id', payout_policy ->> 'policyVersionId',
        'gross_driver_earning_amount', gross_payout_amount,
        'platform_driver_commission_amount', platform_commission_amount,
        'platform_driver_commission_percent', platform_commission_percent,
        'net_driver_payout_amount', payout_amount,
        'legacy_zero_payout_correction', legacy_zero_correction
      ),
$new$;
  old_order_update text := $old$
  update public.lpg_refill_orders
  set driver_commission_execution_id = commission_execution_id,
      status = 'completed',
      updated_at = timezone('utc', now())
  where id = order_record.id;
$old$;
  new_order_update text := $new$
  update public.lpg_refill_orders
  set driver_commission_execution_id = commission_execution_id,
      status = 'completed',
      metadata = metadata || jsonb_build_object(
        'driver_payout_execution_id', commission_execution_id,
        'driver_payout_actual_amount', payout_amount,
        'driver_payout_gross_earning_amount', gross_payout_amount,
        'driver_payout_platform_commission_amount', platform_commission_amount,
        'driver_payout_platform_commission_percent', platform_commission_percent,
        'driver_payout_legacy_correction', legacy_zero_correction
      ),
      updated_at = timezone('utc', now())
  where id = order_record.id;
$new$;
  old_event_metadata text := $old$
      'commission_execution_id', commission_execution_id,
      'payout_amount', payout_amount,
      'policy_version_id', payout_policy ->> 'policyVersionId',
      'zero_amount_execution', payout_amount = 0
$old$;
  new_event_metadata text := $new$
      'commission_execution_id', commission_execution_id,
      'payout_amount', payout_amount,
      'gross_driver_earning_amount', gross_payout_amount,
      'platform_driver_commission_amount', platform_commission_amount,
      'platform_driver_commission_percent', platform_commission_percent,
      'legacy_zero_payout_correction', legacy_zero_correction,
      'policy_version_id', payout_policy ->> 'policyVersionId',
      'zero_amount_execution', payout_amount = 0
$new$;
begin
  select pg_get_functiondef(
    'public.execute_lpg_driver_commission(uuid,text,uuid,uuid,jsonb,text)'::regprocedure
  ) into function_sql;

  if position(old_declarations in function_sql) = 0
    or position(old_assignment in function_sql) = 0
    or position(old_release in function_sql) = 0
    or position(old_exec_metadata in function_sql) = 0
    or position(old_order_update in function_sql) = 0
    or position(old_event_metadata in function_sql) = 0 then
    raise exception 'LPG driver commission function changed; refusing unsafe correction patch';
  end if;

  function_sql := replace(function_sql, old_declarations, new_declarations);
  function_sql := replace(function_sql, old_assignment, new_assignment);
  function_sql := replace(function_sql, old_release, new_release);
  function_sql := replace(function_sql, old_exec_metadata, new_exec_metadata);
  function_sql := replace(function_sql, old_order_update, new_order_update);
  function_sql := replace(function_sql, old_event_metadata, new_event_metadata);
  execute function_sql;
end;
$commission_executor$;

-- Display the actual commission execution amount in the driver job read model.
-- This is important for the legacy correction: its immutable original order
-- snapshot still says zero, while the correction execution records the posted net.
do $job_read$
declare
  function_sql text;
  old_amount text := $old$
      'driverCommissionAmount', target_order.driver_commission_amount,
$old$;
  new_amount text := $new$
      'driverCommissionAmount', coalesce((
        select execution.amount
        from public.commission_executions execution
        where execution.id = target_order.driver_commission_execution_id
          and execution.status = 'posted'
      ), target_order.driver_commission_amount),
      'driverCommissionGrossAmount', (
        select nullif(execution.metadata ->> 'gross_driver_earning_amount', '')::numeric
        from public.commission_executions execution
        where execution.id = target_order.driver_commission_execution_id
          and execution.status = 'posted'
      ),
      'driverCommissionPlatformShareAmount', (
        select nullif(execution.metadata ->> 'platform_driver_commission_amount', '')::numeric
        from public.commission_executions execution
        where execution.id = target_order.driver_commission_execution_id
          and execution.status = 'posted'
      ),
$new$;
begin
  select pg_get_functiondef(
    'public.read_lpg_job_details(uuid)'::regprocedure
  ) into function_sql;

  if position(old_amount in function_sql) = 0 then
    raise exception 'LPG job read model changed; refusing unsafe payout display patch';
  end if;
  function_sql := replace(function_sql, old_amount, new_amount);
  execute function_sql;
end;
$job_read$;

-- An explicit adjustment classification makes the one-time legacy transfer
-- auditable, and keeps the original accepted quote/order financial snapshot intact.
alter table public.lpg_order_financial_adjustments
  drop constraint if exists lpg_order_financial_adjustments_adjustment_type_check;
alter table public.lpg_order_financial_adjustments
  add constraint lpg_order_financial_adjustments_adjustment_type_check
  check (adjustment_type = any (array[
    'underfill_refund',
    'cancellation_refund',
    'manual_refund',
    'dispute_hold',
    'overfill_blocked',
    'driver_payout_correction'
  ]));

commit;
