do $$
declare v_requirement_set_id uuid;
begin
  select sets.id into v_requirement_set_id
  from public.document_requirement_sets sets
  where sets.key='documents.lpg.vehicle.phase-one' and sets.status='active'
  limit 1;

  if v_requirement_set_id is null then
    raise exception 'active LPG vehicle document requirement set is required';
  end if;

  insert into public.document_requirements(
    requirement_set_id,key,display_name,description,is_required,review_required,
    min_count,max_count,allowed_content_types,max_byte_size,status,metadata
  ) values
    (v_requirement_set_id,'vehicle.inspection','Vehicle Inspection Evidence','Upload the current inspection evidence for this SKIMA-owned vehicle.',true,true,1,1,array['application/pdf','image/jpeg','image/png','image/webp']::text[],20971520,'active',jsonb_build_object('platformFleet',true,'privacy_classification','INTERNAL_ONLY')),
    (v_requirement_set_id,'vehicle.lpg-transport','LPG Transport Approval','Upload evidence that this SKIMA-owned vehicle is approved for LPG cylinder transport.',true,true,1,1,array['application/pdf','image/jpeg','image/png','image/webp']::text[],20971520,'active',jsonb_build_object('platformFleet',true,'privacy_classification','INTERNAL_ONLY'))
  on conflict(requirement_set_id,key) do update
  set display_name=excluded.display_name,
      description=excluded.description,
      is_required=true,
      review_required=true,
      allowed_content_types=excluded.allowed_content_types,
      max_byte_size=excluded.max_byte_size,
      status='active',
      metadata=public.document_requirements.metadata||excluded.metadata,
      updated_at=timezone('utc',now());
end $$;

