begin;

-- Station invitation mail is a notification/authentication channel only.
-- A station relationship is created only when the signed-in driver presses
-- "Accept invitation" inside SKIMA.
create or replace function public.read_lpg_station_managed_driver_access()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $station_driver_access$
declare
  driver_record public.lpg_station_managed_drivers%rowtype;
  station_record public.lpg_station_branches%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication required';
  end if;

  select * into driver_record
  from public.lpg_station_managed_drivers
  where user_id=auth.uid() and status='active'
  order by created_at desc
  limit 1;

  if not found then return jsonb_build_object('enabled',false); end if;

  select * into station_record
  from public.lpg_station_branches
  where id=driver_record.station_branch_id
    and approval_status='approved'
    and compliance_status='approved';

  if not found then return jsonb_build_object('enabled',false); end if;

  return jsonb_build_object(
    'enabled',true,
    'stationDriverId',driver_record.id,
    'stationBranchId',station_record.id,
    'stationName',station_record.display_name
  );
end;
$station_driver_access$;

-- Read the authenticated user's pending invite without consuming it.
create or replace function public.read_lpg_station_managed_driver_invitation_access()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $station_driver_invitation_access$
declare
  current_email text;
  invite_record public.lpg_station_managed_driver_invites%rowtype;
  station_record public.lpg_station_branches%rowtype;
begin
  if auth.uid() is null then return jsonb_build_object('enabled',false); end if;

  select lower(btrim(u.email)) into current_email
  from auth.users u
  where u.id=auth.uid() and u.email_confirmed_at is not null;

  if current_email is null or current_email='' then
    return jsonb_build_object('enabled',false,'reason','confirmed_email_required');
  end if;

  if exists(select 1 from public.lpg_station_managed_drivers d
            where d.user_id=auth.uid() and d.status='active') then
    return jsonb_build_object('enabled',false,'reason','already_station_driver');
  end if;

  select i.* into invite_record
  from public.lpg_station_managed_driver_invites i
  join public.lpg_station_fulfillment_settings settings
    on settings.station_branch_id=i.station_branch_id and settings.station_managed_enabled
  join public.lpg_station_branches station
    on station.id=i.station_branch_id
    and station.approval_status='approved'
    and station.compliance_status='approved'
  where lower(btrim(i.email))=current_email
    and i.status='pending'
    and i.expires_at>timezone('utc',now())
  order by i.created_at desc
  limit 1;

  if not found then return jsonb_build_object('enabled',false); end if;

  select * into station_record
  from public.lpg_station_branches
  where id=invite_record.station_branch_id;

  return jsonb_build_object(
    'enabled',true,
    'invitationId',invite_record.id,
    'stationBranchId',invite_record.station_branch_id,
    'stationName',station_record.display_name,
    'stationAddress',station_record.formatted_address,
    'driverName',invite_record.display_name,
    'driverPhone',invite_record.phone,
    'email',current_email,
    'expiresAt',invite_record.expires_at,
    'invitedAt',invite_record.created_at
  );
end;
$station_driver_invitation_access$;

