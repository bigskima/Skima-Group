begin;

-- ---------------------------------------------------------------------------
-- SKIMA financial revenue foundation
-- - separates platform clearing, revenue, liability and provider-settlement wallets
-- - keeps revenue private to Finance Admin / Super Admin
-- - exposes immutable revenue reporting from the existing wallet ledger
-- - provisions the canonical LPG refill catalog item for every approved station
-- - publishes only a safe bank directory projection to runtime clients
-- - seeds a governed, zero-safe wallet deposit fee policy
-- ---------------------------------------------------------------------------

insert into public.permissions (key, description, risk_level, metadata)
values
  (
    'platform.revenue.read',
    'Read SKIMA platform revenue balances, ledger entries, and revenue analytics.',
    'critical',
    '{"admin_area":"finance","revenue_scope":true}'::jsonb
  ),
  (
    'platform.revenue.manage',
    'Post or reverse governed entries involving the SKIMA platform revenue wallet.',
    'critical',
    '{"admin_area":"finance","revenue_scope":true}'::jsonb
  )
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    metadata = public.permissions.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

update public.platform_admin_role_templates
set permission_keys = (
      select array(
        select distinct permission_key
        from unnest(
          coalesce(public.platform_admin_role_templates.permission_keys, array[]::text[])
          || array['platform.revenue.read','platform.revenue.manage']::text[]
        ) as permission_key
        order by permission_key
      )
    ),
    metadata = metadata || '{"revenue_authority":true}'::jsonb,
    updated_at = timezone('utc', now())
where key in ('platform.super_admin', 'platform.finance_admin');

-- Platform financial wallets need distinct wallet types. Keeping the old generic
-- `platform` type available preserves backward compatibility while new runtime
-- code uses explicit purpose types.
alter table public.wallet_accounts
  drop constraint if exists wallet_accounts_wallet_type_check;

alter table public.wallet_accounts
  add constraint wallet_accounts_wallet_type_check
  check (wallet_type = any (array[
    'customer'::text,
    'driver'::text,
    'partner'::text,
    'platform'::text,
    'platform_clearing'::text,
    'platform_revenue'::text,
    'platform_liability'::text,
    'platform_provider'::text,
    'escrow'::text,
    'commission'::text,
    'refund'::text,
    'bonus'::text,
    'loyalty'::text,
    'generic'::text
  ]));

-- The existing platform wallet was already being used as settlement clearing.
-- Reclassify it without changing its identity or ledger history.
update public.wallet_accounts
set wallet_type = 'platform_clearing',
    metadata = metadata || jsonb_build_object(
      'wallet_purpose', 'settlement_clearing',
      'wallet_classification_migrated_at', timezone('utc', now())
    ),
    updated_at = timezone('utc', now())
where wallet_type = 'platform'
  and owner_entity_type = 'platform'
  and owner_entity_id is null
  and metadata ->> 'wallet_purpose' = 'settlement_clearing';

