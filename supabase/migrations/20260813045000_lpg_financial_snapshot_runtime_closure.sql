begin;

create or replace function public.prevent_financial_policy_version_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'financial policy versions are immutable and cannot be deleted';
  end if;

  if old.policy_definition_id <> new.policy_definition_id
    or old.version <> new.version
    or old.organization_id is distinct from new.organization_id
    or old.module_id is distinct from new.module_id
    or old.service_key is distinct from new.service_key
    or old.geography_type <> new.geography_type
    or old.geography_key is distinct from new.geography_key
    or old.currency_code <> new.currency_code
    or old.priority <> new.priority
    or old.configuration <> new.configuration
    or old.effective_from <> new.effective_from
    or (
      old.effective_until is distinct from new.effective_until
      and not (
        new.lifecycle_status = 'inactive'
        and new.effective_until is not null
        and new.effective_until <= timezone('utc', now())
      )
      and not (
        new.lifecycle_status = 'superseded'
        and new.effective_until is not null
        and new.effective_until > old.effective_from
      )
    )
    or old.change_reason <> new.change_reason
    or old.created_by is distinct from new.created_by
    or old.created_at <> new.created_at then
    raise exception 'financial policy version business fields are immutable; create a new version';
  end if;

  if old.lifecycle_status not in ('draft', 'submitted', 'approved', 'scheduled', 'active')
    and old.lifecycle_status <> new.lifecycle_status then
    raise exception 'terminal financial policy lifecycle state cannot be changed';
  end if;

  return new;
end;
$$;

