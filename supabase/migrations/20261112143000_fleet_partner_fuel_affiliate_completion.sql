begin;

-- Fleet partner operations: staff invitations, partner-owned vehicles, service lines,
-- vehicle documents and an authenticated owner workspace.

create table if not exists public.fleet_partner_service_lines (
  id uuid primary key default gen_random_uuid(),
  fleet_partner_id uuid not null references public.fleet_partners(id) on delete restrict,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  service_key text not null check (service_key in ('lpg','fuel')),
  status text not null default 'pending' check (status in ('pending','active','rejected','suspended')),
  decision_reason text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  requested_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  unique(vehicle_id,service_key)
);
create index if not exists fleet_partner_service_lines_partner_idx
  on public.fleet_partner_service_lines(fleet_partner_id,status,service_key);

create table if not exists public.fleet_staff_invitations (
  id uuid primary key default gen_random_uuid(),
  fleet_partner_id uuid not null references public.fleet_partners(id) on delete restrict,
  invitee_email text not null check (invitee_email=lower(btrim(invitee_email)) and invitee_email like '%@%'),
  access_role text not null check (access_role in ('fleet_manager','vehicle_manager','compliance_viewer')),
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  reason text not null check (length(btrim(reason))>=3),
  invited_by uuid not null references public.profiles(id) on delete restrict,
  accepted_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now())
);
create index if not exists fleet_staff_invitations_partner_idx
  on public.fleet_staff_invitations(fleet_partner_id,status,created_at desc);

alter table public.fleet_partner_service_lines enable row level security;
alter table public.fleet_staff_invitations enable row level security;
revoke all on public.fleet_partner_service_lines,public.fleet_staff_invitations from public,anon,authenticated;
grant select on public.fleet_partner_service_lines,public.fleet_staff_invitations to authenticated;
grant all on public.fleet_partner_service_lines,public.fleet_staff_invitations to service_role;

-- Dedicated document requirement records make fleet application evidence reviewable by
-- the existing protected document-review workflow even though fleet applications have
-- their own lifecycle table (not application_records).
insert into public.document_requirement_sets(key,display_name,subject_category,status,metadata)
values ('documents.fleet.partner','Fleet partner application documents','organization','active',
        '{"module":"fleet","privacy_classification":"PRIVATE_VERIFICATION"}'::jsonb)
on conflict(key) do update set display_name=excluded.display_name,status='active',
  metadata=public.document_requirement_sets.metadata||excluded.metadata,updated_at=timezone('utc',now());

insert into public.document_requirements(requirement_set_id,key,display_name,description,is_required,review_required,
  min_count,max_count,allowed_content_types,max_byte_size,status,metadata)
select s.id,v.key,v.display_name,v.description,true,true,1,1,
  array['application/pdf','image/jpeg','image/png','image/webp']::text[],20971520,'active',
  '{"privacy_classification":"PRIVATE_VERIFICATION","module":"fleet"}'::jsonb
from public.document_requirement_sets s
cross join (values
 ('fleet.partner.identity','Owner or authorised signatory identity','Upload a clear identity document for the applicant.'),
 ('fleet.partner.registration','Business registration evidence','Required for companies and fleet operators.'),
 ('fleet.partner.address','Operating address evidence','Proof of the fleet partner operating address.')
) v(key,display_name,description)
where s.key='documents.fleet.partner'
and not exists(select 1 from public.document_requirements r where r.requirement_set_id=s.id and r.key=v.key);

create or replace function public.register_fleet_application_document(
  target_application_id uuid,
  target_requirement_key text,
  target_media_asset_id uuid,
  target_idempotency_key text
) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  app record;
  requirement record;
  media record;
  saved_id uuid;
  source_key text:='skima.fleet.application-document';
begin
  if auth.uid() is null or target_application_id is null or target_media_asset_id is null
     or nullif(btrim(target_idempotency_key),'') is null then
    raise exception using errcode='22023',message='Application, uploaded media asset and idempotency key are required';
  end if;
  select * into app from public.fleet_partner_applications
  where id=target_application_id and applicant_user_id=auth.uid() for update;
  if not found then raise exception using errcode='42501',message='Fleet application access is required'; end if;
  if app.status not in ('draft','submitted','correction_required','resubmitted') then
    raise exception using errcode='55000',message='Fleet application no longer accepts documents';
  end if;
  select r.* into requirement
  from public.document_requirements r
  join public.document_requirement_sets s on s.id=r.requirement_set_id
  where s.key='documents.fleet.partner' and r.key=target_requirement_key and r.status='active';
  if not found then raise exception using errcode='22023',message='Active fleet document requirement is required'; end if;
  if target_requirement_key='fleet.partner.registration' and app.partner_kind='individual_owner' then
    raise exception using errcode='22023',message='Individual owners do not need company registration evidence';
  end if;
  select * into media from public.media_assets
  where id=target_media_asset_id and owner_user_id=auth.uid() and status='active'
    and storage_bucket in ('skima-platform-documents','skima-platform-media');
  if not found then raise exception using errcode='42501',message='Uploaded media must be active and owned by the applicant'; end if;
  if media.content_type is not null and cardinality(requirement.allowed_content_types)>0
     and media.content_type<>all(requirement.allowed_content_types) then
    raise exception using errcode='22023',message='Uploaded file type is not allowed for this requirement';
  end if;
  if requirement.max_byte_size is not null and media.byte_size>requirement.max_byte_size then
    raise exception using errcode='22023',message='Uploaded file exceeds the document size limit';
  end if;

  select id into saved_id from public.document_submissions
  where source=source_key and idempotency_key=target_idempotency_key;
  if saved_id is not null then return saved_id; end if;

  insert into public.document_submissions(
    requirement_id,application_id,subject_type,subject_id,owner_user_id,organization_id,media_asset_id,
    status,storage_bucket,storage_path,content_type,byte_size,checksum,submitted_at,source,idempotency_key,metadata,created_by
  ) values (
    requirement.id,null,'fleet_application',app.id,auth.uid(),null,media.id,
    'submitted',media.storage_bucket,media.storage_path,media.content_type,media.byte_size,media.checksum,
    timezone('utc',now()),source_key,target_idempotency_key,
    jsonb_build_object('fleet_application_id',app.id,'requirement_key',target_requirement_key,
      'privacy_classification','PRIVATE_VERIFICATION','module','fleet'),auth.uid()
  ) returning id into saved_id;

  update public.fleet_application_documents set status='superseded',
    metadata=metadata||jsonb_build_object('supersededBy',saved_id)
  where fleet_application_id=app.id and requirement_key=target_requirement_key and status='current';
  insert into public.fleet_application_documents(fleet_application_id,requirement_key,document_submission_id,metadata)
  values(app.id,target_requirement_key,saved_id,jsonb_build_object('source','fleet-owner-portal'));
  return saved_id;
end;
$$;

