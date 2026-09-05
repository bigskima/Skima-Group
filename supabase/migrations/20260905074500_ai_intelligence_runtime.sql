begin;

-- SKIMA Intelligence runtime
-- AI is assistive only. Provider/model selection is data-driven and can change without a client deploy.

create table if not exists public.ai_capabilities (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  description text,
  category text not null
    check (category in ('assistant','image','analysis','risk','forecast','support','custom')),
  response_mode text not null default 'text'
    check (response_mode in ('text','json','image')),
  control_mode text not null default 'assist_only'
    check (control_mode in ('assist_only','read_only')),
  status text not null default 'active'
    check (status in ('draft','active','paused','retired')),
  config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ai_provider_routes (
  id uuid primary key default gen_random_uuid(),
  capability_id uuid not null references public.ai_capabilities(id) on delete cascade,
  provider_adapter_id uuid not null references public.provider_adapters(id) on delete restrict,
  model_key text not null check (char_length(btrim(model_key)) between 1 and 180),
  priority integer not null default 100 check (priority between 1 and 10000),
  status text not null default 'active'
    check (status in ('active','paused','retired')),
  effective_from timestamptz,
  effective_until timestamptz,
  config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object'),
  version integer not null default 1 check (version > 0),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (capability_id, provider_adapter_id, model_key),
  check (effective_until is null or effective_from is null or effective_until > effective_from)
);

create index if not exists ai_provider_routes_resolution_idx
on public.ai_provider_routes (capability_id, status, priority, effective_from, effective_until);

create table if not exists public.ai_provider_route_events (
  id uuid primary key default gen_random_uuid(),
  capability_id uuid not null references public.ai_capabilities(id) on delete cascade,
  provider_route_id uuid references public.ai_provider_routes(id) on delete set null,
  event_type text not null
    check (event_type in ('configured','activated','paused','retired','provider_updated')),
  previous_state jsonb not null default '{}'::jsonb,
  new_state jsonb not null default '{}'::jsonb,
  reason text,
  actor_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  idempotency_key text not null unique,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  workspace text not null
    check (workspace in ('customer','driver','station','admin')),
  capability_key text not null
    check (capability_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  title text,
  status text not null default 'active'
    check (status in ('active','archived')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  last_message_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_conversations_owner_recent_idx
on public.ai_conversations (owner_user_id, updated_at desc);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system','tool')),
  content text not null check (char_length(content) between 1 and 16000),
  provider_adapter_key text,
  model_key text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_messages_conversation_created_idx
on public.ai_messages (conversation_id, created_at asc);

create table if not exists public.ai_tool_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  description text,
  operation_kind text not null default 'query'
    check (operation_kind in ('query','action')),
  handler_key text not null
    check (handler_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  allowed_workspaces text[] not null default '{}'::text[],
  requires_confirmation boolean not null default false,
  status text not null default 'active'
    check (status in ('draft','active','retired')),
  config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ai_tool_executions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.ai_conversations(id) on delete set null,
  tool_definition_id uuid not null references public.ai_tool_definitions(id) on delete restrict,
  requested_by uuid references public.profiles(id) on delete set null default auth.uid(),
  status text not null default 'started'
    check (status in ('started','completed','failed','denied')),
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  check (jsonb_typeof(input) = 'object'),
  check (jsonb_typeof(output) = 'object'),
  check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  capability_key text not null,
  provider_adapter_key text not null,
  model_key text not null,
  user_id uuid references public.profiles(id) on delete set null,
  workspace text,
  conversation_id uuid references public.ai_conversations(id) on delete set null,
  input_units bigint,
  output_units bigint,
  request_count integer not null default 1 check (request_count > 0),
  status text not null default 'succeeded'
    check (status in ('succeeded','failed','rate_limited')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  check (jsonb_typeof(metadata) = 'object')
);

alter table public.ai_capabilities enable row level security;
alter table public.ai_provider_routes enable row level security;
alter table public.ai_provider_route_events enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_tool_definitions enable row level security;
alter table public.ai_tool_executions enable row level security;
alter table public.ai_usage_events enable row level security;

drop policy if exists ai_capabilities_read_active_or_privileged on public.ai_capabilities;
create policy ai_capabilities_read_active_or_privileged
on public.ai_capabilities for select to authenticated
using (
  status = 'active'
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
  or public.is_platform_super_admin()
);

drop policy if exists ai_capabilities_manage_privileged on public.ai_capabilities;
create policy ai_capabilities_manage_privileged
on public.ai_capabilities for all to authenticated
using (public.has_permission('platform.ai.manage', null) or public.is_platform_super_admin())
with check (public.has_permission('platform.ai.manage', null) or public.is_platform_super_admin());

drop policy if exists ai_provider_routes_read_privileged on public.ai_provider_routes;
create policy ai_provider_routes_read_privileged
on public.ai_provider_routes for select to authenticated
using (
  public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
  or public.is_platform_super_admin()
);

drop policy if exists ai_provider_routes_manage_privileged on public.ai_provider_routes;
create policy ai_provider_routes_manage_privileged
on public.ai_provider_routes for all to authenticated
using (public.has_permission('platform.ai.manage', null) or public.is_platform_super_admin())
with check (public.has_permission('platform.ai.manage', null) or public.is_platform_super_admin());

drop policy if exists ai_provider_route_events_read_privileged on public.ai_provider_route_events;
create policy ai_provider_route_events_read_privileged
on public.ai_provider_route_events for select to authenticated
using (
  public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
  or public.is_platform_super_admin()
);

drop policy if exists ai_conversations_read_own on public.ai_conversations;
create policy ai_conversations_read_own
on public.ai_conversations for select to authenticated
using (
  owner_user_id = (select auth.uid())
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
  or public.is_platform_super_admin()
);

drop policy if exists ai_conversations_insert_own on public.ai_conversations;
create policy ai_conversations_insert_own
on public.ai_conversations for insert to authenticated
with check (owner_user_id = (select auth.uid()));

drop policy if exists ai_conversations_update_own on public.ai_conversations;
create policy ai_conversations_update_own
on public.ai_conversations for update to authenticated
using (owner_user_id = (select auth.uid()))
with check (owner_user_id = (select auth.uid()));

drop policy if exists ai_messages_read_own on public.ai_messages;
create policy ai_messages_read_own
on public.ai_messages for select to authenticated
using (
  exists (
    select 1 from public.ai_conversations conversation
    where conversation.id = ai_messages.conversation_id
      and conversation.owner_user_id = (select auth.uid())
  )
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
  or public.is_platform_super_admin()
);

drop policy if exists ai_messages_insert_user_own on public.ai_messages;
create policy ai_messages_insert_user_own
on public.ai_messages for insert to authenticated
with check (
  role = 'user'
  and exists (
    select 1 from public.ai_conversations conversation
    where conversation.id = ai_messages.conversation_id
      and conversation.owner_user_id = (select auth.uid())
  )
);

drop policy if exists ai_tool_definitions_read_active_or_privileged on public.ai_tool_definitions;
create policy ai_tool_definitions_read_active_or_privileged
on public.ai_tool_definitions for select to authenticated
using (
  status = 'active'
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
  or public.is_platform_super_admin()
);

drop policy if exists ai_tool_definitions_manage_privileged on public.ai_tool_definitions;
create policy ai_tool_definitions_manage_privileged
on public.ai_tool_definitions for all to authenticated
using (public.has_permission('platform.ai.manage', null) or public.is_platform_super_admin())
with check (public.has_permission('platform.ai.manage', null) or public.is_platform_super_admin());

drop policy if exists ai_tool_executions_read_own_or_privileged on public.ai_tool_executions;
create policy ai_tool_executions_read_own_or_privileged
on public.ai_tool_executions for select to authenticated
using (
  requested_by = (select auth.uid())
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
  or public.is_platform_super_admin()
);

drop policy if exists ai_usage_events_read_privileged on public.ai_usage_events;
create policy ai_usage_events_read_privileged
on public.ai_usage_events for select to authenticated
using (
  public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
  or public.is_platform_super_admin()
);

grant select on public.ai_capabilities, public.ai_tool_definitions to authenticated;
grant select, insert, update on public.ai_conversations to authenticated;
grant select, insert on public.ai_messages to authenticated;
grant select on public.ai_provider_routes, public.ai_provider_route_events, public.ai_tool_executions, public.ai_usage_events to authenticated;
grant all on public.ai_capabilities, public.ai_provider_routes, public.ai_provider_route_events,
  public.ai_conversations, public.ai_messages, public.ai_tool_definitions,
  public.ai_tool_executions, public.ai_usage_events to service_role;

create or replace function public.can_access_ai_workspace(target_workspace text)
returns boolean
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  if target_workspace = 'customer' then
    return true;
  end if;

  if target_workspace = 'driver' then
    return exists (
      select 1
      from public.driver_profiles driver
      where driver.user_id = auth.uid()
        and driver.verification_status = 'approved'
    );
  end if;

  if target_workspace = 'station' then
    return exists (
      select 1
      from public.user_roles assignment
      join public.roles role on role.id = assignment.role_id
      join public.lpg_station_branches station
        on station.organization_id = assignment.organization_id
       and (assignment.branch_id is null or station.branch_id = assignment.branch_id)
      where assignment.user_id = auth.uid()
        and assignment.status = 'active'
        and role.status = 'active'
        and role.key like 'lpg.station.%'
        and station.approval_status = 'approved'
        and station.compliance_status <> 'suspended'
    );
  end if;

  if target_workspace = 'admin' then
    return public.is_platform_super_admin()
      or public.has_permission('platform.ai.read', null)
      or public.has_permission('platform.ai.manage', null);
  end if;

  return false;
end;
$$;

revoke all on function public.can_access_ai_workspace(text) from public, anon;
grant execute on function public.can_access_ai_workspace(text) to authenticated, service_role;

create or replace function public.resolve_ai_workspace_capability(target_workspace text)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select capability.key
  from public.ai_capabilities capability
  where capability.key = case target_workspace
    when 'customer' then 'ai.assistant.customer'
    when 'driver' then 'ai.assistant.driver'
    when 'station' then 'ai.assistant.station'
    when 'admin' then 'ai.assistant.admin'
    else null
  end
    and capability.status = 'active'
  limit 1;
$$;

revoke all on function public.resolve_ai_workspace_capability(text) from public, anon;
grant execute on function public.resolve_ai_workspace_capability(text) to authenticated, service_role;

create or replace function public.resolve_ai_provider_route(target_capability_key text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  resolved record;
begin
  select
    capability.key as capability_key,
    capability.response_mode,
    capability.control_mode,
    capability.config as capability_config,
    route.id as route_id,
    route.model_key,
    route.config as route_config,
    provider.id as provider_adapter_id,
    provider.key as provider_adapter_key,
    provider.display_name as provider_display_name,
    provider.config as provider_config,
    provider.secret_ref
  into resolved
  from public.ai_capabilities capability
  join public.ai_provider_routes route on route.capability_id = capability.id
  join public.provider_adapters provider on provider.id = route.provider_adapter_id
  where capability.key = target_capability_key
    and capability.status = 'active'
    and route.status = 'active'
    and provider.provider_kind = 'ai'
    and provider.status in ('active','degraded')
    and (route.effective_from is null or route.effective_from <= timezone('utc', now()))
    and (route.effective_until is null or route.effective_until > timezone('utc', now()))
  order by
    case provider.status when 'active' then 0 else 1 end,
    route.priority asc,
    route.updated_at desc
  limit 1;

  if resolved.route_id is null then
    return null;
  end if;

  return jsonb_build_object(
    'capabilityKey', resolved.capability_key,
    'responseMode', resolved.response_mode,
    'controlMode', resolved.control_mode,
    'capabilityConfig', resolved.capability_config,
    'routeId', resolved.route_id,
    'modelKey', resolved.model_key,
    'routeConfig', resolved.route_config,
    'providerAdapterId', resolved.provider_adapter_id,
    'providerAdapterKey', resolved.provider_adapter_key,
    'providerDisplayName', resolved.provider_display_name,
    'providerConfig', resolved.provider_config,
    'secretRef', resolved.secret_ref
  );
end;
$$;

revoke all on function public.resolve_ai_provider_route(text) from public, anon, authenticated;
grant execute on function public.resolve_ai_provider_route(text) to service_role;

create or replace function public.set_ai_capability_provider(
  target_capability_key text,
  target_provider_adapter_key text,
  target_model_key text,
  target_reason text,
  target_idempotency_key text,
  target_route_config jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  capability_record public.ai_capabilities%rowtype;
  provider_record public.provider_adapters%rowtype;
  route_record public.ai_provider_routes%rowtype;
  previous_state jsonb;
begin
  if not (
    public.is_platform_super_admin()
    or public.has_permission('platform.ai.manage', null)
  ) then
    raise exception 'AI management permission is required';
  end if;

  if target_model_key is null or btrim(target_model_key) = ''
    or target_reason is null or btrim(target_reason) = ''
    or target_idempotency_key is null or btrim(target_idempotency_key) = ''
    or target_route_config is null or jsonb_typeof(target_route_config) <> 'object' then
    raise exception 'provider route configuration is invalid';
  end if;

  select * into capability_record
  from public.ai_capabilities
  where key = target_capability_key
    and status <> 'retired';

  if capability_record.id is null then
    raise exception 'AI capability was not found';
  end if;

  select * into provider_record
  from public.provider_adapters
  where provider_kind = 'ai'
    and key = target_provider_adapter_key
    and status in ('active','degraded');

  if provider_record.id is null then
    raise exception 'AI provider is not active';
  end if;

  if not (
    coalesce(provider_record.config -> 'supports', '[]'::jsonb)
      ? capability_record.response_mode
  ) then
    raise exception 'AI provider does not support the capability response mode';
  end if;

  if exists (
    select 1 from public.ai_provider_route_events
    where idempotency_key = target_idempotency_key
  ) then
    select route.* into route_record
    from public.ai_provider_routes route
    where route.capability_id = capability_record.id
      and route.provider_adapter_id = provider_record.id
      and route.model_key = btrim(target_model_key);
    return to_jsonb(route_record);
  end if;

  select coalesce(jsonb_agg(to_jsonb(route)), '[]'::jsonb)
  into previous_state
  from public.ai_provider_routes route
  where route.capability_id = capability_record.id
    and route.status = 'active';

  update public.ai_provider_routes
  set status = 'paused',
      updated_by = auth.uid(),
      updated_at = timezone('utc', now()),
      version = version + 1
  where capability_id = capability_record.id
    and status = 'active';

  insert into public.ai_provider_routes (
    capability_id, provider_adapter_id, model_key, priority, status,
    config, created_by, updated_by
  )
  values (
    capability_record.id, provider_record.id, btrim(target_model_key), 1, 'active',
    target_route_config, auth.uid(), auth.uid()
  )
  on conflict (capability_id, provider_adapter_id, model_key)
  do update set
    priority = 1,
    status = 'active',
    effective_from = null,
    effective_until = null,
    config = excluded.config,
    updated_by = auth.uid(),
    updated_at = timezone('utc', now()),
    version = public.ai_provider_routes.version + 1
  returning * into route_record;

  insert into public.ai_provider_route_events (
    capability_id, provider_route_id, event_type, previous_state, new_state,
    reason, actor_user_id, idempotency_key
  )
  values (
    capability_record.id, route_record.id, 'activated', previous_state,
    to_jsonb(route_record), btrim(target_reason), auth.uid(), target_idempotency_key
  );

  return to_jsonb(route_record);
end;
$$;

revoke all on function public.set_ai_capability_provider(text,text,text,text,text,jsonb) from public, anon;
grant execute on function public.set_ai_capability_provider(text,text,text,text,text,jsonb) to authenticated, service_role;

create or replace function public.upsert_ai_provider_configuration(
  target_provider_key text,
  target_display_name text,
  target_transport text,
  target_api_base_url text,
  target_secret_ref text,
  target_status text,
  target_config jsonb,
  target_reason text,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  provider_record public.provider_adapters%rowtype;
  previous_state jsonb := '{}'::jsonb;
  event_capability_id uuid;
begin
  if not (
    public.is_platform_super_admin()
    or public.has_permission('platform.ai.manage', null)
  ) then
    raise exception 'AI management permission is required';
  end if;

  if target_provider_key is null or target_provider_key !~ '^provider[.]ai[.][a-z0-9_.:-]{2,100}$'
    or target_display_name is null or char_length(btrim(target_display_name)) < 2
    or target_transport not in ('google_generate_content','openai_compatible_chat','cloudflare_workers_ai')
    or target_status not in ('inactive','active','degraded','disabled')
    or target_config is null or jsonb_typeof(target_config) <> 'object'
    or target_reason is null or btrim(target_reason) = ''
    or target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'AI provider configuration is invalid';
  end if;

  if target_api_base_url is not null and target_api_base_url !~ '^https://[^ ]+$' then
    raise exception 'AI provider API base URL must use HTTPS';
  end if;

  if target_secret_ref is not null
    and target_secret_ref !~ '^SUPABASE_SECRET:[A-Z][A-Z0-9_]{2,100}$' then
    raise exception 'AI provider secret reference is invalid';
  end if;

  select to_jsonb(provider) into previous_state
  from public.provider_adapters provider
  where provider.provider_kind = 'ai'
    and provider.key = target_provider_key;

  insert into public.provider_adapters (
    provider_kind, key, display_name, status, config, secret_ref, created_by
  )
  values (
    'ai',
    target_provider_key,
    btrim(target_display_name),
    target_status,
    coalesce(target_config, '{}'::jsonb)
      || jsonb_build_object(
        'transport', target_transport,
        'supports', case target_transport
          when 'google_generate_content' then '["text","json","image"]'::jsonb
          when 'openai_compatible_chat' then '["text","json"]'::jsonb
          when 'cloudflare_workers_ai' then '["image"]'::jsonb
          else '[]'::jsonb
        end
      )
      || case when target_api_base_url is null then '{}'::jsonb
              else jsonb_build_object('api_base_url', target_api_base_url) end,
    target_secret_ref,
    auth.uid()
  )
  on conflict (provider_kind, key)
  do update set
    display_name = excluded.display_name,
    status = excluded.status,
    config = public.provider_adapters.config || excluded.config,
    secret_ref = coalesce(excluded.secret_ref, public.provider_adapters.secret_ref),
    updated_at = timezone('utc', now())
  returning * into provider_record;

  select id into event_capability_id
  from public.ai_capabilities
  where key = 'ai.assistant.admin'
  limit 1;

  if event_capability_id is not null then
    insert into public.ai_provider_route_events (
      capability_id, provider_route_id, event_type, previous_state, new_state,
      reason, actor_user_id, idempotency_key
    )
    values (
      event_capability_id, null, 'provider_updated', coalesce(previous_state, '{}'::jsonb),
      to_jsonb(provider_record) - 'secret_ref',
      btrim(target_reason), auth.uid(), target_idempotency_key
    )
    on conflict (idempotency_key) do nothing;
  end if;

  return to_jsonb(provider_record) - 'secret_ref';
end;
$$;

revoke all on function public.upsert_ai_provider_configuration(text,text,text,text,text,text,jsonb,text,text) from public, anon;
grant execute on function public.upsert_ai_provider_configuration(text,text,text,text,text,text,jsonb,text,text) to authenticated, service_role;

-- Existing provider rows get transport metadata, while retaining their current status and image configuration.
update public.provider_adapters
set config = config
      || jsonb_build_object(
        'transport', 'google_generate_content',
        'api_base_url', 'https://generativelanguage.googleapis.com/v1beta',
        'text_model', coalesce(config ->> 'text_model', 'gemini-3.5-flash-lite'),
        'supports', '["text","json","image"]'::jsonb
      ),
    updated_at = timezone('utc', now())
where provider_kind = 'ai'
  and key = 'provider.ai.google-gemini';

update public.provider_adapters
set config = config
      || jsonb_build_object(
        'transport', 'openai_compatible_chat',
        'api_base_url', coalesce(config ->> 'api_base_url', 'https://api.openai.com/v1'),
        'supports', '["text","json"]'::jsonb
      ),
    updated_at = timezone('utc', now())
where provider_kind = 'ai'
  and key = 'provider.ai.openai';

update public.provider_adapters
set config = config
      || jsonb_build_object(
        'transport', 'cloudflare_workers_ai',
        'supports', '["image"]'::jsonb
      ),
    updated_at = timezone('utc', now())
where provider_kind = 'ai'
  and key = 'provider.ai.cloudflare-workers-ai';

insert into public.provider_adapters (
  provider_kind, key, display_name, status, config, secret_ref
)
values (
  'ai',
  'provider.ai.openai-compatible',
  'OpenAI-compatible AI Adapter',
  'inactive',
  jsonb_build_object(
    'transport', 'openai_compatible_chat',
    'supports', '["text","json"]'::jsonb,
    'enabled_by_configuration', true,
    'control', 'assist_only'
  ),
  null
)
on conflict (provider_kind, key) do nothing;

insert into public.ai_capabilities (
  key, display_name, description, category, response_mode, control_mode, status, config
)
values
  (
    'ai.assistant.customer',
    'Customer Assistant',
    'Grounded assistance for customer LPG orders, cylinders, locations, account status and support.',
    'assistant','text','read_only','active',
    '{"workspace":"customer","grounded_only":true,"may_mutate_business_state":false}'::jsonb
  ),
  (
    'ai.assistant.driver',
    'Driver Workflow Copilot',
    'Grounded job briefings, next-step explanations and earnings summaries for approved drivers.',
    'assistant','text','read_only','active',
    '{"workspace":"driver","grounded_only":true,"may_mutate_business_state":false}'::jsonb
  ),
  (
    'ai.assistant.station',
    'Station Operations Assistant',
    'Grounded summaries for station queues, assigned work and operational attention.',
    'assistant','text','read_only','active',
    '{"workspace":"station","grounded_only":true,"may_mutate_business_state":false}'::jsonb
  ),
  (
    'ai.assistant.admin',
    'Admin Operations Copilot',
    'Read-only operational intelligence for authorized SKIMA administrators.',
    'assistant','text','read_only','active',
    '{"workspace":"admin","grounded_only":true,"may_mutate_business_state":false}'::jsonb
  ),
  (
    'ai.lpg.cylinder.presentation',
    'Cylinder Presentation Image',
    'Creates a presentation derivative while preserving the original cylinder evidence.',
    'image','image','assist_only','active',
    '{"preserve_original":true,"no_safety_decisions":true}'::jsonb
  ),
  (
    'ai.driver.card_photo.enhance',
    'Driver Card Photo Enhancement',
    'Creates an approved presentation derivative for the driver card while preserving original evidence.',
    'image','image','assist_only','active',
    '{"preserve_original":true,"no_identity_decisions":true}'::jsonb
  )
on conflict (key) do update
set display_name = excluded.display_name,
    description = excluded.description,
    category = excluded.category,
    response_mode = excluded.response_mode,
    control_mode = excluded.control_mode,
    status = excluded.status,
    config = public.ai_capabilities.config || excluded.config,
    updated_at = timezone('utc', now());

-- Preserve whichever image provider the existing task currently uses.
insert into public.ai_provider_routes (
  capability_id, provider_adapter_id, model_key, priority, status, config
)
select
  capability.id,
  provider.id,
  coalesce(nullif(provider.config ->> 'model',''), 'configured-image-model'),
  1,
  'active',
  jsonb_build_object('seed_source','existing_ai_task_definition')
from public.ai_capabilities capability
join public.ai_task_definitions task on task.key = capability.key
join public.provider_adapters provider on provider.id = task.provider_adapter_id
where capability.key in ('ai.lpg.cylinder.presentation','ai.driver.card_photo.enhance')
  and provider.provider_kind = 'ai'
  and provider.status in ('active','degraded')
on conflict (capability_id, provider_adapter_id, model_key) do nothing;

-- Initial text route uses a free-tier Gemini model when Gemini is already configured.
insert into public.ai_provider_routes (
  capability_id, provider_adapter_id, model_key, priority, status, config
)
select
  capability.id,
  provider.id,
  coalesce(nullif(provider.config ->> 'text_model',''), 'gemini-3.5-flash-lite'),
  1,
  'active',
  '{"seed_source":"free_tier_default"}'::jsonb
from public.ai_capabilities capability
join public.provider_adapters provider
  on provider.provider_kind = 'ai'
 and provider.key = 'provider.ai.google-gemini'
where capability.key in (
  'ai.assistant.customer',
  'ai.assistant.driver',
  'ai.assistant.station',
  'ai.assistant.admin'
)
  and provider.status in ('active','degraded')
on conflict (capability_id, provider_adapter_id, model_key) do nothing;

insert into public.ai_tool_definitions (
  key, display_name, description, operation_kind, handler_key,
  allowed_workspaces, requires_confirmation, status, config
)
values
  ('ai.tool.customer.orders','Order status','Read recent LPG order status for the signed-in customer.','query','context.customer.orders',array['customer'],false,'active','{"read_only":true}'::jsonb),
  ('ai.tool.customer.cylinders','Cylinder summary','Read the signed-in customer cylinder summary.','query','context.customer.cylinders',array['customer'],false,'active','{"read_only":true}'::jsonb),
  ('ai.tool.driver.jobs','Driver jobs','Read approved driver assignments visible to the signed-in driver.','query','context.driver.jobs',array['driver'],false,'active','{"read_only":true}'::jsonb),
  ('ai.tool.driver.earnings','Driver earnings','Read commission records visible to the signed-in driver.','query','context.driver.earnings',array['driver'],false,'active','{"read_only":true}'::jsonb),
  ('ai.tool.station.operations','Station operations','Read station work visible to the signed-in station operator.','query','context.station.operations',array['station'],false,'active','{"read_only":true}'::jsonb),
  ('ai.tool.admin.operations','Admin operations','Read operational summaries available to an authorized AI administrator.','query','context.admin.operations',array['admin'],false,'active','{"read_only":true}'::jsonb)
on conflict (key) do update
set display_name = excluded.display_name,
    description = excluded.description,
    operation_kind = excluded.operation_kind,
    handler_key = excluded.handler_key,
    allowed_workspaces = excluded.allowed_workspaces,
    requires_confirmation = excluded.requires_confirmation,
    status = excluded.status,
    config = excluded.config,
    updated_at = timezone('utc', now());

-- Remove provider-name checks from owned image queueing. Ownership and task identity checks remain unchanged.
create or replace function public.queue_owned_presentation_ai_task(
  target_task_key text,
  target_source text,
  target_subject_type text,
  target_subject_id uuid,
  target_input jsonb,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  task_definition_id uuid;
  task_run_id uuid;
  existing_run record;
begin
  if auth.uid() is null then
    raise exception 'authentication is required';
  end if;

  if target_task_key <> 'ai.lpg.cylinder.presentation'
    or target_subject_type <> 'lpg_cylinder'
    or target_subject_id is null then
    raise exception 'presentation task scope is not supported';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$'
    or target_idempotency_key is null or btrim(target_idempotency_key) = ''
    or target_input is null or jsonb_typeof(target_input) <> 'object' then
    raise exception 'presentation task request is invalid';
  end if;

  if not exists (
    select 1 from public.lpg_cylinders cylinder
    where cylinder.id = target_subject_id
      and cylinder.owner_user_id = auth.uid()
      and cylinder.status <> 'deactivated'
  ) then
    raise exception 'owned active cylinder was not found';
  end if;

  select definition.id
  into task_definition_id
  from public.ai_task_definitions definition
  where definition.key = target_task_key
    and definition.status = 'active'
  limit 1;

  if task_definition_id is null then
    raise exception 'presentation generation is not configured';
  end if;

  insert into public.ai_task_runs (
    task_definition_id, subject_type, subject_id, status, input,
    requested_by, source, idempotency_key
  )
  values (
    task_definition_id, target_subject_type, target_subject_id, 'queued', target_input,
    auth.uid(), target_source, target_idempotency_key
  )
  on conflict (source, idempotency_key) where idempotency_key is not null
  do nothing
  returning id into task_run_id;

  if task_run_id is null then
    select run.* into existing_run
    from public.ai_task_runs run
    where run.source = target_source
      and run.idempotency_key = target_idempotency_key;

    if existing_run.task_definition_id <> task_definition_id
      or existing_run.subject_type <> target_subject_type
      or existing_run.subject_id is distinct from target_subject_id
      or existing_run.input <> target_input then
      raise exception 'presentation idempotency key conflicts with another request';
    end if;
    return existing_run.id;
  end if;

  insert into public.ai_task_run_events (ai_task_run_id, status, idempotency_key, metadata)
  values (task_run_id, 'queued', target_idempotency_key || ':queued', jsonb_build_object('source', target_source))
  on conflict do nothing;

  return task_run_id;
end;
$$;

revoke all on function public.queue_owned_presentation_ai_task(text,text,text,uuid,jsonb,text) from public, anon;
grant execute on function public.queue_owned_presentation_ai_task(text,text,text,uuid,jsonb,text) to authenticated, service_role;

create or replace function public.queue_owned_driver_card_photo_ai_task(
  target_task_key text,
  target_source text,
  target_subject_type text,
  target_subject_id uuid,
  target_input jsonb,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  task_definition_id uuid;
  task_run_id uuid;
  existing_run record;
  source_asset_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication is required';
  end if;

  if target_task_key <> 'ai.driver.card_photo.enhance'
    or target_subject_type <> 'driver_profile'
    or target_subject_id is null then
    raise exception 'driver card photo enhancement scope is not supported';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$'
    or target_idempotency_key is null or btrim(target_idempotency_key) = ''
    or target_input is null or jsonb_typeof(target_input) <> 'object' then
    raise exception 'driver card photo enhancement request is invalid';
  end if;

  if not exists (
    select 1
    from public.driver_profiles driver
    where driver.id = target_subject_id
      and driver.user_id = auth.uid()
      and driver.verification_status <> 'rejected'
  ) then
    raise exception 'owned driver profile was not found';
  end if;

  source_asset_id := case
    when target_input ? 'sourceMediaAssetId'
      and (target_input ->> 'sourceMediaAssetId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (target_input ->> 'sourceMediaAssetId')::uuid
    when target_input ? 'source_media_asset_id'
      and (target_input ->> 'source_media_asset_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (target_input ->> 'source_media_asset_id')::uuid
    else null
  end;

  if source_asset_id is null then
    raise exception 'sourceMediaAssetId is required';
  end if;

  if not exists (
    select 1
    from public.media_assets asset
    where asset.id = source_asset_id
      and asset.owner_user_id = auth.uid()
      and asset.status = 'active'
      and coalesce(asset.content_type, '') like 'image/%'
  ) then
    raise exception 'owned active source image was not found';
  end if;

  select definition.id
  into task_definition_id
  from public.ai_task_definitions definition
  where definition.key = target_task_key
    and definition.status = 'active'
  limit 1;

  if task_definition_id is null then
    raise exception 'driver card photo enhancement is not configured';
  end if;

  insert into public.ai_task_runs (
    task_definition_id, subject_type, subject_id, status, input,
    requested_by, source, idempotency_key
  )
  values (
    task_definition_id, target_subject_type, target_subject_id, 'queued', target_input,
    auth.uid(), target_source, target_idempotency_key
  )
  on conflict (source, idempotency_key) where idempotency_key is not null
  do nothing
  returning id into task_run_id;

  if task_run_id is null then
    select run.* into existing_run
    from public.ai_task_runs run
    where run.source = target_source
      and run.idempotency_key = target_idempotency_key;

    if existing_run.task_definition_id <> task_definition_id
      or existing_run.subject_type <> target_subject_type
      or existing_run.subject_id is distinct from target_subject_id
      or existing_run.input <> target_input then
      raise exception 'driver card photo idempotency key conflicts with another request';
    end if;
    return existing_run.id;
  end if;

  insert into public.ai_task_run_events (ai_task_run_id, status, idempotency_key, metadata)
  values (task_run_id, 'queued', target_idempotency_key || ':queued', jsonb_build_object('source', target_source))
  on conflict do nothing;

  return task_run_id;
end;
$$;

revoke all on function public.queue_owned_driver_card_photo_ai_task(text,text,text,uuid,jsonb,text) from public, anon;
grant execute on function public.queue_owned_driver_card_photo_ai_task(text,text,text,uuid,jsonb,text) to authenticated, service_role;

commit;