create or replace function public.read_platform_fleet_vehicle_compliance(target_vehicle_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role'
    and not public.has_permission('platform.fleets.read',null)
    and not public.has_permission('platform.fleets.manage',null)
    and not public.has_permission('platform.fleets.review',null)
    and not public.has_permission('platform.vehicles.manage',null)
    and not public.is_platform_super_admin() then
    raise exception using errcode='42501',message='SKIMA fleet read permission is required';
  end if;
  if target_vehicle_id is null or not exists(select 1 from public.vehicles where id=target_vehicle_id and platform_owned) then
    raise exception using errcode='22023',message='choose a SKIMA-owned vehicle';
  end if;

  select coalesce(jsonb_agg(item order by sort_order,label),'[]'::jsonb)
  into result
  from (
    select
      case requirement.key
        when 'vehicle.ownership_proof' then 1
        when 'vehicle.insurance' then 2
        when 'vehicle.inspection' then 3
        when 'vehicle.roadworthiness' then 4
        when 'vehicle.lpg_transport' then 5
        else 99
      end sort_order,
      requirement.display_name label,
      jsonb_build_object(
        'requirementKey',requirement.key,
        'label',requirement.display_name,
        'documentPurposeKey',requirement.document_purpose_key,
        'moduleKey',requirement.module_key,
        'required',requirement.required,
        'enforcement',requirement.enforcement,
        'status',coalesce(evidence.status,'missing'),
        'evidenceId',evidence.id,
        'documentSubmissionId',evidence.document_submission_id,
        'validFrom',evidence.valid_from,
        'validUntil',evidence.valid_until,
        'reviewedAt',evidence.reviewed_at,
        'current',coalesce(evidence.status='valid' and (evidence.valid_from is null or evidence.valid_from<=current_date) and (evidence.valid_until is null or evidence.valid_until>=current_date),false)
      ) item
    from public.compliance_requirement_definitions requirement
    left join lateral (
      select compliance.*
      from public.compliance_evidence compliance
      where compliance.requirement_key=requirement.key
        and compliance.subject_type='vehicle'
        and compliance.subject_id=target_vehicle_id
      order by compliance.reviewed_at desc nulls last, compliance.created_at desc
      limit 1
    ) evidence on true
    where requirement.subject_type='vehicle'
      and requirement.status='active'
      and requirement.required
      and (requirement.module_key is null or requirement.module_key='lpg')
  ) rows;
  return result;
end;
$$;

create or replace function public.record_platform_fleet_compliance_document(
  target_vehicle_id uuid,
  target_requirement_key text,
  target_storage_path text,
  target_content_type text,
  target_byte_size bigint,
  target_valid_from date default null,
  target_valid_until date default null,
  target_reason text default null,
  target_idempotency_key text default null,
  target_checksum text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  requirement_record public.compliance_requirement_definitions%rowtype;
  document_requirement public.document_requirements%rowtype;
  media_asset_id uuid;
  document_submission_id uuid;
  existing_id uuid;
  source_key text:='skima.platform_fleet.compliance';
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role'
    and not public.has_permission('platform.fleets.manage',null)
    and not public.has_permission('platform.fleets.review',null)
    and not public.has_permission('platform.vehicles.manage',null)
    and not public.is_platform_super_admin() then
    raise exception using errcode='42501',message='SKIMA fleet compliance management permission is required';
  end if;
  if target_vehicle_id is null
    or coalesce(btrim(target_requirement_key),'')=''
    or coalesce(btrim(target_storage_path),'')=''
    or coalesce(btrim(target_content_type),'')=''
    or target_byte_size is null or target_byte_size<=0
    or char_length(btrim(coalesce(target_reason,'')))<3
    or coalesce(btrim(target_idempotency_key),'')=''
    or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='vehicle, compliance requirement, uploaded file, reason, and idempotency key are required';
  end if;
  if target_valid_from is not null and target_valid_until is not null and target_valid_until<target_valid_from then
    raise exception using errcode='22023',message='document expiry cannot be before its valid-from date';
  end if;
  if not exists(select 1 from public.vehicles where id=target_vehicle_id and platform_owned) then
    raise exception using errcode='22023',message='compliance can only be recorded here for a SKIMA-owned vehicle';
  end if;

  select * into requirement_record
  from public.compliance_requirement_definitions
  where key=target_requirement_key and subject_type='vehicle' and status='active'
    and required and (module_key is null or module_key='lpg');
  if not found then raise exception using errcode='22023',message='active vehicle compliance requirement was not found'; end if;

  select document.* into document_requirement
  from public.document_requirements document
  join public.document_requirement_sets set_record on set_record.id=document.requirement_set_id
  where set_record.key='documents.lpg.vehicle.phase-one'
    and set_record.status='active'
    and document.key=requirement_record.document_purpose_key
    and document.status='active'
  limit 1;
  if not found then raise exception using errcode='55000',message='configured fleet document requirement is missing'; end if;

  if cardinality(document_requirement.allowed_content_types)>0 and target_content_type<>all(document_requirement.allowed_content_types) then
    raise exception using errcode='22023',message='file type is not allowed for this vehicle document';
  end if;
  if document_requirement.max_byte_size is not null and target_byte_size>document_requirement.max_byte_size then
    raise exception using errcode='22023',message='vehicle document exceeds the configured file-size limit';
  end if;
  if coalesce(auth.jwt()->>'role','')<>'service_role' and split_part(target_storage_path,'/',1)<>auth.uid()::text then
    raise exception using errcode='42501',message='vehicle document storage path must belong to the signed-in administrator';
  end if;
  if not exists(select 1 from storage.objects object where object.bucket_id='skima-platform-documents' and object.name=target_storage_path) then
    raise exception using errcode='22023',message='uploaded vehicle document was not found in protected storage';
  end if;

  select id into existing_id
  from public.document_submissions
  where source=source_key and idempotency_key=target_idempotency_key;
  if existing_id is not null then return existing_id; end if;

  insert into public.media_assets(
    organization_id,owner_user_id,storage_bucket,storage_path,content_type,byte_size,checksum,
    status,privacy_classification,asset_type_key,metadata,source,idempotency_key,created_by
  ) values(
    null,auth.uid(),'skima-platform-documents',target_storage_path,target_content_type,target_byte_size,target_checksum,
    'active','INTERNAL_ONLY','media.fleet-compliance',
    target_metadata||jsonb_build_object('vehicleId',target_vehicle_id,'requirementKey',target_requirement_key,'assetOwner','SKIMA'),
    source_key,target_idempotency_key||':asset',auth.uid()
  )
  on conflict(storage_bucket,storage_path) do update
  set content_type=excluded.content_type,
      byte_size=excluded.byte_size,
      checksum=excluded.checksum,
      status='active',
      privacy_classification='INTERNAL_ONLY',
      metadata=public.media_assets.metadata||excluded.metadata,
      updated_at=timezone('utc',now())
  returning id into media_asset_id;

  insert into public.document_submissions(
    requirement_id,application_id,subject_type,subject_id,owner_user_id,organization_id,
    media_asset_id,status,storage_bucket,storage_path,content_type,byte_size,checksum,
    submitted_at,reviewed_at,reviewer_user_id,expires_at,decision_reason,source,idempotency_key,metadata,created_by
  ) values(
    document_requirement.id,null,'vehicle',target_vehicle_id,auth.uid(),null,
    media_asset_id,'approved','skima-platform-documents',target_storage_path,target_content_type,target_byte_size,target_checksum,
    timezone('utc',now()),timezone('utc',now()),auth.uid(),
    case when target_valid_until is null then null else (target_valid_until::timestamp+interval '1 day'-interval '1 second') at time zone 'UTC' end,
    btrim(target_reason),source_key,target_idempotency_key,
    target_metadata||jsonb_build_object('vehicleId',target_vehicle_id,'requirementKey',target_requirement_key,'platformFleet',true),auth.uid()
  ) returning id into document_submission_id;

  insert into public.document_review_events(
    document_submission_id,reviewer_user_id,decision,internal_notes,applicant_message,idempotency_key,metadata
  ) values(
    document_submission_id,auth.uid(),'approved',btrim(target_reason),null,target_idempotency_key||':review',
    jsonb_build_object('platformFleet',true,'vehicleId',target_vehicle_id,'requirementKey',target_requirement_key)
  );

  update public.compliance_evidence
  set status='revoked',
      metadata=metadata||jsonb_build_object('revocationReason','Replaced by newer SKIMA fleet evidence','revokedAt',timezone('utc',now())),
      updated_at=timezone('utc',now())
  where requirement_key=target_requirement_key
    and subject_type='vehicle'
    and subject_id=target_vehicle_id
    and status in ('pending','valid');

  insert into public.compliance_evidence(
    requirement_key,subject_type,subject_id,document_submission_id,status,
    valid_from,valid_until,reviewed_by,reviewed_at,metadata
  ) values(
    target_requirement_key,'vehicle',target_vehicle_id,document_submission_id,'valid',
    target_valid_from,target_valid_until,auth.uid(),timezone('utc',now()),
    target_metadata||jsonb_build_object('reason',btrim(target_reason),'idempotencyKey',target_idempotency_key,'platformFleet',true)
  );

  update public.vehicles
  set insurance_expires_at=case when target_requirement_key='vehicle.insurance' then target_valid_until else insurance_expires_at end,
      inspection_expires_at=case when target_requirement_key='vehicle.inspection' then target_valid_until else inspection_expires_at end,
      roadworthiness_expires_at=case when target_requirement_key='vehicle.roadworthiness' then target_valid_until else roadworthiness_expires_at end,
      metadata=metadata||jsonb_build_object('lastComplianceUpdateAt',timezone('utc',now())),
      updated_at=timezone('utc',now())
  where id=target_vehicle_id;

  return document_submission_id;
end;
$$;

revoke all on function public.read_platform_fleet_vehicle_compliance(uuid) from public,anon;
grant execute on function public.read_platform_fleet_vehicle_compliance(uuid) to authenticated,service_role;
revoke all on function public.record_platform_fleet_compliance_document(uuid,text,text,text,bigint,date,date,text,text,text,jsonb) from public,anon;
grant execute on function public.record_platform_fleet_compliance_document(uuid,text,text,text,bigint,date,date,text,text,text,jsonb) to authenticated,service_role;
