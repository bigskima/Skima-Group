begin;

-- Fleet partner staff and vehicle registration.
alter table public.fleet_authorized_staff drop constraint if exists fleet_authorized_staff_access_role_check;
alter table public.fleet_authorized_staff add constraint fleet_authorized_staff_access_role_check
  check (access_role in ('owner_admin','fleet_manager','vehicle_manager','compliance_viewer','driver_operator'));

create table if not exists public.fleet_staff_invitations (
  id uuid primary key default gen_random_uuid(),
  fleet_partner_id uuid not null references public.fleet_partners(id) on delete restrict,
  invited_email text not null, invited_user_id uuid references public.profiles(id) on delete restrict,
  access_role text not null check (access_role in ('fleet_manager','vehicle_manager','compliance_viewer','driver_operator')),
  status text not null default 'pending' check (status in ('pending','accepted','expired','revoked')),
  reason text not null, invited_by uuid not null references public.profiles(id) on delete restrict,
  accepted_at timestamptz, expires_at timestamptz not null, idempotency_key text not null,
  created_at timestamptz not null default timezone('utc',now()), updated_at timestamptz not null default timezone('utc',now()),
  unique(fleet_partner_id,idempotency_key)
);
create index if not exists fleet_staff_invitation_email_idx
  on public.fleet_staff_invitations(lower(invited_email),expires_at) where status='pending';

create table if not exists public.fleet_vehicle_registrations (
  id uuid primary key default gen_random_uuid(),
  fleet_partner_id uuid not null references public.fleet_partners(id) on delete restrict,
  vehicle_id uuid not null unique references public.vehicles(id) on delete restrict,
  idempotency_key text not null, created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default timezone('utc',now()), unique(fleet_partner_id,idempotency_key)
);
create table if not exists public.fleet_vehicle_service_lines (
  id uuid primary key default gen_random_uuid(),
  fleet_partner_id uuid not null references public.fleet_partners(id) on delete restrict,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  service_key text not null check(service_key in ('lpg','fuel')),
  status text not null default 'pending' check(status in ('pending','approved','rejected','suspended')),
  decision_reason text, reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz, created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default timezone('utc',now()), updated_at timestamptz not null default timezone('utc',now()),
  unique(vehicle_id,service_key)
);

-- Fleet evidence is kept private but joins the existing document review data model.
insert into public.document_requirement_sets(key,display_name,subject_category,status,metadata)
values('documents.fleet.partner.phase-one','Fleet partner application evidence','business','active',
  jsonb_build_object('module','fleet','source','fleet_partner_portal'))
on conflict(key) do update set status='active',metadata=document_requirement_sets.metadata||excluded.metadata,
  updated_at=timezone('utc',now());
insert into public.document_requirements(
  requirement_set_id,key,display_name,description,is_required,review_required,min_count,max_count,
  allowed_content_types,max_byte_size,status,metadata
)
select s.id,r.key,r.name,r.description,r.required,true,1,2,
  array['application/pdf','image/jpeg','image/png','image/webp']::text[],10485760,'active',
  jsonb_build_object('privacy_classification','PRIVATE_VERIFICATION','fleetRequirement',true)
from public.document_requirement_sets s
cross join (values
 ('fleet.identity','Owner identity evidence','Upload a government-issued identity document.',true),
 ('fleet.registration','Company registration evidence','Upload CAC or the applicable business registration evidence.',false),
 ('fleet.address','Operating address evidence','Upload a recent document showing the operating address.',true)
) r(key,name,description,required)
where s.key='documents.fleet.partner.phase-one'
on conflict(requirement_set_id,key) do update set display_name=excluded.display_name,
 description=excluded.description,is_required=excluded.is_required,review_required=true,
 allowed_content_types=excluded.allowed_content_types,max_byte_size=excluded.max_byte_size,
 status='active',metadata=excluded.metadata;

-- Correct the canonical fleet-party role for leased, rented and authorised vehicles.
create or replace function public.seed_canonical_vehicle_owner()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare party_type text; party_id uuid; relationship_role_value text;
begin
 party_type:=case when new.fleet_partner_id is not null then 'fleet_partner'
   when new.organization_id is not null then 'organization' when new.owner_user_id is not null then 'profile' end;
 party_id:=coalesce(new.fleet_partner_id,new.organization_id,new.owner_user_id);
 relationship_role_value:=case new.ownership_relationship
   when 'leased' then 'lessee' when 'rented' then 'rental_provider'
   when 'third_party_authorized' then 'authorized_third_party' else 'legal_owner' end;
 if party_id is not null then
  insert into public.vehicle_party_relationships(
    vehicle_id,party_type,party_id,relationship_role,source,idempotency_key,reason,metadata
  ) values(
    new.id,party_type,party_id,relationship_role_value,'skima.vehicle.registration','owner:'||new.id,
    'Canonical fleet ownership or operating relationship established during registration.',
    jsonb_build_object('registrationProjection',true,'ownershipRelationship',new.ownership_relationship)
  ) on conflict(source,idempotency_key) do nothing;
 end if;
 return new;
end $$;

create or replace function public.register_fleet_partner_vehicle(
 target_fleet_partner_id uuid,target_vehicle_type_id uuid,target_registration_number text,
 target_manufacturer text,target_model text,target_model_year integer,target_color text,
 target_fuel_type text,target_max_load_kg numeric,target_service_keys text[],
 target_ownership_relationship text,target_idempotency_key text,target_metadata jsonb default '{}'
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare saved_id uuid; existing_id uuid; registration text:=upper(btrim(coalesce(target_registration_number,'')));
  service_key text;
begin
 if auth.uid() is null or not public.is_fleet_staff(target_fleet_partner_id,array['owner_admin','fleet_manager','vehicle_manager']) then
  raise exception using errcode='42501',message='Fleet vehicle management access is required';
 end if;
 if not exists(select 1 from public.fleet_partners p where p.id=target_fleet_partner_id
   and p.verification_status='approved' and p.operational_status='active') then
  raise exception using errcode='55000',message='An approved active fleet partner is required';
 end if;
 if target_vehicle_type_id is null or registration='' or length(registration)>32
  or nullif(btrim(target_manufacturer),'') is null or nullif(btrim(target_model),'') is null
  or target_ownership_relationship not in('fleet_owned','leased','rented','third_party_authorized')
  or coalesce(cardinality(target_service_keys),0)=0
  or exists(select 1 from unnest(target_service_keys) s where s not in('lpg','fuel'))
  or nullif(btrim(target_idempotency_key),'') is null
  or jsonb_typeof(coalesce(target_metadata,'{}'))<>'object' then
  raise exception using errcode='22023',message='Valid vehicle details, LPG/Fuel service lines, ownership and idempotency key are required';
 end if;
 if target_model_year is not null and target_model_year not between 1900 and 2100 then
  raise exception using errcode='22023',message='Vehicle model year is invalid';
 end if;
 if target_max_load_kg is not null and target_max_load_kg<0 then
  raise exception using errcode='22023',message='Vehicle load capacity cannot be negative';
 end if;
 if not exists(select 1 from public.vehicle_types where id=target_vehicle_type_id and status='active') then
  raise exception using errcode='22023',message='Choose an active vehicle type';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('fleet-vehicle:'||target_fleet_partner_id::text||':'||target_idempotency_key,0));
 select vehicle_id into existing_id from public.fleet_vehicle_registrations
  where fleet_partner_id=target_fleet_partner_id and idempotency_key=target_idempotency_key;
 if existing_id is not null then return existing_id; end if;
 if exists(select 1 from public.vehicles where lower(btrim(registration_number))=lower(registration)) then
  raise exception using errcode='23505',message='A vehicle with this registration number already exists';
 end if;
 insert into public.vehicles(
  fleet_partner_id,vehicle_type_id,status,ownership_type,ownership_relationship,manufacturer,model,
  model_year,registration_number,color,fuel_type,max_load_kg,capacity_profile,metadata,created_by,platform_owned
 ) values(
  target_fleet_partner_id,target_vehicle_type_id,'pending',
  case target_ownership_relationship when 'fleet_owned' then 'fleet_assigned' else target_ownership_relationship end,
  target_ownership_relationship,btrim(target_manufacturer),btrim(target_model),target_model_year,registration,
  nullif(btrim(coalesce(target_color,'')),''),nullif(btrim(coalesce(target_fuel_type,'')),''),target_max_load_kg,
  jsonb_build_object('serviceKeys',to_jsonb(target_service_keys)),
  coalesce(target_metadata,'{}')||jsonb_build_object('source','fleet_partner_portal','fleetPartnerId',target_fleet_partner_id,
   'requestedServiceKeys',to_jsonb(target_service_keys)),auth.uid(),false
 ) returning id into saved_id;
 insert into public.fleet_vehicle_registrations(fleet_partner_id,vehicle_id,idempotency_key,created_by)
  values(target_fleet_partner_id,saved_id,target_idempotency_key,auth.uid());
 foreach service_key in array target_service_keys loop
  insert into public.fleet_vehicle_service_lines(fleet_partner_id,vehicle_id,service_key,created_by)
   values(target_fleet_partner_id,saved_id,service_key,auth.uid()) on conflict(vehicle_id,service_key) do nothing;
 end loop;
 return saved_id;
end $$;

