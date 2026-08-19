begin;

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
      adapter.config,
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
  and coalesce(adapter.config ->> 'country','NG') = 'NG';

commit;
