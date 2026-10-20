begin;
drop trigger if exists trg_lpg_station_managed_auto_dispatch on public.lpg_refill_orders;
drop function if exists public.trigger_dispatch_lpg_station_managed_order();
drop function if exists public.dispatch_lpg_station_managed_order(uuid);
drop function if exists public.dispatch_pending_lpg_station_managed_orders(uuid);
drop function if exists public.accept_lpg_station_managed_driver_invitation();
create or replace function public.accept_lpg_station_managed_driver_invite()
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare current_email text; invite_record public.lpg_station_managed_driver_invites%rowtype; result_id uuid; current_name text; email_confirmed_at timestamptz;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
 select lower(u.email), coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'),''),nullif(btrim(u.raw_user_meta_data->>'name'),''),split_part(u.email,'@',1)), u.email_confirmed_at
 into current_email,current_name,email_confirmed_at from auth.users u where u.id=auth.uid();
 if current_email is null or email_confirmed_at is null then raise exception using errcode='42501',message='verify the invited email address before accepting the station driver invitation'; end if;
 select id into result_id from public.lpg_station_managed_drivers
 where user_id=auth.uid() and status='active' limit 1;
 if result_id is not null then return result_id; end if;
 select * into invite_record from public.lpg_station_managed_driver_invites
 where lower(email)=current_email and status='pending' and expires_at>now()
 order by created_at desc limit 1 for update;
 if not found then raise exception using errcode='P0002',message='no active Station Managed driver invitation matches this account'; end if;
 if exists(select 1 from public.driver_profiles where user_id=auth.uid()) then
   raise exception using errcode='22023',message='This account already has an independent or SKIMA Managed driver profile and cannot join Station Managed';
 end if;
 insert into public.lpg_station_managed_drivers(station_branch_id,user_id,display_name,phone,created_by,metadata)
 values(invite_record.station_branch_id,auth.uid(),invite_record.display_name,invite_record.phone,invite_record.invited_by,jsonb_build_object('invitationId',invite_record.id,'stationOwned',true))
 on conflict(station_branch_id,user_id) do update set display_name=excluded.display_name,phone=excluded.phone,status='active',updated_at=now()
 returning id into result_id;
 update public.lpg_station_managed_driver_invites set status='accepted',accepted_user_id=auth.uid(),accepted_at=now() where id=invite_record.id;
 update public.lpg_refill_orders set status=status, updated_at=now()
 where station_branch_id=invite_record.station_branch_id and fulfillment_mode='station_managed'
   and fulfillment_channel='marketplace'
   and status in ('payment_reserved','matching_station','matching_driver','driver_offered','driver_accepted','pickup_verified','station_en_route')
   and not exists(select 1 from public.lpg_station_managed_driver_assignments a where a.lpg_order_id=public.lpg_refill_orders.id and a.status<>'cancelled');
 return result_id;
end $$;
commit;
