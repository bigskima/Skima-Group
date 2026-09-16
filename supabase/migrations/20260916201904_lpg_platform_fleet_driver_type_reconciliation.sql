create or replace function public.set_lpg_managed_driver_assignment(target_driver_profile_id uuid,target_managed boolean,target_reason text,target_idempotency_key text,target_metadata jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare membership_id uuid; resolved_program_key text; driver_record public.driver_profiles%rowtype;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' and not public.has_permission('platform.drivers.manage',null) and not public.is_platform_super_admin() then raise exception using errcode='42501',message='driver management permission required'; end if;
  if target_driver_profile_id is null then raise exception using errcode='22023',message='driver is required'; end if;
  if target_managed is null then raise exception using errcode='22023',message='driver type is required'; end if;
  if char_length(btrim(coalesce(target_reason,'')))<3 then raise exception using errcode='22023',message='reason is required'; end if;
  if coalesce(btrim(target_idempotency_key),'')='' then raise exception using errcode='22023',message='idempotency key is required'; end if;
  if target_metadata is null or jsonb_typeof(target_metadata)<>'object' then raise exception using errcode='22023',message='metadata must be an object'; end if;
  select * into driver_record from public.driver_profiles where id=target_driver_profile_id;
  if not found then raise exception using errcode='22023',message='driver profile not found'; end if;
  if target_managed and driver_record.verification_status<>'approved' then raise exception using errcode='55000',message='Only an approved Driver can be added to the SKIMA Managed Driver team.'; end if;
  resolved_program_key:=case when target_managed then coalesce(public.lpg_policy_config('lpg.fulfillment.launch_assurance')->>'internal_driver_program_key','driver.skima_special') else 'driver.independent' end;
  membership_id:=public.set_driver_participation_program(target_driver_profile_id,resolved_program_key,target_reason,target_idempotency_key,target_metadata||jsonb_build_object('managedDriver',target_managed,'adminLabel',case when target_managed then 'SKIMA Managed Driver' else 'Independent Driver' end),'skima.admin.managed_drivers');

  if target_managed then
    update public.driver_vehicle_links link
    set status='revoked',
        ends_at=greatest(timezone('utc',now()),link.starts_at+interval '1 millisecond'),
        metadata=link.metadata||jsonb_build_object('revokedBecause','Driver became SKIMA Managed Driver','revokedBy',auth.uid()),
        updated_at=timezone('utc',now())
    where link.driver_profile_id=target_driver_profile_id
      and link.status='active'
      and (link.ends_at is null or link.ends_at>timezone('utc',now()))
      and not exists(
        select 1 from public.vehicles v
        where v.id=link.vehicle_id and v.platform_owned and link.relationship_type='fleet_owned'
      );
  else
    update public.driver_vehicle_links link
    set status='revoked',
        ends_at=greatest(timezone('utc',now()),link.starts_at+interval '1 millisecond'),
        metadata=link.metadata||jsonb_build_object('revokedBecause','Driver returned to Independent Driver','revokedBy',auth.uid()),
        updated_at=timezone('utc',now())
    where link.driver_profile_id=target_driver_profile_id
      and link.status='active'
      and (link.ends_at is null or link.ends_at>timezone('utc',now()))
      and exists(
        select 1 from public.vehicles v
        where v.id=link.vehicle_id and v.platform_owned and link.relationship_type='fleet_owned'
      );
  end if;

  return jsonb_build_object('driverProfileId',target_driver_profile_id,'managed',target_managed,'membershipId',membership_id,'label',case when target_managed then 'SKIMA Managed Driver' else 'Independent Driver' end);
end;
$$;
revoke all on function public.set_lpg_managed_driver_assignment(uuid,boolean,text,text,jsonb) from public, anon;
grant execute on function public.set_lpg_managed_driver_assignment(uuid,boolean,text,text,jsonb) to authenticated, service_role;
