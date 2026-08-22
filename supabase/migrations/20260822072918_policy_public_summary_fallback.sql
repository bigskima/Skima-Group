alter table public.policy_documents
  add column if not exists summary_content text not null default '';

update public.policy_documents
set summary_content = case key
  when 'policy.customer.terms' then 'SKIMA customer terms explain account use, LPG cylinder registration, service availability, pricing, payment, pickup and return, refill quantity, safety, refunds, disputes and your rights when using SKIMA services.'
  when 'policy.partner.participation' then 'SKIMA partner terms explain application and approval, Driver Partner, Fleet Driver, Vehicle Partner and Station Partner roles, service matching, ratings, safety, vehicle and station obligations, earnings, privacy, conduct, suspension and review rights.'
  else summary_content
end
where key in ('policy.customer.terms','policy.partner.participation');

create or replace function public.read_current_policy(target_policy_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  doc public.policy_documents%rowtype;
  v public.policy_versions%rowtype;
begin
  select * into doc from public.policy_documents where key=target_policy_key and status='active';
  if not found then return null; end if;

  select * into v
  from public.policy_versions
  where policy_document_id=doc.id
    and status='published'
    and (effective_from is null or effective_from<=timezone('utc',now()))
    and (effective_until is null or effective_until>timezone('utc',now()))
  order by effective_from desc nulls last, published_at desc nulls last
  limit 1;

  if not found then
    return jsonb_build_object(
      'key',doc.key,
      'title',doc.title,
      'audience',doc.audience,
      'serviceScope',doc.service_scope,
      'sourceUrl',doc.source_url,
      'isRequired',doc.is_required,
      'acceptanceStatement',doc.acceptance_statement,
      'summary',doc.summary_content,
      'published',false
    );
  end if;

  return jsonb_build_object(
    'key',doc.key,
    'title',doc.title,
    'audience',doc.audience,
    'serviceScope',doc.service_scope,
    'sourceUrl',coalesce(v.source_url,doc.source_url),
    'isRequired',doc.is_required,
    'acceptanceStatement',doc.acceptance_statement,
    'summary',coalesce(nullif(v.summary_content,''),doc.summary_content),
    'published',true,
    'versionId',v.id,
    'versionLabel',v.version_label,
    'content',v.full_content,
    'contentFormat',v.content_format,
    'contentHash',v.content_hash,
    'effectiveFrom',v.effective_from,
    'publishedAt',v.published_at,
    'requiresReacceptance',v.requires_reacceptance
  );
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
      'summary',d.summary_content,
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
