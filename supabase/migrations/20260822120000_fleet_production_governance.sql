begin;

insert into public.permissions(key,description,risk_level) values
('platform.fleets.read','Read fleet partner, ownership, assignment, compliance, and history records.','standard'),
('platform.fleets.review','Review fleet and vehicle lifecycle decisions.','high'),
('platform.fleets.manage','Manage fleet ownership, assignments, staff, and remediation.','high'),
('platform.fleet_compliance.read','Read fleet and vehicle compliance evaluations.','standard')
on conflict(key) do update set description=excluded.description,risk_level=excluded.risk_level;

update public.platform_admin_role_templates t set permission_keys=(select array_agg(distinct x order by x) from unnest(t.permission_keys||case t.key when 'platform.super_admin' then array['platform.fleets.read','platform.fleets.review','platform.fleets.manage','platform.fleet_compliance.read']::text[] when 'platform.company_admin' then array['platform.fleets.read','platform.fleets.review','platform.fleets.manage','platform.fleet_compliance.read']::text[] when 'platform.operations_admin' then array['platform.fleets.read','platform.fleets.review','platform.fleets.manage','platform.fleet_compliance.read']::text[] when 'platform.support_admin' then array['platform.fleets.read','platform.fleet_compliance.read']::text[] else array[]::text[] end)x),updated_at=timezone('utc',now()) where t.key in('platform.super_admin','platform.company_admin','platform.operations_admin','platform.support_admin');
insert into public.role_permissions(role_id,permission_id,conditions) select r.id,p.id,'{}'::jsonb from public.roles r join public.permissions p on p.key=any(case r.key when 'platform.super_admin' then array['platform.fleets.read','platform.fleets.review','platform.fleets.manage','platform.fleet_compliance.read']::text[] when 'platform.company_admin' then array['platform.fleets.read','platform.fleets.review','platform.fleets.manage','platform.fleet_compliance.read']::text[] when 'platform.operations_admin' then array['platform.fleets.read','platform.fleets.review','platform.fleets.manage','platform.fleet_compliance.read']::text[] when 'platform.support_admin' then array['platform.fleets.read','platform.fleet_compliance.read']::text[] else array[]::text[] end) where r.key in('platform.super_admin','platform.company_admin','platform.operations_admin','platform.support_admin') on conflict(role_id,permission_id) do nothing;

insert into public.event_types(key,description,schema,status) values
('event.fleet.submitted','Fleet application submitted.','{}','active'),
('event.fleet.approved','Fleet partner approved.','{}','active'),
('event.fleet.rejected','Fleet partner rejected.','{}','active'),
('event.fleet.suspended','Fleet partner suspended.','{}','active'),
('event.vehicle.approved','Vehicle approved.','{}','active'),
('event.vehicle.rejected','Vehicle rejected.','{}','active'),
('event.vehicle.suspended','Vehicle suspended.','{}','active'),
('event.vehicle.reinstated','Vehicle reinstated.','{}','active'),
('event.vehicle.owner_changed','Vehicle owner or operator relationship changed.','{}','active'),
('event.vehicle.driver_assigned','Driver assigned to vehicle.','{}','active'),
('event.vehicle.driver_removed','Driver removed from vehicle.','{}','active'),
('event.compliance.failed','Configured compliance requirement failed.','{}','active'),
('event.dispatch.eligibility_changed','Driver and vehicle dispatch eligibility changed.','{}','active')
on conflict(key) do update set description=excluded.description,status='active';

-- Canonical temporal party relationship. Legacy vehicle owner columns are projections only.
create table public.vehicle_party_relationships(
 id uuid primary key default gen_random_uuid(), vehicle_id uuid not null references public.vehicles(id) on delete restrict,
 party_type text not null check(party_type in('profile','organization','fleet_partner')),
 party_id uuid not null, relationship_role text not null check(relationship_role in('legal_owner','fleet_operator','lessor','lessee','rental_provider','authorized_third_party')),
 valid_from timestamptz not null default timezone('utc',now()), valid_until timestamptz, status text not null default 'active' check(status in('active','revoked','superseded')),
 source text not null, idempotency_key text not null, reason text not null check(char_length(btrim(reason))>0),
 authorized_by uuid references public.profiles(id) on delete set null default auth.uid(), metadata jsonb not null default '{}' check(jsonb_typeof(metadata)='object'),
 created_at timestamptz not null default timezone('utc',now()), updated_at timestamptz not null default timezone('utc',now()),
 check(valid_until is null or valid_until>valid_from),unique(source,idempotency_key)
);
create unique index vehicle_one_current_legal_owner_idx on public.vehicle_party_relationships(vehicle_id) where relationship_role='legal_owner' and status='active' and valid_until is null;
create index vehicle_party_history_idx on public.vehicle_party_relationships(vehicle_id,relationship_role,valid_from desc);

create table public.vehicle_relationship_events(
 id uuid primary key default gen_random_uuid(),vehicle_id uuid not null references public.vehicles(id) on delete restrict,
 relationship_id uuid references public.vehicle_party_relationships(id) on delete restrict,event_type text not null check(event_type in('created','revoked','superseded','transferred')),
 reason text not null,actor_user_id uuid references public.profiles(id) on delete set null,event_payload jsonb not null default '{}' check(jsonb_typeof(event_payload)='object'),
 source text not null,idempotency_key text not null,occurred_at timestamptz not null default timezone('utc',now()),unique(source,idempotency_key)
);
create or replace function public.prevent_vehicle_relationship_event_mutation() returns trigger language plpgsql as $$ begin raise exception 'vehicle relationship history is immutable'; end $$;
create trigger immutable_vehicle_relationship_events before update or delete on public.vehicle_relationship_events for each row execute function public.prevent_vehicle_relationship_event_mutation();

