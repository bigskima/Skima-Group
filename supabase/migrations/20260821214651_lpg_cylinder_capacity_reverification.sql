do $$
begin
  if not exists (
    select 1 from public.business_modules where key = 'lpg' and status = 'active'
  ) then
    raise exception 'active LPG business module is required';
  end if;
end
$$;

insert into public.document_requirement_sets (
  key,
  display_name,
  subject_category,
  module_id,
  status,
  metadata
)
select
  'documents.lpg.cylinder.capacity-reverification',
  'LPG Cylinder Capacity Re-verification',
  'asset',
  module.id,
  'active',
  jsonb_build_object(
    'bounded_context', 'lpg',
    'configurable', true,
    'purpose', 'cylinder_capacity_reverification'
  )
from public.business_modules module
where module.key = 'lpg'
on conflict (key) do update
set display_name = excluded.display_name,
    subject_category = excluded.subject_category,
    module_id = excluded.module_id,
    status = 'active',
    metadata = public.document_requirement_sets.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

insert into public.document_requirements (
  requirement_set_id,
  key,
  display_name,
  description,
  is_required,
  review_required,
  min_count,
  max_count,
  allowed_content_types,
  max_byte_size,
  status,
  metadata
)
select
  requirement_set.id,
  requirement.key,
  requirement.display_name,
  requirement.description,
  true,
  true,
  1,
  requirement.max_count,
  array['image/jpeg','image/png','image/webp']::text[],
  20971520,
  'active',
  requirement.metadata
from public.document_requirement_sets requirement_set
cross join (
  values
    (
      'cylinder.capacity-marking'::text,
      'Cylinder Capacity Marking'::text,
      'Upload a clear photo of the permanent kilogram or capacity marking on the physical cylinder.'::text,
      2::integer,
      jsonb_build_object(
        'bounded_context','lpg',
        'media_purpose','cylinder_capacity_marking',
        'privacy_classification','PRIVATE_VERIFICATION'
      )
    ),
    (
      'cylinder.full-view'::text,
      'Full Cylinder Photo'::text,
      'Upload a clear full view so SKIMA can match the capacity marking to the registered physical cylinder.'::text,
      2::integer,
      jsonb_build_object(
        'bounded_context','lpg',
        'media_purpose','cylinder_full_view_reverification',
        'privacy_classification','PRIVATE_VERIFICATION'
      )
    )
) as requirement(key, display_name, description, max_count, metadata)
where requirement_set.key = 'documents.lpg.cylinder.capacity-reverification'
on conflict (requirement_set_id, key) do update
set display_name = excluded.display_name,
    description = excluded.description,
    is_required = excluded.is_required,
    review_required = excluded.review_required,
    min_count = excluded.min_count,
    max_count = excluded.max_count,
    allowed_content_types = excluded.allowed_content_types,
    max_byte_size = excluded.max_byte_size,
    status = 'active',
    metadata = public.document_requirements.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

insert into public.application_type_definitions (
  key,
  display_name,
  application_category,
  module_id,
  workflow_key,
  document_requirement_set_id,
  review_policy,
  activation_policy,
  status,
  metadata
)
select
  'application.lpg.cylinder.capacity-reverification',
  'Cylinder Capacity Re-verification',
  'asset',
  module.id,
  'workflow.application.review.default',
  requirement_set.id,
  jsonb_build_object('requires_admin_review', true),
  jsonb_build_object(
    'activate_on_approval', true,
    'activation_handler_key', 'lpg.cylinder.capacity_reverification'
  ),
  'active',
  jsonb_build_object(
    'workspace', 'customer',
    'bounded_context', 'lpg',
    'subject_type', 'lpg_cylinder',
    'submission_required_fields', jsonb_build_array(
      jsonb_build_object('path','cylinder.id','step',1,'label','Cylinder'),
      jsonb_build_object('path','requested.cylinderTypeProfileKey','step',1,'label','Requested cylinder size')
    )
  )
from public.business_modules module
join public.document_requirement_sets requirement_set
  on requirement_set.key = 'documents.lpg.cylinder.capacity-reverification'
