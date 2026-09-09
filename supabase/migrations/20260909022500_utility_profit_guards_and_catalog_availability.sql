begin;

set local lock_timeout='10s';
set local statement_timeout='0';

create or replace function public.guard_utility_route_activation()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  provider_record public.provider_adapters%rowtype;
  economics_record public.utility_route_economics%rowtype;
  preview jsonb;
begin
  if new.status<>'active' or old.status is not distinct from new.status then
    return new;
  end if;

  select * into provider_record
  from public.provider_adapters
  where id=new.provider_adapter_id
    and provider_kind='utility';

  if provider_record.id is null or provider_record.status<>'active' then
    raise exception 'utility route requires an active utility provider';
  end if;
  if provider_record.secret_ref is null then
    raise exception 'utility route requires an Edge secret reference';
  end if;
  if coalesce((provider_record.config->>'runtimeReady')::boolean,false) is not true then
    raise exception 'utility route requires a tested SKIMA fulfillment adapter';
  end if;

  select * into economics_record
  from public.utility_route_economics
  where route_id=new.id and status='active';

  if not found then
    raise exception 'utility route requires active protected economics';
  end if;

  preview:=public.calculate_utility_route_economics(
    new.id,economics_record.minimum_economic_amount,0,0
  );

  if coalesce((preview->>'profitable')::boolean,false) is not true then
    raise exception 'utility route cannot activate below the protected SKIMA profit floor';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_utility_route_activation on public.utility_provider_routes;
create trigger guard_utility_route_activation
before update of status on public.utility_provider_routes
for each row execute function public.guard_utility_route_activation();

create or replace function public.guard_utility_promotion_activation()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  scope_type text:='all';
  scope_key text:=null;
  preview jsonb;
begin
  if new.status<>'active'
     or (tg_op='UPDATE' and old.status is not distinct from new.status
         and old.discount_kind is not distinct from new.discount_kind
         and old.discount_value is not distinct from new.discount_value
         and old.maximum_discount is not distinct from new.maximum_discount
         and old.minimum_spend is not distinct from new.minimum_spend
         and old.funding_mode is not distinct from new.funding_mode
         and old.category_id is not distinct from new.category_id
         and old.biller_id is not distinct from new.biller_id
         and old.product_id is not distinct from new.product_id) then
    return new;
  end if;

  if new.product_id is not null then
    scope_type:='product';
    select key into scope_key from public.utility_products where id=new.product_id;
  elsif new.biller_id is not null then
    scope_type:='biller';
    select key into scope_key from public.utility_billers where id=new.biller_id;
  elsif new.category_id is not null then
    scope_type:='category';
    select key into scope_key from public.utility_service_categories where id=new.category_id;
  end if;

  if new.funding_mode<>'margin'
     and (new.budget_amount is null or new.budget_amount<=0) then
    raise exception 'budget-funded utility campaigns require a positive budget';
  end if;

  preview:=public.preview_utility_campaign_profit(
    'discount',scope_type,scope_key,new.discount_kind,new.discount_value,
    new.maximum_discount,new.minimum_spend,new.funding_mode
  );

  if coalesce((preview->>'routeCount')::integer,0)=0
     or coalesce((preview->>'safe')::boolean,false) is not true then
    raise exception 'discount activation blocked by SKIMA utility profit protection';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_utility_promotion_activation on public.utility_promotions;
create trigger guard_utility_promotion_activation
before insert or update on public.utility_promotions
for each row execute function public.guard_utility_promotion_activation();

create or replace function public.guard_utility_cashback_activation()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  scope_type text:='all';
  scope_key text:=null;
  preview jsonb;
