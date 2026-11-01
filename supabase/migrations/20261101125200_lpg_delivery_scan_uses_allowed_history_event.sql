do $patch$
declare
  function_ddl text;
  old_event constant text := 'history_event := ''delivery_handover_scan'';';
  new_event constant text := 'history_event := ''verified'';';
  matches integer;
begin
  function_ddl:=pg_get_functiondef(
    'public.record_lpg_cylinder_scan(uuid,text,text,numeric,numeric,numeric,jsonb,text)'::regprocedure
  );
  matches:=(length(function_ddl)-length(replace(function_ddl,old_event,'')))/length(old_event);
  if matches=0 and position(new_event in function_ddl)>0 then
    return;
  end if;
  if matches<>1 then
    raise exception 'Expected one custom delivery history event; found %',matches;
  end if;
  function_ddl:=replace(function_ddl,old_event,new_event);
  execute function_ddl;
end
$patch$;