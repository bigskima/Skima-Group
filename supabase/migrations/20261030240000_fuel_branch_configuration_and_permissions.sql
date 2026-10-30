begin;

-- Keep platform read and manage permissions distinct.
create or replace function public.can_read_fuel_platform()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or public.is_platform_super_admin()
    or public.has_permission('platform.fuel.read', null)
    or public.has_permission('platform.fuel.manage', null);
$$;

create or replace function public.can_read_fuel_branch(target_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or public.can_read_fuel_platform()
    or exists (
      select 1
      from public.organization_branches branch_record
      where branch_record.id = target_branch_id
        and (
          public.is_organization_member(branch_record.organization_id)
          or public.has_permission('business.fuel.inventory.read', branch_record.organization_id)
          or public.has_permission('business.fuel.inventory.manage', branch_record.organization_id)
          or public.has_permission('business.catalog.read', branch_record.organization_id)
        )
    );
$$;

create or replace function public.can_manage_fuel_branch(target_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or public.can_manage_fuel_platform()
    or exists (
      select 1
      from public.organization_branches branch_record
      where branch_record.id = target_branch_id
        and (
          public.has_permission('business.fuel.inventory.manage', branch_record.organization_id)
          or public.has_permission('business.fuel.orders.manage', branch_record.organization_id)
          or public.has_permission('business.catalog.manage', branch_record.organization_id)
        )
    );
$$;

create or replace function public.can_read_fuel_order(target_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or public.can_read_fuel_platform()
    or exists (
      select 1
      from public.order_records order_record
      where order_record.id = target_order_id
        and (
          order_record.requester_user_id = auth.uid()
          or public.can_read_business_order(order_record.organization_id, order_record.branch_id)
          or public.has_permission_for_branch('business.fuel.orders.read', order_record.organization_id, order_record.branch_id)
          or public.has_permission_for_branch('business.fuel.orders.process', order_record.organization_id, order_record.branch_id)
          or public.has_permission_for_branch('business.fuel.orders.manage', order_record.organization_id, order_record.branch_id)
        )
    );
$$;

drop policy if exists fuel_products_read_enabled_or_admin on public.fuel_products;
create policy fuel_products_read_enabled_or_admin
on public.fuel_products for select to authenticated
using (status = 'enabled' or public.can_read_fuel_platform());

drop policy if exists fuel_product_events_admin_read on public.fuel_product_events;
create policy fuel_product_events_admin_read
on public.fuel_product_events for select to authenticated
using (public.can_read_fuel_platform());

drop policy if exists fuel_container_types_read_active_or_admin on public.fuel_container_types;
create policy fuel_container_types_read_active_or_admin
on public.fuel_container_types for select to authenticated
using (status = 'active' or public.can_read_fuel_platform());

drop policy if exists fuel_container_profiles_read_accessible on public.fuel_container_profiles;
create policy fuel_container_profiles_read_accessible
on public.fuel_container_profiles for select to authenticated
using (
  public.can_read_fuel_platform()
  or exists (
    select 1
    from public.assets asset_record
    where asset_record.id = asset_id
      and (
        asset_record.owner_user_id = auth.uid()
        or (asset_record.organization_id is not null and public.is_organization_member(asset_record.organization_id))
      )
  )
  or exists (
    select 1
    from public.fuel_container_allocations allocation
    where allocation.container_profile_id = id
      and public.can_read_fuel_order(allocation.order_id)
  )
);

drop policy if exists fuel_order_commercial_snapshots_read_order on public.fuel_order_commercial_snapshots;
create policy fuel_order_commercial_snapshots_read_order
on public.fuel_order_commercial_snapshots for select to authenticated
using (
  exists (
    select 1
    from public.service_requests request_record
    where request_record.id = service_request_id
      and request_record.requester_user_id = auth.uid()
  )
  or (order_id is not null and public.can_read_fuel_order(order_id))
);

-- Existing station roles gain fuel-specific rights without a new onboarding tree.
insert into public.role_permissions (role_id, permission_id)
select role_record.id, permission_record.id
from public.roles role_record
join public.permissions permission_record
  on permission_record.key in (
    'business.fuel.orders.read',
    'business.fuel.orders.process',
    'business.fuel.orders.manage',
    'business.fuel.inventory.read',
    'business.fuel.inventory.manage',
    'business.fuel.containers.read',
    'business.fuel.containers.manage'
  )
where role_record.key in ('business.owner', 'lpg.station.owner', 'lpg.station.admin', 'lpg.station.operations')
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role_record.id, permission_record.id
from public.roles role_record
join public.permissions permission_record
  on permission_record.key in (
    'business.fuel.orders.read',
    'business.fuel.orders.process',
    'business.fuel.inventory.read',
    'business.fuel.containers.read'
  )
where role_record.key = 'lpg.station.pump'
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role_record.id, permission_record.id
from public.roles role_record
join public.permissions permission_record
  on permission_record.key in (
    'business.fuel.orders.read',
    'business.fuel.inventory.read',
    'business.fuel.containers.read'
  )
where role_record.key in ('lpg.station.scanner', 'lpg.station.viewer', 'lpg.station.finance')
on conflict (role_id, permission_id) do nothing;

create table if not exists public.fuel_branch_product_offers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.organization_branches(id) on delete cascade,
  product_key text not null references public.fuel_products(key) on update cascade on delete restrict,
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  catalog_item_id uuid not null references public.catalog_items(id) on delete restrict,
  catalog_variant_id uuid not null references public.catalog_item_variants(id) on delete restrict,
  price_per_litre numeric(20,8) not null check (price_per_litre > 0),
  minimum_litres numeric(16,3) not null default 1 check (minimum_litres > 0),
  maximum_litres numeric(16,3) not null check (maximum_litres >= minimum_litres),
  container_purchase_amount numeric(20,8) not null default 0 check (container_purchase_amount >= 0),
  container_rental_amount numeric(20,8) not null default 0 check (container_rental_amount >= 0),
  refundable_deposit_amount numeric(20,8) not null default 0 check (refundable_deposit_amount >= 0),
  driver_delivery_fee_amount numeric(20,8) not null default 0 check (driver_delivery_fee_amount >= 0),
  platform_fee_amount numeric(20,8) not null default 0 check (platform_fee_amount >= 0),
  tax_rate_percent numeric(8,4) not null default 0 check (tax_rate_percent between 0 and 100),
  fulfillment_modes text[] not null default array['station_managed','independent_driver','skima_managed']::text[]
    check (
      cardinality(fulfillment_modes) > 0
      and fulfillment_modes <@ array['station_managed','independent_driver','skima_managed']::text[]
    ),
  status text not null default 'draft'
    check (status in ('draft','active','paused','retired')),
  effective_from timestamptz not null default timezone('utc',now()),
  effective_until timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  unique (branch_id,product_key,currency_code),
  check (effective_until is null or effective_until > effective_from),
  check (container_purchase_amount = 0 or container_rental_amount = 0 or container_purchase_amount >= 0)
);

create table if not exists public.fuel_branch_product_offer_events (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.fuel_branch_product_offers(id) on delete restrict,
  branch_id uuid not null references public.organization_branches(id) on delete restrict,
  product_key text not null references public.fuel_products(key) on update cascade on delete restrict,
  event_key text not null check (event_key in ('created','updated','paused','activated','retired')),
  before_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(before_snapshot)='object'),
  after_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(after_snapshot)='object'),
  actor_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  idempotency_key text not null unique,
  created_at timestamptz not null default timezone('utc',now())
);