create or replace function public.register_fleet_partner_vehicle(
  target_vehicle_type_id uuid,
  target_registration_number text,
  target_manufacturer text,
  target_model text,
  target_model_year integer,
  target_color text,
  target_max_load_kg numeric,
  target_cargo_volume_m3 numeric,
  target_fuel_type text,
  target_insurance_expires_at date,
  target_inspection_expires_at date,
  target_roadworthiness_expires_at date,
  target_service_keys text[],
  target_reason text,
  target_idempotency_key text
) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  partner record;
  vehicle_id uuid;
  registration text:=upper(btrim(coalesce(target_registration_number,'')));
  service_key text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Authentication is required'; end if;
  if registration='' or nullif(btrim(target_manufacturer),'') is null or nullif(btrim(target_model),'') is null
     or nullif(btrim(target_reason),'') is null or nullif(btrim(target_idempotency_key),'') is null then
    raise exception using errcode='22023',message='Registration, manufacturer, model, reason and idempotency key are required';
  end if;
  if target_vehicle_type_id is null or not exists(select 1 from public.vehicle_types where id=target_vehicle_type_id and status='active') then
    raise exception using errcode='22023',message='Choose an active vehicle type';
  end if;
  if target_model_year is not null and target_model_year not between 1900 and 2100 then
    raise exception using errcode='22023',message='Vehicle model year is invalid';
  end if;
  if coalesce(target_max_load_kg,0)<0 or coalesce(target_cargo_volume_m3,0)<0 then
    raise exception using errcode='22023',message='Vehicle capacity cannot be negative';
  end if;
  if coalesce(cardinality(target_service_keys),0)=0 or exists(
    select 1 from unnest(target_service_keys) k where k not in ('lpg','fuel')
  ) then raise exception using errcode='22023',message='Select LPG, Fuel or both service lines'; end if;
  select f.* into partner from public.fleet_partners f
  where f.owner_user_id=auth.uid() and f.verification_status='approved' and f.operational_status='active'
    and public.is_fleet_staff(f.id,array['owner_admin','fleet_manager','vehicle_manager'])
  order by f.created_at desc limit 1;
  if not found then raise exception using errcode='42501',message='An approved active fleet partner and vehicle-management access are required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fleet-vehicle:'||partner.id::text||':'||target_idempotency_key,0));
  select id into vehicle_id from public.vehicles
  where fleet_partner_id=partner.id and metadata->>'fleetRegistrationIdempotencyKey'=target_idempotency_key limit 1;
  if vehicle_id is not null then return vehicle_id; end if;
  if exists(select 1 from public.vehicles where lower(btrim(registration_number))=lower(registration)) then
    raise exception using errcode='23505',message='A vehicle with this registration number is already registered';
  end if;

  insert into public.vehicles(
    organization_id,owner_user_id,fleet_partner_id,vehicle_type_id,status,capacity_profile,metadata,created_by,
    ownership_type,ownership_relationship,manufacturer,model,model_year,registration_number,color,max_load_kg,
    cargo_volume_m3,fuel_type,insurance_expires_at,inspection_expires_at,roadworthiness_expires_at,platform_owned
  ) values (
    partner.organization_id,partner.owner_user_id,partner.id,target_vehicle_type_id,'pending','{}'::jsonb,
    jsonb_build_object('fleetRegistrationIdempotencyKey',target_idempotency_key,'serviceKeys',to_jsonb(target_service_keys),
      'registrationReason',btrim(target_reason),'ownerManaged',true),auth.uid(),
    'fleet_assigned','fleet_owned',btrim(target_manufacturer),btrim(target_model),target_model_year,registration,
    nullif(btrim(coalesce(target_color,'')),''),target_max_load_kg,target_cargo_volume_m3,
    nullif(btrim(coalesce(target_fuel_type,'')),''),target_insurance_expires_at,target_inspection_expires_at,
    target_roadworthiness_expires_at,false
  ) returning id into vehicle_id;

  foreach service_key in array target_service_keys loop
    insert into public.fleet_partner_service_lines(fleet_partner_id,vehicle_id,service_key,status,requested_by)
    values(partner.id,vehicle_id,service_key,'pending',auth.uid())
    on conflict(vehicle_id,service_key) do update set status='pending',decision_reason=null,
      reviewed_by=null,reviewed_at=null,updated_at=timezone('utc',now());
  end loop;
  return vehicle_id;
end;
$$;

create or replace function public.register_fleet_vehicle_document(
  target_vehicle_id uuid,
  target_requirement_key text,
  target_media_asset_id uuid,
  target_valid_from date,
  target_valid_until date,
  target_reason text,
  target_idempotency_key text
) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare vehicle record; requirement record; document_requirement record; media record; submission_id uuid; purpose text;
begin
  if auth.uid() is null or target_vehicle_id is null or target_media_asset_id is null
     or nullif(btrim(target_reason),'') is null or nullif(btrim(target_idempotency_key),'') is null then
    raise exception using errcode='22023',message='Vehicle, evidence, reason and idempotency key are required';
  end if;
  select v.* into vehicle from public.vehicles v
  where v.id=target_vehicle_id and v.fleet_partner_id is not null
    and public.is_fleet_staff(v.fleet_partner_id,array['owner_admin','fleet_manager','vehicle_manager']);
  if not found then raise exception using errcode='42501',message='Fleet vehicle access is required'; end if;
  select * into requirement from public.compliance_requirement_definitions
  where key=target_requirement_key and subject_type='vehicle' and status='active' and required;
  if not found then raise exception using errcode='22023',message='Active vehicle compliance requirement is required'; end if;
  purpose:=requirement.document_purpose_key;
  select r.* into document_requirement from public.document_requirements r
  where r.key=purpose and r.status='active'
  order by case when r.metadata->>'bounded_context'='lpg' then 0 else 1 end,r.created_at desc limit 1;
  if not found then raise exception using errcode='22023',message='The document upload requirement is not configured'; end if;
  select * into media from public.media_assets
  where id=target_media_asset_id and owner_user_id=auth.uid() and status='active'
    and storage_bucket in ('skima-platform-documents','skima-platform-media');
  if not found then raise exception using errcode='42501',message='Uploaded media must be active and owned by the fleet manager'; end if;
  if media.content_type is not null and cardinality(document_requirement.allowed_content_types)>0
     and media.content_type<>all(document_requirement.allowed_content_types) then
    raise exception using errcode='22023',message='Uploaded file type is not allowed for this vehicle requirement';
  end if;
  if target_valid_from is not null and target_valid_until is not null and target_valid_until<target_valid_from then
    raise exception using errcode='22023',message='Document validity dates are invalid';
  end if;
  select id into submission_id from public.document_submissions
  where source='skima.fleet.vehicle-document' and idempotency_key=target_idempotency_key;
  if submission_id is not null then return submission_id; end if;
  insert into public.document_submissions(
    requirement_id,application_id,subject_type,subject_id,owner_user_id,organization_id,media_asset_id,status,
    storage_bucket,storage_path,content_type,byte_size,checksum,submitted_at,source,idempotency_key,metadata,created_by
  ) values(
    document_requirement.id,null,'vehicle',target_vehicle_id,auth.uid(),vehicle.organization_id,media.id,'submitted',
    media.storage_bucket,media.storage_path,media.content_type,media.byte_size,media.checksum,timezone('utc',now()),
    'skima.fleet.vehicle-document',target_idempotency_key,
    jsonb_build_object('fleet_partner_id',vehicle.fleet_partner_id,'requirement_key',target_requirement_key,
      'purpose_key',purpose,'valid_from',target_valid_from,'valid_until',target_valid_until,'reason',btrim(target_reason),
      'privacy_classification','PRIVATE_VERIFICATION'),auth.uid()
  ) returning id into submission_id;
  update public.fleet_partner_documents set status='superseded'
  where fleet_partner_id=vehicle.fleet_partner_id and purpose_key=target_requirement_key and status='current';
  insert into public.fleet_partner_documents(
    fleet_partner_id,document_submission_id,purpose_key,status,valid_from,valid_until,metadata,created_by
  ) values(
    vehicle.fleet_partner_id,submission_id,target_requirement_key,'current',target_valid_from,target_valid_until,
    jsonb_build_object('vehicle_id',target_vehicle_id,'reason',btrim(target_reason)),auth.uid()
  );
  return submission_id;
