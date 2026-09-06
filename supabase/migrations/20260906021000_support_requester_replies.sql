create or replace function public.reply_to_my_support_thread(target_thread_id uuid,target_body text,target_source text default 'skima.mobile',target_idempotency_key text default null,target_metadata jsonb default '{}')
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare message_id uuid;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
 if coalesce(btrim(target_body),'')='' or char_length(btrim(target_body))>4000 then raise exception using errcode='22023',message='reply must contain between 1 and 4000 characters'; end if;
 if not exists(select 1 from public.support_threads where id=target_thread_id and requester_user_id=auth.uid() and status not in ('closed')) then raise exception using errcode='42501',message='support conversation is unavailable'; end if;
 insert into public.support_thread_messages(thread_id,author_user_id,author_kind,body,source,idempotency_key,metadata)
 values(target_thread_id,auth.uid(),'requester',btrim(target_body),target_source,target_idempotency_key,coalesce(target_metadata,'{}'))
 on conflict(source,idempotency_key) do update set source=excluded.source returning id into message_id;
 update public.support_threads set status='open',last_message_at=timezone('utc',now()),updated_at=timezone('utc',now()) where id=target_thread_id;
 return message_id;
end $$;
revoke all on function public.reply_to_my_support_thread(uuid,text,text,text,jsonb) from public;
grant execute on function public.reply_to_my_support_thread(uuid,text,text,text,jsonb) to authenticated,service_role;