create or replace function public.invite_fleet_staff(
 target_fleet_partner_id uuid,target_invited_email text,target_access_role text,
 target_reason text,target_idempotency_key text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare invitation_id uuid; resolved_user_id uuid; email_value text:=lower(btrim(coalesce(target_invited_email,'')));
begin
 if not public.is_fleet_staff(target_fleet_partner_id,array['owner_admin']) then
  raise exception using errcode='42501',message='Only the fleet owner can invite fleet staff';
 end if;
 if email_value !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  or target_access_role not in('fleet_manager','vehicle_manager','compliance_viewer','driver_operator')
  or length(btrim(coalesce(target_reason,'')))<5 or nullif(btrim(target_idempotency_key),'') is null then
  raise exception using errcode='22023',message='A valid email, staff role, reason and idempotency key are required';
 end if;
 select id into resolved_user_id from auth.users where lower(email)=email_value limit 1;
 if resolved_user_id=auth.uid() then raise exception using errcode='22023',message='You cannot invite yourself'; end if;
 insert into public.fleet_staff_invitations(
  fleet_partner_id,invited_email,invited_user_id,access_role,status,reason,invited_by,expires_at,idempotency_key
 ) values(
  target_fleet_partner_id,email_value,resolved_user_id,target_access_role,'pending',btrim(target_reason),
  auth.uid(),timezone('utc',now())+interval '7 days',target_idempotency_key
 ) on conflict(fleet_partner_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key
 returning id into invitation_id;
 return invitation_id;
end $$;

create or replace function public.accept_fleet_staff_invitation(target_invitation_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare invitation public.fleet_staff_invitations%rowtype; user_email text; membership_id uuid;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Authentication is required'; end if;
 user_email:=lower(coalesce(auth.jwt()->>'email',''));
 select * into invitation from public.fleet_staff_invitations where id=target_invitation_id for update;
 if not found or invitation.status<>'pending' or invitation.expires_at<=timezone('utc',now())
  or invitation.invited_email<>user_email
  or (invitation.invited_user_id is not null and invitation.invited_user_id<>auth.uid()) then
  raise exception using errcode='42501',message='This fleet invitation is not valid for the signed-in account';
 end if;
 if invitation.access_role='driver_operator' and not exists(
  select 1 from public.driver_profiles d where d.user_id=auth.uid() and d.verification_status='approved'
    and d.operational_status not in('suspended','inactive','archived')
 ) then raise exception using errcode='55000',message='Driver access requires an approved active SKIMA Driver profile'; end if;
 insert into public.fleet_authorized_staff(
  fleet_partner_id,user_id,access_role,status,reason,authorized_by,idempotency_key
 ) values(invitation.fleet_partner_id,auth.uid(),invitation.access_role,'active',invitation.reason,
   invitation.invited_by,'fleet-invitation:'||invitation.id::text)
 on conflict do nothing returning id into membership_id;
 update public.fleet_staff_invitations set status='accepted',invited_user_id=auth.uid(),
  accepted_at=timezone('utc',now()),updated_at=timezone('utc',now()) where id=invitation.id;
 return coalesce(membership_id,invitation.id);
end $$;

-- Existing Admin assignments still work. Fleet owners can assign only approved
-- drivers they have invited and only vehicles belonging to their own fleet.
create or replace function public.assign_driver_vehicle(
 target_driver_profile_id uuid,target_vehicle_id uuid,target_relationship text,
 target_starts_at timestamptz default timezone('utc',now()),target_metadata jsonb default '{}'
) returns public.driver_vehicle_links language plpgsql security definer set search_path=public,pg_temp as $$
declare result public.driver_vehicle_links; start_time timestamptz:=coalesce(target_starts_at,timezone('utc',now()));
  fleet_id uuid; driver_user_id uuid; platform_manager boolean;
begin
 platform_manager:=public.has_permission('platform.fleets.manage',null) or public.has_permission('platform.vehicles.manage',null);
 select fleet_partner_id into fleet_id from public.vehicles where id=target_vehicle_id;
 if not platform_manager and (fleet_id is null or not public.is_fleet_staff(fleet_id,array['owner_admin','fleet_manager','vehicle_manager'])) then
  raise exception using errcode='42501',message='Vehicle assignment permission is required';
 end if;
 if target_relationship not in('driver_owned','business_owned','fleet_owned','leased','rented','third_party_authorized')
   or target_driver_profile_id is null or target_vehicle_id is null then
  raise exception using errcode='22023',message='A valid driver, vehicle and ownership relationship are required';
 end if;
 if not exists(select 1 from public.driver_profiles where id=target_driver_profile_id and verification_status='approved') then
  raise exception using errcode='55000',message='Driver must be approved';
 end if;
 select user_id into driver_user_id from public.driver_profiles where id=target_driver_profile_id;
 if not platform_manager and not exists(
  select 1 from public.fleet_authorized_staff staff where staff.fleet_partner_id=fleet_id
   and staff.user_id=driver_user_id and staff.access_role='driver_operator' and staff.status='active'
   and staff.starts_at<=timezone('utc',now()) and (staff.ends_at is null or staff.ends_at>timezone('utc',now()))
 ) then raise exception using errcode='42501',message='Only a driver invited to this fleet can receive its vehicle'; end if;
 if not exists(select 1 from public.vehicles where id=target_vehicle_id and status='active') then
  raise exception using errcode='55000',message='Vehicle must be approved and active before assignment';
 end if;
 if fleet_id is not null and target_relationship not in('fleet_owned','leased','rented','third_party_authorized') then
  raise exception using errcode='23514',message='Fleet partner vehicles require an accurate ownership relationship';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(target_driver_profile_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended(target_vehicle_id::text,0));
 update public.driver_vehicle_links set status='revoked',
  ends_at=greatest(start_time,starts_at+interval '1 millisecond'),
  metadata=metadata||jsonb_build_object('reassignedBy',auth.uid()),updated_at=timezone('utc',now())
 where status='active' and ends_at is null and (driver_profile_id=target_driver_profile_id or vehicle_id=target_vehicle_id);
 insert into public.driver_vehicle_links(
  driver_profile_id,vehicle_id,relationship_type,status,authorized_by,starts_at,metadata,created_by
 ) values(target_driver_profile_id,target_vehicle_id,target_relationship,'active',auth.uid(),start_time,
  coalesce(target_metadata,'{}'),auth.uid()) returning * into result;
 return result;
end $$;

create or replace function public.read_my_fleet_workspace()
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
select jsonb_build_object(
 'applications',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc)
   from public.fleet_partner_applications a where a.applicant_user_id=auth.uid()),'[]'::jsonb),
 'partners',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc)
   from public.fleet_partners p where public.is_fleet_staff(p.id,null)),'[]'::jsonb),
 'vehicles',coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc)
   from public.vehicles v where v.fleet_partner_id in
    (select p.id from public.fleet_partners p where public.is_fleet_staff(p.id,null))),'[]'::jsonb),
 'assignments',coalesce((select jsonb_agg(to_jsonb(l) order by l.starts_at desc)
   from public.driver_vehicle_links l join public.vehicles v on v.id=l.vehicle_id
   where v.fleet_partner_id in (select p.id from public.fleet_partners p where public.is_fleet_staff(p.id,null))),'[]'::jsonb),
 'staff',coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at)
   from public.fleet_authorized_staff s where public.is_fleet_staff(s.fleet_partner_id,array['owner_admin','fleet_manager','vehicle_manager'])),'[]'::jsonb),
 'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'fleetPartnerId',i.fleet_partner_id,
   'accessRole',i.access_role,'status',i.status,'expiresAt',i.expires_at,'invitedEmail',i.invited_email,'reason',i.reason)
   order by i.created_at desc) from public.fleet_staff_invitations i
   where (lower(i.invited_email)=lower(coalesce(auth.jwt()->>'email',''))
     or public.is_fleet_staff(i.fleet_partner_id,array['owner_admin','fleet_manager']))
   and i.status='pending' and i.expires_at>timezone('utc',now())),'[]'::jsonb),
 'serviceLines',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc)
   from public.fleet_vehicle_service_lines l
   where public.is_fleet_staff(l.fleet_partner_id,null)),'[]'::jsonb),
 'applicationDocuments',coalesce((select jsonb_agg(jsonb_build_object(
   'id',link.id,'fleetApplicationId',link.fleet_application_id,'requirementKey',link.requirement_key,
   'documentSubmissionId',link.document_submission_id,'status',doc.status,'decisionReason',doc.decision_reason,
   'createdAt',link.linked_at) order by link.linked_at desc)
   from public.fleet_application_documents link join public.document_submissions doc on doc.id=link.document_submission_id
   join public.fleet_partner_applications app on app.id=link.fleet_application_id
   where app.applicant_user_id=auth.uid()),'[]'::jsonb),
 'documentRequirements',coalesce((select jsonb_agg(to_jsonb(r) order by r.display_name)
   from public.fleet_application_document_requirements r
   where r.status='active' and exists(select 1 from public.fleet_partner_applications a
    where a.applicant_user_id=auth.uid() and a.partner_kind=any(r.partner_kinds)
      and a.status in('submitted','correction_required','resubmitted'))),'[]'::jsonb),
 'drivers',coalesce((select jsonb_agg(jsonb_build_object('driverProfileId',d.id,'userId',d.user_id,
   'displayName',profile.display_name,'verificationStatus',d.verification_status,'operationalStatus',d.operational_status,
   'fleetPartnerId',s.fleet_partner_id) order by profile.display_name)
   from public.fleet_authorized_staff s join public.driver_profiles d on d.user_id=s.user_id
   join public.profiles profile on profile.id=d.user_id
   where s.access_role='driver_operator' and s.status='active'
   and public.is_fleet_staff(s.fleet_partner_id,array['owner_admin','fleet_manager','vehicle_manager'])),'[]'::jsonb)
)
$$;

