begin;

-- Station Managed is a fulfillment mode, not a replacement for the commercial channel.
-- Existing marketplace orders remain independent-driver fulfillment; existing internal
-- orders remain SKIMA Fleet. This migration is additive and does not alter live data.
alter table public.lpg_refill_quotes
  add column if not exists fulfillment_mode text not null default 'independent_driver',
  add column if not exists delivery_pricing_mode text not null default 'separate',
  add column if not exists station_delivery_fee_amount numeric(28,8) not null default 0;

alter table public.lpg_refill_orders
  add column if not exists fulfillment_mode text not null default 'independent_driver',
  add column if not exists delivery_pricing_mode text not null default 'separate',
  add column if not exists station_delivery_fee_amount numeric(28,8) not null default 0;

update public.lpg_refill_quotes
set fulfillment_mode = case when fulfillment_channel = 'skima_internal' then 'skima_fleet' else 'independent_driver' end
where fulfillment_mode = 'independent_driver' and fulfillment_channel = 'skima_internal';

update public.lpg_refill_orders
set fulfillment_mode = case when fulfillment_channel = 'skima_internal' then 'skima_fleet' else 'independent_driver' end
where fulfillment_mode = 'independent_driver' and fulfillment_channel = 'skima_internal';

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.lpg_refill_quotes'::regclass and conname='lpg_refill_quotes_fulfillment_mode_check') then
    alter table public.lpg_refill_quotes add constraint lpg_refill_quotes_fulfillment_mode_check
      check (fulfillment_mode in ('station_managed','independent_driver','skima_fleet','partner_managed'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.lpg_refill_orders'::regclass and conname='lpg_refill_orders_fulfillment_mode_check') then
    alter table public.lpg_refill_orders add constraint lpg_refill_orders_fulfillment_mode_check
      check (fulfillment_mode in ('station_managed','independent_driver','skima_fleet','partner_managed'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.lpg_refill_quotes'::regclass and conname='lpg_refill_quotes_delivery_pricing_mode_check') then
    alter table public.lpg_refill_quotes add constraint lpg_refill_quotes_delivery_pricing_mode_check
      check (delivery_pricing_mode in ('separate','included','free'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.lpg_refill_orders'::regclass and conname='lpg_refill_orders_delivery_pricing_mode_check') then
    alter table public.lpg_refill_orders add constraint lpg_refill_orders_delivery_pricing_mode_check
      check (delivery_pricing_mode in ('separate','included','free'));
  end if;
end $$;

alter table public.lpg_refill_quotes
  add constraint lpg_refill_quotes_station_delivery_fee_amount_check check (station_delivery_fee_amount >= 0);
alter table public.lpg_refill_orders
  add constraint lpg_refill_orders_station_delivery_fee_amount_check check (station_delivery_fee_amount >= 0);

create index if not exists lpg_refill_orders_fulfillment_mode_status_idx
  on public.lpg_refill_orders (fulfillment_mode, status, updated_at desc);
create index if not exists lpg_refill_quotes_fulfillment_mode_created_idx
  on public.lpg_refill_quotes (fulfillment_mode, created_at desc);

create table if not exists public.lpg_station_fulfillment_settings (
  station_branch_id uuid primary key references public.lpg_station_branches(id) on delete cascade,
  station_managed_enabled boolean not null default false,
  delivery_pricing_mode text not null default 'separate'
    check (delivery_pricing_mode in ('separate','included','free')),
  delivery_fee_amount numeric(28,8) not null default 0 check (delivery_fee_amount >= 0),
  driver_compensation_mode text not null default 'in_app_plan'
    check (driver_compensation_mode in ('in_app_plan','offline')),
  driver_compensation_plan jsonb not null default '{}'::jsonb
    check (jsonb_typeof(driver_compensation_plan)='object'),
  currency_code text not null default 'NGN' references public.currency_definitions(code) on delete restrict,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object')
);

create table if not exists public.lpg_station_managed_drivers (
  id uuid primary key default gen_random_uuid(),
  station_branch_id uuid not null references public.lpg_station_branches(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 160),
  phone text,
  status text not null default 'active' check (status in ('active','paused','removed')),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  unique (station_branch_id,user_id),
  unique (id,station_branch_id)
);

create table if not exists public.lpg_station_managed_driver_assignments (
  id uuid primary key default gen_random_uuid(),
  lpg_order_id uuid not null unique references public.lpg_refill_orders(id) on delete restrict,
  station_branch_id uuid not null references public.lpg_station_branches(id) on delete restrict,
  station_driver_id uuid not null,
  status text not null default 'assigned'
    check (status in ('assigned','accepted','en_route','delivered','cancelled')),
  assigned_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  assigned_at timestamptz not null default timezone('utc',now()),
  completed_at timestamptz,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  foreign key (station_driver_id,station_branch_id)
    references public.lpg_station_managed_drivers(id,station_branch_id) on delete restrict,
  unique (station_branch_id,idempotency_key)
);

create table if not exists public.lpg_station_managed_driver_agreements (
  id uuid primary key default gen_random_uuid(),
  station_driver_id uuid not null references public.lpg_station_managed_drivers(id) on delete restrict,
  station_branch_id uuid not null references public.lpg_station_branches(id) on delete restrict,
  agreement_mode text not null check (agreement_mode in ('in_app_plan','offline')),
  agreement_status text not null default 'active' check (agreement_status in ('draft','active','superseded','ended')),
  terms jsonb not null default '{}'::jsonb check (jsonb_typeof(terms)='object'),
  notes text,
  effective_from timestamptz not null default timezone('utc',now()),
  effective_until timestamptz,
  recorded_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default timezone('utc',now()),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  check (effective_until is null or effective_until > effective_from)
);

create table if not exists public.lpg_station_managed_driver_payment_records (
  id uuid primary key default gen_random_uuid(),
  station_branch_id uuid not null references public.lpg_station_branches(id) on delete restrict,
  station_driver_id uuid not null references public.lpg_station_managed_drivers(id) on delete restrict,
  lpg_order_id uuid references public.lpg_refill_orders(id) on delete restrict,
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  amount numeric(28,8) not null check (amount >= 0),
  payment_method text not null check (payment_method in ('cash','bank_transfer','wallet_external','other')),
  payment_status text not null default 'confirmed' check (payment_status in ('recorded','confirmed','reversed')),
  external_reference text,
  confirmation_notes text,
  confirmed_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  confirmed_at timestamptz not null default timezone('utc',now()),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  unique (station_branch_id,idempotency_key)
);

create index if not exists lpg_station_managed_drivers_branch_status_idx
  on public.lpg_station_managed_drivers(station_branch_id,status,created_at desc);
create index if not exists lpg_station_managed_driver_assignments_driver_idx
  on public.lpg_station_managed_driver_assignments(station_driver_id,status,assigned_at desc);
create index if not exists lpg_station_managed_driver_agreements_driver_idx
  on public.lpg_station_managed_driver_agreements(station_driver_id,created_at desc);
create index if not exists lpg_station_managed_driver_payments_driver_idx
  on public.lpg_station_managed_driver_payment_records(station_driver_id,confirmed_at desc);

alter table public.lpg_station_fulfillment_settings enable row level security;
alter table public.lpg_station_managed_drivers enable row level security;
alter table public.lpg_station_managed_driver_assignments enable row level security;
alter table public.lpg_station_managed_driver_agreements enable row level security;
alter table public.lpg_station_managed_driver_payment_records enable row level security;

revoke all on public.lpg_station_fulfillment_settings, public.lpg_station_managed_drivers,
  public.lpg_station_managed_driver_assignments, public.lpg_station_managed_driver_agreements,
  public.lpg_station_managed_driver_payment_records from public, anon, authenticated;
grant all on public.lpg_station_fulfillment_settings, public.lpg_station_managed_drivers,
  public.lpg_station_managed_driver_assignments, public.lpg_station_managed_driver_agreements,
  public.lpg_station_managed_driver_payment_records to service_role;


create or replace function public.read_lpg_station_managed_fulfillment_option(
  target_station_branch_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $
declare settings public.lpg_station_fulfillment_settings%rowtype; station_record public.lpg_station_branches%rowtype;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  select * into station_record from public.lpg_station_branches
  where id=target_station_branch_id and approval_status='approved'
    and compliance_status='approved' and availability_status='available';
  if not found then return jsonb_build_object('enabled',false); end if;
  select * into settings from public.lpg_station_fulfillment_settings
  where station_branch_id=target_station_branch_id and station_managed_enabled;
  if not found then return jsonb_build_object('enabled',false); end if;
  return jsonb_build_object(
    'enabled',true,
    'deliveryPricingMode',settings.delivery_pricing_mode,
    'deliveryFeeAmount',case when settings.delivery_pricing_mode='separate' then settings.delivery_fee_amount else 0 end,
    'currencyCode',settings.currency_code
  );
end;
$;

create or replace function public.configure_lpg_station_managed_fulfillment(
  target_station_branch_id uuid,
  target_enabled boolean,
  target_delivery_pricing_mode text,
  target_delivery_fee_amount numeric,
  target_driver_compensation_mode text,
  target_driver_compensation_plan jsonb default '{}'::jsonb,
  target_currency_code text default 'NGN',
  target_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  if not public.can_operate_lpg_station_branch(target_station_branch_id,'lpg.stations.manage') then
    raise exception using errcode='42501',message='branch-scoped station management permission is required';
  end if;
  if target_delivery_pricing_mode not in ('separate','included','free')
    or target_driver_compensation_mode not in ('in_app_plan','offline')
    or target_delivery_fee_amount is null or target_delivery_fee_amount < 0
    or target_currency_code is null
    or target_driver_compensation_plan is null or jsonb_typeof(target_driver_compensation_plan)<>'object'
    or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='invalid station fulfillment settings';
  end if;
  if target_delivery_pricing_mode='free' and target_delivery_fee_amount<>0 then
    raise exception using errcode='22023',message='free delivery must have a zero customer delivery fee';
  end if;
  if target_driver_compensation_mode='offline' and target_driver_compensation_plan<>'{}'::jsonb then
    raise exception using errcode='22023',message='offline driver compensation must be recorded as an offline agreement, not an in-app payout plan';
  end if;
  perform 1 from public.currency_definitions where code=target_currency_code and status='active';
  if not found then raise exception using errcode='22023',message='active currency is required'; end if;
  insert into public.lpg_station_fulfillment_settings(
    station_branch_id,station_managed_enabled,delivery_pricing_mode,delivery_fee_amount,
    driver_compensation_mode,driver_compensation_plan,currency_code,updated_by,updated_at,metadata
  ) values (
    target_station_branch_id,target_enabled,target_delivery_pricing_mode,target_delivery_fee_amount,
    target_driver_compensation_mode,target_driver_compensation_plan,target_currency_code,auth.uid(),
    timezone('utc',now()),target_metadata
  )
  on conflict(station_branch_id) do update set
    station_managed_enabled=excluded.station_managed_enabled,
    delivery_pricing_mode=excluded.delivery_pricing_mode,
    delivery_fee_amount=excluded.delivery_fee_amount,
    driver_compensation_mode=excluded.driver_compensation_mode,
    driver_compensation_plan=excluded.driver_compensation_plan,
    currency_code=excluded.currency_code,
    updated_by=excluded.updated_by,
    updated_at=excluded.updated_at,
    metadata=excluded.metadata;
end;
$$;

create or replace function public.register_lpg_station_managed_driver(
  target_station_branch_id uuid,
  target_user_id uuid,
  target_display_name text,
  target_phone text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare result_id uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  if not public.can_operate_lpg_station_branch(target_station_branch_id,'lpg.stations.manage') then
    raise exception using errcode='42501',message='branch-scoped station management permission is required';
  end if;
  if target_user_id is null or target_display_name is null or char_length(btrim(target_display_name)) not between 2 and 160
    or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='valid station driver identity is required';
  end if;
  if not exists(select 1 from public.profiles where id=target_user_id) then
    raise exception using errcode='22023',message='station driver must have a SKIMA account';
  end if;
  if exists(select 1 from public.driver_profiles where user_id=target_user_id) then
    raise exception using errcode='22023',message='a SKIMA Managed or independent driver profile cannot also be registered as a Station Managed driver';
  end if;
  insert into public.lpg_station_managed_drivers(station_branch_id,user_id,display_name,phone,created_by,metadata)
  values(target_station_branch_id,target_user_id,btrim(target_display_name),nullif(btrim(target_phone),''),auth.uid(),target_metadata)
  on conflict(station_branch_id,user_id) do update set
    display_name=excluded.display_name,phone=excluded.phone,status='active',updated_at=timezone('utc',now()),metadata=excluded.metadata
  returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.assign_lpg_station_managed_driver(
  target_lpg_order_id uuid,
  target_station_driver_id uuid,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  order_record public.lpg_refill_orders%rowtype;
  driver_record public.lpg_station_managed_drivers%rowtype;
  result_id uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  if target_idempotency_key is null or btrim(target_idempotency_key)='' or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='idempotency key and valid metadata are required';
  end if;
  select * into order_record from public.lpg_refill_orders where id=target_lpg_order_id for update;
  if not found then raise exception using errcode='22023',message='LPG order was not found'; end if;
  if order_record.station_branch_id is null or not public.can_operate_lpg_station_branch(order_record.station_branch_id,'lpg.stations.manage') then
    raise exception using errcode='42501',message='branch-scoped station management permission is required';
  end if;
  if order_record.status not in ('payment_reserved','matching_station','matching_driver','driver_offered','driver_accepted','pickup_verified','station_en_route') then
    raise exception using errcode='55000',message='order is not in a state that allows station driver assignment';
  end if;
  if order_record.fulfillment_channel<>'marketplace' or order_record.fulfillment_mode<>'station_managed' then
    raise exception using errcode='55000',message='order must already be quoted and paid as Station Managed marketplace fulfillment';
  end if;
  select * into driver_record from public.lpg_station_managed_drivers
  where id=target_station_driver_id and station_branch_id=order_record.station_branch_id and status='active';
  if not found then raise exception using errcode='22023',message='active driver for this station branch is required'; end if;
  if not exists(select 1 from public.lpg_station_fulfillment_settings where station_branch_id=order_record.station_branch_id and station_managed_enabled) then
    raise exception using errcode='55000',message='Station Managed must be enabled for this branch';
  end if;
  if exists(select 1 from public.lpg_station_managed_driver_assignments where lpg_order_id=order_record.id and status<>'cancelled') then
    raise exception using errcode='23505',message='order already has an active Station Managed driver assignment';
  end if;
  update public.lpg_refill_orders
  set fulfillment_mode='station_managed',driver_profile_id=null,vehicle_id=null,
      assignment_status='station_assigned',updated_at=timezone('utc',now()),
      metadata=metadata || jsonb_build_object('stationManagedDriverId',driver_record.id,'stationManagedDriverUserId',driver_record.user_id)
  where id=order_record.id;
  insert into public.lpg_station_managed_driver_assignments(
    lpg_order_id,station_branch_id,station_driver_id,assigned_by,idempotency_key,metadata
  ) values (
    order_record.id,order_record.station_branch_id,driver_record.id,auth.uid(),target_idempotency_key,target_metadata
  ) returning id into result_id;
  perform public.record_lpg_order_event(
    order_record.id,'lpg.station_managed.driver_assigned',order_record.status,order_record.status,
    target_idempotency_key||':event',
    target_metadata||jsonb_build_object('station_driver_id',driver_record.id,'station_driver_user_id',driver_record.user_id)
  );
  return result_id;
end;
$$;

create or replace function public.record_lpg_station_managed_driver_agreement(
  target_station_driver_id uuid,
  target_agreement_mode text,
  target_agreement_status text,
  target_terms jsonb default '{}'::jsonb,
  target_notes text default null,
  target_effective_from timestamptz default timezone('utc',now()),
  target_effective_until timestamptz default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare driver_record public.lpg_station_managed_drivers%rowtype; result_id uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  select * into driver_record from public.lpg_station_managed_drivers where id=target_station_driver_id;
  if not found or not public.can_operate_lpg_station_branch(driver_record.station_branch_id,'lpg.stations.manage') then
    raise exception using errcode='42501',message='branch-scoped station management permission is required';
  end if;
  if target_agreement_mode not in ('in_app_plan','offline')
    or target_agreement_status not in ('draft','active','superseded','ended')
    or target_terms is null or jsonb_typeof(target_terms)<>'object'
    or target_metadata is null or jsonb_typeof(target_metadata)<>'object'
    or (target_effective_until is not null and target_effective_until<=target_effective_from) then
    raise exception using errcode='22023',message='invalid station driver agreement';
  end if;
  if target_agreement_mode='offline' and target_terms ? 'payout_execution_id' then
    raise exception using errcode='22023',message='offline agreements cannot reference SKIMA payout execution';
  end if;
  if target_agreement_status='active' then
    update public.lpg_station_managed_driver_agreements set agreement_status='superseded'
    where station_driver_id=target_station_driver_id and agreement_status='active';
  end if;
  insert into public.lpg_station_managed_driver_agreements(
    station_driver_id,station_branch_id,agreement_mode,agreement_status,terms,notes,
    effective_from,effective_until,recorded_by,metadata
  ) values (
    target_station_driver_id,driver_record.station_branch_id,target_agreement_mode,target_agreement_status,
    target_terms,nullif(btrim(target_notes),''),target_effective_from,target_effective_until,auth.uid(),target_metadata
  ) returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.record_lpg_station_managed_driver_payment(
  target_station_driver_id uuid,
  target_lpg_order_id uuid,
  target_currency_code text,
  target_amount numeric,
  target_payment_method text,
  target_payment_status text,
  target_idempotency_key text,
  target_external_reference text default null,
  target_confirmation_notes text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare driver_record public.lpg_station_managed_drivers%rowtype; result_id uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  select * into driver_record from public.lpg_station_managed_drivers where id=target_station_driver_id;
  if not found or not public.can_operate_lpg_station_branch(driver_record.station_branch_id,'lpg.stations.manage') then
    raise exception using errcode='42501',message='branch-scoped station management permission is required';
  end if;
  if target_amount is null or target_amount<0 or target_payment_method not in ('cash','bank_transfer','wallet_external','other')
    or target_payment_status not in ('recorded','confirmed','reversed')
    or target_idempotency_key is null or btrim(target_idempotency_key)=''
    or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='invalid station driver payment record';
  end if;
  if target_lpg_order_id is not null and not exists(
    select 1 from public.lpg_refill_orders o
    where o.id=target_lpg_order_id and o.station_branch_id=driver_record.station_branch_id
      and o.fulfillment_mode='station_managed'
  ) then
    raise exception using errcode='22023',message='payment order must be a Station Managed order for this branch';
  end if;
  insert into public.lpg_station_managed_driver_payment_records(
    station_branch_id,station_driver_id,lpg_order_id,currency_code,amount,payment_method,payment_status,
    external_reference,confirmation_notes,confirmed_by,idempotency_key,metadata
  ) values (
    driver_record.station_branch_id,target_station_driver_id,target_lpg_order_id,target_currency_code,target_amount,
    target_payment_method,target_payment_status,nullif(btrim(target_external_reference),''),
    nullif(btrim(target_confirmation_notes),''),auth.uid(),target_idempotency_key,target_metadata
  ) on conflict(station_branch_id,idempotency_key) do update set
    payment_status=excluded.payment_status,
    external_reference=excluded.external_reference,
    confirmation_notes=excluded.confirmation_notes,
    metadata=excluded.metadata
  returning id into result_id;
  return result_id;
end;
$$;

-- Apply branch pricing only when the quote explicitly requests Station Managed.
-- The quote remains the source of truth for customer total; the station delivery
-- charge is snapshotted separately and is never treated as a SKIMA driver commission.
create or replace function public.apply_lpg_station_managed_quote_policy()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $
declare settings public.lpg_station_fulfillment_settings%rowtype; requested_mode text; base_lpg_amount numeric(28,8);
begin
  if coalesce(new.metadata->>'station_fulfillment_pricing_locked','false')='true' then return new; end if;
  requested_mode:=coalesce(nullif(new.metadata->>'fulfillment_mode',''),new.fulfillment_mode,'independent_driver');
  if requested_mode not in ('station_managed','independent_driver','skima_fleet','partner_managed') then
    raise exception using errcode='22023',message='unsupported LPG fulfillment mode';
  end if;
  new.fulfillment_mode:=requested_mode;
  if requested_mode<>'station_managed' then
    new.delivery_pricing_mode:=coalesce(new.delivery_pricing_mode,'separate');
    new.station_delivery_fee_amount:=0;
    return new;
  end if;
  if new.fulfillment_channel<>'marketplace' or new.station_branch_id is null then
    raise exception using errcode='22023',message='Station Managed requires a marketplace station quote';
  end if;
  select * into settings from public.lpg_station_fulfillment_settings
  where station_branch_id=new.station_branch_id and station_managed_enabled;
  if not found then raise exception using errcode='55000',message='Station Managed is not enabled for this station'; end if;
  if settings.currency_code<>new.currency_code then
    raise exception using errcode='22023',message='station delivery pricing currency must match the quote currency';
  end if;
  new.delivery_pricing_mode:=settings.delivery_pricing_mode;
  new.station_delivery_fee_amount:=case when settings.delivery_pricing_mode='free' then 0 else settings.delivery_fee_amount end;
  new.driver_commission_amount:=0;
  base_lpg_amount:=coalesce(
    nullif(new.metadata->'commercial_policy_snapshot'->>'stationLpgAmount','')::numeric,
    nullif(new.breakdown->>'stationLpgAmount','')::numeric,
    new.lpg_amount
  );
  if settings.delivery_pricing_mode='separate' then
    new.lpg_amount:=base_lpg_amount;
    new.delivery_fee_amount:=settings.delivery_fee_amount;
  elsif settings.delivery_pricing_mode='included' then
    new.lpg_amount:=base_lpg_amount+settings.delivery_fee_amount;
    new.delivery_fee_amount:=0;
  else
    new.lpg_amount:=base_lpg_amount;
    new.delivery_fee_amount:=0;
  end if;
  new.total_amount:=new.lpg_amount+new.delivery_fee_amount+new.platform_fee_amount+new.tax_amount;
  new.breakdown:=coalesce(new.breakdown,'{}'::jsonb)||jsonb_build_object(
    'fulfillmentMode','station_managed',
    'deliveryPricingMode',settings.delivery_pricing_mode,
    'stationDeliveryFeeAmount',new.station_delivery_fee_amount,
    'stationDriverCompensationMode',settings.driver_compensation_mode,
    'stationDriverCompensationPlan',case when settings.driver_compensation_mode='in_app_plan' then settings.driver_compensation_plan else '{}'::jsonb end
  );
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
    'fulfillment_mode','station_managed',
    'delivery_pricing_mode',settings.delivery_pricing_mode,
    'station_delivery_fee_amount',new.station_delivery_fee_amount,
    'station_fulfillment_pricing_locked',true
  );
  return new;
end;
$$;

drop trigger if exists trg_lpg_station_managed_quote_policy on public.lpg_refill_quotes;
create trigger trg_lpg_station_managed_quote_policy
before update on public.lpg_refill_quotes
for each row execute function public.apply_lpg_station_managed_quote_policy();

create or replace function public.copy_lpg_station_fulfillment_snapshot_to_order()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare quote_record public.lpg_refill_quotes%rowtype;
begin
  if new.lpg_refill_quote_id is null then return new; end if;
  select * into quote_record from public.lpg_refill_quotes where id=new.lpg_refill_quote_id;
  if not found then raise exception using errcode='22023',message='accepted LPG quote is required'; end if;
  new.fulfillment_mode:=quote_record.fulfillment_mode;
  new.delivery_pricing_mode:=quote_record.delivery_pricing_mode;
  new.station_delivery_fee_amount:=quote_record.station_delivery_fee_amount;
  if quote_record.fulfillment_mode='station_managed' then
    new.driver_profile_id:=null;
    new.vehicle_id:=null;
    new.driver_commission_amount:=0;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_lpg_station_fulfillment_order_snapshot on public.lpg_refill_orders;
create trigger trg_lpg_station_fulfillment_order_snapshot
before insert on public.lpg_refill_orders
for each row execute function public.copy_lpg_station_fulfillment_snapshot_to_order();


-- The commercial snapshot writer updates the quote after its initial insert. Make
-- its generic price quote projection follow the final, trigger-validated quote
-- amounts (especially the Station Managed delivery pricing mode).
do $
declare function_sql text; old_block text; new_block text;
begin
  function_sql:=pg_get_functiondef('public.create_lpg_refill_quote_from_commercial_snapshot(uuid,numeric,uuid,uuid,uuid,jsonb,text,timestamp with time zone,text,jsonb,text)'::regprocedure);
  old_block:='  update public.price_quotes'||E'\n'||
    '  set subtotal_amount = (commercial_snapshot ->> ''stationLpgAmount'')::numeric'||E'\n'||
    '        + (commercial_snapshot ->> ''customerDeliveryFee'')::numeric,'||E'\n'||
    '      fee_amount = (commercial_snapshot ->> ''platformLpgMarkup'')::numeric,'||E'\n'||
    '      tax_amount = 0,'||E'\n'||
    '      total_amount = (commercial_snapshot ->> ''stationLpgAmount'')::numeric'||E'\n'||
    '        + (commercial_snapshot ->> ''platformLpgMarkup'')::numeric'||E'\n'||
    '        + (commercial_snapshot ->> ''customerDeliveryFee'')::numeric,'||E'\n'||
    '      pricing_context = commercial_snapshot,'||E'\n'||
    '      calculation_breakdown = commercial_snapshot,'||E'\n'||
    '      updated_at = timezone(''utc'', now())'||E'\n'||
    '  where id = generic_quote_id and status = ''calculated'';';
  new_block:='  update public.price_quotes'||E'\n'||
    '  set subtotal_amount = (select lpg_amount + delivery_fee_amount from public.lpg_refill_quotes where id=quote_id),'||E'\n'||
    '      fee_amount = (select platform_fee_amount from public.lpg_refill_quotes where id=quote_id),'||E'\n'||
    '      tax_amount = (select tax_amount from public.lpg_refill_quotes where id=quote_id),'||E'\n'||
    '      total_amount = (select total_amount from public.lpg_refill_quotes where id=quote_id),'||E'\n'||
    '      pricing_context = (select breakdown from public.lpg_refill_quotes where id=quote_id),'||E'\n'||
    '      calculation_breakdown = (select breakdown from public.lpg_refill_quotes where id=quote_id),'||E'\n'||
    '      updated_at = timezone(''utc'', now())'||E'\n'||
    '  where id = generic_quote_id and status = ''calculated'';';
  if position(old_block in function_sql)=0 then raise exception 'Station Managed pricing patch could not locate generic quote projection'; end if;
  execute replace(function_sql,old_block,new_block);
end
$;

-- Settlement keeps the existing station-principal and platform accounting. In
-- Station Managed separate-fee mode, delivery revenue belongs to the station;
-- no SKIMA driver commission or SKIMA driver payout is created.
do $$
declare
  function_sql text;
  old_block text;
  new_block text;
begin
  function_sql:=pg_get_functiondef('public.settle_lpg_station_order(uuid,text,uuid,uuid,uuid,jsonb,text)'::regprocedure);
  old_block:='  delivery_margin_amount := quote_record.delivery_fee_amount - quote_record.driver_commission_amount;';
  new_block:='  delivery_margin_amount := quote_record.delivery_fee_amount - quote_record.driver_commission_amount;'||E'\n'||
    '  if order_record.fulfillment_mode = ''station_managed'' then delivery_margin_amount := 0; end if;';
  if position(old_block in function_sql)=0 then raise exception 'Station Managed settlement patch could not locate delivery margin calculation'; end if;
  function_sql:=replace(function_sql,old_block,new_block);

  old_block:='  if actual_station_amount > 0 then'||E'\n'||
    '    distribution := distribution || jsonb_build_array(jsonb_build_object('||E'\n'||
    '      ''wallet_id'', station_wallet_id,'||E'\n'||
    '      ''amount'', actual_station_amount,'||E'\n'||
    '      ''entry_type'', ''principal'','||E'\n'||
    '      ''metadata'', jsonb_build_object(''role'', ''station_lpg_principal'')'||E'\n'||
    '    ));'||E'\n'||
    '  end if;';
  new_block:='  if actual_station_amount > 0 then'||E'\n'||
    '    distribution := distribution || jsonb_build_array(jsonb_build_object('||E'\n'||
    '      ''wallet_id'', station_wallet_id,'||E'\n'||
    '      ''amount'', actual_station_amount + case when order_record.fulfillment_mode = ''station_managed'' and quote_record.delivery_pricing_mode = ''separate'' then quote_record.delivery_fee_amount else 0 end,'||E'\n'||
    '      ''entry_type'', ''principal'','||E'\n'||
    '      ''metadata'', jsonb_build_object(''role'', ''station_lpg_principal'', ''station_delivery_fee_amount'', case when order_record.fulfillment_mode = ''station_managed'' and quote_record.delivery_pricing_mode = ''separate'' then quote_record.delivery_fee_amount else 0 end)'||E'\n'||
    '    ));'||E'\n'||
    '  end if;';
  if position(old_block in function_sql)=0 then raise exception 'Station Managed settlement patch could not locate station distribution block'; end if;
  function_sql:=replace(function_sql,old_block,new_block);

  old_block:='    actual_station_amount, 0, actual_station_amount, ''posted'',';
  new_block:='    actual_station_amount + case when order_record.fulfillment_mode = ''station_managed'' and quote_record.delivery_pricing_mode = ''separate'' then quote_record.delivery_fee_amount else 0 end, 0, actual_station_amount + case when order_record.fulfillment_mode = ''station_managed'' and quote_record.delivery_pricing_mode = ''separate'' then quote_record.delivery_fee_amount else 0 end, ''posted'',';
  if position(old_block in function_sql)=0 then raise exception 'Station Managed settlement patch could not locate settlement statement amounts'; end if;
  function_sql:=replace(function_sql,old_block,new_block);

  old_block:='  execute function_sql;';
  new_block:='  execute function_sql;';
  -- Keep the live function signature, grants and all unrelated protections unchanged.
  execute function_sql;
end
$$;

-- The existing generic driver commission executor must never issue a SKIMA payout
-- for a station-managed order, even if called manually or by a stale client.
do $$
declare function_sql text; old_block text; new_block text;
begin
  function_sql:=pg_get_functiondef('public.execute_lpg_driver_commission(uuid,text,uuid,uuid,jsonb,text)'::regprocedure);
  old_block:='  if order_record.status <> ''delivered'' then'||E'\n'||
    '    raise exception ''driver payout requires verified LPG delivery'';'||E'\n'||
    '  end if;';
  new_block:='  if order_record.fulfillment_mode = ''station_managed'' then'||E'\n'||
    '    raise exception using errcode=''42501'',message=''Station Managed drivers are paid by the station, never by SKIMA'';'||E'\n'||
    '  end if;'||E'\n'||old_block;
  if position(old_block in function_sql)=0 then raise exception 'Station Managed payout guard could not locate delivery guard'; end if;
  execute replace(function_sql,old_block,new_block);
end
$$;

grant execute on function public.read_lpg_station_managed_fulfillment_option(uuid) to authenticated,service_role;
grant execute on function public.configure_lpg_station_managed_fulfillment(uuid,boolean,text,numeric,text,jsonb,text,jsonb) to authenticated,service_role;
grant execute on function public.register_lpg_station_managed_driver(uuid,uuid,text,text,jsonb) to authenticated,service_role;
grant execute on function public.assign_lpg_station_managed_driver(uuid,uuid,text,jsonb) to authenticated,service_role;
grant execute on function public.record_lpg_station_managed_driver_agreement(uuid,text,text,jsonb,text,timestamptz,timestamptz,jsonb) to authenticated,service_role;
grant execute on function public.record_lpg_station_managed_driver_payment(uuid,uuid,text,numeric,text,text,text,text,text,jsonb) to authenticated,service_role;

comment on table public.lpg_station_managed_drivers is
  'Station-owned driver identities. These are not SKIMA Managed Drivers or independent driver_profiles.';
comment on table public.lpg_station_managed_driver_agreements is
  'Station-held in-app or offline compensation agreements. SKIMA does not execute station driver payouts.';
comment on table public.lpg_station_managed_driver_payment_records is
  'Station-entered payment records and confirmations only; not a SKIMA wallet, commission, or payout ledger.';
comment on column public.lpg_refill_orders.fulfillment_mode is
  'Operational fulfillment mode, distinct from fulfillment_channel (marketplace vs skima_internal).';

commit;
