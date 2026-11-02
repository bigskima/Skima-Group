begin;

-- SKIMA Logistics is an independent marketplace module. It reuses platform identity,
-- organisation, driver, vehicle, geography and ledger engines without touching LPG/Fuel.

insert into public.permissions (key, description, risk_level)
values
  ('logistics.marketplace.manage', 'Manage logistics marketplace taxonomy, provider verification and marketplace governance.', 'critical'),
  ('logistics.marketplace.read', 'Read logistics marketplace administration and aggregate activity.', 'high'),
  ('business.logistics.company.manage', 'Manage this organisation logistics provider profile, services and coverage.', 'high'),
  ('business.logistics.company.read', 'Read this organisation logistics provider profile, services and coverage.', 'standard'),
  ('business.logistics.jobs.read', 'Read logistics job opportunities distributed to this organisation.', 'standard'),
  ('business.logistics.jobs.manage', 'Manage logistics job operations for this organisation.', 'high'),
  ('business.logistics.offers.manage', 'Submit and negotiate logistics offers for this organisation.', 'high'),
  ('business.logistics.finance.read', 'Read logistics booking fees and provider financial statements.', 'critical')
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    updated_at = timezone('utc', now());

insert into public.business_modules (key, display_name, description, status, metadata)
values (
  'logistics_network',
  'SKIMA Logistics',
  'Independent multi-provider logistics marketplace.',
  'active',
  jsonb_build_object(
    'category', 'logistics.marketplace',
    'core_platform_dependency', 'configuration_only',
    'runtime', jsonb_build_object(
      'enabled', true,
      'route_prefix', '/runtime/logistics',
      'edge_function', 'logistics-runtime'
    ),
    'application', jsonb_build_object(
      'slug', 'skima-logistics',
      'android_package', 'com.skima.logistics',
      'ios_bundle_identifier', 'com.skima.logistics'
    )
  )
)
on conflict (key) do update
set display_name = excluded.display_name,
    description = excluded.description,
    status = 'active',
    metadata = coalesce(public.business_modules.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = timezone('utc', now());

insert into public.business_module_versions (module_id, version, status, manifest)
select
  module.id,
  1,
  'active',
  jsonb_build_object(
    'moduleKey', 'logistics_network',
    'version', 1,
    'application', 'skima-logistics',
    'domain', 'provider_marketplace',
    'capabilities', jsonb_build_array(
      'provider_company_onboarding',
      'service_catalogue',
      'geographic_coverage',
      'customer_job_requests',
      'provider_opportunities',
      'offers_and_negotiation'
    ),
    'sharedEngines', jsonb_build_array(
      'identity', 'organizations', 'permissions', 'drivers', 'vehicles',
      'geography', 'dispatch', 'wallets', 'ledger', 'escrow',
      'financial_policies', 'notifications', 'tracking'
    ),
    'isolatedFrom', jsonb_build_array('lpg', 'fuel', 'store')
  )
from public.business_modules module
where module.key = 'logistics_network'
on conflict (module_id, version) do update
set status = 'active',
    manifest = excluded.manifest,
    updated_at = timezone('utc', now());

create table if not exists public.logistics_service_categories (
  id uuid primary key default gen_random_uuid(),
  parent_category_id uuid references public.logistics_service_categories(id) on delete restrict,
  key text not null unique check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 120),
  description text,
  status text not null default 'active'
    check (status in ('draft', 'active', 'suspended', 'retired')),
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.logistics_service_categories (key, display_name, description, sort_order, metadata)
values
  ('courier.parcel', 'Courier & Parcels', 'Documents, parcels and same-city courier delivery.', 10, '{"suggested":true}'::jsonb),
  ('goods.delivery', 'Goods & Item Delivery', 'Furniture, appliances, retail purchases and other goods.', 20, '{"suggested":true}'::jsonb),
  ('moving.relocation', 'Moving & Relocation', 'Home, office and small business relocation.', 30, '{"suggested":true}'::jsonb),
  ('freight.trucking', 'Freight & Trucking', 'Bulk cargo, commercial freight and truck transport.', 40, '{"suggested":true}'::jsonb),
  ('vehicle.transport', 'Vehicle Transport', 'Motorcycle, car and other vehicle transport.', 50, '{"suggested":true}'::jsonb),
  ('specialized.logistics', 'Specialized Logistics', 'Temperature-controlled, fragile and specialist cargo.', 60, '{"suggested":true}'::jsonb)
on conflict (key) do nothing;

create table if not exists public.logistics_provider_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete restrict,
  owner_user_id uuid not null references public.profiles(id) on delete restrict,
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'verified', 'rejected', 'suspended')),
  operational_status text not null default 'onboarding'
    check (operational_status in ('onboarding', 'active', 'paused', 'suspended', 'closed')),
  public_name text not null check (char_length(btrim(public_name)) between 2 and 160),
  about text,
  support_contact jsonb not null default '{}'::jsonb check (jsonb_typeof(support_contact) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  registration_idempotency_key text not null,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  verification_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_user_id, registration_idempotency_key),
  check ((verification_status = 'verified' and verified_at is not null) or verification_status <> 'verified')
);

create table if not exists public.logistics_provider_services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  category_id uuid not null references public.logistics_service_categories(id) on delete restrict,
  service_key text not null check (service_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 160),
  description text,
  pricing_mode text not null
    check (pricing_mode in ('fixed', 'distance', 'weight', 'time', 'capacity', 'negotiated', 'quote_required', 'hybrid')),
  capability_keys text[] not null default '{}',
  cargo_type_keys text[] not null default '{}',
  vehicle_type_keys text[] not null default '{}',
  maximum_weight_kg numeric(14,3) check (maximum_weight_kg is null or maximum_weight_kg > 0),
  maximum_volume_m3 numeric(14,4) check (maximum_volume_m3 is null or maximum_volume_m3 > 0),
  availability_enabled boolean not null default true,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'suspended', 'retired')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, service_key),
  unique (id, organization_id)
);

create table if not exists public.logistics_provider_coverage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  provider_service_id uuid not null,
  coverage_mode text not null check (coverage_mode in ('origin', 'destination', 'both', 'route')),
  geography_id uuid not null references public.geographies(id) on delete restrict,
  destination_geography_id uuid references public.geographies(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'paused', 'retired')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (provider_service_id, organization_id)
    references public.logistics_provider_services(id, organization_id) on delete cascade,
  check (
    (coverage_mode = 'route' and destination_geography_id is not null and destination_geography_id <> geography_id)
    or (coverage_mode <> 'route' and destination_geography_id is null)
  )
);

create table if not exists public.logistics_job_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references public.profiles(id) on delete restrict,
  category_id uuid not null references public.logistics_service_categories(id) on delete restrict,
  service_key text not null check (service_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  title text not null check (char_length(btrim(title)) between 3 and 180),
  description text,
  pickup_geography_id uuid not null references public.geographies(id) on delete restrict,
  destination_geography_id uuid not null references public.geographies(id) on delete restrict,
  pickup_location jsonb not null check (jsonb_typeof(pickup_location) = 'object'),
  destination_location jsonb not null check (jsonb_typeof(destination_location) = 'object'),
  cargo_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(cargo_snapshot) = 'object'),
  customer_contact_snapshot jsonb not null check (jsonb_typeof(customer_contact_snapshot) = 'object'),
  instructions text,
  requested_pickup_at timestamptz,
  status text not null default 'open'
    check (status in ('open', 'matching', 'offers_received', 'booking_pending', 'booked', 'in_progress', 'delivered', 'completed', 'cancelled', 'disputed', 'expired')),
  published_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (requester_user_id, idempotency_key)
);

create table if not exists public.logistics_job_opportunities (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.logistics_job_requests(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  provider_service_id uuid not null references public.logistics_provider_services(id) on delete restrict,
  status text not null default 'matched'
    check (status in ('matched', 'viewed', 'offered', 'selected', 'not_selected', 'declined', 'withdrawn', 'expired')),
  match_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(match_reasons) = 'array'),
  job_snapshot jsonb not null check (jsonb_typeof(job_snapshot) = 'object'),
  customer_contact_snapshot jsonb not null check (jsonb_typeof(customer_contact_snapshot) = 'object'),
  viewed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (job_id, organization_id)
);