-- Dedicated evidence registration. Generic document submissions require application_records;
-- fleet partners use fleet_partner_applications, so these must be linked explicitly.
create or replace function public.register_fleet_application_document_submission(
 target_application_id uuid,target_requirement_key text,target_storage_bucket text,
 target_storage_path text,target_content_type text,target_byte_size bigint,
 target_source text,target_idempotency_key text,target_metadata jsonb default '{}'
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare app public.fleet_partner_applications%rowtype; fleet_req public.fleet_application_document_requirements%rowtype;
  generic_req public.document_requirements%rowtype; media_id uuid; submission_id uuid; owner_prefix text;
begin
 select * into app from public.fleet_partner_applications where id=target_application_id for update;
 if not found then raise exception using errcode='P0002',message='Fleet application was not found'; end if;
 if app.applicant_user_id<>auth.uid() and not public.has_permission('platform.fleets.review',null) then
  raise exception using errcode='42501',message='Fleet application document access is required'; end if;
 if app.status not in('submitted','correction_required','resubmitted') then
  raise exception using errcode='55000',message='Fleet application is not accepting documents'; end if;
 select * into fleet_req from public.fleet_application_document_requirements r
 where r.key=target_requirement_key and r.status='active' and app.partner_kind=any(r.partner_kinds);
 if not found then raise exception using errcode='22023',message='Document does not apply to this fleet partner type'; end if;
 select req.* into generic_req from public.document_requirements req
 join public.document_requirement_sets set_row on set_row.id=req.requirement_set_id
 where set_row.key='documents.fleet.partner.phase-one' and req.key=target_requirement_key and req.status='active';
 if not found then raise exception using errcode='55000',message='Fleet document requirement configuration is missing'; end if;
 if target_storage_bucket not in('skima-platform-documents','skima-platform-media')
  or target_storage_path is null or target_storage_path like '%..%'
  or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$'
  or nullif(btrim(target_idempotency_key),'') is null or jsonb_typeof(coalesce(target_metadata,'{}'))<>'object'
  or target_byte_size is null or target_byte_size<=0 or target_byte_size>10485760
  or target_content_type not in('application/pdf','image/jpeg','image/png','image/webp') then
  raise exception using errcode='22023',message='Fleet documents must be PDF or supported images up to 10 MB'; end if;
 owner_prefix:=app.applicant_user_id::text||'/';
 if left(target_storage_path,length(owner_prefix))<>owner_prefix then
  raise exception using errcode='42501',message='Fleet document storage must be scoped to the applicant'; end if;
 select id into submission_id from public.document_submissions
 where source=target_source and idempotency_key=target_idempotency_key;
 if submission_id is not null then return submission_id; end if;
 insert into public.media_assets(
  organization_id,owner_user_id,storage_bucket,storage_path,content_type,byte_size,status,
  privacy_classification,asset_type_key,metadata,source,idempotency_key,created_by
 ) values (
  null,app.applicant_user_id,target_storage_bucket,target_storage_path,target_content_type,target_byte_size,
  'active','PRIVATE_VERIFICATION','media.application-document',
  coalesce(target_metadata,'{}')||jsonb_build_object('fleet_application_id',app.id,'requirement_key',target_requirement_key),
  target_source,target_idempotency_key||':asset',auth.uid()
 ) on conflict(storage_bucket,storage_path) do update set content_type=excluded.content_type,
  byte_size=excluded.byte_size,status='active',metadata=public.media_assets.metadata||excluded.metadata,
  updated_at=timezone('utc',now()) returning id into media_id;
 insert into public.document_submissions(
  requirement_id,application_id,subject_type,subject_id,owner_user_id,organization_id,media_asset_id,
  status,storage_bucket,storage_path,content_type,byte_size,source,idempotency_key,metadata,created_by
 ) values (
  generic_req.id,null,'fleet_application',app.id,app.applicant_user_id,null,media_id,'uploaded',
  target_storage_bucket,target_storage_path,target_content_type,target_byte_size,target_source,target_idempotency_key,
  coalesce(target_metadata,'{}')||jsonb_build_object('fleetApplicationId',app.id,'requirementKey',target_requirement_key,
   'privacy_classification','PRIVATE_VERIFICATION'),auth.uid()
 ) returning id into submission_id;
 insert into public.fleet_application_documents(fleet_application_id,requirement_key,document_submission_id,metadata)
 values(app.id,target_requirement_key,submission_id,jsonb_build_object('source','fleet_partner_portal','idempotencyKey',target_idempotency_key))
 on conflict(fleet_application_id,document_submission_id) do nothing;
 return submission_id;
end $$;

create or replace function public.review_fleet_application_document_submission(
 target_document_submission_id uuid,target_decision text,target_reason text,target_idempotency_key text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare document_row public.document_submissions%rowtype;
begin
 if not public.has_permission('platform.fleets.review',null) then
  raise exception using errcode='42501',message='Fleet document review permission is required'; end if;
 if target_decision not in('approved','rejected','correction_required')
  or length(btrim(coalesce(target_reason,'')))<5 or nullif(btrim(target_idempotency_key),'') is null then
  raise exception using errcode='22023',message='A review decision, reason and idempotency key are required'; end if;
 select doc.* into document_row from public.document_submissions doc
 join public.fleet_application_documents link on link.document_submission_id=doc.id
 where doc.id=target_document_submission_id for update of doc;
 if not found then raise exception using errcode='P0002',message='Fleet document was not found'; end if;
 if document_row.owner_user_id=auth.uid() then raise exception using errcode='42501',message='A reviewer cannot approve their own document'; end if;
 update public.document_submissions set status=target_decision,decision_reason=btrim(target_reason),
  reviewer_user_id=auth.uid(),reviewed_at=timezone('utc',now()),updated_at=timezone('utc',now())
 where id=target_document_submission_id;
 update public.fleet_application_documents set metadata=metadata||jsonb_build_object(
  'reviewDecision',target_decision,'reviewReason',btrim(target_reason),'reviewedBy',auth.uid(),
  'reviewedAt',timezone('utc',now()),'reviewIdempotencyKey',target_idempotency_key
 ) where document_submission_id=target_document_submission_id;
 return target_document_submission_id;
end $$;

create or replace function public.review_fleet_vehicle_service_line(
 target_service_line_id uuid,target_decision text,target_reason text,target_idempotency_key text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare line public.fleet_vehicle_service_lines%rowtype;
begin
 if not public.has_permission('platform.fleets.review',null) and not public.has_permission('platform.vehicles.manage',null) then
  raise exception using errcode='42501',message='Fleet vehicle review permission is required'; end if;
 if target_decision not in('approved','rejected','suspended')
  or length(btrim(coalesce(target_reason,'')))<5 or nullif(btrim(target_idempotency_key),'') is null then
  raise exception using errcode='22023',message='A decision, reason and idempotency key are required'; end if;
 select * into line from public.fleet_vehicle_service_lines where id=target_service_line_id for update;
 if not found then raise exception using errcode='P0002',message='Fleet service line was not found'; end if;
 if target_decision='approved' then
  if not exists(select 1 from public.vehicles where id=line.vehicle_id and status='active') then
   raise exception using errcode='55000',message='Vehicle must be approved before enabling a service line'; end if;
  if not exists(select 1 from public.subject_compliance_status c
   where c.subject_type='vehicle' and c.subject_id=line.vehicle_id and c.compliant=true) then
   raise exception using errcode='55000',message='Vehicle compliance must be complete before enabling a service line'; end if;
 end if;
 update public.fleet_vehicle_service_lines set status=target_decision,decision_reason=btrim(target_reason),
  reviewed_by=auth.uid(),reviewed_at=timezone('utc',now()),updated_at=timezone('utc',now()) where id=target_service_line_id;
 return target_service_line_id;
end $$;

-- Fuel Affiliate uses the same reviewed affiliate identity and commission wallet as LPG,
-- but has its own policy, station attribution, and earnings linked to completed Fuel orders.
insert into public.financial_policy_definitions(
 key,display_name,policy_family,value_schema,approval_required,allow_partner_delegation,status,metadata
) values(
 'commission.fuel.station_affiliate','Fuel Station Affiliate Commission','affiliate',
 jsonb_build_object('program_enabled',jsonb_build_object('type','boolean'),
  'commission_percent',jsonb_build_object('type','number','minimum',0,'maximum',100),
  'earning_period_months',jsonb_build_object('type','integer','minimum',1,'maximum',36),
  'eligible_revenue_streams',jsonb_build_object('type','array','items',jsonb_build_object('enum',jsonb_build_array('platform_fee')))),
 true,false,'active',jsonb_build_object('module','fuel','programme','station_affiliate')
) on conflict(key) do nothing;

create or replace function public.validate_fuel_station_affiliate_policy_version()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare policy_key text; config jsonb; streams text[];
begin
 select key into policy_key from public.financial_policy_definitions where id=new.policy_definition_id;
 if policy_key is distinct from 'commission.fuel.station_affiliate' then return new; end if;
 config:=new.configuration;
 if new.currency_code<>'NGN' or new.service_key is distinct from 'fuel.station.affiliate'
  or new.geography_type<>'country' or new.geography_key is distinct from 'NG'
  or new.module_id is distinct from (select id from public.business_modules where key='fuel') then
  raise exception using errcode='22023',message='Fuel affiliate policy must be scoped to Fuel / Nigeria / NGN'; end if;
 if jsonb_typeof(config->'program_enabled') is distinct from 'boolean'
  or jsonb_typeof(config->'commission_percent') is distinct from 'number'
  or jsonb_typeof(config->'earning_period_months') is distinct from 'number'
  or jsonb_typeof(config->'eligible_revenue_streams') is distinct from 'array' then
  raise exception using errcode='22023',message='Fuel affiliate policy requires enabled, rate, duration and revenue stream'; end if;
 if (config->>'commission_percent')::numeric<0 or (config->>'commission_percent')::numeric>100
  or ((config->>'program_enabled')::boolean and (config->>'commission_percent')::numeric<=0) then
  raise exception using errcode='22023',message='Commission must be 0-100%, and positive while enabled'; end if;
 if (config->>'earning_period_months')::numeric<>trunc((config->>'earning_period_months')::numeric)
  or (config->>'earning_period_months')::integer not between 1 and 36 then
  raise exception using errcode='22023',message='Earning window must be 1-36 whole months'; end if;
 select array_agg(value) into streams from jsonb_array_elements_text(config->'eligible_revenue_streams') s(value);
 if streams is null or cardinality(streams)=0 or exists(select 1 from unnest(streams) s where s<>'platform_fee') then
  raise exception using errcode='22023',message='Fuel affiliate commissions may use only the posted Fuel platform fee'; end if;
 return new;
end $$;
drop trigger if exists trg_validate_fuel_station_affiliate_policy_version on public.financial_policy_versions;
create trigger trg_validate_fuel_station_affiliate_policy_version
before insert or update on public.financial_policy_versions
for each row execute function public.validate_fuel_station_affiliate_policy_version();

create table if not exists public.fuel_station_affiliate_referrals (
 id uuid primary key default gen_random_uuid(),
 affiliate_id uuid not null references public.lpg_station_affiliates(id) on delete restrict,
 organization_id uuid not null references public.organizations(id) on delete restrict,
 branch_id uuid not null unique references public.organization_branches(id) on delete restrict,
 applicant_user_id uuid references public.profiles(id) on delete set null,
 referral_code_snapshot text not null,
 status text not null default 'submitted' check(status in('submitted','activated','rejected','expired')),
 submitted_at timestamptz not null default timezone('utc',now()), activated_at timestamptz,
 metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
 check((status='activated' and activated_at is not null) or status<>'activated')
);
create index if not exists fuel_station_affiliate_referrals_affiliate_idx
 on public.fuel_station_affiliate_referrals(affiliate_id,status,submitted_at desc);

create table if not exists public.fuel_station_affiliate_earnings (
 id uuid primary key default gen_random_uuid(),
 affiliate_id uuid not null references public.lpg_station_affiliates(id) on delete restrict,
 referral_id uuid not null references public.fuel_station_affiliate_referrals(id) on delete restrict,
 organization_id uuid not null references public.organizations(id) on delete restrict,
 branch_id uuid not null references public.organization_branches(id) on delete restrict,
 fuel_order_id uuid not null unique references public.order_records(id) on delete restrict,
 settlement_transaction_id uuid not null references public.financial_transactions(id) on delete restrict,
 financial_transaction_id uuid references public.financial_transactions(id) on delete restrict,
 commission_wallet_id uuid not null references public.wallet_accounts(id) on delete restrict,
 currency_code text not null references public.currency_definitions(code) on delete restrict,
 revenue_base_amount numeric(28,8) not null check(revenue_base_amount>=0),
 commission_percent numeric(8,4) not null check(commission_percent>0 and commission_percent<=100),
 amount numeric(28,8) not null check(amount>0),
 policy_version_id uuid not null references public.financial_policy_versions(id) on delete restrict,
 earning_period_start timestamptz not null, earning_period_end timestamptz not null,
 status text not null default 'posted' check(status in('posted','reversed')),
 reversal_transaction_id uuid references public.financial_transactions(id) on delete set null,
 reversed_at timestamptz, reversal_reason text, metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default timezone('utc',now()), updated_at timestamptz not null default timezone('utc',now()),
 check(earning_period_end>earning_period_start)
);
create table if not exists public.fuel_station_affiliate_commission_failures (
 id uuid primary key default gen_random_uuid(), fuel_order_id uuid not null unique references public.order_records(id) on delete restrict,
 settlement_transaction_id uuid not null references public.financial_transactions(id) on delete restrict,
 last_error text not null, attempt_count integer not null default 1,
 status text not null default 'pending' check(status in('pending','resolved','cancelled')),
 first_attempt_at timestamptz not null default timezone('utc',now()),
 last_attempt_at timestamptz not null default timezone('utc',now()),
 resolved_at timestamptz, resolved_by uuid references public.profiles(id) on delete set null,
 metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.fuel_station_affiliate_reversal_failures (
 id uuid primary key default gen_random_uuid(),
 earning_id uuid not null unique references public.fuel_station_affiliate_earnings(id) on delete restrict,
 required_amount numeric(28,8) not null check(required_amount>0),
 available_amount numeric(28,8) not null default 0 check(available_amount>=0),
 last_error text not null,
 attempt_count integer not null default 1,
 status text not null default 'pending' check(status in('pending','resolved','cancelled')),
 last_attempt_at timestamptz not null default timezone('utc',now()),
 resolved_at timestamptz,
 resolved_by uuid references public.profiles(id) on delete set null,
 metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object')
);

create or replace function public.ensure_fuel_station_affiliate_referral(target_branch_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare branch_row public.organization_branches%rowtype;
  application_row public.application_records%rowtype;
  version_payload jsonb; affiliate public.lpg_station_affiliates%rowtype;
  code text; referral_id uuid; source_application_text text;
begin
  select * into branch_row from public.organization_branches where id=target_branch_id;
  if not found or branch_row.status<>'active' then return null; end if;
  if not exists(select 1 from public.fuel_branch_product_offers offer
    where offer.branch_id=target_branch_id and offer.status='active') then return null; end if;

  code:=upper(btrim(coalesce(
    branch_row.metadata->>'stationAffiliateReferralCode',
    branch_row.metadata->>'station_affiliate_referral_code',
    branch_row.metadata->>'affiliateReferralCode',''
  )));
  source_application_text:=branch_row.metadata->>'source_application_id';
  if code='' and coalesce(source_application_text,'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select * into application_row from public.application_records
    where id=source_application_text::uuid;
    if found then
      select version.payload into version_payload from public.application_versions version
      where version.application_id=application_row.id and version.version=application_row.active_version;
      code:=upper(btrim(coalesce(version_payload->'station'->>'affiliateReferralCode',
        version_payload->'station'->>'affiliate_referral_code','')));
    end if;
  end if;
  if code='' then return null; end if;

  select * into affiliate from public.lpg_station_affiliates
  where referral_code=code and status='active';
  if not found then return null; end if;
  if affiliate.affiliate_user_id=coalesce(application_row.applicant_user_id,branch_row.created_by)
    or exists(select 1 from public.organization_memberships membership
      where membership.organization_id=branch_row.organization_id
        and membership.user_id=affiliate.affiliate_user_id and membership.status='active') then
    return null;
  end if;

  insert into public.fuel_station_affiliate_referrals(
    affiliate_id,organization_id,branch_id,applicant_user_id,referral_code_snapshot,status,activated_at,metadata
  ) values(
    affiliate.id,branch_row.organization_id,branch_row.id,
    coalesce(application_row.applicant_user_id,branch_row.created_by),affiliate.referral_code,
    'activated',timezone('utc',now()),
    jsonb_build_object('source','fuel_branch_first_active_offer','sourceApplicationId',application_row.id,
      'activatedAt',timezone('utc',now()))
  ) on conflict(branch_id) do update
    set affiliate_id=public.fuel_station_affiliate_referrals.affiliate_id
  returning id into referral_id;
  if referral_id is null then
    select id into referral_id from public.fuel_station_affiliate_referrals where branch_id=target_branch_id;
  end if;
  return referral_id;
end $$;

create or replace function public.activate_fuel_station_affiliate_referral_for_branch()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if new.status='active' then
    perform public.ensure_fuel_station_affiliate_referral(new.id);
  end if;
  return new;
end $$;

create or replace function public.activate_fuel_station_affiliate_referral_for_offer()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if new.status='active' then
    perform public.ensure_fuel_station_affiliate_referral(new.branch_id);
  end if;
  return new;
end $$;

drop trigger if exists trg_capture_fuel_station_affiliate_referral on public.organization_branches;
drop trigger if exists trg_activate_fuel_station_affiliate_referral_branch on public.organization_branches;
create trigger trg_activate_fuel_station_affiliate_referral_branch
after insert or update of status on public.organization_branches
for each row execute function public.activate_fuel_station_affiliate_referral_for_branch();
drop trigger if exists trg_activate_fuel_station_affiliate_referral_offer on public.fuel_branch_product_offers;
create trigger trg_activate_fuel_station_affiliate_referral_offer
after insert or update of status on public.fuel_branch_product_offers
for each row execute function public.activate_fuel_station_affiliate_referral_for_offer();

create or replace function public.award_fuel_station_affiliate_commission(target_fuel_order_id uuid,target_settlement_transaction_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare order_row public.order_records%rowtype; operation_row public.fuel_order_operations%rowtype;
 quote_row public.fuel_order_commercial_snapshots%rowtype; referral public.fuel_station_affiliate_referrals%rowtype;
 affiliate public.lpg_station_affiliates%rowtype; policy jsonb; config jsonb; rate numeric; months integer;
 fee_amount numeric(28,8); commission_amount numeric(28,8); revenue_wallet_id uuid;
 commission_wallet_id uuid; earning_id uuid; posting_id uuid; start_at timestamptz; end_at timestamptz;
begin
 select * into order_row from public.order_records where id=target_fuel_order_id for update;
 if not found or order_row.status<>'completed' or order_row.currency_code<>'NGN'
  or not exists(select 1 from public.business_modules module where module.id=order_row.module_id and module.key='fuel') then return null; end if;
 select * into operation_row from public.fuel_order_operations where order_id=target_fuel_order_id for update;
 if not found or operation_row.stage_key<>'completed' or operation_row.settlement_transaction_id is distinct from target_settlement_transaction_id then return null; end if;
 select * into quote_row from public.fuel_order_commercial_snapshots where order_id=target_fuel_order_id and status='settled'
 order by created_at desc limit 1;
 if not found or quote_row.platform_fee_amount<=0 then return null; end if;
 select * into referral from public.fuel_station_affiliate_referrals
  where branch_id=operation_row.station_branch_id and status='activated';
 if not found or referral.activated_at is null or order_row.created_at<referral.activated_at then return null; end if;
 select * into affiliate from public.lpg_station_affiliates where id=referral.affiliate_id and status='active';
 if not found then return null; end if;
 if not exists(select 1 from public.financial_policy_definitions d join public.financial_policy_versions v
  on v.policy_definition_id=d.id where d.key='commission.fuel.station_affiliate' and d.status='active'
  and v.lifecycle_status in('active','scheduled') and v.currency_code='NGN'
  and v.module_id=(select id from public.business_modules where key='fuel')
  and v.service_key='fuel.station.affiliate' and v.geography_type='country' and v.geography_key='NG'
  and v.effective_from<=timezone('utc',now()) and (v.effective_until is null or v.effective_until>timezone('utc',now()))) then
  return null;
 end if;
 policy:=public.resolve_financial_policy('commission.fuel.station_affiliate','NGN',timezone('utc',now()),
  'fuel',null,'fuel.station.affiliate','country','NG');
 config:=policy->'configuration';
 if not coalesce((config->>'program_enabled')::boolean,false)
  or not (coalesce(config->'eligible_revenue_streams','[]'::jsonb) ? 'platform_fee') then return null; end if;
 rate:=nullif(config->>'commission_percent','')::numeric;
 months:=nullif(config->>'earning_period_months','')::integer;
 if rate is null or rate<=0 or rate>100 or months is null or months not between 1 and 36 then
  raise exception using errcode='55000',message='Active Fuel Station Affiliate policy is invalid'; end if;
 start_at:=referral.activated_at; end_at:=start_at+make_interval(months=>months);
 if order_row.created_at>=end_at then return null; end if;
 fee_amount:=quote_row.platform_fee_amount;
 select ledger.wallet_id into revenue_wallet_id from public.wallet_ledger_entries ledger
 join public.wallet_accounts wallet on wallet.id=ledger.wallet_id
 join public.financial_transactions tx on tx.id=ledger.transaction_id
 where ledger.transaction_id=target_settlement_transaction_id and tx.status='posted'
  and ledger.direction='credit' and wallet.wallet_type='platform_revenue'
  and wallet.owner_entity_type='platform' and wallet.currency_code='NGN'
 order by ledger.created_at limit 1;
 if revenue_wallet_id is null then raise exception using errcode='55000',message='Fuel settlement has not credited the SKIMA revenue wallet'; end if;
 commission_amount:=round(fee_amount*rate/100,2);
 if commission_amount<=0 then return null; end if;
 commission_wallet_id:=affiliate.commission_wallet_id;
 if commission_wallet_id is null then
  commission_wallet_id:=public.ensure_wallet_account('commission','user',affiliate.affiliate_user_id,'NGN',
   'station.affiliate.wallet',jsonb_build_object('module','fuel','purpose','station_affiliate_commission'),
   'station-affiliate-wallet:'||affiliate.affiliate_user_id::text||':NGN');
  update public.lpg_station_affiliates set commission_wallet_id=commission_wallet_id,updated_at=timezone('utc',now())
   where id=affiliate.id;
 end if;
 insert into public.fuel_station_affiliate_earnings(
  affiliate_id,referral_id,organization_id,branch_id,fuel_order_id,settlement_transaction_id,
  commission_wallet_id,currency_code,revenue_base_amount,commission_percent,amount,
  policy_version_id,earning_period_start,earning_period_end,status,metadata
 ) values(affiliate.id,referral.id,referral.organization_id,operation_row.station_branch_id,target_fuel_order_id,
  target_settlement_transaction_id,commission_wallet_id,'NGN',fee_amount,rate,commission_amount,
  (policy->>'policyVersionId')::uuid,start_at,end_at,'posted',
  jsonb_build_object('moduleKey','fuel','revenueStream','platform_fee','productKey',operation_row.product_key,
   'commercialSnapshotId',quote_row.id,'policyVersion',policy->>'version'))
 on conflict(fuel_order_id) do nothing returning id into earning_id;
 if earning_id is null then select id into earning_id from public.fuel_station_affiliate_earnings where fuel_order_id=target_fuel_order_id; return earning_id; end if;
 perform pg_advisory_xact_lock(hashtextextended(revenue_wallet_id::text,0));
 if coalesce((select balance from public.wallet_balances where wallet_id=revenue_wallet_id),0)<commission_amount then
  raise exception using errcode='55000',message='SKIMA revenue wallet does not have enough available balance for Fuel affiliate commission'; end if;
 posting_id:=public.post_financial_transaction(
  'commission','NGN','fuel.station_affiliate','fuel_station_affiliate_earning',earning_id,
  jsonb_build_array(
   jsonb_build_object('wallet_id',revenue_wallet_id,'direction','debit','amount',commission_amount,'entry_type','commission',
    'metadata',jsonb_build_object('role','skima_revenue','revenue_stream','fuel_platform_fee','fuel_order_id',target_fuel_order_id)),
   jsonb_build_object('wallet_id',commission_wallet_id,'direction','credit','amount',commission_amount,'entry_type','commission',
    'metadata',jsonb_build_object('role','affiliate_commission','affiliate_id',affiliate.id,'referral_id',referral.id,'fuel_order_id',target_fuel_order_id))
  ),
  'fuel-station-affiliate:'||target_fuel_order_id::text,null,order_row.public_reference,policy,
  jsonb_build_object('fuelOrderId',target_fuel_order_id,'affiliateId',affiliate.id,
   'revenueBaseAmount',fee_amount,'commissionPercent',rate,'amount',commission_amount));
 update public.fuel_station_affiliate_earnings set financial_transaction_id=posting_id,updated_at=timezone('utc',now())
  where id=earning_id;
 delete from public.fuel_station_affiliate_commission_failures where fuel_order_id=target_fuel_order_id;
 return earning_id;
end $$;

create or replace function public.capture_fuel_station_affiliate_commission_failure()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare settlement_id uuid;
begin
 if old.metadata->>'fuel_settlement_transaction_id' is not distinct from new.metadata->>'fuel_settlement_transaction_id'
  or nullif(new.metadata->>'fuel_settlement_transaction_id','') is null then return new; end if;
 settlement_id:=(new.metadata->>'fuel_settlement_transaction_id')::uuid;
 begin
  perform public.award_fuel_station_affiliate_commission(new.id,settlement_id);
 exception when others then
  if exists(select 1 from public.fuel_order_operations op join public.fuel_station_affiliate_referrals r
   on r.branch_id=op.station_branch_id where op.order_id=new.id and r.status='activated') then
   insert into public.fuel_station_affiliate_commission_failures(fuel_order_id,settlement_transaction_id,last_error,attempt_count,status)
   values(new.id,settlement_id,left(sqlerrm,2000),1,'pending')
   on conflict(fuel_order_id) do update set settlement_transaction_id=excluded.settlement_transaction_id,
    last_error=excluded.last_error,attempt_count=fuel_station_affiliate_commission_failures.attempt_count+1,
    status='pending',last_attempt_at=timezone('utc',now());
  end if;
 end;
 return new;
end $$;
drop trigger if exists trg_capture_fuel_station_affiliate_commission on public.order_records;
create trigger trg_capture_fuel_station_affiliate_commission after update of metadata on public.order_records
for each row execute function public.capture_fuel_station_affiliate_commission_failure();

create or replace function public.retry_fuel_station_affiliate_commission(target_fuel_order_id uuid,target_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare failure public.fuel_station_affiliate_commission_failures%rowtype; settlement_id uuid; earning_id uuid;
begin
 if auth.role()<>'service_role' and (not public.has_permission('platform.financial.manage',null)
  or not public.has_permission('platform.wallets.manage',null)) then
  raise exception using errcode='42501',message='Financial and wallet permissions are required'; end if;
 if length(btrim(coalesce(target_reason,'')))<5 or length(btrim(target_reason))>500 then
  raise exception using errcode='22023',message='Retry reason must be 5-500 characters'; end if;
 select * into failure from public.fuel_station_affiliate_commission_failures where fuel_order_id=target_fuel_order_id for update;
 if not found then raise exception using errcode='P0002',message='Fuel affiliate commission failure not found'; end if;
 select (metadata->>'fuel_settlement_transaction_id')::uuid into settlement_id
  from public.order_records where id=target_fuel_order_id;
 earning_id:=public.award_fuel_station_affiliate_commission(target_fuel_order_id,settlement_id);
 if earning_id is null then raise exception using errcode='55000',message='Fuel affiliate commission is not eligible for posting'; end if;
 update public.fuel_station_affiliate_commission_failures set status='resolved',
  resolved_at=timezone('utc',now()),resolved_by=auth.uid(),
  metadata=metadata||jsonb_build_object('resolutionReason',btrim(target_reason))
 where fuel_order_id=target_fuel_order_id;
 return jsonb_build_object('status','resolved','earningId',earning_id);
end $$;

create or replace function public.read_my_station_affiliate()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare affiliate public.lpg_station_affiliates%rowtype; wallet_id uuid; balance_amount numeric:=0;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Authentication is required'; end if;
 select * into affiliate from public.lpg_station_affiliates where affiliate_user_id=auth.uid();
 if not found then return jsonb_build_object('status','not_applied','referralCode',null,'commissionWalletId',null,
  'availableBalance',0,'referralCount',0,'activeReferrals',0,'totalEarned',0,'referrals','[]'::jsonb,
  'fuelReferralCount',0,'fuelActiveReferrals',0,'fuelTotalEarned',0,'fuelReferrals','[]'::jsonb,'combinedTotalEarned',0); end if;
 if affiliate.commission_wallet_id is not null then
  select w.id,coalesce(b.balance,0) into wallet_id,balance_amount from public.wallet_accounts w
  left join public.wallet_balances b on b.wallet_id=w.id and b.currency_code=w.currency_code
  where w.id=affiliate.commission_wallet_id and w.owner_entity_type='user' and w.owner_entity_id=auth.uid();
 end if;
 return jsonb_build_object(
  'id',affiliate.id,'status',affiliate.status,'referralCode',affiliate.referral_code,
  'commissionWalletId',wallet_id,'currencyCode','NGN','availableBalance',coalesce(balance_amount,0),
  'reviewReason',affiliate.review_reason,
  'referralCount',(select count(*) from public.lpg_station_referrals r where r.affiliate_id=affiliate.id),
  'activeReferrals',(select count(*) from public.lpg_station_referrals r where r.affiliate_id=affiliate.id and r.status='activated'),
  'totalEarned',coalesce((select sum(e.amount) from public.lpg_station_affiliate_earnings e where e.affiliate_id=affiliate.id and e.status='posted'),0),
  'referrals',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'status',r.status,
    'stationName',coalesce(s.display_name,o.display_name,'LPG station'),
    'earned',coalesce((select sum(e.amount) from public.lpg_station_affiliate_earnings e where e.referral_id=r.id and e.status='posted'),0))
    order by r.submitted_at desc) from public.lpg_station_referrals r
    left join public.lpg_station_branches s on s.id=r.station_branch_id
    left join public.organizations o on o.id=s.organization_id where r.affiliate_id=affiliate.id),'[]'::jsonb),
  'fuelReferralCount',(select count(*) from public.fuel_station_affiliate_referrals r where r.affiliate_id=affiliate.id),
  'fuelActiveReferrals',(select count(*) from public.fuel_station_affiliate_referrals r where r.affiliate_id=affiliate.id and r.status='activated'),
  'fuelTotalEarned',coalesce((select sum(e.amount) from public.fuel_station_affiliate_earnings e where e.affiliate_id=affiliate.id and e.status='posted'),0),
  'fuelReferrals',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'status',r.status,
    'stationName',coalesce(b.display_name,o.display_name,'Fuel station'),
    'earned',coalesce((select sum(e.amount) from public.fuel_station_affiliate_earnings e where e.referral_id=r.id and e.status='posted'),0))
    order by r.submitted_at desc) from public.fuel_station_affiliate_referrals r
    join public.organization_branches b on b.id=r.branch_id
    join public.organizations o on o.id=r.organization_id where r.affiliate_id=affiliate.id),'[]'::jsonb),
  'combinedTotalEarned',
   coalesce((select sum(e.amount) from public.lpg_station_affiliate_earnings e where e.affiliate_id=affiliate.id and e.status='posted'),0)
   +coalesce((select sum(e.amount) from public.fuel_station_affiliate_earnings e where e.affiliate_id=affiliate.id and e.status='posted'),0)
 );
