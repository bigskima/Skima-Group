begin;

create table if not exists public.lpg_station_managed_driver_invites (
  id uuid primary key default gen_random_uuid(),
  station_branch_id uuid not null references public.lpg_station_branches(id) on delete cascade,
  email text not null,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 160),
  phone text,
  invited_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  accepted_user_id uuid references public.profiles(id) on delete restrict,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  unique(station_branch_id,email)
);
alter table public.lpg_station_managed_driver_invites enable row level security;
drop policy if exists lpg_station_managed_driver_invites_no_direct_access on public.lpg_station_managed_driver_invites;
create policy lpg_station_managed_driver_invites_no_direct_access on public.lpg_station_managed_driver_invites for all to authenticated using(false) with check(false);
revoke all on public.lpg_station_managed_driver_invites from public,anon,authenticated;
grant all on public.lpg_station_managed_driver_invites to service_role;

create or replace function public.accept_lpg_station_managed_driver_invite()
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare current_email text; invite_record public.lpg_station_managed_driver_invites%rowtype; result_id uuid; current_name text;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
 select lower(email), coalesce(nullif(btrim(raw_user_meta_data->>'full_name'),''),nullif(btrim(raw_user_meta_data->>'name'),''),split_part(email,'@',1))
 into current_email,current_name from auth.users where id=auth.uid();
 if current_email is null then raise exception using errcode='42501',message='verified account email is required'; end if;
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

create or replace function public.assign_lpg_station_managed_driver(
 target_lpg_order_id uuid, target_station_driver_id uuid, target_idempotency_key text,
 target_metadata jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare order_record public.lpg_refill_orders%rowtype; driver_record public.lpg_station_managed_drivers%rowtype; result_id uuid; prior_id uuid;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
 if target_idempotency_key is null or btrim(target_idempotency_key)='' or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then raise exception using errcode='22023',message='idempotency key and valid metadata are required'; end if;
 select * into order_record from public.lpg_refill_orders where id=target_lpg_order_id for update;
 if not found then raise exception using errcode='22023',message='LPG order was not found'; end if;
 if order_record.station_branch_id is null or not public.can_operate_lpg_station_branch(order_record.station_branch_id,'lpg.stations.manage') then raise exception using errcode='42501',message='branch-scoped station management permission is required'; end if;
 if order_record.status not in ('payment_reserved','matching_station','matching_driver','driver_offered','driver_accepted','pickup_verified','station_en_route') or order_record.fulfillment_channel<>'marketplace' or order_record.fulfillment_mode<>'station_managed' then raise exception using errcode='55000',message='order is not eligible for Station Managed assignment'; end if;
 select id into prior_id from public.lpg_station_managed_driver_assignments where lpg_order_id=order_record.id and status<>'cancelled';
 if prior_id is not null then return prior_id; end if;
 select * into driver_record from public.lpg_station_managed_drivers where id=target_station_driver_id and station_branch_id=order_record.station_branch_id and status='active';
 if not found then raise exception using errcode='22023',message='active driver for this station branch is required'; end if;
 if not exists(select 1 from public.lpg_station_fulfillment_settings where station_branch_id=order_record.station_branch_id and station_managed_enabled) then raise exception using errcode='55000',message='Station Managed must be enabled for this branch'; end if;
 update public.lpg_refill_orders set fulfillment_mode='station_managed',driver_profile_id=null,vehicle_id=null,driver_commission_amount=0,status='driver_offered',assignment_status='driver_assigned',updated_at=now(),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('stationManagedDriverId',driver_record.id,'stationManagedDriverUserId',driver_record.user_id,'stationManagedAutoDispatch',true) where id=order_record.id;
 insert into public.lpg_station_managed_driver_assignments(lpg_order_id,station_branch_id,station_driver_id,assigned_by,idempotency_key,metadata)
 values(order_record.id,order_record.station_branch_id,driver_record.id,auth.uid(),target_idempotency_key,target_metadata||jsonb_build_object('automaticDispatch',true))
 on conflict(lpg_order_id) do update set station_driver_id=excluded.station_driver_id,status='assigned',assigned_at=now(),assigned_by=excluded.assigned_by,metadata=excluded.metadata
 returning id into result_id;
 perform public.record_lpg_order_event(order_record.id,'lpg.station_managed.driver_assigned',order_record.status,'driver_offered',target_idempotency_key||':event',target_metadata||jsonb_build_object('station_driver_id',driver_record.id,'automaticDispatch',true));
 return result_id;
end $$;

create or replace function public.auto_dispatch_lpg_station_managed_order()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare chosen_driver public.lpg_station_managed_drivers%rowtype; assignment_id uuid;
begin
 if new.fulfillment_mode<>'station_managed' or new.fulfillment_channel<>'marketplace' or new.station_branch_id is null then return new; end if;
 if new.status not in ('payment_reserved','matching_station','matching_driver','driver_offered') then return new; end if;
 if coalesce(new.metadata->>'stationManagedAutoDispatch','false')='true' then return new; end if;
 if not exists(select 1 from public.lpg_station_fulfillment_settings s where s.station_branch_id=new.station_branch_id and s.station_managed_enabled) then return new; end if;
 if exists(select 1 from public.lpg_station_managed_driver_assignments a where a.lpg_order_id=new.id and a.status<>'cancelled') then return new; end if;
 select d.* into chosen_driver from public.lpg_station_managed_drivers d
 where d.station_branch_id=new.station_branch_id and d.status='active'
 order by
   (select count(*) from public.lpg_station_managed_driver_assignments a where a.station_driver_id=d.id and a.status in ('assigned','accepted','en_route')),
   (select max(a.assigned_at) from public.lpg_station_managed_driver_assignments a where a.station_driver_id=d.id),
   d.created_at,d.id
 limit 1 for update skip locked;
 if not found then return new; end if;
 insert into public.lpg_station_managed_driver_assignments(
   lpg_order_id,station_branch_id,station_driver_id,assigned_by,idempotency_key,metadata
 ) values (
   new.id,new.station_branch_id,chosen_driver.id,chosen_driver.created_by,'auto:'||new.id::text,
   jsonb_build_object('automaticDispatch',true,'source','order_insert_trigger','policy','least_loaded')
 ) on conflict(lpg_order_id) do nothing returning id into assignment_id;
 if assignment_id is not null then
   update public.lpg_refill_orders set driver_profile_id=null,vehicle_id=null,driver_commission_amount=0,
     status='driver_offered',assignment_status='driver_assigned',updated_at=now(),
     metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
       'stationManagedDriverId',chosen_driver.id,
       'stationManagedDriverUserId',chosen_driver.user_id,
       'stationManagedAutoDispatch',true
     )
   where id=new.id;
 end if;
 return new;
