begin;

create table if not exists public.communication_message_user_states (
  communication_message_id uuid not null references public.communication_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz,
  hidden_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (communication_message_id, user_id)
);

create index if not exists communication_message_user_states_user_read_idx
on public.communication_message_user_states (user_id, read_at, updated_at desc);

alter table public.communication_message_user_states enable row level security;

drop policy if exists communication_message_user_states_owner_read on public.communication_message_user_states;
create policy communication_message_user_states_owner_read
on public.communication_message_user_states
for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists communication_message_user_states_owner_insert on public.communication_message_user_states;
create policy communication_message_user_states_owner_insert
on public.communication_message_user_states
for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists communication_message_user_states_owner_update on public.communication_message_user_states;
create policy communication_message_user_states_owner_update
on public.communication_message_user_states
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create or replace function public.user_can_read_communication_message(
  target_user_id uuid,
  target_message_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.communication_messages message
    where message.id = target_message_id
      and message.channel = 'in_app'
      and message.status not in ('cancelled', 'dead_lettered')
      and (
        (message.recipient_entity_type in ('user', 'profile') and message.recipient_entity_id = target_user_id)
        or (
          message.recipient_entity_type = 'organization'
          and exists (
            select 1
            from public.organization_memberships membership
            where membership.organization_id = message.recipient_entity_id
              and membership.user_id = target_user_id
              and membership.status = 'active'
          )
        )
      )
  );
$$;

create or replace function public.read_notification_center(
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
      and state.hidden_at is null
      and (target_include_read or state.read_at is null)
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
      when target_include_read then coalesce(total_count, 0)
      else coalesce(unread_count, 0)
    end
  );
end;
$$;

create or replace function public.mark_notification_read(
  target_message_id uuid,
  target_read boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_user_id uuid := auth.uid();
begin
  if resolved_user_id is null then
    raise exception 'authenticated user context is required';
  end if;
  if target_message_id is null then
    raise exception 'target_message_id is required';
  end if;
  if not public.user_can_read_communication_message(resolved_user_id, target_message_id) then
    raise exception 'notification access permission is required';
  end if;

  insert into public.communication_message_user_states (
    communication_message_id,
    user_id,
    read_at,
    hidden_at,
    updated_at
  )
  values (
    target_message_id,
    resolved_user_id,
    case when target_read then timezone('utc', now()) else null end,
    null,
    timezone('utc', now())
  )
  on conflict (communication_message_id, user_id)
  do update set
    read_at = excluded.read_at,
    updated_at = excluded.updated_at;

  return target_message_id;
end;
$$;

create or replace function public.mark_all_notifications_read()
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
  on conflict (communication_message_id, user_id)
  do update set
    read_at = coalesce(public.communication_message_user_states.read_at, excluded.read_at),
    updated_at = excluded.updated_at;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.user_can_read_communication_message(uuid, uuid) from public, anon, authenticated;
grant execute on function public.user_can_read_communication_message(uuid, uuid) to service_role;

revoke all on function public.read_notification_center(integer, integer, boolean) from public, anon;
grant execute on function public.read_notification_center(integer, integer, boolean) to authenticated, service_role;

revoke all on function public.mark_notification_read(uuid, boolean) from public, anon;
grant execute on function public.mark_notification_read(uuid, boolean) to authenticated, service_role;

revoke all on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.mark_all_notifications_read() to authenticated, service_role;

commit;