where module.key = 'lpg'
on conflict (key) do update
set display_name = excluded.display_name,
    application_category = excluded.application_category,
    module_id = excluded.module_id,
    workflow_key = excluded.workflow_key,
    document_requirement_set_id = excluded.document_requirement_set_id,
    review_policy = excluded.review_policy,
    activation_policy = excluded.activation_policy,
    status = 'active',
    metadata = public.application_type_definitions.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

create or replace function public.validate_lpg_cylinder_capacity_reverification_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  application_record record;
  cylinder_record record;
  requested_profile record;
  target_cylinder_id uuid;
  requested_profile_key text;
  active_request_count integer;
begin
  select app.applicant_user_id, app.status, app_type.key as application_type_key
  into application_record
  from public.application_records app
  join public.application_type_definitions app_type on app_type.id = app.application_type_id
  where app.id = new.application_id;

  if not found
     or application_record.application_type_key <> 'application.lpg.cylinder.capacity-reverification' then
    return new;
  end if;

  if new.payload is null or jsonb_typeof(new.payload) <> 'object' then
    raise exception 'capacity re-verification payload must be a JSON object';
  end if;

  begin
    target_cylinder_id := nullif(new.payload #>> '{cylinder,id}', '')::uuid;
  exception
    when invalid_text_representation then
      raise exception 'capacity re-verification requires a valid cylinder id';
  end;

  if target_cylinder_id is null then
    raise exception 'capacity re-verification requires a cylinder id';
  end if;

  requested_profile_key := nullif(btrim(new.payload #>> '{requested,cylinderTypeProfileKey}'), '');
  if requested_profile_key is null then
    raise exception 'capacity re-verification requires a configured cylinder type';
  end if;

  select cylinder.*
  into cylinder_record
  from public.lpg_cylinders cylinder
  where cylinder.id = target_cylinder_id
    and cylinder.owner_user_id = application_record.applicant_user_id
  for share;

  if not found then
    raise exception 'the selected cylinder must belong to the application owner';
  end if;

  if cylinder_record.status not in ('active','pending_verification','verified')
     or cylinder_record.condition_status in ('unsafe','expired') then
    raise exception 'this cylinder is not eligible for capacity re-verification in its current state';
  end if;

  select profile.*
  into requested_profile
  from public.lpg_cylinder_type_profiles profile
  where profile.key = requested_profile_key
    and profile.status = 'active';

  if not found then
    raise exception 'requested cylinder size is not configured for LPG service';
  end if;

  if requested_profile.size_kg = cylinder_record.size_kg
     and requested_profile.max_capacity_kg = cylinder_record.max_capacity_kg then
    raise exception 'requested cylinder size already matches the verified cylinder capacity';
  end if;

  select count(*)
  into active_request_count
  from public.application_records existing_application
  join public.application_type_definitions existing_type
    on existing_type.id = existing_application.application_type_id
  join public.application_versions existing_version
    on existing_version.application_id = existing_application.id
   and existing_version.version = existing_application.active_version
  where existing_application.id <> new.application_id
    and existing_type.key = 'application.lpg.cylinder.capacity-reverification'
    and existing_application.applicant_user_id = application_record.applicant_user_id
    and existing_application.status in (
      'draft','incomplete','submitted','resubmitted','under_review','additional_info_required'
    )
    and existing_version.payload #>> '{cylinder,id}' = target_cylinder_id::text;

  if active_request_count > 0 then
    raise exception 'an active capacity re-verification request already exists for this cylinder';
  end if;

  new.payload := new.payload
    || jsonb_build_object(
      'requestVersion', 1,
      'cylinder', jsonb_build_object(
        'id', cylinder_record.id,
        'publicReference', cylinder_record.public_reference,
        'sizeKg', cylinder_record.size_kg,
        'maxCapacityKg', cylinder_record.max_capacity_kg,
        'cylinderTypeProfileId', cylinder_record.cylinder_type_profile_id,
        'snapshotAt', timezone('utc', now())
      ),
      'requested', jsonb_build_object(
        'cylinderTypeProfileId', requested_profile.id,
        'cylinderTypeProfileKey', requested_profile.key,
        'displayName', requested_profile.display_name,
        'sizeKg', requested_profile.size_kg,
        'maxCapacityKg', requested_profile.max_capacity_kg,
        'snapshotAt', timezone('utc', now())
      )
    );

  return new;
end;
$$;

revoke all on function public.validate_lpg_cylinder_capacity_reverification_version() from public;
revoke all on function public.validate_lpg_cylinder_capacity_reverification_version() from anon;
revoke all on function public.validate_lpg_cylinder_capacity_reverification_version() from authenticated;

drop trigger if exists trg_validate_lpg_cylinder_capacity_reverification_version
  on public.application_versions;

create trigger trg_validate_lpg_cylinder_capacity_reverification_version
before insert or update of payload
on public.application_versions
for each row
execute function public.validate_lpg_cylinder_capacity_reverification_version();

create or replace function public.activate_lpg_cylinder_capacity_reverification(target_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  application_record record;
  application_type_record record;
  application_payload jsonb;
  cylinder_record record;
  requested_profile record;
  target_cylinder_id uuid;
  requested_profile_key text;
  snapshot_size_kg numeric;
  snapshot_max_capacity_kg numeric;
  snapshot_profile_id text;
  requested_snapshot_size_kg numeric;
  requested_snapshot_max_capacity_kg numeric;
  missing_review_count integer;
  history_id uuid;
  activation_actor uuid;
begin
  select app.*
  into application_record
  from public.application_records app
  where app.id = target_application_id
  for update;

  if not found then
    raise exception 'capacity re-verification application does not exist';
  end if;

  select app_type.*
  into application_type_record
  from public.application_type_definitions app_type
  where app_type.id = application_record.application_type_id;

  if application_type_record.key <> 'application.lpg.cylinder.capacity-reverification' then
    raise exception 'application is not a cylinder capacity re-verification request';
  end if;

  if application_record.status <> 'approved' then
    raise exception 'only approved capacity re-verification applications can be activated';
  end if;

  select version.payload
  into application_payload
  from public.application_versions version
  where version.application_id = target_application_id
    and version.version = application_record.active_version;

  if application_payload is null then
    raise exception 'capacity re-verification application payload is missing';
  end if;

  target_cylinder_id := (application_payload #>> '{cylinder,id}')::uuid;
  requested_profile_key := application_payload #>> '{requested,cylinderTypeProfileKey}';
  snapshot_size_kg := (application_payload #>> '{cylinder,sizeKg}')::numeric;
  snapshot_max_capacity_kg := (application_payload #>> '{cylinder,maxCapacityKg}')::numeric;
  snapshot_profile_id := nullif(application_payload #>> '{cylinder,cylinderTypeProfileId}', '');
  requested_snapshot_size_kg := (application_payload #>> '{requested,sizeKg}')::numeric;
  requested_snapshot_max_capacity_kg := (application_payload #>> '{requested,maxCapacityKg}')::numeric;

  select count(*)
  into missing_review_count
  from public.document_requirements requirement
  where requirement.requirement_set_id = application_type_record.document_requirement_set_id
    and requirement.status = 'active'
    and requirement.review_required
    and public.application_requirement_applies(requirement.metadata, application_payload)
    and (
      select count(*)
      from public.document_submissions submission
      where submission.application_id = target_application_id
        and submission.requirement_id = requirement.id
        and submission.status = 'approved'
    ) < requirement.min_count;

  if missing_review_count > 0 then
    raise exception 'all required cylinder evidence must be approved before capacity activation';
  end if;

  select cylinder.*
  into cylinder_record
  from public.lpg_cylinders cylinder
  where cylinder.id = target_cylinder_id
  for update;

  if not found or cylinder_record.owner_user_id <> application_record.applicant_user_id then
    raise exception 'capacity re-verification cylinder ownership no longer matches the application';
  end if;

  if cylinder_record.size_kg <> snapshot_size_kg
     or cylinder_record.max_capacity_kg <> snapshot_max_capacity_kg
     or coalesce(cylinder_record.cylinder_type_profile_id::text, '') <> coalesce(snapshot_profile_id, '') then
    raise exception 'cylinder capacity details changed after this request was submitted; a fresh review is required';
  end if;

  select profile.*
  into requested_profile
  from public.lpg_cylinder_type_profiles profile
  where profile.key = requested_profile_key
    and profile.status = 'active';

  if not found then
    raise exception 'requested cylinder type is no longer active';
  end if;

  if requested_profile.size_kg <> requested_snapshot_size_kg
     or requested_profile.max_capacity_kg <> requested_snapshot_max_capacity_kg then
    raise exception 'requested cylinder type changed after submission; a fresh review is required';
  end if;

  activation_actor := coalesce(auth.uid(), application_record.assigned_reviewer_user_id);

  update public.lpg_cylinders
  set size_kg = requested_profile.size_kg,
      max_capacity_kg = requested_profile.max_capacity_kg,
      cylinder_type_profile_id = requested_profile.id,
      metadata = metadata || jsonb_build_object(
        'capacityVerification', jsonb_build_object(
          'applicationId', target_application_id,
          'verifiedAt', timezone('utc', now()),
          'verifiedBy', activation_actor,
          'previousSizeKg', cylinder_record.size_kg,
          'previousMaxCapacityKg', cylinder_record.max_capacity_kg,
          'cylinderTypeProfileKey', requested_profile.key,
          'sizeKg', requested_profile.size_kg,
          'maxCapacityKg', requested_profile.max_capacity_kg
        )
      ),
      updated_at = timezone('utc', now())
  where id = target_cylinder_id;

  history_id := public.record_lpg_cylinder_history(
    target_cylinder_id,
    'verified',
    'capacity-reverification:' || target_application_id::text,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'verificationType', 'capacity_reverification',
      'applicationId', target_application_id,
      'previousSizeKg', cylinder_record.size_kg,
      'previousMaxCapacityKg', cylinder_record.max_capacity_kg,
      'newSizeKg', requested_profile.size_kg,
      'newMaxCapacityKg', requested_profile.max_capacity_kg,
      'cylinderTypeProfileKey', requested_profile.key
    ),
    '{}'::jsonb
  );

  update public.application_records
  set activated_subject_type = 'lpg_cylinder',
      activated_subject_id = target_cylinder_id,
      operational_status = 'active',
      activated_at = coalesce(activated_at, timezone('utc', now())),
      activated_by = coalesce(activated_by, activation_actor),
      metadata = metadata || jsonb_build_object(
        'capacity_reverification_history_id', history_id,
        'capacity_reverification_applied_at', timezone('utc', now())
      ),
      updated_at = timezone('utc', now())
  where id = target_application_id;

  return jsonb_build_object(
    'applicationId', target_application_id,
    'cylinderId', target_cylinder_id,
    'cylinderTypeProfileKey', requested_profile.key,
    'sizeKg', requested_profile.size_kg,
    'maxCapacityKg', requested_profile.max_capacity_kg,
    'historyId', history_id
  );
end;
$$;

revoke all on function public.activate_lpg_cylinder_capacity_reverification(uuid) from public;
revoke all on function public.activate_lpg_cylinder_capacity_reverification(uuid) from anon;
revoke all on function public.activate_lpg_cylinder_capacity_reverification(uuid) from authenticated;

create or replace function public.apply_configured_application_post_approval_activation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  handler_key text;
begin
  if new.status <> 'approved'
     or new.operational_status <> 'pending'
     or new.activated_subject_id is not null then
    return new;
  end if;

  select nullif(app_type.activation_policy ->> 'activation_handler_key', '')
  into handler_key
  from public.application_type_definitions app_type
  where app_type.id = new.application_type_id;

  if handler_key = 'lpg.cylinder.capacity_reverification' then
    perform public.activate_lpg_cylinder_capacity_reverification(new.id);
  end if;

  return new;
end;
$$;

revoke all on function public.apply_configured_application_post_approval_activation() from public;
revoke all on function public.apply_configured_application_post_approval_activation() from anon;
revoke all on function public.apply_configured_application_post_approval_activation() from authenticated;

drop trigger if exists application_records_apply_post_approval_activation
  on public.application_records;

create trigger application_records_apply_post_approval_activation
after update of operational_status
on public.application_records
for each row
execute function public.apply_configured_application_post_approval_activation();

comment on function public.validate_lpg_cylinder_capacity_reverification_version() is
  'Normalizes and validates cylinder-capacity re-verification application versions against the owned cylinder and active configured cylinder profiles.';

comment on function public.activate_lpg_cylinder_capacity_reverification(uuid) is
  'Applies an approved cylinder capacity re-verification atomically while preserving stale-snapshot, evidence-review, history, and ownership safeguards.';

comment on function public.apply_configured_application_post_approval_activation() is
  'Runs configured automatic post-approval activation handlers after the generic application review engine completes its approval bookkeeping.';