begin
  if new.status<>'active'
     or (tg_op='UPDATE' and old.status is not distinct from new.status
         and old.calculation_kind is not distinct from new.calculation_kind
         and old.reward_value is not distinct from new.reward_value
         and old.maximum_reward is not distinct from new.maximum_reward
         and old.minimum_spend is not distinct from new.minimum_spend
         and old.funding_mode is not distinct from new.funding_mode
         and old.category_id is not distinct from new.category_id
         and old.biller_id is not distinct from new.biller_id
         and old.product_id is not distinct from new.product_id) then
    return new;
  end if;

  if new.product_id is not null then
    scope_type:='product';
    select key into scope_key from public.utility_products where id=new.product_id;
  elsif new.biller_id is not null then
    scope_type:='biller';
    select key into scope_key from public.utility_billers where id=new.biller_id;
  elsif new.category_id is not null then
    scope_type:='category';
    select key into scope_key from public.utility_service_categories where id=new.category_id;
  end if;

  if new.funding_mode<>'margin'
     and (new.budget_amount is null or new.budget_amount<=0) then
    raise exception 'budget-funded utility campaigns require a positive budget';
  end if;

  preview:=public.preview_utility_campaign_profit(
    'cashback',scope_type,scope_key,new.calculation_kind,new.reward_value,
    new.maximum_reward,new.minimum_spend,new.funding_mode
  );

  if coalesce((preview->>'routeCount')::integer,0)=0
     or coalesce((preview->>'safe')::boolean,false) is not true then
    raise exception 'cashback activation blocked by SKIMA utility profit protection';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_utility_cashback_activation on public.utility_reward_policies;
create trigger guard_utility_cashback_activation
before insert or update on public.utility_reward_policies
for each row execute function public.guard_utility_cashback_activation();

create or replace function public.configure_utility_cashback(
  target_key text,
  target_display_name text,
  target_calculation_kind text,
  target_reward_value numeric,
  target_maximum_reward numeric default null,
  target_minimum_spend numeric default null,
  target_total_award_limit integer default null,
  target_per_customer_limit integer default null,
  target_status text default 'draft'
)
returns uuid
language sql
security definer
set search_path=public,pg_temp
as $$
  select public.configure_utility_campaign(
    'cashback',
    target_key,
    target_display_name,
    null,
    'all',
    null,
    target_calculation_kind,
    target_reward_value,
    target_maximum_reward,
    target_minimum_spend,
    null,
    null,
    target_total_award_limit,
    target_per_customer_limit,
    'margin',
    null,
    null,
    target_status
  );
$$;

create or replace function public.read_utility_catalog()
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
  available boolean
)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select
    category.id,category.key,category.display_name,category.description,category.icon_key,
    biller.id,biller.key,biller.display_name,biller.logo_url,
    biller.customer_identifier_label,biller.customer_identifier_hint,
    product.id,product.key,product.display_name,product.amount_mode,
    product.fixed_amount,product.minimum_amount,product.maximum_amount,product.currency_code,
    product.amount_mode<>'provider'
    and exists(
      select 1
      from public.utility_provider_routes route
      join public.provider_adapters adapter on adapter.id=route.provider_adapter_id
      join public.utility_route_economics economics
        on economics.route_id=route.id and economics.status='active'
      where route.product_id=product.id
        and route.status='active'
        and adapter.status='active'
        and adapter.provider_kind='utility'
        and adapter.secret_ref is not null
        and coalesce((adapter.config->>'runtimeReady')::boolean,false)=true
        and coalesce(
          (
            public.calculate_utility_route_economics(
              route.id,
              coalesce(
                case when product.amount_mode='fixed' then product.fixed_amount end,
                product.minimum_amount,
                economics.minimum_economic_amount
              ),
              0,0
            )->>'profitable'
          )::boolean,
          false
        )=true
    )
  from public.utility_service_categories category
  join public.utility_billers biller
    on biller.category_id=category.id and biller.status='active'
  join public.utility_products product
    on product.biller_id=biller.id and product.status='active'
  where category.status='active'
  order by category.sort_order,category.display_name,product.sort_order,product.display_name;
$$;

notify pgrst,'reload schema';

commit;