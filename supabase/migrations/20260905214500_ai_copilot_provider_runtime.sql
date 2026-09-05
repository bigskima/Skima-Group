begin;

-- Provider-neutral AI capability and routing runtime.
-- AI remains assistive: this runtime does not mutate financial, dispatch, settlement,
-- inventory, verification, or permission state.

create table if not exists public.ai_capabilities (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  description text not null default '',
  audience text[] not null default '{}'::text[],
  modality text not null default 'text'
    check (modality in ('text','image','multimodal','embedding')),
  system_prompt text not null default '',
  tool_keys text[] not null default '{}'::text[],
  allow_mutations boolean not null default false,
  status text not null default 'active'
    check (status in ('draft','active','paused','retired')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ai_provider_routes (
  id uuid primary key default gen_random_uuid(),
  capability_key text not null references public.ai_capabilities(key) on delete cascade,
  provider_adapter_id uuid not null references public.provider_adapters(id) on delete cascade,
  model_key text,
  priority integer not null default 100 check (priority between 1 and 10000),
  status text not null default 'active'
    check (status in ('active','standby','disabled')),
  config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (capability_key, provider_adapter_id)
);

create index if not exists ai_provider_routes_resolution_idx
on public.ai_provider_routes (capability_key, status, priority, updated_at desc);

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  workspace text not null
    check (workspace in ('customer','driver','station','admin')),
  capability_key text not null references public.ai_capabilities(key) on delete restrict,
  title text,
  status text not null default 'active'
    check (status in ('active','archived')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_conversations_user_updated_idx
on public.ai_conversations (user_id, updated_at desc);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null
    check (role in ('user','assistant','system','tool')),
  content text not null check (length(content) between 1 and 20000),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_messages_conversation_created_idx
on public.ai_messages (conversation_id, created_at asc);

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  conversation_id uuid references public.ai_conversations(id) on delete set null,
  capability_key text references public.ai_capabilities(key) on delete set null,
  provider_adapter_id uuid references public.provider_adapters(id) on delete set null,
  model_key text,
  status text not null
    check (status in ('succeeded','failed','rejected')),
  input_units integer,
  output_units integer,
  latency_ms integer,
  error_code text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_usage_events_capability_created_idx
on public.ai_usage_events (capability_key, created_at desc);

-- Add protocol metadata to existing adapters. Selection still comes from ai_provider_routes,
-- never from a provider name hardcoded in a mobile or admin client.
update public.provider_adapters
set config = config || jsonb_build_object(
      'protocol', coalesce(config ->> 'protocol', 'gemini_generate_content'),
      'text_model', coalesce(config ->> 'text_model', 'gemini-2.5-flash-lite'),
      'text_endpoint', coalesce(config ->> 'text_endpoint', 'https://generativelanguage.googleapis.com/v1beta')
    ),
    updated_at = timezone('utc', now())
where provider_kind = 'ai'
  and key = 'provider.ai.google-gemini';

update public.provider_adapters
set config = config || jsonb_build_object(
      'protocol', coalesce(config ->> 'protocol', 'openai_chat_completions'),
      'text_endpoint', coalesce(config ->> 'text_endpoint', 'https://api.openai.com/v1')
    ),
    updated_at = timezone('utc', now())
where provider_kind = 'ai'
  and key = 'provider.ai.openai';

update public.provider_adapters
set config = config || jsonb_build_object(
      'protocol', coalesce(config ->> 'protocol', 'anthropic_messages'),
      'text_endpoint', coalesce(config ->> 'text_endpoint', 'https://api.anthropic.com/v1')
    ),
    updated_at = timezone('utc', now())
where provider_kind = 'ai'
  and key = 'provider.ai.anthropic-claude';

insert into public.ai_capabilities (
  key, display_name, description, audience, modality, system_prompt, tool_keys, allow_mutations, status, metadata
)
values
  (
    'ai.customer.assistant',
    'Customer Assistant',
    'Grounded SKIMA help for customer orders, cylinders, locations, pricing explanations and support.',
    array['customer'],
    'text',
    'Help the signed-in SKIMA customer understand only the grounded platform context supplied to you. Never invent order, payment, location, price, cylinder, driver or station facts. Explain clearly and briefly. If context is insufficient, say what is missing. Never claim to have changed an order, wallet, payment, dispatch, policy or account.',
    array['customer.orders.read','customer.cylinders.read','customer.locations.read'],
    false,
    'active',
    '{"surface":"mobile","control":"assist_only","grounding_required":true}'::jsonb
  ),
  (
    'ai.driver.copilot',
    'Driver Workflow Copilot',
    'Read-only workflow guidance for the signed-in driver.',
    array['driver'],
    'text',
    'Act as the signed-in SKIMA driver workflow copilot. Use only supplied job, profile and earnings context. Tell the driver what the current workflow state means and what the next normal app action is. Never assign, accept, cancel, settle, scan or complete a job yourself. Never invent customer or station details.',
    array['driver.jobs.read','driver.earnings.read'],
    false,
    'active',
    '{"surface":"mobile","control":"assist_only","grounding_required":true}'::jsonb
  ),
  (
    'ai.station.assistant',
    'Station Operations Assistant',
    'Read-only station queue, inventory and settlement assistance.',
    array['station'],
    'text',
    'Act as the signed-in SKIMA station operations assistant. Use only supplied station runtime, queue, inventory and settlement context. Highlight what needs attention and explain the next normal operational step. Never alter inventory, confirm a refill, settle money, approve a driver or change station configuration.',
    array['station.runtime.read','station.jobs.read','station.inventory.read','station.settlements.read'],
    false,
    'active',
    '{"surface":"mobile","control":"assist_only","grounding_required":true}'::jsonb
  ),
  (
    'ai.admin.operations_copilot',
    'Admin Operations Copilot',
    'Grounded operational summaries and investigation assistance for authorized SKIMA administrators.',
    array['admin'],
    'text',
    'Act as the SKIMA operations copilot for an authorized administrator. Use only supplied, permission-filtered platform context. Distinguish facts from suggestions. Never modify financial records, permissions, dispatch, settlements, inventory, verification, policies or user accounts. Recommend the relevant admin workspace when action is required.',
    array['admin.orders.read','admin.applications.read','admin.drivers.read','admin.stations.read'],
    false,
    'active',
    '{"surface":"admin","control":"assist_only","grounding_required":true}'::jsonb
  )
on conflict (key) do update
set display_name = excluded.display_name,
    description = excluded.description,
    audience = excluded.audience,
    modality = excluded.modality,
    system_prompt = excluded.system_prompt,
    tool_keys = excluded.tool_keys,
    allow_mutations = false,
    metadata = public.ai_capabilities.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

-- Default text route. This is configuration data, not source-code selection.
-- Administrators can reprioritize or replace routes without redeploying the clients.
insert into public.ai_provider_routes (
  capability_key, provider_adapter_id, model_key, priority, status, config
)
select capability.key, provider.id, coalesce(provider.config ->> 'text_model', 'gemini-2.5-flash-lite'), 10, 'active',
       '{"selection_source":"database","free_tier_preferred":true}'::jsonb
from public.ai_capabilities capability
join public.provider_adapters provider
  on provider.provider_kind = 'ai'
 and provider.key = 'provider.ai.google-gemini'
where capability.modality = 'text'
  and capability.key in (
    'ai.customer.assistant',
    'ai.driver.copilot',
    'ai.station.assistant',
    'ai.admin.operations_copilot'
  )
on conflict (capability_key, provider_adapter_id) do update
set model_key = coalesce(public.ai_provider_routes.model_key, excluded.model_key),
    priority = least(public.ai_provider_routes.priority, excluded.priority),
    config = public.ai_provider_routes.config || excluded.config,
    updated_at = timezone('utc', now());

-- Standby routes are intentionally model-agnostic until an administrator supplies the model in
-- configuration. They can be activated/reprioritized without an app deployment.
insert into public.ai_provider_routes (
  capability_key, provider_adapter_id, model_key, priority, status, config
)
select capability.key, provider.id, provider.config ->> 'text_model',
       case provider.key when 'provider.ai.openai' then 20 else 30 end,
       'standby',
       '{"selection_source":"database","requires_model_configuration":true}'::jsonb
from public.ai_capabilities capability
join public.provider_adapters provider
  on provider.provider_kind = 'ai'
 and provider.key in ('provider.ai.openai','provider.ai.anthropic-claude')
where capability.modality = 'text'
  and capability.key in (
    'ai.customer.assistant',
    'ai.driver.copilot',
    'ai.station.assistant',
    'ai.admin.operations_copilot'
  )
on conflict (capability_key, provider_adapter_id) do nothing;

alter table public.ai_capabilities enable row level security;
alter table public.ai_provider_routes enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_usage_events enable row level security;

drop policy if exists ai_capabilities_read_active_or_privileged on public.ai_capabilities;
create policy ai_capabilities_read_active_or_privileged
on public.ai_capabilities
for select to authenticated
using (
  status = 'active'
  or public.is_platform_super_admin()
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
);

drop policy if exists ai_capabilities_manage_privileged on public.ai_capabilities;
create policy ai_capabilities_manage_privileged
on public.ai_capabilities
for all to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.manage', null)
)
with check (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.manage', null)
);

drop policy if exists ai_provider_routes_read_privileged on public.ai_provider_routes;
create policy ai_provider_routes_read_privileged
on public.ai_provider_routes
for select to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
);

drop policy if exists ai_provider_routes_manage_privileged on public.ai_provider_routes;
create policy ai_provider_routes_manage_privileged
on public.ai_provider_routes
for all to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.manage', null)
)
with check (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.manage', null)
);

