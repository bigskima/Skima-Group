begin;

-- The legacy lpg_refill_pricing table is now a compatibility projection for the
-- station's own LPG selling price only. Platform fees, delivery economics, tax
-- and driver payout are resolved from versioned financial policy and must not be
-- required as a legacy baseline before a station can set its first price.
create or replace function public.enforce_lpg_station_pricing_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role'
    or public.has_permission('lpg.config.manage', null)
    or public.can_manage_lpg_operations() then
    return new;
  end if;

  if new.station_branch_id is null
    or not public.can_manage_delegated_lpg_station_price(new.station_branch_id) then
    raise exception 'delegated LPG station price management permission is required';
  end if;

  if coalesce(new.delivery_base_fee, 0) <> 0
    or coalesce(new.platform_fee_amount, 0) <> 0
    or coalesce(new.tax_rate_percent, 0) <> 0
    or coalesce(new.driver_commission_amount, 0) <> 0 then
    raise exception 'station users may manage only their own LPG selling price; SKIMA financial components are managed separately';
  end if;

  if new.price_per_kg is null or new.price_per_kg <= 0
    or new.min_kg is null or new.min_kg <= 0
    or new.max_kg is null or new.max_kg < new.min_kg then
    raise exception 'positive station price and valid kilogram bounds are required';
  end if;

  if new.effective_until is not null and new.effective_until <= new.effective_from then
    raise exception 'station price end time must be after its start time';
  end if;

  if coalesce(new.metadata ->> 'compatibility_role', '') <> 'station_price_input_only'
    and coalesce(new.metadata ->> 'managed_field', '') not in ('station_price_per_kg', 'price_per_kg') then
    raise exception 'station price compatibility rows must be explicitly marked as station-price input';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_lpg_station_pricing_scope()
from public, anon, authenticated;
grant execute on function public.enforce_lpg_station_pricing_scope()
to service_role;

comment on function public.enforce_lpg_station_pricing_scope() is
  'Guards the legacy LPG refill-pricing compatibility projection. Station users may supply only their own selling price; platform financial components remain versioned-policy controlled.';

notify pgrst, 'reload schema';

commit;
