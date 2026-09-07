begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- Keep a governed Nigerian payout directory available even when the selected
-- payment provider is temporarily unavailable. Provider readiness controls
-- account verification and transfer execution separately from bank discovery.
with bank_directory as (
  select jsonb_build_array(
    jsonb_build_object('name','GTBank (Guaranty Trust)','code','058'),
    jsonb_build_object('name','Access Bank','code','044'),
    jsonb_build_object('name','Zenith Bank','code','057'),
    jsonb_build_object('name','First Bank of Nigeria','code','011'),
    jsonb_build_object('name','United Bank for Africa (UBA)','code','033'),
    jsonb_build_object('name','OPay Digital Services','code','999992'),
    jsonb_build_object('name','PalmPay','code','999991'),
    jsonb_build_object('name','Kuda Microfinance Bank','code','50211'),
    jsonb_build_object('name','Moniepoint Microfinance Bank','code','50515'),
    jsonb_build_object('name','Wema Bank / ALAT','code','035'),
    jsonb_build_object('name','Stanbic IBTC Bank','code','221'),
    jsonb_build_object('name','FCMB (First City Monument)','code','214'),
    jsonb_build_object('name','Sterling Bank','code','232'),
    jsonb_build_object('name','Polaris Bank','code','076'),
    jsonb_build_object('name','Union Bank of Nigeria','code','032'),
    jsonb_build_object('name','Fidelity Bank','code','070'),
    jsonb_build_object('name','Providus Bank','code','101'),
    jsonb_build_object('name','VFD Microfinance Bank','code','566'),
    jsonb_build_object('name','Jaiz Bank','code','301'),
    jsonb_build_object('name','Taj Bank','code','302'),
    jsonb_build_object('name','Lotus Bank','code','303'),
    jsonb_build_object('name','Keystone Bank','code','082'),
    jsonb_build_object('name','SunTrust Bank','code','100'),
    jsonb_build_object('name','Globus Bank','code','103'),
    jsonb_build_object('name','Titan Trust Bank','code','102'),
    jsonb_build_object('name','Parallex Bank','code','526'),
    jsonb_build_object('name','PremiumTrust Bank','code','105'),
    jsonb_build_object('name','Signature Bank','code','106'),
    jsonb_build_object('name','Ecobank Nigeria','code','050'),
    jsonb_build_object('name','Standard Chartered','code','068')
  ) as directory
)
update public.provider_adapters adapter
set config = jsonb_set(
      coalesce(adapter.config, '{}'::jsonb),
      '{public_bank_directory}',
      bank_directory.directory,
      true
    ) || jsonb_build_object(
      'public_payout_country','NG',
      'public_payout_currency','NGN'
    ),
    updated_at = timezone('utc', now())
from bank_directory
where adapter.provider_kind = 'payment'
  and coalesce(adapter.config ->> 'country', 'NG') = 'NG';

with bank_directory as (
  select coalesce(
    (
      select adapter.config -> 'public_bank_directory'
      from public.provider_adapters adapter
      where adapter.provider_kind = 'payment'
        and jsonb_typeof(adapter.config -> 'public_bank_directory') = 'array'
        and jsonb_array_length(adapter.config -> 'public_bank_directory') > 0
      order by
        case when adapter.status = 'active' then 0 else 1 end,
        case when adapter.key = 'provider.payment.paystack' then 0 else 1 end,
        adapter.key
      limit 1
    ),
    '[]'::jsonb
  ) as directory
)
update public.currency_definitions currency
set metadata = jsonb_set(
      coalesce(currency.metadata, '{}'::jsonb),
      '{public_payout}',
      jsonb_build_object(
        'available', jsonb_array_length(bank_directory.directory) > 0,
        'country', 'NG',
        'currency', 'NGN',
        'source', 'skima.configured_fallback',
        'banks', bank_directory.directory
      ),
      true
    ),
    updated_at = timezone('utc', now())
from bank_directory
where currency.code = 'NGN'
  and currency.status = 'enabled';

create or replace function public.sync_public_payout_directory()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  provider_record record;
  payout_currency text := 'NGN';
  payout_country text := 'NG';
  bank_directory jsonb;
begin
  select provider.key, provider.config
  into provider_record
  from public.provider_adapters provider
  where provider.provider_kind = 'payment'
    and provider.status = 'active'
    and jsonb_typeof(provider.config -> 'public_bank_directory') = 'array'
    and jsonb_array_length(provider.config -> 'public_bank_directory') > 0
  order by
    case when provider.key = 'provider.payment.paystack' then 0 else 1 end,
    case when provider.key like '%.sandbox' then 1 else 0 end,
    provider.key
  limit 1;

  if found then
    payout_currency := coalesce(nullif(provider_record.config ->> 'public_payout_currency', ''), 'NGN');
    payout_country := coalesce(nullif(provider_record.config ->> 'public_payout_country', ''), 'NG');
    bank_directory := provider_record.config -> 'public_bank_directory';
  else
    select currency.metadata -> 'public_payout' -> 'banks'
    into bank_directory
    from public.currency_definitions currency
    where currency.code = 'NGN'
      and currency.status = 'enabled'
    limit 1;
  end if;

  bank_directory := coalesce(bank_directory, '[]'::jsonb);

  update public.currency_definitions currency
  set metadata = jsonb_set(
        coalesce(currency.metadata, '{}'::jsonb),
        '{public_payout}',
        jsonb_build_object(
          'available', jsonb_typeof(bank_directory) = 'array' and jsonb_array_length(bank_directory) > 0,
          'country', payout_country,
          'currency', payout_currency,
          'source', case when found then 'provider.config' else 'skima.configured_fallback' end,
          'banks', bank_directory
        ),
        true
      ),
      updated_at = timezone('utc', now())
  where currency.code = payout_currency
    and currency.status = 'enabled';
end;
$$;

comment on function public.sync_public_payout_directory() is
  'Publishes a safe Nigerian bank directory independently of live payout-provider readiness so bank discovery remains available during provider outages or compliance holds.';

select public.sync_public_payout_directory();

notify pgrst, 'reload schema';

commit;
