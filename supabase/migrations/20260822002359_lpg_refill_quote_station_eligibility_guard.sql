create or replace function public.enforce_lpg_refill_quote_station_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  station_is_eligible boolean := false;
begin
  if new.station_branch_id is null then
    raise exception using errcode = 'P0001', message = 'an eligible LPG station is required for this refill';
  end if;

  select exists (
    select 1
    from public.read_lpg_eligible_stations(
      new.pickup_location_id,
      new.delivery_location_id,
      new.cylinder_id,
      new.requested_kg,
      50,
      timezone('utc', now())
    ) eligible
    where eligible.station_branch_id = new.station_branch_id
  ) into station_is_eligible;

  if not station_is_eligible then
    raise exception using
      errcode = 'P0001',
      message = 'selected LPG station cannot fulfil this refill for the chosen trip';
  end if;

  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'stationEligibilityVerifiedAt', timezone('utc', now()),
    'stationEligibilityStationId', new.station_branch_id
  );

  return new;
end;
$$;

revoke all on function public.enforce_lpg_refill_quote_station_eligibility() from public, anon, authenticated;
grant execute on function public.enforce_lpg_refill_quote_station_eligibility() to service_role;

drop trigger if exists trg_lpg_refill_quote_station_eligibility on public.lpg_refill_quotes;
create trigger trg_lpg_refill_quote_station_eligibility
before insert on public.lpg_refill_quotes
for each row
execute function public.enforce_lpg_refill_quote_station_eligibility();