create or replace function public.activate_financial_policy_version(
  target_policy_version_id uuid,
  target_reason text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  before_record public.financial_policy_versions%rowtype;
  superseded_before public.financial_policy_versions%rowtype;
  superseded_after jsonb;
  next_status text;
begin
  if auth.role() <> 'service_role' and not public.has_permission('platform.financial_policy.activate', null) then
    raise exception 'financial policy activation permission is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select * into before_record
  from public.financial_policy_versions
  where id = target_policy_version_id
  for update;

  if not found or before_record.lifecycle_status <> 'approved' then
    raise exception 'only an approved financial policy version can be activated';
  end if;

  if before_record.supersedes_version_id is not null then
    select * into superseded_before
    from public.financial_policy_versions
    where id = before_record.supersedes_version_id
    for update;

    if not found then
      raise exception 'superseded financial policy version was not found';
    end if;

    if superseded_before.policy_definition_id <> before_record.policy_definition_id
      or superseded_before.currency_code <> before_record.currency_code
      or superseded_before.module_id is distinct from before_record.module_id
      or superseded_before.organization_id is distinct from before_record.organization_id
      or superseded_before.service_key is distinct from before_record.service_key
      or superseded_before.geography_type <> before_record.geography_type
      or superseded_before.geography_key is distinct from before_record.geography_key
      or superseded_before.priority <> before_record.priority then
      raise exception 'superseding policy version must keep the same policy scope as the version it replaces';
    end if;

    if superseded_before.lifecycle_status not in ('active', 'scheduled') then
      raise exception 'only active or scheduled policy versions can be superseded';
    end if;

    if before_record.effective_from <= superseded_before.effective_from then
      raise exception 'superseding policy version must start after the version it replaces';
    end if;

    if superseded_before.effective_until is not null
      and before_record.effective_from >= superseded_before.effective_until then
      raise exception 'superseding policy version effective time does not overlap the version it replaces';
    end if;

    update public.financial_policy_versions
    set lifecycle_status = 'superseded',
        effective_until = before_record.effective_from,
        deactivated_by = auth.uid(),
        deactivated_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = superseded_before.id;

    select to_jsonb(version.*) into superseded_after
    from public.financial_policy_versions version
    where version.id = superseded_before.id;

    insert into public.financial_policy_events (
      policy_version_id, event_type, actor_user_id, previous_state, new_state, reason, idempotency_key
    ) values (
      superseded_before.id, 'superseded', auth.uid(), to_jsonb(superseded_before),
      superseded_after, target_reason, target_idempotency_key || ':superseded'
    ) on conflict (policy_version_id, idempotency_key) do nothing;
  end if;

  perform public.assert_financial_policy_no_conflict(target_policy_version_id);
  next_status := case when before_record.effective_from > timezone('utc', now()) then 'scheduled' else 'active' end;

  update public.financial_policy_versions
  set lifecycle_status = next_status,
      activated_by = auth.uid(),
      activated_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = target_policy_version_id;

  insert into public.financial_policy_events (
    policy_version_id, event_type, actor_user_id, previous_state, new_state, reason, idempotency_key
  ) values (
    target_policy_version_id,
    case when next_status = 'active' then 'activated' else 'scheduled' end,
    auth.uid(), to_jsonb(before_record),
    (select to_jsonb(version.*) from public.financial_policy_versions version where version.id = target_policy_version_id),
    target_reason, target_idempotency_key
  ) on conflict (policy_version_id, idempotency_key) do nothing;

  return target_policy_version_id;
end;
$$;

-- The legacy LPG pricing row remains only as the station-price input referenced by
-- the established quote/refill lifecycle. Platform fees, delivery prices, taxes,
-- payouts, and commissions are never read from this compatibility record.
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
  resolved_effective_from timestamptz := coalesce(target_effective_from, timezone('utc', now()));
begin
  if target_station_branch_id is null then
    raise exception 'station-scoped LPG pricing is required';
  end if;

  if auth.role() <> 'service_role'
    and not public.has_permission('platform.financial_policy.draft', null)
    and not public.can_manage_delegated_lpg_station_price(target_station_branch_id) then
    raise exception 'financial policy draft or delegated station price permission is required';
  end if;

  if not exists (
    select 1 from public.lpg_station_branches station
    where station.id = target_station_branch_id
  ) then
    raise exception 'target_station_branch_id must reference an LPG station branch';
  end if;

  if target_currency_code is null or target_currency_code !~ '^[A-Z0-9]{3,12}$'
    or not exists (
      select 1 from public.currency_definitions currency
      where currency.code = target_currency_code and currency.status = 'enabled'
    ) then
    raise exception 'target_currency_code must reference an enabled currency';
  end if;

  if target_price_per_kg is null or target_price_per_kg <= 0
    or target_min_kg is null or target_min_kg <= 0
    or target_max_kg is null or target_max_kg < target_min_kg then
    raise exception 'positive station price and valid kilogram bounds are required';
  end if;

  if coalesce(target_delivery_base_fee, 0) <> 0
    or coalesce(target_platform_fee_amount, 0) <> 0
    or coalesce(target_tax_rate_percent, 0) <> 0
    or coalesce(target_driver_commission_amount, 0) <> 0 then
    raise exception 'legacy LPG pricing may store only the station selling price; platform financial components must come from versioned policy';
  end if;

  if target_effective_until is not null and target_effective_until <= resolved_effective_from then
    raise exception 'target_effective_until must be after target_effective_from';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = ''
    or target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$'
    or target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'valid source, idempotency key, and metadata are required';
  end if;

  select * into existing_record
  from public.lpg_refill_pricing
  where source = target_source and idempotency_key = target_idempotency_key;

  if found then
    if existing_record.station_branch_id is distinct from target_station_branch_id
      or existing_record.currency_code <> target_currency_code
      or existing_record.price_per_kg <> target_price_per_kg
      or existing_record.min_kg <> target_min_kg
      or existing_record.max_kg <> target_max_kg
      or existing_record.effective_from <> resolved_effective_from
      or existing_record.effective_until is distinct from target_effective_until
      or existing_record.delivery_base_fee <> 0
      or existing_record.platform_fee_amount <> 0
      or existing_record.tax_rate_percent <> 0
      or existing_record.driver_commission_amount <> 0 then
      raise exception 'target_idempotency_key has already been used with different LPG station pricing details';
    end if;

    return existing_record.id;
  end if;

  -- Close only the currently-effective predecessor. Future scheduled versions are
  -- not silently replaced; an overlapping future window fails below.
  update public.lpg_refill_pricing pricing
  set effective_until = resolved_effective_from,
      status = case
        when resolved_effective_from <= timezone('utc', now()) then 'retired'
        else pricing.status
      end,
      metadata = pricing.metadata || jsonb_build_object(
        'superseded_at', timezone('utc', now()),
        'superseded_by_idempotency_key', target_idempotency_key
      ),
      updated_at = timezone('utc', now())
  where pricing.station_branch_id = target_station_branch_id
    and pricing.currency_code = target_currency_code
    and pricing.status = 'active'
    and pricing.effective_from < resolved_effective_from
    and (pricing.effective_until is null or pricing.effective_until > resolved_effective_from);

  if exists (
    select 1
    from public.lpg_refill_pricing pricing
    where pricing.station_branch_id = target_station_branch_id
      and pricing.currency_code = target_currency_code
      and pricing.status = 'active'
      and numrange(pricing.min_kg, pricing.max_kg, '[]') && numrange(target_min_kg, target_max_kg, '[]')
      and tstzrange(pricing.effective_from, pricing.effective_until, '[)') &&
        tstzrange(resolved_effective_from, target_effective_until, '[)')
  ) then
    raise exception 'LPG station selling-price version conflicts with an active effective window';
  end if;

  insert into public.lpg_refill_pricing (
    station_branch_id, currency_code, price_per_kg, delivery_base_fee,
    platform_fee_amount, tax_rate_percent, driver_commission_amount, min_kg, max_kg,
    effective_from, effective_until, metadata, source, idempotency_key
  ) values (
    target_station_branch_id, target_currency_code, target_price_per_kg, 0,
    0, 0, 0, target_min_kg, target_max_kg,
    resolved_effective_from, target_effective_until,
    target_metadata || jsonb_build_object(
      'compatibility_role', 'station_price_input_only',
      'legacy_platform_components_ignored', true,
      'managed_field', 'station_price_per_kg'
    ),
    target_source, target_idempotency_key
  ) returning id into pricing_id;

  return pricing_id;
end;
$$;

-- Guard the delegated LPG catalog field even if a caller reaches the catalog
-- engine directly. Other module catalog prices remain governed by their generic
-- catalog permissions and are not made LPG-specific here.
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
    'platform.partner_price.manage', item_record.organization_id, item_record.branch_id
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

drop trigger if exists enforce_delegated_lpg_catalog_price on public.catalog_prices;
create trigger enforce_delegated_lpg_catalog_price
before insert or update on public.catalog_prices
for each row execute function public.enforce_delegated_lpg_catalog_price();

create or replace function public.configure_lpg_station_catalog_price(
  target_station_branch_id uuid,
  target_item_id uuid,
  target_price_per_kg numeric,
  target_effective_from timestamptz,
  target_idempotency_key text,
  target_effective_until timestamptz default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.station_catalog_price'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  station_record public.lpg_station_branches%rowtype;
  item_record public.catalog_items%rowtype;
  existing_record public.catalog_prices%rowtype;
  resolved_effective_from timestamptz := coalesce(target_effective_from, timezone('utc', now()));
  target_status text;
  price_id uuid;
begin
  if not public.can_manage_delegated_lpg_station_price(target_station_branch_id) then
    raise exception 'delegated branch price management permission is required';
  end if;

  select * into station_record
  from public.lpg_station_branches
  where id = target_station_branch_id
  for update;

  select * into item_record
  from public.catalog_items
  where id = target_item_id;

  if station_record.id is null or item_record.id is null
    or item_record.organization_id <> station_record.organization_id
    or item_record.branch_id is distinct from station_record.branch_id
    or item_record.module_id is distinct from (select id from public.business_modules where key = 'lpg')
    or item_record.item_type not in ('product', 'service')
    or item_record.status <> 'active' then
    raise exception 'target_item_id must be an active LPG catalog item owned by the delegated station branch';
  end if;

  if target_price_per_kg is null or target_price_per_kg <= 0 then
    raise exception 'target_price_per_kg must be greater than zero';
  end if;

  if target_effective_until is not null and target_effective_until <= resolved_effective_from then
    raise exception 'target_effective_until must be after target_effective_from';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = ''
    or target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$'
    or target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'valid source, idempotency key, and metadata are required';
  end if;

  select * into existing_record
  from public.catalog_prices
  where source = target_source and idempotency_key = target_idempotency_key;

  if found then
    if existing_record.item_id <> target_item_id
      or existing_record.currency_code <> 'NGN'
      or existing_record.amount <> target_price_per_kg
      or existing_record.effective_from is distinct from resolved_effective_from
      or existing_record.effective_until is distinct from target_effective_until then
      raise exception 'target_idempotency_key has already been used with different station catalog pricing details';
    end if;

    price_id := existing_record.id;
  else
    -- Preserve future scheduled versions. Only the currently-effective predecessor
    -- is closed, leaving an auditable row instead of overwriting its amount.
    update public.catalog_prices price
    set effective_until = resolved_effective_from,
        status = case
          when resolved_effective_from <= timezone('utc', now()) then 'retired'
          else price.status
        end,
        metadata = price.metadata || jsonb_build_object(
          'superseded_at', timezone('utc', now()),
          'superseded_by_idempotency_key', target_idempotency_key
        ),
        updated_at = timezone('utc', now())
    where price.organization_id = station_record.organization_id
      and price.branch_id is not distinct from station_record.branch_id
      and price.currency_code = 'NGN'
      and price.status = 'active'
      and price.metadata ->> 'price_basis' = 'per_kg'
      and coalesce(price.effective_from, '-infinity'::timestamptz) < resolved_effective_from
      and (price.effective_until is null or price.effective_until > resolved_effective_from);

    if exists (
      select 1
      from public.catalog_prices price
      join public.catalog_items item on item.id = price.item_id
      where price.organization_id = station_record.organization_id
        and price.branch_id is not distinct from station_record.branch_id
        and price.currency_code = 'NGN'
        and price.status in ('active', 'scheduled')
        and item.module_id = item_record.module_id
        and price.metadata ->> 'price_basis' = 'per_kg'
        and tstzrange(coalesce(price.effective_from, '-infinity'::timestamptz), price.effective_until, '[)') &&
          tstzrange(resolved_effective_from, target_effective_until, '[)')
    ) then
      raise exception 'station catalog price conflicts with another effective per-kilogram version';
    end if;

    target_status := case
      when resolved_effective_from > timezone('utc', now()) then 'scheduled'
      else 'active'
    end;

    insert into public.catalog_prices (
      organization_id, branch_id, item_id, variant_id, pricing_policy_id,
      currency_code, amount, compare_at_amount, tax_behavior, status,
      effective_from, effective_until, source, idempotency_key, metadata
    ) values (
      station_record.organization_id, station_record.branch_id, item_record.id, null, null,
      'NGN', target_price_per_kg, null, 'exempt', target_status,
      resolved_effective_from, target_effective_until, target_source, target_idempotency_key,
      target_metadata || jsonb_build_object(
        'price_basis', 'per_kg',
        'delegated_station_branch_id', target_station_branch_id,
        'managed_field', 'station_price_per_kg'
      )
    ) returning id into price_id;

    perform public.record_catalog_runtime_event(
      station_record.organization_id,
      'event.catalog.price.configured',
      target_idempotency_key || ':event',
      station_record.branch_id,
      item_record.id,
      null,
      null,
      target_status,
      target_metadata || jsonb_build_object(
        'currency_code', 'NGN',
        'managed_field', 'station_price_per_kg'
      )
    );
  end if;

  -- Bridge the established quote/refill FK without carrying any platform money.
  perform public.configure_lpg_refill_pricing(
    target_station_branch_id,
    'NGN',
    target_price_per_kg,
    0,
    0,
    0,
    0,
    0.001,
    999999999.999,
    target_idempotency_key || ':station-price-input',
    resolved_effective_from,
    target_effective_until,
    target_metadata || jsonb_build_object(
      'catalog_price_id', price_id,
      'catalog_item_id', target_item_id
    ),
    target_source || '.compatibility'
  );

  return price_id;
end;
$$;

create or replace function public.read_lpg_station_catalog_prices(
  target_station_branch_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  station_record public.lpg_station_branches%rowtype;
begin
  select * into station_record
  from public.lpg_station_branches station
  where (target_station_branch_id is null or station.id = target_station_branch_id)
    and public.can_read_lpg_station_branch(station.id)
  order by station.created_at asc
  limit 1;

  if not found then
    raise exception 'branch-scoped LPG station access is required';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', catalog_price.id,
      'itemId', catalog_item.id,
      'itemKey', catalog_item.key,
      'displayName', catalog_item.display_name,
      'currencyCode', catalog_price.currency_code,
      'pricePerKg', catalog_price.amount,
      'status', catalog_price.status,
      'effectiveFrom', catalog_price.effective_from,
      'effectiveUntil', catalog_price.effective_until,
      'createdAt', catalog_price.created_at
    ) order by catalog_item.display_name, catalog_price.effective_from desc)
    from public.catalog_prices catalog_price
    join public.catalog_items catalog_item on catalog_item.id = catalog_price.item_id
    where catalog_price.organization_id = station_record.organization_id
      and catalog_price.branch_id is not distinct from station_record.branch_id
      and catalog_item.module_id = (select id from public.business_modules where key = 'lpg')
      and catalog_item.status = 'active'
      and catalog_price.metadata ->> 'price_basis' = 'per_kg'
      and catalog_price.status in ('active', 'scheduled')
  ), '[]'::jsonb);