create or replace function public.set_vehicle_party_relationship(target_vehicle_id uuid,target_party_type text,target_party_id uuid,target_role text,target_valid_from timestamptz,target_reason text,target_source text,target_idempotency_key text,target_metadata jsonb default '{}') returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare existing record; new_id uuid; owner_profile uuid; owner_org uuid; owner_fleet uuid;
begin
 if not public.has_permission('platform.fleets.manage',null) and auth.role()<>'service_role' then raise exception 'fleet management permission is required'; end if;
 if nullif(btrim(target_reason),'') is null or nullif(btrim(target_idempotency_key),'') is null then raise exception 'reason and idempotency key are required'; end if;
 if target_party_type not in('profile','organization','fleet_partner') or target_role not in('legal_owner','fleet_operator','lessor','lessee','rental_provider','authorized_third_party') then raise exception 'unsupported vehicle party relationship'; end if;
 if target_party_type='profile' and not exists(select 1 from public.profiles where id=target_party_id) then raise exception 'profile party does not exist';
 elsif target_party_type='organization' and not exists(select 1 from public.organizations where id=target_party_id) then raise exception 'organization party does not exist';
 elsif target_party_type='fleet_partner' and not exists(select 1 from public.fleet_partners where id=target_party_id and verification_status='approved') then raise exception 'approved fleet partner party is required'; end if;
 select * into existing from public.vehicle_party_relationships where vehicle_id=target_vehicle_id and relationship_role=target_role and status='active' and valid_until is null for update;
 if found then
  update public.vehicle_party_relationships set status='superseded',valid_until=greatest(coalesce(target_valid_from,timezone('utc',now())),valid_from+interval '1 millisecond'),updated_at=timezone('utc',now()) where id=existing.id;
  insert into public.vehicle_relationship_events(vehicle_id,relationship_id,event_type,reason,actor_user_id,event_payload,source,idempotency_key) values(target_vehicle_id,existing.id,'superseded',target_reason,auth.uid(),jsonb_build_object('replacementPartyId',target_party_id),target_source,target_idempotency_key||':superseded');
 end if;
 insert into public.vehicle_party_relationships(vehicle_id,party_type,party_id,relationship_role,valid_from,source,idempotency_key,reason,metadata) values(target_vehicle_id,target_party_type,target_party_id,target_role,coalesce(target_valid_from,timezone('utc',now())),target_source,target_idempotency_key,target_reason,coalesce(target_metadata,'{}')) returning id into new_id;
 insert into public.vehicle_relationship_events(vehicle_id,relationship_id,event_type,reason,actor_user_id,event_payload,source,idempotency_key) values(target_vehicle_id,new_id,case when existing.id is null then 'created' else 'transferred' end,target_reason,auth.uid(),jsonb_build_object('partyType',target_party_type,'partyId',target_party_id,'role',target_role),target_source,target_idempotency_key||':created');
 -- Controlled compatibility projection; application code must read the canonical relation.
 if target_role='legal_owner' then
  owner_profile:=case when target_party_type='profile' then target_party_id end; owner_org:=case when target_party_type='organization' then target_party_id end; owner_fleet:=case when target_party_type='fleet_partner' then target_party_id end;
  perform set_config('skima.canonical_ownership_projection','on',true);
  update public.vehicles set owner_user_id=owner_profile,organization_id=owner_org,fleet_partner_id=owner_fleet,ownership_relationship=case target_party_type when 'profile' then 'driver_owned' when 'organization' then 'business_owned' else 'fleet_owned' end,updated_at=timezone('utc',now()) where id=target_vehicle_id;
 end if;
 insert into public.event_log(event_type_key,source,subject_type,subject_id,actor_user_id,idempotency_key,payload,status) values('event.vehicle.owner_changed',target_source,'vehicle',target_vehicle_id,auth.uid(),target_idempotency_key,jsonb_build_object('relationshipId',new_id,'role',target_role,'partyType',target_party_type,'partyId',target_party_id),'processed') on conflict do nothing;
 return new_id;
end $$;


create or replace function public.guard_legacy_vehicle_ownership_projection() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if (new.owner_user_id,new.organization_id,new.fleet_partner_id,new.ownership_relationship,new.ownership_type) is distinct from (old.owner_user_id,old.organization_id,old.fleet_partner_id,old.ownership_relationship,old.ownership_type) and current_setting('skima.canonical_ownership_projection',true) is distinct from 'on' then raise exception 'vehicle ownership must be changed through set_vehicle_party_relationship'; end if;
 return new;
end $$;
drop trigger if exists guard_legacy_vehicle_ownership_projection on public.vehicles;
create trigger guard_legacy_vehicle_ownership_projection before update of owner_user_id,organization_id,fleet_partner_id,ownership_relationship,ownership_type on public.vehicles for each row execute function public.guard_legacy_vehicle_ownership_projection();

