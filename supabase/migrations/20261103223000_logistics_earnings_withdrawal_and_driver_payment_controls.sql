begin;

-- Separate provider earnings from the existing company partner wallet.
-- The partner wallet remains dedicated to offline receival-fee operations and
-- owner top-ups. Only online customer-confirmed Logistics settlements reach
-- logistics_earnings, which is the sole company wallet eligible for withdrawal.

alter table public.wallet_accounts
  drop constraint if exists wallet_accounts_wallet_type_check;
alter table public.wallet_accounts
  add constraint wallet_accounts_wallet_type_check
  check (wallet_type in (
    'customer','driver','partner','platform',
    'platform_clearing','platform_revenue','platform_liability',
    'platform_provider','platform_campaign',
    'escrow','commission','refund','bonus','loyalty','generic',
    'logistics_earnings'
  ));

create or replace function public.can_access_wallet_account(target_wallet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.role() = 'service_role'
    or exists (
      select 1
      from public.wallet_accounts wallet
      where wallet.id = target_wallet_id
        and (
          (
            wallet.wallet_type = 'platform_revenue'
            and wallet.owner_entity_type = 'platform'
            and (
              public.is_platform_super_admin()
              or public.has_permission('platform.revenue.read', null)
              or public.has_permission('platform.revenue.manage', null)
            )
          )
          or (
            wallet.wallet_type = 'logistics_earnings'
            and wallet.owner_entity_type = 'organization'
            and (
              public.can_manage_logistics_company(wallet.owner_entity_id)
              or public.is_platform_super_admin()
              or public.has_permission('platform.wallets.manage', null)
              or public.has_permission('platform.financial.manage', null)
            )
          )
          or (
            wallet.wallet_type not in ('platform_revenue','logistics_earnings')
            and (
              public.is_wallet_owner(wallet.id)
              or public.has_permission('platform.wallets.read', null)
              or public.has_permission('platform.wallets.manage', null)
              or public.has_permission('platform.financial.manage', null)
            )
          )
        )
    );
$$;

-- Extend the shared finance withdrawal gate for this exact company earnings
-- wallet type. can_access_wallet_account above keeps it company-owner managed.
do $withdrawal_wallet_patch$
declare
  function_sql text;
  old_gate text := $old_gate$wallet_record.wallet_type not in ('customer','driver','partner','commission','refund','generic')$old_gate$;
  new_gate text := $$wallet_record.wallet_type not in ('customer', 'driver', 'partner', 'commission', 'refund', 'generic', 'logistics_earnings')$$;
begin
  function_sql := pg_get_functiondef(
    'public.request_wallet_withdrawal(uuid,uuid,numeric,numeric,text,text,jsonb)'::regprocedure
  );
  if position(old_gate in function_sql) = 0 then
    raise exception 'request_wallet_withdrawal wallet-type guard changed; refusing an unsafe patch';
  end if;
  function_sql := replace(function_sql, old_gate, new_gate);
  execute function_sql;
end;
$withdrawal_wallet_patch$;

-- Only the online settlement path changes wallet class; offline fee operations
-- and company-owned partner wallet funding continue to use wallet_type=partner.
do $settlement_wallet_patch$
declare
  function_sql text;
  old_wallet text := $old_wallet$public.ensure_wallet_account(
      'partner', 'organization', booking_record.provider_organization_id, booking_record.currency_code,
      'platform.logistics.wallet_engine',
      jsonb_build_object('module_key', 'logistics_network', 'wallet_role', 'provider'),
      'logistics-provider:' || booking_record.provider_organization_id::text || ':' || booking_record.currency_code
    )$old_wallet$;
  new_wallet text := $new_wallet$public.ensure_wallet_account(
      'logistics_earnings', 'organization', booking_record.provider_organization_id, booking_record.currency_code,
      'platform.logistics.wallet_engine',
      jsonb_build_object('module_key', 'logistics_network', 'wallet_role', 'logistics_earnings'),
      'logistics-earnings:' || booking_record.provider_organization_id::text || ':' || booking_record.currency_code
    )$new_wallet$;
begin
  function_sql := pg_get_functiondef(
    'public.confirm_logistics_booking_delivery(uuid,uuid,text)'::regprocedure
  );
  if position(old_wallet in function_sql) = 0 then
    raise exception 'Logistics online settlement wallet block changed; refusing an unsafe patch';
  end if;
  function_sql := replace(function_sql, old_wallet, new_wallet);
  execute function_sql;
end;
$settlement_wallet_patch$;

-- ensure_wallet_account validates supported wallet types independently of the
-- wallet_accounts table constraint. Permit this one internal wallet role while
-- retaining its existing service-role/platform-wallet-manager creation guard.
do $logistics_earnings_wallet_type_patch$
declare
  function_sql text;
  old_types text := $old_types$
    'customer',
    'driver',
    'partner',
    'platform',
    'escrow',
    'commission',
    'refund',
    'bonus',
    'loyalty',
    'generic'
  ) then
    raise exception 'target_wallet_type is not supported';
  $old_types$;
  new_types text := $new_types$
    'customer',
    'driver',
    'partner',
    'platform',
    'escrow',
    'commission',
    'refund',
    'bonus',
    'loyalty',
    'generic',
    'logistics_earnings'
  ) then
    raise exception 'target_wallet_type is not supported';
  $new_types$;
