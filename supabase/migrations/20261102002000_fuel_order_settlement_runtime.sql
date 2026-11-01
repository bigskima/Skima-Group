begin;

alter table public.fuel_order_operations
  add column if not exists settlement_execution_id uuid references public.settlement_executions(id) on delete set null,
  add column if not exists settlement_transaction_id uuid references public.financial_transactions(id) on delete set null,
  add column if not exists settlement_statement_id uuid references public.settlement_statements(id) on delete set null,
  add column if not exists settled_at timestamptz,
  add column if not exists deposit_refunded_at timestamptz,
  add column if not exists deposit_refund_amount numeric(28,8) not null default 0 check (deposit_refund_amount>=0);

create or replace function public.sync_fuel_accepted_quote_deposit_amount()
returns trigger
language plpgsql
security definer
set search_path = public
as $fuel_accepted_quote_deposit$
begin
  if new.status='accepted' then
    update public.fuel_order_operations
    set deposit_refund_amount=new.refundable_deposit_amount,
        updated_at=timezone('utc',now())
    where order_id=new.order_id;
  end if;
  return new;
end;
$fuel_accepted_quote_deposit$;

drop trigger if exists fuel_accepted_quote_deposit_amount on public.fuel_order_commercial_snapshots;
create trigger fuel_accepted_quote_deposit_amount
after update of status on public.fuel_order_commercial_snapshots
for each row
when (new.status='accepted' and old.status is distinct from new.status)
execute function public.sync_fuel_accepted_quote_deposit_amount();

revoke all on function public.sync_fuel_accepted_quote_deposit_amount() from public,anon,authenticated;

