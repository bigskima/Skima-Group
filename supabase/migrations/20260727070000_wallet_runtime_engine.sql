begin;

alter table public.wallet_accounts
add column if not exists source text not null default 'platform.wallet_engine'
  check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$');

alter table public.wallet_accounts
add column if not exists idempotency_key text;

create unique index if not exists wallet_accounts_source_idempotency_unique
on public.wallet_accounts (source, idempotency_key)
where idempotency_key is not null;

create table if not exists public.wallet_account_events (
  id uuid primary key default gen_random_uuid(),
  wallet_account_id uuid not null references public.wallet_accounts(id) on delete cascade,
  event_type text not null
    check (event_type in ('created', 'status_changed')),
  status text not null
    check (status in ('pending', 'active', 'suspended', 'closed')),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  unique (wallet_account_id, idempotency_key)
);

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
    target_owner_entity_type = 'user'
    and target_owner_entity_id = auth.uid()
    and target_wallet_type in ('customer', 'refund', 'bonus', 'loyalty', 'generic');

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

create or replace function public.set_wallet_account_status(
  target_wallet_account_id uuid default null,
  target_status text default null,
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  wallet_record record;
  existing_event record;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.wallets.manage', null) then
    raise exception 'platform wallet management permission is required';
  end if;

  if target_wallet_account_id is null then
    raise exception 'target_wallet_account_id is required';
  end if;

  if target_status is null
    or target_status not in ('pending', 'active', 'suspended', 'closed') then
    raise exception 'target_status is not supported';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select event.*
  into existing_event
  from public.wallet_account_events event
  where event.wallet_account_id = target_wallet_account_id
    and event.idempotency_key = target_idempotency_key;

  if found then
    if existing_event.status <> target_status
      or existing_event.metadata <> target_metadata then
      raise exception 'target_idempotency_key has already been used with different wallet status details';
    end if;

    return target_wallet_account_id;
  end if;

  select wallet.*
  into wallet_record
  from public.wallet_accounts wallet
  where wallet.id = target_wallet_account_id
  for update;

  if not found then
    raise exception 'target_wallet_account_id must reference an existing wallet account';
  end if;

  if wallet_record.status = 'closed'
    and target_status <> 'closed' then
    raise exception 'closed wallet accounts cannot change status';
  end if;

  if wallet_record.status = 'active'
    and target_status = 'pending' then
    raise exception 'active wallet accounts cannot return to pending status';
  end if;

  if wallet_record.status = 'suspended'
    and target_status = 'pending' then
    raise exception 'suspended wallet accounts cannot return to pending status';
  end if;

  update public.wallet_accounts
  set status = target_status,
      metadata = metadata || target_metadata,
      updated_at = timezone('utc', now())
  where id = target_wallet_account_id;

  insert into public.wallet_account_events (
    wallet_account_id,
    event_type,
    status,
    idempotency_key,
    metadata
  )
  values (
    target_wallet_account_id,
    'status_changed',
    target_status,
    target_idempotency_key,
    target_metadata
  );

  return target_wallet_account_id;
end;
$$;

create or replace function public.prevent_wallet_account_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'wallet account events are append-only';
end;
$$;

drop trigger if exists prevent_wallet_account_events_update on public.wallet_account_events;
create trigger prevent_wallet_account_events_update
before update on public.wallet_account_events
for each row execute function public.prevent_wallet_account_event_mutation();

drop trigger if exists prevent_wallet_account_events_delete on public.wallet_account_events;
create trigger prevent_wallet_account_events_delete
before delete on public.wallet_account_events
for each row execute function public.prevent_wallet_account_event_mutation();

alter table public.wallet_account_events enable row level security;

drop policy if exists wallet_accounts_manage_privileged on public.wallet_accounts;
drop policy if exists wallet_accounts_no_direct_insert on public.wallet_accounts;
drop policy if exists wallet_accounts_no_direct_update on public.wallet_accounts;
drop policy if exists wallet_accounts_no_direct_delete on public.wallet_accounts;
drop policy if exists wallet_account_events_select_owner_or_privileged on public.wallet_account_events;
drop policy if exists wallet_account_events_no_direct_insert on public.wallet_account_events;
drop policy if exists wallet_account_events_no_direct_update on public.wallet_account_events;
drop policy if exists wallet_account_events_no_direct_delete on public.wallet_account_events;

create policy wallet_accounts_no_direct_insert on public.wallet_accounts
for insert to authenticated
with check (false);

create policy wallet_accounts_no_direct_update on public.wallet_accounts
for update to authenticated
using (false)
with check (false);

create policy wallet_accounts_no_direct_delete on public.wallet_accounts
for delete to authenticated
using (false);

create policy wallet_account_events_select_owner_or_privileged
on public.wallet_account_events
for select to authenticated
using (
  exists (
    select 1
    from public.wallet_accounts wallet
    where wallet.id = wallet_account_events.wallet_account_id
      and public.is_wallet_owner(wallet.id)
  )
  or public.has_permission('platform.wallets.read', null)
  or public.has_permission('platform.wallets.manage', null)
);

create policy wallet_account_events_no_direct_insert
on public.wallet_account_events
for insert to authenticated
with check (false);

create policy wallet_account_events_no_direct_update
on public.wallet_account_events
for update to authenticated
using (false)
with check (false);

create policy wallet_account_events_no_direct_delete
on public.wallet_account_events
for delete to authenticated
using (false);

grant select, insert, update, delete on public.wallet_account_events to authenticated;
grant select, insert, update, delete on public.wallet_account_events to service_role;

revoke all on function public.ensure_wallet_account(text, text, uuid, text, text, jsonb, text) from public;
revoke all on function public.set_wallet_account_status(uuid, text, text, jsonb) from public;
revoke all on function public.ensure_wallet_account(text, text, uuid, text, text, jsonb, text) from anon;
revoke all on function public.set_wallet_account_status(uuid, text, text, jsonb) from anon;

grant execute on function public.ensure_wallet_account(text, text, uuid, text, text, jsonb, text)
to authenticated, service_role;

grant execute on function public.set_wallet_account_status(uuid, text, text, jsonb)
to authenticated, service_role;

commit;
