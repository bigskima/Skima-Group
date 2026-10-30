begin;

insert into public.permissions (key, description, risk_level)
values
  ('module.fuel.read', 'Read the Fuel module and fuel order operations.', 'standard'),
  ('module.fuel.manage', 'Manage Fuel module configuration.', 'critical'),
  ('module.fuel.operate', 'Operate Fuel fulfilment workflows.', 'high'),
  ('business.fuel.orders.read', 'Read Fuel orders for an authorized station organization.', 'standard'),
  ('business.fuel.orders.process', 'Process Fuel station preparation and handover stages.', 'high'),
  ('business.fuel.orders.manage', 'Manage Fuel station orders and controlled exceptions.', 'high')
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    updated_at = timezone('utc', now());

insert into public.role_permissions (role_id, permission_id)
select role_record.id, permission_record.id
from public.roles role_record
join public.permissions permission_record
  on permission_record.key in ('platform.fuel.read', 'platform.fuel.manage', 'module.fuel.read', 'module.fuel.manage')
where role_record.key = 'platform.module_admin'
  and role_record.organization_id is null
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role_record.id, permission_record.id
from public.roles role_record
join public.permissions permission_record
  on permission_record.key in ('platform.fuel.read', 'module.fuel.read')
where role_record.key = 'platform.operations_admin'
  and role_record.organization_id is null
on conflict (role_id, permission_id) do nothing;

insert into public.event_types (key, description, schema, status)
values
  ('event.fuel.operation.stage_changed', 'A fuel order operational stage changed through the controlled fuel runtime.', '{"required":["order_id","from_stage","to_stage","product_key"]}'::jsonb, 'active'),
  ('event.fuel.operation.exception_recorded', 'A fuel order operational exception was recorded.', '{"required":["order_id","stage","reason"]}'::jsonb, 'active')
on conflict (key) do update
set description = excluded.description,
    schema = excluded.schema,
    status = excluded.status,
    updated_at = timezone('utc', now());

-- Module pricing remains quoted from the authoritative fuel commercial snapshot.
insert into public.pricing_policies (
  key, display_name, pricing_mode, scope_type, scope_id,
  currency_code, rules, status, version
)
select
  'pricing.fuel.commercial-snapshot.v1',
  'Fuel Commercial Snapshot',
  'quoted',
  'module',
  module.id,
  null,
  jsonb_build_object(
    'quote_source', 'fuel_order_commercial_snapshots',
    'client_amounts_authoritative', false,
    'unit', 'L',
    'components', jsonb_build_array('fuel', 'container', 'driver', 'platform_fee', 'tax', 'refundable_deposit')
  ),
  'active',
  1
from public.business_modules module
where module.key = 'fuel'
  and not exists (
    select 1 from public.pricing_policies policy
    where policy.key = 'pricing.fuel.commercial-snapshot.v1'
      and policy.scope_type = 'module'
      and policy.scope_id = module.id
      and policy.version = 1
  );

insert into public.settlement_policies (
  key, display_name, scope_type, scope_id,
  flow_schema, beneficiary_schema, release_policy, status, version
)
select
  'settlement.fuel.escrow.station-driver.v1',
  'Fuel Escrow Station and Driver Settlement',
  'module',
  module.id,
  jsonb_build_object(
    'intake', 'customer_to_platform_gateway',
    'holding_wallet', 'escrow',
    'direct_partner_payment', false,
    'direct_driver_payment', false,
    'commercial_snapshot', 'fuel_order_commercial_snapshots'
  ),
  jsonb_build_object(
    'beneficiaries', jsonb_build_array(
      jsonb_build_object('role', 'station', 'amount_source', 'verified_fuel_and_station_component'),
      jsonb_build_object('role', 'driver', 'amount_source', 'verified_driver_component'),
      jsonb_build_object('role', 'platform', 'amount_source', 'configured_platform_fee'),
      jsonb_build_object('role', 'container_sale', 'amount_source', 'verified_container_purchase_component')
    ),
    'refundable_deposit', jsonb_build_object(
      'treatment', 'refundable_liability',
      'release_condition', 'rental_container_received_and_inspected'
    )
  ),
  jsonb_build_object(
    'release_controller', 'workflow_engine',
    'refund_controller', 'escrow_engine',
    'deposit_controller', 'fuel_container_return_runtime',
    'requires_reconciliation', true
  ),
  'active',
  1