end $$;

create or replace function public.reverse_fuel_station_affiliate_commission(
 target_earning_id uuid,
 target_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $
declare earning public.fuel_station_affiliate_earnings%rowtype;
  affiliate public.lpg_station_affiliates%rowtype;
  commission_wallet public.wallet_accounts%rowtype;
  revenue_wallet public.wallet_accounts%rowtype;
  order_row public.order_records%rowtype;
  balance_amount numeric(28,8):=0;
  posting_id uuid;
  failure_message text;
begin
 if auth.role()<>'service_role' and (
   not public.has_permission('platform.financial.manage',null)
   or not public.has_permission('platform.wallets.manage',null)
 ) then raise exception using errcode='42501',message='Financial and wallet permissions are required'; end if;
 if target_earning_id is null or length(btrim(coalesce(target_reason,'')))<5 or length(btrim(target_reason))>500 then
  raise exception using errcode='22023',message='A Fuel earning and a 5-500 character reversal reason are required'; end if;
 select * into earning from public.fuel_station_affiliate_earnings where id=target_earning_id for update;
 if not found then return jsonb_build_object('status','not_found','earningId',target_earning_id); end if;
 if earning.status='reversed' and earning.reversal_transaction_id is not null then
  return jsonb_build_object('status','reversed','earningId',earning.id,'transactionId',earning.reversal_transaction_id); end if;
 if earning.status<>'posted' or earning.financial_transaction_id is null then
  return jsonb_build_object('status','not_eligible','earningId',earning.id,'earningStatus',earning.status); end if;
 select * into order_row from public.order_records where id=earning.fuel_order_id;
 select * into affiliate from public.lpg_station_affiliates where id=earning.affiliate_id;
 select * into commission_wallet from public.wallet_accounts
  where id=earning.commission_wallet_id and wallet_type='commission'
   and owner_entity_type='user' and owner_entity_id=affiliate.affiliate_user_id
   and currency_code=earning.currency_code and status='active';
 select wallet.* into revenue_wallet
 from public.wallet_ledger_entries ledger join public.wallet_accounts wallet on wallet.id=ledger.wallet_id
 where ledger.transaction_id=earning.settlement_transaction_id and ledger.direction='credit'
  and wallet.wallet_type='platform_revenue' and wallet.owner_entity_type='platform'
  and wallet.currency_code=earning.currency_code
 order by ledger.created_at limit 1;
 if commission_wallet.id is null or revenue_wallet.id is null then
  failure_message:='The affiliate commission wallet or originating Fuel revenue wallet is unavailable.';
  insert into public.fuel_station_affiliate_reversal_failures(
   earning_id,required_amount,available_amount,last_error,metadata
  ) values(earning.id,earning.amount,0,failure_message,jsonb_build_object('reason',btrim(target_reason)))
  on conflict(earning_id) do update set required_amount=excluded.required_amount,available_amount=0,
   last_error=excluded.last_error,attempt_count=public.fuel_station_affiliate_reversal_failures.attempt_count+1,
   status='pending',last_attempt_at=timezone('utc',now()),
   metadata=public.fuel_station_affiliate_reversal_failures.metadata||excluded.metadata;
  return jsonb_build_object('status','pending_recovery','earningId',earning.id,'requiredAmount',earning.amount,'availableAmount',0);
 end if;
 perform pg_advisory_xact_lock(hashtextextended(commission_wallet.id::text,0));
 select coalesce(balance.balance,0)::numeric(28,8) into balance_amount
 from public.wallet_balances balance
 where balance.wallet_id=commission_wallet.id and balance.currency_code=earning.currency_code;
 balance_amount:=coalesce(balance_amount,0);
 if balance_amount<earning.amount then
  failure_message:='Affiliate wallet balance is below the Fuel commission reversal amount; a later retry or manual recovery is required.';
  insert into public.fuel_station_affiliate_reversal_failures(
   earning_id,required_amount,available_amount,last_error,metadata
  ) values(earning.id,earning.amount,balance_amount,failure_message,
   jsonb_build_object('reason',btrim(target_reason),'commissionWalletId',commission_wallet.id,'revenueWalletId',revenue_wallet.id))
  on conflict(earning_id) do update set required_amount=excluded.required_amount,available_amount=excluded.available_amount,
   last_error=excluded.last_error,attempt_count=public.fuel_station_affiliate_reversal_failures.attempt_count+1,
   status='pending',last_attempt_at=timezone('utc',now()),
   metadata=public.fuel_station_affiliate_reversal_failures.metadata||excluded.metadata;
  return jsonb_build_object('status','pending_recovery','earningId',earning.id,'requiredAmount',earning.amount,'availableAmount',balance_amount);
 end if;
 posting_id:=public.post_financial_transaction(
  'refund',earning.currency_code,'fuel.station_affiliate.reversal','fuel_station_affiliate_earning',earning.id,
  jsonb_build_array(
   jsonb_build_object('wallet_id',commission_wallet.id,'direction','debit','amount',earning.amount,'entry_type','commission',
    'metadata',jsonb_build_object('role','affiliate_commission_reversal','affiliate_id',earning.affiliate_id,'referral_id',earning.referral_id,'fuel_order_id',earning.fuel_order_id)),
   jsonb_build_object('wallet_id',revenue_wallet.id,'direction','credit','amount',earning.amount,'entry_type','commission',
    'metadata',jsonb_build_object('role','skima_revenue_recovery','affiliate_id',earning.affiliate_id,'referral_id',earning.referral_id,'fuel_order_id',earning.fuel_order_id))
  ),
  'fuel-station-affiliate-reversal:'||earning.id::text,null,order_row.public_reference,
  jsonb_build_object('policyKey','commission.fuel.station_affiliate','policyVersionId',earning.policy_version_id,'reversal',true),
  jsonb_build_object('earningId',earning.id,'originalCommissionTransactionId',earning.financial_transaction_id,
   'settlementTransactionId',earning.settlement_transaction_id,'fuelOrderId',earning.fuel_order_id,
   'reason',btrim(target_reason),'amount',earning.amount)
 );
 update public.fuel_station_affiliate_earnings set status='reversed',reversal_transaction_id=posting_id,
  reversed_at=timezone('utc',now()),reversal_reason=btrim(target_reason),updated_at=timezone('utc',now())
 where id=earning.id;
 update public.fuel_station_affiliate_reversal_failures set status='resolved',resolved_at=timezone('utc',now()),
  resolved_by=auth.uid(),available_amount=earning.amount,last_error='Reversal posted successfully.'
 where earning_id=earning.id and status='pending';
 return jsonb_build_object('status','reversed','earningId',earning.id,'transactionId',posting_id,'amount',earning.amount);
end $;

create or replace function public.retry_fuel_station_affiliate_reversal(
 target_earning_id uuid,
 target_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $
declare failure public.fuel_station_affiliate_reversal_failures%rowtype; result jsonb;
begin
 if auth.role()<>'service_role' and (
  not public.has_permission('platform.financial.manage',null)
  or not public.has_permission('platform.wallets.manage',null)
 ) then raise exception using errcode='42501',message='Financial and wallet permissions are required'; end if;
 if length(btrim(coalesce(target_reason,'')))<5 or length(btrim(target_reason))>500 then
  raise exception using errcode='22023',message='Retry reason must be 5-500 characters'; end if;
 select * into failure from public.fuel_station_affiliate_reversal_failures where earning_id=target_earning_id for update;
 if not found then raise exception using errcode='P0002',message='Fuel affiliate reversal failure not found'; end if;
 result:=public.reverse_fuel_station_affiliate_commission(target_earning_id,btrim(target_reason));
 return result;
end $;

create or replace function public.read_fuel_station_affiliate_admin_workspace()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not (public.has_permission('platform.financial_policy.read',null)
  or public.has_permission('platform.financial.manage',null)
  or public.has_permission('platform.wallets.manage',null)
  or public.has_permission('platform.fleets.read',null)) then
  raise exception using errcode='42501',message='Fuel affiliate administration permission is required'; end if;
 return jsonb_build_object(
  'policy',jsonb_build_object(
   'policyKey','commission.fuel.station_affiliate',
   'definitionId',(select id from public.financial_policy_definitions where key='commission.fuel.station_affiliate'),
   'latestVersion',(select to_jsonb(v) from public.financial_policy_versions v join public.financial_policy_definitions d on d.id=v.policy_definition_id
    where d.key='commission.fuel.station_affiliate' order by v.version desc limit 1),
   'activeVersion',(select to_jsonb(v) from public.financial_policy_versions v join public.financial_policy_definitions d on d.id=v.policy_definition_id
    where d.key='commission.fuel.station_affiliate' and v.lifecycle_status='active' order by v.version desc limit 1)
  ),
  'affiliates',coalesce((select jsonb_agg(jsonb_build_object(
    'id',a.id,'displayName',p.display_name,'status',a.status,'referralCode',a.referral_code,
    'referralCount',(select count(*) from public.fuel_station_affiliate_referrals r where r.affiliate_id=a.id),
    'activeReferrals',(select count(*) from public.fuel_station_affiliate_referrals r where r.affiliate_id=a.id and r.status='activated'),
    'earned',coalesce((select sum(e.amount) from public.fuel_station_affiliate_earnings e where e.affiliate_id=a.id and e.status='posted'),0)
   ) order by a.created_at desc) from public.lpg_station_affiliates a
    join public.profiles p on p.id=a.affiliate_user_id),'[]'::jsonb),
  'referrals',coalesce((select jsonb_agg(jsonb_build_object(
    'id',r.id,'stationName',b.display_name,'affiliateName',p.display_name,
    'referralCode',r.referral_code_snapshot,'status',r.status,'activatedAt',r.activated_at,
    'earnings',coalesce((select sum(e.amount) from public.fuel_station_affiliate_earnings e
      where e.referral_id=r.id and e.status='posted'),0)
   ) order by r.submitted_at desc) from public.fuel_station_affiliate_referrals r
    join public.lpg_station_affiliates a on a.id=r.affiliate_id
    join public.profiles p on p.id=a.affiliate_user_id
    join public.organization_branches b on b.id=r.branch_id),'[]'::jsonb),
  'earnings',coalesce((select jsonb_agg(jsonb_build_object(
    'id',e.id,'orderId',e.fuel_order_id,'publicReference',o.public_reference,
    'affiliateName',p.display_name,'stationName',b.display_name,'amount',e.amount,'currencyCode',e.currency_code,
    'revenueBaseAmount',e.revenue_base_amount,'commissionPercent',e.commission_percent,
    'status',e.status,'policyVersion',v.version,'reversalTransactionId',e.reversal_transaction_id,
    'createdAt',e.created_at)
   order by e.created_at desc) from public.fuel_station_affiliate_earnings e
    join public.lpg_station_affiliates a on a.id=e.affiliate_id
    join public.profiles p on p.id=a.affiliate_user_id
    join public.organization_branches b on b.id=e.branch_id
    join public.financial_policy_versions v on v.id=e.policy_version_id
    join public.order_records o on o.id=e.fuel_order_id),'[]'::jsonb),
  'commissionFailures',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'orderId',f.fuel_order_id,
    'lastError',f.last_error,'attemptCount',f.attempt_count) order by f.last_attempt_at desc)
    from public.fuel_station_affiliate_commission_failures f where f.status='pending'),'[]'::jsonb),
  'reversalFailures',coalesce((select jsonb_agg(jsonb_build_object(
    'id',failure.id,'earningId',failure.earning_id,'orderId',earning.fuel_order_id,
    'lastError',failure.last_error,'requiredAmount',failure.required_amount,
    'availableAmount',failure.available_amount,'attemptCount',failure.attempt_count)
    order by failure.last_attempt_at desc)
    from public.fuel_station_affiliate_reversal_failures failure
    join public.fuel_station_affiliate_earnings earning on earning.id=failure.earning_id
    where failure.status='pending'),'[]'::jsonb)
 );
