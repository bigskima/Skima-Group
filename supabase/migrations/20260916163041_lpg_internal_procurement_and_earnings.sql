begin;

alter table public.lpg_refill_orders
  add column if not exists internal_settlement_execution_id uuid references public.settlement_executions(id) on delete restrict;

create table if not exists public.lpg_internal_refill_procurements (
  id uuid primary key default gen_random_uuid(),
  lpg_order_id uuid not null unique references public.lpg_refill_orders(id) on delete restrict,
  driver_profile_id uuid not null references public.driver_profiles(id) on delete restrict,
  supplier_name text not null check (char_length(btrim(supplier_name)) between 2 and 200),
  supplier_address text,
  supplier_latitude numeric(10,7) check (supplier_latitude is null or supplier_latitude between -90 and 90),
  supplier_longitude numeric(10,7) check (supplier_longitude is null or supplier_longitude between -180 and 180),
  actual_kg numeric(12,3) not null check (actual_kg > 0),
  supplier_price_per_kg numeric(28,8) not null check (supplier_price_per_kg > 0),
  procurement_amount numeric(28,8) not null check (procurement_amount >= 0),
  reference_price_per_kg numeric(28,8) not null check (reference_price_per_kg > 0),
  approved_ceiling_per_kg numeric(28,8) not null check (approved_ceiling_per_kg > 0),
  variance_percent numeric(12,4) not null,
  payment_method text not null check (payment_method in ('skima_operational_fund','driver_personal_reimbursement','other')),
  reimbursement_status text not null default 'not_applicable'
    check (reimbursement_status in ('not_applicable','pending','approved','paid','rejected')),
  receipt_media_asset_id uuid references public.media_assets(id) on delete restrict,
  status text not null default 'approved' check (status in ('approved','review_required','void')),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  source text not null default 'lpg.internal_procurement',
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  unique(source,idempotency_key),
  check ((supplier_latitude is null) = (supplier_longitude is null))
);

create table if not exists public.lpg_internal_driver_earnings (
  id uuid primary key default gen_random_uuid(),
  lpg_order_id uuid not null unique references public.lpg_refill_orders(id) on delete restrict,
  driver_profile_id uuid not null references public.driver_profiles(id) on delete restrict,
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  calculation_kind text not null default 'percentage_of_delivery_fee',
  basis_amount numeric(28,8) not null check (basis_amount >= 0),
  rate_percent numeric(12,4) not null check (rate_percent >= 0 and rate_percent <= 100),
  earning_amount numeric(28,8) not null check (earning_amount >= 0),
  withdrawal_allowed boolean not null default false check (withdrawal_allowed=false),
  status text not null default 'accrued' check (status in ('accrued','approved','paid','void')),
  policy_snapshot jsonb not null check (jsonb_typeof(policy_snapshot)='object'),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  paid_by uuid references public.profiles(id) on delete set null,
  paid_at timestamptz,
  payment_reference text,
  source text not null default 'lpg.internal_driver_earning',
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  unique(source,idempotency_key)
);

create index if not exists lpg_internal_refill_procurements_driver_idx
  on public.lpg_internal_refill_procurements(driver_profile_id,created_at desc);
create index if not exists lpg_internal_driver_earnings_driver_idx
  on public.lpg_internal_driver_earnings(driver_profile_id,status,created_at desc);

alter table public.lpg_internal_refill_procurements enable row level security;
alter table public.lpg_internal_driver_earnings enable row level security;

revoke all on table public.lpg_internal_refill_procurements from public,anon,authenticated;
revoke all on table public.lpg_internal_driver_earnings from public,anon,authenticated;
grant all on table public.lpg_internal_refill_procurements to service_role;
grant all on table public.lpg_internal_driver_earnings to service_role;

drop trigger if exists set_lpg_internal_refill_procurements_updated_at on public.lpg_internal_refill_procurements;
create trigger set_lpg_internal_refill_procurements_updated_at
before update on public.lpg_internal_refill_procurements
for each row execute function public.set_updated_at();

drop trigger if exists set_lpg_internal_driver_earnings_updated_at on public.lpg_internal_driver_earnings;
create trigger set_lpg_internal_driver_earnings_updated_at
before update on public.lpg_internal_driver_earnings
for each row execute function public.set_updated_at();

drop trigger if exists audit_lpg_internal_refill_procurements on public.lpg_internal_refill_procurements;
create trigger audit_lpg_internal_refill_procurements
after insert or update or delete on public.lpg_internal_refill_procurements
for each row execute function public.record_table_audit();