from public.business_modules module
where module.key = 'fuel'
  and not exists (
    select 1 from public.settlement_policies policy
    where policy.key = 'settlement.fuel.escrow.station-driver.v1'
      and policy.scope_type = 'module'
      and policy.scope_id = module.id
      and policy.version = 1
  );

insert into public.dispatch_policies (key, display_name, matching_strategy, rules, status)
values
  (
    'dispatch.fuel.pms.nearest-qualified-driver.v1',
    'PMS Nearest Approved Driver',
    'capability_distance',
    '{"candidate_type":"driver","distance_priority":true,"availability_required":true,"required_capabilities":["capability.driver.fuel-delivery","capability.driver.fuel-pms-delivery","capability.cargo.liquid-fuel-container"],"vehicle_required_capabilities":["capability.vehicle.liquid-fuel-transport"],"product_key":"fuel.pms","capacity_source":"vehicle.capacity_profile","approval_must_be_current":true}'::jsonb,
    'active'
  ),
  (
    'dispatch.fuel.ago.nearest-qualified-driver.v1',
    'AGO Nearest Approved Driver',
    'capability_distance',
    '{"candidate_type":"driver","distance_priority":true,"availability_required":true,"required_capabilities":["capability.driver.fuel-delivery","capability.driver.fuel-ago-delivery","capability.cargo.liquid-fuel-container"],"vehicle_required_capabilities":["capability.vehicle.liquid-fuel-transport"],"product_key":"fuel.ago","capacity_source":"vehicle.capacity_profile","approval_must_be_current":true}'::jsonb,
    'active'
  ),
  (
    'dispatch.fuel.dpk.nearest-qualified-driver.v1',
    'DPK Nearest Approved Driver',
    'capability_distance',
    '{"candidate_type":"driver","distance_priority":true,"availability_required":true,"required_capabilities":["capability.driver.fuel-delivery","capability.driver.fuel-dpk-delivery","capability.cargo.liquid-fuel-container"],"vehicle_required_capabilities":["capability.vehicle.liquid-fuel-transport"],"product_key":"fuel.dpk","capacity_source":"vehicle.capacity_profile","approval_must_be_current":true}'::jsonb,
    'active'
  )
on conflict (key) do update
set display_name = excluded.display_name,
    matching_strategy = excluded.matching_strategy,
    rules = excluded.rules,
    status = excluded.status,
    updated_at = timezone('utc', now());

insert into public.workflow_definitions (key, display_name, description, status, metadata)
values (
  'workflow.fuel.station-fill-delivery',
  'Fuel Station Fill and Delivery',
  'Fuel-specific station preparation, filled-container dispatch, customer delivery and rental-container return workflow.',
  'active',
  '{"module_key":"fuel","fulfillment_profile":"station_fill_container_delivery","engine":"order_operations"}'::jsonb
)
on conflict (key) do update
set display_name = excluded.display_name,
    description = excluded.description,
    status = excluded.status,
    metadata = excluded.metadata,
    updated_at = timezone('utc', now());

with definition as (
  select id from public.workflow_definitions where key = 'workflow.fuel.station-fill-delivery'
)
insert into public.workflow_versions (workflow_id, version, status, definition, activated_at)
select
  definition.id,
  1,
  'active',
  '{
    "module_key":"fuel",
    "purpose":"order_processing",
    "states":["received","accepted","preparing","ready_for_pickup","fulfilled","completed","rejected","cancelled","failed","timed_out","disputed"],
    "operational_timeline":"fuel_order_operations"
  }'::jsonb,
  timezone('utc', now())
from definition
on conflict (workflow_id, version) do update
set status = excluded.status,
    definition = excluded.definition,
    activated_at = coalesce(public.workflow_versions.activated_at, excluded.activated_at),
    updated_at = timezone('utc', now());

