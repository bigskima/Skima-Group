begin;

-- Email invitations are scoped to a single station branch. They do not create
-- independent-driver profiles or grant any SKIMA fleet permissions.
create table if not exists public.lpg_station_managed_driver_invites (
  id uuid primary key default gen_random_uuid(),
  station_branch_id uuid not null references public.lpg_station_branches(id) on delete cascade,
  email text not null check (email=lower(btrim(email)) and position('@' in email)>1),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 160),
  phone text,
  invited_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  accepted_user_id uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz not null default (timezone('utc',now()) + interval '7 days'),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  unique(station_branch_id,email)
);
create index if not exists lpg_station_managed_driver_invites_email_status_idx
  on public.lpg_station_managed_driver_invites(email,status,expires_at);
alter table public.lpg_station_managed_driver_invites enable row level security;
drop policy if exists lpg_station_managed_driver_invites_no_direct_access on public.lpg_station_managed_driver_invites;
create policy lpg_station_managed_driver_invites_no_direct_access on public.lpg_station_managed_driver_invites
  for all to authenticated using(false) with check(false);
revoke all on public.lpg_station_managed_driver_invites from public,anon,authenticated;
grant all on public.lpg_station_managed_driver_invites to service_role;

create or replace function public.accept_lpg_station_managed_driver_invitation()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $accept_station_driver_invite$
declare
  current_email text;
  invite_record public.lpg_station_managed_driver_invites%rowtype;
  result_id uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  current_email:=lower(btrim(coalesce(auth.jwt()->>'email','')));
  if current_email='' or coalesce((auth.jwt()->>'email_verified')::boolean,false) is not true then
    raise exception using errcode='42501',message='verify the invited email address before accepting the station driver invitation';
  end if;
  select * into invite_record
  from public.lpg_station_managed_driver_invites
  where email=current_email and status='pending' and expires_at>timezone('utc',now())
  order by created_at desc limit 1 for update;
  if not found then
    if exists(select 1 from public.lpg_station_managed_drivers where user_id=auth.uid() and status='active') then
      return jsonb_build_object('accepted',true,'alreadyRegistered',true);
    end if;
    return jsonb_build_object('accepted',false,'reason','no_pending_invitation');
  end if;
  if exists(select 1 from public.driver_profiles where user_id=auth.uid()) then
    raise exception using errcode='23514',message='accounts with an independent or SKIMA driver profile cannot accept a Station Managed driver invitation';
  end if;
  if not exists(select 1 from public.profiles where id=auth.uid()) then
    raise exception using errcode='23503',message='complete account setup before accepting the station invitation';
  end if;
  insert into public.lpg_station_managed_drivers(
    station_branch_id,user_id,display_name,phone,status,created_by,metadata
  ) values (
    invite_record.station_branch_id,auth.uid(),invite_record.display_name,invite_record.phone,'active',
    invite_record.invited_by,jsonb_build_object('invitationId',invite_record.id,'acceptedByEmail',current_email)
  )
  on conflict(station_branch_id,user_id) do update set
    display_name=excluded.display_name,phone=excluded.phone,status='active',
    updated_at=timezone('utc',now()),metadata=excluded.metadata
  returning id into result_id;
  update public.lpg_station_managed_driver_invites
  set status='accepted',accepted_user_id=auth.uid(),accepted_at=timezone('utc',now()),updated_at=timezone('utc',now())
  where id=invite_record.id;
  return jsonb_build_object('accepted',true,'stationDriverId',result_id,'stationBranchId',invite_record.station_branch_id);
end;
$accept_station_driver_invite$;

revoke all on function public.accept_lpg_station_managed_driver_invitation() from public,anon;
grant execute on function public.accept_lpg_station_managed_driver_invitation() to authenticated,service_role;

