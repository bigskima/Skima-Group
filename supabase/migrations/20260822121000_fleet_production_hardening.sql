begin;

create table public.fleet_application_document_requirements(
  key text primary key,
  partner_kinds text[] not null,
  display_name text not null,
  document_purpose_key text not null,
  required boolean not null default true,
  minimum_count integer not null default 1 check(minimum_count between 1 and 20),
  status text not null default 'active' check(status in('active','retired')),
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now())
);

create table public.fleet_application_documents(
  id uuid primary key default gen_random_uuid(),
  fleet_application_id uuid not null references public.fleet_partner_applications(id) on delete restrict,
  requirement_key text not null references public.fleet_application_document_requirements(key) on delete restrict,
  document_submission_id uuid not null references public.document_submissions(id) on delete restrict,
  status text not null default 'current' check(status in('current','superseded','revoked')),
  linked_by uuid references public.profiles(id) on delete set null default auth.uid(),
  linked_at timestamptz not null default timezone('utc',now()),
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  unique(fleet_application_id,document_submission_id)
);
create unique index fleet_application_one_current_document_idx
on public.fleet_application_documents(fleet_application_id,requirement_key)
where status='current';

insert into public.fleet_application_document_requirements(key,partner_kinds,display_name,document_purpose_key) values
('fleet.identity',array['individual_owner','company','fleet_operator'],'Owner or company identity','fleet.identity'),
('fleet.registration',array['company','fleet_operator'],'Company or operator registration','fleet.registration'),
('fleet.address',array['individual_owner','company','fleet_operator'],'Operating address evidence','fleet.address')
on conflict(key) do update set partner_kinds=excluded.partner_kinds,display_name=excluded.display_name,document_purpose_key=excluded.document_purpose_key,status='active';

create table public.fleet_authorized_staff(
  id uuid primary key default gen_random_uuid(),
  fleet_partner_id uuid not null references public.fleet_partners(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  access_role text not null check(access_role in('owner_admin','fleet_manager','vehicle_manager','compliance_viewer')),
  status text not null default 'active' check(status in('active','suspended','revoked')),
  starts_at timestamptz not null default timezone('utc',now()),
  ends_at timestamptz,
  reason text not null,
  authorized_by uuid references public.profiles(id) on delete set null default auth.uid(),
  idempotency_key text not null unique,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  check(ends_at is null or ends_at>starts_at)
);
create unique index fleet_one_current_staff_role_idx on public.fleet_authorized_staff(fleet_partner_id,user_id,access_role) where status='active' and ends_at is null;

create or replace function public.is_fleet_staff(target_fleet_partner_id uuid,target_roles text[] default null)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.fleet_partners f where f.id=target_fleet_partner_id and f.owner_user_id=auth.uid())
  or exists(select 1 from public.fleet_authorized_staff s where s.fleet_partner_id=target_fleet_partner_id and s.user_id=auth.uid() and s.status='active' and s.starts_at<=timezone('utc',now()) and (s.ends_at is null or s.ends_at>timezone('utc',now())) and (target_roles is null or s.access_role=any(target_roles)))
$$;

