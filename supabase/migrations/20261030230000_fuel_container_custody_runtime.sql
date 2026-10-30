begin;

alter table public.fuel_container_allocations
add column if not exists filled_litres numeric(12,3) not null default 0
  check (filled_litres >= 0 and filled_litres <= allocated_litres);

alter table public.fuel_container_allocations
add column if not exists delivered_litres numeric(12,3)
  check (delivered_litres is null or delivered_litres >= 0);

create index if not exists fuel_container_allocations_branch_status_idx
on public.fuel_container_allocations(station_branch_id,status,created_at desc);

create or replace function public.register_fuel_container_asset(
  target_serial_number text,
  target_container_type_id uuid,
  target_capacity_litres numeric default null,
  target_organization_id uuid default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  type_record public.fuel_container_types%rowtype;
  asset_id uuid;
  profile_id uuid;
  resolved_capacity numeric(12,3);
begin
  if auth.role()<>'service_role' and not public.can_manage_fuel_platform() then
    raise exception using errcode='42501',message='platform fuel management permission is required';
  end if;

  if coalesce(btrim(target_serial_number),'')='' or target_container_type_id is null
     or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='container serial, type and object metadata are required';
  end if;

  select * into type_record
  from public.fuel_container_types
  where id=target_container_type_id and status='active';

  if not found then
    raise exception using errcode='55000',message='active fuel container type was not found';
  end if;

  resolved_capacity:=coalesce(target_capacity_litres,type_record.nominal_capacity_litres);
  if resolved_capacity<=0 or resolved_capacity>type_record.nominal_capacity_litres then
    raise exception using errcode='23514',message='container capacity must be positive and cannot exceed its configured type';
  end if;

  if exists(select 1 from public.fuel_container_profiles where serial_number=btrim(target_serial_number)) then
    raise exception using errcode='23505',message='fuel container serial already exists';
  end if;

  insert into public.assets(
    organization_id,owner_user_id,asset_type_key,status,metadata,created_by
  )
  values(
    target_organization_id,null,'asset.fuel-container','active',
    target_metadata||jsonb_build_object('serial_number',btrim(target_serial_number),'ownership_mode','skima'),
    auth.uid()
  )
  returning id into asset_id;

  insert into public.fuel_container_profiles(
    asset_id,container_type_id,serial_number,ownership_mode,capacity_litres,status,metadata,created_by
  )
  values(
    asset_id,target_container_type_id,btrim(target_serial_number),'skima',resolved_capacity,'available',
    target_metadata,auth.uid()
  )
  returning id into profile_id;

  return profile_id;
end;
$$;

create or replace function public.reserve_fuel_order_container(
  target_order_id uuid,
  target_container_profile_id uuid,
  target_allocated_litres numeric,
  target_allocation_mode text,
  target_purchase_amount numeric default 0,
  target_rental_amount numeric default 0,
  target_refundable_deposit_amount numeric default 0,
  target_currency_code text default 'NGN',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record public.order_records%rowtype;
  operation_record public.fuel_order_operations%rowtype;
  profile_record public.fuel_container_profiles%rowtype;
  quote_record public.fuel_order_commercial_snapshots%rowtype;
  existing_record public.fuel_container_allocations%rowtype;
  existing_count integer;
  existing_litres numeric(16,3);
  existing_container_amount numeric(20,8);
  existing_deposit_amount numeric(20,8);
  allocation_id uuid;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='fuel container allocation must be performed by the authorized SKIMA order runtime';
  end if;

  if target_order_id is null or target_container_profile_id is null
     or target_allocated_litres is null or target_allocated_litres<=0
     or target_allocation_mode not in ('purchase','rental')
     or target_purchase_amount is null or target_purchase_amount<0
     or target_rental_amount is null or target_rental_amount<0
     or target_refundable_deposit_amount is null or target_refundable_deposit_amount<0
     or target_currency_code is null
     or coalesce(btrim(target_idempotency_key),'')=''
     or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='valid order, container, litres, allocation mode, amounts, idempotency key and object metadata are required';
  end if;

  if target_allocation_mode='purchase' and (target_rental_amount<>0 or target_refundable_deposit_amount<>0) then
    raise exception using errcode='22023',message='purchase allocation cannot contain rental charges or refundable rental deposits';
  end if;
  if target_allocation_mode='rental' and target_purchase_amount<>0 then
    raise exception using errcode='22023',message='rental allocation cannot contain a container purchase amount';
  end if;

  select * into existing_record
  from public.fuel_container_allocations
  where source='platform.fuel_container' and idempotency_key=target_idempotency_key;

  if found then
    if existing_record.order_id<>target_order_id
       or existing_record.container_profile_id<>target_container_profile_id
       or existing_record.allocated_litres<>target_allocated_litres
       or existing_record.allocation_mode<>target_allocation_mode then
      raise exception using errcode='23505',message='fuel container allocation idempotency key was reused with different details';
    end if;
    return existing_record.id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_order_id::text,0));

  select * into order_record from public.order_records where id=target_order_id for update;
  if not found or not exists(select 1 from public.business_modules where id=order_record.module_id and key='fuel') then
    raise exception using errcode='23514',message='container allocation requires an existing Fuel order';
  end if;

  select * into operation_record from public.fuel_order_operations where order_id=target_order_id for update;
  if not found or operation_record.stage_key not in ('awaiting_station_acceptance','stock_reserved','station_filling') then
    raise exception using errcode='55000',message='Fuel order is not accepting container allocations';
  end if;

  if operation_record.container_mode<>target_allocation_mode then
    raise exception using errcode='23514',message='container purchase or rental mode must match the customer order choice';
  end if;

  select * into quote_record
  from public.fuel_order_commercial_snapshots
  where service_request_id=order_record.service_request_id
    and status='accepted';

  if not found then
    raise exception using errcode='55000',message='an accepted commercial quote is required before allocating fuel containers';
  end if;

  if quote_record.product_key<>operation_record.product_key
     or quote_record.container_mode<>operation_record.container_mode
     or quote_record.currency_code<>target_currency_code
     or profile_record.container_type_id<>operation_record.container_type_id then
    raise exception using errcode='23514',message='container allocation does not match the accepted fuel quote';
  end if;

  select * into profile_record
  from public.fuel_container_profiles
  where id=target_container_profile_id
  for update;

  if not found or profile_record.status<>'available' or profile_record.ownership_mode<>'skima' then
    raise exception using errcode='55000',message='only available SKIMA-owned containers can be allocated to a Fuel order';
  end if;

  select count(*),coalesce(sum(allocated_litres),0),
         coalesce(sum(case when allocation_mode='purchase' then purchase_amount else rental_amount end),0),
         coalesce(sum(refundable_deposit_amount),0)
  into existing_count,existing_litres,existing_container_amount,existing_deposit_amount
  from public.fuel_container_allocations
  where order_id=target_order_id and status<>'cancelled';

  if existing_count>=quote_record.container_count
     or existing_litres+target_allocated_litres>quote_record.requested_litres
     or existing_container_amount+case when target_allocation_mode='purchase' then target_purchase_amount else target_rental_amount end>quote_record.container_amount
     or existing_deposit_amount+target_refundable_deposit_amount>quote_record.refundable_deposit_amount then
    raise exception using errcode='23514',message='container allocations exceed accepted quote count, litres or commercial amounts';
  end if;

  insert into public.fuel_container_allocations(
    container_profile_id,order_id,product_key,station_branch_id,customer_user_id,
    allocated_litres,allocation_mode,purchase_amount,rental_amount,refundable_deposit_amount,
    currency_code,status,source,idempotency_key,metadata,created_by
  )
  values(
    profile_record.id,target_order_id,operation_record.product_key,operation_record.station_branch_id,
    operation_record.customer_user_id,target_allocated_litres,target_allocation_mode,
    target_purchase_amount,target_rental_amount,target_refundable_deposit_amount,
    target_currency_code,'reserved','platform.fuel_container',target_idempotency_key,target_metadata,auth.uid()
  )
  returning id into allocation_id;

  update public.fuel_container_profiles
  set status='reserved',updated_by=auth.uid(),updated_at=timezone('utc',now())
  where id=profile_record.id;

  insert into public.fuel_container_custody_events(
    allocation_id,container_profile_id,order_id,event_key,from_holder_type,from_holder_id,
    to_holder_type,to_holder_id,actor_user_id,note,idempotency_key,metadata
  )
  values(
    allocation_id,profile_record.id,target_order_id,'reserved','platform',null,
    'station',operation_record.station_branch_id,auth.uid(),'Reserved for fuel order',
    target_idempotency_key||':custody-reserved',target_metadata
  );

  return allocation_id;
