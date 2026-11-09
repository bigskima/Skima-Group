begin;

-- WhatsApp is a channel over the existing app-scoped support system. It must
-- never create a second ticket store or bypass support permissions.
create table if not exists public.skima_whatsapp_support_outbox (
  id uuid primary key default gen_random_uuid(),
  support_thread_id uuid not null references public.support_threads(id) on delete cascade,
  support_message_id uuid not null unique references public.support_thread_messages(id) on delete cascade,
  contact_id uuid not null references public.skima_whatsapp_contacts(id) on delete cascade,
  whatsapp_wa_id text not null check (whatsapp_wa_id ~ '^[0-9]{6,20}$'),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  status text not null default 'queued'
    check (status in ('queued','processing','sent','failed','cancelled')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 8),
  next_attempt_at timestamptz not null default timezone('utc',now()),
  locked_at timestamptz,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  provider_message_id text unique,
  provider_delivery_status text
    check (provider_delivery_status is null or provider_delivery_status in ('sent','delivered','read','failed')),
  provider_status_at timestamptz,
  provider_error_code text,
  last_error_code text,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now())
);

create index if not exists skima_whatsapp_support_outbox_due_idx
  on public.skima_whatsapp_support_outbox(status,next_attempt_at,created_at)
  where status in ('queued','processing');
create index if not exists skima_whatsapp_support_outbox_thread_idx
  on public.skima_whatsapp_support_outbox(support_thread_id,created_at desc);

alter table public.skima_whatsapp_support_outbox enable row level security;
drop policy if exists skima_whatsapp_support_outbox_service_role_all
  on public.skima_whatsapp_support_outbox;
create policy skima_whatsapp_support_outbox_service_role_all
  on public.skima_whatsapp_support_outbox for all to service_role
  using (auth.role()='service_role')
  with check (auth.role()='service_role');
revoke all on public.skima_whatsapp_support_outbox from public,anon,authenticated;
grant all on public.skima_whatsapp_support_outbox to service_role;

create or replace function public.skima_whatsapp_support_reference(target_thread_id uuid)
returns text
language sql
immutable
set search_path=public,pg_temp
as $$
  select 'SK-' || upper(left(replace(target_thread_id::text,'-',''),8))
$$;

create or replace function public.skima_whatsapp_resolve_support_reference(target_reference text)
returns uuid
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  normalized_reference text := upper(btrim(coalesce(target_reference,'')));
  matched_id uuid;
  match_count integer;
begin
  if normalized_reference !~ '^SK-[A-F0-9]{8}$' then
    raise exception using errcode='22023',message='invalid SKIMA support reference';
  end if;
  select count(*),min(t.id::text)::uuid
    into match_count,matched_id
  from public.support_threads t
  where 'SK-' || upper(left(replace(t.id::text,'-',''),8))=normalized_reference;
  if match_count=0 then
    raise exception using errcode='P0002',message='support conversation not found';
  end if;
  if match_count>1 then
    raise exception using errcode='55000',message='support reference is ambiguous; use the full conversation ID in Admin';
  end if;
  return matched_id;
end
$$;

