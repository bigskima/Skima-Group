begin;

insert into public.permissions (key, description, risk_level)
values
  ('platform.modules.read', 'Read business module framework records.', 'standard'),
  ('platform.modules.manage', 'Configure business modules and module version components.', 'critical')
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    updated_at = timezone('utc', now());

select public.configure_platform_admin_role(
  'platform.module_admin',
  'Module Admin',
  'Configures business module definitions, versions, and component bindings.',
  array[
    'platform.modules.read',
    'platform.modules.manage',
    'platform.configuration.read',
    'platform.providers.manage',
    'platform.workflows.manage',
    'platform.events.manage',
    'platform.pricing.manage',
    'platform.settlement.manage',
    'platform.verification.manage',
    'platform.dispatch.manage',
    'platform.notifications.manage',
    'platform.ai.manage'
  ],
  '{"system_template":true,"category":"modules"}'::jsonb,
  'active'
);

update public.platform_admin_role_templates
set is_system = true,
    updated_at = timezone('utc', now())
where key = 'platform.module_admin';

create table if not exists public.business_modules (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  description text,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'suspended', 'retired')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.business_module_versions (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.business_modules(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'retired')),
  manifest jsonb not null default '{}'::jsonb
    check (jsonb_typeof(manifest) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  activated_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (module_id, version)
);

create unique index if not exists business_module_versions_one_active
on public.business_module_versions (module_id)
where status = 'active';