end;
$$;

-- This default defines only the settlement component contract. It contains no
-- commercial rate and remains replaceable through the governed policy workflow.
do $$
declare
  lpg_module_id uuid;
  definition_id uuid;
  version_id uuid;
begin
  select id into lpg_module_id from public.business_modules where key = 'lpg';
  select id into definition_id
  from public.financial_policy_definitions
  where key = 'settlement.lpg.beneficiaries';

  if lpg_module_id is not null and definition_id is not null and not exists (
    select 1 from public.financial_policy_versions where policy_definition_id = definition_id
  ) then
    insert into public.financial_policy_versions (
      policy_definition_id, version, lifecycle_status, module_id, service_key,
      geography_type, currency_code, configuration, effective_from, change_reason,
      validation_snapshot, submitted_at, approved_at, activated_at
    ) values (
      definition_id, 1, 'active', lpg_module_id, 'lpg.refill.settlement',
      'global', 'NGN',
      '{
        "station_settlement_components":["station_lpg_principal","platform_lpg_markup","platform_logistics_margin","tax"],
        "underfill_refund_components":["station_lpg_principal","platform_lpg_markup"],
        "driver_payout_release_event":"lpg.delivery.verified",
        "require_locked_quote_snapshot":true
      }'::jsonb,
      timezone('utc', now()),
      'Initial LPG settlement component contract; contains no commercial rates.',
      public.validate_financial_policy_configuration(
        'settlement',
        '{"require_locked_quote_snapshot":true}'::jsonb
      ),
      timezone('utc', now()), timezone('utc', now()), timezone('utc', now())
    ) returning id into version_id;

    insert into public.financial_policy_events (
      policy_version_id, event_type, previous_state, new_state, reason, idempotency_key
    ) values (
      version_id, 'activated', null,
      (select to_jsonb(version.*) from public.financial_policy_versions version where version.id = version_id),
      'Initial LPG settlement component contract; contains no commercial rates.',
      'seed:lpg-settlement-components:v1'
    );
  end if;
end $$;

