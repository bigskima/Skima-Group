-- Shared, app-scoped customer support and configurable social directory.
-- Existing support threads are retained and assigned to the Refill app by default.

create table if not exists public.support_apps (
  app_key text primary key check (app_key ~ '^[a-z][a-z0-9_-]{1,31}$'),
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.support_apps(app_key, display_name, is_active) values
  ('refill','SKIMA Refill',true),
  ('logistics','SKIMA Logistics',true),
  ('store','SKIMA Store',true),
  ('bills','SKIMA Bills',true),
  ('mobile','SKIMA',true)
on conflict(app_key) do update set display_name=excluded.display_name, is_active=excluded.is_active, updated_at=timezone('utc', now());

alter table public.support_threads
  add column if not exists app_key text;

update public.support_threads
set app_key = case
  when nullif(metadata->>'appKey','') is not null then metadata->>'appKey'
  else 'refill'
end
where app_key is null;

alter table public.support_threads
  alter column app_key set default 'refill',
  alter column app_key set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='support_threads_app_key_fkey'
      and conrelid='public.support_threads'::regclass
  ) then
    alter table public.support_threads
      add constraint support_threads_app_key_fkey
      foreign key (app_key) references public.support_apps(app_key) on update cascade;
  end if;
end $$;

alter table public.support_thread_messages
  add column if not exists is_internal boolean not null default false,
  add column if not exists attachments jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='support_thread_messages_attachments_array_check'
      and conrelid='public.support_thread_messages'::regclass
  ) then
    alter table public.support_thread_messages
      add constraint support_thread_messages_attachments_array_check
      check (jsonb_typeof(attachments)='array');
  end if;
end $$;

create index if not exists support_threads_app_queue_idx
  on public.support_threads(app_key, status, priority, last_message_at desc);

-- Replace the legacy requester policy: internal agent notes must never be visible to customers.
drop policy if exists support_thread_messages_requester_read on public.support_thread_messages;
create policy support_thread_messages_requester_read on public.support_thread_messages
  for select to authenticated
  using (
    not is_internal
    and exists(select 1 from public.support_threads t
      where t.id=thread_id and t.requester_user_id=auth.uid())
  );

-- Permit scoped support agents to receive live conversation updates through Realtime.
grant select on public.support_threads, public.support_thread_messages to authenticated;

do $
begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='support_threads' and policyname='support_threads_app_agent_read') then
    create policy support_threads_app_agent_read on public.support_threads
      for select to authenticated
      using (public.can_access_support_app(app_key,'read') or public.can_access_support_app(app_key,'manage'));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='support_thread_messages' and policyname='support_thread_messages_app_agent_read') then
    create policy support_thread_messages_app_agent_read on public.support_thread_messages
      for select to authenticated
      using (
        exists(select 1 from public.support_threads t
          where t.id=thread_id
            and (public.can_access_support_app(t.app_key,'read') or public.can_access_support_app(t.app_key,'manage')))
        or exists(select 1 from public.support_threads t
          where t.id=thread_id and t.requester_user_id=auth.uid() and not is_internal)
      );
  end if;
end $;

do $
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='support_threads') then
      alter publication supabase_realtime add table public.support_threads;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='support_thread_messages') then
      alter publication supabase_realtime add table public.support_thread_messages;
    end if;
  end if;
end $;

-- App-scoped permissions allow a support team to operate from its own app.
-- Existing global support permissions remain valid for centrally authorized teams.
insert into public.permissions(key, description, risk_level, metadata)
values
  ('platform.social.manage','Manage SKIMA social platforms and profile links.','high','{}')
on conflict(key) do update set description=excluded.description, risk_level=excluded.risk_level, updated_at=timezone('utc',now());

insert into public.permissions(key, description, risk_level, metadata)
select 'platform.support.read.' || app_key,
       'Read support conversations for ' || display_name || '.',
       'standard','{}'::jsonb
from public.support_apps
on conflict(key) do update set description=excluded.description, risk_level=excluded.risk_level, updated_at=timezone('utc',now());

insert into public.permissions(key, description, risk_level, metadata)
select 'platform.support.manage.' || app_key,
       'Respond to and manage support conversations for ' || display_name || '.',
       'high','{}'::jsonb
from public.support_apps
on conflict(key) do update set description=excluded.description, risk_level=excluded.risk_level, updated_at=timezone('utc',now());

update public.platform_admin_role_templates t
set permission_keys = (
  select array_agg(distinct permission_key order by permission_key)
  from unnest(
    t.permission_keys
    || array['platform.social.manage','platform.support.read','platform.support.manage']
    || (select array_agg('platform.support.read.' || app_key) from public.support_apps)
    || (select array_agg('platform.support.manage.' || app_key) from public.support_apps)
  ) as permission_key
), updated_at=timezone('utc',now())
where t.key in ('platform.super_admin','platform.support_admin','platform.operations_admin');

