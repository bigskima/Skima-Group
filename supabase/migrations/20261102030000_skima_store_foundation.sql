begin;

insert into public.permissions (key, description, risk_level)
values
  ('platform.catalog.read', 'Read platform-managed Store catalogue records.', 'standard'),
  ('platform.catalog.manage', 'Manage platform-managed Store catalogue, pricing, and availability.', 'high'),
  ('platform.store.read', 'Read SKIMA Store settings, products, and orders.', 'standard'),
  ('platform.store.manage', 'Configure the SKIMA Store operating organisation and products.', 'high')
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    updated_at = timezone('utc', now());

insert into public.role_permissions (role_id, permission_id)
select role_record.id, permission_record.id
from public.roles role_record
cross join public.permissions permission_record
where role_record.organization_id is null
  and role_record.key in ('platform.admin', 'platform.module_admin')
  and permission_record.key in (
    'platform.catalog.read',
    'platform.catalog.manage',
    'platform.store.read',
    'platform.store.manage'
  )
on conflict do nothing;

insert into public.event_types (key, description, schema, status)
values
  ('event.store.order.accepted', 'A Store order was accepted by its operating organisation.', '{}'::jsonb, 'active'),
  ('event.store.order.preparing', 'A Store order entered preparation.', '{}'::jsonb, 'active'),
  ('event.store.order.ready', 'A Store order is ready for handoff or collection.', '{}'::jsonb, 'active'),
  ('event.store.order.completed', 'A Store order was completed.', '{}'::jsonb, 'active')
on conflict (key) do update
set description = excluded.description,
    schema = excluded.schema,
    status = excluded.status,
    updated_at = timezone('utc', now());

insert into public.business_modules (key, display_name, description, status, metadata)
values (
  'store',
  'SKIMA Store',
  'SKIMA direct commerce catalogue and order workflow. Products use shared catalogue, pricing, stock, and order engines.',
  'active',
  '{"business_category":"commerce.retail","fulfillment":"configured","catalog_engine":"shared","configured_by":"skima_store_foundation"}'::jsonb
)
on conflict (key) do update
set display_name = excluded.display_name,
    description = excluded.description,
    status = excluded.status,
    metadata = excluded.metadata,
    updated_at = timezone('utc', now());

do $$
declare
  store_module_id uuid;
  store_module_version_id uuid;
  v_workflow_id uuid;
  v_workflow_version_id uuid;
