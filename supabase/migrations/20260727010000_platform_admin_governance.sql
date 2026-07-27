begin;

insert into public.permissions (key, description, risk_level)
values
  ('platform.admins.read', 'Read platform administrator records.', 'critical'),
  ('platform.admins.manage', 'Configure platform administrators and their assigned roles.', 'critical'),
  ('platform.admins.super_manage', 'Bootstrap or transfer the platform super administrator.', 'critical')
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    updated_at = timezone('utc', now());

insert into public.roles (key, display_name, description, status, metadata)
values
  (
    'platform.super_admin',
    'Platform Super Admin',
    'Single general manager role with full platform authority.',
    'active',
    '{"admin_role":true,"super_admin":true,"auto_grant_all_permissions":true}'::jsonb
  ),
  (
    'platform.admin',
    'Platform Admin',
    'Configurable platform administrator role. Permissions are assigned through role policy.',
    'active',
    '{"admin_role":true,"super_admin":false}'::jsonb
  ),
  (
    'platform.identity_admin',
    'Identity Admin',
    'Manages users, roles, permissions, and organization administration.',
    'active',
    '{"admin_role":true,"super_admin":false}'::jsonb
  ),
  (
    'platform.configuration_admin',
    'Configuration Admin',
    'Manages configuration, provider adapters, workflows, and event definitions.',
    'active',
    '{"admin_role":true,"super_admin":false}'::jsonb
  ),
  (
    'platform.operations_admin',
    'Operations Admin',
    'Manages operational queues, health records, logs, webhooks, and rate limits.',
    'active',
    '{"admin_role":true,"super_admin":false}'::jsonb
  ),
  (
    'platform.audit_admin',
    'Audit Admin',
    'Reads audit trails and governed operational reports.',
    'active',
    '{"admin_role":true,"super_admin":false}'::jsonb
  )
on conflict do nothing;

update public.roles
set display_name = 'Platform Super Admin',
    description = 'Single general manager role with full platform authority.',
    metadata = metadata || '{"admin_role":true,"super_admin":true,"auto_grant_all_permissions":true}'::jsonb,
    updated_at = timezone('utc', now())
where key = 'platform.super_admin'
  and organization_id is null;

update public.roles
set description = 'Configurable platform administrator role. Permissions are assigned through role policy.',
    metadata = metadata || '{"admin_role":true,"super_admin":false}'::jsonb,
    updated_at = timezone('utc', now())
where key = 'platform.admin'
  and organization_id is null;

delete from public.role_permissions role_permission
using public.roles role_record
where role_permission.role_id = role_record.id
  and role_record.key = 'platform.admin'
  and role_record.organization_id is null;

insert into public.role_permissions (role_id, permission_id)
select role_record.id, permission_record.id
from public.roles role_record
cross join public.permissions permission_record
where role_record.key = 'platform.super_admin'
  and role_record.organization_id is null
on conflict do nothing;

with default_admin_permissions(role_key, permission_key) as (
  values
    ('platform.identity_admin', 'platform.admins.read'),
    ('platform.identity_admin', 'platform.admins.manage'),
    ('platform.identity_admin', 'platform.users.read'),
    ('platform.identity_admin', 'platform.users.manage'),
    ('platform.identity_admin', 'platform.organizations.read'),
    ('platform.identity_admin', 'platform.organizations.manage'),
    ('platform.identity_admin', 'platform.roles.read'),
    ('platform.identity_admin', 'platform.roles.manage'),
    ('platform.audit_admin', 'platform.audit.read'),
    ('platform.configuration_admin', 'platform.configuration.read'),
    ('platform.configuration_admin', 'platform.configuration.manage'),
    ('platform.configuration_admin', 'platform.providers.manage'),
    ('platform.configuration_admin', 'platform.workflows.manage'),
    ('platform.configuration_admin', 'platform.events.read'),
    ('platform.configuration_admin', 'platform.events.manage'),
    ('platform.operations_admin', 'platform.logs.read'),
    ('platform.operations_admin', 'platform.jobs.manage'),
    ('platform.operations_admin', 'platform.webhooks.manage'),
    ('platform.operations_admin', 'platform.api_clients.manage'),
    ('platform.operations_admin', 'platform.rate_limits.manage'),
    ('platform.operations_admin', 'platform.cache.manage'),
    ('platform.operations_admin', 'platform.health.read'),
    ('platform.operations_admin', 'platform.health.manage')
)
insert into public.role_permissions (role_id, permission_id)
select role_record.id, permission_record.id
from default_admin_permissions default_permission
join public.roles role_record on role_record.key = default_permission.role_key
join public.permissions permission_record on permission_record.key = default_permission.permission_key
where role_record.organization_id is null
on conflict do nothing;