create index if not exists fuel_branch_product_offers_branch_status_idx
on public.fuel_branch_product_offers(branch_id,status,product_key,currency_code);

create unique index if not exists fuel_catalog_availability_one_active_rule
on public.catalog_availability_rules(
  branch_id,
  item_id,
  coalesce(variant_id,'00000000-0000-0000-0000-000000000000'::uuid)
)
where metadata ->> 'module_key' = 'fuel' and status = 'active';

create or replace function public.configure_fuel_branch_product_offer(
  target_branch_id uuid,
  target_product_key text,
  target_currency_code text,
  target_price_per_litre numeric,
  target_minimum_litres numeric,
  target_maximum_litres numeric,
  target_container_purchase_amount numeric default 0,
  target_container_rental_amount numeric default 0,
  target_refundable_deposit_amount numeric default 0,
  target_driver_delivery_fee_amount numeric default 0,
  target_platform_fee_amount numeric default 0,
  target_tax_rate_percent numeric default 0,
  target_fulfillment_modes text[] default array['station_managed','independent_driver','skima_managed']::text[],
  target_status text default 'draft',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  branch_record public.organization_branches%rowtype;
  product_record public.fuel_products%rowtype;
  module_id_value uuid;
  category_id_value uuid;
  unit_id_value uuid;
  item_id_value uuid;
  variant_id_value uuid;
  price_id_value uuid;
  availability_id_value uuid;
  offer_record public.fuel_branch_product_offers%rowtype;
  existing_event public.fuel_branch_product_offer_events%rowtype;
  before_value jsonb := '{}'::jsonb;
  after_value jsonb;
  resolved_status text;
begin
  if auth.role() <> 'service_role'
     and not public.can_manage_fuel_branch(target_branch_id) then
    raise exception using errcode='42501',message='branch fuel management permission is required';
  end if;

  if target_branch_id is null
     or target_product_key not in ('fuel.pms','fuel.ago','fuel.dpk')
     or target_currency_code is null
     or target_price_per_litre is null or target_price_per_litre <= 0
     or target_minimum_litres is null or target_minimum_litres <= 0
     or target_maximum_litres is null or target_maximum_litres < target_minimum_litres
     or coalesce(target_container_purchase_amount,0) < 0
     or coalesce(target_container_rental_amount,0) < 0
     or coalesce(target_refundable_deposit_amount,0) < 0
     or coalesce(target_driver_delivery_fee_amount,0) < 0
     or coalesce(target_platform_fee_amount,0) < 0
     or coalesce(target_tax_rate_percent,0) < 0 or target_tax_rate_percent > 100
     or target_status is null or target_status not in ('draft','active','paused','retired')
     or coalesce(array_length(target_fulfillment_modes,1),0)=0
     or not (target_fulfillment_modes <@ array['station_managed','independent_driver','skima_managed']::text[])
     or coalesce(btrim(target_idempotency_key),'')=''
     or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='valid branch, fuel product, currency, price, litre range, charges, fulfillment modes, status and idempotency key are required';
  end if;

  select * into existing_event
  from public.fuel_branch_product_offer_events
  where idempotency_key=target_idempotency_key;

  if found then
    if existing_event.branch_id<>target_branch_id or existing_event.product_key<>target_product_key then
      raise exception using errcode='23505',message='fuel offer idempotency key was reused for another branch or product';
    end if;
    return existing_event.offer_id;
  end if;

  select * into branch_record
  from public.organization_branches
  where id=target_branch_id and status='active';

  if not found then
    raise exception using errcode='23514',message='fuel offer requires an active organization branch';
  end if;

  select * into product_record
  from public.fuel_products
  where key=target_product_key and status<>'retired';

  if not found then
    raise exception using errcode='23514',message='fuel product is missing or retired';
  end if;

  if not exists (
    select 1 from public.currency_definitions currency
    where currency.code=target_currency_code and currency.status='enabled'
  ) then
    raise exception using errcode='23514',message='fuel offer currency must be enabled';
  end if;

  select id into module_id_value from public.business_modules where key='fuel' and status='active';
  if module_id_value is null then
    raise exception using errcode='55000',message='Fuel business module is not active';
  end if;

  select * into offer_record
  from public.fuel_branch_product_offers
  where branch_id=target_branch_id and product_key=target_product_key and currency_code=target_currency_code
  for update;

  if found then
    before_value:=to_jsonb(offer_record);
  end if;

  insert into public.catalog_units(
    organization_id,key,display_name,unit_kind,symbol,decimal_precision,status,source,idempotency_key,metadata
  )
  values(
    branch_record.organization_id,'unit.litre','Litre','volume','L',2,'active',
    'platform.fuel_catalog','fuel:unit:litre:'||branch_record.organization_id::text,
    jsonb_build_object('canonical_unit','litre','symbol','L','module_key','fuel')
  )
  on conflict(organization_id,key) do update
  set display_name=excluded.display_name,unit_kind=excluded.unit_kind,symbol=excluded.symbol,
      decimal_precision=excluded.decimal_precision,status='active',
      metadata=public.catalog_units.metadata||excluded.metadata,updated_at=timezone('utc',now())
  returning id into unit_id_value;

  insert into public.catalog_categories(
    organization_id,module_id,key,display_name,description,category_type,status,source,idempotency_key,metadata
  )
  values(
    branch_record.organization_id,module_id_value,'category.fuel','Liquid Fuels',
    'Petrol, diesel and kerosene sold by the litre.','product','active',
    'platform.fuel_catalog','fuel:category:'||branch_record.organization_id::text,
    jsonb_build_object('module_key','fuel')
  )
  on conflict(organization_id,key) do update
  set module_id=excluded.module_id,display_name=excluded.display_name,description=excluded.description,
      category_type='product',status='active',metadata=public.catalog_categories.metadata||excluded.metadata,
      updated_at=timezone('utc',now())
  returning id into category_id_value;

  insert into public.catalog_items(
    organization_id,branch_id,module_id,category_id,key,item_type,display_name,description,
    fulfillment_methods,min_quantity,max_quantity,status,source,idempotency_key,metadata
  )
  values(
    branch_record.organization_id,null,module_id_value,category_id_value,target_product_key,'product',
    product_record.display_name,
    product_record.display_name||' sold by the litre.',
    array['fuel_delivery'],0.001,null,
    'active','platform.fuel_catalog',
    'fuel:item:'||branch_record.organization_id::text||':'||target_product_key,
    jsonb_build_object('module_key','fuel','product_key',target_product_key,'unit','L')
  )
  on conflict(organization_id,key) do update
  set module_id=excluded.module_id,category_id=excluded.category_id,
      item_type='product',display_name=excluded.display_name,description=excluded.description,
      fulfillment_methods=excluded.fulfillment_methods,min_quantity=0.001,
      max_quantity=null,status='active',
      metadata=public.catalog_items.metadata||excluded.metadata,updated_at=timezone('utc',now())
  where public.catalog_items.module_id is null or public.catalog_items.module_id=module_id_value
  returning id into item_id_value;

  if item_id_value is null then
    raise exception using errcode='23514',message='catalog item key is already owned by another business module';
  end if;

  insert into public.catalog_item_variants(
    organization_id,branch_id,item_id,unit_id,key,display_name,quantity_value,status,source,idempotency_key,metadata
  )
  values(
    branch_record.organization_id,null,item_id_value,unit_id_value,'unit.litre','Per Litre',1,
    'active','platform.fuel_catalog',
    'fuel:variant:'||branch_record.organization_id::text||':'||target_product_key,
    jsonb_build_object('module_key','fuel','product_key',target_product_key,'unit','L')
  )
  on conflict(item_id,key) do update
  set unit_id=excluded.unit_id,display_name=excluded.display_name,quantity_value=1,status='active',
      metadata=public.catalog_item_variants.metadata||excluded.metadata,updated_at=timezone('utc',now())
  returning id into variant_id_value;

  update public.catalog_prices
  set status='retired',updated_at=timezone('utc',now())
  where item_id=item_id_value and variant_id=variant_id_value
    and branch_id=target_branch_id and currency_code=target_currency_code
    and status='active';

  select id into price_id_value
  from public.catalog_prices
  where source='platform.fuel_catalog' and idempotency_key=target_idempotency_key||':price';

  if price_id_value is null then
    insert into public.catalog_prices(
      organization_id,branch_id,item_id,variant_id,pricing_policy_id,currency_code,amount,
      tax_behavior,status,effective_from,source,idempotency_key,metadata
    )
    values(
      branch_record.organization_id,target_branch_id,item_id_value,variant_id_value,
      (select id from public.pricing_policies where key='pricing.fuel.commercial-snapshot.v1' and status='active' order by version desc limit 1),
      target_currency_code,target_price_per_litre,'exclusive','active',timezone('utc',now()),
      'platform.fuel_catalog',target_idempotency_key||':price',
      jsonb_build_object('module_key','fuel','product_key',target_product_key,'unit','L')
    )
    returning id into price_id_value;
  end if;

  select id into availability_id_value
  from public.catalog_availability_rules
  where branch_id=target_branch_id and item_id=item_id_value and variant_id=variant_id_value
    and metadata->>'module_key'='fuel' and status='active'
  order by created_at desc
  limit 1
  for update;

  resolved_status:=case when target_status='active' then 'available' else 'temporarily_paused' end;

  if availability_id_value is null then
    insert into public.catalog_availability_rules(
      organization_id,branch_id,item_id,variant_id,availability_status,schedule,
      stock_quantity,reserved_quantity,capacity_limit,capacity_used,status,source,idempotency_key,metadata
    )
    values(
      branch_record.organization_id,target_branch_id,item_id_value,variant_id_value,resolved_status,'{}'::jsonb,
      null,0,null,0,'active','platform.fuel_catalog',target_idempotency_key||':availability',
      jsonb_build_object('module_key','fuel','product_key',target_product_key)
    )
    returning id into availability_id_value;
  else
    update public.catalog_availability_rules
    set availability_status=resolved_status,updated_at=timezone('utc',now()),
        metadata=metadata||jsonb_build_object('module_key','fuel','product_key',target_product_key)
    where id=availability_id_value;
  end if;

  insert into public.fuel_branch_product_offers(
    organization_id,branch_id,product_key,currency_code,catalog_item_id,catalog_variant_id,
    price_per_litre,minimum_litres,maximum_litres,container_purchase_amount,container_rental_amount,
    refundable_deposit_amount,driver_delivery_fee_amount,platform_fee_amount,tax_rate_percent,
    fulfillment_modes,status,effective_from,effective_until,metadata,created_by,updated_by
  )
  values(
    branch_record.organization_id,target_branch_id,target_product_key,target_currency_code,item_id_value,variant_id_value,
    target_price_per_litre,target_minimum_litres,target_maximum_litres,target_container_purchase_amount,
    target_container_rental_amount,target_refundable_deposit_amount,target_driver_delivery_fee_amount,
    target_platform_fee_amount,target_tax_rate_percent,target_fulfillment_modes,target_status,
    timezone('utc',now()),null,target_metadata,auth.uid(),auth.uid()
  )
  on conflict(branch_id,product_key,currency_code) do update
  set catalog_item_id=excluded.catalog_item_id,catalog_variant_id=excluded.catalog_variant_id,
      price_per_litre=excluded.price_per_litre,minimum_litres=excluded.minimum_litres,
      maximum_litres=excluded.maximum_litres,container_purchase_amount=excluded.container_purchase_amount,
      container_rental_amount=excluded.container_rental_amount,refundable_deposit_amount=excluded.refundable_deposit_amount,
      driver_delivery_fee_amount=excluded.driver_delivery_fee_amount,platform_fee_amount=excluded.platform_fee_amount,
      tax_rate_percent=excluded.tax_rate_percent,fulfillment_modes=excluded.fulfillment_modes,
      status=excluded.status,effective_from=excluded.effective_from,effective_until=excluded.effective_until,
      metadata=public.fuel_branch_product_offers.metadata||excluded.metadata,
      updated_by=auth.uid(),updated_at=timezone('utc',now())
  returning * into offer_record;

  insert into public.fuel_branch_product_offer_events(
    offer_id,branch_id,product_key,event_key,before_snapshot,after_snapshot,idempotency_key
  )
  values(
    offer_record.id,target_branch_id,target_product_key,
    case when before_value='{}'::jsonb then 'created'
         when target_status='retired' then 'retired'
         when target_status='paused' then 'paused'
         when target_status='active' then 'activated'
         else 'updated' end,
    before_value,to_jsonb(offer_record),target_idempotency_key
  );

  return offer_record.id;
end;
$$;

create table if not exists public.fuel_station_storage_configuration_events (
  id uuid primary key default gen_random_uuid(),
  storage_unit_id uuid not null references public.fuel_station_storage_units(id) on delete restrict,
  branch_id uuid not null references public.organization_branches(id) on delete restrict,
  product_key text not null references public.fuel_products(key) on update cascade on delete restrict,
  event_key text not null check (event_key in ('created','updated','paused','activated','maintenance','retired')),
  before_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(before_snapshot)='object'),
  after_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(after_snapshot)='object'),
  actor_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  idempotency_key text not null unique,
  created_at timestamptz not null default timezone('utc',now())
);

