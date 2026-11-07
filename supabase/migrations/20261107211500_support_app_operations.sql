-- Complete operational support workflows, categories, SLA tracking and admin directory reads.

alter table public.support_apps
  add column if not exists response_sla_minutes integer not null default 30
    check (response_sla_minutes between 1 and 10080),
  add column if not exists resolution_sla_minutes integer not null default 1440
    check (resolution_sla_minutes between 1 and 43200);

alter table public.support_threads
  add column if not exists first_response_due_at timestamptz,
  add column if not exists resolution_due_at timestamptz,
  add column if not exists first_response_at timestamptz,
  add column if not exists sla_breached_at timestamptz,
  add column if not exists escalation_level integer not null default 0
    check (escalation_level between 0 and 5),
  add column if not exists escalation_reason text,
  add column if not exists escalated_at timestamptz;

drop function if exists public.read_support_app_queue(text,text,integer);

create function public.read_support_app_queue(
  target_app_key text,
  target_status text default null,
  target_limit integer default 100
)
returns table(
  id uuid,
  requester_user_id uuid,
  requester_name text,
  app_key text,
  workspace text,
  category text,
  priority text,
  subject text,
  status text,
  assigned_to uuid,
  last_message_at timestamptz,
  created_at timestamptz,
  first_response_due_at timestamptz,
  resolution_due_at timestamptz,
  first_response_at timestamptz,
  is_sla_breached boolean,
  escalation_level integer,
  escalation_reason text,
  escalated_at timestamptz,
  messages jsonb
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
begin
  if not (public.can_access_support_app(target_app_key,'read')
       or public.can_access_support_app(target_app_key,'manage')) then
    raise exception using errcode='42501',message='support access is not available for this app';
  end if;

  return query
  select
    t.id,t.requester_user_id,p.display_name,t.app_key,t.workspace,t.category,t.priority,
    t.subject,t.status,t.assigned_to,t.last_message_at,t.created_at,
    t.first_response_due_at,t.resolution_due_at,t.first_response_at,
    (
      (t.first_response_at is null and now()>t.first_response_due_at)
      or (t.status not in ('resolved','closed') and now()>t.resolution_due_at)
    ) as is_sla_breached,
    t.escalation_level,t.escalation_reason,t.escalated_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',m.id,
        'authorKind',m.author_kind,
        'body',m.body,
        'createdAt',m.created_at,
        'isInternal',m.is_internal,
        'attachments',m.attachments
      ) order by m.created_at)
      from public.support_thread_messages m
      where m.thread_id=t.id
    ),'[]'::jsonb)
  from public.support_threads t
  join public.profiles p on p.id=t.requester_user_id
  where t.app_key=target_app_key
    and (target_status is null or t.status=target_status)
  order by
    case t.priority when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,
    t.last_message_at desc
  limit least(greatest(target_limit,1),300);
end
$$;

revoke all on function public.read_support_app_queue(text,text,integer) from public,anon;
grant execute on function public.read_support_app_queue(text,text,integer) to authenticated;