insert into public.role_permissions(role_id, permission_id, conditions)
select r.id, p.id, '{}'::jsonb
from public.roles r
cross join public.permissions p
where r.key in ('platform.super_admin','platform.support_admin','platform.operations_admin')
  and (
    p.key in ('platform.social.manage','platform.support.read','platform.support.manage')
    or p.key like 'platform.support.read.%'
    or p.key like 'platform.support.manage.%'
  )
on conflict(role_id,permission_id) do nothing;

create or replace function public.can_access_support_app(target_app_key text, target_action text default 'read')
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select auth.uid() is not null
    and exists(select 1 from public.support_apps a where a.app_key=target_app_key and a.is_active)
    and (
      public.is_platform_super_admin()
      or public.has_permission('platform.support.' || target_action, null)
      or public.has_permission('platform.support.' || target_action || '.' || target_app_key, null)
    )
$$;

create or replace function public.create_support_app_thread(
  target_app_key text,
  target_workspace text,
  target_category text,
  target_subject text,
  target_body text,
  target_priority text default 'normal',
  target_source text default 'skima.mobile.support',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  created_thread_id uuid;
  existing_thread_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode='42501', message='authentication required';
  end if;
  if not exists(select 1 from public.support_apps where app_key=target_app_key and is_active) then
    raise exception using errcode='22023', message='support is unavailable for this app';
  end if;
  if coalesce(btrim(target_workspace),'')='' or coalesce(btrim(target_category),'')='' then
    raise exception using errcode='22023', message='workspace and issue type are required';
  end if;
  if target_priority not in ('low','normal','high','urgent') then
    raise exception using errcode='22023', message='unsupported support priority';
  end if;
  if coalesce(btrim(target_subject),'')='' or char_length(btrim(target_subject))>160 then
    raise exception using errcode='22023', message='a valid subject is required';
  end if;
  if coalesce(btrim(target_body),'')='' or char_length(btrim(target_body))>4000 then
    raise exception using errcode='22023', message='message must contain between 1 and 4000 characters';
  end if;
  if coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023', message='idempotency key is required';
  end if;
  select id into existing_thread_id
  from public.support_threads
  where source=target_source and idempotency_key=target_idempotency_key;
  if existing_thread_id is not null then return existing_thread_id; end if;

  insert into public.support_threads(
    requester_user_id, app_key, workspace, category, priority, subject,
    source, idempotency_key, metadata
  ) values (
    auth.uid(), target_app_key, btrim(target_workspace), btrim(target_category),
    target_priority, btrim(target_subject), target_source, target_idempotency_key,
    coalesce(target_metadata,'{}'::jsonb) || jsonb_build_object('appKey',target_app_key)
  )
  returning id into created_thread_id;

  insert into public.support_thread_messages(
    thread_id, author_user_id, author_kind, body, source, idempotency_key, metadata
  ) values (
    created_thread_id, auth.uid(), 'requester', btrim(target_body),
    target_source, target_idempotency_key || ':initial', '{}'::jsonb
  );
  return created_thread_id;
end
$$;

create or replace function public.read_my_support_threads(target_limit integer default 50)
returns table(
  id uuid, workspace text, category text, priority text, subject text,
  status text, last_message_at timestamptz, created_at timestamptz, messages jsonb
)
language sql
stable
security definer
set search_path=public,pg_temp
as $
  select t.id,t.workspace,t.category,t.priority,t.subject,t.status,t.last_message_at,t.created_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',m.id,'authorKind',m.author_kind,'body',m.body,
        'createdAt',m.created_at,'attachments',m.attachments
      ) order by m.created_at)
      from public.support_thread_messages m
      where m.thread_id=t.id and not m.is_internal
    ),'[]'::jsonb)
  from public.support_threads t
  where t.requester_user_id=auth.uid()
  order by t.last_message_at desc
  limit least(greatest(target_limit,1),100)
$;

-- App users see only conversations belonging to the app they are currently using.
create or replace function public.read_my_support_threads(
  target_app_key text,
  target_limit integer default 50
)
returns table(
  id uuid, workspace text, category text, priority text, subject text,
  status text, last_message_at timestamptz, created_at timestamptz, messages jsonb
)
language sql
stable
security definer
set search_path=public,pg_temp
as $
  select t.id,t.workspace,t.category,t.priority,t.subject,t.status,t.last_message_at,t.created_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',m.id,'authorKind',m.author_kind,'body',m.body,
        'createdAt',m.created_at,'attachments',m.attachments
      ) order by m.created_at)
      from public.support_thread_messages m
      where m.thread_id=t.id and not m.is_internal
    ),'[]'::jsonb)
  from public.support_threads t
  where t.requester_user_id=auth.uid() and t.app_key=target_app_key
  order by t.last_message_at desc
  limit least(greatest(target_limit,1),100)
$;