with version_record as (
  select version.id
  from public.workflow_versions version
  join public.workflow_definitions definition on definition.id = version.workflow_id
  where definition.key = 'workflow.fuel.station-fill-delivery'
    and version.version = 1
)
insert into public.workflow_states (workflow_version_id, key, display_name, state_type, metadata)
select version_record.id, state.key, state.display_name, state.state_type, '{"module_key":"fuel"}'::jsonb
from version_record
cross join (values
  ('received','Received','initial'),
  ('accepted','Accepted','normal'),
  ('preparing','Preparing at Station','normal'),
  ('ready_for_pickup','Ready for Driver','normal'),
  ('fulfilled','Delivered','normal'),
  ('completed','Completed','terminal'),
  ('rejected','Rejected','failure'),
  ('cancelled','Cancelled','failure'),
  ('failed','Failed','failure'),
  ('timed_out','Timed Out','failure'),
  ('disputed','Disputed','normal')
) as state(key,display_name,state_type)
on conflict (workflow_version_id,key) do update
set display_name=excluded.display_name,state_type=excluded.state_type,metadata=excluded.metadata,updated_at=timezone('utc',now());

with version_record as (
  select version.id
  from public.workflow_versions version
  join public.workflow_definitions definition on definition.id = version.workflow_id
  where definition.key = 'workflow.fuel.station-fill-delivery'
    and version.version = 1
)
insert into public.workflow_transitions (
  workflow_version_id,from_state_key,to_state_key,event_type_key,guard_policy_key,action_policy_keys,metadata
)
select version_record.id,transition.from_state,transition.to_state,transition.event_key,null,transition.action_keys,
       jsonb_build_object('module_key','fuel','actor_scope',transition.actor_scope)
from version_record
cross join (values
  ('received','accepted','event.order.accepted',array['order.accept'],'business'),
  ('received','rejected','event.order.rejected',array['order.reject'],'business'),
  ('received','cancelled','event.order.cancelled',array['order.cancel'],'customer_or_business'),
  ('received','timed_out','event.order.timed_out',array['order.timeout'],'system'),
  ('accepted','preparing','event.order.preparation.started',array['order.start_preparation'],'business'),
  ('accepted','cancelled','event.order.cancelled',array['order.cancel'],'customer_or_business'),
  ('accepted','failed','event.order.failed',array['order.fail'],'business'),
  ('preparing','ready_for_pickup','event.order.ready_for_pickup',array['order.ready_for_pickup'],'business'),
  ('preparing','cancelled','event.order.cancelled',array['order.cancel'],'customer_or_business'),
  ('preparing','failed','event.order.failed',array['order.fail'],'business'),
  ('ready_for_pickup','fulfilled','event.order.fulfilled',array['order.fulfill'],'business'),
  ('ready_for_pickup','failed','event.order.failed',array['order.fail'],'business'),
  ('ready_for_pickup','disputed','event.order.disputed',array['order.dispute'],'customer_or_business'),
  ('fulfilled','completed','event.order.completed',array['order.complete'],'customer_or_business'),
  ('fulfilled','disputed','event.order.disputed',array['order.dispute'],'customer_or_business'),
  ('disputed','completed','event.order.completed',array['order.complete'],'customer_or_business'),
  ('disputed','cancelled','event.order.cancelled',array['order.cancel'],'customer_or_business')
) as transition(from_state,to_state,event_key,action_keys,actor_scope)
on conflict (workflow_version_id,from_state_key,event_type_key) do update
set to_state_key=excluded.to_state_key,guard_policy_key=excluded.guard_policy_key,
    action_policy_keys=excluded.action_policy_keys,metadata=excluded.metadata,updated_at=timezone('utc',now());

insert into public.order_acceptance_policies (
  key, display_name, scope_type, scope_id, acceptance_mode, auto_accept_action_key,
  rejection_reasons, timeout_seconds, status, metadata
)
select
  'order.acceptance.fuel.manual.v1',
  'Fuel Station Manual Acceptance',
  'module',
  module.id,
  'manual',
  null,
  array['out_of_stock','storage_unavailable','container_unavailable','closed','capacity_unavailable','product_paused','other'],
  900,
  'active',
  '{"module_key":"fuel","requires_station_confirmation":true}'::jsonb
from public.business_modules module
where module.key = 'fuel'
  and not exists (
    select 1 from public.order_acceptance_policies policy
    where policy.key = 'order.acceptance.fuel.manual.v1'
      and policy.scope_type = 'module'
      and policy.scope_id = module.id
  );

