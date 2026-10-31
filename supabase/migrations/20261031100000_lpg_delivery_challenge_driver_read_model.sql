begin;

-- Expose the customer's verified hand-over challenge in the existing driver
-- job read model. The order remains delivery_verification_pending until the
-- assigned driver completes the final cylinder scan.
do $$
declare
  function_definition text;
  old_fragment constant text := $old$'deliveryChallengeId', target_order.delivery_challenge_id,$old$;
  new_fragment constant text := $new$'deliveryChallengeId', target_order.delivery_challenge_id,
       'deliveryChallengeVerified', public.lpg_delivery_challenge_is_verified(target_order.id, target_order.delivery_challenge_id),$new$;
begin
  function_definition := pg_get_functiondef('public.read_lpg_job_details(uuid)'::regprocedure);

  if position(new_fragment in function_definition) > 0 then
    return;
  end if;

  if position(old_fragment in function_definition) = 0 then
    raise exception 'read_lpg_job_details no longer contains the expected delivery challenge projection';
  end if;

  execute replace(function_definition, old_fragment, new_fragment);
end;
$$;

comment on function public.read_lpg_job_details(uuid) is
  'Returns the authorized LPG job read model, including whether the current customer delivery challenge is verified so the assigned driver can complete the final cylinder hand-over scan.';

commit;
