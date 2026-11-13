begin;

create table if not exists public.platform_profit_period_closings (
  id uuid primary key default gen_random_uuid(),
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  period_start date not null,
  period_end date not null,
  net_platform_revenue numeric(28,8) not null check (net_platform_revenue >= 0),
  operating_expenses numeric(28,8) not null default 0 check (operating_expenses >= 0),
  refund_chargeback_reserve numeric(28,8) not null default 0 check (refund_chargeback_reserve >= 0),
  tax_and_statutory_reserve numeric(28,8) not null default 0 check (tax_and_statutory_reserve >= 0),
  other_reserves numeric(28,8) not null default 0 check (other_reserves >= 0),
  excluded_customer_collections numeric(28,8) not null default 0 check (excluded_customer_collections >= 0),
  excluded_supplier_pass_through numeric(28,8) not null default 0 check (excluded_supplier_pass_through >= 0),
  excluded_escrow_and_unsettled_funds numeric(28,8) not null default 0 check (excluded_escrow_and_unsettled_funds >= 0),
  distributable_profit numeric(28,8) generated always as (
    greatest(
      0::numeric,
      net_platform_revenue
        - operating_expenses
        - refund_chargeback_reserve
        - tax_and_statutory_reserve
        - other_reserves
    )
  ) stored,
  reconciliation_reference text not null check (char_length(btrim(reconciliation_reference)) between 3 and 180),
  notes text,
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected')),
  idempotency_key text not null unique,
  ledger_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(ledger_snapshot) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (period_end >= period_start),
  check ((status = 'approved') = (approved_at is not null and approved_by is not null))
);

create unique index if not exists platform_profit_period_close_one_current
  on public.platform_profit_period_closings(currency_code, period_start, period_end)
  where status in ('draft', 'approved');

create index if not exists platform_profit_period_closings_recent_idx
  on public.platform_profit_period_closings(currency_code, period_end desc, created_at desc);

create table if not exists public.platform_profit_distribution_schedules (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(btrim(display_name)) between 3 and 120),
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  template_id uuid not null references public.platform_profit_allocation_templates(id) on delete restrict,
  frequency text not null check (frequency in ('weekly', 'fortnightly', 'monthly', 'quarterly')),
  period_start date not null,
  period_end date not null,
  next_run_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'paused', 'completed')),
  last_distribution_id uuid references public.platform_profit_distributions(id) on delete set null,
  last_attempt_at timestamptz,
  last_error text,
  successful_runs integer not null default 0 check (successful_runs >= 0),
  idempotency_key text not null unique,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (period_end >= period_start)
);

create index if not exists platform_profit_distribution_schedules_due_idx
  on public.platform_profit_distribution_schedules(next_run_at)
  where status = 'active';

create table if not exists public.platform_profit_category_accounts (
  id uuid primary key default gen_random_uuid(),
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  category_key text not null check (category_key in (
    'platform_expenses',
    'vehicle_repayment',
    'skima_savings',
    'daily_expenses',
    'staff_payment',
    'investment_savings'
  )),
  wallet_id uuid unique references public.wallet_accounts(id) on delete restrict,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  unique(currency_code, category_key)
);

alter table public.platform_profit_distributions
  add column if not exists period_close_id uuid references public.platform_profit_period_closings(id) on delete restrict,
  add column if not exists execution_status text not null default 'unfunded'
    check (execution_status in ('unfunded', 'funded')),
  add column if not exists funding_transaction_id uuid references public.financial_transactions(id) on delete restrict,
  add column if not exists funding_idempotency_key text,
  add column if not exists funded_by uuid references public.profiles(id) on delete set null,
  add column if not exists funded_at timestamptz;

alter table public.platform_profit_distribution_allocations
  add column if not exists category_wallet_id uuid references public.wallet_accounts(id) on delete restrict;

create unique index if not exists platform_profit_distribution_one_close
  on public.platform_profit_distributions(period_close_id)
  where period_close_id is not null;

alter table public.platform_profit_period_closings enable row level security;
alter table public.platform_profit_distribution_schedules enable row level security;
alter table public.platform_profit_category_accounts enable row level security;

revoke all on table public.platform_profit_period_closings from public, anon, authenticated;
revoke all on table public.platform_profit_distribution_schedules from public, anon, authenticated;
revoke all on table public.platform_profit_category_accounts from public, anon, authenticated;
grant select on table public.platform_profit_period_closings to authenticated;
grant select on table public.platform_profit_distribution_schedules to authenticated;
grant select on table public.platform_profit_category_accounts to authenticated;

create policy platform_profit_period_closings_finance_read
on public.platform_profit_period_closings
for select to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.profit_capital.read', null)
  or public.has_permission('platform.profit_capital.manage', null)
  or public.has_permission('platform.financial.read', null)
  or public.has_permission('platform.financial.manage', null)
);

create policy platform_profit_distribution_schedules_finance_read
on public.platform_profit_distribution_schedules
for select to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.profit_capital.read', null)
  or public.has_permission('platform.profit_capital.manage', null)
  or public.has_permission('platform.financial.read', null)
  or public.has_permission('platform.financial.manage', null)
);

create policy platform_profit_category_accounts_finance_read
on public.platform_profit_category_accounts
for select to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.profit_capital.read', null)
  or public.has_permission('platform.profit_capital.manage', null)
  or public.has_permission('platform.financial.read', null)
  or public.has_permission('platform.financial.manage', null)
);

