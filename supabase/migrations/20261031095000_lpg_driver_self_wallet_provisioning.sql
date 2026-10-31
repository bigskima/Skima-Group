begin;

-- Permit an approved driver to provision only their own driver wallet.
-- This is required by the automatic payout path after a verified customer
-- delivery scan. It does not grant platform.wallets.manage and does not let a
-- driver create wallets for another driver or for any platform owner.
create or replace function public.ensure_wallet_account(
  target_wallet_type text default null,
  target_owner_entity_type text default null,
  target_owner_entity_id uuid default null,
  target_currency_code text default 'NGN',
  target_source text default null,
  target_metadata jsonb default '{}'::jsonb,
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_record record;
  wallet_account_id uuid;
  can_create_self_wallet boolean;
begin
  can_create_self_wallet :=
    (
      target_owner_entity_type = 'user'
      and target_owner_entity_id = auth.uid()
      and target_wallet_type in ('customer', 'refund', 'bonus', 'loyalty', 'generic')
    )
    or (
      target_wallet_type = 'driver'
      and target_owner_entity_type = 'driver'
      and exists (
        select 1
        from public.driver_profiles driver
        where driver.id = target_owner_entity_id
          and driver.user_id = auth.uid()
          and driver.verification_status = 'approved'
      )
    );

  if auth.role() <> 'service_role'
    and not public.has_permission('platform.wallets.manage', null)
    and not can_create_self_wallet then
    raise exception 'platform wallet management permission is required';
  end if;

  if target_wallet_type not in (
    'customer',
    'driver',
    'partner',
    'platform',
    'escrow',
    'commission',
    'refund',
    'bonus',
    'loyalty',
    'generic'
  ) then
    raise exception 'target_wallet_type is not supported';
  end if;

  if target_owner_entity_type not in (
    'user',
    'organization',
    'partner',
    'driver',
    'vehicle',
    'asset',
    'platform',
    'escrow',
    'module'
  ) then
    raise exception 'target_owner_entity_type is not supported';
  end if;

  if target_owner_entity_type not in ('platform', 'module')
    and target_owner_entity_id is null then
    raise exception 'target_owner_entity_id is required for this owner entity type';
  end if;

  if target_currency_code is null
    or target_currency_code !~ '^[A-Z0-9]{3,12}$' then
    raise exception 'target_currency_code must be a valid configured currency code';
  end if;

  if not exists (
    select 1
    from public.currency_definitions currency_record
    where currency_record.code = target_currency_code
      and currency_record.status = 'enabled'
  ) then
    raise exception 'target_currency_code must reference an enabled currency';
  end if;

  if target_source is null
    or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select existing.*
  into existing_record
  from public.wallet_accounts existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if found then
    if existing_record.wallet_type <> target_wallet_type
      or existing_record.owner_entity_type <> target_owner_entity_type
      or existing_record.owner_entity_id is distinct from target_owner_entity_id
      or existing_record.currency_code <> target_currency_code then
      raise exception 'target_idempotency_key has already been used with different wallet details';
    end if;

    return existing_record.id;
  end if;

  insert into public.wallet_accounts (
    wallet_type,
    owner_entity_type,
    owner_entity_id,
    currency_code,
    status,
    metadata,
    created_by,
    source,
    idempotency_key
  )
  values (
    target_wallet_type,
    target_owner_entity_type,
    target_owner_entity_id,
    target_currency_code,
    'active',
    target_metadata,
    auth.uid(),
    target_source,
    target_idempotency_key
  )
  on conflict do nothing
  returning id into wallet_account_id;

  if wallet_account_id is null then
    select existing.*
    into existing_record
    from public.wallet_accounts existing
    where existing.wallet_type = target_wallet_type
      and existing.owner_entity_type = target_owner_entity_type
      and existing.owner_entity_id is not distinct from target_owner_entity_id
      and existing.currency_code = target_currency_code;

    if not found then
      raise exception 'wallet account idempotency lookup failed';
    end if;

    if existing_record.status = 'closed' then
      raise exception 'closed wallet accounts cannot be re-opened by ensure_wallet_account';
    end if;

    return existing_record.id;
  end if;

  insert into public.wallet_account_events (
    wallet_account_id,
    event_type,
    status,
    idempotency_key,
    metadata
  )
  values (
    wallet_account_id,
    'created',
    'active',
    target_idempotency_key || ':created',
    target_metadata || jsonb_build_object('source', target_source)
  );

  return wallet_account_id;
end;
$$;

commit;
