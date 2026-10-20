begin;

create table if not exists public.lpg_station_managed_driver_invites (
  id uuid primary key default gen_random_uuid(),
  station_branch_id uuid not null references public.lpg_station_branches(id) on delete cascade,
  email text not null check (email = lower(btrim(email))),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 160),
  phone text,
  invited_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  accepted_user_id uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  unique (station_branch_id,email)
);
create index if not exists lpg_station_managed_driver_invites_email_status_idx
  on public.lpg_station_managed_driver_invites(email,status,expires_at);
alter table public.lpg_station_managed_driver_invites enable row level security;
drop policy if exists lpg_station_managed_driver_invites_no_direct_access on public.lpg_station_managed_driver_invites;
create policy lpg_station_managed_driver_invites_no_direct_access
  on public.lpg_station_managed_driver_invites for all to authenticated using(false) with check(false);
revoke all on public.lpg_station_managed_driver_invites from public,anon,authenticated;
grant all on public.lpg_station_managed_driver_invites to service_role;

create or replace function public.dispatch_lpg_station_managed_order(target_lpg_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $dispatch$
declare
  order_record public.lpg_refill_orders%rowtype;
  driver_record public.lpg_station_managed_drivers%rowtype;
  assignment_id uuid;
  manager_id uuid;
begin
  select * into order_record from public.lpg_refill_orders where id=target_lpg_order_id for update;
  if not found or order_record.fulfillment_channel <> 'marketplace'
    or order_record.fulfillment_mode <> 'station_managed'
    or order_record.station_branch_id is null
    or order_record.status not in ('payment_reserved','matching_station','matching_driver','driver_offered','driver_accepted','pickup_verified','station_en_route') then
    return null;
  end if;
  if not exists (
    select 1 from public.lpg_station_fulfillment_settings s
    where s.station_branch_id=order_record.station_branch_id and s.station_managed_enabled=true
  ) then return null; end if;
  if exists (
    select 1 from public.lpg_station_managed_driver_assignments a
    where a.lpg_order_id=order_record.id and a.status <> 'cancelled'
  ) then
    select id into assignment_id from public.lpg_station_managed_driver_assignments
      where lpg_order_id=order_record.id and status <> 'cancelled' limit 1;
    return assignment_id;
  end if;
  -- Deterministic least-loaded selection, then oldest assignment and stable driver ID tie-break.
  select d.* into driver_record
  from public.lpg_station_managed_drivers d
  where d.station_branch_id=order_record.station_branch_id and d.status='active'
  order by
    (select count(*) from public.lpg_station_managed_driver_assignments a
      where a.station_driver_id=d.id and a.status in ('assigned','accepted','en_route')) asc,
    (select max(a.assigned_at) from public.lpg_station_managed_driver_assignments a
      where a.station_driver_id=d.id) asc nulls first,
    d.created_at asc, d.id asc
  limit 1 for update skip locked;
  if not found then return null; end if;
  manager_id := driver_record.created_by;
  update public.lpg_refill_orders
    set fulfillment_mode='station_managed', driver_profile_id=null, vehicle_id=null,
        status='driver_offered', assignment_status='driver_assigned', updated_at=timezone('utc',now()),
        metadata=metadata || jsonb_build_object('stationManagedDriverId',driver_record.id,'stationManagedDriverUserId',driver_record.user_id,'stationManagedDispatch','automatic')
    where id=order_record.id;
  insert into public.lpg_station_managed_driver_assignments(
    lpg_order_id,station_branch_id,station_driver_id,assigned_by,idempotency_key,metadata
  ) values (
    order_record.id,order_record.station_branch_id,driver_record.id,manager_id,
    'station-auto-dispatch:'||order_record.id::text,
    jsonb_build_object('source','automatic_station_dispatch','dispatchVersion',1)
  ) on conflict (lpg_order_id) do nothing returning id into assignment_id;
  if assignment_id is null then
    select id into assignment_id from public.lpg_station_managed_driver_assignments where lpg_order_id=order_record.id;
    return assignment_id;
  end if;
  perform public.record_lpg_order_event(
    order_record.id,'lpg.station_managed.driver_assigned',order_record.status,'driver_offered',
    'station-auto-dispatch-event:'||order_record.id::text,
    jsonb_build_object('station_driver_id',driver_record.id,'station_driver_user_id',driver_record.user_id,'dispatch','automatic')
  );
  return assignment_id;
end;
$dispatch$;

create or replace function public.dispatch_pending_lpg_station_managed_orders(target_station_branch_id uuid)
returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $pending$
declare order_id uuid; assignment_id uuid; dispatched integer:=0;
begin
  if auth.uid() is not null and not public.can_operate_lpg_station_branch(target_station_branch_id,'lpg.stations.manage')
    and not exists(select 1 from public.lpg_station_managed_drivers d where d.station_branch_id=target_station_branch_id and d.user_id=auth.uid() and d.status='active') then
    raise exception using errcode='42501',message='station branch access is required';
  end if;
  for order_id in
    select o.id from public.lpg_refill_orders o
    where o.station_branch_id=target_station_branch_id and o.fulfillment_channel='marketplace'
      and o.fulfillment_mode='station_managed'
      and o.status in ('payment_reserved','matching_station','matching_driver','driver_offered','driver_accepted','pickup_verified','station_en_route')
      and not exists(select 1 from public.lpg_station_managed_driver_assignments a where a.lpg_order_id=o.id and a.status<>'cancelled')
    order by o.created_at asc
    for update skip locked
  loop
    assignment_id := public.dispatch_lpg_station_managed_order(order_id);
    if assignment_id is not null then dispatched:=dispatched+1; end if;
  end loop;
  return dispatched;
end;
$pending$;

create or replace function public.accept_lpg_station_managed_driver_invitation()
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $accept$
declare user_email text; profile_name text; invite_record public.lpg_station_managed_driver_invites%rowtype; driver_id uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  select lower(btrim(email)), coalesce(nullif(btrim(raw_user_meta_data->>'full_name'),''),nullif(btrim(raw_user_meta_data->>'name'),''),'Station driver')
    into user_email,profile_name from auth.users where id=auth.uid();
  if user_email is null then raise exception using errcode='42501',message='a verified account email is required'; end if;
  select * into invite_record from public.lpg_station_managed_driver_invites
    where email=user_email and status='pending' and expires_at>now()
    order by created_at desc limit 1 for update;
  if not found then
    select id into driver_id from public.lpg_station_managed_drivers where user_id=auth.uid() and status='active' limit 1;
    if driver_id is not null then return driver_id; end if;
    raise exception using errcode='P0002',message='no active Station Managed invitation matches this account email';
  end if;
  if exists(select 1 from public.driver_profiles where user_id=auth.uid()) then
    raise exception using errcode='55000',message='an independent driver account cannot be converted into a Station Managed driver';
  end if;
  if not exists(select 1 from public.profiles where id=auth.uid()) then
    raise exception using errcode='23503',message='complete account setup before accepting the station invitation';
  end if;
  insert into public.lpg_station_managed_drivers(station_branch_id,user_id,display_name,phone,status,created_by,metadata)
  values(invite_record.station_branch_id,auth.uid(),
    coalesce(nullif(btrim(invite_record.display_name),''),profile_name),invite_record.phone,'active',invite_record.invited_by,
    jsonb_build_object('source','email_invitation','invitationId',invite_record.id))
  on conflict(station_branch_id,user_id) do update set
    display_name=excluded.display_name,phone=excluded.phone,status='active',updated_at=timezone('utc',now())
  returning id into driver_id;
  update public.lpg_station_managed_driver_invites set status='accepted',accepted_user_id=auth.uid(),
    accepted_at=timezone('utc',now()),updated_at=timezone('utc',now())
    where id=invite_record.id;
  perform public.dispatch_pending_lpg_station_managed_orders(invite_record.station_branch_id);
  return driver_id;
end;
$accept$;

create or replace function public.trigger_dispatch_lpg_station_managed_order()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $trigger$
begin
  if tg_op='UPDATE' and old.fulfillment_mode is not distinct from new.fulfillment_mode
    and old.station_branch_id is not distinct from new.station_branch_id
    and old.status is not distinct from new.status then
    return new;
  end if;
  if new.fulfillment_channel='marketplace' and new.fulfillment_mode='station_managed'
    and new.station_branch_id is not null
    and new.status in ('payment_reserved','matching_station','matching_driver','driver_offered','driver_accepted','pickup_verified','station_en_route') then
    perform public.dispatch_lpg_station_managed_order(new.id);
  end if;
  return new;
end;
$trigger$;
drop trigger if exists trg_lpg_station_managed_auto_dispatch on public.lpg_refill_orders;
create trigger trg_lpg_station_managed_auto_dispatch
after insert or update of fulfillment_mode,station_branch_id,status on public.lpg_refill_orders
for each row execute function public.trigger_dispatch_lpg_station_managed_order();

revoke all on function public.dispatch_lpg_station_managed_order(uuid) from public,anon,authenticated;
revoke all on function public.dispatch_pending_lpg_station_managed_orders(uuid) from public,anon;
revoke all on function public.accept_lpg_station_managed_driver_invitation() from public,anon;
grant execute on function public.dispatch_pending_lpg_station_managed_orders(uuid) to authenticated,service_role;
grant execute on function public.accept_lpg_station_managed_driver_invitation() to authenticated,service_role;

commit;
