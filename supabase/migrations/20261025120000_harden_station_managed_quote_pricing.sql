begin;

-- Recalculate Station Managed pricing from backend-computed quote values on INSERT.
-- Never trust a caller-supplied "locked" metadata flag to bypass station pricing.
create or replace function public.apply_lpg_station_managed_quote_policy()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  settings public.lpg_station_fulfillment_settings%rowtype;
  requested_mode text;
  base_lpg_amount numeric(28,8);
begin
  if tg_op='UPDATE'
    and coalesce(old.metadata->>'station_fulfillment_pricing_locked','false')='true' then
    -- Preserve immutable financial terms on subsequent workflow/status updates.
    new.fulfillment_channel:=old.fulfillment_channel;
    new.fulfillment_mode:=old.fulfillment_mode;
    new.delivery_pricing_mode:=old.delivery_pricing_mode;
    new.station_delivery_fee_amount:=old.station_delivery_fee_amount;
    new.station_branch_id:=old.station_branch_id;
    new.currency_code:=old.currency_code;
    new.requested_kg:=old.requested_kg;
    new.quoted_kg:=old.quoted_kg;
    new.lpg_amount:=old.lpg_amount;
    new.delivery_fee_amount:=old.delivery_fee_amount;
    new.platform_fee_amount:=old.platform_fee_amount;
    new.tax_amount:=old.tax_amount;
    new.total_amount:=old.total_amount;
    new.driver_commission_amount:=old.driver_commission_amount;
    new.breakdown:=old.breakdown;
    new.financial_policy_snapshot:=old.financial_policy_snapshot;
    new.metadata:=coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
      'fulfillment_mode',old.metadata->>'fulfillment_mode',
      'delivery_pricing_mode',old.metadata->>'delivery_pricing_mode',
      'station_delivery_fee_amount',old.metadata->'station_delivery_fee_amount',
      'station_fulfillment_pricing_locked',true
    );
    return new;
  end if;

  -- Client metadata may request a supported fulfilment mode, but it cannot
  -- supply the derived pricing lock or station delivery price.
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)
    - 'station_fulfillment_pricing_locked'
    - 'station_delivery_fee_amount'
    - 'delivery_pricing_mode';

  requested_mode:=case
    when new.fulfillment_channel='skima_internal'
      and coalesce(nullif(new.metadata->>'fulfillment_mode',''),new.fulfillment_mode,'independent_driver')='independent_driver'
      then 'skima_fleet'
    else coalesce(nullif(new.metadata->>'fulfillment_mode',''),new.fulfillment_mode,'independent_driver')
  end;

  if requested_mode not in ('station_managed','independent_driver','skima_fleet','partner_managed') then
    raise exception using errcode='22023',message='unsupported LPG fulfillment mode';
  end if;

  new.fulfillment_mode:=requested_mode;
  if requested_mode<>'station_managed' then
    new.delivery_pricing_mode:=coalesce(new.delivery_pricing_mode,'separate');
    new.station_delivery_fee_amount:=0;
    return new;
  end if;

  if new.fulfillment_channel<>'marketplace' or new.station_branch_id is null then
    raise exception using errcode='22023',message='Station Managed requires a marketplace station quote';
  end if;

  select * into settings
  from public.lpg_station_fulfillment_settings
  where station_branch_id=new.station_branch_id and station_managed_enabled;
  if not found then
    raise exception using errcode='55000',message='Station Managed is not enabled for this station';
  end if;

  if settings.currency_code<>new.currency_code then
    raise exception using errcode='22023',message='station delivery pricing currency must match the quote currency';
  end if;

  if not exists (
    select 1 from public.lpg_station_branches station
    where station.id=new.station_branch_id
      and station.approval_status='approved'
      and station.compliance_status='approved'
      and station.availability_status='available'
  ) then
    raise exception using errcode='55000',message='Station Managed requires an approved and available station branch';
  end if;

  if not exists (
    select 1 from public.lpg_station_managed_drivers driver
    where driver.station_branch_id=new.station_branch_id and driver.status='active'
  ) then
    raise exception using errcode='55000',message='Station Managed requires at least one active station-managed driver';
  end if;

  -- new.lpg_amount is calculated by the existing server-side quote engine.
  -- Do not replace it with values taken from user-supplied metadata/breakdown.
  base_lpg_amount:=new.lpg_amount;
  new.delivery_pricing_mode:=settings.delivery_pricing_mode;
  new.station_delivery_fee_amount:=case when settings.delivery_pricing_mode='free' then 0 else settings.delivery_fee_amount end;
  new.driver_commission_amount:=0;

  if settings.delivery_pricing_mode='separate' then
    new.lpg_amount:=base_lpg_amount;
    new.delivery_fee_amount:=settings.delivery_fee_amount;
  elsif settings.delivery_pricing_mode='included' then
    new.lpg_amount:=base_lpg_amount+settings.delivery_fee_amount;
    new.delivery_fee_amount:=0;
  else
    new.lpg_amount:=base_lpg_amount;
    new.delivery_fee_amount:=0;
  end if;

  new.total_amount:=new.lpg_amount+new.delivery_fee_amount+new.platform_fee_amount+new.tax_amount;
  new.breakdown:=coalesce(new.breakdown,'{}'::jsonb)||jsonb_build_object(
    'fulfillmentMode','station_managed',
    'deliveryPricingMode',settings.delivery_pricing_mode,
    'stationDeliveryFeeAmount',new.station_delivery_fee_amount,
    'stationDriverCompensationMode',settings.driver_compensation_mode,
    'stationDriverCompensationPlan',case when settings.driver_compensation_mode='in_app_plan' then settings.driver_compensation_plan else '{}'::jsonb end
  );
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
    'fulfillment_mode','station_managed',
    'delivery_pricing_mode',settings.delivery_pricing_mode,
    'station_delivery_fee_amount',new.station_delivery_fee_amount,
    'station_fulfillment_pricing_locked',true
  );
  return new;
end;
$$;

drop trigger if exists trg_lpg_station_managed_quote_policy on public.lpg_refill_quotes;
create trigger trg_lpg_station_managed_quote_policy
before insert or update on public.lpg_refill_quotes
for each row execute function public.apply_lpg_station_managed_quote_policy();

revoke all on function public.apply_lpg_station_managed_quote_policy() from public,anon,authenticated;

comment on function public.apply_lpg_station_managed_quote_policy() is
  'Applies station-managed pricing from configured branch settings on quote insert; ignores client-supplied price lock metadata and preserves locked financial terms on later updates.';

notify pgrst,'reload schema';
commit;
