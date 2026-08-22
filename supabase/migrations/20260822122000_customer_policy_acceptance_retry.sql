begin;

create or replace function public.accept_policy(target_policy_key text,target_policy_version_id uuid,target_application_id uuid,target_role_key text,target_acceptance_statement text,target_source text,target_idempotency_key text,target_metadata jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare doc public.policy_documents%rowtype;v public.policy_versions%rowtype;app public.application_records%rowtype;acceptance_id uuid;resolved_source text:=coalesce(nullif(btrim(target_source),''),'skima.app');
begin
 if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
 if coalesce(btrim(target_idempotency_key),'')='' then raise exception using errcode='22023',message='idempotency key is required'; end if;
 select * into doc from public.policy_documents where key=target_policy_key and status='active'; if not found then raise exception using errcode='22023',message='policy document not found'; end if;
 select * into v from public.policy_versions where id=target_policy_version_id and policy_document_id=doc.id;
 if not found or v.status<>'published' or (v.effective_from is not null and v.effective_from>timezone('utc',now())) or (v.effective_until is not null and v.effective_until<=timezone('utc',now())) then raise exception using errcode='55000',message='the presented policy version is no longer current'; end if;
 if coalesce(target_acceptance_statement,'')<>doc.acceptance_statement then raise exception using errcode='22023',message='acceptance statement does not match the current policy'; end if;
 if target_application_id is not null then select * into app from public.application_records where id=target_application_id; if not found or app.applicant_user_id<>auth.uid() then raise exception using errcode='42501',message='application does not belong to the current user'; end if; end if;
 select id into acceptance_id from public.policy_acceptances where source=resolved_source and idempotency_key=target_idempotency_key;
 if acceptance_id is null then select id into acceptance_id from public.policy_acceptances where user_id=auth.uid() and policy_version_id=v.id and application_id is not distinct from target_application_id order by accepted_at desc limit 1; end if;
 if acceptance_id is not null then return acceptance_id; end if;
 insert into public.policy_acceptances(policy_document_id,policy_version_id,user_id,application_id,audience,role_key,acceptance_statement,source,idempotency_key,metadata)
 values(doc.id,v.id,auth.uid(),target_application_id,doc.audience,nullif(btrim(target_role_key),''),doc.acceptance_statement,resolved_source,target_idempotency_key,coalesce(target_metadata,'{}')) returning id into acceptance_id;
 insert into public.policy_events(policy_document_id,policy_version_id,acceptance_id,event_type,actor_user_id,source,idempotency_key,metadata)
 values(doc.id,v.id,acceptance_id,'policy.accepted',auth.uid(),'skima.policy.runtime','acceptance-event:'||acceptance_id::text,jsonb_build_object('applicationId',target_application_id,'roleKey',target_role_key)) on conflict(source,idempotency_key) do nothing;
 return acceptance_id;
end $$;
revoke all on function public.accept_policy(text,uuid,uuid,text,text,text,text,jsonb) from public,anon;
grant execute on function public.accept_policy(text,uuid,uuid,text,text,text,text,jsonb) to authenticated,service_role;
commit;
