begin;

-- Order-bound customer/company conversation. Messages are never exposed through a
-- global inbox; access is derived from the booking's existing participants.
create table if not exists public.logistics_booking_chat_messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.logistics_bookings(id) on delete restrict,
  sender_user_id uuid not null references public.profiles(id) on delete restrict,
  message_type text not null default 'text'
    check (message_type in ('text', 'image', 'video', 'audio', 'file')),
  message text,
  attachment_path text,
  attachment_name text,
  attachment_mime_type text,
  attachment_size_bytes bigint,
  reply_to_message_id uuid,
  idempotency_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, booking_id),
  unique (sender_user_id, idempotency_key),
  foreign key (reply_to_message_id, booking_id)
    references public.logistics_booking_chat_messages(id, booking_id) on delete restrict,
  check (
    (message_type = 'text' and attachment_path is null
      and char_length(btrim(coalesce(message, ''))) between 1 and 4000)
    or
    (message_type <> 'text'
      and attachment_path is not null and char_length(btrim(attachment_path)) between 1 and 700
      and attachment_name is not null and char_length(btrim(attachment_name)) between 1 and 255
      and attachment_mime_type is not null and char_length(btrim(attachment_mime_type)) between 3 and 160
      and attachment_size_bytes between 1 and 52428800
      and char_length(coalesce(message, '')) <= 4000)
  ),
  check (message is null or char_length(message) <= 4000)
);

create index if not exists logistics_booking_chat_messages_booking_created_idx
  on public.logistics_booking_chat_messages (booking_id, created_at, id);

create index if not exists logistics_booking_chat_messages_unread_idx
  on public.logistics_booking_chat_messages (booking_id, sender_user_id)
  where read_at is null;