create table if not exists public.support_app_categories (
  id uuid primary key default gen_random_uuid(),
  app_key text not null references public.support_apps(app_key) on update cascade on delete cascade,
  category_key text not null check (category_key ~ '^[a-z][a-z0-9_-]{0,39}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  unique(app_key,category_key)
);

insert into public.support_app_categories(app_key,category_key,display_name,sort_order)
select a.app_key, c.category_key, c.display_name, c.sort_order
from public.support_apps a
cross join (values
  ('order','Order or service',10),
  ('payment','Payment or wallet',20),
  ('account','Account or sign-in',30),
  ('delivery','Delivery or fulfilment',40),
  ('safety','Safety concern',50),
  ('technical','App issue',60),
  ('other','Something else',100)
) as c(category_key,display_name,sort_order)
on conflict(app_key,category_key) do nothing;

create table if not exists public.support_thread_events (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.support_threads(id) on delete restrict,
  app_key text not null references public.support_apps(app_key),
  actor_user_id uuid null references public.profiles(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'),
  created_at timestamptz not null default timezone('utc',now())
);
create index if not exists support_thread_events_thread_idx
  on public.support_thread_events(thread_id,created_at desc);

alter table public.support_app_categories enable row level security;
alter table public.support_thread_events enable row level security;

-- App clients receive no direct table access; service_role is restricted to server-side operations.
create policy support_app_categories_service_role_all
  on public.support_app_categories for all to service_role
  using (true) with check (true);
create policy support_thread_events_service_role_all
  on public.support_thread_events for all to service_role
  using (true) with check (true);
revoke all on public.support_app_categories,public.support_thread_events from public,anon,authenticated;
grant all on public.support_app_categories,public.support_thread_events to service_role;

create or replace function public.populate_support_thread_sla()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  response_minutes integer;
  resolution_minutes integer;
begin
  select a.response_sla_minutes,a.resolution_sla_minutes
    into response_minutes,resolution_minutes
  from public.support_apps a
  where a.app_key=new.app_key and a.is_active;
  if not found then
    raise exception using errcode='22023',message='support is unavailable for this app';
  end if;
  new.first_response_due_at := coalesce(new.first_response_due_at,timezone('utc',now()) + make_interval(mins => response_minutes));
  new.resolution_due_at := coalesce(new.resolution_due_at,timezone('utc',now()) + make_interval(mins => resolution_minutes));
  return new;
end
$$;

drop trigger if exists support_thread_sla_defaults on public.support_threads;
create trigger support_thread_sla_defaults
before insert on public.support_threads
for each row execute function public.populate_support_thread_sla();

create or replace function public.track_support_first_response()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  app_key_value text;
begin
  if new.author_kind <> 'admin' or new.is_internal then
    return new;
  end if;
  update public.support_threads
  set first_response_at=coalesce(first_response_at,new.created_at),
      updated_at=timezone('utc',now())
  where id=new.thread_id
  returning app_key into app_key_value;
  if app_key_value is not null then
    insert into public.support_thread_events(thread_id,app_key,actor_user_id,event_type,payload)
    values(new.thread_id,app_key_value,new.author_user_id,'first_response','{}'::jsonb);
  end if;
  return new;
end
$$;

drop trigger if exists support_thread_first_response_tracking on public.support_thread_messages;
create trigger support_thread_first_response_tracking
after insert on public.support_thread_messages
for each row execute function public.track_support_first_response();

drop function if exists public.read_my_support_app_threads(text,integer);

create or replace function public.read_my_support_app_threads(
  target_app_key text,
  target_limit integer default 60
)
returns table(
  id uuid, workspace text, category text, priority text, subject text,
  status text, last_message_at timestamptz, created_at timestamptz,
  assigned_to uuid, messages jsonb
)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select t.id,t.workspace,t.category,t.priority,t.subject,t.status,
    t.last_message_at,t.created_at,t.assigned_to,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',m.id,
        'authorKind',m.author_kind,
        'body',m.body,
        'createdAt',m.created_at,
        'isInternal',m.is_internal,
        'attachments',m.attachments
      ) order by m.created_at)
      from public.support_thread_messages m
      where m.thread_id=t.id and not m.is_internal
    ),'[]'::jsonb)
  from public.support_threads t
  where auth.uid() is not null
    and t.requester_user_id=auth.uid()
    and t.app_key=target_app_key
  order by t.last_message_at desc
  limit least(greatest(target_limit,1),100)
$$;

create or replace function public.read_support_app_categories(target_app_key text)
returns table(category_key text,display_name text,sort_order integer)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select c.category_key,c.display_name,c.sort_order
  from public.support_app_categories c
  join public.support_apps a on a.app_key=c.app_key
  where c.app_key=target_app_key and c.is_active and a.is_active
  order by c.sort_order,c.display_name
$$;