create table if not exists public.fuel_order_operations (
  order_id uuid primary key references public.order_records(id) on delete cascade,
  service_request_id uuid not null unique references public.service_requests(id) on delete cascade,
  product_key text not null references public.fuel_products(key) on update cascade on delete restrict,
  station_branch_id uuid not null references public.organization_branches(id) on delete restrict,
  customer_user_id uuid references public.profiles(id) on delete set null,
  requested_litres numeric(16,3) not null check (requested_litres > 0),
  delivered_litres numeric(16,3) check (delivered_litres is null or delivered_litres >= 0),
  container_mode text not null check (container_mode in ('purchase','rental')),
  container_count integer not null check (container_count > 0),
  fulfillment_mode text not null
    check (fulfillment_mode in ('station_managed','independent_driver','skima_fleet','partner_managed')),
  stage_key text not null default 'awaiting_station_acceptance'
    check (stage_key in (
      'awaiting_station_acceptance','stock_reserved','station_filling','ready_for_driver',
      'driver_assigned','station_handover','out_for_delivery','delivered','return_due',
      'returned_to_driver','received_at_station','inspection_passed','completed','exception','cancelled'
    )),
  exception_reason text,
  station_accepted_at timestamptz,
  filled_at timestamptz,
  driver_assigned_at timestamptz,
  station_handover_at timestamptz,
  delivered_at timestamptz,
  return_received_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now())
);

create table if not exists public.fuel_order_operation_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.order_records(id) on delete restrict,
  service_request_id uuid not null references public.service_requests(id) on delete restrict,
  product_key text not null references public.fuel_products(key) on update cascade on delete restrict,
  from_stage text,
  to_stage text not null,
  event_type_key text not null references public.event_types(key) on delete restrict,
  reason text,
  idempotency_key text not null unique,
  actor_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default timezone('utc',now()),
  created_at timestamptz not null default timezone('utc',now())
);

create index if not exists fuel_order_operations_branch_stage_idx
on public.fuel_order_operations(station_branch_id,stage_key,created_at desc);

create index if not exists fuel_order_operations_customer_idx
on public.fuel_order_operations(customer_user_id,created_at desc);

create index if not exists fuel_order_operation_events_order_idx
on public.fuel_order_operation_events(order_id,occurred_at desc);

create or replace function public.initialize_fuel_order_operation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  module_key text;
  requested_product_key text;
  requested_litres numeric(16,3);
  requested_container_mode text;
  requested_container_count integer;
  requested_fulfillment_mode text;
  product_status text;
begin
  select module.key into module_key
  from public.business_modules module
  where module.id = new.module_id;

  if module_key <> 'fuel' then
    return new;
  end if;

  requested_product_key := new.order_payload ->> 'fuel_product_key';
  requested_litres := nullif(new.order_payload ->> 'requested_litres','')::numeric;
  requested_container_mode := new.order_payload ->> 'container_mode';
  requested_container_count := nullif(new.order_payload ->> 'container_count','')::integer;
  requested_fulfillment_mode := coalesce(new.order_payload ->> 'fulfillment_mode','independent_driver');

  if new.branch_id is null then
    raise exception using errcode='23514',message='Fuel orders require a station branch';
  end if;

  if requested_product_key not in ('fuel.pms','fuel.ago','fuel.dpk')
     or requested_litres is null or requested_litres <= 0
     or requested_container_mode not in ('purchase','rental')
     or requested_container_count is null or requested_container_count < 1
     or requested_fulfillment_mode not in ('station_managed','independent_driver','skima_fleet','partner_managed') then
    raise exception using errcode='22023',message='Fuel order payload must contain a valid product, litres, container mode/count and fulfilment mode';
  end if;

  select product.status into product_status
  from public.fuel_products product
  where product.key=requested_product_key;

  if product_status is distinct from 'enabled' then
    raise exception using errcode='55000',message='The selected fuel product is not enabled for new orders';
  end if;

  insert into public.fuel_order_operations(
    order_id,service_request_id,product_key,station_branch_id,customer_user_id,
    requested_litres,container_mode,container_count,fulfillment_mode,stage_key,metadata
  )
  values(
    new.id,new.service_request_id,requested_product_key,new.branch_id,new.requester_user_id,
    requested_litres,requested_container_mode,requested_container_count,requested_fulfillment_mode,
    'awaiting_station_acceptance',
    jsonb_build_object('module_key','fuel','initialized_from_order_payload',true)
  );

  insert into public.fuel_order_operation_events(
    order_id,service_request_id,product_key,from_stage,to_stage,event_type_key,idempotency_key,metadata
  )
  values(
    new.id,new.service_request_id,requested_product_key,null,'awaiting_station_acceptance',
    'event.fuel.operation.stage_changed',
    'fuel-order-init:'||new.id::text,
    jsonb_build_object('source','platform.fuel_order_engine')
  );

  return new;
