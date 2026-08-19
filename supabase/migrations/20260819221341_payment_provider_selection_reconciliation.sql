begin;

do $$
declare
  paystack_status text;
  updated_rows integer;
begin
  select status
  into paystack_status
  from public.provider_adapters
  where key = 'provider.payment.paystack';

  if paystack_status is distinct from 'active' then
    raise exception 'provider.payment.paystack must be active before selecting it for platform payments';
  end if;

  update public.configuration_entries
  set value = jsonb_set(
        value,
        '{active_provider_key}',
        to_jsonb('provider.payment.paystack'::text),
        true
      ),
      version = version + 1,
      updated_at = timezone('utc', now())
  where namespace = 'platform.payments'
    and key = 'provider_selection'
    and scope_type = 'global'
    and status = 'active';

  get diagnostics updated_rows = row_count;
  if updated_rows <> 1 then
    raise exception 'expected exactly one active global platform.payments provider_selection record, updated %', updated_rows;
  end if;
end $$;

commit;