end;
$$;

create or replace function public.review_fleet_vehicle_service_line(
  target_vehicle_id uuid,target_service_key text,target_decision text,target_reason text,target_idempotency_key text
) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid; vehicle record; next_status text;
begin
  if not public.has_permission('platform.fleets.review',null) and not public.has_permission('platform.vehicles.manage',null) then
    raise exception using errcode='42501',message='Fleet service-line review permission is required';
  end if;
  if target_service_key not in ('lpg','fuel') or target_decision not in ('approved','rejected','suspended')
     or nullif(btrim(target_reason),'') is null or nullif(btrim(target_idempotency_key),'') is null then
    raise exception using errcode='22023',message='A valid service, decision, reason and idempotency key are required';
  end if;
  select * into vehicle from public.vehicles where id=target_vehicle_id for update;
  if not found or vehicle.fleet_partner_id is null then raise exception 'Fleet-owned vehicle not found'; end if;
  if target_decision='approved' then
    if vehicle.status<>'active' then raise exception 'The vehicle must be approved before its service line can be activated'; end if;
    if not exists(select 1 from public.subject_compliance_status c where c.subject_type='vehicle' and c.subject_id=vehicle.id and c.compliant) then
      raise exception 'Vehicle compliance must be complete before activating a service line';
    end if;
  end if;
  next_status:=case target_decision when 'approved' then 'active' else target_decision end;
  update public.fleet_partner_service_lines set status=next_status,decision_reason=btrim(target_reason),
    reviewed_by=auth.uid(),reviewed_at=timezone('utc',now()),updated_at=timezone('utc',now())
  where vehicle_id=target_vehicle_id and service_key=target_service_key returning id into result;
  if result is null then raise exception 'Requested service line was not found'; end if;
  insert into public.event_log(event_type_key,source,subject_type,subject_id,actor_user_id,idempotency_key,payload,status)
  values('event.fleet.vehicle.service_line.reviewed','skima.fleet.service-line', 'vehicle',target_vehicle_id,auth.uid(),
    target_idempotency_key,jsonb_build_object('serviceKey',target_service_key,'decision',target_decision,'reason',btrim(target_reason)),'processed')
  on conflict(source,idempotency_key) do nothing;
  return result;
end;
$$;

create or replace function public.assign_fleet_driver_vehicle(
  target_fleet_partner_id uuid,target_driver_profile_id uuid,target_vehicle_id uuid,
  target_service_key text,target_relationship text,target_reason text,target_idempotency_key text
) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare saved_id uuid; vehicle record;
begin
  if auth.uid() is null or not public.is_fleet_staff(target_fleet_partner_id,array['owner_admin','fleet_manager','vehicle_manager']) then
    raise exception using errcode='42501',message='Fleet vehicle assignment access is required';
  end if;
  if target_service_key not in ('lpg','fuel') or target_relationship not in ('fleet_owned','leased','rented','third_party_authorized')
     or nullif(btrim(target_reason),'') is null or nullif(btrim(target_idempotency_key),'') is null then
    raise exception using errcode='22023',message='Service, relationship, reason and idempotency key are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_driver_profile_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended(target_vehicle_id::text,0));
  select * into vehicle from public.vehicles where id=target_vehicle_id and fleet_partner_id=target_fleet_partner_id for update;
  if not found or vehicle.status<>'active' then raise exception 'An approved vehicle belonging to this fleet is required'; end if;
  if not exists(select 1 from public.fleet_partner_service_lines where vehicle_id=target_vehicle_id and service_key=target_service_key and status='active') then
    raise exception 'This vehicle is not approved for the selected service';
  end if;
  if not exists(select 1 from public.driver_profiles where id=target_driver_profile_id and verification_status='approved') then
    raise exception 'The driver must be approved before assignment';
  end if;
  if exists(select 1 from public.driver_vehicle_links where status='active' and ends_at is null and vehicle_id=target_vehicle_id) then
    raise exception 'This vehicle already has an active driver assignment';
  end if;
  update public.driver_vehicle_links set status='revoked',ends_at=greatest(timezone('utc',now()),starts_at+interval '1 millisecond'),
    metadata=metadata||jsonb_build_object('endedReason','Reassigned by fleet partner','endedBy',auth.uid()),updated_at=timezone('utc',now())
  where driver_profile_id=target_driver_profile_id and status='active' and ends_at is null;
  insert into public.driver_vehicle_links(driver_profile_id,vehicle_id,relationship_type,status,authorized_by,starts_at,metadata,created_by)
  values(target_driver_profile_id,target_vehicle_id,target_relationship,'active',auth.uid(),timezone('utc',now()),
    jsonb_build_object('fleet_partner_id',target_fleet_partner_id,'service_key',target_service_key,'reason',btrim(target_reason),'idempotency_key',target_idempotency_key),auth.uid())
  returning id into saved_id;
  return saved_id;
end;
$$;

