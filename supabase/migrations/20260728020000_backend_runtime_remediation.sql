begin;

insert into public.permissions (key, description, risk_level)
values
  ('platform.providers.read', 'Read provider adapter execution records.', 'standard'),
  ('platform.runtime.read', 'Read reusable runtime service request records.', 'standard'),
  ('platform.runtime.manage', 'Execute reusable runtime service request operations.', 'high'),
  ('platform.cache.read', 'Read platform cache records.', 'standard'),
  ('platform.pricing.execute', 'Execute configured pricing policies.', 'high'),
  ('platform.escrow.execute', 'Execute configured escrow holds, releases, refunds, disputes, and expirations.', 'critical'),
  ('platform.settlement.execute', 'Execute configured settlement distributions.', 'critical'),
  ('platform.dispatch.execute', 'Execute configured dispatch selection.', 'high'),
  ('platform.providers.execute', 'Execute provider adapter calls through platform workers.', 'critical'),
  ('platform.reconciliation.execute', 'Execute ledger and runtime reconciliation checks.', 'critical')
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    updated_at = timezone('utc', now());

select public.configure_platform_admin_role(
  'platform.operations_admin',
  'Operations Admin',
  'Operates runtime workflows, dispatch, tracking, verification, and notification queues.',
  array[
    'platform.runtime.read',
    'platform.runtime.manage',
    'platform.workflows.read',
    'platform.workflows.manage',
    'platform.events.read',
    'platform.dispatch.read',
    'platform.dispatch.manage',
    'platform.dispatch.execute',
    'platform.tracking.read',
    'platform.tracking.manage',
    'platform.verification.read',
    'platform.verification.manage',
    'platform.notifications.read',
    'platform.notifications.manage'
  ],
  '{"system_template":true,"category":"runtime"}'::jsonb,
  'active'
);

select public.configure_platform_admin_role(
  'platform.finance_admin',
  'Finance Admin',
  'Executes pricing, escrow, settlement, wallet, financial, and reconciliation operations.',
  array[
    'platform.runtime.read',
    'platform.pricing.read',
    'platform.pricing.execute',
    'platform.wallets.read',
    'platform.wallets.manage',
    'platform.financial.read',
    'platform.financial.manage',
    'platform.escrow.read',
    'platform.escrow.manage',
    'platform.escrow.execute',
    'platform.settlement.read',
    'platform.settlement.manage',
    'platform.settlement.execute',
    'platform.reconciliation.execute'
  ],
  '{"system_template":true,"category":"finance"}'::jsonb,
  'active'
);

update public.platform_admin_role_templates
set is_system = true,
    updated_at = timezone('utc', now())
where key in ('platform.operations_admin', 'platform.finance_admin');

alter table public.escrow_holds
add column if not exists source text not null default 'platform.escrow_engine'
  check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$');

alter table public.escrow_holds
add column if not exists idempotency_key text;

alter table public.escrow_holds
add column if not exists disputed_at timestamptz;

alter table public.escrow_holds
add column if not exists expired_at timestamptz;

create unique index if not exists escrow_holds_source_idempotency_unique
on public.escrow_holds (source, idempotency_key)
where idempotency_key is not null;

alter table public.background_jobs
add column if not exists source text not null default 'platform.queue_engine'
  check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$');

alter table public.background_jobs
add column if not exists idempotency_key text;

create unique index if not exists background_jobs_source_idempotency_unique
on public.background_jobs (source, idempotency_key)
where idempotency_key is not null;

alter table public.business_module_components
drop constraint if exists business_module_components_component_type_check;

alter table public.business_module_components
add constraint business_module_components_component_type_check
check (component_type in (
  'capability',
  'workflow',
  'pricing_policy',
  'settlement_policy',
  'dispatch_policy',
  'event',
  'permission',
  'vehicle_requirement',
  'driver_requirement',
  'document_requirement',
  'ai_behavior',
  'report',
  'screen'
));

create table if not exists public.service_requests (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.business_modules(id) on delete restrict,
  module_version_id uuid not null references public.business_module_versions(id) on delete restrict,
  requester_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  organization_id uuid references public.organizations(id) on delete set null,
  workflow_instance_id uuid references public.workflow_instances(id) on delete set null,
  pricing_policy_id uuid references public.pricing_policies(id) on delete set null,
  settlement_policy_id uuid references public.settlement_policies(id) on delete set null,
  dispatch_policy_id uuid references public.dispatch_policies(id) on delete set null,
  active_quote_id uuid,
  escrow_hold_id uuid references public.escrow_holds(id) on delete set null,
  status text not null default 'requested'
    check (status in (
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
    )),
  request_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(request_payload) = 'object'),
  participants jsonb not null default '{}'::jsonb
    check (jsonb_typeof(participants) = 'object'),
  source text not null
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create table if not exists public.service_request_events (
  id uuid primary key default gen_random_uuid(),
  service_request_id uuid not null references public.service_requests(id) on delete cascade,
  event_type_key text references public.event_types(key) on delete set null,
  event_id uuid references public.event_log(id) on delete set null,
  status text not null,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  unique (service_request_id, idempotency_key)
);

create table if not exists public.price_quotes (
  id uuid primary key default gen_random_uuid(),
  service_request_id uuid not null references public.service_requests(id) on delete cascade,
  pricing_policy_id uuid not null references public.pricing_policies(id) on delete restrict,
  module_id uuid not null references public.business_modules(id) on delete restrict,
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  status text not null default 'calculated'
    check (status in ('calculated', 'accepted', 'expired', 'cancelled')),
  subtotal_amount numeric(28, 8) not null check (subtotal_amount >= 0),
  fee_amount numeric(28, 8) not null default 0 check (fee_amount >= 0),
  discount_amount numeric(28, 8) not null default 0 check (discount_amount >= 0),
  tax_amount numeric(28, 8) not null default 0 check (tax_amount >= 0),
  total_amount numeric(28, 8) not null check (total_amount >= 0),
  pricing_context jsonb not null default '{}'::jsonb
    check (jsonb_typeof(pricing_context) = 'object'),
  calculation_breakdown jsonb not null default '{}'::jsonb
    check (jsonb_typeof(calculation_breakdown) = 'object'),
  expires_at timestamptz,
  accepted_at timestamptz,
  source text not null
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (total_amount = greatest(subtotal_amount + fee_amount + tax_amount - discount_amount, 0)),
  unique (source, idempotency_key)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'service_requests_active_quote_fk'
      and conrelid = 'public.service_requests'::regclass
  ) then
    alter table public.service_requests
    add constraint service_requests_active_quote_fk
    foreign key (active_quote_id) references public.price_quotes(id) on delete set null;
  end if;
end;
$$;

create table if not exists public.settlement_executions (
  id uuid primary key default gen_random_uuid(),
  service_request_id uuid references public.service_requests(id) on delete set null,
  escrow_hold_id uuid not null references public.escrow_holds(id) on delete restrict,
  settlement_policy_id uuid references public.settlement_policies(id) on delete set null,
  transaction_id uuid references public.financial_transactions(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'posted', 'failed', 'cancelled')),
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  gross_amount numeric(28, 8) not null check (gross_amount >= 0),
  distribution jsonb not null
    check (jsonb_typeof(distribution) = 'array'),
  policy_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(policy_snapshot) = 'object'),
  source text not null
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  error_message text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create table if not exists public.provider_execution_logs (
  id uuid primary key default gen_random_uuid(),
  provider_adapter_id uuid references public.provider_adapters(id) on delete set null,
  provider_kind text not null
    check (provider_kind in ('payment', 'storage', 'maps', 'notification', 'ai', 'queue', 'cache', 'observability')),
  operation_key text not null
    check (operation_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  status text not null default 'queued'
    check (status in ('queued', 'succeeded', 'failed', 'dead_lettered')),
  request_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(request_payload) = 'object'),
  response_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(response_payload) = 'object'),
  idempotency_key text not null,
  error_message text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  unique (provider_kind, operation_key, idempotency_key)
);

create index if not exists service_requests_module_status_idx
on public.service_requests (module_id, status, created_at desc);

create index if not exists service_requests_requester_idx
on public.service_requests (requester_user_id, status, created_at desc);

create index if not exists price_quotes_service_request_status_idx
on public.price_quotes (service_request_id, status, created_at desc);

create index if not exists settlement_executions_service_request_status_idx
on public.settlement_executions (service_request_id, status, created_at desc);

create index if not exists provider_execution_logs_kind_status_idx
on public.provider_execution_logs (provider_kind, status, created_at desc);

insert into public.job_queues (key, status, concurrency_limit, retry_policy)
values
  ('platform.workflow_events', 'active', 4, '{"max_attempts":5,"backoff_seconds":[30,120,300]}'::jsonb),
  ('platform.settlement', 'active', 2, '{"max_attempts":5,"backoff_seconds":[60,300,900]}'::jsonb),
  ('platform.notifications', 'active', 10, '{"max_attempts":5,"backoff_seconds":[30,120,300]}'::jsonb),
  ('platform.ai', 'active', 2, '{"max_attempts":3,"backoff_seconds":[120,600,1800]}'::jsonb),
  ('platform.retries', 'active', 2, '{"max_attempts":3,"backoff_seconds":[60,300,900]}'::jsonb),
  ('platform.dead_letters', 'active', 1, '{"retention_days":30}'::jsonb),
  ('platform.expirations', 'active', 2, '{"max_attempts":3,"backoff_seconds":[60,300,900]}'::jsonb),
  ('platform.reconciliation', 'active', 1, '{"max_attempts":3,"backoff_seconds":[300,900,1800]}'::jsonb)
on conflict (key) do update
set status = excluded.status,
    concurrency_limit = excluded.concurrency_limit,
    retry_policy = excluded.retry_policy,
    updated_at = timezone('utc', now());

insert into public.rate_limit_policies (
  key,
  scope_type,
  limit_count,
  window_seconds,
  status,
  metadata
)
values (
  'api.gateway.authenticated.default',
  'user',
  600,
  60,
  'active',
  '{"surface":"api-gateway","configurable":true}'::jsonb
)
on conflict (key) do update
set scope_type = excluded.scope_type,
    limit_count = excluded.limit_count,
    window_seconds = excluded.window_seconds,
    status = excluded.status,
    metadata = excluded.metadata,
    updated_at = timezone('utc', now());