create or replace function public.upsert_support_app_category(
  target_app_key text,
  target_category_key text,
  target_display_name text,
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
  if not public.can_access_support_app(target_app_key,'manage') then
    raise exception using errcode='42501',message='you cannot manage support categories for this app';
  end if;
  if coalesce(btrim(target_category_key),'') !~ '^[a-z][a-z0-9_-]{0,39}$'
     or coalesce(btrim(target_display_name),'')='' then
    raise exception using errcode='22023',message='a valid category key and label are required';
  end if;
  insert into public.support_app_categories(app_key,category_key,display_name,sort_order,is_active)
  values(target_app_key,lower(btrim(target_category_key)),btrim(target_display_name),target_sort_order,target_is_active)
  on conflict(app_key,category_key) do update
    set display_name=excluded.display_name,sort_order=excluded.sort_order,
        is_active=excluded.is_active,updated_at=timezone('utc',now())
  returning id into saved_id;
  return saved_id;
end
$$;

drop function if exists public.append_support_message_attachment(uuid,uuid,jsonb);

create or replace function public.append_support_message_attachment(
  target_thread_id uuid,
  target_message_id uuid,
  target_attachment jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  target_app_key text;
  target_requester uuid;
  target_author uuid;
  target_message_thread uuid;
  attachment_path text;
  attachment_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication required';
  end if;
  if jsonb_typeof(target_attachment)<>'object' then
    raise exception using errcode='22023',message='attachment details are invalid';
  end if;
  attachment_path := nullif(btrim(target_attachment->>'path'),'');
  if attachment_path is null
     or (storage.foldername(attachment_path))[1] <> auth.uid()::text
     or (storage.foldername(attachment_path))[2] <> target_thread_id::text then
    raise exception using errcode='42501',message='attachment does not belong to this support conversation';
  end if;
  select t.app_key,t.requester_user_id,m.author_user_id,m.thread_id
    into target_app_key,target_requester,target_author,target_message_thread
  from public.support_threads t
  join public.support_thread_messages m on m.thread_id=t.id
  where t.id=target_thread_id and m.id=target_message_id;
  if target_app_key is null then
    raise exception using errcode='P0002',message='support message not found';
  end if;
  if target_message_thread <> target_thread_id then
    raise exception using errcode='22023',message='message does not belong to this conversation';
  end if;
  if not (
    (target_requester=auth.uid() and target_author=auth.uid())
    or public.can_access_support_app(target_app_key,'manage')
  ) then
    raise exception using errcode='42501',message='you cannot attach files to this support message';
  end if;
  if not exists(
    select 1 from storage.objects o
    where o.bucket_id='support-attachments' and o.name=attachment_path
  ) then
    raise exception using errcode='P0002',message='uploaded attachment could not be found';
  end if;
  if exists(
    select 1 from public.support_thread_messages m
    where m.id=target_message_id and m.attachments @> jsonb_build_array(jsonb_build_object('path',attachment_path))
  ) then
    return target_message_id;
  end if;
  update public.support_thread_messages
  set attachments=coalesce(attachments,'[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'path',attachment_path,
      'fileName',coalesce(nullif(btrim(target_attachment->>'fileName'),''),'Attachment'),
      'mimeType',coalesce(nullif(btrim(target_attachment->>'mimeType'),''),'application/octet-stream'),
      'size',nullif(target_attachment->>'size','')::bigint
    )
  )
  where id=target_message_id;
  insert into public.support_thread_events(thread_id,app_key,actor_user_id,event_type,payload)
  values(target_thread_id,target_app_key,auth.uid(),'attachment_added',jsonb_build_object('message_id',target_message_id));
  return target_message_id;
end
$$;

create or replace function public.assign_support_app_thread(target_thread_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  app_key_value text;
  previous_assignee uuid;
begin
  select t.app_key,t.assigned_to into app_key_value,previous_assignee
  from public.support_threads t
  where t.id=target_thread_id
  for update;
  if app_key_value is null then
    raise exception using errcode='P0002',message='support conversation not found';
  end if;
  if not public.can_access_support_app(app_key_value,'manage') then
    raise exception using errcode='42501',message='you cannot claim support conversations for this app';
  end if;
  if previous_assignee is not null and previous_assignee<>auth.uid() then
    raise exception using errcode='55000',message='this case is already assigned to another agent';
  end if;
  update public.support_threads
  set assigned_to=auth.uid(),
      status=case when status='open' then 'in_progress' else status end,
      updated_at=timezone('utc',now())
  where id=target_thread_id;
  insert into public.support_thread_events(thread_id,app_key,actor_user_id,event_type,payload)
  values(target_thread_id,app_key_value,auth.uid(),'assigned',jsonb_build_object('assigned_to',auth.uid()));
  return target_thread_id;
end
$$;

create or replace function public.escalate_my_support_app_thread(
  target_thread_id uuid,
  target_app_key text,
  target_reason text default null,
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare new_level integer;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication required';
  end if;
  if coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='idempotency key is required';
  end if;
  if not exists(
    select 1 from public.support_threads t
    where t.id=target_thread_id and t.app_key=target_app_key
      and t.requester_user_id=auth.uid() and t.status not in ('closed')
  ) then
    raise exception using errcode='42501',message='support conversation is unavailable';
  end if;
  update public.support_threads
  set escalation_level=least(escalation_level+1,5),
      escalation_reason=coalesce(nullif(btrim(target_reason),''),'Customer requested escalation'),
      escalated_at=timezone('utc',now()),
      priority=case priority when 'low' then 'normal' when 'normal' then 'high' else 'urgent' end,
      status='open',
      last_message_at=timezone('utc',now()),
      updated_at=timezone('utc',now())
  where id=target_thread_id
  returning escalation_level into new_level;
  insert into public.support_thread_events(thread_id,app_key,actor_user_id,event_type,payload)
  values(target_thread_id,target_app_key,auth.uid(),'escalated',jsonb_build_object(
    'level',new_level,'reason',coalesce(nullif(btrim(target_reason),''),'Customer requested escalation'),
    'idempotency_key',target_idempotency_key
  ));
  return target_thread_id;
end
$$;

create or replace function public.read_social_admin_directory()
returns table(
  platform_key text,platform_name text,icon_key text,icon_url text,
  profile_id uuid,display_name text,handle text,profile_url text,
  target_surfaces text[],sort_order integer,is_active boolean
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
begin
  if not (public.is_platform_super_admin() or public.has_permission('platform.social.manage',null)) then
    raise exception using errcode='42501',message='social profile management permission required';
  end if;
  return query
    select c.platform_key,c.display_name,c.icon_key,c.icon_url,
      p.id,p.display_name,p.handle,p.profile_url,p.target_surfaces,p.sort_order,p.is_active
    from public.social_platform_catalog c
    left join public.social_profiles p on p.platform_key=c.platform_key
    order by c.display_name,p.sort_order nulls last,p.display_name nulls last;
end
$$;

-- Internal notes must never trigger customer-facing reply notifications.
create or replace function public.queue_support_thread_reply_notification()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  thread_record public.support_threads%rowtype;
  deep_link text;
begin
  if new.author_kind <> 'admin' or new.is_internal then
    return new;
  end if;
  select thread.* into thread_record
  from public.support_threads thread
  where thread.id=new.thread_id;
  if not found or thread_record.requester_user_id is null then
    return new;
  end if;
  deep_link := case
    when thread_record.app_key='logistics' and thread_record.workspace='provider' then '/(provider)/support'
    when thread_record.app_key='logistics' then '/(customer)/support'
    when thread_record.app_key='refill' and thread_record.workspace='driver' then '/(driver)/support'
    when thread_record.app_key='refill' and thread_record.workspace='station' then '/(station)/support'
    when thread_record.app_key='refill' then '/(customer)/support'
    else '/support'
  end;
  begin
    perform public.queue_communication_message(
      'in_app','support.thread.reply','user',thread_record.requester_user_id,null,
      jsonb_build_object(
        'title','SKIMA Support replied',
        'body','There is a new reply on your support request. Open Support to read the message and continue the conversation.',
        'category','support','deepLink',deep_link,
        'threadId',thread_record.id,'workspace',thread_record.workspace,'appKey',thread_record.app_key
      ),
      'provider.communication.sandbox','platform.support_notifications',
      'support-reply-notification:' || new.id::text,
      jsonb_build_object(
        'support_thread_id',thread_record.id,'support_message_id',new.id,
        'workspace',thread_record.workspace,'appKey',thread_record.app_key,'category','support'
      )
    );
  exception when others then
    null;
  end;
  return new;
end
$$;

revoke all on function public.read_my_support_app_threads(text,integer) from public,anon;
revoke all on function public.read_support_app_categories(text) from public,anon;
revoke all on function public.upsert_support_app_category(text,text,text,integer,boolean) from public,anon;
revoke all on function public.append_support_message_attachment(uuid,uuid,jsonb) from public,anon;
revoke all on function public.assign_support_app_thread(uuid) from public,anon;
revoke all on function public.escalate_my_support_app_thread(uuid,text,text,text) from public,anon;
revoke all on function public.read_social_admin_directory() from public,anon;

grant execute on function public.read_my_support_app_threads(text,integer) to authenticated;
grant execute on function public.read_support_app_categories(text) to authenticated;
grant execute on function public.upsert_support_app_category(text,text,text,integer,boolean) to authenticated;
grant execute on function public.append_support_message_attachment(uuid,uuid,jsonb) to authenticated;
grant execute on function public.assign_support_app_thread(uuid) to authenticated;
grant execute on function public.escalate_my_support_app_thread(uuid,text,text,text) to authenticated;
grant execute on function public.read_social_admin_directory() to authenticated;

-- Realtime is what keeps the inbox and requester conversation fresh while either app is open.
do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='support_thread_events') then
      alter publication supabase_realtime add table public.support_thread_events;
    end if;
  end if;
end $$;