create or replace function public.settle_fuel_order(
  target_order_id uuid,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record public.order_records%rowtype;
  operation_record public.fuel_order_operations%rowtype;
  request_record public.service_requests%rowtype;
  hold_record public.escrow_holds%rowtype;
  quote_record public.fuel_order_commercial_snapshots%rowtype;
  branch_record public.organization_branches%rowtype;
  assignment_record public.order_assignments%rowtype;
  driver_profile_record public.driver_profiles%rowtype;
  station_wallet_id uuid;
  driver_wallet_id uuid;
  platform_revenue_wallet_id uuid;
  platform_liability_wallet_id uuid;
  customer_wallet_id uuid;
  v_settlement_execution_id uuid;
  v_settlement_transaction_id uuid;
  v_settlement_statement_id uuid;
  station_payout_amount numeric(28,8);
  driver_payout_amount numeric(28,8);
  platform_revenue_amount numeric(28,8);
  tax_liability_amount numeric(28,8);
  v_deposit_refund_amount numeric(28,8);
  component_total numeric(28,8);
  remaining_escrow_amount numeric(28,8);
  distribution jsonb := '[]'::jsonb;
  settlement_metadata jsonb;
  now_value timestamptz := timezone('utc',now());
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode='42501',message='Fuel settlement must run through the trusted SKIMA service runtime';
  end if;

  if target_order_id is null
     or coalesce(btrim(target_idempotency_key),'')=''
     or target_metadata is null
     or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='Fuel order ID, idempotency key and object metadata are required';
  end if;

  select * into order_record
  from public.order_records
  where id=target_order_id
  for update;

  if not found or not exists (
    select 1 from public.business_modules module
    where module.id=order_record.module_id and module.key='fuel'
  ) then
    raise exception using errcode='P0002',message='A valid Fuel order is required for settlement';
  end if;

  select * into operation_record
  from public.fuel_order_operations
  where order_id=target_order_id
  for update;

  if not found or operation_record.stage_key<>'completed' then
    raise exception using errcode='55000',message='Fuel settlement requires a completed operational lifecycle';
  end if;

  if operation_record.settlement_execution_id is not null then
    return operation_record.settlement_execution_id;
  end if;

  select * into request_record
  from public.service_requests
  where id=operation_record.service_request_id
  for update;

  if not found or request_record.escrow_hold_id is null then
    raise exception using errcode='55000',message='Fuel settlement requires the customer service-request escrow hold';
  end if;

  select * into hold_record
  from public.escrow_holds
  where id=request_record.escrow_hold_id
    and subject_type='service_request'
    and subject_id=request_record.id
  for update;

  if not found or hold_record.status not in ('held','partially_released') then
    raise exception using errcode='55000',message='Fuel customer escrow is not in a settleable state';
  end if;

  select * into quote_record
  from public.fuel_order_commercial_snapshots
  where order_id=target_order_id
    and service_request_id=operation_record.service_request_id
    and status='accepted'
  for update;

  if not found then
    raise exception using errcode='55000',message='An accepted and immutable Fuel commercial quote is required for settlement';
  end if;

  if quote_record.currency_code<>order_record.currency_code
     or quote_record.product_key<>operation_record.product_key then
    raise exception using errcode='23514',message='Fuel settlement currency and product must match the accepted order snapshot';
  end if;

  component_total :=
      quote_record.fuel_amount
    + quote_record.container_amount
    + quote_record.driver_amount
    + quote_record.platform_fee_amount
    + quote_record.tax_amount
    + quote_record.refundable_deposit_amount;

  if abs(component_total-quote_record.grand_total)>0.000001
     or abs(order_record.total_amount-quote_record.grand_total)>0.000001 then
    raise exception using errcode='23514',message='Fuel settlement components do not balance to the accepted commercial total';
  end if;

  remaining_escrow_amount := hold_record.hold_amount-hold_record.released_amount;
  if hold_record.currency_code<>order_record.currency_code
     or abs(remaining_escrow_amount-quote_record.grand_total)>0.000001 then
    raise exception using errcode='55000',message='The remaining Fuel escrow balance must exactly cover the accepted commercial quote';
  end if;

  select * into branch_record
  from public.organization_branches
  where id=operation_record.station_branch_id;

  if not found or branch_record.organization_id is null then
    raise exception using errcode='55000',message='The order station organization is required for settlement';
  end if;

  station_payout_amount := quote_record.fuel_amount;
  driver_payout_amount := 0;
  if operation_record.fulfillment_mode='station_managed' then
    -- Station Managed drivers are paid by their station, not from a SKIMA driver wallet.
    station_payout_amount := station_payout_amount+quote_record.driver_amount;
  else
    driver_payout_amount := quote_record.driver_amount;
  end if;

  platform_revenue_amount := quote_record.container_amount+quote_record.platform_fee_amount;
  tax_liability_amount := quote_record.tax_amount;
  v_deposit_refund_amount := case
    when operation_record.container_mode='rental' then quote_record.refundable_deposit_amount
    else 0
  end;

  if operation_record.container_mode='purchase' and quote_record.refundable_deposit_amount<>0 then
    raise exception using errcode='23514',message='Purchased Fuel containers cannot carry a refundable rental deposit';
  end if;

  if operation_record.container_mode='rental'
     and v_deposit_refund_amount>0
     and operation_record.stage_key<>'completed' then
    raise exception using errcode='55000',message='Rental deposit return requires completed container return and inspection';
  end if;

  station_wallet_id := public.ensure_wallet_account(
    'partner','organization',branch_record.organization_id,order_record.currency_code,
    'fuel.settlement_engine',
    jsonb_build_object('wallet_purpose','fuel_station_settlement','station_branch_id',operation_record.station_branch_id),
    target_idempotency_key||':station-wallet'
  );

  if driver_payout_amount>0 then
    select * into assignment_record
    from public.order_assignments
    where order_id=target_order_id
      and participant_role='driver'
      and entity_type='driver'
      and status in ('active','completed')
    order by assigned_at desc
    limit 1
    for share;

    if not found then
      raise exception using errcode='55000',message='A real assigned driver identity is required before driver settlement';
    end if;

    select * into driver_profile_record
    from public.driver_profiles
    where id=assignment_record.entity_id
    for share;

    if not found then
      raise exception using errcode='23514',message='Fuel driver settlement must reference an approved marketplace or SKIMA driver profile';
    end if;

    driver_wallet_id := public.ensure_wallet_account(
      'driver','driver',driver_profile_record.id,order_record.currency_code,
      'fuel.settlement_engine',
      jsonb_build_object('wallet_purpose','fuel_delivery_earnings','driver_profile_id',driver_profile_record.id),
      target_idempotency_key||':driver-wallet'
    );
  end if;

  if platform_revenue_amount>0 then
    platform_revenue_wallet_id := public.ensure_platform_revenue_wallet(
      order_record.currency_code,'fuel.settlement_engine',target_idempotency_key||':revenue-wallet'
    );
  end if;

  if tax_liability_amount>0 then
    platform_liability_wallet_id := public.ensure_platform_liability_wallet(
      order_record.currency_code,'fuel.settlement_engine',target_idempotency_key||':tax-liability-wallet'
    );
  end if;

  if v_deposit_refund_amount>0 then
    -- Return the deposit to the exact customer wallet debited by the original
    -- escrow-funding transaction. Never choose a different same-currency wallet.
    select ledger.wallet_id into customer_wallet_id
    from public.wallet_ledger_entries ledger
    join public.wallet_accounts wallet on wallet.id=ledger.wallet_id
    where ledger.transaction_id=hold_record.source_transaction_id
      and ledger.direction='debit'
      and ledger.amount=hold_record.hold_amount
      and wallet.wallet_type='customer'
      and wallet.owner_entity_type='user'
      and wallet.owner_entity_id=operation_record.customer_user_id
      and wallet.currency_code=order_record.currency_code
      and wallet.status='active'
    order by ledger.created_at asc
    limit 1
    for share of ledger;

    if customer_wallet_id is null then
      raise exception using errcode='55000',message='The original customer funding wallet could not be verified for the rental deposit return';
    end if;
  end if;

  if station_payout_amount>0 then
    distribution := distribution||jsonb_build_array(jsonb_build_object(
      'wallet_id',station_wallet_id,
      'amount',station_payout_amount,
      'entry_type','principal',
      'metadata',jsonb_build_object(
        'role','station',
        'fuel_principal_amount',quote_record.fuel_amount,
        'station_managed_driver_component',case when operation_record.fulfillment_mode='station_managed' then quote_record.driver_amount else 0 end,
        'fuel_product_key',operation_record.product_key
      )
    ));
  end if;

  if driver_payout_amount>0 then
    distribution := distribution||jsonb_build_array(jsonb_build_object(
      'wallet_id',driver_wallet_id,
      'amount',driver_payout_amount,
      'entry_type','commission',
      'metadata',jsonb_build_object(
        'role','driver',
        'component','fuel_delivery_fee',
        'fulfillment_mode',operation_record.fulfillment_mode,
        'fuel_product_key',operation_record.product_key
      )
    ));
  end if;

  if platform_revenue_amount>0 then
    distribution := distribution||jsonb_build_array(jsonb_build_object(
      'wallet_id',platform_revenue_wallet_id,
      'amount',platform_revenue_amount,
      'entry_type','fee',
      'metadata',jsonb_build_object(
        'role','platform',
        'container_sale_or_rental_amount',quote_record.container_amount,
        'platform_fee_amount',quote_record.platform_fee_amount,
        'container_mode',operation_record.container_mode
      )
    ));
  end if;

  if tax_liability_amount>0 then
    distribution := distribution||jsonb_build_array(jsonb_build_object(
      'wallet_id',platform_liability_wallet_id,
      'amount',tax_liability_amount,
      'entry_type','tax',
      'metadata',jsonb_build_object('role','tax_liability','fuel_product_key',operation_record.product_key)
    ));
  end if;

  if v_deposit_refund_amount>0 then
    distribution := distribution||jsonb_build_array(jsonb_build_object(
      'wallet_id',customer_wallet_id,
      'amount',v_deposit_refund_amount,
      'entry_type','principal',
      'metadata',jsonb_build_object(
        'role','customer_refundable_deposit_return',
        'refund_reason','rental_container_returned_and_inspected',
        'container_count',operation_record.container_count
      )
    ));
  end if;

  if jsonb_array_length(distribution)=0 then
    raise exception using errcode='23514',message='Fuel settlement distribution cannot be empty';
  end if;

  settlement_metadata := target_metadata||jsonb_build_object(
    'fuel_order_id',target_order_id,
    'service_request_id',operation_record.service_request_id,
    'product_key',operation_record.product_key,
    'container_mode',operation_record.container_mode,
    'fulfillment_mode',operation_record.fulfillment_mode,
    'commercial_snapshot_id',quote_record.id,
    'component_snapshot',quote_record.component_snapshot,
    'station_payout_amount',station_payout_amount,
    'driver_payout_amount',driver_payout_amount,
    'platform_revenue_amount',platform_revenue_amount,
    'tax_liability_amount',tax_liability_amount,
    'deposit_refund_amount',v_deposit_refund_amount,
    'policy_snapshot',jsonb_build_object(
      'settlement_policy_key','settlement.fuel.escrow.station-driver.v1',
      'settlement_policy_id',request_record.settlement_policy_id,
      'station_managed_driver_compensation','station_wallet',
      'rental_deposit_release_condition','all_rental_containers_received_and_inspected'
    )
  );

  v_settlement_execution_id := public.execute_service_request_settlement(
    operation_record.service_request_id,
    request_record.escrow_hold_id,
    distribution,
    target_idempotency_key,
    'fuel.settlement_engine',
    settlement_metadata
  );

  select execution.transaction_id into v_settlement_transaction_id
  from public.settlement_executions execution
  where execution.id=v_settlement_execution_id;

  if v_settlement_transaction_id is null then
    raise exception using errcode='55000',message='Fuel settlement execution did not produce a financial transaction';
  end if;

  insert into public.settlement_statements(
    organization_id,service_request_id,order_id,escrow_hold_id,settlement_execution_id,
    currency_code,gross_amount,platform_fee_amount,net_amount,status,period_start,period_end,
    source,idempotency_key,metadata
  )
  values(
    branch_record.organization_id,operation_record.service_request_id,target_order_id,
    request_record.escrow_hold_id,v_settlement_execution_id,order_record.currency_code,
    station_payout_amount,0,station_payout_amount,'posted',
    operation_record.created_at,now_value,'fuel.settlement_engine',
    target_idempotency_key||':station-statement',
    settlement_metadata||jsonb_build_object('statement_role','station','wallet_id',station_wallet_id)
  )
  on conflict(source,idempotency_key) do nothing
  returning id into v_settlement_statement_id;

  if v_settlement_statement_id is null then
    select statement.id into v_settlement_statement_id
    from public.settlement_statements statement
    where statement.source='fuel.settlement_engine'
      and statement.idempotency_key=target_idempotency_key||':station-statement';
  end if;

  update public.fuel_order_operations
  set settlement_execution_id=v_settlement_execution_id,
      settlement_transaction_id=v_settlement_transaction_id,
      settlement_statement_id=v_settlement_statement_id,
      settled_at=now_value,
      deposit_refunded_at=case when v_deposit_refund_amount>0 then now_value else deposit_refunded_at end,
      deposit_refund_amount=v_deposit_refund_amount,
      metadata=metadata||jsonb_build_object(
        'settlement_execution_id',v_settlement_execution_id,
        'settlement_transaction_id',v_settlement_transaction_id,
        'settlement_statement_id',v_settlement_statement_id,
        'deposit_refunded_at',case when v_deposit_refund_amount>0 then now_value else null end
      ),
      updated_at=now_value
  where order_id=target_order_id;

  update public.fuel_order_commercial_snapshots
  set status='settled',
      metadata=metadata||jsonb_build_object(
        'settlement_execution_id',v_settlement_execution_id,
        'settlement_transaction_id',v_settlement_transaction_id
      ),
      updated_at=now_value
  where id=quote_record.id;

  update public.order_records
  set status='completed',
      completed_at=coalesce(completed_at,now_value),
      metadata=metadata||jsonb_build_object(
        'fuel_settlement_execution_id',v_settlement_execution_id,
        'fuel_settlement_transaction_id',v_settlement_transaction_id,
        'fuel_settlement_statement_id',v_settlement_statement_id
      ),
      updated_at=now_value
  where id=target_order_id;

  return v_settlement_execution_id;
end;
$$;

create or replace function public.trigger_settle_fuel_order_on_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='Fuel settlement completion must be triggered by the trusted SKIMA service runtime';
  end if;

  perform public.settle_fuel_order(
    new.order_id,
    'fuel-settlement:'||new.order_id::text,
    jsonb_build_object(
      'trigger','fuel_order_operations.completed',
      'from_stage',old.stage_key,
      'to_stage',new.stage_key
    )
  );

  return new;
end;
$$;

drop trigger if exists fuel_order_settlement_on_completion on public.fuel_order_operations;
create trigger fuel_order_settlement_on_completion
after update of stage_key on public.fuel_order_operations
for each row
when (new.stage_key='completed' and old.stage_key is distinct from new.stage_key)
execute function public.trigger_settle_fuel_order_on_completion();

revoke all on function public.settle_fuel_order(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.settle_fuel_order(uuid,text,jsonb) to service_role;

revoke all on function public.trigger_settle_fuel_order_on_completion() from public,anon,authenticated;

notify pgrst,'reload schema';
commit;
