begin;

create extension if not exists pgcrypto;
create extension if not exists citext;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.is_authenticated()
returns boolean
language sql
stable
as $$
  select auth.uid() is not null;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  status text not null default 'active'
    check (status in ('active', 'disabled', 'pending')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug citext not null unique
    check (slug::text ~ '^[a-z][a-z0-9-]{2,62}[a-z0-9]$' and slug::text !~ '--'),
  legal_name text,
  display_name text not null,
  status text not null default 'active'
    check (status in ('pending', 'active', 'suspended', 'archived')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  membership_type text not null default 'member'
    check (membership_type in ('owner', 'admin', 'member', 'viewer')),
  status text not null default 'active'
    check (status in ('invited', 'active', 'suspended', 'removed')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, user_id)
);

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  description text not null,
  risk_level text not null default 'standard'
    check (risk_level in ('low', 'standard', 'high', 'critical')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  key text not null
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  description text,
  status text not null default 'active'
    check (status in ('draft', 'active', 'suspended', 'archived')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists roles_scope_key_unique
on public.roles (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

create table if not exists public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  conditions jsonb not null default '{}'::jsonb
    check (jsonb_typeof(conditions) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (role_id, permission_id)
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'expired')),
  starts_at timestamptz not null default timezone('utc', now()),
  ends_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, user_id, role_id)
);

create unique index if not exists user_roles_global_unique
on public.user_roles (user_id, role_id)
where organization_id is null;

create table if not exists public.capability_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  category text not null default 'general'
    check (category ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  description text,
  schema jsonb not null default '{}'::jsonb
    check (jsonb_typeof(schema) = 'object'),
  status text not null default 'active'
    check (status in ('draft', 'active', 'retired')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.entity_capabilities (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null
    check (entity_type in ('user', 'organization', 'partner', 'driver', 'vehicle', 'asset')),
  entity_id uuid not null,
  capability_key text not null references public.capability_definitions(key),
  constraints jsonb not null default '{}'::jsonb
    check (jsonb_typeof(constraints) = 'object'),
  status text not null default 'active'
    check (status in ('pending', 'active', 'suspended', 'retired')),
  verified_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (entity_type, entity_id, capability_key)
);

create table if not exists public.partner_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  partner_type_key text not null
    check (partner_type_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'suspended', 'archived')),
  behavior_config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(behavior_config) = 'object'),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id)
);

create table if not exists public.driver_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  operational_status text not null default 'offline'
    check (operational_status in ('offline', 'available', 'busy', 'paused')),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'pending', 'approved', 'rejected', 'suspended')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id)
);

create table if not exists public.vehicle_types (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  capability_schema jsonb not null default '{}'::jsonb
    check (jsonb_typeof(capability_schema) = 'object'),
  status text not null default 'active'
    check (status in ('draft', 'active', 'retired')),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  owner_user_id uuid references public.profiles(id) on delete set null,
  vehicle_type_id uuid references public.vehicle_types(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'maintenance', 'suspended', 'archived')),
  capacity_profile jsonb not null default '{}'::jsonb
    check (jsonb_typeof(capacity_profile) = 'object'),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  owner_user_id uuid references public.profiles(id) on delete set null,
  asset_type_key text not null
    check (asset_type_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  status text not null default 'active'
    check (status in ('pending', 'active', 'inactive', 'suspended', 'archived')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  owner_user_id uuid references public.profiles(id) on delete set null,
  storage_bucket text not null,
  storage_path text not null,
  content_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  checksum text,
  status text not null default 'active'
    check (status in ('pending', 'active', 'quarantined', 'deleted')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (storage_bucket, storage_path)
);

create table if not exists public.configuration_entries (
  id uuid primary key default gen_random_uuid(),
  namespace text not null
    check (namespace ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  key text not null
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  scope_type text not null default 'global'
    check (scope_type in ('global', 'organization', 'user', 'module', 'provider')),
  scope_id uuid,
  value jsonb not null,
  is_secret boolean not null default false,
  status text not null default 'active'
    check (status in ('draft', 'active', 'retired')),
  version integer not null default 1 check (version > 0),
  effective_from timestamptz,
  effective_until timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (scope_type = 'global' or scope_id is not null),
  check (effective_until is null or effective_from is null or effective_until > effective_from)
);

create unique index if not exists configuration_entries_version_unique
on public.configuration_entries (
  namespace,
  key,
  scope_type,
  coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid),
  version
);

create table if not exists public.provider_adapters (
  id uuid primary key default gen_random_uuid(),
  provider_kind text not null
    check (provider_kind in ('payment', 'storage', 'maps', 'notification', 'ai', 'queue', 'cache', 'observability')),
  key text not null
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  status text not null default 'inactive'
    check (status in ('inactive', 'active', 'degraded', 'disabled')),
  config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object'),
  secret_ref text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (provider_kind, key)
);

create table if not exists public.workflow_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  description text,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'retired')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.workflow_versions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflow_definitions(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'retired')),
  definition jsonb not null default '{}'::jsonb
    check (jsonb_typeof(definition) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  activated_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workflow_id, version)
);

