begin;

insert into public.permissions (key, description, risk_level)
values
  ('business.orders.read', 'Read organization order records and order history.', 'standard'),
  ('business.orders.process', 'Process organization orders through configured order actions.', 'high'),
  ('business.orders.manage', 'Manage organization order policy, processing, and assignment controls.', 'high')
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    updated_at = timezone('utc', now());

create table if not exists public.order_acceptance_policies (
  id uuid primary key default gen_random_uuid(),
  key text not null
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  scope_type text not null default 'global'
    check (scope_type in ('global', 'module', 'organization')),
  scope_id uuid,
  acceptance_mode text not null default 'manual'
    check (acceptance_mode in ('manual', 'automatic', 'configured')),
  auto_accept_action_key text
    check (auto_accept_action_key is null or auto_accept_action_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  rejection_reasons text[] not null default '{}',
  timeout_seconds integer check (timeout_seconds is null or timeout_seconds > 0),
  status text not null default 'active'
    check (status in ('draft', 'active', 'retired')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check ((scope_type = 'global' and scope_id is null) or (scope_type <> 'global' and scope_id is not null))
);

create unique index if not exists order_acceptance_policies_scope_key_unique
on public.order_acceptance_policies (
  scope_type,
  coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid),
  key
);

create table if not exists public.order_action_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  scope_type text not null default 'global'
    check (scope_type in ('global', 'module', 'organization')),
  scope_id uuid,
  event_type_key text not null references public.event_types(key) on delete restrict,
  actor_scope text not null default 'business'
    check (actor_scope in ('customer', 'business', 'customer_or_business', 'platform', 'system', 'any')),
  service_request_status text
    check (
      service_request_status is null
      or service_request_status in (
        'requested',
        'priced',
        'payment_reserved',
        'workflow_started',
        'matching',
        'assigned',
        'in_progress',
        'fulfilled',
        'completed',
        'settled',
        'cancelled',
        'failed',
        'disputed',
        'refunded'
      )
    ),
  line_fulfillment_status text
    check (
      line_fulfillment_status is null
      or line_fulfillment_status in (
        'pending',
        'accepted',
        'preparing',
        'ready',
        'partially_fulfilled',
        'fulfilled',
        'cancelled',
        'failed'
      )
    ),
  reservation_effect text not null default 'none'
    check (reservation_effect in ('none', 'release', 'consume')),
  requires_reason boolean not null default false,
  status text not null default 'active'
    check (status in ('draft', 'active', 'retired')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check ((scope_type = 'global' and scope_id is null) or (scope_type <> 'global' and scope_id is not null))
);

create unique index if not exists order_action_definitions_scope_key_unique
on public.order_action_definitions (
  scope_type,
  coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid),
  key
);

create table if not exists public.order_records (
  id uuid primary key default gen_random_uuid(),
  service_request_id uuid not null references public.service_requests(id) on delete cascade,
  module_id uuid not null references public.business_modules(id) on delete restrict,
  module_version_id uuid not null references public.business_module_versions(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid references public.organization_branches(id) on delete set null,
  requester_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  workflow_instance_id uuid references public.workflow_instances(id) on delete set null,
  acceptance_policy_id uuid references public.order_acceptance_policies(id) on delete set null,
  status text not null default 'received'
    check (status in (
      'received',
      'accepted',
      'preparing',
      'ready_for_pickup',
      'partially_fulfilled',
      'fulfilled',
      'completed',
      'rejected',
      'cancelled',
      'failed',
      'timed_out',
      'reassignment_requested',
      'disputed'
    )),
  fulfillment_method text
    check (fulfillment_method is null or fulfillment_method ~ '^[a-z][a-z0-9_.:-]{1,120}$'),
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  subtotal_amount numeric(28, 8) not null default 0 check (subtotal_amount >= 0),
  fee_amount numeric(28, 8) not null default 0 check (fee_amount >= 0),
  discount_amount numeric(28, 8) not null default 0 check (discount_amount >= 0),
  tax_amount numeric(28, 8) not null default 0 check (tax_amount >= 0),
  total_amount numeric(28, 8) not null default 0 check (total_amount >= 0),
  order_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(order_payload) = 'object'),
  source text not null default 'platform.order_engine'
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  accepted_at timestamptz,
  preparing_at timestamptz,
  ready_at timestamptz,
  fulfilled_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  failed_at timestamptz,
  rejected_at timestamptz,
  disputed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (service_request_id),
  unique (source, idempotency_key),
  check (total_amount = greatest(subtotal_amount + fee_amount + tax_amount - discount_amount, 0))
);

create table if not exists public.order_line_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.order_records(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  item_id uuid not null references public.catalog_items(id) on delete restrict,
  variant_id uuid references public.catalog_item_variants(id) on delete restrict,
  price_id uuid references public.catalog_prices(id) on delete restrict,
  availability_rule_id uuid references public.catalog_availability_rules(id) on delete restrict,
  quantity numeric(20, 8) not null check (quantity > 0),
  unit_amount numeric(28, 8) not null check (unit_amount >= 0),
  line_amount numeric(28, 8) not null check (line_amount >= 0),
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  fulfillment_status text not null default 'pending'
    check (fulfillment_status in (
      'pending',
      'accepted',
      'preparing',
      'ready',
      'partially_fulfilled',
      'fulfilled',
      'cancelled',
      'failed'
    )),
  stock_reservation_status text not null default 'reserved'
    check (stock_reservation_status in ('not_required', 'reserved', 'consumed', 'released')),
  item_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(item_snapshot) = 'object'),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (order_id, line_number)
);

create table if not exists public.order_assignments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.order_records(id) on delete cascade,
  service_request_id uuid not null references public.service_requests(id) on delete cascade,
  participant_role text not null
    check (participant_role ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  entity_type text not null
    check (entity_type in ('user', 'organization', 'partner', 'driver', 'vehicle', 'asset')),
  entity_id uuid not null,
  status text not null default 'active'
    check (status in ('active', 'reassigned', 'completed', 'cancelled')),
  source text not null default 'platform.order_engine'
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  assigned_by uuid references public.profiles(id) on delete set null default auth.uid(),
  assigned_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create unique index if not exists order_assignments_one_active_role
on public.order_assignments (order_id, participant_role)
where status = 'active';

create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.order_records(id) on delete cascade,
  service_request_id uuid not null references public.service_requests(id) on delete cascade,
  workflow_instance_id uuid references public.workflow_instances(id) on delete set null,
  event_type_key text not null references public.event_types(key) on delete restrict,
  event_id uuid references public.event_log(id) on delete set null,
  from_status text,
  to_status text not null,
  actor_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  source text not null default 'platform.order_engine'
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (order_id, idempotency_key)
);

create index if not exists order_records_org_branch_status_idx
on public.order_records (organization_id, branch_id, status);

create index if not exists order_records_requester_status_idx
on public.order_records (requester_user_id, status);

create index if not exists order_line_items_item_variant_idx
on public.order_line_items (item_id, variant_id, fulfillment_status);

create index if not exists order_events_order_created_idx
on public.order_events (order_id, created_at desc);

create or replace function public.prevent_order_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'order events are append-only';
end;
$$;