end $$;
drop trigger if exists trg_auto_dispatch_lpg_station_managed_order on public.lpg_refill_orders;
create trigger trg_auto_dispatch_lpg_station_managed_order after insert or update of fulfillment_mode,status on public.lpg_refill_orders for each row execute function public.auto_dispatch_lpg_station_managed_order();

create or replace function public.read_lpg_station_managed_driver_invitation_access()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare current_email text; invite_record public.lpg_station_managed_driver_invites%rowtype;
begin
 if auth.uid() is null then return jsonb_build_object('enabled',false); end if;
 select lower(email) into current_email from auth.users where id=auth.uid();
 select i.* into invite_record from public.lpg_station_managed_driver_invites i
 join public.lpg_station_fulfillment_settings s on s.station_branch_id=i.station_branch_id and s.station_managed_enabled
 where lower(i.email)=current_email and i.status='pending' and i.expires_at>now()
 order by i.created_at desc limit 1;
 if not found then return jsonb_build_object('enabled',false); end if;
 return jsonb_build_object('enabled',true,'stationBranchId',invite_record.station_branch_id,'invitationId',invite_record.id);
end $$;
revoke all on function public.read_lpg_station_managed_driver_invitation_access() from public,anon;
grant execute on function public.read_lpg_station_managed_driver_invitation_access() to authenticated,service_role;

revoke all on function public.accept_lpg_station_managed_driver_invite() from public,anon;
grant execute on function public.accept_lpg_station_managed_driver_invite() to authenticated,service_role;
revoke all on function public.auto_dispatch_lpg_station_managed_order() from public,anon,authenticated;
commit;