create or replace function public.configure_fuel_station_storage_unit(
  target_organization_id uuid,
  target_branch_id uuid,
  target_product_key text,
  target_storage_key text,
  target_display_name text,
  target_capacity_litres numeric,
  target_safety_reserve_litres numeric default 0,
  target_status text default 'active',
  target_metadata jsonb default '{}'::jsonb,
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  branch_record public.organization_branches%rowtype;
  storage_record public.fuel_station_storage_units%rowtype;
  product_record public.fuel_products%rowtype;
  existing_event public.fuel_station_storage_configuration_events%rowtype;
  before_value jsonb := '{}'::jsonb;
  storage_id uuid;
begin
  if auth.role()<>'service_role' and not public.can_manage_fuel_branch(target_branch_id) then
    raise exception using errcode='42501',message='fuel storage management permission is required for this branch';
  end if;

  if target_organization_id is null or target_branch_id is null
     or target_product_key not in ('fuel.pms','fuel.ago','fuel.dpk')
     or coalesce(btrim(target_storage_key),'')='' or coalesce(btrim(target_display_name),'')=''
     or target_capacity_litres is null or target_capacity_litres<=0
     or coalesce(target_safety_reserve_litres,0)<0
     or target_safety_reserve_litres>target_capacity_litres
     or target_status is null or target_status not in ('active','paused','maintenance','retired')
     or coalesce(btrim(target_idempotency_key),'')=''
     or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='valid organization, branch, fuel product, storage identity, capacity, safety reserve, status and idempotency key are required';
  end if;

  select * into existing_event
  from public.fuel_station_storage_configuration_events
  where idempotency_key=target_idempotency_key;

  if found then
    return existing_event.storage_unit_id;
  end if;

  select * into branch_record
  from public.organization_branches
  where id=target_branch_id and organization_id=target_organization_id and status='active';

  if not found then
    raise exception using errcode='23514',message='storage branch must be active and belong to the supplied organization';
  end if;

  select * into product_record
  from public.fuel_products
  where key=target_product_key and status<>'retired';

  if not found then
    raise exception using errcode='23514',message='fuel storage product is missing or retired';
  end if;

  select * into storage_record
  from public.fuel_station_storage_units
  where branch_id=target_branch_id and key=target_storage_key
  for update;

  if found then
    before_value:=to_jsonb(storage_record);
    if storage_record.product_key<>target_product_key then
      raise exception using errcode='23514',message='a storage unit cannot be reassigned to another fuel product';
    end if;
    if target_capacity_litres<storage_record.physical_stock_litres
       or target_capacity_litres<storage_record.reserved_stock_litres+target_safety_reserve_litres then
      raise exception using errcode='23514',message='new capacity must preserve all physical stock, reservations and safety reserve';
    end if;

    update public.fuel_station_storage_units
    set display_name=btrim(target_display_name),
        capacity_litres=target_capacity_litres,
        safety_reserve_litres=target_safety_reserve_litres,
        status=target_status,
        metadata=metadata||target_metadata,
        updated_by=auth.uid(),
        updated_at=timezone('utc',now())
    where id=storage_record.id
    returning id into storage_id;
  else
    insert into public.fuel_station_storage_units(
      organization_id,branch_id,product_key,key,display_name,capacity_litres,
      safety_reserve_litres,physical_stock_litres,reserved_stock_litres,status,metadata,created_by,updated_by
    )
    values(
      target_organization_id,target_branch_id,target_product_key,target_storage_key,btrim(target_display_name),
      target_capacity_litres,target_safety_reserve_litres,0,0,target_status,target_metadata,auth.uid(),auth.uid()
    )
    returning id into storage_id;
  end if;

  select * into storage_record from public.fuel_station_storage_units where id=storage_id;

  insert into public.fuel_station_storage_configuration_events(
    storage_unit_id,branch_id,product_key,event_key,before_snapshot,after_snapshot,idempotency_key
  )
  values(
    storage_id,target_branch_id,target_product_key,
    case when before_value='{}'::jsonb then 'created'
         when target_status='retired' then 'retired'
         when target_status='paused' then 'paused'
         when target_status='maintenance' then 'maintenance'
         when target_status='active' then 'activated'
         else 'updated' end,
    before_value,to_jsonb(storage_record),target_idempotency_key
  );

  return storage_id;
end;
$$;

create table if not exists public.fuel_container_type_events (
  id uuid primary key default gen_random_uuid(),
  container_type_id uuid not null references public.fuel_container_types(id) on delete restrict,
  event_key text not null check (event_key in ('created','updated','activated','paused','retired')),
  before_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(before_snapshot)='object'),
  after_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(after_snapshot)='object'),
  actor_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  idempotency_key text not null unique,
  created_at timestamptz not null default timezone('utc',now())
);