drop policy if exists ai_conversations_select_own on public.ai_conversations;
create policy ai_conversations_select_own
on public.ai_conversations
for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists ai_conversations_insert_own on public.ai_conversations;
create policy ai_conversations_insert_own
on public.ai_conversations
for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists ai_conversations_update_own on public.ai_conversations;
create policy ai_conversations_update_own
on public.ai_conversations
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists ai_messages_select_own on public.ai_messages;
create policy ai_messages_select_own
on public.ai_messages
for select to authenticated
using (
  exists (
    select 1
    from public.ai_conversations conversation
    where conversation.id = ai_messages.conversation_id
      and conversation.user_id = (select auth.uid())
  )
);

drop policy if exists ai_messages_no_direct_insert on public.ai_messages;
create policy ai_messages_no_direct_insert
on public.ai_messages
for insert to authenticated
with check (false);

drop policy if exists ai_messages_no_direct_update on public.ai_messages;
create policy ai_messages_no_direct_update
on public.ai_messages
for update to authenticated
using (false)
with check (false);

drop policy if exists ai_messages_no_direct_delete on public.ai_messages;
create policy ai_messages_no_direct_delete
on public.ai_messages
for delete to authenticated
using (false);

drop policy if exists ai_usage_events_select_own_or_privileged on public.ai_usage_events;
create policy ai_usage_events_select_own_or_privileged
on public.ai_usage_events
for select to authenticated
using (
  user_id = (select auth.uid())
  or public.is_platform_super_admin()
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
);

drop policy if exists ai_usage_events_no_direct_insert on public.ai_usage_events;
create policy ai_usage_events_no_direct_insert
on public.ai_usage_events
for insert to authenticated
with check (false);

revoke all on table public.ai_capabilities from anon;
revoke all on table public.ai_provider_routes from anon;
revoke all on table public.ai_conversations from anon;
revoke all on table public.ai_messages from anon;
revoke all on table public.ai_usage_events from anon;

grant select on table public.ai_capabilities to authenticated, service_role;
grant select, insert, update on table public.ai_conversations to authenticated;
grant select on table public.ai_messages to authenticated;
grant select on table public.ai_usage_events to authenticated;
grant select, insert, update, delete on table public.ai_capabilities to service_role;
grant select, insert, update, delete on table public.ai_provider_routes to service_role;
grant select, insert, update, delete on table public.ai_conversations to service_role;
grant select, insert, update, delete on table public.ai_messages to service_role;
grant select, insert, update, delete on table public.ai_usage_events to service_role;
grant select, insert, update, delete on table public.ai_provider_routes to authenticated;

commit;