insert into public.provider_adapters (provider_kind, key, display_name, status, config, secret_ref)
values
  (
    'payment',
    'provider.payment.sandbox',
    'Sandbox Payment Adapter',
    'active',
    '{"mode":"sandbox","deterministic":true,"supports":["authorize","capture","refund","webhook"]}'::jsonb,
    'SUPABASE_SECRET:SKIMA_SANDBOX_PAYMENT_SECRET'
  ),
  (
    'notification',
    'provider.notification.sandbox',
    'Sandbox Notification Adapter',
    'active',
    '{"mode":"sandbox","deterministic":true,"channels":["push","sms","email","whatsapp","voice","in_app","future"]}'::jsonb,
    'SUPABASE_SECRET:SKIMA_SANDBOX_NOTIFICATION_SECRET'
  ),
  (
    'maps',
    'provider.maps.sandbox',
    'Sandbox Maps Adapter',
    'active',
    '{"mode":"sandbox","deterministic":true,"supports":["geocode","reverse_geocode","route","distance_matrix","eta","geofence"]}'::jsonb,
    'SUPABASE_SECRET:SKIMA_SANDBOX_MAPS_SECRET'
  ),
  (
    'ai',
    'provider.ai.sandbox',
    'Sandbox AI Adapter',
    'active',
    '{"mode":"sandbox","deterministic":true,"control":"assist_only"}'::jsonb,
    'SUPABASE_SECRET:SKIMA_SANDBOX_AI_SECRET'
  ),
  (
    'queue',
    'provider.queue.supabase',
    'Supabase Queue Adapter',
    'active',
    '{"mode":"database","queues_table":"background_jobs"}'::jsonb,
    null
  ),
  (
    'cache',
    'provider.cache.database',
    'Database Cache Adapter',
    'active',
    '{"mode":"database","cache_table":"cache_entries"}'::jsonb,
    null
  ),
  (
    'observability',
    'provider.observability.database',
    'Database Observability Adapter',
    'active',
    '{"mode":"database","logs":["application_logs","error_reports","health_checks"]}'::jsonb,
    null
  )
on conflict (provider_kind, key) do update
set display_name = excluded.display_name,
    status = excluded.status,
    config = excluded.config,
    secret_ref = excluded.secret_ref,
    updated_at = timezone('utc', now());

insert into public.business_module_components (
  module_version_id,
  component_type,
  component_key,
  reference_key,
  is_required,
  config,
  status
)
select
  version.id,
  'dispatch_policy',
  module.key || '.dispatch.primary',
  dispatch.key,
  true,
  '{"selection":"configured_policy"}'::jsonb,
  'active'
from public.business_modules module
join public.business_module_versions version on version.module_id = module.id
join public.dispatch_policies dispatch on dispatch.key = 'dispatch.lpg.nearest-qualified-driver.v1'
where module.key = 'lpg'
  and version.status = 'active'
on conflict (module_version_id, component_type, component_key) do update
set reference_key = excluded.reference_key,
    is_required = excluded.is_required,
    config = excluded.config,
    status = excluded.status,
    updated_at = timezone('utc', now());

create or replace function public.can_read_platform_runtime()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.role() = 'service_role'
    or public.has_permission('platform.runtime.read', null)
    or public.has_permission('platform.runtime.manage', null);
$$;

create or replace function public.can_execute_platform_runtime()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.role() = 'service_role'
    or public.has_permission('platform.runtime.manage', null);
$$;

