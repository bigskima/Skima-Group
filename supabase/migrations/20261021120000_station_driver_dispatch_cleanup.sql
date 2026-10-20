begin;

-- Reconcile the existing Station Managed invitation migration with safe acceptance and automatic dispatch.
create table if not exists public.lpg_station_managed_driver_invites (
  id uuid primary key default gen_random_uuid(),
  station_branch_id uuid not null references public.lpg_station_branches(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 160),
  phone text,
  invited_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  accepted_user_id uuid references public.profiles(id) on delete restrict,
  accepted_at timestamptz,
  expires_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  unique (station_branch_id,email),
  check ((status='accepted') = (accepted_user_id is not null and accepted_at is not null))
);
create index if not exists lpg_station_managed_driver_invites_email_status_idx
  on public.lpg_station_managed_driver_invites(email,status,expires_at);
alter table public.lpg_station_managed_driver_invites enable row level security;
drop policy if exists lpg_station_managed_driver_invites_no_direct_access on public.lpg_station_managed_driver_invites;
create policy lpg_station_managed_driver_invites_no_direct_access
  on public.lpg_station_managed_driver_invites for all to authenticated using(false) with check(false);
revoke all on public.lpg_station_managed_driver_invites from public,anon,authenticated;
grant all on public.lpg_station_managed_driver_invites to service_role;

-- Sign-in/first authenticated session completes an invite only when the JWT email
-- matches the invited address. No independent driver profile or SKIMA role is created.
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
    if exists(select 1 from public.driver_profiles where user_id=auth.uid()) then
      raise exception using errcode='55000',message='an independent or SKIMA Managed driver account cannot accept a Station Managed invitation';
    end if;
    select * into invite_record from public.lpg_station_managed_driver_invites
    where email=current_email and status='pending' and expires_at>timezone('utc',now())
    order by created_at desc limit 1 for update;
    if found then
      if exists(select 1 from public.driver_profiles where user_id=auth.uid()) then
        raise exception using errcode='55000',message='an independent or SKIMA Managed driver profile cannot accept a Station Managed invitation';
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
        and pending_order.status in ('payment_reserved','matching_station','matching_driver')
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

-- Dispatch Station Managed orders inside the order-creation transaction. The
-- order lock + unique order assignment makes retries safe; other fulfillment modes
-- are untouched. Prefer the least-loaded active driver in the selected branch.
create or replace function public.auto_assign_lpg_station_managed_order()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $station_managed_auto_dispatch$
declare
  settings_enabled boolean;
  driver_record public.lpg_station_managed_drivers%rowtype;
  assignment_id uuid;
  auto_key text;