create or replace function public.create_fleet_staff_invitation(
  target_fleet_partner_id uuid,target_invitee_email text,target_access_role text,target_reason text,target_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare saved record; token_value text; email_value text:=lower(btrim(coalesce(target_invitee_email,'')));
begin
  if auth.uid() is null or not public.is_fleet_staff(target_fleet_partner_id,array['owner_admin','fleet_manager']) then
    raise exception using errcode='42501',message='Fleet owner or manager access is required';
  end if;
  if email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or target_access_role not in ('fleet_manager','vehicle_manager','compliance_viewer')
    or length(btrim(coalesce(target_reason,'')))<3
    or nullif(btrim(target_idempotency_key),'') is null then
    raise exception using errcode='22023',message='A valid email, staff role, reason and idempotency key are required';
  end if;
  select * into saved from public.fleet_staff_invitations where idempotency_key=target_idempotency_key;
  if found then return jsonb_build_object('id',saved.id,'status',saved.status,'expiresAt',saved.expires_at,'alreadyCreated',true); end if;
  token_value:=encode(extensions.gen_random_bytes(24),'hex');
  insert into public.fleet_staff_invitations(fleet_partner_id,invitee_email,access_role,token_hash,reason,invited_by,expires_at,idempotency_key)
  values(target_fleet_partner_id,email_value,target_access_role,encode(extensions.digest(convert_to(token_value,'UTF8'),'sha256'),'hex'),
    btrim(target_reason),auth.uid(),timezone('utc',now())+interval '7 days',target_idempotency_key)
  returning * into saved;
  return jsonb_build_object('id',saved.id,'status',saved.status,'expiresAt',saved.expires_at,'inviteToken',token_value,'inviteeEmail',saved.invitee_email);
end;
$$;

create or replace function public.accept_fleet_staff_invitation(target_invite_token text) returns uuid
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare invite record; user_email text:=lower(coalesce(auth.jwt()->>'email','')); staff_id uuid;
begin
  if auth.uid() is null or nullif(target_invite_token,'') is null or user_email='' then
    raise exception using errcode='42501',message='Sign in with the invited email address to accept this invitation';
  end if;
  select * into invite from public.fleet_staff_invitations
  where token_hash=encode(extensions.digest(convert_to(target_invite_token,'UTF8'),'sha256'),'hex')
  for update;
  if not found or invite.status<>'pending' or invite.expires_at<=timezone('utc',now()) then
    raise exception using errcode='55000',message='Fleet invitation is invalid, expired or already used';
  end if;
  if invite.invitee_email<>user_email then
    raise exception using errcode='42501',message='This invitation belongs to a different email address';
  end if;
  if not exists(select 1 from public.fleet_partners f where f.id=invite.fleet_partner_id and f.verification_status='approved' and f.operational_status='active') then
    raise exception using errcode='55000',message='The fleet partner is not currently active';
  end if;
  insert into public.fleet_authorized_staff(fleet_partner_id,user_id,access_role,reason,authorized_by,idempotency_key)
  values(invite.fleet_partner_id,auth.uid(),invite.access_role,'Accepted invitation: '||invite.reason,invite.invited_by,
    'fleet-invite-accepted:'||invite.id::text)
  on conflict(idempotency_key) do update set idempotency_key=excluded.idempotency_key
  returning id into staff_id;
  update public.fleet_staff_invitations set status='accepted',accepted_by=auth.uid(),accepted_at=timezone('utc',now()),updated_at=timezone('utc',now())
  where id=invite.id;
  return staff_id;
end;
$$;

create or replace function public.revoke_fleet_staff_access(
  target_fleet_partner_id uuid,target_staff_id uuid,target_reason text,target_idempotency_key text
) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid;
begin
  if auth.uid() is null or not public.is_fleet_staff(target_fleet_partner_id,array['owner_admin','fleet_manager']) then
    raise exception using errcode='42501',message='Fleet owner or manager access is required';
  end if;
  if length(btrim(coalesce(target_reason,'')))<3 or nullif(btrim(target_idempotency_key),'') is null then
    raise exception using errcode='22023',message='A reason and idempotency key are required';
  end if;
  update public.fleet_authorized_staff set status='revoked',ends_at=timezone('utc',now()),reason=btrim(target_reason),updated_at=timezone('utc',now())
  where id=target_staff_id and fleet_partner_id=target_fleet_partner_id and status='active'
    and access_role<>'owner_admin' returning id into result;
  if result is null then raise exception 'Active delegated fleet staff record not found'; end if;
  insert into public.event_log(event_type_key,source,subject_type,subject_id,actor_user_id,idempotency_key,payload,status)
  values('event.fleet.staff.revoked','skima.fleet.staff','fleet_partner',target_fleet_partner_id,auth.uid(),target_idempotency_key,
    jsonb_build_object('staffId',result,'reason',btrim(target_reason)),'processed')
  on conflict(source,idempotency_key) do nothing;
  return result;
end;
$$;

-- Extend the owner workspace without changing the existing application/vehicle payloads.
create or replace function public.read_my_fleet_workspace() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
select jsonb_build_object(
  'applications',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc)
    from public.fleet_partner_applications a where a.applicant_user_id=auth.uid()),'[]'::jsonb),
  'partners',coalesce((select jsonb_agg(to_jsonb(f)) from public.fleet_partners f
    where public.is_fleet_staff(f.id,null)),'[]'::jsonb),
  'vehicles',coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc) from public.vehicles v
    where v.fleet_partner_id in (select f.id from public.fleet_partners f where public.is_fleet_staff(f.id,null))),'[]'::jsonb),
  'assignments',coalesce((select jsonb_agg(to_jsonb(l) order by l.starts_at desc) from public.driver_vehicle_links l
    where l.vehicle_id in (select v.id from public.vehicles v where v.fleet_partner_id in
      (select f.id from public.fleet_partners f where public.is_fleet_staff(f.id,null)))),'[]'::jsonb),
  'staff',coalesce((select jsonb_agg(to_jsonb(s)) from public.fleet_authorized_staff s
    where public.is_fleet_staff(s.fleet_partner_id,array['owner_admin','fleet_manager'])),'[]'::jsonb),
  'staffInvitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.invitee_email,'role',i.access_role,
    'status',i.status,'expiresAt',i.expires_at,'createdAt',i.created_at,'reason',i.reason))
    from public.fleet_staff_invitations i where public.is_fleet_staff(i.fleet_partner_id,array['owner_admin','fleet_manager'])),'[]'::jsonb),
  'serviceLines',coalesce((select jsonb_agg(to_jsonb(s)) from public.fleet_partner_service_lines s
    where public.is_fleet_staff(s.fleet_partner_id,null)),'[]'::jsonb),
  'applicationDocuments',coalesce((select jsonb_agg(jsonb_build_object('id',link.id,'applicationId',link.fleet_application_id,
    'requirementKey',link.requirement_key,'documentSubmissionId',link.document_submission_id,'status',doc.status,
    'decisionReason',doc.decision_reason,'createdAt',doc.created_at))
    from public.fleet_application_documents link join public.document_submissions doc on doc.id=link.document_submission_id
    join public.fleet_partner_applications app on app.id=link.fleet_application_id
    where app.applicant_user_id=auth.uid()),'[]'::jsonb),
  'documentRequirements',coalesce((select jsonb_agg(to_jsonb(r) order by r.key)
    from public.fleet_application_document_requirements r where r.status='active'
      and exists(select 1 from public.fleet_partner_applications a where a.applicant_user_id=auth.uid() and a.partner_kind=any(r.partner_kinds))
  ),'[]'::jsonb),
  'vehicleDocuments',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'fleetPartnerId',d.fleet_partner_id,
    'vehicleId',d.metadata->>'vehicle_id','purposeKey',d.purpose_key,'documentSubmissionId',d.document_submission_id,
    'status',doc.status,'decisionReason',doc.decision_reason,'validFrom',d.valid_from,'validUntil',d.valid_until))
    from public.fleet_partner_documents d join public.document_submissions doc on doc.id=d.document_submission_id
    where public.is_fleet_staff(d.fleet_partner_id,null)),'[]'::jsonb),
  'vehicleDocumentRequirements',coalesce((select jsonb_agg(jsonb_build_object('key',r.key,'displayName',r.display_name,
    'description',r.display_name,'documentPurposeKey',r.document_purpose_key,'moduleKey',r.module_key,
    'required',r.required,'capabilityKey',r.capability_key))
    from public.compliance_requirement_definitions r where r.subject_type='vehicle' and r.status='active' and r.required),'[]'::jsonb)
);
$$;

create or replace function public.read_fleet_admin_workspace(target_search text default null,target_status text default null) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
select jsonb_build_object(
  'partners',coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at desc) from public.fleet_partners f
    where (target_status is null or f.verification_status=target_status) and
      (target_search is null or f.display_name ilike '%'||target_search||'%')),'[]'::jsonb),
  'applications',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from public.fleet_partner_applications a
    where (target_status is null or a.status=target_status) and
      (target_search is null or a.legal_name ilike '%'||target_search||'%')),'[]'::jsonb),
  'vehicles',coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc) from public.vehicles v
    where v.fleet_partner_id is not null),'[]'::jsonb),
  'drivers',coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc) from public.driver_profiles d
    where d.verification_status='approved'),'[]'::jsonb),
  'assignments',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc) from public.driver_vehicle_links l),'[]'::jsonb),
  'compliance',coalesce((select jsonb_agg(to_jsonb(c)) from public.subject_compliance_status c),'[]'::jsonb),
  'ownership',coalesce((select jsonb_agg(to_jsonb(r) order by r.valid_from desc) from public.vehicle_party_relationships r),'[]'::jsonb),
  'applicationDocuments',coalesce((select jsonb_agg(jsonb_build_object('id',link.id,'applicationId',link.fleet_application_id,
    'requirementKey',link.requirement_key,'documentSubmissionId',doc.id,'status',doc.status,'decisionReason',doc.decision_reason,
    'storageBucket',doc.storage_bucket,'storagePath',doc.storage_path,'contentType',doc.content_type,'createdAt',doc.created_at,
    'applicantUserId',app.applicant_user_id,'legalName',app.legal_name))
    from public.fleet_application_documents link join public.document_submissions doc on doc.id=link.document_submission_id
    join public.fleet_partner_applications app on app.id=link.fleet_application_id),'[]'::jsonb),
  'vehicleDocuments',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'fleetPartnerId',d.fleet_partner_id,
    'vehicleId',d.metadata->>'vehicle_id','purposeKey',d.purpose_key,'documentSubmissionId',doc.id,'status',doc.status,
    'decisionReason',doc.decision_reason,'storageBucket',doc.storage_bucket,'storagePath',doc.storage_path,
    'contentType',doc.content_type,'validFrom',d.valid_from,'validUntil',d.valid_until))
    from public.fleet_partner_documents d join public.document_submissions doc on doc.id=d.document_submission_id),'[]'::jsonb),
  'serviceLines',coalesce((select jsonb_agg(to_jsonb(s)) from public.fleet_partner_service_lines s),'[]'::jsonb),
  'staffInvitations',coalesce((select jsonb_agg(to_jsonb(i)) from public.fleet_staff_invitations i),'[]'::jsonb),
  'audit',coalesce((select jsonb_agg(to_jsonb(h) order by h.occurred_at desc) from
    (select id,fleet_partner_id::text entity_id,to_status,reason,actor_user_id,occurred_at from public.fleet_lifecycle_history
     union all select id,vehicle_id::text,to_status,reason,actor_user_id,occurred_at from public.vehicle_lifecycle_history) h),'[]'::jsonb)
) where public.has_permission('platform.fleets.read',null) or public.has_permission('platform.vehicles.manage',null)
$$;

