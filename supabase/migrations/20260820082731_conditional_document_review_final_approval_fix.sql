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
set search_path to 'public'
as $function$
declare
  application_record record;
  application_type_record record;
  application_payload jsonb;
  missing_review_count integer;
  missing_review_labels text;
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

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
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

  select app_type.*
  into application_type_record
  from public.application_type_definitions app_type
  where app_type.id = application_record.application_type_id;

  if not found then
    raise exception 'application type definition was not found';
  end if;

  select coalesce(application_version.payload, '{}'::jsonb)
  into application_payload
  from public.application_versions application_version
  where application_version.application_id = target_application_id
    and application_version.version = application_record.active_version;

  application_payload := coalesce(application_payload, '{}'::jsonb);

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
    select count(*),
           string_agg(req.display_name, ', ' order by req.display_name)
    into missing_review_count, missing_review_labels
    from public.document_requirements req
    where req.requirement_set_id = application_type_record.document_requirement_set_id
      and req.status = 'active'
      and req.review_required
      and public.application_requirement_applies(req.metadata, application_payload)
      and (
        select count(*)
        from public.document_submissions doc_sub
        where doc_sub.application_id = target_application_id
          and doc_sub.requirement_id = req.id
          and doc_sub.status = 'approved'
      ) < req.min_count;

    if missing_review_count > 0 then
      raise exception 'required documents must be approved before application approval: %',
        coalesce(missing_review_labels, 'document review incomplete');
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

  if target_decision in ('approved', 'reactivated')
     and application_type_record.application_category = 'vehicle' then
    perform public.activate_approved_application(target_application_id);

    update public.application_records
    set operational_status = 'active',
        activated_at = coalesce(activated_at, timezone('utc', now())),
        activated_by = coalesce(activated_by, auth.uid()),
        updated_at = timezone('utc', now())
    where id = target_application_id;
  elsif target_decision = 'approved' then
    update public.application_records
    set operational_status = 'pending',
        activated_at = null,
        activated_by = null,
        updated_at = timezone('utc', now())
    where id = target_application_id;
  elsif target_decision = 'suspended' then
    update public.application_records
    set operational_status = 'suspended',
        updated_at = timezone('utc', now())
    where id = target_application_id;
  elsif target_decision = 'reactivated' then
    update public.application_records
    set operational_status = case
          when application_type_record.application_category = 'vehicle' then 'active'
          else 'pending'
        end,
        updated_at = timezone('utc', now())
    where id = target_application_id;
  end if;

  return target_application_id;
end;
$function$;