drop trigger if exists audit_lpg_internal_driver_earnings on public.lpg_internal_driver_earnings;
create trigger audit_lpg_internal_driver_earnings
after insert or update or delete on public.lpg_internal_driver_earnings
for each row execute function public.record_table_audit();

create or replace function public.confirm_lpg_internal_refill(
  target_lpg_order_id uuid,
  target_actual_kg numeric,
  target_supplier_name text,
  target_supplier_price_per_kg numeric,
  target_payment_method text,
  target_idempotency_key text,
  target_supplier_address text default null,
  target_supplier_latitude numeric default null,
  target_supplier_longitude numeric default null,
  target_receipt_media_asset_id uuid default null,
  target_safety_observations jsonb default '{}'::jsonb,
  target_evidence_media_asset_ids uuid[] default array[]::uuid[],
  target_override_reason text default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'lpg.internal_procurement'
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  order_record public.lpg_refill_orders%rowtype;
  quote_record public.lpg_refill_quotes%rowtype;
  driver_record public.driver_profiles%rowtype;
  config jsonb;
  reference_policy jsonb;
  markup_policy jsonb;
  payout_policy jsonb;
  reference_price numeric;
  markup_per_kg numeric;
  max_variance_percent numeric;
  approved_ceiling numeric;
  supplier_variance numeric;
  procurement_amount numeric;
  actual_reference_amount numeric;
  actual_markup_amount numeric;
  quoted_reference_amount numeric;
  quoted_markup_amount numeric;
  inspection_id uuid;
  verification_event_id uuid;
  procurement_id uuid;
  earning_id uuid;
  payout_percentage numeric;
  internal_admin boolean;
  requires_receipt boolean;
  refill_policy jsonb;
  overfill_tolerance_kg numeric;
begin
  if target_actual_kg is null or target_actual_kg<=0 then
    raise exception using errcode='22023',message='actual kilograms must be greater than zero';
  end if;
  if char_length(btrim(coalesce(target_supplier_name,'')))<2 then
    raise exception using errcode='22023',message='supplier name is required';
  end if;
  if target_supplier_price_per_kg is null or target_supplier_price_per_kg<=0 then
    raise exception using errcode='22023',message='supplier price per kg must be greater than zero';
  end if;
  if target_payment_method not in ('skima_operational_fund','driver_personal_reimbursement','other') then
    raise exception using errcode='22023',message='unsupported internal procurement payment method';
  end if;
  if coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='idempotency key is required';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata)<>'object'
    or target_safety_observations is null or jsonb_typeof(target_safety_observations)<>'object' then
    raise exception using errcode='22023',message='metadata and safety observations must be JSON objects';
  end if;
  if (target_supplier_latitude is null)<>(target_supplier_longitude is null) then
    raise exception using errcode='22023',message='supplier latitude and longitude must be provided together';
  end if;

  select id into procurement_id
  from public.lpg_internal_refill_procurements
  where source=target_source and idempotency_key=target_idempotency_key;
  if procurement_id is not null then return procurement_id; end if;

  select * into order_record
  from public.lpg_refill_orders
  where id=target_lpg_order_id
  for update;
  if not found then raise exception using errcode='22023',message='LPG order was not found'; end if;
  if order_record.fulfillment_channel<>'skima_internal' then
    raise exception using errcode='22023',message='order is not a SKIMA internal fulfillment';
  end if;
  if order_record.driver_profile_id is null then
    raise exception using errcode='55000',message='SKIMA internal driver must be assigned before refill';
  end if;
  if order_record.status not in ('station_verified','refill_in_progress') then
    raise exception using errcode='55000',message='internal refill cannot be confirmed from the current order status';
  end if;

  select * into driver_record from public.driver_profiles where id=order_record.driver_profile_id;
  internal_admin:=auth.role()='service_role' or public.can_manage_lpg_operations();
  if not internal_admin and driver_record.user_id is distinct from auth.uid() then
    raise exception using errcode='42501',message='assigned SKIMA driver is required for internal refill confirmation';
  end if;

  if not exists (
    select 1
    from public.driver_program_memberships membership
    where membership.driver_profile_id=order_record.driver_profile_id
      and membership.program_key=coalesce(
        public.lpg_policy_config('lpg.fulfillment.launch_assurance')->>'internal_driver_program_key',
        'driver.skima_special'
      )
      and membership.status='active'
      and membership.starts_at<=timezone('utc',now())
      and membership.ends_at is null
  ) then
    raise exception using errcode='55000',message='assigned driver is not in the configured SKIMA internal driver program';
  end if;

  select * into quote_record
  from public.lpg_refill_quotes
  where id=order_record.lpg_refill_quote_id;
  if not found or quote_record.status<>'accepted' or quote_record.fulfillment_channel<>'skima_internal' then
    raise exception using errcode='55000',message='accepted SKIMA internal LPG quote is required';
  end if;

  refill_policy:=public.lpg_policy_config('lpg.refill.phase_one');
  overfill_tolerance_kg:=coalesce(nullif(refill_policy->>'overfill_tolerance_kg','')::numeric,0);
  if target_actual_kg>quote_record.quoted_kg+overfill_tolerance_kg then
    insert into public.lpg_order_financial_adjustments(
      lpg_order_id,adjustment_type,currency_code,amount,status,reason_key,metadata,source,idempotency_key
    ) values(
      order_record.id,'overfill_blocked',order_record.currency_code,
      round((target_actual_kg-quote_record.quoted_kg)*target_supplier_price_per_kg,2),
      'blocked','lpg.internal.overfill.manual_review',
      target_metadata || jsonb_build_object('quotedKg',quote_record.quoted_kg,'actualKg',target_actual_kg),
      target_source,target_idempotency_key||':overfill'
    ) on conflict(source,idempotency_key) do nothing;
    raise exception using errcode='P0001',message='LPG overfill is blocked for manual review';
  end if;

  reference_policy:=order_record.financial_policy_snapshot->'internalReference';
  markup_policy:=order_record.financial_policy_snapshot->'platformMarkup';
  payout_policy:=order_record.financial_policy_snapshot->'driverPayout';
  if reference_policy is null or markup_policy is null or payout_policy is null then
    raise exception using errcode='55000',message='locked internal pricing and driver policy snapshots are required';
  end if;

  reference_price:=nullif(reference_policy #>> '{configuration,amount_per_kg}','')::numeric;
  max_variance_percent:=coalesce(
    nullif(reference_policy #>> '{configuration,max_supplier_variance_percent}','')::numeric,0
  );
  markup_per_kg:=nullif(markup_policy #>> '{configuration,amount_per_kg}','')::numeric;
  payout_percentage:=nullif(payout_policy #>> '{configuration,percentage}','')::numeric;
  if reference_price is null or reference_price<=0
    or markup_per_kg is null or markup_per_kg<0
    or payout_percentage is null or payout_percentage<=0 or payout_percentage>100 then
    raise exception using errcode='55000',message='locked SKIMA internal financial policy snapshot is incomplete';
  end if;

  approved_ceiling:=round(reference_price*(1+max_variance_percent/100),2);
  supplier_variance:=round((target_supplier_price_per_kg-reference_price)/reference_price*100,4);
  if target_supplier_price_per_kg>approved_ceiling then
    if not internal_admin then
      raise exception using errcode='P0001',
        message='Supplier price is above the approved SKIMA procurement ceiling. Choose another supplier or request Operations approval.';
    end if;
    if char_length(btrim(coalesce(target_override_reason,'')))<3 then
      raise exception using errcode='22023',message='Operations override reason is required above the procurement ceiling';
    end if;
  end if;

  config:=public.lpg_policy_config('lpg.fulfillment.launch_assurance');
  requires_receipt:=coalesce((config->>'require_supplier_receipt')::boolean,true);
  if requires_receipt and target_receipt_media_asset_id is null then
    raise exception using errcode='22023',message='supplier receipt evidence is required for SKIMA internal refill';
  end if;
  if target_receipt_media_asset_id is not null and not exists(
    select 1 from public.media_assets media
    where media.id=target_receipt_media_asset_id and media.status='active'
  ) then
    raise exception using errcode='22023',message='receipt media must reference an active media asset';
  end if;
  if target_evidence_media_asset_ids is not null
    and array_length(target_evidence_media_asset_ids,1) is not null
    and exists(
      select 1
      from unnest(target_evidence_media_asset_ids) media_id
      left join public.media_assets media on media.id=media_id
      where media.id is null or media.status<>'active'
    ) then
    raise exception using errcode='22023',message='inspection evidence must reference active media assets';
  end if;

  if coalesce(target_safety_observations->>'result',target_safety_observations->>'safetyStatus')<>'safe' then
    raise exception using errcode='P0001',message='a safe cylinder inspection is required before internal refill confirmation';
  end if;

  if not exists(
    select 1 from public.lpg_cylinder_inspections inspection
    where inspection.lpg_order_id=order_record.id and inspection.result='safe'
  ) then
    verification_event_id:=public.record_verification_event(
      'verification.lpg.partner.fulfillment_scan',
      target_source,
      'asset',
      order_record.cylinder_id,
      'lpg.internal.inspection',
      jsonb_build_object('latitude',target_supplier_latitude,'longitude',target_supplier_longitude),
      'passed',
      target_safety_observations || jsonb_build_object(
        'lpg_order_id',order_record.id,
        'inspection_result','safe',
        'fulfillment_channel','skima_internal'
      ),
      target_idempotency_key||':inspection:verification',
      timezone('utc',now())
    );

    insert into public.lpg_cylinder_inspections(
      lpg_order_id,cylinder_id,station_branch_id,inspected_by_user_id,verification_event_id,
      result,evidence_media_asset_ids,observations,source,idempotency_key
    ) values(
      order_record.id,order_record.cylinder_id,null,auth.uid(),verification_event_id,
      'safe',coalesce(target_evidence_media_asset_ids,array[]::uuid[]),
      target_safety_observations || jsonb_build_object('recordedBy','skima_internal_driver'),
      target_source,target_idempotency_key||':inspection'
    )
    returning id into inspection_id;
  end if;

  procurement_amount:=round(target_actual_kg*target_supplier_price_per_kg,2);
  actual_reference_amount:=round(target_actual_kg*reference_price,2);
  actual_markup_amount:=round(target_actual_kg*markup_per_kg,2);
  quoted_reference_amount:=quote_record.lpg_amount;
  quoted_markup_amount:=quote_record.platform_fee_amount;

  if target_actual_kg>quote_record.quoted_kg
    or actual_reference_amount>quoted_reference_amount
    or actual_markup_amount>quoted_markup_amount then
    raise exception using errcode='P0001',message='internal refill quantity exceeds the accepted customer quote';
  end if;

  if target_actual_kg < quote_record.quoted_kg then
    insert into public.lpg_order_financial_adjustments(
      lpg_order_id,adjustment_type,currency_code,amount,status,reason_key,metadata,source,idempotency_key
    ) values(
      order_record.id,'underfill_refund',order_record.currency_code,
      greatest(quoted_reference_amount-actual_reference_amount,0)
        + greatest(quoted_markup_amount-actual_markup_amount,0),
      'blocked','lpg.internal.underfill.manual_review',
      target_metadata || jsonb_build_object(
        'quotedKg',quote_record.quoted_kg,
        'actualKg',target_actual_kg,
        'note','Internal launch fulfillment requires exact quoted kilograms until automated internal underfill settlement is enabled.'
      ),
      target_source,target_idempotency_key||':underfill-review'
    ) on conflict(source,idempotency_key) do nothing;
    raise exception using errcode='P0001',
      message='Internal refill is below the accepted quantity and requires Operations review before completion.';
  end if;

  insert into public.lpg_internal_refill_procurements(
    lpg_order_id,driver_profile_id,supplier_name,supplier_address,supplier_latitude,supplier_longitude,
    actual_kg,supplier_price_per_kg,procurement_amount,reference_price_per_kg,
    approved_ceiling_per_kg,variance_percent,payment_method,reimbursement_status,
    receipt_media_asset_id,status,approved_by,approved_at,source,idempotency_key,metadata
  ) values(
    order_record.id,order_record.driver_profile_id,btrim(target_supplier_name),nullif(btrim(coalesce(target_supplier_address,'')),''),
    target_supplier_latitude,target_supplier_longitude,target_actual_kg,target_supplier_price_per_kg,
    procurement_amount,reference_price,approved_ceiling,supplier_variance,target_payment_method,
    case when target_payment_method='driver_personal_reimbursement' then 'pending' else 'not_applicable' end,
    target_receipt_media_asset_id,'approved',
    case when internal_admin and target_supplier_price_per_kg>approved_ceiling then auth.uid() else null end,
    case when internal_admin and target_supplier_price_per_kg>approved_ceiling then timezone('utc',now()) else null end,
    target_source,target_idempotency_key,
    target_metadata || jsonb_build_object(
      'overrideReason',nullif(btrim(coalesce(target_override_reason,'')),''),
      'referencePolicyVersionId',reference_policy->>'policyVersionId',
      'fulfillmentChannel','skima_internal'
    )
  )
  returning id into procurement_id;

  insert into public.lpg_internal_driver_earnings(
    lpg_order_id,driver_profile_id,currency_code,calculation_kind,basis_amount,rate_percent,
    earning_amount,withdrawal_allowed,status,policy_snapshot,source,idempotency_key,metadata
  ) values(
    order_record.id,order_record.driver_profile_id,order_record.currency_code,
    'percentage_of_delivery_fee',order_record.delivery_fee_amount,payout_percentage,
    order_record.driver_commission_amount,false,'accrued',payout_policy,
    'lpg.internal_driver_earning',target_idempotency_key||':driver-earning',
    jsonb_build_object('procurementId',procurement_id,'fulfillmentChannel','skima_internal')
  )
  on conflict(lpg_order_id) do nothing
  returning id into earning_id;

  update public.lpg_refill_orders
  set actual_kg=target_actual_kg,
      station_amount=actual_reference_amount,
      status='refill_confirmed',
      metadata=metadata || jsonb_build_object(
        'internalProcurementId',procurement_id,
        'internalSupplierName',btrim(target_supplier_name),
        'internalSupplierPricePerKg',target_supplier_price_per_kg,
        'internalProcurementAmount',procurement_amount,
        'internalDriverEarningId',earning_id
      ),
      updated_at=timezone('utc',now())
  where id=order_record.id;

  update public.service_requests
  set status='in_progress',
      updated_at=timezone('utc',now())
  where id=order_record.service_request_id;

  perform public.record_lpg_order_event(
    order_record.id,'lpg.internal.refill.confirmed',order_record.status,'refill_confirmed',
    target_idempotency_key||':event',
    target_metadata || jsonb_build_object(
      'procurement_id',procurement_id,
      'supplier_name',btrim(target_supplier_name),
      'supplier_price_per_kg',target_supplier_price_per_kg,
      'actual_kg',target_actual_kg,
      'procurement_amount',procurement_amount,
      'driver_earning_id',earning_id
    )
  );

  perform public.record_lpg_cylinder_history(
    order_record.cylinder_id,'refilled',target_idempotency_key||':cylinder-history',
    order_record.id,null,order_record.driver_profile_id,target_actual_kg,
    target_safety_observations || jsonb_build_object(
      'supplierName',btrim(target_supplier_name),
      'supplierPricePerKg',target_supplier_price_per_kg,
      'internalProcurementId',procurement_id
    ),
    case when target_supplier_latitude is null then '{}'::jsonb
      else jsonb_build_object('latitude',target_supplier_latitude,'longitude',target_supplier_longitude)
    end
  );

  return procurement_id;
end
$$;

create or replace function public.read_my_lpg_internal_earnings(target_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  driver_id uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  select id into driver_id from public.driver_profiles where user_id=auth.uid() limit 1;
  if driver_id is null then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',earning.id,
      'lpgOrderId',earning.lpg_order_id,
      'driverProfileId',earning.driver_profile_id,
      'currencyCode',earning.currency_code,
      'basisAmount',earning.basis_amount,
      'ratePercent',earning.rate_percent,
      'earningAmount',earning.earning_amount,
      'withdrawalAllowed',earning.withdrawal_allowed,
      'status',earning.status,
      'createdAt',earning.created_at,
      'paidAt',earning.paid_at,
      'paymentReference',earning.payment_reference
    ) order by earning.created_at desc)
    from (
      select * from public.lpg_internal_driver_earnings
      where driver_profile_id=driver_id
      order by created_at desc
      limit least(greatest(coalesce(target_limit,100),1),200)
    ) earning
  ),'[]'::jsonb);
end
$$;

create or replace function public.read_lpg_internal_operations_financials(
  target_driver_profile_id uuid default null,
  target_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
begin
  if auth.role()<>'service_role'
    and not public.has_permission('platform.drivers.read',null)
    and not public.has_permission('platform.financial_policy.read',null)
    and not public.can_manage_lpg_operations() then
    raise exception using errcode='42501',message='internal LPG operations read permission is required';
  end if;

  return jsonb_build_object(
    'procurements',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',p.id,'lpgOrderId',p.lpg_order_id,'driverProfileId',p.driver_profile_id,
        'supplierName',p.supplier_name,'supplierAddress',p.supplier_address,
        'actualKg',p.actual_kg,'supplierPricePerKg',p.supplier_price_per_kg,
        'procurementAmount',p.procurement_amount,'referencePricePerKg',p.reference_price_per_kg,
        'approvedCeilingPerKg',p.approved_ceiling_per_kg,'variancePercent',p.variance_percent,
        'paymentMethod',p.payment_method,'reimbursementStatus',p.reimbursement_status,
        'status',p.status,'createdAt',p.created_at
      ) order by p.created_at desc)
      from (
        select * from public.lpg_internal_refill_procurements
        where target_driver_profile_id is null or driver_profile_id=target_driver_profile_id
        order by created_at desc
        limit least(greatest(coalesce(target_limit,100),1),200)
      ) p
    ),'[]'::jsonb),
    'earnings',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',e.id,'lpgOrderId',e.lpg_order_id,'driverProfileId',e.driver_profile_id,
        'currencyCode',e.currency_code,'basisAmount',e.basis_amount,'ratePercent',e.rate_percent,
        'earningAmount',e.earning_amount,'withdrawalAllowed',e.withdrawal_allowed,
        'status',e.status,'createdAt',e.created_at,'paidAt',e.paid_at,'paymentReference',e.payment_reference
      ) order by e.created_at desc)
      from (
        select * from public.lpg_internal_driver_earnings
        where target_driver_profile_id is null or driver_profile_id=target_driver_profile_id
        order by created_at desc
        limit least(greatest(coalesce(target_limit,100),1),200)
      ) e
    ),'[]'::jsonb)
  );