-- Fuel affiliate commissions use the same vetted affiliate and station referral records,
-- but a separate policy and earning ledger. Only the SKIMA platform_fee_amount component
-- on a posted Fuel settlement can be used as the commission base.
insert into public.financial_policy_definitions(key,display_name,policy_family,value_schema,approval_required,allow_partner_delegation,status,metadata)
values(
  'commission.fuel.station_affiliate','Fuel Station Affiliate Commission','affiliate',
  '{"type":"object","required":["program_enabled","commission_percent","earning_period_months","eligible_revenue_streams"]}'::jsonb,
  true,false,'active','{"module":"fuel","programme":"station_affiliate","currency":"NGN","geography":"NG"}'::jsonb
) on conflict(key) do nothing;

create or replace function public.validate_fuel_station_affiliate_policy_version() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare policy_key text; config jsonb; streams text[];
begin
  select d.key into policy_key from public.financial_policy_definitions d where d.id=new.policy_definition_id;
  if policy_key is distinct from 'commission.fuel.station_affiliate' then return new; end if;
  config:=new.configuration;
  if new.currency_code<>'NGN' or new.service_key is distinct from 'fuel.station.affiliate'
    or new.geography_type<>'country' or new.geography_key is distinct from 'NG'
    or new.module_id is distinct from (select id from public.business_modules where key='fuel') then
    raise exception using errcode='22023',message='Fuel affiliate policy must be scoped to Fuel / Nigeria / NGN';
  end if;
  if jsonb_typeof(config->'program_enabled') is distinct from 'boolean'
    or jsonb_typeof(config->'commission_percent') is distinct from 'number'
    or jsonb_typeof(config->'earning_period_months') is distinct from 'number'
    or jsonb_typeof(config->'eligible_revenue_streams') is distinct from 'array' then
    raise exception using errcode='22023',message='Fuel affiliate policy configuration is incomplete';
  end if;
  if (config->>'commission_percent')::numeric<0 or (config->>'commission_percent')::numeric>100
    or ((config->>'program_enabled')::boolean and (config->>'commission_percent')::numeric<=0) then
    raise exception using errcode='22023',message='Fuel affiliate commission must be positive while enabled and cannot exceed 100%';
  end if;
  if (config->>'earning_period_months')::numeric<>trunc((config->>'earning_period_months')::numeric)
    or (config->>'earning_period_months')::integer<1 or (config->>'earning_period_months')::integer>36 then
    raise exception using errcode='22023',message='Fuel affiliate earning window must be 1 to 36 whole months';
  end if;
  select array_agg(value) into streams from jsonb_array_elements_text(config->'eligible_revenue_streams') e(value);
  if coalesce(cardinality(streams),0)=0 or exists(select 1 from unnest(streams) s where s<>'fuel_platform_fee') then
    raise exception using errcode='22023',message='Fuel affiliate commissions can only use the Fuel platform fee stream';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_validate_fuel_station_affiliate_policy_version on public.financial_policy_versions;
create trigger trg_validate_fuel_station_affiliate_policy_version
before insert or update on public.financial_policy_versions
for each row execute function public.validate_fuel_station_affiliate_policy_version();

create table if not exists public.fuel_station_affiliate_earnings (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.lpg_station_affiliates(id) on delete restrict,
  referral_id uuid not null references public.lpg_station_referrals(id) on delete restrict,
  station_branch_id uuid not null references public.organization_branches(id) on delete restrict,
  fuel_order_id uuid not null unique references public.order_records(id) on delete restrict,
  settlement_transaction_id uuid not null references public.financial_transactions(id) on delete restrict,
  financial_transaction_id uuid references public.financial_transactions(id) on delete restrict,
  revenue_wallet_id uuid not null references public.wallet_accounts(id) on delete restrict,
  commission_wallet_id uuid not null references public.wallet_accounts(id) on delete restrict,
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  revenue_base_amount numeric(28,8) not null check(revenue_base_amount>=0),
  commission_percent numeric(9,6) not null check(commission_percent>0 and commission_percent<=100),
  amount numeric(28,8) not null check(amount>0),
  policy_version_id uuid not null references public.financial_policy_versions(id) on delete restrict,
  earning_period_start timestamptz not null,
  earning_period_end timestamptz not null,
  status text not null default 'posted' check(status in ('posted','reversed')),
  reversal_transaction_id uuid references public.financial_transactions(id) on delete restrict,
  reversed_at timestamptz,
  reversal_reason text,
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  check(earning_period_end>earning_period_start)
);
create index if not exists fuel_station_affiliate_earnings_affiliate_idx
  on public.fuel_station_affiliate_earnings(affiliate_id,status,created_at desc);

create table if not exists public.fuel_station_affiliate_commission_failures (
  id uuid primary key default gen_random_uuid(),
  fuel_order_id uuid not null unique references public.order_records(id) on delete restrict,
  settlement_transaction_id uuid references public.financial_transactions(id) on delete set null,
  attempt_count integer not null default 1 check(attempt_count>0),
  last_error text not null,
  status text not null default 'pending' check(status in ('pending','resolved','dismissed')),
  last_attempt_at timestamptz not null default timezone('utc',now()),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);