-- Add the settlement contract to every newly-created commercial quote snapshot.
create or replace function public.create_lpg_refill_quote_from_commercial_snapshot(
  target_cylinder_id uuid,
  target_requested_kg numeric,
  target_pickup_location_id uuid,
  target_delivery_location_id uuid,
  target_station_branch_id uuid,
  target_route_snapshot jsonb,
  target_idempotency_key text,
  target_preferred_time timestamptz default null,
  target_delivery_instructions text default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'lpg.quote_api'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  quote_id uuid;
  commercial_snapshot jsonb;
  settlement_policy jsonb;
  station_record public.lpg_station_branches%rowtype;
  generic_quote_id uuid;
begin
  select * into station_record
  from public.lpg_station_branches
  where id = target_station_branch_id;

  if not found then
    raise exception 'target_station_branch_id must reference an LPG station';
  end if;

  commercial_snapshot := public.calculate_lpg_commercial_quote(
    target_station_branch_id, target_requested_kg, target_route_snapshot, timezone('utc', now())
  );

  settlement_policy := public.resolve_financial_policy(
    'settlement.lpg.beneficiaries', 'NGN', timezone('utc', now()), 'lpg',
    station_record.organization_id, 'lpg.refill.settlement', 'global', null
  );

  commercial_snapshot := jsonb_set(
    commercial_snapshot,
    '{policySnapshots,settlement}',
    settlement_policy,
    true
  );

  quote_id := public.create_lpg_refill_quote(
    target_cylinder_id, target_requested_kg, target_pickup_location_id,
    target_delivery_location_id, target_idempotency_key, target_station_branch_id,
    target_preferred_time, target_delivery_instructions,
    target_metadata || jsonb_build_object('commercial_policy_snapshot', commercial_snapshot),
    target_source
  );

  update public.lpg_refill_quotes
  set quoted_kg = target_requested_kg,
      lpg_amount = (commercial_snapshot ->> 'stationLpgAmount')::numeric,
      delivery_fee_amount = (commercial_snapshot ->> 'customerDeliveryFee')::numeric,
      platform_fee_amount = (commercial_snapshot ->> 'platformLpgMarkup')::numeric,
      driver_commission_amount = (commercial_snapshot ->> 'driverPayout')::numeric,
      tax_amount = 0,
      total_amount = (commercial_snapshot ->> 'stationLpgAmount')::numeric
        + (commercial_snapshot ->> 'platformLpgMarkup')::numeric
        + (commercial_snapshot ->> 'customerDeliveryFee')::numeric,
      breakdown = commercial_snapshot,
      financial_policy_snapshot = commercial_snapshot -> 'policySnapshots',
      metadata = metadata || jsonb_build_object(
        'commercial_policy_snapshot_locked', true,
        'financial_snapshot_schema', 'skima.financial.lpg.quote.v1'
      ),
      updated_at = timezone('utc', now())
  where id = quote_id and status = 'quoted';

  select price_quote_id into generic_quote_id
  from public.lpg_refill_quotes where id = quote_id;

  update public.price_quotes
  set subtotal_amount = (commercial_snapshot ->> 'stationLpgAmount')::numeric
        + (commercial_snapshot ->> 'customerDeliveryFee')::numeric,
      fee_amount = (commercial_snapshot ->> 'platformLpgMarkup')::numeric,
      tax_amount = 0,
      total_amount = (commercial_snapshot ->> 'stationLpgAmount')::numeric
        + (commercial_snapshot ->> 'platformLpgMarkup')::numeric
        + (commercial_snapshot ->> 'customerDeliveryFee')::numeric,
      pricing_context = commercial_snapshot,
      calculation_breakdown = commercial_snapshot,
      updated_at = timezone('utc', now())
  where id = generic_quote_id and status = 'calculated';

  return quote_id;
end;
$$;

create or replace function public.copy_lpg_quote_policy_snapshot_to_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  quote_record public.lpg_refill_quotes%rowtype;
begin
  select * into quote_record
  from public.lpg_refill_quotes where id = new.lpg_refill_quote_id;

  if not found
    or quote_record.financial_policy_snapshot is null
    or quote_record.financial_policy_snapshot = '{}'::jsonb
    or quote_record.financial_policy_snapshot -> 'platformMarkup' is null
    or quote_record.financial_policy_snapshot -> 'deliveryPricing' is null
    or quote_record.financial_policy_snapshot -> 'driverPayout' is null
    or quote_record.financial_policy_snapshot -> 'settlement' is null then
    raise exception 'accepted LPG order requires a complete locked financial policy snapshot';
  end if;

  new.financial_policy_snapshot := quote_record.financial_policy_snapshot || jsonb_build_object(
    'snapshotSchema', 'skima.financial.lpg.order.v1',
    'commercialQuote', quote_record.breakdown,
    'acceptedQuote', jsonb_build_object(
      'quoteId', quote_record.id,
      'quotedKg', quote_record.quoted_kg,
      'stationAmount', quote_record.lpg_amount,
      'platformMarkupAmount', quote_record.platform_fee_amount,
      'deliveryFeeAmount', quote_record.delivery_fee_amount,
      'driverPayoutAmount', quote_record.driver_commission_amount,
      'taxAmount', quote_record.tax_amount,
      'totalAmount', quote_record.total_amount,
      'currencyCode', quote_record.currency_code
    )
  );

  return new;
end;
$$;

create or replace function public.prevent_lpg_accepted_quote_financial_mutation()
returns trigger
language plpgsql
as $$
begin
  if old.quoted_kg is distinct from new.quoted_kg
    or old.lpg_amount is distinct from new.lpg_amount
    or old.delivery_fee_amount is distinct from new.delivery_fee_amount
    or old.platform_fee_amount is distinct from new.platform_fee_amount
    or old.tax_amount is distinct from new.tax_amount
    or old.driver_commission_amount is distinct from new.driver_commission_amount
    or old.total_amount is distinct from new.total_amount
    or old.breakdown is distinct from new.breakdown
    or old.financial_policy_snapshot is distinct from new.financial_policy_snapshot then
    raise exception 'accepted LPG quote financial snapshot and amounts are immutable';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_lpg_accepted_quote_financial_mutation on public.lpg_refill_quotes;
create trigger prevent_lpg_accepted_quote_financial_mutation
before update on public.lpg_refill_quotes
for each row when (old.status in ('accepted', 'expired', 'cancelled'))
execute function public.prevent_lpg_accepted_quote_financial_mutation();

-- Underfill changes only the fulfilled quantity. The accepted quote remains
-- immutable; the refund reconciles both station principal and the per-kg platform
-- markup while route-priced delivery and its locked payout stay unchanged.
create or replace function public.settle_lpg_station_order(
  target_lpg_order_id uuid,
  target_idempotency_key text,
  target_station_wallet_id uuid default null,
  target_platform_wallet_id uuid default null,
  target_actor_user_id uuid default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'lpg.station_settlement_api'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record public.lpg_refill_orders%rowtype;
  quote_record public.lpg_refill_quotes%rowtype;
  station_record public.lpg_station_branches%rowtype;
  actor_user_id uuid;
  order_record_id uuid;
  station_wallet_id uuid;
  platform_wallet_id uuid;
  customer_wallet_id uuid;
  settlement_policy jsonb;
  settlement_configuration jsonb;
  markup_policy jsonb;
  locked_markup_per_kg numeric(28, 8);
  quote_station_amount numeric(28, 8);
  quote_platform_markup numeric(28, 8);
  actual_station_amount numeric(28, 8);
  actual_platform_markup numeric(28, 8);
  tax_amount numeric(28, 8);
  delivery_margin_amount numeric(28, 8);
  platform_release_amount numeric(28, 8);
  station_underfill_refund numeric(28, 8);
  markup_underfill_refund numeric(28, 8);
  underfill_refund_amount numeric(28, 8);
  refund_transaction_id uuid;
  settlement_execution_id uuid;
  settlement_statement_id uuid;
  distribution jsonb := '[]'::jsonb;
begin
  if target_lpg_order_id is null
    or target_idempotency_key is null or btrim(target_idempotency_key) = ''
    or target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'LPG order, idempotency key, and valid metadata are required';
  end if;

  actor_user_id := coalesce(target_actor_user_id, auth.uid());

  select * into order_record
  from public.lpg_refill_orders
  where id = target_lpg_order_id
  for update;

  if not found then raise exception 'target_lpg_order_id must reference an LPG order'; end if;
  if order_record.station_settlement_execution_id is not null then
    return order_record.station_settlement_execution_id;
  end if;
  if order_record.status <> 'refill_confirmed' then
    raise exception 'LPG station settlement requires a confirmed refill';
  end if;
  if order_record.escrow_hold_id is null or order_record.actual_kg is null then
    raise exception 'LPG station settlement requires reserved escrow and confirmed actual kilograms';
  end if;

  select * into quote_record
  from public.lpg_refill_quotes
  where id = order_record.lpg_refill_quote_id;

  if not found or quote_record.status <> 'accepted' then
    raise exception 'an accepted LPG quote is required for settlement';
  end if;

  select * into station_record
  from public.lpg_station_branches
  where id = order_record.station_branch_id;

  if not found then raise exception 'LPG station branch is required before settlement'; end if;

  if auth.role() = 'service_role' then
    if actor_user_id is not null
      and not public.user_can_operate_lpg_station_branch(actor_user_id, station_record.id, 'lpg.orders.finance')
      and not public.user_can_operate_lpg_station_branch(actor_user_id, station_record.id, 'lpg.stations.manage') then
      raise exception 'branch-scoped LPG finance actor permission is required';
    end if;
  elsif not public.can_operate_lpg_station_branch(station_record.id, 'lpg.orders.finance') then
    raise exception 'branch-scoped LPG finance permission is required';
  end if;

  settlement_policy := order_record.financial_policy_snapshot -> 'settlement';
  markup_policy := order_record.financial_policy_snapshot -> 'platformMarkup';

  if settlement_policy is null or jsonb_typeof(settlement_policy) <> 'object'
    or settlement_policy ->> 'policyVersionId' is null
    or settlement_policy ->> 'currencyCode' <> order_record.currency_code
    or markup_policy is null or jsonb_typeof(markup_policy) <> 'object'
    or markup_policy ->> 'policyVersionId' is null
    or markup_policy ->> 'currencyCode' <> order_record.currency_code then
    raise exception 'complete currency-matched locked settlement and markup policy snapshots are required';
  end if;

  settlement_configuration := settlement_policy -> 'configuration';
  if jsonb_typeof(settlement_configuration -> 'station_settlement_components') <> 'array'
    or not (settlement_configuration -> 'station_settlement_components' @>
      '["station_lpg_principal","platform_lpg_markup","platform_logistics_margin","tax"]'::jsonb)
    or jsonb_typeof(settlement_configuration -> 'underfill_refund_components') <> 'array'
    or not (settlement_configuration -> 'underfill_refund_components' @>
      '["station_lpg_principal","platform_lpg_markup"]'::jsonb)
    or settlement_configuration ->> 'driver_payout_release_event' <> 'lpg.delivery.verified' then
    raise exception 'locked LPG settlement policy is missing required beneficiary and reconciliation controls';
  end if;

  locked_markup_per_kg := nullif(markup_policy -> 'configuration' ->> 'amount_per_kg', '')::numeric;
  if locked_markup_per_kg is null or locked_markup_per_kg < 0 then
    raise exception 'locked LPG markup policy must define non-negative amount_per_kg';
  end if;

  quote_station_amount := quote_record.lpg_amount;
  quote_platform_markup := quote_record.platform_fee_amount;
  actual_station_amount := order_record.station_amount;
  actual_platform_markup := round(order_record.actual_kg * locked_markup_per_kg, 2);
  tax_amount := quote_record.tax_amount;

  if round(quote_record.quoted_kg * locked_markup_per_kg, 2) <> quote_platform_markup then
    raise exception 'accepted quote platform markup does not match its locked policy snapshot';
  end if;

  if order_record.actual_kg > quote_record.quoted_kg
    or actual_station_amount > quote_station_amount
    or actual_platform_markup > quote_platform_markup then
    insert into public.lpg_order_financial_adjustments (
      lpg_order_id, adjustment_type, currency_code, amount, status,
      reason_key, metadata, source, idempotency_key
    ) values (
      order_record.id, 'overfill_blocked', order_record.currency_code,
      greatest(actual_station_amount + actual_platform_markup - quote_station_amount - quote_platform_markup, 0),
      'blocked', 'lpg.overfill.manual_review',
      target_metadata || jsonb_build_object(
        'quoted_kg', quote_record.quoted_kg,
        'actual_kg', order_record.actual_kg,
        'policy_version_id', markup_policy ->> 'policyVersionId'
      ),
      target_source, target_idempotency_key || ':overfill'
    ) on conflict (source, idempotency_key) do nothing;

    raise exception 'LPG overfill is blocked for manual review';
  end if;

  station_underfill_refund := greatest(quote_station_amount - actual_station_amount, 0);
  markup_underfill_refund := greatest(quote_platform_markup - actual_platform_markup, 0);
  underfill_refund_amount := station_underfill_refund + markup_underfill_refund;
  delivery_margin_amount := quote_record.delivery_fee_amount - quote_record.driver_commission_amount;

  if delivery_margin_amount < 0 then
    raise exception 'locked driver payout exceeds the accepted delivery fee';
  end if;

  platform_release_amount := actual_platform_markup + tax_amount + delivery_margin_amount;

  order_record_id := public.ensure_lpg_order_record(
    order_record.id,
    target_idempotency_key || ':order-record',
    'lpg.order_projection',
    target_metadata || jsonb_build_object(
      'financial_policy_snapshot', order_record.financial_policy_snapshot
    )
  );

  station_wallet_id := coalesce(
    target_station_wallet_id,
    public.ensure_wallet_account(
      'partner', 'organization', station_record.organization_id,
      order_record.currency_code, 'lpg.wallet_engine',
      jsonb_build_object('wallet_purpose', 'lpg_station_settlement', 'station_branch_id', station_record.id),
      target_idempotency_key || ':station-wallet'
    )
  );

  platform_wallet_id := coalesce(
    target_platform_wallet_id,
    public.ensure_platform_clearing_wallet(
      order_record.currency_code, 'lpg.wallet_engine', target_idempotency_key || ':platform-wallet'
    )
  );

  select wallet.id into customer_wallet_id
  from public.wallet_accounts wallet
  where wallet.wallet_type = 'customer'
    and wallet.owner_entity_type = 'user'
    and wallet.owner_entity_id = order_record.customer_user_id
    and wallet.currency_code = order_record.currency_code
    and wallet.status = 'active'
  order by wallet.created_at asc
  limit 1;

  if customer_wallet_id is null then
    customer_wallet_id := public.ensure_wallet_account(
      'customer', 'user', order_record.customer_user_id,
      order_record.currency_code, 'lpg.wallet_engine',
      '{"wallet_purpose":"lpg_refund"}'::jsonb,
      target_idempotency_key || ':customer-wallet'
    );
  end if;

  if underfill_refund_amount > 0 then
    refund_transaction_id := public.return_escrow_hold_amount(
      order_record.escrow_hold_id,
      customer_wallet_id,
      underfill_refund_amount,
      target_idempotency_key || ':underfill-refund',
      'lpg.refund_engine',
      target_metadata || jsonb_build_object(
        'refund_reason', 'lpg.underfill',
        'station_principal_refund', station_underfill_refund,
        'platform_markup_refund', markup_underfill_refund,
        'financial_policy_snapshot', order_record.financial_policy_snapshot
      )
    );

    insert into public.lpg_order_financial_adjustments (
      lpg_order_id, adjustment_type, currency_code, amount, transaction_id,
      status, reason_key, metadata, source, idempotency_key
    ) values (
      order_record.id, 'underfill_refund', order_record.currency_code,
      underfill_refund_amount, refund_transaction_id, 'posted',
      'lpg.underfill.automatic',
      target_metadata || jsonb_build_object(
        'station_principal_refund', station_underfill_refund,
        'platform_markup_refund', markup_underfill_refund,
        'markup_policy_version_id', markup_policy ->> 'policyVersionId'
      ),
      'lpg.refund_engine', target_idempotency_key || ':underfill-adjustment'
    ) on conflict (source, idempotency_key) do nothing;
  end if;

  if actual_station_amount > 0 then
    distribution := distribution || jsonb_build_array(jsonb_build_object(
      'wallet_id', station_wallet_id,
      'amount', actual_station_amount,
      'entry_type', 'principal',
      'metadata', jsonb_build_object('role', 'station_lpg_principal')
    ));
  end if;

  if platform_release_amount > 0 then
    distribution := distribution || jsonb_build_array(jsonb_build_object(
      'wallet_id', platform_wallet_id,
      'amount', platform_release_amount,
      'entry_type', 'fee',
      'metadata', jsonb_build_object(
        'role', 'platform',
        'platform_markup_amount', actual_platform_markup,
        'tax_amount', tax_amount,
        'delivery_margin_amount', delivery_margin_amount,
        'markup_policy_version_id', markup_policy ->> 'policyVersionId'
      )
    ));
  end if;

  if jsonb_array_length(distribution) = 0 then
    raise exception 'station settlement distribution cannot be empty';
  end if;

  settlement_execution_id := public.execute_service_request_settlement(
    order_record.service_request_id,
    order_record.escrow_hold_id,
    distribution,
    target_idempotency_key || ':settlement',
    'lpg.settlement_engine',
    target_metadata || jsonb_build_object(
      'lpg_order_id', order_record.id,
      'policy_snapshot', settlement_policy,
      'financial_policy_snapshot', order_record.financial_policy_snapshot
    )
  );

  insert into public.settlement_statements (
    organization_id, service_request_id, order_id, escrow_hold_id,
    settlement_execution_id, currency_code, gross_amount, platform_fee_amount,
    net_amount, status, period_start, period_end, source, idempotency_key,
    metadata, created_by
  ) values (
    station_record.organization_id, order_record.service_request_id, order_record_id,
    order_record.escrow_hold_id, settlement_execution_id, order_record.currency_code,
    actual_station_amount, 0, actual_station_amount, 'posted',
    timezone('utc', now()), timezone('utc', now()), target_source,
    target_idempotency_key || ':statement',
    target_metadata || jsonb_build_object(
      'lpg_order_id', order_record.id,
      'financial_policy_snapshot', order_record.financial_policy_snapshot
    ),
    actor_user_id
  ) on conflict (source, idempotency_key) do nothing
  returning id into settlement_statement_id;

  if settlement_statement_id is null then
    select id into settlement_statement_id
    from public.settlement_statements
    where source = target_source and idempotency_key = target_idempotency_key || ':statement';
  end if;

  -- The generic projection records the accepted snapshot plus the governed
  -- quantity adjustment, never a newly-resolved policy.
  update public.order_records
  set subtotal_amount = actual_station_amount + quote_record.delivery_fee_amount,
      fee_amount = actual_platform_markup,
      tax_amount = tax_amount,
      total_amount = actual_station_amount + actual_platform_markup
        + quote_record.delivery_fee_amount + tax_amount,
      order_payload = order_payload || jsonb_build_object(
        'financial_policy_snapshot', order_record.financial_policy_snapshot,
        'accepted_quote_amounts', order_record.financial_policy_snapshot -> 'acceptedQuote',
        'fulfilled_financial_amounts', jsonb_build_object(
          'stationAmount', actual_station_amount,
          'platformMarkupAmount', actual_platform_markup,
          'deliveryFeeAmount', quote_record.delivery_fee_amount,
          'driverPayoutAmount', quote_record.driver_commission_amount,
          'taxAmount', tax_amount,
          'totalAmount', actual_station_amount + actual_platform_markup
            + quote_record.delivery_fee_amount + tax_amount
        )
      ),
      metadata = metadata || jsonb_build_object(
        'financial_policy_snapshot', order_record.financial_policy_snapshot,
        'underfill_adjustment_transaction_id', refund_transaction_id
      ),
      updated_at = timezone('utc', now())
  where id = order_record_id;

  update public.lpg_refill_orders
  set status = 'station_settled',
      station_settlement_execution_id = settlement_execution_id,
      station_settlement_statement_id = settlement_statement_id,
      underfill_refund_transaction_id = refund_transaction_id,
      updated_at = timezone('utc', now())
  where id = order_record.id;

  perform public.record_lpg_order_event(
    order_record.id, 'lpg.station.settled', order_record.status, 'station_settled',
    target_idempotency_key || ':event',
    target_metadata || jsonb_build_object(
      'settlement_execution_id', settlement_execution_id,
      'settlement_statement_id', settlement_statement_id,
      'underfill_refund_transaction_id', refund_transaction_id,
      'station_principal_refund', station_underfill_refund,
      'platform_markup_refund', markup_underfill_refund,
      'financial_policy_version_ids', jsonb_build_object(
        'settlement', settlement_policy ->> 'policyVersionId',
        'platformMarkup', markup_policy ->> 'policyVersionId'
      )
    )
  );

  return settlement_execution_id;
end;
$$;

-- A governed zero payout is a real execution decision and must be auditable even
-- though it produces no ledger movement. All positive payouts still release the
-- locked amount from escrow.
alter table public.commission_executions
drop constraint if exists commission_executions_amount_check;

alter table public.commission_executions
add constraint commission_executions_amount_check check (amount >= 0);

create or replace function public.execute_lpg_driver_commission(
  target_lpg_order_id uuid,
  target_idempotency_key text,
  target_driver_wallet_id uuid default null,
  target_actor_user_id uuid default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'lpg.driver_commission_api'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record public.lpg_refill_orders%rowtype;
  quote_record public.lpg_refill_quotes%rowtype;
  driver_record public.driver_profiles%rowtype;
  actor_user_id uuid;
  order_record_id uuid;
  driver_wallet_id uuid;
  payout_policy jsonb;
  payout_configuration jsonb;
  payout_amount numeric(28, 8);
  release_transaction_id uuid;
  commission_execution_id uuid;
  existing_execution public.commission_executions%rowtype;
begin
  if target_lpg_order_id is null
    or target_idempotency_key is null or btrim(target_idempotency_key) = ''
    or target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'LPG order, idempotency key, and valid metadata are required';
  end if;

  actor_user_id := coalesce(target_actor_user_id, auth.uid());

  select * into order_record
  from public.lpg_refill_orders
  where id = target_lpg_order_id
  for update;

  if not found then raise exception 'target_lpg_order_id must reference an LPG order'; end if;
  if order_record.driver_commission_execution_id is not null then
    return order_record.driver_commission_execution_id;
  end if;
  if order_record.status <> 'delivered' then
    raise exception 'driver payout requires verified LPG delivery';
  end if;
  if order_record.station_settlement_execution_id is null then
    raise exception 'station settlement must be posted before driver payout';
  end if;

  select * into quote_record
  from public.lpg_refill_quotes
  where id = order_record.lpg_refill_quote_id;

  if not found then raise exception 'accepted LPG quote is required for driver payout'; end if;

  select * into driver_record
  from public.driver_profiles
  where id = order_record.driver_profile_id;

  if not found then raise exception 'assigned LPG driver is required'; end if;

  if auth.role() = 'service_role' then
    if actor_user_id is not null
      and actor_user_id is distinct from driver_record.user_id
      and not exists (
        select 1 from public.lpg_station_branches station
        where station.id = order_record.station_branch_id
          and public.user_can_operate_lpg_station_branch(actor_user_id, station.id, 'lpg.orders.finance')
      ) then
      raise exception 'driver or branch finance actor is required for LPG payout execution';
    end if;
  elsif auth.uid() is distinct from driver_record.user_id
    and not public.can_operate_lpg_station_branch(order_record.station_branch_id, 'lpg.orders.finance')
    and not public.can_manage_lpg_operations() then
    raise exception 'driver or LPG finance permission is required';
  end if;

  payout_policy := order_record.financial_policy_snapshot -> 'driverPayout';
  payout_configuration := payout_policy -> 'configuration';
  payout_amount := order_record.driver_commission_amount;

  if payout_policy is null or jsonb_typeof(payout_policy) <> 'object'
    or payout_policy ->> 'policyVersionId' is null
    or payout_policy ->> 'currencyCode' <> order_record.currency_code
    or payout_configuration is null or jsonb_typeof(payout_configuration) <> 'object'
    or payout_amount is null or payout_amount < 0
    or payout_amount <> quote_record.driver_commission_amount then
    raise exception 'a currency-matched locked driver payout policy and amount are required';
  end if;

  if payout_amount = 0 and not (
    coalesce((payout_configuration ->> 'allow_zero_amount')::boolean, false)
    or coalesce((payout_configuration ->> 'explicit_zero_authorized')::boolean, false)
    or coalesce((payout_configuration ->> 'explicit_zero_development_configuration')::boolean, false)
  ) then
    raise exception 'zero driver payout must be explicitly authorized by the locked policy';
  end if;

  select * into existing_execution
  from public.commission_executions
  where source = target_source and idempotency_key = target_idempotency_key || ':payout';

  if found then
    if existing_execution.order_id is distinct from order_record.order_record_id
      or existing_execution.amount <> payout_amount
      or existing_execution.policy_snapshot <> payout_policy then
      raise exception 'target_idempotency_key has already been used with different driver payout details';
    end if;
    return existing_execution.id;
  end if;

  order_record_id := public.ensure_lpg_order_record(
    order_record.id,
    target_idempotency_key || ':order-record',
    'lpg.order_projection',
    target_metadata || jsonb_build_object('financial_policy_snapshot', order_record.financial_policy_snapshot)
  );

  driver_wallet_id := coalesce(
    target_driver_wallet_id,
    public.ensure_wallet_account(
      'driver', 'driver', order_record.driver_profile_id,
      order_record.currency_code, 'lpg.wallet_engine',
      jsonb_build_object('wallet_purpose', 'lpg_driver_payout'),
      target_idempotency_key || ':driver-wallet'
    )
  );

  if not exists (
    select 1 from public.wallet_accounts wallet
    where wallet.id = driver_wallet_id
      and wallet.wallet_type = 'driver'
      and wallet.owner_entity_type = 'driver'
      and wallet.owner_entity_id = order_record.driver_profile_id
      and wallet.currency_code = order_record.currency_code
      and wallet.status = 'active'
  ) then
    raise exception 'target_driver_wallet_id must be the assigned driver active currency wallet';
  end if;

  if payout_amount > 0 then
    release_transaction_id := public.release_escrow_hold(
      order_record.escrow_hold_id,
      jsonb_build_array(jsonb_build_object(
        'wallet_id', driver_wallet_id,
        'amount', payout_amount,
        'entry_type', 'commission',
        'metadata', jsonb_build_object('role', 'driver_payout')
      )),
      target_idempotency_key || ':release',
      target_source,
      target_metadata || jsonb_build_object(
        'financial_policy_snapshot', payout_policy,
        'lpg_order_id', order_record.id
      )
    );
  end if;

  insert into public.commission_executions (
    service_request_id, order_id, escrow_hold_id, driver_wallet_id,
    commission_policy_id, transaction_id, currency_code, amount, status,
    policy_snapshot, source, idempotency_key, metadata, created_by
  ) values (
    order_record.service_request_id, order_record_id, order_record.escrow_hold_id,
    driver_wallet_id, null, release_transaction_id, order_record.currency_code,
    payout_amount, 'posted', payout_policy, target_source,
    target_idempotency_key || ':payout',
    target_metadata || jsonb_build_object(
      'lpg_order_id', order_record.id,
      'zero_amount_execution', payout_amount = 0,
      'policy_version_id', payout_policy ->> 'policyVersionId'
    ),
    actor_user_id
  ) returning id into commission_execution_id;

  update public.lpg_refill_orders
  set driver_commission_execution_id = commission_execution_id,
      status = 'completed',
      updated_at = timezone('utc', now())
  where id = order_record.id;

  update public.order_records
  set status = 'completed',
      completed_at = timezone('utc', now()),
      metadata = metadata || jsonb_build_object(
        'driver_payout_policy_snapshot', payout_policy,
        'driver_payout_execution_id', commission_execution_id
      ),
      updated_at = timezone('utc', now())
  where id = order_record_id;

  update public.service_requests
  set status = 'settled', updated_at = timezone('utc', now())
  where id = order_record.service_request_id;

  perform public.record_lpg_order_event(
    order_record.id,
    'lpg.driver.commission_executed',
    order_record.status,
    'completed',
    target_idempotency_key || ':event',
    target_metadata || jsonb_build_object(
      'commission_execution_id', commission_execution_id,
      'payout_amount', payout_amount,
      'policy_version_id', payout_policy ->> 'policyVersionId',
      'zero_amount_execution', payout_amount = 0
    )
  );

  return commission_execution_id;
end;
$$;

-- Reusable settlement entry point: callers supply identities, never money. The
-- authoritative platform fee is read from the order's accepted policy snapshot.
create or replace function public.execute_order_business_settlement_from_snapshot(
  target_order_id uuid,
  target_escrow_hold_id uuid,
  target_business_wallet_id uuid,
  target_platform_fee_wallet_id uuid default null,
  target_source text default 'platform.settlement_engine',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record public.order_records%rowtype;
  settlement_snapshot jsonb;
  settlement_configuration jsonb;
  locked_platform_fee_amount numeric(28, 8);
  locked_gross_amount numeric(28, 8);
begin
  if target_order_id is null or target_escrow_hold_id is null or target_business_wallet_id is null
    or target_idempotency_key is null or btrim(target_idempotency_key) = ''
    or target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'order, escrow, business wallet, idempotency key, and valid metadata are required';
  end if;

  select * into order_record
  from public.order_records
  where id = target_order_id;

  if not found then raise exception 'target_order_id must reference an existing order'; end if;

  settlement_snapshot := coalesce(
    nullif(order_record.metadata -> 'financial_policy_snapshot' -> 'settlement', 'null'::jsonb),
    nullif(order_record.order_payload -> 'financial_policy_snapshot' -> 'settlement', 'null'::jsonb)
  );

  if settlement_snapshot is null or jsonb_typeof(settlement_snapshot) <> 'object'
    or coalesce(settlement_snapshot ->> 'policyVersionId', settlement_snapshot ->> 'policy_version_id') is null
    or coalesce(settlement_snapshot ->> 'currencyCode', settlement_snapshot ->> 'currency_code') <> order_record.currency_code then
    raise exception 'accepted order is missing a currency-matched locked settlement policy snapshot';
  end if;

  settlement_configuration := settlement_snapshot -> 'configuration';
  if settlement_configuration is null or jsonb_typeof(settlement_configuration) <> 'object' then
    raise exception 'locked settlement policy configuration is required';
  end if;

  locked_platform_fee_amount := coalesce(
    nullif(settlement_snapshot ->> 'lockedPlatformFeeAmount', '')::numeric,
    nullif(settlement_configuration ->> 'locked_platform_fee_amount', '')::numeric
  );
  locked_gross_amount := coalesce(
    nullif(settlement_snapshot ->> 'lockedGrossAmount', '')::numeric,
    nullif(settlement_configuration ->> 'locked_gross_amount', '')::numeric,
    order_record.total_amount
  );

  if locked_platform_fee_amount is null or locked_platform_fee_amount < 0 then
    raise exception 'locked settlement policy must define a non-negative platform fee amount';
  end if;

  if locked_gross_amount <> order_record.total_amount then
    raise exception 'order total does not match its locked settlement snapshot';
  end if;

  if locked_platform_fee_amount = 0 and not (
    coalesce((settlement_configuration ->> 'allow_zero_platform_fee')::boolean, false)
    or coalesce((settlement_configuration ->> 'explicit_zero_authorized')::boolean, false)
  ) then
    raise exception 'zero platform fee must be explicitly authorized by the locked settlement policy';
  end if;

  return public.execute_order_business_settlement(
    target_order_id,
    target_escrow_hold_id,
    target_business_wallet_id,
    target_platform_fee_wallet_id,
    locked_platform_fee_amount,
    target_source,
    target_idempotency_key,
    target_metadata || jsonb_build_object(
      'financial_policy_snapshot', settlement_snapshot,
      'policy_version_id', coalesce(
        settlement_snapshot ->> 'policyVersionId',
        settlement_snapshot ->> 'policy_version_id'
      )
    )
  );
end;
$$;

revoke all on function public.configure_lpg_refill_pricing(uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, timestamptz, timestamptz, jsonb, text) from public;
revoke all on function public.configure_lpg_station_catalog_price(uuid, uuid, numeric, timestamptz, text, timestamptz, jsonb, text) from public;
revoke all on function public.read_lpg_station_catalog_prices(uuid) from public;
revoke all on function public.create_lpg_refill_quote_from_commercial_snapshot(uuid, numeric, uuid, uuid, uuid, jsonb, text, timestamptz, text, jsonb, text) from public;
revoke all on function public.execute_order_business_settlement_from_snapshot(uuid, uuid, uuid, uuid, text, text, jsonb) from public;

grant execute on function public.configure_lpg_refill_pricing(uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, timestamptz, timestamptz, jsonb, text) to authenticated, service_role;
grant execute on function public.configure_lpg_station_catalog_price(uuid, uuid, numeric, timestamptz, text, timestamptz, jsonb, text) to authenticated, service_role;
grant execute on function public.read_lpg_station_catalog_prices(uuid) to authenticated, service_role;
grant execute on function public.create_lpg_refill_quote_from_commercial_snapshot(uuid, numeric, uuid, uuid, uuid, jsonb, text, timestamptz, text, jsonb, text) to authenticated, service_role;
grant execute on function public.execute_order_business_settlement_from_snapshot(uuid, uuid, uuid, uuid, text, text, jsonb) to authenticated, service_role;

commit;
