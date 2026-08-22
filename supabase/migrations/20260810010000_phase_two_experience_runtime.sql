begin;

alter table public.lpg_cylinders
  add column if not exists display_name text;

alter table public.lpg_cylinders
  drop constraint if exists lpg_cylinders_display_name_check;

alter table public.lpg_cylinders
  add constraint lpg_cylinders_display_name_check
  check (
    display_name is null
    or (
      char_length(btrim(display_name)) between 2 and 80
      and display_name = btrim(display_name)
    )
  );

update public.provider_adapters
set status = 'active',
    config = config || jsonb_build_object(
      'model', 'gemini-3.1-flash-image',
      'response_mode', 'image',
      'control', 'presentation_derivative_only'
    ),
    updated_at = timezone('utc', now())
where provider_kind = 'ai'
  and key = 'provider.ai.google-gemini';

update public.provider_adapters
set status = 'inactive',
    updated_at = timezone('utc', now())
where provider_kind = 'ai'
  and key = 'provider.ai.sandbox';

insert into public.ai_task_definitions (
  key,
  display_name,
  task_type,
  provider_adapter_id,
  prompt_config,
  output_schema,
  status
)
select
  'ai.lpg.cylinder.presentation',
  'Cylinder Presentation Image',
  'custom',
  provider.id,
  '{"control":"presentation_derivative_only","preserve_original":true,"no_safety_decisions":true,"requires_owned_subject":true}'::jsonb,
  '{"type":"object","required":["mediaAssetId","mediaRole"],"properties":{"mediaAssetId":{"type":"string","format":"uuid"},"mediaRole":{"const":"presentation.ai"}}}'::jsonb,
  'active'
from public.provider_adapters provider
where provider.provider_kind = 'ai'
  and provider.key = 'provider.ai.google-gemini'
on conflict (key) do update
set display_name = excluded.display_name,
    task_type = excluded.task_type,
    provider_adapter_id = excluded.provider_adapter_id,
    prompt_config = excluded.prompt_config,
    output_schema = excluded.output_schema,
    status = excluded.status,
    updated_at = timezone('utc', now());

update public.configuration_entries
set value = value || jsonb_build_object(
      'active_provider_key', 'provider.ai.google-gemini',
      'selection_source', 'configuration'
    ),
    version = version + 1,
    updated_at = timezone('utc', now())
where namespace = 'platform.ai'
  and key = 'provider_selection'
  and scope_type = 'global'
  and scope_id is null
  and status = 'active';

