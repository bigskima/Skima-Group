begin;

insert into public.permissions (key, description, risk_level)
values
  ('platform.currency.read', 'Read configured platform currencies.', 'standard'),
  ('platform.currency.manage', 'Manage configured platform currencies.', 'critical'),
  ('platform.pricing.read', 'Read reusable pricing policies.', 'standard'),
  ('platform.pricing.manage', 'Manage reusable pricing policies.', 'critical'),
  ('platform.settlement.read', 'Read reusable settlement policies.', 'standard'),
  ('platform.settlement.manage', 'Manage reusable settlement policies.', 'critical'),
  ('platform.wallets.read', 'Read wallet accounts and ledger entries.', 'high'),
  ('platform.wallets.manage', 'Manage wallet accounts.', 'critical'),
  ('platform.financial.read', 'Read financial transactions.', 'high'),
  ('platform.financial.manage', 'Manage financial transactions.', 'critical'),
  ('platform.escrow.read', 'Read escrow holds.', 'high'),
  ('platform.escrow.manage', 'Manage escrow holds.', 'critical'),
  ('platform.workflows.read', 'Read workflow runtime instances.', 'standard'),
  ('platform.verification.read', 'Read verification definitions and events.', 'standard'),
  ('platform.verification.manage', 'Manage verification definitions and events.', 'high'),
  ('platform.dispatch.read', 'Read dispatch policies and requests.', 'standard'),
  ('platform.dispatch.manage', 'Manage dispatch policies and requests.', 'high'),
  ('platform.tracking.read', 'Read tracking sessions and points.', 'high'),
  ('platform.tracking.manage', 'Manage tracking sessions and points.', 'high'),
  ('platform.notifications.read', 'Read notification templates and messages.', 'standard'),
  ('platform.notifications.manage', 'Manage notification templates and messages.', 'high'),
  ('platform.ai.read', 'Read AI task definitions and runs.', 'high'),
  ('platform.ai.manage', 'Manage AI task definitions and runs.', 'critical'),
  ('platform.maps.read', 'Read map service requests.', 'standard'),
  ('platform.maps.manage', 'Manage map service requests.', 'high')
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    updated_at = timezone('utc', now());

create table if not exists public.currency_definitions (
  code text primary key
    check (code ~ '^[A-Z0-9]{3,12}$'),
  display_name text not null,
  symbol text,
  decimal_places integer not null default 2
    check (decimal_places between 0 and 18),
  status text not null default 'disabled'
    check (status in ('enabled', 'disabled', 'retired')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.pricing_policies (
  id uuid primary key default gen_random_uuid(),
  key text not null
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  pricing_mode text not null
    check (pricing_mode in (
      'fixed',
      'distance',
      'weight',
      'time',
      'dynamic',
      'negotiated',
      'quoted',
      'marketplace',
      'subscription',
      'hybrid',
      'ai_assisted',
      'manual'
    )),
  scope_type text not null default 'global'
    check (scope_type in ('global', 'organization', 'module', 'provider')),
  scope_id uuid,
  currency_code text references public.currency_definitions(code) on delete restrict,
  rules jsonb not null default '{}'::jsonb
    check (jsonb_typeof(rules) = 'object'),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'retired')),
  version integer not null default 1 check (version > 0),
  effective_from timestamptz,
  effective_until timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (scope_type = 'global' or scope_id is not null),
  check (effective_until is null or effective_from is null or effective_until > effective_from)
);

create unique index if not exists pricing_policies_version_unique
on public.pricing_policies (
  key,
  scope_type,
  coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid),
  version
);

create table if not exists public.settlement_policies (
  id uuid primary key default gen_random_uuid(),
  key text not null
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  scope_type text not null default 'global'
    check (scope_type in ('global', 'organization', 'module', 'provider')),
  scope_id uuid,
  flow_schema jsonb not null default '{}'::jsonb
    check (jsonb_typeof(flow_schema) = 'object'),
  beneficiary_schema jsonb not null default '{}'::jsonb
    check (jsonb_typeof(beneficiary_schema) = 'object'),
  release_policy jsonb not null default '{}'::jsonb
    check (jsonb_typeof(release_policy) = 'object'),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'retired')),
  version integer not null default 1 check (version > 0),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (scope_type = 'global' or scope_id is not null)
);

create unique index if not exists settlement_policies_version_unique
on public.settlement_policies (
  key,
  scope_type,
  coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid),
  version
);

