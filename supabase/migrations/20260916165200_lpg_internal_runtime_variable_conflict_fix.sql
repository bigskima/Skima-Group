begin;

do $$
declare
  fn text;
  sig regprocedure;
begin
  foreach sig in array array[
    'public.lpg_internal_live_driver_available(numeric,numeric)'::regprocedure,
    'public.read_lpg_internal_launch_readiness()'::regprocedure,
    'public.dispatch_lpg_internal_order(uuid,integer,text,text)'::regprocedure
  ]
  loop
    fn:=pg_get_functiondef(sig);
    if position('#variable_conflict use_variable' in fn)=0 then
      fn:=replace(fn,'AS $function$\n','AS $function$\n#variable_conflict use_variable\n');
      execute fn;
    end if;
  end loop;
end
$$;

notify pgrst,'reload schema';
commit;
