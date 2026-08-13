begin;

do $$
declare
  lpg_module_id uuid;
  definition_record public.financial_policy_definitions%rowtype;
  version_id uuid;
begin
  select id into lpg_module_id from public.business_modules where key = 'lpg';

  select * into definition_record
  from public.financial_policy_definitions
  where key = 'pricing.lpg.delivery';

  if lpg_module_id is not null and definition_record.id is not null and not exists (
    select 1 from public.financial_policy_versions where policy_definition_id = definition_record.id
  ) then
    insert into public.financial_policy_versions (
      policy_definition_id, version, lifecycle_status, module_id, service_key, geography_type,
      currency_code, configuration, effective_from, change_reason, validation_snapshot,
      submitted_at, approved_at, activated_at
    ) values (
      definition_record.id, 1, 'active', lpg_module_id, 'lpg.refill.delivery', 'global', 'NGN',
      '{
        "base_amount":0,
        "included_km":0,
        "per_km_amount":0,
        "minimum_amount":0,
        "load_amount_per_kg":0,
        "distance_bands":[
          {"key":"configured-local-service","min_km":0,"max_km":20,"supported":true,"base_amount":0,"per_km_amount":0,"minimum_amount":0},
          {"key":"unsupported-distance","min_km":20,"supported":false,"base_amount":0,"per_km_amount":0,"minimum_amount":0}
        ],
        "explicit_zero_development_configuration":true
      }'::jsonb,
      timezone('utc', now()),
      'Development-safe zero-rate delivery structure pending company-approved LPG logistics rates.',
      public.validate_financial_policy_configuration('pricing', '{"base_amount":0,"per_km_amount":0,"explicit_zero_development_configuration":true}'::jsonb),
      timezone('utc', now()), timezone('utc', now()), timezone('utc', now())
    ) returning id into version_id;

    insert into public.financial_policy_events (
      policy_version_id, event_type, previous_state, new_state, reason, idempotency_key
    ) values (
      version_id, 'activated', null,
      (select to_jsonb(version.*) from public.financial_policy_versions version where version.id = version_id),
      'Development-safe zero-rate delivery structure pending company-approved LPG logistics rates.',
      'seed:lpg-delivery-development:v1'
    );
  end if;

  select * into definition_record
  from public.financial_policy_definitions
  where key = 'payout.lpg.driver';

  if lpg_module_id is not null and definition_record.id is not null and not exists (
    select 1 from public.financial_policy_versions where policy_definition_id = definition_record.id
  ) then
    insert into public.financial_policy_versions (
      policy_definition_id, version, lifecycle_status, module_id, service_key, geography_type,
      currency_code, configuration, effective_from, change_reason, validation_snapshot,
      submitted_at, approved_at, activated_at
    ) values (
      definition_record.id, 1, 'active', lpg_module_id, 'lpg.refill.delivery', 'global', 'NGN',
      '{"base_amount":0,"per_km_amount":0,"load_amount_per_kg":0,"explicit_zero_development_configuration":true,"not_linked_to_lpg_value":true}'::jsonb,
      timezone('utc', now()),
      'Development-safe zero-rate driver payout structure pending company-approved logistics compensation.',
      public.validate_financial_policy_configuration('payout', '{"base_amount":0,"per_km_amount":0,"explicit_zero_development_configuration":true}'::jsonb),
      timezone('utc', now()), timezone('utc', now()), timezone('utc', now())
    ) returning id into version_id;

    insert into public.financial_policy_events (
      policy_version_id, event_type, previous_state, new_state, reason, idempotency_key
    ) values (
      version_id, 'activated', null,
      (select to_jsonb(version.*) from public.financial_policy_versions version where version.id = version_id),
      'Development-safe zero-rate driver payout structure pending company-approved logistics compensation.',
      'seed:lpg-driver-payout-development:v1'
    );
  end if;
end $$;

commit;