-- This is the only function that accepts/enrols an invitation. It is invoked
-- by the explicit in-app button, never by workspace resolution or email-link
-- return handling.
create or replace function public.accept_lpg_station_managed_driver_invite()
returns uuid
language plpgsql
volatile
security definer
set search_path=public,pg_temp
as $accept_station_driver_invite$
declare
  current_email text;
  email_confirmed boolean;
  invite_record public.lpg_station_managed_driver_invites%rowtype;
  driver_record public.lpg_station_managed_drivers%rowtype;
  station_record public.lpg_station_branches%rowtype;
  pending_order record;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication required';
  end if;

  select lower(btrim(u.email)),(u.email_confirmed_at is not null)
  into current_email,email_confirmed
  from auth.users u where u.id=auth.uid();

  if current_email is null or not coalesce(email_confirmed,false) then
    raise exception using errcode='42501',message='sign in with the verified email address invited by the station';
  end if;

  if exists(select 1 from public.driver_profiles d where d.user_id=auth.uid()) then
    raise exception using errcode='55000',message='this account already has an independent or SKIMA Managed driver profile and cannot accept a Station Managed invitation';
  end if;

  select i.* into invite_record
  from public.lpg_station_managed_driver_invites i
  join public.lpg_station_fulfillment_settings settings
    on settings.station_branch_id=i.station_branch_id and settings.station_managed_enabled
  join public.lpg_station_branches station
    on station.id=i.station_branch_id
    and station.approval_status='approved'
    and station.compliance_status='approved'
  where lower(btrim(i.email))=current_email
    and i.status='pending'
    and i.expires_at>timezone('utc',now())
  order by i.created_at desc
  limit 1
  for update of i;

  if not found then
    select d.* into driver_record
    from public.lpg_station_managed_drivers d
    join public.lpg_station_managed_driver_invites accepted_invite
      on accepted_invite.station_branch_id=d.station_branch_id
     and accepted_invite.accepted_user_id=d.user_id
     and accepted_invite.status='accepted'
    where d.user_id=auth.uid() and d.status='active'
      and accepted_invite.email=current_email
    order by accepted_invite.accepted_at desc
    limit 1;
    if found then return driver_record.id; end if;
    raise exception using errcode='55000',message='there is no pending Station Managed invitation for this verified email address';
  end if;

  if exists(select 1 from public.lpg_station_managed_drivers d
            where d.user_id=auth.uid() and d.status='active'
              and d.station_branch_id<>invite_record.station_branch_id) then
    raise exception using errcode='23505',message='this account already belongs to a different active Station Managed branch';
  end if;

  insert into public.lpg_station_managed_drivers(
    station_branch_id,user_id,display_name,phone,status,created_by,metadata
  ) values (
    invite_record.station_branch_id,auth.uid(),invite_record.display_name,invite_record.phone,'active',
    invite_record.invited_by,
    jsonb_build_object('source','in_app_station_invitation_acceptance','invitationId',invite_record.id)
  )
  on conflict (station_branch_id,user_id) do update set
    display_name=excluded.display_name,
    phone=excluded.phone,
    status='active',
    updated_at=timezone('utc',now()),
    metadata=public.lpg_station_managed_drivers.metadata
      || jsonb_build_object('acceptedInvitationId',invite_record.id)
  returning * into driver_record;

  update public.lpg_station_managed_driver_invites
  set status='accepted',
      accepted_user_id=auth.uid(),
      accepted_at=timezone('utc',now()),
      updated_at=timezone('utc',now()),
      metadata=metadata||jsonb_build_object(
        'acceptedDriverId',driver_record.id,
        'acceptedInApp',true
      )
  where id=invite_record.id and status='pending';

  select * into station_record
  from public.lpg_station_branches
  where id=driver_record.station_branch_id;

  -- Drain the station's existing paid-order queue through its canonical
  -- dispatcher. This preserves the normal assignment/vehicle reservation rules.
  for pending_order in
    select o.id
    from public.lpg_refill_orders o
    where o.station_branch_id=driver_record.station_branch_id
      and o.fulfillment_channel='marketplace'
      and o.fulfillment_mode='station_managed'
      and o.status in ('payment_reserved','matching_station','matching_driver','driver_offered','driver_accepted','pickup_verified','station_en_route')
      and not exists (
        select 1 from public.lpg_station_managed_driver_assignments a
        where a.lpg_order_id=o.id and a.status<>'cancelled'
      )
    order by o.created_at
  loop
    perform public.auto_assign_lpg_station_managed_order_for_id(pending_order.id);
  end loop;

  return driver_record.id;
end;
$accept_station_driver_invite$;