create or replace function public.queue_owned_presentation_ai_task(
  target_task_key text,
  target_source text,
  target_subject_type text,
  target_subject_id uuid,
  target_input jsonb,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  task_definition_id uuid;
  task_run_id uuid;
  existing_run record;
begin
  if auth.uid() is null then
    raise exception 'authentication is required';
  end if;

  if target_task_key <> 'ai.lpg.cylinder.presentation'
    or target_subject_type <> 'lpg_cylinder'
    or target_subject_id is null then
    raise exception 'presentation task scope is not supported';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$'
    or target_idempotency_key is null or btrim(target_idempotency_key) = ''
    or target_input is null or jsonb_typeof(target_input) <> 'object' then
    raise exception 'presentation task request is invalid';
  end if;

  if not exists (
    select 1 from public.lpg_cylinders cylinder
    where cylinder.id = target_subject_id
      and cylinder.owner_user_id = auth.uid()
      and cylinder.status <> 'deactivated'
  ) then
    raise exception 'owned active cylinder was not found';
  end if;

  select definition.id
  into task_definition_id
  from public.ai_task_definitions definition
  join public.provider_adapters provider on provider.id = definition.provider_adapter_id
  where definition.key = target_task_key
    and definition.status = 'active'
    and provider.key = 'provider.ai.google-gemini'
    and provider.status = 'active';

  if task_definition_id is null then
    raise exception 'presentation generation is not configured';
  end if;

  insert into public.ai_task_runs (
    task_definition_id, subject_type, subject_id, status, input,
    requested_by, source, idempotency_key
  )
  values (
    task_definition_id, target_subject_type, target_subject_id, 'queued', target_input,
    auth.uid(), target_source, target_idempotency_key
  )
  on conflict (source, idempotency_key) where idempotency_key is not null
  do nothing
  returning id into task_run_id;

  if task_run_id is null then
    select run.* into existing_run
    from public.ai_task_runs run
    where run.source = target_source
      and run.idempotency_key = target_idempotency_key;

    if existing_run.task_definition_id <> task_definition_id
      or existing_run.subject_type <> target_subject_type
      or existing_run.subject_id is distinct from target_subject_id
      or existing_run.input <> target_input then
      raise exception 'presentation idempotency key conflicts with another request';
    end if;
    return existing_run.id;
  end if;

  insert into public.ai_task_run_events (ai_task_run_id, status, idempotency_key, metadata)
  values (task_run_id, 'queued', target_idempotency_key || ':queued', jsonb_build_object('source', target_source))
  on conflict do nothing;

  return task_run_id;
end;
$$;

create or replace function public.register_entity_presentation_media(
  target_entity_type text,
  target_entity_id uuid,
  target_media_asset_id uuid,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  link_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role is required';
  end if;

  if target_entity_type !~ '^[a-z][a-z0-9_.:-]{2,120}$'
    or target_entity_id is null
    or target_media_asset_id is null
    or target_idempotency_key is null
    or btrim(target_idempotency_key) = ''
    or target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'presentation media link request is invalid';
  end if;

  update public.entity_media_links
  set is_primary = false,
      status = 'archived',
      updated_at = timezone('utc', now())
  where entity_type = target_entity_type
    and entity_id = target_entity_id
    and media_role = 'presentation.ai'
    and status = 'active';

  insert into public.entity_media_links (
    entity_type, entity_id, media_asset_id, media_role, is_primary,
    display_order, status, metadata, source, idempotency_key
  )
  values (
    target_entity_type, target_entity_id, target_media_asset_id, 'presentation.ai', true,
    0, 'active', target_metadata, 'platform.ai_engine', target_idempotency_key
  )
  on conflict (source, idempotency_key) do update
  set media_asset_id = excluded.media_asset_id,
      is_primary = true,
      status = 'active',
      metadata = public.entity_media_links.metadata || excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into link_id;

  return link_id;
end;
$$;

drop policy if exists ai_task_definitions_select_privileged on public.ai_task_definitions;
create policy ai_task_definitions_select_active_or_privileged
on public.ai_task_definitions
for select to authenticated
using (
  status = 'active'
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
);

create or replace function public.set_lpg_cylinder_display_name(
  target_cylinder_id uuid,
  target_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cylinder_owner uuid;
  normalized_name text := nullif(btrim(target_display_name), '');
begin
  if auth.uid() is null then
    raise exception 'authentication is required';
  end if;

  if target_cylinder_id is null then
    raise exception 'target_cylinder_id is required';
  end if;

  if normalized_name is null or char_length(normalized_name) not between 2 and 80 then
    raise exception 'target_display_name must contain between 2 and 80 characters';
  end if;

  select cylinder.owner_user_id
  into cylinder_owner
  from public.lpg_cylinders cylinder
  where cylinder.id = target_cylinder_id
    and cylinder.status <> 'deactivated';

  if cylinder_owner is null then
    raise exception 'cylinder was not found';
  end if;

  if cylinder_owner <> auth.uid()
    and not public.has_permission('lpg.cylinders.manage', null)
    and not public.has_permission('platform.assets.manage', null)
  then
    raise exception 'cylinder name access denied';
  end if;

  update public.lpg_cylinders
  set display_name = normalized_name,
      updated_at = timezone('utc', now())
  where id = target_cylinder_id;

  return target_cylinder_id;
end;
$$;

create or replace function public.set_profile_avatar_media(
  target_media_asset_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication is required';
  end if;

  if target_media_asset_id is null then
    raise exception 'target_media_asset_id is required';
  end if;

  if not exists (
    select 1
    from public.media_assets media
    where media.id = target_media_asset_id
      and media.owner_user_id = auth.uid()
      and media.status = 'active'
      and media.storage_bucket = 'skima-platform-media'
      and coalesce(media.content_type, '') like 'image/%'
  ) then
    raise exception 'active owned profile image was not found';
  end if;

  update public.profiles
  set avatar_url = target_media_asset_id::text,
      updated_at = timezone('utc', now())
  where id = auth.uid();

  if not found then
    raise exception 'profile was not found';
  end if;

  return target_media_asset_id;
end;
$$;

create or replace function public.clear_profile_avatar_media()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  previous_avatar text;
begin
  if auth.uid() is null then
    raise exception 'authentication is required';
  end if;

  select profile.avatar_url
  into previous_avatar
  from public.profiles profile
  where profile.id = auth.uid();

  if not found then
    raise exception 'profile was not found';
  end if;

  update public.profiles
  set avatar_url = null,
      updated_at = timezone('utc', now())
  where id = auth.uid();

  return previous_avatar;
end;
$$;

drop policy if exists storage_objects_skima_documents_delete on storage.objects;
create policy storage_objects_skima_documents_delete
on storage.objects
for delete to authenticated
using (
  bucket_id in ('skima-platform-documents', 'skima-platform-media')
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.has_permission('platform.documents.manage', null)
  )
);

revoke all on function public.set_lpg_cylinder_display_name(uuid, text) from public, anon;
revoke all on function public.set_profile_avatar_media(uuid) from public, anon;
revoke all on function public.clear_profile_avatar_media() from public, anon;
revoke all on function public.queue_owned_presentation_ai_task(text, text, text, uuid, jsonb, text) from public, anon;
revoke all on function public.register_entity_presentation_media(text, uuid, uuid, text, jsonb) from public, anon, authenticated;

grant execute on function public.set_lpg_cylinder_display_name(uuid, text) to authenticated, service_role;
grant execute on function public.set_profile_avatar_media(uuid) to authenticated, service_role;
grant execute on function public.clear_profile_avatar_media() to authenticated, service_role;
grant execute on function public.queue_owned_presentation_ai_task(text, text, text, uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.register_entity_presentation_media(text, uuid, uuid, text, jsonb) to service_role;

commit;