-- A newly authenticated invited user accepts through the normal station-driver
-- access check. The access RPC performs acceptance before reading the identity.
create or replace function public.read_lpg_station_managed_driver_access()
returns jsonb
language plpgsql
volatile
security definer
set search_path=public,pg_temp
as $station_driver_access_invite$
declare driver_record public.lpg_station_managed_drivers%rowtype; station_record public.lpg_station_branches%rowtype;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  perform public.accept_lpg_station_managed_driver_invitation();
  select * into driver_record from public.lpg_station_managed_drivers
  where user_id=auth.uid() and status='active' limit 1;
  if not found then return jsonb_build_object('enabled',false); end if;
  select * into station_record from public.lpg_station_branches
  where id=driver_record.station_branch_id and approval_status='approved' and compliance_status='approved';
  if not found then return jsonb_build_object('enabled',false); end if;
  return jsonb_build_object('enabled',true,'stationDriverId',driver_record.id,'stationBranchId',station_record.id,'stationName',station_record.display_name);
end;
$station_driver_access_invite$;

-- Atomic automatic dispatch: only Station Managed marketplace orders are routed.
-- Existing independent-driver and SKIMA Fleet dispatch paths are untouched.
create or replace function public.auto_assign_lpg_station_managed_order()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $auto_station_driver$
declare
  chosen_driver public.lpg_station_managed_drivers%rowtype;
  assignment_key text;
  assigned_id uuid;
begin
  if new.fulfillment_channel<>'marketplace' or new.fulfillment_mode<>'station_managed'
     or new.station_branch_id is null
     or new.status not in ('payment_reserved','matching_station','matching_driver','driver_offered')
     or coalesce(new.metadata->>'station_managed_auto_dispatch_attempted','false')='true' then
    return new;
  end if;
  if not exists(select 1 from public.lpg_station_fulfillment_settings s
    where s.station_branch_id=new.station_branch_id and s.station_managed_enabled) then
    return new;
  end if;
  if exists(select 1 from public.lpg_station_managed_driver_assignments a
    where a.lpg_order_id=new.id and a.status<>'cancelled') then
    return new;
  end if;
  -- Deterministic least-loaded selection; lock the chosen row to serialize dispatch.
  select d.* into chosen_driver
  from public.lpg_station_managed_drivers d
  where d.station_branch_id=new.station_branch_id and d.status='active'
  order by
    (select count(*) from public.lpg_station_managed_driver_assignments a
      where a.station_driver_id=d.id and a.status in ('assigned','accepted','en_route')),
    (select max(a.assigned_at) from public.lpg_station_managed_driver_assignments a where a.station_driver_id=d.id),
    d.created_at,d.id
  limit 1 for update skip locked;
  if not found then
    -- Leave the order unassigned and retry on a later status change / dispatch call.
    return new;
  end if;
  assignment_key:='auto-station-managed:'||new.id::text;
  insert into public.lpg_station_managed_driver_assignments(
    lpg_order_id,station_branch_id,station_driver_id,assigned_by,idempotency_key,metadata
  ) values (
    new.id,new.station_branch_id,chosen_driver.id,coalesce(auth.uid(),chosen_driver.created_by),
    assignment_key,jsonb_build_object('source','automatic_station_dispatch','policy','least_loaded')
  )
  on conflict(lpg_order_id) do nothing
  returning id into assigned_id;
  if assigned_id is not null then
    new.driver_profile_id:=null;
    new.vehicle_id:=null;
    new.status:='driver_offered';
    new.assignment_status:='driver_assigned';
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
      'stationManagedDriverId',chosen_driver.id,
      'stationManagedDriverUserId',chosen_driver.user_id,
      'station_managed_auto_dispatch_attempted',true
    );
  end if;
  return new;
end;
$auto_station_driver$;

drop trigger if exists trg_lpg_station_managed_auto_dispatch on public.lpg_refill_orders;
create trigger trg_lpg_station_managed_auto_dispatch
before insert or update of fulfillment_mode,station_branch_id,status,metadata on public.lpg_refill_orders
for each row execute function public.auto_assign_lpg_station_managed_order();

revoke all on function public.auto_assign_lpg_station_managed_order() from public,anon,authenticated;
comment on table public.lpg_station_managed_driver_invites is
  'Email invitations scoped to station-owned drivers; accepting requires a verified matching auth email.';
comment on function public.auto_assign_lpg_station_managed_order() is
  'Idempotent station-managed marketplace dispatch; does not affect independent-driver or SKIMA Fleet orders.';

commit;