-- Declining also happens in-app. The existing constrained status model uses
-- revoked plus an auditable decline reason rather than inventing a new status.
create or replace function public.decline_lpg_station_managed_driver_invite()
returns uuid
language plpgsql
volatile
security definer
set search_path=public,pg_temp
as $decline_station_driver_invite$
declare current_email text; invitation_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication required';
  end if;

  select lower(btrim(u.email)) into current_email
  from auth.users u
  where u.id=auth.uid() and u.email_confirmed_at is not null;

  if current_email is null or current_email='' then
    raise exception using errcode='42501',message='a verified email address is required';
  end if;

  update public.lpg_station_managed_driver_invites i
  set status='revoked',
      updated_at=timezone('utc',now()),
      metadata=i.metadata||jsonb_build_object('declinedInApp',true,'declinedAt',timezone('utc',now()))
  where i.id=(
    select candidate.id from public.lpg_station_managed_driver_invites candidate
    join public.lpg_station_fulfillment_settings settings
      on settings.station_branch_id=candidate.station_branch_id and settings.station_managed_enabled
    where lower(btrim(candidate.email))=current_email
      and candidate.status='pending'
      and candidate.expires_at>timezone('utc',now())
    order by candidate.created_at desc
    limit 1
    for update of candidate
  )
  returning i.id into invitation_id;

  if invitation_id is null then
    raise exception using errcode='55000',message='there is no pending Station Managed invitation to decline';
  end if;
  return invitation_id;
end;
$decline_station_driver_invite$;

-- Reuse the same workspace read model, adding the pending invite list and the
-- actual assignment queue so the station sees its real driver/vehicle/order links.
create or replace function public.read_lpg_station_managed_workspace(target_station_branch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $station_managed_workspace$
declare
  settings_record public.lpg_station_fulfillment_settings%rowtype;
  result jsonb;
  settings_found boolean:=false;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication required';
  end if;
  if not public.can_operate_lpg_station_branch(target_station_branch_id,'lpg.stations.manage') then
    raise exception using errcode='42501',message='branch-scoped station management permission is required';
  end if;

  select * into settings_record
  from public.lpg_station_fulfillment_settings
  where station_branch_id=target_station_branch_id;
  settings_found:=found;

  result:=jsonb_build_object(
    'settings',case when settings_found then jsonb_build_object(
      'stationManagedEnabled',settings_record.station_managed_enabled,
      'deliveryPricingMode',settings_record.delivery_pricing_mode,
      'deliveryFeeAmount',settings_record.delivery_fee_amount,
      'driverCompensationMode',settings_record.driver_compensation_mode,
      'driverCompensationPlan',settings_record.driver_compensation_plan,
      'currencyCode',settings_record.currency_code
    ) else jsonb_build_object(
      'stationManagedEnabled',false,
      'deliveryPricingMode','separate',
      'deliveryFeeAmount',0,
      'driverCompensationMode','in_app_plan',
      'driverCompensationPlan',jsonb_build_object(),
      'currencyCode','NGN'
    ) end,
    'drivers',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',d.id,'userId',d.user_id,'displayName',d.display_name,'phone',d.phone,'status',d.status
      ) order by d.created_at desc)
      from public.lpg_station_managed_drivers d
      where d.station_branch_id=target_station_branch_id
    ),'[]'::jsonb),
    'invitations',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,
        'email',i.email,
        'displayName',i.display_name,
        'phone',i.phone,
        'status',i.status,
        'expiresAt',i.expires_at,
        'acceptedAt',i.accepted_at,
        'createdAt',i.created_at,
        'deliveryStatus',i.metadata->>'deliveryStatus',
        'deliveryFailure',i.metadata->>'deliveryFailure'
      ) order by i.created_at desc)
      from (
        select invite.* from public.lpg_station_managed_driver_invites invite
        where invite.station_branch_id=target_station_branch_id
        order by invite.created_at desc
        limit 30
      ) i
    ),'[]'::jsonb),
    'agreements',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,'stationDriverId',a.station_driver_id,'agreementMode',a.agreement_mode,
        'agreementStatus',a.agreement_status,'terms',a.terms,'notes',a.notes,'effectiveFrom',a.effective_from
      ) order by a.created_at desc)
      from public.lpg_station_managed_driver_agreements a
      where a.station_branch_id=target_station_branch_id
      limit 20
    ),'[]'::jsonb),
    'payments',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',p.id,'stationDriverId',p.station_driver_id,'lpgOrderId',p.lpg_order_id,
        'currencyCode',p.currency_code,'amount',p.amount,'paymentMethod',p.payment_method,
        'paymentStatus',p.payment_status,'externalReference',p.external_reference,'confirmedAt',p.confirmed_at
      ) order by p.confirmed_at desc)
      from public.lpg_station_managed_driver_payment_records p
      where p.station_branch_id=target_station_branch_id
      limit 20
    ),'[]'::jsonb),
    'assignableOrders',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',o.id,'publicReference',o.public_reference,'status',o.status,'requestedKg',o.requested_kg,
        'totalAmount',o.total_amount,'currencyCode',o.currency_code,'fulfillmentMode',o.fulfillment_mode
      ) order by o.created_at desc)
      from public.lpg_refill_orders o
      where o.station_branch_id=target_station_branch_id
        and o.fulfillment_mode='station_managed'
        and o.status in ('payment_reserved','matching_station','matching_driver','driver_offered','driver_accepted','pickup_verified','station_en_route')
        and not exists(
          select 1 from public.lpg_station_managed_driver_assignments a
          where a.lpg_order_id=o.id and a.status<>'cancelled'
        )
    ),'[]'::jsonb),
    'assignedOrders',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',o.id,
        'lpgOrderId',o.id,
        'publicReference',o.public_reference,
        'orderStatus',o.status,
        'assignmentId',a.id,
        'assignmentStatus',a.status,
        'requestedKg',o.requested_kg,
        'actualKg',o.actual_kg,
        'totalAmount',o.total_amount,
        'currencyCode',o.currency_code,
        'assignedAt',a.assigned_at,
        'completedAt',a.completed_at,
        'driverId',d.id,
        'driverName',d.display_name,
        'driverPhone',d.phone,
        'vehicleId',a.vehicle_id,
        'vehicleRegistration',v.registration_number,
        'vehicleType',vt.display_name
      ) order by a.assigned_at desc)
      from public.lpg_station_managed_driver_assignments a
      join public.lpg_refill_orders o on o.id=a.lpg_order_id
      join public.lpg_station_managed_drivers d on d.id=a.station_driver_id
      left join public.vehicles v on v.id=a.vehicle_id
      left join public.vehicle_types vt on vt.id=v.vehicle_type_id
      where a.station_branch_id=target_station_branch_id
        and a.status in ('assigned','accepted','en_route','delivered')
        and o.fulfillment_mode='station_managed'
        and o.status not in ('cancelled','failed','refunded','expired')
      limit 50
    ),'[]'::jsonb)
  );
  return result;