create or replace function public.seed_canonical_vehicle_owner() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare party_type text;party_id uuid;
begin
 party_type:=case when new.fleet_partner_id is not null then 'fleet_partner' when new.organization_id is not null then 'organization' when new.owner_user_id is not null then 'profile' end; party_id:=coalesce(new.fleet_partner_id,new.organization_id,new.owner_user_id);
 if party_id is not null then insert into public.vehicle_party_relationships(vehicle_id,party_type,party_id,relationship_role,source,idempotency_key,reason,metadata) values(new.id,party_type,party_id,'legal_owner','skima.vehicle.registration','owner:'||new.id,'Canonical owner established during vehicle registration.',jsonb_build_object('registrationProjection',true)) on conflict(source,idempotency_key) do nothing; end if;
 return new;
end $$;
drop trigger if exists seed_canonical_vehicle_owner on public.vehicles;
create trigger seed_canonical_vehicle_owner after insert on public.vehicles for each row execute function public.seed_canonical_vehicle_owner();

-- Governed application and lifecycle history.
create table public.fleet_partner_applications(
 id uuid primary key default gen_random_uuid(), applicant_user_id uuid not null references public.profiles(id) on delete restrict,
 fleet_partner_id uuid references public.fleet_partners(id) on delete restrict,partner_kind text not null check(partner_kind in('individual_owner','company','fleet_operator')),
 legal_name text not null,registration_identifier text,normalized_identity_key text not null,status text not null default 'draft' check(status in('draft','submitted','correction_required','resubmitted','approved','rejected','withdrawn','suspended')),
 revision integer not null default 1,application_payload jsonb not null default '{}' check(jsonb_typeof(application_payload)='object'),
 source text not null,idempotency_key text not null,created_at timestamptz not null default timezone('utc',now()),updated_at timestamptz not null default timezone('utc',now()),unique(source,idempotency_key)
);
create unique index fleet_application_no_duplicate_live_identity on public.fleet_partner_applications(normalized_identity_key) where status in('submitted','correction_required','resubmitted','approved');
create table public.fleet_lifecycle_history(id uuid primary key default gen_random_uuid(),fleet_application_id uuid references public.fleet_partner_applications(id) on delete restrict,fleet_partner_id uuid references public.fleet_partners(id) on delete restrict,from_status text,to_status text not null,reason text not null,actor_user_id uuid references public.profiles(id) on delete set null,idempotency_key text not null unique,metadata jsonb not null default '{}',occurred_at timestamptz not null default timezone('utc',now()));
create trigger immutable_fleet_lifecycle_history before update or delete on public.fleet_lifecycle_history for each row execute function public.prevent_vehicle_relationship_event_mutation();

create table public.vehicle_lifecycle_history(id uuid primary key default gen_random_uuid(),vehicle_id uuid not null references public.vehicles(id) on delete restrict,from_status text,to_status text not null check(to_status in('active','suspended','archived')),decision text not null check(decision in('approved','rejected','suspended','reinstated')),reason text not null,actor_user_id uuid references public.profiles(id) on delete set null,idempotency_key text not null unique,occurred_at timestamptz not null default timezone('utc',now()));
create trigger immutable_vehicle_lifecycle_history before update or delete on public.vehicle_lifecycle_history for each row execute function public.prevent_vehicle_relationship_event_mutation();

