begin;

create or replace function public.can_manage_lpg_operations()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.role() = 'service_role'
    or exists (
      select 1
      from public.user_roles assigned_role
      join public.roles role_record on role_record.id = assigned_role.role_id
      join public.role_permissions role_permission on role_permission.role_id = role_record.id
      join public.permissions permission_record on permission_record.id = role_permission.permission_id
      where assigned_role.user_id = auth.uid()
        and assigned_role.organization_id is null
        and assigned_role.branch_id is null
        and assigned_role.status = 'active'
        and role_record.organization_id is null
        and role_record.status = 'active'
        and permission_record.key in (
          'lpg.orders.manage',
          'lpg.cylinders.manage',
          'lpg.safety.manage',
          'lpg.dispatch.execute',
          'lpg.config.manage'
        )
        and (assigned_role.ends_at is null or assigned_role.ends_at > timezone('utc', now()))
    );
$$;

commit;