end;
$station_managed_workspace$;

-- The station driver's worklist remains backed by the canonical assignment and
-- order rows, and now includes the vehicle that dispatch reserved for that job.
create or replace function public.read_lpg_station_managed_driver_jobs(target_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $station_driver_jobs$
declare driver_record public.lpg_station_managed_drivers%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication required';
  end if;

  select * into driver_record
  from public.lpg_station_managed_drivers
  where user_id=auth.uid() and status='active'
  limit 1;
  if not found then
    raise exception using errcode='42501',message='active Station Managed driver identity is required';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',assignment.id,
      'lpgOrderId',order_record.id,
      'publicReference',order_record.public_reference,
      'status',assignment.status,
      'orderStatus',order_record.status,
      'requestedKg',order_record.requested_kg,
      'actualKg',order_record.actual_kg,
      'totalAmount',order_record.total_amount,
      'currencyCode',order_record.currency_code,
      'assignedAt',assignment.assigned_at,
      'completedAt',assignment.completed_at,
      'stationName',station.display_name,
      'stationAddress',station.formatted_address,
      'deliveryAddress',location.formatted_address,
      'deliveryInstructions',location.delivery_instructions,
      'customerName',location.contact_name,
      'vehicleId',assignment.vehicle_id,
      'vehicleRegistration',vehicle.registration_number,
      'vehicleType',vehicle_type.display_name,
      'vehicleStatus',vehicle.status
    ) order by assignment.assigned_at desc)
    from (
      select a.* from public.lpg_station_managed_driver_assignments a
      where a.station_driver_id=driver_record.id
        and a.status in ('assigned','accepted','en_route','delivered')
        and not exists (
          select 1 from public.lpg_refill_orders terminal_order
          where terminal_order.id=a.lpg_order_id
            and terminal_order.status in ('cancelled','failed','refunded','expired')
        )
      order by a.assigned_at desc
      limit greatest(1,least(coalesce(target_limit,50),100))
    ) assignment
    join public.lpg_refill_orders order_record on order_record.id=assignment.lpg_order_id
    join public.lpg_station_branches station on station.id=assignment.station_branch_id
    left join public.lpg_customer_locations location on location.id=order_record.delivery_location_id
    left join public.vehicles vehicle on vehicle.id=assignment.vehicle_id
    left join public.vehicle_types vehicle_type on vehicle_type.id=vehicle.vehicle_type_id
  ),'[]'::jsonb);
