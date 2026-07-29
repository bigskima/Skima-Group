begin;

insert into public.event_types (key, description, schema, status)
values
  ('event.catalog.unit.configured', 'Catalog unit was configured.', '{}'::jsonb, 'active'),
  ('event.catalog.category.configured', 'Catalog category was configured.', '{}'::jsonb, 'active'),
  ('event.catalog.item.configured', 'Catalog item was configured.', '{}'::jsonb, 'active'),
  ('event.catalog.variant.configured', 'Catalog item variant was configured.', '{}'::jsonb, 'active'),
  ('event.catalog.price.configured', 'Catalog price was configured.', '{}'::jsonb, 'active'),
  ('event.catalog.media.attached', 'Catalog media was attached.', '{}'::jsonb, 'active'),
  ('event.catalog.availability.configured', 'Catalog availability was configured.', '{}'::jsonb, 'active'),
  ('event.catalog.stock.adjusted', 'Catalog stock or capacity was adjusted.', '{}'::jsonb, 'active'),
  ('event.catalog.orderability.checked', 'Catalog orderability was checked.', '{}'::jsonb, 'active')
on conflict (key) do update
set description = excluded.description,
    schema = excluded.schema,
    status = excluded.status,
    updated_at = timezone('utc', now());

insert into public.permissions (key, description, risk_level)
values
  ('business.catalog.read', 'Read organization catalog, price, and availability records.', 'standard'),
  ('business.catalog.manage', 'Manage organization products, services, prices, and availability.', 'high')
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    updated_at = timezone('utc', now());

create table if not exists public.catalog_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  unit_kind text not null default 'quantity'
    check (unit_kind in ('quantity', 'weight', 'volume', 'time', 'distance', 'package', 'service', 'future')),
  symbol text,
  decimal_precision integer not null default 0
    check (decimal_precision between 0 and 8),
  status text not null default 'active'
    check (status in ('draft', 'active', 'suspended', 'archived')),
  source text not null default 'platform.catalog_engine'
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, key),
  unique (source, idempotency_key)
);

create table if not exists public.catalog_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_id uuid references public.business_modules(id) on delete set null,
  parent_id uuid references public.catalog_categories(id) on delete set null,
  key text not null check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  description text,
  category_type text not null default 'mixed'
    check (category_type in ('product', 'service', 'mixed', 'future')),
  status text not null default 'active'
    check (status in ('draft', 'active', 'suspended', 'archived')),
  source text not null default 'platform.catalog_engine'
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, key),
  unique (source, idempotency_key)
);

create table if not exists public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.organization_branches(id) on delete set null,
  module_id uuid references public.business_modules(id) on delete set null,
  category_id uuid references public.catalog_categories(id) on delete set null,
  key text not null check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  item_type text not null
    check (item_type in ('product', 'service', 'bundle', 'subscription', 'future')),
  display_name text not null,
  description text,
  fulfillment_methods text[] not null default '{}',
  preparation_time_minutes integer check (preparation_time_minutes is null or preparation_time_minutes >= 0),
  min_quantity numeric(20, 8) not null default 1 check (min_quantity > 0),
  max_quantity numeric(20, 8) check (max_quantity is null or max_quantity >= min_quantity),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'unavailable', 'suspended', 'archived')),
  source text not null default 'platform.catalog_engine'
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, key),
  unique (source, idempotency_key)
);

create table if not exists public.catalog_item_variants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.organization_branches(id) on delete set null,
  item_id uuid not null references public.catalog_items(id) on delete cascade,
  unit_id uuid references public.catalog_units(id) on delete set null,
  key text not null check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  sku text,
  quantity_value numeric(20, 8) not null default 1 check (quantity_value > 0),
  status text not null default 'active'
    check (status in ('draft', 'active', 'unavailable', 'suspended', 'archived')),
  source text not null default 'platform.catalog_engine'
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (item_id, key),
  unique (source, idempotency_key)
);

create table if not exists public.catalog_prices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.organization_branches(id) on delete set null,
  item_id uuid not null references public.catalog_items(id) on delete cascade,
  variant_id uuid references public.catalog_item_variants(id) on delete cascade,
  pricing_policy_id uuid references public.pricing_policies(id) on delete set null,
  currency_code text not null references public.currency_definitions(code),
  amount numeric(20, 8) not null check (amount >= 0),
  compare_at_amount numeric(20, 8) check (compare_at_amount is null or compare_at_amount >= 0),
  tax_behavior text not null default 'exclusive'
    check (tax_behavior in ('exclusive', 'inclusive', 'exempt', 'configured')),
  status text not null default 'active'
    check (status in ('draft', 'active', 'scheduled', 'retired')),
  effective_from timestamptz,
  effective_until timestamptz,
  source text not null default 'platform.catalog_engine'
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key),
  check (effective_until is null or effective_from is null or effective_until > effective_from)
);

create table if not exists public.catalog_item_media (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.organization_branches(id) on delete set null,
  item_id uuid not null references public.catalog_items(id) on delete cascade,
  variant_id uuid references public.catalog_item_variants(id) on delete cascade,
  media_asset_id uuid not null references public.media_assets(id) on delete restrict,
  display_order integer not null default 0 check (display_order >= 0),
  status text not null default 'active'
    check (status in ('active', 'hidden', 'archived')),
  source text not null default 'platform.catalog_engine'
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (item_id, media_asset_id),
  unique (source, idempotency_key)
);

create table if not exists public.catalog_availability_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.organization_branches(id) on delete set null,
  item_id uuid not null references public.catalog_items(id) on delete cascade,
  variant_id uuid references public.catalog_item_variants(id) on delete cascade,
  availability_status text not null default 'available'
    check (availability_status in (
      'available',
      'unavailable',
      'out_of_stock',
      'temporarily_paused',
      'capacity_reached',
      'service_closed',
      'admin_suspended'
    )),
  schedule jsonb not null default '{}'::jsonb
    check (jsonb_typeof(schedule) = 'object'),
  stock_quantity numeric(20, 8) check (stock_quantity is null or stock_quantity >= 0),
  reserved_quantity numeric(20, 8) not null default 0 check (reserved_quantity >= 0),
  capacity_limit numeric(20, 8) check (capacity_limit is null or capacity_limit >= 0),
  capacity_used numeric(20, 8) not null default 0 check (capacity_used >= 0),
  status text not null default 'active'
    check (status in ('active', 'retired')),
  effective_from timestamptz,
  effective_until timestamptz,
  source text not null default 'platform.catalog_engine'
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key),
  check (reserved_quantity <= coalesce(stock_quantity, reserved_quantity)),
  check (capacity_used <= coalesce(capacity_limit, capacity_used)),
  check (effective_until is null or effective_from is null or effective_until > effective_from)
);

