begin;

-- Nationwide Store checkout uses a configured flat fee. Coordinates/radius remain
-- optional legacy metadata only; neither is an eligibility or pricing input.
create or replace function public.configure_storefront_fulfillment_settings(
  target_organization_id uuid,
  target_branch_id uuid,
  target_currency_code text,
  target_fulfillment_method text,
  target_fulfillment_methods text[],
  target_status text,
  target_idempotency_key text,
  target_metadata jsonb,
  target_delivery_origin_label text,
  target_delivery_origin_formatted_address text,
  target_delivery_origin_latitude numeric,
  target_delivery_origin_longitude numeric,
  target_delivery_base_fee_amount numeric,
  target_delivery_per_km_fee_amount numeric,
  target_delivery_radius_km numeric,
  target_free_delivery_minimum_amount numeric,
  target_minimum_order_amount numeric,
  target_pickup_location_label text,
  target_pickup_formatted_address text,
  target_pickup_instructions text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  setting_id uuid;
  methods text[] := coalesce(target_fulfillment_methods, array[]::text[]);
begin
  if auth.uid() is null
    or not public.is_platform_super_admin()
      and not public.has_permission('platform.store.manage', null) then
    raise exception 'platform Store management permission is required';
  end if;

  if cardinality(methods) = 0
    or target_fulfillment_method is null
    or not target_fulfillment_method = any(methods) then
    raise exception 'Choose a default Store fulfillment method from the enabled methods';
  end if;

  if target_delivery_base_fee_amount is null or target_delivery_base_fee_amount < 0
    or target_delivery_per_km_fee_amount is null or target_delivery_per_km_fee_amount < 0
    or target_minimum_order_amount is null or target_minimum_order_amount < 0
    or (target_free_delivery_minimum_amount is not null and target_free_delivery_minimum_amount < 0) then
    raise exception 'Store delivery fees and order minimums cannot be negative';
  end if;

  if 'delivery' = any(methods) then
    if target_delivery_origin_label is null or btrim(target_delivery_origin_label) = ''
      or target_delivery_origin_formatted_address is null or btrim(target_delivery_origin_formatted_address) = '' then
      raise exception 'Enter the Store dispatch address or service area before enabling delivery';
    end if;
  end if;

  if (target_delivery_origin_latitude is null) <> (target_delivery_origin_longitude is null)
    or (target_delivery_origin_latitude is not null and
      (target_delivery_origin_latitude < -90 or target_delivery_origin_latitude > 90
       or target_delivery_origin_longitude < -180 or target_delivery_origin_longitude > 180)) then
    raise exception 'Optional Store coordinates must be supplied together and within valid geographic ranges';
  end if;

  if target_delivery_radius_km is not null and target_delivery_radius_km <= 0 then
    raise exception 'An optional legacy delivery radius must be positive';
  end if;

  if 'pickup' = any(methods)
    and (
      coalesce(nullif(btrim(target_pickup_location_label), ''), nullif(btrim(target_delivery_origin_label), '')) is null
      or coalesce(nullif(btrim(target_pickup_formatted_address), ''), nullif(btrim(target_delivery_origin_formatted_address), '')) is null
    ) then
    raise exception 'Configure a Store pickup location before enabling customer pickup';
  end if;

  setting_id := public.configure_storefront_settings(
    target_organization_id,
    target_branch_id,
    target_currency_code,
    target_fulfillment_method,
    methods,
    target_status,
    target_idempotency_key,
    coalesce(target_metadata, '{}'::jsonb)
  );

  update public.storefront_settings
  set delivery_origin_label = nullif(btrim(target_delivery_origin_label), ''),
      delivery_origin_formatted_address = nullif(btrim(target_delivery_origin_formatted_address), ''),
      delivery_origin_latitude = target_delivery_origin_latitude,
      delivery_origin_longitude = target_delivery_origin_longitude,
      delivery_base_fee_amount = target_delivery_base_fee_amount,
      delivery_per_km_fee_amount = 0,
      delivery_radius_km = null,
      free_delivery_minimum_amount = target_free_delivery_minimum_amount,
      minimum_order_amount = target_minimum_order_amount,
      pickup_location_label = coalesce(
        nullif(btrim(target_pickup_location_label), ''),
        nullif(btrim(target_delivery_origin_label), '')
      ),
      pickup_formatted_address = coalesce(
        nullif(btrim(target_pickup_formatted_address), ''),
        nullif(btrim(target_delivery_origin_formatted_address), '')
      ),
      pickup_instructions = nullif(btrim(target_pickup_instructions), ''),
      updated_at = timezone('utc', now())
  where id = setting_id;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, after_state, metadata
  )
  values (
    auth.uid(),
    'storefront.fulfillment_configured',
    'storefront_settings',
    setting_id,
    jsonb_build_object(
      'delivery_origin_label', target_delivery_origin_label,
      'delivery_origin_formatted_address', target_delivery_origin_formatted_address,
      'delivery_flat_fee_amount', target_delivery_base_fee_amount,
      'minimum_order_amount', target_minimum_order_amount,
      'free_delivery_minimum_amount', target_free_delivery_minimum_amount,
      'pickup_location_label', target_pickup_location_label,
      'coverage', 'nationwide_nigeria_pending_store_review'
    ),
    jsonb_build_object('source', 'platform.storefront')
  );

  return setting_id;