begin
  if new.fulfillment_channel<>'marketplace' or new.fulfillment_mode<>'station_managed'
    or new.station_branch_id is null
    or new.status not in ('payment_reserved','matching_station','matching_driver','driver_offered','driver_accepted','pickup_verified','station_en_route') then
    return new;
  end if;

  select station_managed_enabled into settings_enabled
  from public.lpg_station_fulfillment_settings
  where station_branch_id=new.station_branch_id;
  if coalesce(settings_enabled,false) is not true then return new; end if;

  -- Serialize dispatches for a station to avoid overloading a single driver and
  -- keep each order assigned once, even when creation callbacks race.
  perform pg_advisory_xact_lock(hashtextextended(new.station_branch_id::text,0));

  if exists(select 1 from public.lpg_station_managed_driver_assignments
    where lpg_order_id=new.id and status<>'cancelled') then
    return new;
  end if;

  select d.* into driver_record
  from public.lpg_station_managed_drivers d
  where d.station_branch_id=new.station_branch_id and d.status='active'
  order by (
    select count(*) from public.lpg_station_managed_driver_assignments a
    where a.station_driver_id=d.id and a.status in ('assigned','accepted','en_route')
  ), d.created_at, d.id
  limit 1
  for update;

  if not found then
    -- Keep the paid order in the station's pending queue until a driver is invited
    -- and accepts. Never route it to an independent driver as a fallback. Do not
    -- write status=matching_driver again from its own UPDATE trigger.
    if new.status<>'matching_driver' then
      update public.lpg_refill_orders
      set status='matching_driver',
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('stationManagedDispatch','waiting_for_station_driver'),
          updated_at=timezone('utc',now())
      where id=new.id;
    else
      update public.lpg_refill_orders
      set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('stationManagedDispatch','waiting_for_station_driver'),
          updated_at=timezone('utc',now())
      where id=new.id;
    end if;
    return new;
  end if;

  auto_key:='station-managed-auto:'||new.id::text;
  insert into public.lpg_station_managed_driver_assignments(
    lpg_order_id,station_branch_id,station_driver_id,assigned_by,idempotency_key,metadata
  ) values (
    new.id,new.station_branch_id,driver_record.id,driver_record.created_by,auto_key,
    jsonb_build_object('source','automatic_station_dispatch','policy','least_active_assignments')
  )
  on conflict (lpg_order_id) do nothing
  returning id into assignment_id;

  if assignment_id is not null then
    update public.lpg_refill_orders
    set driver_profile_id=null,vehicle_id=null,status='driver_offered',
        assignment_status='driver_assigned',updated_at=timezone('utc',now()),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'stationManagedDriverId',driver_record.id,
          'stationManagedDriverUserId',driver_record.user_id,
          'stationManagedDispatch','automatically_assigned'
        )
    where id=new.id;

    perform public.record_lpg_order_event(
      new.id,'lpg.station_managed.driver_assigned',new.status,'driver_offered',
      auto_key||':event',
      jsonb_build_object('station_driver_id',driver_record.id,'station_driver_user_id',driver_record.user_id,'automatic',true)
    );
  end if;
  return new;
end;
$station_managed_auto_dispatch$;

drop trigger if exists trg_auto_dispatch_lpg_station_managed_order on public.lpg_refill_orders;
-- Replace the earlier dispatcher, whose nested status update could re-enter itself.
drop trigger if exists trg_lpg_station_managed_auto_dispatch on public.lpg_refill_orders;
drop function if exists public.trigger_dispatch_lpg_station_managed_order();
create trigger trg_auto_dispatch_lpg_station_managed_order
after insert or update of status on public.lpg_refill_orders
for each row execute function public.auto_assign_lpg_station_managed_order();

-- A newly accepted station driver also drains pending Station Managed orders
-- from their branch, so orders created while the station had no drivers are not lost.
create or replace function public.dispatch_pending_lpg_station_managed_orders(target_station_branch_id uuid)
returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $dispatch_pending_station_orders$
declare order_record public.lpg_refill_orders%rowtype; dispatched_count integer:=0;
begin
  if auth.uid() is null or not public.can_operate_lpg_station_branch(target_station_branch_id,'lpg.stations.manage') then
    raise exception using errcode='42501',message='branch-scoped station management permission is required';
  end if;
  for order_record in
    select o.* from public.lpg_refill_orders o
    where o.station_branch_id=target_station_branch_id
      and o.fulfillment_channel='marketplace' and o.fulfillment_mode='station_managed'
      and o.status in ('payment_reserved','matching_station','matching_driver','driver_offered','driver_accepted','pickup_verified','station_en_route')
      and not exists(select 1 from public.lpg_station_managed_driver_assignments a where a.lpg_order_id=o.id and a.status<>'cancelled')
    order by o.created_at,o.id
    for update skip locked
  loop
    perform public.auto_assign_lpg_station_managed_order_for_id(order_record.id);
    dispatched_count:=dispatched_count+1;
  end loop;
  return dispatched_count;
end;
$dispatch_pending_station_orders$;