create table if not exists public.workflow_states (
  id uuid primary key default gen_random_uuid(),
  workflow_version_id uuid not null references public.workflow_versions(id) on delete cascade,
  key text not null
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  state_type text not null default 'normal'
    check (state_type in ('initial', 'normal', 'terminal', 'failure')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workflow_version_id, key)
);

create table if not exists public.workflow_transitions (
  id uuid primary key default gen_random_uuid(),
  workflow_version_id uuid not null references public.workflow_versions(id) on delete cascade,
  from_state_key text not null,
  to_state_key text not null,
  event_type_key text not null
    check (event_type_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  guard_policy_key text
    check (guard_policy_key is null or guard_policy_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  action_policy_keys text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workflow_version_id, from_state_key, event_type_key),
  foreign key (workflow_version_id, from_state_key)
    references public.workflow_states(workflow_version_id, key) on delete cascade,
  foreign key (workflow_version_id, to_state_key)
    references public.workflow_states(workflow_version_id, key) on delete cascade
);

create table if not exists public.event_types (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  description text,
  schema jsonb not null default '{}'::jsonb
    check (jsonb_typeof(schema) = 'object'),
  status text not null default 'active'
    check (status in ('draft', 'active', 'retired')),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.event_log (
  id uuid primary key default gen_random_uuid(),
  event_type_key text not null references public.event_types(key),
  source text not null
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  subject_type text not null
    check (subject_type ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  subject_id uuid not null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  idempotency_key text,
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  status text not null default 'received'
    check (status in ('received', 'validated', 'processing', 'processed', 'failed', 'ignored')),
  occurred_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists event_log_source_idempotency_unique
on public.event_log (source, idempotency_key)
where idempotency_key is not null;

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.application_logs (
  id uuid primary key default gen_random_uuid(),
  severity text not null
    check (severity in ('debug', 'info', 'notice', 'warning', 'error', 'critical')),
  source text not null
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  message text not null,
  context jsonb not null default '{}'::jsonb
    check (jsonb_typeof(context) = 'object'),
  request_id text,
  actor_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.error_reports (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null,
  severity text not null
    check (severity in ('warning', 'error', 'critical')),
  status text not null default 'open'
    check (status in ('open', 'acknowledged', 'resolved', 'ignored')),
  source text not null
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  message text not null,
  stack_trace text,
  context jsonb not null default '{}'::jsonb
    check (jsonb_typeof(context) = 'object'),
  first_seen_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now()),
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (fingerprint)
);

create table if not exists public.job_queues (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  status text not null default 'active'
    check (status in ('active', 'paused', 'retired')),
  concurrency_limit integer not null default 1 check (concurrency_limit > 0),
  retry_policy jsonb not null default '{}'::jsonb
    check (jsonb_typeof(retry_policy) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null references public.job_queues(id) on delete restrict,
  job_type_key text not null
    check (job_type_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  run_at timestamptz not null default timezone('utc', now()),
  locked_until timestamptz,
  locked_by text,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  url text not null check (url ~ '^https://'),
  event_type_keys text[] not null default '{}',
  signing_secret_ref text not null,
  status text not null default 'active'
    check (status in ('active', 'paused', 'disabled')),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references public.webhook_endpoints(id) on delete cascade,
  event_id uuid not null references public.event_log(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'delivered', 'failed', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  response_status integer,
  response_body text,
  next_attempt_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (endpoint_id, event_id)
);

create table if not exists public.api_clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  scopes text[] not null default '{}',
  status text not null default 'active'
    check (status in ('active', 'suspended', 'revoked')),
  last_used_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.rate_limit_policies (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  scope_type text not null
    check (scope_type in ('global', 'organization', 'user', 'api-client', 'ip')),
  limit_count integer not null check (limit_count > 0),
  window_seconds integer not null check (window_seconds > 0),
  status text not null default 'active'
    check (status in ('active', 'disabled', 'retired')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.rate_limit_counters (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.rate_limit_policies(id) on delete cascade,
  subject_key text not null,
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (policy_id, subject_key, window_start)
);

create table if not exists public.cache_entries (
  id uuid primary key default gen_random_uuid(),
  namespace text not null
    check (namespace ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  key text not null,
  value jsonb not null,
  tags text[] not null default '{}',
  expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (namespace, key)
);

create table if not exists public.health_checks (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  status text not null default 'unknown'
    check (status in ('healthy', 'degraded', 'unhealthy', 'unknown')),
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  checked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists organization_memberships_user_idx
on public.organization_memberships (user_id, status);

create index if not exists roles_organization_idx
on public.roles (organization_id, status);

create index if not exists user_roles_user_idx
on public.user_roles (user_id, status);

create index if not exists user_roles_organization_idx
on public.user_roles (organization_id, status);

create index if not exists entity_capabilities_lookup_idx
on public.entity_capabilities (entity_type, entity_id, status);

create index if not exists driver_profiles_user_idx
on public.driver_profiles (user_id, verification_status, operational_status);

create index if not exists vehicles_owner_idx
on public.vehicles (owner_user_id, status);

create index if not exists configuration_entries_lookup_idx
on public.configuration_entries (namespace, key, scope_type, status);

create index if not exists event_log_subject_idx
on public.event_log (subject_type, subject_id, occurred_at desc);

create index if not exists event_log_status_idx
on public.event_log (status, occurred_at desc);

create index if not exists audit_logs_entity_idx
on public.audit_logs (entity_type, entity_id, created_at desc);

create index if not exists application_logs_source_idx
on public.application_logs (source, created_at desc);

create index if not exists error_reports_status_idx
on public.error_reports (status, severity, last_seen_at desc);

create index if not exists background_jobs_queue_status_idx
on public.background_jobs (queue_id, status, run_at);

create index if not exists webhook_deliveries_status_idx
on public.webhook_deliveries (status, next_attempt_at);

create index if not exists cache_entries_expiry_idx
on public.cache_entries (expires_at);

create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
  );
$$;

create or replace function public.is_organization_creator(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organizations organization_record
    where organization_record.id = target_organization_id
      and organization_record.created_by = auth.uid()
  );
$$;

create or replace function public.has_permission(
  target_permission text,
  target_organization_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles assigned_role
    join public.roles role_record on role_record.id = assigned_role.role_id
    join public.role_permissions role_permission on role_permission.role_id = role_record.id
    join public.permissions permission_record on permission_record.id = role_permission.permission_id
    where assigned_role.user_id = auth.uid()
      and assigned_role.status = 'active'
      and role_record.status = 'active'
      and permission_record.key = target_permission
      and (assigned_role.ends_at is null or assigned_role.ends_at > timezone('utc', now()))
      and (
        target_organization_id is null
        or assigned_role.organization_id is null
        or assigned_role.organization_id = target_organization_id
      )
      and (
        role_record.organization_id is null
        or target_organization_id is null
        or role_record.organization_id = target_organization_id
      )
  );
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url, metadata)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.email),
    new.raw_user_meta_data ->> 'avatar_url',
    jsonb_build_object('auth_provider', new.raw_app_meta_data ->> 'provider')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.prevent_profile_privilege_escalation()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() = new.id and not public.has_permission('platform.users.manage', null) then
    if new.id is distinct from old.id
      or new.status is distinct from old.status
      or new.created_at is distinct from old.created_at then
      raise exception 'profile privilege fields cannot be changed by the profile owner';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.prevent_driver_verification_escalation()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() = new.user_id and not public.has_permission('platform.drivers.verify', new.organization_id) then
    if new.verification_status is distinct from old.verification_status then
      raise exception 'driver verification cannot be self-assigned';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit logs are append-only';
end;
$$;

create or replace function public.record_table_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
begin
  if tg_op = 'DELETE' then
    target_id := old.id;
  else
    target_id := new.id;
  end if;

  insert into public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before_state,
    after_state
  )
  values (
    auth.uid(),
    tg_op,
    tg_table_name,
    target_id,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create or replace function public.bootstrap_platform_admin(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_role_id uuid;
begin
  insert into public.roles (key, display_name, description, status)
  values ('platform.admin', 'Platform Admin', 'Global platform administration role.', 'active')
  on conflict do nothing;

  select id into admin_role_id
  from public.roles
  where key = 'platform.admin'
    and organization_id is null;

  insert into public.role_permissions (role_id, permission_id)
  select admin_role_id, permission_record.id
  from public.permissions permission_record
  on conflict do nothing;

  insert into public.user_roles (organization_id, user_id, role_id, status)
  values (null, target_user_id, admin_role_id, 'active')
  on conflict do nothing;
end;
$$;

revoke all on function public.bootstrap_platform_admin(uuid) from public;
revoke all on function public.bootstrap_platform_admin(uuid) from anon;
revoke all on function public.bootstrap_platform_admin(uuid) from authenticated;
grant execute on function public.bootstrap_platform_admin(uuid) to service_role;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'profiles',
    'organizations',
    'organization_memberships',
    'permissions',
    'roles',
    'user_roles',
    'capability_definitions',
    'entity_capabilities',
    'partner_profiles',
    'driver_profiles',
    'vehicle_types',
    'vehicles',
    'assets',
    'media_assets',
    'configuration_entries',
    'provider_adapters',
    'workflow_definitions',
    'workflow_versions',
    'workflow_states',
    'workflow_transitions',
    'event_types',
    'error_reports',
    'job_queues',
    'background_jobs',
    'webhook_endpoints',
    'webhook_deliveries',
    'api_clients',
    'rate_limit_policies',
    'rate_limit_counters',
    'cache_entries',
    'health_checks'
  ] loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I', target_table, target_table);
    execute format(
      'create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      target_table,
      target_table
    );
  end loop;
end $$;

drop trigger if exists prevent_profile_privilege_escalation on public.profiles;
create trigger prevent_profile_privilege_escalation
before update on public.profiles
for each row execute function public.prevent_profile_privilege_escalation();

drop trigger if exists prevent_driver_verification_escalation on public.driver_profiles;
create trigger prevent_driver_verification_escalation
before update on public.driver_profiles
for each row execute function public.prevent_driver_verification_escalation();

drop trigger if exists prevent_audit_log_update on public.audit_logs;
create trigger prevent_audit_log_update
before update on public.audit_logs
for each row execute function public.prevent_audit_log_mutation();

drop trigger if exists prevent_audit_log_delete on public.audit_logs;
create trigger prevent_audit_log_delete
before delete on public.audit_logs
for each row execute function public.prevent_audit_log_mutation();

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'profiles',
    'organizations',
    'organization_memberships',
    'roles',
    'role_permissions',
    'user_roles',
    'capability_definitions',
    'entity_capabilities',
    'partner_profiles',
    'driver_profiles',
    'vehicle_types',
    'vehicles',
    'assets',
    'media_assets',
    'configuration_entries',
    'provider_adapters',
    'workflow_definitions',
    'workflow_versions',
    'workflow_states',
    'workflow_transitions',
    'event_types',
    'job_queues',
    'background_jobs',
    'webhook_endpoints',
    'api_clients',
    'rate_limit_policies',
    'health_checks'
  ] loop
    execute format('drop trigger if exists audit_%I_mutations on public.%I', target_table, target_table);
    execute format(
      'create trigger audit_%I_mutations after insert or update or delete on public.%I for each row execute function public.record_table_audit()',
      target_table,
      target_table
    );
  end loop;
end $$;

insert into public.permissions (key, description, risk_level)
values
  ('platform.admin', 'Full platform administration.', 'critical'),
  ('platform.users.read', 'Read platform user profiles.', 'standard'),
  ('platform.users.manage', 'Manage platform user profiles.', 'critical'),
  ('platform.organizations.read', 'Read organization records.', 'standard'),
  ('platform.organizations.manage', 'Manage organization records and memberships.', 'high'),
  ('platform.roles.read', 'Read role and permission assignments.', 'standard'),
  ('platform.roles.manage', 'Manage roles and permissions.', 'critical'),
  ('platform.drivers.read', 'Read driver profiles.', 'standard'),
  ('platform.drivers.manage', 'Manage driver profiles.', 'high'),
  ('platform.drivers.verify', 'Approve or reject driver verification.', 'critical'),
  ('platform.vehicles.manage', 'Manage vehicle records.', 'high'),
  ('platform.assets.manage', 'Manage asset and media records.', 'high'),
  ('platform.configuration.read', 'Read platform configuration.', 'standard'),
  ('platform.configuration.manage', 'Manage platform configuration.', 'critical'),
  ('platform.providers.manage', 'Manage provider adapters.', 'critical'),
  ('platform.workflows.manage', 'Manage workflow definitions.', 'critical'),
  ('platform.events.read', 'Read platform events.', 'standard'),
  ('platform.events.manage', 'Manage event definitions.', 'critical'),
  ('platform.audit.read', 'Read append-only audit logs.', 'critical'),
  ('platform.logs.read', 'Read logs and error reports.', 'high'),
  ('platform.jobs.manage', 'Manage job queues and background jobs.', 'high'),
  ('platform.webhooks.manage', 'Manage webhook endpoints and deliveries.', 'high'),
  ('platform.api_clients.manage', 'Manage API clients.', 'critical'),
  ('platform.rate_limits.manage', 'Manage rate limit policies.', 'high'),
  ('platform.cache.manage', 'Manage platform cache records.', 'high'),
  ('platform.health.read', 'Read health monitoring records.', 'standard'),
  ('platform.health.manage', 'Manage health monitoring records.', 'high')
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    updated_at = timezone('utc', now());

insert into public.roles (key, display_name, description, status)
values ('platform.admin', 'Platform Admin', 'Global platform administration role.', 'active')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select role_record.id, permission_record.id
from public.roles role_record
cross join public.permissions permission_record
where role_record.key = 'platform.admin'
  and role_record.organization_id is null
on conflict do nothing;

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
  ('platform.currency', 'primary', 'global', null, '{"code":"NGN","enabled":true}'::jsonb, 'active', 1),
  ('platform.security', 'rls_required', 'global', null, '{"enabled":true}'::jsonb, 'active', 1)
on conflict do nothing;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.permissions enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.capability_definitions enable row level security;
alter table public.entity_capabilities enable row level security;
alter table public.partner_profiles enable row level security;
alter table public.driver_profiles enable row level security;
alter table public.vehicle_types enable row level security;
alter table public.vehicles enable row level security;
alter table public.assets enable row level security;
alter table public.media_assets enable row level security;
alter table public.configuration_entries enable row level security;
alter table public.provider_adapters enable row level security;
alter table public.workflow_definitions enable row level security;
alter table public.workflow_versions enable row level security;
alter table public.workflow_states enable row level security;
alter table public.workflow_transitions enable row level security;
alter table public.event_types enable row level security;
alter table public.event_log enable row level security;
alter table public.audit_logs enable row level security;
alter table public.application_logs enable row level security;
alter table public.error_reports enable row level security;
alter table public.job_queues enable row level security;
alter table public.background_jobs enable row level security;
alter table public.webhook_endpoints enable row level security;
alter table public.webhook_deliveries enable row level security;
alter table public.api_clients enable row level security;
alter table public.rate_limit_policies enable row level security;
alter table public.rate_limit_counters enable row level security;
alter table public.cache_entries enable row level security;
alter table public.health_checks enable row level security;

create policy profiles_select_self_or_privileged on public.profiles
for select to authenticated
using (id = auth.uid() or public.has_permission('platform.users.read', null));

create policy profiles_insert_self on public.profiles
for insert to authenticated
with check (id = auth.uid());

create policy profiles_update_self_or_privileged on public.profiles
for update to authenticated
using (id = auth.uid() or public.has_permission('platform.users.manage', null))
with check (id = auth.uid() or public.has_permission('platform.users.manage', null));

create policy organizations_select_member_or_privileged on public.organizations
for select to authenticated
using (
  created_by = auth.uid()
  or public.is_organization_member(id)
  or public.has_permission('platform.organizations.read', id)
);

create policy organizations_insert_authenticated on public.organizations
for insert to authenticated
with check (created_by = auth.uid());

create policy organizations_update_creator_or_privileged on public.organizations
for update to authenticated
using (created_by = auth.uid() or public.has_permission('platform.organizations.manage', id))
with check (created_by = auth.uid() or public.has_permission('platform.organizations.manage', id));

create policy organization_memberships_select_self_or_privileged on public.organization_memberships
for select to authenticated
using (
  user_id = auth.uid()
  or public.is_organization_creator(organization_id)
  or public.has_permission('platform.organizations.read', organization_id)
  or public.has_permission('platform.organizations.manage', organization_id)
);

create policy organization_memberships_manage_privileged on public.organization_memberships
for all to authenticated
using (
  public.is_organization_creator(organization_id)
  or public.has_permission('platform.organizations.manage', organization_id)
)
with check (
  public.is_organization_creator(organization_id)
  or public.has_permission('platform.organizations.manage', organization_id)
);

create policy permissions_select_authenticated on public.permissions
for select to authenticated
using (true);

create policy permissions_manage_privileged on public.permissions
for all to authenticated
using (public.has_permission('platform.roles.manage', null))
with check (public.has_permission('platform.roles.manage', null));

create policy roles_select_member_or_privileged on public.roles
for select to authenticated
using (
  organization_id is null
  or public.is_organization_member(organization_id)
  or public.has_permission('platform.roles.read', organization_id)
);

create policy roles_manage_privileged on public.roles
for all to authenticated
using (
  public.has_permission('platform.roles.manage', organization_id)
  or (organization_id is not null and public.is_organization_creator(organization_id))
)
with check (
  public.has_permission('platform.roles.manage', organization_id)
  or (organization_id is not null and public.is_organization_creator(organization_id))
);

create policy role_permissions_select_authenticated on public.role_permissions
for select to authenticated
using (true);

create policy role_permissions_manage_privileged on public.role_permissions
for all to authenticated
using (public.has_permission('platform.roles.manage', null))
with check (public.has_permission('platform.roles.manage', null));

create policy user_roles_select_self_or_privileged on public.user_roles
for select to authenticated
using (
  user_id = auth.uid()
  or public.has_permission('platform.roles.read', organization_id)
  or public.has_permission('platform.roles.manage', organization_id)
);

create policy user_roles_manage_privileged on public.user_roles
for all to authenticated
using (
  public.has_permission('platform.roles.manage', organization_id)
  or (organization_id is not null and public.is_organization_creator(organization_id))
)
with check (
  public.has_permission('platform.roles.manage', organization_id)
  or (organization_id is not null and public.is_organization_creator(organization_id))
);

create policy capability_definitions_select_authenticated on public.capability_definitions
for select to authenticated
using (true);

create policy capability_definitions_manage_privileged on public.capability_definitions
for all to authenticated
using (public.has_permission('platform.configuration.manage', null))
with check (public.has_permission('platform.configuration.manage', null));

create policy entity_capabilities_select_authenticated on public.entity_capabilities
for select to authenticated
using (true);

create policy entity_capabilities_manage_privileged on public.entity_capabilities
for all to authenticated
using (public.has_permission('platform.configuration.manage', null))
with check (public.has_permission('platform.configuration.manage', null));

create policy partner_profiles_select_member_or_privileged on public.partner_profiles
for select to authenticated
using (
  public.is_organization_member(organization_id)
  or public.has_permission('platform.organizations.read', organization_id)
);

create policy partner_profiles_manage_privileged on public.partner_profiles
for all to authenticated
using (
  public.is_organization_creator(organization_id)
  or public.has_permission('platform.organizations.manage', organization_id)
)
with check (
  public.is_organization_creator(organization_id)
  or public.has_permission('platform.organizations.manage', organization_id)
);

create policy driver_profiles_select_self_member_or_privileged on public.driver_profiles
for select to authenticated
using (
  user_id = auth.uid()
  or (organization_id is not null and public.is_organization_member(organization_id))
  or public.has_permission('platform.drivers.read', organization_id)
);

create policy driver_profiles_insert_self on public.driver_profiles
for insert to authenticated
with check (user_id = auth.uid());

create policy driver_profiles_update_self_or_privileged on public.driver_profiles
for update to authenticated
using (user_id = auth.uid() or public.has_permission('platform.drivers.manage', organization_id))
with check (user_id = auth.uid() or public.has_permission('platform.drivers.manage', organization_id));

create policy vehicle_types_select_authenticated on public.vehicle_types
for select to authenticated
using (true);

create policy vehicle_types_manage_privileged on public.vehicle_types
for all to authenticated
using (public.has_permission('platform.vehicles.manage', null))
with check (public.has_permission('platform.vehicles.manage', null));

create policy vehicles_select_owner_member_or_privileged on public.vehicles
for select to authenticated
using (
  owner_user_id = auth.uid()
  or (organization_id is not null and public.is_organization_member(organization_id))
  or public.has_permission('platform.vehicles.manage', organization_id)
);

create policy vehicles_manage_owner_or_privileged on public.vehicles
for all to authenticated
using (owner_user_id = auth.uid() or public.has_permission('platform.vehicles.manage', organization_id))
with check (owner_user_id = auth.uid() or public.has_permission('platform.vehicles.manage', organization_id));

create policy assets_select_owner_member_or_privileged on public.assets
for select to authenticated
using (
  owner_user_id = auth.uid()
  or (organization_id is not null and public.is_organization_member(organization_id))
  or public.has_permission('platform.assets.manage', organization_id)
);

create policy assets_manage_owner_or_privileged on public.assets
for all to authenticated
using (owner_user_id = auth.uid() or public.has_permission('platform.assets.manage', organization_id))
with check (owner_user_id = auth.uid() or public.has_permission('platform.assets.manage', organization_id));

create policy media_assets_select_owner_member_or_privileged on public.media_assets
for select to authenticated
using (
  owner_user_id = auth.uid()
  or (organization_id is not null and public.is_organization_member(organization_id))
  or public.has_permission('platform.assets.manage', organization_id)
);

create policy media_assets_manage_owner_or_privileged on public.media_assets
for all to authenticated
using (owner_user_id = auth.uid() or public.has_permission('platform.assets.manage', organization_id))
with check (owner_user_id = auth.uid() or public.has_permission('platform.assets.manage', organization_id));

create policy configuration_entries_select_visible on public.configuration_entries
for select to authenticated
using (
  is_secret = false
  and (
    scope_type = 'global'
    or (scope_type = 'user' and scope_id = auth.uid())
    or (scope_type = 'organization' and public.is_organization_member(scope_id))
    or public.has_permission('platform.configuration.read', null)
  )
);

create policy configuration_entries_manage_privileged on public.configuration_entries
for all to authenticated
using (public.has_permission('platform.configuration.manage', null))
with check (public.has_permission('platform.configuration.manage', null));

create policy provider_adapters_select_privileged on public.provider_adapters
for select to authenticated
using (public.has_permission('platform.configuration.read', null));

create policy provider_adapters_manage_privileged on public.provider_adapters
for all to authenticated
using (public.has_permission('platform.providers.manage', null))
with check (public.has_permission('platform.providers.manage', null));

create policy workflow_definitions_select_authenticated on public.workflow_definitions
for select to authenticated
using (true);

create policy workflow_definitions_manage_privileged on public.workflow_definitions
for all to authenticated
using (public.has_permission('platform.workflows.manage', null))
with check (public.has_permission('platform.workflows.manage', null));

create policy workflow_versions_select_authenticated on public.workflow_versions
for select to authenticated
using (true);

create policy workflow_versions_manage_privileged on public.workflow_versions
for all to authenticated
using (public.has_permission('platform.workflows.manage', null))
with check (public.has_permission('platform.workflows.manage', null));

create policy workflow_states_select_authenticated on public.workflow_states
for select to authenticated
using (true);

create policy workflow_states_manage_privileged on public.workflow_states
for all to authenticated
using (public.has_permission('platform.workflows.manage', null))
with check (public.has_permission('platform.workflows.manage', null));

create policy workflow_transitions_select_authenticated on public.workflow_transitions
for select to authenticated
using (true);

create policy workflow_transitions_manage_privileged on public.workflow_transitions
for all to authenticated
using (public.has_permission('platform.workflows.manage', null))
with check (public.has_permission('platform.workflows.manage', null));

create policy event_types_select_authenticated on public.event_types
for select to authenticated
using (true);

create policy event_types_manage_privileged on public.event_types
for all to authenticated
using (public.has_permission('platform.events.manage', null))
with check (public.has_permission('platform.events.manage', null));

create policy event_log_select_actor_or_privileged on public.event_log
for select to authenticated
using (
  actor_user_id = auth.uid()
  or public.has_permission('platform.events.read', null)
);

create policy event_log_insert_actor on public.event_log
for insert to authenticated
with check (actor_user_id = auth.uid());

create policy audit_logs_select_privileged on public.audit_logs
for select to authenticated
using (public.has_permission('platform.audit.read', null));

create policy audit_logs_no_direct_insert on public.audit_logs
for insert to authenticated
with check (false);

create policy application_logs_select_privileged on public.application_logs
for select to authenticated
using (public.has_permission('platform.logs.read', null));

create policy application_logs_no_direct_insert on public.application_logs
for insert to authenticated
with check (false);

create policy error_reports_select_privileged on public.error_reports
for select to authenticated
using (public.has_permission('platform.logs.read', null));

create policy error_reports_manage_privileged on public.error_reports
for all to authenticated
using (public.has_permission('platform.logs.read', null))
with check (public.has_permission('platform.logs.read', null));

create policy job_queues_select_privileged on public.job_queues
for select to authenticated
using (public.has_permission('platform.jobs.manage', null));

create policy job_queues_manage_privileged on public.job_queues
for all to authenticated
using (public.has_permission('platform.jobs.manage', null))
with check (public.has_permission('platform.jobs.manage', null));

create policy background_jobs_select_privileged on public.background_jobs
for select to authenticated
using (public.has_permission('platform.jobs.manage', null));

create policy background_jobs_manage_privileged on public.background_jobs
for all to authenticated
using (public.has_permission('platform.jobs.manage', null))
with check (public.has_permission('platform.jobs.manage', null));

create policy webhook_endpoints_select_member_or_privileged on public.webhook_endpoints
for select to authenticated
using (
  organization_id is null
  or public.is_organization_member(organization_id)
  or public.has_permission('platform.webhooks.manage', organization_id)
);

create policy webhook_endpoints_manage_privileged on public.webhook_endpoints
for all to authenticated
using (
  public.has_permission('platform.webhooks.manage', organization_id)
  or (organization_id is not null and public.is_organization_creator(organization_id))
)
with check (
  public.has_permission('platform.webhooks.manage', organization_id)
  or (organization_id is not null and public.is_organization_creator(organization_id))
);

create policy webhook_deliveries_select_privileged on public.webhook_deliveries
for select to authenticated
using (public.has_permission('platform.webhooks.manage', null));

create policy webhook_deliveries_manage_privileged on public.webhook_deliveries
for all to authenticated
using (public.has_permission('platform.webhooks.manage', null))
with check (public.has_permission('platform.webhooks.manage', null));

create policy api_clients_select_member_or_privileged on public.api_clients
for select to authenticated
using (
  organization_id is null
  or public.is_organization_member(organization_id)
  or public.has_permission('platform.api_clients.manage', organization_id)
);

create policy api_clients_manage_privileged on public.api_clients
for all to authenticated
using (
  public.has_permission('platform.api_clients.manage', organization_id)
  or (organization_id is not null and public.is_organization_creator(organization_id))
)
with check (
  public.has_permission('platform.api_clients.manage', organization_id)
  or (organization_id is not null and public.is_organization_creator(organization_id))
);

create policy rate_limit_policies_select_privileged on public.rate_limit_policies
for select to authenticated
using (public.has_permission('platform.rate_limits.manage', null));

create policy rate_limit_policies_manage_privileged on public.rate_limit_policies
for all to authenticated
using (public.has_permission('platform.rate_limits.manage', null))
with check (public.has_permission('platform.rate_limits.manage', null));

create policy rate_limit_counters_select_privileged on public.rate_limit_counters
for select to authenticated
using (public.has_permission('platform.rate_limits.manage', null));

create policy rate_limit_counters_manage_privileged on public.rate_limit_counters
for all to authenticated
using (public.has_permission('platform.rate_limits.manage', null))
with check (public.has_permission('platform.rate_limits.manage', null));

create policy cache_entries_select_privileged on public.cache_entries
for select to authenticated
using (public.has_permission('platform.cache.manage', null));

create policy cache_entries_manage_privileged on public.cache_entries
for all to authenticated
using (public.has_permission('platform.cache.manage', null))
with check (public.has_permission('platform.cache.manage', null));

create policy health_checks_select_privileged on public.health_checks
for select to authenticated
using (public.has_permission('platform.health.read', null));

create policy health_checks_manage_privileged on public.health_checks
for all to authenticated
using (public.has_permission('platform.health.manage', null))
with check (public.has_permission('platform.health.manage', null));

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on
  public.profiles,
  public.organizations,
  public.organization_memberships,
  public.permissions,
  public.roles,
  public.role_permissions,
  public.user_roles,
  public.capability_definitions,
  public.entity_capabilities,
  public.partner_profiles,
  public.driver_profiles,
  public.vehicle_types,
  public.vehicles,
  public.assets,
  public.media_assets,
  public.configuration_entries,
  public.provider_adapters,
  public.workflow_definitions,
  public.workflow_versions,
  public.workflow_states,
  public.workflow_transitions,
  public.event_types,
  public.event_log,
  public.audit_logs,
  public.application_logs,
  public.error_reports,
  public.job_queues,
  public.background_jobs,
  public.webhook_endpoints,
  public.webhook_deliveries,
  public.api_clients,
  public.rate_limit_policies,
  public.rate_limit_counters,
  public.cache_entries,
  public.health_checks
to authenticated;

grant select, insert, update, delete on
  public.profiles,
  public.organizations,
  public.organization_memberships,
  public.permissions,
  public.roles,
  public.role_permissions,
  public.user_roles,
  public.capability_definitions,
  public.entity_capabilities,
  public.partner_profiles,
  public.driver_profiles,
  public.vehicle_types,
  public.vehicles,
  public.assets,
  public.media_assets,
  public.configuration_entries,
  public.provider_adapters,
  public.workflow_definitions,
  public.workflow_versions,
  public.workflow_states,
  public.workflow_transitions,
  public.event_types,
  public.event_log,
  public.audit_logs,
  public.application_logs,
  public.error_reports,
  public.job_queues,
  public.background_jobs,
  public.webhook_endpoints,
  public.webhook_deliveries,
  public.api_clients,
  public.rate_limit_policies,
  public.rate_limit_counters,
  public.cache_entries,
  public.health_checks
to service_role;

commit;