end;
$$;

create or replace function public.record_fuel_container_handover(
  target_allocation_id uuid,
  target_event_key text,
  target_from_holder_type text,
  target_from_holder_id uuid,
  target_to_holder_type text,
  target_to_holder_id uuid,
  target_actor_user_id uuid,
  target_measured_litres numeric default null,
  target_verification_reference text default null,
  target_note text default null,
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  allocation_record public.fuel_container_allocations%rowtype;
  profile_record public.fuel_container_profiles%rowtype;
  operation_record public.fuel_order_operations%rowtype;
  existing_event public.fuel_container_custody_events%rowtype;
  next_allocation_status text;
  next_profile_status text;
  event_id uuid;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='fuel container custody must be recorded by the authorized SKIMA operations runtime';
  end if;

  if target_allocation_id is null or target_event_key not in (
       'station_filled','handed_to_driver','delivered_to_customer','returned_to_driver','received_at_station'
     )
     or target_from_holder_type not in ('station','driver','customer','platform')
     or target_to_holder_type not in ('station','driver','customer','platform')
     or target_from_holder_id is null or target_to_holder_id is null
     or target_actor_user_id is null
     or coalesce(btrim(target_idempotency_key),'')=''
     or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='container custody event requires valid holders, actor, event key, idempotency key and object metadata';
  end if;

  select * into existing_event
  from public.fuel_container_custody_events
  where idempotency_key=target_idempotency_key;

  if found then
    if existing_event.allocation_id<>target_allocation_id or existing_event.event_key<>target_event_key then
      raise exception using errcode='23505',message='container custody idempotency key was reused with different details';
    end if;
    return existing_event.id;
  end if;

  select * into allocation_record
  from public.fuel_container_allocations
  where id=target_allocation_id
  for update;

  if not found then
    raise exception using errcode='P0002',message='fuel container allocation was not found';
  end if;

  select * into operation_record
  from public.fuel_order_operations
  where order_id=allocation_record.order_id
  for update;

  select * into profile_record
  from public.fuel_container_profiles
  where id=allocation_record.container_profile_id
  for update;

  if target_event_key='station_filled' then
    if allocation_record.status<>'reserved' or target_from_holder_type<>'station'
       or target_to_holder_type<>'station'
       or target_from_holder_id<>allocation_record.station_branch_id
       or target_to_holder_id<>allocation_record.station_branch_id
       or target_measured_litres is null or target_measured_litres<=0
       or target_measured_litres>allocation_record.allocated_litres then
      raise exception using errcode='23514',message='station fill proof must match a reserved container and its capacity allocation';
    end if;
    next_allocation_status:='station_prepared';
    next_profile_status:='at_station';
  elsif target_event_key='handed_to_driver' then
    if allocation_record.status<>'station_prepared'
       or target_from_holder_type<>'station' or target_to_holder_type<>'driver'
       or target_from_holder_id<>allocation_record.station_branch_id
       or not exists (
         select 1 from public.order_assignments assignment
         where assignment.order_id=allocation_record.order_id
           and assignment.participant_role='driver'
           and assignment.entity_id=target_to_holder_id
           and assignment.entity_type in ('driver','user')
           and assignment.status='active'
       ) then
      raise exception using errcode='23514',message='driver handover requires a station-prepared container and the active assigned driver';
    end if;
    next_allocation_status:='with_driver';
    next_profile_status:='with_driver';
  elsif target_event_key='delivered_to_customer' then
    if allocation_record.status<>'with_driver'
       or target_from_holder_type<>'driver' or target_to_holder_type<>'customer'
       or target_to_holder_id<>allocation_record.customer_user_id
       or not exists (
         select 1 from public.order_assignments assignment
         where assignment.order_id=allocation_record.order_id
           and assignment.participant_role='driver'
           and assignment.entity_id=target_from_holder_id
           and assignment.entity_type in ('driver','user')
           and assignment.status='active'
       )
       or target_measured_litres is null or target_measured_litres<=0
       or abs(target_measured_litres-allocation_record.filled_litres)>0.001 then
      raise exception using errcode='23514',message='customer delivery requires driver custody and quantity confirmation matching the station fill';
    end if;
    next_allocation_status:=case when allocation_record.allocation_mode='purchase' then 'ownership_transferred' else 'delivered' end;
    next_profile_status:='with_customer';
  elsif target_event_key='returned_to_driver' then
    if allocation_record.allocation_mode<>'rental'
       or allocation_record.status<>'delivered'
       or target_from_holder_type<>'customer' or target_from_holder_id<>allocation_record.customer_user_id
       or target_to_holder_type<>'driver'
       or not exists (
         select 1 from public.order_assignments assignment
         where assignment.order_id=allocation_record.order_id
           and assignment.participant_role='driver'
           and assignment.entity_id=target_to_holder_id
           and assignment.entity_type in ('driver','user')
           and assignment.status='active'
       ) then
      raise exception using errcode='23514',message='only a delivered rental container can be returned by the customer to the driver';
    end if;
    next_allocation_status:='returned_to_driver';
    next_profile_status:='with_driver';
  elsif target_event_key='received_at_station' then
    if allocation_record.allocation_mode<>'rental'
       or allocation_record.status<>'returned_to_driver'
       or target_from_holder_type<>'driver'
       or not exists (
         select 1 from public.order_assignments assignment
         where assignment.order_id=allocation_record.order_id
           and assignment.participant_role='driver'
           and assignment.entity_id=target_from_holder_id
           and assignment.entity_type in ('driver','user')
           and assignment.status='active'
       )
       or target_to_holder_type<>'station'
       or target_to_holder_id<>allocation_record.station_branch_id then
      raise exception using errcode='23514',message='only a returned rental container can be received back at its allocated station';
    end if;
    next_allocation_status:='inspection';
    next_profile_status:='inspection';
  end if;

  if target_event_key='delivered_to_customer' and allocation_record.allocation_mode='purchase' then
    update public.assets
    set owner_user_id=allocation_record.customer_user_id,
        organization_id=null,
        metadata=metadata||jsonb_build_object('ownership_transferred_at',timezone('utc',now()),'ownership_transfer_order_id',allocation_record.order_id),
        updated_at=timezone('utc',now())
    where id=profile_record.asset_id;

    update public.fuel_container_profiles
    set ownership_mode='customer',status=next_profile_status,updated_by=target_actor_user_id,updated_at=timezone('utc',now())
    where id=profile_record.id;
  else
    update public.fuel_container_profiles
    set status=next_profile_status,updated_by=target_actor_user_id,updated_at=timezone('utc',now())
    where id=profile_record.id;
  end if;

  update public.fuel_container_allocations
  set status=next_allocation_status,
      filled_litres=case when target_event_key='station_filled' then target_measured_litres else filled_litres end,
      delivered_litres=case when target_event_key='delivered_to_customer' then target_measured_litres else delivered_litres end,
      delivered_at=case when target_event_key='delivered_to_customer' then coalesce(delivered_at,timezone('utc',now())) else delivered_at end,
      returned_at=case when target_event_key='returned_to_driver' then coalesce(returned_at,timezone('utc',now())) else returned_at end,
      received_at_station_at=case when target_event_key='received_at_station' then coalesce(received_at_station_at,timezone('utc',now())) else received_at_station_at end,
      updated_at=timezone('utc',now())
  where id=target_allocation_id;

  insert into public.fuel_container_custody_events(
    allocation_id,container_profile_id,order_id,event_key,from_holder_type,from_holder_id,
    to_holder_type,to_holder_id,actor_user_id,verification_reference,note,idempotency_key,metadata
  )
  values(
    allocation_record.id,allocation_record.container_profile_id,allocation_record.order_id,
    target_event_key,target_from_holder_type,target_from_holder_id,target_to_holder_type,target_to_holder_id,
    target_actor_user_id,target_verification_reference,nullif(btrim(target_note),''),target_idempotency_key,target_metadata
  )
  returning id into event_id;

  if target_event_key='delivered_to_customer' and allocation_record.allocation_mode='purchase' then
    insert into public.fuel_container_custody_events(
      allocation_id,container_profile_id,order_id,event_key,from_holder_type,from_holder_id,
      to_holder_type,to_holder_id,actor_user_id,verification_reference,note,idempotency_key,metadata
    )
    values(
      allocation_record.id,allocation_record.container_profile_id,allocation_record.order_id,
      'ownership_transferred','platform',null,'customer',allocation_record.customer_user_id,
      target_actor_user_id,target_verification_reference,'Purchased container ownership transferred',
      target_idempotency_key||':ownership',target_metadata
    );
  end if;

  return event_id;
end;
$$;

create or replace function public.record_fuel_container_inspection(
  target_allocation_id uuid,
  target_inspection_result text,
  target_actor_user_id uuid,
  target_note text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  allocation_record public.fuel_container_allocations%rowtype;
  profile_record public.fuel_container_profiles%rowtype;
  existing_event public.fuel_container_custody_events%rowtype;
  event_key_value text;
  next_allocation_status text;
  next_profile_status text;
  event_id uuid;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='container inspection must be recorded by the authorized SKIMA operations runtime';
  end if;

  if target_allocation_id is null or target_inspection_result not in ('passed','failed','conditional')
     or target_actor_user_id is null or coalesce(btrim(target_idempotency_key),'')=''
     or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='inspection requires allocation, result, actor, idempotency key and object metadata';
  end if;

  select * into existing_event
  from public.fuel_container_custody_events
  where idempotency_key=target_idempotency_key;

  if found then
    if existing_event.allocation_id<>target_allocation_id
       or existing_event.event_key<>case when target_inspection_result='passed' then 'inspection_passed' else 'inspection_failed' end then
      raise exception using errcode='23505',message='container inspection idempotency key was reused with different details';
    end if;
    return existing_event.id;
  end if;

  select * into allocation_record
  from public.fuel_container_allocations
  where id=target_allocation_id
  for update;

  if not found or allocation_record.allocation_mode<>'rental' or allocation_record.status<>'inspection' then
    raise exception using errcode='55000',message='only a returned rental container awaiting inspection can be inspected';
  end if;

  select * into profile_record
  from public.fuel_container_profiles
  where id=allocation_record.container_profile_id
  for update;

  if target_inspection_result='passed' then
    event_key_value:='inspection_passed';
    next_allocation_status:='available';
    next_profile_status:='available';
  else
    event_key_value:='inspection_failed';
    next_allocation_status:='exception';
    next_profile_status:=case when target_inspection_result='failed' then 'damaged' else 'inspection' end;
  end if;

  update public.fuel_container_profiles
  set status=next_profile_status,
      last_inspected_at=timezone('utc',now()),
      last_inspection_result=target_inspection_result,
      updated_by=target_actor_user_id,
      updated_at=timezone('utc',now())
  where id=profile_record.id;

  update public.fuel_container_allocations
  set status=next_allocation_status,
      closed_at=case when target_inspection_result='passed' then timezone('utc',now()) else closed_at end,
      metadata=metadata||jsonb_build_object('inspection_result',target_inspection_result,'inspection_note',target_note),
      updated_at=timezone('utc',now())
  where id=allocation_record.id;

  insert into public.fuel_container_custody_events(
    allocation_id,container_profile_id,order_id,event_key,
    from_holder_type,from_holder_id,to_holder_type,to_holder_id,
    actor_user_id,note,idempotency_key,metadata
  )
  values(
    allocation_record.id,allocation_record.container_profile_id,allocation_record.order_id,event_key_value,
    'station',allocation_record.station_branch_id,
    case when target_inspection_result='passed' then 'station' else 'platform' end,
    case when target_inspection_result='passed' then allocation_record.station_branch_id else null end,
    target_actor_user_id,nullif(btrim(target_note),''),target_idempotency_key,
    target_metadata||jsonb_build_object('inspection_result',target_inspection_result)
  )
  returning id into event_id;

  return event_id;
end;
$$;

revoke all on function public.register_fuel_container_asset(text,uuid,numeric,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.reserve_fuel_order_container(uuid,uuid,numeric,text,numeric,numeric,numeric,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.record_fuel_container_handover(uuid,text,text,uuid,text,uuid,uuid,numeric,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.record_fuel_container_inspection(uuid,text,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.register_fuel_container_asset(text,uuid,numeric,uuid,jsonb) to service_role;
grant execute on function public.reserve_fuel_order_container(uuid,uuid,numeric,text,numeric,numeric,numeric,text,text,jsonb) to service_role;
grant execute on function public.record_fuel_container_handover(uuid,text,text,uuid,text,uuid,uuid,numeric,text,text,text,jsonb) to service_role;
grant execute on function public.record_fuel_container_inspection(uuid,text,uuid,text,text,jsonb) to service_role;

commit;