end;
$$;

revoke all on function public.configure_storefront_fulfillment_settings(
  uuid, uuid, text, text, text[], text, text, jsonb, text, text, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, text, text, text
) from public, anon;
grant execute on function public.configure_storefront_fulfillment_settings(
  uuid, uuid, text, text, text[], text, text, jsonb, text, text, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, text, text, text
) to authenticated, service_role;

-- Edit an existing Store catalogue item without creating a duplicate listing.
-- Prices and stock are versioned so previously reserved order lines remain intact.
create or replace function public.update_storefront_product(
  target_item_id uuid,
  target_display_name text,
  target_description text,
  target_category_key text,
  target_category_name text,
  target_amount numeric,
  target_compare_at_amount numeric,
  target_stock_quantity numeric,
  target_status text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  settings public.storefront_settings%rowtype;
  item_record public.catalog_items%rowtype;
  resolved_category_id uuid;
  reserved_quantity numeric(20,8) := 0;
  price_id uuid;
  availability_id uuid;
  current_availability_rule_id uuid;
begin
  if auth.uid() is null
    or not public.is_platform_super_admin()
      and not public.has_permission('platform.store.manage', null) then
    raise exception 'platform Store management permission is required';
  end if;

  select * into settings
  from public.storefront_settings
  where module_id = (select id from public.business_modules where key = 'store')
  limit 1;

  if not found or settings.status <> 'active' then
    raise exception 'Configure and activate the SKIMA Store before editing products';
  end if;

  select * into item_record
  from public.catalog_items
  where id = target_item_id
    and organization_id = settings.organization_id
    and module_id = settings.module_id
  for update;

  if not found or coalesce(item_record.metadata->>'sales_channel', '') <> 'skima_store' then
    raise exception 'The selected item is not a SKIMA Store listing';
  end if;

  if target_display_name is null or btrim(target_display_name) = ''
    or target_amount is null or target_amount < 0
    or target_stock_quantity is null or target_stock_quantity < 0
    or target_status not in ('draft', 'active') then
    raise exception 'Enter a valid product name, price, stock quantity and listing status';
  end if;

  if target_compare_at_amount is not null and target_compare_at_amount <= target_amount then
    raise exception 'The crossed-out price must be greater than the selling price';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'An idempotency key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'Product metadata must be a JSON object';
  end if;

  if target_category_key is null or btrim(target_category_key) = '' then
    target_category_key := 'store.category.general';
  end if;

  select category.id into resolved_category_id
  from public.catalog_categories category
  where category.organization_id = settings.organization_id
    and category.key = target_category_key
    and category.status = 'active'
  limit 1;

  if resolved_category_id is null then
    perform public.configure_catalog_category(
      settings.organization_id,
      target_category_key,
      coalesce(nullif(target_category_name, ''), 'General'),
      'product',
      'store',
      null,
      'Products available from SKIMA Store.',
      'active',
      'platform.storefront',
      target_idempotency_key || ':category',
      jsonb_build_object('channel', 'skima_store')
    );
    select category.id into resolved_category_id
    from public.catalog_categories category
    where category.organization_id = settings.organization_id
      and category.key = target_category_key
      and category.status = 'active'
    limit 1;
  end if;

  if resolved_category_id is null then
    raise exception 'The selected Store product category could not be created';
  end if;

  select rule.id, rule.reserved_quantity
  into current_availability_rule_id, reserved_quantity
  from public.catalog_availability_rules rule
  where rule.item_id = target_item_id
    and rule.variant_id is null
    and rule.status = 'active'
  order by rule.created_at desc
  limit 1
  for update;
  reserved_quantity := coalesce(reserved_quantity, 0);

  if target_stock_quantity < reserved_quantity then
    raise exception 'Stock cannot be lower than units already reserved for customer orders';
  end if;

  update public.catalog_items
  set category_id = resolved_category_id,
      display_name = btrim(target_display_name),
      description = nullif(btrim(target_description), ''),
      status = target_status,
      metadata = item_record.metadata || target_metadata || jsonb_build_object(
        'storefront', true,
        'sales_channel', 'skima_store'
      ),
      updated_at = timezone('utc', now())
  where id = target_item_id;

  update public.catalog_prices
  set status = 'retired', updated_at = timezone('utc', now())
  where item_id = target_item_id
    and variant_id is null
    and currency_code = settings.currency_code
    and status in ('active', 'scheduled');

  price_id := public.configure_catalog_price(
    target_item_id, null, settings.currency_code, target_amount,
    target_compare_at_amount, null, 'exclusive', 'active',
    timezone('utc', now()), null, 'platform.storefront',
    target_idempotency_key || ':price',
    jsonb_build_object('storefront', true, 'edited_by_admin', true)
  );

  if current_availability_rule_id is not null then
    -- Keep the existing availability row id so outstanding order reservations
    -- can still be released against the exact rule they reserved.
    update public.catalog_availability_rules
    set availability_status = case
          when target_status <> 'active' then 'unavailable'
          when target_stock_quantity > reserved_quantity then 'available'
          else 'out_of_stock' end,
        stock_quantity = target_stock_quantity,
        updated_at = timezone('utc', now())
    where id = current_availability_rule_id;
    availability_id := current_availability_rule_id;
  else
    availability_id := public.set_catalog_availability(
      target_item_id, null, settings.branch_id,
      case when target_status = 'active' and target_stock_quantity > 0 then 'available'
           when target_status = 'active' then 'out_of_stock'
           else 'unavailable' end,
      '{}'::jsonb, target_stock_quantity, 0,
      null, 0, 'active', timezone('utc', now()), null,
      'platform.storefront', target_idempotency_key || ':availability',
      jsonb_build_object('storefront', true, 'edited_by_admin', true)
    );
  end if;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, after_state, metadata
  )
  values (
    auth.uid(), 'storefront.product_updated', 'catalog_items', target_item_id,
    jsonb_build_object(
      'display_name', target_display_name,
      'category_id', resolved_category_id,
      'amount', target_amount,
      'compare_at_amount', target_compare_at_amount,
      'stock_quantity', target_stock_quantity,
      'status', target_status
    ),
    jsonb_build_object('source', 'platform.storefront', 'idempotency_key', target_idempotency_key)
  );

  return jsonb_build_object(
    'itemId', target_item_id,
    'priceId', price_id,
    'availabilityRuleId', availability_id
  );
end;
$$;

revoke all on function public.update_storefront_product(uuid, text, text, text, text, numeric, numeric, numeric, text, text, jsonb) from public, anon;
grant execute on function public.update_storefront_product(uuid, text, text, text, text, numeric, numeric, numeric, text, text, jsonb) to authenticated, service_role;

comment on column public.storefront_settings.delivery_base_fee_amount is
  'Nationwide flat Store delivery fee. Do not multiply by distance.';
comment on column public.storefront_settings.delivery_per_km_fee_amount is
  'Legacy compatibility field; Store checkout ignores this value.';
comment on column public.storefront_settings.delivery_radius_km is
  'Legacy compatibility field; Store delivery is not radius-gated.';

commit;