end $$;

-- Admin Fleet Partners workspace: expose customer fleet documents, authorised people and per-service readiness.
create or replace function public.read_fleet_admin_workspace(
 target_search text default null,
 target_status text default null
)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $
 select jsonb_build_object(
  'partners',coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at desc)
    from public.fleet_partners f
    where (target_status is null or f.verification_status=target_status)
      and (target_search is null or f.display_name ilike '%'||target_search||'%')),'[]'::jsonb),
  'applications',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc)
    from public.fleet_partner_applications a
    where (target_status is null or a.status=target_status)
      and (target_search is null or a.legal_name ilike '%'||target_search||'%')),'[]'::jsonb),
  'vehicles',coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc)
    from public.vehicles v where v.fleet_partner_id is not null
      and (target_search is null or v.registration_number ilike '%'||target_search||'%'
        or v.manufacturer ilike '%'||target_search||'%' or v.model ilike '%'||target_search||'%')),'[]'::jsonb),
  'drivers',coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc)
    from public.driver_profiles d where d.verification_status='approved'),'[]'::jsonb),
  'assignments',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc)
    from public.driver_vehicle_links l join public.vehicles v on v.id=l.vehicle_id
    where v.fleet_partner_id is not null),'[]'::jsonb),
  'compliance',coalesce((select jsonb_agg(to_jsonb(c)) from public.subject_compliance_status c
    where c.subject_type='vehicle' and exists(select 1 from public.vehicles v where v.id=c.subject_id and v.fleet_partner_id is not null)),'[]'::jsonb),
  'ownership',coalesce((select jsonb_agg(to_jsonb(r) order by r.valid_from desc)
    from public.vehicle_party_relationships r join public.vehicles v on v.id=r.vehicle_id
    where v.fleet_partner_id is not null),'[]'::jsonb),
  'audit',coalesce((select jsonb_agg(to_jsonb(h) order by h.occurred_at desc) from (
    select id,fleet_partner_id::text entity_id,to_status,reason,actor_user_id,occurred_at
      from public.fleet_lifecycle_history where fleet_partner_id is not null
    union all
    select history.id,history.vehicle_id::text,history.to_status,history.reason,history.actor_user_id,history.occurred_at
      from public.vehicle_lifecycle_history history join public.vehicles v on v.id=history.vehicle_id
      where v.fleet_partner_id is not null
  ) h),'[]'::jsonb),
  'documents',coalesce((select jsonb_agg(jsonb_build_object(
    'id',document.id,'fleetApplicationId',application.id,'legalName',application.legal_name,
    'partnerKind',application.partner_kind,'applicationStatus',application.status,
    'requirementKey',link.requirement_key,'requirementName',requirement.display_name,
    'documentSubmissionId',document.id,'status',document.status,'decisionReason',document.decision_reason,
    'storageBucket',document.storage_bucket,'storagePath',document.storage_path,
    'contentType',document.content_type,'byteSize',document.byte_size,
    'createdAt',document.created_at,'reviewedAt',document.reviewed_at
  ) order by document.created_at desc)
    from public.fleet_application_documents link
    join public.fleet_partner_applications application on application.id=link.fleet_application_id
    join public.document_submissions document on document.id=link.document_submission_id
    join public.fleet_application_document_requirements requirement on requirement.key=link.requirement_key
    where (target_search is null or application.legal_name ilike '%'||target_search||'%')
      and (target_status is null or document.status=target_status)),'[]'::jsonb),
  'serviceLines',coalesce((select jsonb_agg(jsonb_build_object(
    'id',line.id,'fleetPartnerId',line.fleet_partner_id,'vehicleId',line.vehicle_id,
    'serviceKey',line.service_key,'status',line.status,'decisionReason',line.decision_reason,
    'registrationNumber',vehicle.registration_number,'manufacturer',vehicle.manufacturer,'model',vehicle.model,
    'fleetName',partner.display_name,'reviewedAt',line.reviewed_at
  ) order by line.created_at desc)
    from public.fleet_vehicle_service_lines line
    join public.vehicles vehicle on vehicle.id=line.vehicle_id
    join public.fleet_partners partner on partner.id=line.fleet_partner_id
    where (target_search is null or vehicle.registration_number ilike '%'||target_search||'%'
      or partner.display_name ilike '%'||target_search||'%')
      and (target_status is null or line.status=target_status)),'[]'::jsonb),
  'staff',coalesce((select jsonb_agg(jsonb_build_object(
    'id',staff.id,'fleetPartnerId',staff.fleet_partner_id,'userId',staff.user_id,
    'displayName',profile.display_name,'email',auth_user.email,'accessRole',staff.access_role,
    'status',staff.status,'reason',staff.reason,'startsAt',staff.starts_at,'endsAt',staff.ends_at
  ) order by staff.created_at desc)
    from public.fleet_authorized_staff staff
    join public.fleet_partners partner on partner.id=staff.fleet_partner_id
    join public.profiles profile on profile.id=staff.user_id
    left join auth.users auth_user on auth_user.id=staff.user_id
    where (target_search is null or partner.display_name ilike '%'||target_search||'%'
      or profile.display_name ilike '%'||target_search||'%')),'[]'::jsonb)
 )
 where public.has_permission('platform.fleets.read',null)
   or public.has_permission('platform.vehicles.manage',null)
   or public.has_permission('platform.fleets.review',null)
