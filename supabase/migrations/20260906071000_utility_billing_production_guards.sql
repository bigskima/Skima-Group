begin;

-- Keep explicit grants inspectable for the administrators closest to billing operations.
insert into public.role_permissions (role_id, permission_id, conditions)
select role_record.id, permission_record.id, '{}'::jsonb
from public.roles role_record
join public.permissions permission_record
  on permission_record.key in ('platform.billing.read', 'platform.billing.manage')
where role_record.key in ('platform.super_admin', 'platform.finance_admin', 'platform.operations_admin')
  and role_record.organization_id is null
  and role_record.status = 'active'
on conflict (role_id, permission_id) do nothing;

create or replace function public.guard_utility_provider_route_kind()
returns trigger language plpgsql set search_path=public as $$
begin
  if not exists (
    select 1 from public.provider_adapters adapter
    where adapter.id = new.provider_adapter_id and adapter.provider_kind = 'utility'
  ) then raise exception 'choose a bill service provider connection'; end if;
  return new;
end;
$$;

drop trigger if exists guard_utility_provider_route_kind on public.utility_provider_routes;
create trigger guard_utility_provider_route_kind
before insert or update of provider_adapter_id on public.utility_provider_routes
for each row execute function public.guard_utility_provider_route_kind();

create or replace function public.read_utility_catalog()
returns table (category_id uuid, category_key text, category_name text, category_description text, icon_key text, biller_id uuid, biller_key text, biller_name text, biller_logo_url text, customer_identifier_label text, customer_identifier_hint text, product_id uuid, product_key text, product_name text, amount_mode text, fixed_amount numeric, minimum_amount numeric, maximum_amount numeric, currency_code text, available boolean)
language sql stable security definer set search_path = public
as $$
  select category.id, category.key, category.display_name, category.description, category.icon_key,
    biller.id, biller.key, biller.display_name, biller.logo_url, biller.customer_identifier_label,
    biller.customer_identifier_hint, product.id, product.key, product.display_name, product.amount_mode,
    product.fixed_amount, product.minimum_amount, product.maximum_amount, product.currency_code,
    product.amount_mode <> 'provider' and exists (
      select 1
      from public.utility_provider_routes route
      join public.provider_adapters adapter on adapter.id = route.provider_adapter_id
      where route.product_id = product.id
        and route.status = 'active'
        and adapter.status = 'active'
        and adapter.provider_kind = 'utility'
    )
  from public.utility_service_categories category
  join public.utility_billers biller on biller.category_id = category.id and biller.status = 'active'
  join public.utility_products product on product.biller_id = biller.id and product.status = 'active'
  where category.status = 'active'
  order by category.sort_order, category.display_name, product.sort_order, product.display_name;
$$;

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
returns uuid language plpgsql security definer set search_path = public as $$
declare
  product_record record;
  route_record record;
  promo_record record;
  existing_record record;
  request_id uuid := gen_random_uuid();
  selected_promotion_id uuid := null;
  resolved_amount numeric;
  resolved_discount numeric := 0;
  global_usage_count bigint := 0;
  customer_usage_count bigint := 0;
