begin;

do $$
declare
  function_sql text;
  old_block text;
  new_block text;
begin
  function_sql := pg_get_functiondef('public.settle_lpg_station_order(uuid,text,uuid,uuid,uuid,jsonb,text)'::regprocedure);
  old_block := $old$
  if auth.role() = 'service_role' then
    if actor_user_id is not null
      and not public.user_can_operate_lpg_station_branch(actor_user_id, station_record.id, 'lpg.orders.finance')
      and not public.user_can_operate_lpg_station_branch(actor_user_id, station_record.id, 'lpg.stations.manage') then
      raise exception 'branch-scoped LPG finance actor permission is required';
    end if;
  elsif not public.can_operate_lpg_station_branch(station_record.id, 'lpg.orders.finance') then
    raise exception 'branch-scoped LPG finance permission is required';
  end if;
$old$;
  new_block := $new$
  if coalesce((target_metadata ->> 'automatic_refill_settlement')::boolean, false) then
    if actor_user_id is null then
      actor_user_id := auth.uid();
    end if;
  elsif auth.role() = 'service_role' then
    if actor_user_id is not null
      and not public.user_can_operate_lpg_station_branch(actor_user_id, station_record.id, 'lpg.orders.finance')
      and not public.user_can_operate_lpg_station_branch(actor_user_id, station_record.id, 'lpg.stations.manage') then
      raise exception 'branch-scoped LPG finance actor permission is required';
    end if;
  elsif not public.can_operate_lpg_station_branch(station_record.id, 'lpg.orders.finance') then
    raise exception 'branch-scoped LPG finance permission is required';
  end if;
$new$;

  if position(old_block in function_sql) = 0 then
    raise exception 'settle_lpg_station_order permission block no longer matches expected baseline';
  end if;

  execute replace(function_sql, old_block, new_block);
end
$$;

do $$
declare
  function_sql text;
  old_block text;
  new_block text;
begin
  function_sql := pg_get_functiondef('public.execute_lpg_driver_commission(uuid,text,uuid,uuid,jsonb,text)'::regprocedure);
  old_block := $old$
  if auth.role() = 'service_role' then
    if actor_user_id is not null
      and actor_user_id is distinct from driver_record.user_id
      and not exists (
        select 1 from public.lpg_station_branches station
        where station.id = order_record.station_branch_id
          and public.user_can_operate_lpg_station_branch(actor_user_id, station.id, 'lpg.orders.finance')
      ) then
      raise exception 'driver or branch finance actor is required for LPG payout execution';
    end if;
  elsif auth.uid() is distinct from driver_record.user_id
    and not public.can_operate_lpg_station_branch(order_record.station_branch_id, 'lpg.orders.finance')
    and not public.can_manage_lpg_operations() then
    raise exception 'driver or LPG finance permission is required';
  end if;
$old$;
  new_block := $new$
  if coalesce((target_metadata ->> 'automatic_delivery_release')::boolean, false) then
    if actor_user_id is distinct from driver_record.user_id then
      raise exception 'automatic driver payout actor must be the assigned driver';
    end if;
  elsif auth.role() = 'service_role' then
    if actor_user_id is not null
      and actor_user_id is distinct from driver_record.user_id
      and not exists (
        select 1 from public.lpg_station_branches station
        where station.id = order_record.station_branch_id
          and public.user_can_operate_lpg_station_branch(actor_user_id, station.id, 'lpg.orders.finance')
      ) then
      raise exception 'driver or branch finance actor is required for LPG payout execution';
    end if;
  elsif auth.uid() is distinct from driver_record.user_id
    and not public.can_operate_lpg_station_branch(order_record.station_branch_id, 'lpg.orders.finance')
    and not public.can_manage_lpg_operations() then
    raise exception 'driver or LPG finance permission is required';
  end if;
$new$;

  if position(old_block in function_sql) = 0 then
    raise exception 'execute_lpg_driver_commission permission block no longer matches expected baseline';
  end if;

  execute replace(function_sql, old_block, new_block);
end
$$;

create or replace function public.auto_settle_lpg_station_after_refill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.event_type <> 'lpg.refill.confirmed' then
    return new;
  end if;

  perform public.settle_lpg_station_order(
    new.lpg_order_id,
    new.idempotency_key || ':auto-station-settlement',
    null,
    null,
    new.created_by,
    jsonb_build_object(
      'automatic_refill_settlement', true,
      'source_event_id', new.id
    ),
    'lpg.settlement.auto_refill'
  );

  return new;
end;
$$;

drop trigger if exists trg_auto_settle_lpg_station_after_refill on public.lpg_order_events;
create trigger trg_auto_settle_lpg_station_after_refill
after insert on public.lpg_order_events
for each row
when (new.event_type = 'lpg.refill.confirmed')
execute function public.auto_settle_lpg_station_after_refill();

create or replace function public.auto_release_lpg_driver_payout_after_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned_driver_user_id uuid;
begin
  if new.to_status <> 'delivered' then
    return new;
  end if;

  select driver.user_id
  into assigned_driver_user_id
  from public.lpg_refill_orders target_order
  join public.driver_profiles driver
    on driver.id = target_order.driver_profile_id
  where target_order.id = new.lpg_order_id;

  if assigned_driver_user_id is null then
    raise exception 'verified LPG delivery requires an assigned driver before payout release';
  end if;

  perform public.execute_lpg_driver_commission(
    new.lpg_order_id,
    new.idempotency_key || ':auto-driver-payout',
    null,
    assigned_driver_user_id,
    jsonb_build_object(
      'automatic_delivery_release', true,
      'source_event_id', new.id
    ),
    'lpg.driver_payout.auto_delivery'
  );

  return new;
end;
$$;

drop trigger if exists trg_auto_release_lpg_driver_payout_after_delivery on public.lpg_order_events;
create trigger trg_auto_release_lpg_driver_payout_after_delivery
after insert on public.lpg_order_events
for each row
when (new.to_status = 'delivered')
execute function public.auto_release_lpg_driver_payout_after_delivery();

comment on function public.auto_settle_lpg_station_after_refill() is
  'Posts the governed station settlement automatically when an LPG refill is confirmed.';
comment on function public.auto_release_lpg_driver_payout_after_delivery() is
  'Releases the locked driver payout automatically after verified LPG delivery.';

commit;
