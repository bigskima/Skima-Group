create or replace function public.guard_lpg_internal_platform_fleet_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare managed_key text;
begin
  if new.fulfillment_channel is distinct from 'skima_internal'
    or new.driver_profile_id is null
    or new.vehicle_id is null then
    return new;
  end if;

  managed_key:=coalesce(
    public.lpg_policy_config('lpg.fulfillment.launch_assurance')->>'internal_driver_program_key',
    'driver.skima_special'
  );

  if not exists(
    select 1
    from public.vehicles vehicle
    join public.driver_vehicle_links link
      on link.vehicle_id=vehicle.id
     and link.driver_profile_id=new.driver_profile_id
     and link.relationship_type='fleet_owned'
     and link.status='active'
     and link.starts_at<=timezone('utc',now())
     and (link.ends_at is null or link.ends_at>timezone('utc',now()))
    join public.driver_program_memberships membership
      on membership.driver_profile_id=new.driver_profile_id
     and membership.program_key=managed_key
     and membership.status='active'
     and membership.starts_at<=timezone('utc',now())
     and (membership.ends_at is null or membership.ends_at>timezone('utc',now()))
    where vehicle.id=new.vehicle_id
      and vehicle.platform_owned
      and vehicle.status='active'
  ) then
    raise exception using errcode='55000',message='SKIMA internal fulfillment requires an active SKIMA-owned fleet vehicle assigned to the Managed Driver';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_lpg_internal_platform_fleet_assignment on public.lpg_refill_orders;
create trigger guard_lpg_internal_platform_fleet_assignment
before insert or update of fulfillment_channel,driver_profile_id,vehicle_id,status
on public.lpg_refill_orders
for each row execute function public.guard_lpg_internal_platform_fleet_assignment();

revoke all on function public.guard_lpg_internal_platform_fleet_assignment() from public,anon,authenticated;

do $$
declare fn text;
begin
  select pg_get_functiondef('public.read_lpg_internal_launch_readiness()'::regprocedure) into fn;
  fn:=replace(
    fn,
    'At least one managed driver needs an active LPG-eligible vehicle.',
    'At least one Managed Driver needs an active LPG-eligible SKIMA fleet vehicle assigned by Admin.'
  );
  execute fn;
end $$;