begin
  if auth.uid() is null then raise exception 'authenticated user is required'; end if;
  if coalesce(btrim(target_customer_identifier), '') = '' then raise exception 'customer identifier is required'; end if;
  if coalesce(btrim(target_idempotency_key), '') = '' then raise exception 'idempotency key is required'; end if;

  select * into existing_record
  from public.utility_payment_requests
  where customer_user_id = auth.uid()
    and source = 'platform.utility_billing'
    and idempotency_key = target_idempotency_key;
  if found then return existing_record.id; end if;

  if not exists (
    select 1 from public.wallet_accounts wallet
    where wallet.id = target_wallet_id
      and wallet.owner_entity_type = 'user'
      and wallet.owner_entity_id = auth.uid()
      and wallet.wallet_type = 'customer'
      and wallet.status = 'active'
  ) then raise exception 'choose your active customer wallet'; end if;

  select product.* into product_record
  from public.utility_products product
  join public.utility_billers biller on biller.id = product.biller_id
  join public.utility_service_categories category on category.id = biller.category_id
  where product.id = target_product_id
    and product.status = 'active'
    and biller.status = 'active'
    and category.status = 'active';
  if not found then raise exception 'this bill service is unavailable'; end if;
  if product_record.amount_mode = 'provider' then
    raise exception 'this bill service needs a live price check and is not available yet';
  end if;

  resolved_amount := case when product_record.amount_mode = 'fixed' then product_record.fixed_amount else target_amount end;
  if resolved_amount is null or resolved_amount <= 0
    or (product_record.minimum_amount is not null and resolved_amount < product_record.minimum_amount)
    or (product_record.maximum_amount is not null and resolved_amount > product_record.maximum_amount)
  then raise exception 'amount is outside the allowed range for this service'; end if;

  if not exists (
    select 1 from public.wallet_accounts wallet
    where wallet.id = target_wallet_id and wallet.currency_code = product_record.currency_code
  ) then raise exception 'choose a customer wallet with the same currency as this bill'; end if;

  select route.* into route_record
  from public.utility_provider_routes route
  join public.provider_adapters adapter on adapter.id = route.provider_adapter_id
  where route.product_id = target_product_id
    and route.status = 'active'
    and adapter.status = 'active'
    and adapter.provider_kind = 'utility'
  order by route.priority
  limit 1;
  if not found then raise exception 'this bill service is temporarily unavailable'; end if;

  if nullif(btrim(target_promotion_key), '') is not null then
    select promo.* into promo_record
    from public.utility_promotions promo
    join public.utility_billers biller on biller.id = product_record.biller_id
    where promo.key = btrim(target_promotion_key)
      and promo.status = 'active'
      and (promo.starts_at is null or promo.starts_at <= now())
      and (promo.ends_at is null or promo.ends_at > now())
      and (promo.minimum_spend is null or resolved_amount >= promo.minimum_spend)
      and (promo.category_id is null or promo.category_id = biller.category_id)
      and (promo.biller_id is null or promo.biller_id = product_record.biller_id)
      and (promo.product_id is null or promo.product_id = target_product_id)
    for update of promo;

    if found then
      select count(*), count(*) filter (where request.customer_user_id = auth.uid())
      into global_usage_count, customer_usage_count
      from public.utility_payment_requests request
      where request.promotion_id = promo_record.id
        and request.status not in ('failed', 'reversed');

      if (promo_record.usage_limit is null or global_usage_count < promo_record.usage_limit)
        and (promo_record.per_customer_limit is null or customer_usage_count < promo_record.per_customer_limit)
      then
        selected_promotion_id := promo_record.id;
        resolved_discount := least(
          case when promo_record.discount_kind = 'percentage'
            then resolved_amount * promo_record.discount_value / 100
            else promo_record.discount_value end,
          coalesce(promo_record.maximum_discount, resolved_amount),
          resolved_amount
        );
      else
        raise exception 'this offer has reached its usage limit';
      end if;
    else
      raise exception 'this offer is invalid or no longer active';
    end if;
  end if;

  insert into public.utility_payment_requests (
    id, customer_user_id, wallet_id, product_id, provider_route_id, promotion_id,
    customer_identifier, recipient_phone, currency_code, subtotal_amount,
    discount_amount, fee_amount, idempotency_key, metadata
  ) values (
    request_id, auth.uid(), target_wallet_id, target_product_id, route_record.id,
    selected_promotion_id, btrim(target_customer_identifier),
    nullif(btrim(target_recipient_phone), ''), product_record.currency_code,
    resolved_amount, resolved_discount,
    coalesce((route_record.fee_config->>'fixedAmount')::numeric, 0),
    target_idempotency_key, target_metadata
  );
  return request_id;
end;
$$;

create or replace function public.configure_utility_provider_route(
  target_product_key text,
  target_provider_adapter_key text,
  target_provider_product_code text,
  target_priority integer default 100,
  target_status text default 'inactive',
  target_fixed_fee numeric default 0
)
returns uuid language plpgsql security definer set search_path = public as $$
declare product_record_id uuid; provider_record_id uuid; configured_id uuid;
begin
  if not (public.has_permission('platform.billing.manage', null) or public.is_platform_super_admin())
    then raise exception using errcode='42501', message='bill service management permission is required'; end if;
  select id into product_record_id from public.utility_products where key = target_product_key;
  select id into provider_record_id from public.provider_adapters
    where key = target_provider_adapter_key and provider_kind = 'utility';
  if product_record_id is null then raise exception 'choose a valid bill product'; end if;
  if provider_record_id is null then raise exception 'choose a valid bill service provider'; end if;
  insert into public.utility_provider_routes (product_id, provider_adapter_id, priority, status, provider_product_code, fee_config)
  values (product_record_id, provider_record_id, target_priority, target_status, target_provider_product_code, jsonb_build_object('fixedAmount', coalesce(target_fixed_fee, 0)))
  on conflict (product_id, provider_adapter_id) do update set
    priority=excluded.priority, status=excluded.status,
    provider_product_code=excluded.provider_product_code,
    fee_config=excluded.fee_config, updated_at=now()
  returning id into configured_id;
  return configured_id;
end;
$$;

grant execute on function public.create_utility_payment_request(uuid,uuid,text,numeric,text,text,text,jsonb) to authenticated;
grant execute on function public.configure_utility_provider_route(text,text,text,integer,text,numeric) to authenticated;

create or replace function public.read_utility_admin_configuration()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_permission('platform.billing.read', null) or public.is_platform_super_admin())
    then raise exception using errcode='42501', message='bill service access is required'; end if;
  return jsonb_build_object(
    'categories', coalesce((select jsonb_agg(row_to_json(item) order by item.sort_order, item.display_name) from public.utility_service_categories item), '[]'::jsonb),
    'billers', coalesce((select jsonb_agg(row_to_json(item) order by item.display_name) from public.utility_billers item), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(row_to_json(item) order by item.sort_order, item.display_name) from public.utility_products item), '[]'::jsonb),
    'routes', coalesce((select jsonb_agg(row_to_json(item) order by item.priority) from public.utility_provider_routes item), '[]'::jsonb),
    'providers', coalesce((select jsonb_agg(row_to_json(item) order by item.display_name) from public.provider_adapters item where item.provider_kind='utility'), '[]'::jsonb),
    'promotions', coalesce((select jsonb_agg(row_to_json(item) order by item.created_at desc) from public.utility_promotions item), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(row_to_json(item) order by item.created_at desc) from (select * from public.utility_payment_requests order by created_at desc limit 200) item), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.read_utility_admin_configuration() to authenticated;

commit;