create table if not exists public.wallet_accounts (
  id uuid primary key default gen_random_uuid(),
  wallet_type text not null
    check (wallet_type in (
      'customer',
      'driver',
      'partner',
      'platform',
      'escrow',
      'commission',
      'refund',
      'bonus',
      'loyalty',
      'generic'
    )),
  owner_entity_type text not null
    check (owner_entity_type in (
      'user',
      'organization',
      'partner',
      'driver',
      'vehicle',
      'asset',
      'platform',
      'escrow',
      'module'
    )),
  owner_entity_id uuid,
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  status text not null default 'active'
    check (status in ('pending', 'active', 'suspended', 'closed')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (owner_entity_type in ('platform', 'module') or owner_entity_id is not null)
);

create unique index if not exists wallet_accounts_owner_currency_unique
on public.wallet_accounts (
  wallet_type,
  owner_entity_type,
  coalesce(owner_entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
  currency_code
);

create table if not exists public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_type text not null
    check (transaction_type in (
      'payment',
      'transfer',
      'hold',
      'release',
      'refund',
      'commission',
      'fee',
      'adjustment'
    )),
  status text not null default 'pending'
    check (status in ('pending', 'authorized', 'posted', 'reversed', 'failed', 'cancelled')),
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  total_amount numeric(28, 8) not null check (total_amount >= 0),
  idempotency_key text,
  source text not null
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  subject_type text not null
    check (subject_type ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  subject_id uuid,
  actor_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  provider_adapter_id uuid references public.provider_adapters(id) on delete set null,
  external_reference text,
  policy_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(policy_snapshot) = 'object'),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create table if not exists public.wallet_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallet_accounts(id) on delete restrict,
  transaction_id uuid not null references public.financial_transactions(id) on delete restrict,
  direction text not null check (direction in ('debit', 'credit')),
  amount numeric(28, 8) not null check (amount > 0),
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  entry_type text not null default 'principal'
    check (entry_type in ('principal', 'fee', 'commission', 'tax', 'discount', 'adjustment')),
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (wallet_id, idempotency_key)
);

create or replace view public.wallet_balances
with (security_invoker = true)
as
select
  wallet.id as wallet_id,
  wallet.currency_code,
  coalesce(sum(
    case
      when ledger.direction = 'credit' then ledger.amount
      when ledger.direction = 'debit' then -ledger.amount
      else 0
    end
  ), 0)::numeric(28, 8) as balance
from public.wallet_accounts wallet
left join public.wallet_ledger_entries ledger on ledger.wallet_id = wallet.id
group by wallet.id, wallet.currency_code;

create table if not exists public.escrow_holds (
  id uuid primary key default gen_random_uuid(),
  settlement_policy_id uuid references public.settlement_policies(id) on delete set null,
  wallet_id uuid references public.wallet_accounts(id) on delete restrict,
  source_transaction_id uuid references public.financial_transactions(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'held', 'partially_released', 'released', 'refunded', 'disputed', 'expired', 'cancelled')),
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  hold_amount numeric(28, 8) not null check (hold_amount >= 0),
  released_amount numeric(28, 8) not null default 0 check (released_amount >= 0),
  subject_type text not null
    check (subject_type ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  subject_id uuid,
  release_conditions jsonb not null default '{}'::jsonb
    check (jsonb_typeof(release_conditions) = 'object'),
  beneficiaries jsonb not null default '[]'::jsonb
    check (jsonb_typeof(beneficiaries) = 'array'),
  expires_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (released_amount <= hold_amount)
);

create table if not exists public.workflow_instances (
  id uuid primary key default gen_random_uuid(),
  workflow_version_id uuid not null references public.workflow_versions(id) on delete restrict,
  current_state_key text not null,
  subject_type text not null
    check (subject_type ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  subject_id uuid not null,
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed', 'cancelled')),
  context jsonb not null default '{}'::jsonb
    check (jsonb_typeof(context) = 'object'),
  started_by uuid references public.profiles(id) on delete set null default auth.uid(),
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (workflow_version_id, current_state_key)
    references public.workflow_states(workflow_version_id, key) on delete restrict
);

create table if not exists public.event_handlers (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  event_type_key text not null references public.event_types(key) on delete cascade,
  handler_type text not null
    check (handler_type in ('workflow_transition', 'webhook', 'notification', 'job', 'ai_task', 'audit', 'custom')),
  target_config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(target_config) = 'object'),
  status text not null default 'active'
    check (status in ('draft', 'active', 'paused', 'retired')),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.verification_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  verification_mode text not null default 'scan'
    check (verification_mode in ('scan', 'manual', 'document', 'biometric', 'location', 'system')),
  schema jsonb not null default '{}'::jsonb
    check (jsonb_typeof(schema) = 'object'),
  event_type_key text references public.event_types(key) on delete set null,
  status text not null default 'active'
    check (status in ('draft', 'active', 'retired')),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.verification_events (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references public.verification_definitions(id) on delete restrict,
  scanned_by uuid references public.profiles(id) on delete set null default auth.uid(),
  scanned_entity_type text not null
    check (scanned_entity_type ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  scanned_entity_id uuid,
  purpose text not null
    check (purpose ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  location jsonb not null default '{}'::jsonb
    check (jsonb_typeof(location) = 'object'),
  result text not null default 'pending'
    check (result in ('pending', 'passed', 'failed', 'flagged', 'cancelled')),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  triggered_event_id uuid references public.event_log(id) on delete set null,
  occurred_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.dispatch_policies (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  matching_strategy text not null default 'capability_distance'
    check (matching_strategy in ('capability_distance', 'priority', 'manual', 'ai_assisted', 'hybrid')),
  rules jsonb not null default '{}'::jsonb
    check (jsonb_typeof(rules) = 'object'),
  status text not null default 'active'
    check (status in ('draft', 'active', 'retired')),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.dispatch_requests (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid references public.dispatch_policies(id) on delete set null,
  subject_type text not null
    check (subject_type ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  subject_id uuid not null,
  requester_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  required_capabilities jsonb not null default '{}'::jsonb
    check (jsonb_typeof(required_capabilities) = 'object'),
  pickup_location jsonb not null default '{}'::jsonb
    check (jsonb_typeof(pickup_location) = 'object'),
  dropoff_location jsonb not null default '{}'::jsonb
    check (jsonb_typeof(dropoff_location) = 'object'),
  priority integer not null default 100,
  status text not null default 'pending'
    check (status in ('pending', 'matching', 'assigned', 'cancelled', 'expired', 'completed')),
  assigned_entity_type text
    check (assigned_entity_type is null or assigned_entity_type ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  assigned_entity_id uuid,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.dispatch_candidates (
  id uuid primary key default gen_random_uuid(),
  dispatch_request_id uuid not null references public.dispatch_requests(id) on delete cascade,
  candidate_entity_type text not null
    check (candidate_entity_type ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  candidate_entity_id uuid not null,
  score numeric(10, 4) not null default 0,
  rank integer,
  rationale jsonb not null default '{}'::jsonb
    check (jsonb_typeof(rationale) = 'object'),
  status text not null default 'suggested'
    check (status in ('suggested', 'offered', 'accepted', 'rejected', 'expired')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (dispatch_request_id, candidate_entity_type, candidate_entity_id)
);

create table if not exists public.tracking_sessions (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null
    check (subject_type ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  subject_id uuid not null,
  provider_adapter_id uuid references public.provider_adapters(id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'paused', 'completed', 'cancelled')),
  started_by uuid references public.profiles(id) on delete set null default auth.uid(),
  started_at timestamptz not null default timezone('utc', now()),
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.tracking_points (
  id uuid primary key default gen_random_uuid(),
  tracking_session_id uuid not null references public.tracking_sessions(id) on delete cascade,
  recorded_by uuid references public.profiles(id) on delete set null default auth.uid(),
  latitude numeric(10, 7) not null check (latitude between -90 and 90),
  longitude numeric(10, 7) not null check (longitude between -180 and 180),
  accuracy_meters numeric(12, 4) check (accuracy_meters is null or accuracy_meters >= 0),
  speed_meters_per_second numeric(12, 4) check (speed_meters_per_second is null or speed_meters_per_second >= 0),
  heading_degrees numeric(7, 4) check (heading_degrees is null or heading_degrees >= 0 and heading_degrees < 360),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  recorded_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  channel text not null
    check (channel in ('push', 'sms', 'email', 'whatsapp', 'voice', 'in_app', 'future')),
  locale text not null default 'en',
  subject_template text,
  body_template text not null,
  variables_schema jsonb not null default '{}'::jsonb
    check (jsonb_typeof(variables_schema) = 'object'),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'retired')),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.notification_messages (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.notification_templates(id) on delete set null,
  channel text not null
    check (channel in ('push', 'sms', 'email', 'whatsapp', 'voice', 'in_app', 'future')),
  recipient_entity_type text not null
    check (recipient_entity_type ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  recipient_entity_id uuid,
  recipient_address text,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'failed', 'cancelled')),
  provider_adapter_id uuid references public.provider_adapters(id) on delete set null,
  provider_message_id text,
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  error_message text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  queued_at timestamptz not null default timezone('utc', now()),
  sent_at timestamptz,
  delivered_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ai_task_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  task_type text not null
    check (task_type in (
      'dispatch',
      'fraud_detection',
      'demand_prediction',
      'customer_support',
      'summary',
      'recommendation',
      'report',
      'custom'
    )),
  provider_adapter_id uuid references public.provider_adapters(id) on delete set null,
  prompt_config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(prompt_config) = 'object'),
  output_schema jsonb not null default '{}'::jsonb
    check (jsonb_typeof(output_schema) = 'object'),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'retired')),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ai_task_runs (
  id uuid primary key default gen_random_uuid(),
  task_definition_id uuid references public.ai_task_definitions(id) on delete set null,
  subject_type text not null
    check (subject_type ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  subject_id uuid,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  input jsonb not null default '{}'::jsonb
    check (jsonb_typeof(input) = 'object'),
  output jsonb not null default '{}'::jsonb
    check (jsonb_typeof(output) = 'object'),
  model_info jsonb not null default '{}'::jsonb
    check (jsonb_typeof(model_info) = 'object'),
  error_message text,
  requested_by uuid references public.profiles(id) on delete set null default auth.uid(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.map_service_requests (
  id uuid primary key default gen_random_uuid(),
  provider_adapter_id uuid references public.provider_adapters(id) on delete set null,
  request_type text not null
    check (request_type in ('geocode', 'reverse_geocode', 'route', 'distance_matrix', 'eta', 'geofence')),
  subject_type text
    check (subject_type is null or subject_type ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  subject_id uuid,
  request_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(request_payload) = 'object'),
  response_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(response_payload) = 'object'),
  status text not null default 'queued'
    check (status in ('queued', 'completed', 'failed', 'cancelled')),
  requested_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.currency_definitions (code, display_name, symbol, decimal_places, status, metadata)
values
  ('NGN', 'Nigerian Naira', '₦', 2, 'enabled', '{"phase_one":true,"primary":true}'::jsonb)
on conflict (code) do update
set display_name = excluded.display_name,
    symbol = excluded.symbol,
    decimal_places = excluded.decimal_places,
    status = 'enabled',
    metadata = public.currency_definitions.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

insert into public.configuration_entries (
  namespace,
  key,
  scope_type,
  scope_id,
  value,
  status,
  version
)
values
  ('platform.currency', 'enabled', 'global', null, '{"codes":["NGN"]}'::jsonb, 'active', 1)
on conflict do nothing;

create or replace function public.is_wallet_owner(target_wallet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.wallet_accounts wallet
    where wallet.id = target_wallet_id
      and (
        (wallet.owner_entity_type = 'user' and wallet.owner_entity_id = auth.uid())
        or (wallet.owner_entity_type = 'organization' and public.is_organization_member(wallet.owner_entity_id))
      )
  );
$$;

create or replace function public.prevent_wallet_ledger_entry_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'wallet ledger entries are append-only';
end;
$$;

create or replace function public.prevent_wallet_account_balance_columns()
returns trigger
language plpgsql
as $$
begin
  if new.metadata ? 'balance' or new.metadata ? 'available_balance' then
    raise exception 'wallet balances must be derived from ledger entries';
  end if;

  return new;
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'currency_definitions',
    'pricing_policies',
    'settlement_policies',
    'wallet_accounts',
    'financial_transactions',
    'escrow_holds',
    'workflow_instances',
    'event_handlers',
    'verification_definitions',
    'dispatch_policies',
    'dispatch_requests',
    'dispatch_candidates',
    'tracking_sessions',
    'notification_templates',
    'notification_messages',
    'ai_task_definitions',
    'ai_task_runs',
    'map_service_requests'
  ] loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I', target_table, target_table);
    execute format(
      'create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      target_table,
      target_table
    );
  end loop;
end $$;

drop trigger if exists prevent_wallet_account_balance_columns on public.wallet_accounts;
create trigger prevent_wallet_account_balance_columns
before insert or update on public.wallet_accounts
for each row execute function public.prevent_wallet_account_balance_columns();

drop trigger if exists prevent_wallet_ledger_entry_update on public.wallet_ledger_entries;
create trigger prevent_wallet_ledger_entry_update
before update on public.wallet_ledger_entries
for each row execute function public.prevent_wallet_ledger_entry_mutation();

drop trigger if exists prevent_wallet_ledger_entry_delete on public.wallet_ledger_entries;
create trigger prevent_wallet_ledger_entry_delete
before delete on public.wallet_ledger_entries
for each row execute function public.prevent_wallet_ledger_entry_mutation();

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'currency_definitions',
    'pricing_policies',
    'settlement_policies',
    'wallet_accounts',
    'financial_transactions',
    'wallet_ledger_entries',
    'escrow_holds',
    'workflow_instances',
    'event_handlers',
    'verification_definitions',
    'verification_events',
    'dispatch_policies',
    'dispatch_requests',
    'dispatch_candidates',
    'tracking_sessions',
    'tracking_points',
    'notification_templates',
    'notification_messages',
    'ai_task_definitions',
    'ai_task_runs',
    'map_service_requests'
  ] loop
    execute format('drop trigger if exists audit_%I_mutations on public.%I', target_table, target_table);
    execute format(
      'create trigger audit_%I_mutations after insert or update or delete on public.%I for each row execute function public.record_table_audit()',
      target_table,
      target_table
    );
  end loop;
end $$;

drop trigger if exists auto_grant_permission_to_super_admin_roles on public.permissions;
create trigger auto_grant_permission_to_super_admin_roles
after insert on public.permissions
for each row execute function public.auto_grant_permission_to_super_admin_roles();

update public.platform_admin_role_templates
set permission_keys = array(
      select permission_record.key
      from public.permissions permission_record
      order by permission_record.key
    ),
    updated_at = timezone('utc', now())
where key = 'platform.super_admin';

alter table public.currency_definitions enable row level security;
alter table public.pricing_policies enable row level security;
alter table public.settlement_policies enable row level security;
alter table public.wallet_accounts enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.wallet_ledger_entries enable row level security;
alter table public.escrow_holds enable row level security;
alter table public.workflow_instances enable row level security;
alter table public.event_handlers enable row level security;
alter table public.verification_definitions enable row level security;
alter table public.verification_events enable row level security;
alter table public.dispatch_policies enable row level security;
alter table public.dispatch_requests enable row level security;
alter table public.dispatch_candidates enable row level security;
alter table public.tracking_sessions enable row level security;
alter table public.tracking_points enable row level security;
alter table public.notification_templates enable row level security;
alter table public.notification_messages enable row level security;
alter table public.ai_task_definitions enable row level security;
alter table public.ai_task_runs enable row level security;
alter table public.map_service_requests enable row level security;

create policy currency_definitions_select_active_or_privileged on public.currency_definitions
for select to authenticated
using (status = 'enabled' or public.has_permission('platform.currency.read', null));

create policy currency_definitions_manage_privileged on public.currency_definitions
for all to authenticated
using (public.has_permission('platform.currency.manage', null))
with check (public.has_permission('platform.currency.manage', null));

create policy pricing_policies_select_active_or_privileged on public.pricing_policies
for select to authenticated
using (status = 'active' or public.has_permission('platform.pricing.read', null));

create policy pricing_policies_manage_privileged on public.pricing_policies
for all to authenticated
using (public.has_permission('platform.pricing.manage', null))
with check (public.has_permission('platform.pricing.manage', null));

create policy settlement_policies_select_active_or_privileged on public.settlement_policies
for select to authenticated
using (status = 'active' or public.has_permission('platform.settlement.read', null));

create policy settlement_policies_manage_privileged on public.settlement_policies
for all to authenticated
using (public.has_permission('platform.settlement.manage', null))
with check (public.has_permission('platform.settlement.manage', null));

create policy wallet_accounts_select_owner_or_privileged on public.wallet_accounts
for select to authenticated
using (
  public.is_wallet_owner(id)
  or public.has_permission('platform.wallets.read', null)
  or public.has_permission('platform.wallets.manage', null)
);

create policy wallet_accounts_manage_privileged on public.wallet_accounts
for all to authenticated
using (public.has_permission('platform.wallets.manage', null))
with check (public.has_permission('platform.wallets.manage', null));

create policy financial_transactions_select_actor_or_privileged on public.financial_transactions
for select to authenticated
using (
  actor_user_id = auth.uid()
  or public.has_permission('platform.financial.read', null)
  or public.has_permission('platform.financial.manage', null)
);

create policy financial_transactions_manage_privileged on public.financial_transactions
for all to authenticated
using (public.has_permission('platform.financial.manage', null))
with check (public.has_permission('platform.financial.manage', null));

create policy wallet_ledger_entries_select_owner_or_privileged on public.wallet_ledger_entries
for select to authenticated
using (
  public.is_wallet_owner(wallet_id)
  or public.has_permission('platform.wallets.read', null)
  or public.has_permission('platform.financial.read', null)
);

create policy wallet_ledger_entries_insert_privileged on public.wallet_ledger_entries
for insert to authenticated
with check (public.has_permission('platform.financial.manage', null));

create policy escrow_holds_select_privileged on public.escrow_holds
for select to authenticated
using (
  public.has_permission('platform.escrow.read', null)
  or public.has_permission('platform.escrow.manage', null)
);

create policy escrow_holds_manage_privileged on public.escrow_holds
for all to authenticated
using (public.has_permission('platform.escrow.manage', null))
with check (public.has_permission('platform.escrow.manage', null));

create policy workflow_instances_select_actor_or_privileged on public.workflow_instances
for select to authenticated
using (
  started_by = auth.uid()
  or public.has_permission('platform.workflows.read', null)
  or public.has_permission('platform.workflows.manage', null)
);

create policy workflow_instances_manage_privileged on public.workflow_instances
for all to authenticated
using (public.has_permission('platform.workflows.manage', null))
with check (public.has_permission('platform.workflows.manage', null));

create policy event_handlers_select_privileged on public.event_handlers
for select to authenticated
using (
  public.has_permission('platform.events.read', null)
  or public.has_permission('platform.events.manage', null)
);

create policy event_handlers_manage_privileged on public.event_handlers
for all to authenticated
using (public.has_permission('platform.events.manage', null))
with check (public.has_permission('platform.events.manage', null));

create policy verification_definitions_select_active_or_privileged on public.verification_definitions
for select to authenticated
using (status = 'active' or public.has_permission('platform.verification.read', null));

create policy verification_definitions_manage_privileged on public.verification_definitions
for all to authenticated
using (public.has_permission('platform.verification.manage', null))
with check (public.has_permission('platform.verification.manage', null));

create policy verification_events_select_actor_or_privileged on public.verification_events
for select to authenticated
using (
  scanned_by = auth.uid()
  or public.has_permission('platform.verification.read', null)
  or public.has_permission('platform.verification.manage', null)
);

create policy verification_events_insert_actor_or_privileged on public.verification_events
for insert to authenticated
with check (
  scanned_by = auth.uid()
  or public.has_permission('platform.verification.manage', null)
);

create policy dispatch_policies_select_active_or_privileged on public.dispatch_policies
for select to authenticated
using (status = 'active' or public.has_permission('platform.dispatch.read', null));

create policy dispatch_policies_manage_privileged on public.dispatch_policies
for all to authenticated
using (public.has_permission('platform.dispatch.manage', null))
with check (public.has_permission('platform.dispatch.manage', null));

create policy dispatch_requests_select_actor_or_privileged on public.dispatch_requests
for select to authenticated
using (
  requester_user_id = auth.uid()
  or public.has_permission('platform.dispatch.read', null)
  or public.has_permission('platform.dispatch.manage', null)
);

create policy dispatch_requests_manage_privileged on public.dispatch_requests
for all to authenticated
using (public.has_permission('platform.dispatch.manage', null))
with check (public.has_permission('platform.dispatch.manage', null));

create policy dispatch_candidates_select_privileged on public.dispatch_candidates
for select to authenticated
using (
  public.has_permission('platform.dispatch.read', null)
  or public.has_permission('platform.dispatch.manage', null)
);

create policy dispatch_candidates_manage_privileged on public.dispatch_candidates
for all to authenticated
using (public.has_permission('platform.dispatch.manage', null))
with check (public.has_permission('platform.dispatch.manage', null));

create policy tracking_sessions_select_actor_or_privileged on public.tracking_sessions
for select to authenticated
using (
  started_by = auth.uid()
  or public.has_permission('platform.tracking.read', null)
  or public.has_permission('platform.tracking.manage', null)
);

create policy tracking_sessions_manage_actor_or_privileged on public.tracking_sessions
for all to authenticated
using (
  started_by = auth.uid()
  or public.has_permission('platform.tracking.manage', null)
)
with check (
  started_by = auth.uid()
  or public.has_permission('platform.tracking.manage', null)
);

create policy tracking_points_select_actor_or_privileged on public.tracking_points
for select to authenticated
using (
  recorded_by = auth.uid()
  or public.has_permission('platform.tracking.read', null)
  or public.has_permission('platform.tracking.manage', null)
);

create policy tracking_points_insert_actor_or_privileged on public.tracking_points
for insert to authenticated
with check (
  recorded_by = auth.uid()
  or public.has_permission('platform.tracking.manage', null)
);

create policy notification_templates_select_active_or_privileged on public.notification_templates
for select to authenticated
using (status = 'active' or public.has_permission('platform.notifications.read', null));

create policy notification_templates_manage_privileged on public.notification_templates
for all to authenticated
using (public.has_permission('platform.notifications.manage', null))
with check (public.has_permission('platform.notifications.manage', null));

create policy notification_messages_select_recipient_or_privileged on public.notification_messages
for select to authenticated
using (
  (recipient_entity_type = 'user' and recipient_entity_id = auth.uid())
  or public.has_permission('platform.notifications.read', null)
  or public.has_permission('platform.notifications.manage', null)
);

create policy notification_messages_manage_privileged on public.notification_messages
for all to authenticated
using (public.has_permission('platform.notifications.manage', null))
with check (public.has_permission('platform.notifications.manage', null));

create policy ai_task_definitions_select_privileged on public.ai_task_definitions
for select to authenticated
using (
  public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
);

create policy ai_task_definitions_manage_privileged on public.ai_task_definitions
for all to authenticated
using (public.has_permission('platform.ai.manage', null))
with check (public.has_permission('platform.ai.manage', null));

create policy ai_task_runs_select_actor_or_privileged on public.ai_task_runs
for select to authenticated
using (
  requested_by = auth.uid()
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
);

create policy ai_task_runs_manage_privileged on public.ai_task_runs
for all to authenticated
using (public.has_permission('platform.ai.manage', null))
with check (public.has_permission('platform.ai.manage', null));

create policy map_service_requests_select_actor_or_privileged on public.map_service_requests
for select to authenticated
using (
  requested_by = auth.uid()
  or public.has_permission('platform.maps.read', null)
  or public.has_permission('platform.maps.manage', null)
);

create policy map_service_requests_manage_privileged on public.map_service_requests
for all to authenticated
using (public.has_permission('platform.maps.manage', null))
with check (public.has_permission('platform.maps.manage', null));

grant select, insert, update, delete on
  public.currency_definitions,
  public.pricing_policies,
  public.settlement_policies,
  public.wallet_accounts,
  public.financial_transactions,
  public.wallet_ledger_entries,
  public.escrow_holds,
  public.workflow_instances,
  public.event_handlers,
  public.verification_definitions,
  public.verification_events,
  public.dispatch_policies,
  public.dispatch_requests,
  public.dispatch_candidates,
  public.tracking_sessions,
  public.tracking_points,
  public.notification_templates,
  public.notification_messages,
  public.ai_task_definitions,
  public.ai_task_runs,
  public.map_service_requests
to authenticated;

grant select on public.wallet_balances to authenticated;

grant select, insert, update, delete on
  public.currency_definitions,
  public.pricing_policies,
  public.settlement_policies,
  public.wallet_accounts,
  public.financial_transactions,
  public.wallet_ledger_entries,
  public.escrow_holds,
  public.workflow_instances,
  public.event_handlers,
  public.verification_definitions,
  public.verification_events,
  public.dispatch_policies,
  public.dispatch_requests,
  public.dispatch_candidates,
  public.tracking_sessions,
  public.tracking_points,
  public.notification_templates,
  public.notification_messages,
  public.ai_task_definitions,
  public.ai_task_runs,
  public.map_service_requests
to service_role;

grant select on public.wallet_balances to service_role;

commit;