$;

-- RLS and execute grants.
alter table public.fleet_staff_invitations enable row level security;
alter table public.fleet_vehicle_registrations enable row level security;
alter table public.fleet_vehicle_service_lines enable row level security;
alter table public.fuel_station_affiliate_referrals enable row level security;
alter table public.fuel_station_affiliate_earnings enable row level security;
alter table public.fuel_station_affiliate_commission_failures enable row level security;
alter table public.fuel_station_affiliate_reversal_failures enable row level security;

drop policy if exists fleet_staff_invitation_related_read on public.fleet_staff_invitations;
create policy fleet_staff_invitation_related_read on public.fleet_staff_invitations for select to authenticated
 using(public.is_fleet_staff(fleet_partner_id,null) or lower(invited_email)=lower(coalesce(auth.jwt()->>'email','')));
drop policy if exists fleet_vehicle_service_line_related_read on public.fleet_vehicle_service_lines;
create policy fleet_vehicle_service_line_related_read on public.fleet_vehicle_service_lines for select to authenticated
 using(public.is_fleet_staff(fleet_partner_id,null) or public.has_permission('platform.fleets.read',null)
  or public.has_permission('platform.vehicles.manage',null));
drop policy if exists fuel_station_affiliate_referrals_service_role_only on public.fuel_station_affiliate_referrals;
create policy fuel_station_affiliate_referrals_service_role_only on public.fuel_station_affiliate_referrals
 for all to service_role using(true) with check(true);