create table if not exists public.business_module_components (
  id uuid primary key default gen_random_uuid(),
  module_version_id uuid not null references public.business_module_versions(id) on delete cascade,
  component_type text not null
    check (component_type in (
      'capability',
      'workflow',
      'pricing_policy',
      'settlement_policy',
      'event',
      'permission',
      'vehicle_requirement',
      'driver_requirement',
      'document_requirement',
      'ai_behavior',
      'report',
      'screen'
    )),
  component_key text not null
    check (component_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  reference_key text
    check (reference_key is null or reference_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  is_required boolean not null default true,
  config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object'),
  status text not null default 'active'
    check (status in ('draft', 'active', 'retired')),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (module_version_id, component_type, component_key)
);

create index if not exists business_module_components_type_reference_idx
on public.business_module_components (component_type, reference_key, status);

create table if not exists public.business_module_events (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.business_modules(id) on delete cascade,
  module_version_id uuid references public.business_module_versions(id) on delete cascade,
  event_type text not null
    check (event_type in (
      'configured',
      'version_configured',
      'component_configured',
      'version_activated',
      'retired'
    )),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  unique (module_id, idempotency_key)
);

create or replace function public.can_manage_business_modules()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.role() = 'service_role'
    or public.is_platform_super_admin()
    or public.has_permission('platform.modules.manage', null);
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

create or replace function public.configure_business_module(
  target_module_key text,
  target_display_name text,
  target_description text default null,
  target_metadata jsonb default '{}'::jsonb,
  target_status text default 'draft',
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  module_record_id uuid;
begin
  if not public.can_manage_business_modules() then
    raise exception 'platform module management permission is required';
  end if;

  if target_module_key is null
    or target_module_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_module_key must be a valid platform key';
  end if;

  if target_display_name is null
    or btrim(target_display_name) = '' then
    raise exception 'target_display_name is required';
  end if;

  if target_status is null
    or target_status not in ('draft', 'suspended', 'retired') then
    raise exception 'target_status must be draft, suspended, or retired';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  insert into public.business_modules (
    key,
    display_name,
    description,
    status,
    metadata,
    created_by
  )
  values (
    target_module_key,
    target_display_name,
    target_description,
    target_status,
    target_metadata,
    auth.uid()
  )
  on conflict (key) do update
  set display_name = excluded.display_name,
      description = excluded.description,
      status = case
        when public.business_modules.status = 'active' and excluded.status = 'draft' then 'active'
        else excluded.status
      end,
      metadata = excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into module_record_id;

  insert into public.business_module_events (
    module_id,
    event_type,
    idempotency_key,
    metadata
  )
  values (
    module_record_id,
    'configured',
    target_idempotency_key,
    jsonb_build_object('module_key', target_module_key, 'status', target_status)
  )
  on conflict do nothing;

  return module_record_id;
end;
$$;

create or replace function public.configure_business_module_version(
  target_module_key text,
  target_version integer,
  target_manifest jsonb default '{}'::jsonb,
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  module_record record;
  module_version_id uuid;
  existing_version record;
begin
  if not public.can_manage_business_modules() then
    raise exception 'platform module management permission is required';
  end if;

  if target_module_key is null
    or target_module_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_module_key must be a valid platform key';
  end if;

  select module.*
  into module_record
  from public.business_modules module
  where module.key = target_module_key
    and module.status <> 'retired';

  if not found then
    raise exception 'target_module_key must reference a configured business module';
  end if;

  if target_version is null or target_version < 1 then
    raise exception 'target_version must be greater than zero';
  end if;

  if target_manifest is null
    or jsonb_typeof(target_manifest) <> 'object' then
    raise exception 'target_manifest must be a JSON object';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select version_record.*
  into existing_version
  from public.business_module_versions version_record
  where version_record.module_id = module_record.id
    and version_record.version = target_version;

  if found and existing_version.status <> 'draft' then
    raise exception 'only draft business module versions can be configured';
  end if;

  insert into public.business_module_versions (
    module_id,
    version,
    status,
    manifest,
    created_by
  )
  values (
    module_record.id,
    target_version,
    'draft',
    target_manifest,
    auth.uid()
  )
  on conflict (module_id, version) do update
  set manifest = excluded.manifest,
      updated_at = timezone('utc', now())
  returning id into module_version_id;

  insert into public.business_module_events (
    module_id,
    module_version_id,
    event_type,
    idempotency_key,
    metadata
  )
  values (
    module_record.id,
    module_version_id,
    'version_configured',
    target_idempotency_key,
    jsonb_build_object('module_key', target_module_key, 'version', target_version)
  )
  on conflict do nothing;

  return module_version_id;
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

create or replace function public.activate_business_module_version(
  target_module_key text,
  target_version integer,
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  module_record record;
  version_record record;
  component_record record;
begin
  if not public.can_manage_business_modules() then
    raise exception 'platform module management permission is required';
  end if;

  if target_module_key is null
    or target_module_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_module_key must be a valid platform key';
  end if;

  if target_version is null or target_version < 1 then
    raise exception 'target_version must be greater than zero';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select module.*
  into module_record
  from public.business_modules module
  where module.key = target_module_key
    and module.status <> 'retired'
  for update;

  if not found then
    raise exception 'target_module_key must reference a configured business module';
  end if;

  select version.*
  into version_record
  from public.business_module_versions version
  where version.module_id = module_record.id
    and version.version = target_version
    and version.status in ('draft', 'active')
  for update;

  if not found then
    raise exception 'target_version must reference a configurable business module version';
  end if;

  if not exists (
    select 1
    from public.business_module_components component
    where component.module_version_id = version_record.id
      and component.status = 'active'
  ) then
    raise exception 'business module version must define at least one active component';
  end if;

  for component_record in
    select component.component_type, component.reference_key
    from public.business_module_components component
    where component.module_version_id = version_record.id
      and component.status = 'active'
  loop
    perform public.validate_business_module_component_reference(
      component_record.component_type,
      component_record.reference_key,
      true
    );
  end loop;

  update public.business_module_versions
  set status = 'retired',
      retired_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where module_id = module_record.id
    and status = 'active'
    and id <> version_record.id;

  update public.business_module_versions
  set status = 'active',
      activated_at = coalesce(activated_at, timezone('utc', now())),
      retired_at = null,
      updated_at = timezone('utc', now())
  where id = version_record.id;

  update public.business_modules
  set status = 'active',
      updated_at = timezone('utc', now())
  where id = module_record.id;

  insert into public.business_module_events (
    module_id,
    module_version_id,
    event_type,
    idempotency_key,
    metadata
  )
  values (
    module_record.id,
    version_record.id,
    'version_activated',
    target_idempotency_key,
    jsonb_build_object('module_key', target_module_key, 'version', target_version)
  )
  on conflict do nothing;

  return version_record.id;
end;
$$;

create or replace function public.retire_business_module(
  target_module_key text,
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
begin
  if not public.can_manage_business_modules() then
    raise exception 'platform module management permission is required';
  end if;

  if target_module_key is null
    or target_module_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_module_key must be a valid platform key';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select module.*
  into module_record
  from public.business_modules module
  where module.key = target_module_key
  for update;

  if not found then
    raise exception 'target_module_key must reference a configured business module';
  end if;

  update public.business_modules
  set status = 'retired',
      metadata = metadata || target_metadata,
      updated_at = timezone('utc', now())
  where id = module_record.id;

  update public.business_module_versions
  set status = 'retired',
      retired_at = coalesce(retired_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
  where module_id = module_record.id
    and status <> 'retired';

  insert into public.business_module_events (
    module_id,
    event_type,
    idempotency_key,
    metadata
  )
  values (
    module_record.id,
    'retired',
    target_idempotency_key,
    target_metadata
  )
  on conflict do nothing;

  return module_record.id;
end;
$$;

create or replace function public.prevent_business_module_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'business module events are append-only';
end;
$$;

drop trigger if exists prevent_business_module_events_update on public.business_module_events;
create trigger prevent_business_module_events_update
before update on public.business_module_events
for each row execute function public.prevent_business_module_event_mutation();

drop trigger if exists prevent_business_module_events_delete on public.business_module_events;
create trigger prevent_business_module_events_delete
before delete on public.business_module_events
for each row execute function public.prevent_business_module_event_mutation();

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'business_modules',
    'business_module_versions',
    'business_module_components'
  ] loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I', target_table, target_table);
    execute format(
      'create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      target_table,
      target_table
    );
  end loop;
end $$;

alter table public.business_modules enable row level security;
alter table public.business_module_versions enable row level security;
alter table public.business_module_components enable row level security;
alter table public.business_module_events enable row level security;

create policy business_modules_select_active_or_privileged on public.business_modules
for select to authenticated
using (
  status = 'active'
  or public.has_permission('platform.modules.read', null)
  or public.has_permission('platform.modules.manage', null)
);

create policy business_modules_no_direct_insert on public.business_modules
for insert to authenticated
with check (false);

create policy business_modules_no_direct_update on public.business_modules
for update to authenticated
using (false)
with check (false);

create policy business_modules_no_direct_delete on public.business_modules
for delete to authenticated
using (false);

create policy business_module_versions_select_active_or_privileged
on public.business_module_versions
for select to authenticated
using (
  (
    status = 'active'
    and exists (
      select 1
      from public.business_modules module
      where module.id = business_module_versions.module_id
        and module.status = 'active'
    )
  )
  or public.has_permission('platform.modules.read', null)
  or public.has_permission('platform.modules.manage', null)
);

create policy business_module_versions_no_direct_insert
on public.business_module_versions
for insert to authenticated
with check (false);

create policy business_module_versions_no_direct_update
on public.business_module_versions
for update to authenticated
using (false)
with check (false);

create policy business_module_versions_no_direct_delete
on public.business_module_versions
for delete to authenticated
using (false);

create policy business_module_components_select_active_or_privileged
on public.business_module_components
for select to authenticated
using (
  (
    status = 'active'
    and exists (
      select 1
      from public.business_module_versions version
      join public.business_modules module on module.id = version.module_id
      where version.id = business_module_components.module_version_id
        and version.status = 'active'
        and module.status = 'active'
    )
  )
  or public.has_permission('platform.modules.read', null)
  or public.has_permission('platform.modules.manage', null)
);

create policy business_module_components_no_direct_insert
on public.business_module_components
for insert to authenticated
with check (false);

create policy business_module_components_no_direct_update
on public.business_module_components
for update to authenticated
using (false)
with check (false);

create policy business_module_components_no_direct_delete
on public.business_module_components
for delete to authenticated
using (false);

create policy business_module_events_select_privileged
on public.business_module_events
for select to authenticated
using (
  public.has_permission('platform.modules.read', null)
  or public.has_permission('platform.modules.manage', null)
);

create policy business_module_events_no_direct_insert
on public.business_module_events
for insert to authenticated
with check (false);

create policy business_module_events_no_direct_update
on public.business_module_events
for update to authenticated
using (false)
with check (false);

create policy business_module_events_no_direct_delete
on public.business_module_events
for delete to authenticated
using (false);

grant select, insert, update, delete on
  public.business_modules,
  public.business_module_versions,
  public.business_module_components,
  public.business_module_events
to authenticated;

grant select, insert, update, delete on
  public.business_modules,
  public.business_module_versions,
  public.business_module_components,
  public.business_module_events
to service_role;

revoke all on function public.can_manage_business_modules() from public;
revoke all on function public.validate_business_module_component_reference(text, text, boolean) from public;
revoke all on function public.configure_business_module(text, text, text, jsonb, text, text) from public;
revoke all on function public.configure_business_module_version(text, integer, jsonb, text) from public;
revoke all on function public.configure_business_module_component(uuid, text, text, text, boolean, jsonb, text, text) from public;
revoke all on function public.activate_business_module_version(text, integer, text) from public;
revoke all on function public.retire_business_module(text, text, jsonb) from public;

revoke all on function public.can_manage_business_modules() from anon;
revoke all on function public.validate_business_module_component_reference(text, text, boolean) from anon;
revoke all on function public.configure_business_module(text, text, text, jsonb, text, text) from anon;
revoke all on function public.configure_business_module_version(text, integer, jsonb, text) from anon;
revoke all on function public.configure_business_module_component(uuid, text, text, text, boolean, jsonb, text, text) from anon;
revoke all on function public.activate_business_module_version(text, integer, text) from anon;
revoke all on function public.retire_business_module(text, text, jsonb) from anon;

grant execute on function public.can_manage_business_modules() to authenticated, service_role;
grant execute on function public.validate_business_module_component_reference(text, text, boolean) to service_role;
grant execute on function public.configure_business_module(text, text, text, jsonb, text, text) to authenticated, service_role;
grant execute on function public.configure_business_module_version(text, integer, jsonb, text) to authenticated, service_role;
grant execute on function public.configure_business_module_component(uuid, text, text, text, boolean, jsonb, text, text) to authenticated, service_role;
grant execute on function public.activate_business_module_version(text, integer, text) to authenticated, service_role;
grant execute on function public.retire_business_module(text, text, jsonb) to authenticated, service_role;

commit;