create or replace function public.save_platform_profit_period_close(
  target_currency_code text,
  target_period_start date,
  target_period_end date,
  target_operating_expenses numeric,
  target_refund_chargeback_reserve numeric,
  target_tax_and_statutory_reserve numeric,
  target_other_reserves numeric,
  target_excluded_customer_collections numeric,
  target_excluded_supplier_pass_through numeric,
  target_excluded_escrow_and_unsettled_funds numeric,
  target_reconciliation_reference text,
  target_idempotency_key text,
  target_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  currency text := upper(btrim(target_currency_code));
  net_revenue numeric(28,8) := 0;
  existing public.platform_profit_period_closings%rowtype;
  close_id uuid;
  revenue_entry_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (
       public.is_platform_super_admin()
       or public.has_permission('platform.profit_capital.manage', null)
       or public.has_permission('platform.financial.manage', null)
     ) then
    raise exception using errcode = '42501', message = 'Profit and capital management permission is required';
  end if;

  if not exists (
    select 1 from public.currency_definitions
    where code = currency and status = 'enabled'
  ) then
    raise exception using errcode = '22023', message = 'Choose an enabled currency';
  end if;
  if target_period_start is null or target_period_end is null or target_period_end < target_period_start then
    raise exception using errcode = '22023', message = 'Choose a valid financial period';
  end if;
  if target_operating_expenses is null or target_operating_expenses < 0
     or target_refund_chargeback_reserve is null or target_refund_chargeback_reserve < 0
     or target_tax_and_statutory_reserve is null or target_tax_and_statutory_reserve < 0
     or target_other_reserves is null or target_other_reserves < 0
     or target_excluded_customer_collections is null or target_excluded_customer_collections < 0
     or target_excluded_supplier_pass_through is null or target_excluded_supplier_pass_through < 0
     or target_excluded_escrow_and_unsettled_funds is null or target_excluded_escrow_and_unsettled_funds < 0
     or nullif(btrim(target_reconciliation_reference), '') is null
     or nullif(btrim(target_idempotency_key), '') is null then
    raise exception using errcode = '22023',
      message = 'Non-negative expense and reserve amounts, excluded-funds declarations, a reconciliation reference and idempotency key are required';
  end if;

  select coalesce(sum(
    case when ledger.direction = 'credit' then ledger.amount else -ledger.amount end
  ), 0), count(*)
  into net_revenue, revenue_entry_count
  from public.wallet_ledger_entries ledger
  join public.wallet_accounts wallet on wallet.id = ledger.wallet_id
  join public.financial_transactions transaction_record on transaction_record.id = ledger.transaction_id
  where wallet.wallet_type = 'platform_revenue'
    and wallet.owner_entity_type = 'platform'
    and wallet.owner_entity_id is null
    and wallet.currency_code = currency
    and transaction_record.status = 'posted'
    and coalesce(transaction_record.source, '') <> 'platform.profit_capital.funding'
    and ledger.created_at >= timezone('utc', target_period_start::timestamp)
    and ledger.created_at < timezone('utc', (target_period_end + 1)::timestamp);

  net_revenue := greatest(0, net_revenue);

  select * into existing
  from public.platform_profit_period_closings
  where idempotency_key = target_idempotency_key
  for update;

  if existing.id is not null then
    if existing.currency_code <> currency
       or existing.period_start <> target_period_start
       or existing.period_end <> target_period_end
       or existing.operating_expenses <> target_operating_expenses
       or existing.refund_chargeback_reserve <> target_refund_chargeback_reserve
       or existing.tax_and_statutory_reserve <> target_tax_and_statutory_reserve
       or existing.other_reserves <> target_other_reserves
       or existing.excluded_customer_collections <> target_excluded_customer_collections
       or existing.excluded_supplier_pass_through <> target_excluded_supplier_pass_through
       or existing.excluded_escrow_and_unsettled_funds <> target_excluded_escrow_and_unsettled_funds
       or existing.reconciliation_reference <> btrim(target_reconciliation_reference)
       or coalesce(existing.notes, '') <> coalesce(nullif(btrim(target_notes), ''), '') then
      raise exception using errcode = '23505', message = 'Period-close idempotency key was reused with different details';
    end if;
    return existing.id;
  end if;

  insert into public.platform_profit_period_closings(
    currency_code, period_start, period_end, net_platform_revenue,
    operating_expenses, refund_chargeback_reserve, tax_and_statutory_reserve,
    other_reserves, excluded_customer_collections, excluded_supplier_pass_through,
    excluded_escrow_and_unsettled_funds, reconciliation_reference, notes,
    idempotency_key, ledger_snapshot
  )
  values (
    currency, target_period_start, target_period_end, net_revenue,
    target_operating_expenses, target_refund_chargeback_reserve, target_tax_and_statutory_reserve,
    target_other_reserves, target_excluded_customer_collections, target_excluded_supplier_pass_through,
    target_excluded_escrow_and_unsettled_funds, btrim(target_reconciliation_reference),
    nullif(btrim(target_notes), ''), target_idempotency_key,
    jsonb_build_object(
      'source', 'platform_revenue_wallet_postings',
      'revenueWalletDebitAndCreditNet', net_revenue,
      'postedRevenueLedgerEntryCount', revenue_entry_count,
      'periodStart', target_period_start,
      'periodEnd', target_period_end,
      'capturedAt', timezone('utc', now()),
      'calculationPolicy', 'Conservative net posted platform-revenue wallet movements. Customer collections, escrow, supplier pass-through wallets and unsettled collections are not queried into this base. Internal profit-category funding transfers are excluded from later revenue periods.'
    )
  )
  returning id into close_id;

  insert into public.platform_profit_capital_audit_events(entity_type, entity_id, action, metadata)
  values ('profit_period_close', close_id, 'saved_draft', jsonb_build_object(
    'currencyCode', currency,
    'periodStart', target_period_start,
    'periodEnd', target_period_end,
    'netPlatformRevenue', net_revenue,
    'distributableProfit', greatest(
      0,
      net_revenue - target_operating_expenses - target_refund_chargeback_reserve
        - target_tax_and_statutory_reserve - target_other_reserves
    ),
    'postedRevenueLedgerEntryCount', revenue_entry_count,
    'reconciliationReference', target_reconciliation_reference
  ));

  return close_id;
end;
$$;

create or replace function public.approve_platform_profit_period_close(
  target_close_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  close_record public.platform_profit_period_closings%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (
       public.is_platform_super_admin()
       or public.has_permission('platform.profit_capital.manage', null)
       or public.has_permission('platform.financial.manage', null)
     ) then
    raise exception using errcode = '42501', message = 'Profit and capital approval permission is required';
  end if;

  select * into close_record
  from public.platform_profit_period_closings
  where id = target_close_id
  for update;

  if close_record.id is null or close_record.status <> 'draft' then
    raise exception using errcode = '23514', message = 'Only a draft period close can be approved';
  end if;

  if close_record.created_by = auth.uid()
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.is_platform_super_admin() then
    raise exception using errcode = '42501',
      message = 'A different Finance Admin must approve the period close that you prepared';
  end if;

  update public.platform_profit_period_closings
  set status = 'approved',
      approved_by = auth.uid(),
      approved_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = target_close_id;

  insert into public.platform_profit_capital_audit_events(entity_type, entity_id, action, metadata)
  values ('profit_period_close', target_close_id, 'approved', jsonb_build_object(
    'netPlatformRevenue', close_record.net_platform_revenue,
    'distributableProfit', close_record.distributable_profit,
    'approvedBy', auth.uid()
  ));

  return target_close_id;
end;
$$;

create or replace function public.save_platform_profit_distribution_schedule(
  target_display_name text,
  target_currency_code text,
  target_template_id uuid,
  target_frequency text,
  target_period_start date,
  target_period_end date,
  target_next_run_at timestamptz,
  target_idempotency_key text,
  target_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  currency text := upper(btrim(target_currency_code));
  template public.platform_profit_allocation_templates%rowtype;
  existing public.platform_profit_distribution_schedules%rowtype;
  schedule_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (
       public.is_platform_super_admin()
       or public.has_permission('platform.profit_capital.manage', null)
       or public.has_permission('platform.financial.manage', null)
     ) then
    raise exception using errcode = '42501', message = 'Profit and capital management permission is required';
  end if;
  if nullif(btrim(target_display_name), '') is null
     or target_frequency not in ('weekly', 'fortnightly', 'monthly', 'quarterly')
     or target_period_start is null or target_period_end is null or target_period_end < target_period_start
     or target_next_run_at is null
     or nullif(btrim(target_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'Schedule name, valid cadence, period, next run time and idempotency key are required';
  end if;
  select * into template
  from public.platform_profit_allocation_templates
  where id = target_template_id and currency_code = currency and status = 'active';
  if template.id is null then
    raise exception using errcode = '23514', message = 'Choose the active allocation template for the selected currency';
  end if;

  select * into existing
  from public.platform_profit_distribution_schedules
  where idempotency_key = target_idempotency_key;
  if existing.id is not null then
    if existing.display_name <> btrim(target_display_name)
       or existing.currency_code <> currency
       or existing.template_id <> target_template_id
       or existing.frequency <> target_frequency
       or existing.period_start <> target_period_start
       or existing.period_end <> target_period_end
       or existing.next_run_at <> target_next_run_at then
      raise exception using errcode = '23505', message = 'Schedule idempotency key was reused with different details';
    end if;
    return existing.id;
  end if;

  insert into public.platform_profit_distribution_schedules(
    display_name, currency_code, template_id, frequency, period_start, period_end,
    next_run_at, notes, idempotency_key
  )
  values (
    btrim(target_display_name), currency, target_template_id, target_frequency,
    target_period_start, target_period_end, target_next_run_at,
    nullif(btrim(target_notes), ''), target_idempotency_key
  )
  returning id into schedule_id;

  insert into public.platform_profit_capital_audit_events(entity_type, entity_id, action, metadata)
  values ('profit_distribution_schedule', schedule_id, 'created', jsonb_build_object(
    'frequency', target_frequency,
    'periodStart', target_period_start,
    'periodEnd', target_period_end,
    'nextRunAt', target_next_run_at,
    'currencyCode', currency
  ));

  return schedule_id;
end;
$$;

create or replace function public.set_platform_profit_distribution_schedule_status(
  target_schedule_id uuid,
  target_status text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (
       public.is_platform_super_admin()
       or public.has_permission('platform.profit_capital.manage', null)
       or public.has_permission('platform.financial.manage', null)
     ) then
    raise exception using errcode = '42501', message = 'Profit and capital management permission is required';
  end if;
  if target_status not in ('active', 'paused', 'completed') then
    raise exception using errcode = '22023', message = 'Schedule status is not supported';
  end if;

  update public.platform_profit_distribution_schedules
  set status = target_status, updated_at = timezone('utc', now())
  where id = target_schedule_id
    and status <> 'completed';
  if not found then
    raise exception using errcode = 'P0002', message = 'An active or paused schedule was not found';
  end if;
  return target_schedule_id;
end;
$$;

create or replace function public.ensure_platform_profit_category_wallet(
  target_currency_code text,
  target_category_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  currency text := upper(btrim(target_currency_code));
  account_record public.platform_profit_category_accounts%rowtype;
  wallet_id_value uuid;
  created_wallet boolean := false;
  wallet_source text := 'platform.profit_capital';
  wallet_key text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (
       public.is_platform_super_admin()
       or public.has_permission('platform.profit_capital.manage', null)
       or public.has_permission('platform.financial.manage', null)
     ) then
    raise exception using errcode = '42501', message = 'Profit and capital category wallet management permission is required';
  end if;
  if target_category_key not in (
    'platform_expenses','vehicle_repayment','skima_savings',
    'daily_expenses','staff_payment','investment_savings'
  ) then
    raise exception using errcode = '22023', message = 'Unsupported profit allocation category';
  end if;
  if not exists (
    select 1 from public.currency_definitions
    where code = currency and status = 'enabled'
  ) then
    raise exception using errcode = '22023', message = 'Choose an enabled currency';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('profit_category_wallet:' || currency || ':' || target_category_key, 0)
  );

  insert into public.platform_profit_category_accounts(currency_code, category_key)
  values (currency, target_category_key)
  on conflict (currency_code, category_key) do nothing;

  select * into account_record
  from public.platform_profit_category_accounts account_row
  where account_row.currency_code = currency
    and account_row.category_key = target_category_key
  for update;

  if account_record.wallet_id is not null then
    select wallet.id into wallet_id_value
    from public.wallet_accounts wallet
    where wallet.id = account_record.wallet_id
      and wallet.status = 'active';
    if wallet_id_value is not null then
      return wallet_id_value;
    end if;
    raise exception using errcode = '55000',
      message = 'The profit category wallet is not active. Contact a Super Admin.';
  end if;

  wallet_key := 'profit-category:' || lower(currency) || ':' || target_category_key;
  insert into public.wallet_accounts(
    wallet_type, owner_entity_type, owner_entity_id, currency_code, status,
    metadata, created_by, source, idempotency_key
  )
  values (
    'generic', 'module', account_record.id, currency, 'active',
    jsonb_build_object(
      'wallet_purpose', 'platform_profit_' || target_category_key,
      'display_name', replace(initcap(target_category_key), '_', ' ') || ' · ' || currency,
      'accounting_only', true,
      'withdrawal_allowed', false,
      'platform_internal', true
    ),
    auth.uid(), wallet_source, wallet_key
  )
  on conflict do nothing
  returning id into wallet_id_value;

  if wallet_id_value is null then
    select wallet.id into wallet_id_value
    from public.wallet_accounts wallet
    where wallet.wallet_type = 'generic'
      and wallet.owner_entity_type = 'module'
      and wallet.owner_entity_id = account_record.id
      and wallet.currency_code = currency
      and wallet.status = 'active'
    limit 1;
  else
    created_wallet := true;
  end if;

  if wallet_id_value is null then
    raise exception using errcode = '55000', message = 'Could not create the SKIMA profit category account';
  end if;

  update public.platform_profit_category_accounts account_row
  set wallet_id = wallet_id_value
  where account_row.id = account_record.id;

  if created_wallet then
    insert into public.wallet_account_events(
      wallet_account_id, event_type, status, idempotency_key, metadata, created_by
    )
    values (
      wallet_id_value, 'created', 'active', wallet_key || ':created',
      jsonb_build_object('source', wallet_source, 'categoryKey', target_category_key, 'currencyCode', currency),
      auth.uid()
    )
    on conflict do nothing;
  end if;

  return wallet_id_value;
end;
$$;

create or replace function public.create_platform_profit_distribution_from_close(
  target_template_id uuid,
  target_close_id uuid,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  close_record public.platform_profit_period_closings%rowtype;
  template_id uuid := target_template_id;
  distribution_id uuid;
  notes_value text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (
       public.is_platform_super_admin()
       or public.has_permission('platform.profit_capital.manage', null)
       or public.has_permission('platform.financial.manage', null)
     ) then
    raise exception using errcode = '42501', message = 'Profit and capital management permission is required';
  end if;
  if nullif(btrim(target_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'Distribution idempotency key is required';
  end if;

  select * into close_record
  from public.platform_profit_period_closings
  where id = target_close_id
  for share;
  if close_record.id is null or close_record.status <> 'approved' then
    raise exception using errcode = '23514', message = 'An approved period close is required before a distribution can be created';
  end if;
  if close_record.distributable_profit <= 0 then
    raise exception using errcode = '23514', message = 'The approved period close has no positive distributable profit';
  end if;

  if template_id is null then
    select id into template_id
    from public.platform_profit_allocation_templates
    where currency_code = close_record.currency_code and status = 'active'
    limit 1;
  end if;
  if not exists (
    select 1 from public.platform_profit_allocation_templates
    where id = template_id and currency_code = close_record.currency_code and status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'An active allocation template for this period currency is required';
  end if;

  notes_value := 'Approved period close ' || close_record.id::text || ' · ' || close_record.reconciliation_reference;
  distribution_id := public.create_platform_profit_distribution(
    template_id,
    close_record.currency_code,
    close_record.period_start,
    close_record.period_end,
    close_record.distributable_profit,
    target_idempotency_key,
    notes_value
  );

  update public.platform_profit_distributions
  set period_close_id = close_record.id,
      execution_status = coalesce(execution_status, 'unfunded'),
      updated_at = timezone('utc', now())
  where id = distribution_id
    and (period_close_id is null or period_close_id = close_record.id);

  if not found then
    raise exception using errcode = '23514', message = 'This distribution is already linked to another approved period close';
  end if;

  insert into public.platform_profit_capital_audit_events(entity_type, entity_id, action, metadata)
  values ('profit_distribution', distribution_id, 'created_from_approved_close', jsonb_build_object(
    'periodCloseId', close_record.id,
    'reconciliationReference', close_record.reconciliation_reference,
    'netPlatformRevenue', close_record.net_platform_revenue,
    'distributableProfit', close_record.distributable_profit
  ));

  return distribution_id;
end;
$$;

create or replace function public.fund_platform_profit_distribution(
  target_distribution_id uuid,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  distribution public.platform_profit_distributions%rowtype;
  revenue_wallet_id uuid;
  available_revenue numeric(28,8) := 0;
  allocation_total numeric(28,8) := 0;
  entries jsonb;
  allocation record;
  v_category_wallet_id uuid;
  transaction_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (
       public.is_platform_super_admin()
       or public.has_permission('platform.financial.manage', null)
     ) then
    raise exception using errcode = '42501', message = 'Finance approval is required to fund a profit distribution';
  end if;
  if nullif(btrim(target_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'Funding idempotency key is required';
  end if;

  select * into distribution
  from public.platform_profit_distributions
  where id = target_distribution_id
  for update;

  if distribution.id is null or distribution.status <> 'approved' or distribution.period_close_id is null then
    raise exception using errcode = '23514', message = 'Only a distribution derived from an approved period close can be funded';
  end if;
  if distribution.funding_transaction_id is not null then
    if distribution.funding_idempotency_key <> target_idempotency_key then
      raise exception using errcode = '23505', message = 'This distribution has already been funded with a different request key';
    end if;
    return distribution.funding_transaction_id;
  end if;

  select id into revenue_wallet_id
  from public.wallet_accounts
  where wallet_type = 'platform_revenue'
    and owner_entity_type = 'platform'
    and owner_entity_id is null
    and currency_code = distribution.currency_code
    and status = 'active'
  limit 1
  for update;

  if revenue_wallet_id is null then
    raise exception using errcode = '55000', message = 'SKIMA platform revenue wallet is not provisioned for this currency';
  end if;

  select coalesce(balance.balance, 0) into available_revenue
  from public.wallet_balances balance
  where balance.wallet_id = revenue_wallet_id;

  if available_revenue < distribution.distributable_profit then
    raise exception using errcode = '55000',
      message = format('The SKIMA revenue wallet has %s available, below the approved distribution of %s. Reconcile liquidity before funding.', available_revenue, distribution.distributable_profit);
  end if;

  select coalesce(sum(allocated_amount), 0) into allocation_total
  from public.platform_profit_distribution_allocations
  where distribution_id = distribution.id;
  if allocation_total <> distribution.distributable_profit then
    raise exception using errcode = '23514', message = 'The allocation snapshot does not equal the approved distributable profit';
  end if;

  entries := jsonb_build_array(jsonb_build_object(
    'wallet_id', revenue_wallet_id,
    'direction', 'debit',
    'amount', distribution.distributable_profit,
    'entry_type', 'principal',
    'metadata', jsonb_build_object(
      'role', 'profit_distribution_source',
      'period_close_id', distribution.period_close_id
    )
  ));

  for allocation in
    select * from public.platform_profit_distribution_allocations
    where distribution_id = distribution.id
    order by category_key
  loop
    if allocation.allocated_amount <= 0 then
      continue;
    end if;
    v_category_wallet_id := public.ensure_platform_profit_category_wallet(
      distribution.currency_code,
      allocation.category_key
    );
    entries := entries || jsonb_build_array(jsonb_build_object(
      'wallet_id', v_category_wallet_id,
      'direction', 'credit',
      'amount', allocation.allocated_amount,
      'entry_type', 'principal',
      'metadata', jsonb_build_object(
        'role', 'profit_distribution_category_allocation',
        'distribution_id', distribution.id,
        'category_key', allocation.category_key,
        'allocation_percent', allocation.allocation_percent
      )
    ));
    update public.platform_profit_distribution_allocations allocation_record
    set category_wallet_id = v_category_wallet_id
    where allocation_record.id = allocation.id;
  end loop;

  if jsonb_array_length(entries) < 2 then
    raise exception using errcode = '23514', message = 'There are no positive category allocations to fund';
  end if;

  transaction_id := public.post_financial_transaction(
    'transfer',
    distribution.currency_code,
    'platform.profit_capital.funding',
    'platform_profit_distribution',
    distribution.id,
    entries,
    target_idempotency_key,
    null,
    null,
    jsonb_build_object('period_close_id', distribution.period_close_id),
    jsonb_build_object('source', 'approved_platform_revenue_only', 'distribution_id', distribution.id)
  );

  update public.platform_profit_distributions
  set execution_status = 'funded',
      funding_transaction_id = transaction_id,
      funding_idempotency_key = target_idempotency_key,
      funded_by = auth.uid(),
      funded_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = distribution.id;

  insert into public.platform_profit_capital_audit_events(entity_type, entity_id, action, metadata)
  values ('profit_distribution', distribution.id, 'funded', jsonb_build_object(
    'fundingTransactionId', transaction_id,
    'revenueWalletId', revenue_wallet_id,
    'amount', distribution.distributable_profit,
    'currencyCode', distribution.currency_code
  ));

  return transaction_id;
end;
$$;

create or replace function public.ensure_platform_profit_beneficiary_wallet(
  target_profile_id uuid,
  target_currency_code text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  wallet_id uuid;
begin
  if target_profile_id is null or not exists (
    select 1 from public.profiles where id = target_profile_id
  ) then
    raise exception using errcode = '22023', message = 'A valid SKIMA profile is required for an internal wallet payout';
  end if;

  insert into public.wallet_accounts(
    wallet_type, owner_entity_type, owner_entity_id, currency_code, status,
    metadata, created_by, source, idempotency_key
  )
  values (
    'customer', 'user', target_profile_id, upper(target_currency_code), 'active',
    jsonb_build_object('wallet_purpose', 'customer_spendable', 'created_for', 'profit_capital_beneficiary'),
    auth.uid(), 'platform.profit_capital', target_idempotency_key
  )
  on conflict do nothing
  returning id into wallet_id;

  if wallet_id is null then
    select id into wallet_id
    from public.wallet_accounts
    where wallet_type = 'customer'
      and owner_entity_type = 'user'
      and owner_entity_id = target_profile_id
      and currency_code = upper(target_currency_code)
      and status = 'active'
    limit 1;
  else
    insert into public.wallet_account_events(
      wallet_account_id, event_type, status, idempotency_key, metadata, created_by
    )
    values (
      wallet_id, 'created', 'active', target_idempotency_key || ':created',
      jsonb_build_object('source', 'platform.profit_capital', 'role', 'profit_capital_beneficiary'),
      auth.uid()
    )
    on conflict do nothing;
  end if;

  if wallet_id is null then
    raise exception using errcode = '55000', message = 'The beneficiary customer wallet is missing or inactive';
  end if;
  return wallet_id;
end;
$$;

create or replace function public.link_platform_profit_participant_profile(
  target_participant_id uuid,
  target_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  participant public.platform_profit_participants%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (
       public.is_platform_super_admin()
       or public.has_permission('platform.profit_capital.manage', null)
       or public.has_permission('platform.financial.manage', null)
     ) then
    raise exception using errcode = '42501', message = 'Profit participant management permission is required';
  end if;
  if not exists (select 1 from public.profiles where id = target_profile_id) then
    raise exception using errcode = 'P0002', message = 'The selected SKIMA profile was not found';
  end if;

  select * into participant
  from public.platform_profit_participants
  where id = target_participant_id
  for update;
  if participant.id is null or participant.status = 'closed' then
    raise exception using errcode = 'P0002', message = 'An active profit participant was not found';
  end if;
  if exists (
    select 1 from public.platform_profit_participants
    where profile_id = target_profile_id and id <> target_participant_id and status <> 'closed'
  ) then
    raise exception using errcode = '23505', message = 'This SKIMA profile is already linked to another active profit participant';
  end if;

  update public.platform_profit_participants
  set profile_id = target_profile_id, updated_at = timezone('utc', now())
  where id = target_participant_id;

  insert into public.platform_profit_capital_audit_events(entity_type, entity_id, action, metadata)
  values ('profit_participant', target_participant_id, 'profile_linked', jsonb_build_object('profileId', target_profile_id));

  return target_participant_id;
end;
$$;

create or replace function public.pay_platform_profit_participant_entitlement_to_wallet(
  target_entitlement_id uuid,
  target_amount numeric,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  entitlement public.platform_profit_participant_entitlements%rowtype;
  distribution public.platform_profit_distributions%rowtype;
  participant public.platform_profit_participants%rowtype;
  v_category_wallet_id uuid;
  beneficiary_wallet_id uuid;
  available_balance numeric(28,8) := 0;
  transaction_id uuid;
  payment_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (
       public.is_platform_super_admin()
       or public.has_permission('platform.financial.manage', null)
     ) then
    raise exception using errcode = '42501', message = 'Finance permission is required to pay profit participation';
  end if;
  if target_amount is null or target_amount <= 0 or nullif(btrim(target_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'A positive payout amount and idempotency key are required';
  end if;

  select * into entitlement
  from public.platform_profit_participant_entitlements
  where id = target_entitlement_id
  for update;
  if entitlement.id is null or entitlement.status not in ('approved', 'partially_paid') then
    raise exception using errcode = '23514', message = 'Only an approved outstanding entitlement can be paid';
  end if;
  if target_amount > entitlement.entitlement_amount - entitlement.paid_amount then
    raise exception using errcode = '23514', message = 'Payout exceeds the outstanding profit entitlement';
  end if;

  select * into distribution
  from public.platform_profit_distributions
  where id = entitlement.distribution_id
  for update;
  if distribution.status not in ('approved', 'completed')
     or distribution.execution_status <> 'funded'
     or distribution.funding_transaction_id is null then
    raise exception using errcode = '23514', message = 'Fund the approved distribution before paying a beneficiary';
  end if;

  select * into participant
  from public.platform_profit_participants
  where id = entitlement.participant_id;
  if participant.profile_id is null then
    raise exception using errcode = '23514', message = 'Link this participant to a verified SKIMA profile before using an internal wallet payout';
  end if;

  select allocation.category_wallet_id into v_category_wallet_id
  from public.platform_profit_distribution_allocations allocation
  where allocation.distribution_id = distribution.id
    and allocation.category_key = entitlement.funding_category;
  if v_category_wallet_id is null then
    raise exception using errcode = '55000', message = 'The participant funding category has not been funded';
  end if;

  select coalesce(balance.balance, 0) into available_balance
  from public.wallet_balances balance
  where balance.wallet_id = v_category_wallet_id;
  if available_balance < target_amount then
    raise exception using errcode = '55000', message = 'The allocated category wallet does not have enough available funds';
  end if;

  beneficiary_wallet_id := public.ensure_platform_profit_beneficiary_wallet(
    participant.profile_id,
    distribution.currency_code,
    'profit-beneficiary-wallet:' || participant.profile_id::text || ':' || lower(distribution.currency_code)
  );

  transaction_id := public.post_financial_transaction(
    'transfer',
    distribution.currency_code,
    'platform.profit_capital.payout',
    'platform_profit_entitlement',
    entitlement.id,
    jsonb_build_array(
      jsonb_build_object('wallet_id', v_category_wallet_id, 'direction', 'debit', 'amount', target_amount, 'entry_type', 'principal',
        'metadata', jsonb_build_object('role', 'profit_participation_source', 'entitlement_id', entitlement.id)),
      jsonb_build_object('wallet_id', beneficiary_wallet_id, 'direction', 'credit', 'amount', target_amount, 'entry_type', 'principal',
        'metadata', jsonb_build_object('role', 'profit_participation_beneficiary', 'participant_id', participant.id))
    ),
    target_idempotency_key,
    null,
    'SKIMA profit participation payout',
    jsonb_build_object('distributionId', distribution.id),
    jsonb_build_object('participantId', participant.id, 'internalWalletPayout', true)
  );

  payment_id := public.record_platform_profit_participant_payment(
    entitlement.id,
    target_amount,
    transaction_id,
    'SKIMA wallet transfer ' || transaction_id::text,
    target_idempotency_key || ':record'
  );

  return jsonb_build_object(
    'paymentId', payment_id,
    'financialTransactionId', transaction_id,
    'beneficiaryWalletId', beneficiary_wallet_id,
    'amount', target_amount,
    'currencyCode', distribution.currency_code
  );
end;
$$;

create or replace function public.pay_platform_vehicle_capital_repayment_to_wallet(
  target_repayment_id uuid,
  target_amount numeric,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  repayment public.platform_vehicle_capital_repayments%rowtype;
  distribution public.platform_profit_distributions%rowtype;
  agreement public.platform_vehicle_capital_agreements%rowtype;
  participant public.platform_profit_participants%rowtype;
  v_category_wallet_id uuid;
  beneficiary_wallet_id uuid;
  available_balance numeric(28,8) := 0;
  transaction_id uuid;
  payment_id uuid;
  original_committed_amount numeric(28,8);
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (
       public.is_platform_super_admin()
       or public.has_permission('platform.financial.manage', null)
     ) then
    raise exception using errcode = '42501', message = 'Finance permission is required to repay vehicle capital';
  end if;
  if target_amount is null or target_amount <= 0 or nullif(btrim(target_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'A positive principal repayment and idempotency key are required';
  end if;

  select * into repayment
  from public.platform_vehicle_capital_repayments
  where id = target_repayment_id
  for update;
  if repayment.id is null or repayment.status not in ('approved', 'partially_paid') then
    raise exception using errcode = '23514', message = 'Only an approved outstanding vehicle repayment can be paid';
  end if;
  if target_amount > repayment.principal_amount - repayment.paid_amount then
    raise exception using errcode = '23514', message = 'Payout exceeds the outstanding vehicle principal';
  end if;

  select * into distribution
  from public.platform_profit_distributions
  where id = repayment.distribution_id
  for update;
  if distribution.status not in ('approved', 'completed')
     or distribution.execution_status <> 'funded'
     or distribution.funding_transaction_id is null then
    raise exception using errcode = '23514', message = 'Fund the approved distribution before repaying vehicle capital';
  end if;

  select * into agreement
  from public.platform_vehicle_capital_agreements
  where id = repayment.agreement_id
  for update;
  select * into participant
  from public.platform_profit_participants
  where id = agreement.participant_id;
  if participant.profile_id is null then
    raise exception using errcode = '23514', message = 'Link this capital provider to a verified SKIMA profile before using an internal wallet payout';
  end if;
  if target_amount > agreement.principal_amount - agreement.principal_repaid then
    raise exception using errcode = '23514', message = 'Payout exceeds the provider original principal outstanding';
  end if;

  select allocation.category_wallet_id into v_category_wallet_id
  from public.platform_profit_distribution_allocations allocation
  where allocation.distribution_id = distribution.id
    and allocation.category_key = 'vehicle_repayment';
  if v_category_wallet_id is null then
    raise exception using errcode = '55000', message = 'The vehicle capital category has not been funded';
  end if;
  select coalesce(balance, 0) into available_balance
  from public.wallet_balances
  where wallet_id = v_category_wallet_id;
  if available_balance < target_amount then
    raise exception using errcode = '55000', message = 'The vehicle repayment category wallet does not have enough available funds';
  end if;

  beneficiary_wallet_id := public.ensure_platform_profit_beneficiary_wallet(
    participant.profile_id,
    distribution.currency_code,
    'profit-beneficiary-wallet:' || participant.profile_id::text || ':' || lower(distribution.currency_code)
  );

  transaction_id := public.post_financial_transaction(
    'transfer',
    distribution.currency_code,
    'platform.profit_capital.payout',
    'platform_vehicle_capital_repayment',
    repayment.id,
    jsonb_build_array(
      jsonb_build_object('wallet_id', v_category_wallet_id, 'direction', 'debit', 'amount', target_amount, 'entry_type', 'principal',
        'metadata', jsonb_build_object('role', 'vehicle_principal_source', 'repayment_id', repayment.id)),
      jsonb_build_object('wallet_id', beneficiary_wallet_id, 'direction', 'credit', 'amount', target_amount, 'entry_type', 'principal',
        'metadata', jsonb_build_object('role', 'vehicle_capital_provider', 'participant_id', participant.id, 'interestRatePercent', 0))
    ),
    target_idempotency_key,
    null,
    'SKIMA interest-free vehicle capital principal repayment',
    jsonb_build_object('distributionId', distribution.id, 'interestRatePercent', 0),
    jsonb_build_object('participantId', participant.id, 'internalWalletPayout', true, 'principalOnly', true)
  );

  select committed_amount into original_committed_amount
  from public.platform_profit_distribution_allocations
  where distribution_id = distribution.id and category_key = 'vehicle_repayment'
  for update;

  payment_id := public.record_platform_vehicle_capital_repayment(
    repayment.id,
    target_amount,
    transaction_id,
    'SKIMA vehicle principal transfer ' || transaction_id::text,
    target_idempotency_key || ':record'
  );

  -- The legacy recorder decrements committed_amount as a manual settlement is
  -- recorded. Restore the reserved amount here: the actual available funds are
  -- now reflected by the category wallet balance, not by reducing this snapshot.
  update public.platform_profit_distribution_allocations
  set committed_amount = coalesce(original_committed_amount, 0)
  where distribution_id = distribution.id and category_key = 'vehicle_repayment';

  return jsonb_build_object(
    'paymentId', payment_id,
    'financialTransactionId', transaction_id,
    'beneficiaryWalletId', beneficiary_wallet_id,
    'amount', target_amount,
    'currencyCode', distribution.currency_code,
    'interestRatePercent', 0
  );
end;
$$;

create or replace function public.read_platform_profit_capital_execution_workspace(
  target_currency_code text default 'NGN'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  currency text := upper(coalesce(nullif(btrim(target_currency_code), ''), 'NGN'));
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (
       public.is_platform_super_admin()
       or public.has_permission('platform.profit_capital.read', null)
       or public.has_permission('platform.profit_capital.manage', null)
       or public.has_permission('platform.financial.read', null)
       or public.has_permission('platform.financial.manage', null)
     ) then
    raise exception using errcode = '42501', message = 'Profit and capital finance read permission is required';
  end if;

  return jsonb_build_object(
    'currencyCode', currency,
    'periodClosings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', closing.id,
        'currencyCode', closing.currency_code,
        'periodStart', closing.period_start,
        'periodEnd', closing.period_end,
        'netPlatformRevenue', closing.net_platform_revenue,
        'operatingExpenses', closing.operating_expenses,
        'refundChargebackReserve', closing.refund_chargeback_reserve,
        'taxAndStatutoryReserve', closing.tax_and_statutory_reserve,
        'otherReserves', closing.other_reserves,
        'excludedCustomerCollections', closing.excluded_customer_collections,
        'excludedSupplierPassThrough', closing.excluded_supplier_pass_through,
        'excludedEscrowAndUnsettledFunds', closing.excluded_escrow_and_unsettled_funds,
        'distributableProfit', closing.distributable_profit,
        'reconciliationReference', closing.reconciliation_reference,
        'notes', closing.notes,
        'status', closing.status,
        'createdBy', closing.created_by,
        'approvedBy', closing.approved_by,
        'approvedAt', closing.approved_at,
        'createdAt', closing.created_at
      ) order by closing.period_end desc, closing.created_at desc)
      from (
        select * from public.platform_profit_period_closings
        where currency_code = currency
        order by period_end desc, created_at desc
        limit 100
      ) closing
    ), '[]'::jsonb),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', participant.id,
        'displayName', participant.display_name,
        'participantType', participant.participant_type,
        'profileId', participant.profile_id,
        'status', participant.status
      ) order by participant.display_name)
      from public.platform_profit_participants participant
      where participant.currency_code = currency
    ), '[]'::jsonb),
    'schedules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', schedule.id,
        'displayName', schedule.display_name,
        'currencyCode', schedule.currency_code,
        'frequency', schedule.frequency,
        'periodStart', schedule.period_start,
        'periodEnd', schedule.period_end,
        'nextRunAt', schedule.next_run_at,
        'status', schedule.status,
        'lastError', schedule.last_error,
        'lastDistributionId', schedule.last_distribution_id,
        'successfulRuns', schedule.successful_runs,
        'createdAt', schedule.created_at
      ) order by schedule.next_run_at)
      from (
        select * from public.platform_profit_distribution_schedules
        where currency_code = currency
        order by next_run_at
        limit 100
      ) schedule
    ), '[]'::jsonb),
    'categoryAccounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'categoryKey', account.category_key,
        'walletId', account.wallet_id,
        'balance', coalesce(balance.balance, 0),
        'currencyCode', account.currency_code
      ) order by account.category_key)
      from public.platform_profit_category_accounts account
      left join public.wallet_balances balance on balance.wallet_id = account.wallet_id
      where account.currency_code = currency
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.process_due_platform_profit_distribution_schedules(
  target_limit integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  schedule_record public.platform_profit_distribution_schedules%rowtype;
  close_id uuid;
  distribution_id uuid;
  next_start date;
  next_end date;
  next_run timestamptz;
  created_count integer := 0;
  waiting_count integer := 0;
  failed_count integer := 0;
  claimed_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'The scheduled profit distribution worker requires service-role access';
  end if;
  if target_limit is null or target_limit < 1 or target_limit > 100 then
    raise exception using errcode = '22023', message = 'target_limit must be between 1 and 100';
  end if;

  for schedule_record in
    select * from public.platform_profit_distribution_schedules
    where status = 'active'
      and next_run_at <= timezone('utc', now())
      and (last_attempt_at is null or last_attempt_at < timezone('utc', now()) - interval '5 minutes')
    order by next_run_at, created_at
    limit target_limit
    for update skip locked
  loop
    claimed_count := claimed_count + 1;
    begin
      select id into close_id
      from public.platform_profit_period_closings
      where currency_code = schedule_record.currency_code
        and period_start = schedule_record.period_start
        and period_end = schedule_record.period_end
        and status = 'approved'
      order by approved_at desc
      limit 1;

      if close_id is null then
        update public.platform_profit_distribution_schedules
        set last_attempt_at = timezone('utc', now()),
            last_error = 'Waiting for Finance to approve the matching period close',
            updated_at = timezone('utc', now())
        where id = schedule_record.id;
        waiting_count := waiting_count + 1;
        continue;
      end if;

      distribution_id := public.create_platform_profit_distribution_from_close(
        schedule_record.template_id,
        close_id,
        'profit-schedule:' || schedule_record.id::text || ':' || schedule_record.period_start::text
      );

      next_start := case schedule_record.frequency
        when 'weekly' then (schedule_record.period_start + 7)
        when 'fortnightly' then (schedule_record.period_start + 14)
        when 'monthly' then (schedule_record.period_start + interval '1 month')::date
        else (schedule_record.period_start + interval '3 months')::date
      end;
      next_end := case schedule_record.frequency
        when 'weekly' then (schedule_record.period_end + 7)
        when 'fortnightly' then (schedule_record.period_end + 14)
        when 'monthly' then (schedule_record.period_end + interval '1 month')::date
        else (schedule_record.period_end + interval '3 months')::date
      end;
      next_run := case schedule_record.frequency
        when 'weekly' then schedule_record.next_run_at + interval '7 days'
        when 'fortnightly' then schedule_record.next_run_at + interval '14 days'
        when 'monthly' then schedule_record.next_run_at + interval '1 month'
        else schedule_record.next_run_at + interval '3 months'
      end;

      update public.platform_profit_distribution_schedules
      set period_start = next_start,
          period_end = next_end,
          next_run_at = next_run,
          last_distribution_id = distribution_id,
          last_attempt_at = timezone('utc', now()),
          last_error = null,
          successful_runs = successful_runs + 1,
          updated_at = timezone('utc', now())
      where id = schedule_record.id;

      created_count := created_count + 1;
    exception when others then
      update public.platform_profit_distribution_schedules
      set last_attempt_at = timezone('utc', now()),
          last_error = left(sqlerrm, 1000),
          updated_at = timezone('utc', now())
      where id = schedule_record.id;
      failed_count := failed_count + 1;
    end;
  end loop;

  return jsonb_build_object(
    'claimed', claimed_count,
    'createdDrafts', created_count,
    'waitingForPeriodClose', waiting_count,
    'failed', failed_count
  );
end;
$$;

-- Allocation payments can only be posted once the approved run has been
-- backed by an actual movement from SKIMA's platform revenue account.
create or replace function public.require_funded_platform_profit_capital_payment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  distribution_id uuid;
  execution_status_value text;
begin
  if tg_table_name = 'platform_profit_participant_payments' then
    select entitlement.distribution_id into distribution_id
    from public.platform_profit_participant_entitlements entitlement
    where entitlement.id = new.entitlement_id;
  else
    select repayment.distribution_id into distribution_id
    from public.platform_vehicle_capital_repayments repayment
    where repayment.id = new.repayment_id;
  end if;

  select distribution.execution_status into execution_status_value
  from public.platform_profit_distributions distribution
  where distribution.id = distribution_id;

  if coalesce(execution_status_value, '') <> 'funded' then
    raise exception using errcode = '23514',
      message = 'Fund the approved distribution from SKIMA platform revenue before recording beneficiary payments';
  end if;
  return new;
end;
$$;

drop trigger if exists platform_profit_participant_payment_requires_funding
  on public.platform_profit_participant_payments;
create trigger platform_profit_participant_payment_requires_funding
before insert on public.platform_profit_participant_payments
for each row execute function public.require_funded_platform_profit_capital_payment();

drop trigger if exists platform_vehicle_capital_payment_requires_funding
  on public.platform_vehicle_capital_repayment_payments;
create trigger platform_vehicle_capital_payment_requires_funding
before insert on public.platform_vehicle_capital_repayment_payments
for each row execute function public.require_funded_platform_profit_capital_payment();

comment on table public.platform_profit_period_closings is
  'Finance-approved period close derived only from posted platform_revenue wallet movements. Customer collections, escrow, unsettled cash and supplier pass-through funds are recorded as exclusions and are never queried into the revenue base.';
comment on table public.platform_profit_category_accounts is
  'Separate ledger-backed wallets for each approved profit allocation category. Funding is debited from SKIMA platform_revenue, never customer, escrow, supplier or platform clearing accounts.';
comment on function public.process_due_platform_profit_distribution_schedules(integer) is
  'Runs recurring profit calculations from approved period closes. It creates draft distributions only; it never auto-approves or pays a beneficiary.';
comment on function public.fund_platform_profit_distribution(uuid,text) is
  'Moves an approved distribution from the SKIMA platform revenue wallet to six category wallets through the balanced financial posting engine.';

revoke all on function public.save_platform_profit_period_close(text,date,date,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,text)
  from public, anon;
revoke all on function public.approve_platform_profit_period_close(uuid)
  from public, anon;
revoke all on function public.save_platform_profit_distribution_schedule(text,text,uuid,text,date,date,timestamptz,text,text)
  from public, anon;
revoke all on function public.set_platform_profit_distribution_schedule_status(uuid,text)
  from public, anon;
revoke all on function public.ensure_platform_profit_category_wallet(text,text)
  from public, anon;
revoke all on function public.create_platform_profit_distribution_from_close(uuid,uuid,text)
  from public, anon;
revoke all on function public.fund_platform_profit_distribution(uuid,text)
  from public, anon;
revoke all on function public.ensure_platform_profit_beneficiary_wallet(uuid,text,text)
  from public, anon, authenticated;
revoke all on function public.link_platform_profit_participant_profile(uuid,uuid)
  from public, anon;
revoke all on function public.pay_platform_profit_participant_entitlement_to_wallet(uuid,numeric,text)
  from public, anon;
revoke all on function public.pay_platform_vehicle_capital_repayment_to_wallet(uuid,numeric,text)
  from public, anon;
revoke all on function public.read_platform_profit_capital_execution_workspace(text)
  from public, anon;
revoke all on function public.process_due_platform_profit_distribution_schedules(integer)
  from public, anon;
revoke all on function public.require_funded_platform_profit_capital_payment()
  from public, anon, authenticated, service_role;

grant execute on function public.save_platform_profit_period_close(text,date,date,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,text)
  to authenticated, service_role;
grant execute on function public.approve_platform_profit_period_close(uuid)
  to authenticated, service_role;
grant execute on function public.save_platform_profit_distribution_schedule(text,text,uuid,text,date,date,timestamptz,text,text)
  to authenticated, service_role;
grant execute on function public.set_platform_profit_distribution_schedule_status(uuid,text)
  to authenticated, service_role;
grant execute on function public.ensure_platform_profit_category_wallet(text,text)
  to authenticated, service_role;
grant execute on function public.create_platform_profit_distribution_from_close(uuid,uuid,text)
  to authenticated, service_role;
grant execute on function public.fund_platform_profit_distribution(uuid,text)
  to authenticated, service_role;
grant execute on function public.ensure_platform_profit_beneficiary_wallet(uuid,text,text)
  to service_role;
grant execute on function public.link_platform_profit_participant_profile(uuid,uuid)
  to authenticated, service_role;
grant execute on function public.pay_platform_profit_participant_entitlement_to_wallet(uuid,numeric,text)
  to authenticated, service_role;
grant execute on function public.pay_platform_vehicle_capital_repayment_to_wallet(uuid,numeric,text)
  to authenticated, service_role;
grant execute on function public.read_platform_profit_capital_execution_workspace(text)
  to authenticated, service_role;
grant execute on function public.process_due_platform_profit_distribution_schedules(integer)
  to service_role;

-- Only close-backed distributions can be requested by Finance Admins. The
-- lower-level amount-based function remains service-role only for controlled
-- worker and migration operations.
revoke execute on function public.create_platform_profit_distribution(uuid,text,date,date,numeric,text,text)
  from authenticated;
grant execute on function public.create_platform_profit_distribution(uuid,text,date,date,numeric,text,text)
  to service_role;

notify pgrst, 'reload schema';

commit;