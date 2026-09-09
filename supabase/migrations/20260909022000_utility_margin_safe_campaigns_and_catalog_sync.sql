begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- Provider-neutral economics for every utility route. A route represents
-- "SKIMA product -> provider product"; this table describes what that route
-- costs and the minimum contribution SKIMA must retain.
create table if not exists public.utility_route_economics (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null unique references public.utility_provider_routes(id) on delete cascade,
  currency_code text not null default 'NGN' references public.currency_definitions(code),
  provider_discount_percent numeric(12,6) not null default 0 check (provider_discount_percent between 0 and 100),
  provider_discount_fixed numeric(20,8) not null default 0 check (provider_discount_fixed >= 0),
  collection_cost_percent numeric(12,6) not null default 0 check (collection_cost_percent between 0 and 100),
  collection_cost_fixed numeric(20,8) not null default 0 check (collection_cost_fixed >= 0),
  operating_reserve_percent numeric(12,6) not null default 0 check (operating_reserve_percent between 0 and 100),
  operating_reserve_fixed numeric(20,8) not null default 0 check (operating_reserve_fixed >= 0),
  minimum_profit_percent numeric(12,6) not null default 0 check (minimum_profit_percent between 0 and 100),
  minimum_profit_fixed numeric(20,8) not null default 0 check (minimum_profit_fixed >= 0),
  customer_fee_percent numeric(12,6) not null default 0 check (customer_fee_percent between 0 and 100),
  customer_fee_fixed numeric(20,8) not null default 0 check (customer_fee_fixed >= 0),
  minimum_economic_amount numeric(20,8) not null default 100 check (minimum_economic_amount > 0),
  status text not null default 'inactive' check (status in ('inactive','active')),
  source text not null default 'skima.admin.utility_economics',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now())
);

create index if not exists utility_route_economics_status_idx
  on public.utility_route_economics(status, route_id);

alter table public.utility_route_economics enable row level security;

-- Campaign funding is explicit. Margin-funded campaigns must fit inside the
-- provider margin. Marketing/sponsor campaigns may exceed route margin only
-- against an explicit budget.
alter table public.utility_promotions
  add column if not exists funding_mode text not null default 'margin',
  add column if not exists budget_amount numeric(20,8),
  add column if not exists budget_reserved numeric(20,8) not null default 0,
  add column if not exists budget_spent numeric(20,8) not null default 0,
  add column if not exists sponsor_reference text;

alter table public.utility_reward_policies
  add column if not exists funding_mode text not null default 'margin',
  add column if not exists budget_amount numeric(20,8),
  add column if not exists budget_reserved numeric(20,8) not null default 0,
  add column if not exists budget_spent numeric(20,8) not null default 0,
  add column if not exists sponsor_reference text;

alter table public.utility_promotions
  drop constraint if exists utility_promotions_funding_mode_check;
alter table public.utility_promotions
  add constraint utility_promotions_funding_mode_check
  check (funding_mode in ('margin','marketing_budget','sponsor'));

alter table public.utility_promotions
  drop constraint if exists utility_promotions_budget_amount_check;
alter table public.utility_promotions
  add constraint utility_promotions_budget_amount_check
  check (budget_amount is null or budget_amount > 0);

alter table public.utility_promotions
  drop constraint if exists utility_promotions_budget_counters_check;
alter table public.utility_promotions
  add constraint utility_promotions_budget_counters_check
  check (budget_reserved >= 0 and budget_spent >= 0);

alter table public.utility_reward_policies
  drop constraint if exists utility_reward_policies_funding_mode_check;
alter table public.utility_reward_policies
  add constraint utility_reward_policies_funding_mode_check
  check (funding_mode in ('margin','marketing_budget','sponsor'));

alter table public.utility_reward_policies
  drop constraint if exists utility_reward_policies_budget_amount_check;
alter table public.utility_reward_policies
  add constraint utility_reward_policies_budget_amount_check
  check (budget_amount is null or budget_amount > 0);

alter table public.utility_reward_policies
  drop constraint if exists utility_reward_policies_budget_counters_check;
alter table public.utility_reward_policies
  add constraint utility_reward_policies_budget_counters_check
  check (budget_reserved >= 0 and budget_spent >= 0);

-- Every bill request snapshots the expected economics so later provider,
-- commission, fee or campaign changes cannot rewrite historical profitability.
alter table public.utility_payment_requests
  add column if not exists cashback_policy_id uuid references public.utility_reward_policies(id) on delete set null,
  add column if not exists expected_cashback_amount numeric(20,8) not null default 0,
  add column if not exists provider_cost_amount numeric(20,8),
  add column if not exists provider_margin_amount numeric(20,8),
  add column if not exists collection_cost_amount numeric(20,8),
  add column if not exists operating_reserve_amount numeric(20,8),
  add column if not exists margin_campaign_cost_amount numeric(20,8) not null default 0,
  add column if not exists subsidized_campaign_cost_amount numeric(20,8) not null default 0,
  add column if not exists contribution_profit_amount numeric(20,8),
  add column if not exists minimum_profit_amount numeric(20,8),
  add column if not exists economics_snapshot jsonb not null default '{}'::jsonb;

alter table public.utility_payment_requests
  drop constraint if exists utility_payment_requests_expected_cashback_check;
alter table public.utility_payment_requests
  add constraint utility_payment_requests_expected_cashback_check
  check (
    expected_cashback_amount >= 0
    and margin_campaign_cost_amount >= 0
    and subsidized_campaign_cost_amount >= 0
  );

-- Provider catalog ingestion is adapter-neutral. A provider-specific adapter
-- converts its payload into this canonical contract; SKIMA then publishes it
-- as draft catalog records for admin curation.
create table if not exists public.utility_provider_catalog_sync_runs (
  id uuid primary key default gen_random_uuid(),
  provider_adapter_id uuid not null references public.provider_adapters(id) on delete cascade,
  status text not null default 'running' check (status in ('running','staged','published','failed')),
  source text not null default 'platform.utility_catalog_sync',
  idempotency_key text not null,
  item_count integer not null default 0 check (item_count >= 0),
  error_message text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  started_at timestamptz not null default timezone('utc',now()),
  completed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  unique(provider_adapter_id,idempotency_key)
);

create table if not exists public.utility_provider_catalog_items (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references public.utility_provider_catalog_sync_runs(id) on delete cascade,
  provider_adapter_id uuid not null references public.provider_adapters(id) on delete cascade,
  item_type text not null check (item_type in ('category','biller','product')),
  external_key text not null,
  canonical_key text not null,
  canonical_parent_key text,
  display_name text not null,
  provider_product_code text,
  amount_mode text check (amount_mode is null or amount_mode in ('customer','fixed','provider')),
  fixed_amount numeric(20,8),
  minimum_amount numeric(20,8),
  maximum_amount numeric(20,8),
  currency_code text not null default 'NGN',
  customer_identifier_label text,
  customer_identifier_hint text,
  normalized_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(normalized_payload)='object'),
  raw_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_payload)='object'),
  status text not null default 'available' check (status in ('available','unavailable')),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  unique(sync_run_id,item_type,external_key)
);

create index if not exists utility_provider_catalog_items_provider_idx
  on public.utility_provider_catalog_items(provider_adapter_id,item_type,canonical_key);

alter table public.utility_provider_catalog_sync_runs enable row level security;
alter table public.utility_provider_catalog_items enable row level security;

create or replace function public.calculate_utility_campaign_amount(
  target_calculation_kind text,
  target_value numeric,
  target_maximum_amount numeric,
  target_face_amount numeric
)
returns numeric
language sql
immutable
as $$
  select greatest(
    0::numeric,
    least(
      case
        when target_calculation_kind='percentage'
          then target_face_amount * target_value / 100
        else target_value
      end,
      coalesce(target_maximum_amount,target_face_amount),
      target_face_amount
    )
  );
