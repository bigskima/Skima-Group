begin;

-- Cylinder history accepts the canonical verification event. The dedicated
-- lpg_cylinder_scans row still identifies this action as customer_delivery.
do $migration$
declare
  function_ddl text;
  old_event text := $old$    history_event := 'delivery_handover_scan';$old$;
  new_event text := $new$    history_event := 'verified';$new$;
begin
  function_ddl := pg_get_functiondef(
    'public.record_lpg_cylinder_scan(uuid,text,text,numeric,numeric,numeric,jsonb,text)'::regprocedure
  );

  if position(new_event in function_ddl) > 0 then
    return;
  end if;

  if position(old_event in function_ddl) = 0 then
    raise exception 'Expected interim delivery scan history event was not found';
  end if;

  function_ddl := replace(function_ddl, old_event, new_event);
  execute function_ddl;
end
$migration$;

notify pgrst, 'reload schema';
commit;
