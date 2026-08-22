create or replace function public.enforce_lpg_refill_quote_serviceability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pickup_record record;
  delivery_record record;
  pickup_resolution jsonb;
  delivery_resolution jsonb;
begin
  select location.latitude, location.longitude, location.metadata
  into pickup_record
  from public.lpg_customer_locations location
  where location.id = new.pickup_location_id;

  if not found then
    raise exception using errcode = '23503', message = 'pickup location is missing for LPG serviceability verification';
  end if;

  select location.latitude, location.longitude, location.metadata
  into delivery_record
  from public.lpg_customer_locations location
  where location.id = new.delivery_location_id;

  if not found then
    raise exception using errcode = '23503', message = 'delivery location is missing for LPG serviceability verification';
  end if;

  pickup_resolution := public.resolve_lpg_serviceability(
    pickup_record.latitude,
    pickup_record.longitude,
    coalesce(pickup_record.metadata, '{}'::jsonb)
  );

  if not coalesce((pickup_resolution ->> 'serviceable')::boolean, false) then
    raise exception using
      errcode = 'P0001',
      message = 'pickup location is outside enabled LPG service coverage';
  end if;

  delivery_resolution := public.resolve_lpg_serviceability(
    delivery_record.latitude,
    delivery_record.longitude,
    coalesce(delivery_record.metadata, '{}'::jsonb)
  );

  if not coalesce((delivery_resolution ->> 'serviceable')::boolean, false) then
    raise exception using
      errcode = 'P0001',
      message = 'return location is outside enabled LPG service coverage';
  end if;

  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'serviceabilitySnapshot',
    jsonb_build_object(
      'verifiedAt', timezone('utc', now()),
      'pickup', pickup_resolution,
      'return', delivery_resolution
    )
  );

  return new;
end;
$$;

revoke all on function public.enforce_lpg_refill_quote_serviceability() from public, anon, authenticated;
grant execute on function public.enforce_lpg_refill_quote_serviceability() to service_role;

drop trigger if exists trg_lpg_refill_quote_serviceability on public.lpg_refill_quotes;
create trigger trg_lpg_refill_quote_serviceability
before insert on public.lpg_refill_quotes
for each row
execute function public.enforce_lpg_refill_quote_serviceability();