$$;

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
set search_path=public,pg_temp
as $$
declare
  route_record public.utility_provider_routes%rowtype;
  economics_record public.utility_route_economics%rowtype;
  provider_discount numeric := 0;
  provider_cost numeric := 0;
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
  where id=target_route_id;

  if not found then raise exception 'utility route was not found'; end if;

  select * into economics_record
  from public.utility_route_economics
  where route_id=target_route_id
    and status='active';

  economics_configured := found;

  if economics_configured then
    provider_discount := least(
      target_face_amount,
      target_face_amount * economics_record.provider_discount_percent / 100
        + economics_record.provider_discount_fixed
    );
    customer_fee :=
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
    customer_fee := coalesce((route_record.fee_config->>'fixedAmount')::numeric,0);
  end if;

  provider_cost := greatest(0,target_face_amount-provider_discount);
  gross_margin := provider_discount + customer_fee - collection_cost - operating_reserve;
  safe_campaign := greatest(0,gross_margin-minimum_profit);
  contribution := gross_margin-coalesce(target_margin_campaign_cost,0);

  return jsonb_build_object(
    'economicsConfigured', economics_configured,
    'routeId', target_route_id,
    'faceAmount', target_face_amount,
    'providerDiscount', provider_discount,
    'providerCost', provider_cost,
    'customerFee', customer_fee,
    'collectionCost', collection_cost,
    'operatingReserve', operating_reserve,
    'grossMarginBeforeCampaign', gross_margin,
    'minimumProfit', minimum_profit,
    'maxSafeMarginCampaign', safe_campaign,
    'marginCampaignCost', coalesce(target_margin_campaign_cost,0),
    'subsidizedCampaignCost', coalesce(target_subsidized_campaign_cost,0),
    'contributionProfit', contribution,
    'profitable',
      economics_configured
      and contribution >= minimum_profit,
    'currencyCode', coalesce(economics_record.currency_code,'NGN')
  );
end;
$$;

revoke all on function public.calculate_utility_route_economics(uuid,numeric,numeric,numeric)
from public,anon;
grant execute on function public.calculate_utility_route_economics(uuid,numeric,numeric,numeric)
to authenticated,service_role;

create or replace function public.configure_utility_route_economics(
  target_product_key text,
  target_provider_adapter_key text,
  target_provider_discount_percent numeric default 0,
  target_provider_discount_fixed numeric default 0,
  target_collection_cost_percent numeric default 0,
  target_collection_cost_fixed numeric default 0,
  target_operating_reserve_percent numeric default 0,
  target_operating_reserve_fixed numeric default 0,
  target_minimum_profit_percent numeric default 0,
  target_minimum_profit_fixed numeric default 0,
  target_customer_fee_percent numeric default 0,
  target_customer_fee_fixed numeric default 0,
  target_minimum_economic_amount numeric default 100,
  target_status text default 'active',
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  route_record_id uuid;
  product_currency text;
  configured_id uuid;
begin
  if auth.role()<>'service_role'
     and not (
       public.has_permission('platform.billing.manage',null)
       or public.is_platform_super_admin()
     ) then
    raise exception using errcode='42501',
      message='bill service management permission is required';
  end if;

  if target_status not in ('inactive','active') then
    raise exception 'economics status must be inactive or active';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception 'economics metadata must be a JSON object';
  end if;

  if target_minimum_economic_amount is null or target_minimum_economic_amount<=0 then
    raise exception 'minimum economic amount must be greater than zero';
  end if;

  if target_provider_discount_percent not between 0 and 100
     or target_collection_cost_percent not between 0 and 100
     or target_operating_reserve_percent not between 0 and 100
     or target_minimum_profit_percent not between 0 and 100
     or target_customer_fee_percent not between 0 and 100 then
    raise exception 'percentage values must be between 0 and 100';
  end if;

  if least(
    target_provider_discount_fixed,
    target_collection_cost_fixed,
    target_operating_reserve_fixed,
    target_minimum_profit_fixed,
    target_customer_fee_fixed
  ) < 0 then
    raise exception 'fixed economics values cannot be negative';
  end if;

  select route.id,product.currency_code
  into route_record_id,product_currency
  from public.utility_provider_routes route
  join public.utility_products product on product.id=route.product_id
  join public.provider_adapters provider on provider.id=route.provider_adapter_id
  where product.key=target_product_key
    and provider.key=target_provider_adapter_key
    and provider.provider_kind='utility';

  if route_record_id is null then
    raise exception 'create the product-to-provider route before configuring its economics';
  end if;

  insert into public.utility_route_economics(
    route_id,currency_code,provider_discount_percent,provider_discount_fixed,
    collection_cost_percent,collection_cost_fixed,
    operating_reserve_percent,operating_reserve_fixed,
    minimum_profit_percent,minimum_profit_fixed,
    customer_fee_percent,customer_fee_fixed,minimum_economic_amount,
    status,metadata,created_by
  )
  values(
    route_record_id,product_currency,
    target_provider_discount_percent,target_provider_discount_fixed,
    target_collection_cost_percent,target_collection_cost_fixed,
    target_operating_reserve_percent,target_operating_reserve_fixed,
    target_minimum_profit_percent,target_minimum_profit_fixed,
    target_customer_fee_percent,target_customer_fee_fixed,
    target_minimum_economic_amount,target_status,target_metadata,auth.uid()
  )
  on conflict(route_id) do update
  set provider_discount_percent=excluded.provider_discount_percent,
      provider_discount_fixed=excluded.provider_discount_fixed,
      collection_cost_percent=excluded.collection_cost_percent,
      collection_cost_fixed=excluded.collection_cost_fixed,
      operating_reserve_percent=excluded.operating_reserve_percent,
      operating_reserve_fixed=excluded.operating_reserve_fixed,
      minimum_profit_percent=excluded.minimum_profit_percent,
      minimum_profit_fixed=excluded.minimum_profit_fixed,
      customer_fee_percent=excluded.customer_fee_percent,
      customer_fee_fixed=excluded.customer_fee_fixed,
      minimum_economic_amount=excluded.minimum_economic_amount,
      status=excluded.status,
      metadata=public.utility_route_economics.metadata||excluded.metadata,
      updated_at=timezone('utc',now())
  returning id into configured_id;

  update public.utility_provider_routes
  set fee_config=jsonb_build_object(
        'fixedAmount',target_customer_fee_fixed,
        'percentageAmount',target_customer_fee_percent,
        'source','utility_route_economics'
      ),
      updated_at=timezone('utc',now())
  where id=route_record_id;

  insert into public.audit_logs(
    actor_user_id,action,entity_type,entity_id,after_state,metadata
  )
  values(
    auth.uid(),'utility.route_economics.configured','utility_route_economics',
    configured_id,
    jsonb_build_object(
      'productKey',target_product_key,
      'providerKey',target_provider_adapter_key,
      'providerDiscountPercent',target_provider_discount_percent,
      'minimumProfitPercent',target_minimum_profit_percent,
      'customerFeePercent',target_customer_fee_percent,
      'status',target_status
    ),
    jsonb_build_object('source','skima.admin.utility_economics')
  );

  return configured_id;
end;
$$;

revoke all on function public.configure_utility_route_economics(
  text,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,
  numeric,numeric,numeric,text,jsonb
) from public,anon;
grant execute on function public.configure_utility_route_economics(
  text,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,
  numeric,numeric,numeric,text,jsonb
) to authenticated,service_role;

create or replace function public.preview_utility_route_economics(
  target_product_key text,
  target_provider_adapter_key text,
  target_face_amount numeric
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  route_record_id uuid;
begin
  if auth.role()<>'service_role'
     and not (
       public.has_permission('platform.billing.read',null)
       or public.has_permission('platform.billing.manage',null)
       or public.is_platform_super_admin()
     ) then
    raise exception using errcode='42501',
      message='bill service access is required';
  end if;

  select route.id into route_record_id
  from public.utility_provider_routes route
  join public.utility_products product on product.id=route.product_id
  join public.provider_adapters provider on provider.id=route.provider_adapter_id
  where product.key=target_product_key
    and provider.key=target_provider_adapter_key
    and provider.provider_kind='utility';

  if route_record_id is null then raise exception 'utility route was not found'; end if;

  return public.calculate_utility_route_economics(
    route_record_id,target_face_amount,0,0
  );
end;
$$;

revoke all on function public.preview_utility_route_economics(text,text,numeric)
from public,anon;
grant execute on function public.preview_utility_route_economics(text,text,numeric)
to authenticated,service_role;

create or replace function public.preview_utility_campaign_profit(
  target_campaign_type text,
  target_scope_type text,
  target_scope_key text,
  target_calculation_kind text,
  target_value numeric,
  target_maximum_amount numeric default null,
  target_minimum_spend numeric default null,
  target_funding_mode text default 'margin'
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  result jsonb;
begin
  if auth.role()<>'service_role'
     and not (
       public.has_permission('platform.billing.read',null)
       or public.has_permission('platform.billing.manage',null)
       or public.is_platform_super_admin()
     ) then
    raise exception using errcode='42501',
      message='bill service access is required';
  end if;

  if target_campaign_type not in ('discount','cashback') then
    raise exception 'campaign type must be discount or cashback';
  end if;
  if target_scope_type not in ('all','category','biller','product') then
    raise exception 'scope type must be all, category, biller or product';
  end if;
  if target_calculation_kind not in ('fixed','percentage') then
    raise exception 'campaign calculation must be fixed or percentage';
  end if;
  if target_funding_mode not in ('margin','marketing_budget','sponsor') then
    raise exception 'funding mode is not supported';
  end if;
  if target_value is null or target_value<=0
     or (target_calculation_kind='percentage' and target_value>100) then
    raise exception 'campaign value is invalid';
  end if;

  with candidate as (
    select
      route.id as route_id,
      product.key as product_key,
      product.display_name as product_name,
      biller.key as biller_key,
      biller.display_name as biller_name,
      category.key as category_key,
      category.display_name as category_name,
      provider.key as provider_key,
      provider.display_name as provider_name,
      product.amount_mode,
      coalesce(
        case when product.amount_mode='fixed' then product.fixed_amount end,
        greatest(
          coalesce(target_minimum_spend,0),
          coalesce(product.minimum_amount,0),
          coalesce(economics.minimum_economic_amount,100)
        )
      ) as sample_amount
    from public.utility_provider_routes route
    join public.utility_products product on product.id=route.product_id
    join public.utility_billers biller on biller.id=product.biller_id
    join public.utility_service_categories category on category.id=biller.category_id
    join public.provider_adapters provider on provider.id=route.provider_adapter_id
    left join public.utility_route_economics economics
      on economics.route_id=route.id and economics.status='active'
    where route.status='active'
      and provider.status='active'
      and provider.provider_kind='utility'
      and (
        target_scope_type='all'
        or (target_scope_type='category' and category.key=target_scope_key)
        or (target_scope_type='biller' and biller.key=target_scope_key)
        or (target_scope_type='product' and product.key=target_scope_key)
      )
  ),
  calculated as (
    select
      candidate.*,
      public.calculate_utility_campaign_amount(
        target_calculation_kind,target_value,target_maximum_amount,candidate.sample_amount
      ) as campaign_amount
    from candidate
  ),
  economics as (
    select
      calculated.*,
      public.calculate_utility_route_economics(
        calculated.route_id,
        calculated.sample_amount,
        case when target_funding_mode='margin' then calculated.campaign_amount else 0 end,
        case when target_funding_mode='margin' then 0 else calculated.campaign_amount end
      ) as economics
    from calculated
  )
  select jsonb_build_object(
    'campaignType',target_campaign_type,
    'scopeType',target_scope_type,
    'scopeKey',target_scope_key,
    'fundingMode',target_funding_mode,
    'routeCount',count(*),
    'safe',
      count(*)>0
      and bool_and(coalesce((economics->>'profitable')::boolean,false)),
    'routes',
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'routeId',route_id,
            'productKey',product_key,
            'productName',product_name,
            'billerKey',biller_key,
            'billerName',biller_name,
            'categoryKey',category_key,
            'categoryName',category_name,
            'providerKey',provider_key,
            'providerName',provider_name,
            'sampleAmount',sample_amount,
            'campaignAmount',campaign_amount,
            'economics',economics
          )
          order by category_name,biller_name,product_name,provider_name
        ),
        '[]'::jsonb
      )
  )
  into result
  from economics;

  return result;
