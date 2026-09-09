begin;

set local lock_timeout='10s';
set local statement_timeout='0';

create or replace function public.fail_unreserved_utility_payment_request(
  target_request_id uuid,
  target_error_code text,
  target_error_message text
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',
      message='utility reservation failure cleanup is server-only';
  end if;

  update public.utility_payment_requests
  set status='failed',
      last_error_code=coalesce(nullif(btrim(target_error_code),''),'reservation_failed'),
      last_error_message=left(
        coalesce(nullif(btrim(target_error_message),''),'Utility wallet reservation failed.'),
        1000
      ),
      completed_at=timezone('utc',now()),
      updated_at=timezone('utc',now())
  where id=target_request_id
    and status='awaiting_payment'
    and reservation_transaction_id is null;

  -- The existing utility status trigger releases any budget_reserved counters
  -- and cancels a prepared reward when an awaiting request transitions to failed.
end;
$$;

revoke all on function public.fail_unreserved_utility_payment_request(uuid,text,text)
from public,anon,authenticated;
grant execute on function public.fail_unreserved_utility_payment_request(uuid,text,text)
to service_role;

notify pgrst,'reload schema';

commit;