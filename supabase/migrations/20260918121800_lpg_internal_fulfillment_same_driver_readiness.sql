begin;

-- A launch-ready state must describe one executable Managed Driver path.
-- Separate vehicle-ready and coverage-ready counts can otherwise be satisfied
-- by different Drivers, while no single Driver can actually receive an order.

do $migration$
declare
  fn text;
  patched text;
begin
  fn := pg_get_functiondef('public.read_lpg_internal_launch_readiness()'::regprocedure);
  patched := fn;

  patched := replace(
    patched,
    $old$  coverage_ready_count integer:=0;
  reference_scope_count integer:=0;$old$,
    $new$  coverage_ready_count integer:=0;
  fully_ready_count integer:=0;
  reference_scope_count integer:=0;$new$
  );

  patched := replace(
    patched,
    $old$  select count(*)::integer into reference_scope_count
  from public.financial_policy_versions version$old$,
    $new$  select count(distinct driver.id)::integer into fully_ready_count
  from public.driver_profiles driver
  join public.driver_program_memberships membership
    on membership.driver_profile_id=driver.id
  where membership.program_key=program_key
    and membership.status='active'
    and membership.starts_at<=timezone('utc',now())
    and (membership.ends_at is null or membership.ends_at>timezone('utc',now()))
    and driver.verification_status='approved'
    and exists(
      select 1
      from public.driver_vehicle_links link
      join public.vehicles vehicle on vehicle.id=link.vehicle_id
      where link.driver_profile_id=driver.id
        and link.relationship_type='fleet_owned'
        and link.status='active'
        and link.starts_at<=timezone('utc',now())
        and (link.ends_at is null or link.ends_at>timezone('utc',now()))
        and vehicle.platform_owned
        and vehicle.status='active'
        and coalesce((public.evaluate_driver_vehicle_eligibility(driver.id,vehicle.id,'lpg')->>'eligible')::boolean,false)
    )
    and exists(
      select 1
      from public.operational_coverage_assignments coverage
      where coverage.entity_type='DRIVER'
        and coverage.entity_id=driver.id
        and coverage.service_key='lpg'
        and coverage.status in ('approved','active')
        and coverage.approved_at is not null
        and (coverage.valid_from is null or coverage.valid_from<=timezone('utc',now()))
        and (coverage.valid_to is null or coverage.valid_to>timezone('utc',now()))
    );

  select count(*)::integer into reference_scope_count
  from public.financial_policy_versions version$new$
  );

  patched := replace(
    patched,
    $old$  if coverage_ready_count=0 then
    reasons:=reasons||jsonb_build_array('At least one managed driver needs approved LPG operational coverage.');
  end if;

  return jsonb_build_object($old$,
    $new$  if coverage_ready_count=0 then
    reasons:=reasons||jsonb_build_array('At least one managed driver needs approved LPG operational coverage.');
  end if;
  if fully_ready_count=0 then
    reasons:=reasons||jsonb_build_array('At least one Managed Driver must have both an LPG-ready SKIMA-owned fleet vehicle and approved LPG operational coverage.');
  end if;

  return jsonb_build_object($new$
  );

  patched := replace(
    patched,
    $old$    'coverageReadyDriverCount',coverage_ready_count,
    'reasons',reasons$old$,
    $new$    'coverageReadyDriverCount',coverage_ready_count,
    'fullyReadyDriverCount',fully_ready_count,
    'reasons',reasons$new$
  );

  if patched = fn
    or position('fullyReadyDriverCount' in patched)=0
    or position('fully_ready_count' in patched)=0 then
    raise exception 'could not require one fully ready Managed Driver for SKIMA internal fulfillment';
  end if;

  execute patched;
end
$migration$;

notify pgrst,'reload schema';
commit;
