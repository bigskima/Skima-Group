begin;

insert into public.permissions (key, description, risk_level)
values
  ('platform.profit_capital.read', 'Read SKIMA profit allocation, participation and vehicle capital schedules.', 'high'),
  ('platform.profit_capital.manage', 'Configure SKIMA profit allocations, capital agreements and distribution approvals.', 'critical')
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    updated_at = timezone('utc', now());

alter table public.lpg_customer_locations
  add column if not exists is_default boolean not null default false;

with ranked as (
  select id,
         row_number() over (
           partition by owner_user_id
           order by created_at asc, id asc
         ) as position
  from public.lpg_customer_locations
  where status = 'active'
)
update public.lpg_customer_locations location
set is_default = (ranked.position = 1)
from ranked
where ranked.id = location.id
  and location.is_default = false;

create unique index if not exists lpg_customer_locations_one_default_per_owner
  on public.lpg_customer_locations (owner_user_id)
  where is_default = true and status = 'active';

create or replace function public.ensure_first_lpg_customer_location_default()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT'
     and new.status = 'active'
     and not exists (
       select 1
       from public.lpg_customer_locations current_default
       where current_default.owner_user_id = new.owner_user_id
         and current_default.is_default = true
         and current_default.status = 'active'
     ) then
    new.is_default := true;
  end if;

  if new.status <> 'active' then
    new.is_default := false;
  end if;

  if new.is_default then
    update public.lpg_customer_locations
    set is_default = false,
        updated_at = timezone('utc', now())
    where owner_user_id = new.owner_user_id
      and id is distinct from new.id
      and is_default = true;
  end if;

  return new;
end;
$$;

drop trigger if exists lpg_customer_location_default_guard
  on public.lpg_customer_locations;
create trigger lpg_customer_location_default_guard
before insert or update of is_default, status, owner_user_id
on public.lpg_customer_locations
for each row
execute function public.ensure_first_lpg_customer_location_default();

create or replace function public.maintain_lpg_customer_location_default_after_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  fallback_id uuid;
begin
  if new.status = 'active' and not exists (
    select 1 from public.lpg_customer_locations candidate
    where candidate.owner_user_id = new.owner_user_id
      and candidate.status = 'active'
      and candidate.is_default = true
  ) then
    update public.lpg_customer_locations
    set is_default = true, updated_at = timezone('utc', now())
    where id = new.id;
  elsif old.is_default = true and new.status <> 'active' then
    select id into fallback_id
    from public.lpg_customer_locations candidate
    where candidate.owner_user_id = new.owner_user_id
      and candidate.status = 'active'
      and candidate.id <> new.id
    order by candidate.created_at, candidate.id
    limit 1;
    if fallback_id is not null then
      update public.lpg_customer_locations
      set is_default = true, updated_at = timezone('utc', now())
      where id = fallback_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists lpg_customer_location_default_fallback
  on public.lpg_customer_locations;
create trigger lpg_customer_location_default_fallback
after update of status
on public.lpg_customer_locations
for each row
when (old.status is distinct from new.status)
execute function public.maintain_lpg_customer_location_default_after_status_change();

create or replace function public.set_lpg_customer_location_default(
  target_location_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  location_owner uuid := auth.uid();
  selected_location uuid;
begin
  if location_owner is null then
    raise exception using errcode = '42501', message = 'Sign in to choose a preferred address';
  end if;

  select id
  into selected_location
  from public.lpg_customer_locations
  where id = target_location_id
    and owner_user_id = location_owner
    and status = 'active'
  for update;

  if selected_location is null then
    raise exception using errcode = 'P0002', message = 'Saved address was not found or is not active';
  end if;

  update public.lpg_customer_locations
  set is_default = false,
      updated_at = timezone('utc', now())
  where owner_user_id = location_owner
    and status = 'active'
    and is_default = true
    and id <> selected_location;

  update public.lpg_customer_locations
  set is_default = true,
      updated_at = timezone('utc', now())
  where id = selected_location
    and owner_user_id = location_owner;

  return selected_location;
end;
$$;

revoke all on function public.ensure_first_lpg_customer_location_default()
  from public, anon, authenticated, service_role;
revoke all on function public.maintain_lpg_customer_location_default_after_status_change()
  from public, anon, authenticated, service_role;
revoke all on function public.set_lpg_customer_location_default(uuid)
  from public, anon;
grant execute on function public.set_lpg_customer_location_default(uuid)
  to authenticated, service_role;

create table if not exists public.platform_profit_allocation_templates (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(btrim(display_name)) between 3 and 100),
  idempotency_key text not null unique,
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  notes text,
  version integer not null default 1 check (version > 0),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  activated_by uuid references public.profiles(id) on delete set null,
  activated_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists platform_profit_allocation_one_active_per_currency
  on public.platform_profit_allocation_templates(currency_code)
  where status = 'active';

create table if not exists public.platform_profit_allocation_template_lines (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.platform_profit_allocation_templates(id) on delete cascade,
  category_key text not null check (category_key in (
    'platform_expenses',
    'vehicle_repayment',
    'skima_savings',
    'daily_expenses',
    'staff_payment',
    'investment_savings'
  )),
  allocation_percent numeric(7,4) not null check (allocation_percent >= 0 and allocation_percent <= 100),
  created_at timestamptz not null default timezone('utc', now()),
  unique (template_id, category_key)
);

create table if not exists public.platform_profit_participants (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 160),
  participant_type text not null check (participant_type in ('profit_only', 'vehicle_provider', 'both')),
  contact_email text,
  contact_phone text,
  profile_id uuid references public.profiles(id) on delete set null,
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  profit_share_percent numeric(9,6) not null default 0
    check (profit_share_percent >= 0 and profit_share_percent <= 100),
  funding_category text not null default 'skima_savings' check (funding_category in (
    'platform_expenses',
    'vehicle_repayment',
    'skima_savings',
    'daily_expenses',
    'staff_payment',
    'investment_savings'
  )),
  status text not null default 'active' check (status in ('active', 'paused', 'closed')),
  notes text,
  idempotency_key text not null unique,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (participant_type <> 'vehicle_provider' or profit_share_percent >= 0)
);

create index if not exists platform_profit_participants_currency_status_idx
  on public.platform_profit_participants(currency_code, status);

create table if not exists public.platform_vehicle_capital_agreements (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.platform_profit_participants(id) on delete restrict,
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  vehicle_description text not null check (char_length(btrim(vehicle_description)) between 3 and 180),
  registration_number text,
  agreement_reference text not null check (char_length(btrim(agreement_reference)) between 3 and 100),
  principal_amount numeric(28,8) not null check (principal_amount > 0),
  principal_repaid numeric(28,8) not null default 0 check (principal_repaid >= 0),
  status text not null default 'active' check (status in ('active', 'paused', 'fully_repaid', 'closed')),
  interest_rate_percent numeric(7,4) not null default 0 check (interest_rate_percent = 0),
  notes text,
  idempotency_key text not null unique,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (principal_repaid <= principal_amount)
);

