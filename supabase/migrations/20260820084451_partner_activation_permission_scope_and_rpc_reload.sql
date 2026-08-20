begin;

insert into public.permissions (
  key,
  description,
  risk_level,
  metadata
)
values (
  'business.partner_price.manage',
  'Manage a delegated partner selling price within an assigned organization and branch.',
  'high',
  jsonb_build_object('scope', 'organization_branch', 'delegated', true)
)
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    metadata = public.permissions.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

update public.lpg_station_role_presets
set permission_keys = array_replace(
      permission_keys,
      'platform.partner_price.manage',
      'business.partner_price.manage'
    ),
    updated_at = timezone('utc', now())
where 'platform.partner_price.manage' = any(permission_keys);

create or replace function public.can_manage_delegated_lpg_station_price(
  target_station_branch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or public.can_manage_lpg_operations()
    or exists (
      select 1
      from public.lpg_station_branches station
      where station.id = target_station_branch_id
        and public.has_permission_for_branch(
          'business.partner_price.manage',
          station.organization_id,
          station.branch_id
        )
    );
$$;

create or replace function public.enforce_delegated_lpg_catalog_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  item_record public.catalog_items%rowtype;
  privileged_actor boolean;
  managed_lpg_price boolean;
begin
  select * into item_record from public.catalog_items where id = new.item_id;

  if not found then
    raise exception 'catalog price item is required';
  end if;

  if item_record.module_id is distinct from (select id from public.business_modules where key = 'lpg') then
    return new;
  end if;

  if new.organization_id <> item_record.organization_id
    or new.branch_id is distinct from item_record.branch_id then
    raise exception 'catalog price organization and branch must match its item';
  end if;

  privileged_actor := auth.role() = 'service_role'
    or public.can_manage_lpg_operations()
    or public.has_permission('platform.financial_policy.draft', null);

  managed_lpg_price := new.metadata ->> 'price_basis' = 'per_kg'
    or new.metadata ->> 'managed_field' = 'station_price_per_kg'
    or not privileged_actor;

  if not privileged_actor and not public.has_permission_for_branch(
    'business.partner_price.manage', item_record.organization_id, item_record.branch_id
  ) then
    raise exception 'LPG station selling prices require delegated branch price permission';
  end if;

  if not managed_lpg_price then
    return new;
  end if;

  if new.amount <= 0
    or not exists (
      select 1 from public.currency_definitions currency
      where currency.code = new.currency_code and currency.status = 'enabled'
    ) then
    raise exception 'delegated station price must be positive and use an enabled currency';
  end if;

  if not privileged_actor and (
    new.variant_id is not null
    or new.pricing_policy_id is not null
    or new.tax_behavior <> 'exempt'
    or new.status not in ('active', 'scheduled')
  ) then
    raise exception 'station users may manage only their branch LPG selling price per kilogram';
  end if;

  new.metadata := new.metadata || jsonb_build_object(
    'price_basis', 'per_kg',
    'managed_field', 'station_price_per_kg'
  );

  if exists (
    select 1
    from public.catalog_prices price
    join public.catalog_items item on item.id = price.item_id
    where price.id is distinct from new.id
      and price.organization_id = new.organization_id
      and price.branch_id is not distinct from new.branch_id
      and price.currency_code = new.currency_code
      and price.status in ('active', 'scheduled')
      and item.module_id = item_record.module_id
      and price.metadata ->> 'price_basis' = 'per_kg'
      and tstzrange(coalesce(price.effective_from, '-infinity'::timestamptz), price.effective_until, '[)') &&
        tstzrange(coalesce(new.effective_from, '-infinity'::timestamptz), new.effective_until, '[)')
  ) then
    raise exception 'LPG station catalog price conflicts with another effective per-kilogram price';
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';

commit;
