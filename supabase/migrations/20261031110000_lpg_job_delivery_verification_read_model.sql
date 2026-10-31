begin;

-- Expose only the boolean completion state to actors who can already access
-- this LPG order. The OTP value/hash is never included in the read model.
do $$
declare
  function_sql text;
  old_block text;
  new_block text;
begin
  function_sql := pg_get_functiondef('public.read_lpg_job_details(uuid)'::regprocedure);
  old_block := $old$'deliveryChallengeId', target_order.delivery_challenge_id,$old$;
  new_block := $new$'deliveryChallengeId', target_order.delivery_challenge_id,
      'deliveryChallengeVerified', public.lpg_delivery_challenge_is_verified(
        target_order.id,
        target_order.delivery_challenge_id
      ),$new$;

  if position(old_block in function_sql) = 0 then
    raise exception 'read_lpg_job_details delivery challenge projection no longer matches expected baseline';
  end if;

  function_sql := replace(function_sql, old_block, new_block);
  execute function_sql;
end;
$$;

notify pgrst, 'reload schema';

commit;