create table if not exists public.catalog_stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.organization_branches(id) on delete set null,
  item_id uuid not null references public.catalog_items(id) on delete cascade,
  variant_id uuid references public.catalog_item_variants(id) on delete cascade,
  availability_rule_id uuid not null references public.catalog_availability_rules(id) on delete cascade,
  delta_quantity numeric(20, 8) not null check (delta_quantity <> 0),
  from_stock_quantity numeric(20, 8),
  to_stock_quantity numeric(20, 8),
  reason text not null,
  source text not null default 'platform.catalog_engine'
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create table if not exists public.catalog_orderability_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.organization_branches(id) on delete set null,
  item_id uuid not null references public.catalog_items(id) on delete cascade,
  variant_id uuid references public.catalog_item_variants(id) on delete set null,
  price_id uuid references public.catalog_prices(id) on delete set null,
  availability_rule_id uuid references public.catalog_availability_rules(id) on delete set null,
  requester_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  quantity numeric(20, 8) not null check (quantity > 0),
  currency_code text not null references public.currency_definitions(code),
  status text not null check (status in ('allowed', 'rejected')),
  rejection_reason text,
  calculated_amount numeric(20, 8) check (calculated_amount is null or calculated_amount >= 0),
  source text not null default 'platform.catalog_engine'
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create table if not exists public.catalog_runtime_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.organization_branches(id) on delete set null,
  item_id uuid references public.catalog_items(id) on delete set null,
  variant_id uuid references public.catalog_item_variants(id) on delete set null,
  event_type_key text not null references public.event_types(key),
  actor_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  from_status text,
  to_status text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, idempotency_key)
);

create index if not exists catalog_units_org_status_idx
on public.catalog_units (organization_id, status);

create index if not exists catalog_categories_org_status_idx
on public.catalog_categories (organization_id, status);

create index if not exists catalog_items_org_branch_status_idx
on public.catalog_items (organization_id, branch_id, status);

create index if not exists catalog_item_variants_item_status_idx
on public.catalog_item_variants (item_id, status);

create index if not exists catalog_prices_item_variant_status_idx
on public.catalog_prices (item_id, variant_id, currency_code, status, effective_from desc);

create index if not exists catalog_availability_item_branch_status_idx
on public.catalog_availability_rules (item_id, variant_id, branch_id, status);

create index if not exists catalog_orderability_checks_org_created_idx
on public.catalog_orderability_checks (organization_id, created_at desc);

create index if not exists catalog_runtime_events_org_created_idx
on public.catalog_runtime_events (organization_id, created_at desc);

create or replace function public.prevent_catalog_runtime_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'catalog runtime events are append-only';
end;
$$;