create or replace function public.configure_fuel_container_type(
  target_key text,
  target_display_name text,
  target_nominal_capacity_litres numeric,
  target_supported_product_keys text[],
  target_status text default 'draft',
  target_metadata jsonb default '{}'::jsonb,
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  type_record public.fuel_container_types%rowtype;
  existing_event public.fuel_container_type_events%rowtype;
  before_value jsonb := '{}'::jsonb;
  type_id uuid;
  event_name text;
begin
  if auth.role()<>'service_role' and not public.can_manage_fuel_platform() then
    raise exception using errcode='42501',message='platform fuel management permission is required';
  end if;

  if coalesce(btrim(target_key),'')='' or coalesce(btrim(target_display_name),'')=''
     or target_nominal_capacity_litres is null or target_nominal_capacity_litres<=0
     or coalesce(array_length(target_supported_product_keys,1),0)=0
     or not (target_supported_product_keys <@ array['fuel.pms','fuel.ago','fuel.dpk']::text[])
     or target_status is null or target_status not in ('draft','active','paused','retired')
     or target_metadata is null or jsonb_typeof(target_metadata)<>'object'
     or coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='container type key, name, positive litre capacity, supported products, status and idempotency key are required';
  end if;

  select * into existing_event
  from public.fuel_container_type_events
  where idempotency_key=target_idempotency_key;

  if found then
    if not exists(select 1 from public.fuel_container_types where id=existing_event.container_type_id and key=target_key) then
      raise exception using errcode='23505',message='container type idempotency key was reused for another type';
    end if;
    return existing_event.container_type_id;
  end if;

  select * into type_record
  from public.fuel_container_types
  where key=target_key
  for update;

  if found then
    before_value:=to_jsonb(type_record);
    if exists(
      select 1 from public.fuel_container_profiles profile
      where profile.container_type_id=type_record.id
        and profile.capacity_litres>target_nominal_capacity_litres
    ) then
      raise exception using errcode='23514',message='container type capacity cannot be reduced below an existing registered container capacity';
    end if;
  end if;

  insert into public.fuel_container_types(
    key,display_name,nominal_capacity_litres,supported_product_keys,status,metadata,created_by,updated_by
  )
  values(
    target_key,btrim(target_display_name),target_nominal_capacity_litres,target_supported_product_keys,
    target_status,target_metadata,auth.uid(),auth.uid()
  )
  on conflict(key) do update
  set display_name=excluded.display_name,
      nominal_capacity_litres=excluded.nominal_capacity_litres,
      supported_product_keys=excluded.supported_product_keys,
      status=excluded.status,
      metadata=public.fuel_container_types.metadata||excluded.metadata,
      updated_by=auth.uid(),
      updated_at=timezone('utc',now())
  returning * into type_record;

  type_id:=type_record.id;
  event_name:=case when before_value='{}'::jsonb then 'created'
                   when target_status='retired' then 'retired'
                   when target_status='paused' then 'paused'
                   when target_status='active' then 'activated'
                   else 'updated' end;

  insert into public.fuel_container_type_events(
    container_type_id,event_key,before_snapshot,after_snapshot,idempotency_key
  )
  values(type_id,event_name,before_value,to_jsonb(type_record),target_idempotency_key);

  return type_id;
end;
$$;

alter table public.fuel_container_type_events enable row level security;
alter table public.fuel_branch_product_offers enable row level security;
alter table public.fuel_branch_product_offer_events enable row level security;
alter table public.fuel_station_storage_configuration_events enable row level security;

drop policy if exists fuel_container_type_events_platform_read on public.fuel_container_type_events;
create policy fuel_container_type_events_platform_read
on public.fuel_container_type_events for select to authenticated
using (public.can_read_fuel_platform());

drop policy if exists fuel_branch_product_offers_read_branch on public.fuel_branch_product_offers;
create policy fuel_branch_product_offers_read_branch
on public.fuel_branch_product_offers for select to authenticated
using (
  public.can_read_fuel_branch(branch_id)
  or (status='active' and exists(
    select 1 from public.fuel_products product
    where product.key=product_key and product.status='enabled'
  ))
);

drop policy if exists fuel_branch_product_offer_events_read_branch on public.fuel_branch_product_offer_events;
create policy fuel_branch_product_offer_events_read_branch
on public.fuel_branch_product_offer_events for select to authenticated
using (public.can_read_fuel_branch(branch_id));

drop policy if exists fuel_station_storage_configuration_events_read_branch on public.fuel_station_storage_configuration_events;
create policy fuel_station_storage_configuration_events_read_branch
on public.fuel_station_storage_configuration_events for select to authenticated
using (public.can_read_fuel_branch(branch_id));

grant select on public.fuel_container_type_events to authenticated,service_role;

grant select on
  public.fuel_branch_product_offers,
  public.fuel_branch_product_offer_events,
  public.fuel_station_storage_configuration_events
to authenticated,service_role;

drop trigger if exists fuel_branch_product_offers_set_updated_at on public.fuel_branch_product_offers;
create trigger fuel_branch_product_offers_set_updated_at
before update on public.fuel_branch_product_offers
for each row execute function public.set_updated_at();

drop trigger if exists fuel_branch_product_offers_audit on public.fuel_branch_product_offers;
create trigger fuel_branch_product_offers_audit
after insert or update or delete on public.fuel_branch_product_offers
for each row execute function public.record_table_audit();

drop trigger if exists fuel_container_type_events_immutable on public.fuel_container_type_events;
create trigger fuel_container_type_events_immutable
before update or delete on public.fuel_container_type_events
for each row execute function public.prevent_fuel_event_mutation();

drop trigger if exists fuel_branch_product_offer_events_immutable on public.fuel_branch_product_offer_events;
create trigger fuel_branch_product_offer_events_immutable
before update or delete on public.fuel_branch_product_offer_events
for each row execute function public.prevent_fuel_event_mutation();

drop trigger if exists fuel_station_storage_configuration_events_immutable on public.fuel_station_storage_configuration_events;
create trigger fuel_station_storage_configuration_events_immutable
before update or delete on public.fuel_station_storage_configuration_events
for each row execute function public.prevent_fuel_event_mutation();

revoke all on function public.can_read_fuel_platform() from public,anon;
revoke all on function public.can_read_fuel_branch(uuid) from public,anon;
revoke all on function public.can_manage_fuel_branch(uuid) from public,anon;
revoke all on function public.can_read_fuel_order(uuid) from public,anon;
revoke all on function public.configure_fuel_branch_product_offer(uuid,text,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text[],text,text,jsonb) from public,anon;
revoke all on function public.configure_fuel_station_storage_unit(uuid,uuid,text,text,text,numeric,numeric,text,jsonb,text) from public,anon;
revoke all on function public.configure_fuel_container_type(text,text,numeric,text[],text,jsonb,text) from public,anon;

grant execute on function public.can_read_fuel_platform() to authenticated,service_role;
grant execute on function public.can_read_fuel_branch(uuid) to authenticated,service_role;
grant execute on function public.can_manage_fuel_branch(uuid) to authenticated,service_role;
grant execute on function public.can_read_fuel_order(uuid) to authenticated,service_role;
grant execute on function public.configure_fuel_branch_product_offer(uuid,text,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text[],text,text,jsonb) to authenticated,service_role;
grant execute on function public.configure_fuel_station_storage_unit(uuid,uuid,text,text,text,numeric,numeric,text,jsonb,text) to authenticated,service_role;
grant execute on function public.configure_fuel_container_type(text,text,numeric,text[],text,jsonb,text) to authenticated,service_role;

commit;
