begin;

-- The LPG lifecycle already owns all unpaid-order expiry rules. This wrapper only
-- gives pg_cron a tightly scoped way to invoke that existing function without
-- exposing lifecycle execution to normal application roles.
create extension if not exists pg_cron;

create or replace function public.run_scheduled_lpg_unpaid_expiry()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_count integer;
begin
  -- Supabase auth helpers read the transaction-local JWT claims. The scheduled
  -- job runs as the migration/database owner, so provide the same service-role
  -- execution context used by the existing runtime worker for this call only.
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'service_role')::text,
    true
  );

  expired_count := public.expire_stale_unpaid_lpg_orders(500);
  return expired_count;
end;
$$;

revoke all on function public.run_scheduled_lpg_unpaid_expiry() from public, anon, authenticated;
grant execute on function public.run_scheduled_lpg_unpaid_expiry() to service_role;

-- Keep a single named job if this migration is replayed in a restored or branched
-- environment. Hourly execution keeps the 24-hour policy timely without creating
-- a second lifecycle engine or unnecessarily frequent database work.
do $$
declare
  existing_job_id bigint;
begin
  select jobid
  into existing_job_id
  from cron.job
  where jobname = 'skima-lpg-unpaid-order-expiry'
  order by jobid desc
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end;
$$;

select cron.schedule(
  'skima-lpg-unpaid-order-expiry',
  '7 * * * *',
  $cron$select public.run_scheduled_lpg_unpaid_expiry();$cron$
);

commit;
