begin;

-- Assigned drivers need the delivery contact attached to the saved address. The
-- contact remains scoped by read_lpg_job_details/can_access_lpg_order and is not
-- added to queue-wide or public records.
do $$
declare
  function_sql text;
begin
  function_sql := pg_get_functiondef('public.read_lpg_job_details(uuid)'::regprocedure);

  if position('''avatarUrl'', customer.avatar_url' in function_sql) = 0 then
    raise exception 'read_lpg_job_details customer projection no longer matches expected baseline';
  end if;
  function_sql := replace(function_sql, '''avatarUrl'', customer.avatar_url', '''avatarUrl'', customer.avatar_url, ''email'', (select account.email from auth.users account where account.id = customer.id)');

  if position('''contactPhone'', pickup.contact_phone' in function_sql) = 0 or position('''contactPhone'', delivery.contact_phone' in function_sql) = 0 then
    raise exception 'read_lpg_job_details location contact projection no longer matches expected baseline';
  end if;
  function_sql := replace(function_sql, '''contactPhone'', pickup.contact_phone', '''contactPhone'', pickup.contact_phone, ''contactEmail'', pickup.metadata #>> ''{deliveryContact,email}''');
  function_sql := replace(function_sql, '''contactPhone'', delivery.contact_phone', '''contactPhone'', delivery.contact_phone, ''contactEmail'', delivery.metadata #>> ''{deliveryContact,email}''');

  execute function_sql;
end
$$;

revoke all on function public.read_lpg_job_details(uuid) from public, anon;
grant execute on function public.read_lpg_job_details(uuid) to authenticated, service_role;

commit;
