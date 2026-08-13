begin;

insert into public.provider_adapters (
  provider_kind,
  key,
  display_name,
  status,
  config,
  secret_ref
)
values (
  'ai',
  'provider.ai.cloudflare-workers-ai',
  'Cloudflare Workers AI Adapter',
  'active',
  jsonb_build_object(
    'provider', 'cloudflare',
    'product', 'workers_ai',
    'model', '@cf/black-forest-labs/flux-1-schnell',
    'response_mode', 'image',
    'control', 'presentation_derivative_only',
    'free_allocation_supported', true
  ),
  'SUPABASE_SECRET:CLOUDFLARE_API_TOKEN'
)
on conflict (provider_kind, key) do update
set display_name = excluded.display_name,
    status = 'active',
    config = public.provider_adapters.config || excluded.config,
    secret_ref = excluded.secret_ref,
    updated_at = timezone('utc', now());

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
  and provider.key = 'provider.ai.cloudflare-workers-ai'
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
      'active_provider_key', 'provider.ai.cloudflare-workers-ai',
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
    and provider.key in ('provider.ai.cloudflare-workers-ai', 'provider.ai.google-gemini')
    and provider.status = 'active'
  order by case provider.key
    when 'provider.ai.cloudflare-workers-ai' then 0
    when 'provider.ai.google-gemini' then 1
    else 2
  end
  limit 1;

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

revoke all on function public.queue_owned_presentation_ai_task(text, text, text, uuid, jsonb, text) from public, anon;
grant execute on function public.queue_owned_presentation_ai_task(text, text, text, uuid, jsonb, text) to authenticated, service_role;

commit;