-- Internal helper used only by the branch-scoped drain RPC and order trigger.
create or replace function public.auto_assign_lpg_station_managed_order_for_id(target_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $dispatch_one_station_order$
declare order_record public.lpg_refill_orders%rowtype; settings_enabled boolean; driver_record public.lpg_station_managed_drivers%rowtype; result_id uuid; auto_key text;
begin
  select * into order_record from public.lpg_refill_orders where id=target_order_id for update;
  if not found or order_record.fulfillment_channel<>'marketplace' or order_record.fulfillment_mode<>'station_managed'
    or order_record.status not in ('payment_reserved','matching_station','matching_driver','driver_offered','driver_accepted','pickup_verified','station_en_route') then return null; end if;
  select station_managed_enabled into settings_enabled from public.lpg_station_fulfillment_settings where station_branch_id=order_record.station_branch_id;
  if coalesce(settings_enabled,false) is not true then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(order_record.station_branch_id::text,0));
  if exists(select 1 from public.lpg_station_managed_driver_assignments where lpg_order_id=order_record.id and status<>'cancelled') then return null; end if;
  select d.* into driver_record from public.lpg_station_managed_drivers d
  where d.station_branch_id=order_record.station_branch_id and d.status='active'
  order by (select count(*) from public.lpg_station_managed_driver_assignments a where a.station_driver_id=d.id and a.status in ('assigned','accepted','en_route')),d.created_at,d.id
  limit 1 for update;
  if not found then return null; end if;
  auto_key:='station-managed-auto:'||order_record.id::text;
  insert into public.lpg_station_managed_driver_assignments(lpg_order_id,station_branch_id,station_driver_id,assigned_by,idempotency_key,metadata)
  values(order_record.id,order_record.station_branch_id,driver_record.id,driver_record.created_by,auto_key,jsonb_build_object('source','automatic_station_dispatch','policy','least_active_assignments'))
  on conflict(lpg_order_id) do nothing returning id into result_id;
  if result_id is null then return null; end if;
  update public.lpg_refill_orders set driver_profile_id=null,vehicle_id=null,status='driver_offered',assignment_status='driver_assigned',
    updated_at=timezone('utc',now()),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('stationManagedDriverId',driver_record.id,'stationManagedDriverUserId',driver_record.user_id,'stationManagedDispatch','automatically_assigned')
  where id=order_record.id;
  perform public.record_lpg_order_event(order_record.id,'lpg.station_managed.driver_assigned',order_record.status,'driver_offered',auto_key||':event',
    jsonb_build_object('station_driver_id',driver_record.id,'station_driver_user_id',driver_record.user_id,'automatic',true));
  return result_id;
end;
$dispatch_one_station_order$;

-- Settings or driver onboarding may occur after an order has already entered the
-- station queue. Drain that queue whenever the branch becomes dispatch-ready.
create or replace function public.auto_dispatch_pending_station_orders_for_branch(target_station_branch_id uuid)
returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $auto_dispatch_branch$
declare order_id uuid; count_dispatched integer:=0; assigned_id uuid;
begin
  if target_station_branch_id is null then return 0; end if;
  for order_id in
    select o.id from public.lpg_refill_orders o
    where o.station_branch_id=target_station_branch_id
      and o.fulfillment_channel='marketplace' and o.fulfillment_mode='station_managed'
      and o.status in ('payment_reserved','matching_station','matching_driver')
      and not exists(select 1 from public.lpg_station_managed_driver_assignments a where a.lpg_order_id=o.id and a.status<>'cancelled')
    order by o.created_at,o.id
  loop
    assigned_id:=public.auto_assign_lpg_station_managed_order_for_id(order_id);
    if assigned_id is not null then count_dispatched:=count_dispatched+1; end if;
  end loop;
  return count_dispatched;
end;
$auto_dispatch_branch$;

create or replace function public.on_station_managed_dispatch_readiness_changed()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $dispatch_readiness$
begin
  if tg_table_name='lpg_station_fulfillment_settings' then
    if new.station_managed_enabled then perform public.auto_dispatch_pending_station_orders_for_branch(new.station_branch_id); end if;
  elsif tg_table_name='lpg_station_managed_drivers' then
    if new.status='active' then perform public.auto_dispatch_pending_station_orders_for_branch(new.station_branch_id); end if;
  end if;
  return new;
