begin;

drop index if exists public.fuel_order_stock_reservations_one_open_line;

alter table public.fuel_order_stock_reservations
add column if not exists consumed_litres numeric(16,3) not null default 0
  check (consumed_litres >= 0 and consumed_litres <= reserved_litres);

alter table public.fuel_order_operations
add column if not exists filled_litres numeric(16,3)
  check (filled_litres is null or filled_litres >= 0);

create index if not exists fuel_order_stock_reservations_order_status_idx
on public.fuel_order_stock_reservations(order_id,status);

create table if not exists public.fuel_stock_reservation_events (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.fuel_order_stock_reservations(id) on delete restrict,
  order_id uuid not null references public.order_records(id) on delete restrict,
  storage_unit_id uuid not null references public.fuel_station_storage_units(id) on delete restrict,
  event_key text not null check (event_key in ('reserved','released','consumed','expired','cancelled')),
  reserved_litres numeric(16,3) not null check (reserved_litres > 0),
  consumed_litres numeric(16,3) not null default 0 check (consumed_litres >= 0),
  reserved_stock_before_litres numeric(16,3) not null check (reserved_stock_before_litres >= 0),
  reserved_stock_after_litres numeric(16,3) not null check (reserved_stock_after_litres >= 0),
  physical_stock_before_litres numeric(16,3) not null check (physical_stock_before_litres >= 0),
  physical_stock_after_litres numeric(16,3) not null check (physical_stock_after_litres >= 0),
  reason text,
  idempotency_key text not null unique,
  actor_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default timezone('utc',now()),
  created_at timestamptz not null default timezone('utc',now())
);

create index if not exists fuel_stock_reservation_events_order_idx
on public.fuel_stock_reservation_events(order_id,occurred_at desc);