drop policy if exists fuel_station_affiliate_earnings_service_role_only on public.fuel_station_affiliate_earnings;
create policy fuel_station_affiliate_earnings_service_role_only on public.fuel_station_affiliate_earnings
 for all to service_role using(true) with check(true);
drop policy if exists fuel_station_affiliate_commission_failures_service_role_only on public.fuel_station_affiliate_commission_failures;
create policy fuel_station_affiliate_commission_failures_service_role_only on public.fuel_station_affiliate_commission_failures
 for all to service_role using(true) with check(true);
drop policy if exists fuel_station_affiliate_reversal_failures_service_role_only on public.fuel_station_affiliate_reversal_failures;
create policy fuel_station_affiliate_reversal_failures_service_role_only on public.fuel_station_affiliate_reversal_failures
 for all to service_role using(true) with check(true);

revoke all on public.fleet_staff_invitations,public.fleet_vehicle_registrations,public.fleet_vehicle_service_lines,
 public.fuel_station_affiliate_referrals,public.fuel_station_affiliate_earnings,
 public.fuel_station_affiliate_commission_failures,public.fuel_station_affiliate_reversal_failures from anon,authenticated;
grant select on public.fleet_staff_invitations,public.fleet_vehicle_service_lines to authenticated;
grant all on public.fleet_staff_invitations,public.fleet_vehicle_registrations,public.fleet_vehicle_service_lines,
 public.fuel_station_affiliate_referrals,public.fuel_station_affiliate_earnings,
 public.fuel_station_affiliate_commission_failures,public.fuel_station_affiliate_reversal_failures to service_role;

