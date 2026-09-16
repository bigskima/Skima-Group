begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

create table if not exists public.utility_service_fee_settings (
  currency_code text primary key references public.currency_definitions(code),
  fee_percent numeric(12,6) not null default 0 check (fee_percent between 0 and 100),
  fee_fixed numeric(20,8) not null default 0 check (fee_fixed >= 0),
  status text not null default 'active' check (status in ('active','inactive')),
  source text not null default 'skima.admin.utility_service_fee',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.utility_service_fee_settings enable row level security;
revoke all on table public.utility_service_fee_settings from public, anon, authenticated;
grant select, insert, update, delete on table public.utility_service_fee_settings to service_role;

insert into public.utility_service_fee_settings (
  currency_code, fee_percent, fee_fixed, status, source, metadata
)
values ('NGN', 0, 0, 'active', 'skima.admin.utility_service_fee', '{"launchDefault":true}'::jsonb)
on conflict (currency_code) do nothing;

create or replace function public.set_utility_service_fee(
  target_currency_code text default 'NGN',
  target_fee_percent numeric default 0,
  target_fee_fixed numeric default 0,
  target_status text default 'active'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  before_record public.utility_service_fee_settings%rowtype;
  after_record public.utility_service_fee_settings%rowtype;
begin
  if not (
    public.has_permission('platform.billing.manage', null)
    or public.is_platform_super_admin()
  ) then
    raise exception using errcode = '42501', message = 'bill service management permission is required';
  end if;

  if target_currency_code is null or btrim(target_currency_code) = '' then
    raise exception 'currency code is required';
  end if;
  if target_fee_percent is null or target_fee_percent < 0 or target_fee_percent > 100 then
    raise exception 'utility service fee percent must be between 0 and 100';
  end if;
  if target_fee_fixed is null or target_fee_fixed < 0 then
    raise exception 'utility service fixed fee cannot be negative';
  end if;
  if target_status not in ('active','inactive') then
    raise exception 'utility service fee status must be active or inactive';
  end if;
  if not exists (
    select 1 from public.currency_definitions c where c.code = upper(btrim(target_currency_code))
  ) then
    raise exception 'choose a configured platform currency';
  end if;

  select * into before_record
  from public.utility_service_fee_settings
  where currency_code = upper(btrim(target_currency_code));

  insert into public.utility_service_fee_settings (
    currency_code, fee_percent, fee_fixed, status, updated_by, updated_at
  )
  values (
    upper(btrim(target_currency_code)), target_fee_percent, target_fee_fixed,
    target_status, auth.uid(), timezone('utc', now())
  )
  on conflict (currency_code) do update
  set fee_percent = excluded.fee_percent,
      fee_fixed = excluded.fee_fixed,
      status = excluded.status,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  returning * into after_record;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id,
    before_state, after_state, metadata
  ) values (
    auth.uid(),
    'utility.service_fee.updated',
    'utility_service_fee_setting',
    null,
    case when before_record.currency_code is null then null else to_jsonb(before_record) end,
    to_jsonb(after_record),
    jsonb_build_object('source','skima.admin.utility_billing')
  );

  return jsonb_build_object(
    'currencyCode', after_record.currency_code,
    'feePercent', after_record.fee_percent,
    'feeFixed', after_record.fee_fixed,
    'status', after_record.status,
    'updatedAt', after_record.updated_at
  );
end;
$$;

revoke all on function public.set_utility_service_fee(text,numeric,numeric,text) from public, anon;
grant execute on function public.set_utility_service_fee(text,numeric,numeric,text) to authenticated, service_role;

create or replace function public.set_utility_provider_treasury_policy(
  target_provider_key text,
  target_low_balance_threshold numeric default null,
  target_target_balance numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  provider_record public.provider_adapters%rowtype;
  next_config jsonb;
begin
  if not (
    public.has_permission('platform.billing.manage', null)
    or public.is_platform_super_admin()
  ) then
    raise exception using errcode = '42501', message = 'bill service management permission is required';
  end if;

  if target_low_balance_threshold is not null and target_low_balance_threshold < 0 then
    raise exception 'low balance threshold cannot be negative';
  end if;
  if target_target_balance is not null and target_target_balance < 0 then
    raise exception 'target provider balance cannot be negative';
  end if;
  if target_low_balance_threshold is not null
     and target_target_balance is not null
     and target_target_balance < target_low_balance_threshold then
    raise exception 'target provider balance must be at least the low balance threshold';
  end if;

  select * into provider_record
  from public.provider_adapters
  where provider_kind = 'utility' and key = target_provider_key
  for update;

  if not found then raise exception 'utility provider was not found'; end if;

  next_config := coalesce(provider_record.config, '{}'::jsonb)
    || jsonb_build_object(
      'lowBalanceThreshold', target_low_balance_threshold,
      'targetBalance', target_target_balance,
      'treasuryPolicyUpdatedAt', timezone('utc', now())
    );

  update public.provider_adapters
  set config = next_config,
      updated_at = timezone('utc', now())
  where id = provider_record.id;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id,
    before_state, after_state, metadata
  ) values (
    auth.uid(),
    'utility.provider.treasury_policy.updated',
    'provider_adapter',
    provider_record.id,
    jsonb_build_object(
      'lowBalanceThreshold', provider_record.config->'lowBalanceThreshold',
      'targetBalance', provider_record.config->'targetBalance'
    ),
    jsonb_build_object(
      'lowBalanceThreshold', target_low_balance_threshold,
      'targetBalance', target_target_balance
    ),
    jsonb_build_object('source','skima.admin.utility_billing')
  );

  return jsonb_build_object(
    'providerKey', target_provider_key,
    'lowBalanceThreshold', target_low_balance_threshold,
    'targetBalance', target_target_balance
  );
end;
$$;

revoke all on function public.set_utility_provider_treasury_policy(text,numeric,numeric) from public, anon;
grant execute on function public.set_utility_provider_treasury_policy(text,numeric,numeric) to authenticated, service_role;

create or replace function public.calculate_utility_route_economics(
  target_route_id uuid,
  target_face_amount numeric,
  target_margin_campaign_cost numeric default 0,
  target_subsidized_campaign_cost numeric default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  route_record public.utility_provider_routes%rowtype;
  economics_record public.utility_route_economics%rowtype;
  service_fee_record public.utility_service_fee_settings%rowtype;
  route_currency text := 'NGN';
  provider_discount numeric := 0;
  provider_cost numeric := 0;
  route_customer_fee numeric := 0;
  platform_service_fee numeric := 0;
  customer_fee numeric := 0;
  collection_cost numeric := 0;
  operating_reserve numeric := 0;
  minimum_profit numeric := 0;
  gross_margin numeric := 0;
  safe_campaign numeric := 0;
  contribution numeric := 0;
  economics_configured boolean := false;
begin
  if target_face_amount is null or target_face_amount <= 0 then
    raise exception 'face amount must be greater than zero';
  end if;

  select * into route_record
  from public.utility_provider_routes
  where id = target_route_id;
  if not found then raise exception 'utility route was not found'; end if;

  select product.currency_code into route_currency
  from public.utility_products product
  where product.id = route_record.product_id;
  route_currency := coalesce(route_currency, 'NGN');

  select * into economics_record
  from public.utility_route_economics
  where route_id = target_route_id and status = 'active';
  economics_configured := found;

  if economics_configured then
    provider_discount := least(
      target_face_amount,
      target_face_amount * economics_record.provider_discount_percent / 100
        + economics_record.provider_discount_fixed
    );
    route_customer_fee :=
      target_face_amount * economics_record.customer_fee_percent / 100
      + economics_record.customer_fee_fixed;
    collection_cost :=
      target_face_amount * economics_record.collection_cost_percent / 100
      + economics_record.collection_cost_fixed;
    operating_reserve :=
      target_face_amount * economics_record.operating_reserve_percent / 100
      + economics_record.operating_reserve_fixed;
    minimum_profit := greatest(
      target_face_amount * economics_record.minimum_profit_percent / 100,
      economics_record.minimum_profit_fixed
    );
  else
    route_customer_fee := coalesce((route_record.fee_config->>'fixedAmount')::numeric, 0);
  end if;

  select * into service_fee_record
  from public.utility_service_fee_settings
  where currency_code = route_currency and status = 'active';

  if found then
    platform_service_fee :=
      target_face_amount * service_fee_record.fee_percent / 100
      + service_fee_record.fee_fixed;
  end if;

  customer_fee := route_customer_fee + platform_service_fee;
  provider_cost := greatest(0, target_face_amount - provider_discount);
  gross_margin := provider_discount + customer_fee - collection_cost - operating_reserve;
  safe_campaign := greatest(0, gross_margin - minimum_profit);
  contribution := gross_margin - coalesce(target_margin_campaign_cost, 0);

  return jsonb_build_object(
    'economicsConfigured', economics_configured,
    'routeId', target_route_id,
    'faceAmount', target_face_amount,
    'providerDiscount', provider_discount,
    'providerCost', provider_cost,
    'routeCustomerFee', route_customer_fee,
    'platformServiceFee', platform_service_fee,
    'customerFee', customer_fee,
    'collectionCost', collection_cost,
    'operatingReserve', operating_reserve,
    'grossMarginBeforeCampaign', gross_margin,
    'minimumProfit', minimum_profit,
    'maxSafeMarginCampaign', safe_campaign,
    'marginCampaignCost', coalesce(target_margin_campaign_cost, 0),
    'subsidizedCampaignCost', coalesce(target_subsidized_campaign_cost, 0),
    'contributionProfit', contribution,
    'profitable', economics_configured and contribution >= minimum_profit,
    'currencyCode', route_currency,
    'serviceFeePercent', coalesce(service_fee_record.fee_percent, 0),
    'serviceFeeFixed', coalesce(service_fee_record.fee_fixed, 0)
  );
end;
$$;

revoke all on function public.calculate_utility_route_economics(uuid,numeric,numeric,numeric) from public, anon;
grant execute on function public.calculate_utility_route_economics(uuid,numeric,numeric,numeric) to authenticated, service_role;

drop function if exists public.read_utility_catalog();
create function public.read_utility_catalog()
returns table(
  category_id uuid,
  category_key text,
  category_name text,
  category_description text,
  icon_key text,
  biller_id uuid,
  biller_key text,
  biller_name text,
  biller_logo_url text,
  customer_identifier_label text,
  customer_identifier_hint text,
  product_id uuid,
  product_key text,
  product_name text,
  amount_mode text,
  fixed_amount numeric,
  minimum_amount numeric,
  maximum_amount numeric,
  currency_code text,
  service_fee_percent numeric,
  service_fee_fixed numeric,
  available boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    category.id, category.key, category.display_name, category.description, category.icon_key,
    biller.id, biller.key, biller.display_name, biller.logo_url,
    biller.customer_identifier_label, biller.customer_identifier_hint,
    product.id, product.key, product.display_name, product.amount_mode,
    product.fixed_amount, product.minimum_amount, product.maximum_amount, product.currency_code,
    coalesce(service_fee.fee_percent, 0),
    coalesce(service_fee.fee_fixed, 0),
    product.amount_mode <> 'provider'
    and exists(
      select 1
      from public.utility_provider_routes route
      join public.provider_adapters adapter on adapter.id = route.provider_adapter_id
      join public.utility_route_economics economics
        on economics.route_id = route.id and economics.status = 'active'
      where route.product_id = product.id
        and route.status = 'active'
        and adapter.status = 'active'
        and adapter.provider_kind = 'utility'
        and adapter.secret_ref is not null
        and coalesce((adapter.config->>'runtimeReady')::boolean, false) = true
        and coalesce((
          public.calculate_utility_route_economics(
            route.id,
            coalesce(
              case when product.amount_mode = 'fixed' then product.fixed_amount end,
              product.minimum_amount,
              economics.minimum_economic_amount
            ),
            0, 0
          )->>'profitable'
        )::boolean, false) = true
    )
  from public.utility_service_categories category
  join public.utility_billers biller
    on biller.category_id = category.id and biller.status = 'active'
  join public.utility_products product
    on product.biller_id = biller.id and product.status = 'active'
  left join public.utility_service_fee_settings service_fee
    on service_fee.currency_code = product.currency_code and service_fee.status = 'active'
  where category.status = 'active'
  order by category.sort_order, category.display_name, product.sort_order, product.display_name;
$$;

revoke all on function public.read_utility_catalog() from public, anon;
grant execute on function public.read_utility_catalog() to authenticated, service_role;

create or replace function public.read_utility_admin_configuration()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (
    public.has_permission('platform.billing.read', null)
    or public.is_platform_super_admin()
  ) then
    raise exception using errcode = '42501', message = 'bill service access is required';
  end if;

  return jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(row_to_json(item) order by item.sort_order, item.display_name)
      from public.utility_service_categories item
    ), '[]'::jsonb),
    'billers', coalesce((
      select jsonb_agg(row_to_json(item) order by item.display_name)
      from public.utility_billers item
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(row_to_json(item) order by item.sort_order, item.display_name)
      from public.utility_products item
    ), '[]'::jsonb),
    'routes', coalesce((
      select jsonb_agg(
        to_jsonb(route) || jsonb_build_object(
          'product_key', product.key,
          'product_name', product.display_name,
          'provider_key', provider.key,
          'provider_name', provider.display_name
        ) order by route.priority
      )
      from public.utility_provider_routes route
      join public.utility_products product on product.id = route.product_id
      join public.provider_adapters provider on provider.id = route.provider_adapter_id
    ), '[]'::jsonb),
    'economics', coalesce((
      select jsonb_agg(
        to_jsonb(economics) || jsonb_build_object(
          'product_key', product.key,
          'product_name', product.display_name,
          'biller_name', biller.display_name,
          'category_name', category.display_name,
          'provider_key', provider.key,
          'provider_name', provider.display_name
        ) order by category.display_name, biller.display_name, product.display_name, provider.display_name
      )
      from public.utility_route_economics economics
      join public.utility_provider_routes route on route.id = economics.route_id
      join public.utility_products product on product.id = route.product_id
      join public.utility_billers biller on biller.id = product.biller_id
      join public.utility_service_categories category on category.id = biller.category_id
      join public.provider_adapters provider on provider.id = route.provider_adapter_id
    ), '[]'::jsonb),
    'serviceFees', coalesce((
      select jsonb_agg(row_to_json(item) order by item.currency_code)
      from public.utility_service_fee_settings item
    ), '[]'::jsonb),
    'providers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', item.id,
          'key', item.key,
          'display_name', item.display_name,
          'status', item.status,
          'provider_family', item.config->>'providerFamily',
          'environment', item.config->>'environment',
          'base_url', item.config->>'baseUrl',
          'website_url', item.config->>'websiteUrl',
          'documentation_url', item.config->>'documentationUrl',
          'runtime_ready', coalesce((item.config->>'runtimeReady')::boolean, false),
          'catalog_sync_ready', coalesce((item.config->>'catalogSyncReady')::boolean, false),
          'secret_configured', item.secret_ref is not null,
          'last_known_balance', case when coalesce(item.config->>'lastKnownBalance','') ~ '^-?[0-9]+([.][0-9]+)?$' then (item.config->>'lastKnownBalance')::numeric else null end,
          'balance_currency', item.config->>'balanceCurrency',
          'last_balance_check_at', item.config->>'lastBalanceCheckAt',
          'low_balance_threshold', case when coalesce(item.config->>'lowBalanceThreshold','') ~ '^-?[0-9]+([.][0-9]+)?$' then (item.config->>'lowBalanceThreshold')::numeric else null end,
          'target_balance', case when coalesce(item.config->>'targetBalance','') ~ '^-?[0-9]+([.][0-9]+)?$' then (item.config->>'targetBalance')::numeric else null end
        ) order by item.display_name
      )
      from public.provider_adapters item
      where item.provider_kind = 'utility'
    ), '[]'::jsonb),
    'treasury', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'provider_key', provider.key,
          'provider_name', provider.display_name,
          'last_known_balance', provider_metrics.last_known_balance,
          'balance_currency', coalesce(provider.config->>'balanceCurrency','NGN'),
          'last_balance_check_at', provider.config->>'lastBalanceCheckAt',
          'low_balance_threshold', provider_metrics.low_balance_threshold,
          'target_balance', provider_metrics.target_balance,
          'balance_low', case
            when provider_metrics.last_known_balance is null or provider_metrics.low_balance_threshold is null then false
            else provider_metrics.last_known_balance <= provider_metrics.low_balance_threshold
          end,
          'recommended_top_up', case
            when provider_metrics.last_known_balance is null or provider_metrics.target_balance is null then null
            else greatest(0, provider_metrics.target_balance - provider_metrics.last_known_balance)
          end,
          'provider_spend_today', coalesce(spend.provider_spend_today,0),
          'provider_spend_7d', coalesce(spend.provider_spend_7d,0),
          'pending_provider_cost', coalesce(spend.pending_provider_cost,0)
        ) order by provider.display_name
      )
      from public.provider_adapters provider
      cross join lateral (
        select
          case when coalesce(provider.config->>'lastKnownBalance','') ~ '^-?[0-9]+([.][0-9]+)?$' then (provider.config->>'lastKnownBalance')::numeric else null end as last_known_balance,
          case when coalesce(provider.config->>'lowBalanceThreshold','') ~ '^-?[0-9]+([.][0-9]+)?$' then (provider.config->>'lowBalanceThreshold')::numeric else null end as low_balance_threshold,
          case when coalesce(provider.config->>'targetBalance','') ~ '^-?[0-9]+([.][0-9]+)?$' then (provider.config->>'targetBalance')::numeric else null end as target_balance
      ) provider_metrics
      left join lateral (
        select
          coalesce(sum(request.provider_cost_amount) filter (
            where request.status = 'succeeded'
              and request.created_at >= date_trunc('day', timezone('utc', now()))
          ),0) as provider_spend_today,
          coalesce(sum(request.provider_cost_amount) filter (
            where request.status = 'succeeded'
              and request.created_at >= timezone('utc', now()) - interval '7 days'
          ),0) as provider_spend_7d,
          coalesce(sum(request.provider_cost_amount) filter (
            where request.status in ('processing','reconciliation_required')
          ),0) as pending_provider_cost
        from public.utility_payment_requests request
        join public.utility_provider_routes route on route.id = request.provider_route_id
        where route.provider_adapter_id = provider.id
      ) spend on true
      where provider.provider_kind = 'utility'
    ), '[]'::jsonb),
    'syncRuns', coalesce((
      select jsonb_agg(
        to_jsonb(run) || jsonb_build_object(
          'provider_key', provider.key,
          'provider_name', provider.display_name
        ) order by run.started_at desc
      )
      from (
        select * from public.utility_provider_catalog_sync_runs
        order by started_at desc limit 50
      ) run
      join public.provider_adapters provider on provider.id = run.provider_adapter_id
    ), '[]'::jsonb),
    'promotions', coalesce((
      select jsonb_agg(row_to_json(item) order by item.created_at desc)
      from public.utility_promotions item
    ), '[]'::jsonb),
    'cashbacks', coalesce((
      select jsonb_agg(row_to_json(item) order by item.created_at desc)
      from public.utility_reward_policies item
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(row_to_json(item) order by item.created_at desc)
      from (
        select * from public.utility_payment_requests
        order by created_at desc limit 200
      ) item
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.read_utility_admin_configuration() from public, anon;
grant execute on function public.read_utility_admin_configuration() to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