create table if not exists public.fuel_station_affiliate_reversal_failures (
  id uuid primary key default gen_random_uuid(),
  earning_id uuid not null unique references public.fuel_station_affiliate_earnings(id) on delete restrict,
  required_amount numeric(28,8) not null check(required_amount>0),
  available_amount numeric(28,8) not null check(available_amount>=0),
  last_error text not null,
  attempt_count integer not null default 1 check(attempt_count>0),
  status text not null default 'pending' check(status in ('pending','resolved','dismissed')),
  last_attempt_at timestamptz not null default timezone('utc',now()),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.fuel_station_affiliate_earnings enable row level security;
alter table public.fuel_station_affiliate_commission_failures enable row level security;
alter table public.fuel_station_affiliate_reversal_failures enable row level security;
revoke all on public.fuel_station_affiliate_earnings,public.fuel_station_affiliate_commission_failures,
  public.fuel_station_affiliate_reversal_failures from public,anon,authenticated;
grant all on public.fuel_station_affiliate_earnings,public.fuel_station_affiliate_commission_failures,
  public.fuel_station_affiliate_reversal_failures to service_role;

create or replace function public.award_fuel_station_affiliate_commission(target_fuel_order_id uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  operation record; order_record record; referral record; affiliate record; policy jsonb; config jsonb;
  commission_percent numeric; earning_months integer; earning_start timestamptz; earning_end timestamptz;
  revenue_base numeric(28,8):=0; commission_amount numeric(28,8):=0; revenue_wallet uuid; commission_wallet uuid;
  earning_id uuid; posting_id uuid; existing record;
begin
  select op.*,o.currency_code,o.public_reference,o.created_at order_created_at
  into operation
  from public.fuel_order_operations op join public.order_records o on o.id=op.order_id
  join public.business_modules m on m.id=o.module_id and m.key='fuel'
  where op.order_id=target_fuel_order_id for update of op;
  if not found or operation.stage_key<>'completed' or operation.settlement_transaction_id is null then return null; end if;

  select r.*,s.branch_id into referral
  from public.lpg_station_referrals r
  join public.lpg_station_branches s on s.id=r.station_branch_id
  where s.branch_id=operation.station_branch_id and r.status='activated'
  order by r.activated_at desc limit 1;
  if not found or referral.activated_at is null or operation.order_created_at<referral.activated_at then return null; end if;
  select * into affiliate from public.lpg_station_affiliates where id=referral.affiliate_id and status='active';
  if not found then return null; end if;

  policy:=public.resolve_financial_policy('commission.fuel.station_affiliate',operation.currency_code,timezone('utc',now()),
    'fuel',null,'fuel.station.affiliate','country','NG');
  config:=policy->'configuration';
  if not coalesce((config->>'program_enabled')::boolean,false) then return null; end if;
  commission_percent:=nullif(config->>'commission_percent','')::numeric;
  earning_months:=nullif(config->>'earning_period_months','')::integer;
  if commission_percent is null or commission_percent<=0 or commission_percent>100 or earning_months is null
     or earning_months<1 or earning_months>36 or not ('fuel_platform_fee'=any(array(select jsonb_array_elements_text(config->'eligible_revenue_streams')))) then
    raise exception using errcode='55000',message='Active Fuel Station Affiliate policy is invalid';
  end if;
  earning_start:=referral.activated_at;
  earning_end:=earning_start+make_interval(months=>earning_months);
  if operation.order_created_at>=earning_end then return null; end if;

  -- Fuel settlement ledger splits platform fee from principal, supplier amount, driver pay,
  -- tax and refundable deposits. Only the platform_fee_amount subcomponent is eligible.
  select coalesce(sum(greatest(coalesce(nullif(l.metadata->>'platform_fee_amount','')::numeric,0),0)),0)::numeric(28,8)
  into revenue_base
  from public.wallet_ledger_entries l
  join public.wallet_accounts w on w.id=l.wallet_id
  where l.transaction_id=operation.settlement_transaction_id and l.direction='credit'
    and w.wallet_type='platform_revenue' and w.owner_entity_type='platform'
    and w.currency_code=operation.currency_code and l.entry_type='fee';
  if revenue_base<=0 then return null; end if;
  commission_amount:=round(revenue_base*commission_percent/100,2);
  if commission_amount<=0 then return null; end if;

  select l.wallet_id into revenue_wallet
  from public.wallet_ledger_entries l join public.wallet_accounts w on w.id=l.wallet_id
  where l.transaction_id=operation.settlement_transaction_id and l.direction='credit'
    and w.wallet_type='platform_revenue' and w.owner_entity_type='platform'
    and w.currency_code=operation.currency_code and l.entry_type='fee'
  order by l.created_at limit 1;
  if revenue_wallet is null then return null; end if;

  commission_wallet:=affiliate.commission_wallet_id;
  if commission_wallet is null then
    commission_wallet:=public.ensure_wallet_account('commission','user',affiliate.affiliate_user_id,operation.currency_code,
      'fuel.station_affiliate.wallet',jsonb_build_object('module','fuel','purpose','station_affiliate_commission'),
      'station-affiliate-wallet:'||affiliate.affiliate_user_id::text||':'||operation.currency_code);
    update public.lpg_station_affiliates set commission_wallet_id=commission_wallet,updated_at=timezone('utc',now())
    where id=affiliate.id;
  end if;

  insert into public.fuel_station_affiliate_earnings(
    affiliate_id,referral_id,station_branch_id,fuel_order_id,settlement_transaction_id,revenue_wallet_id,
    commission_wallet_id,currency_code,revenue_base_amount,commission_percent,amount,policy_version_id,
    earning_period_start,earning_period_end,status,metadata
  ) values(
    affiliate.id,referral.id,operation.station_branch_id,target_fuel_order_id,operation.settlement_transaction_id,
    revenue_wallet,commission_wallet,operation.currency_code,revenue_base,commission_percent,commission_amount,
    (policy->>'policyVersionId')::uuid,earning_start,earning_end,'posted',
    jsonb_build_object('serviceLine','fuel','revenueStreams',config->'eligible_revenue_streams',
      'policyKey','commission.fuel.station_affiliate','policyVersion',policy->>'version',
      'fuelProductKey',operation.product_key,'platformFeeOnly',true)
  ) on conflict(fuel_order_id) do nothing returning id into earning_id;
  if earning_id is null then
    select id,financial_transaction_id into existing from public.fuel_station_affiliate_earnings where fuel_order_id=target_fuel_order_id;
    return existing.id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(revenue_wallet::text,0));
  if coalesce((select b.balance from public.wallet_balances b where b.wallet_id=revenue_wallet),0)<commission_amount then
    raise exception using errcode='55000',message='SKIMA Fuel revenue wallet cannot fund this affiliate commission';
  end if;
  posting_id:=public.post_financial_transaction(
    'commission',operation.currency_code,'fuel.station_affiliate','fuel_station_affiliate_earning',earning_id,
    jsonb_build_array(
      jsonb_build_object('wallet_id',revenue_wallet,'direction','debit','amount',commission_amount,'entry_type','commission',
        'metadata',jsonb_build_object('role','skima_revenue','revenue_stream','fuel_platform_fee','fuel_order_id',target_fuel_order_id)),
      jsonb_build_object('wallet_id',commission_wallet,'direction','credit','amount',commission_amount,'entry_type','commission',
        'metadata',jsonb_build_object('role','affiliate_commission','service_line','fuel','affiliate_id',affiliate.id,
          'referral_id',referral.id,'fuel_order_id',target_fuel_order_id))
    ),
    'fuel-station-affiliate:'||target_fuel_order_id::text,null,operation.public_reference,policy,
    jsonb_build_object('fuelOrderId',target_fuel_order_id,'affiliateId',affiliate.id,'referralId',referral.id,
      'revenueBaseAmount',revenue_base,'commissionPercent',commission_percent,'amount',commission_amount,'serviceLine','fuel')
  );
  update public.fuel_station_affiliate_earnings set financial_transaction_id=posting_id,updated_at=timezone('utc',now()) where id=earning_id;
  delete from public.fuel_station_affiliate_commission_failures where fuel_order_id=target_fuel_order_id;
  return earning_id;
end;
$$;

create or replace function public.capture_fuel_station_affiliate_commission_failure() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.settlement_transaction_id is null or new.stage_key<>'completed'
     or (tg_op='UPDATE' and old.settlement_transaction_id is not distinct from new.settlement_transaction_id) then
    return new;
  end if;
  begin
    perform public.award_fuel_station_affiliate_commission(new.order_id);
  exception when others then
    insert into public.fuel_station_affiliate_commission_failures(fuel_order_id,settlement_transaction_id,last_error,metadata)
    values(new.order_id,new.settlement_transaction_id,left(sqlerrm,2000),jsonb_build_object('trigger','fuel-settlement'))
    on conflict(fuel_order_id) do update set attempt_count=public.fuel_station_affiliate_commission_failures.attempt_count+1,
      settlement_transaction_id=excluded.settlement_transaction_id,last_error=excluded.last_error,last_attempt_at=timezone('utc',now());
  end;
  return new;
end;
$$;
drop trigger if exists trg_capture_fuel_station_affiliate_commission on public.fuel_order_operations;
create trigger trg_capture_fuel_station_affiliate_commission
after insert or update of settlement_transaction_id,stage_key on public.fuel_order_operations
for each row execute function public.capture_fuel_station_affiliate_commission_failure();

create or replace function public.retry_fuel_station_affiliate_commission(target_fuel_order_id uuid,target_reason text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid;
begin
  if not public.has_permission('platform.revenue.manage',null) and not public.has_permission('platform.wallets.manage',null) then
    raise exception using errcode='42501',message='Revenue or wallet management permission is required';
  end if;
  if length(btrim(coalesce(target_reason,'')))<5 then raise exception using errcode='22023',message='A retry reason is required'; end if;
  result:=public.award_fuel_station_affiliate_commission(target_fuel_order_id);
  if result is null then raise exception 'Fuel order is not eligible for affiliate commission or no active policy applies'; end if;
  delete from public.fuel_station_affiliate_commission_failures where fuel_order_id=target_fuel_order_id;
  return result;
end;
$$;

create or replace function public.reverse_fuel_station_affiliate_commission(target_earning_id uuid,target_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare earning record; available numeric; transaction_id uuid;
begin
  if auth.role()<>'service_role' and not public.has_permission('platform.revenue.manage',null)
     and not public.has_permission('platform.wallets.manage',null) then
    raise exception using errcode='42501',message='Revenue or wallet management permission is required';
  end if;
  if length(btrim(coalesce(target_reason,'')))<5 then raise exception using errcode='22023',message='A reversal reason is required'; end if;
  select * into earning from public.fuel_station_affiliate_earnings where id=target_earning_id for update;
  if not found then raise exception 'Fuel affiliate earning was not found'; end if;
  if earning.status='reversed' then return jsonb_build_object('status','reversed','earningId',earning.id); end if;
  select coalesce(balance,0) into available from public.wallet_balances where wallet_id=earning.commission_wallet_id;
  if coalesce(available,0)<earning.amount then
    insert into public.fuel_station_affiliate_reversal_failures(earning_id,required_amount,available_amount,last_error)
    values(earning.id,earning.amount,coalesce(available,0),'Affiliate commission wallet balance is insufficient for reversal')
    on conflict(earning_id) do update set required_amount=excluded.required_amount,available_amount=excluded.available_amount,
      last_error=excluded.last_error,attempt_count=public.fuel_station_affiliate_reversal_failures.attempt_count+1,
      last_attempt_at=timezone('utc',now());
    return jsonb_build_object('status','pending_recovery','earningId',earning.id,'requiredAmount',earning.amount,'availableAmount',coalesce(available,0));
  end if;
  transaction_id:=public.post_financial_transaction(
    'reversal',earning.currency_code,'fuel.station_affiliate.reversal','fuel_station_affiliate_earning',earning.id,
    jsonb_build_array(
      jsonb_build_object('wallet_id',earning.commission_wallet_id,'direction','debit','amount',earning.amount,'entry_type','reversal',
        'metadata',jsonb_build_object('role','affiliate_commission_recovery','fuel_order_id',earning.fuel_order_id)),
      jsonb_build_object('wallet_id',earning.revenue_wallet_id,'direction','credit','amount',earning.amount,'entry_type','reversal',
        'metadata',jsonb_build_object('role','skima_revenue_recovery','fuel_order_id',earning.fuel_order_id))
    ),
    'fuel-station-affiliate-reversal:'||earning.id::text,null,earning.fuel_order_id::text,
    jsonb_build_object('policyKey','commission.fuel.station_affiliate.reversal'),
    jsonb_build_object('earningId',earning.id,'reason',btrim(target_reason),'fuelOrderId',earning.fuel_order_id)
  );
  update public.fuel_station_affiliate_earnings set status='reversed',reversal_transaction_id=transaction_id,
    reversed_at=timezone('utc',now()),reversal_reason=btrim(target_reason),updated_at=timezone('utc',now()) where id=earning.id;
  delete from public.fuel_station_affiliate_reversal_failures where earning_id=earning.id;
  return jsonb_build_object('status','reversed','earningId',earning.id,'transactionId',transaction_id);
end;
$$;

create or replace function public.retry_fuel_station_affiliate_reversal(target_earning_id uuid,target_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.has_permission('platform.revenue.manage',null) and not public.has_permission('platform.wallets.manage',null) then
    raise exception using errcode='42501',message='Revenue or wallet management permission is required';
  end if;
  return public.reverse_fuel_station_affiliate_commission(target_earning_id,target_reason);
end;
$$;

create or replace function public.read_fuel_station_affiliate_admin_workspace() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare policy_result jsonb;
begin
  if auth.role()<>'service_role' and not public.is_platform_super_admin()
    and not public.has_permission('platform.dispatch.read',null)
    and not public.has_permission('platform.wallets.read',null)
    and not public.has_permission('platform.revenue.read',null)
    and not public.has_permission('platform.financial_policy.read',null)
    and not public.has_permission('platform.financial_policy.draft',null)
    and not public.has_permission('platform.financial_policy.approve',null)
    and not public.has_permission('platform.financial_policy.activate',null) then
    raise exception using errcode='42501',message='Station Affiliate administration read permission is required';
  end if;
  select jsonb_build_object('policyKey',d.key,'displayName',d.display_name,'policyFamily',d.policy_family,'definitionId',d.id,
    'latestVersion',(select to_jsonb(v.*) from public.financial_policy_versions v where v.policy_definition_id=d.id order by v.version desc limit 1),
    'activeVersion',(select to_jsonb(v.*) from public.financial_policy_versions v where v.policy_definition_id=d.id
      and v.lifecycle_status in ('active','scheduled') and v.effective_from<=timezone('utc',now())
      and (v.effective_until is null or v.effective_until>timezone('utc',now())) order by v.version desc limit 1))
  into policy_result from public.financial_policy_definitions d where d.key='commission.fuel.station_affiliate';
  return jsonb_build_object(
    'policy',policy_result,
    'affiliates',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'affiliateUserId',a.affiliate_user_id,
      'displayName',p.display_name,'referralCode',a.referral_code,'status',a.status,'createdAt',a.created_at,
      'reviewReason',a.review_reason,'referralCount',(select count(*) from public.lpg_station_referrals r where r.affiliate_id=a.id),
      'activeReferrals',(select count(*) from public.lpg_station_referrals r where r.affiliate_id=a.id and r.status='activated'),
      'earned',(select coalesce(sum(e.amount),0) from public.fuel_station_affiliate_earnings e where e.affiliate_id=a.id and e.status='posted'))
      order by a.created_at desc) from public.lpg_station_affiliates a join public.profiles p on p.id=a.affiliate_user_id),'[]'::jsonb),
    'referrals',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'status',r.status,'referralCode',r.referral_code_snapshot,
      'stationBranchId',r.station_branch_id,'stationName',coalesce(s.display_name,'Station pending activation'),
      'submittedAt',r.submitted_at,'activatedAt',r.activated_at,'affiliateId',a.id,'affiliateName',p.display_name,
      'earnings',(select coalesce(sum(e.amount),0) from public.fuel_station_affiliate_earnings e where e.referral_id=r.id and e.status='posted'))
      order by r.submitted_at desc) from public.lpg_station_referrals r join public.lpg_station_affiliates a on a.id=r.affiliate_id
      join public.profiles p on p.id=a.affiliate_user_id left join public.lpg_station_branches s on s.id=r.station_branch_id),'[]'::jsonb),
    'earnings',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'affiliateId',e.affiliate_id,'affiliateName',p.display_name,
      'referralId',e.referral_id,'stationBranchId',e.station_branch_id,'stationName',b.display_name,'orderId',e.fuel_order_id,
      'publicReference',o.public_reference,'currencyCode',e.currency_code,'revenueBaseAmount',e.revenue_base_amount,
      'commissionPercent',e.commission_percent,'amount',e.amount,'status',e.status,'createdAt',e.created_at,
      'policyVersion',e.metadata->>'policyVersion','serviceLine','fuel','reversalTransactionId',e.reversal_transaction_id)
      order by e.created_at desc) from public.fuel_station_affiliate_earnings e join public.lpg_station_affiliates a on a.id=e.affiliate_id
      join public.profiles p on p.id=a.affiliate_user_id join public.organization_branches b on b.id=e.station_branch_id
      join public.order_records o on o.id=e.fuel_order_id),'[]'::jsonb),
    'commissionFailures',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'orderId',f.fuel_order_id,
      'attemptCount',f.attempt_count,'lastError',f.last_error,'status',f.status,'lastAttemptAt',f.last_attempt_at))
      from public.fuel_station_affiliate_commission_failures f where f.status='pending'),'[]'::jsonb),
    'reversalFailures',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'earningId',f.earning_id,
      'requiredAmount',f.required_amount,'availableAmount',f.available_amount,'lastError',f.last_error,
      'attemptCount',f.attempt_count,'status',f.status,'lastAttemptAt',f.last_attempt_at))
      from public.fuel_station_affiliate_reversal_failures f where f.status='pending'),'[]'::jsonb)
  );
