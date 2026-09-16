begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

create or replace function public.record_utility_provider_balance(
  target_provider_key text,
  target_balance numeric,
  target_currency_code text default 'NGN',
  target_source text default 'skima.admin.utility_billing'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  provider_record public.provider_adapters%rowtype;
  checked_at timestamptz := timezone('utc', now());
begin
  if not (
    public.has_permission('platform.billing.manage', null)
    or public.is_platform_super_admin()
  ) then
    raise exception using errcode = '42501', message = 'bill service management permission is required';
  end if;

  if target_balance is null or target_balance < 0 then
    raise exception 'provider balance cannot be negative';
  end if;
  if target_currency_code is null or btrim(target_currency_code) = '' then
    raise exception 'provider balance currency is required';
  end if;

  select * into provider_record
  from public.provider_adapters
  where provider_kind = 'utility' and key = target_provider_key
  for update;
  if not found then raise exception 'utility provider was not found'; end if;

  update public.provider_adapters
  set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
        'lastKnownBalance', target_balance,
        'balanceCurrency', upper(btrim(target_currency_code)),
        'lastBalanceCheckAt', checked_at,
        'balanceSource', nullif(btrim(target_source), '')
      ),
      updated_at = checked_at
  where id = provider_record.id;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id,
    before_state, after_state, metadata
  ) values (
    auth.uid(),
    'utility.provider.balance.recorded',
    'provider_adapter',
    provider_record.id,
    jsonb_build_object(
      'lastKnownBalance', provider_record.config->'lastKnownBalance',
      'balanceCurrency', provider_record.config->>'balanceCurrency',
      'lastBalanceCheckAt', provider_record.config->>'lastBalanceCheckAt'
    ),
    jsonb_build_object(
      'lastKnownBalance', target_balance,
      'balanceCurrency', upper(btrim(target_currency_code)),
      'lastBalanceCheckAt', checked_at
    ),
    jsonb_build_object('source', coalesce(nullif(btrim(target_source), ''), 'skima.admin.utility_billing'))
  );

  return jsonb_build_object(
    'providerKey', target_provider_key,
    'balance', target_balance,
    'currencyCode', upper(btrim(target_currency_code)),
    'checkedAt', checked_at
  );
end;
$$;

revoke all on function public.record_utility_provider_balance(text,numeric,text,text) from public, anon;
grant execute on function public.record_utility_provider_balance(text,numeric,text,text) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
