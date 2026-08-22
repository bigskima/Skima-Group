create table public.driver_participation_programs (
  key text primary key,
  display_name text not null,
  public_label text not null,
  description text not null,
  program_type text not null check (program_type in ('baseline','priority')),
  is_default boolean not null default false,
  public_visible boolean not null default true,
  status text not null default 'active' check (status in ('active','paused','retired')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_by uuid null references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now())
);

create unique index driver_participation_programs_one_default_idx
  on public.driver_participation_programs ((is_default))
  where is_default=true and status='active';

create table public.driver_program_memberships (
  id uuid primary key default gen_random_uuid(),
  driver_profile_id uuid not null references public.driver_profiles(id) on delete restrict,
  program_key text not null references public.driver_participation_programs(key) on delete restrict,
  status text not null default 'active' check (status in ('active','ended','suspended')),
  starts_at timestamptz not null default timezone('utc',now()),
  ends_at timestamptz null,
  assigned_by uuid null references public.profiles(id) on delete set null default auth.uid(),
  assignment_reason text null check (assignment_reason is null or char_length(assignment_reason)<=1000),
  source text not null default 'skima.driver_participation',
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  constraint driver_program_membership_time_check check (ends_at is null or ends_at>starts_at),
  constraint driver_program_membership_source_idempotency_unique unique(source,idempotency_key)
);

create unique index driver_program_memberships_one_active_idx
  on public.driver_program_memberships(driver_profile_id)
  where status='active' and ends_at is null;
create index driver_program_memberships_history_idx
  on public.driver_program_memberships(driver_profile_id,created_at desc);
create index driver_program_memberships_program_idx
  on public.driver_program_memberships(program_key,status,created_at desc);

alter table public.driver_participation_programs enable row level security;
alter table public.driver_program_memberships enable row level security;
revoke all on table public.driver_participation_programs from public,anon,authenticated;
revoke all on table public.driver_program_memberships from public,anon,authenticated;
grant all on table public.driver_participation_programs to service_role;
grant all on table public.driver_program_memberships to service_role;

drop trigger if exists set_driver_participation_programs_updated_at on public.driver_participation_programs;
create trigger set_driver_participation_programs_updated_at
before update on public.driver_participation_programs
for each row execute function public.set_updated_at();

drop trigger if exists set_driver_program_memberships_updated_at on public.driver_program_memberships;
create trigger set_driver_program_memberships_updated_at
before update on public.driver_program_memberships
for each row execute function public.set_updated_at();

drop trigger if exists audit_driver_participation_programs_governance_mutations on public.driver_participation_programs;
create trigger audit_driver_participation_programs_governance_mutations
after insert or update or delete on public.driver_participation_programs
for each row execute function public.record_table_audit();

drop trigger if exists audit_driver_program_memberships_governance_mutations on public.driver_program_memberships;
create trigger audit_driver_program_memberships_governance_mutations
after insert or update or delete on public.driver_program_memberships
for each row execute function public.record_table_audit();

insert into public.driver_participation_programs(
  key,display_name,public_label,description,program_type,is_default,public_visible,status,metadata
) values
(
  'driver.independent',
  'Independent Driver Partner',
  'Independent Driver Partner',
  'Default SKIMA driver participation class for approved independent driver partners.',
  'baseline',true,true,'active',
  jsonb_build_object('adminAssignable',true,'selfSelectable',false)
),
(
  'driver.skima_special',
  'SKIMA Special Driver',
  'SKIMA Special Driver',
  'Admin-assigned SKIMA service class with a bounded dispatch preference. It does not change vehicle ownership or driver identity.',
  'priority',false,true,'active',
  jsonb_build_object('adminAssignable',true,'selfSelectable',false,'requiresApprovedDriver',true)
)
on conflict(key) do update
set display_name=excluded.display_name,
    public_label=excluded.public_label,
    description=excluded.description,
    program_type=excluded.program_type,
    is_default=excluded.is_default,
    public_visible=excluded.public_visible,
    status=excluded.status,
    metadata=public.driver_participation_programs.metadata || excluded.metadata,
    updated_at=timezone('utc',now());

insert into public.driver_program_memberships(
  driver_profile_id,program_key,status,starts_at,assigned_by,assignment_reason,source,idempotency_key,metadata
)
select driver.id,'driver.independent','active',coalesce(driver.approved_at,driver.created_at),null,
       'Default participation class established by SKIMA.',
       'skima.driver_participation.backfill','independent:'||driver.id::text,
       jsonb_build_object('backfilled',true)
from public.driver_profiles driver
where not exists (
  select 1 from public.driver_program_memberships membership
  where membership.driver_profile_id=driver.id and membership.status='active' and membership.ends_at is null
)
on conflict(source,idempotency_key) do nothing;

