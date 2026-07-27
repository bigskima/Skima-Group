begin;

insert into public.permissions (key, description, risk_level)
values
  ('platform.support.read', 'Read platform support and account-assistance context.', 'high'),
  ('platform.support.manage', 'Manage platform support operations and assistance workflows.', 'high')
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    updated_at = timezone('utc', now());

create table if not exists public.platform_admin_role_templates (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles(id) on delete cascade,
  key text not null unique
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  description text,
  permission_keys text[] not null default '{}',
  status text not null default 'active'
    check (status in ('draft', 'active', 'retired')),
  is_system boolean not null default false,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (role_id)
);

create index if not exists platform_admin_role_templates_status_idx
on public.platform_admin_role_templates (status, key);

create or replace function public.can_manage_platform_admin_roles()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.role() = 'service_role'
    or public.is_platform_super_admin()
    or public.has_permission('platform.admins.super_manage', null);
$$;

create or replace function public.configure_platform_admin_role(
  target_role_key text,
  target_display_name text,
  target_description text,
  target_permission_keys text[],
  target_metadata jsonb default '{}'::jsonb,
  target_status text default 'active'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_permission_keys text[];
  missing_permission_keys text[];
  target_role_id uuid;
  template_id uuid;
begin
  if current_user not in ('postgres', 'supabase_admin')
    and not public.can_manage_platform_admin_roles() then
    raise exception 'only the platform super admin can configure platform admin roles';
  end if;

  if target_role_key is null
    or target_role_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_role_key must be a valid platform key';
  end if;

  if target_role_key = 'platform.super_admin'
    and current_user not in ('postgres', 'supabase_admin')
    and auth.role() <> 'service_role' then
    raise exception 'platform super admin role can only be configured by service-role deployment';
  end if;

  if target_display_name is null or btrim(target_display_name) = '' then
    raise exception 'target_display_name is required';
  end if;

  if target_status not in ('draft', 'active', 'retired') then
    raise exception 'target_status must be draft, active, or retired';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select coalesce(array_agg(distinct permission_key order by permission_key), '{}')
  into normalized_permission_keys
  from unnest(coalesce(target_permission_keys, '{}')) as permission_input(permission_key)
  where permission_key is not null
    and btrim(permission_key) <> '';

  select coalesce(array_agg(permission_key order by permission_key), '{}')
  into missing_permission_keys
  from unnest(normalized_permission_keys) as permission_input(permission_key)
  left join public.permissions permission_record on permission_record.key = permission_key
  where permission_record.id is null;

  if cardinality(missing_permission_keys) > 0 then
    raise exception 'unknown permission keys: %', array_to_string(missing_permission_keys, ', ');
  end if;

  insert into public.roles (
    key,
    display_name,
    description,
    status,
    metadata,
    created_by
  )
  values (
    target_role_key,
    target_display_name,
    target_description,
    target_status,
    target_metadata || jsonb_build_object(
      'admin_role',
      true,
      'super_admin',
      target_role_key = 'platform.super_admin',
      'template_managed',
      true
    ),
    auth.uid()
  )
  on conflict do nothing;

  select id into target_role_id
  from public.roles
  where key = target_role_key
    and organization_id is null;

  if target_role_id is null then
    raise exception 'target role could not be created';
  end if;

  update public.roles
  set display_name = target_display_name,
      description = target_description,
      status = target_status,
      metadata = target_metadata || jsonb_build_object(
        'admin_role',
        true,
        'super_admin',
        target_role_key = 'platform.super_admin',
        'template_managed',
        true
      ),
      updated_at = timezone('utc', now())
  where id = target_role_id;

  delete from public.role_permissions
  where role_id = target_role_id;

  insert into public.role_permissions (role_id, permission_id)
  select target_role_id, permission_record.id
  from public.permissions permission_record
  where permission_record.key = any(normalized_permission_keys)
  on conflict do nothing;

  insert into public.platform_admin_role_templates (
    role_id,
    key,
    display_name,
    description,
    permission_keys,
    status,
    is_system,
    metadata,
    created_by
  )
  values (
    target_role_id,
    target_role_key,
    target_display_name,
    target_description,
    normalized_permission_keys,
    target_status,
    target_role_key in (
      'platform.super_admin',
      'platform.identity_admin',
      'platform.configuration_admin',
      'platform.operations_admin',
      'platform.audit_admin',
      'platform.support_admin'
    ),
    target_metadata,
    auth.uid()
  )
  on conflict (key) do update
  set role_id = excluded.role_id,
      display_name = excluded.display_name,
      description = excluded.description,
      permission_keys = excluded.permission_keys,
      status = excluded.status,
      is_system = excluded.is_system,
      metadata = excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into template_id;

  return template_id;
end;
$$;

select public.configure_platform_admin_role(
  'platform.super_admin',
  'Platform Super Admin',
  'Single general manager role with full platform authority.',
  array(
    select permission_record.key
    from public.permissions permission_record
    order by permission_record.key
  ),
  '{"system_template":true,"general_manager":true}'::jsonb,
  'active'
);

select public.configure_platform_admin_role(
  'platform.identity_admin',
  'Identity Admin',
  'Manages users, roles, permissions, organizations, and admin assignments.',
  array[
    'platform.admins.read',
    'platform.admins.manage',
    'platform.users.read',
    'platform.users.manage',
    'platform.organizations.read',
    'platform.organizations.manage',
    'platform.roles.read',
    'platform.roles.manage'
  ],
  '{"system_template":true,"category":"identity"}'::jsonb,
  'active'
);

select public.configure_platform_admin_role(
  'platform.configuration_admin',
  'Configuration Admin',
  'Manages configuration, provider adapters, workflows, and event definitions.',
  array[
    'platform.configuration.read',
    'platform.configuration.manage',
    'platform.providers.manage',
    'platform.workflows.manage',
    'platform.events.read',
    'platform.events.manage'
  ],
  '{"system_template":true,"category":"configuration"}'::jsonb,
  'active'
);

select public.configure_platform_admin_role(
  'platform.operations_admin',
  'Operations Admin',
  'Manages operational queues, health records, logs, webhooks, and rate limits.',
  array[
    'platform.logs.read',
    'platform.jobs.manage',
    'platform.webhooks.manage',
    'platform.api_clients.manage',
    'platform.rate_limits.manage',
    'platform.cache.manage',
    'platform.health.read',
    'platform.health.manage'
  ],
  '{"system_template":true,"category":"operations"}'::jsonb,
  'active'
);

select public.configure_platform_admin_role(
  'platform.audit_admin',
  'Audit Admin',
  'Reads audit trails and governed operational reports.',
  array[
    'platform.audit.read',
    'platform.logs.read',
    'platform.events.read'
  ],
  '{"system_template":true,"category":"audit"}'::jsonb,
  'active'
);

select public.configure_platform_admin_role(
  'platform.support_admin',
  'Support Admin',
  'Handles account support operations without unrestricted platform control.',
  array[
    'platform.support.read',
    'platform.users.read',
    'platform.organizations.read',
    'platform.events.read',
    'platform.logs.read',
    'platform.health.read'
  ],
  '{"system_template":true,"category":"support"}'::jsonb,
  'active'
);

create or replace function public.configure_platform_admin(
  target_user_id uuid,
  target_role_key text,
  admin_title text default null,
  admin_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_role_id uuid;
  admin_record_id uuid;
begin
  if not public.is_platform_super_admin() then
    raise exception 'only the platform super admin can configure platform admins';
  end if;

  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;

  if target_role_key = 'platform.super_admin' then
    raise exception 'use service-role bootstrap to configure the platform super admin';
  end if;

  if admin_metadata is null or jsonb_typeof(admin_metadata) <> 'object' then
    raise exception 'admin_metadata must be a JSON object';
  end if;

  if not exists (select 1 from public.profiles profile where profile.id = target_user_id) then
    raise exception 'target_user_id must belong to a real Supabase Auth user';
  end if;

  select role_record.id into target_role_id
  from public.roles role_record
  join public.platform_admin_role_templates template_record
    on template_record.role_id = role_record.id
  where role_record.key = target_role_key
    and role_record.organization_id is null
    and role_record.status = 'active'
    and role_record.metadata ->> 'admin_role' = 'true'
    and template_record.status = 'active';

  if target_role_id is null then
    raise exception 'target_role_key must reference an active platform admin role template';
  end if;

  insert into public.platform_admins (
    user_id,
    primary_role_id,
    admin_kind,
    title,
    status,
    metadata,
    created_by
  )
  values (
    target_user_id,
    target_role_id,
    'role_admin',
    admin_title,
    'active',
    admin_metadata,
    auth.uid()
  )
  on conflict (user_id) do update
  set primary_role_id = excluded.primary_role_id,
      admin_kind = 'role_admin',
      title = excluded.title,
      status = 'active',
      metadata = excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into admin_record_id;

  insert into public.user_roles (organization_id, user_id, role_id, status, created_by)
  values (null, target_user_id, target_role_id, 'active', auth.uid())
  on conflict do nothing;

  return admin_record_id;
end;
$$;

revoke all on function public.configure_platform_admin_role(text, text, text, text[], jsonb, text)
from public;
revoke all on function public.configure_platform_admin_role(text, text, text, text[], jsonb, text)
from anon;
grant execute on function public.configure_platform_admin_role(text, text, text, text[], jsonb, text)
to authenticated, service_role;

drop trigger if exists set_platform_admin_role_templates_updated_at
on public.platform_admin_role_templates;
create trigger set_platform_admin_role_templates_updated_at
before update on public.platform_admin_role_templates
for each row execute function public.set_updated_at();

drop trigger if exists audit_platform_admin_role_templates_mutations
on public.platform_admin_role_templates;
create trigger audit_platform_admin_role_templates_mutations
after insert or update or delete on public.platform_admin_role_templates
for each row execute function public.record_table_audit();

alter table public.platform_admin_role_templates enable row level security;

create policy platform_admin_role_templates_select_privileged
on public.platform_admin_role_templates
for select to authenticated
using (
  public.has_permission('platform.admins.read', null)
  or public.has_permission('platform.admins.manage', null)
);

create policy platform_admin_role_templates_manage_super_admin
on public.platform_admin_role_templates
for all to authenticated
using (public.can_manage_platform_admin_roles())
with check (public.can_manage_platform_admin_roles());

grant select, insert, update, delete on public.platform_admin_role_templates to authenticated;
grant select, insert, update, delete on public.platform_admin_role_templates to service_role;

commit;