end
$$;

create or replace function public.set_lpg_internal_driver_earning_status(
  target_earning_id uuid,
  target_status text,
  target_payment_reference text,
  target_reason text,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  earning public.lpg_internal_driver_earnings%rowtype;
begin
  if auth.role()<>'service_role'
    and not public.has_permission('platform.drivers.manage',null)
    and not public.can_manage_lpg_operations() then
    raise exception using errcode='42501',message='internal driver earning management permission is required';
  end if;
  if target_status not in ('approved','paid','void') then
    raise exception using errcode='22023',message='earning status must be approved, paid, or void';
  end if;
  if char_length(btrim(coalesce(target_reason,'')))<3 or coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='reason and idempotency key are required';
  end if;
  if target_status='paid' and char_length(btrim(coalesce(target_payment_reference,'')))<2 then
    raise exception using errcode='22023',message='payment reference is required when marking an earning paid';
  end if;

  select * into earning from public.lpg_internal_driver_earnings where id=target_earning_id for update;
  if not found then raise exception using errcode='22023',message='internal driver earning was not found'; end if;
  if earning.metadata->>'lastStatusIdempotencyKey'=target_idempotency_key then
    return to_jsonb(earning);
  end if;
  if earning.status='paid' and target_status<>'paid' then
    raise exception using errcode='55000',message='paid internal driver earnings cannot be moved back to another state';
  end if;

  update public.lpg_internal_driver_earnings
  set status=target_status,
      approved_by=case when target_status in ('approved','paid') then coalesce(approved_by,auth.uid()) else approved_by end,
      approved_at=case when target_status in ('approved','paid') then coalesce(approved_at,timezone('utc',now())) else approved_at end,
      paid_by=case when target_status='paid' then auth.uid() else paid_by end,
      paid_at=case when target_status='paid' then timezone('utc',now()) else paid_at end,
      payment_reference=case when target_status='paid' then btrim(target_payment_reference) else payment_reference end,
      metadata=metadata || jsonb_build_object(
        'lastStatusReason',btrim(target_reason),
        'lastStatusIdempotencyKey',target_idempotency_key,
        'lastStatusChangedBy',auth.uid(),
        'lastStatusChangedAt',timezone('utc',now())
      ),
      updated_at=timezone('utc',now())
  where id=earning.id
  returning * into earning;

  return to_jsonb(earning);
end
$$;

revoke all on function public.confirm_lpg_internal_refill(uuid,numeric,text,numeric,text,text,text,numeric,numeric,uuid,jsonb,uuid[],text,jsonb,text) from public,anon;
revoke all on function public.read_my_lpg_internal_earnings(integer) from public,anon;
revoke all on function public.read_lpg_internal_operations_financials(uuid,integer) from public,anon;
revoke all on function public.set_lpg_internal_driver_earning_status(uuid,text,text,text,text) from public,anon;

grant execute on function public.confirm_lpg_internal_refill(uuid,numeric,text,numeric,text,text,text,numeric,numeric,uuid,jsonb,uuid[],text,jsonb,text) to authenticated,service_role;
grant execute on function public.read_my_lpg_internal_earnings(integer) to authenticated,service_role;
grant execute on function public.read_lpg_internal_operations_financials(uuid,integer) to authenticated,service_role;
grant execute on function public.set_lpg_internal_driver_earning_status(uuid,text,text,text,text) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