begin
  select id into store_module_id
  from public.business_modules
  where key = 'store';

  insert into public.workflow_definitions (key, display_name, description, status, metadata)
  values (
    'workflow.skima-store.order-processing',
    'SKIMA Store Order Processing',
    'Generic retail order workflow for catalogue products. Fulfillment and settlement remain policy-configured.',
    'active',
    '{"module_key":"store","purpose":"order_processing"}'::jsonb
  )
  on conflict (key) do update
  set display_name = excluded.display_name,
      description = excluded.description,
      status = excluded.status,
      metadata = excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into v_workflow_id;

  insert into public.workflow_versions (workflow_id, version, status, definition, activated_at)
  values (
    v_workflow_id,
    1,
    'active',
    '{"module_key":"store","order_source":"catalog","amount_source":"active_catalog_price","stock_source":"catalog_availability"}'::jsonb,
    timezone('utc', now())
  )
  on conflict (workflow_id, version) do update
  set status = excluded.status,
      definition = excluded.definition,
      activated_at = coalesce(public.workflow_versions.activated_at, excluded.activated_at),
      updated_at = timezone('utc', now())
  returning id into v_workflow_version_id;

  insert into public.workflow_states (workflow_version_id, key, display_name, state_type, metadata)
  values
    (v_workflow_version_id, 'received', 'Received', 'initial', '{"customer_visible":true}'::jsonb),
    (v_workflow_version_id, 'accepted', 'Accepted', 'normal', '{"customer_visible":true}'::jsonb),
    (v_workflow_version_id, 'preparing', 'Preparing', 'normal', '{"customer_visible":true}'::jsonb),
    (v_workflow_version_id, 'ready_for_pickup', 'Ready for pickup', 'normal', '{"customer_visible":true}'::jsonb),
    (v_workflow_version_id, 'fulfilled', 'Fulfilled', 'normal', '{"customer_visible":true}'::jsonb),
    (v_workflow_version_id, 'completed', 'Completed', 'terminal', '{"customer_visible":true}'::jsonb),
    (v_workflow_version_id, 'cancelled', 'Cancelled', 'failure', '{"customer_visible":true}'::jsonb)
  on conflict (workflow_version_id, key) do update
  set display_name = excluded.display_name,
      state_type = excluded.state_type,
      metadata = excluded.metadata,
      updated_at = timezone('utc', now());

  insert into public.workflow_transitions (
    workflow_version_id, from_state_key, to_state_key, event_type_key,
    guard_policy_key, action_policy_keys, metadata
  )
  values
    (v_workflow_version_id, 'received', 'accepted', 'event.store.order.accepted', null, '{}'::text[], '{}'::jsonb),
    (v_workflow_version_id, 'accepted', 'preparing', 'event.store.order.preparing', null, '{}'::text[], '{}'::jsonb),
    (v_workflow_version_id, 'preparing', 'ready_for_pickup', 'event.store.order.ready', null, '{}'::text[], '{}'::jsonb),
    (v_workflow_version_id, 'ready_for_pickup', 'fulfilled', 'event.partner.fulfillment.confirmed', null, '{}'::text[], '{}'::jsonb),
    (v_workflow_version_id, 'fulfilled', 'completed', 'event.store.order.completed', null, '{}'::text[], '{}'::jsonb),
    (v_workflow_version_id, 'received', 'cancelled', 'event.request.cancelled', null, '{}'::text[], '{}'::jsonb),
    (v_workflow_version_id, 'accepted', 'cancelled', 'event.request.cancelled', null, '{}'::text[], '{}'::jsonb),
    (v_workflow_version_id, 'preparing', 'cancelled', 'event.request.cancelled', null, '{}'::text[], '{}'::jsonb),
    (v_workflow_version_id, 'ready_for_pickup', 'cancelled', 'event.request.cancelled', null, '{}'::text[], '{}'::jsonb)
  on conflict (workflow_version_id, from_state_key, event_type_key) do update
  set to_state_key = excluded.to_state_key,
      guard_policy_key = excluded.guard_policy_key,
      action_policy_keys = excluded.action_policy_keys,
      metadata = excluded.metadata,
      updated_at = timezone('utc', now());

  insert into public.business_module_versions (module_id, version, status, manifest, activated_at)
  values (
    store_module_id,
    1,
    'active',
    '{"module_key":"store","business_category":"commerce.retail","engines":["catalog","pricing","inventory","workflow","orders","financial","settlement"],"activation":"configuration_only"}'::jsonb,
    timezone('utc', now())
  )
  on conflict (module_id, version) do update
  set status = excluded.status,
      manifest = excluded.manifest,
      activated_at = coalesce(public.business_module_versions.activated_at, excluded.activated_at),
      retired_at = null,
      updated_at = timezone('utc', now())
  returning id into store_module_version_id;

  insert into public.business_module_components (
    module_version_id, component_type, component_key, reference_key, is_required, config, status
  )
  values (
    store_module_version_id,
    'workflow',
    'store.workflow.order-processing',
    'workflow.skima-store.order-processing',
    true,
    '{"purpose":"order_processing","entry_event":"event.request.created","terminal_states":["completed","cancelled"]}'::jsonb,
    'active'
  )
  on conflict (module_version_id, component_type, component_key) do update
  set reference_key = excluded.reference_key,
      is_required = excluded.is_required,
      config = excluded.config,
      status = excluded.status,
      updated_at = timezone('utc', now());

  insert into public.order_acceptance_policies (
    key, display_name, scope_type, scope_id, acceptance_mode,
    auto_accept_action_key, rejection_reasons, timeout_seconds, status, metadata
  )
  values (
    'store.order.acceptance.manual.v1',
    'SKIMA Store Manual Order Acceptance',
    'module',
    store_module_id,
    'manual',
    null,
    array['item_unavailable', 'delivery_unavailable', 'customer_request'],
    86400,
    'active',
    '{"module_key":"store","fulfillment_confirmation_required":true}'::jsonb
  )
  on conflict (scope_type, (coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)), key) do update
  set display_name = excluded.display_name,
      acceptance_mode = excluded.acceptance_mode,
      rejection_reasons = excluded.rejection_reasons,
      timeout_seconds = excluded.timeout_seconds,
      status = excluded.status,
      metadata = excluded.metadata,
      updated_at = timezone('utc', now());

  insert into public.order_action_definitions (
    key, display_name, scope_type, scope_id, event_type_key, actor_scope,
    service_request_status, line_fulfillment_status, reservation_effect,
    requires_reason, status, metadata
  )
  values
    (
      'store.order.accept',
      'Accept Store Order',
      'module',
      store_module_id,
      'event.store.order.accepted',
      'business',
      'in_progress',
      'accepted',
      'none',
      false,
      'active',
      '{"module_key":"store","order_action":"accept"}'::jsonb
    ),
    (
      'store.order.prepare',
      'Start Store Order Preparation',
      'module',
      store_module_id,
      'event.store.order.preparing',
      'business',
      'in_progress',
      'preparing',
      'none',
      false,
      'active',
      '{"module_key":"store","order_action":"prepare"}'::jsonb
    ),
    (
      'store.order.ready',
      'Mark Store Order Ready',
      'module',
      store_module_id,
      'event.store.order.ready',
      'business',
      'in_progress',
      'ready',
      'none',
      false,
      'active',
      '{"module_key":"store","order_action":"ready"}'::jsonb
    ),
    (
      'store.order.fulfill',
      'Confirm Store Order Fulfilment',
      'module',
      store_module_id,
      'event.partner.fulfillment.confirmed',
      'business',
      'fulfilled',
      'fulfilled',
      'consume',
      false,
      'active',
      '{"module_key":"store","order_action":"fulfil","stock_consumption":"on_fulfilment"}'::jsonb
    ),
    (
      'store.order.complete',
      'Complete Store Order',
      'module',
      store_module_id,
      'event.store.order.completed',
      'business',
      'completed',
      null,
      'none',
      false,
      'active',
      '{"module_key":"store","order_action":"complete"}'::jsonb
    ),
    (
      'store.order.cancel',
      'Cancel Store Order',
      'module',
      store_module_id,
      'event.request.cancelled',
      'business',
      'cancelled',
      'cancelled',
      'release',
      true,
      'active',
      '{"module_key":"store","order_action":"cancel","stock_reservation":"release"}'::jsonb
    )
  on conflict do nothing;