end;
$$;

-- Refund / reversal postings for Fuel orders reverse the linked affiliate commission.
create or replace function public.reverse_fuel_station_affiliate_on_refund() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare fuel_order uuid; earning uuid;
begin
  if new.status<>'posted' or new.transaction_type not in ('refund','reversal') then return new; end if;
  if coalesce(new.metadata->>'module_key',new.metadata->>'bounded_context') not in ('fuel') then return new; end if;
  begin
    fuel_order:=nullif(new.metadata->>'fuel_order_id','')::uuid;
  exception when invalid_text_representation then fuel_order:=null;
  end;
  if fuel_order is null and new.subject_id is not null then
    select op.order_id into fuel_order from public.fuel_order_operations op where op.order_id=new.subject_id;
  end if;
  if fuel_order is null then return new; end if;
  select id into earning from public.fuel_station_affiliate_earnings where fuel_order_id=fuel_order and status='posted';
  if earning is not null then
    perform public.reverse_fuel_station_affiliate_commission(earning,'Automatic reversal after posted Fuel refund/reversal '||new.id::text);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_reverse_fuel_station_affiliate_on_refund on public.financial_transactions;
create trigger trg_reverse_fuel_station_affiliate_on_refund
after insert or update of status on public.financial_transactions
for each row execute function public.reverse_fuel_station_affiliate_on_refund();

