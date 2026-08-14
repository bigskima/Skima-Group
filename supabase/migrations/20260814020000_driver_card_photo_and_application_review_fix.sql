begin;

create or replace function public.ensure_driver_card_identity(
  target_driver_profile_id uuid,
  target_application_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  driver_record public.driver_profiles%rowtype;
  resolved_application_id uuid;
  application_payload jsonb := '{}'::jsonb;
  applicant_profile record;
  display_name_value text;
  profile_photo_id uuid;
  issued_driver_id text;
begin
  select *
  into driver_record
  from public.driver_profiles
  where id = target_driver_profile_id
  for update;

  if not found then
    raise exception 'target_driver_profile_id must reference a driver profile';
  end if;

  resolved_application_id := coalesce(
    target_application_id,
    case
      when driver_record.metadata ? 'source_application_id'
        and (driver_record.metadata ->> 'source_application_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (driver_record.metadata ->> 'source_application_id')::uuid
      else null
    end
  );

  if resolved_application_id is not null then
    select app_version.payload
    into application_payload
    from public.application_records app_record
    join public.application_type_definitions app_type
      on app_type.id = app_record.application_type_id
    join public.application_versions app_version
      on app_version.application_id = app_record.id
      and app_version.version = app_record.active_version
    where app_record.id = resolved_application_id
      and app_type.application_category = 'driver';
  end if;

  select profile.id, profile.display_name
  into applicant_profile
  from public.profiles profile
  where profile.id = driver_record.user_id;

  display_name_value := coalesce(
    nullif(application_payload #>> '{identity,driverDisplayName}', ''),
    nullif(application_payload #>> '{identity,driver_display_name}', ''),
    nullif(application_payload #>> '{driver,displayName}', ''),
    nullif(application_payload #>> '{driver,display_name}', ''),
    nullif(driver_record.driver_display_name, ''),
    nullif(application_payload #>> '{identity,fullName}', ''),
    nullif(application_payload #>> '{identity,full_name}', ''),
    nullif(applicant_profile.display_name, ''),
    'SKIMA Driver'
  );

  if resolved_application_id is not null then
    select submission.media_asset_id
    into profile_photo_id
    from public.document_submissions submission
    join public.document_requirements requirement
      on requirement.id = submission.requirement_id
    where submission.application_id = resolved_application_id
      and requirement.key = 'driver.profile-photo'
      and submission.status = 'approved'
      and submission.media_asset_id is not null
    order by submission.reviewed_at desc nulls last, submission.created_at desc
    limit 1;
  end if;

  issued_driver_id := coalesce(
    nullif(driver_record.public_driver_id, ''),
    public.skima_driver_public_id(driver_record.id)
  );

  update public.driver_profiles
  set public_driver_id = issued_driver_id,
      driver_display_name = display_name_value,
      profile_photo_asset_id = coalesce(profile_photo_id, profile_photo_asset_id),
      driver_card_issued_at = case
        when driver_card_issued_at is null and verification_status = 'approved'
          then timezone('utc', now())
        else driver_card_issued_at
      end,
      driver_card_status = case verification_status
        when 'approved' then 'active'
        when 'suspended' then 'suspended'
        when 'rejected' then 'revoked'
        else driver_card_status
      end,
      metadata = metadata || jsonb_build_object(
        'driver_card',
        coalesce(metadata -> 'driver_card', '{}'::jsonb) || jsonb_build_object(
          'source_application_id', resolved_application_id,
          'safe_public_identity', true,
          'updated_at', timezone('utc', now())
        )
      ),
      updated_at = timezone('utc', now())
  where id = target_driver_profile_id;

  return issued_driver_id;
end;
$$;

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
  'ai.driver.card_photo.enhance',
  'Driver Card Photo Enhancement',
  'custom',
  provider.id,
  '{"control":"public_driver_card_photo_derivative","preserve_original":true,"no_identity_fabrication":true,"requires_owned_subject":true}'::jsonb,
  '{"type":"object","required":["mediaAssetId","mediaRole"],"properties":{"mediaAssetId":{"type":"string","format":"uuid"},"mediaRole":{"const":"driver-card-photo.ai"}}}'::jsonb,
  'active'
from public.provider_adapters provider
where provider.provider_kind = 'ai'
  and provider.key in ('provider.ai.cloudflare-workers-ai', 'provider.ai.google-gemini')
  and provider.status = 'active'
order by case provider.key
  when 'provider.ai.cloudflare-workers-ai' then 0
  when 'provider.ai.google-gemini' then 1
  else 2
end
limit 1
on conflict (key) do update
set display_name = excluded.display_name,
    task_type = excluded.task_type,
    provider_adapter_id = excluded.provider_adapter_id,
    prompt_config = excluded.prompt_config,
    output_schema = excluded.output_schema,
    status = excluded.status,
    updated_at = timezone('utc', now());

create or replace function public.queue_owned_driver_card_photo_ai_task(
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
  source_asset_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication is required';
  end if;

  if target_task_key <> 'ai.driver.card_photo.enhance'
    or target_subject_type <> 'driver_profile'
    or target_subject_id is null then
    raise exception 'driver card photo enhancement scope is not supported';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$'
    or target_idempotency_key is null or btrim(target_idempotency_key) = ''
    or target_input is null or jsonb_typeof(target_input) <> 'object' then
    raise exception 'driver card photo enhancement request is invalid';
  end if;

  if not exists (
    select 1
    from public.driver_profiles driver
    where driver.id = target_subject_id
      and driver.user_id = auth.uid()
      and driver.verification_status <> 'rejected'
  ) then
    raise exception 'owned driver profile was not found';
  end if;

  source_asset_id := case
    when target_input ? 'sourceMediaAssetId'
      and (target_input ->> 'sourceMediaAssetId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (target_input ->> 'sourceMediaAssetId')::uuid
    when target_input ? 'source_media_asset_id'
      and (target_input ->> 'source_media_asset_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (target_input ->> 'source_media_asset_id')::uuid
    else null
  end;

  if source_asset_id is null then
    raise exception 'sourceMediaAssetId is required';
  end if;

  if not exists (
    select 1
    from public.media_assets asset
    where asset.id = source_asset_id
      and asset.owner_user_id = auth.uid()
      and asset.status = 'active'
      and coalesce(asset.content_type, '') like 'image/%'
  ) then
    raise exception 'owned active source image was not found';
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
    raise exception 'driver card photo enhancement is not configured';
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
      raise exception 'driver card photo idempotency key conflicts with another request';
    end if;
    return existing_run.id;
  end if;

  insert into public.ai_task_run_events (ai_task_run_id, status, idempotency_key, metadata)
  values (task_run_id, 'queued', target_idempotency_key || ':queued', jsonb_build_object('source', target_source))
  on conflict do nothing;

  return task_run_id;
end;
$$;

revoke all on function public.queue_owned_driver_card_photo_ai_task(text, text, text, uuid, jsonb, text) from public, anon;
grant execute on function public.queue_owned_driver_card_photo_ai_task(text, text, text, uuid, jsonb, text) to authenticated, service_role;

create or replace function public.decide_application_review(
  target_application_id uuid,
  target_decision text,
  target_reason text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  application_record record;
  application_type_record record;
  missing_review_count integer;
  event_type_key text;
  review_task_id uuid;
begin
  if auth.role() <> 'service_role' and not public.can_review_applications() then
    raise exception 'application review permission is required';
  end if;

  if target_application_id is null then
    raise exception 'target_application_id is required';
  end if;

  if target_decision not in ('approved', 'rejected', 'suspended', 'reactivated') then
    raise exception 'target_decision is not supported';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select app_rec.*
  into application_record
  from public.application_records app_rec
  where app_rec.id = target_application_id
  for update;

  if not found then
    raise exception 'target_application_id must reference an existing application';
  end if;

  if target_decision in ('approved', 'rejected') and application_record.status <> 'under_review' then
    raise exception 'application approval decisions require under_review state';
  end if;

  if target_decision = 'suspended' and application_record.status <> 'approved' then
    raise exception 'only approved applications can be suspended';
  end if;

  if target_decision = 'reactivated' and application_record.status <> 'suspended' then
    raise exception 'only suspended applications can be reactivated';
  end if;

  if target_decision = 'approved' then
    select app_type.*
    into application_type_record
    from public.application_type_definitions app_type
    where app_type.id = application_record.application_type_id;

    select count(*)
    into missing_review_count
    from public.document_requirements req
    where req.requirement_set_id = application_type_record.document_requirement_set_id
      and req.status = 'active'
      and req.review_required
      and (
        select count(*)
        from public.document_submissions doc_sub
        where doc_sub.application_id = target_application_id
          and doc_sub.requirement_id = req.id
          and doc_sub.status = 'approved'
      ) < req.min_count;

    if missing_review_count > 0 then
      raise exception 'required documents must be approved before application approval';
    end if;
  end if;

  event_type_key := case target_decision
    when 'approved' then 'event.application.approved'
    when 'rejected' then 'event.application.rejected'
    when 'suspended' then 'event.application.suspended'
    when 'reactivated' then 'event.application.reactivated'
  end;

  perform public.advance_application_record_state(
    target_application_id,
    event_type_key,
    target_metadata || jsonb_build_object('reason', target_reason),
    target_idempotency_key || ':workflow'
  );

  select task.id
  into review_task_id
  from public.application_review_tasks task
  where task.application_id = target_application_id
    and task.status in ('open', 'assigned', 'correction_requested')
  order by task.created_at desc
  limit 1;

  if review_task_id is not null then
    update public.application_review_tasks
    set status = case
          when target_decision = 'approved' then 'approved'
          when target_decision = 'rejected' then 'rejected'
          else status
        end,
        metadata = metadata || target_metadata,
        updated_at = timezone('utc', now())
    where id = review_task_id;
  end if;

  insert into public.application_review_events (
    application_id,
    review_task_id,
    reviewer_user_id,
    decision,
    internal_notes,
    applicant_message,
    idempotency_key,
    metadata
  )
  values (
    target_application_id,
    review_task_id,
    auth.uid(),
    target_decision,
    target_reason,
    case when target_decision in ('approved', 'rejected') then target_reason else null end,
    target_idempotency_key,
    target_metadata
  )
  on conflict do nothing;

  if target_decision in ('approved', 'reactivated') then
    perform public.activate_approved_application(target_application_id);
  end if;

  return target_application_id;
end;
$$;

commit;
