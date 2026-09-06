begin;

-- Platform Super Admin is the root platform operator. New platform-scoped
-- permissions must never leave that role unable to use a platform workspace.
-- Several newer geography/coverage/inventory permissions were created after
-- the Super Admin template and were not reconciled into the template or role.

do $$
begin
  if not exists (
    select 1
    from public.roles
    where key = 'platform.super_admin'
      and organization_id is null
      and status = 'active'
  ) then
    raise exception using
      errcode = '55000',
      message = 'active platform.super_admin role is required';
  end if;

  if not exists (
    select 1
    from public.platform_admin_role_templates
    where key = 'platform.super_admin'
      and status = 'active'
  ) then
    raise exception using
      errcode = '55000',
      message = 'active platform.super_admin role template is required';
  end if;
end
$$;

update public.platform_admin_role_templates template
set permission_keys = (
      select array_agg(permission_key order by permission_key)
      from (
        select distinct permission_key
        from (
          select unnest(coalesce(template.permission_keys, array[]::text[])) as permission_key
          union all
          select permission_record.key
          from public.permissions permission_record
          where permission_record.key like 'platform.%'
        ) combined
      ) deduplicated
    ),
    updated_at = timezone('utc', now())
where template.key = 'platform.super_admin'
  and template.status = 'active';

insert into public.role_permissions (
  role_id,
  permission_id,
  conditions
)
select
  role_record.id,
  permission_record.id,
  '{}'::jsonb
from public.roles role_record
join public.permissions permission_record
  on permission_record.key like 'platform.%'
where role_record.key = 'platform.super_admin'
  and role_record.organization_id is null
  and role_record.status = 'active'
on conflict (role_id, permission_id) do nothing;

-- Keep explicit role grants as the inspectable source of truth, while also
-- making the root-admin contract resilient to a future migration that adds a
-- platform.* permission but forgets to backfill role_permissions immediately.
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
  select
    (
      coalesce(target_permission like 'platform.%', false)
      and public.is_platform_super_admin()
    )
    or exists (
      select 1
      from public.user_roles assigned_role
      join public.roles role_record
        on role_record.id = assigned_role.role_id
      join public.role_permissions role_permission
        on role_permission.role_id = role_record.id
      join public.permissions permission_record
        on permission_record.id = role_permission.permission_id
      where assigned_role.user_id = auth.uid()
        and assigned_role.status = 'active'
        and role_record.status = 'active'
        and permission_record.key = target_permission
        and (
          assigned_role.ends_at is null
          or assigned_role.ends_at > timezone('utc', now())
        )
        and (
          assigned_role.organization_id is null
          or exists (
            select 1
            from public.organization_memberships membership
            where membership.organization_id = assigned_role.organization_id
              and membership.user_id = auth.uid()
              and membership.status = 'active'
          )
        )
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

comment on function public.has_permission(text, uuid) is
  'Checks explicit active role permissions. Active Platform Super Admins also satisfy every platform.* permission so newly introduced platform controls cannot accidentally lock out the root administrator.';

commit;