create or replace function public.submit_fleet_application(target_partner_kind text,target_legal_name text,target_registration_identifier text,target_payload jsonb,target_source text,target_idempotency_key text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid; identity_key text;
begin
 identity_key:=lower(regexp_replace(coalesce(nullif(btrim(target_registration_identifier),''),btrim(target_legal_name)),'[^a-zA-Z0-9]','','g'));
 if target_partner_kind not in('individual_owner','company','fleet_operator') or length(identity_key)<3 then raise exception 'valid fleet identity is required'; end if;
 if exists(select 1 from public.fleet_partner_applications where normalized_identity_key=identity_key and status in('submitted','correction_required','resubmitted','approved') and applicant_user_id<>auth.uid()) then raise exception 'a fleet application already exists for this identity'; end if;
 insert into public.fleet_partner_applications(applicant_user_id,partner_kind,legal_name,registration_identifier,normalized_identity_key,status,application_payload,source,idempotency_key) values(auth.uid(),target_partner_kind,btrim(target_legal_name),nullif(btrim(target_registration_identifier),''),identity_key,'submitted',coalesce(target_payload,'{}'),target_source,target_idempotency_key) on conflict(source,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning id into result;
 insert into public.fleet_lifecycle_history(fleet_application_id,from_status,to_status,reason,actor_user_id,idempotency_key) values(result,'draft','submitted','Submitted for review.',auth.uid(),target_idempotency_key||':history') on conflict do nothing;
 insert into public.event_log(event_type_key,source,subject_type,subject_id,actor_user_id,idempotency_key,payload,status) values('event.fleet.submitted',target_source,'fleet_application',result,auth.uid(),target_idempotency_key,jsonb_build_object('partnerKind',target_partner_kind),'processed') on conflict do nothing;
 return result;
end $$;

create or replace function public.review_fleet_application(target_application_id uuid,target_decision text,target_reason text,target_idempotency_key text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare app record; partner_id uuid; next_status text; event_key text;
begin
 if not public.has_permission('platform.fleets.review',null) and not public.has_permission('platform.vehicles.manage',null) then raise exception 'fleet review permission is required'; end if;
 if target_decision not in('approved','rejected','correction_required','suspended') or nullif(btrim(target_reason),'') is null then raise exception 'valid decision and reason are required'; end if;
 select * into app from public.fleet_partner_applications where id=target_application_id for update; if not found then raise exception 'fleet application not found'; end if;
 if app.applicant_user_id=auth.uid() then raise exception 'fleet applications cannot be self-approved'; end if;
 next_status:=target_decision;
 if target_decision='approved' then
  insert into public.fleet_partners(owner_user_id,partner_kind,display_name,verification_status,operational_status,verified_by,verified_at,decision_reason,metadata) values(app.applicant_user_id,app.partner_kind,app.legal_name,'approved','active',auth.uid(),timezone('utc',now()),target_reason,jsonb_build_object('applicationId',app.id)) returning id into partner_id;
  event_key:='event.fleet.approved';
 elsif target_decision='rejected' then event_key:='event.fleet.rejected';
 elsif target_decision='suspended' then partner_id:=app.fleet_partner_id; update public.fleet_partners set verification_status='suspended',operational_status='suspended',decision_reason=target_reason where id=partner_id; event_key:='event.fleet.suspended'; end if;
 update public.fleet_partner_applications set status=next_status,fleet_partner_id=coalesce(partner_id,fleet_partner_id),updated_at=timezone('utc',now()) where id=app.id;
 insert into public.fleet_lifecycle_history(fleet_application_id,fleet_partner_id,from_status,to_status,reason,actor_user_id,idempotency_key) values(app.id,partner_id,app.status,next_status,target_reason,auth.uid(),target_idempotency_key);
 if event_key is not null then insert into public.event_log(event_type_key,source,subject_type,subject_id,actor_user_id,idempotency_key,payload,status) values(event_key,'skima.fleet.workflow','fleet_partner',coalesce(partner_id,app.id),auth.uid(),target_idempotency_key,jsonb_build_object('applicationId',app.id,'reason',target_reason),'processed') on conflict do nothing; end if;
 return coalesce(partner_id,app.id);
end $$;

-- Configured compliance requirements and evidence.
create table public.compliance_requirement_definitions(
 key text primary key,subject_type text not null check(subject_type in('driver','vehicle','fleet_partner')),display_name text not null,document_purpose_key text,capability_key text,module_key text,geography_scope jsonb not null default '{}',required boolean not null default true,expiry_warning_days integer not null default 30,enforcement text not null check(enforcement in('warn','suspend','dispatch_block')),status text not null default 'active',metadata jsonb not null default '{}',created_at timestamptz not null default timezone('utc',now()),updated_at timestamptz not null default timezone('utc',now())
);
create table public.compliance_evidence(id uuid primary key default gen_random_uuid(),requirement_key text not null references public.compliance_requirement_definitions(key),subject_type text not null,subject_id uuid not null,document_submission_id uuid references public.document_submissions(id) on delete restrict,status text not null check(status in('pending','valid','rejected','revoked','expired')),valid_from date,valid_until date,reviewed_by uuid references public.profiles(id) on delete set null,reviewed_at timestamptz,metadata jsonb not null default '{}',created_at timestamptz not null default timezone('utc',now()),updated_at timestamptz not null default timezone('utc',now()));
create unique index compliance_one_current_evidence on public.compliance_evidence(requirement_key,subject_type,subject_id) where status in('pending','valid');

create or replace function public.record_compliance_evidence(target_requirement_key text,target_subject_type text,target_subject_id uuid,target_document_submission_id uuid,target_valid_from date,target_valid_until date,target_reason text,target_idempotency_key text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid;document_record record;
begin
 if not public.has_permission('platform.fleets.review',null) and not public.has_permission('platform.documents.review',null) then raise exception 'compliance evidence review permission is required'; end if;
 select * into document_record from public.document_submissions where id=target_document_submission_id and subject_type=target_subject_type and subject_id=target_subject_id and status='approved'; if not found then raise exception 'approved document evidence for this subject is required'; end if;
 if not exists(select 1 from public.compliance_requirement_definitions where key=target_requirement_key and subject_type=target_subject_type and status='active') then raise exception 'active configured compliance requirement is required'; end if;
 update public.compliance_evidence set status='revoked',updated_at=timezone('utc',now()),metadata=metadata||jsonb_build_object('revocationReason',target_reason) where requirement_key=target_requirement_key and subject_type=target_subject_type and subject_id=target_subject_id and status in('pending','valid');
 insert into public.compliance_evidence(requirement_key,subject_type,subject_id,document_submission_id,status,valid_from,valid_until,reviewed_by,reviewed_at,metadata) values(target_requirement_key,target_subject_type,target_subject_id,target_document_submission_id,'valid',target_valid_from,target_valid_until,auth.uid(),timezone('utc',now()),jsonb_build_object('reason',target_reason,'idempotencyKey',target_idempotency_key)) returning id into result;
 insert into public.event_log(event_type_key,source,subject_type,subject_id,actor_user_id,idempotency_key,payload,status) values('event.dispatch.eligibility_changed','skima.compliance.review',target_subject_type,target_subject_id,auth.uid(),target_idempotency_key,jsonb_build_object('requirementKey',target_requirement_key,'evidenceId',result,'reviewed',true),'processed') on conflict do nothing;
 return result;
end $$;
insert into public.compliance_requirement_definitions(key,subject_type,display_name,document_purpose_key,module_key,enforcement) values
('vehicle.ownership_proof','vehicle','Ownership proof','vehicle.ownership-authorization',null,'dispatch_block'),
('vehicle.insurance','vehicle','Insurance','vehicle.insurance',null,'dispatch_block'),
('vehicle.inspection','vehicle','Vehicle inspection','vehicle.inspection',null,'dispatch_block'),
('vehicle.roadworthiness','vehicle','Roadworthiness','vehicle.roadworthiness',null,'dispatch_block'),
('vehicle.lpg_transport','vehicle','LPG transport approval','vehicle.lpg-transport','lpg','dispatch_block'),
('driver.licence','driver','Driver licence','driver.licence',null,'dispatch_block'),
('driver.lpg_approval','driver','LPG service approval','driver.lpg-approval','lpg','dispatch_block') on conflict(key) do nothing;

create or replace view public.subject_compliance_status with(security_invoker=true) as
select subject.subject_type,subject.subject_id,bool_and(not requirement.required or (evidence.status='valid' and (evidence.valid_from is null or evidence.valid_from<=current_date) and (evidence.valid_until is null or evidence.valid_until>=current_date))) as compliant,
 array_agg(requirement.key order by requirement.key) filter(where requirement.required and not coalesce(evidence.status='valid' and (evidence.valid_from is null or evidence.valid_from<=current_date) and (evidence.valid_until is null or evidence.valid_until>=current_date),false)) as failures,
 min(evidence.valid_until) filter(where evidence.status='valid') as next_expiry
from (select 'vehicle'::text subject_type,id subject_id from public.vehicles union all select 'driver',id from public.driver_profiles union all select 'fleet_partner',id from public.fleet_partners) subject
join public.compliance_requirement_definitions requirement on requirement.subject_type=subject.subject_type and requirement.status='active' and requirement.module_key is null
left join public.compliance_evidence evidence on evidence.requirement_key=requirement.key and evidence.subject_type=subject.subject_type and evidence.subject_id=subject.subject_id and evidence.status in('valid','pending')
group by subject.subject_type,subject.subject_id;

create or replace function public.decide_vehicle_lifecycle(target_vehicle_id uuid,target_decision text,target_reason text,target_idempotency_key text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare vehicle_record record; next_status text; event_key text; compliant boolean;
begin
 if not public.has_permission('platform.fleets.review',null) and not public.has_permission('platform.vehicles.manage',null) then raise exception 'vehicle review permission is required'; end if;
 if target_decision not in('approved','rejected','suspended','reinstated') or nullif(btrim(target_reason),'') is null then raise exception 'valid decision and reason are required'; end if;
 select * into vehicle_record from public.vehicles where id=target_vehicle_id for update; if not found then raise exception 'vehicle not found'; end if;
 if vehicle_record.owner_user_id=auth.uid() then raise exception 'vehicle cannot be self-approved'; end if;
 if target_decision in('approved','reinstated') then select status.compliant into compliant from public.subject_compliance_status status where status.subject_type='vehicle' and status.subject_id=target_vehicle_id; if not coalesce(compliant,false) then raise exception 'vehicle has unmet configured compliance requirements'; end if; end if;
 next_status:=case when target_decision in('approved','reinstated') then 'active' when target_decision='suspended' then 'suspended' else 'archived' end;
 event_key:=case target_decision when 'approved' then 'event.vehicle.approved' when 'rejected' then 'event.vehicle.rejected' when 'suspended' then 'event.vehicle.suspended' else 'event.vehicle.reinstated' end;
 update public.vehicles set status=next_status,updated_at=timezone('utc',now()) where id=target_vehicle_id;
 insert into public.vehicle_lifecycle_history(vehicle_id,from_status,to_status,decision,reason,actor_user_id,idempotency_key) values(target_vehicle_id,vehicle_record.status,next_status,target_decision,target_reason,auth.uid(),target_idempotency_key);
 insert into public.event_log(event_type_key,source,subject_type,subject_id,actor_user_id,idempotency_key,payload,status) values(event_key,'skima.vehicle.workflow','vehicle',target_vehicle_id,auth.uid(),target_idempotency_key,jsonb_build_object('reason',target_reason),'processed') on conflict do nothing;
 return target_vehicle_id;
end $$;


create or replace function public.evaluate_driver_vehicle_eligibility(target_driver_profile_id uuid,target_vehicle_id uuid,target_module_key text) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare driver_ok boolean;vehicle_ok boolean;assignment_ok boolean;driver_docs boolean;vehicle_docs boolean;capability_ok boolean;failures text[]:='{}';
begin
 select verification_status='approved' into driver_ok from public.driver_profiles where id=target_driver_profile_id;
 select status='active' into vehicle_ok from public.vehicles where id=target_vehicle_id;
 select exists(select 1 from public.driver_vehicle_links where driver_profile_id=target_driver_profile_id and vehicle_id=target_vehicle_id and status='active' and starts_at<=timezone('utc',now()) and (ends_at is null or ends_at>timezone('utc',now()))) into assignment_ok;
 select not exists(select 1 from public.compliance_requirement_definitions r where r.subject_type='driver' and r.status='active' and r.required and (r.module_key is null or r.module_key=target_module_key) and not exists(select 1 from public.compliance_evidence e where e.requirement_key=r.key and e.subject_type='driver' and e.subject_id=target_driver_profile_id and e.status='valid' and (e.valid_from is null or e.valid_from<=current_date) and (e.valid_until is null or e.valid_until>=current_date))) into driver_docs;
 select not exists(select 1 from public.compliance_requirement_definitions r where r.subject_type='vehicle' and r.status='active' and r.required and (r.module_key is null or r.module_key=target_module_key) and not exists(select 1 from public.compliance_evidence e where e.requirement_key=r.key and e.subject_type='vehicle' and e.subject_id=target_vehicle_id and e.status='valid' and (e.valid_from is null or e.valid_from<=current_date) and (e.valid_until is null or e.valid_until>=current_date))) into vehicle_docs;
 select not exists(select 1 from public.compliance_requirement_definitions r where r.subject_type='vehicle' and r.status='active' and r.required and r.module_key=target_module_key and r.capability_key is not null and not exists(select 1 from public.entity_capabilities c where c.entity_type='vehicle' and c.entity_id=target_vehicle_id and c.capability_key=r.capability_key and c.status='active')) into capability_ok;
 if not coalesce(driver_ok,false) then failures:=array_append(failures,'driver_not_approved'); end if; if not coalesce(vehicle_ok,false) then failures:=array_append(failures,'vehicle_not_approved'); end if; if not assignment_ok then failures:=array_append(failures,'assignment_inactive'); end if; if not driver_docs then failures:=array_append(failures,'driver_compliance_failed'); end if; if not vehicle_docs then failures:=array_append(failures,'vehicle_compliance_failed'); end if; if not capability_ok then failures:=array_append(failures,'vehicle_capability_failed'); end if;
 return jsonb_build_object('eligible',cardinality(failures)=0,'driverProfileId',target_driver_profile_id,'vehicleId',target_vehicle_id,'moduleKey',target_module_key,'reasons',to_jsonb(failures),'evaluatedAt',timezone('utc',now()));
end $$;

create or replace function public.read_fleet_admin_workspace(target_search text default null,target_status text default null) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
  'partners',coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at desc) from public.fleet_partners f where (target_status is null or f.verification_status=target_status) and (target_search is null or f.display_name ilike '%'||target_search||'%')),'[]'::jsonb),
  'applications',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from public.fleet_partner_applications a where (target_status is null or a.status=target_status) and (target_search is null or a.legal_name ilike '%'||target_search||'%')),'[]'::jsonb),
  'vehicles',coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc) from public.vehicles v),'[]'::jsonb),
  'drivers',coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc) from public.driver_profiles d where d.verification_status='approved'),'[]'::jsonb),
  'assignments',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc) from public.driver_vehicle_links l),'[]'::jsonb),
  'compliance',coalesce((select jsonb_agg(to_jsonb(c)) from public.subject_compliance_status c),'[]'::jsonb),
  'ownership',coalesce((select jsonb_agg(to_jsonb(r) order by r.valid_from desc) from public.vehicle_party_relationships r),'[]'::jsonb),
  'audit',coalesce((select jsonb_agg(to_jsonb(h) order by h.occurred_at desc) from (select id,fleet_partner_id::text entity_id,to_status,reason,actor_user_id,occurred_at from public.fleet_lifecycle_history union all select id,vehicle_id::text,to_status,reason,actor_user_id,occurred_at from public.vehicle_lifecycle_history) h),'[]'::jsonb)
 ) where public.has_permission('platform.fleets.read',null) or public.has_permission('platform.vehicles.manage',null)
