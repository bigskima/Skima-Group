-- Cylinder capacity is a physical LPG safety invariant, not a configurable tolerance.
-- Enforce it at the refill-record boundary so every caller is protected even if
-- operational overfill policy changes later.

create or replace function public.enforce_lpg_refill_record_cylinder_capacity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  cylinder_max_capacity_kg numeric;
begin
  select cylinder.max_capacity_kg
  into cylinder_max_capacity_kg
  from public.lpg_cylinders cylinder
  where cylinder.id = new.cylinder_id;

  if not found or cylinder_max_capacity_kg is null or cylinder_max_capacity_kg <= 0 then
    raise exception 'cylinder maximum capacity is required before refill confirmation';
  end if;

  if new.requested_kg is null or new.requested_kg <= 0 then
    raise exception 'requested refill quantity must be greater than zero';
  end if;

  if new.actual_kg is null or new.actual_kg <= 0 then
    raise exception 'actual refill quantity must be greater than zero';
  end if;

  if new.requested_kg > cylinder_max_capacity_kg then
    raise exception 'requested refill quantity exceeds cylinder maximum capacity';
  end if;

  if new.actual_kg > cylinder_max_capacity_kg then
    raise exception 'actual refill quantity exceeds cylinder maximum capacity';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_lpg_refill_record_cylinder_capacity() from public;
revoke all on function public.enforce_lpg_refill_record_cylinder_capacity() from anon;
revoke all on function public.enforce_lpg_refill_record_cylinder_capacity() from authenticated;

drop trigger if exists trg_lpg_refill_records_cylinder_capacity
  on public.lpg_refill_records;

create trigger trg_lpg_refill_records_cylinder_capacity
before insert or update of cylinder_id, requested_kg, actual_kg
on public.lpg_refill_records
for each row
execute function public.enforce_lpg_refill_record_cylinder_capacity();

comment on function public.enforce_lpg_refill_record_cylinder_capacity() is
  'Hard LPG safety guard that rejects requested or actual refill quantities above the cylinder verified maximum capacity regardless of configurable operational tolerances.';
