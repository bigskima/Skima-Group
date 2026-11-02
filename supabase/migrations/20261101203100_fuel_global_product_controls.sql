begin;

-- The Fuel module is installed and administratively available. Customer ordering
-- remains closed until an administrator explicitly enables one or more products.
update public.business_modules
set status = 'active',
    updated_at = timezone('utc', now())
where key = 'fuel'
  and status <> 'active';

create or replace function public.set_fuel_products_status(
  target_product_keys text[],
  target_status text,
  target_reason text,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  product_key_value text;
  result_value jsonb;
begin
  if auth.role() <> 'service_role' and not public.can_manage_fuel_platform() then
    raise exception using errcode = '42501', message = 'platform fuel management permission is required';
  end if;

  if target_product_keys is null
     or cardinality(target_product_keys) <> 3
     or not (target_product_keys @> array['fuel.pms', 'fuel.ago', 'fuel.dpk']::text[])
     or not (target_product_keys <@ array['fuel.pms', 'fuel.ago', 'fuel.dpk']::text[]) then
    raise exception using errcode = '22023', message = 'global product controls must include PMS, AGO and DPK exactly once';
  end if;

  if target_status is null or target_status not in ('enabled', 'disabled') then
    raise exception using errcode = '22023', message = 'global product status must be enabled or disabled';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception using errcode = '22023', message = 'an idempotency key is required for global product changes';
  end if;

  if not exists (
    select 1
    from public.business_modules
    where key = 'fuel'
      and status = 'active'
  ) then
    raise exception using errcode = '55000', message = 'the Fuel business module must be active before products can be changed';
  end if;

  -- Calling the existing per-product RPC preserves its permission check,
  -- row lock, idempotency behavior and append-only product status event.
  -- The surrounding transaction makes the three changes all-or-nothing.
  foreach product_key_value in array array['fuel.pms', 'fuel.ago', 'fuel.dpk']::text[]
  loop
    perform public.set_fuel_product_status(
      product_key_value,
      target_status,
      target_reason,
      target_idempotency_key || ':' || replace(product_key_value, '.', '-')
    );
  end loop;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('key', product.key, 'status', product.status)
      order by product.key
    ),
    '[]'::jsonb
  )
  into result_value
  from public.fuel_products product
  where product.key = any(target_product_keys);

  return result_value;
end;
$$;

revoke all on function public.set_fuel_products_status(text[], text, text, text) from public, anon;
grant execute on function public.set_fuel_products_status(text[], text, text, text) to authenticated, service_role;

commit;
