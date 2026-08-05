create or replace function public.read_organization_staff_directory(
  target_organization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if target_organization_id is null then
    raise exception 'target_organization_id is required';
  end if;

  if auth.role() <> 'service_role'
    and not public.can_manage_organization_staff(target_organization_id) then
    raise exception 'organization staff management permission is required';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'membershipId', membership.id,
        'userId', membership.user_id,
        'displayName', profile.display_name,
        'avatarUrl', profile.avatar_url,
        'email', auth_user.email,
        'membershipType', membership.membership_type,
        'status', membership.status,
        'createdAt', membership.created_at,
        'updatedAt', membership.updated_at,
        'roles', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'assignmentId', assignment.id,
              'roleId', role_record.id,
              'roleKey', role_record.key,
              'roleName', role_record.display_name,
              'branchId', assignment.branch_id,
              'branchName', branch.display_name,
              'accessScope', assignment.access_scope,
              'status', assignment.status,
              'startsAt', assignment.starts_at,
              'endsAt', assignment.ends_at
            ) order by role_record.display_name asc
          )
          from public.user_roles assignment
          join public.roles role_record on role_record.id = assignment.role_id
          left join public.organization_branches branch on branch.id = assignment.branch_id
          where assignment.organization_id = target_organization_id
            and assignment.user_id = membership.user_id
        ), '[]'::jsonb)
      ) order by profile.display_name asc nulls last, auth_user.email asc
    )
    from public.organization_memberships membership
    join public.profiles profile on profile.id = membership.user_id
    left join auth.users auth_user on auth_user.id = membership.user_id
    where membership.organization_id = target_organization_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.read_organization_staff_directory(uuid) from public, anon;
grant execute on function public.read_organization_staff_directory(uuid) to authenticated, service_role;