create or replace function public.skima_whatsapp_create_support_thread(
  target_whatsapp_wa_id text,
  target_app_key text,
  target_category text,
  target_subject text,
  target_body text,
  target_provider_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  contact_record public.skima_whatsapp_contacts%rowtype;
  created_thread_id uuid;
  thread_status text;
  normalized_subject text := left(btrim(coalesce(target_subject,'')),160);
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='service role required';
  end if;
  if coalesce(btrim(target_whatsapp_wa_id),'') !~ '^[0-9]{6,20}$'
     or target_app_key not in ('refill','store','logistics','bills')
     or coalesce(btrim(target_category),'')=''
     or coalesce(btrim(target_body),'')=''
     or char_length(btrim(target_body))>4000
     or char_length(normalized_subject)<3
     or coalesce(btrim(target_provider_message_id),'')=''
     or char_length(target_provider_message_id)>200 then
    raise exception using errcode='22023',message='valid customer, app, category and support message are required';
  end if;

  select * into contact_record
  from public.skima_whatsapp_contacts
  where whatsapp_wa_id=btrim(target_whatsapp_wa_id)
    and link_status='linked'
    and profile_id is not null
  for update;
  if not found or not exists(
    select 1 from public.profiles p
    where p.id=contact_record.profile_id and p.status='active'
  ) then
    raise exception using errcode='42501',message='an active linked SKIMA customer is required';
  end if;
  if not exists(
    select 1 from public.support_apps a
    join public.support_app_categories c on c.app_key=a.app_key
    where a.app_key=target_app_key and a.is_active
      and c.category_key=target_category and c.is_active
  ) then
    raise exception using errcode='22023',message='this support category is not available for the selected SKIMA app';
  end if;

  perform set_config('request.jwt.claim.sub',contact_record.profile_id::text,true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',contact_record.profile_id::text,'role','service_role')::text,true);

  created_thread_id := public.create_support_app_thread(
    target_app_key,
    'customer',
    target_category,
    normalized_subject,
    btrim(target_body),
    'normal',
    'skima.whatsapp.support.customer',
    'meta:' || target_provider_message_id,
    jsonb_build_object(
      'channel','whatsapp',
      'whatsapp_wa_id',contact_record.whatsapp_wa_id,
      'origin','official_skima_whatsapp'
    )
  );

  select status into thread_status
  from public.support_threads where id=created_thread_id;

  return jsonb_build_object(
    'threadId',created_thread_id,
    'reference',public.skima_whatsapp_support_reference(created_thread_id),
    'appKey',target_app_key,
    'status',thread_status
  );
end
$$;

create or replace function public.skima_whatsapp_reply_support_thread(
  target_whatsapp_wa_id text,
  target_support_reference text,
  target_body text,
  target_provider_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  contact_record public.skima_whatsapp_contacts%rowtype;
  thread_record public.support_threads%rowtype;
  new_message_id uuid;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='service role required';
  end if;
  if coalesce(btrim(target_whatsapp_wa_id),'') !~ '^[0-9]{6,20}$'
     or coalesce(btrim(target_body),'')=''
     or char_length(btrim(target_body))>4000
     or coalesce(btrim(target_provider_message_id),'')='' then
    raise exception using errcode='22023',message='valid WhatsApp customer and support reply are required';
  end if;

  select * into contact_record
  from public.skima_whatsapp_contacts
  where whatsapp_wa_id=btrim(target_whatsapp_wa_id)
    and link_status='linked' and profile_id is not null
  for update;
  if not found or not exists(
    select 1 from public.profiles p
    where p.id=contact_record.profile_id and p.status='active'
  ) then
    raise exception using errcode='42501',message='an active linked SKIMA customer is required';
  end if;

  select * into thread_record
  from public.support_threads
  where id=public.skima_whatsapp_resolve_support_reference(target_support_reference)
    and requester_user_id=contact_record.profile_id
    and app_key in ('refill','store','logistics','bills')
  for update;
  if not found or thread_record.status='closed' then
    raise exception using errcode='42501',message='this support conversation is unavailable';
  end if;

  perform set_config('request.jwt.claim.sub',contact_record.profile_id::text,true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',contact_record.profile_id::text,'role','service_role')::text,true);

  new_message_id := public.reply_to_my_support_app_thread(
    thread_record.id,
    thread_record.app_key,
    btrim(target_body),
    'skima.whatsapp.support.customer',
    'meta:' || target_provider_message_id,
    jsonb_build_object('channel','whatsapp','whatsapp_wa_id',contact_record.whatsapp_wa_id)
  );

  return jsonb_build_object(
    'threadId',thread_record.id,
    'reference',public.skima_whatsapp_support_reference(thread_record.id),
    'messageId',new_message_id,
    'status','open'
  );
end
$$;

create or replace function public.skima_whatsapp_claim_support_thread(
  target_agent_whatsapp_wa_id text,
  target_support_reference text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  contact_record public.skima_whatsapp_contacts%rowtype;
  thread_record public.support_threads%rowtype;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='service role required';
  end if;
  if coalesce(btrim(target_agent_whatsapp_wa_id),'') !~ '^[0-9]{6,20}$' then
    raise exception using errcode='22023',message='valid linked agent WhatsApp number is required';
  end if;
  select * into contact_record
  from public.skima_whatsapp_contacts
  where whatsapp_wa_id=btrim(target_agent_whatsapp_wa_id)
    and link_status='linked' and profile_id is not null
  for update;
  if not found or not exists(
    select 1 from public.profiles p
    where p.id=contact_record.profile_id and p.status='active'
  ) then
    raise exception using errcode='42501',message='link this WhatsApp number to an active SKIMA staff account first';
  end if;

  select * into thread_record
  from public.support_threads
  where id=public.skima_whatsapp_resolve_support_reference(target_support_reference)
    and app_key in ('refill','store','logistics','bills')
  for update;
  if not found or thread_record.status in ('resolved','closed') then
    raise exception using errcode='55000',message='this support conversation is no longer open for assignment';
  end if;

  perform set_config('request.jwt.claim.sub',contact_record.profile_id::text,true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',contact_record.profile_id::text,'role','service_role')::text,true);

  if not public.can_access_support_app(thread_record.app_key,'manage') then
    raise exception using errcode='42501',message='this staff account is not authorised for the selected app support queue';
  end if;
  if thread_record.assigned_to is not null and thread_record.assigned_to<>contact_record.profile_id then
    raise exception using errcode='55000',message='this conversation is already assigned to another support agent';
  end if;
  if thread_record.assigned_to is null then
    perform public.assign_support_app_thread(thread_record.id);
  end if;

  return jsonb_build_object(
    'threadId',thread_record.id,
    'reference',public.skima_whatsapp_support_reference(thread_record.id),
    'appKey',thread_record.app_key,
    'status','in_progress'
  );
end
$$;

create or replace function public.skima_whatsapp_agent_reply_support_thread(
  target_agent_whatsapp_wa_id text,
  target_support_reference text,
  target_body text,
  target_is_internal boolean,
  target_provider_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  contact_record public.skima_whatsapp_contacts%rowtype;
  thread_record public.support_threads%rowtype;
  new_message_id uuid;
  customer_wa_id text;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='service role required';
  end if;
  if coalesce(btrim(target_agent_whatsapp_wa_id),'') !~ '^[0-9]{6,20}$'
     or coalesce(btrim(target_body),'')=''
     or char_length(btrim(target_body))>4000
     or target_is_internal is null
     or coalesce(btrim(target_provider_message_id),'')='' then
    raise exception using errcode='22023',message='valid linked agent and support response are required';
  end if;

  select * into contact_record
  from public.skima_whatsapp_contacts
  where whatsapp_wa_id=btrim(target_agent_whatsapp_wa_id)
    and link_status='linked' and profile_id is not null
  for update;
  if not found or not exists(
    select 1 from public.profiles p
    where p.id=contact_record.profile_id and p.status='active'
  ) then
    raise exception using errcode='42501',message='link this WhatsApp number to an active SKIMA staff account first';
  end if;

  select * into thread_record
  from public.support_threads
  where id=public.skima_whatsapp_resolve_support_reference(target_support_reference)
    and app_key in ('refill','store','logistics','bills')
  for update;
  if not found or thread_record.status in ('resolved','closed') then
    raise exception using errcode='55000',message='this support conversation is no longer open';
  end if;

  perform set_config('request.jwt.claim.sub',contact_record.profile_id::text,true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',contact_record.profile_id::text,'role','service_role')::text,true);

  if not public.can_access_support_app(thread_record.app_key,'manage') then
    raise exception using errcode='42501',message='this staff account is not authorised for the selected app support queue';
  end if;
  if thread_record.assigned_to is not null and thread_record.assigned_to<>contact_record.profile_id then
    raise exception using errcode='55000',message='this conversation is assigned to another support agent';
  end if;
  if thread_record.assigned_to is null then
    perform public.assign_support_app_thread(thread_record.id);
  end if;

  new_message_id := public.respond_to_support_app_thread(
    thread_record.id,
    btrim(target_body),
    case when target_is_internal then thread_record.status else 'in_progress' end,
    target_is_internal,
    'meta:' || target_provider_message_id,
    jsonb_build_object(
      'channel','whatsapp',
      'agent_whatsapp_wa_id',contact_record.whatsapp_wa_id,
      'origin','official_skima_whatsapp'
    )
  );

  select c.whatsapp_wa_id into customer_wa_id
  from public.skima_whatsapp_contacts c
  where c.profile_id=thread_record.requester_user_id
    and c.link_status='linked'
  order by c.last_inbound_at desc nulls last
  limit 1;

  return jsonb_build_object(
    'threadId',thread_record.id,
    'reference',public.skima_whatsapp_support_reference(thread_record.id),
    'messageId',new_message_id,
    'appKey',thread_record.app_key,
    'internal',target_is_internal,
    'customerWhatsAppLinked',customer_wa_id is not null
  );
end
$$;

-- Public support-agent replies from either Admin or WhatsApp are relayed to the
-- customer's linked WhatsApp chat only while the Meta customer-service window
-- is open. App conversations remain the durable source of truth regardless.
create or replace function public.queue_skima_whatsapp_support_reply()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  thread_record public.support_threads%rowtype;
  contact_record public.skima_whatsapp_contacts%rowtype;
begin
  if new.author_kind<>'admin' or coalesce(new.is_internal,false) then
    return new;
  end if;

  select * into thread_record
  from public.support_threads
  where id=new.thread_id
    and app_key in ('refill','store','logistics','bills');
  if not found then return new; end if;

  select * into contact_record
  from public.skima_whatsapp_contacts
  where profile_id=thread_record.requester_user_id
    and link_status='linked'
    and last_inbound_at >= timezone('utc',now()) - interval '24 hours'
  order by last_inbound_at desc
  limit 1;
  if not found then return new; end if;

  insert into public.skima_whatsapp_support_outbox(
    support_thread_id,support_message_id,contact_id,whatsapp_wa_id,body
  ) values (
    thread_record.id,new.id,contact_record.id,contact_record.whatsapp_wa_id,new.body
  )
  on conflict(support_message_id) do nothing;

  return new;
end
$$;

drop trigger if exists trg_skima_whatsapp_support_reply_outbox
  on public.support_thread_messages;
create trigger trg_skima_whatsapp_support_reply_outbox
  after insert on public.support_thread_messages
  for each row execute function public.queue_skima_whatsapp_support_reply();

create or replace function public.claim_skima_whatsapp_support_outbox(
  target_limit integer default 25
)
returns table(
  notification_id uuid,
  whatsapp_wa_id text,
  support_thread_id uuid,
  support_message_id uuid,
  body text,
  attempt_count integer
)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='service role required';
  end if;
  if target_limit is null or target_limit<1 or target_limit>100 then
    raise exception using errcode='22023',message='target_limit must be between 1 and 100';
  end if;

  update public.skima_whatsapp_support_outbox n
  set status='failed',
      last_error_code=coalesce(n.last_error_code,'retry_limit_exhausted'),
      locked_at=null,
      updated_at=timezone('utc',now())
  where n.status='processing'
    and n.locked_at < timezone('utc',now()) - interval '5 minutes'
    and n.attempt_count>=8;

  return query
  with due as (
    select n.id
    from public.skima_whatsapp_support_outbox n
    join public.skima_whatsapp_contacts c on c.id=n.contact_id
    where c.link_status='linked'
      and c.whatsapp_wa_id=n.whatsapp_wa_id
      and c.last_inbound_at >= timezone('utc',now()) - interval '24 hours'
      and n.attempt_count<8
      and n.next_attempt_at<=timezone('utc',now())
      and (
        n.status='queued'
        or (n.status='processing' and n.locked_at < timezone('utc',now()) - interval '5 minutes')
      )
    order by n.next_attempt_at,n.created_at
    limit target_limit
    for update of n skip locked
  ),
  claimed as (
    update public.skima_whatsapp_support_outbox n
    set status='processing',
        attempt_count=n.attempt_count+1,
        locked_at=timezone('utc',now()),
        last_attempt_at=timezone('utc',now()),
        updated_at=timezone('utc',now())
    from due
    where n.id=due.id
    returning n.id,n.contact_id,n.support_thread_id,n.support_message_id,n.body,n.attempt_count
  )
  select claimed.id,c.whatsapp_wa_id,claimed.support_thread_id,
    claimed.support_message_id,claimed.body,claimed.attempt_count
  from claimed
  join public.skima_whatsapp_contacts c on c.id=claimed.contact_id;
end
$$;

revoke all on function public.skima_whatsapp_support_reference(uuid) from public,anon,authenticated;
revoke all on function public.skima_whatsapp_resolve_support_reference(text) from public,anon,authenticated;
revoke all on function public.skima_whatsapp_create_support_thread(text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.skima_whatsapp_reply_support_thread(text,text,text,text) from public,anon,authenticated;
revoke all on function public.skima_whatsapp_claim_support_thread(text,text) from public,anon,authenticated;
revoke all on function public.skima_whatsapp_agent_reply_support_thread(text,text,text,boolean,text) from public,anon,authenticated;
revoke all on function public.queue_skima_whatsapp_support_reply() from public,anon,authenticated;
revoke all on function public.claim_skima_whatsapp_support_outbox(integer) from public,anon,authenticated;

grant execute on function public.skima_whatsapp_create_support_thread(text,text,text,text,text,text) to service_role;
grant execute on function public.skima_whatsapp_reply_support_thread(text,text,text,text) to service_role;
grant execute on function public.skima_whatsapp_claim_support_thread(text,text) to service_role;
grant execute on function public.skima_whatsapp_agent_reply_support_thread(text,text,text,boolean,text) to service_role;
grant execute on function public.claim_skima_whatsapp_support_outbox(integer) to service_role;

commit;