create index if not exists platform_vehicle_capital_agreements_status_idx
  on public.platform_vehicle_capital_agreements(currency_code, status);

create table if not exists public.platform_profit_distributions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.platform_profit_allocation_templates(id) on delete restrict,
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  period_start date not null,
  period_end date not null,
  distributable_profit numeric(28,8) not null check (distributable_profit > 0),
  status text not null default 'draft' check (status in ('draft', 'approved', 'completed', 'cancelled')),
  notes text,
  template_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(template_snapshot) = 'object'),
  idempotency_key text not null unique,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (period_end >= period_start)
);

create unique index if not exists platform_profit_distribution_period_unique
  on public.platform_profit_distributions(currency_code, period_start, period_end)
  where status <> 'cancelled';

create table if not exists public.platform_profit_distribution_allocations (
  id uuid primary key default gen_random_uuid(),
  distribution_id uuid not null references public.platform_profit_distributions(id) on delete restrict,
  category_key text not null check (category_key in (
    'platform_expenses',
    'vehicle_repayment',
    'skima_savings',
    'daily_expenses',
    'staff_payment',
    'investment_savings'
  )),
  allocation_percent numeric(7,4) not null check (allocation_percent >= 0 and allocation_percent <= 100),
  allocated_amount numeric(28,8) not null check (allocated_amount >= 0),
  committed_amount numeric(28,8) not null default 0 check (committed_amount >= 0),
  unique (distribution_id, category_key)
);

create table if not exists public.platform_profit_participant_entitlements (
  id uuid primary key default gen_random_uuid(),
  distribution_id uuid not null references public.platform_profit_distributions(id) on delete restrict,
  participant_id uuid not null references public.platform_profit_participants(id) on delete restrict,
  funding_category text not null check (funding_category in (
    'platform_expenses',
    'vehicle_repayment',
    'skima_savings',
    'daily_expenses',
    'staff_payment',
    'investment_savings'
  )),
  profit_basis_amount numeric(28,8) not null check (profit_basis_amount >= 0),
  share_percent numeric(9,6) not null check (share_percent >= 0 and share_percent <= 100),
  entitlement_amount numeric(28,8) not null check (entitlement_amount >= 0),
  paid_amount numeric(28,8) not null default 0 check (paid_amount >= 0),
  status text not null default 'calculated' check (status in ('calculated', 'approved', 'partially_paid', 'paid', 'cancelled')),
  created_at timestamptz not null default timezone('utc', now()),
  unique (distribution_id, participant_id),
  check (paid_amount <= entitlement_amount)
);

create table if not exists public.platform_vehicle_capital_repayments (
  id uuid primary key default gen_random_uuid(),
  distribution_id uuid not null references public.platform_profit_distributions(id) on delete restrict,
  agreement_id uuid not null references public.platform_vehicle_capital_agreements(id) on delete restrict,
  principal_amount numeric(28,8) not null check (principal_amount > 0),
  paid_amount numeric(28,8) not null default 0 check (paid_amount >= 0),
  status text not null default 'calculated' check (status in ('calculated', 'approved', 'partially_paid', 'paid', 'cancelled')),
  created_at timestamptz not null default timezone('utc', now()),
  unique (distribution_id, agreement_id),
  check (paid_amount <= principal_amount)
);

create table if not exists public.platform_profit_participant_payments (
  id uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null references public.platform_profit_participant_entitlements(id) on delete restrict,
  amount numeric(28,8) not null check (amount > 0),
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  financial_transaction_id uuid not null references public.financial_transactions(id) on delete restrict,
  external_reference text not null check (char_length(btrim(external_reference)) between 3 and 160),
  idempotency_key text not null unique,
  paid_by uuid references public.profiles(id) on delete set null default auth.uid(),
  paid_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (financial_transaction_id)
);

create table if not exists public.platform_vehicle_capital_repayment_payments (
  id uuid primary key default gen_random_uuid(),
  repayment_id uuid not null references public.platform_vehicle_capital_repayments(id) on delete restrict,
  amount numeric(28,8) not null check (amount > 0),
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  financial_transaction_id uuid not null references public.financial_transactions(id) on delete restrict,
  external_reference text not null check (char_length(btrim(external_reference)) between 3 and 160),
  idempotency_key text not null unique,
  paid_by uuid references public.profiles(id) on delete set null default auth.uid(),
  paid_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (financial_transaction_id)
);

-- A ledger transaction may satisfy exactly one participant or vehicle payment.
-- The primary key makes the claim atomic even when two Admins submit at once.
create table if not exists public.platform_profit_capital_transaction_claims (
  financial_transaction_id uuid primary key references public.financial_transactions(id) on delete restrict,
  payment_kind text not null check (payment_kind in ('profit_participation', 'vehicle_principal')),
  payment_record_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (payment_kind, payment_record_id)
);

create table if not exists public.platform_profit_capital_audit_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  actor_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists platform_profit_distributions_created_idx
  on public.platform_profit_distributions(created_at desc);
create index if not exists platform_profit_capital_audit_created_idx
  on public.platform_profit_capital_audit_events(created_at desc);

alter table public.platform_profit_allocation_templates enable row level security;
alter table public.platform_profit_allocation_template_lines enable row level security;
alter table public.platform_profit_participants enable row level security;
alter table public.platform_vehicle_capital_agreements enable row level security;
alter table public.platform_profit_distributions enable row level security;
alter table public.platform_profit_distribution_allocations enable row level security;
alter table public.platform_profit_participant_entitlements enable row level security;
alter table public.platform_vehicle_capital_repayments enable row level security;
alter table public.platform_profit_participant_payments enable row level security;
alter table public.platform_vehicle_capital_repayment_payments enable row level security;
alter table public.platform_profit_capital_transaction_claims enable row level security;
alter table public.platform_profit_capital_audit_events enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'platform_profit_allocation_templates',
    'platform_profit_allocation_template_lines',
    'platform_profit_participants',
    'platform_vehicle_capital_agreements',
    'platform_profit_distributions',
    'platform_profit_distribution_allocations',
    'platform_profit_participant_entitlements',
    'platform_vehicle_capital_repayments',
    'platform_profit_participant_payments',
    'platform_vehicle_capital_repayment_payments',
    'platform_profit_capital_audit_events'
  ]
  loop
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
  end loop;
end;
$$;

revoke all on table public.platform_profit_capital_transaction_claims
  from public, anon, authenticated;

create policy platform_profit_allocation_templates_finance_read
on public.platform_profit_allocation_templates
for select to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.profit_capital.read', null)
  or public.has_permission('platform.profit_capital.manage', null)
  or public.has_permission('platform.financial.read', null)
  or public.has_permission('platform.financial.manage', null)
);

create policy platform_profit_allocation_lines_finance_read
on public.platform_profit_allocation_template_lines
for select to authenticated
using (exists (
  select 1 from public.platform_profit_allocation_templates parent
  where parent.id = template_id
    and (
      public.is_platform_super_admin()
      or public.has_permission('platform.profit_capital.read', null)
      or public.has_permission('platform.profit_capital.manage', null)
      or public.has_permission('platform.financial.read', null)
      or public.has_permission('platform.financial.manage', null)
    )
));