begin
  function_sql := pg_get_functiondef(
    'public.ensure_wallet_account(text,text,uuid,text,text,jsonb,text)'::regprocedure
  );
  if position(old_types in function_sql) = 0 then
    raise exception 'ensure_wallet_account supported-type guard changed; refusing an unsafe patch';
  end if;
  function_sql := replace(function_sql, old_types, new_types);
  execute function_sql;
end;
$logistics_earnings_wallet_type_patch$;

create table if not exists public.logistics_company_payment_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  default_driver_payment_method text not null default 'offline'
    check (default_driver_payment_method in ('bank_transfer','cash','other','offline')),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
alter table public.logistics_company_payment_settings enable row level security;
revoke all on public.logistics_company_payment_settings from public, anon, authenticated;

create table if not exists public.logistics_driver_payment_records (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.logistics_bookings(id) on delete restrict,
  provider_organization_id uuid not null references public.organizations(id) on delete restrict,
  driver_profile_id uuid not null references public.driver_profiles(id) on delete restrict,
  driver_user_id uuid not null references public.profiles(id) on delete restrict,
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  amount numeric(28,8) not null check (amount > 0),
  payment_method text not null check (payment_method in ('bank_transfer','cash','other','offline')),
  status text not null check (status in ('paid','recorded_offline')),
  financial_transaction_id uuid references public.financial_transactions(id) on delete restrict,
  note text,
  idempotency_key text not null unique,
  paid_by uuid not null references public.profiles(id) on delete restrict,
  paid_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);
create index if not exists logistics_driver_payment_records_company_idx
  on public.logistics_driver_payment_records(provider_organization_id, paid_at desc);
create index if not exists logistics_driver_payment_records_driver_idx
  on public.logistics_driver_payment_records(driver_user_id, paid_at desc);
alter table public.logistics_driver_payment_records enable row level security;
revoke all on public.logistics_driver_payment_records from public, anon, authenticated;
grant select on public.logistics_driver_payment_records to authenticated;
create policy logistics_driver_payment_records_read_participants
on public.logistics_driver_payment_records for select to authenticated
using (
  public.can_read_logistics_company(provider_organization_id)
  or driver_user_id = auth.uid()
);