create table if not exists public.logistics_offers (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.logistics_job_requests(id) on delete restrict,
  opportunity_id uuid not null references public.logistics_job_opportunities(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  parent_offer_id uuid references public.logistics_offers(id) on delete restrict,
  offer_type text not null check (offer_type in ('provider_quote', 'customer_counter', 'provider_counter')),
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  delivery_price_minor bigint not null check (delivery_price_minor > 0),
  estimated_duration_minutes integer check (estimated_duration_minutes is null or estimated_duration_minutes > 0),
  terms jsonb not null default '{}'::jsonb check (jsonb_typeof(terms) = 'object'),
  status text not null default 'submitted'
    check (status in ('submitted', 'countered', 'selected', 'not_selected', 'withdrawn', 'expired')),
  expires_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (created_by, idempotency_key)
);

create table if not exists public.logistics_negotiation_messages (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.logistics_job_requests(id) on delete restrict,
  opportunity_id uuid not null references public.logistics_job_opportunities(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  offer_id uuid references public.logistics_offers(id) on delete set null,
  sender_user_id uuid not null references public.profiles(id) on delete restrict,
  message text not null check (char_length(btrim(message)) between 1 and 3000),
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (sender_user_id, idempotency_key)
);

create table if not exists public.logistics_job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.logistics_job_requests(id) on delete restrict,
  actor_user_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  from_status text,
  to_status text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (job_id, idempotency_key)
);

create index if not exists logistics_provider_services_match_idx
  on public.logistics_provider_services (category_id, service_key, status, availability_enabled);
create index if not exists logistics_provider_coverage_match_idx
  on public.logistics_provider_coverage (geography_id, destination_geography_id, coverage_mode, status);
create unique index if not exists logistics_provider_coverage_identity_idx
  on public.logistics_provider_coverage (
    organization_id, provider_service_id, coverage_mode, geography_id,
    coalesce(destination_geography_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
create index if not exists logistics_job_requests_customer_idx
  on public.logistics_job_requests (requester_user_id, created_at desc);
create index if not exists logistics_job_opportunities_company_idx
  on public.logistics_job_opportunities (organization_id, status, created_at desc);
create index if not exists logistics_offers_job_idx
  on public.logistics_offers (job_id, created_at desc);
create index if not exists logistics_negotiation_messages_thread_idx
  on public.logistics_negotiation_messages (job_id, organization_id, created_at);

create or replace function public.can_manage_logistics_company(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_organization_id is not null
    and exists (
      select 1 from public.logistics_provider_profiles provider
      where provider.organization_id = target_organization_id
    )
    and (
      public.can_manage_organization_staff(target_organization_id)
      or public.has_permission('business.logistics.company.manage', target_organization_id)
    );
$$;

create or replace function public.can_read_logistics_company(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_organization_id is not null
    and exists (
      select 1 from public.logistics_provider_profiles provider
      where provider.organization_id = target_organization_id
    )
    and (
      public.can_manage_logistics_company(target_organization_id)
      or public.is_organization_member(target_organization_id)
      or public.has_permission('business.logistics.company.read', target_organization_id)
    );
$$;

create or replace function public.can_read_logistics_job(target_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.logistics_job_requests job
    where job.id = target_job_id
      and (
        job.requester_user_id = auth.uid()
        or public.has_permission('logistics.marketplace.read', null)
        or public.has_permission('logistics.marketplace.manage', null)
      )
  );
$$;

create or replace function public.record_logistics_job_event(
  target_job_id uuid,
  target_event_type text,
  target_idempotency_key text,
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
  event_id uuid;
begin
  if target_job_id is null
    or target_event_type is null
    or target_event_type !~ '^[a-z][a-z0-9_.:-]{2,120}$'
    or target_idempotency_key is null
    or btrim(target_idempotency_key) = ''
    or target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'valid logistics job event inputs are required';
  end if;

  insert into public.logistics_job_events (
    job_id, actor_user_id, event_type, from_status, to_status, idempotency_key, metadata
  )
  values (
    target_job_id, auth.uid(), target_event_type, target_from_status, target_to_status,
    target_idempotency_key, target_metadata
  )
  on conflict (job_id, idempotency_key) do nothing
  returning id into event_id;

  if event_id is null then
    select id into event_id
    from public.logistics_job_events
    where job_id = target_job_id and idempotency_key = target_idempotency_key;
  end if;

  return event_id;
end;
$$;

create or replace function public.register_logistics_company(
  target_display_name text,
  target_legal_name text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  organization_id uuid;
  provider_id uuid;
  role_id uuid;
  permission_ids uuid[];
  permission_keys text[] := array[
    'business.staff.manage',
    'business.logistics.company.manage',
    'business.logistics.company.read',
    'business.logistics.jobs.read',
    'business.logistics.jobs.manage',
    'business.logistics.offers.manage',
    'business.logistics.finance.read'
  ];
begin
  if actor is null then raise exception 'authentication is required'; end if;
  if target_display_name is null or char_length(btrim(target_display_name)) not between 2 and 160 then
    raise exception 'a valid company display name is required';
  end if;
  if target_legal_name is not null and char_length(btrim(target_legal_name)) > 200 then
    raise exception 'legal name is too long';
  end if;
  if target_idempotency_key is null or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'a valid idempotency key is required';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'metadata must be an object';
  end if;

  select provider.id into provider_id
  from public.logistics_provider_profiles provider
  where provider.owner_user_id = actor
    and provider.registration_idempotency_key = target_idempotency_key;

  if provider_id is not null then
    return provider_id;
  end if;

  insert into public.organizations (
    slug, legal_name, display_name, status, metadata, created_by
  )
  values (
    'logistics-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
    nullif(btrim(target_legal_name), ''),
    btrim(target_display_name),
    'pending',
    jsonb_build_object('business_kind', 'logistics_provider', 'product_module', 'logistics_network'),
    actor
  )
  returning id into organization_id;

  insert into public.organization_memberships (
    organization_id, user_id, membership_type, status, created_by,
    metadata
  )
  values (
    organization_id, actor, 'owner', 'active', actor,
    jsonb_build_object('source', 'logistics.company.registration')
  );

  insert into public.roles (organization_id, key, display_name, description, status, metadata, created_by)
  values (
    organization_id,
    'logistics.company.owner',
    'Logistics Company Owner',
    'Full control of this logistics provider organisation.',
    'active',
    '{"source":"logistics.company.registration","preset":"owner"}'::jsonb,
    actor
  )
  returning id into role_id;

  select array_agg(permission_record.id)
  into permission_ids
  from public.permissions permission_record
  where permission_record.key = any(permission_keys);

  if coalesce(array_length(permission_ids, 1), 0) <> array_length(permission_keys, 1) then
    raise exception 'required logistics company permissions are not configured';
  end if;

  insert into public.role_permissions (role_id, permission_id, conditions)
  select role_id, permission_id, '{}'::jsonb
  from unnest(permission_ids) as role_permission_ids(permission_id)
  on conflict do nothing;

  insert into public.user_roles (
    organization_id, user_id, role_id, status, starts_at, created_by, access_scope
  )
  values (
    organization_id, actor, role_id, 'active', timezone('utc', now()), actor,
    jsonb_build_object('module', 'logistics_network', 'scope', 'organization')
  )
  on conflict do nothing;

  insert into public.logistics_provider_profiles (
    organization_id, owner_user_id, verification_status, operational_status,
    public_name, metadata, registration_idempotency_key
  )
  values (
    organization_id, actor, 'pending', 'onboarding',
    btrim(target_display_name), target_metadata, target_idempotency_key
  )
  returning id into provider_id;

  return provider_id;
end;
$$;

create or replace function public.set_logistics_provider_verification(
  target_organization_id uuid,
  target_decision text,
  target_reason text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  provider_id uuid;
begin
  if not public.has_permission('logistics.marketplace.manage', null) then
    raise exception 'logistics marketplace administration permission is required';
  end if;
  if target_decision is null or target_decision not in ('verified', 'rejected', 'suspended') then
    raise exception 'verification decision is not supported';
  end if;
  if target_reason is null or char_length(btrim(target_reason)) < 5 then
    raise exception 'a verification reason is required';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'idempotency key is required';
  end if;

  update public.logistics_provider_profiles
  set verification_status = target_decision,
      operational_status = case
        when target_decision = 'verified' and operational_status = 'onboarding' then 'active'
        when target_decision in ('rejected', 'suspended') then 'suspended'
        else operational_status
      end,
      verified_by = case when target_decision = 'verified' then auth.uid() else verified_by end,
      verified_at = case when target_decision = 'verified' then timezone('utc', now()) else verified_at end,
      verification_reason = btrim(target_reason),
      updated_at = timezone('utc', now())
  where organization_id = target_organization_id
  returning id into provider_id;

  if provider_id is null then raise exception 'logistics provider company was not found'; end if;

  update public.organizations
  set status = case when target_decision = 'verified' then 'active' else status end,
      updated_at = timezone('utc', now())
  where id = target_organization_id;

  if target_decision = 'verified' then
    update public.logistics_provider_services
    set status = 'active', updated_at = timezone('utc', now())
    where organization_id = target_organization_id and status = 'draft';
  end if;

  return provider_id;
end;
$$;

create or replace function public.configure_logistics_provider_service(
  target_organization_id uuid,
  target_category_key text,
  target_service_key text,
  target_display_name text,
  target_description text,
  target_pricing_mode text,
  target_capability_keys text[] default '{}',
  target_cargo_type_keys text[] default '{}',
  target_vehicle_type_keys text[] default '{}',
  target_maximum_weight_kg numeric default null,
  target_maximum_volume_m3 numeric default null,
  target_availability_enabled boolean default true,
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  category_id uuid;
  service_id uuid;
  target_status text;
begin
  if not public.can_manage_logistics_company(target_organization_id) then
    raise exception 'logistics company management permission is required';
  end if;
  if target_category_key is null or target_service_key is null
    or target_service_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'valid logistics category and service keys are required';
  end if;
  if target_display_name is null or char_length(btrim(target_display_name)) not between 2 and 160 then
    raise exception 'service display name is required';
  end if;
  if target_pricing_mode is null or target_pricing_mode not in ('fixed', 'distance', 'weight', 'time', 'capacity', 'negotiated', 'quote_required', 'hybrid') then
    raise exception 'pricing mode is not supported';
  end if;
  if target_maximum_weight_kg is not null and target_maximum_weight_kg <= 0 then
    raise exception 'maximum weight must be positive';
  end if;
  if target_maximum_volume_m3 is not null and target_maximum_volume_m3 <= 0 then
    raise exception 'maximum volume must be positive';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'idempotency key is required';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'service metadata must be an object';
  end if;

  select id into category_id
  from public.logistics_service_categories
  where key = target_category_key and status = 'active';
  if category_id is null then raise exception 'active logistics service category is required'; end if;

  select case when verification_status = 'verified' and operational_status = 'active' then 'active' else 'draft' end
  into target_status
  from public.logistics_provider_profiles
  where organization_id = target_organization_id;
  if target_status is null then raise exception 'logistics provider profile was not found'; end if;

  insert into public.logistics_provider_services (
    organization_id, category_id, service_key, display_name, description, pricing_mode,
    capability_keys, cargo_type_keys, vehicle_type_keys, maximum_weight_kg, maximum_volume_m3,
    availability_enabled, status, metadata, created_by
  )
  values (
    target_organization_id, category_id, target_service_key, btrim(target_display_name),
    nullif(btrim(target_description), ''), target_pricing_mode,
    coalesce(target_capability_keys, '{}'), coalesce(target_cargo_type_keys, '{}'),
    coalesce(target_vehicle_type_keys, '{}'), target_maximum_weight_kg, target_maximum_volume_m3,
    coalesce(target_availability_enabled, true), target_status, target_metadata, auth.uid()
  )
  on conflict (organization_id, service_key) do update
  set category_id = excluded.category_id,
      display_name = excluded.display_name,
      description = excluded.description,
      pricing_mode = excluded.pricing_mode,
      capability_keys = excluded.capability_keys,
      cargo_type_keys = excluded.cargo_type_keys,
      vehicle_type_keys = excluded.vehicle_type_keys,
      maximum_weight_kg = excluded.maximum_weight_kg,
      maximum_volume_m3 = excluded.maximum_volume_m3,
      availability_enabled = excluded.availability_enabled,
      status = case
        when public.logistics_provider_services.status = 'suspended' then 'suspended'
        else excluded.status
      end,
      metadata = excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into service_id;

  return service_id;
end;
$$;

create or replace function public.configure_logistics_provider_coverage(
  target_organization_id uuid,
  target_service_key text,
  target_coverage_mode text,
  target_geography_id uuid,
  target_destination_geography_id uuid default null,
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider_service_id uuid;
  coverage_id uuid;
begin
  if not public.can_manage_logistics_company(target_organization_id) then
    raise exception 'logistics company management permission is required';
  end if;
  if target_coverage_mode is null or target_coverage_mode not in ('origin', 'destination', 'both', 'route') then
    raise exception 'coverage mode is not supported';
  end if;
  if target_coverage_mode = 'route' and (
    target_destination_geography_id is null
    or target_destination_geography_id = target_geography_id
  ) then
    raise exception 'route coverage requires different origin and destination geographies';
  end if;
  if target_coverage_mode <> 'route' and target_destination_geography_id is not null then
    raise exception 'destination geography is allowed only for route coverage';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'idempotency key is required';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'coverage metadata must be an object';
  end if;

  select id into v_provider_service_id
  from public.logistics_provider_services
  where organization_id = target_organization_id and service_key = target_service_key;
  if v_provider_service_id is null then raise exception 'provider service was not found'; end if;

  if not exists (select 1 from public.geographies where id = target_geography_id and status = 'active') then
    raise exception 'active origin geography is required';
  end if;
  if target_destination_geography_id is not null and not exists (
    select 1 from public.geographies where id = target_destination_geography_id and status = 'active'
  ) then
    raise exception 'active destination geography is required';
  end if;

  insert into public.logistics_provider_coverage (
    organization_id, provider_service_id, coverage_mode, geography_id,
    destination_geography_id, status, metadata, created_by
  )
  values (
    target_organization_id, v_provider_service_id, target_coverage_mode, target_geography_id,
    target_destination_geography_id, 'active', target_metadata, auth.uid()
  )
  on conflict do nothing
  returning id into coverage_id;

  if coverage_id is null then
    select id into coverage_id
    from public.logistics_provider_coverage
    where logistics_provider_coverage.organization_id = target_organization_id
      and logistics_provider_coverage.provider_service_id = v_provider_service_id
      and logistics_provider_coverage.coverage_mode = target_coverage_mode
      and geography_id = target_geography_id
      and destination_geography_id is not distinct from target_destination_geography_id
      and status = 'active'
    order by created_at desc limit 1;
  end if;

  return coverage_id;
end;
$$;

create or replace function public.create_logistics_job(
  target_payload jsonb,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  category_id uuid;
  pickup_geo_id uuid;
  destination_geo_id uuid;
  job_id uuid;
  existing_job public.logistics_job_requests%rowtype;
  request_title text;
  request_service_key text;
  match_count integer;
  event_status text;
begin
  if actor is null then raise exception 'authentication is required'; end if;
  if target_payload is null or jsonb_typeof(target_payload) <> 'object' then
    raise exception 'logistics job payload must be an object';
  end if;
  if target_idempotency_key is null or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'valid idempotency key is required';
  end if;

  select id into category_id
  from public.logistics_service_categories
  where key = target_payload->>'category_key' and status = 'active';
  if category_id is null then raise exception 'active logistics category is required'; end if;

  request_service_key := target_payload->>'service_key';
  if request_service_key is null or request_service_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'valid service key is required';
  end if;
  request_title := btrim(coalesce(target_payload->>'title', ''));
  if char_length(request_title) not between 3 and 180 then
    raise exception 'job title must contain 3 to 180 characters';
  end if;

  pickup_geo_id := nullif(target_payload #>> '{pickup,geography_id}', '')::uuid;
  destination_geo_id := nullif(target_payload #>> '{destination,geography_id}', '')::uuid;
  if pickup_geo_id is null or destination_geo_id is null then
    raise exception 'pickup and destination geography are required';
  end if;
  if not exists (select 1 from public.geographies where id = pickup_geo_id and status = 'active')
    or not exists (select 1 from public.geographies where id = destination_geo_id and status = 'active') then
    raise exception 'pickup and destination must reference active platform geographies';
  end if;
  if jsonb_typeof(target_payload->'pickup') <> 'object'
    or jsonb_typeof(target_payload->'destination') <> 'object'
    or jsonb_typeof(coalesce(target_payload->'cargo', '{}'::jsonb)) <> 'object'
    or jsonb_typeof(target_payload->'customer_contact') <> 'object' then
    raise exception 'pickup, destination, cargo and customer contact must be JSON objects';
  end if;
  if length(btrim(coalesce(target_payload #>> '{customer_contact,name}', ''))) < 2
    or (target_payload #>> '{customer_contact,phone}') !~ '^[+0-9][0-9 ()-]{6,22}
    raise exception 'customer contact name and phone are required';
  end if;

  select * into existing_job
  from public.logistics_job_requests
  where requester_user_id = actor and idempotency_key = target_idempotency_key;

  if found then
    if existing_job.category_id <> category_id
      or existing_job.service_key <> request_service_key
      or existing_job.title <> request_title
      or existing_job.pickup_location <> target_payload->'pickup'
      or existing_job.destination_location <> target_payload->'destination'
      or existing_job.cargo_snapshot <> coalesce(target_payload->'cargo', '{}'::jsonb)
      or existing_job.customer_contact_snapshot->>'phone' <> target_payload #>> '{customer_contact,phone}' then
      raise exception 'idempotency key was already used for a different logistics job';
    end if;
    return existing_job.id;
  end if;

  insert into public.logistics_job_requests (
    requester_user_id, category_id, service_key, title, description,
    pickup_geography_id, destination_geography_id, pickup_location, destination_location,
    cargo_snapshot, customer_contact_snapshot, instructions, requested_pickup_at,
    status, published_at, expires_at, metadata, idempotency_key
  )
  values (
    actor, category_id, request_service_key, request_title,
    nullif(btrim(target_payload->>'description'), ''),
    pickup_geo_id, destination_geo_id,
    target_payload->'pickup', target_payload->'destination',
    coalesce(target_payload->'cargo', '{}'::jsonb),
    jsonb_strip_nulls(jsonb_build_object(
      'name', btrim(target_payload #>> '{customer_contact,name}'),
      'phone', btrim(target_payload #>> '{customer_contact,phone}'),
      'email', nullif(lower(btrim(target_payload #>> '{customer_contact,email}')), ''),
      'contact_instructions', nullif(btrim(target_payload #>> '{customer_contact,contact_instructions}'), '')
    )),
    nullif(btrim(target_payload->>'instructions'), ''),
    nullif(target_payload->>'requested_pickup_at', '')::timestamptz,
    'open', timezone('utc', now()),
    timezone('utc', now()) + interval '7 days',
    coalesce(target_payload->'metadata', '{}'::jsonb),
    target_idempotency_key
  )
  returning id into job_id;

  insert into public.logistics_job_opportunities (
    job_id, organization_id, provider_service_id, status, match_reasons,
    job_snapshot, customer_contact_snapshot
  )
  select
    job_id,
    service.organization_id,
    service.id,
    'matched',
    jsonb_build_array('service_capability', 'pickup_coverage', 'destination_coverage', 'provider_verified'),
    jsonb_build_object(
      'job_id', job_id,
      'title', request_title,
      'description', nullif(btrim(target_payload->>'description'), ''),
      'service_key', request_service_key,
      'category_key', target_payload->>'category_key',
      'pickup', target_payload->'pickup',
      'destination', target_payload->'destination',
      'cargo', coalesce(target_payload->'cargo', '{}'::jsonb),
      'instructions', nullif(btrim(target_payload->>'instructions'), ''),
      'requested_pickup_at', nullif(target_payload->>'requested_pickup_at', '') 
    ),
    target_payload->'customer_contact'
  from public.logistics_provider_services service
  join public.logistics_provider_profiles provider
    on provider.organization_id = service.organization_id
  where service.category_id = category_id
    and service.service_key = request_service_key
    and service.status = 'active'
    and service.availability_enabled = true
    and provider.verification_status = 'verified'
    and provider.operational_status = 'active'
    and exists (
      select 1
      from public.logistics_provider_coverage origin
      where origin.provider_service_id = service.id
        and origin.status = 'active'
        and (
          (origin.coverage_mode in ('origin', 'both') and origin.geography_id = pickup_geo_id)
          or (origin.coverage_mode = 'route'
            and origin.geography_id = pickup_geo_id
            and origin.destination_geography_id = destination_geo_id)
          or (origin.coverage_mode = 'both' and origin.geography_id = pickup_geo_id)
        )
    )
    and exists (
      select 1
      from public.logistics_provider_coverage destination
      where destination.provider_service_id = service.id
        and destination.status = 'active'
        and (
          (destination.coverage_mode in ('destination', 'both') and destination.geography_id = destination_geo_id)
          or (destination.coverage_mode = 'route'
            and destination.geography_id = pickup_geo_id
            and destination.destination_geography_id = destination_geo_id)
        )
    )
    and (
      service.maximum_weight_kg is null
      or nullif(target_payload #>> '{cargo,weight_kg}', '') is null
      or service.maximum_weight_kg >= (target_payload #>> '{cargo,weight_kg}')::numeric
    )
    and (
      service.maximum_volume_m3 is null
      or nullif(target_payload #>> '{cargo,volume_m3}', '') is null
      or service.maximum_volume_m3 >= (target_payload #>> '{cargo,volume_m3}')::numeric
    )
    and (
      cardinality(service.cargo_type_keys) = 0
      or service.cargo_type_keys && array(
        select jsonb_array_elements_text(coalesce(target_payload #> '{cargo,cargo_type_keys}', '[]'::jsonb))
      )
    )
    and (
      cardinality(service.vehicle_type_keys) = 0
      or service.vehicle_type_keys && array(
        select jsonb_array_elements_text(coalesce(target_payload #> '{cargo,vehicle_type_keys}', '[]'::jsonb))
      )
    )
  on conflict (job_id, organization_id) do nothing;

  get diagnostics match_count = row_count;
  event_status := case when match_count > 0 then 'matching' else 'open' end;

  update public.logistics_job_requests
  set status = event_status, updated_at = timezone('utc', now())
  where id = job_id;

  perform public.record_logistics_job_event(
    job_id,
    case when match_count > 0 then 'logistics.job.distributed' else 'logistics.job.no_provider_match' end,
    target_idempotency_key || ':published',
    'draft',
    event_status,
    jsonb_build_object('matched_provider_count', match_count)
  );

  return job_id;
end;
$$;

create or replace function public.refresh_logistics_job_matches(
  target_job_id uuid,
  target_idempotency_key text
)
returns integer
language plpgsql
security definer
set search_path = public
as $
declare
  job public.logistics_job_requests%rowtype;
  added_count integer := 0;
begin
  if target_idempotency_key is null or char_length(btrim(target_idempotency_key)) < 8 then
    raise exception 'valid idempotency key is required';
  end if;

  select * into job
  from public.logistics_job_requests
  where id = target_job_id
  for update;
  if not found then raise exception 'logistics job was not found'; end if;

  if job.requester_user_id <> auth.uid()
    and not public.has_permission('logistics.marketplace.manage', null) then
    raise exception 'only the job customer or marketplace administrator may refresh matching';
  end if;
  if job.status not in ('open', 'matching', 'offers_received') then
    raise exception 'this logistics job is no longer accepting provider matches';
  end if;

  insert into public.logistics_job_opportunities (
    job_id, organization_id, provider_service_id, status, match_reasons,
    job_snapshot, customer_contact_snapshot
  )
  select
    job.id,
    service.organization_id,
    service.id,
    'matched',
    jsonb_build_array('service_capability', 'pickup_coverage', 'destination_coverage', 'provider_verified'),
    jsonb_build_object(
      'job_id', job.id,
      'title', job.title,
      'description', job.description,
      'service_key', job.service_key,
      'category_id', job.category_id,
      'pickup', job.pickup_location,
      'destination', job.destination_location,
      'cargo', job.cargo_snapshot,
      'instructions', job.instructions,
      'requested_pickup_at', job.requested_pickup_at
    ),
    job.customer_contact_snapshot
  from public.logistics_provider_services service
  join public.logistics_provider_profiles provider
    on provider.organization_id = service.organization_id
  where service.category_id = job.category_id
    and service.service_key = job.service_key
    and service.status = 'active'
    and service.availability_enabled = true
    and provider.verification_status = 'verified'
    and provider.operational_status = 'active'
    and exists (
      select 1 from public.logistics_provider_coverage origin
      where origin.provider_service_id = service.id
        and origin.status = 'active'
        and (
          (origin.coverage_mode in ('origin', 'both') and origin.geography_id = job.pickup_geography_id)
          or (origin.coverage_mode = 'route'
            and origin.geography_id = job.pickup_geography_id
            and origin.destination_geography_id = job.destination_geography_id)
        )
    )
    and exists (
      select 1 from public.logistics_provider_coverage destination
      where destination.provider_service_id = service.id
        and destination.status = 'active'
        and (
          (destination.coverage_mode in ('destination', 'both') and destination.geography_id = job.destination_geography_id)
          or (destination.coverage_mode = 'route'
            and destination.geography_id = job.pickup_geography_id
            and destination.destination_geography_id = job.destination_geography_id)
        )
    )
    and (
      service.maximum_weight_kg is null
      or nullif(job.cargo_snapshot->>'weight_kg', '') is null
      or service.maximum_weight_kg >= (job.cargo_snapshot->>'weight_kg')::numeric
    )
    and (
      service.maximum_volume_m3 is null
      or nullif(job.cargo_snapshot->>'volume_m3', '') is null
      or service.maximum_volume_m3 >= (job.cargo_snapshot->>'volume_m3')::numeric
    )
    and (
      cardinality(service.cargo_type_keys) = 0
      or service.cargo_type_keys && array(
        select jsonb_array_elements_text(coalesce(job.cargo_snapshot->'cargo_type_keys', '[]'::jsonb))
      )
    )
    and (
      cardinality(service.vehicle_type_keys) = 0
      or service.vehicle_type_keys && array(
        select jsonb_array_elements_text(coalesce(job.cargo_snapshot->'vehicle_type_keys', '[]'::jsonb))
      )
    )
  on conflict (job_id, organization_id) do nothing;

  get diagnostics added_count = row_count;

  if added_count > 0 and job.status in ('open', 'matching') then
    update public.logistics_job_requests
    set status = 'matching', updated_at = timezone('utc', now())
    where id = job.id;
  end if;

  perform public.record_logistics_job_event(
    job.id,
    'logistics.job.matching_refreshed',
    target_idempotency_key || ':event',
    job.status,
    case when added_count > 0 then 'matching' else job.status end,
    jsonb_build_object('additional_provider_matches', added_count)
  );

  return added_count;
end;
$;

create or replace function public.create_logistics_offer(
  target_opportunity_id uuid,
  target_currency_code text,
  target_delivery_price_minor bigint,
  target_estimated_duration_minutes integer,
  target_terms jsonb,
  target_expires_at timestamptz,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  opportunity public.logistics_job_opportunities%rowtype;
  job public.logistics_job_requests%rowtype;
  offer_id uuid;
begin
  select * into opportunity
  from public.logistics_job_opportunities
  where id = target_opportunity_id
  for update;
  if not found then raise exception 'logistics opportunity was not found'; end if;
  if not public.can_manage_logistics_company(opportunity.organization_id)
    and not public.has_permission('business.logistics.offers.manage', opportunity.organization_id) then
    raise exception 'offer management permission is required for this provider company';
  end if;
  select * into job from public.logistics_job_requests where id = opportunity.job_id for update;
  if job.status not in ('matching', 'offers_received') then
    raise exception 'this logistics job is no longer accepting provider offers';
  end if;
  if opportunity.status not in ('matched', 'viewed', 'offered') then
    raise exception 'this provider opportunity is no longer available';
  end if;
  if target_delivery_price_minor is null or target_delivery_price_minor <= 0 then
    raise exception 'delivery offer must be a positive minor-unit amount';
  end if;
  if target_currency_code is null or not exists (
    select 1 from public.currency_definitions
    where code = target_currency_code and status = 'enabled'
  ) then
    raise exception 'an enabled currency is required for a logistics offer';
  end if;
  if target_estimated_duration_minutes is not null and target_estimated_duration_minutes <= 0 then
    raise exception 'estimated duration must be positive';
  end if;
  if target_terms is null or jsonb_typeof(target_terms) <> 'object' then
    raise exception 'offer terms must be an object';
  end if;
  if target_idempotency_key is null or char_length(btrim(target_idempotency_key)) < 8 then
    raise exception 'valid idempotency key is required';
  end if;
  if target_expires_at is not null and target_expires_at <= timezone('utc', now()) then
    raise exception 'offer expiry must be in the future';
  end if;

  if exists (
    select 1 from public.logistics_offers
    where created_by = auth.uid() and idempotency_key = target_idempotency_key
  ) then
    select existing.id into offer_id
    from public.logistics_offers existing
    where existing.created_by = auth.uid() and existing.idempotency_key = target_idempotency_key
      and existing.opportunity_id = target_opportunity_id
      and existing.currency_code = target_currency_code
      and existing.delivery_price_minor = target_delivery_price_minor
      and existing.terms = target_terms;
    if offer_id is null then raise exception 'idempotency key was reused with different offer details'; end if;
    return offer_id;
  end if;

  if not exists (
    select 1 from public.logistics_provider_profiles
    where organization_id = opportunity.organization_id
      and verification_status = 'verified'
      and operational_status = 'active'
  ) then raise exception 'only verified, active providers may submit offers'; end if;

  insert into public.logistics_offers (
    job_id, opportunity_id, organization_id, offer_type, currency_code,
    delivery_price_minor, estimated_duration_minutes, terms, status,
    expires_at, created_by, idempotency_key
  )
  values (
    opportunity.job_id, opportunity.id, opportunity.organization_id, 'provider_quote',
    target_currency_code, target_delivery_price_minor, target_estimated_duration_minutes,
    target_terms, 'submitted', target_expires_at, auth.uid(), target_idempotency_key
  )
  returning id into offer_id;

  update public.logistics_job_opportunities
  set status = 'offered', updated_at = timezone('utc', now())
  where id = opportunity.id;

  update public.logistics_job_requests
  set status = 'offers_received', updated_at = timezone('utc', now())
  where id = job.id;

  perform public.record_logistics_job_event(
    job.id, 'logistics.offer.submitted', target_idempotency_key || ':event',
    job.status, 'offers_received',
    jsonb_build_object('offer_id', offer_id, 'provider_organization_id', opportunity.organization_id)
  );

  return offer_id;
end;
$$;

create or replace function public.counter_logistics_offer(
  target_parent_offer_id uuid,
  target_currency_code text,
  target_delivery_price_minor bigint,
  target_estimated_duration_minutes integer,
  target_terms jsonb,
  target_expires_at timestamptz,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_offer public.logistics_offers%rowtype;
  new_offer_id uuid;
  offer_type_value text;
begin
  select * into parent_offer
  from public.logistics_offers
  where id = target_parent_offer_id
  for update;
  if not found then raise exception 'offer to counter was not found'; end if;
  if parent_offer.status <> 'submitted' then
    raise exception 'only the latest open offer can be negotiated';
  end if;
  if target_delivery_price_minor is null or target_delivery_price_minor <= 0 then
    raise exception 'counteroffer must be a positive minor-unit amount';
  end if;
  if target_currency_code is null or not exists (
    select 1 from public.currency_definitions
    where code = target_currency_code and status = 'enabled'
  ) then
    raise exception 'an enabled currency is required for a counteroffer';
  end if;
  if target_terms is null or jsonb_typeof(target_terms) <> 'object' then
    raise exception 'counteroffer terms must be an object';
  end if;
  if target_idempotency_key is null or char_length(btrim(target_idempotency_key)) < 8 then
    raise exception 'valid idempotency key is required';
  end if;
  if target_expires_at is not null and target_expires_at <= timezone('utc', now()) then
    raise exception 'counteroffer expiry must be in the future';
  end if;

  if auth.uid() = (select requester_user_id from public.logistics_job_requests where id = parent_offer.job_id) then
    if parent_offer.offer_type = 'customer_counter' then
      raise exception 'the customer cannot counter their own latest offer';
    end if;
    offer_type_value := 'customer_counter';
  elsif public.can_manage_logistics_company(parent_offer.organization_id)
    or public.has_permission('business.logistics.offers.manage', parent_offer.organization_id) then
    if parent_offer.offer_type in ('provider_quote', 'provider_counter') then
      raise exception 'the provider cannot counter their own latest offer';
    end if;
    offer_type_value := 'provider_counter';
  else
    raise exception 'only the customer or matched provider may negotiate this offer';
  end if;

  if exists (select 1 from public.logistics_offers where created_by = auth.uid() and idempotency_key = target_idempotency_key) then
    select existing.id into new_offer_id
    from public.logistics_offers existing
    where existing.created_by = auth.uid()
      and existing.idempotency_key = target_idempotency_key
      and existing.parent_offer_id = parent_offer.id
      and existing.offer_type = offer_type_value
      and existing.currency_code = target_currency_code
      and existing.delivery_price_minor = target_delivery_price_minor
      and existing.terms = target_terms;
    if new_offer_id is null then
      raise exception 'idempotency key was reused with different counteroffer details';
    end if;
    return new_offer_id;
  end if;

  insert into public.logistics_offers (
    job_id, opportunity_id, organization_id, parent_offer_id, offer_type, currency_code,
    delivery_price_minor, estimated_duration_minutes, terms, status, expires_at,
    created_by, idempotency_key
  )
  values (
    parent_offer.job_id, parent_offer.opportunity_id, parent_offer.organization_id,
    parent_offer.id, offer_type_value, target_currency_code,
    target_delivery_price_minor, target_estimated_duration_minutes,
    target_terms, 'submitted', target_expires_at, auth.uid(), target_idempotency_key
  )
  returning id into new_offer_id;

  update public.logistics_offers
  set status = 'countered'
  where id = parent_offer.id;

  return new_offer_id;
end;
$$;

create or replace function public.add_logistics_negotiation_message(
  target_opportunity_id uuid,
  target_offer_id uuid,
  target_message text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  opportunity public.logistics_job_opportunities%rowtype;
  message_id uuid;
  requester_id uuid;
begin
  select * into opportunity
  from public.logistics_job_opportunities
  where id = target_opportunity_id;
  if not found then raise exception 'logistics opportunity was not found'; end if;

  select requester_user_id into requester_id
  from public.logistics_job_requests where id = opportunity.job_id;

  if auth.uid() <> requester_id
    and not public.can_read_logistics_company(opportunity.organization_id) then
    raise exception 'only the customer and matched provider may send negotiation messages';
  end if;
  if target_message is null or char_length(btrim(target_message)) not between 1 and 3000 then
    raise exception 'message must contain 1 to 3000 characters';
  end if;
  if target_idempotency_key is null or char_length(btrim(target_idempotency_key)) < 8 then
    raise exception 'valid idempotency key is required';
  end if;
  if target_offer_id is not null and not exists (
    select 1 from public.logistics_offers
    where id = target_offer_id and job_id = opportunity.job_id
      and opportunity_id = opportunity.id
  ) then raise exception 'message offer must belong to this opportunity'; end if;

  insert into public.logistics_negotiation_messages (
    job_id, opportunity_id, organization_id, offer_id, sender_user_id,
    message, idempotency_key
  )
  values (
    opportunity.job_id, opportunity.id, opportunity.organization_id, target_offer_id,
    auth.uid(), btrim(target_message), target_idempotency_key
  )
  on conflict (sender_user_id, idempotency_key) do nothing
  returning id into message_id;

  if message_id is null then
    select existing.id into message_id
    from public.logistics_negotiation_messages existing
    where existing.sender_user_id = auth.uid()
      and existing.idempotency_key = target_idempotency_key
      and existing.opportunity_id = opportunity.id
      and existing.offer_id is not distinct from target_offer_id
      and existing.message = btrim(target_message);
    if message_id is null then
      raise exception 'idempotency key was reused with different negotiation message details';
    end if;
  end if;

  return message_id;
end;
$$;

create or replace function public.select_logistics_offer(
  target_offer_id uuid,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_offer public.logistics_offers%rowtype;
  job public.logistics_job_requests%rowtype;
begin
  if target_idempotency_key is null or char_length(btrim(target_idempotency_key)) < 8 then
    raise exception 'valid idempotency key is required';
  end if;

  select * into selected_offer
  from public.logistics_offers
  where id = target_offer_id
  for update;
  if not found then raise exception 'logistics offer was not found'; end if;

  select * into job
  from public.logistics_job_requests
  where id = selected_offer.job_id
  for update;

  if exists (
    select 1
    from public.logistics_job_events event_record
    where event_record.job_id = job.id
      and event_record.idempotency_key = target_idempotency_key || ':event'
      and event_record.event_type = 'logistics.offer.selected'
  ) then
    if exists (
      select 1 from public.logistics_job_events event_record
      where event_record.job_id = job.id
        and event_record.idempotency_key = target_idempotency_key || ':event'
        and event_record.metadata->>'offer_id' = target_offer_id::text
    ) then
      return target_offer_id;
    end if;
    raise exception 'idempotency key was reused to select a different offer';
  end if;

  if job.requester_user_id <> auth.uid() then
    raise exception 'only the job customer may select a provider offer';
  end if;
  if job.status not in ('matching', 'offers_received') then
    raise exception 'job is not accepting offer selection';
  end if;
  if selected_offer.status <> 'submitted' then
    raise exception 'only the latest open offer may be selected';
  end if;
  if selected_offer.expires_at is not null and selected_offer.expires_at <= timezone('utc', now()) then
    raise exception 'selected offer has expired';
  end if;
  if not exists (
    select 1 from public.logistics_provider_profiles provider
    where provider.organization_id = selected_offer.organization_id
      and provider.verification_status = 'verified'
      and provider.operational_status = 'active'
  ) then raise exception 'provider is no longer eligible'; end if;

  update public.logistics_offers
  set status = case when id = target_offer_id then 'selected' else 'not_selected' end
  where job_id = job.id and status in ('submitted', 'countered');

  update public.logistics_job_opportunities
  set status = case when id = selected_offer.opportunity_id then 'selected' else 'not_selected' end,
      updated_at = timezone('utc', now())
  where job_id = job.id;

  update public.logistics_job_requests
  set status = 'booking_pending', updated_at = timezone('utc', now())
  where id = job.id;

  perform public.record_logistics_job_event(
    job.id,
    'logistics.offer.selected',
    target_idempotency_key || ':event',
    job.status,
    'booking_pending',
    jsonb_build_object(
      'offer_id', target_offer_id,
      'provider_organization_id', selected_offer.organization_id,
      'next_step', 'complete_booking_terms_and_payment'
    )
  );

  return target_offer_id;
end;
$$;

create or replace function public.update_logistics_provider_profile(
  target_organization_id uuid,
  target_about text,
  target_support_contact jsonb,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $
declare
  provider_id uuid;
begin
  if not public.can_manage_logistics_company(target_organization_id) then
    raise exception 'logistics company management permission is required';
  end if;
  if target_about is not null and char_length(target_about) > 2000 then
    raise exception 'company description is too long';
  end if;
  if target_support_contact is null or jsonb_typeof(target_support_contact) <> 'object'
    or target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'support contact and metadata must be JSON objects';
  end if;

  update public.logistics_provider_profiles
  set about = nullif(btrim(target_about), ''),
      support_contact = target_support_contact,
      metadata = metadata || target_metadata,
      updated_at = timezone('utc', now())
  where organization_id = target_organization_id
  returning id into provider_id;

  if provider_id is null then raise exception 'logistics provider profile was not found'; end if;
  return provider_id;
end;
$;

create or replace function public.set_logistics_provider_operational_status(
  target_organization_id uuid,
  target_status text,
  target_reason text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $
declare
  provider_id uuid;
begin
  if not public.can_manage_logistics_company(target_organization_id)
    and not public.has_permission('logistics.marketplace.manage', null) then
    raise exception 'logistics company management permission is required';
  end if;
  if target_status not in ('active', 'paused', 'closed') then
    raise exception 'provider operational status is not supported';
  end if;
  if target_reason is null or char_length(btrim(target_reason)) < 3
    or target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'a reason and idempotency key are required';
  end if;

  update public.logistics_provider_profiles
  set operational_status = case
        when target_status = 'active' and verification_status <> 'verified' then 'onboarding'
        else target_status
      end,
      updated_at = timezone('utc', now())
  where organization_id = target_organization_id
  returning id into provider_id;

  if provider_id is null then raise exception 'logistics provider profile was not found'; end if;
  return provider_id;
end;
$;

create or replace function public.upsert_logistics_service_category(
  target_key text,
  target_display_name text,
  target_parent_key text default null,
  target_description text default null,
  target_status text default 'active',
  target_sort_order integer default 100,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_id uuid;
  category_id uuid;
begin
  if not public.has_permission('logistics.marketplace.manage', null) then
    raise exception 'logistics marketplace administration permission is required';
  end if;
  if target_key is null or target_key !~ '^[a-z][a-z0-9_.:-]{2,120}$'
    or target_display_name is null or char_length(btrim(target_display_name)) not between 2 and 120 then
    raise exception 'valid category key and display name are required';
  end if;
  if target_status not in ('draft', 'active', 'suspended', 'retired') then
    raise exception 'category status is not supported';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'category metadata must be an object';
  end if;
  if target_parent_key is not null then
    select id into parent_id from public.logistics_service_categories where key = target_parent_key;
    if parent_id is null then raise exception 'parent logistics category was not found'; end if;
  end if;

  insert into public.logistics_service_categories (
    key, display_name, description, parent_category_id, status, sort_order, metadata, created_by
  )
  values (
    target_key, btrim(target_display_name), nullif(btrim(target_description), ''),
    parent_id, target_status, target_sort_order, target_metadata, auth.uid()
  )
  on conflict (key) do update
  set display_name = excluded.display_name,
      description = excluded.description,
      parent_category_id = excluded.parent_category_id,
      status = excluded.status,
      sort_order = excluded.sort_order,
      metadata = excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into category_id;

  return category_id;
end;
$$;

alter table public.logistics_service_categories enable row level security;
alter table public.logistics_provider_profiles enable row level security;
alter table public.logistics_provider_services enable row level security;
alter table public.logistics_provider_coverage enable row level security;
alter table public.logistics_job_requests enable row level security;
alter table public.logistics_job_opportunities enable row level security;
alter table public.logistics_offers enable row level security;
alter table public.logistics_negotiation_messages enable row level security;
alter table public.logistics_job_events enable row level security;

create policy logistics_categories_read_active_or_admin
on public.logistics_service_categories for select to authenticated
using (
  status = 'active'
  or public.has_permission('logistics.marketplace.read', null)
  or public.has_permission('logistics.marketplace.manage', null)
);
create policy logistics_categories_no_direct_insert
on public.logistics_service_categories for insert to authenticated with check (false);
create policy logistics_categories_no_direct_update
on public.logistics_service_categories for update to authenticated using (false) with check (false);
create policy logistics_categories_no_direct_delete
on public.logistics_service_categories for delete to authenticated using (false);

create policy logistics_provider_profiles_read_org_or_admin
on public.logistics_provider_profiles for select to authenticated
using (
  public.can_read_logistics_company(organization_id)
  or public.has_permission('logistics.marketplace.read', null)
  or public.has_permission('logistics.marketplace.manage', null)
);
create policy logistics_provider_profiles_no_direct_insert
on public.logistics_provider_profiles for insert to authenticated with check (false);
create policy logistics_provider_profiles_no_direct_update
on public.logistics_provider_profiles for update to authenticated using (false) with check (false);
create policy logistics_provider_profiles_no_direct_delete
on public.logistics_provider_profiles for delete to authenticated using (false);

create policy logistics_provider_services_read_org_or_admin
on public.logistics_provider_services for select to authenticated
using (
  public.can_read_logistics_company(organization_id)
  or public.has_permission('logistics.marketplace.read', null)
  or public.has_permission('logistics.marketplace.manage', null)
);
create policy logistics_provider_services_no_direct_insert
on public.logistics_provider_services for insert to authenticated with check (false);
create policy logistics_provider_services_no_direct_update
on public.logistics_provider_services for update to authenticated using (false) with check (false);
create policy logistics_provider_services_no_direct_delete
on public.logistics_provider_services for delete to authenticated using (false);

create policy logistics_provider_coverage_read_org_or_admin
on public.logistics_provider_coverage for select to authenticated
using (
  public.can_read_logistics_company(organization_id)
  or public.has_permission('logistics.marketplace.read', null)
  or public.has_permission('logistics.marketplace.manage', null)
);
create policy logistics_provider_coverage_no_direct_insert
on public.logistics_provider_coverage for insert to authenticated with check (false);
create policy logistics_provider_coverage_no_direct_update
on public.logistics_provider_coverage for update to authenticated using (false) with check (false);
create policy logistics_provider_coverage_no_direct_delete
on public.logistics_provider_coverage for delete to authenticated using (false);

create policy logistics_jobs_read_customer_or_admin
on public.logistics_job_requests for select to authenticated
using (
  requester_user_id = auth.uid()
  or public.has_permission('logistics.marketplace.read', null)
  or public.has_permission('logistics.marketplace.manage', null)
);
create policy logistics_jobs_no_direct_insert
on public.logistics_job_requests for insert to authenticated with check (false);
create policy logistics_jobs_no_direct_update
on public.logistics_job_requests for update to authenticated using (false) with check (false);
create policy logistics_jobs_no_direct_delete
on public.logistics_job_requests for delete to authenticated using (false);

create policy logistics_opportunities_read_matched_company
on public.logistics_job_opportunities for select to authenticated
using (
  public.can_read_logistics_company(organization_id)
  or public.has_permission('logistics.marketplace.manage', null)
);
create policy logistics_opportunities_no_direct_insert
on public.logistics_job_opportunities for insert to authenticated with check (false);
create policy logistics_opportunities_no_direct_update
on public.logistics_job_opportunities for update to authenticated using (false) with check (false);
create policy logistics_opportunities_no_direct_delete
on public.logistics_job_opportunities for delete to authenticated using (false);

create policy logistics_offers_read_customer_or_company
on public.logistics_offers for select to authenticated
using (
  public.can_read_logistics_job(job_id)
  or public.can_read_logistics_company(organization_id)
  or public.has_permission('logistics.marketplace.manage', null)
);
create policy logistics_offers_no_direct_insert
on public.logistics_offers for insert to authenticated with check (false);
create policy logistics_offers_no_direct_update
on public.logistics_offers for update to authenticated using (false) with check (false);
create policy logistics_offers_no_direct_delete
on public.logistics_offers for delete to authenticated using (false);

create policy logistics_messages_read_customer_or_company
on public.logistics_negotiation_messages for select to authenticated
using (
  public.can_read_logistics_job(job_id)
  or public.can_read_logistics_company(organization_id)
  or public.has_permission('logistics.marketplace.manage', null)
);
create policy logistics_messages_no_direct_insert
on public.logistics_negotiation_messages for insert to authenticated with check (false);
create policy logistics_messages_no_direct_update
on public.logistics_negotiation_messages for update to authenticated using (false) with check (false);
create policy logistics_messages_no_direct_delete
on public.logistics_negotiation_messages for delete to authenticated using (false);

create policy logistics_events_read_customer_or_company
on public.logistics_job_events for select to authenticated
using (
  public.can_read_logistics_job(job_id)
  or exists (
    select 1 from public.logistics_job_opportunities opportunity
    where opportunity.job_id = logistics_job_events.job_id
      and public.can_read_logistics_company(opportunity.organization_id)
  )
  or public.has_permission('logistics.marketplace.manage', null)
);
create policy logistics_events_no_direct_insert
on public.logistics_job_events for insert to authenticated with check (false);
create policy logistics_events_no_direct_update
on public.logistics_job_events for update to authenticated using (false) with check (false);
create policy logistics_events_no_direct_delete
on public.logistics_job_events for delete to authenticated using (false);

grant select on public.logistics_service_categories,
  public.logistics_provider_profiles,
  public.logistics_provider_services,
  public.logistics_provider_coverage,
  public.logistics_job_requests,
  public.logistics_job_opportunities,
  public.logistics_offers,
  public.logistics_negotiation_messages,
  public.logistics_job_events
to authenticated, service_role;

revoke all on function public.can_manage_logistics_company(uuid) from public, anon;
revoke all on function public.can_read_logistics_company(uuid) from public, anon;
revoke all on function public.can_read_logistics_job(uuid) from public, anon;
revoke all on function public.record_logistics_job_event(uuid, text, text, text, text, jsonb) from public, anon;
revoke all on function public.register_logistics_company(text, text, text, jsonb) from public, anon;
revoke all on function public.set_logistics_provider_verification(uuid, text, text, text) from public, anon;
revoke all on function public.update_logistics_provider_profile(uuid, text, jsonb, jsonb) from public, anon;
revoke all on function public.set_logistics_provider_operational_status(uuid, text, text, text) from public, anon;
revoke all on function public.update_logistics_provider_profile(uuid, text, jsonb, jsonb) from public, anon;
revoke all on function public.set_logistics_provider_operational_status(uuid, text, text, text) from public, anon;
revoke all on function public.configure_logistics_provider_service(uuid, text, text, text, text, text, text[], text[], text[], numeric, numeric, boolean, text, jsonb) from public, anon;
revoke all on function public.configure_logistics_provider_coverage(uuid, text, text, uuid, uuid, text, jsonb) from public, anon;
revoke all on function public.create_logistics_job(jsonb, text) from public, anon;
revoke all on function public.refresh_logistics_job_matches(uuid, text) from public, anon;
revoke all on function public.create_logistics_offer(uuid, text, bigint, integer, jsonb, timestamptz, text) from public, anon;
revoke all on function public.counter_logistics_offer(uuid, text, bigint, integer, jsonb, timestamptz, text) from public, anon;
revoke all on function public.add_logistics_negotiation_message(uuid, uuid, text, text) from public, anon;
revoke all on function public.select_logistics_offer(uuid, text) from public, anon;
revoke all on function public.upsert_logistics_service_category(text, text, text, text, text, integer, jsonb) from public, anon;

grant execute on function public.can_manage_logistics_company(uuid) to authenticated, service_role;
grant execute on function public.can_read_logistics_company(uuid) to authenticated, service_role;
grant execute on function public.can_read_logistics_job(uuid) to authenticated, service_role;
grant execute on function public.register_logistics_company(text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.set_logistics_provider_verification(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.update_logistics_provider_profile(uuid, text, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.set_logistics_provider_operational_status(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.update_logistics_provider_profile(uuid, text, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.set_logistics_provider_operational_status(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.configure_logistics_provider_service(uuid, text, text, text, text, text, text[], text[], text[], numeric, numeric, boolean, text, jsonb) to authenticated, service_role;
grant execute on function public.configure_logistics_provider_coverage(uuid, text, text, uuid, uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.create_logistics_job(jsonb, text) to authenticated, service_role;
grant execute on function public.refresh_logistics_job_matches(uuid, text) to authenticated, service_role;
grant execute on function public.create_logistics_offer(uuid, text, bigint, integer, jsonb, timestamptz, text) to authenticated, service_role;
grant execute on function public.counter_logistics_offer(uuid, text, bigint, integer, jsonb, timestamptz, text) to authenticated, service_role;
grant execute on function public.add_logistics_negotiation_message(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.select_logistics_offer(uuid, text) to authenticated, service_role;
grant execute on function public.upsert_logistics_service_category(text, text, text, text, text, integer, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
 then
    raise exception 'customer contact name and phone are required';
  end if;

  select * into existing_job
  from public.logistics_job_requests
  where requester_user_id = actor and idempotency_key = target_idempotency_key;

  if found then
    if existing_job.category_id <> category_id
      or existing_job.service_key <> request_service_key
      or existing_job.title <> request_title
      or existing_job.pickup_location <> target_payload->'pickup'
      or existing_job.destination_location <> target_payload->'destination'
      or existing_job.cargo_snapshot <> coalesce(target_payload->'cargo', '{}'::jsonb) then
      raise exception 'idempotency key was already used for a different logistics job';
    end if;
    return existing_job.id;
  end if;

  insert into public.logistics_job_requests (
    requester_user_id, category_id, service_key, title, description,
    pickup_geography_id, destination_geography_id, pickup_location, destination_location,
    cargo_snapshot, customer_contact_snapshot, instructions, requested_pickup_at,
    status, published_at, expires_at, metadata, idempotency_key
  )
  values (
    actor, category_id, request_service_key, request_title,
    nullif(btrim(target_payload->>'description'), ''),
    pickup_geo_id, destination_geo_id,
    target_payload->'pickup', target_payload->'destination',
    coalesce(target_payload->'cargo', '{}'::jsonb), target_payload->'customer_contact',
    nullif(btrim(target_payload->>'instructions'), ''),
    nullif(target_payload->>'requested_pickup_at', '')::timestamptz,
    'open', timezone('utc', now()),
    timezone('utc', now()) + interval '7 days',
    coalesce(target_payload->'metadata', '{}'::jsonb),
    target_idempotency_key
  )
  returning id into job_id;

  insert into public.logistics_job_opportunities (
    job_id, organization_id, provider_service_id, status, match_reasons,
    job_snapshot, customer_contact_snapshot
  )
  select
    job_id,
    service.organization_id,
    service.id,
    'matched',
    jsonb_build_array('service_capability', 'pickup_coverage', 'destination_coverage', 'provider_verified'),
    jsonb_build_object(
      'job_id', job_id,
      'title', request_title,
      'description', nullif(btrim(target_payload->>'description'), ''),
      'service_key', request_service_key,
      'category_key', target_payload->>'category_key',
      'pickup', target_payload->'pickup',
      'destination', target_payload->'destination',
      'cargo', coalesce(target_payload->'cargo', '{}'::jsonb),
      'instructions', nullif(btrim(target_payload->>'instructions'), ''),
      'requested_pickup_at', nullif(target_payload->>'requested_pickup_at', '') 
    ),
    target_payload->'customer_contact'
  from public.logistics_provider_services service
  join public.logistics_provider_profiles provider
    on provider.organization_id = service.organization_id
  where service.category_id = category_id
    and service.service_key = request_service_key
    and service.status = 'active'
    and service.availability_enabled = true
    and provider.verification_status = 'verified'
    and provider.operational_status = 'active'
    and exists (
      select 1
      from public.logistics_provider_coverage origin
      where origin.provider_service_id = service.id
        and origin.status = 'active'
        and (
          (origin.coverage_mode in ('origin', 'both') and origin.geography_id = pickup_geo_id)
          or (origin.coverage_mode = 'route'
            and origin.geography_id = pickup_geo_id
            and origin.destination_geography_id = destination_geo_id)
          or (origin.coverage_mode = 'both' and origin.geography_id = pickup_geo_id)
        )
    )
    and exists (
      select 1
      from public.logistics_provider_coverage destination
      where destination.provider_service_id = service.id
        and destination.status = 'active'
        and (
          (destination.coverage_mode in ('destination', 'both') and destination.geography_id = destination_geo_id)
          or (destination.coverage_mode = 'route'
            and destination.geography_id = pickup_geo_id
            and destination.destination_geography_id = destination_geo_id)
        )
    )
    and (
      service.maximum_weight_kg is null
      or nullif(target_payload #>> '{cargo,weight_kg}', '') is null
      or service.maximum_weight_kg >= (target_payload #>> '{cargo,weight_kg}')::numeric
    )
    and (
      service.maximum_volume_m3 is null
      or nullif(target_payload #>> '{cargo,volume_m3}', '') is null
      or service.maximum_volume_m3 >= (target_payload #>> '{cargo,volume_m3}')::numeric
    )
    and (
      cardinality(service.cargo_type_keys) = 0
      or service.cargo_type_keys && array(
        select jsonb_array_elements_text(coalesce(target_payload #> '{cargo,cargo_type_keys}', '[]'::jsonb))
      )
    )
  on conflict (job_id, organization_id) do nothing;

  get diagnostics match_count = row_count;
  event_status := case when match_count > 0 then 'matching' else 'open' end;

  update public.logistics_job_requests
  set status = event_status, updated_at = timezone('utc', now())
  where id = job_id;

  perform public.record_logistics_job_event(
    job_id,
    case when match_count > 0 then 'logistics.job.distributed' else 'logistics.job.no_provider_match' end,
    target_idempotency_key || ':published',
    'draft',
    event_status,
    jsonb_build_object('matched_provider_count', match_count)
  );

  return job_id;
end;
$$;

create or replace function public.create_logistics_offer(
  target_opportunity_id uuid,
  target_currency_code text,
  target_delivery_price_minor bigint,
  target_estimated_duration_minutes integer,
  target_terms jsonb,
  target_expires_at timestamptz,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  opportunity public.logistics_job_opportunities%rowtype;
  job public.logistics_job_requests%rowtype;
  offer_id uuid;
begin
  select * into opportunity
  from public.logistics_job_opportunities
  where id = target_opportunity_id
  for update;
  if not found then raise exception 'logistics opportunity was not found'; end if;
  if not public.can_manage_logistics_company(opportunity.organization_id)
    and not public.has_permission('business.logistics.offers.manage', opportunity.organization_id) then
    raise exception 'offer management permission is required for this provider company';
  end if;
  select * into job from public.logistics_job_requests where id = opportunity.job_id for update;
  if job.status not in ('matching', 'offers_received') then
    raise exception 'this logistics job is no longer accepting provider offers';
  end if;
  if opportunity.status not in ('matched', 'viewed', 'offered') then
    raise exception 'this provider opportunity is no longer available';
  end if;
  if target_delivery_price_minor is null or target_delivery_price_minor <= 0 then
    raise exception 'delivery offer must be a positive minor-unit amount';
  end if;
  if target_currency_code is null or not exists (
    select 1 from public.currency_definitions
    where code = target_currency_code and status = 'enabled'
  ) then
    raise exception 'an enabled currency is required for a logistics offer';
  end if;
  if target_estimated_duration_minutes is not null and target_estimated_duration_minutes <= 0 then
    raise exception 'estimated duration must be positive';
  end if;
  if target_terms is null or jsonb_typeof(target_terms) <> 'object' then
    raise exception 'offer terms must be an object';
  end if;
  if target_idempotency_key is null or char_length(btrim(target_idempotency_key)) < 8 then
    raise exception 'valid idempotency key is required';
  end if;
  if target_expires_at is not null and target_expires_at <= timezone('utc', now()) then
    raise exception 'offer expiry must be in the future';
  end if;

  if exists (
    select 1 from public.logistics_offers
    where created_by = auth.uid() and idempotency_key = target_idempotency_key
  ) then
    select id into offer_id from public.logistics_offers
    where created_by = auth.uid() and idempotency_key = target_idempotency_key;
    return offer_id;
  end if;

  if not exists (
    select 1 from public.logistics_provider_profiles
    where organization_id = opportunity.organization_id
      and verification_status = 'verified'
      and operational_status = 'active'
  ) then raise exception 'only verified, active providers may submit offers'; end if;

  insert into public.logistics_offers (
    job_id, opportunity_id, organization_id, offer_type, currency_code,
    delivery_price_minor, estimated_duration_minutes, terms, status,
    expires_at, created_by, idempotency_key
  )
  values (
    opportunity.job_id, opportunity.id, opportunity.organization_id, 'provider_quote',
    target_currency_code, target_delivery_price_minor, target_estimated_duration_minutes,
    target_terms, 'submitted', target_expires_at, auth.uid(), target_idempotency_key
  )
  returning id into offer_id;

  update public.logistics_job_opportunities
  set status = 'offered', updated_at = timezone('utc', now())
  where id = opportunity.id;

  update public.logistics_job_requests
  set status = 'offers_received', updated_at = timezone('utc', now())
  where id = job.id;

  perform public.record_logistics_job_event(
    job.id, 'logistics.offer.submitted', target_idempotency_key || ':event',
    job.status, 'offers_received',
    jsonb_build_object('offer_id', offer_id, 'provider_organization_id', opportunity.organization_id)
  );

  return offer_id;
end;
$$;

create or replace function public.counter_logistics_offer(
  target_parent_offer_id uuid,
  target_currency_code text,
  target_delivery_price_minor bigint,
  target_estimated_duration_minutes integer,
  target_terms jsonb,
  target_expires_at timestamptz,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_offer public.logistics_offers%rowtype;
  new_offer_id uuid;
  offer_type_value text;
begin
  select * into parent_offer
  from public.logistics_offers
  where id = target_parent_offer_id
  for update;
  if not found then raise exception 'offer to counter was not found'; end if;
  if parent_offer.status not in ('submitted', 'countered') then
    raise exception 'this offer is no longer open for negotiation';
  end if;
  if target_delivery_price_minor is null or target_delivery_price_minor <= 0 then
    raise exception 'counteroffer must be a positive minor-unit amount';
  end if;
  if target_currency_code is null or not exists (
    select 1 from public.currency_definitions
    where code = target_currency_code and status = 'enabled'
  ) then
    raise exception 'an enabled currency is required for a counteroffer';
  end if;
  if target_terms is null or jsonb_typeof(target_terms) <> 'object' then
    raise exception 'counteroffer terms must be an object';
  end if;
  if target_idempotency_key is null or char_length(btrim(target_idempotency_key)) < 8 then
    raise exception 'valid idempotency key is required';
  end if;
  if target_expires_at is not null and target_expires_at <= timezone('utc', now()) then
    raise exception 'counteroffer expiry must be in the future';
  end if;

  if auth.uid() = (select requester_user_id from public.logistics_job_requests where id = parent_offer.job_id) then
    offer_type_value := 'customer_counter';
  elsif public.can_manage_logistics_company(parent_offer.organization_id)
    or public.has_permission('business.logistics.offers.manage', parent_offer.organization_id) then
    offer_type_value := 'provider_counter';
  else
    raise exception 'only the customer or matched provider may negotiate this offer';
  end if;

  if exists (select 1 from public.logistics_offers where created_by = auth.uid() and idempotency_key = target_idempotency_key) then
    select id into new_offer_id from public.logistics_offers
    where created_by = auth.uid() and idempotency_key = target_idempotency_key;
    return new_offer_id;
  end if;

  insert into public.logistics_offers (
    job_id, opportunity_id, organization_id, parent_offer_id, offer_type, currency_code,
    delivery_price_minor, estimated_duration_minutes, terms, status, expires_at,
    created_by, idempotency_key
  )
  values (
    parent_offer.job_id, parent_offer.opportunity_id, parent_offer.organization_id,
    parent_offer.id, offer_type_value, target_currency_code,
    target_delivery_price_minor, target_estimated_duration_minutes,
    target_terms, 'submitted', target_expires_at, auth.uid(), target_idempotency_key
  )
  returning id into new_offer_id;

  update public.logistics_offers
  set status = 'countered'
  where id = parent_offer.id;

  return new_offer_id;
end;
$$;

create or replace function public.add_logistics_negotiation_message(
  target_opportunity_id uuid,
  target_offer_id uuid,
  target_message text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  opportunity public.logistics_job_opportunities%rowtype;
  message_id uuid;
  requester_id uuid;
begin
  select * into opportunity
  from public.logistics_job_opportunities
  where id = target_opportunity_id;
  if not found then raise exception 'logistics opportunity was not found'; end if;

  select requester_user_id into requester_id
  from public.logistics_job_requests where id = opportunity.job_id;

  if auth.uid() <> requester_id
    and not public.can_read_logistics_company(opportunity.organization_id) then
    raise exception 'only the customer and matched provider may send negotiation messages';
  end if;
  if target_message is null or char_length(btrim(target_message)) not between 1 and 3000 then
    raise exception 'message must contain 1 to 3000 characters';
  end if;
  if target_idempotency_key is null or char_length(btrim(target_idempotency_key)) < 8 then
    raise exception 'valid idempotency key is required';
  end if;
  if target_offer_id is not null and not exists (
    select 1 from public.logistics_offers
    where id = target_offer_id and job_id = opportunity.job_id
      and opportunity_id = opportunity.id
  ) then raise exception 'message offer must belong to this opportunity'; end if;

  insert into public.logistics_negotiation_messages (
    job_id, opportunity_id, organization_id, offer_id, sender_user_id,
    message, idempotency_key
  )
  values (
    opportunity.job_id, opportunity.id, opportunity.organization_id, target_offer_id,
    auth.uid(), btrim(target_message), target_idempotency_key
  )
  on conflict (sender_user_id, idempotency_key) do nothing
  returning id into message_id;

  if message_id is null then
    select id into message_id
    from public.logistics_negotiation_messages
    where sender_user_id = auth.uid() and idempotency_key = target_idempotency_key;
  end if;

  return message_id;
end;
$$;

create or replace function public.select_logistics_offer(
  target_offer_id uuid,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_offer public.logistics_offers%rowtype;
  job public.logistics_job_requests%rowtype;
begin
  if target_idempotency_key is null or char_length(btrim(target_idempotency_key)) < 8 then
    raise exception 'valid idempotency key is required';
  end if;

  select * into selected_offer
  from public.logistics_offers
  where id = target_offer_id
  for update;
  if not found then raise exception 'logistics offer was not found'; end if;

  select * into job
  from public.logistics_job_requests
  where id = selected_offer.job_id
  for update;

  if job.requester_user_id <> auth.uid() then
    raise exception 'only the job customer may select a provider offer';
  end if;
  if job.status not in ('matching', 'offers_received') then
    raise exception 'job is not accepting offer selection';
  end if;
  if selected_offer.status not in ('submitted', 'countered') then
    raise exception 'selected offer is no longer available';
  end if;
  if selected_offer.expires_at is not null and selected_offer.expires_at <= timezone('utc', now()) then
    raise exception 'selected offer has expired';
  end if;
  if not exists (
    select 1 from public.logistics_provider_profiles provider
    where provider.organization_id = selected_offer.organization_id
      and provider.verification_status = 'verified'
      and provider.operational_status = 'active'
  ) then raise exception 'provider is no longer eligible'; end if;

  update public.logistics_offers
  set status = case when id = target_offer_id then 'selected' else 'not_selected' end
  where job_id = job.id and status in ('submitted', 'countered');

  update public.logistics_job_opportunities
  set status = case when id = selected_offer.opportunity_id then 'selected' else 'not_selected' end,
      updated_at = timezone('utc', now())
  where job_id = job.id;

  update public.logistics_job_requests
  set status = 'booking_pending', updated_at = timezone('utc', now())
  where id = job.id;

  perform public.record_logistics_job_event(
    job.id,
    'logistics.offer.selected',
    target_idempotency_key || ':event',
    job.status,
    'booking_pending',
    jsonb_build_object(
      'offer_id', target_offer_id,
      'provider_organization_id', selected_offer.organization_id,
      'next_step', 'complete_booking_terms_and_payment'
    )
  );

  return target_offer_id;
end;
$$;

create or replace function public.upsert_logistics_service_category(
  target_key text,
  target_display_name text,
  target_parent_key text default null,
  target_description text default null,
  target_status text default 'active',
  target_sort_order integer default 100,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_id uuid;
  category_id uuid;
begin
  if not public.has_permission('logistics.marketplace.manage', null) then
    raise exception 'logistics marketplace administration permission is required';
  end if;
  if target_key is null or target_key !~ '^[a-z][a-z0-9_.:-]{2,120}$'
    or target_display_name is null or char_length(btrim(target_display_name)) not between 2 and 120 then
    raise exception 'valid category key and display name are required';
  end if;
  if target_status not in ('draft', 'active', 'suspended', 'retired') then
    raise exception 'category status is not supported';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'category metadata must be an object';
  end if;
  if target_parent_key is not null then
    select id into parent_id from public.logistics_service_categories where key = target_parent_key;
    if parent_id is null then raise exception 'parent logistics category was not found'; end if;
  end if;

  insert into public.logistics_service_categories (
    key, display_name, description, parent_category_id, status, sort_order, metadata, created_by
  )
  values (
    target_key, btrim(target_display_name), nullif(btrim(target_description), ''),
    parent_id, target_status, target_sort_order, target_metadata, auth.uid()
  )
  on conflict (key) do update
  set display_name = excluded.display_name,
      description = excluded.description,
      parent_category_id = excluded.parent_category_id,
      status = excluded.status,
      sort_order = excluded.sort_order,
      metadata = excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into category_id;

  return category_id;
end;
$$;

alter table public.logistics_service_categories enable row level security;
alter table public.logistics_provider_profiles enable row level security;
alter table public.logistics_provider_services enable row level security;
alter table public.logistics_provider_coverage enable row level security;
alter table public.logistics_job_requests enable row level security;
alter table public.logistics_job_opportunities enable row level security;
alter table public.logistics_offers enable row level security;
alter table public.logistics_negotiation_messages enable row level security;
alter table public.logistics_job_events enable row level security;

create policy logistics_categories_read_active_or_admin
on public.logistics_service_categories for select to authenticated
using (
  status = 'active'
  or public.has_permission('logistics.marketplace.manage', null)
);
create policy logistics_categories_no_direct_insert
on public.logistics_service_categories for insert to authenticated with check (false);
create policy logistics_categories_no_direct_update
on public.logistics_service_categories for update to authenticated using (false) with check (false);
create policy logistics_categories_no_direct_delete
on public.logistics_service_categories for delete to authenticated using (false);

create policy logistics_provider_profiles_read_org_or_admin
on public.logistics_provider_profiles for select to authenticated
using (
  public.can_read_logistics_company(organization_id)
  or public.has_permission('logistics.marketplace.read', null)
  or public.has_permission('logistics.marketplace.manage', null)
);
create policy logistics_provider_profiles_no_direct_insert
on public.logistics_provider_profiles for insert to authenticated with check (false);
create policy logistics_provider_profiles_no_direct_update
on public.logistics_provider_profiles for update to authenticated using (false) with check (false);
create policy logistics_provider_profiles_no_direct_delete
on public.logistics_provider_profiles for delete to authenticated using (false);

create policy logistics_provider_services_read_org_or_admin
on public.logistics_provider_services for select to authenticated
using (
  public.can_read_logistics_company(organization_id)
  or public.has_permission('logistics.marketplace.read', null)
  or public.has_permission('logistics.marketplace.manage', null)
);
create policy logistics_provider_services_no_direct_insert
on public.logistics_provider_services for insert to authenticated with check (false);
create policy logistics_provider_services_no_direct_update
on public.logistics_provider_services for update to authenticated using (false) with check (false);
create policy logistics_provider_services_no_direct_delete
on public.logistics_provider_services for delete to authenticated using (false);

create policy logistics_provider_coverage_read_org_or_admin
on public.logistics_provider_coverage for select to authenticated
using (
  public.can_read_logistics_company(organization_id)
  or public.has_permission('logistics.marketplace.read', null)
  or public.has_permission('logistics.marketplace.manage', null)
);
create policy logistics_provider_coverage_no_direct_insert
on public.logistics_provider_coverage for insert to authenticated with check (false);
create policy logistics_provider_coverage_no_direct_update
on public.logistics_provider_coverage for update to authenticated using (false) with check (false);
create policy logistics_provider_coverage_no_direct_delete
on public.logistics_provider_coverage for delete to authenticated using (false);

create policy logistics_jobs_read_customer_or_admin
on public.logistics_job_requests for select to authenticated
using (
  requester_user_id = auth.uid()
  or public.has_permission('logistics.marketplace.read', null)
  or public.has_permission('logistics.marketplace.manage', null)
);
create policy logistics_jobs_no_direct_insert
on public.logistics_job_requests for insert to authenticated with check (false);
create policy logistics_jobs_no_direct_update
on public.logistics_job_requests for update to authenticated using (false) with check (false);
create policy logistics_jobs_no_direct_delete
on public.logistics_job_requests for delete to authenticated using (false);

create policy logistics_opportunities_read_matched_company
on public.logistics_job_opportunities for select to authenticated
using (
  public.can_read_logistics_company(organization_id)
  or public.has_permission('logistics.marketplace.manage', null)
);
create policy logistics_opportunities_no_direct_insert
on public.logistics_job_opportunities for insert to authenticated with check (false);
create policy logistics_opportunities_no_direct_update
on public.logistics_job_opportunities for update to authenticated using (false) with check (false);
create policy logistics_opportunities_no_direct_delete
on public.logistics_job_opportunities for delete to authenticated using (false);

create policy logistics_offers_read_customer_or_company
on public.logistics_offers for select to authenticated
using (
  public.can_read_logistics_job(job_id)
  or public.can_read_logistics_company(organization_id)
  or public.has_permission('logistics.marketplace.manage', null)
);
create policy logistics_offers_no_direct_insert
on public.logistics_offers for insert to authenticated with check (false);
create policy logistics_offers_no_direct_update
on public.logistics_offers for update to authenticated using (false) with check (false);
create policy logistics_offers_no_direct_delete
on public.logistics_offers for delete to authenticated using (false);

create policy logistics_messages_read_customer_or_company
on public.logistics_negotiation_messages for select to authenticated
using (
  public.can_read_logistics_job(job_id)
  or public.can_read_logistics_company(organization_id)
  or public.has_permission('logistics.marketplace.manage', null)
);
create policy logistics_messages_no_direct_insert
on public.logistics_negotiation_messages for insert to authenticated with check (false);
create policy logistics_messages_no_direct_update
on public.logistics_negotiation_messages for update to authenticated using (false) with check (false);
create policy logistics_messages_no_direct_delete
on public.logistics_negotiation_messages for delete to authenticated using (false);

create policy logistics_events_read_customer_or_company
on public.logistics_job_events for select to authenticated
using (
  public.can_read_logistics_job(job_id)
  or exists (
    select 1 from public.logistics_job_opportunities opportunity
    where opportunity.job_id = logistics_job_events.job_id
      and public.can_read_logistics_company(opportunity.organization_id)
  )
  or public.has_permission('logistics.marketplace.manage', null)
);
create policy logistics_events_no_direct_insert
on public.logistics_job_events for insert to authenticated with check (false);
create policy logistics_events_no_direct_update
on public.logistics_job_events for update to authenticated using (false) with check (false);
create policy logistics_events_no_direct_delete
on public.logistics_job_events for delete to authenticated using (false);

grant select on public.logistics_service_categories,
  public.logistics_provider_profiles,
  public.logistics_provider_services,
  public.logistics_provider_coverage,
  public.logistics_job_requests,
  public.logistics_job_opportunities,
  public.logistics_offers,
  public.logistics_negotiation_messages,
  public.logistics_job_events
to authenticated, service_role;

revoke all on function public.can_manage_logistics_company(uuid) from public, anon;
revoke all on function public.can_read_logistics_company(uuid) from public, anon;
revoke all on function public.can_read_logistics_job(uuid) from public, anon;
revoke all on function public.record_logistics_job_event(uuid, text, text, text, text, jsonb) from public, anon;
revoke all on function public.register_logistics_company(text, text, text, jsonb) from public, anon;
revoke all on function public.set_logistics_provider_verification(uuid, text, text, text) from public, anon;
revoke all on function public.configure_logistics_provider_service(uuid, text, text, text, text, text, text[], text[], text[], numeric, numeric, boolean, text, jsonb) from public, anon;
revoke all on function public.configure_logistics_provider_coverage(uuid, text, text, uuid, uuid, text, jsonb) from public, anon;
revoke all on function public.create_logistics_job(jsonb, text) from public, anon;
revoke all on function public.create_logistics_offer(uuid, text, bigint, integer, jsonb, timestamptz, text) from public, anon;
revoke all on function public.counter_logistics_offer(uuid, text, bigint, integer, jsonb, timestamptz, text) from public, anon;
revoke all on function public.add_logistics_negotiation_message(uuid, uuid, text, text) from public, anon;
revoke all on function public.select_logistics_offer(uuid, text) from public, anon;
revoke all on function public.upsert_logistics_service_category(text, text, text, text, text, integer, jsonb) from public, anon;

grant execute on function public.can_manage_logistics_company(uuid) to authenticated, service_role;
grant execute on function public.can_read_logistics_company(uuid) to authenticated, service_role;
grant execute on function public.can_read_logistics_job(uuid) to authenticated, service_role;
grant execute on function public.register_logistics_company(text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.set_logistics_provider_verification(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.configure_logistics_provider_service(uuid, text, text, text, text, text, text[], text[], text[], numeric, numeric, boolean, text, jsonb) to authenticated, service_role;
grant execute on function public.configure_logistics_provider_coverage(uuid, text, text, uuid, uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.create_logistics_job(jsonb, text) to authenticated, service_role;
grant execute on function public.create_logistics_offer(uuid, text, bigint, integer, jsonb, timestamptz, text) to authenticated, service_role;
grant execute on function public.counter_logistics_offer(uuid, text, bigint, integer, jsonb, timestamptz, text) to authenticated, service_role;
grant execute on function public.add_logistics_negotiation_message(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.select_logistics_offer(uuid, text) to authenticated, service_role;
grant execute on function public.upsert_logistics_service_category(text, text, text, text, text, integer, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
