begin;

alter table public.storefront_settings
  add column if not exists delivery_eta_min_business_days smallint not null default 2,
  add column if not exists delivery_eta_max_business_days smallint not null default 5;

alter table public.storefront_settings
  drop constraint if exists storefront_settings_delivery_eta_window_check;
alter table public.storefront_settings
  add constraint storefront_settings_delivery_eta_window_check
  check (
    delivery_eta_min_business_days between 1 and 60
    and delivery_eta_max_business_days between delivery_eta_min_business_days and 90
  );

comment on column public.storefront_settings.delivery_eta_min_business_days is
  'Customer-facing minimum delivery estimate in business days after Store order acceptance.';
comment on column public.storefront_settings.delivery_eta_max_business_days is
  'Customer-facing maximum delivery estimate in business days after Store order acceptance.';

create or replace function public.configure_storefront_delivery_window(
  target_organization_id uuid,
  target_min_business_days integer,
  target_max_business_days integer,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  setting_id uuid;
begin
  if auth.uid() is null
    or not public.is_platform_super_admin()
      and not public.has_permission('platform.store.manage', null) then
    raise exception 'platform Store management permission is required';
  end if;

  if target_organization_id is null
    or target_idempotency_key is null
    or btrim(target_idempotency_key) = ''
    or target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'Store organisation, idempotency key and metadata are required';
  end if;

  if target_min_business_days is null
    or target_max_business_days is null
    or target_min_business_days < 1
    or target_max_business_days < target_min_business_days
    or target_max_business_days > 90 then
    raise exception 'Delivery window must be between 1 and 90 business days, with the maximum not below the minimum';
  end if;

  select settings.id
  into setting_id
  from public.storefront_settings settings
  join public.business_modules module on module.id = settings.module_id
  where module.key = 'store'
    and settings.organization_id = target_organization_id
    and settings.status = 'active'
  order by settings.updated_at desc
  limit 1
  for update;

  if setting_id is null then
    raise exception 'Activate the Store for this organisation before configuring its delivery window';
  end if;

  update public.storefront_settings
  set delivery_eta_min_business_days = target_min_business_days::smallint,
      delivery_eta_max_business_days = target_max_business_days::smallint,
      metadata = metadata || jsonb_build_object(
        'delivery_eta_configured_at', timezone('utc', now()),
        'delivery_eta_configured_by', auth.uid(),
        'delivery_eta_source', coalesce(target_metadata ->> 'source', 'admin.store')
      ),
      updated_at = timezone('utc', now())
  where id = setting_id;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, after_state, metadata
  )
  values (
    auth.uid(),
    'storefront.delivery_window_configured',
    'storefront_settings',
    setting_id,
    jsonb_build_object(
      'delivery_eta_min_business_days', target_min_business_days,
      'delivery_eta_max_business_days', target_max_business_days
    ),
    target_metadata || jsonb_build_object('source', 'platform.storefront')
  );

  return setting_id;
end;
$$;

revoke all on function public.configure_storefront_delivery_window(uuid, integer, integer, text, jsonb) from public, anon;
grant execute on function public.configure_storefront_delivery_window(uuid, integer, integer, text, jsonb) to authenticated;

