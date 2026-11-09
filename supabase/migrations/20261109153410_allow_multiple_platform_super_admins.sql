begin;

-- Super Admin is a privileged role, but the platform may have more than one
-- active holder. Client-side creation remains blocked; additions still use the
-- service-role bootstrap path.
drop index if exists public.platform_admins_one_active_super_admin;

update public.roles
set description = 'Full platform authority for platform-wide governance and operations. Multiple Super Admins may be active concurrently.',
    metadata = metadata || '{"admin_role":true,"super_admin":true,"auto_grant_all_permissions":true,"multiple_super_admins":true}'::jsonb,
    updated_at = timezone('utc', now())
where key = 'platform.super_admin'
  and organization_id is null;

-- Keep the Super Admin role fully current, including permissions added after
-- the original governance migration.
insert into public.role_permissions (role_id, permission_id)
select role_record.id, permission_record.id
from public.roles role_record
cross join public.permissions permission_record
where role_record.key = 'platform.super_admin'
  and role_record.organization_id is null
on conflict do nothing;

update public.platform_admin_role_templates template_record
set description = 'Full platform authority for platform-wide governance and operations. Multiple Super Admins may be active concurrently.',
    permission_keys = (
      select coalesce(array_agg(permission_record.key order by permission_record.key), '{}'::text[])
      from public.permissions permission_record
    ),
    metadata = template_record.metadata || '{"multiple_super_admins":true}'::jsonb,
    updated_at = timezone('utc', now())
where template_record.key = 'platform.super_admin';

create or replace function public.prevent_platform_super_admin_client_mutation()
returns trigger
language plpgsql
as $$
begin
  -- Trusted database maintenance and service-role bootstrap may manage
  -- Super Admin rows. Authenticated clients may not create or modify them.
  if current_user in ('postgres', 'supabase_admin')
    or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' and new.admin_kind = 'super_admin' then
    raise exception 'platform super admin can only be configured by trusted bootstrap';
  end if;

  if tg_op = 'UPDATE'
    and (old.admin_kind = 'super_admin' or new.admin_kind = 'super_admin') then
    raise exception 'platform super admin can only be configured by trusted bootstrap';
  end if;

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
begin
  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;

  insert into public.profiles (id)
  select auth_user.id
  from auth.users auth_user
  where auth_user.id = target_user_id
  on conflict (id) do nothing;

  if not exists (
    select 1 from public.profiles profile where profile.id = target_user_id
  ) then
    raise exception 'target_user_id must belong to a real Supabase Auth user';
  end if;

  select id into super_admin_role_id
  from public.roles
  where key = 'platform.super_admin'
    and organization_id is null
    and status = 'active';

  if super_admin_role_id is null then
    raise exception 'active platform.super_admin role is not configured';
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
    'Platform Super Admin',
    'active',
    '{"bootstrap":true,"multiple_super_admins":true}'::jsonb
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

commit;