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

  select id into existing_id
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

revoke all on function public.set_driver_participation_program(uuid,text,text,text,jsonb,text) from public,anon;
grant execute on function public.set_driver_participation_program(uuid,text,text,text,jsonb,text) to authenticated,service_role;