create or replace function public.reply_to_my_support_app_thread(
  target_app_key text,
  target_thread_id uuid,
  target_body text,
  target_source text default 'skima.mobile.support',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $
declare
  message_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication required';
  end if;
  if coalesce(btrim(target_body),'')='' or char_length(btrim(target_body))>4000 then
    raise exception using errcode='22023',message='reply must contain between 1 and 4000 characters';
  end if;
  if not exists(
    select 1 from public.support_threads
    where id=target_thread_id and app_key=target_app_key
      and requester_user_id=auth.uid() and status not in ('closed')
  ) then
    raise exception using errcode='42501',message='support conversation is unavailable';
  end if;
  if coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='idempotency key is required';
  end if;
  insert into public.support_thread_messages(
    thread_id,author_user_id,author_kind,body,source,idempotency_key,metadata
  ) values (
    target_thread_id,auth.uid(),'requester',btrim(target_body),target_source,
    target_idempotency_key,coalesce(target_metadata,'{}'::jsonb)
  )
  on conflict(source,idempotency_key) do update set source=excluded.source
  returning id into message_id;
  update public.support_threads
  set status='open',last_message_at=timezone('utc',now()),updated_at=timezone('utc',now())
  where id=target_thread_id;
  return message_id;
end
$;

create or replace function public.read_my_support_threads(target_limit integer default 50)
returns table(
  id uuid, workspace text, category text, priority text, subject text,
  status text, last_message_at timestamptz, created_at timestamptz, messages jsonb
)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select t.id,t.workspace,t.category,t.priority,t.subject,t.status,t.last_message_at,t.created_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',m.id,'authorKind',m.author_kind,'body',m.body,
        'createdAt',m.created_at,'attachments',m.attachments
      ) order by m.created_at)
      from public.support_thread_messages m
      where m.thread_id=t.id and not m.is_internal
    ),'[]'::jsonb)
  from public.support_threads t
  where t.requester_user_id=auth.uid()
  order by t.last_message_at desc
  limit least(greatest(target_limit,1),100)
$$;

create or replace function public.read_my_support_app_threads(target_app_key text, target_limit integer default 50)
returns table(
  id uuid, workspace text, category text, priority text, subject text,
  status text, last_message_at timestamptz, created_at timestamptz, messages jsonb
)
language sql
stable
security definer
set search_path=public,pg_temp
as $
  select t.id,t.workspace,t.category,t.priority,t.subject,t.status,t.last_message_at,t.created_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',m.id,'authorKind',m.author_kind,'body',m.body,
        'createdAt',m.created_at,'attachments',m.attachments
      ) order by m.created_at)
      from public.support_thread_messages m
      where m.thread_id=t.id and not m.is_internal
    ),'[]'::jsonb)
  from public.support_threads t
  where t.requester_user_id=auth.uid() and t.app_key=target_app_key
  order by t.last_message_at desc
  limit least(greatest(target_limit,1),100)
$;

create or replace function public.reply_to_my_support_app_thread(
  target_thread_id uuid,
  target_app_key text,
  target_body text,
  target_source text default 'skima.mobile.support',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $
declare new_message_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication required';
  end if;
  if coalesce(btrim(target_body),'')='' or char_length(btrim(target_body))>4000 then
    raise exception using errcode='22023',message='reply must contain between 1 and 4000 characters';
  end if;
  if coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='idempotency key is required';
  end if;
  if not exists(
    select 1 from public.support_threads
    where id=target_thread_id and app_key=target_app_key
      and requester_user_id=auth.uid() and status not in ('closed')
  ) then
    raise exception using errcode='42501',message='support conversation is unavailable';
  end if;
  insert into public.support_thread_messages(
    thread_id,author_user_id,author_kind,body,source,idempotency_key,metadata
  ) values (
    target_thread_id,auth.uid(),'requester',btrim(target_body),target_source,
    target_idempotency_key,coalesce(target_metadata,'{}'::jsonb)
  )
  on conflict(source,idempotency_key) do update set source=excluded.source
  returning id into new_message_id;
  update public.support_threads
  set status='open',last_message_at=timezone('utc',now()),updated_at=timezone('utc',now())
  where id=target_thread_id;
  return new_message_id;
end
$;

create or replace function public.append_support_message_attachment(
  target_thread_id uuid,
  target_message_id uuid,
  target_attachment jsonb
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $
declare thread_app_key text; message_author uuid; attachment_path text;
begin
  select t.app_key into thread_app_key
  from public.support_threads t where t.id=target_thread_id;
  if thread_app_key is null then
    raise exception using errcode='P0002',message='support conversation not found';
  end if;
  select m.author_user_id into message_author
  from public.support_thread_messages m
  where m.id=target_message_id and m.thread_id=target_thread_id;
  if message_author is null then
    raise exception using errcode='P0002',message='support message not found';
  end if;
  if not (
    (exists(select 1 from public.support_threads t where t.id=target_thread_id and t.requester_user_id=auth.uid())
      and message_author=auth.uid())
    or public.can_access_support_app(thread_app_key,'manage')
  ) then
    raise exception using errcode='42501',message='attachment access is not available';
  end if;
  if jsonb_typeof(target_attachment)<>'object' then
    raise exception using errcode='22023',message='attachment details are invalid';
  end if;
  attachment_path := target_attachment->>'path';
  if coalesce(attachment_path,'')='' or split_part(attachment_path,'/',2)<>target_thread_id::text
     or split_part(attachment_path,'/',1)<>auth.uid()::text then
    raise exception using errcode='22023',message='attachment path is invalid';
  end if;
  update public.support_thread_messages
  set attachments=attachments || jsonb_build_array(target_attachment)
  where id=target_message_id and thread_id=target_thread_id;
end
$;

create or replace function public.read_support_app_queue(
  target_app_key text,
  target_status text default null,
  target_limit integer default 100
)
returns table(
  id uuid, requester_user_id uuid, requester_name text, app_key text,
  workspace text, category text, priority text, subject text, status text,
  assigned_to uuid, last_message_at timestamptz, created_at timestamptz, messages jsonb
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
begin
  if not public.can_access_support_app(target_app_key,'read')
     and not public.can_access_support_app(target_app_key,'manage') then
    raise exception using errcode='42501',message='support access is not available for this app';
  end if;
  return query
  select t.id,t.requester_user_id,p.display_name,t.app_key,t.workspace,t.category,t.priority,
    t.subject,t.status,t.assigned_to,t.last_message_at,t.created_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',m.id,'authorKind',m.author_kind,'body',m.body,
        'createdAt',m.created_at,'isInternal',m.is_internal,'attachments',m.attachments
      ) order by m.created_at)
      from public.support_thread_messages m where m.thread_id=t.id
    ),'[]'::jsonb)
  from public.support_threads t
  join public.profiles p on p.id=t.requester_user_id
  where t.app_key=target_app_key
    and (target_status is null or t.status=target_status)
  order by case t.priority when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,
    t.last_message_at desc
  limit least(greatest(target_limit,1),300);
