begin;

-- Avoid PL/pgSQL variable/column name collision when validating a driver's
-- assigned vehicle. The previous "vehicle_id = vehicle_id" predicate failed
-- as ambiguous on every dispatch candidate insert.
create or replace function public.guard_dispatch_driver_vehicle_pair()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_vehicle_id uuid;
  eligible boolean;
begin
  if new.candidate_entity_type<>'driver' then
    return new;
  end if;

  v_vehicle_id:=nullif(new.rationale->>'vehicle_id','')::uuid;
  if v_vehicle_id is null then
    raise exception 'dispatch candidate must identify a driver and vehicle combination';
  end if;

  select
    assignment_compliance.driver_approved
    and assignment_compliance.vehicle_approved
    and assignment_compliance.assignment_active
    and assignment_compliance.vehicle_documents_valid
    and assignment_compliance.owner_approved
  into eligible
  from public.vehicle_assignment_compliance assignment_compliance
  where assignment_compliance.driver_profile_id=new.candidate_entity_id
    and assignment_compliance.vehicle_id=v_vehicle_id;

  if not coalesce(eligible,false) then
    raise exception 'driver and vehicle combination is not operationally eligible';
  end if;

  return new;
end;
$function$;

comment on function public.guard_dispatch_driver_vehicle_pair() is
  'Validates the driver/vehicle pair attached to a dispatch candidate using an unambiguous vehicle identifier.';

notify pgrst,'reload schema';
commit;