create or replace function public.read_logistics_company_payment_settings(target_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result public.logistics_company_payment_settings%rowtype;
begin
  if auth.uid() is null or not public.can_manage_logistics_company(target_organization_id) then
    raise exception using errcode = '42501', message = 'company payment settings access is restricted to company owners';
  end if;

  select * into result
  from public.logistics_company_payment_settings
  where organization_id = target_organization_id;

  return jsonb_build_object(
    'organization_id', target_organization_id,
    'default_driver_payment_method', coalesce(result.default_driver_payment_method, 'offline'),
    'updated_at', result.updated_at
  );
end;
$$;

create or replace function public.update_logistics_company_payment_settings(
  target_organization_id uuid,
  target_default_driver_payment_method text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.logistics_company_payment_settings%rowtype;
begin
  if auth.uid() is null or not public.can_manage_logistics_company(target_organization_id) then
    raise exception using errcode = '42501', message = 'company payment settings update is restricted to company owners';
  end if;
  if target_default_driver_payment_method is null
    or target_default_driver_payment_method not in ('bank_transfer','cash','other','offline') then
    raise exception 'choose bank transfer, cash, other or offline payment';
  end if;

  insert into public.logistics_company_payment_settings (
    organization_id, default_driver_payment_method, updated_by, updated_at
  ) values (
    target_organization_id, target_default_driver_payment_method, auth.uid(), timezone('utc', now())
  )
  on conflict (organization_id) do update
    set default_driver_payment_method = excluded.default_driver_payment_method,
        updated_by = excluded.updated_by,
        updated_at = timezone('utc', now())
  returning * into result;

  return jsonb_build_object(
    'organization_id', result.organization_id,
    'default_driver_payment_method', result.default_driver_payment_method,
    'updated_at', result.updated_at
  );
end;
$$;

create or replace function public.record_logistics_driver_payment(
  target_booking_id uuid,
  target_amount numeric,
  target_payment_method text,
  target_note text default null,
  target_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  booking_record public.logistics_bookings%rowtype;
  assignment_record public.logistics_booking_driver_assignments%rowtype;
  settings_record public.logistics_company_payment_settings%rowtype;
  payment_record public.logistics_driver_payment_records%rowtype;
  currency_decimals integer;
  permitted_amount numeric(28,8);
begin
  if actor is null then raise exception 'authentication is required'; end if;
  if target_booking_id is null or target_amount is null or target_amount <= 0
    or target_payment_method is null
    or target_payment_method not in ('bank_transfer','cash','other','offline')
    or target_idempotency_key is null
    or char_length(btrim(target_idempotency_key)) not between 8 and 180
    or coalesce(length(btrim(target_note)),0) < 3 then
    raise exception 'booking, positive amount, supported payment channel, reference and valid idempotency key are required';
  end if;

  select * into booking_record
  from public.logistics_bookings
  where id = target_booking_id
  for update;
  if not found then raise exception 'Logistics booking was not found'; end if;
  if not public.can_manage_logistics_company(booking_record.provider_organization_id) then
    raise exception using errcode = '42501', message = 'only an authorized company owner can record driver payments';
  end if;
  if booking_record.status not in ('settled','completed_offline') then
    raise exception 'driver payment is available only after customer-confirmed job completion';
  end if;

  select * into assignment_record
  from public.logistics_booking_driver_assignments
  where booking_id = booking_record.id
    and provider_organization_id = booking_record.provider_organization_id
    and status = 'completed'
  order by completed_at desc nulls last, created_at desc
  limit 1
  for update;
  if not found then raise exception 'the assigned driver has not completed this Logistics job'; end if;

  select * into settings_record
  from public.logistics_company_payment_settings
  where organization_id = booking_record.provider_organization_id;
  if coalesce(settings_record.default_driver_payment_method, 'offline') <> target_payment_method then
    raise exception 'payment channel differs from the company setting; update the company setting first';
  end if;

  select decimal_places into currency_decimals
  from public.currency_definitions
  where code = booking_record.currency_code and status = 'enabled';
  if currency_decimals is null or target_amount <> trunc(target_amount, currency_decimals) then
    raise exception 'driver payment amount exceeds the currency decimal precision';
  end if;

  permitted_amount := case
    when booking_record.payment_mode = 'online_wallet' then booking_record.provider_net_amount
    else booking_record.delivery_amount
  end;
  if permitted_amount <= 0 or target_amount > permitted_amount then
    raise exception 'driver payment cannot exceed the provider amount for this booking';
  end if;

  select * into payment_record
  from public.logistics_driver_payment_records
  where booking_id = booking_record.id or idempotency_key = target_idempotency_key;
  if found then
    if payment_record.booking_id <> booking_record.id
      or payment_record.amount <> target_amount
      or payment_record.payment_method <> target_payment_method
      or payment_record.provider_organization_id <> booking_record.provider_organization_id then
      raise exception 'driver payment idempotency key or booking has already been used with different details';
    end if;
    return jsonb_build_object(
      'id',payment_record.id,'booking_id',payment_record.booking_id,'amount',payment_record.amount,
      'currency_code',payment_record.currency_code,'payment_method',payment_record.payment_method,
      'status',payment_record.status,'financial_transaction_id',null,'idempotent_replay',true
    );
  end if;

  insert into public.logistics_driver_payment_records (
    booking_id,provider_organization_id,driver_profile_id,driver_user_id,
    currency_code,amount,payment_method,status,financial_transaction_id,note,
    idempotency_key,paid_by,metadata
  ) values (
    booking_record.id,booking_record.provider_organization_id,assignment_record.driver_profile_id,
    assignment_record.driver_user_id,booking_record.currency_code,target_amount,target_payment_method,
    'recorded_offline',null,nullif(btrim(target_note),''),target_idempotency_key,actor,
    jsonb_build_object(
      'source','logistics.company.driver_payments',
      'booking_status',booking_record.status,
      'settlement_mode',booking_record.payment_mode,
      'external_payment_reference',true
    )
  ) returning * into payment_record;

  return jsonb_build_object(
    'id',payment_record.id,'booking_id',payment_record.booking_id,'amount',payment_record.amount,
    'currency_code',payment_record.currency_code,'payment_method',payment_record.payment_method,
    'status',payment_record.status,'financial_transaction_id',null,'idempotent_replay',false
  );
end;
$$;


notify pgrst,'reload schema';
commit;
