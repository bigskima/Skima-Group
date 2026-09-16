begin;

do $$
declare fn text;
begin
  fn:=pg_get_functiondef('public.read_lpg_job_route_state(uuid,text)'::regprocedure);
  fn:=replace(
    fn,
    '''publicReference'', order_record.public_reference',
    '''publicReference'', order_record.public_reference, ''fulfillmentChannel'', order_record.fulfillment_channel'
  );
  execute fn;
end
$$;

notify pgrst,'reload schema';
commit;
