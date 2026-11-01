begin;

alter table public.fuel_order_stock_reservation_batches
drop constraint if exists fuel_order_stock_reservation_batches_status_check;

alter table public.fuel_order_stock_reservation_batches
add constraint fuel_order_stock_reservation_batches_status_check
check (status in ('reserved','consumed','released','expired','cancelled'));

create or replace function public.refresh_fuel_stock_reservation_batch_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  batch_identifier uuid;
  child_count integer;
  open_count integer;
  all_consumed boolean;
  any_expired boolean;
  any_cancelled boolean;
  resolved_status text;
begin
  batch_identifier:=coalesce(new.batch_id,old.batch_id);
  if batch_identifier is null then
    return coalesce(new,old);
  end if;

  select count(*),
         count(*) filter (where reservation.status in ('reserved','partially_consumed')),
         coalesce(bool_and(reservation.status='consumed'),false),
         coalesce(bool_or(reservation.status='expired'),false),
         coalesce(bool_or(reservation.status='cancelled'),false)
  into child_count,open_count,all_consumed,any_expired,any_cancelled
  from public.fuel_order_stock_reservations reservation
  where reservation.batch_id=batch_identifier;

  if child_count=0 then
    resolved_status:='cancelled';
  elsif open_count>0 then
    resolved_status:='reserved';
  elsif all_consumed then
    resolved_status:='consumed';
  elsif any_expired then
    resolved_status:='expired';
  elsif any_cancelled then
    resolved_status:='cancelled';
  else
    resolved_status:='released';
  end if;

  update public.fuel_order_stock_reservation_batches
  set status=resolved_status,updated_at=timezone('utc',now())
  where id=batch_identifier
    and status is distinct from resolved_status;

  return coalesce(new,old);
end;
$$;

drop trigger if exists fuel_stock_reservations_refresh_batch on public.fuel_order_stock_reservations;
create trigger fuel_stock_reservations_refresh_batch
after insert or update of batch_id,status,consumed_litres on public.fuel_order_stock_reservations
for each row execute function public.refresh_fuel_stock_reservation_batch_status();

revoke all on function public.refresh_fuel_stock_reservation_batch_status() from public,anon,authenticated;

commit;