create table if not exists public.platform_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary_role_id uuid not null references public.roles(id) on delete restrict,
  admin_kind text not null default 'role_admin'
    check (admin_kind in ('super_admin', 'role_admin')),
  title text,
  status text not null default 'active'
    check (status in ('pending', 'active', 'suspended', 'revoked')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id)
);

create unique index if not exists platform_admins_one_active_super_admin
on public.platform_admins ((admin_kind))
where admin_kind = 'super_admin'
  and status = 'active';

create index if not exists platform_admins_role_status_idx
on public.platform_admins (primary_role_id, status);

create or replace function public.is_platform_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_admins admin_record
    join public.user_roles assigned_role on assigned_role.user_id = admin_record.user_id
    join public.roles role_record on role_record.id = assigned_role.role_id
    where admin_record.user_id = auth.uid()
      and admin_record.admin_kind = 'super_admin'
      and admin_record.status = 'active'
      and assigned_role.status = 'active'
      and role_record.key = 'platform.super_admin'
      and role_record.status = 'active'
      and assigned_role.organization_id is null
      and role_record.organization_id is null
      and (assigned_role.ends_at is null or assigned_role.ends_at > timezone('utc', now()))
  );
$$;

create or replace function public.prevent_platform_super_admin_client_mutation()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' and new.admin_kind = 'super_admin' then
    raise exception 'platform super admin can only be configured by service-role bootstrap';
  end if;

  if tg_op = 'UPDATE'
    and (old.admin_kind = 'super_admin' or new.admin_kind = 'super_admin') then
    raise exception 'platform super admin can only be configured by service-role bootstrap';
  end if;

  return new;
end;
$$;

create or replace function public.auto_grant_permission_to_super_admin_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.role_permissions (role_id, permission_id)
  select role_record.id, new.id
  from public.roles role_record
  where role_record.organization_id is null
    and role_record.status = 'active'
    and role_record.metadata ->> 'auto_grant_all_permissions' = 'true'
  on conflict do nothing;

  return new;
end;
$$;