create or replace function public.can_access_logistics_booking_chat(target_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_booking_id is not null
    and auth.uid() is not null
    and exists (
      select 1
      from public.logistics_bookings booking
      where booking.id = target_booking_id
        and (
          booking.requester_user_id = auth.uid()
          or public.can_read_logistics_company(booking.provider_organization_id)
          or public.has_permission('logistics.marketplace.manage', null)
        )
    );
$$;

create or replace function public.can_read_logistics_booking_chat_attachment(target_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  booking_folder text;
  booking_id_value uuid;
begin
  if target_object_name is null or target_object_name !~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[^/]{1,255}$' then
    return false;
  end if;
  booking_folder := split_part(target_object_name, '/', 1);
  begin
    booking_id_value := booking_folder::uuid;
  exception when others then
    return false;
  end;
  return public.can_access_logistics_booking_chat(booking_id_value);
end;
$$;

create or replace function public.can_upload_logistics_booking_chat_attachment(target_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  booking_folder text;
  sender_folder text;
  booking_id_value uuid;
begin
  if auth.uid() is null
    or target_object_name is null
    or target_object_name !~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[^/]{1,255}$' then
    return false;
  end if;
  booking_folder := split_part(target_object_name, '/', 1);
  sender_folder := split_part(target_object_name, '/', 2);
  if lower(sender_folder) <> lower(auth.uid()::text) then return false; end if;
  begin
    booking_id_value := booking_folder::uuid;
  exception when others then
    return false;
  end;
  return public.can_access_logistics_booking_chat(booking_id_value);
end;
$$;

create or replace function public.can_delete_unused_logistics_booking_chat_attachment(target_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  booking_folder text;
  sender_folder text;
  booking_id_value uuid;
begin
  if auth.uid() is null
    or target_object_name is null
    or target_object_name !~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[^/]{1,255}$' then
    return false;
  end if;
  booking_folder := split_part(target_object_name, '/', 1);
  sender_folder := split_part(target_object_name, '/', 2);
  if lower(sender_folder) <> lower(auth.uid()::text) then return false; end if;
  begin
    booking_id_value := booking_folder::uuid;
  exception when others then
    return false;
  end;
  return public.can_access_logistics_booking_chat(booking_id_value)
    and not exists (
      select 1 from public.logistics_booking_chat_messages message
      where message.attachment_path = target_object_name
    );
end;
$$;

create or replace function public.send_logistics_booking_chat_message(
  target_booking_id uuid,
  target_message text,
  target_message_type text default 'text',
  target_attachment_path text default null,
  target_attachment_name text default null,
  target_attachment_mime_type text default null,
  target_attachment_size_bytes bigint default null,
  target_reply_to_message_id uuid default null,
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  actor uuid := auth.uid();
  message_id uuid;
  message_type_value text := coalesce(target_message_type, 'text');
  message_value text := nullif(btrim(coalesce(target_message, '')), '');
  existing public.logistics_booking_chat_messages%rowtype;
begin
  if actor is null then raise exception 'authentication is required'; end if;
  if not public.can_access_logistics_booking_chat(target_booking_id) then
    raise exception 'only this booking customer and provider company may use its chat';
  end if;
  if target_idempotency_key is null or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'valid chat message idempotency key is required';
  end if;
  if message_type_value not in ('text', 'image', 'video', 'audio', 'file') then
    raise exception 'unsupported chat message type';
  end if;
  if message_value is not null and char_length(message_value) > 4000 then
    raise exception 'chat message or attachment caption cannot exceed 4000 characters';
  end if;

  if message_type_value = 'text' then
    if target_attachment_path is not null or message_value is null then
      raise exception 'text chat messages must contain text and no attachment';
    end if;
  else
    if message_value is null and target_message is not null and char_length(target_message) > 4000 then
      raise exception 'attachment caption cannot exceed 4000 characters';
    end if;
    if target_attachment_path is null or target_attachment_name is null
      or target_attachment_mime_type is null or target_attachment_size_bytes is null
      or target_attachment_size_bytes not between 1 and 52428800 then
      raise exception 'a valid attachment path, name, MIME type and size up to 50 MiB are required';
    end if;
    if target_attachment_path !~ (
      '^' || target_booking_id::text || '/' || actor::text || '/[^/]{1,255}$'
    ) then
      raise exception 'chat attachment must be stored under this booking and the authenticated sender';
    end if;
    if not exists (
      select 1 from storage.objects object
      where object.bucket_id = 'logistics-booking-chat'
        and object.name = target_attachment_path
        and object.owner_id = actor::text
    ) then
      raise exception 'uploaded chat attachment was not found or is not owned by this sender';
    end if;
    if char_length(btrim(target_attachment_name)) not between 1 and 255
      or char_length(btrim(target_attachment_mime_type)) not between 3 and 160 then
      raise exception 'attachment name and MIME type are invalid';
    end if;
  end if;

  if target_reply_to_message_id is not null and not exists (
    select 1 from public.logistics_booking_chat_messages reply
    where reply.id = target_reply_to_message_id and reply.booking_id = target_booking_id
  ) then
    raise exception 'reply target must belong to the same booking conversation';
  end if;

  insert into public.logistics_booking_chat_messages (
    booking_id, sender_user_id, message_type, message,
    attachment_path, attachment_name, attachment_mime_type, attachment_size_bytes,
    reply_to_message_id, idempotency_key
  )
  values (
    target_booking_id, actor, message_type_value, message_value,
    target_attachment_path, target_attachment_name, target_attachment_mime_type, target_attachment_size_bytes,
    target_reply_to_message_id, btrim(target_idempotency_key)
  )
  on conflict (sender_user_id, idempotency_key) do nothing
  returning id into message_id;

  if message_id is null then
    select * into existing
    from public.logistics_booking_chat_messages
    where sender_user_id = actor and idempotency_key = btrim(target_idempotency_key);
    if existing.id is null
      or existing.booking_id <> target_booking_id
      or existing.message_type <> message_type_value
      or existing.message is distinct from message_value
      or existing.attachment_path is distinct from target_attachment_path
      or existing.attachment_name is distinct from target_attachment_name
      or existing.attachment_mime_type is distinct from target_attachment_mime_type
      or existing.attachment_size_bytes is distinct from target_attachment_size_bytes
      or existing.reply_to_message_id is distinct from target_reply_to_message_id then
      raise exception 'chat idempotency key was reused with different message details';
    end if;
    message_id := existing.id;
  end if;

  return message_id;
end;
$$;

create or replace function public.mark_logistics_booking_chat_read(target_booking_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_count integer;
begin
  if auth.uid() is null then raise exception 'authentication is required'; end if;
  if not public.can_access_logistics_booking_chat(target_booking_id) then
    raise exception 'only this booking customer and provider company may read its chat';
  end if;

  update public.logistics_booking_chat_messages
  set read_at = timezone('utc', now())
  where booking_id = target_booking_id
    and sender_user_id <> auth.uid()
    and read_at is null;
  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;

alter table public.logistics_booking_chat_messages enable row level security;
revoke all on table public.logistics_booking_chat_messages from anon, authenticated;
grant select on table public.logistics_booking_chat_messages to authenticated;

drop policy if exists logistics_booking_chat_messages_read_participants on public.logistics_booking_chat_messages;
create policy logistics_booking_chat_messages_read_participants
  on public.logistics_booking_chat_messages
  for select to authenticated
  using (public.can_access_logistics_booking_chat(booking_id));

revoke all on function public.can_access_logistics_booking_chat(uuid) from public, anon;
revoke all on function public.can_read_logistics_booking_chat_attachment(text) from public, anon;
revoke all on function public.can_upload_logistics_booking_chat_attachment(text) from public, anon;
revoke all on function public.can_delete_unused_logistics_booking_chat_attachment(text) from public, anon;
revoke all on function public.send_logistics_booking_chat_message(uuid,text,text,text,text,text,bigint,uuid,text) from public, anon;
revoke all on function public.mark_logistics_booking_chat_read(uuid) from public, anon;
grant execute on function public.can_access_logistics_booking_chat(uuid) to authenticated;
grant execute on function public.can_read_logistics_booking_chat_attachment(text) to authenticated;
grant execute on function public.can_upload_logistics_booking_chat_attachment(text) to authenticated;
grant execute on function public.can_delete_unused_logistics_booking_chat_attachment(text) to authenticated;
grant execute on function public.send_logistics_booking_chat_message(uuid,text,text,text,text,text,bigint,uuid,text) to authenticated;
grant execute on function public.mark_logistics_booking_chat_read(uuid) to authenticated;

-- A private bucket keeps order media non-public even when an attachment URL is shared.
insert into storage.buckets (id, name, public, file_size_limit)
values ('logistics-booking-chat', 'logistics-booking-chat', false, 52428800)
on conflict (id) do update
set public = false, file_size_limit = 52428800;

drop policy if exists logistics_booking_chat_media_read_participants on storage.objects;
create policy logistics_booking_chat_media_read_participants
  on storage.objects for select to authenticated
  using (
    bucket_id = 'logistics-booking-chat'
    and public.can_read_logistics_booking_chat_attachment(name)
  );

drop policy if exists logistics_booking_chat_media_upload_sender on storage.objects;
create policy logistics_booking_chat_media_upload_sender
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'logistics-booking-chat'
    and public.can_upload_logistics_booking_chat_attachment(name)
  );

drop policy if exists logistics_booking_chat_media_delete_unused_sender on storage.objects;
create policy logistics_booking_chat_media_delete_unused_sender
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'logistics-booking-chat'
    and public.can_delete_unused_logistics_booking_chat_attachment(name)
  );

-- Postgres Changes broadcasts only rows the subscriber is permitted to SELECT.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'logistics_booking_chat_messages'
    ) then
    alter publication supabase_realtime add table public.logistics_booking_chat_messages;
  end if;
end;
$$;

commit;