end;
$$;

create table if not exists public.storefront_settings (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null unique references public.business_modules(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid references public.organization_branches(id) on delete restrict,
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  fulfillment_method text not null default 'delivery'
NaN$'),
  fulfillment_methods text[] not null default array['delivery', 'pickup'],
  status text not null default 'draft'
NaN
  source text not null default 'platform.storefront'
NaN$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (cardinality(fulfillment_methods) > 0),
  check (fulfillment_method = any(fulfillment_methods))
);

alter table public.storefront_settings enable row level security;

drop policy if exists storefront_settings_read_active_or_admin on public.storefront_settings;
create policy storefront_settings_read_active_or_admin
on public.storefront_settings for select to authenticated
using (
  status = 'active'
  or public.is_platform_super_admin()
  or public.has_permission('platform.store.manage', null)
);

create policy storefront_settings_no_direct_insert
on public.storefront_settings for insert to authenticated with check (false);
create policy storefront_settings_no_direct_update
on public.storefront_settings for update to authenticated using (false) with check (false);
create policy storefront_settings_no_direct_delete
on public.storefront_settings for delete to authenticated using (false);

grant select, insert, update, delete on public.storefront_settings to authenticated, service_role;

create or replace function public.can_read_business_catalog(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or public.is_platform_super_admin()
    or public.has_permission('platform.organizations.read', null)
    or public.has_permission('platform.configuration.read', null)
    or public.has_permission('platform.catalog.read', null)
    or public.has_permission('platform.catalog.manage', null)
    or (
      (
        public.has_permission('platform.store.read', null)
        or public.has_permission('platform.store.manage', null)
      )
      and exists (
        select 1
        from public.storefront_settings storefront
        join public.business_modules module on module.id = storefront.module_id
        where module.key = 'store'
          and storefront.organization_id = target_organization_id
      )
    )
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
    or public.is_platform_super_admin()
    or public.has_permission('platform.catalog.manage', null)
    or (
      public.has_permission('platform.store.manage', null)
      and exists (
        select 1
        from public.storefront_settings storefront
        join public.business_modules module on module.id = storefront.module_id
        where module.key = 'store'
          and storefront.organization_id = target_organization_id
          and (
            target_branch_id is null
            or storefront.branch_id is null
            or storefront.branch_id = target_branch_id
          )
      )
    )
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

drop policy if exists catalog_store_categories_select_public on public.catalog_categories;
create policy catalog_store_categories_select_public
on public.catalog_categories for select to authenticated
using (
  status = 'active'
  and module_id = (select module.id from public.business_modules module where module.key = 'store' and module.status = 'active')
);

create or replace function public.configure_storefront_settings(
  target_organization_id uuid,
  target_branch_id uuid default null,
  target_currency_code text default 'NGN',
  target_fulfillment_method text default 'delivery',
  target_fulfillment_methods text[] default array['delivery', 'pickup'],
  target_status text default 'active',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  store_module_id uuid;
  setting_id uuid;
  store_role_id uuid;
  order_permission_id uuid;
begin
  if auth.uid() is null
    or not public.is_platform_super_admin()
      and not public.has_permission('platform.store.manage', null) then
    raise exception 'platform Store management permission is required';
  end if;

  select id into store_module_id
  from public.business_modules
  where key = 'store' and status = 'active';

  if store_module_id is null then
    raise exception 'SKIMA Store module is not active';
  end if;

  if target_organization_id is null or not exists (
    select 1 from public.organizations
    where id = target_organization_id and status = 'active'
  ) then
    raise exception 'Choose an active operating organisation for SKIMA Store';
  end if;

  if not exists (
    select 1
    from public.partner_profiles partner
    where partner.organization_id = target_organization_id
      and partner.status = 'active'
  ) then
    raise exception 'The Store operating organisation must have an active merchant profile before it can accept orders';
  end if;

  if target_branch_id is not null and not exists (
    select 1 from public.organization_branches
    where id = target_branch_id
      and organization_id = target_organization_id
      and status = 'active'
  ) then
    raise exception 'The selected Store branch must belong to the operating organisation and be active';
  end if;

  if not exists (
    select 1 from public.currency_definitions
    where code = target_currency_code and status = 'enabled'
  ) then
    raise exception 'The selected Store currency is not enabled';
  end if;

  if target_fulfillment_methods is null
    or cardinality(target_fulfillment_methods) = 0
    or target_fulfillment_method is null
    or not target_fulfillment_method = any(target_fulfillment_methods) then
    raise exception 'Configure at least one valid Store fulfillment method and select its default';
  end if;

  if target_status not in ('draft', 'active', 'paused') then
    raise exception 'Store status must be draft, active, or paused';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'An idempotency key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'Store metadata must be a JSON object';
  end if;

  -- The user configuring first-party Store operations becomes an organisation-
  -- scoped Store operator. This grants order processing only inside the Store
  -- merchant organisation, not platform-wide runtime execution.
  insert into public.organization_memberships (
    organization_id, user_id, membership_type, status, metadata
  )
  values (
    target_organization_id,
    auth.uid(),
    'admin',
    'active',
    '{"source":"platform.storefront","membership":"store_operations_manager"}'::jsonb
  )
  on conflict (organization_id, user_id) do update
  set membership_type = 'admin',
      status = 'active',
      metadata = public.organization_memberships.metadata || excluded.metadata,
      updated_at = timezone('utc', now());

  insert into public.roles (
    organization_id, key, display_name, description, status, metadata
  )
  values (
    target_organization_id,
    'store.operations.manager',
    'Store Operations Manager',
    'Manage first-party SKIMA Store orders and fulfilment.',
    'active',
    '{"module_key":"store","scope":"organisation"}'::jsonb
  )
  on conflict do nothing;

  select id into store_role_id
  from public.roles
  where organization_id = target_organization_id
    and key = 'store.operations.manager'
    and status = 'active';

  select id into order_permission_id
  from public.permissions
  where key = 'business.orders.process';

  if store_role_id is null or order_permission_id is null
    or not exists (select 1 from public.permissions where key = 'business.orders.read') then
    raise exception 'Store order-processing permissions are not configured';
  end if;

  insert into public.role_permissions (role_id, permission_id)
  select store_role_id, permission.id
  from public.permissions permission
  where permission.key in ('business.orders.read', 'business.orders.process')
  on conflict (role_id, permission_id) do nothing;

  insert into public.user_roles (organization_id, user_id, role_id, status)
  values (target_organization_id, auth.uid(), store_role_id, 'active')
  on conflict (organization_id, user_id, role_id) do update
  set status = 'active',
      ends_at = null,
      updated_at = timezone('utc', now());

  insert into public.storefront_settings (
    module_id, organization_id, branch_id, currency_code,
    fulfillment_method, fulfillment_methods, status,
    idempotency_key, metadata
  )
  values (
    store_module_id, target_organization_id, target_branch_id, target_currency_code,
    target_fulfillment_method, target_fulfillment_methods, target_status,
    target_idempotency_key, target_metadata
  )
  on conflict (module_id) do update
  set organization_id = excluded.organization_id,
      branch_id = excluded.branch_id,
      currency_code = excluded.currency_code,
      fulfillment_method = excluded.fulfillment_method,
      fulfillment_methods = excluded.fulfillment_methods,
      status = excluded.status,
      idempotency_key = excluded.idempotency_key,
      metadata = excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into setting_id;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, after_state, metadata
  )
  values (
    auth.uid(), 'storefront.configured', 'storefront_settings', setting_id,
    jsonb_build_object(
      'organization_id', target_organization_id,
      'branch_id', target_branch_id,
      'currency_code', target_currency_code,
      'fulfillment_method', target_fulfillment_method,
      'status', target_status
    ),
    jsonb_build_object('source', 'platform.storefront')
  );

  return setting_id;
end;
$$;

create or replace function public.create_storefront_product(
  target_display_name text,
  target_description text,
  target_category_key text,
  target_category_name text,
  target_item_key text,
  target_amount numeric,
  target_compare_at_amount numeric,
  target_stock_quantity numeric,
  target_status text default 'active',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  settings public.storefront_settings%rowtype;
  resolved_category_key text;
  item_id uuid;
  price_id uuid;
  availability_id uuid;
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
    raise exception 'Configure and activate the SKIMA Store before adding products';
  end if;

  if target_display_name is null or btrim(target_display_name) = '' then
    raise exception 'Product name is required';
  end if;

  if target_item_key is null or target_item_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'Product key must be a valid platform key';
  end if;

  if target_amount is null or target_amount < 0 then
    raise exception 'A valid selling price is required';
  end if;

  if target_compare_at_amount is not null
    and target_compare_at_amount <= target_amount then
    raise exception 'The crossed-out price must be greater than the selling price';
  end if;

  if target_stock_quantity is null or target_stock_quantity < 0 then
    raise exception 'Stock quantity must be zero or greater';
  end if;

  if target_status not in ('draft', 'active') then
    raise exception 'Product status must be draft or active';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'An idempotency key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'Product metadata must be a JSON object';
  end if;

  resolved_category_key := coalesce(nullif(target_category_key, ''), 'store.category.general');

  if not exists (
    select 1 from public.catalog_categories
    where organization_id = settings.organization_id
      and key = resolved_category_key
      and status = 'active'
  ) then
    perform public.configure_catalog_category(
      settings.organization_id,
      resolved_category_key,
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
  end if;

  item_id := public.configure_catalog_item(
    settings.organization_id,
    settings.branch_id,
    'store',
    resolved_category_key,
    target_item_key,
    'product',
    target_display_name,
    nullif(target_description, ''),
    settings.fulfillment_methods,
    null,
    1,
    null,
    target_status,
    'platform.storefront',
    target_idempotency_key || ':item',
    target_metadata || jsonb_build_object(
      'storefront', true,
      'sales_channel', 'skima_store'
    )
  );

  price_id := public.configure_catalog_price(
    item_id,
    null,
    settings.currency_code,
    target_amount,
    target_compare_at_amount,
    null,
    'exclusive',
    'active',
    timezone('utc', now()),
    null,
    'platform.storefront',
    target_idempotency_key || ':price',
    jsonb_build_object('storefront', true)
  );

  availability_id := public.set_catalog_availability(
    item_id,
    null,
    settings.branch_id,
    case when target_status = 'active' and target_stock_quantity > 0 then 'available'
         when target_status = 'active' then 'out_of_stock'
         else 'unavailable' end,
    '{}'::jsonb,
    target_stock_quantity,
    0,
    null,
    0,
    'active',
    timezone('utc', now()),
    null,
    'platform.storefront',
    target_idempotency_key || ':availability',
    jsonb_build_object('storefront', true)
  );

  return jsonb_build_object(
    'itemId', item_id,
    'priceId', price_id,
    'availabilityRuleId', availability_id,
    'categoryKey', resolved_category_key
  );
end;
$$;

revoke all on function public.configure_storefront_settings(uuid, uuid, text, text, text[], text, text, jsonb) from public, anon;
revoke all on function public.create_storefront_product(text, text, text, text, text, numeric, numeric, numeric, text, text, jsonb) from public, anon;
grant execute on function public.configure_storefront_settings(uuid, uuid, text, text, text[], text, text, jsonb) to authenticated, service_role;
grant execute on function public.create_storefront_product(text, text, text, text, text, numeric, numeric, numeric, text, text, jsonb) to authenticated, service_role;

commit;
),
  fulfillment_methods text[] not null default array['delivery', 'pickup'],
  status text not null default 'draft'
    check (status in ('draft', 'active', 'paused')),
  source text not null default 'platform.storefront'
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}
alter table public.storefront_settings enable row level security;

drop policy if exists storefront_settings_read_active_or_admin on public.storefront_settings;
create policy storefront_settings_read_active_or_admin
on public.storefront_settings for select to authenticated
using (
  status = 'active'
  or public.is_platform_super_admin()
  or public.has_permission('platform.store.manage', null)
);

create policy storefront_settings_no_direct_insert
on public.storefront_settings for insert to authenticated with check (false);
create policy storefront_settings_no_direct_update
on public.storefront_settings for update to authenticated using (false) with check (false);
create policy storefront_settings_no_direct_delete
on public.storefront_settings for delete to authenticated using (false);

grant select, insert, update, delete on public.storefront_settings to authenticated, service_role;

create or replace function public.can_read_business_catalog(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or public.is_platform_super_admin()
    or public.has_permission('platform.organizations.read', null)
    or public.has_permission('platform.configuration.read', null)
    or public.has_permission('platform.catalog.read', null)
    or public.has_permission('platform.catalog.manage', null)
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
    or public.is_platform_super_admin()
    or public.has_permission('platform.catalog.manage', null)
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

drop policy if exists catalog_store_categories_select_public on public.catalog_categories;
create policy catalog_store_categories_select_public
on public.catalog_categories for select to authenticated
using (
  status = 'active'
  and module_id = (select module.id from public.business_modules module where module.key = 'store' and module.status = 'active')
);

create or replace function public.configure_storefront_settings(
  target_organization_id uuid,
  target_branch_id uuid default null,
  target_currency_code text default 'NGN',
  target_fulfillment_method text default 'delivery',
  target_fulfillment_methods text[] default array['delivery', 'pickup'],
  target_status text default 'active',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  store_module_id uuid;
  setting_id uuid;
begin
  if auth.uid() is null
    or not public.is_platform_super_admin()
      and not public.has_permission('platform.store.manage', null) then
    raise exception 'platform Store management permission is required';
  end if;

  select id into store_module_id
  from public.business_modules
  where key = 'store' and status = 'active';

  if store_module_id is null then
    raise exception 'SKIMA Store module is not active';
  end if;

  if target_organization_id is null or not exists (
    select 1 from public.organizations
    where id = target_organization_id and status = 'active'
  ) then
    raise exception 'Choose an active operating organisation for SKIMA Store';
  end if;

  if target_branch_id is not null and not exists (
    select 1 from public.organization_branches
    where id = target_branch_id
      and organization_id = target_organization_id
      and status = 'active'
  ) then
    raise exception 'The selected Store branch must belong to the operating organisation and be active';
  end if;

  if not exists (
    select 1 from public.currency_definitions
    where code = target_currency_code and status = 'enabled'
  ) then
    raise exception 'The selected Store currency is not enabled';
  end if;

  if target_fulfillment_methods is null
    or cardinality(target_fulfillment_methods) = 0
    or target_fulfillment_method is null
    or not target_fulfillment_method = any(target_fulfillment_methods) then
    raise exception 'Configure at least one valid Store fulfillment method and select its default';
  end if;

  if target_status not in ('draft', 'active', 'paused') then
    raise exception 'Store status must be draft, active, or paused';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'An idempotency key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'Store metadata must be a JSON object';
  end if;

  insert into public.storefront_settings (
    module_id, organization_id, branch_id, currency_code,
    fulfillment_method, fulfillment_methods, status,
    idempotency_key, metadata
  )
  values (
    store_module_id, target_organization_id, target_branch_id, target_currency_code,
    target_fulfillment_method, target_fulfillment_methods, target_status,
    target_idempotency_key, target_metadata
  )
  on conflict (module_id) do update
  set organization_id = excluded.organization_id,
      branch_id = excluded.branch_id,
      currency_code = excluded.currency_code,
      fulfillment_method = excluded.fulfillment_method,
      fulfillment_methods = excluded.fulfillment_methods,
      status = excluded.status,
      idempotency_key = excluded.idempotency_key,
      metadata = excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into setting_id;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, after_state, metadata
  )
  values (
    auth.uid(), 'storefront.configured', 'storefront_settings', setting_id,
    jsonb_build_object(
      'organization_id', target_organization_id,
      'branch_id', target_branch_id,
      'currency_code', target_currency_code,
      'fulfillment_method', target_fulfillment_method,
      'status', target_status
    ),
    jsonb_build_object('source', 'platform.storefront')
  );

  return setting_id;
end;
$$;

create or replace function public.create_storefront_product(
  target_display_name text,
  target_description text,
  target_category_key text,
  target_category_name text,
  target_item_key text,
  target_amount numeric,
  target_compare_at_amount numeric,
  target_stock_quantity numeric,
  target_status text default 'active',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  settings public.storefront_settings%rowtype;
  resolved_category_key text;
  item_id uuid;
  price_id uuid;
  availability_id uuid;
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
    raise exception 'Configure and activate the SKIMA Store before adding products';
  end if;

  if target_display_name is null or btrim(target_display_name) = '' then
    raise exception 'Product name is required';
  end if;

  if target_item_key is null or target_item_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'Product key must be a valid platform key';
  end if;

  if target_amount is null or target_amount < 0 then
    raise exception 'A valid selling price is required';
  end if;

  if target_compare_at_amount is not null
    and target_compare_at_amount <= target_amount then
    raise exception 'The crossed-out price must be greater than the selling price';
  end if;

  if target_stock_quantity is null or target_stock_quantity < 0 then
    raise exception 'Stock quantity must be zero or greater';
  end if;

  if target_status not in ('draft', 'active') then
    raise exception 'Product status must be draft or active';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'An idempotency key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'Product metadata must be a JSON object';
  end if;

  resolved_category_key := coalesce(nullif(target_category_key, ''), 'store.category.general');

  if not exists (
    select 1 from public.catalog_categories
    where organization_id = settings.organization_id
      and key = resolved_category_key
      and status = 'active'
  ) then
    perform public.configure_catalog_category(
      settings.organization_id,
      resolved_category_key,
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
  end if;

  item_id := public.configure_catalog_item(
    settings.organization_id,
    settings.branch_id,
    'store',
    resolved_category_key,
    target_item_key,
    'product',
    target_display_name,
    nullif(target_description, ''),
    settings.fulfillment_methods,
    null,
    1,
    null,
    target_status,
    'platform.storefront',
    target_idempotency_key || ':item',
    target_metadata || jsonb_build_object('storefront', true)
  );

  price_id := public.configure_catalog_price(
    item_id,
    null,
    settings.currency_code,
    target_amount,
    target_compare_at_amount,
    null,
    'exclusive',
    'active',
    timezone('utc', now()),
    null,
    'platform.storefront',
    target_idempotency_key || ':price',
    jsonb_build_object('storefront', true)
  );

  availability_id := public.set_catalog_availability(
    item_id,
    null,
    settings.branch_id,
    case when target_status = 'active' and target_stock_quantity > 0 then 'available'
         when target_status = 'active' then 'out_of_stock'
         else 'unavailable' end,
    '{}'::jsonb,
    target_stock_quantity,
    0,
    null,
    0,
    'active',
    timezone('utc', now()),
    null,
    'platform.storefront',
    target_idempotency_key || ':availability',
    jsonb_build_object('storefront', true)
  );

  return jsonb_build_object(
    'itemId', item_id,
    'priceId', price_id,
    'availabilityRuleId', availability_id,
    'categoryKey', resolved_category_key
  );
end;
$$;

revoke all on function public.configure_storefront_settings(uuid, uuid, text, text, text[], text, text, jsonb) from public, anon;
revoke all on function public.create_storefront_product(text, text, text, text, text, numeric, numeric, numeric, text, text, jsonb) from public, anon;
grant execute on function public.configure_storefront_settings(uuid, uuid, text, text, text[], text, text, jsonb) to authenticated, service_role;
grant execute on function public.create_storefront_product(text, text, text, text, text, numeric, numeric, numeric, text, text, jsonb) to authenticated, service_role;

commit;
),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (cardinality(fulfillment_methods) > 0),
  check (fulfillment_method = any(fulfillment_methods))
);


-- SKIMA's direct Store is a first-party merchant module, not an LPG station.
-- Give it a dedicated internal organisation so Store orders never attach to a
-- station's organisation or inherit LPG fulfilment assumptions.
insert into public.organizations (slug, display_name, status, metadata)
values (
  'skima-store',
  'SKIMA Store',
  'active',
  '{"ownership":"platform_first_party","module_key":"store","purpose":"direct_commerce"}'::jsonb
)
on conflict (slug) do update
set status = 'active',
    metadata = public.organizations.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

insert into public.partner_profiles (
  organization_id, partner_type_key, status, behavior_config, metadata
)
select
  organization.id,
  'partner.skima.store',
  'active',
  '{"first_party":true,"catalog_module":"store"}'::jsonb,
  '{"ownership":"platform_first_party","module_key":"store"}'::jsonb
from public.organizations organization
where organization.slug = 'skima-store'
on conflict (organization_id) do update
set partner_type_key = excluded.partner_type_key,
    status = 'active',
    behavior_config = public.partner_profiles.behavior_config || excluded.behavior_config,
    metadata = public.partner_profiles.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

insert into public.storefront_settings (
  module_id, organization_id, branch_id, currency_code,
  fulfillment_method, fulfillment_methods, status, source,
  idempotency_key, metadata
)
select
  module.id,
  organization.id,
  null,
  'NGN',
  'delivery',
  array['delivery', 'pickup'],
  'draft',
  'platform.storefront',
  'migration:20261102030000:storefront-settings',
  '{"first_party_store":true,"requires_admin_activation":true}'::jsonb
from public.business_modules module
cross join public.organizations organization
where module.key = 'store'
  and organization.slug = 'skima-store'
on conflict (module_id) do nothing;

alter table public.storefront_settings enable row level security;

drop policy if exists storefront_settings_read_active_or_admin on public.storefront_settings;
create policy storefront_settings_read_active_or_admin
on public.storefront_settings for select to authenticated
using (
  status = 'active'
  or public.is_platform_super_admin()
  or public.has_permission('platform.store.manage', null)
);

create policy storefront_settings_no_direct_insert
on public.storefront_settings for insert to authenticated with check (false);
create policy storefront_settings_no_direct_update
on public.storefront_settings for update to authenticated using (false) with check (false);
create policy storefront_settings_no_direct_delete
on public.storefront_settings for delete to authenticated using (false);

grant select, insert, update, delete on public.storefront_settings to authenticated, service_role;

create or replace function public.can_read_business_catalog(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or public.is_platform_super_admin()
    or public.has_permission('platform.organizations.read', null)
    or public.has_permission('platform.configuration.read', null)
    or public.has_permission('platform.catalog.read', null)
    or public.has_permission('platform.catalog.manage', null)
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
    or public.is_platform_super_admin()
    or public.has_permission('platform.catalog.manage', null)
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

drop policy if exists catalog_store_categories_select_public on public.catalog_categories;
create policy catalog_store_categories_select_public
on public.catalog_categories for select to authenticated
using (
  status = 'active'
  and module_id = (select module.id from public.business_modules module where module.key = 'store' and module.status = 'active')
);

create or replace function public.configure_storefront_settings(
  target_organization_id uuid,
  target_branch_id uuid default null,
  target_currency_code text default 'NGN',
  target_fulfillment_method text default 'delivery',
  target_fulfillment_methods text[] default array['delivery', 'pickup'],
  target_status text default 'active',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  store_module_id uuid;
  setting_id uuid;
begin
  if auth.uid() is null
    or not public.is_platform_super_admin()
      and not public.has_permission('platform.store.manage', null) then
    raise exception 'platform Store management permission is required';
  end if;

  select id into store_module_id
  from public.business_modules
  where key = 'store' and status = 'active';

  if store_module_id is null then
    raise exception 'SKIMA Store module is not active';
  end if;

  if target_organization_id is null or not exists (
    select 1 from public.organizations
    where id = target_organization_id and status = 'active'
  ) then
    raise exception 'Choose an active operating organisation for SKIMA Store';
  end if;

  if target_branch_id is not null and not exists (
    select 1 from public.organization_branches
    where id = target_branch_id
      and organization_id = target_organization_id
      and status = 'active'
  ) then
    raise exception 'The selected Store branch must belong to the operating organisation and be active';
  end if;

  if not exists (
    select 1 from public.currency_definitions
    where code = target_currency_code and status = 'enabled'
  ) then
    raise exception 'The selected Store currency is not enabled';
  end if;

  if target_fulfillment_methods is null
    or cardinality(target_fulfillment_methods) = 0
    or target_fulfillment_method is null
    or not target_fulfillment_method = any(target_fulfillment_methods) then
    raise exception 'Configure at least one valid Store fulfillment method and select its default';
  end if;

  if target_status not in ('draft', 'active', 'paused') then
    raise exception 'Store status must be draft, active, or paused';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'An idempotency key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'Store metadata must be a JSON object';
  end if;

  insert into public.storefront_settings (
    module_id, organization_id, branch_id, currency_code,
    fulfillment_method, fulfillment_methods, status,
    idempotency_key, metadata
  )
  values (
    store_module_id, target_organization_id, target_branch_id, target_currency_code,
    target_fulfillment_method, target_fulfillment_methods, target_status,
    target_idempotency_key, target_metadata
  )
  on conflict (module_id) do update
  set organization_id = excluded.organization_id,
      branch_id = excluded.branch_id,
      currency_code = excluded.currency_code,
      fulfillment_method = excluded.fulfillment_method,
      fulfillment_methods = excluded.fulfillment_methods,
      status = excluded.status,
      idempotency_key = excluded.idempotency_key,
      metadata = excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into setting_id;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, after_state, metadata
  )
  values (
    auth.uid(), 'storefront.configured', 'storefront_settings', setting_id,
    jsonb_build_object(
      'organization_id', target_organization_id,
      'branch_id', target_branch_id,
      'currency_code', target_currency_code,
      'fulfillment_method', target_fulfillment_method,
      'status', target_status
    ),
    jsonb_build_object('source', 'platform.storefront')
  );

  return setting_id;
end;
$$;

create or replace function public.create_storefront_product(
  target_display_name text,
  target_description text,
  target_category_key text,
  target_category_name text,
  target_item_key text,
  target_amount numeric,
  target_compare_at_amount numeric,
  target_stock_quantity numeric,
  target_status text default 'active',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  settings public.storefront_settings%rowtype;
  resolved_category_key text;
  item_id uuid;
  price_id uuid;
  availability_id uuid;
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
    raise exception 'Configure and activate the SKIMA Store before adding products';
  end if;

  if target_display_name is null or btrim(target_display_name) = '' then
    raise exception 'Product name is required';
  end if;

  if target_item_key is null or target_item_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'Product key must be a valid platform key';
  end if;

  if target_amount is null or target_amount < 0 then
    raise exception 'A valid selling price is required';
  end if;

  if target_compare_at_amount is not null
    and target_compare_at_amount <= target_amount then
    raise exception 'The crossed-out price must be greater than the selling price';
  end if;

  if target_stock_quantity is null or target_stock_quantity < 0 then
    raise exception 'Stock quantity must be zero or greater';
  end if;

  if target_status not in ('draft', 'active') then
    raise exception 'Product status must be draft or active';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'An idempotency key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'Product metadata must be a JSON object';
  end if;

  resolved_category_key := coalesce(nullif(target_category_key, ''), 'store.category.general');

  if not exists (
    select 1 from public.catalog_categories
    where organization_id = settings.organization_id
      and key = resolved_category_key
      and status = 'active'
  ) then
    perform public.configure_catalog_category(
      settings.organization_id,
      resolved_category_key,
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
  end if;

  item_id := public.configure_catalog_item(
    settings.organization_id,
    settings.branch_id,
    'store',
    resolved_category_key,
    target_item_key,
    'product',
    target_display_name,
    nullif(target_description, ''),
    settings.fulfillment_methods,
    null,
    1,
    null,
    target_status,
    'platform.storefront',
    target_idempotency_key || ':item',
    target_metadata || jsonb_build_object('storefront', true)
  );

  price_id := public.configure_catalog_price(
    item_id,
    null,
    settings.currency_code,
    target_amount,
    target_compare_at_amount,
    null,
    'exclusive',
    'active',
    timezone('utc', now()),
    null,
    'platform.storefront',
    target_idempotency_key || ':price',
    jsonb_build_object('storefront', true)
  );

  availability_id := public.set_catalog_availability(
    item_id,
    null,
    settings.branch_id,
    case when target_status = 'active' and target_stock_quantity > 0 then 'available'
         when target_status = 'active' then 'out_of_stock'
         else 'unavailable' end,
    '{}'::jsonb,
    target_stock_quantity,
    0,
    null,
    0,
    'active',
    timezone('utc', now()),
    null,
    'platform.storefront',
    target_idempotency_key || ':availability',
    jsonb_build_object('storefront', true)
  );

  return jsonb_build_object(
    'itemId', item_id,
    'priceId', price_id,
    'availabilityRuleId', availability_id,
    'categoryKey', resolved_category_key
  );
end;
$$;

revoke all on function public.configure_storefront_settings(uuid, uuid, text, text, text[], text, text, jsonb) from public, anon;
revoke all on function public.create_storefront_product(text, text, text, text, text, numeric, numeric, numeric, text, text, jsonb) from public, anon;
grant execute on function public.configure_storefront_settings(uuid, uuid, text, text, text[], text, text, jsonb) to authenticated, service_role;
grant execute on function public.create_storefront_product(text, text, text, text, text, numeric, numeric, numeric, text, text, jsonb) to authenticated, service_role;

commit;