create or replace function public.bootstrap_platform_super_admin(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  super_admin_role_id uuid;
  active_super_admin_user_id uuid;
begin
  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;

  insert into public.profiles (id)
  select auth_user.id
  from auth.users auth_user
  where auth_user.id = target_user_id
  on conflict (id) do nothing;

  if not exists (select 1 from public.profiles profile where profile.id = target_user_id) then
    raise exception 'target_user_id must belong to a real Supabase Auth user';
  end if;

  select user_id into active_super_admin_user_id
  from public.platform_admins
  where admin_kind = 'super_admin'
    and status = 'active'
  limit 1;

  if active_super_admin_user_id is not null
    and active_super_admin_user_id <> target_user_id then
    raise exception 'an active platform super admin is already configured';
  end if;

  select id into super_admin_role_id
  from public.roles
  where key = 'platform.super_admin'
    and organization_id is null;

  if super_admin_role_id is null then
    raise exception 'platform.super_admin role is not configured';
  end if;

  insert into public.role_permissions (role_id, permission_id)
  select super_admin_role_id, permission_record.id
  from public.permissions permission_record
  on conflict do nothing;

  insert into public.platform_admins (
    user_id,
    primary_role_id,
    admin_kind,
    title,
    status,
    metadata
  )
  values (
    target_user_id,
    super_admin_role_id,
    'super_admin',
    'General Manager',
    'active',
    '{"bootstrap":true}'::jsonb
  )
  on conflict (user_id) do update
  set primary_role_id = excluded.primary_role_id,
      admin_kind = 'super_admin',
      title = excluded.title,
      status = 'active',
      metadata = public.platform_admins.metadata || excluded.metadata,
      updated_at = timezone('utc', now());

  insert into public.user_roles (organization_id, user_id, role_id, status)
  values (null, target_user_id, super_admin_role_id, 'active')
  on conflict do nothing;
end;
$$;

create or replace function public.bootstrap_platform_admin(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.bootstrap_platform_super_admin(target_user_id);
end;
$$;

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

  select id into target_role_id
  from public.roles
  where key = target_role_key
    and organization_id is null
    and status = 'active';

  if target_role_id is null then
    raise exception 'target_role_key must reference an active global platform role';
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

create or replace function public.revoke_platform_admin(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_super_admin() then
    raise exception 'only the platform super admin can revoke platform admins';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'platform super admin cannot revoke self';
  end if;

  if exists (
    select 1
    from public.platform_admins admin_record
    where admin_record.user_id = target_user_id
      and admin_record.admin_kind = 'super_admin'
      and admin_record.status = 'active'
  ) then
    raise exception 'platform super admin cannot be revoked by client action';
  end if;

  update public.platform_admins
  set status = 'revoked',
      updated_at = timezone('utc', now())
  where user_id = target_user_id
    and admin_kind = 'role_admin';

  update public.user_roles assigned_role
  set status = 'suspended',
      updated_at = timezone('utc', now())
  from public.roles role_record
  where assigned_role.role_id = role_record.id
    and assigned_role.user_id = target_user_id
    and assigned_role.organization_id is null
    and role_record.metadata ->> 'admin_role' = 'true'
    and role_record.key <> 'platform.super_admin';
end;
$$;

revoke all on function public.bootstrap_platform_super_admin(uuid) from public;
revoke all on function public.bootstrap_platform_super_admin(uuid) from anon;
revoke all on function public.bootstrap_platform_super_admin(uuid) from authenticated;
grant execute on function public.bootstrap_platform_super_admin(uuid) to service_role;

revoke all on function public.bootstrap_platform_admin(uuid) from public;
revoke all on function public.bootstrap_platform_admin(uuid) from anon;
revoke all on function public.bootstrap_platform_admin(uuid) from authenticated;
grant execute on function public.bootstrap_platform_admin(uuid) to service_role;

revoke all on function public.configure_platform_admin(uuid, text, text, jsonb) from public;
revoke all on function public.configure_platform_admin(uuid, text, text, jsonb) from anon;
grant execute on function public.configure_platform_admin(uuid, text, text, jsonb) to authenticated;

revoke all on function public.revoke_platform_admin(uuid) from public;
revoke all on function public.revoke_platform_admin(uuid) from anon;
grant execute on function public.revoke_platform_admin(uuid) to authenticated;

drop trigger if exists set_platform_admins_updated_at on public.platform_admins;
create trigger set_platform_admins_updated_at
before update on public.platform_admins
for each row execute function public.set_updated_at();

drop trigger if exists prevent_platform_super_admin_client_mutation on public.platform_admins;
create trigger prevent_platform_super_admin_client_mutation
before insert or update on public.platform_admins
for each row execute function public.prevent_platform_super_admin_client_mutation();

drop trigger if exists audit_platform_admins_mutations on public.platform_admins;
create trigger audit_platform_admins_mutations
after insert or update or delete on public.platform_admins
for each row execute function public.record_table_audit();

drop trigger if exists auto_grant_permission_to_super_admin_roles on public.permissions;
create trigger auto_grant_permission_to_super_admin_roles
after insert on public.permissions
for each row execute function public.auto_grant_permission_to_super_admin_roles();

alter table public.platform_admins enable row level security;

create policy platform_admins_select_self_or_privileged on public.platform_admins
for select to authenticated
using (
  user_id = auth.uid()
  or public.has_permission('platform.admins.read', null)
  or public.has_permission('platform.admins.manage', null)
);

create policy platform_admins_insert_role_admin_super_admin on public.platform_admins
for insert to authenticated
with check (
  admin_kind = 'role_admin'
  and public.is_platform_super_admin()
);

create policy platform_admins_update_role_admin_super_admin on public.platform_admins
for update to authenticated
using (
  admin_kind = 'role_admin'
  and public.is_platform_super_admin()
)
with check (
  admin_kind = 'role_admin'
  and public.is_platform_super_admin()
);

grant select, insert, update, delete on public.platform_admins to authenticated;
grant select, insert, update, delete on public.platform_admins to service_role;

commit;
