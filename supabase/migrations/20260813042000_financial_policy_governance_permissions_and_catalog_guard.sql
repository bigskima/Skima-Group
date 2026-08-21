begin;

do $$
declare
  target_role_key text;
  target_role_id uuid;
  target_permission_id uuid;
begin
  select id into target_permission_id
  from public.permissions
  where key = 'platform.partner_price.manage';

  foreach target_role_key in array array['lpg.station.owner', 'lpg.station.admin']
  loop
    select id into target_role_id from public.roles where key = target_role_key;

    if target_role_id is not null and target_permission_id is not null then
      insert into public.role_permissions (role_id, permission_id)
      values (target_role_id, target_permission_id)
      on conflict do nothing;
    end if;

    update public.lpg_station_role_presets
    set permission_keys = array(
      select distinct permission_key
      from unnest(permission_keys || array['platform.partner_price.manage']) permission_key
      order by permission_key
    ),
        updated_at = timezone('utc', now())
    where role_key = target_role_key;
  end loop;
end $$;

create or replace function public.enforce_delegated_lpg_catalog_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  item_record public.catalog_items%rowtype;
begin
  if auth.role() = 'service_role' or public.can_manage_lpg_operations() then
    return new;
  end if;

  select * into item_record from public.catalog_items where id = new.item_id;

  if item_record.module_id is distinct from (select id from public.business_modules where key = 'lpg') then
    return new;
  end if;

  if not (
    public.has_permission_for_branch(
      'platform.partner_price.manage',
      item_record.organization_id,
      item_record.branch_id
    )
    or public.has_permission('platform.financial_policy.draft', null)
  ) then
    raise exception 'LPG station selling prices require delegated branch price permission';
  end if;

  if new.currency_code <> 'NGN' or new.amount <= 0 then
    raise exception 'delegated station users may change only a positive NGN branch LPG selling price per kilogram';
  end if;

  new.metadata := new.metadata || jsonb_build_object(
    'price_basis', 'per_kg',
    'managed_field', 'station_price_per_kg'
  );

  return new;
end;
$$;

create or replace function public.configure_lpg_refill_pricing(
  target_station_branch_id uuid,
  target_currency_code text,
  target_price_per_kg numeric,
  target_delivery_base_fee numeric,
  target_platform_fee_amount numeric,
  target_tax_rate_percent numeric,
  target_driver_commission_amount numeric,
  target_min_kg numeric,
  target_max_kg numeric,
  target_idempotency_key text,
  target_effective_from timestamptz default timezone('utc', now()),
  target_effective_until timestamptz default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'lpg.pricing_api'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pricing_id uuid;
  existing_record public.lpg_refill_pricing%rowtype;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.financial_policy.draft', null)
    and not (
      target_station_branch_id is not null
      and public.can_manage_delegated_lpg_station_price(target_station_branch_id)
    ) then
    raise exception 'financial policy draft or delegated station price permission is required';
  end if;

  if target_station_branch_id is not null
    and auth.role() <> 'service_role'
    and not public.has_permission('platform.financial_policy.draft', null)
    and (
      coalesce(target_delivery_base_fee, 0) <> 0
      or coalesce(target_platform_fee_amount, 0) <> 0
      or coalesce(target_tax_rate_percent, 0) <> 0
      or coalesce(target_driver_commission_amount, 0) <> 0
    ) then
    raise exception 'station users may set only their LPG selling price; all platform components come from financial policy';
  end if;

  if target_currency_code is null or target_currency_code !~ '^[A-Z0-9]{3,12}$'
    or target_price_per_kg is null or target_price_per_kg <= 0
    or target_min_kg is null or target_min_kg <= 0
    or target_max_kg is null or target_max_kg < target_min_kg
    or target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'valid currency, positive station price, kilogram bounds, and idempotency key are required';
  end if;

  if target_effective_until is not null
    and target_effective_until <= coalesce(target_effective_from, timezone('utc', now())) then
    raise exception 'target_effective_until must be after target_effective_from';
  end if;

  select * into existing_record
  from public.lpg_refill_pricing
  where source = target_source and idempotency_key = target_idempotency_key;

  if found then
    if existing_record.station_branch_id is distinct from target_station_branch_id
      or existing_record.price_per_kg <> target_price_per_kg
      or existing_record.currency_code <> target_currency_code then
      raise exception 'target_idempotency_key has already been used with different LPG pricing details';
    end if;
    return existing_record.id;
  end if;

  if exists (
    select 1
    from public.lpg_refill_pricing pricing
    where pricing.station_branch_id is not distinct from target_station_branch_id
      and pricing.currency_code = target_currency_code
      and pricing.status = 'active'
      and numrange(pricing.min_kg, pricing.max_kg, '[]') && numrange(target_min_kg, target_max_kg, '[]')
      and tstzrange(pricing.effective_from, pricing.effective_until, '[)') &&
        tstzrange(coalesce(target_effective_from, timezone('utc', now())), target_effective_until, '[)')
  ) then
    raise exception 'LPG station selling-price version conflicts with an active effective window';
  end if;

  insert into public.lpg_refill_pricing (
    station_branch_id, currency_code, price_per_kg, delivery_base_fee,
    platform_fee_amount, tax_rate_percent, driver_commission_amount, min_kg, max_kg,
    effective_from, effective_until, metadata, source, idempotency_key
  ) values (
    target_station_branch_id, target_currency_code, target_price_per_kg, 0, 0, 0, 0,
    target_min_kg, target_max_kg, coalesce(target_effective_from, timezone('utc', now())),
    target_effective_until,
    target_metadata || jsonb_build_object(
      'legacy_platform_components_ignored', true,
      'managed_field', 'station_price_per_kg'
    ),
    target_source, target_idempotency_key
  ) returning id into pricing_id;

  return pricing_id;
end;
$$;

commit;
