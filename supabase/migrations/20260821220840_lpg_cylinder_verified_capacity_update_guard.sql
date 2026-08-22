create or replace function public.enforce_lpg_cylinder_verified_capacity_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.size_kg is distinct from old.size_kg
     or new.max_capacity_kg is distinct from old.max_capacity_kg
     or new.cylinder_type_profile_id is distinct from old.cylinder_type_profile_id then
    if current_user not in ('postgres', 'service_role') then
      raise exception using
        errcode = '42501',
        message = 'verified cylinder capacity can only be changed through SKIMA verification';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_lpg_cylinder_verified_capacity_update() from public;
revoke all on function public.enforce_lpg_cylinder_verified_capacity_update() from anon;
revoke all on function public.enforce_lpg_cylinder_verified_capacity_update() from authenticated;
grant execute on function public.enforce_lpg_cylinder_verified_capacity_update() to service_role;

drop trigger if exists lpg_cylinders_enforce_verified_capacity_update on public.lpg_cylinders;
create trigger lpg_cylinders_enforce_verified_capacity_update
before update of size_kg, max_capacity_kg, cylinder_type_profile_id
on public.lpg_cylinders
for each row
execute function public.enforce_lpg_cylinder_verified_capacity_update();