-- Save the complete operating configuration atomically so a failed delivery
-- estimate cannot leave fees/address updated while the ETA remains stale.
create or replace function public.configure_storefront_full_settings(
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
  target_pickup_instructions text,
  target_min_business_days integer,
  target_max_business_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $
declare
  settings_id uuid;
  delivery_window_id uuid;
begin
  if auth.uid() is null
    or not public.is_platform_super_admin()
      and not public.has_permission('platform.store.manage', null) then
    raise exception 'platform Store management permission is required';
  end if;

  settings_id := public.configure_storefront_fulfillment_settings(
    target_organization_id,
    target_branch_id,
    target_currency_code,
    target_fulfillment_method,
    target_fulfillment_methods,
    target_status,
    target_idempotency_key,
    coalesce(target_metadata, '{}'::jsonb),
    target_delivery_origin_label,
    target_delivery_origin_formatted_address,
    target_delivery_origin_latitude,
    target_delivery_origin_longitude,
    target_delivery_base_fee_amount,
    target_delivery_per_km_fee_amount,
    target_delivery_radius_km,
    target_free_delivery_minimum_amount,
    target_minimum_order_amount,
    target_pickup_location_label,
    target_pickup_formatted_address,
    target_pickup_instructions
  );

  delivery_window_id := public.configure_storefront_delivery_window(
    target_organization_id,
    target_min_business_days,
    target_max_business_days,
    target_idempotency_key || ':delivery-window',
    coalesce(target_metadata, '{}'::jsonb)
  );

  return jsonb_build_object(
    'settingsId', settings_id,
    'deliveryWindowId', delivery_window_id
  );
end;
$;

revoke all on function public.configure_storefront_full_settings(
  uuid, uuid, text, text, text[], text, text, jsonb, text, text, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, text, text, text, integer, integer
) from public, anon;
grant execute on function public.configure_storefront_full_settings(
  uuid, uuid, text, text, text[], text, text, jsonb, text, text, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, text, text, text, integer, integer
) to authenticated;

-- Customer receipt confirmation is the final Store milestone. Funds remain in
-- the existing checkout hold until the authenticated customer confirms receipt.
-- The API gateway invokes this function with its service-role client after
-- authenticating the customer and supplies that customer's immutable user id.
create or replace function public.confirm_store_order_receipt(
  target_order_id uuid,
  target_actor_user_id uuid,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record public.order_records%rowtype;
  service_request_record public.service_requests%rowtype;
  business_wallet_id uuid;
  settlement_statement_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Store receipt confirmation must use the trusted API gateway';
  end if;

  if target_order_id is null
    or target_actor_user_id is null
    or target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'Order, customer and idempotency key are required';
  end if;

  select order_table.*
  into order_record
  from public.order_records order_table
  join public.business_modules module on module.id = order_table.module_id
  where order_table.id = target_order_id
    and module.key = 'store'
    and order_table.order_payload ->> 'channel' = 'skima_store'
  for update of order_table;

  if not found then
    raise exception 'Store order was not found';
  end if;

  if order_record.requester_user_id <> target_actor_user_id then
    raise exception 'Only the customer who placed this Store order can confirm receipt';
  end if;

  if order_record.status = 'completed'
    and order_record.metadata ? 'store_customer_receipt_confirmed_at' then
    return jsonb_build_object(
      'orderId', order_record.id,
      'status', 'completed',
      'alreadyConfirmed', true,
      'settlementStatementId', order_record.metadata ->> 'store_settlement_statement_id'
    );
  end if;

  if order_record.status <> 'fulfilled' then
    raise exception 'Receipt can only be confirmed after Store operations records fulfilment';
  end if;

  select request.*
  into service_request_record
  from public.service_requests request
  where request.id = order_record.service_request_id
  for update;

  if not found or service_request_record.escrow_hold_id is null then
    raise exception 'The Store order has no confirmed checkout escrow hold; contact SKIMA support';
  end if;

  select wallet.id
  into business_wallet_id
  from public.wallet_accounts wallet
  where wallet.wallet_type = 'partner'
    and wallet.owner_entity_type = 'organization'
    and wallet.owner_entity_id = order_record.organization_id
    and wallet.currency_code = order_record.currency_code
    and wallet.status = 'active'
  order by wallet.created_at
  limit 1
  for update;

  if business_wallet_id is null then
    business_wallet_id := public.ensure_wallet_account(
      'partner',
      'organization',
      order_record.organization_id,
      order_record.currency_code,
      'platform.wallet_engine',
      jsonb_build_object(
        'wallet_purpose', 'store_order_settlement',
        'module_key', 'store'
      ),
      target_idempotency_key || ':merchant-wallet'
    );
  end if;

  settlement_statement_id := public.execute_order_business_settlement(
    order_record.id,
    service_request_record.escrow_hold_id,
    business_wallet_id,
    null,
    0,
    'skima.store.customer',
    target_idempotency_key || ':settlement',
    jsonb_build_object(
      'module_key', 'store',
      'channel', 'skima_store',
      'customer_receipt_confirmed_by', target_actor_user_id,
      'customer_receipt_confirmation_key', target_idempotency_key
    )
  );

  perform public.process_order_action(
    order_record.id,
    'store.order.complete',
    null,
    jsonb_build_object(
      'customer_receipt_confirmed', true,
      'customer_receipt_confirmed_by', target_actor_user_id
    ),
    'skima.store.customer',
    target_idempotency_key || ':completion',
    jsonb_build_object(
      'customer_receipt_confirmed_at', timezone('utc', now()),
      'settlement_statement_id', settlement_statement_id
    )
  );

  update public.order_records
  set metadata = metadata || jsonb_build_object(
        'store_customer_receipt_confirmed_at', timezone('utc', now()),
        'store_customer_receipt_confirmed_by', target_actor_user_id,
        'store_settlement_statement_id', settlement_statement_id
      ),
      updated_at = timezone('utc', now())
  where id = order_record.id;

  return jsonb_build_object(
    'orderId', order_record.id,
    'status', 'completed',
    'alreadyConfirmed', false,
    'settlementStatementId', settlement_statement_id
  );
end;
$$;

revoke all on function public.confirm_store_order_receipt(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.confirm_store_order_receipt(uuid, uuid, text) to service_role;

update public.order_action_definitions
set actor_scope = 'customer_or_business',
    display_name = 'Confirm customer receipt',
    metadata = metadata || jsonb_build_object(
      'customer_receipt_confirmation', true,
      'settlement_on_customer_receipt', true
    ),
    updated_at = timezone('utc', now())
where key = 'store.order.complete'
  and metadata ->> 'module_key' = 'store'
  and status = 'active';

commit;
