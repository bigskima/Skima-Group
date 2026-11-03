begin;

alter table public.storefront_settings
  add column if not exists delivery_origin_label text,
  add column if not exists delivery_origin_formatted_address text,
  add column if not exists delivery_origin_latitude numeric(10, 7),
  add column if not exists delivery_origin_longitude numeric(10, 7),
  add column if not exists delivery_base_fee_amount numeric(28, 8) not null default 0,
  add column if not exists delivery_per_km_fee_amount numeric(28, 8) not null default 0,
  add column if not exists delivery_radius_km numeric(12, 3),
  add column if not exists free_delivery_minimum_amount numeric(28, 8),
  add column if not exists minimum_order_amount numeric(28, 8) not null default 0,
  add column if not exists pickup_location_label text,
  add column if not exists pickup_formatted_address text,
  add column if not exists pickup_instructions text;

create index if not exists storefront_settings_organization_id_idx
  on public.storefront_settings (organization_id);
create index if not exists storefront_settings_branch_id_idx
  on public.storefront_settings (branch_id);
create index if not exists storefront_settings_currency_code_idx
  on public.storefront_settings (currency_code);
create index if not exists storefront_settings_created_by_idx
  on public.storefront_settings (created_by);

alter table public.storefront_settings
  drop constraint if exists storefront_settings_delivery_coordinates_pair_check,
  add constraint storefront_settings_delivery_coordinates_pair_check
    check (
      (delivery_origin_latitude is null and delivery_origin_longitude is null)
      or (
        delivery_origin_latitude between -90 and 90
        and delivery_origin_longitude between -180 and 180
      )
    ),
  drop constraint if exists storefront_settings_delivery_fees_nonnegative_check,
  add constraint storefront_settings_delivery_fees_nonnegative_check
    check (delivery_base_fee_amount >= 0 and delivery_per_km_fee_amount >= 0),
  drop constraint if exists storefront_settings_delivery_radius_positive_check,
  add constraint storefront_settings_delivery_radius_positive_check
    check (delivery_radius_km is null or delivery_radius_km > 0),
  drop constraint if exists storefront_settings_delivery_thresholds_nonnegative_check,
  add constraint storefront_settings_delivery_thresholds_nonnegative_check
    check (
      minimum_order_amount >= 0
      and (free_delivery_minimum_amount is null or free_delivery_minimum_amount >= 0)
    );

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
  methods text[];
begin
  if auth.uid() is null
    or not public.is_platform_super_admin()
      and not public.has_permission('platform.store.manage', null) then
    raise exception 'platform Store management permission is required';
  end if;

  methods := coalesce(target_fulfillment_methods, array[]::text[]);
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
      or target_delivery_origin_formatted_address is null or btrim(target_delivery_origin_formatted_address) = ''
      or target_delivery_origin_latitude is null or target_delivery_origin_longitude is null
      or target_delivery_origin_latitude < -90 or target_delivery_origin_latitude > 90
      or target_delivery_origin_longitude < -180 or target_delivery_origin_longitude > 180
      or target_delivery_radius_km is null or target_delivery_radius_km <= 0 then
      raise exception 'Configure the Store delivery origin, valid coordinates, and delivery radius before enabling delivery';
    end if;
  elsif target_delivery_origin_latitude is not null or target_delivery_origin_longitude is not null then
    if target_delivery_origin_latitude is null or target_delivery_longitude is null
      or target_delivery_origin_latitude < -90 or target_delivery_origin_latitude > 90
      or target_delivery_origin_longitude < -180 or target_delivery_origin_longitude > 180 then
      raise exception 'Store delivery coordinates must be supplied together and within valid geographic ranges';
    end if;
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
      delivery_per_km_fee_amount = target_delivery_per_km_fee_amount,
      delivery_radius_km = target_delivery_radius_km,
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
      'delivery_radius_km', target_delivery_radius_km,
      'delivery_base_fee_amount', target_delivery_base_fee_amount,
      'delivery_per_km_fee_amount', target_delivery_per_km_fee_amount,
      'minimum_order_amount', target_minimum_order_amount,
      'free_delivery_minimum_amount', target_free_delivery_minimum_amount,
      'pickup_location_label', target_pickup_location_label
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

commit;
