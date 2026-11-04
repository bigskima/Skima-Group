begin;

-- Logistics has its own notification inbox. Keep the shared notification
-- center intact for LPG and other apps, but expose a module-scoped view here.
create or replace function public.is_logistics_app_notification(
  target_purpose text,
  target_payload jsonb,
  target_metadata jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    lower(coalesce(target_purpose, '')) like 'logistics.%'
    or lower(coalesce(target_purpose, '')) like 'logistics_%'
    or lower(coalesce(target_purpose, '')) like 'store.%'
    or lower(coalesce(target_purpose, '')) like 'store_%'
    or lower(coalesce(
      nullif(target_metadata ->> 'module', ''),
      nullif(target_metadata ->> 'module_key', ''),
      nullif(target_payload ->> 'module', ''),
      nullif(target_payload ->> 'moduleKey', ''),
      nullif(target_payload ->> 'module_key', ''),
      nullif(target_payload ->> 'category', ''),
      ''
    )) in ('logistics', 'logistics_network', 'store', 'skima_store')
    or (
      lower(coalesce(target_purpose, '')) = 'organization.staff.invitation'
      and exists (
        select 1
        from public.organization_invitations invitation
        where invitation.id = case
          when coalesce(target_payload ->> 'invitationId', target_payload ->> 'invitation_id', '')
            ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then coalesce(target_payload ->> 'invitationId', target_payload ->> 'invitation_id')::uuid
          else null::uuid
        end
          and (
            lower(coalesce(invitation.metadata ->> 'module', '')) = 'logistics_network'
            or coalesce(invitation.source, '') like 'skima.logistics%'
          )
      )
    );
$$;

revoke all on function public.is_logistics_app_notification(text, jsonb, jsonb)
from public, anon, authenticated;

create or replace function public.read_logistics_notification_center(
  target_limit integer default 20,
  target_offset integer default 0,
  target_include_read boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  resolved_user_id uuid := auth.uid();
  resolved_limit integer := least(greatest(coalesce(target_limit, 20), 1), 100);
  resolved_offset integer := greatest(coalesce(target_offset, 0), 0);
  result_items jsonb;
  unread_count integer;
  total_count integer;
  visible_count integer;
begin
  if resolved_user_id is null then
    raise exception 'authenticated user context is required';
  end if;

  with accessible as (
    select message.id, state.read_at, state.hidden_at
    from public.communication_messages message
    left join public.communication_message_user_states state
      on state.communication_message_id = message.id
     and state.user_id = resolved_user_id
    where public.user_can_read_communication_message(resolved_user_id, message.id)
      and public.is_logistics_app_notification(message.purpose, message.payload, message.metadata)
      and state.hidden_at is null
  )
  select
    count(*) filter (where read_at is null)::integer,
    count(*)::integer
  into unread_count, total_count
  from accessible;

  with accessible as (
    select
      message.id,
      message.channel,
      message.purpose,
      message.status,
      message.payload,
      message.metadata,
      message.created_at,
      state.read_at
    from public.communication_messages message
    left join public.communication_message_user_states state
      on state.communication_message_id = message.id
     and state.user_id = resolved_user_id
    where public.user_can_read_communication_message(resolved_user_id, message.id)
      and public.is_logistics_app_notification(message.purpose, message.payload, message.metadata)
      and state.hidden_at is null
      and (coalesce(target_include_read, true) or state.read_at is null)
    order by message.created_at desc, message.id desc
    offset resolved_offset
    limit resolved_limit
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', id,
      'channel', channel,
      'purpose', purpose,
      'status', status,
      'payload', payload,
      'metadata', metadata,
      'createdAt', created_at,
      'readAt', read_at,
      'isRead', read_at is not null
    ) order by created_at desc, id desc), '[]'::jsonb),
    count(*)::integer
  into result_items, visible_count
  from accessible;

  return jsonb_build_object(
    'items', result_items,
    'unreadCount', coalesce(unread_count, 0),
    'totalCount', coalesce(total_count, 0),
    'offset', resolved_offset,
    'limit', resolved_limit,
    'hasMore', resolved_offset + coalesce(visible_count, 0) < case
      when coalesce(target_include_read, true) then coalesce(total_count, 0)
      else coalesce(unread_count, 0)
    end
  );
end;
$$;

revoke all on function public.read_logistics_notification_center(integer, integer, boolean)
from public, anon;
grant execute on function public.read_logistics_notification_center(integer, integer, boolean)
to authenticated, service_role;

create or replace function public.mark_all_logistics_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_user_id uuid := auth.uid();
  affected integer := 0;
begin
  if resolved_user_id is null then
    raise exception 'authenticated user context is required';
  end if;

  insert into public.communication_message_user_states (
    communication_message_id,
    user_id,
    read_at,
    hidden_at,
    updated_at
  )
  select
    message.id,
    resolved_user_id,
    timezone('utc', now()),
    null,
    timezone('utc', now())
  from public.communication_messages message
  where public.user_can_read_communication_message(resolved_user_id, message.id)
    and public.is_logistics_app_notification(message.purpose, message.payload, message.metadata)
  on conflict (communication_message_id, user_id)
  do update set
    read_at = coalesce(public.communication_message_user_states.read_at, excluded.read_at),
    updated_at = excluded.updated_at;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.mark_all_logistics_notifications_read()
from public, anon;
grant execute on function public.mark_all_logistics_notifications_read()
to authenticated, service_role;