end;
$station_driver_jobs$;

-- Extend the existing LPG location stream instead of creating a parallel
-- Station Managed tracking store. A location row belongs to exactly one driver
-- identity: independent/SKIMA driver profile OR Station Managed driver.
alter table public.lpg_driver_locations
  alter column driver_profile_id drop not null;

alter table public.lpg_driver_locations
  add column if not exists station_driver_id uuid references public.lpg_station_managed_drivers(id) on delete restrict;

do $station_location_identity_constraint$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.lpg_driver_locations'::regclass
      and conname='lpg_driver_locations_exactly_one_driver_identity'
  ) then
    alter table public.lpg_driver_locations
      add constraint lpg_driver_locations_exactly_one_driver_identity
      check ((driver_profile_id is not null) <> (station_driver_id is not null));
  end if;
end;
$station_location_identity_constraint$;

create index if not exists lpg_driver_locations_station_driver_order_recorded_idx
  on public.lpg_driver_locations(station_driver_id,lpg_order_id,recorded_at desc)
  where station_driver_id is not null;

create or replace function public.record_lpg_station_managed_driver_location(
  target_station_driver_id uuid,
  target_lpg_order_id uuid,
  target_latitude numeric,
  target_longitude numeric,
  target_idempotency_key text,
  target_accuracy_meters numeric default null,
  target_heading_degrees numeric default null,
  target_speed_meters_per_second numeric default null,
  target_recorded_at timestamptz default timezone('utc',now()),
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.station_managed_driver.mobile'
)
returns uuid
language plpgsql
volatile
security definer
set search_path=public,pg_temp
as $station_driver_location$
declare
  driver_record public.lpg_station_managed_drivers%rowtype;
  assignment_record public.lpg_station_managed_driver_assignments%rowtype;
  order_record public.lpg_refill_orders%rowtype;
  location_id uuid;
  existing_location public.lpg_driver_locations%rowtype;
  effective_recorded_at timestamptz:=coalesce(target_recorded_at,timezone('utc',now()));
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication required';
  end if;
  if target_latitude is null or target_latitude < -90 or target_latitude > 90
    or target_longitude is null or target_longitude < -180 or target_longitude > 180 then
    raise exception using errcode='22023',message='valid latitude and longitude are required';
  end if;
  if target_station_driver_id is null or target_lpg_order_id is null
    or nullif(btrim(target_idempotency_key),'') is null
    or nullif(btrim(target_source),'') is null
    or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='driver, order, idempotency key and metadata are required';
  end if;
  if target_accuracy_meters is not null and target_accuracy_meters<0 then
    raise exception using errcode='22023',message='accuracy must be non-negative';
  end if;
  if target_heading_degrees is not null and (target_heading_degrees<0 or target_heading_degrees>=360) then
    raise exception using errcode='22023',message='heading must be between 0 and 359.999';
  end if;
  if target_speed_meters_per_second is not null and target_speed_meters_per_second<0 then
    raise exception using errcode='22023',message='speed must be non-negative';
  end if;

  select * into driver_record
  from public.lpg_station_managed_drivers
  where id=target_station_driver_id
    and user_id=auth.uid()
    and status='active';
  if not found then
    raise exception using errcode='42501',message='active Station Managed driver identity is required';
  end if;

  select * into assignment_record
  from public.lpg_station_managed_driver_assignments
  where lpg_order_id=target_lpg_order_id
    and station_driver_id=driver_record.id
    and station_branch_id=driver_record.station_branch_id
    and status in ('accepted','en_route')
  for update;
  if not found then
    raise exception using errcode='42501',message='live tracking is allowed only for your accepted Station Managed delivery';
  end if;

  select * into order_record
  from public.lpg_refill_orders
  where id=target_lpg_order_id
    and station_branch_id=driver_record.station_branch_id
    and fulfillment_mode='station_managed'
    and status in (
      'driver_accepted','pickup_en_route','pickup_verified','station_en_route',
      'station_verified','refill_started','refill_in_progress','refill_confirmed',
      'station_settled','return_en_route','delivery_verification_pending'
    )
  for update;
  if not found then
    raise exception using errcode='55000',message='this LPG order is not in an active Station Managed route stage';
  end if;

  insert into public.lpg_driver_locations(
    driver_profile_id,station_driver_id,user_id,lpg_order_id,
    latitude,longitude,accuracy_meters,heading_degrees,speed_meters_per_second,
    online_status,recorded_at,metadata,source,idempotency_key
  ) values (
    null,driver_record.id,auth.uid(),order_record.id,
    target_latitude,target_longitude,target_accuracy_meters,target_heading_degrees,target_speed_meters_per_second,
    'busy',effective_recorded_at,
    target_metadata||jsonb_build_object(
      'stationManaged',true,
      'stationDriverId',driver_record.id,
      'stationAssignmentId',assignment_record.id
    ),
    target_source,target_idempotency_key
  )
  on conflict(source,idempotency_key) do nothing
  returning id into location_id;

  if location_id is null then
    select * into existing_location from public.lpg_driver_locations
    where source=target_source and idempotency_key=target_idempotency_key;
    if not found
      or existing_location.station_driver_id is distinct from driver_record.id
      or existing_location.lpg_order_id is distinct from order_record.id
      or existing_location.latitude is distinct from target_latitude
      or existing_location.longitude is distinct from target_longitude then
      raise exception using errcode='23505',message='location idempotency key was already used for different tracking data';
    end if;
    location_id:=existing_location.id;
  end if;

  -- Publish the same location to the order's existing tracking session so the
  -- customer tracking screen and station workflow continue to share one stream.
  if order_record.tracking_session_id is not null then
    insert into public.tracking_points(
      tracking_session_id,recorded_by,latitude,longitude,accuracy_meters,
      speed_meters_per_second,heading_degrees,metadata,recorded_at,idempotency_key
    )
    select session.id,auth.uid(),target_latitude,target_longitude,target_accuracy_meters,
      target_speed_meters_per_second,target_heading_degrees,
      target_metadata||jsonb_build_object(
        'source',target_source,
        'stationDriverId',driver_record.id,
        'stationAssignmentId',assignment_record.id,
        'lpgDriverLocationId',location_id
      ),
      effective_recorded_at,target_idempotency_key||':tracking-point'
    from public.tracking_sessions session
    where session.id=order_record.tracking_session_id
      and session.status='active'
    on conflict (tracking_session_id,idempotency_key)
    where idempotency_key is not null
    do nothing;
  end if;

  return location_id;
