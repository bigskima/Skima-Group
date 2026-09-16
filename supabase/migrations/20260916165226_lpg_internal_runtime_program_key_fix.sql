begin;

do $$
declare fn text;
begin
  fn:=pg_get_functiondef('public.read_lpg_internal_launch_readiness()'::regprocedure);
  fn:=replace(fn,'  program_key text;','  v_program_key text;');
  fn:=replace(fn,'  program_key:=coalesce','  v_program_key:=coalesce');
  fn:=replace(fn,'membership.program_key=program_key','membership.program_key=v_program_key');
  fn:=replace(fn,'''programKey'',program_key','''programKey'',v_program_key');
  execute fn;

  fn:=pg_get_functiondef('public.lpg_internal_live_driver_available(numeric,numeric)'::regprocedure);
  fn:=replace(fn,'  program_key text;','  v_program_key text;');
  fn:=replace(fn,'  program_key:=coalesce','  v_program_key:=coalesce');
  fn:=replace(fn,'membership.program_key=program_key','membership.program_key=v_program_key');
  execute fn;

  fn:=pg_get_functiondef('public.dispatch_lpg_internal_order(uuid,integer,text,text)'::regprocedure);
  fn:=replace(fn,'  program_key text;','  v_program_key text;');
  fn:=replace(fn,'  program_key:=coalesce','  v_program_key:=coalesce');
  fn:=replace(fn,'membership.program_key=program_key','membership.program_key=v_program_key');
  fn:=replace(fn,'''driver_program_key'',program_key','''driver_program_key'',v_program_key');
  fn:=replace(fn,'''participation_program_key'',program_key','''participation_program_key'',v_program_key');
  fn:=replace(fn,'''participationProgramKey'',program_key','''participationProgramKey'',v_program_key');
  execute fn;
end
$$;

notify pgrst,'reload schema';
commit;