end
$$;

create or replace function public.respond_to_support_app_thread(
  target_thread_id uuid,
  target_body text,
  target_status text default 'in_progress',
  target_is_internal boolean default false,
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  thread_app_key text;
  new_message_id uuid;
begin
  select t.app_key into thread_app_key
  from public.support_threads t
  where t.id=target_thread_id
  for update;
  if thread_app_key is null then
    raise exception using errcode='P0002',message='support conversation not found';
  end if;
  if not public.can_access_support_app(thread_app_key,'manage') then
    raise exception using errcode='42501',message='you cannot respond to support for this app';
  end if;
  if coalesce(btrim(target_body),'')='' or char_length(btrim(target_body))>4000 then
    raise exception using errcode='22023',message='reply must contain between 1 and 4000 characters';
  end if;
  if target_status not in ('open','in_progress','waiting_for_requester','resolved','closed') then
    raise exception using errcode='22023',message='unsupported support status';
  end if;
  if coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='idempotency key is required';
  end if;

  insert into public.support_thread_messages(
    thread_id,author_user_id,author_kind,body,source,idempotency_key,metadata,is_internal
  ) values (
    target_thread_id,auth.uid(),'admin',btrim(target_body),'skima.app.support.agent',
    target_idempotency_key,coalesce(target_metadata,'{}'::jsonb),target_is_internal
  )
  on conflict(source,idempotency_key) do update
    set source=excluded.source
  returning id into new_message_id;

  update public.support_threads
  set status=target_status,
      assigned_to=coalesce(assigned_to,auth.uid()),
      last_message_at=timezone('utc',now()),
      resolved_at=case when target_status in ('resolved','closed') then timezone('utc',now()) else null end,
      updated_at=timezone('utc',now())
  where id=target_thread_id;
  return new_message_id;
end
$$;

create or replace function public.upsert_support_app(target_app_key text, target_display_name text, target_is_active boolean default true)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if not (public.is_platform_super_admin() or public.has_permission('platform.support.manage',null)) then
    raise exception using errcode='42501',message='support configuration permission required';
  end if;
  if coalesce(btrim(target_app_key),'') !~ '^[a-z][a-z0-9_-]{1,31}$' then
    raise exception using errcode='22023',message='invalid app key';
  end if;
  insert into public.support_apps(app_key,display_name,is_active)
  values (lower(btrim(target_app_key)),btrim(target_display_name),target_is_active)
  on conflict(app_key) do update
    set display_name=excluded.display_name,is_active=excluded.is_active,updated_at=timezone('utc',now());
  insert into public.permissions(key,description,risk_level,metadata)
  values
    ('platform.support.read.' || lower(btrim(target_app_key)),'Read support conversations for ' || btrim(target_display_name) || '.','standard','{}'),
    ('platform.support.manage.' || lower(btrim(target_app_key)),'Respond to and manage support conversations for ' || btrim(target_display_name) || '.','high','{}')
  on conflict(key) do update set description=excluded.description,updated_at=timezone('utc',now());
end
$$;

create table if not exists public.social_platform_catalog (
  platform_key text primary key check (platform_key ~ '^[a-z][a-z0-9_-]{0,31},
  display_name text not null,
  icon_key text not null default 'globe',
  icon_url text null check (icon_url is null or icon_url ~ '^https://'),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now())
);

create table if not exists public.social_profiles (
  id uuid primary key default gen_random_uuid(),
  platform_key text not null references public.social_platform_catalog(platform_key) on update cascade,
  display_name text not null,
  handle text null,
  profile_url text not null check (profile_url ~ '^https://'),
  target_surfaces text[] not null default array['all']::text[],
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  constraint social_profiles_surfaces_not_empty check (cardinality(target_surfaces)>0)
);

create index if not exists social_profiles_active_surface_idx
  on public.social_profiles(is_active,sort_order)
  where is_active;

alter table public.social_platform_catalog enable row level security;
alter table public.social_profiles enable row level security;
revoke all on public.social_platform_catalog,public.social_profiles from public,anon,authenticated;
grant select on public.social_platform_catalog,public.social_profiles to anon,authenticated;

insert into public.social_platform_catalog(platform_key,display_name,icon_key)
values ('x','X','twitter'),('tiktok','TikTok','music-2')
on conflict(platform_key) do update set display_name=excluded.display_name,icon_key=excluded.icon_key,updated_at=timezone('utc',now());

insert into public.social_profiles(platform_key,display_name,handle,profile_url,target_surfaces,sort_order,is_active)
values
  ('x','SKIMA on X','@skimagroup','https://x.com/skimagroup',array['all']::text[],10,true),
  ('tiktok','SKIMA on TikTok','@skimagroup','https://www.tiktok.com/@skimagroup',array['all']::text[],20,true)
on conflict do nothing;

create or replace function public.read_active_social_accounts(target_surface text default 'all')
returns table(
  id uuid, platform_key text, platform_name text, icon_key text, icon_url text,
  display_name text, handle text, profile_url text, target_surfaces text[], sort_order integer
)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select p.id,p.platform_key,c.display_name,c.icon_key,c.icon_url,
    p.display_name,p.handle,p.profile_url,p.target_surfaces,p.sort_order
  from public.social_profiles p
  join public.social_platform_catalog c on c.platform_key=p.platform_key
  where p.is_active
    and (target_surface='all' or 'all'=any(p.target_surfaces) or target_surface=any(p.target_surfaces))
  order by p.sort_order,c.display_name,p.display_name
$$;

create or replace function public.upsert_social_platform(
  target_platform_key text,
  target_display_name text,
  target_icon_key text default 'globe',
  target_icon_url text default null
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if not (public.is_platform_super_admin() or public.has_permission('platform.social.manage',null)) then
    raise exception using errcode='42501',message='social profile management permission required';
  end if;
  if coalesce(btrim(target_platform_key),'') !~ '^[a-z][a-z0-9_-]{1,31}$'
     or coalesce(btrim(target_display_name),'')='' then
    raise exception using errcode='22023',message='a valid platform key and name are required';
  end if;
  insert into public.social_platform_catalog(platform_key,display_name,icon_key,icon_url)
  values(lower(btrim(target_platform_key)),btrim(target_display_name),coalesce(nullif(btrim(target_icon_key),''),'globe'),nullif(btrim(target_icon_url),''))
  on conflict(platform_key) do update set display_name=excluded.display_name,icon_key=excluded.icon_key,icon_url=excluded.icon_url,updated_at=timezone('utc',now());
end
$$;

create or replace function public.upsert_social_profile(
  target_id uuid default null,
  target_platform_key text default null,
  target_display_name text default null,
  target_handle text default null,
  target_profile_url text default null,
  target_surfaces text[] default array['all']::text[],
  target_sort_order integer default 100,
  target_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare saved_id uuid;
begin
  if not (public.is_platform_super_admin() or public.has_permission('platform.social.manage',null)) then
    raise exception using errcode='42501',message='social profile management permission required';
  end if;
  if not exists(select 1 from public.social_platform_catalog where platform_key=target_platform_key) then
    raise exception using errcode='22023',message='select a registered social platform first';
  end if;
  if coalesce(btrim(target_display_name),'')='' or coalesce(btrim(target_profile_url),'') !~ '^https://' then
    raise exception using errcode='22023',message='a profile name and secure profile URL are required';
  end if;
  if coalesce(cardinality(target_surfaces),0)=0 then
    raise exception using errcode='22023',message='choose at least one display location';
  end if;
  if target_id is null then
    insert into public.social_profiles(platform_key,display_name,handle,profile_url,target_surfaces,sort_order,is_active)
    values(target_platform_key,btrim(target_display_name),nullif(btrim(target_handle),''),btrim(target_profile_url),target_surfaces,target_sort_order,target_is_active)
    returning id into saved_id;
  else
    update public.social_profiles
    set platform_key=target_platform_key,display_name=btrim(target_display_name),
        handle=nullif(btrim(target_handle),''),profile_url=btrim(target_profile_url),
        target_surfaces=$6,sort_order=$7,is_active=$8,
        updated_at=timezone('utc',now())
    where id=target_id returning id into saved_id;
    if saved_id is null then raise exception using errcode='P0002',message='social profile not found'; end if;
  end if;
  return saved_id;
end
$$;

create or replace function public.assign_support_app_thread(target_thread_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $
declare app_key text;
begin
  select app_key into app_key from public.support_threads where id=target_thread_id for update;
  if app_key is null then raise exception using errcode='P0002',message='support conversation not found'; end if;
  if not public.can_access_support_app(app_key,'manage') then
    raise exception using errcode='42501',message='you cannot manage support for this app';
  end if;
  update public.support_threads set assigned_to=auth.uid(),status=case when status='open' then 'in_progress' else status end,updated_at=timezone('utc',now()) where id=target_thread_id;
  return target_thread_id;
end
$;

create or replace function public.escalate_my_support_app_thread(
  target_thread_id uuid,
  target_app_key text,
  target_reason text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $
declare message_id uuid;
begin
  if not exists(select 1 from public.support_threads where id=target_thread_id and app_key=target_app_key and requester_user_id=auth.uid() and status not in ('closed')) then
    raise exception using errcode='42501',message='support conversation is unavailable';
  end if;
  insert into public.support_thread_messages(thread_id,author_user_id,author_kind,body,source,idempotency_key,metadata)
  values(target_thread_id,auth.uid(),'requester',coalesce(nullif(btrim(target_reason),''),'Please escalate this support request.'),'skima.app.support.escalation',target_idempotency_key,'{"escalation":true}')
  on conflict(source,idempotency_key) do update set source=excluded.source
  returning id into message_id;
  update public.support_threads
  set priority='urgent',status='open',last_message_at=timezone('utc',now()),updated_at=timezone('utc',now())
  where id=target_thread_id;
  return message_id;
end
$;

-- Support agents can receive live updates only for apps they are authorized to serve.
do $
begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='support_threads' and policyname='support_threads_app_agent_read') then
    create policy support_threads_app_agent_read on public.support_threads
      for select to authenticated
      using (public.can_access_support_app(app_key,'read') or public.can_access_support_app(app_key,'manage'));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='support_thread_messages' and policyname='support_messages_app_agent_read') then
    create policy support_messages_app_agent_read on public.support_thread_messages
      for select to authenticated
      using (
        exists(select 1 from public.support_threads t
          where t.id=thread_id and
            (public.can_access_support_app(t.app_key,'read') or public.can_access_support_app(t.app_key,'manage')))
      );
  end if;
end $;

do $
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    begin alter publication supabase_realtime add table public.support_threads; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.support_thread_messages; exception when duplicate_object then null; end;
  end if;
end $;

revoke all on function public.read_my_support_app_threads(text,integer) from public;
revoke all on function public.reply_to_my_support_app_thread(uuid,text,text,text,text,jsonb) from public;
revoke all on function public.append_support_message_attachment(uuid,uuid,jsonb) from public;
revoke all on function public.assign_support_app_thread(uuid) from public;
revoke all on function public.escalate_my_support_app_thread(uuid,text,text,text) from public;
grant execute on function public.read_my_support_app_threads(text,integer) to authenticated;
grant execute on function public.reply_to_my_support_app_thread(uuid,text,text,text,text,jsonb) to authenticated;
grant execute on function public.append_support_message_attachment(uuid,uuid,jsonb) to authenticated;
grant execute on function public.assign_support_app_thread(uuid) to authenticated;
grant execute on function public.escalate_my_support_app_thread(uuid,text,text,text) to authenticated;

revoke all on function public.can_access_support_app(text,text) from public;
revoke all on function public.create_support_app_thread(text,text,text,text,text,text,text,text,jsonb) from public;
revoke all on function public.read_support_app_queue(text,text,integer) from public;
revoke all on function public.respond_to_support_app_thread(uuid,text,text,boolean,text,jsonb) from public;
revoke all on function public.upsert_support_app(text,text,boolean) from public;
revoke all on function public.read_active_social_accounts(text) from public;
revoke all on function public.upsert_social_platform(text,text,text,text) from public;
revoke all on function public.upsert_social_profile(uuid,text,text,text,text,text[],integer,boolean) from public;

grant execute on function public.can_access_support_app(text,text) to authenticated;
grant execute on function public.create_support_app_thread(text,text,text,text,text,text,text,text,jsonb) to authenticated;
grant execute on function public.read_my_support_threads(text,integer) to authenticated;
grant execute on function public.reply_to_my_support_app_thread(text,uuid,text,text,text,jsonb) to authenticated;

grant execute on function public.read_support_app_queue(text,text,integer) to authenticated;
grant execute on function public.respond_to_support_app_thread(uuid,text,text,boolean,text,jsonb) to authenticated;
grant execute on function public.upsert_support_app(text,text,boolean) to authenticated;
grant execute on function public.read_active_social_accounts(text) to anon,authenticated;
grant execute on function public.upsert_social_platform(text,text,text,text) to authenticated;
grant execute on function public.upsert_social_profile(uuid,text,text,text,text,text[],integer,boolean) to authenticated;

-- Enable table change streams for active support conversations when the standard publication exists.
do $
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='support_threads') then
      alter publication supabase_realtime add table public.support_threads;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='support_thread_messages') then
      alter publication supabase_realtime add table public.support_thread_messages;
    end if;
  end if;
end $;

-- Private attachment storage. Paths are <uploader user id>/<thread id>/<file name>.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'support-attachments','support-attachments',false,10485760,
  array['image/jpeg','image/png','image/webp','application/pdf','text/plain','video/mp4','audio/mpeg']::text[]
)
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