end;
$station_driver_location$;

-- Return Station Managed driver/vehicle details within the same canonical job
-- details payload. The assigned station driver is deliberately not projected as
-- a driver_profiles record.
do $station_managed_job_details_projection$
declare function_sql text; old_vehicle_block text; new_vehicle_block text; old_join_block text; new_join_block text;
begin
  function_sql:=pg_get_functiondef('public.read_lpg_job_details(uuid)'::regprocedure);
  old_vehicle_block:=E'    \'vehicle\', case when vehicle.id is null then null else jsonb_build_object(\n      \'id\', vehicle.id,\n      \'typeKey\', vehicle_type.key,\n      \'typeName\', vehicle_type.display_name,\n      \'status\', vehicle.status,\n      \'capacityProfile\', vehicle.capacity_profile,\n      \'metadata\', vehicle.metadata\n    ) end,\n    \'events\', coalesce((';
  new_vehicle_block:=E'    \'vehicle\', case when vehicle.id is null then null else jsonb_build_object(\n      \'id\', vehicle.id,\n      \'typeKey\', vehicle_type.key,\n      \'typeName\', vehicle_type.display_name,\n      \'status\', vehicle.status,\n      \'capacityProfile\', vehicle.capacity_profile,\n      \'metadata\', vehicle.metadata\n    ) end,\n    \'stationManagedDriver\', case when station_driver.id is null then null else jsonb_build_object(\n      \'id\', station_driver.id,\n      \'displayName\', station_driver.display_name,\n      \'status\', station_driver.status\n    ) end,\n    \'stationManagedAssignment\', case when station_assignment.id is null then null else jsonb_build_object(\n      \'id\', station_assignment.id,\n      \'status\', station_assignment.status,\n      \'assignedAt\', station_assignment.assigned_at,\n      \'completedAt\', station_assignment.completed_at,\n      \'vehicleId\', station_assignment.vehicle_id\n    ) end,\n    \'stationManagedVehicle\', case when station_vehicle.id is null then null else jsonb_build_object(\n      \'id\', station_vehicle.id,\n      \'registrationNumber\', station_vehicle.registration_number,\n      \'typeName\', station_vehicle_type.display_name,\n      \'status\', station_vehicle.status\n    ) end,\n    \'events\', coalesce((';
  if position(old_vehicle_block in function_sql)=0 then
    raise exception 'Could not locate canonical LPG job details vehicle projection';
  end if;
  function_sql:=replace(function_sql,old_vehicle_block,new_vehicle_block);
  old_join_block:=E'  left join public.vehicles vehicle on vehicle.id = target_order.vehicle_id\n  left join public.vehicle_types vehicle_type on vehicle_type.id = vehicle.vehicle_type_id\n  where target_order.id = target_lpg_order_id;';
  new_join_block:=E'  left join public.vehicles vehicle on vehicle.id = target_order.vehicle_id\n  left join public.vehicle_types vehicle_type on vehicle_type.id = vehicle.vehicle_type_id\n  left join public.lpg_station_managed_driver_assignments station_assignment\n    on station_assignment.lpg_order_id = target_order.id and station_assignment.status <> \'cancelled\'\n  left join public.lpg_station_managed_drivers station_driver on station_driver.id = station_assignment.station_driver_id\n  left join public.vehicles station_vehicle on station_vehicle.id = station_assignment.vehicle_id\n  left join public.vehicle_types station_vehicle_type on station_vehicle_type.id = station_vehicle.vehicle_type_id\n  where target_order.id = target_lpg_order_id;';
  if position(old_join_block in function_sql)=0 then
    raise exception 'Could not locate canonical LPG job details joins';
  end if;
  execute replace(function_sql,old_join_block,new_join_block);