do $$
declare
  table_name text;
  policy_name text;
begin
  foreach table_name in array array[
    'platform_profit_participants',
    'platform_vehicle_capital_agreements',
    'platform_profit_distributions',
    'platform_profit_distribution_allocations',
    'platform_profit_participant_entitlements',
    'platform_vehicle_capital_repayments',
    'platform_profit_participant_payments',
    'platform_vehicle_capital_repayment_payments',
    'platform_profit_capital_audit_events'
  ]
  loop
    policy_name := table_name || '_finance_read';
    execute format(
      'create policy %I on public.%I for select to authenticated using (
         public.is_platform_super_admin()
         or public.has_permission(''platform.profit_capital.read'', null)
         or public.has_permission(''platform.profit_capital.manage'', null)
         or public.has_permission(''platform.financial.read'', null)
         or public.has_permission(''platform.financial.manage'', null)
       )',
      policy_name, table_name
    );
  end loop;
end;
$$;

create or replace function public.read_platform_profit_capital_workspace(
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
  result jsonb;
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

  select jsonb_build_object(
    'currencyCode', currency,
    'templates', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', template.id,
          'displayName', template.display_name,
          'currencyCode', template.currency_code,
          'status', template.status,
          'version', template.version,
          'notes', template.notes,
          'createdAt', template.created_at,
          'activatedAt', template.activated_at,
          'lines', coalesce((
            select jsonb_agg(jsonb_build_object(
              'categoryKey', line.category_key,
              'allocationPercent', line.allocation_percent
            ) order by line.category_key)
            from public.platform_profit_allocation_template_lines line
            where line.template_id = template.id
          ), '[]'::jsonb)
        ) order by template.created_at desc
      )
      from public.platform_profit_allocation_templates template
      where template.currency_code = currency
    ), '[]'::jsonb),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', participant.id,
        'displayName', participant.display_name,
        'participantType', participant.participant_type,
        'contactEmail', participant.contact_email,
        'contactPhone', participant.contact_phone,
        'currencyCode', participant.currency_code,
        'profitSharePercent', participant.profit_share_percent,
        'fundingCategory', participant.funding_category,
        'status', participant.status,
        'notes', participant.notes,
        'createdAt', participant.created_at
      ) order by participant.created_at desc)
      from public.platform_profit_participants participant
      where participant.currency_code = currency
    ), '[]'::jsonb),
    'vehicleAgreements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', agreement.id,
        'participantId', agreement.participant_id,
        'participantName', participant.display_name,
        'vehicleDescription', agreement.vehicle_description,
        'registrationNumber', agreement.registration_number,
        'agreementReference', agreement.agreement_reference,
        'currencyCode', agreement.currency_code,
        'principalAmount', agreement.principal_amount,
        'principalRepaid', agreement.principal_repaid,
        'outstandingPrincipal', agreement.principal_amount - agreement.principal_repaid,
        'status', agreement.status,
        'interestRatePercent', agreement.interest_rate_percent,
        'notes', agreement.notes,
        'createdAt', agreement.created_at
      ) order by agreement.created_at desc)
      from public.platform_vehicle_capital_agreements agreement
      join public.platform_profit_participants participant on participant.id = agreement.participant_id
      where agreement.currency_code = currency
    ), '[]'::jsonb),
    'distributions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', distribution.id,
        'periodStart', distribution.period_start,
        'periodEnd', distribution.period_end,
        'distributableProfit', distribution.distributable_profit,
        'currencyCode', distribution.currency_code,
        'status', distribution.status,
        'notes', distribution.notes,
        'createdAt', distribution.created_at,
        'approvedAt', distribution.approved_at,
        'allocations', coalesce((
          select jsonb_agg(jsonb_build_object(
            'categoryKey', allocation.category_key,
            'allocationPercent', allocation.allocation_percent,
            'allocatedAmount', allocation.allocated_amount,
            'committedAmount', allocation.committed_amount,
            'uncommittedAmount', allocation.allocated_amount - allocation.committed_amount
          ) order by allocation.category_key)
          from public.platform_profit_distribution_allocations allocation
          where allocation.distribution_id = distribution.id
        ), '[]'::jsonb),
        'participantEntitlements', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', entitlement.id,
            'participantId', entitlement.participant_id,
            'participantName', participant.display_name,
            'fundingCategory', entitlement.funding_category,
            'sharePercent', entitlement.share_percent,
            'entitlementAmount', entitlement.entitlement_amount,
            'paidAmount', entitlement.paid_amount,
            'outstandingAmount', entitlement.entitlement_amount - entitlement.paid_amount,
            'status', entitlement.status
          ) order by participant.display_name)
          from public.platform_profit_participant_entitlements entitlement
          join public.platform_profit_participants participant on participant.id = entitlement.participant_id
          where entitlement.distribution_id = distribution.id
        ), '[]'::jsonb),
        'vehicleRepayments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', repayment.id,
            'agreementId', repayment.agreement_id,
            'participantName', participant.display_name,
            'vehicleDescription', agreement.vehicle_description,
            'principalAmount', repayment.principal_amount,
            'paidAmount', repayment.paid_amount,
            'outstandingAmount', repayment.principal_amount - repayment.paid_amount,
            'status', repayment.status
          ) order by participant.display_name)
          from public.platform_vehicle_capital_repayments repayment
          join public.platform_vehicle_capital_agreements agreement on agreement.id = repayment.agreement_id
          join public.platform_profit_participants participant on participant.id = agreement.participant_id
          where repayment.distribution_id = distribution.id
        ), '[]'::jsonb)
      ) order by distribution.created_at desc)
      from (
        select * from public.platform_profit_distributions
        where currency_code = currency
        order by created_at desc
        limit 30
      ) distribution
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