revoke all on function public.register_fleet_application_document(uuid,text,uuid,text),
  public.register_fleet_partner_vehicle(uuid,text,text,text,integer,text,numeric,numeric,text,date,date,date,text[],text,text),
  public.register_fleet_vehicle_document(uuid,text,uuid,date,date,text,text),
  public.review_fleet_vehicle_service_line(uuid,text,text,text,text),
  public.assign_fleet_driver_vehicle(uuid,uuid,uuid,text,text,text,text),
  public.create_fleet_staff_invitation(uuid,text,text,text,text),
  public.accept_fleet_staff_invitation(text),
  public.revoke_fleet_staff_access(uuid,uuid,text,text),
  public.validate_fuel_station_affiliate_policy_version(),
  public.award_fuel_station_affiliate_commission(uuid),
  public.capture_fuel_station_affiliate_commission_failure(),
  public.retry_fuel_station_affiliate_commission(uuid,text),
  public.reverse_fuel_station_affiliate_commission(uuid,text),
  public.retry_fuel_station_affiliate_reversal(uuid,text),
  public.read_fuel_station_affiliate_admin_workspace(),
  public.reverse_fuel_station_affiliate_on_refund()
from public,anon;

grant execute on function public.register_fleet_application_document(uuid,text,uuid,text),
  public.register_fleet_partner_vehicle(uuid,text,text,text,integer,text,numeric,numeric,text,date,date,date,text[],text,text),
  public.register_fleet_vehicle_document(uuid,text,uuid,date,date,text,text),
  public.assign_fleet_driver_vehicle(uuid,uuid,uuid,text,text,text,text),
  public.create_fleet_staff_invitation(uuid,text,text,text,text),
  public.accept_fleet_staff_invitation(text),
  public.revoke_fleet_staff_access(uuid,uuid,text,text),
  public.read_my_fleet_workspace()
to authenticated,service_role;
grant execute on function public.review_fleet_vehicle_service_line(uuid,text,text,text,text),
  public.read_fleet_admin_workspace(text,text),
  public.retry_fuel_station_affiliate_commission(uuid,text),
  public.retry_fuel_station_affiliate_reversal(uuid,text),
  public.read_fuel_station_affiliate_admin_workspace()
to authenticated,service_role;

grant execute on function public.award_fuel_station_affiliate_commission(uuid),
  public.capture_fuel_station_affiliate_commission_failure(),
  public.reverse_fuel_station_affiliate_commission(uuid,text),
  public.reverse_fuel_station_affiliate_on_refund()
to service_role;


-- Keep the original LPG summary implementation, then add Fuel commission amounts from
-- the same affiliate wallet so the customer sees one consolidated earning balance.
alter function public.read_my_lpg_station_affiliate() rename to read_my_lpg_station_affiliate_lpg_only;
create or replace function public.read_my_lpg_station_affiliate() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $fuelwrap$
declare result jsonb; affiliate_id uuid; fuel_earned numeric(28,8):=0;
begin
  result:=public.read_my_lpg_station_affiliate_lpg_only();
  select a.id into affiliate_id from public.lpg_station_affiliates a where a.affiliate_user_id=auth.uid();
  if affiliate_id is null then return result; end if;
  select coalesce(sum(e.amount),0) into fuel_earned
  from public.fuel_station_affiliate_earnings e where e.affiliate_id=affiliate_id and e.status='posted';
  result:=jsonb_set(result,'{totalEarned}',to_jsonb(coalesce(nullif(result->>'totalEarned','')::numeric,0)+fuel_earned),true);
  result:=jsonb_set(result,'{fuelTotalEarned}',to_jsonb(fuel_earned),true);
  result:=jsonb_set(result,'{lpgTotalEarned}',to_jsonb(coalesce(nullif(result->>'totalEarned','')::numeric,0)-fuel_earned),true);
  return result;
end;
$fuelwrap$;
revoke all on function public.read_my_lpg_station_affiliate() from public,anon;
grant execute on function public.read_my_lpg_station_affiliate() to authenticated,service_role;

notify pgrst,'reload schema';
commit;