end;
$station_managed_job_details_projection$;

revoke all on function public.read_lpg_station_managed_driver_access() from public,anon;
revoke all on function public.read_lpg_station_managed_driver_invitation_access() from public,anon;
revoke all on function public.accept_lpg_station_managed_driver_invite() from public,anon;
revoke all on function public.accept_lpg_station_managed_driver_invitation() from public,anon;
revoke all on function public.decline_lpg_station_managed_driver_invite() from public,anon;
revoke all on function public.read_lpg_station_managed_workspace(uuid) from public,anon;
revoke all on function public.read_lpg_station_managed_driver_jobs(integer) from public,anon;
revoke all on function public.record_lpg_station_managed_driver_location(uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,timestamptz,jsonb,text) from public,anon;

grant execute on function public.read_lpg_station_managed_driver_access() to authenticated,service_role;
grant execute on function public.read_lpg_station_managed_driver_invitation_access() to authenticated,service_role;
grant execute on function public.accept_lpg_station_managed_driver_invite() to authenticated,service_role;
grant execute on function public.accept_lpg_station_managed_driver_invitation() to authenticated,service_role;
grant execute on function public.decline_lpg_station_managed_driver_invite() to authenticated,service_role;
grant execute on function public.read_lpg_station_managed_workspace(uuid) to authenticated,service_role;
grant execute on function public.read_lpg_station_managed_driver_jobs(integer) to authenticated,service_role;
grant execute on function public.record_lpg_station_managed_driver_location(uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,timestamptz,jsonb,text) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