create or replace function public.save_platform_profit_allocation_template(
  target_template_id uuid,
  target_display_name text,
  target_currency_code text,
  target_lines jsonb,
  target_idempotency_key text,
  target_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_template_id uuid;
  existing_template public.platform_profit_allocation_templates%rowtype;
  currency text := upper(btrim(target_currency_code));
  row_item jsonb;
  row_count integer := 0;
  total_percent numeric(12,4) := 0;
  allowed_categories text[] := array[
    'platform_expenses',
    'vehicle_repayment',
    'skima_savings',
    'daily_expenses',
    'staff_payment',
    'investment_savings'
  ];
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_platform_super_admin() or public.has_permission('platform.profit_capital.manage', null)
       or public.has_permission('platform.financial.manage', null)) then
    raise exception using errcode = '42501', message = 'Profit and capital finance management permission is required';
  end if;
  if nullif(btrim(target_display_name), '') is null
     or nullif(btrim(target_idempotency_key), '') is null
     or jsonb_typeof(target_lines) <> 'array' then
    raise exception using errcode = '22023', message = 'Template name, six allocation lines and idempotency key are required';
  end if;
  if not exists (select 1 from public.currency_definitions where code = currency and status = 'enabled') then
    raise exception using errcode = '22023', message = 'Choose an enabled platform currency';
  end if;

  for row_item in select value from jsonb_array_elements(target_lines)
  loop
    if not (row_item ? 'categoryKey' and row_item ? 'allocationPercent')
       or (row_item->>'categoryKey') <> all(allowed_categories)
       or coalesce(row_item->>'allocationPercent', '') !~ '^[0-9]+(\.[0-9]{1,4})?$' then
      raise exception using errcode = '22023', message = 'Each allocation line must have a valid category and percentage';
    end if;
    row_count := row_count + 1;
    total_percent := total_percent + (row_item->>'allocationPercent')::numeric;
  end loop;

  if row_count <> 6 or total_percent <> 100 then
    raise exception using errcode = '23514', message = 'All six allocation categories must total exactly 100%';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(target_lines) as allocation_item(item)
    group by item->>'categoryKey'
    having count(*) > 1
  ) then
    raise exception using errcode = '23514', message = 'Each allocation category can appear only once';
  end if;

  if target_template_id is null then
    select * into existing_template
    from public.platform_profit_allocation_templates
    where idempotency_key = target_idempotency_key;
    if existing_template.id is not null then
      if existing_template.display_name <> btrim(target_display_name)
         or existing_template.currency_code <> currency
         or coalesce(existing_template.notes, '') <> coalesce(nullif(btrim(target_notes), ''), '') then
        raise exception using errcode = '23505', message = 'Template idempotency key was already used with different details';
      end if;
      return existing_template.id;
    end if;

    insert into public.platform_profit_allocation_templates(
      display_name, currency_code, notes, idempotency_key
    )
    values (
      btrim(target_display_name), currency, nullif(btrim(target_notes), ''), target_idempotency_key
    )
    returning id into v_template_id;
  else
    update public.platform_profit_allocation_templates
    set display_name = btrim(target_display_name),
        notes = nullif(btrim(target_notes), ''),
        updated_at = timezone('utc', now()),
        version = version + 1
    where id = target_template_id
      and status = 'draft'
    returning id into v_template_id;
    if v_template_id is null then
      raise exception using errcode = '23514', message = 'Only a draft allocation template can be edited';
    end if;
    delete from public.platform_profit_allocation_template_lines line where line.template_id = v_template_id;
  end if;

  insert into public.platform_profit_allocation_template_lines(template_id, category_key, allocation_percent)
  select v_template_id, item->>'categoryKey', (item->>'allocationPercent')::numeric
  from jsonb_array_elements(target_lines) as allocation_item(item);

  insert into public.platform_profit_capital_audit_events(entity_type, entity_id, action, metadata)
  values ('allocation_template', v_template_id, 'saved', jsonb_build_object('currencyCode', currency, 'totalPercent', total_percent));

  return v_template_id;
end;
$$;

create or replace function public.activate_platform_profit_allocation_template(
  target_template_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  selected_template public.platform_profit_allocation_templates%rowtype;
  line_count integer;
  total_percent numeric(12,4);
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_platform_super_admin() or public.has_permission('platform.profit_capital.manage', null)
       or public.has_permission('platform.financial.manage', null)) then
    raise exception using errcode = '42501', message = 'Profit and capital finance management permission is required';
  end if;

  select * into selected_template
  from public.platform_profit_allocation_templates
  where id = target_template_id
  for update;

  if selected_template.id is null or selected_template.status not in ('draft', 'active') then
    raise exception using errcode = 'P0002', message = 'Draft allocation template not found';
  end if;

  select count(*), coalesce(sum(allocation_percent), 0)
  into line_count, total_percent
  from public.platform_profit_allocation_template_lines
  where template_id = target_template_id;

  if line_count <> 6 or total_percent <> 100 then
    raise exception using errcode = '23514', message = 'The six allocation categories must total exactly 100%';
  end if;

  update public.platform_profit_allocation_templates
  set status = 'archived', updated_at = timezone('utc', now())
  where currency_code = selected_template.currency_code
    and status = 'active'
    and id <> target_template_id;

  update public.platform_profit_allocation_templates
  set status = 'active',
      activated_by = auth.uid(),
      activated_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = target_template_id;

  insert into public.platform_profit_capital_audit_events(entity_type, entity_id, action, metadata)
  values ('allocation_template', target_template_id, 'activated', jsonb_build_object('currencyCode', selected_template.currency_code));

  return target_template_id;
end;
$$;

