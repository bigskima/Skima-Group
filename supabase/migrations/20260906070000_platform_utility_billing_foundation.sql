begin;

-- Utility billing is a platform capability. Products, providers and promotions are data,
-- so adding a new biller never requires changing the platform runtime.
alter table public.provider_adapters drop constraint if exists provider_adapters_provider_kind_check;
alter table public.provider_adapters add constraint provider_adapters_provider_kind_check
check (provider_kind in ('payment', 'storage', 'maps', 'notification', 'ai', 'queue', 'cache', 'observability', 'inventory', 'utility'));

insert into public.permissions (key, description, risk_level, metadata)
values
  ('platform.billing.read', 'Read utility billing configuration and payment activity.', 'standard', '{"domain":"billing","displayName":"Read utility billing"}'),
  ('platform.billing.manage', 'Configure utility bill products, provider routes and promotions.', 'high', '{"domain":"billing","displayName":"Manage utility billing"}')
on conflict (key) do update set
  description = excluded.description,
  risk_level = excluded.risk_level,
  metadata = public.permissions.metadata || excluded.metadata;

insert into public.role_permissions (role_id, permission_id)
select role_record.id, permission_record.id
from public.roles role_record
join public.permissions permission_record
  on permission_record.key in ('platform.billing.read', 'platform.billing.manage')
where role_record.key in ('platform.super_admin', 'platform.operations_admin', 'platform.finance_admin')
on conflict do nothing;

