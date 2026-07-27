begin;

create or replace function public.post_financial_transaction(
  target_transaction_type text,
  target_currency_code text,
  target_source text,
  target_subject_type text,
  target_subject_id uuid,
  target_entries jsonb,
  target_idempotency_key text,
  target_provider_adapter_id uuid default null,
  target_external_reference text default null,
  target_policy_snapshot jsonb default '{}'::jsonb,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_transaction record;
  parsed_entry record;
  target_wallet record;
  transaction_id uuid;
  debit_total numeric(28, 8) := 0;
  credit_total numeric(28, 8) := 0;
  entry_wallet_id uuid;
  entry_direction text;
  entry_amount numeric(28, 8);
  entry_type text;
  entry_metadata jsonb;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.financial.manage', null) then
    raise exception 'platform financial management permission is required';
  end if;

  if target_transaction_type not in (
    'payment',
    'transfer',
    'hold',
    'release',
    'refund',
    'commission',
    'fee',
    'adjustment'
  ) then
    raise exception 'target_transaction_type is not supported';
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

  if target_subject_type is null
    or target_subject_type !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_subject_type must be a valid platform key';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_policy_snapshot is null
    or jsonb_typeof(target_policy_snapshot) <> 'object' then
    raise exception 'target_policy_snapshot must be a JSON object';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  if target_entries is null
    or jsonb_typeof(target_entries) <> 'array'
    or jsonb_array_length(target_entries) < 2 then
    raise exception 'target_entries must contain at least two ledger entries';
  end if;

  if target_provider_adapter_id is not null
    and not exists (
      select 1
      from public.provider_adapters provider_record
      where provider_record.id = target_provider_adapter_id
        and provider_record.status = 'active'
    ) then
    raise exception 'target_provider_adapter_id must reference an active provider adapter';
  end if;

  drop table if exists pg_temp.financial_posting_entries;

  create temporary table financial_posting_entries (
    wallet_id uuid not null,
    direction text not null,
    amount numeric(28, 8) not null,
    entry_type text not null,
    metadata jsonb not null,
    ordinal bigint not null
  ) on commit drop;

  for parsed_entry in
    select parsed.value, parsed.ordinality
    from jsonb_array_elements(target_entries) with ordinality as parsed(value, ordinality)
  loop
    begin
      entry_wallet_id := (parsed_entry.value ->> 'wallet_id')::uuid;
    exception
      when others then
        raise exception 'each ledger entry must include a valid wallet_id';
    end;

    entry_direction := parsed_entry.value ->> 'direction';

    if entry_direction not in ('debit', 'credit') then
      raise exception 'each ledger entry direction must be debit or credit';
    end if;

    begin
      entry_amount := (parsed_entry.value ->> 'amount')::numeric(28, 8);
    exception
      when others then
        raise exception 'each ledger entry amount must be numeric';
    end;

    if entry_amount <= 0 then
      raise exception 'each ledger entry amount must be greater than zero';
    end if;

    entry_type := coalesce(parsed_entry.value ->> 'entry_type', 'principal');

    if entry_type not in ('principal', 'fee', 'commission', 'tax', 'discount', 'adjustment') then
      raise exception 'each ledger entry type is not supported';
    end if;

    entry_metadata := coalesce(parsed_entry.value -> 'metadata', '{}'::jsonb);

    if jsonb_typeof(entry_metadata) <> 'object' then
      raise exception 'each ledger entry metadata must be a JSON object';
    end if;

    select wallet_record.id, wallet_record.currency_code, wallet_record.status
    into target_wallet
    from public.wallet_accounts wallet_record
    where wallet_record.id = entry_wallet_id;

    if not found then
      raise exception 'each ledger entry wallet_id must reference an existing wallet';
    end if;

    if target_wallet.status <> 'active' then
      raise exception 'each ledger entry wallet must be active';
    end if;

    if target_wallet.currency_code <> target_currency_code then
      raise exception 'each ledger entry wallet currency must match target_currency_code';
    end if;

    if entry_direction = 'debit' then
      debit_total := debit_total + entry_amount;
    else
      credit_total := credit_total + entry_amount;
    end if;

    insert into financial_posting_entries (
      wallet_id,
      direction,
      amount,
      entry_type,
      metadata,
      ordinal
    )
    values (
      entry_wallet_id,
      entry_direction,
      entry_amount,
      entry_type,
      entry_metadata,
      parsed_entry.ordinality
    );
  end loop;

  if debit_total <> credit_total then
    raise exception 'financial transaction ledger entries must balance';
  end if;

  insert into public.financial_transactions (
    transaction_type,
    status,
    currency_code,
    total_amount,
    idempotency_key,
    source,
    subject_type,
    subject_id,
    actor_user_id,
    provider_adapter_id,
    external_reference,
    policy_snapshot,
    metadata
  )
  values (
    target_transaction_type,
    'posted',
    target_currency_code,
    debit_total,
    target_idempotency_key,
    target_source,
    target_subject_type,
    target_subject_id,
    auth.uid(),
    target_provider_adapter_id,
    target_external_reference,
    target_policy_snapshot,
    target_metadata
  )
  on conflict (source, idempotency_key) do nothing
  returning id into transaction_id;

  if transaction_id is null then
    select existing_record.*
    into existing_transaction
    from public.financial_transactions existing_record
    where existing_record.source = target_source
      and existing_record.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'financial transaction idempotency lookup failed';
    end if;

    if existing_transaction.transaction_type <> target_transaction_type
      or existing_transaction.status <> 'posted'
      or existing_transaction.currency_code <> target_currency_code
      or existing_transaction.total_amount <> debit_total
      or existing_transaction.subject_type <> target_subject_type
      or existing_transaction.subject_id is distinct from target_subject_id
      or existing_transaction.provider_adapter_id is distinct from target_provider_adapter_id
      or existing_transaction.external_reference is distinct from target_external_reference
      or existing_transaction.policy_snapshot <> target_policy_snapshot
      or existing_transaction.metadata <> target_metadata then
      raise exception 'target_idempotency_key has already been used with different transaction details';
    end if;

    return existing_transaction.id;
  end if;

  insert into public.wallet_ledger_entries (
    wallet_id,
    transaction_id,
    direction,
    amount,
    currency_code,
    entry_type,
    idempotency_key,
    metadata
  )
  select
    posting_entry.wallet_id,
    transaction_id,
    posting_entry.direction,
    posting_entry.amount,
    target_currency_code,
    posting_entry.entry_type,
    target_idempotency_key || ':' || posting_entry.ordinal::text,
    posting_entry.metadata
  from financial_posting_entries posting_entry
  order by posting_entry.ordinal;

  return transaction_id;
end;
$$;

drop policy if exists financial_transactions_manage_privileged on public.financial_transactions;
drop policy if exists financial_transactions_no_direct_insert on public.financial_transactions;
drop policy if exists financial_transactions_no_direct_update on public.financial_transactions;
drop policy if exists wallet_ledger_entries_insert_privileged on public.wallet_ledger_entries;
drop policy if exists wallet_ledger_entries_no_direct_insert on public.wallet_ledger_entries;

create policy financial_transactions_no_direct_insert on public.financial_transactions
for insert to authenticated
with check (false);

create policy financial_transactions_no_direct_update on public.financial_transactions
for update to authenticated
using (false)
with check (false);

create policy wallet_ledger_entries_no_direct_insert on public.wallet_ledger_entries
for insert to authenticated
with check (false);

revoke all on function public.post_financial_transaction(
  text,
  text,
  text,
  text,
  uuid,
  jsonb,
  text,
  uuid,
  text,
  jsonb,
  jsonb
) from public;

revoke all on function public.post_financial_transaction(
  text,
  text,
  text,
  text,
  uuid,
  jsonb,
  text,
  uuid,
  text,
  jsonb,
  jsonb
) from anon;

grant execute on function public.post_financial_transaction(
  text,
  text,
  text,
  text,
  uuid,
  jsonb,
  text,
  uuid,
  text,
  jsonb,
  jsonb
) to authenticated;

grant execute on function public.post_financial_transaction(
  text,
  text,
  text,
  text,
  uuid,
  jsonb,
  text,
  uuid,
  text,
  jsonb,
  jsonb
) to service_role;

commit;