create or replace function public.link_fleet_application_document(target_application_id uuid,target_requirement_key text,target_document_submission_id uuid,target_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare app record;doc record;result uuid;
begin
 select * into app from public.fleet_partner_applications where id=target_application_id for update;
 if not found or (app.applicant_user_id<>auth.uid() and not public.has_permission('platform.fleets.review',null)) then raise exception 'fleet application access is required'; end if;
 if app.status not in('draft','submitted','correction_required','resubmitted') then raise exception 'fleet application no longer accepts documents'; end if;
 if not exists(select 1 from public.fleet_application_document_requirements r where r.key=target_requirement_key and r.status='active' and app.partner_kind=any(r.partner_kinds)) then raise exception 'applicable fleet document requirement is required'; end if;
 select * into doc from public.document_submissions where id=target_document_submission_id and owner_user_id=app.applicant_user_id and status in('submitted','under_review','approved');
 if not found then raise exception 'submitted applicant-owned document is required'; end if;
 update public.fleet_application_documents set status='superseded',metadata=metadata||jsonb_build_object('supersededByIdempotencyKey',target_idempotency_key) where fleet_application_id=app.id and requirement_key=target_requirement_key and status='current';
 insert into public.fleet_application_documents(fleet_application_id,requirement_key,document_submission_id,metadata) values(app.id,target_requirement_key,target_document_submission_id,jsonb_build_object('idempotencyKey',target_idempotency_key)) returning id into result;
 return result;
end $$;

create or replace function public.fleet_application_compliance(target_application_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with app as(select * from public.fleet_partner_applications where id=target_application_id), required as(
  select r.* from app join public.fleet_application_document_requirements r on app.partner_kind=any(r.partner_kinds) where r.required and r.status='active'
 ), failures as(
  select r.key from required r where (select count(*) from public.fleet_application_documents l join public.document_submissions d on d.id=l.document_submission_id where l.fleet_application_id=target_application_id and l.requirement_key=r.key and l.status='current' and d.status='approved')<r.minimum_count
 ) select jsonb_build_object('compliant',not exists(select 1 from failures),'failures',coalesce((select jsonb_agg(key order by key) from failures),'[]'::jsonb))
$$;

create or replace function public.review_fleet_application(target_application_id uuid,target_decision text,target_reason text,target_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare app record;partner_id uuid;event_key text;compliance jsonb;
begin
 if not public.has_permission('platform.fleets.review',null) then raise exception 'fleet review permission is required'; end if;
 if target_decision not in('approved','rejected','correction_required','suspended') or nullif(btrim(target_reason),'') is null or nullif(btrim(target_idempotency_key),'') is null then raise exception 'valid decision, reason, and idempotency key are required'; end if;
 select * into app from public.fleet_partner_applications where id=target_application_id for update;
 if not found then raise exception 'fleet application not found'; end if;
 if app.applicant_user_id=auth.uid() then raise exception 'fleet applications cannot be self-approved'; end if;
 if target_decision in('approved','rejected','correction_required') and app.status not in('submitted','resubmitted') then raise exception 'fleet application is not awaiting review'; end if;
 if target_decision='suspended' and (app.status<>'approved' or app.fleet_partner_id is null) then raise exception 'only an approved fleet partner can be suspended'; end if;
 if exists(select 1 from public.fleet_lifecycle_history where idempotency_key=target_idempotency_key) then return coalesce(app.fleet_partner_id,app.id); end if;
 if target_decision='approved' then
  compliance:=public.fleet_application_compliance(app.id);
  if not coalesce((compliance->>'compliant')::boolean,false) then raise exception 'fleet application has unmet document requirements: %',compliance->'failures'; end if;
  insert into public.fleet_partners(owner_user_id,partner_kind,display_name,verification_status,operational_status,verified_by,verified_at,decision_reason,metadata)
  values(app.applicant_user_id,app.partner_kind,app.legal_name,'approved','active',auth.uid(),timezone('utc',now()),target_reason,jsonb_build_object('applicationId',app.id)) returning id into partner_id;
  insert into public.fleet_authorized_staff(fleet_partner_id,user_id,access_role,reason,authorized_by,idempotency_key) values(partner_id,app.applicant_user_id,'owner_admin','Fleet owner access granted at approval.',auth.uid(),target_idempotency_key||':owner');
  event_key:='event.fleet.approved';
 elsif target_decision='suspended' then
  partner_id:=app.fleet_partner_id; update public.fleet_partners set verification_status='suspended',operational_status='suspended',decision_reason=target_reason,updated_at=timezone('utc',now()) where id=partner_id; event_key:='event.fleet.suspended';
 elsif target_decision='rejected' then event_key:='event.fleet.rejected'; end if;
 update public.fleet_partner_applications set status=target_decision,fleet_partner_id=coalesce(partner_id,fleet_partner_id),updated_at=timezone('utc',now()) where id=app.id;
 insert into public.fleet_lifecycle_history(fleet_application_id,fleet_partner_id,from_status,to_status,reason,actor_user_id,idempotency_key) values(app.id,partner_id,app.status,target_decision,btrim(target_reason),auth.uid(),target_idempotency_key);
 if event_key is not null then insert into public.event_log(event_type_key,source,subject_type,subject_id,actor_user_id,idempotency_key,payload,status) values(event_key,'skima.fleet.workflow',case when partner_id is null then 'fleet_application' else 'fleet_partner' end,coalesce(partner_id,app.id),auth.uid(),target_idempotency_key,jsonb_build_object('applicationId',app.id,'reason',btrim(target_reason)),'processed') on conflict(source,idempotency_key) do nothing; end if;
 return coalesce(partner_id,app.id);
end $$;

create or replace function public.assign_driver_vehicle(target_driver_profile_id uuid,target_vehicle_id uuid,target_relationship text,target_starts_at timestamptz default timezone('utc',now()),target_metadata jsonb default '{}')
returns public.driver_vehicle_links language plpgsql security definer set search_path=public,pg_temp as $$
declare result public.driver_vehicle_links;start_time timestamptz:=coalesce(target_starts_at,timezone('utc',now()));
begin
 if not public.has_permission('platform.fleets.manage',null) and not public.has_permission('platform.vehicles.manage',null) then raise exception 'vehicle assignment permission is required'; end if;
 if target_relationship not in('driver_owned','business_owned','fleet_owned','leased','rented','third_party_authorized') then raise exception 'invalid assignment relationship'; end if;
 perform pg_advisory_xact_lock(hashtextextended(target_driver_profile_id::text,0)); perform pg_advisory_xact_lock(hashtextextended(target_vehicle_id::text,0));
 if not exists(select 1 from public.driver_profiles where id=target_driver_profile_id and verification_status='approved') then raise exception 'driver must be approved'; end if;
 if not exists(select 1 from public.vehicles where id=target_vehicle_id and status='active') then raise exception 'vehicle must be approved'; end if;
 update public.driver_vehicle_links set status='revoked',ends_at=greatest(start_time,starts_at+interval '1 millisecond'),metadata=metadata||jsonb_build_object('reassignedBy',auth.uid()),updated_at=timezone('utc',now()) where status='active' and ends_at is null and (driver_profile_id=target_driver_profile_id or vehicle_id=target_vehicle_id);
 insert into public.driver_vehicle_links(driver_profile_id,vehicle_id,relationship_type,status,authorized_by,starts_at,metadata,created_by) values(target_driver_profile_id,target_vehicle_id,target_relationship,'active',auth.uid(),start_time,coalesce(target_metadata,'{}'),auth.uid()) returning * into result;
 return result;
end $$;

create or replace function public.read_my_fleet_workspace()
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
  'applications',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from public.fleet_partner_applications a where a.applicant_user_id=auth.uid()),'[]'::jsonb),
  'partners',coalesce((select jsonb_agg(to_jsonb(f)) from public.fleet_partners f where public.is_fleet_staff(f.id,null)),'[]'::jsonb),
  'vehicles',coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc) from public.vehicles v where exists(select 1 from public.vehicle_party_relationships r where r.vehicle_id=v.id and r.status='active' and r.valid_until is null and r.party_type='fleet_partner' and public.is_fleet_staff(r.party_id,null))),'[]'::jsonb),
  'assignments',coalesce((select jsonb_agg(to_jsonb(l) order by l.starts_at desc) from public.driver_vehicle_links l where exists(select 1 from public.vehicle_party_relationships r where r.vehicle_id=l.vehicle_id and r.status='active' and r.valid_until is null and r.party_type='fleet_partner' and public.is_fleet_staff(r.party_id,null))),'[]'::jsonb),
  'staff',coalesce((select jsonb_agg(to_jsonb(s)) from public.fleet_authorized_staff s where public.is_fleet_staff(s.fleet_partner_id,array['owner_admin','fleet_manager'])),'[]'::jsonb)
 )