do $$
begin
  if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='support_attachments_read_scoped') then
    create policy support_attachments_read_scoped on storage.objects
      for select to authenticated
      using (
        bucket_id='support-attachments'
        and exists (
          select 1 from public.support_threads t
          where t.id::text=(storage.foldername(name))[2]
            and (
              t.requester_user_id=auth.uid()
              or public.can_access_support_app(t.app_key,'read')
              or public.can_access_support_app(t.app_key,'manage')
            )
        )
      );
  end if;
  if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='support_attachments_insert_scoped') then
    create policy support_attachments_insert_scoped on storage.objects
      for insert to authenticated
      with check (
        bucket_id='support-attachments'
        and (storage.foldername(name))[1]=auth.uid()::text
        and exists (
          select 1 from public.support_threads t
          where t.id::text=(storage.foldername(name))[2]
            and (
              t.requester_user_id=auth.uid()
              or public.can_access_support_app(t.app_key,'manage')
            )
        )
      );
  end if;
end $$;
),
  display_name text not null,
  icon_key text not null default 'globe',
  icon_url text null check (icon_url is null or icon_url ~ '^https://'),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now())
);

create table if not exists public.social_profiles (
  id uuid primary key default gen_random_uuid(),
  platform_key text not null references public.social_platform_catalog(platform_key) on update cascade,
  display_name text not null,
  handle text null,
  profile_url text not null check (profile_url ~ '^https://'),
  target_surfaces text[] not null default array['all']::text[],
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  constraint social_profiles_surfaces_not_empty check (cardinality(target_surfaces)>0)
);

