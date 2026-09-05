-- Reusable, business-agnostic support inbox with append-only conversation messages.
create table if not exists public.support_threads (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  workspace text not null,
  category text not null,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  subject text not null check (char_length(btrim(subject)) between 3 and 160),
  status text not null default 'open' check (status in ('open','in_progress','waiting_for_requester','resolved','closed')),
  assigned_to uuid null references public.profiles(id) on delete set null,
  last_message_at timestamptz not null default timezone('utc',now()),
  resolved_at timestamptz null,
  source text not null,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  unique(source,idempotency_key)
);
create table if not exists public.support_thread_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.support_threads(id) on delete restrict,
  author_user_id uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  author_kind text not null check (author_kind in ('requester','admin')),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  source text not null,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default timezone('utc',now()),
  unique(source,idempotency_key)
);
create index if not exists support_threads_requester_idx on public.support_threads(requester_user_id,last_message_at desc);
create index if not exists support_threads_admin_queue_idx on public.support_threads(status,priority,last_message_at desc);
create index if not exists support_thread_messages_thread_idx on public.support_thread_messages(thread_id,created_at);

alter table public.support_threads enable row level security;
alter table public.support_thread_messages enable row level security;
revoke all on public.support_threads,public.support_thread_messages from public,anon,authenticated;
grant all on public.support_threads,public.support_thread_messages to service_role;
create policy support_threads_requester_read on public.support_threads for select to authenticated
using (requester_user_id=auth.uid());
create policy support_thread_messages_requester_read on public.support_thread_messages for select to authenticated
using (exists(select 1 from public.support_threads thread where thread.id=thread_id and thread.requester_user_id=auth.uid()));

insert into public.permissions(key,description,risk_level,metadata) values
('platform.support.read','Read support conversations assigned to the platform.','standard','{}'),
('platform.support.manage','Respond to and resolve platform support conversations.','high','{}')
on conflict(key) do update set description=excluded.description,risk_level=excluded.risk_level,updated_at=timezone('utc',now());

update public.platform_admin_role_templates t set permission_keys=(
 select array_agg(distinct key order by key) from unnest(t.permission_keys || array['platform.support.read','platform.support.manage']) key
),updated_at=timezone('utc',now())
where t.key in ('platform.super_admin','platform.support_admin','platform.operations_admin');

insert into public.role_permissions(role_id,permission_id,conditions)
select r.id,p.id,'{}'::jsonb from public.roles r cross join public.permissions p
where r.key in ('platform.super_admin','platform.support_admin','platform.operations_admin')
and p.key in ('platform.support.read','platform.support.manage')
on conflict(role_id,permission_id) do nothing;

create or replace function public.create_support_thread(target_workspace text,target_category text,target_subject text,target_body text,target_priority text default 'normal',target_source text default 'skima.mobile',target_idempotency_key text default null,target_metadata jsonb default '{}')
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare thread_id uuid; existing_id uuid;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
 if coalesce(btrim(target_workspace),'')='' or coalesce(btrim(target_category),'')='' then raise exception using errcode='22023',message='workspace and category are required'; end if;
 if target_priority not in ('low','normal','high','urgent') then raise exception using errcode='22023',message='unsupported support priority'; end if;
 if coalesce(btrim(target_idempotency_key),'')='' then raise exception using errcode='22023',message='idempotency key is required'; end if;
 select id into existing_id from public.support_threads where source=target_source and idempotency_key=target_idempotency_key;
 if existing_id is not null then return existing_id; end if;
 insert into public.support_threads(requester_user_id,workspace,category,priority,subject,source,idempotency_key,metadata)
 values(auth.uid(),btrim(target_workspace),btrim(target_category),target_priority,btrim(target_subject),target_source,target_idempotency_key,coalesce(target_metadata,'{}')) returning id into thread_id;
 insert into public.support_thread_messages(thread_id,author_user_id,author_kind,body,source,idempotency_key,metadata)
 values(thread_id,auth.uid(),'requester',btrim(target_body),target_source,target_idempotency_key||':initial','{}');
 return thread_id;
end $$;

create or replace function public.read_my_support_threads(target_limit integer default 50)
returns table(id uuid,workspace text,category text,priority text,subject text,status text,last_message_at timestamptz,created_at timestamptz,messages jsonb)
language sql stable security definer set search_path=public,pg_temp as $$
 select t.id,t.workspace,t.category,t.priority,t.subject,t.status,t.last_message_at,t.created_at,
 coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'authorKind',m.author_kind,'body',m.body,'createdAt',m.created_at) order by m.created_at) from public.support_thread_messages m where m.thread_id=t.id),'[]')
 from public.support_threads t where t.requester_user_id=auth.uid() order by t.last_message_at desc limit least(greatest(target_limit,1),100)
$$;

create or replace function public.read_support_admin_queue(target_status text default null,target_limit integer default 200)
returns table(id uuid,requester_user_id uuid,requester_name text,workspace text,category text,priority text,subject text,status text,assigned_to uuid,last_message_at timestamptz,created_at timestamptz,messages jsonb)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not (public.has_permission('platform.support.read',null) or public.is_platform_super_admin()) then raise exception using errcode='42501',message='support read permission required'; end if;
 return query select t.id,t.requester_user_id,p.display_name,t.workspace,t.category,t.priority,t.subject,t.status,t.assigned_to,t.last_message_at,t.created_at,
 coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'authorKind',m.author_kind,'body',m.body,'createdAt',m.created_at) order by m.created_at) from public.support_thread_messages m where m.thread_id=t.id),'[]')
 from public.support_threads t join public.profiles p on p.id=t.requester_user_id
 where target_status is null or t.status=target_status order by case t.priority when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,t.last_message_at desc limit least(greatest(target_limit,1),500);
end $$;

create or replace function public.respond_to_support_thread(target_thread_id uuid,target_body text,target_status text default 'in_progress',target_source text default 'skima.admin',target_idempotency_key text default null,target_metadata jsonb default '{}')
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare message_id uuid;
begin
 if not (public.has_permission('platform.support.manage',null) or public.is_platform_super_admin()) then raise exception using errcode='42501',message='support manage permission required'; end if;
 if target_status not in ('open','in_progress','waiting_for_requester','resolved','closed') then raise exception using errcode='22023',message='unsupported support status'; end if;
 insert into public.support_thread_messages(thread_id,author_user_id,author_kind,body,source,idempotency_key,metadata)
 values(target_thread_id,auth.uid(),'admin',btrim(target_body),target_source,target_idempotency_key,coalesce(target_metadata,'{}'))
 on conflict(source,idempotency_key) do update set source=excluded.source returning id into message_id;
 update public.support_threads set status=target_status,assigned_to=auth.uid(),last_message_at=timezone('utc',now()),resolved_at=case when target_status in ('resolved','closed') then timezone('utc',now()) else null end,updated_at=timezone('utc',now()) where id=target_thread_id;
 return message_id;
end $$;

revoke all on function public.create_support_thread(text,text,text,text,text,text,text,jsonb) from public;
revoke all on function public.read_my_support_threads(integer) from public;
revoke all on function public.read_support_admin_queue(text,integer) from public;
revoke all on function public.respond_to_support_thread(uuid,text,text,text,text,jsonb) from public;
grant execute on function public.create_support_thread(text,text,text,text,text,text,text,jsonb),public.read_my_support_threads(integer) to authenticated,service_role;
grant execute on function public.read_support_admin_queue(text,integer),public.respond_to_support_thread(uuid,text,text,text,text,jsonb) to authenticated,service_role;
