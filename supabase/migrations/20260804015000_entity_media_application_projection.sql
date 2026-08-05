begin;

create table if not exists public.entity_media_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  entity_type text not null check (entity_type ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  entity_id uuid not null,
  media_asset_id uuid not null references public.media_assets(id) on delete restrict,
  media_role text not null check (media_role ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  is_primary boolean not null default false,
  display_order integer not null default 0 check (display_order >= 0),
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  source text not null check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key),
  unique (entity_type, entity_id, media_asset_id, media_role)
);

create index if not exists entity_media_links_entity_lookup_idx
on public.entity_media_links (entity_type, entity_id, status, display_order, created_at);

create index if not exists entity_media_links_asset_lookup_idx
on public.entity_media_links (media_asset_id, status);

create unique index if not exists entity_media_links_one_primary_role_idx
on public.entity_media_links (entity_type, entity_id, media_role)
where is_primary and status = 'active';

update public.application_type_definitions
set activation_policy = jsonb_set(
      activation_policy,
      '{media_projections}',
      '[{"requirement_key":"driver.profile-photo","media_role":"profile.photo","is_primary":true}]'::jsonb,
      true
    ),
    updated_at = timezone('utc', now())
where key = 'application.lpg.driver.phase-one';

update public.application_type_definitions
set activation_policy = jsonb_set(
      activation_policy,
      '{media_projections}',
      '[{"requirement_key":"vehicle.photo","media_role":"vehicle.photo","is_primary":true}]'::jsonb,
      true
    ),
    updated_at = timezone('utc', now())
where key = 'application.lpg.vehicle.phase-one';

update public.application_type_definitions
set activation_policy = jsonb_set(
      activation_policy,
      '{media_projections}',
      '[{"requirement_key":"station.photo","media_role":"station.photo","is_primary":true}]'::jsonb,
      true
    ),
    updated_at = timezone('utc', now())
where key = 'application.lpg.station.phase-one';