$$;

create or replace function public.read_my_vehicle_workspace() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare driver_id uuid;result jsonb;
begin
 select id into driver_id from public.driver_profiles where user_id=auth.uid() order by created_at limit 1;
 select jsonb_build_object('driverProfileId',driver_id,'current',to_jsonb(current_row),'history',coalesce((select jsonb_agg(to_jsonb(history_row) order by history_row.starts_at desc) from (select l.*,v.manufacturer,v.model,v.registration_number from public.driver_vehicle_links l join public.vehicles v on v.id=l.vehicle_id where l.driver_profile_id=driver_id) history_row),'[]'::jsonb)) into result
 from (select l.id assignment_id,l.vehicle_id,l.relationship_type,l.status assignment_status,l.starts_at,l.ends_at,v.manufacturer,v.model,v.registration_number,v.status vehicle_status,coalesce(fp.display_name,o.display_name,p.display_name,'Owner details pending') owner_name,public.evaluate_driver_vehicle_eligibility(driver_id,v.id,'lpg') eligibility
 from public.driver_vehicle_links l join public.vehicles v on v.id=l.vehicle_id left join public.vehicle_party_relationships r on r.vehicle_id=v.id and r.relationship_role='legal_owner' and r.status='active' and r.valid_until is null left join public.fleet_partners fp on r.party_type='fleet_partner' and fp.id=r.party_id left join public.organizations o on r.party_type='organization' and o.id=r.party_id left join public.profiles p on r.party_type='profile' and p.id=r.party_id where l.driver_profile_id=driver_id and l.status='active' and l.starts_at<=timezone('utc',now()) and (l.ends_at is null or l.ends_at>timezone('utc',now())) order by l.starts_at desc limit 1) current_row;
 return coalesce(result,jsonb_build_object('driverProfileId',driver_id,'current',null,'history','[]'::jsonb));
