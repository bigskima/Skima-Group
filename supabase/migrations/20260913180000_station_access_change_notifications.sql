begin;

create or replace function public.queue_organization_membership_change_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  organization_record record;
  is_station_organization boolean := false;
  notification_title text;
  notification_body text;
  event_key text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'invited' then
    return new;
  end if;

  select organization.*
  into organization_record
  from public.organizations organization
  where organization.id = new.organization_id;

  select exists (
    select 1
    from public.lpg_station_branches station
    where station.organization_id = new.organization_id
  ) into is_station_organization;

  if not is_station_organization then
    return new;
  end if;

  notification_title := case new.status
    when 'active' then 'Station access granted'
    when 'suspended' then 'Station access suspended'
    when 'removed' then 'Station access revoked'
    else 'Station access updated'
  end;

  notification_body := case new.status
    when 'active' then 'You can now access ' || coalesce(organization_record.display_name, 'this SKIMA Station') || ' using your assigned Station role.'
    when 'suspended' then 'Your access to ' || coalesce(organization_record.display_name, 'this SKIMA Station') || ' has been suspended. Contact the Station Owner if you believe this is incorrect.'
    when 'removed' then 'Your access to ' || coalesce(organization_record.display_name, 'this SKIMA Station') || ' has been revoked.'
    else 'Your Station access changed.'
  end;

  event_key := 'station-membership:' || new.id::text || ':' || new.status || ':' || extract(epoch from coalesce(new.updated_at, timezone('utc', now())))::bigint::text;

  begin
    perform public.queue_communication_message(
      'in_app',
      'station.access.' || new.status,
      'user',
      new.user_id,
      null,
      jsonb_build_object(
        'title', notification_title,
        'body', notification_body,
        'category', 'partner',
        'deepLink', '/(station)/account',
        'organizationId', new.organization_id,
        'membershipId', new.id,
        'status', new.status
      ),
      'provider.communication.sandbox',
      'platform.station_access_notifications',
      event_key,
      jsonb_build_object(
        'organization_id', new.organization_id,
        'membership_id', new.id,
        'status', new.status
      )
    );
  exception when others then
    null;
  end;

  return new;
end;
$$;

drop trigger if exists organization_membership_change_notification_trigger on public.organization_memberships;
create trigger organization_membership_change_notification_trigger
after insert or update of status on public.organization_memberships
for each row execute function public.queue_organization_membership_change_notification();

create or replace function public.queue_station_role_change_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  assignment_record public.user_roles%rowtype;
  role_record record;
  organization_record record;
  membership_record record;
  recently_accepted_invitation boolean := false;
  notification_title text;
  notification_body text;
  event_status text;
  event_key text;
begin
  assignment_record := case when tg_op = 'DELETE' then old else new end;

  if assignment_record.organization_id is null or assignment_record.user_id is null then
    return coalesce(new, old);
  end if;

  if not exists (
    select 1
    from public.lpg_station_branches station
    where station.organization_id = assignment_record.organization_id
  ) then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.role_id is not distinct from old.role_id
     and new.branch_id is not distinct from old.branch_id then
    return new;
  end if;

  select role.* into role_record
  from public.roles role
  where role.id = assignment_record.role_id;

  select organization.* into organization_record
  from public.organizations organization
  where organization.id = assignment_record.organization_id;

  select membership.* into membership_record
  from public.organization_memberships membership
  where membership.organization_id = assignment_record.organization_id
    and membership.user_id = assignment_record.user_id
  order by membership.updated_at desc
  limit 1;

  if tg_op = 'INSERT' then
    select exists (
      select 1
      from public.organization_invitations invitation
      where invitation.organization_id = assignment_record.organization_id
        and invitation.invited_user_id = assignment_record.user_id
        and invitation.role_id = assignment_record.role_id
        and invitation.status = 'accepted'
        and invitation.accepted_at >= timezone('utc', now()) - interval '5 minutes'
    ) into recently_accepted_invitation;

    if recently_accepted_invitation then
      return new;
    end if;
  end if;

  event_status := case
    when tg_op = 'DELETE' then 'removed'
    when assignment_record.status = 'active' then 'active'
    when assignment_record.status = 'suspended' then 'suspended'
    else 'expired'
  end;

  notification_title := case event_status
    when 'active' then case when tg_op = 'INSERT' then 'Station role assigned' else 'Station role updated' end
    when 'suspended' then 'Station role suspended'
    when 'expired' then 'Station role expired'
    when 'removed' then 'Station role removed'
    else 'Station role updated'
  end;

  notification_body := case event_status
    when 'active' then 'Your role for ' || coalesce(organization_record.display_name, 'this SKIMA Station') || ' is now ' || coalesce(role_record.display_name, 'an assigned Station role') || '.'
    when 'suspended' then 'Your ' || coalesce(role_record.display_name, 'Station') || ' role is suspended.'
    when 'expired' then 'Your ' || coalesce(role_record.display_name, 'Station') || ' role has expired.'
    when 'removed' then 'Your ' || coalesce(role_record.display_name, 'Station') || ' role was removed.'
    else 'Your Station role changed.'
  end;

  event_key := 'station-role:' || assignment_record.id::text || ':' || event_status || ':' || extract(epoch from timezone('utc', now()))::bigint::text;

  begin
    perform public.queue_communication_message(
      'in_app',
      'station.role.' || event_status,
      'user',
      assignment_record.user_id,
      null,
      jsonb_build_object(
        'title', notification_title,
        'body', notification_body,
        'category', 'partner',
        'deepLink', '/(station)/account',
        'organizationId', assignment_record.organization_id,
        'roleId', assignment_record.role_id,
        'roleKey', role_record.key,
        'branchId', assignment_record.branch_id,
        'status', event_status
      ),
      'provider.communication.sandbox',
      'platform.station_access_notifications',
      event_key,
      jsonb_build_object(
        'organization_id', assignment_record.organization_id,
        'role_assignment_id', assignment_record.id,
        'status', event_status
      )
    );
  exception when others then
    null;
  end;

  return coalesce(new, old);
end;
$$;

drop trigger if exists station_role_change_notification_insert_trigger on public.user_roles;
create trigger station_role_change_notification_insert_trigger
after insert on public.user_roles
for each row execute function public.queue_station_role_change_notification();

drop trigger if exists station_role_change_notification_update_trigger on public.user_roles;
create trigger station_role_change_notification_update_trigger
after update of status, role_id, branch_id on public.user_roles
for each row execute function public.queue_station_role_change_notification();

drop trigger if exists station_role_change_notification_delete_trigger on public.user_roles;
create trigger station_role_change_notification_delete_trigger
after delete on public.user_roles
for each row execute function public.queue_station_role_change_notification();

revoke all on function public.queue_organization_membership_change_notification() from public, anon, authenticated;
revoke all on function public.queue_station_role_change_notification() from public, anon, authenticated;
grant execute on function public.queue_organization_membership_change_notification() to service_role;
grant execute on function public.queue_station_role_change_notification() to service_role;

commit;