$$;

alter table public.fleet_application_document_requirements enable row level security;
alter table public.fleet_application_documents enable row level security;
alter table public.fleet_authorized_staff enable row level security;
create policy fleet_requirements_read on public.fleet_application_document_requirements for select to authenticated using(status='active' or public.has_permission('platform.fleets.manage',null));
create policy fleet_application_documents_read on public.fleet_application_documents for select to authenticated using(exists(select 1 from public.fleet_partner_applications a where a.id=fleet_application_id and (a.applicant_user_id=auth.uid() or public.has_permission('platform.fleets.review',null))));
create policy fleet_staff_related_read on public.fleet_authorized_staff for select to authenticated using(public.is_fleet_staff(fleet_partner_id,null) or public.has_permission('platform.fleets.read',null));
revoke all on public.fleet_application_document_requirements,public.fleet_application_documents,public.fleet_authorized_staff from anon,authenticated;
grant select on public.fleet_application_document_requirements,public.fleet_application_documents,public.fleet_authorized_staff to authenticated;
grant all on public.fleet_application_document_requirements,public.fleet_application_documents,public.fleet_authorized_staff to service_role;
grant execute on function public.is_fleet_staff(uuid,text[]),public.link_fleet_application_document(uuid,text,uuid,text),public.fleet_application_compliance(uuid),public.read_my_fleet_workspace() to authenticated,service_role;

commit;