revoke all on function public.register_fleet_partner_vehicle(uuid,uuid,text,text,text,integer,text,text,numeric,text[],text,text,jsonb) from public,anon;
revoke all on function public.invite_fleet_staff(uuid,text,text,text,text) from public,anon;
revoke all on function public.accept_fleet_staff_invitation(uuid) from public,anon;
revoke all on function public.register_fleet_application_document_submission(uuid,text,text,text,text,bigint,text,text,jsonb) from public,anon;
revoke all on function public.review_fleet_application_document_submission(uuid,text,text,text) from public,anon;
revoke all on function public.review_fleet_vehicle_service_line(uuid,text,text,text) from public,anon;
revoke all on function public.award_fuel_station_affiliate_commission(uuid,uuid) from public,anon,authenticated;
revoke all on function public.read_my_station_affiliate() from public,anon;
revoke all on function public.read_fuel_station_affiliate_admin_workspace() from public,anon;
revoke all on function public.retry_fuel_station_affiliate_commission(uuid,text) from public,anon;
revoke all on function public.reverse_fuel_station_affiliate_commission(uuid,text) from public,anon;
revoke all on function public.retry_fuel_station_affiliate_reversal(uuid,text) from public,anon;

grant execute on function public.register_fleet_partner_vehicle(uuid,uuid,text,text,text,integer,text,text,numeric,text[],text,text,jsonb) to authenticated,service_role;
grant execute on function public.invite_fleet_staff(uuid,text,text,text,text) to authenticated,service_role;
grant execute on function public.accept_fleet_staff_invitation(uuid) to authenticated,service_role;
grant execute on function public.register_fleet_application_document_submission(uuid,text,text,text,text,bigint,text,text,jsonb) to authenticated,service_role;
grant execute on function public.review_fleet_application_document_submission(uuid,text,text,text) to authenticated,service_role;
grant execute on function public.review_fleet_vehicle_service_line(uuid,text,text,text) to authenticated,service_role;
grant execute on function public.read_my_fleet_workspace() to authenticated,service_role;
grant execute on function public.read_my_station_affiliate() to authenticated,service_role;
grant execute on function public.read_fuel_station_affiliate_admin_workspace() to authenticated,service_role;
grant execute on function public.retry_fuel_station_affiliate_commission(uuid,text) to authenticated,service_role;
grant execute on function public.reverse_fuel_station_affiliate_commission(uuid,text) to authenticated,service_role;
grant execute on function public.retry_fuel_station_affiliate_reversal(uuid,text) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