create or replace function public.ensure_platform_purpose_wallet(
  target_wallet_type text,
  target_wallet_purpose text,
  target_currency_code text default 'NGN',
  target_source text default 'platform.wallet_engine',
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  wallet_id uuid;
  resolved_idempotency_key text;
begin
  if target_wallet_type not in (
    'platform_clearing',
    'platform_revenue',
    'platform_liability',
    'platform_provider'
  ) then
    raise exception 'unsupported platform purpose wallet type';
  end if;

  if target_wallet_purpose is null or btrim(target_wallet_purpose) = '' then
    raise exception 'target_wallet_purpose is required';
  end if;

  if target_currency_code is null or target_currency_code !~ '^[A-Z0-9]{3,12}$' then
    raise exception 'target_currency_code must be a valid currency code';
  end if;

  if not exists (
    select 1 from public.currency_definitions currency
    where currency.code = target_currency_code and currency.status = 'enabled'
  ) then
    raise exception 'target_currency_code must reference an enabled currency';
  end if;

  if auth.role() <> 'service_role' then
    if target_wallet_type = 'platform_revenue' then
      if not public.has_permission('platform.revenue.manage', null) then
        raise exception 'platform revenue management permission is required';
      end if;
    elsif not public.has_permission('platform.financial.manage', null)
      and not public.has_permission('platform.wallets.manage', null) then
      raise exception 'platform financial management permission is required';
    end if;
  end if;

  select wallet.id
  into wallet_id
  from public.wallet_accounts wallet
  where wallet.wallet_type = target_wallet_type
    and wallet.owner_entity_type = 'platform'
    and wallet.owner_entity_id is null
    and wallet.currency_code = target_currency_code
    and wallet.status = 'active'
  limit 1;

  if wallet_id is not null then
    return wallet_id;
  end if;

  resolved_idempotency_key := coalesce(
    nullif(btrim(target_idempotency_key), ''),
    target_wallet_type || ':' || lower(target_currency_code)
  );

  insert into public.wallet_accounts (
    wallet_type,
    owner_entity_type,
    owner_entity_id,
    currency_code,
    status,
    metadata,
    created_by,
    source,
    idempotency_key
  ) values (
    target_wallet_type,
    'platform',
    null,
    target_currency_code,
    'active',
    jsonb_build_object(
      'wallet_purpose', target_wallet_purpose,
      'platform_internal', true
    ),
    auth.uid(),
    coalesce(nullif(target_source, ''), 'platform.wallet_engine'),
    resolved_idempotency_key
  )
  on conflict do nothing
  returning id into wallet_id;

  if wallet_id is null then
    select wallet.id
    into wallet_id
    from public.wallet_accounts wallet
    where wallet.wallet_type = target_wallet_type
      and wallet.owner_entity_type = 'platform'
      and wallet.owner_entity_id is null
      and wallet.currency_code = target_currency_code
      and wallet.status = 'active'
    limit 1;
  end if;

  if wallet_id is null then
    raise exception 'platform purpose wallet could not be ensured';
  end if;

  insert into public.wallet_account_events (
    wallet_account_id,
    event_type,
    status,
    idempotency_key,
    metadata
  )
  values (
    wallet_id,
    'created',
    'active',
    resolved_idempotency_key || ':created',
    jsonb_build_object(
      'source', coalesce(nullif(target_source, ''), 'platform.wallet_engine'),
      'wallet_purpose', target_wallet_purpose
    )
  )
  on conflict do nothing;

  return wallet_id;
end;
$$;

create or replace function public.ensure_platform_clearing_wallet(
  target_currency_code text default 'NGN',
  target_source text default 'platform.financial_engine',
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.ensure_platform_purpose_wallet(
    'platform_clearing',
    'settlement_clearing',
    target_currency_code,
    coalesce(nullif(target_source, ''), 'platform.financial_engine'),
    coalesce(nullif(target_idempotency_key, ''), 'platform-clearing:' || lower(target_currency_code))
  );
end;
$$;

create or replace function public.ensure_platform_revenue_wallet(
  target_currency_code text default 'NGN',
  target_source text default 'platform.revenue_engine',
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.ensure_platform_purpose_wallet(
    'platform_revenue',
    'skima_revenue',
    target_currency_code,
    coalesce(nullif(target_source, ''), 'platform.revenue_engine'),
    coalesce(nullif(target_idempotency_key, ''), 'platform-revenue:' || lower(target_currency_code))
  );
end;
$$;

create or replace function public.ensure_platform_liability_wallet(
  target_currency_code text default 'NGN',
  target_source text default 'platform.liability_engine',
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.ensure_platform_purpose_wallet(
    'platform_liability',
    'tax_and_pass_through_liabilities',
    target_currency_code,
    coalesce(nullif(target_source, ''), 'platform.liability_engine'),
    coalesce(nullif(target_idempotency_key, ''), 'platform-liability:' || lower(target_currency_code))
  );
end;
$$;

create or replace function public.ensure_platform_provider_wallet(
  target_currency_code text default 'NGN',
  target_source text default 'platform.provider_settlement_engine',
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.ensure_platform_purpose_wallet(
    'platform_provider',
    'external_provider_settlement',
    target_currency_code,
    coalesce(nullif(target_source, ''), 'platform.provider_settlement_engine'),
    coalesce(nullif(target_idempotency_key, ''), 'platform-provider:' || lower(target_currency_code))
  );
end;
$$;

create or replace function public.is_platform_revenue_wallet(target_wallet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.wallet_accounts wallet
    where wallet.id = target_wallet_id
      and wallet.wallet_type = 'platform_revenue'
      and wallet.owner_entity_type = 'platform'
  );
$$;

create or replace function public.financial_transaction_touches_revenue(target_transaction_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.wallet_ledger_entries ledger
    join public.wallet_accounts wallet on wallet.id = ledger.wallet_id
    where ledger.transaction_id = target_transaction_id
      and wallet.wallet_type = 'platform_revenue'
  );
$$;

create or replace function public.protect_platform_revenue_ledger_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_platform_revenue_wallet(new.wallet_id)
    and auth.role() <> 'service_role'
    and current_user not in ('postgres', 'supabase_admin')
    and not public.has_permission('platform.revenue.manage', null) then
    raise exception 'platform revenue management permission is required';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_platform_revenue_ledger_write on public.wallet_ledger_entries;
create trigger protect_platform_revenue_ledger_write
before insert on public.wallet_ledger_entries
for each row execute function public.protect_platform_revenue_ledger_entry();

-- Revenue wallets and revenue-bearing transactions are deliberately excluded
-- from generic wallet/financial visibility unless the caller has revenue authority.
drop policy if exists wallet_accounts_select_owner_or_privileged on public.wallet_accounts;
create policy wallet_accounts_select_owner_or_privileged
on public.wallet_accounts
for select
to authenticated
using (
  (
    wallet_type = 'platform_revenue'
    and (
      public.has_permission('platform.revenue.read', null)
      or public.has_permission('platform.revenue.manage', null)
    )
  )
  or
  (
    wallet_type <> 'platform_revenue'
    and (
      public.is_wallet_owner(id)
      or public.has_permission('platform.wallets.read', null)
      or public.has_permission('platform.wallets.manage', null)
    )
  )
);

drop policy if exists wallet_ledger_entries_select_owner_or_privileged on public.wallet_ledger_entries;
create policy wallet_ledger_entries_select_owner_or_privileged
on public.wallet_ledger_entries
for select
to authenticated
using (
  (
    public.is_platform_revenue_wallet(wallet_id)
    and (
      public.has_permission('platform.revenue.read', null)
      or public.has_permission('platform.revenue.manage', null)
    )
  )
  or
  (
    not public.is_platform_revenue_wallet(wallet_id)
    and (
      public.is_wallet_owner(wallet_id)
      or public.has_permission('platform.wallets.read', null)
      or public.has_permission('platform.financial.read', null)
    )
  )
);

drop policy if exists financial_transactions_select_actor_or_privileged on public.financial_transactions;
create policy financial_transactions_select_actor_or_privileged
on public.financial_transactions
for select
to authenticated
using (
  (
    actor_user_id = auth.uid()
    or public.has_permission('platform.financial.read', null)
    or public.has_permission('platform.financial.manage', null)
  )
  and (
    not public.financial_transaction_touches_revenue(id)
    or public.has_permission('platform.revenue.read', null)
    or public.has_permission('platform.revenue.manage', null)
  )
);

create or replace function public.platform_revenue_summary(
  target_currency_code text default 'NGN',
  target_from timestamp with time zone default null,
  target_until timestamp with time zone default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.revenue.read', null)
    and not public.has_permission('platform.revenue.manage', null) then
    raise exception 'platform revenue read permission is required';
  end if;

  if target_until is not null and target_from is not null and target_until <= target_from then
    raise exception 'target_until must be after target_from';
  end if;

  with revenue_entries as (
    select
      ledger.id,
      ledger.transaction_id,
      ledger.created_at,
      ledger.direction,
      ledger.amount,
      case when ledger.direction = 'credit' then ledger.amount else -ledger.amount end as signed_amount,
      coalesce(nullif(ledger.metadata ->> 'revenue_stream', ''), 'uncategorized') as revenue_stream,
      coalesce(nullif(ledger.metadata ->> 'revenue_component', ''), 'uncategorized') as revenue_component
    from public.wallet_ledger_entries ledger
    join public.wallet_accounts wallet on wallet.id = ledger.wallet_id
    where wallet.wallet_type = 'platform_revenue'
      and wallet.owner_entity_type = 'platform'
      and wallet.currency_code = target_currency_code
      and (target_from is null or ledger.created_at >= target_from)
      and (target_until is null or ledger.created_at < target_until)
  ),
  stream_totals as (
    select revenue_stream, sum(signed_amount)::numeric(28,8) as amount
    from revenue_entries
    group by revenue_stream
  ),
  component_totals as (
    select revenue_stream, revenue_component, sum(signed_amount)::numeric(28,8) as amount
    from revenue_entries
    group by revenue_stream, revenue_component
  )
  select jsonb_build_object(
    'currencyCode', target_currency_code,
    'from', target_from,
    'until', target_until,
    'netRevenue', coalesce((select sum(signed_amount) from revenue_entries), 0),
    'grossCredits', coalesce((select sum(amount) from revenue_entries where direction = 'credit'), 0),
    'reversalsAndDebits', coalesce((select sum(amount) from revenue_entries where direction = 'debit'), 0),
    'entryCount', (select count(*) from revenue_entries),
    'byStream', coalesce((
      select jsonb_agg(
        jsonb_build_object('key', revenue_stream, 'amount', amount)
        order by revenue_stream
      )
      from stream_totals
    ), '[]'::jsonb),
    'byComponent', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'stream', revenue_stream,
          'component', revenue_component,
          'amount', amount
        )
        order by revenue_stream, revenue_component
      )
      from component_totals
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.platform_revenue_summary(text, timestamptz, timestamptz) from public;
grant execute on function public.platform_revenue_summary(text, timestamptz, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Canonical LPG refill catalog provisioning
-- ---------------------------------------------------------------------------
create or replace function public.ensure_lpg_station_refill_catalog_item(
  target_station_branch_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  station_record public.lpg_station_branches%rowtype;
  lpg_module_id uuid;
  item_id uuid;
  item_key text;
  item_idempotency_key text;
begin
  select * into station_record
  from public.lpg_station_branches
  where id = target_station_branch_id;

  if not found then
    raise exception 'target_station_branch_id must reference an LPG station';
  end if;

  if station_record.approval_status <> 'approved'
    or station_record.compliance_status <> 'approved' then
    return null;
  end if;

  if auth.role() <> 'service_role'
    and current_user not in ('postgres', 'supabase_admin')
    and not public.can_manage_lpg_operations()
    and not public.can_operate_lpg_station_branch(target_station_branch_id, 'lpg.stations.manage') then
    raise exception 'LPG station management permission is required';
  end if;

  select module.id into lpg_module_id
  from public.business_modules module
  where module.key = 'lpg' and module.status = 'active'
  limit 1;

  if lpg_module_id is null then
    raise exception 'active LPG business module is required';
  end if;

  item_key := 'lpg.refill.' || replace(station_record.branch_id::text, '-', '');
  item_idempotency_key := 'station-refill:' || station_record.id::text;

  insert into public.catalog_items (
    organization_id,
    branch_id,
    module_id,
    category_id,
    key,
    item_type,
    display_name,
    description,
    fulfillment_methods,
    preparation_time_minutes,
    min_quantity,
    max_quantity,
    status,
    source,
    idempotency_key,
    metadata,
    created_by
  ) values (
    station_record.organization_id,
    station_record.branch_id,
    lpg_module_id,
    null,
    item_key,
    'service',
    'LPG Refill',
    'Per-kilogram LPG refill service supplied by this approved SKIMA station branch.',
    array['pickup_delivery']::text[],
    null,
    0.001,
    null,
    'active',
    'lpg.station_catalog_provisioning',
    item_idempotency_key,
    jsonb_build_object(
      'canonical_lpg_refill', true,
      'price_basis', 'per_kg',
      'station_branch_id', station_record.id,
      'managed_by', 'station_price_workflow'
    ),
    auth.uid()
  )
  on conflict (organization_id, key) do update
  set branch_id = excluded.branch_id,
      module_id = excluded.module_id,
      item_type = excluded.item_type,
      display_name = excluded.display_name,
      description = excluded.description,
      fulfillment_methods = excluded.fulfillment_methods,
      status = 'active',
      metadata = public.catalog_items.metadata || excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into item_id;

  if item_id is null then
    select item.id into item_id
    from public.catalog_items item
    where item.organization_id = station_record.organization_id
      and item.key = item_key;
  end if;

  return item_id;
end;
$$;

create or replace function public.ensure_lpg_station_refill_catalog_item_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.approval_status = 'approved' and new.compliance_status = 'approved' then
    perform public.ensure_lpg_station_refill_catalog_item(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists ensure_lpg_station_refill_catalog_item_after_write on public.lpg_station_branches;
create trigger ensure_lpg_station_refill_catalog_item_after_write
after insert or update of approval_status, compliance_status, organization_id, branch_id
on public.lpg_station_branches
for each row execute function public.ensure_lpg_station_refill_catalog_item_trigger();

do $$
declare
  station_id uuid;
begin
  for station_id in
    select station.id
    from public.lpg_station_branches station
    where station.approval_status = 'approved'
      and station.compliance_status = 'approved'
  loop
    perform public.ensure_lpg_station_refill_catalog_item(station_id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Safe runtime payout directory. Ordinary users never need provider_adapters.
-- Only the provider's explicitly public bank directory is projected into the
-- already public currency metadata returned by /engines/currencies.
-- ---------------------------------------------------------------------------
create or replace function public.sync_public_payout_directory()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  provider_record record;
  payout_currency text;
  payout_country text;
  bank_directory jsonb;
begin
  select provider.key, provider.config
  into provider_record
  from public.provider_adapters provider
  where provider.provider_kind = 'payment'
    and provider.status = 'active'
    and jsonb_typeof(provider.config -> 'public_bank_directory') = 'array'
    and jsonb_array_length(provider.config -> 'public_bank_directory') > 0
  order by
    case when provider.key like '%.sandbox' then 1 else 0 end,
    provider.key
  limit 1;

  if not found then
    update public.currency_definitions currency
    set metadata = jsonb_set(
          currency.metadata,
          '{public_payout}',
          jsonb_build_object('available', false, 'banks', '[]'::jsonb),
          true
        ),
        updated_at = timezone('utc', now())
    where currency.status = 'enabled';
    return;
  end if;

  payout_currency := coalesce(nullif(provider_record.config ->> 'public_payout_currency', ''), 'NGN');
  payout_country := coalesce(nullif(provider_record.config ->> 'public_payout_country', ''), 'NG');
  bank_directory := provider_record.config -> 'public_bank_directory';

  update public.currency_definitions currency
  set metadata = jsonb_set(
        currency.metadata,
        '{public_payout}',
        jsonb_build_object(
          'available', true,
          'country', payout_country,
          'currency', payout_currency,
          'banks', bank_directory
        ),
        true
      ),
      updated_at = timezone('utc', now())
  where currency.code = payout_currency;
end;
$$;

create or replace function public.sync_public_payout_directory_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_public_payout_directory();
  return coalesce(new, old);
end;
$$;

drop trigger if exists sync_public_payout_directory_after_provider_change on public.provider_adapters;
create trigger sync_public_payout_directory_after_provider_change
after insert or update or delete on public.provider_adapters
for each statement execute function public.sync_public_payout_directory_trigger();

select public.sync_public_payout_directory();

-- ---------------------------------------------------------------------------
-- Governed wallet-deposit fee policy. The initial active configuration is
-- intentionally zero so existing top-ups do not suddenly become more expensive.
-- Finance can create/approve/activate a non-zero version later.
-- ---------------------------------------------------------------------------
insert into public.financial_policy_definitions (
  key,
  display_name,
  policy_family,
  value_schema,
  approval_required,
  allow_partner_delegation,
  status,
  metadata
) values (
  'fees.deposit.default',
  'Default wallet deposit fee',
  'payment_fee',
  '{}'::jsonb,
  true,
  false,
  'active',
  '{"component":"deposit_fee","safe_default":true}'::jsonb
)
on conflict (key) do update
set display_name = excluded.display_name,
    policy_family = excluded.policy_family,
    approval_required = excluded.approval_required,
    allow_partner_delegation = excluded.allow_partner_delegation,
    status = 'active',
    metadata = public.financial_policy_definitions.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

insert into public.financial_policy_versions (
  policy_definition_id,
  version,
  lifecycle_status,
  organization_id,
  module_id,
  service_key,
  geography_type,
  geography_key,
  currency_code,
  priority,
  configuration,
  effective_from,
  effective_until,
  change_reason,
  validation_snapshot,
  submitted_at,
  approved_at,
  activated_at,
  created_by
)
select
  definition.id,
  1,
  'active',
  null,
  null,
  'wallet.deposit',
  'global',
  null,
  'NGN',
  100,
  jsonb_build_object(
    'fixed_amount', 0,
    'percentage_rate', 0,
    'minimum_fee_amount', 0,
    'maximum_fee_amount', null,
    'minimum_deposit_amount', 0,
    'maximum_deposit_amount', null,
    'explicit_zero', true
  ),
  timezone('utc', now()),
  null,
  'Safe zero-fee default for wallet deposits.',
  '{"seeded_by":"financial_revenue_foundation","safe_default":true}'::jsonb,
  timezone('utc', now()),
  timezone('utc', now()),
  timezone('utc', now()),
  null
from public.financial_policy_definitions definition
where definition.key = 'fees.deposit.default'
  and not exists (
    select 1
    from public.financial_policy_versions version
    where version.policy_definition_id = definition.id
  );

-- Ensure the four internal platform money buckets exist without posting any
-- balance. Provisioning wallets does not create revenue or move customer money.
do $$
begin
  perform public.ensure_platform_clearing_wallet('NGN', 'platform.financial_migration', 'financial-revenue-foundation:clearing');
  perform public.ensure_platform_revenue_wallet('NGN', 'platform.financial_migration', 'financial-revenue-foundation:revenue');
  perform public.ensure_platform_liability_wallet('NGN', 'platform.financial_migration', 'financial-revenue-foundation:liability');
  perform public.ensure_platform_provider_wallet('NGN', 'platform.financial_migration', 'financial-revenue-foundation:provider');
end;
$$;

commit;
