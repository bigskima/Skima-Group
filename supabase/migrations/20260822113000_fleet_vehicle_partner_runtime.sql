begin;

-- Fleet partners are reusable asset-owning/operating counterparties. They do not
-- encode a service vertical and ownership remains independent of driver identity.
create table public.fleet_partners (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references public.profiles(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete restrict,
  partner_kind text not null check (partner_kind in ('individual_owner','company','fleet_operator')),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 160),
  verification_status text not null default 'pending' check (verification_status in ('pending','approved','suspended','rejected')),
  operational_status text not null default 'inactive' check (operational_status in ('inactive','active','suspended','closed')),
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  decision_reason text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  check (owner_user_id is not null or organization_id is not null),
  check (operational_status <> 'active' or verification_status='approved')
);

create index fleet_partners_review_idx on public.fleet_partners(verification_status,operational_status,created_at desc);
create index fleet_partners_owner_idx on public.fleet_partners(owner_user_id,organization_id);

create table public.fleet_partner_documents (
  id uuid primary key default gen_random_uuid(),
  fleet_partner_id uuid not null references public.fleet_partners(id) on delete restrict,
  document_submission_id uuid not null references public.document_submissions(id) on delete restrict,
  purpose_key text not null check (purpose_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  status text not null default 'current' check (status in ('current','superseded','revoked')),
  valid_from date,
  valid_until date,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc',now()),
  check (valid_until is null or valid_from is null or valid_until>=valid_from),
  unique(fleet_partner_id,document_submission_id)
);

alter table public.vehicles add column if not exists fleet_partner_id uuid references public.fleet_partners(id) on delete restrict;
alter table public.vehicles add column if not exists ownership_relationship text;
update public.vehicles set ownership_relationship=case when ownership_type='fleet_assigned' then 'fleet_owned' else ownership_type end where ownership_relationship is null;
alter table public.vehicles alter column ownership_relationship set default 'driver_owned';
alter table public.vehicles alter column ownership_relationship set not null;
alter table public.vehicles add constraint vehicles_ownership_relationship_check check (ownership_relationship in ('driver_owned','business_owned','fleet_owned','leased','rented','third_party_authorized')) not valid;
alter table public.vehicles validate constraint vehicles_ownership_relationship_check;
alter table public.vehicles add constraint vehicles_fleet_owner_required_check check (ownership_relationship<>'fleet_owned' or fleet_partner_id is not null) not valid;
alter table public.vehicles validate constraint vehicles_fleet_owner_required_check;

-- Replace the legacy all-time uniqueness rule with one-current-assignment rules.
alter table public.driver_vehicle_links drop constraint if exists driver_vehicle_links_driver_profile_id_vehicle_id_relationship_key;
alter table public.driver_vehicle_links drop constraint if exists driver_vehicle_links_relationship_type_check;
alter table public.driver_vehicle_links add constraint driver_vehicle_links_relationship_type_check
  check (relationship_type in ('driver_owned','business_owned','fleet_owned','leased','rented','third_party_authorized')) not valid;
update public.driver_vehicle_links
set relationship_type = case when relationship_type = 'fleet_assigned' then 'fleet_owned' else 'third_party_authorized' end
where relationship_type not in ('driver_owned','business_owned','fleet_owned','leased','rented','third_party_authorized');
alter table public.driver_vehicle_links validate constraint driver_vehicle_links_relationship_type_check;

-- Resolve legacy active-link conflicts deterministically before installing the
-- current-assignment indexes. The displaced rows remain immutable history.
with ranked as (
  select id,
    row_number() over (partition by driver_profile_id order by starts_at desc,created_at desc,id desc) as driver_rank,
    row_number() over (partition by vehicle_id order by starts_at desc,created_at desc,id desc) as vehicle_rank
  from public.driver_vehicle_links
  where status='active' and ends_at is null
)
update public.driver_vehicle_links link
set status='revoked',
    ends_at=greatest(timezone('utc',now()),link.starts_at+interval '1 millisecond'),
    metadata=link.metadata||jsonb_build_object('migrationConflictResolution',true),
    updated_at=timezone('utc',now())
from ranked
where ranked.id=link.id and (ranked.driver_rank>1 or ranked.vehicle_rank>1);
create unique index driver_vehicle_links_one_current_driver_vehicle_idx on public.driver_vehicle_links(driver_profile_id,vehicle_id) where status='active' and ends_at is null;
create unique index driver_vehicle_links_one_current_driver_idx on public.driver_vehicle_links(driver_profile_id) where status='active' and ends_at is null;
create unique index driver_vehicle_links_one_current_vehicle_idx on public.driver_vehicle_links(vehicle_id) where status='active' and ends_at is null;

create or replace view public.vehicle_assignment_compliance
with (security_invoker=true) as
select link.id as assignment_id, link.driver_profile_id, link.vehicle_id,
  driver.verification_status='approved' as driver_approved,
  vehicle.status='active' as vehicle_approved,
  link.status='active' and link.starts_at<=timezone('utc',now()) and (link.ends_at is null or link.ends_at>timezone('utc',now())) as assignment_active,
  (vehicle.insurance_expires_at is null or vehicle.insurance_expires_at>=current_date)
    and (vehicle.inspection_expires_at is null or vehicle.inspection_expires_at>=current_date)
    and (vehicle.roadworthiness_expires_at is null or vehicle.roadworthiness_expires_at>=current_date) as vehicle_documents_valid,
  case when fleet.id is null then true else fleet.verification_status='approved' and fleet.operational_status='active' end as owner_approved,
  array_remove(array[
    case when driver.verification_status<>'approved' then 'driver_not_approved' end,
    case when vehicle.status<>'active' then 'vehicle_not_approved' end,
    case when not (link.status='active' and link.starts_at<=timezone('utc',now()) and (link.ends_at is null or link.ends_at>timezone('utc',now()))) then 'assignment_inactive' end,
    case when vehicle.insurance_expires_at<current_date then 'insurance_expired' end,
    case when vehicle.inspection_expires_at<current_date then 'inspection_expired' end,
    case when vehicle.roadworthiness_expires_at<current_date then 'roadworthiness_expired' end,
    case when fleet.id is not null and (fleet.verification_status<>'approved' or fleet.operational_status<>'active') then 'fleet_partner_inactive' end
  ],null) as warnings
from public.driver_vehicle_links link
join public.driver_profiles driver on driver.id=link.driver_profile_id
join public.vehicles vehicle on vehicle.id=link.vehicle_id
left join public.fleet_partners fleet on fleet.id=vehicle.fleet_partner_id;

create or replace function public.guard_dispatch_driver_vehicle_pair() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare vehicle_id uuid; eligible boolean;
begin
  if new.candidate_entity_type<>'driver' then return new; end if;
  vehicle_id:=nullif(new.rationale->>'vehicle_id','')::uuid;
  if vehicle_id is null then raise exception 'dispatch candidate must identify a driver and vehicle combination'; end if;
  select driver_approved and vehicle_approved and assignment_active and vehicle_documents_valid and owner_approved
  into eligible from public.vehicle_assignment_compliance
  where driver_profile_id=new.candidate_entity_id and public.vehicle_assignment_compliance.vehicle_id=vehicle_id;
  if not coalesce(eligible,false) then raise exception 'driver and vehicle combination is not operationally eligible'; end if;
  return new;
end; $$;
drop trigger if exists guard_dispatch_driver_vehicle_pair on public.dispatch_candidates;
create trigger guard_dispatch_driver_vehicle_pair before insert or update on public.dispatch_candidates for each row execute function public.guard_dispatch_driver_vehicle_pair();

create or replace function public.review_fleet_partner(target_fleet_partner_id uuid,target_status text,target_reason text)
returns public.fleet_partners language plpgsql security definer set search_path=public,pg_temp as $$
declare result public.fleet_partners;
begin
  if not public.has_permission('platform.vehicles.manage',null) then raise exception 'fleet review permission is required'; end if;
  if target_status not in ('approved','suspended','rejected') then raise exception 'invalid fleet decision'; end if;
  if nullif(btrim(target_reason),'') is null then raise exception 'decision reason is required'; end if;
  update public.fleet_partners set verification_status=target_status,
    operational_status=case when target_status='approved' then 'active' else 'suspended' end,
    verified_by=auth.uid(),verified_at=timezone('utc',now()),decision_reason=btrim(target_reason),updated_at=timezone('utc',now())
  where id=target_fleet_partner_id and auth.uid() is distinct from owner_user_id returning * into result;
  if result.id is null then raise exception 'fleet partner not found or self approval attempted'; end if;
  return result;
end; $$;

create or replace function public.assign_driver_vehicle(target_driver_profile_id uuid,target_vehicle_id uuid,target_relationship text,target_starts_at timestamptz default timezone('utc',now()),target_metadata jsonb default '{}'::jsonb)
returns public.driver_vehicle_links language plpgsql security definer set search_path=public,pg_temp as $$
declare result public.driver_vehicle_links;
begin
  if not public.has_permission('platform.vehicles.manage',null) then raise exception 'vehicle assignment permission is required'; end if;
  if target_relationship not in ('driver_owned','business_owned','fleet_owned','leased','rented','third_party_authorized') then raise exception 'invalid ownership relationship'; end if;
  if not exists(select 1 from public.driver_profiles where id=target_driver_profile_id and verification_status='approved') then raise exception 'driver must be approved'; end if;
  if not exists(select 1 from public.vehicles where id=target_vehicle_id and status='active') then raise exception 'vehicle must be approved'; end if;
  update public.driver_vehicle_links set status='revoked',ends_at=greatest(target_starts_at,starts_at+interval '1 millisecond'),updated_at=timezone('utc',now()) where status='active' and ends_at is null and (driver_profile_id=target_driver_profile_id or vehicle_id=target_vehicle_id);
  insert into public.driver_vehicle_links(driver_profile_id,vehicle_id,relationship_type,status,authorized_by,starts_at,metadata,created_by)
  values(target_driver_profile_id,target_vehicle_id,target_relationship,'active',auth.uid(),target_starts_at,coalesce(target_metadata,'{}'::jsonb),auth.uid()) returning * into result;
  return result;
end; $$;

create or replace function public.end_driver_vehicle_assignment(target_assignment_id uuid,target_reason text)
returns public.driver_vehicle_links language plpgsql security definer set search_path=public,pg_temp as $$
declare result public.driver_vehicle_links;
begin
  if not public.has_permission('platform.vehicles.manage',null) then raise exception 'vehicle assignment permission is required'; end if;
  update public.driver_vehicle_links set status='revoked',ends_at=timezone('utc',now()),metadata=metadata||jsonb_build_object('endReason',target_reason,'endedBy',auth.uid()),updated_at=timezone('utc',now()) where id=target_assignment_id and status='active' returning * into result;
  if result.id is null then raise exception 'active assignment not found'; end if;
  return result;
end; $$;

alter table public.fleet_partners enable row level security;
alter table public.fleet_partner_documents enable row level security;
create policy fleet_partners_read_related on public.fleet_partners for select to authenticated using (owner_user_id=auth.uid() or (organization_id is not null and public.is_organization_member(organization_id)) or public.has_permission('platform.vehicles.manage',organization_id));
create policy fleet_partners_submit on public.fleet_partners for insert to authenticated with check (owner_user_id=auth.uid() and verification_status='pending' and operational_status='inactive');
create policy fleet_partners_admin_manage on public.fleet_partners for all to authenticated using(public.has_permission('platform.vehicles.manage',organization_id)) with check(public.has_permission('platform.vehicles.manage',organization_id));
create policy fleet_documents_read_related on public.fleet_partner_documents for select to authenticated using(exists(select 1 from public.fleet_partners f where f.id=fleet_partner_id and (f.owner_user_id=auth.uid() or public.has_permission('platform.vehicles.manage',f.organization_id))));
create policy fleet_documents_admin_manage on public.fleet_partner_documents for all to authenticated using(public.has_permission('platform.vehicles.manage',null)) with check(public.has_permission('platform.vehicles.manage',null));

drop trigger if exists set_fleet_partners_updated_at on public.fleet_partners;
create trigger set_fleet_partners_updated_at before update on public.fleet_partners for each row execute function public.set_updated_at();
drop trigger if exists audit_fleet_partners on public.fleet_partners;
create trigger audit_fleet_partners after insert or update or delete on public.fleet_partners for each row execute function public.record_table_audit();
drop trigger if exists audit_fleet_partner_documents on public.fleet_partner_documents;
create trigger audit_fleet_partner_documents after insert or update or delete on public.fleet_partner_documents for each row execute function public.record_table_audit();

grant select,insert on public.fleet_partners to authenticated;
grant select on public.fleet_partner_documents,public.vehicle_assignment_compliance to authenticated;
grant all on public.fleet_partners,public.fleet_partner_documents to service_role;
revoke all on function public.review_fleet_partner(uuid,text,text),public.assign_driver_vehicle(uuid,uuid,text,timestamptz,jsonb),public.end_driver_vehicle_assignment(uuid,text) from public,anon;
grant execute on function public.review_fleet_partner(uuid,text,text),public.assign_driver_vehicle(uuid,uuid,text,timestamptz,jsonb),public.end_driver_vehicle_assignment(uuid,text) to authenticated,service_role;

commit;
