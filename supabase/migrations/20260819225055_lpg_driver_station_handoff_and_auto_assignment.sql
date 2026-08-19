begin;

do $$
declare
  function_sql text;
  old_block text;
  new_block text;
begin
  function_sql := pg_get_functiondef('public.accept_lpg_driver_assignment(uuid,text,text,jsonb)'::regprocedure);
  old_block := $old$
  actor_user_id := auth.uid();

  if auth.role() = 'service_role' then
    actor_user_id := nullif(target_metadata ->> 'server_actor_user_id', '')::uuid;
  end if;
$old$;
  new_block := $new$
  actor_user_id := auth.uid();

  if auth.role() = 'service_role'
    or public.has_permission('lpg.dispatch.execute', null)
    or public.can_manage_lpg_operations() then
    actor_user_id := coalesce(
      nullif(target_metadata ->> 'server_actor_user_id', '')::uuid,
      actor_user_id
    );
  end if;
$new$;

  if position(old_block in function_sql) = 0 then
    raise exception 'accept_lpg_driver_assignment actor block no longer matches expected baseline';
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
  function_sql := pg_get_functiondef('public.record_lpg_cylinder_scan(uuid,text,text,numeric,numeric,numeric,jsonb,text)'::regprocedure);
  old_block := $old$
  elsif target_scan_type = 'station_receipt' then
    if order_record.status not in ('pickup_verified', 'station_en_route') then
      raise exception 'station receipt scan is not valid for the current order status';
    end if;
    if not public.can_operate_lpg_station_branch(order_record.station_branch_id, 'lpg.stations.scan') then
      raise exception 'branch-scoped LPG scanner permission is required';
    end if;
    new_status := 'station_verified';
    history_event := 'station_scan';
    verification_definition_key := 'verification.lpg.partner.fulfillment_scan';
$old$;
  new_block := $new$
  elsif target_scan_type = 'station_receipt' then
    if order_record.status not in ('pickup_verified', 'station_en_route') then
      raise exception 'station receipt scan is not valid for the current order status';
    end if;
    if auth.role() <> 'service_role'
      and driver_record.user_id is distinct from auth.uid()
      and not public.can_manage_lpg_operations() then
      raise exception 'assigned driver is required for station receipt scan';
    end if;
    new_status := 'station_verified';
    history_event := 'station_scan';
    verification_definition_key := 'verification.lpg.partner.fulfillment_scan';
$new$;

  if position(old_block in function_sql) = 0 then
    raise exception 'record_lpg_cylinder_scan station receipt block no longer matches expected baseline';
  end if;

  execute replace(function_sql, old_block, new_block);
end
$$;

create or replace function public.auto_accept_dispatched_lpg_driver()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned_driver_user_id uuid;
begin
  if new.event_type <> 'lpg.dispatch.driver_offered' then
    return new;
  end if;

  select driver.user_id
  into assigned_driver_user_id
  from public.lpg_refill_orders target_order
  join public.driver_profiles driver
    on driver.id = target_order.driver_profile_id
  where target_order.id = new.lpg_order_id
    and target_order.status = 'driver_offered'
    and driver.verification_status = 'approved';

  if assigned_driver_user_id is null then
    raise exception 'automatic LPG assignment requires an approved assigned driver';
  end if;

  perform public.accept_lpg_driver_assignment(
    new.lpg_order_id,
    new.idempotency_key || ':auto-accept',
    'lpg.dispatch.auto_assignment',
    jsonb_build_object(
      'server_actor_user_id', assigned_driver_user_id,
      'automatic_assignment', true,
      'source_event_id', new.id
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_auto_accept_dispatched_lpg_driver on public.lpg_order_events;
create trigger trg_auto_accept_dispatched_lpg_driver
after insert on public.lpg_order_events
for each row
when (new.event_type = 'lpg.dispatch.driver_offered')
execute function public.auto_accept_dispatched_lpg_driver();

comment on function public.auto_accept_dispatched_lpg_driver() is
  'Finalizes the nearest selected LPG driver as an automatic assignment after dispatch records the driver-offered event. The mobile driver does not manually accept LPG assignments.';

commit;