end;
$$;

create or replace function public.record_fuel_order_stage(
  target_order_id uuid,
  target_stage_key text,
  target_idempotency_key text,
  target_reason text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record public.order_records%rowtype;
  operation_record public.fuel_order_operations%rowtype;
  existing_event public.fuel_order_operation_events%rowtype;
  allowed_transition boolean := false;
  event_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode='42501',message='Fuel operational stage changes must be performed through the authorized SKIMA service runtime';
  end if;

  if target_order_id is null or coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='order ID and idempotency key are required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='stage metadata must be a JSON object';
  end if;

  select * into existing_event
  from public.fuel_order_operation_events
  where idempotency_key=target_idempotency_key;

  if found then
    if existing_event.order_id is distinct from target_order_id
       or existing_event.to_stage is distinct from target_stage_key then
      raise exception using errcode='23505',message='Fuel stage idempotency key was reused for different details';
    end if;
    return existing_event.id;
  end if;

  select * into order_record
  from public.order_records
  where id=target_order_id
  for update;

  if not found then
    raise exception using errcode='P0002',message='Fuel order was not found';
  end if;

  if not exists (
    select 1 from public.business_modules module
    where module.id=order_record.module_id and module.key='fuel'
  ) then
    raise exception using errcode='23514',message='Order does not belong to the Fuel module';
  end if;

  select * into operation_record
  from public.fuel_order_operations
  where order_id=target_order_id
  for update;

  if not found then
    raise exception using errcode='P0002',message='Fuel order operational record was not found';
  end if;

  select exists (
    select 1
    from (values
      ('awaiting_station_acceptance','stock_reserved'),
      ('stock_reserved','station_filling'),
      ('station_filling','ready_for_driver'),
      ('ready_for_driver','driver_assigned'),
      ('driver_assigned','station_handover'),
      ('station_handover','out_for_delivery'),
      ('out_for_delivery','delivered'),
      ('delivered','return_due'),
      ('delivered','completed'),
      ('return_due','returned_to_driver'),
      ('returned_to_driver','received_at_station'),
      ('received_at_station','inspection_passed'),
      ('inspection_passed','completed'),
      ('awaiting_station_acceptance','cancelled'),
      ('stock_reserved','cancelled'),
      ('station_filling','cancelled'),
      ('ready_for_driver','cancelled'),
      ('driver_assigned','cancelled'),
      ('station_handover','cancelled'),
      ('out_for_delivery','exception'),
      ('delivered','exception'),
      ('return_due','exception'),
      ('returned_to_driver','exception'),
      ('received_at_station','exception')
    ) transition(from_stage,to_stage)
    where transition.from_stage=operation_record.stage_key
      and transition.to_stage=target_stage_key
  ) into allowed_transition;

  if not allowed_transition then
    raise exception using errcode='23514',message='Fuel order stage transition is not allowed';
  end if;

  if target_stage_key='completed' and operation_record.container_mode='rental'
     and operation_record.stage_key<>'inspection_passed' then
    raise exception using errcode='23514',message='Rental fuel containers must be returned and inspected before completion';
  end if;

  if target_stage_key='completed' and operation_record.container_mode='purchase'
     and operation_record.stage_key<>'delivered' then
    raise exception using errcode='23514',message='Purchased container orders must reach verified delivery before completion';
  end if;

  update public.fuel_order_operations
  set stage_key=target_stage_key,
      exception_reason=case when target_stage_key='exception' then nullif(btrim(target_reason),'') else exception_reason end,
      station_accepted_at=case when target_stage_key='stock_reserved' then coalesce(station_accepted_at,timezone('utc',now())) else station_accepted_at end,
      filled_at=case when target_stage_key='ready_for_driver' then coalesce(filled_at,timezone('utc',now())) else filled_at end,
      driver_assigned_at=case when target_stage_key='driver_assigned' then coalesce(driver_assigned_at,timezone('utc',now())) else driver_assigned_at end,
      station_handover_at=case when target_stage_key='station_handover' then coalesce(station_handover_at,timezone('utc',now())) else station_handover_at end,
      delivered_at=case when target_stage_key='delivered' then coalesce(delivered_at,timezone('utc',now())) else delivered_at end,
      return_received_at=case when target_stage_key='received_at_station' then coalesce(return_received_at,timezone('utc',now())) else return_received_at end,
      completed_at=case when target_stage_key='completed' then coalesce(completed_at,timezone('utc',now())) else completed_at end,
      metadata=metadata||target_metadata,
      updated_at=timezone('utc',now())
  where order_id=target_order_id;

  insert into public.fuel_order_operation_events(
    order_id,service_request_id,product_key,from_stage,to_stage,event_type_key,reason,idempotency_key,metadata
  )
  values(
    target_order_id,operation_record.service_request_id,operation_record.product_key,
    operation_record.stage_key,target_stage_key,
    case when target_stage_key='exception' then 'event.fuel.operation.exception_recorded'
         else 'event.fuel.operation.stage_changed' end,
    nullif(btrim(target_reason),''),
    target_idempotency_key,
    target_metadata
  )
  returning id into event_id;

  return event_id;
end;
$$;

alter table public.fuel_order_operations enable row level security;
alter table public.fuel_order_operation_events enable row level security;

drop policy if exists fuel_order_operations_read_order on public.fuel_order_operations;
create policy fuel_order_operations_read_order
on public.fuel_order_operations for select to authenticated
using (public.can_read_fuel_order(order_id));

drop policy if exists fuel_order_operation_events_read_order on public.fuel_order_operation_events;
create policy fuel_order_operation_events_read_order
on public.fuel_order_operation_events for select to authenticated
using (public.can_read_fuel_order(order_id));

grant select on public.fuel_order_operations,public.fuel_order_operation_events to authenticated,service_role;
grant insert,update,delete on public.fuel_order_operations,public.fuel_order_operation_events to service_role;

drop trigger if exists fuel_order_records_initialize_operation on public.order_records;
create trigger fuel_order_records_initialize_operation
after insert on public.order_records
for each row execute function public.initialize_fuel_order_operation();

drop trigger if exists fuel_order_operations_set_updated_at on public.fuel_order_operations;
create trigger fuel_order_operations_set_updated_at
before update on public.fuel_order_operations
for each row execute function public.set_updated_at();

drop trigger if exists fuel_order_operations_audit on public.fuel_order_operations;
create trigger fuel_order_operations_audit
after insert or update or delete on public.fuel_order_operations
for each row execute function public.record_table_audit();

drop trigger if exists fuel_order_operation_events_immutable on public.fuel_order_operation_events;
create trigger fuel_order_operation_events_immutable
before update or delete on public.fuel_order_operation_events
for each row execute function public.prevent_fuel_event_mutation();

revoke all on function public.initialize_fuel_order_operation() from public;
revoke all on function public.record_fuel_order_stage(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_fuel_order_stage(uuid,text,text,text,jsonb) to service_role;

-- Create a configured active Fuel module version. Product-level switches remain disabled.
do $$
declare
  fuel_module_id uuid;
  fuel_version_id uuid;
  component_record record;
begin
  select id into fuel_module_id
  from public.business_modules
  where key='fuel'
  for update;

  if not found then
    raise exception 'Fuel business module foundation is missing';
  end if;

  update public.business_modules
  set status='active',
      metadata=metadata||jsonb_build_object(
        'fulfillment_profile','station_fill_container_delivery',
        'products',jsonb_build_array('fuel.pms','fuel.ago','fuel.dpk')
      ),
      updated_at=timezone('utc',now())
  where id=fuel_module_id;

  insert into public.business_module_versions(module_id,version,status,manifest,activated_at)
  values(
    fuel_module_id,
    1,
    'active',
    jsonb_build_object(
      'module_key','fuel',
      'business_category','commerce.fulfillment',
      'fulfillment_profile','station_fill_container_delivery',
      'unit','L',
      'products',jsonb_build_array('fuel.pms','fuel.ago','fuel.dpk'),
      'engines',jsonb_build_array('catalog','pricing','order','workflow','wallet','escrow','settlement','dispatch','tracking','verification','notification'),
      'activation','configuration_only'
    ),
    timezone('utc',now())
  )
  on conflict(module_id,version) do update
  set status='active',manifest=excluded.manifest,activated_at=coalesce(public.business_module_versions.activated_at,excluded.activated_at),
      retired_at=null,updated_at=timezone('utc',now())
  returning id into fuel_version_id;

  for component_record in
    select * from (values
      ('workflow','fuel.workflow.order-processing','workflow.fuel.station-fill-delivery',true,'{"purpose":"order_processing","fulfillment_profile":"station_fill_container_delivery"}'::jsonb),
      ('pricing_policy','fuel.pricing.commercial-snapshot','pricing.fuel.commercial-snapshot.v1',true,'{"quote_source":"fuel_order_commercial_snapshots"}'::jsonb),
      ('settlement_policy','fuel.settlement.escrow-station-driver','settlement.fuel.escrow.station-driver.v1',true,'{"deposit_treatment":"refundable_liability"}'::jsonb),
      ('permission','fuel.permission.read','module.fuel.read',true,'{}'::jsonb),
      ('permission','fuel.permission.manage','module.fuel.manage',true,'{}'::jsonb),
      ('permission','fuel.permission.operate','module.fuel.operate',true,'{}'::jsonb),
      ('capability','fuel.capability.driver-pms','capability.driver.fuel-pms-delivery',true,'{"product_key":"fuel.pms"}'::jsonb),
      ('capability','fuel.capability.driver-ago','capability.driver.fuel-ago-delivery',true,'{"product_key":"fuel.ago"}'::jsonb),
      ('capability','fuel.capability.driver-dpk','capability.driver.fuel-dpk-delivery',true,'{"product_key":"fuel.dpk"}'::jsonb),
      ('dispatch_policy','fuel.dispatch.pms','dispatch.fuel.pms.nearest-qualified-driver.v1',false,'{"product_key":"fuel.pms"}'::jsonb),
      ('dispatch_policy','fuel.dispatch.ago','dispatch.fuel.ago.nearest-qualified-driver.v1',false,'{"product_key":"fuel.ago"}'::jsonb),
      ('dispatch_policy','fuel.dispatch.dpk','dispatch.fuel.dpk.nearest-qualified-driver.v1',false,'{"product_key":"fuel.dpk"}'::jsonb),
      ('screen','fuel.screen.customer-order','',false,'{"blueprint_key":"screen.fuel.customer-order","target":"native"}'::jsonb),
      ('screen','fuel.screen.station-operations','',false,'{"blueprint_key":"screen.fuel.station-operations","target":"native"}'::jsonb),
      ('screen','fuel.screen.driver-delivery','',false,'{"blueprint_key":"screen.fuel.driver-delivery","target":"native"}'::jsonb),
      ('screen','fuel.screen.admin-configuration','',false,'{"blueprint_key":"screen.fuel.admin-configuration","target":"web"}'::jsonb)
    ) as component(component_type,component_key,reference_key,is_required,config)
  loop
    insert into public.business_module_components(
      module_version_id,component_type,component_key,reference_key,is_required,config,status
    )
    values(
      fuel_version_id,component_record.component_type,component_record.component_key,
      nullif(component_record.reference_key,''),component_record.is_required,component_record.config,'active'
    )
    on conflict(module_version_id,component_type,component_key) do update
    set reference_key=excluded.reference_key,is_required=excluded.is_required,config=excluded.config,status=excluded.status,updated_at=timezone('utc',now());
  end loop;

  insert into public.configuration_entries(namespace,key,scope_type,scope_id,value,status,version)
  values(
    'module.fuel','runtime_policy','module',fuel_module_id,
    jsonb_build_object(
      'workflow','workflow.fuel.station-fill-delivery',
      'pricing_policy','pricing.fuel.commercial-snapshot.v1',
      'settlement_policy','settlement.fuel.escrow.station-driver.v1',
      'acceptance_policy','order.acceptance.fuel.manual.v1',
      'dispatch_policy_by_product',jsonb_build_object(
        'fuel.pms','dispatch.fuel.pms.nearest-qualified-driver.v1',
        'fuel.ago','dispatch.fuel.ago.nearest-qualified-driver.v1',
        'fuel.dpk','dispatch.fuel.dpk.nearest-qualified-driver.v1'
      )
    ),
    'active',1
  )
  on conflict do nothing;

  insert into public.business_module_events(module_id,module_version_id,event_type,idempotency_key,metadata)
  values(
    fuel_module_id,fuel_version_id,'version_activated','migration:20261030210000:fuel:v1',
    '{"module_key":"fuel","version":1,"products_default_disabled":true}'::jsonb
  )
  on conflict do nothing;
end;
$$;

commit;
