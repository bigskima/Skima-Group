-- Repair the Revenue read path, expose a simple governed LPG revenue control,
-- and make every approved LPG station catalog priceable without inventing a price.

insert into public.role_permissions (role_id, permission_id)
select role_record.id, permission_record.id
from public.roles role_record
join public.permissions permission_record
  on permission_record.key in ('platform.revenue.read', 'platform.revenue.manage')
where role_record.key = 'platform.super_admin'
  and role_record.organization_id is null
  and role_record.status = 'active'
on conflict do nothing;

create or replace function public.platform_revenue_summary(
  target_currency_code text default 'NGN',
  target_from timestamptz default null,
  target_until timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
  current_balance numeric(28,8);
begin
  if auth.role() <> 'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.revenue.read', null)
    and not public.has_permission('platform.revenue.manage', null) then
    raise exception 'platform revenue read permission is required';
  end if;

  if target_until is not null and target_from is not null and target_until <= target_from then
    raise exception 'target_until must be after target_from';
  end if;

  select coalesce(sum(balance.balance), 0)::numeric(28,8)
  into current_balance
  from public.wallet_accounts wallet
  left join public.wallet_balances balance
    on balance.wallet_id = wallet.id
   and balance.currency_code = wallet.currency_code
  where wallet.wallet_type = 'platform_revenue'
    and wallet.owner_entity_type = 'platform'
    and wallet.currency_code = target_currency_code
    and wallet.status = 'active';

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
    select revenue_stream, sum(signed_amount)::numeric(28,8) amount
    from revenue_entries
    group by revenue_stream
  ),
  component_totals as (
    select revenue_stream, revenue_component, sum(signed_amount)::numeric(28,8) amount
    from revenue_entries
    group by revenue_stream, revenue_component
  )
  select jsonb_build_object(
    'currencyCode', target_currency_code,
    'from', target_from,
    'until', target_until,
    'currentRevenueBalance', current_balance,
    'netRevenue', coalesce((select sum(signed_amount) from revenue_entries), 0),
    'grossCredits', coalesce((select sum(amount) from revenue_entries where direction = 'credit'), 0),
    'reversalsAndDebits', coalesce((select sum(amount) from revenue_entries where direction = 'debit'), 0),
    'entryCount', (select count(*) from revenue_entries),
    'byStream', coalesce((
      select jsonb_agg(jsonb_build_object('key', revenue_stream, 'amount', amount) order by revenue_stream)
      from stream_totals
    ), '[]'::jsonb),
    'byComponent', coalesce((
      select jsonb_agg(jsonb_build_object('stream', revenue_stream, 'component', revenue_component, 'amount', amount) order by revenue_stream, revenue_component)
      from component_totals
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

create or replace function public.platform_revenue_activity(
  target_currency_code text default 'NGN',
  target_from timestamptz default null,
  target_until timestamptz default null,
  target_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  resolved_limit integer;
  result jsonb;
begin
  if auth.role() <> 'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.revenue.read', null)
    and not public.has_permission('platform.revenue.manage', null) then
    raise exception 'platform revenue read permission is required';
  end if;

  if target_until is not null and target_from is not null and target_until <= target_from then
    raise exception 'target_until must be after target_from';
  end if;

  resolved_limit := least(greatest(coalesce(target_limit, 100), 1), 500);

  select coalesce(jsonb_agg(activity.payload order by activity.created_at desc), '[]'::jsonb)
  into result
  from (
    select
      ledger.created_at,
      jsonb_build_object(
        'ledgerEntryId', ledger.id,
        'transactionId', ledger.transaction_id,
        'createdAt', ledger.created_at,
        'direction', ledger.direction,
        'amount', ledger.amount,
        'signedAmount', case when ledger.direction = 'credit' then ledger.amount else -ledger.amount end,
        'currencyCode', ledger.currency_code,
        'revenueStream', coalesce(nullif(ledger.metadata ->> 'revenue_stream', ''), 'uncategorized'),
        'revenueComponent', coalesce(nullif(ledger.metadata ->> 'revenue_component', ''), 'uncategorized'),
        'transactionType', transaction.transaction_type,
        'source', transaction.source,
        'subjectType', transaction.subject_type,
        'subjectId', transaction.subject_id,
        'externalReference', transaction.external_reference,
        'metadata', ledger.metadata
      ) as payload
    from public.wallet_ledger_entries ledger
    join public.wallet_accounts wallet on wallet.id = ledger.wallet_id
    join public.financial_transactions transaction on transaction.id = ledger.transaction_id
    where wallet.wallet_type = 'platform_revenue'
      and wallet.owner_entity_type = 'platform'
      and wallet.currency_code = target_currency_code
      and (target_from is null or ledger.created_at >= target_from)
      and (target_until is null or ledger.created_at < target_until)
    order by ledger.created_at desc
    limit resolved_limit
  ) activity;

  return result;
end;
$$;

create or replace function public.read_lpg_platform_revenue_configuration(
  target_currency_code text default 'NGN'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  policy_snapshot jsonb;
  revenue_balance numeric(28,8);
begin
  if auth.role() <> 'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.revenue.read', null)
    and not public.has_permission('platform.revenue.manage', null) then
    raise exception 'platform revenue read permission is required';
  end if;

  policy_snapshot := public.resolve_financial_policy(
    'pricing.lpg.platform_markup_per_kg',
    target_currency_code,
    timezone('utc', now()),
    'lpg',
    null,
    'lpg.refill',
    'global',
    null
  );

  select coalesce(sum(balance.balance), 0)::numeric(28,8)
  into revenue_balance
  from public.wallet_accounts wallet
  left join public.wallet_balances balance
    on balance.wallet_id = wallet.id
   and balance.currency_code = wallet.currency_code
  where wallet.wallet_type = 'platform_revenue'
    and wallet.owner_entity_type = 'platform'
    and wallet.currency_code = target_currency_code
    and wallet.status = 'active';

  return jsonb_build_object(
    'currencyCode', target_currency_code,
    'currentRevenueBalance', revenue_balance,
    'lpgPlatformRevenuePerKg', nullif(policy_snapshot -> 'configuration' ->> 'amount_per_kg', '')::numeric,
    'policyVersionId', policy_snapshot ->> 'policyVersionId',
    'policyVersion', policy_snapshot -> 'version',
    'effectiveFrom', policy_snapshot ->> 'effectiveFrom',
    'effectiveUntil', policy_snapshot ->> 'effectiveUntil'
  );
end;
$$;

create or replace function public.configure_lpg_platform_revenue_rate(
  target_amount_per_kg numeric,
  target_reason text,
  target_idempotency_key text,
  target_effective_from timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_version public.financial_policy_versions%rowtype;
  new_version public.financial_policy_versions%rowtype;
  new_version_id uuid;
  lpg_module_id uuid;
  resolved_effective_from timestamptz;
  previous_state jsonb;
begin
  if auth.role() <> 'service_role' and not public.is_platform_super_admin() then
    raise exception 'only the platform Super Admin can directly change SKIMA LPG revenue per kg';
  end if;

  if target_amount_per_kg is null or target_amount_per_kg < 0 then
    raise exception 'target_amount_per_kg must be zero or greater';
  end if;

  if target_reason is null or char_length(btrim(target_reason)) < 3 then
    raise exception 'a short reason is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select id into lpg_module_id
  from public.business_modules
  where key = 'lpg' and status = 'active'
  limit 1;

  if lpg_module_id is null then
    raise exception 'active LPG business module is required';
  end if;

  select version.*
  into current_version
  from public.financial_policy_versions version
  join public.financial_policy_definitions definition
    on definition.id = version.policy_definition_id
  where definition.key = 'pricing.lpg.platform_markup_per_kg'
    and version.currency_code = 'NGN'
    and version.module_id = lpg_module_id
    and version.organization_id is null
    and version.service_key = 'lpg.refill'
    and version.geography_type = 'global'
    and version.geography_key is null
    and version.lifecycle_status = 'active'
    and version.effective_from <= timezone('utc', now())
    and (version.effective_until is null or version.effective_until > timezone('utc', now()))
  order by version.priority desc, version.effective_from desc, version.version desc
  limit 1;

  if current_version.id is not null
    and nullif(current_version.configuration ->> 'amount_per_kg', '')::numeric = target_amount_per_kg then
    return public.read_lpg_platform_revenue_configuration('NGN') || jsonb_build_object('changed', false);
  end if;

  resolved_effective_from := greatest(
    coalesce(target_effective_from, timezone('utc', now())),
    timezone('utc', now())
  );

  new_version_id := public.create_financial_policy_version(
    target_policy_key => 'pricing.lpg.platform_markup_per_kg',
    target_display_name => 'LPG platform revenue per kilogram',
    target_policy_family => 'service_fee',
    target_currency_code => 'NGN',
    target_configuration => jsonb_build_object(
      'amount_per_kg', target_amount_per_kg,
      'component_key', 'lpg_platform_markup_per_kg',
      'quantity_sensitive', true
    ),
    target_effective_from => resolved_effective_from,
    target_change_reason => btrim(target_reason),
    target_idempotency_key => target_idempotency_key || ':draft',
    target_module_key => 'lpg',
    target_organization_id => null,
    target_service_key => 'lpg.refill',
    target_geography_type => 'global',
    target_geography_key => null,
    target_effective_until => null,
    target_priority => coalesce(current_version.priority, 100),
    target_approval_required => true,
    target_allow_partner_delegation => false,
    target_based_on_version_id => current_version.id,
    target_supersedes_version_id => current_version.id,
    target_rollback_of_version_id => null,
    target_metadata => jsonb_build_object('simple_revenue_control', true)
  );

  select * into new_version
  from public.financial_policy_versions
  where id = new_version_id
  for update;

  if new_version.lifecycle_status = 'draft' then
    perform public.submit_financial_policy_version(
      new_version_id,
      btrim(target_reason),
      target_idempotency_key || ':submit'
    );
  end if;

  select * into new_version
  from public.financial_policy_versions
  where id = new_version_id
  for update;

  if new_version.lifecycle_status = 'submitted' then
    previous_state := to_jsonb(new_version);

    update public.financial_policy_versions
    set lifecycle_status = 'approved',
        approved_by = auth.uid(),
        approved_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = new_version_id;

    insert into public.financial_policy_events (
      policy_version_id,
      event_type,
      actor_user_id,
      previous_state,
      new_state,
      reason,
      idempotency_key
    ) values (
      new_version_id,
      'approved',
      auth.uid(),
      previous_state,
      (select to_jsonb(version.*) from public.financial_policy_versions version where version.id = new_version_id),
      'Super Admin direct approval: ' || btrim(target_reason),
      target_idempotency_key || ':approve'
    ) on conflict (policy_version_id, idempotency_key) do nothing;
  end if;

  select * into new_version
  from public.financial_policy_versions
  where id = new_version_id;

  if new_version.lifecycle_status = 'approved' then
    perform public.activate_financial_policy_version(
      new_version_id,
      btrim(target_reason),
      target_idempotency_key || ':activate'
    );
  end if;

  return public.read_lpg_platform_revenue_configuration('NGN') || jsonb_build_object(
    'changed', true,
    'newPolicyVersionId', new_version_id
  );
end;
$$;

create or replace function public.provision_lpg_station_catalog_after_approval()
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

drop trigger if exists provision_lpg_station_catalog_after_approval on public.lpg_station_branches;
create trigger provision_lpg_station_catalog_after_approval
after insert or update of approval_status, compliance_status, organization_id, branch_id
on public.lpg_station_branches
for each row
execute function public.provision_lpg_station_catalog_after_approval();

do $$
declare
  station_record record;
begin
  for station_record in
    select id
    from public.lpg_station_branches
    where approval_status = 'approved'
      and compliance_status = 'approved'
  loop
    perform public.ensure_lpg_station_refill_catalog_item(station_record.id);
  end loop;
end;
$$;

create or replace function public.read_lpg_station_catalog_prices(
  target_station_branch_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  station_record public.lpg_station_branches%rowtype;
  lpg_module_id uuid;
begin
  select * into station_record
  from public.lpg_station_branches station
  where (target_station_branch_id is null or station.id = target_station_branch_id)
    and public.can_read_lpg_station_branch(station.id)
  order by station.created_at asc
  limit 1;

  if not found then
    raise exception 'branch-scoped LPG station access is required';
  end if;

  select id into lpg_module_id
  from public.business_modules
  where key = 'lpg' and status = 'active'
  limit 1;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', catalog_price.id,
        'itemId', catalog_item.id,
        'itemKey', catalog_item.key,
        'displayName', catalog_item.display_name,
        'currencyCode', coalesce(catalog_price.currency_code, 'NGN'),
        'pricePerKg', catalog_price.amount,
        'status', coalesce(catalog_price.status, 'unpriced'),
        'priceConfigured', catalog_price.id is not null,
        'effectiveFrom', catalog_price.effective_from,
        'effectiveUntil', catalog_price.effective_until,
        'createdAt', coalesce(catalog_price.created_at, catalog_item.created_at)
      )
      order by catalog_item.display_name
    )
    from public.catalog_items catalog_item
    left join lateral (
      select price.*
      from public.catalog_prices price
      where price.organization_id = station_record.organization_id
        and price.branch_id is not distinct from station_record.branch_id
        and price.item_id = catalog_item.id
        and price.currency_code = 'NGN'
        and price.metadata ->> 'price_basis' = 'per_kg'
        and price.status in ('active', 'scheduled')
      order by
        case
          when price.status = 'active'
            and price.effective_from <= timezone('utc', now())
            and (price.effective_until is null or price.effective_until > timezone('utc', now()))
          then 0 else 1
        end,
        price.effective_from desc
      limit 1
    ) catalog_price on true
    where catalog_item.organization_id = station_record.organization_id
      and catalog_item.branch_id is not distinct from station_record.branch_id
      and catalog_item.module_id = lpg_module_id
      and catalog_item.status = 'active'
      and catalog_item.metadata ->> 'price_basis' = 'per_kg'
  ), '[]'::jsonb);
end;
$$;

alter table public.lpg_refill_orders
  add column if not exists quoted_kg numeric generated always as (requested_kg) stored;

comment on column public.lpg_refill_orders.quoted_kg is
  'Read-only compatibility mirror of requested_kg for deployed LPG order APIs; authoritative accepted quote quantity remains on the quote snapshot.';

revoke all on function public.read_lpg_platform_revenue_configuration(text) from public, anon;
revoke all on function public.configure_lpg_platform_revenue_rate(numeric,text,text,timestamptz) from public, anon;
revoke all on function public.platform_revenue_summary(text,timestamptz,timestamptz) from public, anon;
revoke all on function public.platform_revenue_activity(text,timestamptz,timestamptz,integer) from public, anon;
grant execute on function public.read_lpg_platform_revenue_configuration(text) to authenticated, service_role;
grant execute on function public.configure_lpg_platform_revenue_rate(numeric,text,text,timestamptz) to authenticated, service_role;
grant execute on function public.platform_revenue_summary(text,timestamptz,timestamptz) to authenticated, service_role;
grant execute on function public.platform_revenue_activity(text,timestamptz,timestamptz,integer) to authenticated, service_role;
