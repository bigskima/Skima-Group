begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

create or replace function public.resolve_active_payment_provider()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  configured_key text;
  adapter_status text;
begin
  select nullif(btrim(entry.value ->> 'active_provider_key'), '')
  into configured_key
  from public.configuration_entries entry
  where entry.namespace = 'platform.payments'
    and entry.key = 'provider_selection'
    and entry.scope_type = 'global'
    and entry.scope_id is null
    and entry.status = 'active'
  order by entry.version desc, entry.updated_at desc
  limit 1;

  if configured_key is null then
    raise exception using errcode = '23514',
      message = 'active payment provider selection is not configured';
  end if;

  select adapter.status
  into adapter_status
  from public.provider_adapters adapter
  where adapter.provider_kind = 'payment'
    and adapter.key = configured_key
  limit 1;

  if adapter_status is null then
    raise exception using errcode = '23514',
      message = format('configured payment provider %s does not exist', configured_key);
  end if;

  if adapter_status <> 'active' then
    raise exception using errcode = '23514',
      message = format('configured payment provider %s is not active', configured_key);
  end if;

  return configured_key;
end;
$$;

revoke all on function public.resolve_active_payment_provider()
from public, anon;

grant execute on function public.resolve_active_payment_provider()
to authenticated, service_role;

comment on function public.resolve_active_payment_provider() is
  'Returns the single configured active payment provider after validating the provider adapter is active. Finance runtimes must use this resolver rather than choosing an adapter independently.';

notify pgrst, 'reload schema';

commit;
