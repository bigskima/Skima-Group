create or replace function public.update_policy_draft(
  target_policy_version_id uuid,
  target_summary_content text,
  target_full_content text,
  target_content_format text,
  target_source_url text,
  target_source_reference text,
  target_source_updated_at timestamptz,
  target_requires_reacceptance boolean,
  target_metadata jsonb,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v public.policy_versions%rowtype;
  existing boolean;
  normalized_content text := coalesce(target_full_content,'');
begin
  if not public.can_draft_policy() then
    raise exception using errcode='42501', message='policy draft permission required';
  end if;
  if coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023', message='idempotency key is required';
  end if;
  select exists(
    select 1 from public.policy_events
    where source='skima.policy.runtime' and idempotency_key=target_idempotency_key and event_type='policy.draft_updated'
  ) into existing;
  if existing then return target_policy_version_id; end if;

  select * into v from public.policy_versions where id=target_policy_version_id for update;
  if not found then raise exception using errcode='22023', message='policy version not found'; end if;
  if v.status<>'draft' then raise exception using errcode='55000', message='only draft policy versions can be edited'; end if;
  if target_content_format not in ('markdown','plain_text','html') then
    raise exception using errcode='22023', message='unsupported policy content format';
  end if;

  update public.policy_versions
  set summary_content=coalesce(target_summary_content,''),
      full_content=normalized_content,
      content_format=target_content_format,
      content_hash=case when normalized_content='' then null else encode(digest(convert_to(normalized_content,'UTF8'),'sha256'),'hex') end,
      source_url=coalesce(target_source_url,source_url),
      source_reference=coalesce(target_source_reference,source_reference),
      source_updated_at=target_source_updated_at,
      requires_reacceptance=coalesce(target_requires_reacceptance,false),
      metadata=coalesce(target_metadata,'{}'::jsonb)
  where id=v.id;

  insert into public.policy_events(policy_document_id,policy_version_id,event_type,actor_user_id,source,idempotency_key,metadata)
  values(v.policy_document_id,v.id,'policy.draft_updated',auth.uid(),'skima.policy.runtime',target_idempotency_key,
    jsonb_build_object('contentHash',case when normalized_content='' then null else encode(digest(convert_to(normalized_content,'UTF8'),'sha256'),'hex') end));
  return v.id;
end;
$$;

create or replace function public.read_policy_admin_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if not public.can_read_policy_admin() then
    raise exception using errcode='42501', message='policy read permission required';
  end if;
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'documentId',d.id,
      'key',d.key,
      'title',d.title,
      'audience',d.audience,
      'serviceScope',d.service_scope,
      'sourceUrl',d.source_url,
      'sourceReference',d.source_reference,
      'acceptanceStatement',d.acceptance_statement,
      'isRequired',d.is_required,
      'status',d.status,
      'metadata',d.metadata,
      'versions',coalesce((
        select jsonb_agg(jsonb_build_object(
          'versionId',v.id,
          'versionLabel',v.version_label,
          'status',v.status,
          'summary',v.summary_content,
          'content',v.full_content,
          'contentFormat',v.content_format,
          'contentHash',v.content_hash,
          'effectiveFrom',v.effective_from,
          'effectiveUntil',v.effective_until,
          'publishedAt',v.published_at,
          'requiresReacceptance',v.requires_reacceptance,
          'sourceUrl',v.source_url,
          'sourceReference',v.source_reference,
          'sourceUpdatedAt',v.source_updated_at,
          'supersedesVersionId',v.supersedes_version_id,
          'createdAt',v.created_at,
          'updatedAt',v.updated_at
        ) order by v.created_at desc)
        from public.policy_versions v where v.policy_document_id=d.id
      ),'[]'::jsonb),
      'acceptanceCount',(select count(*) from public.policy_acceptances a where a.policy_document_id=d.id),
      'latestAcceptanceAt',(select max(a.accepted_at) from public.policy_acceptances a where a.policy_document_id=d.id)
    ) order by d.audience,d.title
  ),'[]'::jsonb) into result
  from public.policy_documents d;
  return result;
end;
$$;

create or replace function public.read_policy_acceptance_evidence(
  target_policy_key text default null,
  target_user_id uuid default null,
  target_application_id uuid default null,
  target_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if not public.can_read_policy_acceptance() then
    raise exception using errcode='42501', message='policy acceptance read permission required';
  end if;
  select coalesce(jsonb_agg(row_data order by accepted_at desc),'[]'::jsonb) into result
  from (
    select
      a.accepted_at,
      jsonb_build_object(
        'acceptanceId',a.id,
        'policyKey',d.key,
        'policyTitle',d.title,
        'versionId',v.id,
        'versionLabel',v.version_label,
        'contentHash',v.content_hash,
        'userId',a.user_id,
        'applicationId',a.application_id,
        'audience',a.audience,
        'roleKey',a.role_key,
        'acceptanceStatement',a.acceptance_statement,
        'acceptedAt',a.accepted_at,
        'source',a.source,
        'metadata',a.metadata
      ) row_data
    from public.policy_acceptances a
    join public.policy_documents d on d.id=a.policy_document_id
    join public.policy_versions v on v.id=a.policy_version_id
    where (target_policy_key is null or d.key=target_policy_key)
      and (target_user_id is null or a.user_id=target_user_id)
      and (target_application_id is null or a.application_id=target_application_id)
    order by a.accepted_at desc
    limit least(greatest(coalesce(target_limit,100),1),500)
  ) evidence;
  return result;
end;
$$;

revoke all on function public.update_policy_draft(uuid,text,text,text,text,text,timestamptz,boolean,jsonb,text) from public,anon;
revoke all on function public.read_policy_admin_catalog() from public,anon;
revoke all on function public.read_policy_acceptance_evidence(text,uuid,uuid,integer) from public,anon;
grant execute on function public.update_policy_draft(uuid,text,text,text,text,text,timestamptz,boolean,jsonb,text) to authenticated,service_role;
grant execute on function public.read_policy_admin_catalog() to authenticated,service_role;
grant execute on function public.read_policy_acceptance_evidence(text,uuid,uuid,integer) to authenticated,service_role;
