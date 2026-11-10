begin;

-- SKIMA Managed procurement money is operating capital, not platform revenue.
-- Keep the supplier fund separate from the physical cash float and from the
-- accounting-only record of cash already paid to a station.
create unique index if not exists wallet_accounts_supplier_cash_cycle_purpose_uidx
  on public.wallet_accounts(currency_code,(metadata->>'wallet_purpose'))
  where owner_entity_type='platform'
    and owner_entity_id is null
    and status='active'
    and metadata->>'wallet_purpose' in (
      'lpg_fleet_operating_funds',
      'lpg_supplier_cash_on_hand',
      'lpg_supplier_disbursements',
      'fuel_supplier_funds',
      'fuel_supplier_cash_on_hand',
      'fuel_supplier_disbursements'
    );

create table if not exists public.platform_supplier_cash_movements (
  id uuid primary key default gen_random_uuid(),
  module_key text not null check (module_key in ('lpg','fuel')),
  movement_type text not null check (movement_type in ('cash_withdrawal','station_cash_payment','fund_reclassification')),
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  amount numeric(28,8) not null check (amount>0),
  source_wallet_id uuid not null references public.wallet_accounts(id) on delete restrict,
  destination_wallet_id uuid not null references public.wallet_accounts(id) on delete restrict,
  financial_transaction_id uuid not null references public.financial_transactions(id) on delete restrict,
  lpg_procurement_id uuid references public.lpg_internal_refill_procurements(id) on delete restrict,
  fuel_order_id uuid references public.order_records(id) on delete restrict,
  station_branch_id uuid references public.organization_branches(id) on delete restrict,
  payment_reference text not null check (char_length(btrim(payment_reference)) between 3 and 160),
  evidence_media_asset_id uuid references public.media_assets(id) on delete restrict,
  note text,
  occurred_at timestamptz not null default timezone('utc',now()),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default timezone('utc',now()),
  check (
    (movement_type='cash_withdrawal' and lpg_procurement_id is null and fuel_order_id is null)
    or
    (movement_type='station_cash_payment' and (
      (module_key='lpg' and lpg_procurement_id is not null and fuel_order_id is null)
      or (module_key='fuel' and fuel_order_id is not null and lpg_procurement_id is null)
    ))
    or (movement_type='fund_reclassification' and module_key='lpg'
        and lpg_procurement_id is null and fuel_order_id is null)
  ),
  unique(module_key,idempotency_key)
);

create index if not exists platform_supplier_cash_movements_recent_idx
  on public.platform_supplier_cash_movements(module_key,currency_code,occurred_at desc);
create index if not exists platform_supplier_cash_movements_lpg_procurement_idx
  on public.platform_supplier_cash_movements(lpg_procurement_id,occurred_at desc)
  where lpg_procurement_id is not null;
create index if not exists platform_supplier_cash_movements_fuel_order_idx
  on public.platform_supplier_cash_movements(fuel_order_id,occurred_at desc)
  where fuel_order_id is not null;

alter table public.platform_supplier_cash_movements enable row level security;
revoke all on table public.platform_supplier_cash_movements from public,anon,authenticated;
grant all on table public.platform_supplier_cash_movements to service_role;

drop policy if exists platform_supplier_cash_movements_deny_direct_authenticated
  on public.platform_supplier_cash_movements;
create policy platform_supplier_cash_movements_deny_direct_authenticated
  on public.platform_supplier_cash_movements for all to authenticated
  using(false) with check(false);

drop trigger if exists audit_platform_supplier_cash_movements on public.platform_supplier_cash_movements;
create trigger audit_platform_supplier_cash_movements
after insert on public.platform_supplier_cash_movements
for each row execute function public.record_table_audit();