end;
$dispatch_readiness$;

drop trigger if exists trg_station_managed_settings_dispatch_pending on public.lpg_station_fulfillment_settings;
create trigger trg_station_managed_settings_dispatch_pending
after insert or update of station_managed_enabled on public.lpg_station_fulfillment_settings
for each row execute function public.on_station_managed_dispatch_readiness_changed();

drop trigger if exists trg_station_managed_driver_dispatch_pending on public.lpg_station_managed_drivers;
create trigger trg_station_managed_driver_dispatch_pending
after insert or update of status on public.lpg_station_managed_drivers
for each row execute function public.on_station_managed_dispatch_readiness_changed();

revoke all on function public.auto_assign_lpg_station_managed_order() from public,anon,authenticated;
revoke all on function public.auto_assign_lpg_station_managed_order_for_id(uuid) from public,anon,authenticated;
revoke all on function public.dispatch_pending_lpg_station_managed_orders(uuid) from public,anon;
grant execute on function public.dispatch_pending_lpg_station_managed_orders(uuid) to authenticated,service_role;
grant execute on function public.read_lpg_station_managed_driver_access() to authenticated,service_role;

-- Named acceptance/access RPCs let the authenticated invitation landing flow
-- explicitly finalize an invite and then resolve the station-driver workspace.
drop function if exists public.accept_lpg_station_managed_driver_invite();
create or replace function public.accept_lpg_station_managed_driver_invite()
returns uuid
language sql
volatile
security definer
set search_path=public,pg_temp
as $accept_station_driver_invite$
  select nullif(public.read_lpg_station_managed_driver_access()->>'stationDriverId','')::uuid;
$accept_station_driver_invite$;

-- Keep the legacy invitation RPC as a safe alias to the same confirmed-email flow.
create or replace function public.accept_lpg_station_managed_driver_invitation()
returns uuid
language sql
volatile
security definer
set search_path=public,pg_temp
as $accept_station_driver_invitation$
  select public.accept_lpg_station_managed_driver_invite();
$accept_station_driver_invitation$;

revoke all on function public.accept_lpg_station_managed_driver_invitation() from public,anon;
grant execute on function public.accept_lpg_station_managed_driver_invitation() to authenticated,service_role;

create or replace function public.read_lpg_station_managed_driver_invitation_access()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $station_driver_invitation_access$
declare current_email text; invite_record public.lpg_station_managed_driver_invites%rowtype;
begin
  if auth.uid() is null then return jsonb_build_object('enabled',false); end if;
  select lower(u.email) into current_email from auth.users u
  where u.id=auth.uid() and u.email_confirmed_at is not null;
  if current_email is null then return jsonb_build_object('enabled',false); end if;
  select i.* into invite_record
  from public.lpg_station_managed_driver_invites i
  join public.lpg_station_fulfillment_settings settings
    on settings.station_branch_id=i.station_branch_id and settings.station_managed_enabled
  where lower(i.email)=current_email and i.status='pending' and i.expires_at>timezone('utc',now())
  order by i.created_at desc limit 1;
  if not found then return jsonb_build_object('enabled',false); end if;
  return jsonb_build_object('enabled',true,'stationBranchId',invite_record.station_branch_id,'invitationId',invite_record.id);
end;
$station_driver_invitation_access$;

revoke all on function public.accept_lpg_station_managed_driver_invite() from public,anon;
revoke all on function public.read_lpg_station_managed_driver_invitation_access() from public,anon;
grant execute on function public.accept_lpg_station_managed_driver_invite() to authenticated,service_role;
grant execute on function public.read_lpg_station_managed_driver_invitation_access() to authenticated,service_role;

notify pgrst,'reload schema';
commit;
