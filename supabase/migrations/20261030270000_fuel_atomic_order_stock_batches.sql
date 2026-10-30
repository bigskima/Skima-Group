begin;

create table if not exists public.fuel_order_stock_reservation_batches (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.order_records(id) on delete restrict,
  service_request_id uuid not null references public.service_requests(id) on delete restrict,
  branch_id uuid not null references public.organization_branches(id) on delete restrict,
  product_key text not null references public.fuel_products(key) on update cascade on delete restrict,
  requested_litres numeric(16,3) not null check (requested_litres > 0),
  reserved_litres numeric(16,3) not null check (reserved_litres > 0 and reserved_litres <= requested_litres),
  status text not null default 'reserved' check (status in ('reserved','released','expired','cancelled')),
  source text not null default 'platform.fuel_inventory',
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$')
);

alter table public.fuel_order_stock_reservations
add column if not exists batch_id uuid references public.fuel_order_stock_reservation_batches(id) on delete restrict;

create index if not exists fuel_order_stock_reservation_batches_order_idx
on public.fuel_order_stock_reservation_batches(order_id,created_at desc);

create index if not exists fuel_order_stock_reservations_batch_idx
on public.fuel_order_stock_reservations(batch_id,status);

create or replace function public.reserve_fuel_order_stock(
  target_order_id uuid,
  target_requested_litres numeric,
  target_idempotency_key text,
  target_expires_at timestamptz default null,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record public.order_records%rowtype;
  request_record public.service_requests%rowtype;
  operation_record public.fuel_order_operations%rowtype;
  storage_record public.fuel_station_storage_units%rowtype;
  batch_record public.fuel_order_stock_reservation_batches%rowtype;
  reservation_id uuid;
  reserved_total numeric(16,3):=0;
  open_reserved_total numeric(16,3):=0;
  available_litres numeric(16,3);
  allocation_litres numeric(16,3);
  remaining_litres numeric(16,3);
  reservation_rows jsonb:='[]'::jsonb;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='Fuel batch reservations must be created by the authorized SKIMA station runtime';
  end if;

  if target_order_id is null or target_requested_litres is null or target_requested_litres<=0
     or coalesce(btrim(target_idempotency_key),'')=''
     or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='Fuel order, positive requested litres, idempotency key and object metadata are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_order_id::text,0));

  select * into order_record
  from public.order_records
  where id=target_order_id
  for update;

  if not found or not exists(
    select 1 from public.business_modules module
    where module.id=order_record.module_id and module.key='fuel'
  ) then
    raise exception using errcode='23514',message='Stock batch requires an existing Fuel order';
  end if;

  select * into batch_record
  from public.fuel_order_stock_reservation_batches
  where idempotency_key=target_idempotency_key;

  if found then
    if batch_record.order_id<>target_order_id
       or batch_record.requested_litres<>target_requested_litres then
      raise exception using errcode='23505',message='Fuel stock batch idempotency key was reused with different details';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'reservationId',reservation.id,
      'storageUnitId',reservation.storage_unit_id,
      'reservedLitres',reservation.reserved_litres,
      'consumedLitres',reservation.consumed_litres,
      'status',reservation.status
    ) order by reservation.created_at,reservation.id),'[]'::jsonb)
    into reservation_rows
    from public.fuel_order_stock_reservations reservation
    where reservation.batch_id=batch_record.id;

    return jsonb_build_object(
      'batchId',batch_record.id,
      'orderId',batch_record.order_id,
      'requestedLitres',batch_record.requested_litres,
      'reservedLitres',batch_record.reserved_litres,
      'status',batch_record.status,
      'reservations',reservation_rows,
      'replayed',true
    );
  end if;

  select * into request_record
  from public.service_requests
  where id=order_record.service_request_id
  for update;

  if not found or request_record.status<>'payment_reserved'
     or request_record.escrow_hold_id is null
     or not exists(
       select 1 from public.escrow_holds hold
       where hold.id=request_record.escrow_hold_id
         and hold.status='held'
         and hold.subject_type='service_request'
         and hold.subject_id=order_record.service_request_id
         and hold.currency_code=order_record.currency_code
         and hold.hold_amount=order_record.total_amount
     ) then
    raise exception using errcode='55000',message='A confirmed matching escrow hold is required before reserving Fuel stock';
  end if;

  select * into operation_record
  from public.fuel_order_operations
  where order_id=target_order_id
  for update;

  if not found or operation_record.stage_key<>'awaiting_station_acceptance' then
    raise exception using errcode='55000',message='Fuel order is not waiting for its initial stock reservation';
  end if;

  if abs(target_requested_litres-operation_record.requested_litres)>0.001 then
    raise exception using errcode='23514',message='Stock reservation litres must exactly match the Fuel order quantity';
  end if;

  select coalesce(sum(reservation.reserved_litres-reservation.consumed_litres),0)
  into open_reserved_total
  from public.fuel_order_stock_reservations reservation
  where reservation.order_id=target_order_id
    and reservation.status in ('reserved','partially_consumed');

  if open_reserved_total+coalesce(operation_record.filled_litres,0)+target_requested_litres>operation_record.requested_litres then
    raise exception using errcode='23514',message='Stock batch would over-reserve the Fuel order quantity';
  end if;

  insert into public.fuel_order_stock_reservation_batches(
    order_id,service_request_id,branch_id,product_key,requested_litres,reserved_litres,
    status,source,idempotency_key,metadata
  )
  values(
    target_order_id,order_record.service_request_id,operation_record.station_branch_id,
    operation_record.product_key,target_requested_litres,target_requested_litres,
    'reserved','platform.fuel_inventory',target_idempotency_key,target_metadata
  )
  returning * into batch_record;

  remaining_litres:=target_requested_litres;

  for storage_record in
    select storage.*
    from public.fuel_station_storage_units storage
    where storage.branch_id=operation_record.station_branch_id
      and storage.product_key=operation_record.product_key
      and storage.status='active'
      and storage.physical_stock_litres>storage.reserved_stock_litres+storage.safety_reserve_litres
    order by storage.id
    for update
  loop
    exit when remaining_litres<=0.000;

    available_litres:=greatest(
      storage_record.physical_stock_litres
      - storage_record.reserved_stock_litres
      - storage_record.safety_reserve_litres,
      0
    );

    allocation_litres:=least(available_litres,remaining_litres);
    if allocation_litres<=0 then
      continue;
    end if;

    update public.fuel_station_storage_units
    set reserved_stock_litres=reserved_stock_litres+allocation_litres,
        updated_at=timezone('utc',now())
    where id=storage_record.id;

    insert into public.fuel_order_stock_reservations(
      batch_id,order_id,storage_unit_id,product_key,requested_litres,reserved_litres,
      consumed_litres,status,expires_at,source,idempotency_key,metadata
    )
    values(
      batch_record.id,target_order_id,storage_record.id,operation_record.product_key,
      allocation_litres,allocation_litres,0,'reserved',target_expires_at,
      'platform.fuel_inventory',
      target_idempotency_key||':tank:'||storage_record.id::text,
      target_metadata||jsonb_build_object('stock_batch_id',batch_record.id)
    )
    returning id into reservation_id;

    insert into public.fuel_stock_reservation_events(
      reservation_id,order_id,storage_unit_id,event_key,reserved_litres,consumed_litres,
      reserved_stock_before_litres,reserved_stock_after_litres,
      physical_stock_before_litres,physical_stock_after_litres,idempotency_key,metadata
    )
    values(
      reservation_id,target_order_id,storage_record.id,'reserved',allocation_litres,0,
      storage_record.reserved_stock_litres,
      storage_record.reserved_stock_litres+allocation_litres,
      storage_record.physical_stock_litres,storage_record.physical_stock_litres,
      target_idempotency_key||':tank:'||storage_record.id::text||':event',
      target_metadata||jsonb_build_object('stock_batch_id',batch_record.id)
    );

    reservation_rows:=reservation_rows||jsonb_build_array(jsonb_build_object(
      'reservationId',reservation_id,
      'storageUnitId',storage_record.id,
      'reservedLitres',allocation_litres,
      'consumedLitres',0,
      'status','reserved'
    ));

    reserved_total:=reserved_total+allocation_litres;
    remaining_litres:=remaining_litres-allocation_litres;
  end loop;

  if remaining_litres>0.001 then
    raise exception using errcode='23514',message='Insufficient available Fuel stock across all active compatible station storage units';
  end if;

  return jsonb_build_object(
    'batchId',batch_record.id,
    'orderId',target_order_id,
    'requestedLitres',target_requested_litres,
    'reservedLitres',reserved_total,
    'status','reserved',
    'reservations',reservation_rows,
    'replayed',false
  );
end;
$$;

alter table public.fuel_order_stock_reservation_batches enable row level security;

drop policy if exists fuel_order_stock_reservation_batches_read_order on public.fuel_order_stock_reservation_batches;
create policy fuel_order_stock_reservation_batches_read_order
on public.fuel_order_stock_reservation_batches for select to authenticated
using (public.can_read_fuel_order(order_id));

grant select on public.fuel_order_stock_reservation_batches to authenticated,service_role;

drop trigger if exists fuel_order_stock_reservation_batches_audit on public.fuel_order_stock_reservation_batches;
create trigger fuel_order_stock_reservation_batches_audit
after insert or update on public.fuel_order_stock_reservation_batches
for each row execute function public.record_table_audit();

revoke all on function public.reserve_fuel_order_stock(uuid,numeric,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_fuel_order_stock(uuid,numeric,text,timestamptz,jsonb) to service_role;

commit;
