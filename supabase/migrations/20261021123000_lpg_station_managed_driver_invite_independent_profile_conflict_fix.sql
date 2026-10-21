begin;

-- A pending invite cannot convert an independent driver account. Revoke only that invite
-- and return a normal disabled Station Managed result instead of aborting workspace resolution.
create or replace function public.read_lpg_station_managed_driver_access()
returns jsonb
language plpgsql
volatile
security definer
set search_path=public,pg_temp
as $station_driver_access$
declare
  driver_record public.lpg_station_managed_drivers%rowtype;
  station_record public.lpg_station_branches%rowtype;
  invite_record public.lpg_station_managed_driver_invites%rowtype;
  current_email text;
  current_email_verified boolean;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  current_email:=lower(btrim(coalesce(auth.jwt()->>'email','')));
  select exists(
    select 1 from auth.users authenticated_user
    where authenticated_user.id=auth.uid()
      and authenticated_user.email_confirmed_at is not null
      and lower(btrim(coalesce(authenticated_user.email,'')))=current_email
  ) into current_email_verified;

  select * into driver_record from public.lpg_station_managed_drivers
  where user_id=auth.uid() and status='active' limit 1;

  if not found and current_email<>'' and current_email_verified then
    -- Do not fail general workspace resolution for independent drivers.
    -- Only reject conversion if this email has a pending Station Managed invitation.
    select * into invite_record from public.lpg_station_managed_driver_invites
    where email=current_email and status='pending' and expires_at>timezone('utc',now())
    order by created_at desc limit 1 for update;
    if found then
      if exists(select 1 from public.driver_profiles where user_id=auth.uid()) then
        -- Consume an ineligible invite without breaking the user's existing independent-driver workspace.
        update public.lpg_station_managed_driver_invites
        set status='revoked',
            updated_at=timezone('utc',now()),
            metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('revocationReason','account_already_has_independent_driver_profile')
        where id=invite_record.id and status='pending';
        return jsonb_build_object('enabled',false);
      end if;
      if exists(select 1 from public.lpg_station_managed_drivers where user_id=auth.uid() and status='active') then
        raise exception using errcode='23505',message='this account already belongs to an active Station Managed driver';
      end if;
      insert into public.lpg_station_managed_drivers(
        station_branch_id,user_id,display_name,phone,status,created_by,metadata
      ) values (
        invite_record.station_branch_id,auth.uid(),invite_record.display_name,invite_record.phone,'active',
        invite_record.invited_by,
        jsonb_build_object('source','email_invitation','invitationId',invite_record.id)
      )
      on conflict (station_branch_id,user_id) do update set
        display_name=excluded.display_name,phone=excluded.phone,status='active',updated_at=timezone('utc',now())
      returning * into driver_record;

      update public.lpg_station_managed_driver_invites
      set status='accepted',accepted_user_id=auth.uid(),accepted_at=timezone('utc',now()),
          updated_at=timezone('utc',now()),
          metadata=metadata||jsonb_build_object('acceptedDriverId',driver_record.id)
      where id=invite_record.id and status='pending';

      -- Drain eligible orders that were waiting for this station to onboard a driver.
      perform public.auto_assign_lpg_station_managed_order_for_id(pending_order.id)
      from public.lpg_refill_orders pending_order
      where pending_order.station_branch_id=driver_record.station_branch_id
        and pending_order.fulfillment_channel='marketplace'
        and pending_order.fulfillment_mode='station_managed'
        and pending_order.status in ('payment_reserved','matching_station','matching_driver','driver_offered','driver_accepted','pickup_verified','station_en_route')
        and not exists (
          select 1 from public.lpg_station_managed_driver_assignments assignment
          where assignment.lpg_order_id=pending_order.id and assignment.status<>'cancelled'
        );
    end if;
  end if;

  if driver_record.id is null or driver_record.status<>'active' then
    return jsonb_build_object('enabled',false);
  end if;
  select * into station_record from public.lpg_station_branches
  where id=driver_record.station_branch_id and approval_status='approved' and compliance_status='approved';
  if not found then return jsonb_build_object('enabled',false); end if;
  return jsonb_build_object(
    'enabled',true,'stationDriverId',driver_record.id,
    'stationBranchId',station_record.id,'stationName',station_record.display_name
  );
end;
$station_driver_access$;

revoke all on function public.read_lpg_station_managed_driver_access() from public, anon;
grant execute on function public.read_lpg_station_managed_driver_access() to authenticated, service_role;

notify pgrst,'reload schema';
commit;