create or replace function public.can_read_business_order(
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
    or public.can_read_platform_runtime()
    or public.has_permission_for_branch(
      'business.orders.read',
      target_organization_id,
      target_branch_id
    )
    or public.has_permission_for_branch(
      'business.orders.process',
      target_organization_id,
      target_branch_id
    )
    or public.has_permission_for_branch(
      'business.orders.manage',
      target_organization_id,
      target_branch_id
    )
    or public.is_organization_creator(target_organization_id);
$$;

create or replace function public.can_process_business_order(
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
    or public.can_execute_platform_runtime()
    or public.has_permission_for_branch(
      'business.orders.process',
      target_organization_id,
      target_branch_id
    )
    or public.has_permission_for_branch(
      'business.orders.manage',
      target_organization_id,
      target_branch_id
    )
    or public.is_organization_creator(target_organization_id);
$$;

create or replace function public.resolve_order_workflow_version(
  target_module_version_id uuid
)
returns table (workflow_key text, workflow_version_id uuid, initial_state_key text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if target_module_version_id is null then
    raise exception 'target_module_version_id is required';
  end if;

  return query
  select
    workflow.key,
    workflow_version.id,
    workflow_state.key
  from public.business_module_components component
  join public.workflow_definitions workflow on workflow.key = component.reference_key
  join public.workflow_versions workflow_version on workflow_version.workflow_id = workflow.id
  join public.workflow_states workflow_state
    on workflow_state.workflow_version_id = workflow_version.id
  where component.module_version_id = target_module_version_id
    and component.component_type = 'workflow'
    and component.status = 'active'
    and coalesce(component.config ->> 'purpose', 'service_request') = 'order_processing'
    and workflow.status = 'active'
    and workflow_version.status = 'active'
    and workflow_state.state_type = 'initial'
  order by workflow_version.version desc, component.created_at asc
  limit 1;
end;
$$;

create or replace function public.resolve_order_acceptance_policy(
  target_module_id uuid,
  target_organization_id uuid,
  target_policy_key text default null
)
returns public.order_acceptance_policies
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  policy_record public.order_acceptance_policies%rowtype;
begin
  if target_module_id is null then
    raise exception 'target_module_id is required';
  end if;

  if target_organization_id is null then
    raise exception 'target_organization_id is required';
  end if;

  if target_policy_key is not null
    and target_policy_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_policy_key must be a valid platform key';
  end if;

  select policy.*
  into policy_record
  from public.order_acceptance_policies policy
  where policy.status = 'active'
    and (target_policy_key is null or policy.key = target_policy_key)
    and (
      (policy.scope_type = 'organization' and policy.scope_id = target_organization_id)
      or (policy.scope_type = 'module' and policy.scope_id = target_module_id)
      or (policy.scope_type = 'global' and policy.scope_id is null)
    )
  order by
    case policy.scope_type
      when 'organization' then 1
      when 'module' then 2
      else 3
    end,
    policy.created_at desc
  limit 1;

  if not found then
    raise exception 'active order acceptance policy is required';
  end if;

  return policy_record;
end;
$$;

create or replace function public.resolve_order_action_definition(
  target_action_key text,
  target_module_id uuid,
  target_organization_id uuid
)
returns public.order_action_definitions
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  action_record public.order_action_definitions%rowtype;
begin
  if target_action_key is null
    or target_action_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_action_key must be a valid platform key';
  end if;

  select action_definition.*
  into action_record
  from public.order_action_definitions action_definition
  where action_definition.key = target_action_key
    and action_definition.status = 'active'
    and (
      (action_definition.scope_type = 'organization' and action_definition.scope_id = target_organization_id)
      or (action_definition.scope_type = 'module' and action_definition.scope_id = target_module_id)
      or (action_definition.scope_type = 'global' and action_definition.scope_id is null)
    )
  order by
    case action_definition.scope_type
      when 'organization' then 1
      when 'module' then 2
      else 3
    end,
    action_definition.created_at desc
  limit 1;

  if not found then
    raise exception 'target_action_key must reference an active order action';
  end if;

  return action_record;
end;
$$;

create or replace function public.apply_order_reservation_effect(
  target_order_id uuid,
  target_effect text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  line_record record;
begin
  if target_order_id is null then
    raise exception 'target_order_id is required';
  end if;

  if target_effect not in ('none', 'release', 'consume') then
    raise exception 'target_effect is not supported';
  end if;

  if target_effect = 'none' then
    return;
  end if;

  for line_record in
    select
      order_line.id,
      order_line.availability_rule_id,
      order_line.quantity,
      order_line.stock_reservation_status
    from public.order_line_items order_line
    where order_line.order_id = target_order_id
      and order_line.stock_reservation_status = 'reserved'
    for update
  loop
    if line_record.availability_rule_id is not null then
      update public.catalog_availability_rules
      set reserved_quantity = greatest(reserved_quantity - line_record.quantity, 0),
          stock_quantity = case
            when target_effect = 'consume' and stock_quantity is not null
              then greatest(stock_quantity - line_record.quantity, 0)
            else stock_quantity
          end,
          capacity_used = case
            when target_effect = 'release' then greatest(capacity_used - line_record.quantity, 0)
            when target_effect = 'consume' then capacity_used
            else capacity_used
          end,
          updated_at = timezone('utc', now())
      where id = line_record.availability_rule_id;
    end if;

    update public.order_line_items
    set stock_reservation_status = case
          when target_effect = 'consume' then 'consumed'
          else 'released'
        end,
        fulfillment_status = case
          when target_effect = 'consume' then 'fulfilled'
          else fulfillment_status
        end,
        updated_at = timezone('utc', now())
    where id = line_record.id;
  end loop;
end;
$$;

create or replace function public.record_order_notification(
  target_order_id uuid,
  target_service_request_id uuid,
  target_organization_id uuid,
  target_requester_user_id uuid,
  target_event_type_key text,
  target_status text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  template_id uuid;
begin
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select template.id
  into template_id
  from public.notification_templates template
  where template.key = 'notification.order.status.in_app'
    and template.channel = 'in_app'
    and template.status = 'active'
  limit 1;

  insert into public.notification_messages (
    template_id,
    channel,
    recipient_entity_type,
    recipient_entity_id,
    status,
    payload,
    created_by,
    source,
    idempotency_key
  )
  values
    (
      template_id,
      'in_app',
      'user',
      target_requester_user_id,
      'queued',
      target_metadata || jsonb_build_object(
        'order_id',
        target_order_id,
        'service_request_id',
        target_service_request_id,
        'event_type_key',
        target_event_type_key,
        'status',
        target_status
      ),
      auth.uid(),
      'platform.order_engine',
      target_idempotency_key || ':requester'
    ),
    (
      template_id,
      'in_app',
      'organization',
      target_organization_id,
      'queued',
      target_metadata || jsonb_build_object(
        'order_id',
        target_order_id,
        'service_request_id',
        target_service_request_id,
        'event_type_key',
        target_event_type_key,
        'status',
        target_status
      ),
      auth.uid(),
      'platform.order_engine',
      target_idempotency_key || ':organization'
    )
  on conflict (source, idempotency_key)
  where idempotency_key is not null
  do nothing;

  insert into public.notification_message_events (
    notification_message_id,
    status,
    idempotency_key,
    metadata
  )
  select
    message.id,
    'queued',
    message.idempotency_key || ':queued',
    jsonb_build_object(
      'source',
      'platform.order_engine',
      'order_id',
      target_order_id,
      'event_type_key',
      target_event_type_key
    )
  from public.notification_messages message
  where message.source = 'platform.order_engine'
    and message.idempotency_key in (
      target_idempotency_key || ':requester',
      target_idempotency_key || ':organization'
    )
  on conflict do nothing;
end;
$$;

create or replace function public.apply_order_action_internal(
  target_order_id uuid,
  target_action_key text,
  target_reason text,
  target_payload jsonb,
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
  order_record public.order_records%rowtype;
  workflow_instance_record public.workflow_instances%rowtype;
  action_record public.order_action_definitions%rowtype;
  transition_record record;
  platform_event_id uuid;
  existing_order_event record;
  event_payload jsonb;
  next_workflow_status text;
begin
  if target_order_id is null then
    raise exception 'target_order_id is required';
  end if;

  if target_payload is null or jsonb_typeof(target_payload) <> 'object' then
    raise exception 'target_payload must be a JSON object';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select event.*
  into existing_order_event
  from public.order_events event
  where event.order_id = target_order_id
    and event.idempotency_key = target_idempotency_key;

  if found then
    return existing_order_event.event_id;
  end if;

  select order_table.*
  into order_record
  from public.order_records order_table
  where order_table.id = target_order_id
  for update;

  if not found then
    raise exception 'target_order_id must reference an existing order';
  end if;

  if order_record.workflow_instance_id is null then
    raise exception 'order workflow instance is missing';
  end if;

  select workflow_instance.*
  into workflow_instance_record
  from public.workflow_instances workflow_instance
  where workflow_instance.id = order_record.workflow_instance_id
  for update;

  if not found then
    raise exception 'order workflow instance must exist';
  end if;

  action_record := public.resolve_order_action_definition(
    target_action_key,
    order_record.module_id,
    order_record.organization_id
  );

  if action_record.requires_reason
    and (target_reason is null or btrim(target_reason) = '') then
    raise exception 'target_reason is required for this order action';
  end if;

  select
    transition.to_state_key,
    transition.action_policy_keys,
    transition.metadata,
    target_state.state_type
  into transition_record
  from public.workflow_transitions transition
  join public.workflow_states target_state
    on target_state.workflow_version_id = transition.workflow_version_id
    and target_state.key = transition.to_state_key
  where transition.workflow_version_id = workflow_instance_record.workflow_version_id
    and transition.from_state_key = workflow_instance_record.current_state_key
    and transition.event_type_key = action_record.event_type_key;

  if not found then
    raise exception 'no configured order workflow transition matches this action';
  end if;

  event_payload := target_payload || jsonb_build_object(
    'action_key',
    target_action_key,
    'reason',
    target_reason,
    'from_status',
    order_record.status,
    'to_status',
    transition_record.to_state_key
  );

  platform_event_id := public.record_platform_event(
    action_record.event_type_key,
    target_source,
    'order',
    target_order_id,
    event_payload,
    target_idempotency_key || ':platform-event',
    timezone('utc', now())
  );

  next_workflow_status := case
    when transition_record.state_type = 'terminal' then 'completed'
    when transition_record.state_type = 'failure' then 'failed'
    else 'running'
  end;

  update public.workflow_instances
  set current_state_key = transition_record.to_state_key,
      status = next_workflow_status,
      completed_at = case
        when next_workflow_status in ('completed', 'failed') then timezone('utc', now())
        else completed_at
      end,
      updated_at = timezone('utc', now())
  where id = workflow_instance_record.id;

  update public.event_log
  set status = 'processed',
      processed_at = timezone('utc', now())
  where id = platform_event_id
    and status in ('received', 'validated', 'processing');

  insert into public.workflow_instance_events (
    workflow_instance_id,
    event_id,
    from_state_key,
    to_state_key,
    idempotency_key,
    action_policy_keys,
    status,
    metadata
  )
  values (
    workflow_instance_record.id,
    platform_event_id,
    workflow_instance_record.current_state_key,
    transition_record.to_state_key,
    target_idempotency_key,
    transition_record.action_policy_keys,
    'processed',
    transition_record.metadata || target_metadata || jsonb_build_object(
      'action_key',
      target_action_key,
      'reason',
      target_reason
    )
  );

  perform public.apply_order_reservation_effect(target_order_id, action_record.reservation_effect);

  update public.order_line_items
  set fulfillment_status = action_record.line_fulfillment_status,
      updated_at = timezone('utc', now())
  where order_id = target_order_id
    and action_record.line_fulfillment_status is not null
    and fulfillment_status not in ('cancelled', 'failed', 'fulfilled');

  update public.order_records
  set status = transition_record.to_state_key,
      accepted_at = case when transition_record.to_state_key = 'accepted' then coalesce(accepted_at, timezone('utc', now())) else accepted_at end,
      preparing_at = case when transition_record.to_state_key = 'preparing' then coalesce(preparing_at, timezone('utc', now())) else preparing_at end,
      ready_at = case when transition_record.to_state_key = 'ready_for_pickup' then coalesce(ready_at, timezone('utc', now())) else ready_at end,
      fulfilled_at = case when transition_record.to_state_key = 'fulfilled' then coalesce(fulfilled_at, timezone('utc', now())) else fulfilled_at end,
      completed_at = case when transition_record.to_state_key = 'completed' then coalesce(completed_at, timezone('utc', now())) else completed_at end,
      cancelled_at = case when transition_record.to_state_key = 'cancelled' then coalesce(cancelled_at, timezone('utc', now())) else cancelled_at end,
      failed_at = case when transition_record.to_state_key in ('failed', 'timed_out') then coalesce(failed_at, timezone('utc', now())) else failed_at end,
      rejected_at = case when transition_record.to_state_key = 'rejected' then coalesce(rejected_at, timezone('utc', now())) else rejected_at end,
      disputed_at = case when transition_record.to_state_key = 'disputed' then coalesce(disputed_at, timezone('utc', now())) else disputed_at end,
      updated_at = timezone('utc', now())
  where id = target_order_id;

  update public.service_requests
  set status = coalesce(action_record.service_request_status, status),
      updated_at = timezone('utc', now())
  where id = order_record.service_request_id;

  insert into public.service_request_events (
    service_request_id,
    event_type_key,
    event_id,
    status,
    idempotency_key,
    metadata
  )
  values (
    order_record.service_request_id,
    action_record.event_type_key,
    platform_event_id,
    coalesce(action_record.service_request_status, order_record.status),
    target_idempotency_key || ':service-request',
    target_metadata || jsonb_build_object(
      'order_id',
      target_order_id,
      'order_status',
      transition_record.to_state_key,
      'action_key',
      target_action_key
    )
  )
  on conflict do nothing;

  insert into public.order_events (
    order_id,
    service_request_id,
    workflow_instance_id,
    event_type_key,
    event_id,
    from_status,
    to_status,
    actor_user_id,
    source,
    idempotency_key,
    metadata
  )
  values (
    target_order_id,
    order_record.service_request_id,
    workflow_instance_record.id,
    action_record.event_type_key,
    platform_event_id,
    order_record.status,
    transition_record.to_state_key,
    auth.uid(),
    target_source,
    target_idempotency_key,
    target_metadata || jsonb_build_object(
      'action_key',
      target_action_key,
      'reason',
      target_reason,
      'reservation_effect',
      action_record.reservation_effect
    )
  );

  perform public.record_order_notification(
    target_order_id,
    order_record.service_request_id,
    order_record.organization_id,
    order_record.requester_user_id,
    action_record.event_type_key,
    transition_record.to_state_key,
    target_idempotency_key || ':notification',
    target_metadata
  );

  return platform_event_id;
end;
$$;

create or replace function public.create_order_from_catalog(
  target_module_key text,
  target_organization_id uuid,
  target_branch_id uuid,
  target_line_items jsonb,
  target_fulfillment_method text default null,
  target_currency_code text default 'NGN',
  target_acceptance_policy_key text default null,
  target_order_payload jsonb default '{}'::jsonb,
  target_source text default 'platform.order_engine',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  module_record record;
  organization_record record;
  partner_record record;
  branch_record record;
  workflow_record record;
  acceptance_policy_record public.order_acceptance_policies%rowtype;
  service_request_id uuid;
  order_id uuid;
  existing_order record;
  platform_event_id uuid;
  line_record record;
  line_item_record public.catalog_items%rowtype;
  line_variant_record public.catalog_item_variants%rowtype;
  line_price_record public.catalog_prices%rowtype;
  line_availability_record public.catalog_availability_rules%rowtype;
  orderability_result jsonb;
  line_number integer;
  line_item_id uuid;
  line_variant_id uuid;
  line_price_id uuid;
  line_availability_rule_id uuid;
  line_quantity numeric(20, 8);
  line_amount numeric(28, 8);
  running_subtotal_amount numeric(28, 8) := 0;
  created_workflow_instance_id uuid;
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  if target_module_key is null
    or target_module_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_module_key must be a valid platform key';
  end if;

  if target_organization_id is null then
    raise exception 'target_organization_id is required';
  end if;

  if target_line_items is null
    or jsonb_typeof(target_line_items) <> 'array'
    or jsonb_array_length(target_line_items) = 0 then
    raise exception 'target_line_items must be a non-empty JSON array';
  end if;

  if target_order_payload is null or jsonb_typeof(target_order_payload) <> 'object' then
    raise exception 'target_order_payload must be a JSON object';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  if target_fulfillment_method is not null
    and target_fulfillment_method !~ '^[a-z][a-z0-9_.:-]{1,120}$' then
    raise exception 'target_fulfillment_method must be a valid platform key';
  end if;

  if target_currency_code is null
    or target_currency_code !~ '^[A-Z0-9]{3,12}$' then
    raise exception 'target_currency_code must be a valid currency code';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select existing.*
  into existing_order
  from public.order_records existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if found then
    if existing_order.organization_id <> target_organization_id
      or existing_order.branch_id is distinct from target_branch_id
      or existing_order.currency_code <> target_currency_code
      or existing_order.order_payload <> target_order_payload
      or existing_order.metadata -> 'line_items' <> target_line_items then
      raise exception 'target_idempotency_key has already been used with different order details';
    end if;

    return existing_order.id;
  end if;

  if not exists (
    select 1
    from public.currency_definitions currency
    where currency.code = target_currency_code
      and currency.status = 'enabled'
  ) then
    raise exception 'target_currency_code must reference an enabled currency';
  end if;

  select module.id, version.id as version_id
  into module_record
  from public.business_modules module
  join public.business_module_versions version on version.module_id = module.id
  where module.key = target_module_key
    and module.status = 'active'
    and version.status = 'active'
  order by version.version desc
  limit 1;

  if not found then
    raise exception 'target_module_key must reference an active module version';
  end if;

  select organization_table.*
  into organization_record
  from public.organizations organization_table
  where organization_table.id = target_organization_id
    and organization_table.status = 'active';

  if not found then
    raise exception 'target_organization_id must reference an active organization';
  end if;

  select partner.*
  into partner_record
  from public.partner_profiles partner
  where partner.organization_id = target_organization_id
    and partner.status = 'active';

  if not found then
    raise exception 'target_organization_id must reference an active partner organization';
  end if;

  if target_branch_id is not null then
    select branch.*
    into branch_record
    from public.organization_branches branch
    where branch.id = target_branch_id
      and branch.organization_id = target_organization_id
      and branch.status = 'active';

    if not found then
      raise exception 'target_branch_id must reference an active branch for this organization';
    end if;
  end if;

  select *
  into workflow_record
  from public.resolve_order_workflow_version(module_record.version_id);

  if workflow_record.workflow_version_id is null then
    raise exception 'active module version must bind an order_processing workflow component';
  end if;

  acceptance_policy_record := public.resolve_order_acceptance_policy(
    module_record.id,
    target_organization_id,
    target_acceptance_policy_key
  );

  insert into public.service_requests (
    module_id,
    module_version_id,
    requester_user_id,
    organization_id,
    status,
    request_payload,
    participants,
    source,
    idempotency_key,
    metadata
  )
  values (
    module_record.id,
    module_record.version_id,
    auth.uid(),
    target_organization_id,
    'requested',
    target_order_payload || jsonb_build_object(
      'order_engine',
      true,
      'branch_id',
      target_branch_id,
      'fulfillment_method',
      target_fulfillment_method,
      'line_item_count',
      jsonb_array_length(target_line_items)
    ),
    jsonb_build_object('partner_organization_id', target_organization_id),
    target_source,
    target_idempotency_key || ':service-request',
    target_metadata
  )
  returning id into service_request_id;

  insert into public.order_records (
    service_request_id,
    module_id,
    module_version_id,
    organization_id,
    branch_id,
    requester_user_id,
    acceptance_policy_id,
    status,
    fulfillment_method,
    currency_code,
    subtotal_amount,
    total_amount,
    order_payload,
    source,
    idempotency_key,
    metadata
  )
  values (
    service_request_id,
    module_record.id,
    module_record.version_id,
    target_organization_id,
    target_branch_id,
    auth.uid(),
    acceptance_policy_record.id,
    'received',
    target_fulfillment_method,
    target_currency_code,
    0,
    0,
    target_order_payload,
    target_source,
    target_idempotency_key,
    target_metadata || jsonb_build_object(
      'acceptance_policy_key',
      acceptance_policy_record.key,
      'acceptance_mode',
      acceptance_policy_record.acceptance_mode,
      'line_items',
      target_line_items
    )
  )
  returning id into order_id;

  insert into public.workflow_instances (
    workflow_version_id,
    current_state_key,
    subject_type,
    subject_id,
    status,
    context,
    started_by,
    source,
    idempotency_key
  )
  values (
    workflow_record.workflow_version_id,
    workflow_record.initial_state_key,
    'order',
    order_id,
    'running',
    target_metadata || jsonb_build_object(
      'module_key',
      target_module_key,
      'organization_id',
      target_organization_id,
      'branch_id',
      target_branch_id
    ),
    auth.uid(),
    target_source,
    target_idempotency_key || ':workflow'
  )
  returning id into created_workflow_instance_id;

  update public.order_records
  set workflow_instance_id = created_workflow_instance_id,
      updated_at = timezone('utc', now())
  where id = order_id;

  update public.service_requests
  set workflow_instance_id = created_workflow_instance_id,
      status = 'workflow_started',
      updated_at = timezone('utc', now())
  where id = service_request_id;

  line_number := 0;

  for line_record in
    select item_payload, ordinality::integer as ordinal_position
    from jsonb_array_elements(target_line_items) with ordinality as source_items(item_payload, ordinality)
  loop
    line_number := line_number + 1;

    if jsonb_typeof(line_record.item_payload) <> 'object' then
      raise exception 'each target_line_items entry must be a JSON object';
    end if;

    line_item_id := nullif(coalesce(line_record.item_payload ->> 'itemId', line_record.item_payload ->> 'item_id'), '')::uuid;
    line_variant_id := nullif(coalesce(line_record.item_payload ->> 'variantId', line_record.item_payload ->> 'variant_id'), '')::uuid;
    line_quantity := nullif(coalesce(line_record.item_payload ->> 'quantity', '0'), '')::numeric;

    if line_item_id is null then
      raise exception 'line item itemId is required';
    end if;

    if line_quantity is null or line_quantity <= 0 then
      raise exception 'line item quantity must be greater than zero';
    end if;

    orderability_result := public.validate_catalog_orderability(
      line_item_id,
      line_variant_id,
      target_branch_id,
      line_quantity,
      target_currency_code,
      target_source,
      target_idempotency_key || ':orderability:' || line_number,
      target_metadata || jsonb_build_object('order_id', order_id, 'line_number', line_number)
    );

    if coalesce((orderability_result ->> 'allowed')::boolean, false) is not true then
      raise exception 'catalog item is not orderable: %', coalesce(orderability_result ->> 'rejection_reason', 'unknown');
    end if;

    line_price_id := nullif(orderability_result ->> 'price_id', '')::uuid;
    line_availability_rule_id := nullif(orderability_result ->> 'availability_rule_id', '')::uuid;
    line_amount := (orderability_result ->> 'calculated_amount')::numeric;

    select item.*
    into line_item_record
    from public.catalog_items item
    where item.id = line_item_id;

    if not found then
      raise exception 'line item must reference an existing catalog item';
    end if;

    if line_item_record.organization_id <> target_organization_id then
      raise exception 'line item must belong to the target organization';
    end if;

    if target_branch_id is not null
      and line_item_record.branch_id is not null
      and line_item_record.branch_id <> target_branch_id then
      raise exception 'line item branch does not match target_branch_id';
    end if;

    if target_fulfillment_method is not null
      and not target_fulfillment_method = any(line_item_record.fulfillment_methods) then
      raise exception 'line item does not support the requested fulfillment method';
    end if;

    select price.*
    into line_price_record
    from public.catalog_prices price
    where price.id = line_price_id;

    if not found then
      raise exception 'validated price record is missing';
    end if;

    if line_variant_id is not null then
      select variant.*
      into line_variant_record
      from public.catalog_item_variants variant
      where variant.id = line_variant_id;
    end if;

    select availability.*
    into line_availability_record
    from public.catalog_availability_rules availability
    where availability.id = line_availability_rule_id
    for update;

    if not found then
      raise exception 'validated availability record is missing';
    end if;

    if line_availability_record.availability_status <> 'available'
      or line_availability_record.status <> 'active' then
      raise exception 'catalog availability is no longer available';
    end if;

    if line_availability_record.stock_quantity is not null
      and (line_availability_record.stock_quantity - line_availability_record.reserved_quantity) < line_quantity then
      raise exception 'insufficient stock is available';
    end if;

    if line_availability_record.capacity_limit is not null
      and (line_availability_record.capacity_limit - line_availability_record.capacity_used) < line_quantity then
      raise exception 'insufficient capacity is available';
    end if;

    insert into public.order_line_items (
      order_id,
      line_number,
      item_id,
      variant_id,
      price_id,
      availability_rule_id,
      quantity,
      unit_amount,
      line_amount,
      currency_code,
      fulfillment_status,
      stock_reservation_status,
      item_snapshot,
      metadata
    )
    values (
      order_id,
      line_number,
      line_item_id,
      line_variant_id,
      line_price_id,
      line_availability_rule_id,
      line_quantity,
      line_price_record.amount,
      line_amount,
      target_currency_code,
      'pending',
      case when line_availability_rule_id is null then 'not_required' else 'reserved' end,
      jsonb_build_object(
        'item_key',
        line_item_record.key,
        'item_type',
        line_item_record.item_type,
        'display_name',
        line_item_record.display_name,
        'variant_key',
        case when line_variant_id is null then null else line_variant_record.key end,
        'unit_amount',
        line_price_record.amount
      ),
      coalesce(line_record.item_payload -> 'metadata', '{}'::jsonb)
    );

    update public.catalog_availability_rules
    set reserved_quantity = reserved_quantity + line_quantity,
        capacity_used = case
          when capacity_limit is not null then capacity_used + line_quantity
          else capacity_used
        end,
        updated_at = timezone('utc', now())
    where id = line_availability_rule_id;

    running_subtotal_amount := running_subtotal_amount + line_amount;
  end loop;

  update public.order_records
  set subtotal_amount = running_subtotal_amount,
      total_amount = running_subtotal_amount,
      updated_at = timezone('utc', now())
  where id = order_id;

  update public.service_requests
  set request_payload = request_payload || jsonb_build_object(
        'order_id',
        order_id,
        'subtotal_amount',
        running_subtotal_amount,
        'total_amount',
        running_subtotal_amount,
        'currency_code',
        target_currency_code
      ),
      updated_at = timezone('utc', now())
  where id = service_request_id;

  platform_event_id := public.record_platform_event(
    'event.order.received',
    target_source,
    'order',
    order_id,
    target_order_payload || jsonb_build_object(
      'service_request_id',
      service_request_id,
      'organization_id',
      target_organization_id,
      'branch_id',
      target_branch_id,
      'subtotal_amount',
      running_subtotal_amount,
      'currency_code',
      target_currency_code
    ),
    target_idempotency_key || ':received',
    timezone('utc', now())
  );

  update public.event_log
  set status = 'processed',
      processed_at = timezone('utc', now())
  where id = platform_event_id
    and status in ('received', 'validated', 'processing');

  insert into public.service_request_events (
    service_request_id,
    event_type_key,
    event_id,
    status,
    idempotency_key,
    metadata
  )
  values (
    service_request_id,
    'event.order.received',
    platform_event_id,
    'workflow_started',
    target_idempotency_key || ':received',
    target_metadata || jsonb_build_object('order_id', order_id)
  )
  on conflict do nothing;

  insert into public.order_events (
    order_id,
    service_request_id,
    workflow_instance_id,
    event_type_key,
    event_id,
    from_status,
    to_status,
    actor_user_id,
    source,
    idempotency_key,
    metadata
  )
  values (
    order_id,
    service_request_id,
    created_workflow_instance_id,
    'event.order.received',
    platform_event_id,
    null,
    'received',
    auth.uid(),
    target_source,
    target_idempotency_key || ':received',
    target_metadata
  );

  perform public.record_order_notification(
    order_id,
    service_request_id,
    target_organization_id,
    auth.uid(),
    'event.order.received',
    'received',
    target_idempotency_key || ':received-notification',
    target_metadata
  );

  if acceptance_policy_record.acceptance_mode = 'automatic' then
    perform public.apply_order_action_internal(
      order_id,
      coalesce(acceptance_policy_record.auto_accept_action_key, 'order.accept'),
      null,
      jsonb_build_object('automatic', true, 'acceptance_policy_key', acceptance_policy_record.key),
      target_source,
      target_idempotency_key || ':auto-accept',
      target_metadata
    );
  end if;

  return order_id;
end;
$$;

create or replace function public.process_order_action(
  target_order_id uuid,
  target_action_key text,
  target_reason text default null,
  target_payload jsonb default '{}'::jsonb,
  target_source text default 'platform.order_engine',
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
  action_record public.order_action_definitions%rowtype;
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  if target_order_id is null then
    raise exception 'target_order_id is required';
  end if;

  select order_table.*
  into order_record
  from public.order_records order_table
  where order_table.id = target_order_id;

  if not found then
    raise exception 'target_order_id must reference an existing order';
  end if;

  action_record := public.resolve_order_action_definition(
    target_action_key,
    order_record.module_id,
    order_record.organization_id
  );

  if action_record.actor_scope = 'customer'
    and auth.role() <> 'service_role'
    and not public.can_execute_platform_runtime()
    and order_record.requester_user_id <> auth.uid() then
    raise exception 'only the order customer can perform this order action';
  end if;

  if action_record.actor_scope = 'business'
    and not public.can_process_business_order(order_record.organization_id, order_record.branch_id) then
    raise exception 'business order processing permission is required';
  end if;

  if action_record.actor_scope = 'customer_or_business'
    and auth.role() <> 'service_role'
    and not public.can_execute_platform_runtime()
    and order_record.requester_user_id <> auth.uid()
    and not public.can_process_business_order(order_record.organization_id, order_record.branch_id) then
    raise exception 'customer or business order processing permission is required';
  end if;

  if action_record.actor_scope = 'platform'
    and not public.can_execute_platform_runtime() then
    raise exception 'platform runtime execution permission is required';
  end if;

  if action_record.actor_scope = 'system'
    and auth.role() <> 'service_role' then
    raise exception 'service-role execution is required for this order action';
  end if;

  if action_record.actor_scope = 'any'
    and auth.role() <> 'service_role'
    and not public.can_execute_platform_runtime()
    and order_record.requester_user_id <> auth.uid()
    and not public.can_process_business_order(order_record.organization_id, order_record.branch_id) then
    raise exception 'order participant permission is required';
  end if;

  return public.apply_order_action_internal(
    target_order_id,
    target_action_key,
    target_reason,
    target_payload,
    target_source,
    target_idempotency_key,
    target_metadata
  );
end;
$$;

create or replace function public.assign_order_participant(
  target_order_id uuid,
  target_participant_role text,
  target_entity_type text,
  target_entity_id uuid,
  target_source text default 'platform.order_engine',
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
  assignment_id uuid;
  existing_assignment record;
  platform_event_id uuid;
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  if target_order_id is null then
    raise exception 'target_order_id is required';
  end if;

  if target_participant_role is null
    or target_participant_role !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_participant_role must be a valid platform key';
  end if;

  if target_entity_type is null
    or target_entity_type not in ('user', 'organization', 'partner', 'driver', 'vehicle', 'asset') then
    raise exception 'target_entity_type is not supported';
  end if;

  if target_entity_id is null then
    raise exception 'target_entity_id is required';
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
  into existing_assignment
  from public.order_assignments existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if found then
    return existing_assignment.id;
  end if;

  select order_table.*
  into order_record
  from public.order_records order_table
  where order_table.id = target_order_id
  for update;

  if not found then
    raise exception 'target_order_id must reference an existing order';
  end if;

  if not public.can_process_business_order(order_record.organization_id, order_record.branch_id) then
    raise exception 'business order processing permission is required';
  end if;

  update public.order_assignments
  set status = 'reassigned',
      updated_at = timezone('utc', now())
  where order_id = target_order_id
    and participant_role = target_participant_role
    and status = 'active';

  insert into public.order_assignments (
    order_id,
    service_request_id,
    participant_role,
    entity_type,
    entity_id,
    status,
    source,
    idempotency_key,
    metadata
  )
  values (
    target_order_id,
    order_record.service_request_id,
    target_participant_role,
    target_entity_type,
    target_entity_id,
    'active',
    target_source,
    target_idempotency_key,
    target_metadata
  )
  returning id into assignment_id;

  update public.service_requests
  set participants = participants || jsonb_build_object(
        target_participant_role,
        jsonb_build_object(
          'entity_type',
          target_entity_type,
          'entity_id',
          target_entity_id,
          'assignment_id',
          assignment_id
        )
      ),
      status = case
        when status in ('workflow_started', 'matching') then 'assigned'
        else status
      end,
      updated_at = timezone('utc', now())
  where id = order_record.service_request_id;

  platform_event_id := public.record_platform_event(
    'event.order.reassigned',
    target_source,
    'order',
    target_order_id,
    target_metadata || jsonb_build_object(
      'participant_role',
      target_participant_role,
      'entity_type',
      target_entity_type,
      'entity_id',
      target_entity_id
    ),
    target_idempotency_key || ':assigned',
    timezone('utc', now())
  );

  update public.event_log
  set status = 'processed',
      processed_at = timezone('utc', now())
  where id = platform_event_id
    and status in ('received', 'validated', 'processing');

  insert into public.order_events (
    order_id,
    service_request_id,
    workflow_instance_id,
    event_type_key,
    event_id,
    from_status,
    to_status,
    actor_user_id,
    source,
    idempotency_key,
    metadata
  )
  values (
    target_order_id,
    order_record.service_request_id,
    order_record.workflow_instance_id,
    'event.order.reassigned',
    platform_event_id,
    order_record.status,
    order_record.status,
    auth.uid(),
    target_source,
    target_idempotency_key || ':event',
    target_metadata || jsonb_build_object('assignment_id', assignment_id)
  );

  return assignment_id;
end;
$$;

create trigger audit_changes
after insert or update or delete on public.order_acceptance_policies
for each row execute function public.record_table_audit();

create trigger audit_changes
after insert or update or delete on public.order_action_definitions
for each row execute function public.record_table_audit();

create trigger audit_changes
after insert or update or delete on public.order_records
for each row execute function public.record_table_audit();

create trigger audit_changes
after insert or update or delete on public.order_line_items
for each row execute function public.record_table_audit();

create trigger audit_changes
after insert or update or delete on public.order_assignments
for each row execute function public.record_table_audit();

create trigger audit_changes
after insert or update or delete on public.order_events
for each row execute function public.record_table_audit();

create trigger set_updated_at
before update on public.order_acceptance_policies
for each row execute function public.set_updated_at();

create trigger set_updated_at
before update on public.order_action_definitions
for each row execute function public.set_updated_at();

create trigger set_updated_at
before update on public.order_records
for each row execute function public.set_updated_at();

create trigger set_updated_at
before update on public.order_line_items
for each row execute function public.set_updated_at();

create trigger set_updated_at
before update on public.order_assignments
for each row execute function public.set_updated_at();

drop trigger if exists prevent_order_events_update on public.order_events;
create trigger prevent_order_events_update
before update on public.order_events
for each row execute function public.prevent_order_event_mutation();

drop trigger if exists prevent_order_events_delete on public.order_events;
create trigger prevent_order_events_delete
before delete on public.order_events
for each row execute function public.prevent_order_event_mutation();

alter table public.order_acceptance_policies enable row level security;
alter table public.order_action_definitions enable row level security;
alter table public.order_records enable row level security;
alter table public.order_line_items enable row level security;
alter table public.order_assignments enable row level security;
alter table public.order_events enable row level security;

drop policy if exists order_acceptance_policies_select_authenticated on public.order_acceptance_policies;
drop policy if exists order_acceptance_policies_no_direct_insert on public.order_acceptance_policies;
drop policy if exists order_acceptance_policies_no_direct_update on public.order_acceptance_policies;
drop policy if exists order_acceptance_policies_no_direct_delete on public.order_acceptance_policies;

create policy order_acceptance_policies_select_authenticated
on public.order_acceptance_policies
for select to authenticated
using (status = 'active' or public.can_read_platform_runtime());

create policy order_acceptance_policies_no_direct_insert
on public.order_acceptance_policies
for insert to authenticated
with check (false);

create policy order_acceptance_policies_no_direct_update
on public.order_acceptance_policies
for update to authenticated
using (false)
with check (false);

create policy order_acceptance_policies_no_direct_delete
on public.order_acceptance_policies
for delete to authenticated
using (false);

drop policy if exists order_action_definitions_select_authenticated on public.order_action_definitions;
drop policy if exists order_action_definitions_no_direct_insert on public.order_action_definitions;
drop policy if exists order_action_definitions_no_direct_update on public.order_action_definitions;
drop policy if exists order_action_definitions_no_direct_delete on public.order_action_definitions;

create policy order_action_definitions_select_authenticated
on public.order_action_definitions
for select to authenticated
using (status = 'active' or public.can_read_platform_runtime());

create policy order_action_definitions_no_direct_insert
on public.order_action_definitions
for insert to authenticated
with check (false);

create policy order_action_definitions_no_direct_update
on public.order_action_definitions
for update to authenticated
using (false)
with check (false);

create policy order_action_definitions_no_direct_delete
on public.order_action_definitions
for delete to authenticated
using (false);

drop policy if exists order_records_select_customer_business_or_privileged on public.order_records;
drop policy if exists order_records_no_direct_insert on public.order_records;
drop policy if exists order_records_no_direct_update on public.order_records;
drop policy if exists order_records_no_direct_delete on public.order_records;

create policy order_records_select_customer_business_or_privileged
on public.order_records
for select to authenticated
using (
  requester_user_id = auth.uid()
  or public.can_read_business_order(organization_id, branch_id)
);

create policy order_records_no_direct_insert
on public.order_records
for insert to authenticated
with check (false);

create policy order_records_no_direct_update
on public.order_records
for update to authenticated
using (false)
with check (false);

create policy order_records_no_direct_delete
on public.order_records
for delete to authenticated
using (false);

drop policy if exists order_line_items_select_customer_business_or_privileged on public.order_line_items;
drop policy if exists order_line_items_no_direct_insert on public.order_line_items;
drop policy if exists order_line_items_no_direct_update on public.order_line_items;
drop policy if exists order_line_items_no_direct_delete on public.order_line_items;

create policy order_line_items_select_customer_business_or_privileged
on public.order_line_items
for select to authenticated
using (
  exists (
    select 1
    from public.order_records order_record
    where order_record.id = order_line_items.order_id
      and (
        order_record.requester_user_id = auth.uid()
        or public.can_read_business_order(order_record.organization_id, order_record.branch_id)
      )
  )
);

create policy order_line_items_no_direct_insert
on public.order_line_items
for insert to authenticated
with check (false);

create policy order_line_items_no_direct_update
on public.order_line_items
for update to authenticated
using (false)
with check (false);

create policy order_line_items_no_direct_delete
on public.order_line_items
for delete to authenticated
using (false);

drop policy if exists order_assignments_select_customer_business_or_privileged on public.order_assignments;
drop policy if exists order_assignments_no_direct_insert on public.order_assignments;
drop policy if exists order_assignments_no_direct_update on public.order_assignments;
drop policy if exists order_assignments_no_direct_delete on public.order_assignments;

create policy order_assignments_select_customer_business_or_privileged
on public.order_assignments
for select to authenticated
using (
  exists (
    select 1
    from public.order_records order_record
    where order_record.id = order_assignments.order_id
      and (
        order_record.requester_user_id = auth.uid()
        or public.can_read_business_order(order_record.organization_id, order_record.branch_id)
      )
  )
);

create policy order_assignments_no_direct_insert
on public.order_assignments
for insert to authenticated
with check (false);

create policy order_assignments_no_direct_update
on public.order_assignments
for update to authenticated
using (false)
with check (false);

create policy order_assignments_no_direct_delete
on public.order_assignments
for delete to authenticated
using (false);

drop policy if exists order_events_select_customer_business_or_privileged on public.order_events;
drop policy if exists order_events_no_direct_insert on public.order_events;
drop policy if exists order_events_no_direct_update on public.order_events;
drop policy if exists order_events_no_direct_delete on public.order_events;

create policy order_events_select_customer_business_or_privileged
on public.order_events
for select to authenticated
using (
  exists (
    select 1
    from public.order_records order_record
    where order_record.id = order_events.order_id
      and (
        order_record.requester_user_id = auth.uid()
        or public.can_read_business_order(order_record.organization_id, order_record.branch_id)
      )
  )
);

create policy order_events_no_direct_insert
on public.order_events
for insert to authenticated
with check (false);

create policy order_events_no_direct_update
on public.order_events
for update to authenticated
using (false)
with check (false);

create policy order_events_no_direct_delete
on public.order_events
for delete to authenticated
using (false);

grant select, insert, update, delete on
  public.order_acceptance_policies,
  public.order_action_definitions,
  public.order_records,
  public.order_line_items,
  public.order_assignments,
  public.order_events
to authenticated;

grant select, insert, update, delete on
  public.order_acceptance_policies,
  public.order_action_definitions,
  public.order_records,
  public.order_line_items,
  public.order_assignments,
  public.order_events
to service_role;

revoke all on function public.prevent_order_event_mutation() from public;
revoke all on function public.can_read_business_order(uuid, uuid) from public;
revoke all on function public.can_process_business_order(uuid, uuid) from public;
revoke all on function public.resolve_order_workflow_version(uuid) from public;
revoke all on function public.resolve_order_acceptance_policy(uuid, uuid, text) from public;
revoke all on function public.resolve_order_action_definition(text, uuid, uuid) from public;
revoke all on function public.apply_order_reservation_effect(uuid, text) from public;
revoke all on function public.record_order_notification(uuid, uuid, uuid, uuid, text, text, text, jsonb) from public;
revoke all on function public.apply_order_action_internal(uuid, text, text, jsonb, text, text, jsonb) from public;
revoke all on function public.create_order_from_catalog(text, uuid, uuid, jsonb, text, text, text, jsonb, text, text, jsonb) from public;
revoke all on function public.process_order_action(uuid, text, text, jsonb, text, text, jsonb) from public;
revoke all on function public.assign_order_participant(uuid, text, text, uuid, text, text, jsonb) from public;

revoke all on function public.prevent_order_event_mutation() from anon;
revoke all on function public.can_read_business_order(uuid, uuid) from anon;
revoke all on function public.can_process_business_order(uuid, uuid) from anon;
revoke all on function public.resolve_order_workflow_version(uuid) from anon;
revoke all on function public.resolve_order_acceptance_policy(uuid, uuid, text) from anon;
revoke all on function public.resolve_order_action_definition(text, uuid, uuid) from anon;
revoke all on function public.apply_order_reservation_effect(uuid, text) from anon;
revoke all on function public.record_order_notification(uuid, uuid, uuid, uuid, text, text, text, jsonb) from anon;
revoke all on function public.apply_order_action_internal(uuid, text, text, jsonb, text, text, jsonb) from anon;
revoke all on function public.create_order_from_catalog(text, uuid, uuid, jsonb, text, text, text, jsonb, text, text, jsonb) from anon;
revoke all on function public.process_order_action(uuid, text, text, jsonb, text, text, jsonb) from anon;
revoke all on function public.assign_order_participant(uuid, text, text, uuid, text, text, jsonb) from anon;

grant execute on function public.can_read_business_order(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_process_business_order(uuid, uuid) to authenticated, service_role;
grant execute on function public.create_order_from_catalog(text, uuid, uuid, jsonb, text, text, text, jsonb, text, text, jsonb) to authenticated, service_role;
grant execute on function public.process_order_action(uuid, text, text, jsonb, text, text, jsonb) to authenticated, service_role;
grant execute on function public.assign_order_participant(uuid, text, text, uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function public.resolve_order_workflow_version(uuid) to service_role;
grant execute on function public.resolve_order_acceptance_policy(uuid, uuid, text) to service_role;
grant execute on function public.resolve_order_action_definition(text, uuid, uuid) to service_role;
grant execute on function public.apply_order_reservation_effect(uuid, text) to service_role;
grant execute on function public.record_order_notification(uuid, uuid, uuid, uuid, text, text, text, jsonb) to service_role;
grant execute on function public.apply_order_action_internal(uuid, text, text, jsonb, text, text, jsonb) to service_role;

insert into public.event_types (key, description, schema, status)
values
  ('event.order.received', 'A module-backed order was received by the platform order engine.', '{}'::jsonb, 'active'),
  ('event.order.accepted', 'A business accepted an order according to the configured order workflow.', '{}'::jsonb, 'active'),
  ('event.order.rejected', 'A business rejected an order with a controlled reason.', '{}'::jsonb, 'active'),
  ('event.order.preparation.started', 'A business started order preparation or service work.', '{}'::jsonb, 'active'),
  ('event.order.ready_for_pickup', 'An order is ready for pickup or next fulfilment step.', '{}'::jsonb, 'active'),
  ('event.order.partially_fulfilled', 'An order was partially fulfilled where the workflow permits it.', '{}'::jsonb, 'active'),
  ('event.order.fulfilled', 'A business completed fulfilment for an order.', '{}'::jsonb, 'active'),
  ('event.order.completed', 'An order lifecycle completed after all configured conditions were satisfied.', '{}'::jsonb, 'active'),
  ('event.order.cancelled', 'An order was cancelled according to configured rules.', '{}'::jsonb, 'active'),
  ('event.order.failed', 'An order failed according to configured rules.', '{}'::jsonb, 'active'),
  ('event.order.timed_out', 'An order timed out according to configured policy.', '{}'::jsonb, 'active'),
  ('event.order.disputed', 'An order entered dispute state.', '{}'::jsonb, 'active'),
  ('event.order.reassignment.requested', 'An order reassignment was requested according to configured workflow.', '{}'::jsonb, 'active'),
  ('event.order.reassigned', 'An order participant assignment changed.', '{}'::jsonb, 'active')
on conflict (key) do update
set description = excluded.description,
    schema = excluded.schema,
    status = excluded.status,
    updated_at = timezone('utc', now());

insert into public.notification_templates (
  key,
  channel,
  locale,
  subject_template,
  body_template,
  variables_schema,
  status
)
values (
  'notification.order.status.in_app',
  'in_app',
  'en',
  'Order status updated',
  'Order {{order_id}} moved to {{status}}.',
  jsonb_build_object(
    'required',
    jsonb_build_array('order_id', 'status'),
    'properties',
    jsonb_build_object(
      'order_id',
      jsonb_build_object('type', 'string'),
      'status',
      jsonb_build_object('type', 'string')
    )
  ),
  'active'
)
on conflict (key) do update
set channel = excluded.channel,
    locale = excluded.locale,
    subject_template = excluded.subject_template,
    body_template = excluded.body_template,
    variables_schema = excluded.variables_schema,
    status = excluded.status,
    updated_at = timezone('utc', now());

do $$
declare
  action_record record;
begin
  for action_record in
    select *
    from (
      values
        ('order.accept', 'Accept Order', 'event.order.accepted', 'business', 'in_progress', 'accepted', 'none', false),
        ('order.reject', 'Reject Order', 'event.order.rejected', 'business', 'cancelled', 'cancelled', 'release', true),
        ('order.start_preparation', 'Start Preparation', 'event.order.preparation.started', 'business', 'in_progress', 'preparing', 'none', false),
        ('order.ready_for_pickup', 'Ready For Pickup', 'event.order.ready_for_pickup', 'business', 'in_progress', 'ready', 'none', false),
        ('order.partially_fulfill', 'Partially Fulfill Order', 'event.order.partially_fulfilled', 'business', 'fulfilled', 'partially_fulfilled', 'none', false),
        ('order.fulfill', 'Fulfill Order', 'event.order.fulfilled', 'business', 'fulfilled', 'fulfilled', 'consume', false),
        ('order.complete', 'Complete Order', 'event.order.completed', 'customer_or_business', 'completed', 'fulfilled', 'none', false),
        ('order.cancel', 'Cancel Order', 'event.order.cancelled', 'customer_or_business', 'cancelled', 'cancelled', 'release', true),
        ('order.fail', 'Fail Order', 'event.order.failed', 'business', 'failed', 'failed', 'release', true),
        ('order.timeout', 'Timeout Order', 'event.order.timed_out', 'system', 'failed', 'failed', 'release', false),
        ('order.dispute', 'Dispute Order', 'event.order.disputed', 'customer_or_business', 'disputed', null, 'none', true),
        ('order.request_reassignment', 'Request Reassignment', 'event.order.reassignment.requested', 'business', 'matching', null, 'none', true),
        ('order.reassign', 'Reassign Order', 'event.order.reassigned', 'business', 'assigned', null, 'none', false)
    ) as configured_actions(
      key,
      display_name,
      event_type_key,
      actor_scope,
      service_request_status,
      line_fulfillment_status,
      reservation_effect,
      requires_reason
    )
  loop
    insert into public.order_action_definitions (
      key,
      display_name,
      scope_type,
      scope_id,
      event_type_key,
      actor_scope,
      service_request_status,
      line_fulfillment_status,
      reservation_effect,
      requires_reason,
      status,
      metadata
    )
    select
      action_record.key,
      action_record.display_name,
      'global',
      null,
      action_record.event_type_key,
      action_record.actor_scope,
      action_record.service_request_status,
      action_record.line_fulfillment_status,
      action_record.reservation_effect,
      action_record.requires_reason,
      'active',
      jsonb_build_object('system_seed', true)
    where not exists (
      select 1
      from public.order_action_definitions existing
      where existing.scope_type = 'global'
        and existing.scope_id is null
        and existing.key = action_record.key
    );

    update public.order_action_definitions
    set display_name = action_record.display_name,
        event_type_key = action_record.event_type_key,
        actor_scope = action_record.actor_scope,
        service_request_status = action_record.service_request_status,
        line_fulfillment_status = action_record.line_fulfillment_status,
        reservation_effect = action_record.reservation_effect,
        requires_reason = action_record.requires_reason,
        status = 'active',
        metadata = metadata || jsonb_build_object('system_seed', true),
        updated_at = timezone('utc', now())
    where scope_type = 'global'
      and scope_id is null
      and key = action_record.key;
  end loop;
end;
$$;

insert into public.order_acceptance_policies (
  key,
  display_name,
  scope_type,
  scope_id,
  acceptance_mode,
  auto_accept_action_key,
  rejection_reasons,
  timeout_seconds,
  status,
  metadata
)
select
  'order.acceptance.manual.default',
  'Manual Acceptance',
  'global',
  null,
  'manual',
  null,
  array['out_of_stock', 'closed', 'capacity_unavailable', 'policy_restriction', 'other'],
  900,
  'active',
  jsonb_build_object('system_seed', true)
where not exists (
  select 1
  from public.order_acceptance_policies policy
  where policy.scope_type = 'global'
    and policy.scope_id is null
    and policy.key = 'order.acceptance.manual.default'
);

update public.order_acceptance_policies
set display_name = 'Manual Acceptance',
    acceptance_mode = 'manual',
    auto_accept_action_key = null,
    rejection_reasons = array['out_of_stock', 'closed', 'capacity_unavailable', 'policy_restriction', 'other'],
    timeout_seconds = 900,
    status = 'active',
    metadata = metadata || jsonb_build_object('system_seed', true),
    updated_at = timezone('utc', now())
where scope_type = 'global'
  and scope_id is null
  and key = 'order.acceptance.manual.default';

insert into public.workflow_definitions (
  key,
  display_name,
  description,
  status,
  metadata
)
values (
  'workflow.order.processing.default',
  'Default Order Processing Workflow',
  'Reusable order receiving and processing workflow used by module configuration.',
  'active',
  jsonb_build_object('engine', 'order_operations', 'system_seed', true)
)
on conflict (key) do update
set display_name = excluded.display_name,
    description = excluded.description,
    status = excluded.status,
    metadata = excluded.metadata,
    updated_at = timezone('utc', now());

with workflow_definition as (
  select id from public.workflow_definitions where key = 'workflow.order.processing.default'
)
insert into public.workflow_versions (
  workflow_id,
  version,
  status,
  definition,
  activated_at
)
select
  workflow_definition.id,
  1,
  'active',
  jsonb_build_object(
    'states',
    jsonb_build_array(
      'received',
      'accepted',
      'preparing',
      'ready_for_pickup',
      'partially_fulfilled',
      'fulfilled',
      'completed',
      'rejected',
      'cancelled',
      'failed',
      'timed_out',
      'reassignment_requested',
      'disputed'
    ),
    'source',
    'platform.order_engine'
  ),
  timezone('utc', now())
from workflow_definition
on conflict (workflow_id, version) do update
set status = excluded.status,
    definition = excluded.definition,
    activated_at = coalesce(public.workflow_versions.activated_at, excluded.activated_at),
    updated_at = timezone('utc', now());

with active_order_workflow_version as (
  select version.id
  from public.workflow_versions version
  join public.workflow_definitions workflow on workflow.id = version.workflow_id
  where workflow.key = 'workflow.order.processing.default'
    and version.version = 1
)
insert into public.workflow_states (
  workflow_version_id,
  key,
  display_name,
  state_type,
  metadata
)
select
  active_order_workflow_version.id,
  state_definition.key,
  state_definition.display_name,
  state_definition.state_type,
  jsonb_build_object('system_seed', true)
from active_order_workflow_version
cross join (
  values
    ('received', 'Received', 'initial'),
    ('accepted', 'Accepted', 'normal'),
    ('preparing', 'Preparing', 'normal'),
    ('ready_for_pickup', 'Ready For Pickup', 'normal'),
    ('partially_fulfilled', 'Partially Fulfilled', 'normal'),
    ('fulfilled', 'Fulfilled', 'normal'),
    ('reassignment_requested', 'Reassignment Requested', 'normal'),
    ('disputed', 'Disputed', 'normal'),
    ('completed', 'Completed', 'terminal'),
    ('cancelled', 'Cancelled', 'terminal'),
    ('rejected', 'Rejected', 'failure'),
    ('failed', 'Failed', 'failure'),
    ('timed_out', 'Timed Out', 'failure')
) as state_definition(key, display_name, state_type)
on conflict (workflow_version_id, key) do update
set display_name = excluded.display_name,
    state_type = excluded.state_type,
    metadata = excluded.metadata,
    updated_at = timezone('utc', now());

with active_order_workflow_version as (
  select version.id
  from public.workflow_versions version
  join public.workflow_definitions workflow on workflow.id = version.workflow_id
  where workflow.key = 'workflow.order.processing.default'
    and version.version = 1
)
insert into public.workflow_transitions (
  workflow_version_id,
  from_state_key,
  to_state_key,
  event_type_key,
  guard_policy_key,
  action_policy_keys,
  metadata
)
select
  active_order_workflow_version.id,
  transition_definition.from_state_key,
  transition_definition.to_state_key,
  transition_definition.event_type_key,
  null,
  transition_definition.action_policy_keys,
  jsonb_build_object('actor_scope', transition_definition.actor_scope, 'system_seed', true)
from active_order_workflow_version
cross join (
  values
    ('received', 'accepted', 'event.order.accepted', array['order.accept'], 'business'),
    ('received', 'rejected', 'event.order.rejected', array['order.reject'], 'business'),
    ('received', 'cancelled', 'event.order.cancelled', array['order.cancel'], 'customer_or_business'),
    ('received', 'timed_out', 'event.order.timed_out', array['order.timeout'], 'system'),
    ('accepted', 'preparing', 'event.order.preparation.started', array['order.start_preparation'], 'business'),
    ('accepted', 'ready_for_pickup', 'event.order.ready_for_pickup', array['order.ready_for_pickup'], 'business'),
    ('accepted', 'fulfilled', 'event.order.fulfilled', array['order.fulfill'], 'business'),
    ('accepted', 'cancelled', 'event.order.cancelled', array['order.cancel'], 'customer_or_business'),
    ('accepted', 'failed', 'event.order.failed', array['order.fail'], 'business'),
    ('accepted', 'disputed', 'event.order.disputed', array['order.dispute'], 'customer_or_business'),
    ('accepted', 'reassignment_requested', 'event.order.reassignment.requested', array['order.request_reassignment'], 'business'),
    ('preparing', 'ready_for_pickup', 'event.order.ready_for_pickup', array['order.ready_for_pickup'], 'business'),
    ('preparing', 'partially_fulfilled', 'event.order.partially_fulfilled', array['order.partially_fulfill'], 'business'),
    ('preparing', 'cancelled', 'event.order.cancelled', array['order.cancel'], 'customer_or_business'),
    ('preparing', 'failed', 'event.order.failed', array['order.fail'], 'business'),
    ('preparing', 'disputed', 'event.order.disputed', array['order.dispute'], 'customer_or_business'),
    ('partially_fulfilled', 'ready_for_pickup', 'event.order.ready_for_pickup', array['order.ready_for_pickup'], 'business'),
    ('partially_fulfilled', 'fulfilled', 'event.order.fulfilled', array['order.fulfill'], 'business'),
    ('partially_fulfilled', 'cancelled', 'event.order.cancelled', array['order.cancel'], 'customer_or_business'),
    ('partially_fulfilled', 'failed', 'event.order.failed', array['order.fail'], 'business'),
    ('partially_fulfilled', 'disputed', 'event.order.disputed', array['order.dispute'], 'customer_or_business'),
    ('ready_for_pickup', 'fulfilled', 'event.order.fulfilled', array['order.fulfill'], 'business'),
    ('ready_for_pickup', 'failed', 'event.order.failed', array['order.fail'], 'business'),
    ('ready_for_pickup', 'disputed', 'event.order.disputed', array['order.dispute'], 'customer_or_business'),
    ('ready_for_pickup', 'reassignment_requested', 'event.order.reassignment.requested', array['order.request_reassignment'], 'business'),
    ('fulfilled', 'completed', 'event.order.completed', array['order.complete'], 'customer_or_business'),
    ('fulfilled', 'disputed', 'event.order.disputed', array['order.dispute'], 'customer_or_business'),
    ('disputed', 'completed', 'event.order.completed', array['order.complete'], 'customer_or_business'),
    ('disputed', 'cancelled', 'event.order.cancelled', array['order.cancel'], 'customer_or_business'),
    ('disputed', 'failed', 'event.order.failed', array['order.fail'], 'business'),
    ('reassignment_requested', 'accepted', 'event.order.reassigned', array['order.reassign'], 'business'),
    ('reassignment_requested', 'cancelled', 'event.order.cancelled', array['order.cancel'], 'customer_or_business'),
    ('reassignment_requested', 'failed', 'event.order.failed', array['order.fail'], 'business')
) as transition_definition(
  from_state_key,
  to_state_key,
  event_type_key,
  action_policy_keys,
  actor_scope
)
on conflict (workflow_version_id, from_state_key, event_type_key) do update
set to_state_key = excluded.to_state_key,
    guard_policy_key = excluded.guard_policy_key,
    action_policy_keys = excluded.action_policy_keys,
    metadata = excluded.metadata,
    updated_at = timezone('utc', now());

do $$
declare
  active_lpg_version_id uuid;
begin
  select version.id
  into active_lpg_version_id
  from public.business_modules module
  join public.business_module_versions version on version.module_id = module.id
  where module.key = 'lpg'
    and module.status = 'active'
    and version.status = 'active'
  order by version.version desc
  limit 1;

  if active_lpg_version_id is not null then
    insert into public.business_module_components (
      module_version_id,
      component_type,
      component_key,
      reference_key,
      is_required,
      config,
      status
    )
    values (
      active_lpg_version_id,
      'workflow',
      'lpg.workflow.order-processing',
      'workflow.order.processing.default',
      true,
      jsonb_build_object('purpose', 'order_processing', 'configured_only', true),
      'active'
    )
    on conflict (module_version_id, component_type, component_key) do update
    set reference_key = excluded.reference_key,
        is_required = excluded.is_required,
        config = excluded.config,
        status = excluded.status,
        updated_at = timezone('utc', now());
  end if;
end;
$$;

commit;