create or replace function public.project_application_media_assets(
  target_application_id uuid,
  target_entity_type text default null,
  target_entity_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  application_record record;
  projection jsonb;
  projections jsonb;
  document_record record;
  resolved_entity_type text;
  resolved_entity_id uuid;
  requirement_key text;
  media_role_key text;
  projection_is_primary boolean;
  link_is_primary boolean;
  base_display_order integer;
  current_display_order integer;
  projected_count integer := 0;
begin
  if target_application_id is null then
    raise exception 'target_application_id is required';
  end if;

  select
    application.*,
    application_type.activation_policy
  into application_record
  from public.application_records application
  join public.application_type_definitions application_type
    on application_type.id = application.application_type_id
  where application.id = target_application_id;

  if not found then
    raise exception 'target_application_id must reference an application';
  end if;

  if application_record.status <> 'approved' then
    raise exception 'only approved application media can be projected';
  end if;

  resolved_entity_type := coalesce(target_entity_type, application_record.activated_subject_type);
  resolved_entity_id := coalesce(target_entity_id, application_record.activated_subject_id);

  if resolved_entity_type is null
    or resolved_entity_type !~ '^[a-z][a-z0-9_.:-]{2,120}$'
    or resolved_entity_id is null then
    raise exception 'an activated target entity is required for application media projection';
  end if;

  projections := coalesce(application_record.activation_policy -> 'media_projections', '[]'::jsonb);
  if jsonb_typeof(projections) <> 'array' then
    raise exception 'application media_projections policy must be an array';
  end if;

  for projection in select value from jsonb_array_elements(projections)
  loop
    if jsonb_typeof(projection) <> 'object' then
      raise exception 'each application media projection must be an object';
    end if;

    requirement_key := nullif(projection ->> 'requirement_key', '');
    media_role_key := nullif(projection ->> 'media_role', '');
    projection_is_primary := coalesce((projection ->> 'is_primary')::boolean, false);
    base_display_order := coalesce((projection ->> 'display_order')::integer, 0);
    current_display_order := base_display_order;
    link_is_primary := projection_is_primary;

    if requirement_key is null
      or requirement_key !~ '^[a-z][a-z0-9_.:-]{2,120}$'
      or media_role_key is null
      or media_role_key !~ '^[a-z][a-z0-9_.:-]{2,120}$'
      or base_display_order < 0 then
      raise exception 'application media projection policy is invalid';
    end if;

    for document_record in
      select document.media_asset_id, document.id as document_submission_id
      from public.document_submissions document
      join public.document_requirements requirement on requirement.id = document.requirement_id
      join public.media_assets media on media.id = document.media_asset_id
      where document.application_id = target_application_id
        and requirement.key = requirement_key
        and document.status = 'approved'
        and media.status = 'active'
      order by document.created_at desc, document.id
    loop
      if application_record.organization_id is not null then
        update public.media_assets
        set organization_id = coalesce(organization_id, application_record.organization_id),
            updated_at = timezone('utc', now())
        where id = document_record.media_asset_id;
      end if;

      if link_is_primary then
        update public.entity_media_links
        set is_primary = false,
            updated_at = timezone('utc', now())
        where entity_type = resolved_entity_type
          and entity_id = resolved_entity_id
          and media_role = media_role_key
          and is_primary
          and status = 'active';
      end if;

      insert into public.entity_media_links (
        organization_id,
        entity_type,
        entity_id,
        media_asset_id,
        media_role,
        is_primary,
        display_order,
        status,
        metadata,
        source,
        idempotency_key,
        created_by
      )
      values (
        application_record.organization_id,
        resolved_entity_type,
        resolved_entity_id,
        document_record.media_asset_id,
        media_role_key,
        link_is_primary,
        current_display_order,
        'active',
        jsonb_build_object(
          'application_id', target_application_id,
          'document_submission_id', document_record.document_submission_id,
          'requirement_key', requirement_key
        ),
        'platform.application_media_projection',
        target_application_id::text || ':' || resolved_entity_type || ':' ||
          resolved_entity_id::text || ':' || media_role_key || ':' || document_record.media_asset_id::text,
        application_record.applicant_user_id
      )
      on conflict (entity_type, entity_id, media_asset_id, media_role) do update
      set organization_id = excluded.organization_id,
          is_primary = excluded.is_primary,
          display_order = excluded.display_order,
          status = 'active',
          metadata = public.entity_media_links.metadata || excluded.metadata,
          updated_at = timezone('utc', now());

      projected_count := projected_count + 1;
      current_display_order := current_display_order + 1;
      link_is_primary := false;
    end loop;
  end loop;

  return projected_count;
end;
$$;

create or replace function public.apply_configured_application_media()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved'
    and new.activated_subject_type is not null
    and new.activated_subject_id is not null
    and (
      old.activated_subject_type is distinct from new.activated_subject_type
      or old.activated_subject_id is distinct from new.activated_subject_id
    ) then
    perform public.project_application_media_assets(new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists application_records_apply_configured_media
on public.application_records;

create trigger application_records_apply_configured_media
after update of activated_subject_id, activated_subject_type on public.application_records
for each row execute function public.apply_configured_application_media();

create or replace function public.apply_approved_document_media_projection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved'
    and old.status is distinct from new.status
    and new.application_id is not null
    and exists (
      select 1
      from public.application_records application
      where application.id = new.application_id
        and application.status = 'approved'
        and application.activated_subject_type is not null
        and application.activated_subject_id is not null
    ) then
    perform public.project_application_media_assets(new.application_id);
  end if;

  return new;
end;
$$;

drop trigger if exists document_submissions_project_approved_media
on public.document_submissions;

create trigger document_submissions_project_approved_media
after update of status on public.document_submissions
for each row execute function public.apply_approved_document_media_projection();

alter table public.entity_media_links enable row level security;

drop policy if exists entity_media_links_select_accessible on public.entity_media_links;
drop policy if exists entity_media_links_no_direct_insert on public.entity_media_links;
drop policy if exists entity_media_links_no_direct_update on public.entity_media_links;
drop policy if exists entity_media_links_no_direct_delete on public.entity_media_links;

create policy entity_media_links_select_accessible
on public.entity_media_links
for select to authenticated
using (
  exists (
    select 1
    from public.media_assets media
    where media.id = entity_media_links.media_asset_id
      and media.status = 'active'
  )
);

create policy entity_media_links_no_direct_insert
on public.entity_media_links
for insert to authenticated
with check (false);

create policy entity_media_links_no_direct_update
on public.entity_media_links
for update to authenticated
using (false)
with check (false);

create policy entity_media_links_no_direct_delete
on public.entity_media_links
for delete to authenticated
using (false);

do $$
declare
  application_record record;
begin
  for application_record in
    select application.id
    from public.application_records application
    where application.status = 'approved'
      and application.activated_subject_type is not null
      and application.activated_subject_id is not null
  loop
    perform public.project_application_media_assets(application_record.id);
  end loop;
end;
$$;

revoke all on table public.entity_media_links from public, anon, authenticated;
grant select on table public.entity_media_links to authenticated, service_role;
grant all on table public.entity_media_links to service_role;

revoke all on function public.project_application_media_assets(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.apply_configured_application_media() from public, anon, authenticated;
revoke all on function public.apply_approved_document_media_projection() from public, anon, authenticated;
grant execute on function public.project_application_media_assets(uuid, text, uuid) to service_role;

commit;