create index if not exists social_profiles_active_surface_idx
  on public.social_profiles(is_active,sort_order)
  where is_active;

alter table public.social_platform_catalog enable row level security;
alter table public.social_profiles enable row level security;
revoke all on public.social_platform_catalog,public.social_profiles from public,anon,authenticated;
grant select on public.social_platform_catalog,public.social_profiles to anon,authenticated;

insert into public.social_platform_catalog(platform_key,display_name,icon_key)
values ('x','X','twitter'),('tiktok','TikTok','music-2')
on conflict(platform_key) do update set display_name=excluded.display_name,icon_key=excluded.icon_key,updated_at=timezone('utc',now());

insert into public.social_profiles(platform_key,display_name,handle,profile_url,target_surfaces,sort_order,is_active)
values
  ('x','SKIMA on X','@skimagroup','https://x.com/skimagroup',array['all']::text[],10,true),
  ('tiktok','SKIMA on TikTok','@skimagroup','https://www.tiktok.com/@skimagroup',array['all']::text[],20,true)
on conflict do nothing;

create or replace function public.read_active_social_accounts(target_surface text default 'all')
returns table(
  id uuid, platform_key text, platform_name text, icon_key text, icon_url text,
  display_name text, handle text, profile_url text, target_surfaces text[], sort_order integer
)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select p.id,p.platform_key,c.display_name,c.icon_key,c.icon_url,
    p.display_name,p.handle,p.profile_url,p.target_surfaces,p.sort_order
  from public.social_profiles p
  join public.social_platform_catalog c on c.platform_key=p.platform_key
  where p.is_active
    and (target_surface='all' or 'all'=any(p.target_surfaces) or target_surface=any(p.target_surfaces))
  order by p.sort_order,c.display_name,p.display_name