end $$;


create or replace function public.resubmit_fleet_application(target_application_id uuid,target_payload jsonb,target_reason text,target_idempotency_key text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare app record;
begin
 select * into app from public.fleet_partner_applications where id=target_application_id and applicant_user_id=auth.uid() for update;
 if not found or app.status<>'correction_required' then raise exception 'a correction-required fleet application is required'; end if;
 update public.fleet_partner_applications set status='resubmitted',revision=revision+1,application_payload=coalesce(target_payload,'{}'),idempotency_key=target_idempotency_key,updated_at=timezone('utc',now()) where id=app.id;
 insert into public.fleet_lifecycle_history(fleet_application_id,fleet_partner_id,from_status,to_status,reason,actor_user_id,idempotency_key) values(app.id,app.fleet_partner_id,app.status,'resubmitted',target_reason,auth.uid(),target_idempotency_key);
 insert into public.event_log(event_type_key,source,subject_type,subject_id,actor_user_id,idempotency_key,payload,status) values('event.fleet.submitted','skima.fleet.portal','fleet_application',app.id,auth.uid(),target_idempotency_key,jsonb_build_object('revision',app.revision+1),'processed') on conflict do nothing;
 return app.id;
end $$;

create or replace function public.emit_vehicle_assignment_event() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare event_key text;event_idempotency text;
begin
 if tg_op='INSERT' and new.status='active' then event_key:='event.vehicle.driver_assigned';event_idempotency:='assignment:'||new.id;
 elsif tg_op='UPDATE' and old.status='active' and new.status<>'active' then event_key:='event.vehicle.driver_removed';event_idempotency:='removal:'||new.id||':'||new.updated_at::text; else return new; end if;
 insert into public.event_log(event_type_key,source,subject_type,subject_id,actor_user_id,idempotency_key,payload,status) values(event_key,'skima.vehicle.assignment','vehicle',new.vehicle_id,auth.uid(),event_idempotency,jsonb_build_object('assignmentId',new.id,'driverProfileId',new.driver_profile_id,'relationshipType',new.relationship_type,'startsAt',new.starts_at,'endsAt',new.ends_at),'processed') on conflict do nothing;
 return new;
end $$;
drop trigger if exists emit_vehicle_assignment_event on public.driver_vehicle_links;
create trigger emit_vehicle_assignment_event after insert or update on public.driver_vehicle_links for each row execute function public.emit_vehicle_assignment_event();

create or replace function public.enforce_expired_compliance(target_limit integer default 100) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare evidence record;affected integer:=0;
begin
 if auth.role()<>'service_role' and not public.has_permission('platform.fleets.manage',null) then raise exception 'compliance enforcement permission is required'; end if;
 for evidence in select e.*,r.enforcement from public.compliance_evidence e join public.compliance_requirement_definitions r on r.key=e.requirement_key where e.status='valid' and e.valid_until<current_date and r.status='active' order by e.valid_until limit least(greatest(target_limit,1),500) for update of e loop
  update public.compliance_evidence set status='expired',updated_at=timezone('utc',now()) where id=evidence.id;
  if evidence.enforcement in('suspend','dispatch_block') and evidence.subject_type='vehicle' then update public.vehicles set status='suspended',updated_at=timezone('utc',now()) where id=evidence.subject_id and status='active'; end if;
  if evidence.enforcement='suspend' and evidence.subject_type='driver' then update public.driver_profiles set operational_status='paused',verification_status='suspended',updated_at=timezone('utc',now()) where id=evidence.subject_id; end if;
  insert into public.event_log(event_type_key,source,subject_type,subject_id,actor_user_id,idempotency_key,payload,status) values('event.compliance.failed','skima.compliance.enforcement',evidence.subject_type,evidence.subject_id,auth.uid(),'expired:'||evidence.id,jsonb_build_object('requirementKey',evidence.requirement_key,'validUntil',evidence.valid_until,'enforcement',evidence.enforcement),'processed') on conflict do nothing;
  insert into public.event_log(event_type_key,source,subject_type,subject_id,actor_user_id,idempotency_key,payload,status) values('event.dispatch.eligibility_changed','skima.compliance.enforcement',evidence.subject_type,evidence.subject_id,auth.uid(),'eligibility:'||evidence.id,jsonb_build_object('eligible',false,'reason','compliance_expired','requirementKey',evidence.requirement_key),'processed') on conflict do nothing;
  affected:=affected+1;
 end loop;
 return affected;
end $$;

-- Finance preparation only: no payout or posting function is provided.
create table public.fleet_settlement_profiles(id uuid primary key default gen_random_uuid(),fleet_partner_id uuid not null references public.fleet_partners(id) on delete restrict,vehicle_owner_beneficiary_id uuid references public.withdrawal_beneficiaries(id) on delete restrict,financial_policy_key text,lease_agreement_reference text,status text not null default 'configuration_required' check(status in('configuration_required','policy_ready','disabled')),payouts_enabled boolean not null default false check(payouts_enabled=false),metadata jsonb not null default '{}',created_at timestamptz not null default timezone('utc',now()),updated_at timestamptz not null default timezone('utc',now()),unique(fleet_partner_id));
create table public.order_vehicle_ownership_snapshots(id uuid primary key default gen_random_uuid(),order_id uuid not null,vehicle_id uuid not null references public.vehicles(id),driver_profile_id uuid not null references public.driver_profiles(id),legal_owner_relationship_id uuid references public.vehicle_party_relationships(id),fleet_operator_relationship_id uuid references public.vehicle_party_relationships(id),settlement_profile_id uuid references public.fleet_settlement_profiles(id),policy_inputs jsonb not null default '{}',captured_at timestamptz not null default timezone('utc',now()),unique(order_id));

-- Reconcile legacy owners into canonical temporal records before canonical reads begin.
insert into public.vehicle_party_relationships(vehicle_id,party_type,party_id,relationship_role,source,idempotency_key,reason,metadata)
select v.id,case when v.fleet_partner_id is not null then 'fleet_partner' when v.organization_id is not null then 'organization' else 'profile' end,coalesce(v.fleet_partner_id,v.organization_id,v.owner_user_id),'legal_owner','skima.fleet.legacy_backfill','owner:'||v.id,'Legacy owner projection backfill.',jsonb_build_object('backfilled',true)
from public.vehicles v where coalesce(v.fleet_partner_id,v.organization_id,v.owner_user_id) is not null and not exists(select 1 from public.vehicle_party_relationships r where r.vehicle_id=v.id and r.relationship_role='legal_owner' and r.status='active');

alter table public.vehicle_party_relationships enable row level security; alter table public.vehicle_relationship_events enable row level security; alter table public.fleet_partner_applications enable row level security; alter table public.fleet_lifecycle_history enable row level security; alter table public.vehicle_lifecycle_history enable row level security; alter table public.compliance_requirement_definitions enable row level security; alter table public.compliance_evidence enable row level security; alter table public.fleet_settlement_profiles enable row level security; alter table public.order_vehicle_ownership_snapshots enable row level security;
create policy fleet_applicant_read on public.fleet_partner_applications for select to authenticated using(applicant_user_id=auth.uid() or public.has_permission('platform.fleets.read',null) or public.has_permission('platform.vehicles.manage',null));
create policy fleet_history_admin_read on public.fleet_lifecycle_history for select to authenticated using(public.has_permission('platform.fleets.read',null) or public.has_permission('platform.vehicles.manage',null));
create policy vehicle_history_related_read on public.vehicle_lifecycle_history for select to authenticated using(public.has_permission('platform.fleets.read',null) or exists(select 1 from public.vehicles v where v.id=vehicle_id and v.owner_user_id=auth.uid()));
create policy vehicle_relationship_related_read on public.vehicle_party_relationships for select to authenticated using(public.has_permission('platform.fleets.read',null) or exists(select 1 from public.vehicles v where v.id=vehicle_id and v.owner_user_id=auth.uid()) or exists(select 1 from public.driver_vehicle_links l join public.driver_profiles d on d.id=l.driver_profile_id where l.vehicle_id=vehicle_party_relationships.vehicle_id and d.user_id=auth.uid()));
create policy relationship_events_related_read on public.vehicle_relationship_events for select to authenticated using(public.has_permission('platform.fleets.read',null) or exists(select 1 from public.vehicles v where v.id=vehicle_id and v.owner_user_id=auth.uid()));
create policy compliance_definitions_read on public.compliance_requirement_definitions for select to authenticated using(status='active' or public.has_permission('platform.fleets.manage',null));
create policy compliance_evidence_related_read on public.compliance_evidence for select to authenticated using(public.has_permission('platform.fleet_compliance.read',null) or public.has_permission('platform.vehicles.manage',null) or (subject_type='driver' and exists(select 1 from public.driver_profiles d where d.id=subject_id and d.user_id=auth.uid())) or (subject_type='vehicle' and exists(select 1 from public.vehicles v where v.id=subject_id and v.owner_user_id=auth.uid())));

revoke execute on function public.review_fleet_partner(uuid,text,text) from authenticated;
revoke all on public.vehicle_party_relationships,public.vehicle_relationship_events,public.fleet_partner_applications,public.fleet_lifecycle_history,public.vehicle_lifecycle_history,public.compliance_requirement_definitions,public.compliance_evidence,public.fleet_settlement_profiles,public.order_vehicle_ownership_snapshots from anon,authenticated;
grant select on public.vehicle_party_relationships,public.vehicle_relationship_events,public.fleet_partner_applications,public.fleet_lifecycle_history,public.vehicle_lifecycle_history,public.compliance_requirement_definitions,public.compliance_evidence,public.subject_compliance_status to authenticated;
grant all on public.vehicle_party_relationships,public.vehicle_relationship_events,public.fleet_partner_applications,public.fleet_lifecycle_history,public.vehicle_lifecycle_history,public.compliance_requirement_definitions,public.compliance_evidence,public.fleet_settlement_profiles,public.order_vehicle_ownership_snapshots to service_role;
grant execute on function public.record_compliance_evidence(text,text,uuid,uuid,date,date,text,text) to authenticated,service_role;
grant execute on function public.resubmit_fleet_application(uuid,jsonb,text,text),public.enforce_expired_compliance(integer) to authenticated,service_role;
grant execute on function public.evaluate_driver_vehicle_eligibility(uuid,uuid,text),public.read_fleet_admin_workspace(text,text),public.read_my_vehicle_workspace() to authenticated,service_role;
grant execute on function public.submit_fleet_application(text,text,text,jsonb,text,text),public.review_fleet_application(uuid,text,text,text),public.decide_vehicle_lifecycle(uuid,text,text,text),public.set_vehicle_party_relationship(uuid,text,uuid,text,timestamptz,text,text,text,jsonb) to authenticated,service_role;

commit;
