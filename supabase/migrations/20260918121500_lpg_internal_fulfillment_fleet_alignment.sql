begin;

-- Keep every SKIMA internal-fulfillment gate aligned with the platform-fleet
-- invariant enforced by guard_lpg_internal_platform_fleet_assignment().
-- The original internal runtime predates platform_owned/fleet_owned and can
-- otherwise report readiness or choose a vehicle that the order guard rejects.

do $migration$
declare
  fn text;
  patched text;
begin
  fn := pg_get_functiondef('public.lpg_internal_live_driver_available(numeric,numeric)'::regprocedure);
  patched := replace(
    fn,
    $old$    join public.driver_vehicle_links vehicle_link
      on vehicle_link.driver_profile_id=driver.id
     and vehicle_link.status='active'$old$,
    $new$    join public.driver_vehicle_links vehicle_link
      on vehicle_link.driver_profile_id=driver.id
     and vehicle_link.relationship_type='fleet_owned'
     and vehicle_link.status='active'$new$
  );
  patched := replace(
    patched,
    $old$    join public.vehicles vehicle
      on vehicle.id=vehicle_link.vehicle_id
     and vehicle.status='active'$old$,
    $new$    join public.vehicles vehicle
      on vehicle.id=vehicle_link.vehicle_id
     and vehicle.platform_owned
     and vehicle.status='active'$new$
  );
  if patched = fn then
    raise exception 'could not align lpg_internal_live_driver_available with SKIMA fleet ownership';
  end if;
  execute patched;

  fn := pg_get_functiondef('public.read_lpg_internal_launch_readiness()'::regprocedure);
  patched := replace(
    fn,
    $old$    and link.status='active'$old$,
    $new$    and link.relationship_type='fleet_owned'
    and link.status='active'$new$
  );
  patched := replace(
    patched,
    $old$    and vehicle.status='active'$old$,
    $new$    and vehicle.platform_owned
    and vehicle.status='active'$new$
  );
  if patched = fn then
    raise exception 'could not align read_lpg_internal_launch_readiness with SKIMA fleet ownership';
  end if;
  execute patched;

  fn := pg_get_functiondef('public.dispatch_lpg_internal_order(uuid,integer,text,text)'::regprocedure);
  patched := replace(
    fn,
    $old$       and link.status='active'$old$,
    $new$       and link.relationship_type='fleet_owned'
       and link.status='active'$new$
  );
  patched := replace(
    patched,
    $old$      join public.vehicles vehicle on vehicle.id=link.vehicle_id and vehicle.status='active'$old$,
    $new$      join public.vehicles vehicle
        on vehicle.id=link.vehicle_id
       and vehicle.platform_owned
       and vehicle.status='active'$new$
  );
  if patched = fn then
    raise exception 'could not align dispatch_lpg_internal_order with SKIMA fleet ownership';
  end if;
  execute patched;

  fn := pg_get_functiondef('public.read_lpg_managed_driver_admin(uuid)'::regprocedure);
  patched := replace(
    fn,
    $old$          vehicle.status='active'
          and coalesce((public.evaluate_driver_vehicle_eligibility(driver.id,vehicle.id,'lpg')->>'eligible')::boolean,false)$old$,
    $new$          vehicle.status='active'
          and (
            membership.program_key is distinct from managed_key
            or (vehicle.platform_owned and link.relationship_type='fleet_owned')
          )
          and coalesce((public.evaluate_driver_vehicle_eligibility(driver.id,vehicle.id,'lpg')->>'eligible')::boolean,false)$new$
  );
  if patched = fn then
    raise exception 'could not align managed Driver vehicle readiness with SKIMA fleet ownership';
  end if;
  execute patched;
end
$migration$;

notify pgrst,'reload schema';
commit;