create or replace function public.receive_fuel_stock(
  target_storage_unit_id uuid,
  target_quantity_litres numeric,
  target_reason text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  storage_record public.fuel_station_storage_units%rowtype;
  existing_movement public.fuel_station_stock_movements%rowtype;
  movement_id uuid;
  physical_after numeric(16,3);
begin
  if auth.role()<>'service_role' and not public.can_manage_fuel_branch(
    (select branch_id from public.fuel_station_storage_units where id=target_storage_unit_id)
  ) then
    raise exception using errcode='42501',message='fuel inventory management permission is required';
  end if;

  if target_storage_unit_id is null or target_quantity_litres is null or target_quantity_litres<=0
     or coalesce(btrim(target_reason),'')='' or coalesce(btrim(target_idempotency_key),'')=''
     or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='storage unit, positive receipt quantity, reason, idempotency key and object metadata are required';
  end if;

  select * into existing_movement
  from public.fuel_station_stock_movements
  where source='platform.fuel_inventory' and idempotency_key=target_idempotency_key;

  if found then
    if existing_movement.storage_unit_id<>target_storage_unit_id
       or existing_movement.movement_kind<>'receipt'
       or existing_movement.quantity_delta_litres<>target_quantity_litres then
      raise exception using errcode='23505',message='fuel stock idempotency key was reused with different receipt details';
    end if;
    return existing_movement.id;
  end if;

  select * into storage_record
  from public.fuel_station_storage_units
  where id=target_storage_unit_id
  for update;

  if not found or storage_record.status<>'active' then
    raise exception using errcode='55000',message='fuel storage unit is not active';
  end if;

  physical_after:=storage_record.physical_stock_litres+target_quantity_litres;
  if physical_after>storage_record.capacity_litres then
    raise exception using errcode='23514',message='fuel receipt exceeds configured storage capacity';
  end if;

  update public.fuel_station_storage_units
  set physical_stock_litres=physical_after,updated_by=auth.uid(),updated_at=timezone('utc',now())
  where id=target_storage_unit_id;

  insert into public.fuel_station_stock_movements(
    storage_unit_id,product_key,movement_kind,quantity_delta_litres,
    physical_before_litres,physical_after_litres,reason,source,idempotency_key,actor_user_id,metadata
  )
  values(
    storage_record.id,storage_record.product_key,'receipt',target_quantity_litres,
    storage_record.physical_stock_litres,physical_after,btrim(target_reason),
    'platform.fuel_inventory',target_idempotency_key,auth.uid(),target_metadata
  )
  returning id into movement_id;

  return movement_id;
end;
$$;

create or replace function public.adjust_fuel_stock(
  target_storage_unit_id uuid,
  target_quantity_delta_litres numeric,
  target_reason text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  storage_record public.fuel_station_storage_units%rowtype;
  existing_movement public.fuel_station_stock_movements%rowtype;
  movement_id uuid;
  physical_after numeric(16,3);
begin
  if auth.role()<>'service_role' and not public.can_manage_fuel_branch(
    (select branch_id from public.fuel_station_storage_units where id=target_storage_unit_id)
  ) then
    raise exception using errcode='42501',message='fuel inventory management permission is required';
  end if;

  if target_storage_unit_id is null or target_quantity_delta_litres is null or target_quantity_delta_litres=0
     or coalesce(btrim(target_reason),'')='' or coalesce(btrim(target_idempotency_key),'')=''
     or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='storage unit, non-zero adjustment, reason, idempotency key and object metadata are required';
  end if;

  select * into existing_movement
  from public.fuel_station_stock_movements
  where source='platform.fuel_inventory' and idempotency_key=target_idempotency_key;

  if found then
    if existing_movement.storage_unit_id<>target_storage_unit_id
       or existing_movement.movement_kind<>'adjustment'
       or existing_movement.quantity_delta_litres<>target_quantity_delta_litres then
      raise exception using errcode='23505',message='fuel stock idempotency key was reused with different adjustment details';
    end if;
    return existing_movement.id;
  end if;

  select * into storage_record
  from public.fuel_station_storage_units
  where id=target_storage_unit_id
  for update;

  if not found or storage_record.status not in ('active','paused') then
    raise exception using errcode='55000',message='fuel storage unit cannot be adjusted in its current state';
  end if;

  physical_after:=storage_record.physical_stock_litres+target_quantity_delta_litres;
  if physical_after<storage_record.reserved_stock_litres+storage_record.safety_reserve_litres then
    raise exception using errcode='23514',message='adjustment would reduce stock below reservations or safety reserve';
  end if;
  if physical_after>storage_record.capacity_litres then
    raise exception using errcode='23514',message='adjustment would exceed configured storage capacity';
  end if;

  update public.fuel_station_storage_units
  set physical_stock_litres=physical_after,updated_by=auth.uid(),updated_at=timezone('utc',now())
  where id=target_storage_unit_id;

  insert into public.fuel_station_stock_movements(
    storage_unit_id,product_key,movement_kind,quantity_delta_litres,
    physical_before_litres,physical_after_litres,reason,source,idempotency_key,actor_user_id,metadata
  )
  values(
    storage_record.id,storage_record.product_key,'adjustment',target_quantity_delta_litres,
    storage_record.physical_stock_litres,physical_after,btrim(target_reason),
    'platform.fuel_inventory',target_idempotency_key,auth.uid(),target_metadata
  )
  returning id into movement_id;

  return movement_id;
end;
$$;

create or replace function public.reserve_fuel_stock(
  target_order_id uuid,
  target_storage_unit_id uuid,
  target_quantity_litres numeric,
  target_idempotency_key text,
  target_expires_at timestamptz default null,
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
  storage_record public.fuel_station_storage_units%rowtype;
  existing_reservation public.fuel_order_stock_reservations%rowtype;
  reserved_total numeric(16,3);
  reservation_id uuid;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='fuel stock reservations must be created by the authorized SKIMA order runtime';
  end if;

  if target_order_id is null or target_storage_unit_id is null or target_quantity_litres is null or target_quantity_litres<=0
     or coalesce(btrim(target_idempotency_key),'')='' or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='order, storage unit, positive litres, idempotency key and object metadata are required';
  end if;

  select * into existing_reservation
  from public.fuel_order_stock_reservations
  where source='platform.fuel_inventory' and idempotency_key=target_idempotency_key;

  if found then
    if existing_reservation.order_id<>target_order_id
       or existing_reservation.storage_unit_id<>target_storage_unit_id
       or existing_reservation.reserved_litres<>target_quantity_litres then
      raise exception using errcode='23505',message='fuel stock reservation idempotency key was reused with different details';
    end if;
    return existing_reservation.id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_order_id::text,0));

  select * into order_record from public.order_records where id=target_order_id for update;
  if not found then
    raise exception using errcode='P0002',message='Fuel order was not found';
  end if;

  if not exists(select 1 from public.business_modules module where module.id=order_record.module_id and module.key='fuel') then
    raise exception using errcode='23514',message='Stock reservation requires a Fuel order';
  end if;

  select * into operation_record from public.fuel_order_operations where order_id=target_order_id for update;
  if not found or operation_record.stage_key not in ('awaiting_station_acceptance','stock_reserved') then
    raise exception using errcode='55000',message='Fuel order is not accepting stock reservations';
  end if;

  select coalesce(sum(reservation.reserved_litres),0)
  into reserved_total
  from public.fuel_order_stock_reservations reservation
  where reservation.order_id=target_order_id
    and reservation.status in ('reserved','partially_consumed');

  if reserved_total+target_quantity_litres>operation_record.requested_litres then
    raise exception using errcode='23514',message='Fuel stock reservations exceed the order quantity';
  end if;

  select * into storage_record
  from public.fuel_station_storage_units
  where id=target_storage_unit_id
  for update;

  if not found or storage_record.status<>'active'
     or storage_record.branch_id<>operation_record.station_branch_id
     or storage_record.product_key<>operation_record.product_key then
    raise exception using errcode='23514',message='Storage unit must be active and match the order station and fuel product';
  end if;

  if storage_record.physical_stock_litres-storage_record.reserved_stock_litres-storage_record.safety_reserve_litres<target_quantity_litres then
    raise exception using errcode='23514',message='Insufficient unreserved fuel stock after safety reserve';
  end if;

  update public.fuel_station_storage_units
  set reserved_stock_litres=reserved_stock_litres+target_quantity_litres,updated_at=timezone('utc',now())
  where id=target_storage_unit_id;

  insert into public.fuel_order_stock_reservations(
    order_id,storage_unit_id,product_key,requested_litres,reserved_litres,status,expires_at,source,idempotency_key,metadata
  )
  values(
    target_order_id,target_storage_unit_id,operation_record.product_key,target_quantity_litres,target_quantity_litres,
    'reserved',target_expires_at,'platform.fuel_inventory',target_idempotency_key,target_metadata
  )
  returning id into reservation_id;

  insert into public.fuel_stock_reservation_events(
    reservation_id,order_id,storage_unit_id,event_key,reserved_litres,consumed_litres,
    reserved_stock_before_litres,reserved_stock_after_litres,
    physical_stock_before_litres,physical_stock_after_litres,idempotency_key,metadata
  )
  values(
    reservation_id,target_order_id,target_storage_unit_id,'reserved',target_quantity_litres,0,
    storage_record.reserved_stock_litres,storage_record.reserved_stock_litres+target_quantity_litres,
    storage_record.physical_stock_litres,storage_record.physical_stock_litres,
    target_idempotency_key||':reserved',target_metadata
  );

  return reservation_id;
end;
$$;

create or replace function public.release_fuel_stock_reservation(
  target_reservation_id uuid,
  target_reason text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  reservation_record public.fuel_order_stock_reservations%rowtype;
  storage_record public.fuel_station_storage_units%rowtype;
  existing_event public.fuel_stock_reservation_events%rowtype;
  event_id uuid;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='fuel stock reservation release must be performed by the authorized SKIMA runtime';
  end if;

  if target_reservation_id is null or coalesce(btrim(target_reason),'')='' or coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='reservation, reason and idempotency key are required';
  end if;

  select * into existing_event from public.fuel_stock_reservation_events where idempotency_key=target_idempotency_key;
  if found then
    if existing_event.reservation_id<>target_reservation_id or existing_event.event_key<>'released' then
      raise exception using errcode='23505',message='reservation event idempotency key was reused';
    end if;
    return existing_event.id;
  end if;

  select * into reservation_record
  from public.fuel_order_stock_reservations
  where id=target_reservation_id
  for update;

  if not found then
    raise exception using errcode='P0002',message='Fuel stock reservation was not found';
  end if;
  if reservation_record.status not in ('reserved','partially_consumed') then
    raise exception using errcode='55000',message='Fuel stock reservation is already closed';
  end if;

  select * into storage_record
  from public.fuel_station_storage_units
  where id=reservation_record.storage_unit_id
  for update;

  if not found or storage_record.reserved_stock_litres<reservation_record.reserved_litres then
    raise exception using errcode='23514',message='Fuel reserved-stock balance is inconsistent';
  end if;

  update public.fuel_station_storage_units
  set reserved_stock_litres=reserved_stock_litres-reservation_record.reserved_litres,
      updated_at=timezone('utc',now())
  where id=storage_record.id;

  update public.fuel_order_stock_reservations
  set status='released',released_at=timezone('utc',now()),release_reason=btrim(target_reason),updated_at=timezone('utc',now())
  where id=target_reservation_id;

  insert into public.fuel_stock_reservation_events(
    reservation_id,order_id,storage_unit_id,event_key,reserved_litres,consumed_litres,
    reserved_stock_before_litres,reserved_stock_after_litres,
    physical_stock_before_litres,physical_stock_after_litres,reason,idempotency_key,metadata
  )
  values(
    reservation_record.id,reservation_record.order_id,reservation_record.storage_unit_id,'released',
    reservation_record.reserved_litres,reservation_record.consumed_litres,
    storage_record.reserved_stock_litres,storage_record.reserved_stock_litres-reservation_record.reserved_litres,
    storage_record.physical_stock_litres,storage_record.physical_stock_litres,btrim(target_reason),
    target_idempotency_key,coalesce(target_metadata,'{}'::jsonb)
  )
  returning id into event_id;

  return event_id;
end;
$$;

create or replace function public.consume_fuel_stock_reservation(
  target_reservation_id uuid,
  target_consumed_litres numeric,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  reservation_record public.fuel_order_stock_reservations%rowtype;
  storage_record public.fuel_station_storage_units%rowtype;
  operation_record public.fuel_order_operations%rowtype;
  existing_event public.fuel_stock_reservation_events%rowtype;
  physical_after numeric(16,3);
  reserved_after numeric(16,3);
  total_filled numeric(16,3);
  movement_id uuid;
  event_id uuid;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='fuel stock consumption must be performed by the authorized SKIMA station runtime';
  end if;

  if target_reservation_id is null or target_consumed_litres is null or target_consumed_litres<=0
     or coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='reservation, positive consumed litres and idempotency key are required';
  end if;

  select * into existing_event from public.fuel_stock_reservation_events where idempotency_key=target_idempotency_key;
  if found then
    if existing_event.reservation_id<>target_reservation_id or existing_event.event_key<>'consumed'
       or existing_event.consumed_litres<>target_consumed_litres then
      raise exception using errcode='23505',message='reservation consumption idempotency key was reused';
    end if;
    return existing_event.id;
  end if;

  select * into reservation_record
  from public.fuel_order_stock_reservations
  where id=target_reservation_id
  for update;

  if not found or reservation_record.status<>'reserved' then
    raise exception using errcode='55000',message='Fuel stock reservation is not open for consumption';
  end if;

  if target_consumed_litres>reservation_record.reserved_litres then
    raise exception using errcode='23514',message='Consumed fuel cannot exceed the reservation';
  end if;

  select * into storage_record
  from public.fuel_station_storage_units
  where id=reservation_record.storage_unit_id
  for update;

  if not found or storage_record.reserved_stock_litres<reservation_record.reserved_litres
     or storage_record.physical_stock_litres<target_consumed_litres then
    raise exception using errcode='23514',message='Fuel stock reservation or physical stock is inconsistent';
  end if;

  select * into operation_record
  from public.fuel_order_operations
  where order_id=reservation_record.order_id
  for update;

  if not found or operation_record.stage_key not in ('stock_reserved','station_filling') then
    raise exception using errcode='55000',message='Fuel order is not in a station filling stage';
  end if;

  total_filled:=coalesce(operation_record.filled_litres,0)+target_consumed_litres;
  if total_filled>operation_record.requested_litres then
    raise exception using errcode='23514',message='Filled fuel quantity cannot exceed the order quantity';
  end if;

  physical_after:=storage_record.physical_stock_litres-target_consumed_litres;
  reserved_after:=storage_record.reserved_stock_litres-reservation_record.reserved_litres;

  if physical_after<reserved_after+storage_record.safety_reserve_litres then
    raise exception using errcode='23514',message='Fuel dispense would consume stock reserved for other orders or safety reserve';
  end if;

  update public.fuel_station_storage_units
  set physical_stock_litres=physical_after,
      reserved_stock_litres=reserved_after,
      updated_at=timezone('utc',now())
  where id=storage_record.id;

  update public.fuel_order_stock_reservations
  set status=case when target_consumed_litres=reserved_litres then 'consumed' else 'partially_consumed' end,
      consumed_litres=target_consumed_litres,
      consumed_at=timezone('utc',now()),
      updated_at=timezone('utc',now())
  where id=reservation_record.id;

  update public.fuel_order_operations
  set filled_litres=total_filled,
      updated_at=timezone('utc',now())
  where order_id=reservation_record.order_id;

  insert into public.fuel_station_stock_movements(
    storage_unit_id,product_key,movement_kind,quantity_delta_litres,
    physical_before_litres,physical_after_litres,order_id,reason,source,idempotency_key,metadata
  )
  values(
    storage_record.id,storage_record.product_key,'dispense',-target_consumed_litres,
    storage_record.physical_stock_litres,physical_after,reservation_record.order_id,
    'Fuel order station fill','platform.fuel_inventory',target_idempotency_key||':movement',
    coalesce(target_metadata,'{}'::jsonb)
  )
  returning id into movement_id;

  insert into public.fuel_stock_reservation_events(
    reservation_id,order_id,storage_unit_id,event_key,reserved_litres,consumed_litres,
    reserved_stock_before_litres,reserved_stock_after_litres,
    physical_stock_before_litres,physical_stock_after_litres,idempotency_key,metadata
  )
  values(
    reservation_record.id,reservation_record.order_id,reservation_record.storage_unit_id,'consumed',
    reservation_record.reserved_litres,target_consumed_litres,
    storage_record.reserved_stock_litres,reserved_after,
    storage_record.physical_stock_litres,physical_after,
    target_idempotency_key,coalesce(target_metadata,'{}'::jsonb)||jsonb_build_object('stock_movement_id',movement_id)
  )
  returning id into event_id;

  return event_id;
end;
$$;

alter table public.fuel_stock_reservation_events enable row level security;
drop policy if exists fuel_stock_reservation_events_read_order on public.fuel_stock_reservation_events;
create policy fuel_stock_reservation_events_read_order
on public.fuel_stock_reservation_events for select to authenticated
using (public.can_read_fuel_order(order_id));

grant select on public.fuel_stock_reservation_events to authenticated,service_role;
grant insert,update,delete on public.fuel_station_stock_movements,public.fuel_order_stock_reservations,public.fuel_stock_reservation_events to service_role;

drop trigger if exists fuel_stock_reservation_events_immutable on public.fuel_stock_reservation_events;
create trigger fuel_stock_reservation_events_immutable
before update or delete on public.fuel_stock_reservation_events
for each row execute function public.prevent_fuel_event_mutation();

revoke all on function public.receive_fuel_stock(uuid,numeric,text,text,jsonb) from public,anon;
revoke all on function public.adjust_fuel_stock(uuid,numeric,text,text,jsonb) from public,anon;
revoke all on function public.reserve_fuel_stock(uuid,uuid,numeric,text,timestamptz,jsonb) from public,anon,authenticated;
revoke all on function public.release_fuel_stock_reservation(uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.consume_fuel_stock_reservation(uuid,numeric,text,jsonb) from public,anon,authenticated;

grant execute on function public.receive_fuel_stock(uuid,numeric,text,text,jsonb) to authenticated,service_role;
grant execute on function public.adjust_fuel_stock(uuid,numeric,text,text,jsonb) to authenticated,service_role;
grant execute on function public.reserve_fuel_stock(uuid,uuid,numeric,text,timestamptz,jsonb) to service_role;
grant execute on function public.release_fuel_stock_reservation(uuid,text,text,jsonb) to service_role;
grant execute on function public.consume_fuel_stock_reservation(uuid,numeric,text,jsonb) to service_role;

commit;
