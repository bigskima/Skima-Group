begin;

do $job_delivery_challenge_projection$
declare
  function_sql text;
  old_fragment text := E'      ''deliveryChallengeId'', target_order.delivery_challenge_id,\n';
  new_fragment text := E'      ''deliveryChallengeId'', target_order.delivery_challenge_id,\n      ''deliveryChallengeVerified'', case when target_order.delivery_challenge_id is not null then public.lpg_delivery_challenge_is_verified(target_order.id, target_order.delivery_challenge_id) else false end,\n';
begin
  function_sql := pg_get_functiondef('public.read_lpg_job_details(uuid)'::regprocedure);

  if position(old_fragment in function_sql) = 0 then
    if position('deliveryChallengeVerified' in function_sql) > 0 then
      raise notice 'Delivery challenge verification projection is already present';
      return;
    end if;
    raise exception 'Could not locate the delivery challenge field in read_lpg_job_details';
  end if;

  function_sql := replace(function_sql, old_fragment, new_fragment);
  execute function_sql;
end;
$job_delivery_challenge_projection$;

commit;