create table if not exists public.utility_service_categories (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_.-]{2,80}$'),
  display_name text not null check (length(btrim(display_name)) between 2 and 100),
  description text,
  icon_key text not null default 'receipt',
  sort_order integer not null default 100,
  status text not null default 'draft' check (status in ('draft', 'active', 'inactive')),
  input_schema jsonb not null default '{}'::jsonb check (jsonb_typeof(input_schema) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.utility_billers (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.utility_service_categories(id) on delete restrict,
  key text not null unique check (key ~ '^[a-z][a-z0-9_.-]{2,120}$'),
  display_name text not null check (length(btrim(display_name)) between 2 and 140),
  logo_url text,
  status text not null default 'draft' check (status in ('draft', 'active', 'inactive')),
  customer_identifier_label text not null default 'Account number',
  customer_identifier_hint text,
  validation_mode text not null default 'provider' check (validation_mode in ('none', 'format', 'provider')),
  validation_config jsonb not null default '{}'::jsonb check (jsonb_typeof(validation_config) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.utility_products (
  id uuid primary key default gen_random_uuid(),
  biller_id uuid not null references public.utility_billers(id) on delete restrict,
  key text not null unique check (key ~ '^[a-z][a-z0-9_.-]{2,160}$'),
  display_name text not null check (length(btrim(display_name)) between 2 and 160),
  amount_mode text not null default 'customer' check (amount_mode in ('fixed', 'customer', 'provider')),
  fixed_amount numeric(28,8),
  minimum_amount numeric(28,8),
  maximum_amount numeric(28,8),
  currency_code text not null default 'NGN' references public.currency_definitions(code),
  status text not null default 'draft' check (status in ('draft', 'active', 'inactive')),
  sort_order integer not null default 100,
  provider_product_ref text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (fixed_amount is null or fixed_amount > 0),
  check (minimum_amount is null or minimum_amount > 0),
  check (maximum_amount is null or maximum_amount > 0),
  check (minimum_amount is null or maximum_amount is null or minimum_amount <= maximum_amount),
  check (amount_mode <> 'fixed' or fixed_amount is not null)
);

create table if not exists public.utility_provider_routes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.utility_products(id) on delete cascade,
  provider_adapter_id uuid not null references public.provider_adapters(id) on delete restrict,
  priority integer not null default 100 check (priority > 0),
  status text not null default 'inactive' check (status in ('active', 'inactive')),
  provider_product_code text not null,
  fee_config jsonb not null default '{}'::jsonb check (jsonb_typeof(fee_config) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, provider_adapter_id)
);

create table if not exists public.utility_promotions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_.-]{2,120}$'),
  display_name text not null,
  description text,
  discount_kind text not null check (discount_kind in ('fixed', 'percentage')),
  discount_value numeric(28,8) not null check (discount_value > 0),
  maximum_discount numeric(28,8),
  minimum_spend numeric(28,8),
  category_id uuid references public.utility_service_categories(id) on delete cascade,
  biller_id uuid references public.utility_billers(id) on delete cascade,
  product_id uuid references public.utility_products(id) on delete cascade,
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit integer,
  per_customer_limit integer,
  status text not null default 'draft' check (status in ('draft', 'active', 'inactive')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (discount_kind <> 'percentage' or discount_value <= 100),
  check (maximum_discount is null or maximum_discount > 0),
  check (minimum_spend is null or minimum_spend >= 0),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table if not exists public.utility_payment_requests (
  id uuid primary key default gen_random_uuid(),
  public_reference text not null unique default ('BILL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  customer_user_id uuid not null references auth.users(id) on delete restrict,
  wallet_id uuid not null references public.wallet_accounts(id) on delete restrict,
  product_id uuid not null references public.utility_products(id) on delete restrict,
  provider_route_id uuid not null references public.utility_provider_routes(id) on delete restrict,
  promotion_id uuid references public.utility_promotions(id) on delete set null,
  customer_identifier text not null,
  recipient_phone text,
  currency_code text not null references public.currency_definitions(code),
  subtotal_amount numeric(28,8) not null check (subtotal_amount > 0),
  discount_amount numeric(28,8) not null default 0 check (discount_amount >= 0),
  fee_amount numeric(28,8) not null default 0 check (fee_amount >= 0),
  total_amount numeric(28,8) generated always as (greatest(subtotal_amount + fee_amount - discount_amount, 0)) stored,
  status text not null default 'awaiting_payment' check (status in ('awaiting_payment', 'payment_reserved', 'processing', 'succeeded', 'failed', 'reversed')),
  provider_reference text,
  provider_response jsonb not null default '{}'::jsonb,
  source text not null default 'platform.utility_billing',
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_user_id, source, idempotency_key)
);

create index if not exists utility_products_biller_status_idx on public.utility_products (biller_id, status, sort_order);
create index if not exists utility_provider_routes_product_status_idx on public.utility_provider_routes (product_id, status, priority);
create index if not exists utility_payment_requests_customer_created_idx on public.utility_payment_requests (customer_user_id, created_at desc);

alter table public.utility_service_categories enable row level security;
alter table public.utility_billers enable row level security;
alter table public.utility_products enable row level security;
alter table public.utility_provider_routes enable row level security;
alter table public.utility_promotions enable row level security;
alter table public.utility_payment_requests enable row level security;

create policy utility_categories_active_read on public.utility_service_categories for select using (status = 'active' or public.has_permission('platform.billing.read', null) or public.is_platform_super_admin());
create policy utility_billers_active_read on public.utility_billers for select using (status = 'active' or public.has_permission('platform.billing.read', null) or public.is_platform_super_admin());
create policy utility_products_active_read on public.utility_products for select using (status = 'active' or public.has_permission('platform.billing.read', null) or public.is_platform_super_admin());
create policy utility_routes_admin_read on public.utility_provider_routes for select using (public.has_permission('platform.billing.read', null) or public.is_platform_super_admin());
create policy utility_promotions_active_read on public.utility_promotions for select using (status = 'active' or public.has_permission('platform.billing.read', null) or public.is_platform_super_admin());
create policy utility_requests_owner_read on public.utility_payment_requests for select using (customer_user_id = auth.uid() or public.has_permission('platform.billing.read', null) or public.is_platform_super_admin());

create or replace function public.read_utility_catalog()
returns table (category_id uuid, category_key text, category_name text, category_description text, icon_key text, biller_id uuid, biller_key text, biller_name text, biller_logo_url text, customer_identifier_label text, customer_identifier_hint text, product_id uuid, product_key text, product_name text, amount_mode text, fixed_amount numeric, minimum_amount numeric, maximum_amount numeric, currency_code text, available boolean)
language sql stable security definer set search_path = public
as $$
  select category.id, category.key, category.display_name, category.description, category.icon_key,
    biller.id, biller.key, biller.display_name, biller.logo_url, biller.customer_identifier_label,
    biller.customer_identifier_hint, product.id, product.key, product.display_name, product.amount_mode,
    product.fixed_amount, product.minimum_amount, product.maximum_amount, product.currency_code,
    exists (select 1 from public.utility_provider_routes route join public.provider_adapters adapter on adapter.id = route.provider_adapter_id where route.product_id = product.id and route.status = 'active' and adapter.status = 'active')
  from public.utility_service_categories category
  join public.utility_billers biller on biller.category_id = category.id and biller.status = 'active'
  join public.utility_products product on product.biller_id = biller.id and product.status = 'active'
  where category.status = 'active'
  order by category.sort_order, category.display_name, product.sort_order, product.display_name;
$$;

create or replace function public.create_utility_payment_request(target_product_id uuid, target_wallet_id uuid, target_customer_identifier text, target_amount numeric, target_recipient_phone text default null, target_promotion_key text default null, target_idempotency_key text default null, target_metadata jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare product_record record; route_record record; promo_record record; existing_record record; request_id uuid := gen_random_uuid(); resolved_amount numeric; resolved_discount numeric := 0;
begin
  if auth.uid() is null then raise exception 'authenticated user is required'; end if;
  if coalesce(btrim(target_customer_identifier), '') = '' then raise exception 'customer identifier is required'; end if;
  if coalesce(btrim(target_idempotency_key), '') = '' then raise exception 'idempotency key is required'; end if;
  select * into existing_record from public.utility_payment_requests where customer_user_id = auth.uid() and source = 'platform.utility_billing' and idempotency_key = target_idempotency_key;
  if found then return existing_record.id; end if;
  if not public.is_wallet_owner(target_wallet_id) then raise exception 'wallet must belong to the authenticated customer'; end if;
  select product.* into product_record from public.utility_products product join public.utility_billers biller on biller.id = product.biller_id join public.utility_service_categories category on category.id = biller.category_id where product.id = target_product_id and product.status = 'active' and biller.status = 'active' and category.status = 'active';
  if not found then raise exception 'utility product is unavailable'; end if;
  resolved_amount := case when product_record.amount_mode = 'fixed' then product_record.fixed_amount else target_amount end;
  if resolved_amount is null or resolved_amount <= 0 or (product_record.minimum_amount is not null and resolved_amount < product_record.minimum_amount) or (product_record.maximum_amount is not null and resolved_amount > product_record.maximum_amount) then raise exception 'amount is outside the configured product range'; end if;
  select route.* into route_record from public.utility_provider_routes route join public.provider_adapters adapter on adapter.id = route.provider_adapter_id where route.product_id = target_product_id and route.status = 'active' and adapter.status = 'active' order by route.priority limit 1;
  if not found then raise exception 'this utility product is temporarily unavailable'; end if;
  if target_promotion_key is not null then
    select promo.* into promo_record from public.utility_promotions promo join public.utility_billers biller on biller.id = product_record.biller_id where promo.key = target_promotion_key and promo.status = 'active' and (promo.starts_at is null or promo.starts_at <= now()) and (promo.ends_at is null or promo.ends_at > now()) and (promo.minimum_spend is null or resolved_amount >= promo.minimum_spend) and (promo.category_id is null or promo.category_id = biller.category_id) and (promo.biller_id is null or promo.biller_id = product_record.biller_id) and (promo.product_id is null or promo.product_id = target_product_id);
    if found then resolved_discount := least(case when promo_record.discount_kind = 'percentage' then resolved_amount * promo_record.discount_value / 100 else promo_record.discount_value end, coalesce(promo_record.maximum_discount, resolved_amount), resolved_amount); end if;
  end if;
  insert into public.utility_payment_requests (id, customer_user_id, wallet_id, product_id, provider_route_id, promotion_id, customer_identifier, recipient_phone, currency_code, subtotal_amount, discount_amount, fee_amount, idempotency_key, metadata)
  values (request_id, auth.uid(), target_wallet_id, target_product_id, route_record.id, promo_record.id, btrim(target_customer_identifier), nullif(btrim(target_recipient_phone), ''), product_record.currency_code, resolved_amount, resolved_discount, coalesce((route_record.fee_config->>'fixedAmount')::numeric, 0), target_idempotency_key, target_metadata);
  return request_id;
end; $$;

grant execute on function public.read_utility_catalog() to authenticated;
grant execute on function public.create_utility_payment_request(uuid, uuid, text, numeric, text, text, text, jsonb) to authenticated;
grant select on public.utility_payment_requests to authenticated;

create or replace function public.configure_utility_catalog_item(target_kind text, target_key text, target_configuration jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare configured_id uuid; category_record_id uuid; biller_record_id uuid; product_record_id uuid; provider_record_id uuid;
begin
  if not (public.has_permission('platform.billing.manage', null) or public.is_platform_super_admin()) then raise exception using errcode = '42501', message = 'utility billing management permission is required'; end if;
  if coalesce(btrim(target_key), '') = '' or target_configuration is null or jsonb_typeof(target_configuration) <> 'object' then raise exception 'a key and configuration object are required'; end if;
  if target_kind = 'category' then
    insert into public.utility_service_categories (key, display_name, description, icon_key, sort_order, status, input_schema, metadata)
    values (target_key, target_configuration->>'displayName', target_configuration->>'description', coalesce(target_configuration->>'iconKey', 'receipt'), coalesce((target_configuration->>'sortOrder')::integer, 100), coalesce(target_configuration->>'status', 'draft'), coalesce(target_configuration->'inputSchema', '{}'::jsonb), coalesce(target_configuration->'metadata', '{}'::jsonb))
    on conflict (key) do update set display_name=excluded.display_name, description=excluded.description, icon_key=excluded.icon_key, sort_order=excluded.sort_order, status=excluded.status, input_schema=excluded.input_schema, metadata=excluded.metadata, updated_at=now() returning id into configured_id;
  elsif target_kind = 'biller' then
    select id into category_record_id from public.utility_service_categories where key = target_configuration->>'categoryKey';
    if category_record_id is null then raise exception 'categoryKey must reference a utility category'; end if;
    insert into public.utility_billers (category_id,key,display_name,logo_url,status,customer_identifier_label,customer_identifier_hint,validation_mode,validation_config,metadata)
    values (category_record_id,target_key,target_configuration->>'displayName',target_configuration->>'logoUrl',coalesce(target_configuration->>'status','draft'),coalesce(target_configuration->>'customerIdentifierLabel','Account number'),target_configuration->>'customerIdentifierHint',coalesce(target_configuration->>'validationMode','provider'),coalesce(target_configuration->'validationConfig','{}'::jsonb),coalesce(target_configuration->'metadata','{}'::jsonb))
    on conflict (key) do update set category_id=excluded.category_id,display_name=excluded.display_name,logo_url=excluded.logo_url,status=excluded.status,customer_identifier_label=excluded.customer_identifier_label,customer_identifier_hint=excluded.customer_identifier_hint,validation_mode=excluded.validation_mode,validation_config=excluded.validation_config,metadata=excluded.metadata,updated_at=now() returning id into configured_id;
  elsif target_kind = 'product' then
    select id into biller_record_id from public.utility_billers where key = target_configuration->>'billerKey';
    if biller_record_id is null then raise exception 'billerKey must reference a utility biller'; end if;
    insert into public.utility_products (biller_id,key,display_name,amount_mode,fixed_amount,minimum_amount,maximum_amount,currency_code,status,sort_order,provider_product_ref,metadata)
    values (biller_record_id,target_key,target_configuration->>'displayName',coalesce(target_configuration->>'amountMode','customer'),(target_configuration->>'fixedAmount')::numeric,(target_configuration->>'minimumAmount')::numeric,(target_configuration->>'maximumAmount')::numeric,coalesce(target_configuration->>'currencyCode','NGN'),coalesce(target_configuration->>'status','draft'),coalesce((target_configuration->>'sortOrder')::integer,100),target_configuration->>'providerProductRef',coalesce(target_configuration->'metadata','{}'::jsonb))
    on conflict (key) do update set biller_id=excluded.biller_id,display_name=excluded.display_name,amount_mode=excluded.amount_mode,fixed_amount=excluded.fixed_amount,minimum_amount=excluded.minimum_amount,maximum_amount=excluded.maximum_amount,currency_code=excluded.currency_code,status=excluded.status,sort_order=excluded.sort_order,provider_product_ref=excluded.provider_product_ref,metadata=excluded.metadata,updated_at=now() returning id into configured_id;
  elsif target_kind = 'route' then
    select id into product_record_id from public.utility_products where key = target_configuration->>'productKey';
    select id into provider_record_id from public.provider_adapters where key = target_configuration->>'providerAdapterKey';
    if product_record_id is null or provider_record_id is null then raise exception 'productKey and providerAdapterKey must reference configured records'; end if;
    insert into public.utility_provider_routes (product_id,provider_adapter_id,priority,status,provider_product_code,fee_config,metadata)
    values (product_record_id,provider_record_id,coalesce((target_configuration->>'priority')::integer,100),coalesce(target_configuration->>'status','inactive'),target_configuration->>'providerProductCode',coalesce(target_configuration->'feeConfig','{}'::jsonb),coalesce(target_configuration->'metadata','{}'::jsonb))
    on conflict (product_id,provider_adapter_id) do update set priority=excluded.priority,status=excluded.status,provider_product_code=excluded.provider_product_code,fee_config=excluded.fee_config,metadata=excluded.metadata,updated_at=now() returning id into configured_id;
  elsif target_kind = 'promotion' then
    insert into public.utility_promotions (key,display_name,description,discount_kind,discount_value,maximum_discount,minimum_spend,starts_at,ends_at,usage_limit,per_customer_limit,status,metadata)
    values (target_key,target_configuration->>'displayName',target_configuration->>'description',target_configuration->>'discountKind',(target_configuration->>'discountValue')::numeric,(target_configuration->>'maximumDiscount')::numeric,(target_configuration->>'minimumSpend')::numeric,(target_configuration->>'startsAt')::timestamptz,(target_configuration->>'endsAt')::timestamptz,(target_configuration->>'usageLimit')::integer,(target_configuration->>'perCustomerLimit')::integer,coalesce(target_configuration->>'status','draft'),coalesce(target_configuration->'metadata','{}'::jsonb))
    on conflict (key) do update set display_name=excluded.display_name,description=excluded.description,discount_kind=excluded.discount_kind,discount_value=excluded.discount_value,maximum_discount=excluded.maximum_discount,minimum_spend=excluded.minimum_spend,starts_at=excluded.starts_at,ends_at=excluded.ends_at,usage_limit=excluded.usage_limit,per_customer_limit=excluded.per_customer_limit,status=excluded.status,metadata=excluded.metadata,updated_at=now() returning id into configured_id;
  else raise exception 'target_kind must be category, biller, product, route, or promotion';
  end if;
  return configured_id;
end; $$;

grant execute on function public.configure_utility_catalog_item(text,text,jsonb) to authenticated;

create or replace function public.read_utility_admin_configuration()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_permission('platform.billing.read', null) or public.is_platform_super_admin()) then raise exception using errcode='42501', message='utility billing read permission is required'; end if;
  return jsonb_build_object(
    'categories', coalesce((select jsonb_agg(row_to_json(item) order by item.sort_order, item.display_name) from public.utility_service_categories item), '[]'::jsonb),
    'billers', coalesce((select jsonb_agg(row_to_json(item) order by item.display_name) from public.utility_billers item), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(row_to_json(item) order by item.sort_order, item.display_name) from public.utility_products item), '[]'::jsonb),
    'routes', coalesce((select jsonb_agg(row_to_json(item) order by item.priority) from public.utility_provider_routes item), '[]'::jsonb),
    'promotions', coalesce((select jsonb_agg(row_to_json(item) order by item.created_at desc) from public.utility_promotions item), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(row_to_json(item) order by item.created_at desc) from (select * from public.utility_payment_requests order by created_at desc limit 200) item), '[]'::jsonb)
  );
end; $$;

grant execute on function public.read_utility_admin_configuration() to authenticated;

-- Categories are safe defaults; billers and products stay admin-configured and provider-routed.
insert into public.utility_service_categories (key, display_name, description, icon_key, sort_order, status, input_schema)
values
  ('electricity', 'Electricity', 'Prepaid tokens and postpaid electricity bills.', 'zap', 10, 'active', '{"identifier":"meter_number"}'),
  ('airtime', 'Airtime', 'Mobile airtime top-ups.', 'phone', 20, 'active', '{"identifier":"phone_number"}'),
  ('data', 'Mobile data', 'Mobile network data plans.', 'wifi', 30, 'active', '{"identifier":"phone_number"}'),
  ('other', 'More bills', 'Additional configured utility services.', 'receipt', 100, 'active', '{}')
on conflict (key) do update set display_name = excluded.display_name, description = excluded.description, icon_key = excluded.icon_key, sort_order = excluded.sort_order;

commit;