create or replace function public.ensure_skima_supplier_wallet(
  target_module_key text,
  target_currency_code text,
  target_account_kind text
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  purpose_value text;
  wallet_type_value text;
  wallet_id uuid;
  idempotency_value text;
begin
  if target_module_key not in ('lpg','fuel')
     or target_account_kind not in ('supplier_fund','cash_on_hand','supplier_disbursements')
     or not exists(
       select 1 from public.currency_definitions currency
       where currency.code=upper(target_currency_code) and currency.status='enabled'
     ) then
    raise exception using errcode='22023',message='A supported SKIMA module, account kind and enabled currency are required';
  end if;

  purpose_value:=case
    when target_module_key='lpg' and target_account_kind='supplier_fund' then 'lpg_fleet_operating_funds'
    when target_module_key='lpg' and target_account_kind='cash_on_hand' then 'lpg_supplier_cash_on_hand'
    when target_module_key='lpg' and target_account_kind='supplier_disbursements' then 'lpg_supplier_disbursements'
    when target_module_key='fuel' and target_account_kind='supplier_fund' then 'fuel_supplier_funds'
    when target_module_key='fuel' and target_account_kind='cash_on_hand' then 'fuel_supplier_cash_on_hand'
    else 'fuel_supplier_disbursements'
  end;
  wallet_type_value:=case when target_account_kind='supplier_disbursements' then 'platform' else 'platform_clearing' end;

  select wallet.id into wallet_id
  from public.wallet_accounts wallet
  where wallet.wallet_type=wallet_type_value
    and wallet.owner_entity_type='platform'
    and wallet.owner_entity_id is null
    and wallet.currency_code=upper(target_currency_code)
    and wallet.status='active'
    and wallet.metadata->>'wallet_purpose'=purpose_value
  for update;

  if wallet_id is not null then return wallet_id; end if;

  idempotency_value:='skima-supplier-account:'||purpose_value||':'||lower(target_currency_code);
  insert into public.wallet_accounts(
    wallet_type,owner_entity_type,owner_entity_id,currency_code,status,metadata,
    created_by,source,idempotency_key
  ) values (
    wallet_type_value,'platform',null,upper(target_currency_code),'active',
    jsonb_build_object(
      'wallet_purpose',purpose_value,
      'display_name',case target_account_kind
        when 'supplier_fund' then case target_module_key when 'lpg' then 'SKIMA LPG Supplier Fund' else 'SKIMA Fuel Supplier Fund' end
        when 'cash_on_hand' then case target_module_key when 'lpg' then 'SKIMA LPG Cash on Hand' else 'SKIMA Fuel Cash on Hand' end
        else case target_module_key when 'lpg' then 'SKIMA LPG Supplier Cash Disbursements' else 'SKIMA Fuel Supplier Cash Disbursements' end
      end,
      'platform_internal',true,
      'accounting_scope',target_module_key||'_supplier_cash_cycle',
      'withdrawal_allowed',false
    ),
    auth.uid(),'platform.supplier_funds',idempotency_value
  )
  on conflict do nothing
  returning id into wallet_id;

  if wallet_id is null then
    select wallet.id into wallet_id
    from public.wallet_accounts wallet
    where wallet.wallet_type=wallet_type_value
      and wallet.owner_entity_type='platform'
      and wallet.owner_entity_id is null
      and wallet.currency_code=upper(target_currency_code)
      and wallet.status='active'
      and wallet.metadata->>'wallet_purpose'=purpose_value
    for update;
  else
    insert into public.wallet_account_events(
      wallet_account_id,event_type,status,idempotency_key,metadata,created_by
    ) values (
      wallet_id,'created','active',idempotency_value||':created',
      jsonb_build_object(
        'source','platform.supplier_funds',
        'wallet_purpose',purpose_value,
        'accounting_scope',target_module_key||'_supplier_cash_cycle'
      ),auth.uid()
    ) on conflict do nothing;
  end if;

  if wallet_id is null then
    raise exception using errcode='55000',message='SKIMA supplier cash-cycle account could not be initialized';
  end if;
  return wallet_id;
end;
$function$;

revoke all on function public.ensure_skima_supplier_wallet(text,text,text) from public,anon,authenticated;
grant execute on function public.ensure_skima_supplier_wallet(text,text,text) to service_role;

-- The LPG customer-cost allocation must land in a dedicated SKIMA supplier
-- fund, not the shared platform clearing account.
do $patch$
declare
  function_sql text;
  old_block text;
  new_block text;
begin
  select pg_get_functiondef(
    'public.settle_lpg_internal_order(uuid,text,text)'::regprocedure
  ) into function_sql;

  old_block:=$old$  clearing_wallet_id:=public.ensure_platform_clearing_wallet(
    order_record.currency_code,'lpg.internal_settlement',target_idempotency_key||':clearing-wallet'
  );$old$;
  new_block:=$new$  clearing_wallet_id:=public.ensure_skima_supplier_wallet(
    'lpg',order_record.currency_code,'supplier_fund'
  );$new$;

  if position(old_block in function_sql)=0 then
    raise exception 'LPG settlement clearing-wallet block changed; refusing supplier-fund cutover';
  end if;
  execute replace(function_sql,old_block,new_block);
end;
$patch$;

-- Preserve the LPG supplier-payment record, but require an explicit cash-float
-- withdrawal before a physical station cash payment can be posted.
do $patch$
declare
  function_sql text;
  old_decl text;
  new_decl text;
  old_validation text;
  new_validation text;
  old_balance text;
  new_balance text;
  old_debit text;
  new_debit text;
  old_insert text;
  new_insert text;
  old_processing text;
  new_processing text;
begin
  select pg_get_functiondef(
    'public.record_lpg_internal_supplier_payment(uuid,numeric,text,text,uuid,text,text,timestamptz)'::regprocedure
  ) into function_sql;

  old_decl:=$old$  funding_wallet_id uuid;
  supplier_wallet_id uuid;$old$;
  new_decl:=$new$  funding_wallet_id uuid;
  cash_wallet_id uuid;
  hold_record public.escrow_holds%rowtype;
  supplier_wallet_id uuid;$new$;
  if position(old_decl in function_sql)=0 then raise exception 'LPG supplier-payment declarations changed'; end if;
  function_sql:=replace(function_sql,old_decl,new_decl);

  old_validation:=$old$    or target_payment_method not in ('cash','bank_transfer')$old$;
  new_validation:=$new$    or target_payment_method not in ('cash','bank_transfer')$new$;
  if position(old_validation in function_sql)=0 then raise exception 'LPG supplier-payment method validation changed'; end if;
  function_sql:=replace(function_sql,old_validation,new_validation);

  old_processing:=$old$  select * into order_record
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
  end if;$old$;
  new_processing:=$new$  select * into order_record
  from public.lpg_refill_orders
  where id=procurement.lpg_order_id
  for update;
  if not found or order_record.fulfillment_channel<>'skima_internal'
    or order_record.payment_status not in ('reserved','settled')
    or order_record.escrow_hold_id is null then
    raise exception using errcode='55000',message='an approved, customer-funded SKIMA Fleet order is required before recording its supplier cash payment';
  end if;

  select * into hold_record
  from public.escrow_holds
  where id=order_record.escrow_hold_id
    and subject_type='service_request'
    and subject_id=order_record.service_request_id
  for share;
  if not found or hold_record.status not in ('held','partially_released','released') then
    raise exception using errcode='55000',message='SKIMA Fleet customer escrow is not active; supplier cash cannot be paid from an expired or cancelled order';
  end if;

  if order_record.internal_settlement_execution_id is not null then
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
  else
    funding_wallet_id:=public.ensure_skima_supplier_wallet(
      'lpg',order_record.currency_code,'supplier_fund'
    );
  end if;
  if funding_wallet_id is null then
    raise exception using errcode='55000',message='SKIMA Fleet Supplier Fund allocation could not be resolved';
  end if;$new$;
  if position(old_processing in function_sql)=0 then raise exception 'LPG customer-funded order guard changed'; end if;
  function_sql:=replace(function_sql,old_processing,new_processing);

  -- Preserve true idempotent replays of historical bank-transfer payments, but
  -- require all new supplier payments to follow the physical cash-float cycle.
  old_balance:=$old$  if procurement.status<>'approved' then$old$;
  new_balance:=$new$  if target_payment_method<>'cash' then
    raise exception using errcode='22023',message='New LPG supplier payments must be recorded as physical cash after a Supplier Fund withdrawal';
  end if;
  if procurement.status<>'approved' then$new$;
  if position(old_balance in function_sql)=0 then raise exception 'LPG supplier payment new-method guard anchor changed'; end if;
  function_sql:=replace(function_sql,old_balance,new_balance);

  old_balance:=$old$  select coalesce(balance.balance,0) into available_balance
  from public.wallet_accounts wallet
  left join public.wallet_balances balance
    on balance.wallet_id=wallet.id and balance.currency_code=wallet.currency_code
  where wallet.id=funding_wallet_id and wallet.currency_code=order_record.currency_code
    and wallet.wallet_type='platform_clearing' and wallet.owner_entity_type='platform'
    and wallet.status='active';
  if not found or available_balance<round(target_amount,2) then
    raise exception using errcode='55000',
      message='SKIMA platform clearing funds are insufficient for this disbursement. Reconcile the collection wallet before recording payment.';
  end if;$old$;
  new_balance:=$new$  cash_wallet_id:=public.ensure_skima_supplier_wallet(
    'lpg',order_record.currency_code,'cash_on_hand'
  );
  select coalesce(balance.balance,0) into available_balance
  from public.wallet_accounts wallet
  left join public.wallet_balances balance
    on balance.wallet_id=wallet.id and balance.currency_code=wallet.currency_code
  where wallet.id=cash_wallet_id and wallet.currency_code=order_record.currency_code
    and wallet.wallet_type='platform_clearing'
    and wallet.owner_entity_type='platform' and wallet.status='active'
    and wallet.metadata->>'wallet_purpose'='lpg_supplier_cash_on_hand';
  if not found or available_balance<round(target_amount,2) then
    raise exception using errcode='55000',
      message='SKIMA LPG cash on hand is insufficient. Record a cash withdrawal from the LPG Supplier Fund before paying the station.';
  end if;$new$;
  if position(old_balance in function_sql)=0 then raise exception 'LPG supplier-payment cash-balance block changed'; end if;
  function_sql:=replace(function_sql,old_balance,new_balance);

  old_debit:=$old$jsonb_build_object(
        'wallet_id',funding_wallet_id,'direction','debit','amount',round(target_amount,2),
        'entry_type','principal',
        'metadata',jsonb_build_object(
          'role','skima_fleet_funds_disbursed_to_supplier',
          'procurement_id',procurement.id,'lpg_order_id',order_record.id,
          'payment_method',target_payment_method
        )
      )$old$;
  new_debit:=$new$jsonb_build_object(
        'wallet_id',cash_wallet_id,'direction','debit','amount',round(target_amount,2),
        'entry_type','principal',
        'metadata',jsonb_build_object(
          'role','skima_lpg_cash_paid_to_supplier',
          'procurement_id',procurement.id,'lpg_order_id',order_record.id,
          'supplier_fund_wallet_id',funding_wallet_id,
          'payment_method','cash'
        )
      )$new$;
  if position(old_debit in function_sql)=0 then raise exception 'LPG supplier-payment ledger debit changed'; end if;
  function_sql:=replace(function_sql,old_debit,new_debit);

  old_insert:=$old$  if payment_id is null then
    select id into payment_id from public.lpg_internal_supplier_payments
    where source='lpg.internal_supplier_payment' and idempotency_key=target_idempotency_key;
  end if;$old$;
  new_insert:=$new$  if payment_id is null then
    select id into payment_id from public.lpg_internal_supplier_payments
    where source='lpg.internal_supplier_payment' and idempotency_key=target_idempotency_key;
  end if;

  insert into public.platform_supplier_cash_movements(
    module_key,movement_type,currency_code,amount,source_wallet_id,destination_wallet_id,
    financial_transaction_id,lpg_procurement_id,payment_reference,evidence_media_asset_id,
    note,occurred_at,created_by,idempotency_key,metadata
  ) values (
    'lpg','station_cash_payment',order_record.currency_code,round(target_amount,2),
    cash_wallet_id,supplier_wallet_id,transaction_id,procurement.id,payment_reference,
    target_evidence_media_asset_id,nullif(btrim(coalesce(target_note,'')),''),
    paid_at_value,auth.uid(),target_idempotency_key,
    jsonb_build_object(
      'lpgOrderId',order_record.id,
      'supplierName',procurement.supplier_name,
      'paymentMethod','cash',
      'supplierFundWalletId',funding_wallet_id
    )
  ) on conflict(module_key,idempotency_key) do nothing;$new$;
  if position(old_insert in function_sql)=0 then raise exception 'LPG supplier-payment result block changed'; end if;
  function_sql:=replace(function_sql,old_insert,new_insert);
  execute function_sql;
end;
$patch$;

-- Fuel cash movements are deliberately separate from station wallets. The
-- supplier fund is credited by final SKIMA Managed settlement; finance records
-- a bank-to-cash withdrawal, then a physical cash payment to the station.
create or replace function public.read_platform_supplier_funds_workspace(
  target_currency_code text default 'NGN'
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
declare
  currency_value text:=upper(coalesce(target_currency_code,'NGN'));
  accounts_value jsonb;
  movements_value jsonb;
  fuel_payables_value jsonb;
  lpg_payables_value jsonb;
  legacy_lpg_value jsonb;
begin
  if not (
    public.is_platform_super_admin()
    or public.has_permission('platform.financial.read',null)
    or public.has_permission('platform.financial.manage',null)
  ) then
    raise exception using errcode='42501',message='platform finance read permission is required for supplier funds';
  end if;
  if not exists(select 1 from public.currency_definitions where code=currency_value and status='enabled') then
    raise exception using errcode='22023',message='requested supplier-fund currency is not enabled';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'moduleKey',module_key,
    'accountKind',account_kind,
    'walletId',wallet.id,
    'walletPurpose',wallet.metadata->>'wallet_purpose',
    'balance',coalesce(balance.balance,0),
    'currencyCode',currency_value
  ) order by module_key,account_kind),'[]'::jsonb)
  into accounts_value
  from (values
    ('lpg'::text,'supplier_fund'::text,'lpg_fleet_operating_funds'::text,'platform_clearing'::text),
    ('lpg','cash_on_hand','lpg_supplier_cash_on_hand','platform_clearing'),
    ('fuel','supplier_fund','fuel_supplier_funds','platform_clearing'),
    ('fuel','cash_on_hand','fuel_supplier_cash_on_hand','platform_clearing')
  ) accounts(module_key,account_kind,purpose,wallet_type)
  left join public.wallet_accounts wallet
    on wallet.wallet_type=accounts.wallet_type
   and wallet.owner_entity_type='platform'
   and wallet.owner_entity_id is null
   and wallet.currency_code=currency_value
   and wallet.status='active'
   and wallet.metadata->>'wallet_purpose'=accounts.purpose
  left join public.wallet_balances balance
    on balance.wallet_id=wallet.id and balance.currency_code=currency_value;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',movement.id,
    'moduleKey',movement.module_key,
    'movementType',movement.movement_type,
    'amount',movement.amount,
    'currencyCode',movement.currency_code,
    'paymentReference',movement.payment_reference,
    'occurredAt',movement.occurred_at,
    'lpgProcurementId',movement.lpg_procurement_id,
    'fuelOrderId',movement.fuel_order_id,
    'financialTransactionId',movement.financial_transaction_id,
    'sourceWalletPurpose',source_wallet.metadata->>'wallet_purpose',
    'destinationWalletPurpose',destination_wallet.metadata->>'wallet_purpose',
    'note',movement.note
  ) order by movement.occurred_at desc),'[]'::jsonb)
  into movements_value
  from (
    select * from public.platform_supplier_cash_movements
    where currency_code=currency_value
    order by occurred_at desc
    limit 100
  ) movement
  join public.wallet_accounts source_wallet on source_wallet.id=movement.source_wallet_id
  join public.wallet_accounts destination_wallet on destination_wallet.id=movement.destination_wallet_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'orderId',order_record.id,
    'orderReference',order_record.id::text,
    'branchId',operation.station_branch_id,
    'branchName',branch.display_name,
    'supplierName',organization.display_name,
    'productKey',operation.product_key,
    'requestedLitres',operation.requested_litres,
    'stageKey',operation.stage_key,
    'supplierAmount',supplier_amount.amount,
    'paidAmount',supplier_amount.paid_amount,
    'outstandingAmount',greatest(supplier_amount.amount-supplier_amount.paid_amount,0),
    'currencyCode',order_record.currency_code
  ) order by operation.created_at desc),'[]'::jsonb)
  into fuel_payables_value
  from public.fuel_order_operations operation
  join public.order_records order_record on order_record.id=operation.order_id
  join public.business_modules module on module.id=order_record.module_id and module.key='fuel'
  join public.service_requests request on request.id=operation.service_request_id
  join public.escrow_holds hold
    on hold.id=request.escrow_hold_id
   and hold.subject_type='service_request'
   and hold.subject_id=request.id
  join public.fuel_order_commercial_snapshots quote
    on quote.order_id=operation.order_id
   and quote.service_request_id=operation.service_request_id
   and quote.status in ('accepted','settled')
  join public.organization_branches branch on branch.id=operation.station_branch_id
  join public.organizations organization on organization.id=branch.organization_id
  cross join lateral (
    select
      coalesce(nullif(quote.component_snapshot->>'station_supply_amount','')::numeric,quote.fuel_amount) as amount,
      coalesce((
        select sum(movement.amount)
        from public.platform_supplier_cash_movements movement
        where movement.module_key='fuel'
          and movement.movement_type='station_cash_payment'
          and movement.fuel_order_id=operation.order_id
      ),0)::numeric(28,8) as paid_amount
  ) supplier_amount
  where operation.fulfillment_mode='skima_managed'
    and operation.stage_key in ('ready_for_driver','station_handover','out_for_delivery','delivered','completed')
    and order_record.currency_code=currency_value
    and hold.status in ('held','partially_released','released')
    and supplier_amount.amount>supplier_amount.paid_amount;

  select coalesce(jsonb_agg(jsonb_build_object(
    'procurementId',procurement.id,
    'orderId',order_record.id,
    'orderReference',order_record.public_reference,
    'supplierName',procurement.supplier_name,
    'supplierAmount',procurement.procurement_amount,
    'paidAmount',supplier_amount.paid_amount,
    'supplierOutstanding',greatest(procurement.procurement_amount-supplier_amount.paid_amount,0),
    'currencyCode',order_record.currency_code,
    'orderStatus',order_record.status,
    'paymentStatus',order_record.payment_status,
    'holdStatus',hold.status
  ) order by order_record.created_at desc),'[]'::jsonb)
  into lpg_payables_value
  from public.lpg_internal_refill_procurements procurement
  join public.lpg_refill_orders order_record on order_record.id=procurement.lpg_order_id
  join public.escrow_holds hold
    on hold.id=order_record.escrow_hold_id
   and hold.subject_type='service_request'
   and hold.subject_id=order_record.service_request_id
  cross join lateral (
    select coalesce(sum(payment.amount),0)::numeric(28,8) as paid_amount
    from public.lpg_internal_supplier_payments payment
    where payment.procurement_id=procurement.id
  ) supplier_amount
  where procurement.status='approved'
    and order_record.fulfillment_channel='skima_internal'
    and order_record.payment_status in ('reserved','settled')
    and hold.status in ('held','partially_released','released')
    and order_record.currency_code=currency_value
    and procurement.procurement_amount>supplier_amount.paid_amount;

  select jsonb_build_object(
    'supplierPrincipalCredited',coalesce(sum(
      case when ledger.direction='credit' and ledger.metadata->>'role'='internal_lpg_cost_recovery'
        then ledger.amount else 0 end
    ),0),
    'recordedSupplierCashPaid',coalesce(sum(
      case when ledger.direction='debit' and ledger.metadata->>'role'='skima_fleet_funds_disbursed_to_supplier'
        then ledger.amount else 0 end
    ),0),
    'reclassifiedAmount',coalesce(sum(
      case when ledger.direction='debit' and ledger.metadata->>'role'='legacy_lpg_supplier_fund_reclassified'
        then ledger.amount else 0 end
    ),0),
    'legacyClearingBalance',coalesce(balance.balance,0),
    'reclassifiableAmount',least(
      greatest(
        coalesce(sum(case
          when ledger.direction='credit' and ledger.metadata->>'role'='internal_lpg_cost_recovery' then ledger.amount
          else 0 end),0)
        -coalesce(sum(case
          when ledger.direction='debit' and ledger.metadata->>'role'='skima_fleet_funds_disbursed_to_supplier' then ledger.amount
          else 0 end),0)
        -coalesce(sum(case
          when ledger.direction='debit' and ledger.metadata->>'role'='legacy_lpg_supplier_fund_reclassified' then ledger.amount
          else 0 end),0),
        0
      ),
      greatest(coalesce(balance.balance,0),0)
    ),
    'unreconciledDifference',greatest(
      coalesce(sum(case
        when ledger.direction='credit' and ledger.metadata->>'role'='internal_lpg_cost_recovery' then ledger.amount
        else 0 end),0)
      -coalesce(sum(case
        when ledger.direction='debit' and ledger.metadata->>'role'='skima_fleet_funds_disbursed_to_supplier' then ledger.amount
        else 0 end),0)
      -coalesce(sum(case
        when ledger.direction='debit' and ledger.metadata->>'role'='legacy_lpg_supplier_fund_reclassified' then ledger.amount
        else 0 end),0)
      -coalesce(balance.balance,0),
      0
    ),
    'currencyCode',currency_value
  )
  into legacy_lpg_value
  from public.wallet_accounts wallet
  left join public.wallet_balances balance
    on balance.wallet_id=wallet.id and balance.currency_code=currency_value
  left join public.wallet_ledger_entries ledger
    on ledger.wallet_id=wallet.id
  where wallet.wallet_type='platform_clearing'
    and wallet.owner_entity_type='platform'
    and wallet.owner_entity_id is null
    and wallet.currency_code=currency_value
    and wallet.status='active'
    and wallet.metadata->>'wallet_purpose'='settlement_clearing'
  group by balance.balance;

  if legacy_lpg_value is null then
    legacy_lpg_value:=jsonb_build_object(
      'supplierPrincipalCredited',0,'recordedSupplierCashPaid',0,
      'reclassifiedAmount',0,'legacyClearingBalance',0,
      'reclassifiableAmount',0,'unreconciledDifference',0,
      'currencyCode',currency_value
    );
  end if;

  return jsonb_build_object(
    'currencyCode',currency_value,
    'accounts',accounts_value,
    'recentMovements',movements_value,
    'fuelPayables',fuel_payables_value,
    'lpgPayables',lpg_payables_value,
    'legacyLpg',legacy_lpg_value
  );