create or replace function public.save_platform_profit_participant(
  target_participant_id uuid,
  target_display_name text,
  target_participant_type text,
  target_contact_email text,
  target_contact_phone text,
  target_currency_code text,
  target_profit_share_percent numeric,
  target_funding_category text,
  target_status text,
  target_idempotency_key text,
  target_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  participant_id uuid;
  existing_participant public.platform_profit_participants%rowtype;
  currency text := upper(btrim(target_currency_code));
  existing_type text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_platform_super_admin() or public.has_permission('platform.profit_capital.manage', null)
       or public.has_permission('platform.financial.manage', null)) then
    raise exception using errcode = '42501', message = 'Profit and capital finance management permission is required';
  end if;
  if char_length(btrim(coalesce(target_display_name, ''))) < 2
     or target_participant_type not in ('profit_only', 'vehicle_provider', 'both')
     or target_status not in ('active', 'paused', 'closed')
     or target_funding_category not in (
       'platform_expenses','vehicle_repayment','skima_savings','daily_expenses','staff_payment','investment_savings'
     )
     or target_profit_share_percent is null or target_profit_share_percent < 0 or target_profit_share_percent > 100
     or nullif(btrim(target_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'Participant details, share percentage and idempotency key are required';
  end if;
  if target_participant_type = 'profit_only' and target_profit_share_percent = 0 then
    raise exception using errcode = '22023', message = 'A profit-only participant needs a profit participation percentage greater than zero';
  end if;
  if target_participant_type = 'vehicle_provider' and target_profit_share_percent > 0 then
    raise exception using errcode = '22023', message = 'Choose both when a vehicle provider also receives profit participation';
  end if;
  if not exists (select 1 from public.currency_definitions where code = currency and status = 'enabled') then
    raise exception using errcode = '22023', message = 'Choose an enabled platform currency';
  end if;

  if target_participant_id is null then
    select * into existing_participant
    from public.platform_profit_participants
    where idempotency_key = target_idempotency_key
    for update;
    if existing_participant.id is not null then
      if existing_participant.display_name <> btrim(target_display_name)
         or existing_participant.participant_type <> target_participant_type
         or coalesce(existing_participant.contact_email, '') <> coalesce(nullif(btrim(target_contact_email), ''), '')
         or coalesce(existing_participant.contact_phone, '') <> coalesce(nullif(btrim(target_contact_phone), ''), '')
         or existing_participant.currency_code <> currency
         or existing_participant.profit_share_percent <> target_profit_share_percent
         or existing_participant.funding_category <> target_funding_category
         or existing_participant.status <> target_status
         or coalesce(existing_participant.notes, '') <> coalesce(nullif(btrim(target_notes), ''), '') then
        raise exception using errcode = '23505', message = 'Participant idempotency key was already used with different details';
      end if;
      return existing_participant.id;
    end if;

    insert into public.platform_profit_participants(
      display_name, participant_type, contact_email, contact_phone, currency_code,
      profit_share_percent, funding_category, status, notes, idempotency_key
    )
    values (
      btrim(target_display_name), target_participant_type,
      nullif(btrim(target_contact_email), ''), nullif(btrim(target_contact_phone), ''),
      currency, target_profit_share_percent, target_funding_category, target_status,
      nullif(btrim(target_notes), ''), target_idempotency_key
    )
    returning id into participant_id;
  else
    select participant_type into existing_type
    from public.platform_profit_participants
    where id = target_participant_id
    for update;
    if existing_type is null then
      raise exception using errcode = 'P0002', message = 'Profit participant was not found';
    end if;
    update public.platform_profit_participants
    set display_name = btrim(target_display_name),
        participant_type = target_participant_type,
        contact_email = nullif(btrim(target_contact_email), ''),
        contact_phone = nullif(btrim(target_contact_phone), ''),
        currency_code = currency,
        profit_share_percent = target_profit_share_percent,
        funding_category = target_funding_category,
        status = target_status,
        notes = nullif(btrim(target_notes), ''),
        updated_at = timezone('utc', now())
    where id = target_participant_id;
    participant_id := target_participant_id;
  end if;

  if target_status = 'active' and target_profit_share_percent > 0 then
    if (
      select coalesce(sum(profit_share_percent), 0)
      from public.platform_profit_participants
      where currency_code = currency
        and status = 'active'
        and id <> participant_id
    ) + target_profit_share_percent > 100 then
      raise exception using errcode = '23514', message = 'Active profit participation percentages cannot exceed 100% in a currency';
    end if;
  end if;

  insert into public.platform_profit_capital_audit_events(entity_type, entity_id, action, metadata)
  values ('profit_participant', participant_id, case when target_participant_id is null then 'created' else 'updated' end,
    jsonb_build_object('participantType', target_participant_type, 'profitSharePercent', target_profit_share_percent, 'status', target_status));

  return participant_id;
end;
$$;

create or replace function public.save_platform_vehicle_capital_agreement(
  target_agreement_id uuid,
  target_participant_id uuid,
  target_vehicle_description text,
  target_registration_number text,
  target_agreement_reference text,
  target_currency_code text,
  target_principal_amount numeric,
  target_status text,
  target_idempotency_key text,
  target_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  agreement_id uuid;
  participant public.platform_profit_participants%rowtype;
  existing_agreement public.platform_vehicle_capital_agreements%rowtype;
  existing_repaid numeric(28,8) := 0;
  currency text := upper(btrim(target_currency_code));
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_platform_super_admin() or public.has_permission('platform.profit_capital.manage', null)
       or public.has_permission('platform.financial.manage', null)) then
    raise exception using errcode = '42501', message = 'Profit and capital finance management permission is required';
  end if;
  if nullif(btrim(target_vehicle_description), '') is null
     or nullif(btrim(target_agreement_reference), '') is null
     or target_principal_amount is null or target_principal_amount <= 0
     or target_status not in ('active', 'paused', 'closed')
     or nullif(btrim(target_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'Vehicle details, positive principal, agreement reference and idempotency key are required';
  end if;

  if target_agreement_id is null then
    select * into existing_agreement
    from public.platform_vehicle_capital_agreements
    where idempotency_key = target_idempotency_key
    for update;
    if existing_agreement.id is not null then
      if existing_agreement.participant_id <> target_participant_id
         or existing_agreement.currency_code <> currency
         or existing_agreement.vehicle_description <> btrim(target_vehicle_description)
         or coalesce(existing_agreement.registration_number, '') <> coalesce(nullif(btrim(target_registration_number), ''), '')
         or existing_agreement.agreement_reference <> btrim(target_agreement_reference)
         or existing_agreement.principal_amount <> target_principal_amount
         or existing_agreement.status <> target_status
         or coalesce(existing_agreement.notes, '') <> coalesce(nullif(btrim(target_notes), ''), '') then
        raise exception using errcode = '23505', message = 'Vehicle agreement idempotency key was already used with different details';
      end if;
      return existing_agreement.id;
    end if;
  end if;

  select * into participant from public.platform_profit_participants
  where id = target_participant_id and status <> 'closed';
  if participant.id is null or participant.participant_type not in ('vehicle_provider', 'both') then
    raise exception using errcode = '23514', message = 'Select an active vehicle provider or combined participant';
  end if;
  if participant.currency_code <> currency then
    raise exception using errcode = '23514', message = 'The agreement currency must match the provider currency';
  end if;

  if target_agreement_id is null then
    insert into public.platform_vehicle_capital_agreements(
      participant_id, currency_code, vehicle_description, registration_number,
      agreement_reference, principal_amount, status, notes, idempotency_key
    )
    values (
      participant.id, currency, btrim(target_vehicle_description),
      nullif(btrim(target_registration_number), ''), btrim(target_agreement_reference),
      target_principal_amount, target_status, nullif(btrim(target_notes), ''), target_idempotency_key
    )
    returning id into agreement_id;
  else
    select principal_repaid into existing_repaid
    from public.platform_vehicle_capital_agreements
    where id = target_agreement_id and participant_id = target_participant_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Vehicle capital agreement was not found';
    end if;
    if target_principal_amount < existing_repaid then
      raise exception using errcode = '23514', message = 'Principal cannot be reduced below the amount already repaid';
    end if;
    update public.platform_vehicle_capital_agreements
    set currency_code = currency,
        vehicle_description = btrim(target_vehicle_description),
        registration_number = nullif(btrim(target_registration_number), ''),
        agreement_reference = btrim(target_agreement_reference),
        principal_amount = target_principal_amount,
        status = case when target_principal_amount = existing_repaid then 'fully_repaid' else target_status end,
        notes = nullif(btrim(target_notes), ''),
        updated_at = timezone('utc', now())
    where id = target_agreement_id;
    agreement_id := target_agreement_id;
  end if;

  insert into public.platform_profit_capital_audit_events(entity_type, entity_id, action, metadata)
  values ('vehicle_capital_agreement', agreement_id, case when target_agreement_id is null then 'created' else 'updated' end,
    jsonb_build_object('principalAmount', target_principal_amount, 'status', target_status, 'interestRatePercent', 0));

  return agreement_id;
end;
$$;

create or replace function public.create_platform_profit_distribution(
  target_template_id uuid,
  target_currency_code text,
  target_period_start date,
  target_period_end date,
  target_distributable_profit numeric,
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
  v_distribution_id uuid;
  existing_id uuid;
  decimals integer := 2;
  vehicle_pool numeric(28,8) := 0;
  total_profit_shares numeric(12,6) := 0;
  rounding_delta numeric(28,8) := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_platform_super_admin() or public.has_permission('platform.profit_capital.manage', null)
       or public.has_permission('platform.financial.manage', null)) then
    raise exception using errcode = '42501', message = 'Profit and capital finance management permission is required';
  end if;
  if target_distributable_profit is null or target_distributable_profit <= 0
     or target_period_start is null or target_period_end is null or target_period_end < target_period_start
     or nullif(btrim(target_notes), '') is null
     or nullif(btrim(target_idempotency_key), '') is null then
    raise exception using errcode = '22023',
      message = 'A positive Finance-approved profit amount, valid period, reconciliation reference and idempotency key are required';
  end if;

  select id into existing_id
  from public.platform_profit_distributions
  where idempotency_key = target_idempotency_key;
  if existing_id is not null then
    return existing_id;
  end if;

  select * into template
  from public.platform_profit_allocation_templates
  where id = target_template_id
    and currency_code = currency
    and status = 'active'
  for share;
  if template.id is null then
    raise exception using errcode = '23514', message = 'Select the active allocation template for this currency';
  end if;

  select coalesce(decimal_places, 2) into decimals
  from public.currency_definitions where code = currency and status = 'enabled';
  if not found then
    raise exception using errcode = '22023', message = 'Distribution currency is not enabled';
  end if;

  select coalesce(sum(profit_share_percent), 0)
  into total_profit_shares
  from public.platform_profit_participants
  where currency_code = currency and status = 'active'
    and profit_share_percent > 0;
  if total_profit_shares > 100 then
    raise exception using errcode = '23514', message = 'Active profit participation percentages exceed 100%';
  end if;

  insert into public.platform_profit_distributions(
    template_id, currency_code, period_start, period_end, distributable_profit,
    notes, template_snapshot, idempotency_key
  )
  values (
    template.id, currency, target_period_start, target_period_end, target_distributable_profit,
    nullif(btrim(target_notes), ''),
    jsonb_build_object('templateId', template.id, 'templateName', template.display_name, 'version', template.version),
    target_idempotency_key
  )
  returning id into v_distribution_id;

  insert into public.platform_profit_distribution_allocations(
    distribution_id, category_key, allocation_percent, allocated_amount
  )
  select v_distribution_id,
         line.category_key,
         line.allocation_percent,
         round(target_distributable_profit * line.allocation_percent / 100, decimals)
  from public.platform_profit_allocation_template_lines line
  where line.template_id = template.id;

  select target_distributable_profit - coalesce(sum(allocation.allocated_amount), 0)
  into rounding_delta
  from public.platform_profit_distribution_allocations allocation
  where allocation.distribution_id = v_distribution_id;

  update public.platform_profit_distribution_allocations allocation
  set allocated_amount = allocation.allocated_amount + rounding_delta
  where allocation.id = (
    select candidate.id
    from public.platform_profit_distribution_allocations candidate
    where candidate.distribution_id = v_distribution_id
    order by candidate.allocated_amount desc, candidate.category_key
    limit 1
  );

  insert into public.platform_profit_participant_entitlements(
    distribution_id, participant_id, funding_category,
    profit_basis_amount, share_percent, entitlement_amount
  )
  select v_distribution_id,
         participant.id,
         participant.funding_category,
         target_distributable_profit,
         participant.profit_share_percent,
         round(target_distributable_profit * participant.profit_share_percent / 100, decimals)
  from public.platform_profit_participants participant
  where participant.currency_code = currency
    and participant.status = 'active'
    and participant.profit_share_percent > 0
    and round(target_distributable_profit * participant.profit_share_percent / 100, decimals) > 0;

  if exists (
    select 1
    from public.platform_profit_participant_entitlements entitlement
    join public.platform_profit_distribution_allocations allocation
      on allocation.distribution_id = entitlement.distribution_id
     and allocation.category_key = entitlement.funding_category
    where entitlement.distribution_id = v_distribution_id
    group by entitlement.funding_category, allocation.allocated_amount
    having sum(entitlement.entitlement_amount) > allocation.allocated_amount
  ) then
    raise exception using errcode = '23514',
      message = 'Profit participation exceeds the available amount in its configured funding category. Adjust the template or participation rates.';
  end if;

  update public.platform_profit_distribution_allocations allocation
  set committed_amount = coalesce((
    select sum(entitlement.entitlement_amount)
    from public.platform_profit_participant_entitlements entitlement
    where entitlement.distribution_id = allocation.distribution_id
      and entitlement.funding_category = allocation.category_key
  ), 0)
  where allocation.distribution_id = v_distribution_id;

  select greatest(0, allocation.allocated_amount - allocation.committed_amount)
  into vehicle_pool
  from public.platform_profit_distribution_allocations allocation
  where allocation.distribution_id = v_distribution_id
    and allocation.category_key = 'vehicle_repayment';

  with eligible_agreements as (
    select
      agreement.id,
      agreement.principal_amount - agreement.principal_repaid as outstanding_principal,
      sum(agreement.principal_amount - agreement.principal_repaid) over () as total_outstanding
    from public.platform_vehicle_capital_agreements agreement
    where agreement.currency_code = currency
      and agreement.status = 'active'
      and agreement.principal_amount > agreement.principal_repaid
      and vehicle_pool > 0
  ),
  projected_repayments as (
    select
      eligible.id as agreement_id,
      trunc(
        least(
          eligible.outstanding_principal,
          vehicle_pool * eligible.outstanding_principal / nullif(eligible.total_outstanding, 0)
        ),
        decimals
      ) as repayment_amount
    from eligible_agreements eligible
  )
  insert into public.platform_vehicle_capital_repayments(
    distribution_id, agreement_id, principal_amount
  )
  select v_distribution_id, projected.agreement_id, projected.repayment_amount
  from projected_repayments projected
  where projected.repayment_amount > 0;

  update public.platform_profit_distribution_allocations allocation
  set committed_amount = committed_amount + coalesce((
    select sum(repayment.principal_amount)
    from public.platform_vehicle_capital_repayments repayment
    where repayment.distribution_id = allocation.distribution_id
  ), 0)
  where allocation.distribution_id = v_distribution_id
    and allocation.category_key = 'vehicle_repayment';

  insert into public.platform_profit_capital_audit_events(entity_type, entity_id, action, metadata)
  values ('profit_distribution', v_distribution_id, 'calculated', jsonb_build_object(
    'currencyCode', currency,
    'periodStart', target_period_start,
    'periodEnd', target_period_end,
    'distributableProfit', target_distributable_profit,
    'templateId', template.id
  ));

  return v_distribution_id;
end;
$$;

create or replace function public.approve_platform_profit_distribution(
  target_distribution_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  distribution public.platform_profit_distributions%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_platform_super_admin() or public.has_permission('platform.profit_capital.manage', null)
       or public.has_permission('platform.financial.manage', null)) then
    raise exception using errcode = '42501', message = 'Profit and capital finance management permission is required';
  end if;

  select * into distribution
  from public.platform_profit_distributions
  where id = target_distribution_id
  for update;

  if distribution.id is null or distribution.status <> 'draft' then
    raise exception using errcode = '23514', message = 'Only a draft profit distribution can be approved';
  end if;

  update public.platform_profit_distributions
  set status = 'approved',
      approved_by = auth.uid(),
      approved_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = target_distribution_id;

  update public.platform_profit_participant_entitlements
  set status = 'approved'
  where distribution_id = target_distribution_id and status = 'calculated';

  update public.platform_vehicle_capital_repayments
  set status = 'approved'
  where distribution_id = target_distribution_id and status = 'calculated';

  insert into public.platform_profit_capital_audit_events(entity_type, entity_id, action)
  values ('profit_distribution', target_distribution_id, 'approved');

  return target_distribution_id;
end;
$$;

create or replace function public.record_platform_profit_participant_payment(
  target_entitlement_id uuid,
  target_amount numeric,
  target_financial_transaction_id uuid,
  target_external_reference text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  entitlement public.platform_profit_participant_entitlements%rowtype;
  distribution public.platform_profit_distributions%rowtype;
  transaction_record public.financial_transactions%rowtype;
  payment_id uuid;
  claimed_transaction_id uuid;
  existing_payment public.platform_profit_participant_payments%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_platform_super_admin() or public.has_permission('platform.profit_capital.manage', null)
       or public.has_permission('platform.financial.manage', null)) then
    raise exception using errcode = '42501', message = 'Profit and capital finance management permission is required';
  end if;
  if target_amount is null or target_amount <= 0 or nullif(btrim(target_external_reference), '') is null
     or nullif(btrim(target_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'A positive payment amount, transfer reference and idempotency key are required';
  end if;

  select * into existing_payment
  from public.platform_profit_participant_payments
  where idempotency_key = target_idempotency_key;
  if existing_payment.id is null then
    select * into existing_payment
    from public.platform_profit_participant_payments
    where financial_transaction_id = target_financial_transaction_id;
  end if;
  if existing_payment.id is not null then
    if existing_payment.entitlement_id <> target_entitlement_id
       or existing_payment.amount <> target_amount
       or existing_payment.financial_transaction_id <> target_financial_transaction_id
       or existing_payment.external_reference <> btrim(target_external_reference) then
      raise exception using errcode = '23505', message = 'Payment idempotency key was already used with different details';
    end if;
    return existing_payment.id;
  end if;

  select * into entitlement from public.platform_profit_participant_entitlements
  where id = target_entitlement_id for update;
  if entitlement.id is null or entitlement.status not in ('approved', 'partially_paid') then
    raise exception using errcode = '23514', message = 'This profit entitlement is not approved for payment';
  end if;
  select * into distribution from public.platform_profit_distributions
  where id = entitlement.distribution_id;
  if distribution.status not in ('approved', 'completed') then
    raise exception using errcode = '23514', message = 'The profit distribution must be approved before payment';
  end if;

  select * into transaction_record from public.financial_transactions
  where id = target_financial_transaction_id;
  if transaction_record.id is null
     or transaction_record.status <> 'posted'
     or transaction_record.transaction_type not in ('payment', 'transfer')
     or transaction_record.currency_code <> distribution.currency_code
     or transaction_record.total_amount <> target_amount then
    raise exception using errcode = '23514', message = 'Link a posted transfer/payment ledger transaction for the exact amount and currency';
  end if;

  if exists (
    select 1 from public.platform_vehicle_capital_repayment_payments payment
    where payment.financial_transaction_id = target_financial_transaction_id
  ) then
    raise exception using errcode = '23514',
      message = 'This posted transaction has already been used for a vehicle capital repayment';
  end if;
  if target_amount > entitlement.entitlement_amount - entitlement.paid_amount then
    raise exception using errcode = '23514', message = 'Payment exceeds the outstanding profit entitlement';
  end if;

  insert into public.platform_profit_participant_payments(
    entitlement_id, amount, currency_code, financial_transaction_id, external_reference, idempotency_key
  )
  values (
    target_entitlement_id, target_amount, distribution.currency_code,
    target_financial_transaction_id, btrim(target_external_reference), target_idempotency_key
  )
  returning id into payment_id;

  insert into public.platform_profit_capital_transaction_claims(
    financial_transaction_id, payment_kind, payment_record_id
  )
  values (target_financial_transaction_id, 'profit_participation', payment_id)
  on conflict (financial_transaction_id) do nothing
  returning financial_transaction_id into claimed_transaction_id;

  if claimed_transaction_id is null then
    raise exception using errcode = '23514',
      message = 'This posted transaction has already been claimed by another capital payment';
  end if;

  update public.platform_profit_participant_entitlements
  set paid_amount = paid_amount + target_amount,
      status = case when paid_amount + target_amount >= entitlement_amount then 'paid' else 'partially_paid' end
  where id = target_entitlement_id;

  update public.platform_profit_distributions
  set status = case
      when not exists (
        select 1 from public.platform_profit_participant_entitlements e
        where e.distribution_id = distribution.id and e.status not in ('paid', 'cancelled')
      ) and not exists (
        select 1 from public.platform_vehicle_capital_repayments r
        where r.distribution_id = distribution.id and r.status not in ('paid', 'cancelled')
      ) then 'completed'
      else status
    end,
    updated_at = timezone('utc', now())
  where id = distribution.id;

  insert into public.platform_profit_capital_audit_events(entity_type, entity_id, action, metadata)
  values ('profit_entitlement', target_entitlement_id, 'payment_recorded',
    jsonb_build_object('amount', target_amount, 'currencyCode', distribution.currency_code, 'transactionId', target_financial_transaction_id));

  return payment_id;
end;
$$;

create or replace function public.record_platform_vehicle_capital_repayment(
  target_repayment_id uuid,
  target_amount numeric,
  target_financial_transaction_id uuid,
  target_external_reference text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  repayment public.platform_vehicle_capital_repayments%rowtype;
  agreement public.platform_vehicle_capital_agreements%rowtype;
  distribution public.platform_profit_distributions%rowtype;
  transaction_record public.financial_transactions%rowtype;
  payment_id uuid;
  new_repaid numeric(28,8);
  claimed_transaction_id uuid;
  existing_payment public.platform_vehicle_capital_repayment_payments%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_platform_super_admin() or public.has_permission('platform.profit_capital.manage', null)
       or public.has_permission('platform.financial.manage', null)) then
    raise exception using errcode = '42501', message = 'Profit and capital finance management permission is required';
  end if;
  if target_amount is null or target_amount <= 0 or nullif(btrim(target_external_reference), '') is null
     or nullif(btrim(target_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'A positive principal payment, transfer reference and idempotency key are required';
  end if;

  select * into existing_payment
  from public.platform_vehicle_capital_repayment_payments
  where idempotency_key = target_idempotency_key;
  if existing_payment.id is null then
    select * into existing_payment
    from public.platform_vehicle_capital_repayment_payments
    where financial_transaction_id = target_financial_transaction_id;
  end if;
  if existing_payment.id is not null then
    if existing_payment.repayment_id <> target_repayment_id
       or existing_payment.amount <> target_amount
       or existing_payment.financial_transaction_id <> target_financial_transaction_id
       or existing_payment.external_reference <> btrim(target_external_reference) then
      raise exception using errcode = '23505', message = 'Principal payment idempotency key was already used with different details';
    end if;
    return existing_payment.id;
  end if;

  select * into repayment from public.platform_vehicle_capital_repayments
  where id = target_repayment_id for update;
  if repayment.id is null or repayment.status not in ('approved', 'partially_paid') then
    raise exception using errcode = '23514', message = 'This vehicle principal repayment is not approved';
  end if;

  select * into distribution from public.platform_profit_distributions
  where id = repayment.distribution_id;
  select * into agreement from public.platform_vehicle_capital_agreements
  where id = repayment.agreement_id for update;

  if distribution.status not in ('approved', 'completed') then
    raise exception using errcode = '23514', message = 'The profit distribution must be approved before repayment';
  end if;
  select * into transaction_record from public.financial_transactions
  where id = target_financial_transaction_id;
  if transaction_record.id is null
     or transaction_record.status <> 'posted'
     or transaction_record.transaction_type not in ('payment', 'transfer')
     or transaction_record.currency_code <> distribution.currency_code
     or transaction_record.total_amount <> target_amount then
    raise exception using errcode = '23514', message = 'Link a posted transfer/payment ledger transaction for the exact principal amount and currency';
  end if;

  if exists (
    select 1 from public.platform_profit_participant_payments payment
    where payment.financial_transaction_id = target_financial_transaction_id
  ) then
    raise exception using errcode = '23514',
      message = 'This posted transaction has already been used for a profit participation payment';
  end if;
  if target_amount > repayment.principal_amount - repayment.paid_amount
     or target_amount > agreement.principal_amount - agreement.principal_repaid then
    raise exception using errcode = '23514', message = 'Payment exceeds the outstanding principal';
  end if;

  insert into public.platform_vehicle_capital_repayment_payments(
    repayment_id, amount, currency_code, financial_transaction_id, external_reference, idempotency_key
  )
  values (
    target_repayment_id, target_amount, distribution.currency_code,
    target_financial_transaction_id, btrim(target_external_reference), target_idempotency_key
  )
  returning id into payment_id;

  insert into public.platform_profit_capital_transaction_claims(
    financial_transaction_id, payment_kind, payment_record_id
  )
  values (target_financial_transaction_id, 'vehicle_principal', payment_id)
  on conflict (financial_transaction_id) do nothing
  returning financial_transaction_id into claimed_transaction_id;

  if claimed_transaction_id is null then
    raise exception using errcode = '23514',
      message = 'This posted transaction has already been claimed by another capital payment';
  end if;

  update public.platform_vehicle_capital_repayments
  set paid_amount = paid_amount + target_amount,
      status = case when paid_amount + target_amount >= principal_amount then 'paid' else 'partially_paid' end
  where id = target_repayment_id;

  new_repaid := agreement.principal_repaid + target_amount;
  update public.platform_vehicle_capital_agreements
  set principal_repaid = new_repaid,
      status = case when new_repaid >= principal_amount then 'fully_repaid' else status end,
      updated_at = timezone('utc', now())
  where id = agreement.id;

  update public.platform_profit_distributions
  set status = case
      when not exists (
        select 1 from public.platform_profit_participant_entitlements e
        where e.distribution_id = distribution.id and e.status not in ('paid', 'cancelled')
      ) and not exists (
        select 1 from public.platform_vehicle_capital_repayments r
        where r.distribution_id = distribution.id and r.status not in ('paid', 'cancelled')
      ) then 'completed'
      else status
    end,
    updated_at = timezone('utc', now())
  where id = distribution.id;

  insert into public.platform_profit_capital_audit_events(entity_type, entity_id, action, metadata)
  values ('vehicle_capital_repayment', target_repayment_id, 'principal_payment_recorded',
    jsonb_build_object('amount', target_amount, 'currencyCode', distribution.currency_code, 'transactionId', target_financial_transaction_id, 'remainingPrincipal', agreement.principal_amount - new_repaid));

  return payment_id;
end;
$$;

revoke all on function public.read_platform_profit_capital_workspace(text) from public, anon;
revoke all on function public.save_platform_profit_allocation_template(uuid,text,text,jsonb,text,text) from public, anon;
revoke all on function public.activate_platform_profit_allocation_template(uuid) from public, anon;
revoke all on function public.save_platform_profit_participant(uuid,text,text,text,text,text,numeric,text,text,text,text) from public, anon;
revoke all on function public.save_platform_vehicle_capital_agreement(uuid,uuid,text,text,text,text,numeric,text,text,text) from public, anon;
revoke all on function public.create_platform_profit_distribution(uuid,text,date,date,numeric,text,text) from public, anon;
revoke all on function public.approve_platform_profit_distribution(uuid) from public, anon;
revoke all on function public.record_platform_profit_participant_payment(uuid,numeric,uuid,text,text) from public, anon;
revoke all on function public.record_platform_vehicle_capital_repayment(uuid,numeric,uuid,text,text) from public, anon;

grant execute on function public.read_platform_profit_capital_workspace(text) to authenticated, service_role;
grant execute on function public.save_platform_profit_allocation_template(uuid,text,text,jsonb,text,text) to authenticated, service_role;
grant execute on function public.activate_platform_profit_allocation_template(uuid) to authenticated, service_role;
grant execute on function public.save_platform_profit_participant(uuid,text,text,text,text,text,numeric,text,text,text,text) to authenticated, service_role;
grant execute on function public.save_platform_vehicle_capital_agreement(uuid,uuid,text,text,text,text,numeric,text,text,text) to authenticated, service_role;
grant execute on function public.create_platform_profit_distribution(uuid,text,date,date,numeric,text,text) to authenticated, service_role;
grant execute on function public.approve_platform_profit_distribution(uuid) to authenticated, service_role;
grant execute on function public.record_platform_profit_participant_payment(uuid,numeric,uuid,text,text) to authenticated, service_role;
grant execute on function public.record_platform_vehicle_capital_repayment(uuid,numeric,uuid,text,text) to authenticated, service_role;

comment on table public.platform_profit_participants is
  'Contractual profit-participation beneficiaries. This register does not issue legal company shares or confer voting rights.';
comment on table public.platform_vehicle_capital_agreements is
  'Interest-free vehicle principal agreements. Principal is reduced only when a posted payment transaction is linked.';
comment on table public.platform_profit_distribution_allocations is
  'Immutable-by-workflow snapshots of category percentages and amounts calculated from approved distributable profit.';
comment on function public.record_platform_vehicle_capital_repayment(uuid,numeric,uuid,text,text) is
  'Records an interest-free principal repayment only against a matching posted financial transaction; no interest is calculated.';

notify pgrst, 'reload schema';

commit;