$$;

create or replace function public.upsert_social_platform(
  target_platform_key text,
  target_display_name text,
  target_icon_key text default 'globe',
  target_icon_url text default null
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if not (public.is_platform_super_admin() or public.has_permission('platform.social.manage',null)) then
    raise exception using errcode='42501',message='social profile management permission required';
  end if;
  if coalesce(btrim(target_platform_key),'') !~ '^[a-z][a-z0-9_-]{1,31}$'
     or coalesce(btrim(target_display_name),'')='' then
    raise exception using errcode='22023',message='a valid platform key and name are required';
  end if;
  insert into public.social_platform_catalog(platform_key,display_name,icon_key,icon_url)
  values(lower(btrim(target_platform_key)),btrim(target_display_name),coalesce(nullif(btrim(target_icon_key),''),'globe'),nullif(btrim(target_icon_url),''))
  on conflict(platform_key) do update set display_name=excluded.display_name,icon_key=excluded.icon_key,icon_url=excluded.icon_url,updated_at=timezone('utc',now());
end
$$;

create or replace function public.upsert_social_profile(
  target_id uuid default null,
  target_platform_key text default null,
  target_display_name text default null,
  target_handle text default null,
  target_profile_url text default null,
  target_surfaces text[] default array['all']::text[],
  target_sort_order integer default 100,
  target_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare saved_id uuid;
begin
  if not (public.is_platform_super_admin() or public.has_permission('platform.social.manage',null)) then
    raise exception using errcode='42501',message='social profile management permission required';
  end if;
  if not exists(select 1 from public.social_platform_catalog where platform_key=target_platform_key) then
    raise exception using errcode='22023',message='select a registered social platform first';
  end if;
  if coalesce(btrim(target_display_name),'')='' or coalesce(btrim(target_profile_url),'') !~ '^https://' then
    raise exception using errcode='22023',message='a profile name and secure profile URL are required';
  end if;
  if coalesce(cardinality(target_surfaces),0)=0 then
    raise exception using errcode='22023',message='choose at least one display location';
  end if;
  if target_id is null then
    insert into public.social_profiles(platform_key,display_name,handle,profile_url,target_surfaces,sort_order,is_active)
    values(target_platform_key,btrim(target_display_name),nullif(btrim(target_handle),''),btrim(target_profile_url),target_surfaces,target_sort_order,target_is_active)
    returning id into saved_id;
  else
    update public.social_profiles
    set platform_key=target_platform_key,display_name=btrim(target_display_name),
        handle=nullif(btrim(target_handle),''),profile_url=btrim(target_profile_url),
        target_surfaces=target_surfaces,sort_order=target_sort_order,is_active=target_is_active,
        updated_at=timezone('utc',now())
    where id=target_id returning id into saved_id;
    if saved_id is null then raise exception using errcode='P0002',message='social profile not found'; end if;
  end if;
  return saved_id;
end
$$;

revoke all on function public.can_access_support_app(text,text) from public;
revoke all on function public.create_support_app_thread(text,text,text,text,text,text,text,text,jsonb) from public;
revoke all on function public.read_support_app_queue(text,text,integer) from public;
revoke all on function public.respond_to_support_app_thread(uuid,text,text,boolean,text,jsonb) from public;
revoke all on function public.upsert_support_app(text,text,boolean) from public;
revoke all on function public.read_active_social_accounts(text) from public;
revoke all on function public.upsert_social_platform(text,text,text,text) from public;
revoke all on function public.upsert_social_profile(uuid,text,text,text,text,text[],integer,boolean) from public;

grant execute on function public.can_access_support_app(text,text) to authenticated;
grant execute on function public.create_support_app_thread(text,text,text,text,text,text,text,text,jsonb) to authenticated;
grant execute on function public.read_support_app_queue(text,text,integer) to authenticated;
grant execute on function public.respond_to_support_app_thread(uuid,text,text,boolean,text,jsonb) to authenticated;
grant execute on function public.upsert_support_app(text,text,boolean) to authenticated;
grant execute on function public.read_active_social_accounts(text) to anon,authenticated;
grant execute on function public.upsert_social_platform(text,text,text,text) to authenticated;
grant execute on function public.upsert_social_profile(uuid,text,text,text,text,text[],integer,boolean) to authenticated;

-- Private attachment storage. Paths are <uploader user id>/<thread id>/<file name>.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'support-attachments','support-attachments',false,10485760,
  array['image/jpeg','image/png','image/webp','application/pdf','text/plain','video/mp4','audio/mpeg']::text[]
)
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

do $$
begin
  if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='support_attachments_read_scoped') then
    create policy support_attachments_read_scoped on storage.objects
      for select to authenticated
      using (
        bucket_id='support-attachments'
        and exists (
          select 1 from public.support_threads t
          where t.id::text=(storage.foldername(name))[2]
            and (
              t.requester_user_id=auth.uid()
              or public.can_access_support_app(t.app_key,'read')
              or public.can_access_support_app(t.app_key,'manage')
            )
        )
      );
  end if;
  if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='support_attachments_insert_scoped') then
    create policy support_attachments_insert_scoped on storage.objects
      for insert to authenticated
      with check (
        bucket_id='support-attachments'
        and (storage.foldername(name))[1]=auth.uid()::text
        and exists (
          select 1 from public.support_threads t
          where t.id::text=(storage.foldername(name))[2]
            and (
              t.requester_user_id=auth.uid()
              or public.can_access_support_app(t.app_key,'manage')
            )
        )
      );
  end if;
end $$;
