begin;

-- The worker authenticates service-role Bearer tokens in its own handler. The
-- Vault values stay inside the database scheduler and are never returned to
-- clients or written to logs.
do $$
declare
  existing_job_id bigint;
  project_url text;
  service_role_key text;
begin
  select decrypted_secret into project_url
  from vault.decrypted_secrets
  where name = 'skima_supabase_url'
  limit 1;

  select decrypted_secret into service_role_key
  from vault.decrypted_secrets
  where name = 'skima_service_role_key'
  limit 1;

  if nullif(rtrim(coalesce(project_url, ''), '/'), '') is null
    or nullif(btrim(coalesce(service_role_key, '')), '') is null then
    raise exception 'Configure skima_supabase_url and skima_service_role_key in Vault before scheduling the SKIMA runtime worker';
  end if;

  select jobid into existing_job_id
  from cron.job
  where jobname = 'skima-runtime-worker';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'skima-runtime-worker',
    '* * * * *',
    $job$
      select net.http_post(
        url := (
          select rtrim(decrypted_secret, '/') || '/functions/v1/runtime-worker'
          from vault.decrypted_secrets
          where name = 'skima_supabase_url'
          limit 1
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'skima_service_role_key'
            limit 1
          )
        ),
        body := '{"limit":50}'::jsonb
      );
    $job$
  );
end;
$$;

commit;