-- Invitations still use the recipient's account email as an identity lookup.
-- Delivery is exclusively to the in-app inbox: there is no email-channel send.
create or replace function public.notify_organization_invitation_in_app()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  organization_name text;
  station_name text;
  role_name text;
  message_title text;
  message_body text;
  message_payload jsonb;
  is_logistics_company boolean;
begin
  if new.invited_user_id is null then
    return new;
  end if;

  is_logistics_company :=
    lower(coalesce(new.metadata ->> 'module', '')) = 'logistics_network'
    or coalesce(new.source, '') like 'skima.logistics%';

  select organization.display_name
  into organization_name
  from public.organizations organization
  where organization.id = new.organization_id;

  select coalesce(
    (
      select station.display_name
      from public.lpg_station_branches station
      where station.organization_id = new.organization_id
        and station.branch_id is not distinct from new.branch_id
      limit 1
    ),
    (
      select branch.display_name
      from public.organization_branches branch
      where branch.id = new.branch_id
      limit 1
    ),
    organization_name
  )
  into station_name;

  select role.display_name
  into role_name
  from public.roles role
  where role.id = new.role_id;

  organization_name := coalesce(nullif(btrim(organization_name), ''), 'Logistics company');
  station_name := coalesce(nullif(btrim(station_name), ''), organization_name);
  role_name := coalesce(nullif(btrim(role_name), ''), 'Team member');

  if is_logistics_company then
    case new.status
      when 'pending' then
        message_title := 'Company workspace invitation';
        message_body := format('%s invited you to join their Logistics workspace as a %s.', organization_name, role_name);
      when 'accepted' then
        message_title := 'Company invitation accepted';
        message_body := format('You joined the %s Logistics workspace as a %s.', organization_name, role_name);
      when 'declined' then
        message_title := 'Company invitation declined';
        message_body := format('You declined the Logistics workspace invitation from %s.', organization_name);
      when 'expired' then
        message_title := 'Company invitation expired';
        message_body := format('The Logistics workspace invitation from %s has expired.', organization_name);
      else
        message_title := 'Company invitation unavailable';
        message_body := format('The Logistics workspace invitation from %s is no longer available.', organization_name);
    end case;
  else
    case new.status
      when 'pending' then
        message_title := 'Station invitation';
        message_body := format('%s has invited you to join their team as a %s.', station_name, role_name);
      when 'accepted' then
        message_title := 'Invitation accepted';
        message_body := format('You joined %s as a %s.', station_name, role_name);
      when 'declined' then
        message_title := 'Invitation declined';
        message_body := format('You declined the invitation from %s.', station_name);
      when 'expired' then
        message_title := 'Invitation expired';
        message_body := format('The invitation from %s has expired.', station_name);
      else
        message_title := 'Invitation no longer available';
        message_body := format('The invitation from %s is no longer available.', station_name);
    end case;
  end if;

  message_payload := jsonb_strip_nulls(jsonb_build_object(
    'title', message_title,
    'body', message_body,
    'category', case when is_logistics_company then 'logistics' else 'partner' end,
    'module', case when is_logistics_company then 'logistics_network' else 'partner' end,
    'invitationId', new.id,
    'organizationId', new.organization_id,
    'branchId', new.branch_id,
    'organizationName', organization_name,
    'stationName', station_name,
    'roleDisplayName', role_name,
    'invitationStatus', new.status,
    'expiresAt', new.expires_at,
    'deepLink', case
      when is_logistics_company then '/notifications?invitationId=' || new.id::text
      else '/invitations/' || new.id::text
    end
  ));

  insert into public.communication_messages (
    channel,
    purpose,
    recipient_entity_type,
    recipient_entity_id,
    recipient_address,
    status,
    payload,
    source,
    idempotency_key,
    metadata,
    created_by
  ) values (
    'in_app',
    'organization.staff.invitation',
    'user',
    new.invited_user_id,
    null,
    'queued',
    message_payload,
    'skima.organization.invitation',
    'organization-invitation:' || new.id::text,
    jsonb_build_object(
      'invitationId', new.id,
      'organizationId', new.organization_id,
      'invitationStatus', new.status,
      'module', case when is_logistics_company then 'logistics_network' else 'partner' end
    ),
    new.invited_by
  )
  on conflict (source, idempotency_key) do update
  set recipient_entity_id = excluded.recipient_entity_id,
      payload = excluded.payload,
      metadata = public.communication_messages.metadata || excluded.metadata,
      updated_at = timezone('utc', now());

  return new;
end;
$$;

-- Make existing Logistics invitation cards recognisable to the Logistics inbox.
update public.communication_messages message
set payload = message.payload || jsonb_build_object(
      'module', 'logistics_network',
      'category', 'logistics'
    ),
    metadata = message.metadata || jsonb_build_object(
      'module', 'logistics_network'
    ),
    updated_at = timezone('utc', now())
from public.organization_invitations invitation
where message.purpose = 'organization.staff.invitation'
  and coalesce(message.payload ->> 'invitationId', message.payload ->> 'invitation_id', '')
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and invitation.id = coalesce(
    message.payload ->> 'invitationId',
    message.payload ->> 'invitation_id'
  )::uuid
  and (
    lower(coalesce(invitation.metadata ->> 'module', '')) = 'logistics_network'
    or coalesce(invitation.source, '') like 'skima.logistics%'
  );

-- Rebuild existing invite payloads with the new Logistics-specific wording.
update public.organization_invitations invitation
set status = invitation.status
where (
    lower(coalesce(invitation.metadata ->> 'module', '')) = 'logistics_network'
    or coalesce(invitation.source, '') like 'skima.logistics%'
  )
  and invitation.invited_user_id is not null;

commit;
