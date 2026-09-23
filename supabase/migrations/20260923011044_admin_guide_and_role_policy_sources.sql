begin;

create table if not exists public.admin_knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_.:-]{2,160}$'),
  title text not null,
  version_label text not null,
  source_url text not null,
  source_document_id text,
  source_revision text,
  content_format text not null default 'markdown' check (content_format in ('markdown','plain_text')),
  content text not null default '',
  content_hash text,
  status text not null default 'active' check (status in ('draft','active','retired')),
  last_synced_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now())
);

alter table public.admin_knowledge_documents enable row level security;

drop policy if exists admin_knowledge_documents_platform_admin_read on public.admin_knowledge_documents;
create policy admin_knowledge_documents_platform_admin_read
on public.admin_knowledge_documents
for select
to authenticated
using (
  exists (
    select 1
    from public.platform_admins admin_record
    where admin_record.user_id=auth.uid()
      and admin_record.status='active'
  )
);

create or replace function public.read_admin_operational_guide()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  guide public.admin_knowledge_documents%rowtype;
begin
  if auth.role()<>'service_role'
     and not exists (
       select 1 from public.platform_admins admin_record
       where admin_record.user_id=auth.uid()
         and admin_record.status='active'
     ) then
    raise exception using errcode='42501',message='active SKIMA administrator access is required';
  end if;

  select * into guide
  from public.admin_knowledge_documents
  where key='guide.admin.operations'
    and status='active'
  order by updated_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'available',false,
      'key','guide.admin.operations',
      'title','SKIMA Administration — Operational Handbook'
    );
  end if;

  return jsonb_build_object(
    'available',true,
    'key',guide.key,
    'title',guide.title,
    'versionLabel',guide.version_label,
    'sourceUrl',guide.source_url,
    'sourceDocumentId',guide.source_document_id,
    'sourceRevision',guide.source_revision,
    'contentFormat',guide.content_format,
    'content',guide.content,
    'contentHash',guide.content_hash,
    'lastSyncedAt',guide.last_synced_at,
    'metadata',guide.metadata,
    'updatedAt',guide.updated_at
  );
end
$$;

grant execute on function public.read_admin_operational_guide() to authenticated,service_role;

insert into public.policy_documents(
  key,title,audience,service_scope,source_url,source_reference,
  acceptance_statement,summary_content,is_required,status,metadata
)
values
(
  'policy.privacy.notice',
  'SKIMA Privacy Notice — Nigeria',
  'public',
  'platform',
  'https://docs.google.com/document/d/1vw43-cbquF7t4e4ZcAMxB_N8YGu6i-VUP3Mldvs0YsQ/edit?usp=drivesdk',
  'gdrive:1vw43-cbquF7t4e4ZcAMxB_N8YGu6i-VUP3Mldvs0YsQ',
  'I acknowledge that I have had the opportunity to read the SKIMA Privacy Notice.',
  'How SKIMA uses account, location, verification, financial, operational and AI-related data, who it may be shared with, how it is protected, and the privacy rights available under applicable law.',
  false,'active',
  jsonb_build_object('canonicalVersion','2.0','canonicalUpdatedDate','2026-09-23','sourceType','google_drive')
),
(
  'policy.driver.operations',
  'SKIMA Driver & Managed Driver Operations Policy',
  'partner',
  'lpg',
  'https://docs.google.com/document/d/1cIJrh8E3YBbNipbQqHffBKQnHjamKC2BfP6MN36xT1Q/edit?usp=drivesdk',
  'gdrive:1cIJrh8E3YBbNipbQqHffBKQnHjamKC2BfP6MN36xT1Q',
  'I acknowledge the SKIMA Driver & Managed Driver Operations Policy applicable to my Driver role.',
  'Operational rules for Driver Partners and SKIMA Managed Drivers, including online status, background location, vehicle eligibility, cylinder custody, earnings, payout accounts, privacy and safety.',
  false,'active',
  jsonb_build_object('canonicalVersion','2.0','canonicalUpdatedDate','2026-09-23','sourceType','google_drive')
),
(
  'policy.station.operations',
  'SKIMA Station Partner Participation & Operations Policy',
  'partner',
  'lpg',
  'https://docs.google.com/document/d/1B56XF2mQJVQYO_1N-D6R_51hvCGTVl00ZZTwC4YeB8Q/edit?usp=drivesdk',
  'gdrive:1B56XF2mQJVQYO_1N-D6R_51hvCGTVl00ZZTwC4YeB8Q',
  'I acknowledge the SKIMA Station Partner Participation & Operations Policy applicable to my Station role.',
  'Operational rules for Station Partners, including eligibility, price, inventory, cylinder scans, actual quantity, settlements, payout accounts, staff access, privacy and safety.',
  false,'active',
  jsonb_build_object('canonicalVersion','2.0','canonicalUpdatedDate','2026-09-23','sourceType','google_drive')
)
on conflict (key) do update set
  title=excluded.title,
  audience=excluded.audience,
  service_scope=excluded.service_scope,
  source_url=excluded.source_url,
  source_reference=excluded.source_reference,
  acceptance_statement=excluded.acceptance_statement,
  summary_content=excluded.summary_content,
  is_required=excluded.is_required,
  status=excluded.status,
  metadata=public.policy_documents.metadata || excluded.metadata,
  updated_at=timezone('utc',now());

update public.policy_documents
set source_url='https://docs.google.com/document/d/1f6Mm-lbrDppTF0Sa9SL4XvU1KBsnyi0QLl6c6Fz5f6A/edit?usp=drivesdk',
    source_reference='gdrive:1f6Mm-lbrDppTF0Sa9SL4XvU1KBsnyi0QLl6c6Fz5f6A',
    metadata=metadata || jsonb_build_object('canonicalVersion','2.0','canonicalUpdatedDate','2026-09-23','sourceType','google_drive'),
    updated_at=timezone('utc',now())
where key='policy.customer.terms';

update public.policy_documents
set source_url='https://docs.google.com/document/d/1YbOBejHhnDs2kqAV3kl1YbpLbV2laeZeYrAer12kffE/edit?usp=drivesdk',
    source_reference='gdrive:1YbOBejHhnDs2kqAV3kl1YbpLbV2laeZeYrAer12kffE',
    metadata=metadata || jsonb_build_object('canonicalVersion','2.0','canonicalUpdatedDate','2026-09-23','sourceType','google_drive'),
    updated_at=timezone('utc',now())
where key='policy.partner.participation';

commit;