end;
$$;

revoke all on function public.preview_utility_campaign_profit(
  text,text,text,text,numeric,numeric,numeric,text
) from public,anon;
grant execute on function public.preview_utility_campaign_profit(
  text,text,text,text,numeric,numeric,numeric,text
) to authenticated,service_role;

create or replace function public.configure_utility_campaign(
  target_campaign_type text,
  target_key text,
  target_display_name text,
  target_description text,
  target_scope_type text,
  target_scope_key text,
  target_calculation_kind text,
  target_value numeric,
  target_maximum_amount numeric default null,
  target_minimum_spend numeric default null,
  target_starts_at timestamptz default null,
  target_ends_at timestamptz default null,
  target_usage_limit integer default null,
  target_per_customer_limit integer default null,
  target_funding_mode text default 'margin',
  target_budget_amount numeric default null,
  target_sponsor_reference text default null,
  target_status text default 'draft'
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  category_record_id uuid;
  biller_record_id uuid;
  product_record_id uuid;
  configured_id uuid;
  preview jsonb;
  existing_spent numeric := 0;
  existing_reserved numeric := 0;
begin
  if auth.role()<>'service_role'
     and not (
       public.has_permission('platform.billing.manage',null)
       or public.is_platform_super_admin()
     ) then
    raise exception using errcode='42501',
      message='bill service management permission is required';
  end if;

  if target_campaign_type not in ('discount','cashback') then
    raise exception 'campaign type must be discount or cashback';
  end if;
  if target_scope_type not in ('all','category','biller','product') then
    raise exception 'campaign scope is invalid';
  end if;
  if target_calculation_kind not in ('fixed','percentage') then
    raise exception 'campaign calculation must be fixed or percentage';
  end if;
  if target_funding_mode not in ('margin','marketing_budget','sponsor') then
    raise exception 'campaign funding mode is invalid';
  end if;
  if target_status not in ('draft','active','inactive') then
    raise exception 'campaign status is invalid';
  end if;
  if coalesce(btrim(target_key),'')=''
     or target_key !~ '^[a-z][a-z0-9_.-]{2,120}$' then
    raise exception 'campaign key is invalid';
  end if;
  if target_value is null or target_value<=0
     or (target_calculation_kind='percentage' and target_value>100) then
    raise exception 'campaign value is invalid';
  end if;
  if target_ends_at is not null and target_starts_at is not null
     and target_ends_at<=target_starts_at then
    raise exception 'campaign end must be after its start';
  end if;

  if target_scope_type='category' then
    select id into category_record_id from public.utility_service_categories where key=target_scope_key;
    if category_record_id is null then raise exception 'campaign category was not found'; end if;
  elsif target_scope_type='biller' then
    select id,category_id into biller_record_id,category_record_id
    from public.utility_billers where key=target_scope_key;
    if biller_record_id is null then raise exception 'campaign biller was not found'; end if;
  elsif target_scope_type='product' then
    select product.id,biller.id,biller.category_id
    into product_record_id,biller_record_id,category_record_id
    from public.utility_products product
    join public.utility_billers biller on biller.id=product.biller_id
    where product.key=target_scope_key;
    if product_record_id is null then raise exception 'campaign product was not found'; end if;
  end if;

  if target_funding_mode<>'margin'
     and (target_budget_amount is null or target_budget_amount<=0) then
    raise exception 'budget-funded campaigns require a positive campaign budget';
  end if;

  if target_status='active' then
    preview := public.preview_utility_campaign_profit(
      target_campaign_type,target_scope_type,target_scope_key,
      target_calculation_kind,target_value,target_maximum_amount,
      target_minimum_spend,target_funding_mode
    );

    if coalesce((preview->>'routeCount')::integer,0)=0 then
      raise exception 'this campaign has no active utility routes to target';
    end if;

    if coalesce((preview->>'safe')::boolean,false) is not true then
      raise exception 'campaign activation blocked because one or more targeted routes would fall below the protected SKIMA profit';
    end if;
  end if;

  if target_campaign_type='discount' then
    select coalesce(budget_spent,0),coalesce(budget_reserved,0)
    into existing_spent,existing_reserved
    from public.utility_promotions where key=target_key;

    if target_budget_amount is not null
       and target_budget_amount<existing_spent+existing_reserved then
      raise exception 'campaign budget cannot be lower than already spent or reserved value';
    end if;

    insert into public.utility_promotions(
      key,display_name,description,discount_kind,discount_value,
      maximum_discount,minimum_spend,category_id,biller_id,product_id,
      starts_at,ends_at,usage_limit,per_customer_limit,status,metadata,
      funding_mode,budget_amount,sponsor_reference
    )
    values(
      target_key,btrim(target_display_name),nullif(btrim(target_description),''),
      target_calculation_kind,target_value,target_maximum_amount,target_minimum_spend,
      category_record_id,biller_record_id,product_record_id,
      target_starts_at,target_ends_at,target_usage_limit,target_per_customer_limit,
      target_status,
      jsonb_build_object(
        'scopeType',target_scope_type,
        'scopeKey',target_scope_key,
        'profitProtection',true
      ),
      target_funding_mode,
      case when target_funding_mode='margin' then null else target_budget_amount end,
      nullif(btrim(target_sponsor_reference),'')
    )
    on conflict(key) do update
    set display_name=excluded.display_name,
        description=excluded.description,
        discount_kind=excluded.discount_kind,
        discount_value=excluded.discount_value,
        maximum_discount=excluded.maximum_discount,
        minimum_spend=excluded.minimum_spend,
        category_id=excluded.category_id,
        biller_id=excluded.biller_id,
        product_id=excluded.product_id,
        starts_at=excluded.starts_at,
        ends_at=excluded.ends_at,
        usage_limit=excluded.usage_limit,
        per_customer_limit=excluded.per_customer_limit,
        status=excluded.status,
        metadata=public.utility_promotions.metadata||excluded.metadata,
        funding_mode=excluded.funding_mode,
        budget_amount=excluded.budget_amount,
        sponsor_reference=excluded.sponsor_reference,
        updated_at=timezone('utc',now())
    returning id into configured_id;
  else
    select coalesce(budget_spent,0),coalesce(budget_reserved,0)
    into existing_spent,existing_reserved
    from public.utility_reward_policies where key=target_key;

    if target_budget_amount is not null
       and target_budget_amount<existing_spent+existing_reserved then
      raise exception 'campaign budget cannot be lower than already spent or reserved value';
    end if;

    insert into public.utility_reward_policies(
      key,display_name,reward_kind,calculation_kind,reward_value,
      maximum_reward,minimum_spend,category_id,biller_id,product_id,
      starts_at,ends_at,total_award_limit,per_customer_limit,status,metadata,
      currency_code,funding_mode,budget_amount,sponsor_reference
    )
    values(
      target_key,btrim(target_display_name),'cashback',
      target_calculation_kind,target_value,target_maximum_amount,target_minimum_spend,
      category_record_id,biller_record_id,product_record_id,
      target_starts_at,target_ends_at,target_usage_limit,target_per_customer_limit,
      target_status,
      jsonb_build_object(
        'description',nullif(btrim(target_description),''),
        'scopeType',target_scope_type,
        'scopeKey',target_scope_key,
        'profitProtection',true
      ),
      'NGN',target_funding_mode,
      case when target_funding_mode='margin' then null else target_budget_amount end,
      nullif(btrim(target_sponsor_reference),'')
    )
    on conflict(key) do update
    set display_name=excluded.display_name,
        calculation_kind=excluded.calculation_kind,
        reward_value=excluded.reward_value,
        maximum_reward=excluded.maximum_reward,
        minimum_spend=excluded.minimum_spend,
        category_id=excluded.category_id,
        biller_id=excluded.biller_id,
        product_id=excluded.product_id,
        starts_at=excluded.starts_at,
        ends_at=excluded.ends_at,
        total_award_limit=excluded.total_award_limit,
        per_customer_limit=excluded.per_customer_limit,
        status=excluded.status,
        metadata=public.utility_reward_policies.metadata||excluded.metadata,
        funding_mode=excluded.funding_mode,
        budget_amount=excluded.budget_amount,
        sponsor_reference=excluded.sponsor_reference,
        updated_at=timezone('utc',now())
    returning id into configured_id;
  end if;

  insert into public.audit_logs(
    actor_user_id,action,entity_type,entity_id,after_state,metadata
  )
  values(
    auth.uid(),'utility.campaign.configured','utility_campaign',configured_id,
    jsonb_build_object(
      'campaignType',target_campaign_type,
      'key',target_key,
      'scopeType',target_scope_type,
      'scopeKey',target_scope_key,
      'fundingMode',target_funding_mode,
      'status',target_status,
      'budgetAmount',target_budget_amount
    ),
    jsonb_build_object('source','skima.admin.utility_campaigns')
  );

  return configured_id;
end;
$$;

revoke all on function public.configure_utility_campaign(
  text,text,text,text,text,text,text,numeric,numeric,numeric,timestamptz,
  timestamptz,integer,integer,text,numeric,text,text
) from public,anon;
grant execute on function public.configure_utility_campaign(
  text,text,text,text,text,text,text,numeric,numeric,numeric,timestamptz,
  timestamptz,integer,integer,text,numeric,text,text
) to authenticated,service_role;

create or replace function public.begin_utility_provider_catalog_sync(
  target_provider_adapter_key text,
  target_idempotency_key text,
  target_source text default 'platform.utility_catalog_sync',
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  provider_record_id uuid;
  run_id uuid;
begin
  if auth.role()<>'service_role'
     and not (
       public.has_permission('platform.billing.manage',null)
       or public.is_platform_super_admin()
     ) then
    raise exception using errcode='42501',
      message='bill service management permission is required';
  end if;

  select id into provider_record_id
  from public.provider_adapters
  where key=target_provider_adapter_key
    and provider_kind='utility';

  if provider_record_id is null then raise exception 'utility provider was not found'; end if;
  if coalesce(btrim(target_idempotency_key),'')='' then raise exception 'sync idempotency key is required'; end if;

  insert into public.utility_provider_catalog_sync_runs(
    provider_adapter_id,status,source,idempotency_key,metadata,created_by
  )
  values(
    provider_record_id,'running',coalesce(nullif(btrim(target_source),''),'platform.utility_catalog_sync'),
    target_idempotency_key,coalesce(target_metadata,'{}'::jsonb),auth.uid()
  )
  on conflict(provider_adapter_id,idempotency_key) do update
  set metadata=public.utility_provider_catalog_sync_runs.metadata||excluded.metadata
  returning id into run_id;

  return run_id;
end;
$$;

revoke all on function public.begin_utility_provider_catalog_sync(text,text,text,jsonb)
from public,anon;
grant execute on function public.begin_utility_provider_catalog_sync(text,text,text,jsonb)
to authenticated,service_role;

create or replace function public.stage_utility_provider_catalog_items(
  target_sync_run_id uuid,
  target_items jsonb
)
returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  run_record public.utility_provider_catalog_sync_runs%rowtype;
  item jsonb;
  inserted_count integer := 0;
begin
  if auth.role()<>'service_role'
     and not (
       public.has_permission('platform.billing.manage',null)
       or public.is_platform_super_admin()
     ) then
    raise exception using errcode='42501',
      message='bill service management permission is required';
  end if;

  select * into run_record
  from public.utility_provider_catalog_sync_runs
  where id=target_sync_run_id
  for update;

  if not found then raise exception 'catalog sync run was not found'; end if;
  if run_record.status not in ('running','staged') then
    raise exception 'catalog sync run cannot accept more items';
  end if;
  if target_items is null or jsonb_typeof(target_items)<>'array' then
    raise exception 'catalog items must be a JSON array';
  end if;

  for item in select value from jsonb_array_elements(target_items)
  loop
    if coalesce(item->>'itemType','') not in ('category','biller','product') then
      raise exception 'catalog itemType must be category, biller or product';
    end if;
    if coalesce(btrim(item->>'externalKey'),'')=''
       or coalesce(btrim(item->>'canonicalKey'),'')=''
       or coalesce(btrim(item->>'displayName'),'')='' then
      raise exception 'catalog externalKey, canonicalKey and displayName are required';
    end if;

    insert into public.utility_provider_catalog_items(
      sync_run_id,provider_adapter_id,item_type,external_key,canonical_key,
      canonical_parent_key,display_name,provider_product_code,amount_mode,
      fixed_amount,minimum_amount,maximum_amount,currency_code,
      customer_identifier_label,customer_identifier_hint,
      normalized_payload,raw_payload,status
    )
    values(
      run_record.id,run_record.provider_adapter_id,item->>'itemType',
      btrim(item->>'externalKey'),btrim(item->>'canonicalKey'),
      nullif(btrim(item->>'canonicalParentKey'),''),
      btrim(item->>'displayName'),
      nullif(btrim(item->>'providerProductCode'),''),
      nullif(btrim(item->>'amountMode'),''),
      nullif(item->>'fixedAmount','')::numeric,
      nullif(item->>'minimumAmount','')::numeric,
      nullif(item->>'maximumAmount','')::numeric,
      coalesce(nullif(btrim(item->>'currencyCode'),''),'NGN'),
      nullif(btrim(item->>'customerIdentifierLabel'),''),
      nullif(btrim(item->>'customerIdentifierHint'),''),
      coalesce(item->'normalizedPayload','{}'::jsonb),
      coalesce(item->'rawPayload','{}'::jsonb),
      coalesce(nullif(btrim(item->>'status'),''),'available')
    )
    on conflict(sync_run_id,item_type,external_key) do update
    set canonical_key=excluded.canonical_key,
        canonical_parent_key=excluded.canonical_parent_key,
        display_name=excluded.display_name,
        provider_product_code=excluded.provider_product_code,
        amount_mode=excluded.amount_mode,
        fixed_amount=excluded.fixed_amount,
        minimum_amount=excluded.minimum_amount,
        maximum_amount=excluded.maximum_amount,
        currency_code=excluded.currency_code,
        customer_identifier_label=excluded.customer_identifier_label,
        customer_identifier_hint=excluded.customer_identifier_hint,
        normalized_payload=excluded.normalized_payload,
        raw_payload=excluded.raw_payload,
        status=excluded.status,
        updated_at=timezone('utc',now());

    inserted_count := inserted_count+1;
  end loop;

  update public.utility_provider_catalog_sync_runs
  set status='staged',
      item_count=(select count(*) from public.utility_provider_catalog_items where sync_run_id=target_sync_run_id)
  where id=target_sync_run_id;

  return inserted_count;
end;
$$;

revoke all on function public.stage_utility_provider_catalog_items(uuid,jsonb)
from public,anon;
grant execute on function public.stage_utility_provider_catalog_items(uuid,jsonb)
to authenticated,service_role;

create or replace function public.publish_utility_provider_catalog_sync(
  target_sync_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  run_record public.utility_provider_catalog_sync_runs%rowtype;
  item record;
  category_record_id uuid;
  biller_record_id uuid;
  product_record_id uuid;
  categories_count integer := 0;
  billers_count integer := 0;
  products_count integer := 0;
begin
  if auth.role()<>'service_role'
     and not (
       public.has_permission('platform.billing.manage',null)
       or public.is_platform_super_admin()
     ) then
    raise exception using errcode='42501',
      message='bill service management permission is required';
  end if;

  select * into run_record
  from public.utility_provider_catalog_sync_runs
  where id=target_sync_run_id
  for update;

  if not found then raise exception 'catalog sync run was not found'; end if;
  if run_record.status not in ('staged','running') then
    raise exception 'catalog sync run is not ready to publish';
  end if;

  for item in
    select * from public.utility_provider_catalog_items
    where sync_run_id=target_sync_run_id
      and item_type='category'
      and status='available'
    order by created_at
  loop
    insert into public.utility_service_categories(
      key,display_name,description,icon_key,status,input_schema,metadata
    )
    values(
      item.canonical_key,item.display_name,
      item.normalized_payload->>'description',
      coalesce(item.normalized_payload->>'iconKey','receipt'),
      'draft','{}'::jsonb,
      jsonb_build_object(
        'catalogSource','provider_sync',
        'providerAdapterId',run_record.provider_adapter_id,
        'externalKey',item.external_key
      )||item.normalized_payload
    )
    on conflict(key) do update
    set display_name=excluded.display_name,
        description=coalesce(excluded.description,public.utility_service_categories.description),
        metadata=public.utility_service_categories.metadata||excluded.metadata,
        updated_at=timezone('utc',now());
    categories_count:=categories_count+1;
  end loop;

  for item in
    select * from public.utility_provider_catalog_items
    where sync_run_id=target_sync_run_id
      and item_type='biller'
      and status='available'
    order by created_at
  loop
    select id into category_record_id
    from public.utility_service_categories
    where key=item.canonical_parent_key;

    if category_record_id is null then
      raise exception 'catalog biller % has no published canonical category %',
        item.canonical_key,item.canonical_parent_key;
    end if;

    insert into public.utility_billers(
      category_id,key,display_name,logo_url,status,
      customer_identifier_label,customer_identifier_hint,
      validation_mode,validation_config,metadata
    )
    values(
      category_record_id,item.canonical_key,item.display_name,
      item.normalized_payload->>'logoUrl','draft',
      coalesce(item.customer_identifier_label,'Account or phone number'),
      item.customer_identifier_hint,'provider','{}'::jsonb,
      jsonb_build_object(
        'catalogSource','provider_sync',
        'providerAdapterId',run_record.provider_adapter_id,
        'externalKey',item.external_key
      )||item.normalized_payload
    )
    on conflict(key) do update
    set category_id=excluded.category_id,
        display_name=excluded.display_name,
        logo_url=coalesce(excluded.logo_url,public.utility_billers.logo_url),
        customer_identifier_label=excluded.customer_identifier_label,
        customer_identifier_hint=excluded.customer_identifier_hint,
        metadata=public.utility_billers.metadata||excluded.metadata,
        updated_at=timezone('utc',now());
    billers_count:=billers_count+1;
  end loop;

  for item in
    select * from public.utility_provider_catalog_items
    where sync_run_id=target_sync_run_id
      and item_type='product'
      and status='available'
    order by created_at
  loop
    select id into biller_record_id
    from public.utility_billers
    where key=item.canonical_parent_key;

    if biller_record_id is null then
      raise exception 'catalog product % has no published canonical biller %',
        item.canonical_key,item.canonical_parent_key;
    end if;

    insert into public.utility_products(
      biller_id,key,display_name,amount_mode,fixed_amount,
      minimum_amount,maximum_amount,currency_code,status,
      provider_product_ref,metadata
    )
    values(
      biller_record_id,item.canonical_key,item.display_name,
      coalesce(item.amount_mode,'customer'),item.fixed_amount,
      item.minimum_amount,item.maximum_amount,item.currency_code,
      'draft',item.provider_product_code,
      jsonb_build_object(
        'catalogSource','provider_sync',
        'providerAdapterId',run_record.provider_adapter_id,
        'externalKey',item.external_key
      )||item.normalized_payload
    )
    on conflict(key) do update
    set biller_id=excluded.biller_id,
        display_name=excluded.display_name,
        amount_mode=excluded.amount_mode,
        fixed_amount=excluded.fixed_amount,
        minimum_amount=excluded.minimum_amount,
        maximum_amount=excluded.maximum_amount,
        currency_code=excluded.currency_code,
        provider_product_ref=excluded.provider_product_ref,
        metadata=public.utility_products.metadata||excluded.metadata,
        updated_at=timezone('utc',now())
    returning id into product_record_id;

    insert into public.utility_provider_routes(
      product_id,provider_adapter_id,priority,status,
      provider_product_code,fee_config,metadata
    )
    values(
      product_record_id,run_record.provider_adapter_id,100,'inactive',
      coalesce(item.provider_product_code,item.external_key),
      '{}'::jsonb,
      jsonb_build_object(
        'catalogSyncRunId',run_record.id,
        'externalKey',item.external_key,
        'requiresEconomics',true
      )
    )
    on conflict(product_id,provider_adapter_id) do update
    set provider_product_code=excluded.provider_product_code,
        metadata=public.utility_provider_routes.metadata||excluded.metadata,
        updated_at=timezone('utc',now());

    products_count:=products_count+1;
  end loop;

  update public.utility_provider_catalog_sync_runs
  set status='published',
      item_count=(select count(*) from public.utility_provider_catalog_items where sync_run_id=target_sync_run_id),
      completed_at=timezone('utc',now())
  where id=target_sync_run_id;

  return jsonb_build_object(
    'syncRunId',target_sync_run_id,
    'categories',categories_count,
    'billers',billers_count,
    'products',products_count,
    'status','published'
  );
end;
$$;

revoke all on function public.publish_utility_provider_catalog_sync(uuid)
from public,anon;
grant execute on function public.publish_utility_provider_catalog_sync(uuid)
to authenticated,service_role;

-- An active customer route must now have provider credentials, a tested
-- fulfillment adapter and a profit model that is positive at its configured
-- minimum economic amount.
create or replace function public.configure_utility_provider_route(
  target_product_key text,
  target_provider_adapter_key text,
  target_provider_product_code text,
  target_priority integer default 100,
  target_status text default 'inactive',
  target_fixed_fee numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  product_record_id uuid;
  provider_record public.provider_adapters%rowtype;
  configured_id uuid;
  economics_record public.utility_route_economics%rowtype;
  preview jsonb;
begin
  if auth.role()<>'service_role'
     and not (
       public.has_permission('platform.billing.manage',null)
       or public.is_platform_super_admin()
     ) then
    raise exception using errcode='42501',
      message='bill service management permission is required';
  end if;

  if target_status not in ('active','inactive') then
    raise exception 'connection status must be active or inactive';
  end if;
  if target_priority is null or target_priority<1 or target_priority>10000 then
    raise exception 'connection priority must be between 1 and 10000';
  end if;
  if target_fixed_fee is null or target_fixed_fee<0 then
    raise exception 'customer fee cannot be negative';
  end if;

  select id into product_record_id
  from public.utility_products
  where key=target_product_key;

  select * into provider_record
  from public.provider_adapters
  where key=target_provider_adapter_key
    and provider_kind='utility';

  if product_record_id is null then raise exception 'choose a valid bill product'; end if;
  if provider_record.id is null then raise exception 'choose a valid bill service provider'; end if;

  insert into public.utility_provider_routes(
    product_id,provider_adapter_id,priority,status,
    provider_product_code,fee_config
  )
  values(
    product_record_id,provider_record.id,target_priority,'inactive',
    btrim(target_provider_product_code),
    jsonb_build_object('fixedAmount',target_fixed_fee)
  )
  on conflict(product_id,provider_adapter_id) do update
  set priority=excluded.priority,
      provider_product_code=excluded.provider_product_code,
      updated_at=timezone('utc',now())
  returning id into configured_id;

  if target_status='active' then
    if provider_record.status<>'active' then
      raise exception 'activate and test the bill service provider before exposing this plan';
    end if;
    if provider_record.secret_ref is null then
      raise exception 'configure the provider Edge secret reference before exposing this plan';
    end if;
    if coalesce((provider_record.config->>'runtimeReady')::boolean,false) is not true then
      raise exception 'this provider has no live SKIMA fulfillment adapter yet; keep the connection unavailable';
    end if;

    select * into economics_record
    from public.utility_route_economics
    where route_id=configured_id and status='active';

    if not found then
      raise exception 'configure this route economics and protected profit before making it available';
    end if;

    preview:=public.calculate_utility_route_economics(
      configured_id,economics_record.minimum_economic_amount,0,0
    );

    if coalesce((preview->>'profitable')::boolean,false) is not true then
      raise exception 'route activation blocked because its minimum economics do not preserve the configured SKIMA profit';
    end if;
  end if;

  update public.utility_provider_routes
  set status=target_status,
      updated_at=timezone('utc',now())
  where id=configured_id;

  return configured_id;
end;
$$;

-- Profit-safe bill creation. Cashback is resolved before the request is
-- inserted so discount + cashback can never silently exceed the route margin.
create or replace function public.create_utility_payment_request(
  target_product_id uuid,
  target_wallet_id uuid,
  target_customer_identifier text,
  target_amount numeric,
  target_recipient_phone text default null,
  target_promotion_key text default null,
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  product_record record;
  route_record record;
  promo_record record;
  cashback_record record;
  existing_record record;
  request_id uuid:=gen_random_uuid();
  selected_promotion_id uuid:=null;
  selected_cashback_id uuid:=null;
  resolved_amount numeric;
  resolved_discount numeric:=0;
  resolved_cashback numeric:=0;
  global_usage_count bigint:=0;
  customer_usage_count bigint:=0;
  margin_campaign_cost numeric:=0;
  subsidized_campaign_cost numeric:=0;
  economics jsonb;
  customer_fee numeric:=0;
begin
  if auth.uid() is null then raise exception 'authenticated user is required'; end if;
  if coalesce(btrim(target_customer_identifier),'')='' then raise exception 'customer identifier is required'; end if;
  if coalesce(btrim(target_idempotency_key),'')='' then raise exception 'idempotency key is required'; end if;

  select * into existing_record
  from public.utility_payment_requests
  where customer_user_id=auth.uid()
    and source='platform.utility_billing'
    and idempotency_key=target_idempotency_key;
  if found then return existing_record.id; end if;

  if not exists(
    select 1 from public.wallet_accounts wallet
    where wallet.id=target_wallet_id
      and wallet.owner_entity_type='user'
      and wallet.owner_entity_id=auth.uid()
      and wallet.wallet_type='customer'
      and wallet.status='active'
  ) then raise exception 'choose your active customer wallet'; end if;

  select product.*,biller.category_id
  into product_record
  from public.utility_products product
  join public.utility_billers biller on biller.id=product.biller_id
  join public.utility_service_categories category on category.id=biller.category_id
  where product.id=target_product_id
    and product.status='active'
    and biller.status='active'
    and category.status='active';

  if not found then raise exception 'this bill service is unavailable'; end if;
  if product_record.amount_mode='provider' then
    raise exception 'this bill service needs a live provider quote before payment';
  end if;

  resolved_amount:=case
    when product_record.amount_mode='fixed' then product_record.fixed_amount
    else target_amount
  end;

  if resolved_amount is null or resolved_amount<=0
     or (product_record.minimum_amount is not null and resolved_amount<product_record.minimum_amount)
     or (product_record.maximum_amount is not null and resolved_amount>product_record.maximum_amount)
  then raise exception 'amount is outside the allowed range for this service'; end if;

  if not exists(
    select 1 from public.wallet_accounts wallet
    where wallet.id=target_wallet_id
      and wallet.currency_code=product_record.currency_code
  ) then raise exception 'choose a customer wallet with the same currency as this bill'; end if;

  select route.*
  into route_record
  from public.utility_provider_routes route
  join public.provider_adapters adapter on adapter.id=route.provider_adapter_id
  join public.utility_route_economics economics
    on economics.route_id=route.id and economics.status='active'
  where route.product_id=target_product_id
    and route.status='active'
    and adapter.status='active'
    and adapter.provider_kind='utility'
    and adapter.secret_ref is not null
    and coalesce((adapter.config->>'runtimeReady')::boolean,false)=true
  order by route.priority
  limit 1;

  if not found then raise exception 'this bill service is temporarily unavailable'; end if;

  economics:=public.calculate_utility_route_economics(
    route_record.id,resolved_amount,0,0
  );

  if coalesce((economics->>'profitable')::boolean,false) is not true then
    raise exception 'this bill route is temporarily paused because its economics no longer preserve SKIMA profit';
  end if;

  if nullif(btrim(target_promotion_key),'') is not null then
    select promo.*
    into promo_record
    from public.utility_promotions promo
    where promo.key=btrim(target_promotion_key)
      and promo.status='active'
      and (promo.starts_at is null or promo.starts_at<=now())
      and (promo.ends_at is null or promo.ends_at>now())
      and (promo.minimum_spend is null or resolved_amount>=promo.minimum_spend)
      and (promo.category_id is null or promo.category_id=product_record.category_id)
      and (promo.biller_id is null or promo.biller_id=product_record.biller_id)
      and (promo.product_id is null or promo.product_id=target_product_id)
    for update of promo;

    if not found then raise exception 'this offer is invalid or no longer active'; end if;

    select count(*),count(*) filter(where request.customer_user_id=auth.uid())
    into global_usage_count,customer_usage_count
    from public.utility_payment_requests request
    where request.promotion_id=promo_record.id
      and request.status not in ('failed','reversed');

    if (promo_record.usage_limit is not null and global_usage_count>=promo_record.usage_limit)
       or (promo_record.per_customer_limit is not null and customer_usage_count>=promo_record.per_customer_limit)
    then raise exception 'this offer has reached its usage limit'; end if;

    selected_promotion_id:=promo_record.id;
    resolved_discount:=public.calculate_utility_campaign_amount(
      promo_record.discount_kind,promo_record.discount_value,
      promo_record.maximum_discount,resolved_amount
    );
  end if;

  select policy.*
  into cashback_record
  from public.utility_reward_policies policy
  where policy.status='active'
    and policy.currency_code=product_record.currency_code
    and (policy.starts_at is null or policy.starts_at<=now())
    and (policy.ends_at is null or policy.ends_at>now())
    and (policy.minimum_spend is null or resolved_amount>=policy.minimum_spend)
    and (policy.category_id is null or policy.category_id=product_record.category_id)
    and (policy.biller_id is null or policy.biller_id=product_record.biller_id)
    and (policy.product_id is null or policy.product_id=target_product_id)
  order by policy.created_at desc
  limit 1
  for update of policy;

  if found then
    select count(*),count(*) filter(where request.customer_user_id=auth.uid())
    into global_usage_count,customer_usage_count
    from public.utility_payment_requests request
    where request.cashback_policy_id=cashback_record.id
      and request.status not in ('failed','reversed');

    if (cashback_record.total_award_limit is null or global_usage_count<cashback_record.total_award_limit)
       and (cashback_record.per_customer_limit is null or customer_usage_count<cashback_record.per_customer_limit)
    then
      selected_cashback_id:=cashback_record.id;
      resolved_cashback:=public.calculate_utility_campaign_amount(
        cashback_record.calculation_kind,cashback_record.reward_value,
        cashback_record.maximum_reward,resolved_amount
      );
    end if;
  end if;

  margin_campaign_cost:=
    case when selected_promotion_id is not null and promo_record.funding_mode='margin'
      then resolved_discount else 0 end
    + case when selected_cashback_id is not null and cashback_record.funding_mode='margin'
      then resolved_cashback else 0 end;

  subsidized_campaign_cost:=
    case when selected_promotion_id is not null and promo_record.funding_mode<>'margin'
      then resolved_discount else 0 end
    + case when selected_cashback_id is not null and cashback_record.funding_mode<>'margin'
      then resolved_cashback else 0 end;

  economics:=public.calculate_utility_route_economics(
    route_record.id,resolved_amount,margin_campaign_cost,subsidized_campaign_cost
  );

  -- Cashback is automatic. If combining it with a promo would violate the
  -- protected margin, silently drop the cashback rather than failing the bill.
  if coalesce((economics->>'profitable')::boolean,false) is not true
     and selected_cashback_id is not null
     and cashback_record.funding_mode='margin' then
    selected_cashback_id:=null;
    resolved_cashback:=0;
    margin_campaign_cost:=
      case when selected_promotion_id is not null and promo_record.funding_mode='margin'
        then resolved_discount else 0 end;

    economics:=public.calculate_utility_route_economics(
      route_record.id,resolved_amount,margin_campaign_cost,subsidized_campaign_cost
    );
  end if;

  if coalesce((economics->>'profitable')::boolean,false) is not true then
    raise exception 'this campaign cannot be applied because it would reduce the protected SKIMA profit';
  end if;

  if selected_promotion_id is not null
     and promo_record.funding_mode<>'margin'
     and resolved_discount>0 then
    update public.utility_promotions
    set budget_reserved=budget_reserved+resolved_discount,
        updated_at=timezone('utc',now())
    where id=selected_promotion_id
      and budget_amount-budget_spent-budget_reserved>=resolved_discount;
    if not found then raise exception 'this funded discount has reached its campaign budget'; end if;
  end if;

  if selected_cashback_id is not null
     and cashback_record.funding_mode<>'margin'
     and resolved_cashback>0 then
    update public.utility_reward_policies
    set budget_reserved=budget_reserved+resolved_cashback,
        updated_at=timezone('utc',now())
    where id=selected_cashback_id
      and budget_amount-budget_spent-budget_reserved>=resolved_cashback;
    if not found then
      selected_cashback_id:=null;
      resolved_cashback:=0;
      subsidized_campaign_cost:=
        case when selected_promotion_id is not null and promo_record.funding_mode<>'margin'
          then resolved_discount else 0 end;
      economics:=public.calculate_utility_route_economics(
        route_record.id,resolved_amount,margin_campaign_cost,subsidized_campaign_cost
      );
    end if;
  end if;

  customer_fee:=coalesce((economics->>'customerFee')::numeric,0);

  insert into public.utility_payment_requests(
    id,customer_user_id,wallet_id,product_id,provider_route_id,promotion_id,
    cashback_policy_id,customer_identifier,recipient_phone,currency_code,
    subtotal_amount,discount_amount,fee_amount,expected_cashback_amount,
    provider_cost_amount,provider_margin_amount,collection_cost_amount,
    operating_reserve_amount,margin_campaign_cost_amount,
    subsidized_campaign_cost_amount,contribution_profit_amount,
    minimum_profit_amount,economics_snapshot,idempotency_key,metadata
  )
  values(
    request_id,auth.uid(),target_wallet_id,target_product_id,route_record.id,
    selected_promotion_id,selected_cashback_id,btrim(target_customer_identifier),
    nullif(btrim(target_recipient_phone),''),
    product_record.currency_code,resolved_amount,resolved_discount,customer_fee,
    resolved_cashback,
    (economics->>'providerCost')::numeric,
    (economics->>'providerDiscount')::numeric,
    (economics->>'collectionCost')::numeric,
    (economics->>'operatingReserve')::numeric,
    margin_campaign_cost,subsidized_campaign_cost,
    (economics->>'contributionProfit')::numeric,
    (economics->>'minimumProfit')::numeric,
    economics,target_idempotency_key,
    coalesce(target_metadata,'{}'::jsonb)||jsonb_build_object(
      'profitProtected',true,
      'expectedCashbackPolicyId',selected_cashback_id,
      'expectedCashbackAmount',resolved_cashback
    )
  );

  return request_id;
end;
$$;

create or replace function public.prepare_utility_reward_award()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if new.cashback_policy_id is null or new.expected_cashback_amount<=0 then
    return new;
  end if;

  insert into public.utility_reward_awards(
    payment_request_id,reward_policy_id,customer_user_id,
    wallet_id,currency_code,reward_amount
  )
  values(
    new.id,new.cashback_policy_id,new.customer_user_id,
    new.wallet_id,new.currency_code,new.expected_cashback_amount
  )
  on conflict do nothing;

  return new;
end;
$$;

create or replace function public.sync_utility_reward_award_status()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if new.status='succeeded' and old.status is distinct from new.status then
    update public.utility_reward_awards
    set status='earned',updated_at=timezone('utc',now())
    where payment_request_id=new.id and status='pending';

    if new.promotion_id is not null and new.discount_amount>0 then
      update public.utility_promotions
      set budget_reserved=greatest(0,budget_reserved-new.discount_amount),
          budget_spent=budget_spent+new.discount_amount,
          updated_at=timezone('utc',now())
      where id=new.promotion_id and funding_mode<>'margin';
    end if;

    if new.cashback_policy_id is not null and new.expected_cashback_amount>0 then
      update public.utility_reward_policies
      set budget_reserved=greatest(0,budget_reserved-new.expected_cashback_amount),
          budget_spent=budget_spent+new.expected_cashback_amount,
          updated_at=timezone('utc',now())
      where id=new.cashback_policy_id and funding_mode<>'margin';
    end if;

  elsif new.status in ('failed','reversed') and old.status is distinct from new.status then
    update public.utility_reward_awards
    set status='cancelled',updated_at=timezone('utc',now())
    where payment_request_id=new.id and status in ('pending','earned');

    if old.status<>'succeeded' then
      if new.promotion_id is not null and new.discount_amount>0 then
        update public.utility_promotions
        set budget_reserved=greatest(0,budget_reserved-new.discount_amount),
            updated_at=timezone('utc',now())
        where id=new.promotion_id and funding_mode<>'margin';
      end if;

      if new.cashback_policy_id is not null and new.expected_cashback_amount>0 then
        update public.utility_reward_policies
        set budget_reserved=greatest(0,budget_reserved-new.expected_cashback_amount),
            updated_at=timezone('utc',now())
        where id=new.cashback_policy_id and funding_mode<>'margin';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.read_utility_admin_configuration()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
begin
  if not(
    public.has_permission('platform.billing.read',null)
    or public.is_platform_super_admin()
  ) then
    raise exception using errcode='42501',message='bill service access is required';
  end if;

  return jsonb_build_object(
    'categories',coalesce((
      select jsonb_agg(row_to_json(item) order by item.sort_order,item.display_name)
      from public.utility_service_categories item
    ),'[]'::jsonb),
    'billers',coalesce((
      select jsonb_agg(row_to_json(item) order by item.display_name)
      from public.utility_billers item
    ),'[]'::jsonb),
    'products',coalesce((
      select jsonb_agg(row_to_json(item) order by item.sort_order,item.display_name)
      from public.utility_products item
    ),'[]'::jsonb),
    'routes',coalesce((
      select jsonb_agg(
        to_jsonb(route)
        ||jsonb_build_object(
          'product_key',product.key,
          'product_name',product.display_name,
          'provider_key',provider.key,
          'provider_name',provider.display_name
        )
        order by route.priority
      )
      from public.utility_provider_routes route
      join public.utility_products product on product.id=route.product_id
      join public.provider_adapters provider on provider.id=route.provider_adapter_id
    ),'[]'::jsonb),
    'economics',coalesce((
      select jsonb_agg(
        to_jsonb(economics)
        ||jsonb_build_object(
          'product_key',product.key,
          'product_name',product.display_name,
          'biller_name',biller.display_name,
          'category_name',category.display_name,
          'provider_key',provider.key,
          'provider_name',provider.display_name
        )
        order by category.display_name,biller.display_name,product.display_name,provider.display_name
      )
      from public.utility_route_economics economics
      join public.utility_provider_routes route on route.id=economics.route_id
      join public.utility_products product on product.id=route.product_id
      join public.utility_billers biller on biller.id=product.biller_id
      join public.utility_service_categories category on category.id=biller.category_id
      join public.provider_adapters provider on provider.id=route.provider_adapter_id
    ),'[]'::jsonb),
    'providers',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',item.id,'key',item.key,'display_name',item.display_name,
          'status',item.status,
          'provider_family',item.config->>'providerFamily',
          'environment',item.config->>'environment',
          'base_url',item.config->>'baseUrl',
          'website_url',item.config->>'websiteUrl',
          'documentation_url',item.config->>'documentationUrl',
          'runtime_ready',coalesce((item.config->>'runtimeReady')::boolean,false),
          'catalog_sync_ready',coalesce((item.config->>'catalogSyncReady')::boolean,false),
          'secret_configured',item.secret_ref is not null
        )
        order by item.display_name
      )
      from public.provider_adapters item
      where item.provider_kind='utility'
    ),'[]'::jsonb),
    'syncRuns',coalesce((
      select jsonb_agg(
        to_jsonb(run)
        ||jsonb_build_object(
          'provider_key',provider.key,
          'provider_name',provider.display_name
        )
        order by run.started_at desc
      )
      from (
        select *
        from public.utility_provider_catalog_sync_runs
        order by started_at desc
        limit 50
      ) run
      join public.provider_adapters provider on provider.id=run.provider_adapter_id
    ),'[]'::jsonb),
    'promotions',coalesce((
      select jsonb_agg(row_to_json(item) order by item.created_at desc)
      from public.utility_promotions item
    ),'[]'::jsonb),
    'cashbacks',coalesce((
      select jsonb_agg(row_to_json(item) order by item.created_at desc)
      from public.utility_reward_policies item
    ),'[]'::jsonb),
    'payments',coalesce((
      select jsonb_agg(row_to_json(item) order by item.created_at desc)
      from(
        select *
        from public.utility_payment_requests
        order by created_at desc
        limit 200
      ) item
    ),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.read_utility_admin_configuration()
from public,anon;
grant execute on function public.read_utility_admin_configuration()
to authenticated,service_role;

notify pgrst,'reload schema';

commit;