create or replace function public.can_read_business_catalog(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or public.has_permission('platform.organizations.read', null)
    or public.has_permission('platform.configuration.read', null)
    or public.is_organization_member(target_organization_id);
$$;

create or replace function public.can_manage_business_catalog(
  target_organization_id uuid,
  target_branch_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or exists (
      select 1
      from public.user_roles assigned_role
      join public.roles role_record on role_record.id = assigned_role.role_id
      join public.role_permissions role_permission on role_permission.role_id = role_record.id
      join public.permissions permission_record on permission_record.id = role_permission.permission_id
      join public.organization_memberships membership
        on membership.organization_id = assigned_role.organization_id
        and membership.user_id = assigned_role.user_id
        and membership.status = 'active'
      where assigned_role.user_id = auth.uid()
        and assigned_role.organization_id = target_organization_id
        and assigned_role.status = 'active'
        and role_record.status = 'active'
        and role_record.organization_id = target_organization_id
        and permission_record.key = 'business.catalog.manage'
        and (assigned_role.ends_at is null or assigned_role.ends_at > timezone('utc', now()))
        and (
          (target_branch_id is null and assigned_role.branch_id is null)
          or (
            target_branch_id is not null
            and (assigned_role.branch_id is null or assigned_role.branch_id = target_branch_id)
          )
        )
    );
$$;

create or replace function public.record_catalog_runtime_event(
  target_organization_id uuid,
  target_event_type_key text,
  target_idempotency_key text,
  target_branch_id uuid default null,
  target_item_id uuid default null,
  target_variant_id uuid default null,
  target_from_status text default null,
  target_to_status text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  catalog_event_id uuid;
begin
  if target_organization_id is null then
    raise exception 'target_organization_id is required';
  end if;

  if target_event_type_key is null
    or target_event_type_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_event_type_key must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  insert into public.catalog_runtime_events (
    organization_id,
    branch_id,
    item_id,
    variant_id,
    event_type_key,
    from_status,
    to_status,
    idempotency_key,
    metadata
  )
  values (
    target_organization_id,
    target_branch_id,
    target_item_id,
    target_variant_id,
    target_event_type_key,
    target_from_status,
    target_to_status,
    target_idempotency_key,
    target_metadata
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning id into catalog_event_id;

  if catalog_event_id is null then
    select existing.id
    into catalog_event_id
    from public.catalog_runtime_events existing
    where existing.organization_id = target_organization_id
      and existing.idempotency_key = target_idempotency_key;
  end if;

  perform public.record_platform_event(
    target_event_type_key,
    'platform.catalog_engine',
    'catalog.runtime_event',
    catalog_event_id,
    target_metadata || jsonb_build_object(
      'organization_id',
      target_organization_id,
      'branch_id',
      target_branch_id,
      'item_id',
      target_item_id,
      'variant_id',
      target_variant_id
    ),
    target_idempotency_key || ':platform',
    timezone('utc', now())
  );

  return catalog_event_id;
end;
$$;

create or replace function public.resolve_catalog_module_id(target_module_key text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  module_id uuid;
begin
  if target_module_key is null then
    return null;
  end if;

  if target_module_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_module_key must be a valid platform key';
  end if;

  select module.id
  into module_id
  from public.business_modules module
  where module.key = target_module_key
    and module.status = 'active';

  if module_id is null then
    raise exception 'target_module_key must reference an active business module';
  end if;

  return module_id;
end;
$$;

create or replace function public.configure_catalog_unit(
  target_organization_id uuid,
  target_unit_key text,
  target_display_name text,
  target_unit_kind text,
  target_symbol text,
  target_decimal_precision integer,
  target_status text,
  target_source text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  unit_id uuid;
  existing_record record;
begin
  if not public.can_manage_business_catalog(target_organization_id, null) then
    raise exception 'business catalog management permission is required';
  end if;

  if target_unit_key is null or target_unit_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_unit_key must be a valid platform key';
  end if;

  if target_display_name is null or btrim(target_display_name) = '' then
    raise exception 'target_display_name is required';
  end if;

  if target_unit_kind not in ('quantity', 'weight', 'volume', 'time', 'distance', 'package', 'service', 'future') then
    raise exception 'target_unit_kind is not supported';
  end if;

  if target_decimal_precision is null or target_decimal_precision < 0 or target_decimal_precision > 8 then
    raise exception 'target_decimal_precision must be between 0 and 8';
  end if;

  if target_status not in ('draft', 'active', 'suspended', 'archived') then
    raise exception 'target_status is not supported';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  insert into public.catalog_units (
    organization_id,
    key,
    display_name,
    unit_kind,
    symbol,
    decimal_precision,
    status,
    source,
    idempotency_key,
    metadata
  )
  values (
    target_organization_id,
    target_unit_key,
    target_display_name,
    target_unit_kind,
    target_symbol,
    target_decimal_precision,
    target_status,
    target_source,
    target_idempotency_key,
    target_metadata
  )
  on conflict (source, idempotency_key) do nothing
  returning id into unit_id;

  if unit_id is null then
    select existing.*
    into existing_record
    from public.catalog_units existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'catalog unit idempotency lookup failed';
    end if;

    return existing_record.id;
  end if;

  perform public.record_catalog_runtime_event(
    target_organization_id,
    'event.catalog.unit.configured',
    target_idempotency_key || ':event',
    null,
    null,
    null,
    null,
    target_status,
    target_metadata
  );

  return unit_id;
end;
$$;

create or replace function public.configure_catalog_category(
  target_organization_id uuid,
  target_category_key text,
  target_display_name text,
  target_category_type text,
  target_module_key text,
  target_parent_key text,
  target_description text,
  target_status text,
  target_source text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  category_id uuid;
  existing_record record;
  module_id uuid;
  parent_id uuid;
begin
  if not public.can_manage_business_catalog(target_organization_id, null) then
    raise exception 'business catalog management permission is required';
  end if;

  if target_category_key is null or target_category_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_category_key must be a valid platform key';
  end if;

  if target_display_name is null or btrim(target_display_name) = '' then
    raise exception 'target_display_name is required';
  end if;

  if target_category_type not in ('product', 'service', 'mixed', 'future') then
    raise exception 'target_category_type is not supported';
  end if;

  if target_parent_key is not null then
    select parent.id
    into parent_id
    from public.catalog_categories parent
    where parent.organization_id = target_organization_id
      and parent.key = target_parent_key
      and parent.status = 'active';

    if parent_id is null then
      raise exception 'target_parent_key must reference an active catalog category';
    end if;
  end if;

  if target_status not in ('draft', 'active', 'suspended', 'archived') then
    raise exception 'target_status is not supported';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  module_id := public.resolve_catalog_module_id(target_module_key);

  insert into public.catalog_categories (
    organization_id,
    module_id,
    parent_id,
    key,
    display_name,
    description,
    category_type,
    status,
    source,
    idempotency_key,
    metadata
  )
  values (
    target_organization_id,
    module_id,
    parent_id,
    target_category_key,
    target_display_name,
    target_description,
    target_category_type,
    target_status,
    target_source,
    target_idempotency_key,
    target_metadata
  )
  on conflict (source, idempotency_key) do nothing
  returning id into category_id;

  if category_id is null then
    select existing.*
    into existing_record
    from public.catalog_categories existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'catalog category idempotency lookup failed';
    end if;

    return existing_record.id;
  end if;

  perform public.record_catalog_runtime_event(
    target_organization_id,
    'event.catalog.category.configured',
    target_idempotency_key || ':event',
    null,
    null,
    null,
    null,
    target_status,
    target_metadata
  );

  return category_id;
end;
$$;

create or replace function public.configure_catalog_item(
  target_organization_id uuid,
  target_branch_id uuid,
  target_module_key text,
  target_category_key text,
  target_item_key text,
  target_item_type text,
  target_display_name text,
  target_description text,
  target_fulfillment_methods text[],
  target_preparation_time_minutes integer,
  target_min_quantity numeric,
  target_max_quantity numeric,
  target_status text,
  target_source text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  item_id uuid;
  existing_record record;
  module_id uuid;
  category_id uuid;
begin
  if not public.can_manage_business_catalog(target_organization_id, target_branch_id) then
    raise exception 'business catalog management permission is required';
  end if;

  if target_branch_id is not null and not exists (
    select 1
    from public.organization_branches branch
    where branch.id = target_branch_id
      and branch.organization_id = target_organization_id
      and branch.status = 'active'
  ) then
    raise exception 'target_branch_id must reference an active organization branch';
  end if;

  if target_category_key is not null then
    select category.id
    into category_id
    from public.catalog_categories category
    where category.organization_id = target_organization_id
      and category.key = target_category_key
      and category.status = 'active';

    if category_id is null then
      raise exception 'target_category_key must reference an active catalog category';
    end if;
  end if;

  if target_item_key is null or target_item_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_item_key must be a valid platform key';
  end if;

  if target_item_type not in ('product', 'service', 'bundle', 'subscription', 'future') then
    raise exception 'target_item_type is not supported';
  end if;

  if target_display_name is null or btrim(target_display_name) = '' then
    raise exception 'target_display_name is required';
  end if;

  if target_fulfillment_methods is null then
    raise exception 'target_fulfillment_methods is required';
  end if;

  if target_preparation_time_minutes is not null and target_preparation_time_minutes < 0 then
    raise exception 'target_preparation_time_minutes must be zero or greater';
  end if;

  if target_min_quantity is null or target_min_quantity <= 0 then
    raise exception 'target_min_quantity must be greater than zero';
  end if;

  if target_max_quantity is not null and target_max_quantity < target_min_quantity then
    raise exception 'target_max_quantity must be greater than or equal to target_min_quantity';
  end if;

  if target_status not in ('draft', 'active', 'unavailable', 'suspended', 'archived') then
    raise exception 'target_status is not supported';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  module_id := public.resolve_catalog_module_id(target_module_key);

  insert into public.catalog_items (
    organization_id,
    branch_id,
    module_id,
    category_id,
    key,
    item_type,
    display_name,
    description,
    fulfillment_methods,
    preparation_time_minutes,
    min_quantity,
    max_quantity,
    status,
    source,
    idempotency_key,
    metadata
  )
  values (
    target_organization_id,
    target_branch_id,
    module_id,
    category_id,
    target_item_key,
    target_item_type,
    target_display_name,
    target_description,
    target_fulfillment_methods,
    target_preparation_time_minutes,
    target_min_quantity,
    target_max_quantity,
    target_status,
    target_source,
    target_idempotency_key,
    target_metadata
  )
  on conflict (source, idempotency_key) do nothing
  returning id into item_id;

  if item_id is null then
    select existing.*
    into existing_record
    from public.catalog_items existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'catalog item idempotency lookup failed';
    end if;

    return existing_record.id;
  end if;

  perform public.record_catalog_runtime_event(
    target_organization_id,
    'event.catalog.item.configured',
    target_idempotency_key || ':event',
    target_branch_id,
    item_id,
    null,
    null,
    target_status,
    target_metadata
  );

  return item_id;
end;
$$;

create or replace function public.configure_catalog_variant(
  target_item_id uuid,
  target_unit_key text,
  target_variant_key text,
  target_display_name text,
  target_sku text,
  target_quantity_value numeric,
  target_status text,
  target_source text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  item_record record;
  unit_id uuid;
  variant_id uuid;
  existing_record record;
begin
  select item.*
  into item_record
  from public.catalog_items item
  where item.id = target_item_id;

  if not found then
    raise exception 'target_item_id must reference an existing catalog item';
  end if;

  if not public.can_manage_business_catalog(item_record.organization_id, item_record.branch_id) then
    raise exception 'business catalog management permission is required';
  end if;

  if target_unit_key is not null then
    select unit.id
    into unit_id
    from public.catalog_units unit
    where unit.organization_id = item_record.organization_id
      and unit.key = target_unit_key
      and unit.status = 'active';

    if unit_id is null then
      raise exception 'target_unit_key must reference an active catalog unit';
    end if;
  end if;

  if target_variant_key is null or target_variant_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_variant_key must be a valid platform key';
  end if;

  if target_display_name is null or btrim(target_display_name) = '' then
    raise exception 'target_display_name is required';
  end if;

  if target_quantity_value is null or target_quantity_value <= 0 then
    raise exception 'target_quantity_value must be greater than zero';
  end if;

  if target_status not in ('draft', 'active', 'unavailable', 'suspended', 'archived') then
    raise exception 'target_status is not supported';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  insert into public.catalog_item_variants (
    organization_id,
    branch_id,
    item_id,
    unit_id,
    key,
    display_name,
    sku,
    quantity_value,
    status,
    source,
    idempotency_key,
    metadata
  )
  values (
    item_record.organization_id,
    item_record.branch_id,
    target_item_id,
    unit_id,
    target_variant_key,
    target_display_name,
    target_sku,
    target_quantity_value,
    target_status,
    target_source,
    target_idempotency_key,
    target_metadata
  )
  on conflict (source, idempotency_key) do nothing
  returning id into variant_id;

  if variant_id is null then
    select existing.*
    into existing_record
    from public.catalog_item_variants existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'catalog variant idempotency lookup failed';
    end if;

    return existing_record.id;
  end if;

  perform public.record_catalog_runtime_event(
    item_record.organization_id,
    'event.catalog.variant.configured',
    target_idempotency_key || ':event',
    item_record.branch_id,
    target_item_id,
    variant_id,
    null,
    target_status,
    target_metadata
  );

  return variant_id;
end;
$$;

create or replace function public.configure_catalog_price(
  target_item_id uuid,
  target_variant_id uuid,
  target_currency_code text,
  target_amount numeric,
  target_compare_at_amount numeric,
  target_pricing_policy_key text,
  target_tax_behavior text,
  target_status text,
  target_effective_from timestamptz,
  target_effective_until timestamptz,
  target_source text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  item_record record;
  pricing_policy_id uuid;
  price_id uuid;
  existing_record record;
begin
  select item.*
  into item_record
  from public.catalog_items item
  where item.id = target_item_id;

  if not found then
    raise exception 'target_item_id must reference an existing catalog item';
  end if;

  if not public.can_manage_business_catalog(item_record.organization_id, item_record.branch_id) then
    raise exception 'business catalog management permission is required';
  end if;

  if target_variant_id is not null and not exists (
    select 1
    from public.catalog_item_variants variant
    where variant.id = target_variant_id
      and variant.item_id = target_item_id
  ) then
    raise exception 'target_variant_id must reference a variant for this item';
  end if;

  if not exists (
    select 1
    from public.currency_definitions currency
    where currency.code = target_currency_code
      and currency.status = 'enabled'
  ) then
    raise exception 'target_currency_code must reference an enabled currency';
  end if;

  if target_amount is null or target_amount < 0 then
    raise exception 'target_amount must be zero or greater';
  end if;

  if target_compare_at_amount is not null and target_compare_at_amount < 0 then
    raise exception 'target_compare_at_amount must be zero or greater';
  end if;

  if target_pricing_policy_key is not null then
    select policy.id
    into pricing_policy_id
    from public.pricing_policies policy
    where policy.key = target_pricing_policy_key
      and policy.status = 'active';

    if pricing_policy_id is null then
      raise exception 'target_pricing_policy_key must reference an active pricing policy';
    end if;
  end if;

  if target_tax_behavior not in ('exclusive', 'inclusive', 'exempt', 'configured') then
    raise exception 'target_tax_behavior is not supported';
  end if;

  if target_status not in ('draft', 'active', 'scheduled', 'retired') then
    raise exception 'target_status is not supported';
  end if;

  if target_effective_until is not null and target_effective_from is not null
    and target_effective_until <= target_effective_from then
    raise exception 'target_effective_until must be after target_effective_from';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  insert into public.catalog_prices (
    organization_id,
    branch_id,
    item_id,
    variant_id,
    pricing_policy_id,
    currency_code,
    amount,
    compare_at_amount,
    tax_behavior,
    status,
    effective_from,
    effective_until,
    source,
    idempotency_key,
    metadata
  )
  values (
    item_record.organization_id,
    item_record.branch_id,
    target_item_id,
    target_variant_id,
    pricing_policy_id,
    target_currency_code,
    target_amount,
    target_compare_at_amount,
    target_tax_behavior,
    target_status,
    target_effective_from,
    target_effective_until,
    target_source,
    target_idempotency_key,
    target_metadata
  )
  on conflict (source, idempotency_key) do nothing
  returning id into price_id;

  if price_id is null then
    select existing.*
    into existing_record
    from public.catalog_prices existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'catalog price idempotency lookup failed';
    end if;

    return existing_record.id;
  end if;

  perform public.record_catalog_runtime_event(
    item_record.organization_id,
    'event.catalog.price.configured',
    target_idempotency_key || ':event',
    item_record.branch_id,
    target_item_id,
    target_variant_id,
    null,
    target_status,
    target_metadata || jsonb_build_object('currency_code', target_currency_code)
  );

  return price_id;
end;
$$;

create or replace function public.attach_catalog_item_media(
  target_item_id uuid,
  target_variant_id uuid,
  target_media_asset_id uuid,
  target_display_order integer,
  target_status text,
  target_source text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  item_record record;
  media_record record;
  media_link_id uuid;
  existing_record record;
begin
  select item.*
  into item_record
  from public.catalog_items item
  where item.id = target_item_id;

  if not found then
    raise exception 'target_item_id must reference an existing catalog item';
  end if;

  if not public.can_manage_business_catalog(item_record.organization_id, item_record.branch_id) then
    raise exception 'business catalog management permission is required';
  end if;

  if target_variant_id is not null and not exists (
    select 1
    from public.catalog_item_variants variant
    where variant.id = target_variant_id
      and variant.item_id = target_item_id
  ) then
    raise exception 'target_variant_id must reference a variant for this item';
  end if;

  select media.*
  into media_record
  from public.media_assets media
  where media.id = target_media_asset_id
    and (
      media.organization_id is null
      or media.organization_id = item_record.organization_id
    )
    and media.status = 'active';

  if not found then
    raise exception 'target_media_asset_id must reference an active media asset for this organization';
  end if;

  if target_display_order is null or target_display_order < 0 then
    raise exception 'target_display_order must be zero or greater';
  end if;

  if target_status not in ('active', 'hidden', 'archived') then
    raise exception 'target_status is not supported';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  insert into public.catalog_item_media (
    organization_id,
    branch_id,
    item_id,
    variant_id,
    media_asset_id,
    display_order,
    status,
    source,
    idempotency_key,
    metadata
  )
  values (
    item_record.organization_id,
    item_record.branch_id,
    target_item_id,
    target_variant_id,
    target_media_asset_id,
    target_display_order,
    target_status,
    target_source,
    target_idempotency_key,
    target_metadata
  )
  on conflict (source, idempotency_key) do nothing
  returning id into media_link_id;

  if media_link_id is null then
    select existing.*
    into existing_record
    from public.catalog_item_media existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'catalog media idempotency lookup failed';
    end if;

    return existing_record.id;
  end if;

  perform public.record_catalog_runtime_event(
    item_record.organization_id,
    'event.catalog.media.attached',
    target_idempotency_key || ':event',
    item_record.branch_id,
    target_item_id,
    target_variant_id,
    null,
    target_status,
    target_metadata || jsonb_build_object('media_asset_id', target_media_asset_id)
  );

  return media_link_id;
end;
$$;

create or replace function public.set_catalog_availability(
  target_item_id uuid,
  target_variant_id uuid,
  target_branch_id uuid,
  target_availability_status text,
  target_schedule jsonb,
  target_stock_quantity numeric,
  target_reserved_quantity numeric,
  target_capacity_limit numeric,
  target_capacity_used numeric,
  target_status text,
  target_effective_from timestamptz,
  target_effective_until timestamptz,
  target_source text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  item_record record;
  resolved_branch_id uuid;
  availability_id uuid;
  existing_record record;
begin
  select item.*
  into item_record
  from public.catalog_items item
  where item.id = target_item_id;

  if not found then
    raise exception 'target_item_id must reference an existing catalog item';
  end if;

  resolved_branch_id := coalesce(target_branch_id, item_record.branch_id);

  if not public.can_manage_business_catalog(item_record.organization_id, resolved_branch_id) then
    raise exception 'business catalog management permission is required';
  end if;

  if resolved_branch_id is not null and not exists (
    select 1
    from public.organization_branches branch
    where branch.id = resolved_branch_id
      and branch.organization_id = item_record.organization_id
      and branch.status = 'active'
  ) then
    raise exception 'target_branch_id must reference an active organization branch';
  end if;

  if target_variant_id is not null and not exists (
    select 1
    from public.catalog_item_variants variant
    where variant.id = target_variant_id
      and variant.item_id = target_item_id
      and variant.status = 'active'
  ) then
    raise exception 'target_variant_id must reference an active variant for this item';
  end if;

  if target_availability_status not in (
    'available',
    'unavailable',
    'out_of_stock',
    'temporarily_paused',
    'capacity_reached',
    'service_closed',
    'admin_suspended'
  ) then
    raise exception 'target_availability_status is not supported';
  end if;

  if target_schedule is null or jsonb_typeof(target_schedule) <> 'object' then
    raise exception 'target_schedule must be a JSON object';
  end if;

  if target_stock_quantity is not null and target_stock_quantity < 0 then
    raise exception 'target_stock_quantity must be zero or greater';
  end if;

  if target_reserved_quantity is null or target_reserved_quantity < 0 then
    raise exception 'target_reserved_quantity must be zero or greater';
  end if;

  if target_stock_quantity is not null and target_reserved_quantity > target_stock_quantity then
    raise exception 'target_reserved_quantity cannot exceed target_stock_quantity';
  end if;

  if target_capacity_limit is not null and target_capacity_limit < 0 then
    raise exception 'target_capacity_limit must be zero or greater';
  end if;

  if target_capacity_used is null or target_capacity_used < 0 then
    raise exception 'target_capacity_used must be zero or greater';
  end if;

  if target_capacity_limit is not null and target_capacity_used > target_capacity_limit then
    raise exception 'target_capacity_used cannot exceed target_capacity_limit';
  end if;

  if target_status not in ('active', 'retired') then
    raise exception 'target_status is not supported';
  end if;

  if target_effective_until is not null and target_effective_from is not null
    and target_effective_until <= target_effective_from then
    raise exception 'target_effective_until must be after target_effective_from';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  insert into public.catalog_availability_rules (
    organization_id,
    branch_id,
    item_id,
    variant_id,
    availability_status,
    schedule,
    stock_quantity,
    reserved_quantity,
    capacity_limit,
    capacity_used,
    status,
    effective_from,
    effective_until,
    source,
    idempotency_key,
    metadata
  )
  values (
    item_record.organization_id,
    resolved_branch_id,
    target_item_id,
    target_variant_id,
    target_availability_status,
    target_schedule,
    target_stock_quantity,
    target_reserved_quantity,
    target_capacity_limit,
    target_capacity_used,
    target_status,
    target_effective_from,
    target_effective_until,
    target_source,
    target_idempotency_key,
    target_metadata
  )
  on conflict (source, idempotency_key) do nothing
  returning id into availability_id;

  if availability_id is null then
    select existing.*
    into existing_record
    from public.catalog_availability_rules existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'catalog availability idempotency lookup failed';
    end if;

    return existing_record.id;
  end if;

  perform public.record_catalog_runtime_event(
    item_record.organization_id,
    'event.catalog.availability.configured',
    target_idempotency_key || ':event',
    resolved_branch_id,
    target_item_id,
    target_variant_id,
    null,
    target_availability_status,
    target_metadata
  );

  return availability_id;
end;
$$;

create or replace function public.adjust_catalog_stock(
  target_availability_rule_id uuid,
  target_delta_quantity numeric,
  target_reason text,
  target_source text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  availability_record record;
  adjustment_id uuid;
  existing_record record;
  next_stock_quantity numeric;
begin
  select availability.*
  into availability_record
  from public.catalog_availability_rules availability
  where availability.id = target_availability_rule_id
  for update;

  if not found then
    raise exception 'target_availability_rule_id must reference an existing availability rule';
  end if;

  if not public.can_manage_business_catalog(availability_record.organization_id, availability_record.branch_id) then
    raise exception 'business catalog management permission is required';
  end if;

  if target_delta_quantity is null or target_delta_quantity = 0 then
    raise exception 'target_delta_quantity must be non-zero';
  end if;

  if target_reason is null or btrim(target_reason) = '' then
    raise exception 'target_reason is required';
  end if;

  if availability_record.stock_quantity is null then
    raise exception 'availability rule does not track stock_quantity';
  end if;

  next_stock_quantity := availability_record.stock_quantity + target_delta_quantity;

  if next_stock_quantity < availability_record.reserved_quantity then
    raise exception 'stock adjustment cannot reduce stock below reserved quantity';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select existing.*
  into existing_record
  from public.catalog_stock_adjustments existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if found then
    return existing_record.id;
  end if;

  update public.catalog_availability_rules
  set stock_quantity = next_stock_quantity,
      availability_status = case
        when next_stock_quantity <= reserved_quantity then 'out_of_stock'
        else availability_status
      end,
      updated_at = timezone('utc', now())
  where id = target_availability_rule_id;

  insert into public.catalog_stock_adjustments (
    organization_id,
    branch_id,
    item_id,
    variant_id,
    availability_rule_id,
    delta_quantity,
    from_stock_quantity,
    to_stock_quantity,
    reason,
    source,
    idempotency_key,
    metadata
  )
  values (
    availability_record.organization_id,
    availability_record.branch_id,
    availability_record.item_id,
    availability_record.variant_id,
    target_availability_rule_id,
    target_delta_quantity,
    availability_record.stock_quantity,
    next_stock_quantity,
    target_reason,
    target_source,
    target_idempotency_key,
    target_metadata
  )
  returning id into adjustment_id;

  perform public.record_catalog_runtime_event(
    availability_record.organization_id,
    'event.catalog.stock.adjusted',
    target_idempotency_key || ':event',
    availability_record.branch_id,
    availability_record.item_id,
    availability_record.variant_id,
    availability_record.stock_quantity::text,
    next_stock_quantity::text,
    target_metadata || jsonb_build_object('reason', target_reason)
  );

  return adjustment_id;
end;
$$;

create or replace function public.validate_catalog_orderability(
  target_item_id uuid,
  target_variant_id uuid,
  target_branch_id uuid,
  target_quantity numeric,
  target_currency_code text,
  target_source text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item_record public.catalog_items%rowtype;
  variant_record public.catalog_item_variants%rowtype;
  price_record public.catalog_prices%rowtype;
  availability_record public.catalog_availability_rules%rowtype;
  resolved_branch_id uuid;
  rejection_reason text;
  check_id uuid;
  calculated_amount numeric(20, 8);
  existing_record record;
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  if target_item_id is null then
    raise exception 'target_item_id is required';
  end if;

  if target_quantity is null or target_quantity <= 0 then
    raise exception 'target_quantity must be greater than zero';
  end if;

  if target_currency_code is null or target_currency_code !~ '^[A-Z0-9]{3,12}$' then
    raise exception 'target_currency_code must be a valid currency code';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select existing.*
  into existing_record
  from public.catalog_orderability_checks existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if found then
    return jsonb_build_object(
      'allowed',
      existing_record.status = 'allowed',
      'check_id',
      existing_record.id,
      'price_id',
      existing_record.price_id,
      'availability_rule_id',
      existing_record.availability_rule_id,
      'currency_code',
      existing_record.currency_code,
      'quantity',
      existing_record.quantity,
      'calculated_amount',
      existing_record.calculated_amount,
      'rejection_reason',
      existing_record.rejection_reason
    );
  end if;

  select item.*
  into item_record
  from public.catalog_items item
  where item.id = target_item_id;

  if not found then
    raise exception 'target_item_id must reference an existing catalog item';
  end if;

  resolved_branch_id := coalesce(target_branch_id, item_record.branch_id);

  if target_variant_id is not null then
    select variant.*
    into variant_record
    from public.catalog_item_variants variant
    where variant.id = target_variant_id
      and variant.item_id = target_item_id;

    if not found then
      raise exception 'target_variant_id must reference a variant for this item';
    end if;
  end if;

  select price.*
  into price_record
  from public.catalog_prices price
  where price.item_id = target_item_id
    and (target_variant_id is null or price.variant_id = target_variant_id)
    and price.currency_code = target_currency_code
    and price.status = 'active'
    and (price.effective_from is null or price.effective_from <= timezone('utc', now()))
    and (price.effective_until is null or price.effective_until > timezone('utc', now()))
  order by price.effective_from desc nulls last, price.created_at desc
  limit 1;

  select availability.*
  into availability_record
  from public.catalog_availability_rules availability
  where availability.item_id = target_item_id
    and (target_variant_id is null or availability.variant_id = target_variant_id)
    and (resolved_branch_id is null or availability.branch_id = resolved_branch_id)
    and availability.status = 'active'
    and (availability.effective_from is null or availability.effective_from <= timezone('utc', now()))
    and (availability.effective_until is null or availability.effective_until > timezone('utc', now()))
  order by availability.effective_from desc nulls last, availability.created_at desc
  limit 1;

  if item_record.status <> 'active' then
    rejection_reason := 'catalog item is not active';
  elsif target_quantity < item_record.min_quantity then
    rejection_reason := 'target_quantity is below the item minimum';
  elsif item_record.max_quantity is not null and target_quantity > item_record.max_quantity then
    rejection_reason := 'target_quantity exceeds the item maximum';
  elsif target_variant_id is not null and variant_record.status <> 'active' then
    rejection_reason := 'catalog variant is not active';
  elsif price_record.id is null then
    rejection_reason := 'no active price is configured';
  elsif availability_record.id is null then
    rejection_reason := 'no active availability rule is configured';
  elsif availability_record.availability_status <> 'available' then
    rejection_reason := 'catalog availability is not available';
  elsif availability_record.stock_quantity is not null
    and (availability_record.stock_quantity - availability_record.reserved_quantity) < target_quantity then
    rejection_reason := 'insufficient stock is available';
  elsif availability_record.capacity_limit is not null
    and (availability_record.capacity_limit - availability_record.capacity_used) < target_quantity then
    rejection_reason := 'insufficient capacity is available';
  end if;

  if rejection_reason is null then
    calculated_amount := price_record.amount * target_quantity;
  end if;

  insert into public.catalog_orderability_checks (
    organization_id,
    branch_id,
    item_id,
    variant_id,
    price_id,
    availability_rule_id,
    quantity,
    currency_code,
    status,
    rejection_reason,
    calculated_amount,
    source,
    idempotency_key,
    metadata
  )
  values (
    item_record.organization_id,
    resolved_branch_id,
    target_item_id,
    target_variant_id,
    price_record.id,
    availability_record.id,
    target_quantity,
    target_currency_code,
    case when rejection_reason is null then 'allowed' else 'rejected' end,
    rejection_reason,
    calculated_amount,
    target_source,
    target_idempotency_key,
    target_metadata
  )
  returning id into check_id;

  perform public.record_catalog_runtime_event(
    item_record.organization_id,
    'event.catalog.orderability.checked',
    target_idempotency_key || ':event',
    resolved_branch_id,
    target_item_id,
    target_variant_id,
    null,
    case when rejection_reason is null then 'allowed' else 'rejected' end,
    target_metadata || jsonb_build_object('rejection_reason', rejection_reason)
  );

  return jsonb_build_object(
    'allowed',
    rejection_reason is null,
    'check_id',
    check_id,
    'price_id',
    price_record.id,
    'availability_rule_id',
    availability_record.id,
    'currency_code',
    target_currency_code,
    'quantity',
    target_quantity,
    'calculated_amount',
    calculated_amount,
    'rejection_reason',
    rejection_reason
  );
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'catalog_units',
    'catalog_categories',
    'catalog_items',
    'catalog_item_variants',
    'catalog_prices',
    'catalog_item_media',
    'catalog_availability_rules'
  ] loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I', target_table, target_table);
    execute format(
      'create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      target_table,
      target_table
    );
  end loop;
end $$;

drop trigger if exists prevent_catalog_runtime_events_update on public.catalog_runtime_events;
create trigger prevent_catalog_runtime_events_update
before update on public.catalog_runtime_events
for each row execute function public.prevent_catalog_runtime_event_mutation();

drop trigger if exists prevent_catalog_runtime_events_delete on public.catalog_runtime_events;
create trigger prevent_catalog_runtime_events_delete
before delete on public.catalog_runtime_events
for each row execute function public.prevent_catalog_runtime_event_mutation();

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'catalog_units',
    'catalog_categories',
    'catalog_items',
    'catalog_item_variants',
    'catalog_prices',
    'catalog_item_media',
    'catalog_availability_rules',
    'catalog_stock_adjustments',
    'catalog_orderability_checks',
    'catalog_runtime_events'
  ] loop
    execute format('drop trigger if exists audit_%I_mutations on public.%I', target_table, target_table);
    execute format(
      'create trigger audit_%I_mutations after insert or update or delete on public.%I for each row execute function public.record_table_audit()',
      target_table,
      target_table
    );
  end loop;
end $$;

alter table public.catalog_units enable row level security;
alter table public.catalog_categories enable row level security;
alter table public.catalog_items enable row level security;
alter table public.catalog_item_variants enable row level security;
alter table public.catalog_prices enable row level security;
alter table public.catalog_item_media enable row level security;
alter table public.catalog_availability_rules enable row level security;
alter table public.catalog_stock_adjustments enable row level security;
alter table public.catalog_orderability_checks enable row level security;
alter table public.catalog_runtime_events enable row level security;

drop policy if exists catalog_units_select_member_or_privileged on public.catalog_units;
drop policy if exists catalog_units_no_direct_insert on public.catalog_units;
drop policy if exists catalog_units_no_direct_update on public.catalog_units;
drop policy if exists catalog_units_no_direct_delete on public.catalog_units;
drop policy if exists catalog_categories_select_member_or_privileged on public.catalog_categories;
drop policy if exists catalog_categories_no_direct_insert on public.catalog_categories;
drop policy if exists catalog_categories_no_direct_update on public.catalog_categories;
drop policy if exists catalog_categories_no_direct_delete on public.catalog_categories;
drop policy if exists catalog_items_select_member_or_active on public.catalog_items;
drop policy if exists catalog_items_no_direct_insert on public.catalog_items;
drop policy if exists catalog_items_no_direct_update on public.catalog_items;
drop policy if exists catalog_items_no_direct_delete on public.catalog_items;
drop policy if exists catalog_item_variants_select_member_or_active on public.catalog_item_variants;
drop policy if exists catalog_item_variants_no_direct_insert on public.catalog_item_variants;
drop policy if exists catalog_item_variants_no_direct_update on public.catalog_item_variants;
drop policy if exists catalog_item_variants_no_direct_delete on public.catalog_item_variants;
drop policy if exists catalog_prices_select_member_or_active on public.catalog_prices;
drop policy if exists catalog_prices_no_direct_insert on public.catalog_prices;
drop policy if exists catalog_prices_no_direct_update on public.catalog_prices;
drop policy if exists catalog_prices_no_direct_delete on public.catalog_prices;
drop policy if exists catalog_item_media_select_member_or_active on public.catalog_item_media;
drop policy if exists catalog_item_media_no_direct_insert on public.catalog_item_media;
drop policy if exists catalog_item_media_no_direct_update on public.catalog_item_media;
drop policy if exists catalog_item_media_no_direct_delete on public.catalog_item_media;
drop policy if exists catalog_availability_rules_select_member_or_active on public.catalog_availability_rules;
drop policy if exists catalog_availability_rules_no_direct_insert on public.catalog_availability_rules;
drop policy if exists catalog_availability_rules_no_direct_update on public.catalog_availability_rules;
drop policy if exists catalog_availability_rules_no_direct_delete on public.catalog_availability_rules;
drop policy if exists catalog_stock_adjustments_select_member_or_privileged on public.catalog_stock_adjustments;
drop policy if exists catalog_stock_adjustments_no_direct_insert on public.catalog_stock_adjustments;
drop policy if exists catalog_stock_adjustments_no_direct_update on public.catalog_stock_adjustments;
drop policy if exists catalog_stock_adjustments_no_direct_delete on public.catalog_stock_adjustments;
drop policy if exists catalog_orderability_checks_select_actor_or_privileged on public.catalog_orderability_checks;
drop policy if exists catalog_orderability_checks_no_direct_insert on public.catalog_orderability_checks;
drop policy if exists catalog_orderability_checks_no_direct_update on public.catalog_orderability_checks;
drop policy if exists catalog_orderability_checks_no_direct_delete on public.catalog_orderability_checks;
drop policy if exists catalog_runtime_events_select_member_or_privileged on public.catalog_runtime_events;
drop policy if exists catalog_runtime_events_no_direct_insert on public.catalog_runtime_events;
drop policy if exists catalog_runtime_events_no_direct_update on public.catalog_runtime_events;
drop policy if exists catalog_runtime_events_no_direct_delete on public.catalog_runtime_events;

create policy catalog_units_select_member_or_privileged on public.catalog_units
for select to authenticated
using (public.can_read_business_catalog(organization_id));

create policy catalog_categories_select_member_or_privileged on public.catalog_categories
for select to authenticated
using (public.can_read_business_catalog(organization_id));

create policy catalog_items_select_member_or_active on public.catalog_items
for select to authenticated
using (status = 'active' or public.can_read_business_catalog(organization_id));

create policy catalog_item_variants_select_member_or_active on public.catalog_item_variants
for select to authenticated
using (status = 'active' or public.can_read_business_catalog(organization_id));

create policy catalog_prices_select_member_or_active on public.catalog_prices
for select to authenticated
using (status = 'active' or public.can_read_business_catalog(organization_id));

create policy catalog_item_media_select_member_or_active on public.catalog_item_media
for select to authenticated
using (status = 'active' or public.can_read_business_catalog(organization_id));

create policy catalog_availability_rules_select_member_or_active on public.catalog_availability_rules
for select to authenticated
using (status = 'active' or public.can_read_business_catalog(organization_id));

create policy catalog_stock_adjustments_select_member_or_privileged on public.catalog_stock_adjustments
for select to authenticated
using (public.can_read_business_catalog(organization_id));

create policy catalog_orderability_checks_select_actor_or_privileged on public.catalog_orderability_checks
for select to authenticated
using (requester_user_id = auth.uid() or public.can_read_business_catalog(organization_id));

create policy catalog_runtime_events_select_member_or_privileged on public.catalog_runtime_events
for select to authenticated
using (public.can_read_business_catalog(organization_id));

create policy catalog_units_no_direct_insert on public.catalog_units for insert to authenticated with check (false);
create policy catalog_units_no_direct_update on public.catalog_units for update to authenticated using (false) with check (false);
create policy catalog_units_no_direct_delete on public.catalog_units for delete to authenticated using (false);
create policy catalog_categories_no_direct_insert on public.catalog_categories for insert to authenticated with check (false);
create policy catalog_categories_no_direct_update on public.catalog_categories for update to authenticated using (false) with check (false);
create policy catalog_categories_no_direct_delete on public.catalog_categories for delete to authenticated using (false);
create policy catalog_items_no_direct_insert on public.catalog_items for insert to authenticated with check (false);
create policy catalog_items_no_direct_update on public.catalog_items for update to authenticated using (false) with check (false);
create policy catalog_items_no_direct_delete on public.catalog_items for delete to authenticated using (false);
create policy catalog_item_variants_no_direct_insert on public.catalog_item_variants for insert to authenticated with check (false);
create policy catalog_item_variants_no_direct_update on public.catalog_item_variants for update to authenticated using (false) with check (false);
create policy catalog_item_variants_no_direct_delete on public.catalog_item_variants for delete to authenticated using (false);
create policy catalog_prices_no_direct_insert on public.catalog_prices for insert to authenticated with check (false);
create policy catalog_prices_no_direct_update on public.catalog_prices for update to authenticated using (false) with check (false);
create policy catalog_prices_no_direct_delete on public.catalog_prices for delete to authenticated using (false);
create policy catalog_item_media_no_direct_insert on public.catalog_item_media for insert to authenticated with check (false);
create policy catalog_item_media_no_direct_update on public.catalog_item_media for update to authenticated using (false) with check (false);
create policy catalog_item_media_no_direct_delete on public.catalog_item_media for delete to authenticated using (false);
create policy catalog_availability_rules_no_direct_insert on public.catalog_availability_rules for insert to authenticated with check (false);
create policy catalog_availability_rules_no_direct_update on public.catalog_availability_rules for update to authenticated using (false) with check (false);
create policy catalog_availability_rules_no_direct_delete on public.catalog_availability_rules for delete to authenticated using (false);
create policy catalog_stock_adjustments_no_direct_insert on public.catalog_stock_adjustments for insert to authenticated with check (false);
create policy catalog_stock_adjustments_no_direct_update on public.catalog_stock_adjustments for update to authenticated using (false) with check (false);
create policy catalog_stock_adjustments_no_direct_delete on public.catalog_stock_adjustments for delete to authenticated using (false);
create policy catalog_orderability_checks_no_direct_insert on public.catalog_orderability_checks for insert to authenticated with check (false);
create policy catalog_orderability_checks_no_direct_update on public.catalog_orderability_checks for update to authenticated using (false) with check (false);
create policy catalog_orderability_checks_no_direct_delete on public.catalog_orderability_checks for delete to authenticated using (false);
create policy catalog_runtime_events_no_direct_insert on public.catalog_runtime_events for insert to authenticated with check (false);
create policy catalog_runtime_events_no_direct_update on public.catalog_runtime_events for update to authenticated using (false) with check (false);
create policy catalog_runtime_events_no_direct_delete on public.catalog_runtime_events for delete to authenticated using (false);

grant select, insert, update, delete on
  public.catalog_units,
  public.catalog_categories,
  public.catalog_items,
  public.catalog_item_variants,
  public.catalog_prices,
  public.catalog_item_media,
  public.catalog_availability_rules,
  public.catalog_stock_adjustments,
  public.catalog_orderability_checks,
  public.catalog_runtime_events
to authenticated;

grant select, insert, update, delete on
  public.catalog_units,
  public.catalog_categories,
  public.catalog_items,
  public.catalog_item_variants,
  public.catalog_prices,
  public.catalog_item_media,
  public.catalog_availability_rules,
  public.catalog_stock_adjustments,
  public.catalog_orderability_checks,
  public.catalog_runtime_events
to service_role;

revoke all on function public.can_read_business_catalog(uuid) from public;
revoke all on function public.can_manage_business_catalog(uuid, uuid) from public;
revoke all on function public.record_catalog_runtime_event(uuid, text, text, uuid, uuid, uuid, text, text, jsonb) from public;
revoke all on function public.resolve_catalog_module_id(text) from public;
revoke all on function public.configure_catalog_unit(uuid, text, text, text, text, integer, text, text, text, jsonb) from public;
revoke all on function public.configure_catalog_category(uuid, text, text, text, text, text, text, text, text, text, jsonb) from public;
revoke all on function public.configure_catalog_item(uuid, uuid, text, text, text, text, text, text, text[], integer, numeric, numeric, text, text, text, jsonb) from public;
revoke all on function public.configure_catalog_variant(uuid, text, text, text, text, numeric, text, text, text, jsonb) from public;
revoke all on function public.configure_catalog_price(uuid, uuid, text, numeric, numeric, text, text, text, timestamptz, timestamptz, text, text, jsonb) from public;
revoke all on function public.attach_catalog_item_media(uuid, uuid, uuid, integer, text, text, text, jsonb) from public;
revoke all on function public.set_catalog_availability(uuid, uuid, uuid, text, jsonb, numeric, numeric, numeric, numeric, text, timestamptz, timestamptz, text, text, jsonb) from public;
revoke all on function public.adjust_catalog_stock(uuid, numeric, text, text, text, jsonb) from public;
revoke all on function public.validate_catalog_orderability(uuid, uuid, uuid, numeric, text, text, text, jsonb) from public;

revoke all on function public.can_read_business_catalog(uuid) from anon;
revoke all on function public.can_manage_business_catalog(uuid, uuid) from anon;
revoke all on function public.record_catalog_runtime_event(uuid, text, text, uuid, uuid, uuid, text, text, jsonb) from anon;
revoke all on function public.resolve_catalog_module_id(text) from anon;
revoke all on function public.configure_catalog_unit(uuid, text, text, text, text, integer, text, text, text, jsonb) from anon;
revoke all on function public.configure_catalog_category(uuid, text, text, text, text, text, text, text, text, text, jsonb) from anon;
revoke all on function public.configure_catalog_item(uuid, uuid, text, text, text, text, text, text, text[], integer, numeric, numeric, text, text, text, jsonb) from anon;
revoke all on function public.configure_catalog_variant(uuid, text, text, text, text, numeric, text, text, text, jsonb) from anon;
revoke all on function public.configure_catalog_price(uuid, uuid, text, numeric, numeric, text, text, text, timestamptz, timestamptz, text, text, jsonb) from anon;
revoke all on function public.attach_catalog_item_media(uuid, uuid, uuid, integer, text, text, text, jsonb) from anon;
revoke all on function public.set_catalog_availability(uuid, uuid, uuid, text, jsonb, numeric, numeric, numeric, numeric, text, timestamptz, timestamptz, text, text, jsonb) from anon;
revoke all on function public.adjust_catalog_stock(uuid, numeric, text, text, text, jsonb) from anon;
revoke all on function public.validate_catalog_orderability(uuid, uuid, uuid, numeric, text, text, text, jsonb) from anon;

grant execute on function public.can_read_business_catalog(uuid) to authenticated, service_role;
grant execute on function public.can_manage_business_catalog(uuid, uuid) to authenticated, service_role;
grant execute on function public.configure_catalog_unit(uuid, text, text, text, text, integer, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.configure_catalog_category(uuid, text, text, text, text, text, text, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.configure_catalog_item(uuid, uuid, text, text, text, text, text, text, text[], integer, numeric, numeric, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.configure_catalog_variant(uuid, text, text, text, text, numeric, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.configure_catalog_price(uuid, uuid, text, numeric, numeric, text, text, text, timestamptz, timestamptz, text, text, jsonb) to authenticated, service_role;
grant execute on function public.attach_catalog_item_media(uuid, uuid, uuid, integer, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.set_catalog_availability(uuid, uuid, uuid, text, jsonb, numeric, numeric, numeric, numeric, text, timestamptz, timestamptz, text, text, jsonb) to authenticated, service_role;
grant execute on function public.adjust_catalog_stock(uuid, numeric, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.validate_catalog_orderability(uuid, uuid, uuid, numeric, text, text, text, jsonb) to authenticated, service_role;

commit;