end;
$function$;

create or replace function public.record_platform_supplier_cash_withdrawal(
  target_module_key text,
  target_currency_code text,
  target_amount numeric,
  target_withdrawal_reference text,
  target_note text default null,
  target_evidence_media_asset_id uuid default null,
  target_idempotency_key text default null,
  target_withdrawn_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  currency_value text:=upper(coalesce(target_currency_code,'NGN'));
  fund_wallet_id uuid;
  cash_wallet_id uuid;
  available_balance numeric(28,8);
  transaction_id uuid;
  movement_id uuid;
  existing_movement public.platform_supplier_cash_movements%rowtype;
  occurred_at_value timestamptz:=coalesce(target_withdrawn_at,timezone('utc',now()));
  reference_value text:=nullif(btrim(coalesce(target_withdrawal_reference,'')),'');
begin
  if not (
    public.is_platform_super_admin()
    or public.has_permission('platform.financial.manage',null)
  ) then
    raise exception using errcode='42501',message='platform financial management permission is required to withdraw supplier cash';
  end if;
  if target_module_key not in ('lpg','fuel')
     or target_amount is null or target_amount<=0
     or reference_value is null
     or coalesce(btrim(target_idempotency_key),'')=''
     or occurred_at_value>timezone('utc',now())+interval '5 minutes' then
    raise exception using errcode='22023',message='A valid module, positive amount, cash withdrawal reference, time and idempotency key are required';
  end if;
  if not exists(select 1 from public.currency_definitions where code=currency_value and status='enabled') then
    raise exception using errcode='22023',message='cash withdrawal currency is not enabled';
  end if;

  select * into existing_movement
  from public.platform_supplier_cash_movements
  where module_key=target_module_key and idempotency_key=target_idempotency_key;
  if found then
    if existing_movement.movement_type<>'cash_withdrawal'
       or existing_movement.amount<>round(target_amount,2)
       or existing_movement.currency_code<>currency_value
       or existing_movement.payment_reference is distinct from reference_value
       or existing_movement.note is distinct from nullif(btrim(coalesce(target_note,'')),'')
       or existing_movement.occurred_at is distinct from occurred_at_value
       or existing_movement.evidence_media_asset_id is distinct from target_evidence_media_asset_id then
      raise exception using errcode='22023',message='supplier cash withdrawal idempotency key was reused with different details';
    end if;
    return jsonb_build_object('movementId',existing_movement.id,'status','posted','idempotentReplay',true);
  end if;

  if target_evidence_media_asset_id is not null and not exists(
    select 1 from public.media_assets media
    where media.id=target_evidence_media_asset_id
      and media.status='active'
      and media.owner_user_id=auth.uid()
      and media.source='skima.admin.financial.analytics'
      and media.asset_type_key in ('media.lpg.supplier_payment_evidence','media.fuel.supplier_payment_evidence')
  ) then
    raise exception using errcode='22023',message='cash withdrawal evidence must be an active supplier-funds file uploaded by this Finance administrator';
  end if;

  fund_wallet_id:=public.ensure_skima_supplier_wallet(target_module_key,currency_value,'supplier_fund');
  cash_wallet_id:=public.ensure_skima_supplier_wallet(target_module_key,currency_value,'cash_on_hand');

  select coalesce(balance.balance,0) into available_balance
  from public.wallet_accounts wallet
  left join public.wallet_balances balance
    on balance.wallet_id=wallet.id and balance.currency_code=wallet.currency_code
  where wallet.id=fund_wallet_id
    and wallet.currency_code=currency_value
    and wallet.status='active'
  for update of wallet;
  if not found or available_balance<round(target_amount,2) then
    raise exception using errcode='55000',message='Supplier Fund balance is insufficient for this cash withdrawal';
  end if;

  movement_id:=gen_random_uuid();
  transaction_id:=public.post_financial_transaction(
    'transfer',currency_value,'platform.supplier_cash.withdrawal',
    'platform_supplier_cash_movement',movement_id,
    jsonb_build_array(
      jsonb_build_object(
        'wallet_id',fund_wallet_id,'direction','debit','amount',round(target_amount,2),
        'entry_type','principal','metadata',jsonb_build_object(
          'role','supplier_fund_cash_withdrawal','module_key',target_module_key
        )
      ),
      jsonb_build_object(
        'wallet_id',cash_wallet_id,'direction','credit','amount',round(target_amount,2),
        'entry_type','principal','metadata',jsonb_build_object(
          'role','supplier_cash_on_hand_funding','module_key',target_module_key,
          'withdrawal_reference',reference_value
        )
      )
    ),
    target_idempotency_key,null,reference_value,'{}'::jsonb,
    jsonb_build_object(
      'module_key',target_module_key,'movement_type','cash_withdrawal',
      'withdrawal_reference',reference_value,'note',nullif(btrim(coalesce(target_note,'')),''),
      'withdrawn_at',occurred_at_value
    )
  );

  insert into public.platform_supplier_cash_movements(
    id,module_key,movement_type,currency_code,amount,source_wallet_id,destination_wallet_id,
    financial_transaction_id,payment_reference,evidence_media_asset_id,note,occurred_at,
    created_by,idempotency_key,metadata
  ) values (
    movement_id,target_module_key,'cash_withdrawal',currency_value,round(target_amount,2),
    fund_wallet_id,cash_wallet_id,transaction_id,reference_value,target_evidence_media_asset_id,
    nullif(btrim(coalesce(target_note,'')),''),occurred_at_value,auth.uid(),target_idempotency_key,
    jsonb_build_object('accounting_scope',target_module_key||'_supplier_cash_cycle')
  );
  return jsonb_build_object(
    'movementId',movement_id,'financialTransactionId',transaction_id,
    'moduleKey',target_module_key,'amount',round(target_amount,2),
    'currencyCode',currency_value,'supplierFundBalanceAfter',available_balance-round(target_amount,2),
    'cashOnHandIncrease',round(target_amount,2),
    'paymentReference',reference_value,'status','posted'
  );
end;
$function$;

create or replace function public.record_fuel_supplier_cash_payment(
  target_order_id uuid,
  target_amount numeric,
  target_payment_reference text,
  target_note text default null,
  target_evidence_media_asset_id uuid default null,
  target_idempotency_key text default null,
  target_paid_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  order_record public.order_records%rowtype;
  operation public.fuel_order_operations%rowtype;
  quote public.fuel_order_commercial_snapshots%rowtype;
  request_record public.service_requests%rowtype;
  hold public.escrow_holds%rowtype;
  branch public.organization_branches%rowtype;
  organization_record public.organizations%rowtype;
  cash_wallet_id uuid;
  disbursement_wallet_id uuid;
  available_balance numeric(28,8);
  supplier_amount numeric(28,8);
  already_paid numeric(28,8);
  remaining_amount numeric(28,8);
  transaction_id uuid;
  existing_movement public.platform_supplier_cash_movements%rowtype;
  occurred_at_value timestamptz:=coalesce(target_paid_at,timezone('utc',now()));
  reference_value text:=nullif(btrim(coalesce(target_payment_reference,'')),'');
  payment_id uuid;
begin
  if not (
    public.is_platform_super_admin()
    or public.has_permission('platform.financial.manage',null)
  ) then
    raise exception using errcode='42501',message='platform financial management permission is required to record Fuel supplier cash payments';
  end if;
  if target_order_id is null or target_amount is null or target_amount<=0
     or reference_value is null or coalesce(btrim(target_idempotency_key),'')=''
     or occurred_at_value>timezone('utc',now())+interval '5 minutes' then
    raise exception using errcode='22023',message='Fuel order, positive cash amount, voucher reference, payment time and idempotency key are required';
  end if;

  select * into existing_movement
  from public.platform_supplier_cash_movements
  where module_key='fuel' and idempotency_key=target_idempotency_key;
  if found then
    if existing_movement.fuel_order_id is distinct from target_order_id
       or existing_movement.amount<>round(target_amount,2)
       or existing_movement.payment_reference is distinct from reference_value
       or existing_movement.evidence_media_asset_id is distinct from target_evidence_media_asset_id
       or existing_movement.note is distinct from nullif(btrim(coalesce(target_note,'')),'')
       or existing_movement.occurred_at is distinct from occurred_at_value then
      raise exception using errcode='22023',message='Fuel cash payment idempotency key was reused with different details';
    end if;
    return jsonb_build_object(
      'movementId',existing_movement.id,
      'financialTransactionId',existing_movement.financial_transaction_id,
      'orderId',existing_movement.fuel_order_id,
      'amount',existing_movement.amount,
      'currencyCode',existing_movement.currency_code,
      'paymentReference',existing_movement.payment_reference,
      'status','posted','idempotentReplay',true
    );
  end if;

  select * into order_record
  from public.order_records
  where id=target_order_id
  for update;
  if not found or not exists(
    select 1 from public.business_modules module
    where module.id=order_record.module_id and module.key='fuel'
  ) then
    raise exception using errcode='P0002',message='Fuel order was not found';
  end if;

  select * into operation
  from public.fuel_order_operations
  where order_id=target_order_id
  for update;
  if not found or operation.fulfillment_mode<>'skima_managed'
     or operation.stage_key not in ('ready_for_driver','station_handover','out_for_delivery','delivered','completed') then
    raise exception using errcode='55000',message='Only a customer-funded SKIMA Managed Fuel order ready for station handover or later can be paid from the supplier cash float';
  end if;

  select * into request_record from public.service_requests where id=operation.service_request_id for share;
  if not found or request_record.escrow_hold_id is null then
    raise exception using errcode='55000',message='Fuel order does not have a linked customer-funded escrow hold';
  end if;
  select * into hold from public.escrow_holds
  where id=request_record.escrow_hold_id
    and subject_type='service_request' and subject_id=request_record.id
  for share;
  if not found or hold.status not in ('held','partially_released','released') then
    raise exception using errcode='55000',message='Fuel customer payment is not confirmed in escrow';
  end if;

  select * into quote
  from public.fuel_order_commercial_snapshots
  where order_id=target_order_id
    and service_request_id=operation.service_request_id
    and status in ('accepted','settled')
  for share;
  if not found or quote.currency_code<>order_record.currency_code then
    raise exception using errcode='55000',message='An accepted Fuel commercial quote in the order currency is required';
  end if;

  select * into branch from public.organization_branches where id=operation.station_branch_id for share;
  if not found or branch.organization_id is null then
    raise exception using errcode='55000',message='Fuel supplier station branch is unavailable';
  end if;
  select * into organization_record from public.organizations where id=branch.organization_id for share;
  if not found then raise exception using errcode='55000',message='Fuel supplier organization was not found'; end if;

  supplier_amount:=coalesce(
    nullif(quote.component_snapshot->>'station_supply_amount','')::numeric,
    quote.fuel_amount
  );
  select coalesce(sum(movement.amount),0) into already_paid
  from public.platform_supplier_cash_movements movement
  where movement.module_key='fuel'
    and movement.movement_type='station_cash_payment'
    and movement.fuel_order_id=target_order_id;
  remaining_amount:=round(supplier_amount-already_paid,2);
  if round(target_amount,2)>remaining_amount then
    raise exception using errcode='22023',message=format('Cash payment exceeds the remaining Fuel supplier amount of %s',remaining_amount);
  end if;

  if target_evidence_media_asset_id is not null and not exists(
    select 1 from public.media_assets media
    where media.id=target_evidence_media_asset_id
      and media.status='active'
      and media.source='skima.admin.financial.analytics'
      and media.owner_user_id=auth.uid()
      and media.asset_type_key='media.fuel.supplier_payment_evidence'
      and media.metadata->>'fuelOrderId'=target_order_id::text
      and media.metadata->>'moduleKey'='fuel'
  ) then
    raise exception using errcode='22023',message='Fuel supplier payment evidence must be an active file uploaded by this Finance administrator and linked to the selected Fuel order';
  end if;

  cash_wallet_id:=public.ensure_skima_supplier_wallet('fuel',order_record.currency_code,'cash_on_hand');
  disbursement_wallet_id:=public.ensure_skima_supplier_wallet('fuel',order_record.currency_code,'supplier_disbursements');
  select coalesce(balance.balance,0) into available_balance
  from public.wallet_accounts wallet
  left join public.wallet_balances balance
    on balance.wallet_id=wallet.id and balance.currency_code=wallet.currency_code
  where wallet.id=cash_wallet_id and wallet.currency_code=order_record.currency_code
    and wallet.status='active' for update of wallet;
  if not found or available_balance<round(target_amount,2) then
    raise exception using errcode='55000',message='Fuel cash on hand is insufficient. Withdraw from the Fuel Supplier Fund before paying the station.';
  end if;

  payment_id:=gen_random_uuid();
  transaction_id:=public.post_financial_transaction(
    'transfer',order_record.currency_code,'platform.fuel.supplier.cash.payment',
    'fuel_order',target_order_id,
    jsonb_build_array(
      jsonb_build_object(
        'wallet_id',cash_wallet_id,'direction','debit','amount',round(target_amount,2),
        'entry_type','principal','metadata',jsonb_build_object(
          'role','skima_fuel_cash_paid_to_station',
          'fuel_order_id',target_order_id,
          'station_branch_id',operation.station_branch_id
        )
      ),
      jsonb_build_object(
        'wallet_id',disbursement_wallet_id,'direction','credit','amount',round(target_amount,2),
        'entry_type','principal','metadata',jsonb_build_object(
          'role','skima_fuel_supplier_cash_disbursement',
          'fuel_order_id',target_order_id,
          'station_branch_id',operation.station_branch_id,
          'supplier_name',organization_record.display_name
        )
      )
    ),
    target_idempotency_key,null,reference_value,
    coalesce(order_record.financial_policy_snapshot,'{}'::jsonb),
    jsonb_build_object(
      'module_key','fuel','fulfillment_mode','skima_managed',
      'supplier_payment_method','cash',
      'supplier_amount',supplier_amount,
      'station_supply_amount_paid',round(target_amount,2),
      'payment_reference',reference_value,
      'evidence_media_asset_id',target_evidence_media_asset_id,
      'paid_at',occurred_at_value,
      'note',nullif(btrim(coalesce(target_note,'')),'')
    )
  );

  insert into public.platform_supplier_cash_movements(
    id,module_key,movement_type,currency_code,amount,source_wallet_id,destination_wallet_id,
    financial_transaction_id,fuel_order_id,station_branch_id,payment_reference,
    evidence_media_asset_id,note,occurred_at,created_by,idempotency_key,metadata
  ) values (
    payment_id,'fuel','station_cash_payment',order_record.currency_code,round(target_amount,2),
    cash_wallet_id,disbursement_wallet_id,transaction_id,target_order_id,
    operation.station_branch_id,reference_value,target_evidence_media_asset_id,
    nullif(btrim(coalesce(target_note,'')),''),occurred_at_value,auth.uid(),
    target_idempotency_key,
    jsonb_build_object(
      'supplierName',organization_record.display_name,
      'stationBranchName',branch.display_name,
      'productKey',operation.product_key,
      'requestedLitres',operation.requested_litres,
      'supplierAmount',supplier_amount
    )
  );

  return jsonb_build_object(
    'movementId',payment_id,'financialTransactionId',transaction_id,
    'orderId',target_order_id,'orderReference',order_record.public_reference,
    'amount',round(target_amount,2),'currencyCode',order_record.currency_code,
    'paymentReference',reference_value,'remainingSupplierBalance',round(remaining_amount-target_amount,2),
    'status','posted'
  );
end;
$function$;

-- Fuel SKIMA Managed station supply principal is a procurement liability held
-- in the dedicated Fuel Supplier Fund. Only Station Managed and Independent
-- Driver orders continue to credit the partner station wallet.
do $patch$
declare
  function_sql text;
  old_decl text;
  new_decl text;
  old_station_wallet text;
  new_station_wallet text;
  old_distribution text;
  new_distribution text;
  old_statement text;
  new_statement text;
  old_operation_update text;
  new_operation_update text;
begin
  select pg_get_functiondef(
    'public.settle_fuel_order(uuid,text,jsonb)'::regprocedure
  ) into function_sql;

  old_decl:=$old$  station_wallet_id uuid;
  driver_wallet_id uuid;$old$;
  new_decl:=$new$  station_wallet_id uuid;
  supplier_funds_wallet_id uuid;
  driver_wallet_id uuid;$new$;
  if position(old_decl in function_sql)=0 then raise exception 'Fuel settlement wallet declarations changed'; end if;
  function_sql:=replace(function_sql,old_decl,new_decl);

  old_station_wallet:=$old$  station_wallet_id := public.ensure_wallet_account(
    'partner','organization',branch_record.organization_id,order_record.currency_code,
    'fuel.settlement_engine',
    jsonb_build_object('wallet_purpose','fuel_station_settlement','station_branch_id',operation_record.station_branch_id,'fuel_order_id',target_order_id),
    target_idempotency_key||':station-wallet'
  );$old$;
  new_station_wallet:=$new$  if operation_record.fulfillment_mode='skima_managed' then
    supplier_funds_wallet_id:=public.ensure_skima_supplier_wallet(
      'fuel',order_record.currency_code,'supplier_fund'
    );
  else
    station_wallet_id := public.ensure_wallet_account(
      'partner','organization',branch_record.organization_id,order_record.currency_code,
      'fuel.settlement_engine',
      jsonb_build_object('wallet_purpose','fuel_station_settlement','station_branch_id',operation_record.station_branch_id,'fuel_order_id',target_order_id),
      target_idempotency_key||':station-wallet'
    );
  end if;$new$;
  if position(old_station_wallet in function_sql)=0 then raise exception 'Fuel station wallet creation block changed'; end if;
  function_sql:=replace(function_sql,old_station_wallet,new_station_wallet);

  old_distribution:=$old$  if station_payout_amount>0 then
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
  end if;$old$;
  new_distribution:=$new$  if station_payout_amount>0 then
    if operation_record.fulfillment_mode='skima_managed' then
      distribution := distribution||jsonb_build_array(jsonb_build_object(
        'wallet_id',supplier_funds_wallet_id,
        'amount',station_payout_amount,
        'entry_type','principal',
        'metadata',jsonb_build_object(
          'role','fuel_supplier_fund',
          'module_key','fuel',
          'fulfillment_mode','skima_managed',
          'fuel_order_id',target_order_id,
          'station_branch_id',operation_record.station_branch_id,
          'fuel_product_key',operation_record.product_key,
          'supplier_cash_payment_required',true
        )
      ));
    else
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
  end if;$new$;
  if position(old_distribution in function_sql)=0 then raise exception 'Fuel settlement station distribution block changed'; end if;
  function_sql:=replace(function_sql,old_distribution,new_distribution);

  old_statement:=$old$  insert into public.settlement_statements(
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
  end if;$old$;
  new_statement:=$new$  if operation_record.fulfillment_mode<>'skima_managed' then
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
  else
    v_settlement_statement_id:=null;
  end if;$new$;
  if position(old_statement in function_sql)=0 then raise exception 'Fuel settlement station statement block changed'; end if;
  function_sql:=replace(function_sql,old_statement,new_statement);

  old_operation_update:=$old$      'station_payout_amount',station_payout_amount,
      'driver_payout_amount',driver_payout_amount,$old$;
  new_operation_update:=$new$      'station_payout_amount',case when operation_record.fulfillment_mode='skima_managed' then 0 else station_payout_amount end,
      'supplier_fund_amount',case when operation_record.fulfillment_mode='skima_managed' then station_payout_amount else 0 end,
      'driver_payout_amount',driver_payout_amount,$new$;
  if position(old_operation_update in function_sql)>0 then
    function_sql:=replace(function_sql,old_operation_update,new_operation_update);
  end if;

  execute function_sql;
end;
$patch$;


-- Legacy LPG cost-recovery allocations were historically pooled in the shared
-- settlement-clearing account. Reclassify only the amount both attributable to
-- those allocations and still present in that account, and only after an
-- explicit Finance action with an auditable reference.
create or replace function public.record_platform_legacy_lpg_fund_reclassification(
  target_currency_code text,
  target_amount numeric,
  target_reference text,
  target_note text default null,
  target_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  currency_value text:=upper(coalesce(target_currency_code,'NGN'));
  reference_value text:=nullif(btrim(coalesce(target_reference,'')),'');
  legacy_wallet_id uuid;
  supplier_wallet_id uuid;
  movement_id uuid;
  transaction_id uuid;
  existing_movement public.platform_supplier_cash_movements%rowtype;
  legacy_balance numeric(28,8);
  supplier_principal_remaining numeric(28,8);
  supplier_fund_balance_after numeric(28,8);
  reclassifiable_amount numeric(28,8);
begin
  if not (
    public.is_platform_super_admin()
    or public.has_permission('platform.financial.manage',null)
  ) then
    raise exception using errcode='42501',message='platform financial management permission is required to reclassify legacy LPG supplier funds';
  end if;
  if target_amount is null or target_amount<=0
     or reference_value is null
     or coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='A positive reclassification amount, reconciliation reference and idempotency key are required';
  end if;
  if not exists(select 1 from public.currency_definitions where code=currency_value and status='enabled') then
    raise exception using errcode='22023',message='legacy LPG supplier-fund currency is not enabled';
  end if;

  select * into existing_movement
  from public.platform_supplier_cash_movements
  where module_key='lpg' and idempotency_key=target_idempotency_key;
  if found then
    if existing_movement.movement_type<>'fund_reclassification'
       or existing_movement.amount<>round(target_amount,2)
       or existing_movement.currency_code<>currency_value
       or existing_movement.payment_reference is distinct from reference_value
       or existing_movement.note is distinct from nullif(btrim(coalesce(target_note,'')),'') then
      raise exception using errcode='22023',message='legacy LPG fund reclassification idempotency key was reused with different details';
    end if;
    return jsonb_build_object(
      'movementId',existing_movement.id,
      'financialTransactionId',existing_movement.financial_transaction_id,
      'amount',existing_movement.amount,'currencyCode',existing_movement.currency_code,
      'paymentReference',existing_movement.payment_reference,
      'status','posted','idempotentReplay',true
    );
  end if;

  select wallet.id,coalesce(balance.balance,0)
  into legacy_wallet_id,legacy_balance
  from public.wallet_accounts wallet
  left join public.wallet_balances balance
    on balance.wallet_id=wallet.id and balance.currency_code=currency_value
  where wallet.wallet_type='platform_clearing'
    and wallet.owner_entity_type='platform'
    and wallet.owner_entity_id is null
    and wallet.currency_code=currency_value
    and wallet.status='active'
    and wallet.metadata->>'wallet_purpose'='settlement_clearing'
  for update of wallet;

  if legacy_wallet_id is null then
    raise exception using errcode='55000',message='No legacy LPG settlement-clearing account exists for this currency';
  end if;

  select coalesce(sum(
    case
      when ledger.direction='credit' and ledger.metadata->>'role'='internal_lpg_cost_recovery'
        then ledger.amount
      when ledger.direction='debit' and ledger.metadata->>'role' in (
        'skima_fleet_funds_disbursed_to_supplier','legacy_lpg_supplier_fund_reclassified'
      ) then -ledger.amount
      else 0
    end
  ),0)
  into supplier_principal_remaining
  from public.wallet_ledger_entries ledger
  where ledger.wallet_id=legacy_wallet_id;

  reclassifiable_amount:=least(
    greatest(supplier_principal_remaining,0),
    greatest(legacy_balance,0)
  );
  if round(target_amount,2)>round(reclassifiable_amount,2) then
    raise exception using errcode='55000',
      message=format(
        'Reclassification exceeds the reconciled amount available (%s %s). Verify legacy supplier allocations and shared clearing first.',
        currency_value,round(reclassifiable_amount,2)
      );
  end if;

  supplier_wallet_id:=public.ensure_skima_supplier_wallet(
    'lpg',currency_value,'supplier_fund'
  );
  movement_id:=gen_random_uuid();
  transaction_id:=public.post_financial_transaction(
    'transfer',currency_value,'platform.lpg.supplier_fund.reclassification',
    'platform_supplier_cash_movement',movement_id,
    jsonb_build_array(
      jsonb_build_object(
        'wallet_id',legacy_wallet_id,'direction','debit','amount',round(target_amount,2),
        'entry_type','principal',
        'metadata',jsonb_build_object(
          'role','legacy_lpg_supplier_fund_reclassified',
          'module_key','lpg',
          'supplier_fund_wallet_id',supplier_wallet_id
        )
      ),
      jsonb_build_object(
        'wallet_id',supplier_wallet_id,'direction','credit','amount',round(target_amount,2),
        'entry_type','principal',
        'metadata',jsonb_build_object(
          'role','legacy_lpg_supplier_fund_opening_balance',
          'module_key','lpg',
          'legacy_clearing_wallet_id',legacy_wallet_id
        )
      )
    ),
    target_idempotency_key,null,reference_value,'{}'::jsonb,
    jsonb_build_object(
      'module_key','lpg',
      'movement_type','fund_reclassification',
      'source_wallet_id',legacy_wallet_id,
      'destination_wallet_id',supplier_wallet_id,
      'legacy_supplier_principal_remaining_before',supplier_principal_remaining,
      'legacy_clearing_balance_before',legacy_balance,
      'reclassifiable_amount_before',reclassifiable_amount,
      'note',nullif(btrim(coalesce(target_note,'')),'')
    )
  );

  insert into public.platform_supplier_cash_movements(
    id,module_key,movement_type,currency_code,amount,source_wallet_id,destination_wallet_id,
    financial_transaction_id,payment_reference,note,created_by,idempotency_key,metadata
  ) values (
    movement_id,'lpg','fund_reclassification',currency_value,round(target_amount,2),
    legacy_wallet_id,supplier_wallet_id,transaction_id,reference_value,
    nullif(btrim(coalesce(target_note,'')),''),auth.uid(),target_idempotency_key,
    jsonb_build_object(
      'legacySupplierPrincipalRemainingBefore',supplier_principal_remaining,
      'legacyClearingBalanceBefore',legacy_balance,
      'reclassifiableAmountBefore',reclassifiable_amount
    )
  );

  select coalesce(balance.balance,0) into supplier_fund_balance_after
  from public.wallet_balances balance
  where balance.wallet_id=supplier_wallet_id;

  return jsonb_build_object(
    'movementId',movement_id,'financialTransactionId',transaction_id,
    'amount',round(target_amount,2),'currencyCode',currency_value,
    'paymentReference',reference_value,
    'supplierFundBalanceAfter',coalesce(supplier_fund_balance_after,0),
    'legacyClearingBalanceAfter',legacy_balance-round(target_amount,2),
    'status','posted'
  );
end;
$function$;

revoke all on function public.read_platform_supplier_funds_workspace(text) from public,anon;
grant execute on function public.read_platform_supplier_funds_workspace(text) to authenticated,service_role;
revoke all on function public.record_platform_supplier_cash_withdrawal(text,text,numeric,text,text,uuid,text,timestamptz) from public,anon;
grant execute on function public.record_platform_supplier_cash_withdrawal(text,text,numeric,text,text,uuid,text,timestamptz) to authenticated,service_role;
revoke all on function public.record_fuel_supplier_cash_payment(uuid,numeric,text,text,uuid,text,timestamptz) from public,anon;
grant execute on function public.record_fuel_supplier_cash_payment(uuid,numeric,text,text,uuid,text,timestamptz) to authenticated,service_role;

revoke all on function public.record_platform_legacy_lpg_fund_reclassification(text,numeric,text,text,text) from public,anon;
grant execute on function public.record_platform_legacy_lpg_fund_reclassification(text,numeric,text,text,text) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