create or replace function public.validate_business_module_component_reference(
  target_component_type text,
  target_reference_key text,
  require_active_reference boolean default false
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if target_component_type in (
    'capability',
    'workflow',
    'pricing_policy',
    'settlement_policy',
    'dispatch_policy',
    'event',
    'permission',
    'ai_behavior'
  )
    and target_reference_key is null then
    raise exception 'target_reference_key is required for this component type';
  end if;

  if target_component_type = 'capability'
    and not exists (
      select 1
      from public.capability_definitions capability
      where capability.key = target_reference_key
        and (not require_active_reference or capability.status = 'active')
        and capability.status <> 'retired'
    ) then
    raise exception 'target_reference_key must reference a configured capability';
  end if;

  if target_component_type = 'workflow'
    and not exists (
      select 1
      from public.workflow_definitions workflow
      where workflow.key = target_reference_key
        and (not require_active_reference or workflow.status = 'active')
        and workflow.status <> 'retired'
    ) then
    raise exception 'target_reference_key must reference a configured workflow';
  end if;

  if target_component_type = 'pricing_policy'
    and not exists (
      select 1
      from public.pricing_policies policy
      where policy.key = target_reference_key
        and (not require_active_reference or policy.status = 'active')
        and policy.status <> 'retired'
    ) then
    raise exception 'target_reference_key must reference a configured pricing policy';
  end if;

  if target_component_type = 'settlement_policy'
    and not exists (
      select 1
      from public.settlement_policies policy
      where policy.key = target_reference_key
        and (not require_active_reference or policy.status = 'active')
        and policy.status <> 'retired'
    ) then
    raise exception 'target_reference_key must reference a configured settlement policy';
  end if;

  if target_component_type = 'dispatch_policy'
    and not exists (
      select 1
      from public.dispatch_policies policy
      where policy.key = target_reference_key
        and (not require_active_reference or policy.status = 'active')
        and policy.status <> 'retired'
    ) then
    raise exception 'target_reference_key must reference a configured dispatch policy';
  end if;

  if target_component_type = 'event'
    and not exists (
      select 1
      from public.event_types event_type
      where event_type.key = target_reference_key
        and (not require_active_reference or event_type.status = 'active')
        and event_type.status <> 'retired'
    ) then
    raise exception 'target_reference_key must reference a configured event type';
  end if;

  if target_component_type = 'permission'
    and not exists (
      select 1
      from public.permissions permission
      where permission.key = target_reference_key
    ) then
    raise exception 'target_reference_key must reference a configured permission';
  end if;

  if target_component_type = 'ai_behavior'
    and not exists (
      select 1
      from public.ai_task_definitions task
      where task.key = target_reference_key
        and (not require_active_reference or task.status = 'active')
        and task.status <> 'retired'
    ) then
    raise exception 'target_reference_key must reference a configured AI task definition';
  end if;

  if target_component_type = 'vehicle_requirement'
    and target_reference_key is not null
    and not exists (
      select 1
      from public.vehicle_types vehicle_type
      where vehicle_type.key = target_reference_key
        and (not require_active_reference or vehicle_type.status = 'active')
        and vehicle_type.status <> 'retired'
    ) then
    raise exception 'target_reference_key must reference a configured vehicle type';
  end if;

  if target_component_type in ('driver_requirement', 'document_requirement')
    and target_reference_key is not null
    and not exists (
      select 1
      from public.verification_definitions definition
      where definition.key = target_reference_key
        and (not require_active_reference or definition.status = 'active')
        and definition.status <> 'retired'
    ) then
    raise exception 'target_reference_key must reference a configured verification definition';
  end if;
end;
$$;

create or replace function public.configure_business_module_component(
  target_module_version_id uuid,
  target_component_type text,
  target_component_key text,
  target_reference_key text default null,
  target_is_required boolean default true,
  target_config jsonb default '{}'::jsonb,
  target_status text default 'active',
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  version_record record;
  component_id uuid;
begin
  if not public.can_manage_business_modules() then
    raise exception 'platform module management permission is required';
  end if;

  if target_module_version_id is null then
    raise exception 'target_module_version_id is required';
  end if;

  select version.*, module.id as module_id
  into version_record
  from public.business_module_versions version
  join public.business_modules module on module.id = version.module_id
  where version.id = target_module_version_id
    and version.status = 'draft'
    and module.status <> 'retired';

  if not found then
    raise exception 'target_module_version_id must reference a draft business module version';
  end if;

  if target_component_type is null
    or target_component_type not in (
      'capability',
      'workflow',
      'pricing_policy',
      'settlement_policy',
      'dispatch_policy',
      'event',
      'permission',
      'vehicle_requirement',
      'driver_requirement',
      'document_requirement',
      'ai_behavior',
      'report',
      'screen'
    ) then
    raise exception 'target_component_type is not supported';
  end if;

  if target_component_key is null
    or target_component_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_component_key must be a valid platform key';
  end if;

  if target_reference_key is not null
    and target_reference_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_reference_key must be a valid platform key';
  end if;

  if target_status is null
    or target_status not in ('draft', 'active', 'retired') then
    raise exception 'target_status must be draft, active, or retired';
  end if;

  if target_config is null
    or jsonb_typeof(target_config) <> 'object' then
    raise exception 'target_config must be a JSON object';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  perform public.validate_business_module_component_reference(
    target_component_type,
    target_reference_key,
    false
  );

  insert into public.business_module_components (
    module_version_id,
    component_type,
    component_key,
    reference_key,
    is_required,
    config,
    status,
    created_by
  )
  values (
    target_module_version_id,
    target_component_type,
    target_component_key,
    target_reference_key,
    coalesce(target_is_required, true),
    target_config,
    target_status,
    auth.uid()
  )
  on conflict (module_version_id, component_type, component_key) do update
  set reference_key = excluded.reference_key,
      is_required = excluded.is_required,
      config = excluded.config,
      status = excluded.status,
      updated_at = timezone('utc', now())
  returning id into component_id;

  insert into public.business_module_events (
    module_id,
    module_version_id,
    event_type,
    idempotency_key,
    metadata
  )
  values (
    version_record.module_id,
    target_module_version_id,
    'component_configured',
    target_idempotency_key,
    jsonb_build_object(
      'component_type',
      target_component_type,
      'component_key',
      target_component_key,
      'reference_key',
      target_reference_key
    )
  )
  on conflict do nothing;

  return component_id;
end;
$$;

create or replace function public.jsonb_numeric_value(
  target_payload jsonb,
  target_key text,
  fallback_value numeric default null
)
returns numeric
language plpgsql
immutable
as $$
declare
  parsed_value numeric;
begin
  if target_payload is null or jsonb_typeof(target_payload) <> 'object' then
    raise exception 'target_payload must be a JSON object';
  end if;

  if target_payload ? target_key then
    begin
      parsed_value := (target_payload ->> target_key)::numeric;
    exception
      when others then
        raise exception '% must be numeric', target_key;
    end;

    return parsed_value;
  end if;

  return fallback_value;
end;
$$;

create or replace function public.prevent_runtime_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'runtime event records are append-only';
end;
$$;

create or replace function public.prevent_provider_execution_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'provider execution logs are append-only';
end;
$$;

create or replace function public.record_provider_execution(
  target_provider_kind text,
  target_operation_key text,
  target_status text,
  target_request_payload jsonb,
  target_response_payload jsonb default '{}'::jsonb,
  target_provider_adapter_key text default null,
  target_idempotency_key text default null,
  target_error_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_provider_adapter_id uuid;
  provider_execution_log_id uuid;
  existing_record record;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.providers.execute', null) then
    raise exception 'platform provider execution permission is required';
  end if;

  if target_provider_kind is null
    or target_provider_kind not in ('payment', 'storage', 'maps', 'notification', 'ai', 'queue', 'cache', 'observability') then
    raise exception 'target_provider_kind is not supported';
  end if;

  if target_operation_key is null
    or target_operation_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_operation_key must be a valid platform key';
  end if;

  if target_status is null
    or target_status not in ('queued', 'succeeded', 'failed', 'dead_lettered') then
    raise exception 'target_status is not supported';
  end if;

  if target_request_payload is null
    or jsonb_typeof(target_request_payload) <> 'object'
    or target_response_payload is null
    or jsonb_typeof(target_response_payload) <> 'object' then
    raise exception 'provider execution payloads must be JSON objects';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_provider_adapter_key is not null then
    select provider.id
    into target_provider_adapter_id
    from public.provider_adapters provider
    where provider.provider_kind = target_provider_kind
      and provider.key = target_provider_adapter_key
      and provider.status = 'active';

    if not found then
      raise exception 'target_provider_adapter_key must reference an active provider adapter';
    end if;
  else
    select provider.id
    into target_provider_adapter_id
    from public.provider_adapters provider
    where provider.provider_kind = target_provider_kind
      and provider.status = 'active'
    order by provider.created_at asc
    limit 1;
  end if;

  insert into public.provider_execution_logs (
    provider_adapter_id,
    provider_kind,
    operation_key,
    status,
    request_payload,
    response_payload,
    idempotency_key,
    error_message,
    created_by
  )
  values (
    target_provider_adapter_id,
    target_provider_kind,
    target_operation_key,
    target_status,
    target_request_payload,
    target_response_payload,
    target_idempotency_key,
    target_error_message,
    auth.uid()
  )
  on conflict (provider_kind, operation_key, idempotency_key)
  do nothing
  returning id into provider_execution_log_id;

  if provider_execution_log_id is null then
    select existing.*
    into existing_record
    from public.provider_execution_logs existing
    where existing.provider_kind = target_provider_kind
      and existing.operation_key = target_operation_key
      and existing.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'provider execution idempotency lookup failed';
    end if;

    if existing_record.status <> target_status
      or existing_record.request_payload <> target_request_payload
      or existing_record.response_payload <> target_response_payload
      or existing_record.error_message is distinct from target_error_message then
      raise exception 'target_idempotency_key has already been used with different provider execution details';
    end if;

    return existing_record.id;
  end if;

  return provider_execution_log_id;
end;
$$;

create or replace function public.check_rate_limit(
  target_policy_key text,
  target_subject text,
  target_increment integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  policy_record record;
  window_start_value timestamptz;
  current_count integer;
  limit_count integer;
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  if target_policy_key is null
    or target_policy_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_policy_key must be a valid platform key';
  end if;

  if target_subject is null or btrim(target_subject) = '' then
    raise exception 'target_subject is required';
  end if;

  if target_increment is null or target_increment <= 0 then
    raise exception 'target_increment must be greater than zero';
  end if;

  select policy.*
  into policy_record
  from public.rate_limit_policies policy
  where policy.key = target_policy_key
    and policy.status = 'active';

  if not found then
    raise exception 'target_policy_key must reference an active rate limit policy';
  end if;

  window_start_value :=
    to_timestamp(
      floor(extract(epoch from timezone('utc', now())) / policy_record.window_seconds)
      * policy_record.window_seconds
    );
  limit_count := policy_record.limit_count;

  insert into public.rate_limit_counters (
    policy_id,
    subject_key,
    window_start,
    request_count
  )
  values (
    policy_record.id,
    target_subject,
    window_start_value,
    target_increment
  )
  on conflict (policy_id, subject_key, window_start) do update
  set request_count = public.rate_limit_counters.request_count + excluded.request_count,
      updated_at = timezone('utc', now())
  returning request_count into current_count;

  return jsonb_build_object(
    'allowed',
    current_count <= limit_count,
    'count',
    current_count,
    'limit',
    limit_count,
    'window_start',
    window_start_value
  );
end;
$$;

create or replace function public.set_cache_entry(
  target_namespace text,
  target_cache_key text,
  target_value jsonb,
  target_ttl_seconds integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cache_entry_id uuid;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.cache.manage', null) then
    raise exception 'platform cache management permission is required';
  end if;

  if target_namespace is null
    or target_namespace !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_namespace must be a valid platform key';
  end if;

  if target_cache_key is null or btrim(target_cache_key) = '' then
    raise exception 'target_cache_key is required';
  end if;

  if target_value is null then
    raise exception 'target_value is required';
  end if;

  if target_ttl_seconds is null or target_ttl_seconds <= 0 then
    raise exception 'target_ttl_seconds must be greater than zero';
  end if;

  insert into public.cache_entries (
    namespace,
    key,
    value,
    expires_at
  )
  values (
    target_namespace,
    target_cache_key,
    target_value,
    timezone('utc', now()) + make_interval(secs => target_ttl_seconds)
  )
  on conflict (namespace, key) do update
  set value = excluded.value,
      expires_at = excluded.expires_at,
      updated_at = timezone('utc', now())
  returning id into cache_entry_id;

  return cache_entry_id;
end;
$$;

create or replace function public.get_cache_entry(
  target_namespace text,
  target_cache_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cache_value jsonb;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.cache.read', null)
    and not public.has_permission('platform.cache.manage', null) then
    raise exception 'platform cache read permission is required';
  end if;

  select entry.value
  into cache_value
  from public.cache_entries entry
  where entry.namespace = target_namespace
    and entry.key = target_cache_key
    and entry.expires_at > timezone('utc', now());

  return cache_value;
end;
$$;

create or replace function public.enqueue_background_job(
  target_queue_key text,
  target_job_type_key text,
  target_payload jsonb,
  target_source text,
  target_idempotency_key text,
  target_run_at timestamptz default timezone('utc', now()),
  target_max_attempts integer default 3
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_queue_id uuid;
  background_job_id uuid;
  existing_record record;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.jobs.manage', null) then
    raise exception 'platform job management permission is required';
  end if;

  if target_queue_key is null
    or target_queue_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_queue_key must be a valid platform key';
  end if;

  if target_job_type_key is null
    or target_job_type_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_job_type_key must be a valid platform key';
  end if;

  if target_source is null
    or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_payload is null
    or jsonb_typeof(target_payload) <> 'object' then
    raise exception 'target_payload must be a JSON object';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_max_attempts is null or target_max_attempts <= 0 then
    raise exception 'target_max_attempts must be greater than zero';
  end if;

  select queue.id
  into target_queue_id
  from public.job_queues queue
  where queue.key = target_queue_key
    and queue.status = 'active';

  if not found then
    raise exception 'target_queue_key must reference an active queue';
  end if;

  insert into public.background_jobs (
    queue_id,
    job_type_key,
    status,
    payload,
    max_attempts,
    run_at,
    source,
    idempotency_key
  )
  values (
    target_queue_id,
    target_job_type_key,
    'queued',
    target_payload,
    target_max_attempts,
    coalesce(target_run_at, timezone('utc', now())),
    target_source,
    target_idempotency_key
  )
  on conflict (source, idempotency_key)
  where idempotency_key is not null
  do nothing
  returning id into background_job_id;

  if background_job_id is null then
    select existing.*
    into existing_record
    from public.background_jobs existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'background job idempotency lookup failed';
    end if;

    return existing_record.id;
  end if;

  return background_job_id;
end;
$$;

create or replace function public.record_health_check(
  target_service_key text,
  target_status text,
  target_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  health_check_id uuid;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.health.manage', null) then
    raise exception 'platform health management permission is required';
  end if;

  if target_service_key is null
    or target_service_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_service_key must be a valid platform key';
  end if;

  if target_status is null
    or target_status not in ('healthy', 'degraded', 'unhealthy', 'unknown') then
    raise exception 'target_status is not supported';
  end if;

  if target_details is null
    or jsonb_typeof(target_details) <> 'object' then
    raise exception 'target_details must be a JSON object';
  end if;

  insert into public.health_checks (
    key,
    status,
    details,
    checked_at
  )
  values (
    target_service_key,
    target_status,
    target_details,
    timezone('utc', now())
  )
  on conflict (key) do update
  set status = excluded.status,
      details = excluded.details,
      checked_at = excluded.checked_at,
      updated_at = timezone('utc', now())
  returning id into health_check_id;

  return health_check_id;
end;
$$;

create or replace function public.create_module_service_request(
  target_module_key text,
  target_request_payload jsonb,
  target_source text,
  target_idempotency_key text,
  target_organization_id uuid default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  module_record record;
  request_id uuid;
  existing_record record;
  configured_workflow_id uuid;
  configured_pricing_id uuid;
  configured_settlement_id uuid;
  configured_dispatch_id uuid;
begin
  if auth.role() <> 'service_role'
    and not public.can_execute_platform_runtime()
    and not public.has_permission('module.' || target_module_key || '.operate', target_organization_id) then
    raise exception 'module operation permission is required';
  end if;

  if target_module_key is null
    or target_module_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_module_key must be a valid platform key';
  end if;

  if target_request_payload is null
    or jsonb_typeof(target_request_payload) <> 'object'
    or target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'service request JSON inputs must be objects';
  end if;

  if target_source is null
    or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
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

  select workflow.id
  into configured_workflow_id
  from public.business_module_components component
  join public.workflow_definitions workflow on workflow.key = component.reference_key
  where component.module_version_id = module_record.version_id
    and component.component_type = 'workflow'
    and component.status = 'active'
    and workflow.status = 'active'
  order by component.created_at asc
  limit 1;

  select pricing.id
  into configured_pricing_id
  from public.business_module_components component
  join public.pricing_policies pricing on pricing.key = component.reference_key
  where component.module_version_id = module_record.version_id
    and component.component_type = 'pricing_policy'
    and component.status = 'active'
    and pricing.status = 'active'
  order by pricing.version desc
  limit 1;

  select settlement.id
  into configured_settlement_id
  from public.business_module_components component
  join public.settlement_policies settlement on settlement.key = component.reference_key
  where component.module_version_id = module_record.version_id
    and component.component_type = 'settlement_policy'
    and component.status = 'active'
    and settlement.status = 'active'
  order by settlement.version desc
  limit 1;

  select dispatch.id
  into configured_dispatch_id
  from public.business_module_components component
  join public.dispatch_policies dispatch on dispatch.key = component.reference_key
  where component.module_version_id = module_record.version_id
    and component.component_type = 'dispatch_policy'
    and component.status = 'active'
    and dispatch.status = 'active'
  order by dispatch.created_at asc
  limit 1;

  insert into public.service_requests (
    module_id,
    module_version_id,
    requester_user_id,
    organization_id,
    pricing_policy_id,
    settlement_policy_id,
    dispatch_policy_id,
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
    configured_pricing_id,
    configured_settlement_id,
    configured_dispatch_id,
    'requested',
    target_request_payload,
    '{}'::jsonb,
    target_source,
    target_idempotency_key,
    target_metadata
  )
  on conflict (source, idempotency_key)
  do nothing
  returning id into request_id;

  if request_id is null then
    select existing.*
    into existing_record
    from public.service_requests existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'service request idempotency lookup failed';
    end if;

    if existing_record.module_id <> module_record.id
      or existing_record.request_payload <> target_request_payload
      or existing_record.organization_id is distinct from target_organization_id then
      raise exception 'target_idempotency_key has already been used with different service request details';
    end if;

    return existing_record.id;
  end if;

  insert into public.service_request_events (
    service_request_id,
    event_type_key,
    status,
    idempotency_key,
    metadata
  )
  values (
    request_id,
    'event.request.created',
    'requested',
    target_idempotency_key || ':created',
    target_metadata
  )
  on conflict do nothing;

  return request_id;
end;
$$;

create or replace function public.calculate_price_quote(
  target_module_key text,
  target_service_request_id uuid,
  target_pricing_policy_key text default null,
  target_currency_code text default 'NGN',
  target_pricing_context jsonb default '{}'::jsonb,
  target_source text default 'platform.pricing_engine',
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request_record record;
  module_record record;
  policy_record record;
  quote_id uuid;
  existing_record record;
  base_amount numeric(28, 8);
  distance_value numeric(28, 8);
  weight_value numeric(28, 8);
  time_value numeric(28, 8);
  quantity_value numeric(28, 8);
  fee_amount numeric(28, 8);
  discount_amount numeric(28, 8);
  tax_amount numeric(28, 8);
  total_amount numeric(28, 8);
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.pricing.execute', null)
    and not public.can_execute_platform_runtime()
    and not public.has_permission('module.' || target_module_key || '.operate', null) then
    raise exception 'pricing execution permission is required';
  end if;

  if target_module_key is null
    or target_module_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_module_key must be a valid platform key';
  end if;

  if target_service_request_id is null then
    raise exception 'target_service_request_id is required';
  end if;

  if target_currency_code is null
    or target_currency_code !~ '^[A-Z0-9]{3,12}$' then
    raise exception 'target_currency_code must be a valid currency code';
  end if;

  if target_pricing_context is null
    or jsonb_typeof(target_pricing_context) <> 'object' then
    raise exception 'target_pricing_context must be a JSON object';
  end if;

  if target_source is null
    or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select
    request.*,
    module.key as module_key
  into request_record
  from public.service_requests request
  join public.business_modules module on module.id = request.module_id
  where request.id = target_service_request_id
  for update;

  if not found then
    raise exception 'target_service_request_id must reference an existing service request';
  end if;

  if request_record.module_key <> target_module_key then
    raise exception 'target_module_key does not match the service request module';
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

  if target_pricing_policy_key is not null then
    select policy.*
    into policy_record
    from public.pricing_policies policy
    where policy.key = target_pricing_policy_key
      and policy.status = 'active'
    order by policy.version desc
    limit 1;
  elsif request_record.pricing_policy_id is not null then
    select policy.*
    into policy_record
    from public.pricing_policies policy
    where policy.id = request_record.pricing_policy_id
      and policy.status = 'active';
  else
    select policy.*
    into policy_record
    from public.business_module_components component
    join public.pricing_policies policy on policy.key = component.reference_key
    where component.module_version_id = module_record.version_id
      and component.component_type = 'pricing_policy'
      and component.status = 'active'
      and policy.status = 'active'
    order by policy.version desc
    limit 1;
  end if;

  if not found then
    raise exception 'an active pricing policy is required for this service request';
  end if;

  if policy_record.currency_code <> target_currency_code then
    raise exception 'target_currency_code must match the pricing policy currency';
  end if;

  base_amount := coalesce(
    public.jsonb_numeric_value(target_pricing_context, 'base_amount', null),
    public.jsonb_numeric_value(target_pricing_context, 'amount', null),
    public.jsonb_numeric_value(policy_record.rules, 'base_amount', null),
    public.jsonb_numeric_value(policy_record.rules, 'amount', null)
  );

  distance_value := coalesce(public.jsonb_numeric_value(target_pricing_context, 'distance', 0), 0);
  weight_value := coalesce(public.jsonb_numeric_value(target_pricing_context, 'weight', 0), 0);
  time_value := coalesce(public.jsonb_numeric_value(target_pricing_context, 'time', 0), 0);
  quantity_value := coalesce(public.jsonb_numeric_value(target_pricing_context, 'quantity', 1), 1);
  fee_amount := coalesce(public.jsonb_numeric_value(target_pricing_context, 'fee_amount', 0), 0);
  discount_amount := coalesce(public.jsonb_numeric_value(target_pricing_context, 'discount_amount', 0), 0);
  tax_amount := coalesce(public.jsonb_numeric_value(target_pricing_context, 'tax_amount', 0), 0);

  if base_amount is null then
    raise exception 'pricing context or policy rules must provide amount or base_amount';
  end if;

  if base_amount < 0 or quantity_value <= 0 or fee_amount < 0 or discount_amount < 0 or tax_amount < 0 then
    raise exception 'pricing amounts must be non-negative and quantity must be greater than zero';
  end if;

  if policy_record.pricing_mode = 'fixed' then
    base_amount := base_amount * quantity_value;
  elsif policy_record.pricing_mode = 'distance' then
    base_amount := base_amount + distance_value * coalesce(public.jsonb_numeric_value(policy_record.rules, 'rate_per_distance', 0), 0);
  elsif policy_record.pricing_mode = 'weight' then
    base_amount := base_amount + weight_value * coalesce(public.jsonb_numeric_value(policy_record.rules, 'rate_per_weight', 0), 0);
  elsif policy_record.pricing_mode = 'time' then
    base_amount := base_amount + time_value * coalesce(public.jsonb_numeric_value(policy_record.rules, 'rate_per_time', 0), 0);
  elsif policy_record.pricing_mode = 'hybrid' then
    base_amount := base_amount
      + distance_value * coalesce(public.jsonb_numeric_value(policy_record.rules, 'rate_per_distance', 0), 0)
      + weight_value * coalesce(public.jsonb_numeric_value(policy_record.rules, 'rate_per_weight', 0), 0)
      + time_value * coalesce(public.jsonb_numeric_value(policy_record.rules, 'rate_per_time', 0), 0);
  elsif policy_record.pricing_mode = 'dynamic' then
    base_amount := base_amount * coalesce(
      public.jsonb_numeric_value(target_pricing_context, 'dynamic_multiplier', null),
      public.jsonb_numeric_value(policy_record.rules, 'dynamic_multiplier', 1)
    );
  elsif policy_record.pricing_mode = 'subscription' then
    base_amount := coalesce(
      public.jsonb_numeric_value(target_pricing_context, 'subscription_amount', null),
      public.jsonb_numeric_value(policy_record.rules, 'subscription_amount', base_amount)
    ) * quantity_value;
  elsif policy_record.pricing_mode = 'ai_assisted' then
    if coalesce((target_pricing_context ->> 'ai_suggestion_accepted')::boolean, false) is not true then
      raise exception 'ai_assisted pricing requires an accepted assistive suggestion in pricing context';
    end if;

    base_amount := base_amount * quantity_value;
  elsif policy_record.pricing_mode in ('quoted', 'negotiated', 'manual', 'marketplace') then
    base_amount := base_amount * quantity_value;
  else
    raise exception 'pricing mode is not supported';
  end if;

  total_amount := greatest(base_amount + fee_amount + tax_amount - discount_amount, 0);

  insert into public.price_quotes (
    service_request_id,
    pricing_policy_id,
    module_id,
    currency_code,
    status,
    subtotal_amount,
    fee_amount,
    discount_amount,
    tax_amount,
    total_amount,
    pricing_context,
    calculation_breakdown,
    expires_at,
    source,
    idempotency_key,
    created_by
  )
  values (
    target_service_request_id,
    policy_record.id,
    request_record.module_id,
    target_currency_code,
    'calculated',
    base_amount,
    fee_amount,
    discount_amount,
    tax_amount,
    total_amount,
    target_pricing_context,
    jsonb_build_object(
      'pricing_mode',
      policy_record.pricing_mode,
      'policy_key',
      policy_record.key,
      'rules_snapshot',
      policy_record.rules
    ),
    timezone('utc', now()) + make_interval(secs => coalesce((policy_record.rules ->> 'quote_ttl_seconds')::integer, 900)),
    target_source,
    target_idempotency_key,
    auth.uid()
  )
  on conflict (source, idempotency_key)
  do nothing
  returning id into quote_id;

  if quote_id is null then
    select existing.*
    into existing_record
    from public.price_quotes existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'price quote idempotency lookup failed';
    end if;

    if existing_record.service_request_id <> target_service_request_id
      or existing_record.total_amount <> total_amount
      or existing_record.pricing_context <> target_pricing_context then
      raise exception 'target_idempotency_key has already been used with different price quote details';
    end if;

    return existing_record.id;
  end if;

  update public.service_requests
  set active_quote_id = quote_id,
      pricing_policy_id = policy_record.id,
      status = case when status = 'requested' then 'priced' else status end,
      updated_at = timezone('utc', now())
  where id = target_service_request_id;

  insert into public.service_request_events (
    service_request_id,
    status,
    idempotency_key,
    metadata
  )
  values (
    target_service_request_id,
    'priced',
    target_idempotency_key || ':priced',
    jsonb_build_object('price_quote_id', quote_id, 'amount', total_amount, 'currency_code', target_currency_code)
  )
  on conflict do nothing;

  return quote_id;
end;
$$;

create or replace function public.accept_price_quote(
  target_price_quote_id uuid,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  quote_record record;
  existing_event record;
begin
  if auth.role() <> 'service_role'
    and not public.can_execute_platform_runtime()
    and not exists (
      select 1
      from public.price_quotes quote
      join public.service_requests request on request.id = quote.service_request_id
      where quote.id = target_price_quote_id
        and request.requester_user_id = auth.uid()
    ) then
    raise exception 'service request requester or platform runtime permission is required';
  end if;

  if target_price_quote_id is null then
    raise exception 'target_price_quote_id is required';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select event.*
  into existing_event
  from public.service_request_events event
  where event.idempotency_key = target_idempotency_key;

  if found then
    return target_price_quote_id;
  end if;

  select quote.*
  into quote_record
  from public.price_quotes quote
  where quote.id = target_price_quote_id
  for update;

  if not found then
    raise exception 'target_price_quote_id must reference an existing price quote';
  end if;

  if quote_record.status <> 'calculated' then
    if quote_record.status = 'accepted' then
      return quote_record.id;
    end if;

    raise exception 'price quote cannot be accepted from its current status';
  end if;

  if quote_record.expires_at is not null and quote_record.expires_at <= timezone('utc', now()) then
    update public.price_quotes
    set status = 'expired',
        updated_at = timezone('utc', now())
    where id = quote_record.id;

    raise exception 'price quote has expired';
  end if;

  update public.price_quotes
  set status = 'accepted',
      accepted_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = quote_record.id;

  update public.service_requests
  set active_quote_id = quote_record.id,
      status = 'priced',
      updated_at = timezone('utc', now())
  where id = quote_record.service_request_id;

  insert into public.service_request_events (
    service_request_id,
    status,
    idempotency_key,
    metadata
  )
  values (
    quote_record.service_request_id,
    'price_quote_accepted',
    target_idempotency_key,
    target_metadata || jsonb_build_object('price_quote_id', quote_record.id)
  );

  return quote_record.id;
end;
$$;

create or replace function public.create_escrow_hold(
  target_service_request_id uuid,
  target_customer_wallet_id uuid,
  target_escrow_wallet_id uuid,
  target_idempotency_key text,
  target_source text default 'platform.escrow_engine',
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request_record record;
  quote_record record;
  customer_wallet record;
  escrow_wallet record;
  customer_balance numeric(28, 8);
  hold_transaction_id uuid;
  created_escrow_hold_id uuid;
  existing_record record;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.escrow.execute', null)
    and not public.can_execute_platform_runtime() then
    raise exception 'escrow execution permission is required';
  end if;

  if target_service_request_id is null then
    raise exception 'target_service_request_id is required';
  end if;

  if target_customer_wallet_id is null or target_escrow_wallet_id is null then
    raise exception 'target_customer_wallet_id and target_escrow_wallet_id are required';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_source is null
    or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select request.*
  into request_record
  from public.service_requests request
  where request.id = target_service_request_id
  for update;

  if not found then
    raise exception 'target_service_request_id must reference an existing service request';
  end if;

  select quote.*
  into quote_record
  from public.price_quotes quote
  where quote.id = request_record.active_quote_id
    and quote.status = 'accepted';

  if not found then
    raise exception 'an accepted active price quote is required before escrow hold';
  end if;

  select wallet.*
  into customer_wallet
  from public.wallet_accounts wallet
  where wallet.id = target_customer_wallet_id
    and wallet.status = 'active';

  if not found then
    raise exception 'target_customer_wallet_id must reference an active wallet';
  end if;

  select wallet.*
  into escrow_wallet
  from public.wallet_accounts wallet
  where wallet.id = target_escrow_wallet_id
    and wallet.status = 'active'
    and wallet.wallet_type = 'escrow';

  if not found then
    raise exception 'target_escrow_wallet_id must reference an active escrow wallet';
  end if;

  if customer_wallet.currency_code <> quote_record.currency_code
    or escrow_wallet.currency_code <> quote_record.currency_code then
    raise exception 'wallet currencies must match the accepted quote currency';
  end if;

  select balance.balance
  into customer_balance
  from public.wallet_balances balance
  where balance.wallet_id = target_customer_wallet_id;

  if coalesce(customer_balance, 0) < quote_record.total_amount then
    raise exception 'customer wallet has insufficient available balance';
  end if;

  select existing.*
  into existing_record
  from public.escrow_holds existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if found then
    if existing_record.subject_id <> target_service_request_id
      or existing_record.hold_amount <> quote_record.total_amount then
      raise exception 'target_idempotency_key has already been used with different escrow hold details';
    end if;

    return existing_record.id;
  end if;

  hold_transaction_id := public.post_financial_transaction(
    'hold',
    quote_record.currency_code,
    target_source,
    'service_request',
    target_service_request_id,
    jsonb_build_array(
      jsonb_build_object(
        'wallet_id',
        target_customer_wallet_id,
        'direction',
        'debit',
        'amount',
        quote_record.total_amount,
        'entry_type',
        'principal',
        'metadata',
        jsonb_build_object('role', 'customer')
      ),
      jsonb_build_object(
        'wallet_id',
        target_escrow_wallet_id,
        'direction',
        'credit',
        'amount',
        quote_record.total_amount,
        'entry_type',
        'principal',
        'metadata',
        jsonb_build_object('role', 'escrow')
      )
    ),
    target_idempotency_key || ':financial',
    null,
    null,
    jsonb_build_object('pricing_policy_id', quote_record.pricing_policy_id),
    target_metadata
  );

  insert into public.escrow_holds (
    settlement_policy_id,
    wallet_id,
    source_transaction_id,
    status,
    currency_code,
    hold_amount,
    released_amount,
    subject_type,
    subject_id,
    release_conditions,
    beneficiaries,
    expires_at,
    source,
    idempotency_key,
    created_by
  )
  values (
    request_record.settlement_policy_id,
    target_escrow_wallet_id,
    hold_transaction_id,
    'held',
    quote_record.currency_code,
    quote_record.total_amount,
    0,
    'service_request',
    target_service_request_id,
    coalesce((target_metadata -> 'release_conditions'), '{}'::jsonb),
    coalesce((target_metadata -> 'beneficiaries'), '[]'::jsonb),
    case
      when target_metadata ? 'expires_at' then (target_metadata ->> 'expires_at')::timestamptz
      else timezone('utc', now()) + interval '24 hours'
    end,
    target_source,
    target_idempotency_key,
    auth.uid()
  )
  returning id into created_escrow_hold_id;

  update public.service_requests
  set escrow_hold_id = created_escrow_hold_id,
      status = 'payment_reserved',
      updated_at = timezone('utc', now())
  where id = target_service_request_id;

  insert into public.service_request_events (
    service_request_id,
    event_type_key,
    status,
    idempotency_key,
    metadata
  )
  values (
    target_service_request_id,
    'event.escrow.held',
    'payment_reserved',
    target_idempotency_key || ':held',
    target_metadata || jsonb_build_object(
      'escrow_hold_id',
      created_escrow_hold_id,
      'transaction_id',
      hold_transaction_id
    )
  )
  on conflict do nothing;

  return created_escrow_hold_id;
end;
$$;

create or replace function public.update_escrow_hold_status(
  target_escrow_hold_id uuid,
  target_status text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hold_record record;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.escrow.execute', null) then
    raise exception 'escrow execution permission is required';
  end if;

  if target_escrow_hold_id is null then
    raise exception 'target_escrow_hold_id is required';
  end if;

  if target_status is null
    or target_status not in ('disputed', 'expired', 'cancelled') then
    raise exception 'target_status is not supported for this escrow operation';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select hold.*
  into hold_record
  from public.escrow_holds hold
  where hold.id = target_escrow_hold_id
  for update;

  if not found then
    raise exception 'target_escrow_hold_id must reference an existing escrow hold';
  end if;

  if hold_record.status not in ('pending', 'held', 'partially_released') then
    if hold_record.status = target_status then
      return hold_record.id;
    end if;

    raise exception 'escrow hold cannot change status from its current state';
  end if;

  update public.escrow_holds
  set status = target_status,
      disputed_at = case when target_status = 'disputed' then timezone('utc', now()) else disputed_at end,
      expired_at = case when target_status = 'expired' then timezone('utc', now()) else expired_at end,
      updated_at = timezone('utc', now())
  where id = hold_record.id;

  insert into public.service_request_events (
    service_request_id,
    status,
    idempotency_key,
    metadata
  )
  select
    request.id,
    'escrow_' || target_status,
    target_idempotency_key,
    target_metadata || jsonb_build_object('escrow_hold_id', hold_record.id)
  from public.service_requests request
  where request.escrow_hold_id = hold_record.id
  on conflict do nothing;

  return hold_record.id;
end;
$$;

create or replace function public.release_escrow_hold(
  target_escrow_hold_id uuid,
  target_distribution jsonb,
  target_idempotency_key text,
  target_source text default 'platform.escrow_engine',
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hold_record record;
  parsed_beneficiary record;
  total_release_amount numeric(28, 8) := 0;
  beneficiary_amount numeric(28, 8);
  beneficiary_wallet_id uuid;
  transaction_entries jsonb := '[]'::jsonb;
  transaction_id uuid;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.escrow.execute', null)
    and not public.has_permission('platform.settlement.execute', null) then
    raise exception 'escrow execution permission is required';
  end if;

  if target_escrow_hold_id is null then
    raise exception 'target_escrow_hold_id is required';
  end if;

  if target_distribution is null
    or jsonb_typeof(target_distribution) <> 'array'
    or jsonb_array_length(target_distribution) = 0 then
    raise exception 'target_distribution must be a non-empty JSON array';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_source is null
    or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select hold.*
  into hold_record
  from public.escrow_holds hold
  where hold.id = target_escrow_hold_id
  for update;

  if not found then
    raise exception 'target_escrow_hold_id must reference an existing escrow hold';
  end if;

  if hold_record.status not in ('held', 'partially_released') then
    raise exception 'escrow hold cannot be released from its current status';
  end if;

  for parsed_beneficiary in
    select parsed.value
    from jsonb_array_elements(target_distribution) parsed(value)
  loop
    begin
      beneficiary_wallet_id := (parsed_beneficiary.value ->> 'wallet_id')::uuid;
      beneficiary_amount := (parsed_beneficiary.value ->> 'amount')::numeric(28, 8);
    exception
      when others then
        raise exception 'each distribution entry must include valid wallet_id and amount';
    end;

    if beneficiary_amount <= 0 then
      raise exception 'each distribution amount must be greater than zero';
    end if;

    if not exists (
      select 1
      from public.wallet_accounts wallet
      where wallet.id = beneficiary_wallet_id
        and wallet.status = 'active'
        and wallet.currency_code = hold_record.currency_code
    ) then
      raise exception 'each distribution wallet must be active and match escrow currency';
    end if;

    total_release_amount := total_release_amount + beneficiary_amount;
    transaction_entries := transaction_entries || jsonb_build_array(
      jsonb_build_object(
        'wallet_id',
        beneficiary_wallet_id,
        'direction',
        'credit',
        'amount',
        beneficiary_amount,
        'entry_type',
        coalesce(parsed_beneficiary.value ->> 'entry_type', 'principal'),
        'metadata',
        coalesce(parsed_beneficiary.value -> 'metadata', '{}'::jsonb)
      )
    );
  end loop;

  if total_release_amount > hold_record.hold_amount - hold_record.released_amount then
    raise exception 'escrow release exceeds available balance';
  end if;

  transaction_entries := jsonb_build_array(
    jsonb_build_object(
      'wallet_id',
      hold_record.wallet_id,
      'direction',
      'debit',
      'amount',
      total_release_amount,
      'entry_type',
      'principal',
      'metadata',
      jsonb_build_object('role', 'escrow')
    )
  ) || transaction_entries;

  transaction_id := public.post_financial_transaction(
    'release',
    hold_record.currency_code,
    target_source,
    hold_record.subject_type,
    hold_record.subject_id,
    transaction_entries,
    target_idempotency_key || ':financial',
    null,
    null,
    jsonb_build_object('escrow_hold_id', hold_record.id),
    target_metadata
  );

  update public.escrow_holds
  set released_amount = released_amount + total_release_amount,
      status = case
        when released_amount + total_release_amount = hold_amount then 'released'
        else 'partially_released'
      end,
      updated_at = timezone('utc', now())
  where id = hold_record.id;

  return transaction_id;
end;
$$;

create or replace function public.refund_escrow_hold(
  target_escrow_hold_id uuid,
  target_refund_wallet_id uuid,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hold_record record;
  refund_wallet record;
  transaction_id uuid;
  remaining_amount numeric(28, 8);
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.escrow.execute', null)
    and not public.has_permission('platform.settlement.execute', null) then
    raise exception 'escrow execution permission is required';
  end if;

  if target_escrow_hold_id is null or target_refund_wallet_id is null then
    raise exception 'target_escrow_hold_id and target_refund_wallet_id are required';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select hold.*
  into hold_record
  from public.escrow_holds hold
  where hold.id = target_escrow_hold_id
  for update;

  if not found then
    raise exception 'target_escrow_hold_id must reference an existing escrow hold';
  end if;

  if hold_record.status not in ('held', 'partially_released', 'disputed', 'expired') then
    if hold_record.status = 'refunded' then
      select transaction.id
      into transaction_id
      from public.financial_transactions transaction
      where transaction.source = 'platform.escrow_engine'
        and transaction.idempotency_key = target_idempotency_key || ':financial';

      if found then
        return transaction_id;
      end if;
    end if;

    raise exception 'escrow hold cannot be refunded from its current status';
  end if;

  remaining_amount := hold_record.hold_amount - hold_record.released_amount;

  if remaining_amount <= 0 then
    raise exception 'escrow hold has no refundable balance';
  end if;

  select wallet.*
  into refund_wallet
  from public.wallet_accounts wallet
  where wallet.id = target_refund_wallet_id
    and wallet.status = 'active'
    and wallet.currency_code = hold_record.currency_code;

  if not found then
    raise exception 'target_refund_wallet_id must reference an active wallet with matching currency';
  end if;

  transaction_id := public.post_financial_transaction(
    'refund',
    hold_record.currency_code,
    'platform.escrow_engine',
    hold_record.subject_type,
    hold_record.subject_id,
    jsonb_build_array(
      jsonb_build_object(
        'wallet_id',
        hold_record.wallet_id,
        'direction',
        'debit',
        'amount',
        remaining_amount,
        'entry_type',
        'principal',
        'metadata',
        jsonb_build_object('role', 'escrow')
      ),
      jsonb_build_object(
        'wallet_id',
        target_refund_wallet_id,
        'direction',
        'credit',
        'amount',
        remaining_amount,
        'entry_type',
        'principal',
        'metadata',
        jsonb_build_object('role', 'refund')
      )
    ),
    target_idempotency_key || ':financial',
    null,
    null,
    jsonb_build_object('escrow_hold_id', hold_record.id),
    target_metadata
  );

  update public.escrow_holds
  set status = 'refunded',
      released_amount = hold_amount,
      updated_at = timezone('utc', now())
  where id = hold_record.id;

  update public.service_requests
  set status = 'refunded',
      updated_at = timezone('utc', now())
  where escrow_hold_id = hold_record.id;

  insert into public.service_request_events (
    service_request_id,
    status,
    idempotency_key,
    metadata
  )
  select
    request.id,
    'refunded',
    target_idempotency_key,
    target_metadata || jsonb_build_object('escrow_hold_id', hold_record.id, 'transaction_id', transaction_id)
  from public.service_requests request
  where request.escrow_hold_id = hold_record.id
  on conflict do nothing;

  return transaction_id;
end;
$$;

create or replace function public.start_service_request_workflow(
  target_service_request_id uuid,
  target_context jsonb default '{}'::jsonb,
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request_record record;
  workflow_key text;
  created_workflow_instance_id uuid;
begin
  if auth.role() <> 'service_role'
    and not public.can_execute_platform_runtime() then
    raise exception 'platform runtime management permission is required';
  end if;

  if target_service_request_id is null then
    raise exception 'target_service_request_id is required';
  end if;

  if target_context is null
    or jsonb_typeof(target_context) <> 'object' then
    raise exception 'target_context must be a JSON object';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select request.*, module.key as module_key
  into request_record
  from public.service_requests request
  join public.business_modules module on module.id = request.module_id
  where request.id = target_service_request_id
  for update;

  if not found then
    raise exception 'target_service_request_id must reference an existing service request';
  end if;

  select workflow.key
  into workflow_key
  from public.business_module_components component
  join public.workflow_definitions workflow on workflow.key = component.reference_key
  where component.module_version_id = request_record.module_version_id
    and component.component_type = 'workflow'
    and component.status = 'active'
    and workflow.status = 'active'
  order by component.created_at asc
  limit 1;

  if workflow_key is null then
    raise exception 'service request module must bind an active workflow';
  end if;

  created_workflow_instance_id := public.start_workflow_instance(
    workflow_key,
    'platform.runtime_engine',
    'service_request',
    target_service_request_id,
    target_context || jsonb_build_object('module_key', request_record.module_key),
    target_idempotency_key
  );

  update public.service_requests
  set workflow_instance_id = created_workflow_instance_id,
      status = 'workflow_started',
      updated_at = timezone('utc', now())
  where id = target_service_request_id;

  insert into public.service_request_events (
    service_request_id,
    status,
    idempotency_key,
    metadata
  )
  values (
    target_service_request_id,
    'workflow_started',
    target_idempotency_key || ':started',
    jsonb_build_object('workflow_instance_id', created_workflow_instance_id)
  )
  on conflict do nothing;

  return created_workflow_instance_id;
end;
$$;

create or replace function public.process_service_request_event(
  target_service_request_id uuid,
  target_event_type_key text,
  target_payload jsonb default '{}'::jsonb,
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request_record record;
  event_id uuid;
  next_status text;
begin
  if auth.role() <> 'service_role'
    and not public.can_execute_platform_runtime() then
    raise exception 'platform runtime management permission is required';
  end if;

  if target_service_request_id is null then
    raise exception 'target_service_request_id is required';
  end if;

  if target_event_type_key is null
    or target_event_type_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_event_type_key must be a valid platform key';
  end if;

  if target_payload is null
    or jsonb_typeof(target_payload) <> 'object' then
    raise exception 'target_payload must be a JSON object';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select request.*
  into request_record
  from public.service_requests request
  where request.id = target_service_request_id
  for update;

  if not found then
    raise exception 'target_service_request_id must reference an existing service request';
  end if;

  if request_record.workflow_instance_id is null then
    raise exception 'service request workflow must be started before processing workflow events';
  end if;

  event_id := public.advance_workflow_instance(
    request_record.workflow_instance_id,
    target_event_type_key,
    null,
    target_payload,
    target_idempotency_key
  );

  next_status := case target_event_type_key
    when 'event.request.validated' then 'workflow_started'
    when 'event.partner.matched' then 'matching'
    when 'event.partner.accepted' then 'matching'
    when 'event.driver.matched' then 'matching'
    when 'event.driver.assigned' then 'assigned'
    when 'event.escrow.held' then 'payment_reserved'
    when 'event.pickup.confirmed' then 'in_progress'
    when 'event.partner.fulfillment.confirmed' then 'fulfilled'
    when 'event.delivery.completed' then 'completed'
    when 'event.settlement.released' then 'settled'
    when 'event.request.cancelled' then 'cancelled'
    else request_record.status
  end;

  update public.service_requests
  set status = next_status,
      updated_at = timezone('utc', now())
  where id = target_service_request_id;

  insert into public.service_request_events (
    service_request_id,
    event_type_key,
    event_id,
    status,
    idempotency_key,
    metadata
  )
  values (
    target_service_request_id,
    target_event_type_key,
    event_id,
    next_status,
    target_idempotency_key || ':service',
    target_payload
  )
  on conflict do nothing;

  return event_id;
end;
$$;

create or replace function public.assign_service_request_participant(
  target_service_request_id uuid,
  target_participant_role text,
  target_entity_id uuid,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request_record record;
  existing_event record;
begin
  if auth.role() <> 'service_role'
    and not public.can_execute_platform_runtime() then
    raise exception 'platform runtime management permission is required';
  end if;

  if target_service_request_id is null then
    raise exception 'target_service_request_id is required';
  end if;

  if target_participant_role is null
    or target_participant_role !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_participant_role must be a valid platform key';
  end if;

  if target_entity_id is null then
    raise exception 'target_entity_id is required';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select event.*
  into existing_event
  from public.service_request_events event
  where event.service_request_id = target_service_request_id
    and event.idempotency_key = target_idempotency_key;

  if found then
    return target_service_request_id;
  end if;

  select request.*
  into request_record
  from public.service_requests request
  where request.id = target_service_request_id
  for update;

  if not found then
    raise exception 'target_service_request_id must reference an existing service request';
  end if;

  update public.service_requests
  set participants = participants || jsonb_build_object(
        target_participant_role,
        jsonb_build_object('entity_id', target_entity_id, 'metadata', target_metadata)
      ),
      updated_at = timezone('utc', now())
  where id = target_service_request_id;

  insert into public.service_request_events (
    service_request_id,
    status,
    idempotency_key,
    metadata
  )
  values (
    target_service_request_id,
    'participant_assigned',
    target_idempotency_key,
    target_metadata || jsonb_build_object('participant_role', target_participant_role, 'entity_id', target_entity_id)
  );

  return target_service_request_id;
end;
$$;

create or replace function public.dispatch_service_request(
  target_service_request_id uuid,
  target_dispatch_policy_key text default null,
  target_candidate_limit integer default 5,
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request_record record;
  policy_record record;
  dispatch_request_id uuid;
  candidate_record record;
  candidate_rank integer := 0;
  required_capabilities text[];
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.dispatch.execute', null)
    and not public.can_execute_platform_runtime() then
    raise exception 'dispatch execution permission is required';
  end if;

  if target_service_request_id is null then
    raise exception 'target_service_request_id is required';
  end if;

  if target_candidate_limit is null or target_candidate_limit <= 0 or target_candidate_limit > 50 then
    raise exception 'target_candidate_limit must be between 1 and 50';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select request.*
  into request_record
  from public.service_requests request
  where request.id = target_service_request_id
  for update;

  if not found then
    raise exception 'target_service_request_id must reference an existing service request';
  end if;

  if target_dispatch_policy_key is not null then
    select policy.*
    into policy_record
    from public.dispatch_policies policy
    where policy.key = target_dispatch_policy_key
      and policy.status = 'active';
  elsif request_record.dispatch_policy_id is not null then
    select policy.*
    into policy_record
    from public.dispatch_policies policy
    where policy.id = request_record.dispatch_policy_id
      and policy.status = 'active';
  else
    select policy.*
    into policy_record
    from public.dispatch_policies policy
    where policy.status = 'active'
    order by policy.created_at asc
    limit 1;
  end if;

  if not found then
    raise exception 'an active dispatch policy is required for this service request';
  end if;

  select array_agg(required.value)
  into required_capabilities
  from jsonb_array_elements_text(
    coalesce(policy_record.rules -> 'required_capabilities', '[]'::jsonb)
  ) as required(value);

  required_capabilities := coalesce(required_capabilities, array[]::text[]);

  dispatch_request_id := public.create_dispatch_request(
    policy_record.key,
    'platform.dispatch_engine',
    'service_request',
    target_service_request_id,
    jsonb_build_object('required_capabilities', required_capabilities),
    coalesce(request_record.request_payload -> 'pickup_location', '{}'::jsonb),
    coalesce(request_record.request_payload -> 'dropoff_location', '{}'::jsonb),
    coalesce((request_record.request_payload ->> 'priority')::integer, 100),
    jsonb_build_object('module_id', request_record.module_id),
    target_idempotency_key || ':request'
  );

  for candidate_record in
    select
      driver.id as driver_id,
      driver.user_id,
      count(capability.id) as matching_capability_count,
      max(vehicle.id) as vehicle_id
    from public.driver_profiles driver
    left join public.entity_capabilities capability
      on capability.entity_type = 'driver'
      and capability.entity_id = driver.id
      and capability.status = 'active'
      and (
        array_length(required_capabilities, 1) is null
        or capability.capability_key = any(required_capabilities)
      )
    left join public.vehicles vehicle
      on vehicle.owner_user_id = driver.user_id
      and vehicle.status = 'active'
    where driver.verification_status = 'approved'
      and driver.operational_status = 'available'
    group by driver.id, driver.user_id
    having array_length(required_capabilities, 1) is null
      or count(capability.id) >= array_length(required_capabilities, 1)
    order by count(capability.id) desc, driver.created_at asc
    limit target_candidate_limit
  loop
    candidate_rank := candidate_rank + 1;

    perform public.upsert_dispatch_candidate(
      dispatch_request_id,
      'driver',
      candidate_record.driver_id,
      greatest(100 - (candidate_rank - 1) * 5, 1),
      candidate_rank,
      jsonb_build_object(
        'matching_capability_count',
        candidate_record.matching_capability_count,
        'vehicle_id',
        candidate_record.vehicle_id,
        'selection_mode',
        policy_record.matching_strategy
      ),
      case when candidate_rank = 1 then 'offered' else 'suggested' end,
      target_idempotency_key || ':candidate:' || candidate_rank::text
    );
  end loop;

  if candidate_rank = 0 then
    raise exception 'no eligible dispatch candidates found';
  end if;

  update public.service_requests
  set dispatch_policy_id = policy_record.id,
      status = 'matching',
      updated_at = timezone('utc', now())
  where id = target_service_request_id;

  insert into public.service_request_events (
    service_request_id,
    event_type_key,
    status,
    idempotency_key,
    metadata
  )
  values (
    target_service_request_id,
    'event.driver.matched',
    'matching',
    target_idempotency_key || ':matched',
    jsonb_build_object('dispatch_request_id', dispatch_request_id, 'candidate_count', candidate_rank)
  )
  on conflict do nothing;

  return dispatch_request_id;
end;
$$;

create or replace function public.execute_service_request_settlement(
  target_service_request_id uuid,
  target_escrow_hold_id uuid,
  target_distribution jsonb,
  target_idempotency_key text,
  target_source text default 'platform.settlement_engine',
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request_record record;
  hold_record record;
  parsed_beneficiary record;
  total_release_amount numeric(28, 8) := 0;
  beneficiary_amount numeric(28, 8);
  beneficiary_wallet_id uuid;
  transaction_entries jsonb := '[]'::jsonb;
  settlement_execution_id uuid;
  transaction_id uuid;
  existing_record record;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.settlement.execute', null)
    and not public.can_execute_platform_runtime() then
    raise exception 'settlement execution permission is required';
  end if;

  if target_service_request_id is null or target_escrow_hold_id is null then
    raise exception 'target_service_request_id and target_escrow_hold_id are required';
  end if;

  if target_distribution is null
    or jsonb_typeof(target_distribution) <> 'array'
    or jsonb_array_length(target_distribution) = 0 then
    raise exception 'target_distribution must be a non-empty JSON array';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_source is null
    or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select request.*
  into request_record
  from public.service_requests request
  where request.id = target_service_request_id
  for update;

  if not found then
    raise exception 'target_service_request_id must reference an existing service request';
  end if;

  select hold.*
  into hold_record
  from public.escrow_holds hold
  where hold.id = target_escrow_hold_id
    and hold.subject_type = 'service_request'
    and hold.subject_id = target_service_request_id
  for update;

  if not found then
    raise exception 'target_escrow_hold_id must reference an escrow hold for the service request';
  end if;

  if hold_record.status not in ('held', 'partially_released') then
    if hold_record.status = 'released' then
      select existing.*
      into existing_record
      from public.settlement_executions existing
      where existing.source = target_source
        and existing.idempotency_key = target_idempotency_key;

      if found then
        return existing_record.id;
      end if;
    end if;

    raise exception 'escrow hold cannot be settled from its current status';
  end if;

  select existing.*
  into existing_record
  from public.settlement_executions existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if found then
    if existing_record.service_request_id <> target_service_request_id
      or existing_record.escrow_hold_id <> target_escrow_hold_id
      or existing_record.distribution <> target_distribution then
      raise exception 'target_idempotency_key has already been used with different settlement details';
    end if;

    return existing_record.id;
  end if;

  for parsed_beneficiary in
    select parsed.value
    from jsonb_array_elements(target_distribution) parsed(value)
  loop
    begin
      beneficiary_wallet_id := (parsed_beneficiary.value ->> 'wallet_id')::uuid;
      beneficiary_amount := (parsed_beneficiary.value ->> 'amount')::numeric(28, 8);
    exception
      when others then
        raise exception 'each distribution entry must include valid wallet_id and amount';
    end;

    if beneficiary_amount <= 0 then
      raise exception 'each distribution amount must be greater than zero';
    end if;

    if not exists (
      select 1
      from public.wallet_accounts wallet
      where wallet.id = beneficiary_wallet_id
        and wallet.status = 'active'
        and wallet.currency_code = hold_record.currency_code
    ) then
      raise exception 'each distribution wallet must be active and match escrow currency';
    end if;

    total_release_amount := total_release_amount + beneficiary_amount;
    transaction_entries := transaction_entries || jsonb_build_array(
      jsonb_build_object(
        'wallet_id',
        beneficiary_wallet_id,
        'direction',
        'credit',
        'amount',
        beneficiary_amount,
        'entry_type',
        coalesce(parsed_beneficiary.value ->> 'entry_type', 'principal'),
        'metadata',
        coalesce(parsed_beneficiary.value -> 'metadata', '{}'::jsonb)
      )
    );
  end loop;

  if total_release_amount <= 0 then
    raise exception 'settlement distribution total must be greater than zero';
  end if;

  if total_release_amount > hold_record.hold_amount - hold_record.released_amount then
    raise exception 'settlement distribution exceeds available escrow balance';
  end if;

  transaction_entries := jsonb_build_array(
    jsonb_build_object(
      'wallet_id',
      hold_record.wallet_id,
      'direction',
      'debit',
      'amount',
      total_release_amount,
      'entry_type',
      'principal',
      'metadata',
      jsonb_build_object('role', 'escrow')
    )
  ) || transaction_entries;

  transaction_id := public.post_financial_transaction(
    'release',
    hold_record.currency_code,
    target_source,
    'service_request',
    target_service_request_id,
    transaction_entries,
    target_idempotency_key || ':financial',
    null,
    null,
    jsonb_build_object('settlement_policy_id', request_record.settlement_policy_id),
    target_metadata
  );

  insert into public.settlement_executions (
    service_request_id,
    escrow_hold_id,
    settlement_policy_id,
    transaction_id,
    status,
    currency_code,
    gross_amount,
    distribution,
    policy_snapshot,
    source,
    idempotency_key,
    created_by
  )
  values (
    target_service_request_id,
    target_escrow_hold_id,
    request_record.settlement_policy_id,
    transaction_id,
    'posted',
    hold_record.currency_code,
    total_release_amount,
    target_distribution,
    coalesce(target_metadata -> 'policy_snapshot', '{}'::jsonb),
    target_source,
    target_idempotency_key,
    auth.uid()
  )
  returning id into settlement_execution_id;

  update public.escrow_holds
  set released_amount = released_amount + total_release_amount,
      status = case
        when released_amount + total_release_amount = hold_amount then 'released'
        else 'partially_released'
      end,
      updated_at = timezone('utc', now())
  where id = target_escrow_hold_id;

  update public.service_requests
  set status = case
        when total_release_amount = hold_record.hold_amount - hold_record.released_amount then 'settled'
        else status
      end,
      updated_at = timezone('utc', now())
  where id = target_service_request_id;

  if request_record.workflow_instance_id is not null then
    perform public.process_service_request_event(
      target_service_request_id,
      'event.settlement.released',
      target_metadata || jsonb_build_object(
        'settlement_execution_id',
        settlement_execution_id,
        'transaction_id',
        transaction_id
      ),
      target_idempotency_key || ':workflow'
    );
  end if;

  insert into public.service_request_events (
    service_request_id,
    event_type_key,
    event_id,
    status,
    idempotency_key,
    metadata
  )
  values (
    target_service_request_id,
    'event.settlement.released',
    null,
    'settled',
    target_idempotency_key || ':settled',
    target_metadata || jsonb_build_object(
      'settlement_execution_id',
      settlement_execution_id,
      'transaction_id',
      transaction_id,
      'gross_amount',
      total_release_amount
    )
  )
  on conflict do nothing;

  return settlement_execution_id;
end;
$$;

create or replace function public.expire_escrow_holds(
  target_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  expired_count integer;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.escrow.execute', null) then
    raise exception 'escrow execution permission is required';
  end if;

  update public.escrow_holds
  set status = 'expired',
      expired_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id in (
    select hold.id
    from public.escrow_holds hold
    where hold.status in ('pending', 'held', 'partially_released')
      and hold.expires_at is not null
      and hold.expires_at <= timezone('utc', now())
    order by hold.expires_at asc
    limit coalesce(target_limit, 100)
  );

  get diagnostics expired_count = row_count;

  return expired_count;
end;
$$;

create or replace function public.reconcile_service_request_financials(
  target_service_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_record record;
  quote_total numeric(28, 8) := 0;
  hold_total numeric(28, 8) := 0;
  release_total numeric(28, 8) := 0;
  refund_total numeric(28, 8) := 0;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.reconciliation.execute', null) then
    raise exception 'reconciliation execution permission is required';
  end if;

  if target_service_request_id is null then
    raise exception 'target_service_request_id is required';
  end if;

  select request.*
  into request_record
  from public.service_requests request
  where request.id = target_service_request_id;

  if not found then
    raise exception 'target_service_request_id must reference an existing service request';
  end if;

  select coalesce(max(quote.total_amount), 0)
  into quote_total
  from public.price_quotes quote
  where quote.service_request_id = target_service_request_id
    and quote.status = 'accepted';

  select coalesce(sum(transaction.total_amount), 0)
  into hold_total
  from public.financial_transactions transaction
  where transaction.subject_type = 'service_request'
    and transaction.subject_id = target_service_request_id
    and transaction.transaction_type = 'hold'
    and transaction.status = 'posted';

  select coalesce(sum(transaction.total_amount), 0)
  into release_total
  from public.financial_transactions transaction
  where transaction.subject_type = 'service_request'
    and transaction.subject_id = target_service_request_id
    and transaction.transaction_type = 'release'
    and transaction.status = 'posted';

  select coalesce(sum(transaction.total_amount), 0)
  into refund_total
  from public.financial_transactions transaction
  where transaction.subject_type = 'service_request'
    and transaction.subject_id = target_service_request_id
    and transaction.transaction_type = 'refund'
    and transaction.status = 'posted';

  return jsonb_build_object(
    'service_request_id',
    target_service_request_id,
    'status',
    request_record.status,
    'quote_total',
    quote_total,
    'hold_total',
    hold_total,
    'release_total',
    release_total,
    'refund_total',
    refund_total,
    'balanced',
    hold_total = quote_total and hold_total = release_total + refund_total
  );
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'service_requests',
    'price_quotes',
    'settlement_executions'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', table_name);
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name
    );

    execute format('drop trigger if exists audit_changes on public.%I', table_name);
    execute format(
      'create trigger audit_changes after insert or update or delete on public.%I for each row execute function public.record_table_audit()',
      table_name
    );
  end loop;
end;
$$;

drop trigger if exists prevent_service_request_events_update on public.service_request_events;
create trigger prevent_service_request_events_update
before update on public.service_request_events
for each row execute function public.prevent_runtime_event_mutation();

drop trigger if exists prevent_service_request_events_delete on public.service_request_events;
create trigger prevent_service_request_events_delete
before delete on public.service_request_events
for each row execute function public.prevent_runtime_event_mutation();

drop trigger if exists prevent_provider_execution_logs_update on public.provider_execution_logs;
create trigger prevent_provider_execution_logs_update
before update on public.provider_execution_logs
for each row execute function public.prevent_provider_execution_log_mutation();

drop trigger if exists prevent_provider_execution_logs_delete on public.provider_execution_logs;
create trigger prevent_provider_execution_logs_delete
before delete on public.provider_execution_logs
for each row execute function public.prevent_provider_execution_log_mutation();

drop trigger if exists audit_changes on public.provider_execution_logs;
create trigger audit_changes
after insert or update or delete on public.provider_execution_logs
for each row execute function public.record_table_audit();

alter table public.service_requests enable row level security;
alter table public.service_request_events enable row level security;
alter table public.price_quotes enable row level security;
alter table public.settlement_executions enable row level security;
alter table public.provider_execution_logs enable row level security;

drop policy if exists service_requests_select_actor_or_privileged on public.service_requests;
drop policy if exists service_requests_no_direct_insert on public.service_requests;
drop policy if exists service_requests_no_direct_update on public.service_requests;
drop policy if exists service_requests_no_direct_delete on public.service_requests;

create policy service_requests_select_actor_or_privileged on public.service_requests
for select to authenticated
using (
  requester_user_id = auth.uid()
  or public.is_organization_member(organization_id)
  or public.can_read_platform_runtime()
);

create policy service_requests_no_direct_insert on public.service_requests
for insert to authenticated
with check (false);

create policy service_requests_no_direct_update on public.service_requests
for update to authenticated
using (false)
with check (false);

create policy service_requests_no_direct_delete on public.service_requests
for delete to authenticated
using (false);

drop policy if exists service_request_events_select_actor_or_privileged on public.service_request_events;
drop policy if exists service_request_events_no_direct_insert on public.service_request_events;
drop policy if exists service_request_events_no_direct_update on public.service_request_events;
drop policy if exists service_request_events_no_direct_delete on public.service_request_events;

create policy service_request_events_select_actor_or_privileged on public.service_request_events
for select to authenticated
using (
  exists (
    select 1
    from public.service_requests request
    where request.id = service_request_events.service_request_id
      and (
        request.requester_user_id = auth.uid()
        or public.is_organization_member(request.organization_id)
        or public.can_read_platform_runtime()
      )
  )
);

create policy service_request_events_no_direct_insert on public.service_request_events
for insert to authenticated
with check (false);

create policy service_request_events_no_direct_update on public.service_request_events
for update to authenticated
using (false)
with check (false);

create policy service_request_events_no_direct_delete on public.service_request_events
for delete to authenticated
using (false);

drop policy if exists price_quotes_select_actor_or_privileged on public.price_quotes;
drop policy if exists price_quotes_no_direct_insert on public.price_quotes;
drop policy if exists price_quotes_no_direct_update on public.price_quotes;
drop policy if exists price_quotes_no_direct_delete on public.price_quotes;

create policy price_quotes_select_actor_or_privileged on public.price_quotes
for select to authenticated
using (
  exists (
    select 1
    from public.service_requests request
    where request.id = price_quotes.service_request_id
      and (
        request.requester_user_id = auth.uid()
        or public.is_organization_member(request.organization_id)
        or public.can_read_platform_runtime()
      )
  )
);

create policy price_quotes_no_direct_insert on public.price_quotes
for insert to authenticated
with check (false);

create policy price_quotes_no_direct_update on public.price_quotes
for update to authenticated
using (false)
with check (false);

create policy price_quotes_no_direct_delete on public.price_quotes
for delete to authenticated
using (false);

drop policy if exists settlement_executions_select_privileged on public.settlement_executions;
drop policy if exists settlement_executions_no_direct_insert on public.settlement_executions;
drop policy if exists settlement_executions_no_direct_update on public.settlement_executions;
drop policy if exists settlement_executions_no_direct_delete on public.settlement_executions;

create policy settlement_executions_select_privileged on public.settlement_executions
for select to authenticated
using (
  public.has_permission('platform.settlement.read', null)
  or public.has_permission('platform.settlement.manage', null)
  or public.can_read_platform_runtime()
);

create policy settlement_executions_no_direct_insert on public.settlement_executions
for insert to authenticated
with check (false);

create policy settlement_executions_no_direct_update on public.settlement_executions
for update to authenticated
using (false)
with check (false);

create policy settlement_executions_no_direct_delete on public.settlement_executions
for delete to authenticated
using (false);

drop policy if exists provider_execution_logs_select_privileged on public.provider_execution_logs;
drop policy if exists provider_execution_logs_no_direct_insert on public.provider_execution_logs;
drop policy if exists provider_execution_logs_no_direct_update on public.provider_execution_logs;
drop policy if exists provider_execution_logs_no_direct_delete on public.provider_execution_logs;

create policy provider_execution_logs_select_privileged on public.provider_execution_logs
for select to authenticated
using (
  public.has_permission('platform.providers.read', null)
  or public.has_permission('platform.providers.manage', null)
  or public.has_permission('platform.providers.execute', null)
);

create policy provider_execution_logs_no_direct_insert on public.provider_execution_logs
for insert to authenticated
with check (false);

create policy provider_execution_logs_no_direct_update on public.provider_execution_logs
for update to authenticated
using (false)
with check (false);

create policy provider_execution_logs_no_direct_delete on public.provider_execution_logs
for delete to authenticated
using (false);

grant select, insert, update, delete on
  public.service_requests,
  public.service_request_events,
  public.price_quotes,
  public.settlement_executions,
  public.provider_execution_logs
to authenticated;

grant select, insert, update, delete on
  public.service_requests,
  public.service_request_events,
  public.price_quotes,
  public.settlement_executions,
  public.provider_execution_logs
to service_role;

revoke all on function public.can_read_platform_runtime() from public;
revoke all on function public.can_execute_platform_runtime() from public;
revoke all on function public.jsonb_numeric_value(jsonb, text, numeric) from public;
revoke all on function public.record_provider_execution(text, text, text, jsonb, jsonb, text, text, text) from public;
revoke all on function public.check_rate_limit(text, text, integer) from public;
revoke all on function public.set_cache_entry(text, text, jsonb, integer) from public;
revoke all on function public.get_cache_entry(text, text) from public;
revoke all on function public.enqueue_background_job(text, text, jsonb, text, text, timestamptz, integer) from public;
revoke all on function public.record_health_check(text, text, jsonb) from public;
revoke all on function public.create_module_service_request(text, jsonb, text, text, uuid, jsonb) from public;
revoke all on function public.calculate_price_quote(text, uuid, text, text, jsonb, text, text) from public;
revoke all on function public.accept_price_quote(uuid, text, jsonb) from public;
revoke all on function public.create_escrow_hold(uuid, uuid, uuid, text, text, jsonb) from public;
revoke all on function public.update_escrow_hold_status(uuid, text, text, jsonb) from public;
revoke all on function public.release_escrow_hold(uuid, jsonb, text, text, jsonb) from public;
revoke all on function public.refund_escrow_hold(uuid, uuid, text, jsonb) from public;
revoke all on function public.start_service_request_workflow(uuid, jsonb, text) from public;
revoke all on function public.process_service_request_event(uuid, text, jsonb, text) from public;
revoke all on function public.assign_service_request_participant(uuid, text, uuid, text, jsonb) from public;
revoke all on function public.dispatch_service_request(uuid, text, integer, text) from public;
revoke all on function public.execute_service_request_settlement(uuid, uuid, jsonb, text, text, jsonb) from public;
revoke all on function public.expire_escrow_holds(integer) from public;
revoke all on function public.reconcile_service_request_financials(uuid) from public;

grant execute on function public.can_read_platform_runtime() to authenticated, service_role;
grant execute on function public.can_execute_platform_runtime() to authenticated, service_role;
grant execute on function public.record_provider_execution(text, text, text, jsonb, jsonb, text, text, text) to authenticated, service_role;
grant execute on function public.check_rate_limit(text, text, integer) to authenticated, service_role;
grant execute on function public.set_cache_entry(text, text, jsonb, integer) to authenticated, service_role;
grant execute on function public.get_cache_entry(text, text) to authenticated, service_role;
grant execute on function public.enqueue_background_job(text, text, jsonb, text, text, timestamptz, integer) to authenticated, service_role;
grant execute on function public.record_health_check(text, text, jsonb) to authenticated, service_role;
grant execute on function public.create_module_service_request(text, jsonb, text, text, uuid, jsonb) to authenticated, service_role;
grant execute on function public.calculate_price_quote(text, uuid, text, text, jsonb, text, text) to authenticated, service_role;
grant execute on function public.accept_price_quote(uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.create_escrow_hold(uuid, uuid, uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function public.update_escrow_hold_status(uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function public.release_escrow_hold(uuid, jsonb, text, text, jsonb) to authenticated, service_role;
grant execute on function public.refund_escrow_hold(uuid, uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.start_service_request_workflow(uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.process_service_request_event(uuid, text, jsonb, text) to authenticated, service_role;
grant execute on function public.assign_service_request_participant(uuid, text, uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.dispatch_service_request(uuid, text, integer, text) to authenticated, service_role;
grant execute on function public.execute_service_request_settlement(uuid, uuid, jsonb, text, text, jsonb) to authenticated, service_role;
grant execute on function public.expire_escrow_holds(integer) to authenticated, service_role;
grant execute on function public.reconcile_service_request_financials(uuid) to authenticated, service_role;

commit;