create or replace function public.ensure_default_driver_participation()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  insert into public.driver_program_memberships(
    driver_profile_id,program_key,status,starts_at,assigned_by,assignment_reason,source,idempotency_key,metadata
  ) values (
    new.id,'driver.independent','active',timezone('utc',now()),null,
    'Default participation class established by SKIMA.',
    'skima.driver_participation.default','independent:'||new.id::text,
    jsonb_build_object('automatic',true)
  )
  on conflict(source,idempotency_key) do nothing;
  return new;
end;
$$;

revoke all on function public.ensure_default_driver_participation() from public,anon,authenticated;

drop trigger if exists trg_ensure_default_driver_participation on public.driver_profiles;
create trigger trg_ensure_default_driver_participation
after insert on public.driver_profiles
for each row execute function public.ensure_default_driver_participation();

create or replace function public.read_current_driver_participation(target_driver_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare result jsonb;
begin
  if target_driver_profile_id is null then
    raise exception using errcode='22023',message='driver profile id is required';
  end if;

  select jsonb_build_object(
    'membershipId',membership.id,
    'driverProfileId',membership.driver_profile_id,
    'programKey',program.key,
    'displayName',program.display_name,
    'publicLabel',program.public_label,
    'programType',program.program_type,
    'isDefault',program.is_default,
    'publicVisible',program.public_visible,
    'startsAt',membership.starts_at
  )
  into result
  from public.driver_program_memberships membership
  join public.driver_participation_programs program on program.key=membership.program_key
  where membership.driver_profile_id=target_driver_profile_id
    and membership.status='active'
    and membership.ends_at is null
    and membership.starts_at<=timezone('utc',now())
    and program.status='active'
  order by membership.starts_at desc
  limit 1;

  if result is null then
    select jsonb_build_object(
      'membershipId',null,
      'driverProfileId',target_driver_profile_id,
      'programKey',program.key,
      'displayName',program.display_name,
      'publicLabel',program.public_label,
      'programType',program.program_type,
      'isDefault',program.is_default,
      'publicVisible',program.public_visible,
      'startsAt',null
    ) into result
    from public.driver_participation_programs program
    where program.is_default=true and program.status='active'
    limit 1;
  end if;

  return result;
end;
$$;

create or replace function public.read_driver_public_participation(target_driver_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare current_program jsonb;
begin
  current_program:=public.read_current_driver_participation(target_driver_profile_id);
  if current_program is null or coalesce((current_program->>'publicVisible')::boolean,false)=false then
    return jsonb_build_object('publicLabel','SKIMA Driver','isSpecial',false);
  end if;
  return jsonb_build_object(
    'publicLabel',current_program->>'publicLabel',
    'isSpecial',(current_program->>'programKey')='driver.skima_special'
  );
end;
$$;

create or replace function public.read_driver_participation_admin(target_driver_profile_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare result jsonb;
begin
  if auth.role()<>'service_role'
    and not public.has_permission('platform.drivers.read',null)
    and not public.has_permission('platform.drivers.manage',null)
    and not public.has_permission('platform.drivers.verify',null) then
    raise exception using errcode='42501',message='driver read permission required';
  end if;

  select coalesce(jsonb_agg(row_data order by display_name asc),'[]'::jsonb)
  into result
  from (
    select
      coalesce(driver.driver_display_name,driver.public_driver_id,'SKIMA Driver') as display_name,
      jsonb_build_object(
        'driverProfileId',driver.id,
        'userId',driver.user_id,
        'organizationId',driver.organization_id,
        'displayName',coalesce(driver.driver_display_name,'SKIMA Driver'),
        'publicDriverId',driver.public_driver_id,
        'verificationStatus',driver.verification_status,
        'operationalStatus',driver.operational_status,
        'approvedAt',driver.approved_at,
        'programKey',coalesce(program.key,'driver.independent'),
        'programLabel',coalesce(program.display_name,'Independent Driver Partner'),
        'programPublicLabel',coalesce(program.public_label,'Independent Driver Partner'),
        'programType',coalesce(program.program_type,'baseline'),
        'membershipId',membership.id,
        'programStartsAt',membership.starts_at,
        'activeVehicleCount',coalesce(vehicle_summary.active_vehicle_count,0),
        'vehicleRelationshipTypes',coalesce(vehicle_summary.relationship_types,'[]'::jsonb),
        'serviceAreaCount',coalesce(area_summary.service_area_count,0)
      ) as row_data
    from public.driver_profiles driver
    left join lateral (
      select m.*
      from public.driver_program_memberships m
      where m.driver_profile_id=driver.id and m.status='active' and m.ends_at is null and m.starts_at<=timezone('utc',now())
      order by m.starts_at desc
      limit 1
    ) membership on true
    left join public.driver_participation_programs program on program.key=membership.program_key
    left join lateral (
      select count(*)::integer as active_vehicle_count,
             coalesce(jsonb_agg(distinct link.relationship_type),'[]'::jsonb) as relationship_types
      from public.driver_vehicle_links link
      where link.driver_profile_id=driver.id
        and link.status='active'
        and link.starts_at<=timezone('utc',now())
        and (link.ends_at is null or link.ends_at>timezone('utc',now()))
    ) vehicle_summary on true
    left join lateral (
      select count(*)::integer as service_area_count
      from public.driver_service_areas area
      where area.driver_profile_id=driver.id and area.status='active'
    ) area_summary on true
    where target_driver_profile_id is null or driver.id=target_driver_profile_id
  ) rows;

  return result;
end;
$$;

create or replace function public.set_driver_participation_program(
  target_driver_profile_id uuid,
  target_program_key text,
  target_reason text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.admin.driver_participation'
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  driver_record public.driver_profiles%rowtype;
  program_record public.driver_participation_programs%rowtype;
  active_membership public.driver_program_memberships%rowtype;
  existing_id uuid;
  membership_id uuid;
begin
  if auth.role()<>'service_role' and not public.has_permission('platform.drivers.manage',null) then
    raise exception using errcode='42501',message='driver management permission required';
  end if;
  if target_driver_profile_id is null then raise exception using errcode='22023',message='driver profile id is required'; end if;
  if coalesce(btrim(target_program_key),'')='' then raise exception using errcode='22023',message='driver program is required'; end if;
  if char_length(btrim(coalesce(target_reason,'')))<3 then raise exception using errcode='22023',message='reason is required'; end if;
  if coalesce(btrim(target_idempotency_key),'')='' then raise exception using errcode='22023',message='idempotency key is required'; end if;
  if target_metadata is null or jsonb_typeof(target_metadata)<>'object' then raise exception using errcode='22023',message='metadata must be an object'; end if;

  select * into existing_id
  from public.driver_program_memberships
  where source=coalesce(nullif(btrim(target_source),''),'skima.admin.driver_participation')
    and idempotency_key=target_idempotency_key
  limit 1;
  if existing_id is not null then return existing_id; end if;

  select * into driver_record from public.driver_profiles where id=target_driver_profile_id for update;
  if not found then raise exception using errcode='22023',message='driver profile not found'; end if;

  select * into program_record
  from public.driver_participation_programs
  where key=target_program_key and status='active';
  if not found then raise exception using errcode='22023',message='active driver participation program not found'; end if;

  if program_record.program_type='priority' and driver_record.verification_status<>'approved' then
    raise exception using errcode='55000',message='only an approved driver can be assigned to a priority driver program';
  end if;

  select * into active_membership
  from public.driver_program_memberships
  where driver_profile_id=driver_record.id and status='active' and ends_at is null
  order by starts_at desc
  limit 1
  for update;

  if found and active_membership.program_key=program_record.key then
    return active_membership.id;
  end if;

  if active_membership.id is not null then
    update public.driver_program_memberships
    set status='ended',ends_at=timezone('utc',now()),
        metadata=metadata || jsonb_build_object('endedReason',btrim(target_reason),'changedToProgram',program_record.key)
    where id=active_membership.id;
  end if;

  insert into public.driver_program_memberships(
    driver_profile_id,program_key,status,starts_at,assigned_by,assignment_reason,source,idempotency_key,metadata
  ) values (
    driver_record.id,program_record.key,'active',timezone('utc',now()),auth.uid(),btrim(target_reason),
    coalesce(nullif(btrim(target_source),''),'skima.admin.driver_participation'),target_idempotency_key,target_metadata
  ) returning id into membership_id;

  return membership_id;
end;
$$;

revoke all on function public.read_current_driver_participation(uuid) from public,anon,authenticated;
revoke all on function public.read_driver_public_participation(uuid) from public;
revoke all on function public.read_driver_participation_admin(uuid) from public,anon;
revoke all on function public.set_driver_participation_program(uuid,text,text,text,jsonb,text) from public,anon;
grant execute on function public.read_current_driver_participation(uuid) to service_role;
grant execute on function public.read_driver_public_participation(uuid) to anon,authenticated,service_role;
grant execute on function public.read_driver_participation_admin(uuid) to authenticated,service_role;
grant execute on function public.set_driver_participation_program(uuid,text,text,text,jsonb,text) to authenticated,service_role;

comment on table public.driver_participation_programs is 'Governed driver participation classes. Driver identity and vehicle ownership remain separate from participation class.';
comment on table public.driver_program_memberships is 'Historical driver participation assignments. Only one active class is allowed per driver at a time.';
comment on function public.set_driver_participation_program(uuid,text,text,text,jsonb,text) is 'Admin-only transition between Independent Driver Partner and governed priority programs such as SKIMA Special Driver.';
