create table if not exists public.policy_documents (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  title text not null,
  audience text not null check (audience in ('customer','partner','public')),
  service_scope text not null default 'platform',
  source_url text null,
  source_reference text null,
  acceptance_statement text not null,
  is_required boolean not null default true,
  status text not null default 'active' check (status in ('active','inactive','retired')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_by uuid null references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint policy_documents_key_format check (key ~ '^[a-z][a-z0-9_.:-]{2,160}$')
);

create table if not exists public.policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_document_id uuid not null references public.policy_documents(id) on delete restrict,
  version_label text not null,
  summary_content text not null default '',
  full_content text not null default '',
  content_format text not null default 'markdown' check (content_format in ('markdown','plain_text','html')),
  content_hash text null,
  status text not null default 'draft' check (status in ('draft','published','superseded','retired')),
  effective_from timestamptz null,
  effective_until timestamptz null,
  published_at timestamptz null,
  requires_reacceptance boolean not null default false,
  source_url text null,
  source_reference text null,
  source_updated_at timestamptz null,
  supersedes_version_id uuid null references public.policy_versions(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_by uuid null references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint policy_versions_document_label_unique unique (policy_document_id, version_label),
  constraint policy_versions_window_valid check (effective_until is null or effective_from is null or effective_until > effective_from),
  constraint policy_versions_hash_format check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$')
);

create table if not exists public.policy_acceptances (
  id uuid primary key default gen_random_uuid(),
  policy_document_id uuid not null references public.policy_documents(id) on delete restrict,
  policy_version_id uuid not null references public.policy_versions(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  application_id uuid null references public.application_records(id) on delete restrict,
  audience text not null,
  role_key text null,
  acceptance_statement text not null,
  accepted_at timestamptz not null default timezone('utc', now()),
  source text not null default 'skima.app',
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default timezone('utc', now()),
  constraint policy_acceptances_source_idempotency_unique unique (source, idempotency_key)
);

create table if not exists public.policy_events (
  id uuid primary key default gen_random_uuid(),
  policy_document_id uuid not null references public.policy_documents(id) on delete restrict,
  policy_version_id uuid null references public.policy_versions(id) on delete restrict,
  acceptance_id uuid null references public.policy_acceptances(id) on delete restrict,
  event_type text not null,
  actor_user_id uuid null references public.profiles(id) on delete set null default auth.uid(),
  source text not null default 'skima.policy.runtime',
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  occurred_at timestamptz not null default timezone('utc', now()),
  constraint policy_events_source_idempotency_unique unique (source, idempotency_key)
);

create index if not exists policy_versions_current_idx on public.policy_versions(policy_document_id, status, effective_from desc, published_at desc);
create index if not exists policy_acceptances_user_document_idx on public.policy_acceptances(user_id, policy_document_id, accepted_at desc);
create index if not exists policy_acceptances_application_idx on public.policy_acceptances(application_id, policy_document_id) where application_id is not null;
create unique index if not exists policy_acceptances_user_version_context_unique on public.policy_acceptances(user_id, policy_version_id, coalesce(application_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists policy_events_document_time_idx on public.policy_events(policy_document_id, occurred_at desc);

alter table public.policy_documents enable row level security;
alter table public.policy_versions enable row level security;
alter table public.policy_acceptances enable row level security;
alter table public.policy_events enable row level security;

revoke all on table public.policy_documents from public, anon, authenticated;
revoke all on table public.policy_versions from public, anon, authenticated;
revoke all on table public.policy_acceptances from public, anon, authenticated;
revoke all on table public.policy_events from public, anon, authenticated;
grant all on table public.policy_documents to service_role;
grant all on table public.policy_versions to service_role;
grant all on table public.policy_acceptances to service_role;
grant all on table public.policy_events to service_role;

drop trigger if exists set_policy_documents_updated_at on public.policy_documents;
create trigger set_policy_documents_updated_at before update on public.policy_documents for each row execute function public.set_updated_at();
drop trigger if exists set_policy_versions_updated_at on public.policy_versions;
create trigger set_policy_versions_updated_at before update on public.policy_versions for each row execute function public.set_updated_at();

create or replace function public.prevent_published_policy_version_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('published','superseded','retired') then
      raise exception using errcode='55000', message='published policy versions are immutable';
    end if;
    return old;
  end if;
  if old.status in ('published','superseded','retired') and (
    new.policy_document_id is distinct from old.policy_document_id or
    new.version_label is distinct from old.version_label or
    new.summary_content is distinct from old.summary_content or
    new.full_content is distinct from old.full_content or
    new.content_format is distinct from old.content_format or
    new.content_hash is distinct from old.content_hash or
    new.source_url is distinct from old.source_url or
    new.source_reference is distinct from old.source_reference or
    new.source_updated_at is distinct from old.source_updated_at or
    new.supersedes_version_id is distinct from old.supersedes_version_id or
    new.requires_reacceptance is distinct from old.requires_reacceptance
  ) then
    raise exception using errcode='55000', message='published policy versions are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_published_policy_version_mutation on public.policy_versions;
create trigger guard_published_policy_version_mutation
before update or delete on public.policy_versions
for each row execute function public.prevent_published_policy_version_mutation();

create or replace function public.prevent_policy_acceptance_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception using errcode='55000', message='policy acceptances are append-only';
end;
$$;

drop trigger if exists guard_policy_acceptance_mutation on public.policy_acceptances;
create trigger guard_policy_acceptance_mutation
before update or delete on public.policy_acceptances
for each row execute function public.prevent_policy_acceptance_mutation();

create or replace function public.prevent_policy_event_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception using errcode='55000', message='policy events are append-only';
end;
$$;

drop trigger if exists guard_policy_event_mutation on public.policy_events;
create trigger guard_policy_event_mutation
before update or delete on public.policy_events
for each row execute function public.prevent_policy_event_mutation();

insert into public.permissions(key, description, risk_level, metadata)
values
  ('platform.policy.read','Read published and historical policy documents and versions.','standard','{}'::jsonb),
  ('platform.policy.draft','Create and update draft policy versions.','high','{}'::jsonb),
  ('platform.policy.publish','Publish, supersede, or retire policy versions.','critical','{}'::jsonb),
  ('platform.policy.acceptance.read','Read policy acceptance evidence for support, compliance, and audit.','high','{}'::jsonb)
on conflict (key) do update set description=excluded.description, risk_level=excluded.risk_level, updated_at=timezone('utc',now());

update public.platform_admin_role_templates t
set permission_keys=(
  select array_agg(distinct value order by value)
  from unnest(t.permission_keys || case t.key
    when 'platform.super_admin' then array['platform.policy.read','platform.policy.draft','platform.policy.publish','platform.policy.acceptance.read']::text[]
    when 'platform.company_admin' then array['platform.policy.read','platform.policy.draft','platform.policy.publish','platform.policy.acceptance.read']::text[]
    when 'platform.content_admin' then array['platform.policy.read','platform.policy.draft']::text[]
    when 'platform.support_admin' then array['platform.policy.read','platform.policy.acceptance.read']::text[]
    else array[]::text[] end) value
), updated_at=timezone('utc',now())
where t.key in ('platform.super_admin','platform.company_admin','platform.content_admin','platform.support_admin');

insert into public.role_permissions(role_id, permission_id, conditions)
select r.id, p.id, '{}'::jsonb
from public.roles r
join public.permissions p on p.key = any(case r.key
  when 'platform.super_admin' then array['platform.policy.read','platform.policy.draft','platform.policy.publish','platform.policy.acceptance.read']::text[]
  when 'platform.company_admin' then array['platform.policy.read','platform.policy.draft','platform.policy.publish','platform.policy.acceptance.read']::text[]
  when 'platform.content_admin' then array['platform.policy.read','platform.policy.draft']::text[]
  when 'platform.support_admin' then array['platform.policy.read','platform.policy.acceptance.read']::text[]
  else array[]::text[] end)
where r.key in ('platform.super_admin','platform.company_admin','platform.content_admin','platform.support_admin')
on conflict (role_id, permission_id) do nothing;

create or replace function public.can_read_policy_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select coalesce(public.has_permission('platform.policy.read', null), false); $$;
create or replace function public.can_draft_policy()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select coalesce(public.has_permission('platform.policy.draft', null), false); $$;
create or replace function public.can_publish_policy()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select coalesce(public.has_permission('platform.policy.publish', null), false); $$;
create or replace function public.can_read_policy_acceptance()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select coalesce(public.has_permission('platform.policy.acceptance.read', null), false); $$;

create policy policy_documents_admin_read on public.policy_documents for select to authenticated using (public.can_read_policy_admin());
create policy policy_versions_admin_read on public.policy_versions for select to authenticated using (public.can_read_policy_admin());
create policy policy_acceptances_owner_read on public.policy_acceptances for select to authenticated using (user_id=auth.uid() or public.can_read_policy_acceptance());
create policy policy_events_admin_read on public.policy_events for select to authenticated using (public.can_read_policy_admin() or public.can_read_policy_acceptance());

create or replace function public.create_policy_version(
  target_policy_key text,target_version_label text,target_summary_content text,target_full_content text,target_content_format text,
  target_source_url text,target_source_reference text,target_source_updated_at timestamptz,target_requires_reacceptance boolean,
  target_metadata jsonb,target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare doc public.policy_documents%rowtype; existing_id uuid; created_id uuid; normalized_content text:=coalesce(target_full_content,'');
begin
  if not public.can_draft_policy() then raise exception using errcode='42501',message='policy draft permission required'; end if;
  if coalesce(btrim(target_idempotency_key),'')='' then raise exception using errcode='22023',message='idempotency key is required'; end if;
  select * into doc from public.policy_documents where key=target_policy_key and status='active';
  if not found then raise exception using errcode='22023',message='unknown policy document'; end if;
  if coalesce(btrim(target_version_label),'')='' then raise exception using errcode='22023',message='version label is required'; end if;
  if target_content_format not in ('markdown','plain_text','html') then raise exception using errcode='22023',message='unsupported policy content format'; end if;
  select (metadata->>'createdVersionId')::uuid into existing_id from public.policy_events where source='skima.policy.runtime' and idempotency_key=target_idempotency_key and event_type='policy.version_created' limit 1;
  if existing_id is not null then return existing_id; end if;
  insert into public.policy_versions(policy_document_id,version_label,summary_content,full_content,content_format,content_hash,status,requires_reacceptance,source_url,source_reference,source_updated_at,metadata,created_by)
  values(doc.id,btrim(target_version_label),coalesce(target_summary_content,''),normalized_content,target_content_format,
    case when normalized_content='' then null else encode(digest(convert_to(normalized_content,'UTF8'),'sha256'),'hex') end,
    'draft',coalesce(target_requires_reacceptance,false),coalesce(target_source_url,doc.source_url),coalesce(target_source_reference,doc.source_reference),target_source_updated_at,coalesce(target_metadata,'{}'::jsonb),auth.uid()) returning id into created_id;
  insert into public.policy_events(policy_document_id,policy_version_id,event_type,actor_user_id,source,idempotency_key,metadata)
  values(doc.id,created_id,'policy.version_created',auth.uid(),'skima.policy.runtime',target_idempotency_key,jsonb_build_object('createdVersionId',created_id,'versionLabel',target_version_label));
  return created_id;
end; $$;

create or replace function public.publish_policy_version(target_policy_version_id uuid,target_effective_from timestamptz,target_requires_reacceptance boolean,target_reason text,target_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v public.policy_versions%rowtype; current_v public.policy_versions%rowtype; event_exists boolean; hash_value text;
begin
  if not public.can_publish_policy() then raise exception using errcode='42501',message='policy publish permission required'; end if;
  if coalesce(btrim(target_idempotency_key),'')='' then raise exception using errcode='22023',message='idempotency key is required'; end if;
  select exists(select 1 from public.policy_events where source='skima.policy.runtime' and idempotency_key=target_idempotency_key and event_type='policy.version_published') into event_exists;
  if event_exists then return target_policy_version_id; end if;
  select * into v from public.policy_versions where id=target_policy_version_id for update;
  if not found then raise exception using errcode='22023',message='policy version not found'; end if;
  if v.status<>'draft' then raise exception using errcode='55000',message='only draft policy versions can be published'; end if;
  if coalesce(length(btrim(v.full_content)),0)<100 then raise exception using errcode='22023',message='full policy content must be imported before publication'; end if;
  if coalesce(length(btrim(v.summary_content)),0)<20 then raise exception using errcode='22023',message='policy summary must be provided before publication'; end if;
  hash_value:=encode(digest(convert_to(v.full_content,'UTF8'),'sha256'),'hex');
  select * into current_v from public.policy_versions where policy_document_id=v.policy_document_id and status='published' and id<>v.id order by published_at desc nulls last,created_at desc limit 1 for update;
  if found then update public.policy_versions set status='superseded',effective_until=coalesce(target_effective_from,timezone('utc',now())) where id=current_v.id; end if;
  update public.policy_versions set status='published',effective_from=coalesce(target_effective_from,timezone('utc',now())),effective_until=null,published_at=timezone('utc',now()),requires_reacceptance=coalesce(target_requires_reacceptance,v.requires_reacceptance),content_hash=hash_value,supersedes_version_id=current_v.id where id=v.id;
  insert into public.policy_events(policy_document_id,policy_version_id,event_type,actor_user_id,source,idempotency_key,metadata)
  values(v.policy_document_id,v.id,'policy.version_published',auth.uid(),'skima.policy.runtime',target_idempotency_key,jsonb_build_object('reason',coalesce(target_reason,''),'supersedesVersionId',current_v.id,'contentHash',hash_value));
  return v.id;
end; $$;

create or replace function public.read_current_policy(target_policy_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare doc public.policy_documents%rowtype; v public.policy_versions%rowtype;
begin
  select * into doc from public.policy_documents where key=target_policy_key and status='active';
  if not found then return null; end if;
  select * into v from public.policy_versions where policy_document_id=doc.id and status='published' and (effective_from is null or effective_from<=timezone('utc',now())) and (effective_until is null or effective_until>timezone('utc',now())) order by effective_from desc nulls last,published_at desc nulls last limit 1;
  if not found then return jsonb_build_object('key',doc.key,'title',doc.title,'audience',doc.audience,'serviceScope',doc.service_scope,'sourceUrl',doc.source_url,'isRequired',doc.is_required,'acceptanceStatement',doc.acceptance_statement,'published',false); end if;
  return jsonb_build_object('key',doc.key,'title',doc.title,'audience',doc.audience,'serviceScope',doc.service_scope,'sourceUrl',coalesce(v.source_url,doc.source_url),'isRequired',doc.is_required,'acceptanceStatement',doc.acceptance_statement,'published',true,'versionId',v.id,'versionLabel',v.version_label,'summary',v.summary_content,'content',v.full_content,'contentFormat',v.content_format,'contentHash',v.content_hash,'effectiveFrom',v.effective_from,'publishedAt',v.published_at,'requiresReacceptance',v.requires_reacceptance);
end; $$;

create or replace function public.accept_policy(target_policy_key text,target_policy_version_id uuid,target_application_id uuid,target_role_key text,target_acceptance_statement text,target_source text,target_idempotency_key text,target_metadata jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare doc public.policy_documents%rowtype; v public.policy_versions%rowtype; app public.application_records%rowtype; existing_id uuid; acceptance_id uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  if coalesce(btrim(target_idempotency_key),'')='' then raise exception using errcode='22023',message='idempotency key is required'; end if;
  select * into doc from public.policy_documents where key=target_policy_key and status='active'; if not found then raise exception using errcode='22023',message='policy document not found'; end if;
  select * into v from public.policy_versions where id=target_policy_version_id and policy_document_id=doc.id;
  if not found or v.status<>'published' or (v.effective_from is not null and v.effective_from>timezone('utc',now())) or (v.effective_until is not null and v.effective_until<=timezone('utc',now())) then raise exception using errcode='55000',message='the presented policy version is no longer current'; end if;
  if coalesce(target_acceptance_statement,'')<>doc.acceptance_statement then raise exception using errcode='22023',message='acceptance statement does not match the current policy'; end if;
  if target_application_id is not null then select * into app from public.application_records where id=target_application_id; if not found or app.applicant_user_id<>auth.uid() then raise exception using errcode='42501',message='application does not belong to the current user'; end if; end if;
  select id into existing_id from public.policy_acceptances where source=coalesce(nullif(btrim(target_source),''),'skima.app') and idempotency_key=target_idempotency_key; if existing_id is not null then return existing_id; end if;
  insert into public.policy_acceptances(policy_document_id,policy_version_id,user_id,application_id,audience,role_key,acceptance_statement,source,idempotency_key,metadata)
  values(doc.id,v.id,auth.uid(),target_application_id,doc.audience,nullif(btrim(target_role_key),''),doc.acceptance_statement,coalesce(nullif(btrim(target_source),''),'skima.app'),target_idempotency_key,coalesce(target_metadata,'{}'::jsonb)) returning id into acceptance_id;
  insert into public.policy_events(policy_document_id,policy_version_id,acceptance_id,event_type,actor_user_id,source,idempotency_key,metadata)
  values(doc.id,v.id,acceptance_id,'policy.accepted',auth.uid(),'skima.policy.runtime','acceptance-event:'||acceptance_id::text,jsonb_build_object('applicationId',target_application_id,'roleKey',target_role_key));
  return acceptance_id;
end; $$;

create or replace function public.has_accepted_current_policy(target_policy_key text,target_application_id uuid default null)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare current_version uuid;
begin
  if auth.uid() is null then return false; end if;
  select v.id into current_version from public.policy_documents d join public.policy_versions v on v.policy_document_id=d.id where d.key=target_policy_key and d.status='active' and d.is_required and v.status='published' and (v.effective_from is null or v.effective_from<=timezone('utc',now())) and (v.effective_until is null or v.effective_until>timezone('utc',now())) order by v.effective_from desc nulls last,v.published_at desc nulls last limit 1;
  if current_version is null then return true; end if;
  return exists(select 1 from public.policy_acceptances a where a.user_id=auth.uid() and a.policy_version_id=current_version and (target_application_id is null or a.application_id=target_application_id));
end; $$;

revoke all on function public.can_read_policy_admin() from public,anon,authenticated;
revoke all on function public.can_draft_policy() from public,anon,authenticated;
revoke all on function public.can_publish_policy() from public,anon,authenticated;
revoke all on function public.can_read_policy_acceptance() from public,anon,authenticated;
revoke all on function public.create_policy_version(text,text,text,text,text,text,text,timestamptz,boolean,jsonb,text) from public,anon;
revoke all on function public.publish_policy_version(uuid,timestamptz,boolean,text,text) from public,anon;
revoke all on function public.read_current_policy(text) from public;
revoke all on function public.accept_policy(text,uuid,uuid,text,text,text,text,jsonb) from public,anon;
revoke all on function public.has_accepted_current_policy(text,uuid) from public,anon;
grant execute on function public.create_policy_version(text,text,text,text,text,text,text,timestamptz,boolean,jsonb,text) to authenticated,service_role;
grant execute on function public.publish_policy_version(uuid,timestamptz,boolean,text,text) to authenticated,service_role;
grant execute on function public.read_current_policy(text) to anon,authenticated,service_role;
grant execute on function public.accept_policy(text,uuid,uuid,text,text,text,text,jsonb) to authenticated,service_role;
grant execute on function public.has_accepted_current_policy(text,uuid) to authenticated,service_role;

insert into public.policy_documents(key,title,audience,service_scope,source_url,source_reference,acceptance_statement,is_required,status,metadata)
values
('policy.customer.terms','SKIMA Customer Terms of Service & LPG Service Policy','customer','lpg','https://odd-magpie-adf.notion.site/SKIMA-Customer-Terms-of-Service-LPG-Service-Policy-3c0efdb226628149a9c0db36e126d8cc?pvs=74','notion:3c0efdb2-2662-8149-a9c0-db36e126d8cc','I have read and agree to the SKIMA Customer Terms of Service & LPG Service Policy.',true,'active',jsonb_build_object('canonicalVersion','1.0','canonicalUpdatedDate','2026-08-18')),
('policy.partner.participation','SKIMA Partner Participation Terms & Public Policy','partner','lpg','https://odd-magpie-adf.notion.site/SKIMA-Partner-Participation-Terms-Public-Policy-3c0efdb22662814a944cd3dba9d6d11c?source=copy_link','notion:3c0efdb2-2662-814a-944c-d3dba9d6d11c','I have read and agree to the SKIMA Partner Participation Terms and the terms applicable to my role.',true,'active',jsonb_build_object('canonicalVersion','1.0','canonicalUpdatedDate','2026-08-18'))
on conflict (key) do update set title=excluded.title,audience=excluded.audience,service_scope=excluded.service_scope,source_url=excluded.source_url,source_reference=excluded.source_reference,acceptance_statement=excluded.acceptance_statement,is_required=excluded.is_required,status=excluded.status,metadata=excluded.metadata,updated_at=timezone('utc',now());