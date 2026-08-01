begin;

insert into public.permissions (key, description, risk_level)
values
  ('platform.references.read', 'Read backend-owned public business references and namespace configuration.', 'high'),
  ('platform.references.manage', 'Configure backend-owned public reference namespaces and sequencing.', 'critical')
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    updated_at = timezone('utc', now());

create table if not exists public.reference_namespaces (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 120),
  description text,
  subject_type text not null check (subject_type ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  prefix text not null check (prefix ~ '^[A-Z0-9]{2,16}$'),
  separator text not null default '-' check (separator ~ '^[A-Z0-9_-]{0,4}$'),
  sequence_padding integer not null default 8 check (sequence_padding between 1 and 20),
  sequence_scope text not null default 'global' check (sequence_scope in ('global')),
  status text not null default 'active' check (status in ('draft', 'active', 'retired')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  source text not null default 'platform.reference_engine'
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.reference_sequences (
  id uuid primary key default gen_random_uuid(),
  namespace_id uuid not null references public.reference_namespaces(id) on delete restrict,
  scope_key text not null default 'global' check (scope_key ~ '^[a-zA-Z0-9_.:-]{2,120}$'),
  last_value bigint not null default 0 check (last_value >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (namespace_id, scope_key)
);

create table if not exists public.public_references (
  id uuid primary key default gen_random_uuid(),
  namespace_id uuid not null references public.reference_namespaces(id) on delete restrict,
  reference text not null unique check (reference ~ '^[A-Z0-9][A-Z0-9_-]{2,80}$'),
  subject_type text not null check (subject_type ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  subject_id uuid not null,
  status text not null default 'active' check (status in ('active', 'retired')),
  issued_by uuid references public.profiles(id) on delete set null default auth.uid(),
  issued_at timestamptz not null default timezone('utc', now()),
  source text not null check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (namespace_id, subject_type, subject_id),
  unique (namespace_id, source, idempotency_key)
);

create index if not exists reference_namespaces_subject_status_idx
on public.reference_namespaces (subject_type, status);

create index if not exists public_references_subject_idx
on public.public_references (subject_type, subject_id);

create index if not exists public_references_namespace_created_idx
on public.public_references (namespace_id, created_at desc);

alter table public.lpg_cylinders
add column if not exists public_reference text;

alter table public.lpg_refill_quotes
add column if not exists public_reference text;

alter table public.lpg_refill_orders
add column if not exists public_reference text;

alter table public.lpg_cylinder_scans
add column if not exists public_reference text;

alter table public.payment_deposit_requests
add column if not exists public_reference text;

alter table public.withdrawal_requests
add column if not exists public_reference text;

alter table public.commission_executions
add column if not exists public_reference text;

alter table public.settlement_statements
add column if not exists public_reference text;

create unique index if not exists lpg_cylinders_public_reference_unique
on public.lpg_cylinders (public_reference)
where public_reference is not null;

create unique index if not exists lpg_refill_quotes_public_reference_unique
on public.lpg_refill_quotes (public_reference)
where public_reference is not null;

create unique index if not exists lpg_refill_orders_public_reference_unique
on public.lpg_refill_orders (public_reference)
where public_reference is not null;

create unique index if not exists lpg_cylinder_scans_public_reference_unique
on public.lpg_cylinder_scans (public_reference)
where public_reference is not null;

create unique index if not exists payment_deposit_requests_public_reference_unique
on public.payment_deposit_requests (public_reference)
where public_reference is not null;

create unique index if not exists withdrawal_requests_public_reference_unique
on public.withdrawal_requests (public_reference)
where public_reference is not null;

create unique index if not exists commission_executions_public_reference_unique
on public.commission_executions (public_reference)
where public_reference is not null;

create unique index if not exists settlement_statements_public_reference_unique
on public.settlement_statements (public_reference)
where public_reference is not null;

do $$
declare
  target_table text;
  constraint_name text;
begin
  foreach target_table in array array[
    'lpg_cylinders',
    'lpg_refill_quotes',
    'lpg_refill_orders',
    'lpg_cylinder_scans',
    'payment_deposit_requests',
    'withdrawal_requests',
    'commission_executions',
    'settlement_statements'
  ]
  loop
    constraint_name := target_table || '_public_reference_format';

    if not exists (
      select 1
      from pg_constraint
      where conname = constraint_name
        and conrelid = format('public.%I', target_table)::regclass
    ) then
      execute format(
        'alter table public.%I add constraint %I check (public_reference is null or public_reference ~ ''^[A-Z0-9][A-Z0-9_-]{2,80}$'')',
        target_table,
        constraint_name
      );
    end if;
  end loop;
end $$;

create or replace function public.configure_reference_namespace(
  target_key text,
  target_display_name text,
  target_subject_type text,
  target_prefix text,
  target_description text default null,
  target_separator text default '-',
  target_sequence_padding integer default 8,
  target_status text default 'active',
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'platform.reference_engine'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_namespace record;
  namespace_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and not public.has_permission('platform.references.manage', null) then
    raise exception 'platform reference management permission is required';
  end if;

  if target_key is null or target_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_key must be a stable platform reference namespace key';
  end if;

  if target_subject_type is null or target_subject_type !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_subject_type must be a stable platform subject type';
  end if;

  if target_prefix is null or upper(btrim(target_prefix)) !~ '^[A-Z0-9]{2,16}$' then
    raise exception 'target_prefix must contain 2 to 16 uppercase alphanumeric characters';
  end if;

  if coalesce(target_separator, '-') !~ '^[A-Z0-9_-]{0,4}$' then
    raise exception 'target_separator contains unsupported characters';
  end if;

  if target_sequence_padding is null or target_sequence_padding not between 1 and 20 then
    raise exception 'target_sequence_padding must be between 1 and 20';
  end if;

  if target_status not in ('draft', 'active', 'retired') then
    raise exception 'target_status is not supported';
  end if;

  select namespace.*
  into existing_namespace
  from public.reference_namespaces namespace
  where namespace.key = target_key;

  if found
    and exists (
      select 1
      from public.public_references reference_record
      where reference_record.namespace_id = existing_namespace.id
    )
    and (
      existing_namespace.subject_type <> btrim(target_subject_type)
      or existing_namespace.prefix <> upper(btrim(target_prefix))
      or existing_namespace.separator <> coalesce(target_separator, '-')
      or existing_namespace.sequence_padding <> target_sequence_padding
    ) then
    raise exception 'issued reference namespaces cannot change subject type or formatting';
  end if;

  insert into public.reference_namespaces (
    key,
    display_name,
    description,
    subject_type,
    prefix,
    separator,
    sequence_padding,
    status,
    metadata,
    source
  )
  values (
    btrim(target_key),
    btrim(target_display_name),
    nullif(btrim(coalesce(target_description, '')), ''),
    btrim(target_subject_type),
    upper(btrim(target_prefix)),
    coalesce(target_separator, '-'),
    target_sequence_padding,
    target_status,
    coalesce(target_metadata, '{}'::jsonb),
    coalesce(nullif(btrim(target_source), ''), 'platform.reference_engine')
  )
  on conflict (key) do update
  set display_name = excluded.display_name,
      description = excluded.description,
      subject_type = excluded.subject_type,
      prefix = excluded.prefix,
      separator = excluded.separator,
      sequence_padding = excluded.sequence_padding,
      status = excluded.status,
      metadata = public.reference_namespaces.metadata || excluded.metadata,
      source = excluded.source,
      updated_at = timezone('utc', now())
  returning id into namespace_id;

  return namespace_id;
end;
$$;

create or replace function public.generate_public_reference(
  target_namespace_key text,
  target_subject_type text,
  target_subject_id uuid,
  target_source text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  namespace_record record;
  existing_record record;
  inserted_reference text;
  sequence_value bigint;
  reference_value text;
begin
  if coalesce(current_setting('skima.reference_generation', true), '') <> 'true'
    and coalesce(auth.role(), '') <> 'service_role'
    and not public.has_permission('platform.references.manage', null) then
    raise exception 'backend-owned reference generation is required';
  end if;

  if target_namespace_key is null or btrim(target_namespace_key) = '' then
    raise exception 'target_namespace_key is required';
  end if;

  if target_subject_type is null or btrim(target_subject_type) = '' then
    raise exception 'target_subject_type is required';
  end if;

  if target_subject_id is null then
    raise exception 'target_subject_id is required';
  end if;

  if target_source is null or btrim(target_source) = '' then
    raise exception 'target_source is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select namespace.*
  into namespace_record
  from public.reference_namespaces namespace
  where namespace.key = target_namespace_key
    and namespace.status = 'active'
  for update;

  if not found then
    raise exception 'active reference namespace is not configured: %', target_namespace_key;
  end if;

  if namespace_record.subject_type <> target_subject_type then
    raise exception 'target_subject_type does not match the configured reference namespace';
  end if;

  select reference_record.*
  into existing_record
  from public.public_references reference_record
  where reference_record.namespace_id = namespace_record.id
    and reference_record.source = target_source
    and reference_record.idempotency_key = target_idempotency_key;

  if found then
    if existing_record.subject_type <> target_subject_type
      or existing_record.subject_id <> target_subject_id then
      raise exception 'target_idempotency_key has already generated a different public reference';
    end if;

    return existing_record.reference;
  end if;

  select reference_record.*
  into existing_record
  from public.public_references reference_record
  where reference_record.namespace_id = namespace_record.id
    and reference_record.subject_type = target_subject_type
    and reference_record.subject_id = target_subject_id;

  if found then
    return existing_record.reference;
  end if;

  insert into public.reference_sequences (namespace_id, scope_key, last_value)
  values (namespace_record.id, 'global', 1)
  on conflict (namespace_id, scope_key) do update
  set last_value = public.reference_sequences.last_value + 1,
      updated_at = timezone('utc', now())
  returning last_value into sequence_value;

  reference_value := namespace_record.prefix
    || namespace_record.separator
    || lpad(sequence_value::text, namespace_record.sequence_padding, '0');

  insert into public.public_references (
    namespace_id,
    reference,
    subject_type,
    subject_id,
    source,
    idempotency_key,
    metadata
  )
  values (
    namespace_record.id,
    reference_value,
    target_subject_type,
    target_subject_id,
    btrim(target_source),
    btrim(target_idempotency_key),
    coalesce(target_metadata, '{}'::jsonb)
  )
  on conflict do nothing
  returning reference into inserted_reference;

  if inserted_reference is not null then
    return inserted_reference;
  end if;

  select reference_record.*
  into existing_record
  from public.public_references reference_record
  where reference_record.namespace_id = namespace_record.id
    and reference_record.subject_type = target_subject_type
    and reference_record.subject_id = target_subject_id;

  if found then
    return existing_record.reference;
  end if;

  select reference_record.*
  into existing_record
  from public.public_references reference_record
  where reference_record.namespace_id = namespace_record.id
    and reference_record.source = target_source
    and reference_record.idempotency_key = target_idempotency_key;

  if found then
    if existing_record.subject_type <> target_subject_type
      or existing_record.subject_id <> target_subject_id then
      raise exception 'target_idempotency_key has already generated a different public reference';
    end if;

    return existing_record.reference;
  end if;

  raise exception 'public reference could not be generated';
end;
$$;

create or replace function public.assign_public_reference_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  namespace_key text;
  reference_value text;
  subject_type text;
  target_idempotency_key text;
  target_source text;
begin
  namespace_key := nullif(TG_ARGV[0], '');
  subject_type := nullif(TG_ARGV[1], '');

  if namespace_key is null or subject_type is null then
    raise exception 'public reference trigger requires namespace key and subject type';
  end if;

  target_source := coalesce(
    nullif(to_jsonb(new) ->> 'source', ''),
    'platform.reference.' || TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME
  );
  target_idempotency_key := coalesce(
    nullif(to_jsonb(new) ->> 'idempotency_key', ''),
    new.id::text
  );

  perform set_config('skima.reference_generation', 'true', true);
  reference_value := public.generate_public_reference(
    namespace_key,
    subject_type,
    new.id,
    target_source,
    target_idempotency_key,
    jsonb_build_object(
      'assigned_by', 'trigger',
      'table_schema', TG_TABLE_SCHEMA,
      'table_name', TG_TABLE_NAME
    )
  );

  perform set_config('skima.reference_assignment', 'true', true);
  execute format('update %I.%I set public_reference = $1 where id = $2', TG_TABLE_SCHEMA, TG_TABLE_NAME)
  using reference_value, new.id;
  perform set_config('skima.reference_assignment', 'false', true);
  perform set_config('skima.reference_generation', 'false', true);

  return new;
end;
$$;

create or replace function public.validate_public_reference_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_public_reference text;
begin
  execute format('select public_reference from %I.%I where id = $1', TG_TABLE_SCHEMA, TG_TABLE_NAME)
  into current_public_reference
  using new.id;

  if current_public_reference is null or btrim(current_public_reference) = '' then
    raise exception 'backend-owned public reference assignment failed for %.% id %', TG_TABLE_SCHEMA, TG_TABLE_NAME, new.id;
  end if;

  return new;
end;
$$;

create or replace function public.prevent_subject_public_reference_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (to_jsonb(old) ->> 'public_reference') is distinct from (to_jsonb(new) ->> 'public_reference')
    and coalesce(current_setting('skima.reference_assignment', true), '') <> 'true' then
    raise exception 'public business references are backend-managed and immutable';
  end if;

  return new;
end;
$$;

create or replace function public.prevent_public_reference_record_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'public business reference records are append-only';
end;
$$;

create or replace function public.prevent_reference_sequence_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'public reference sequences cannot be deleted';
end;
$$;

insert into public.reference_namespaces (
  key,
  display_name,
  description,
  subject_type,
  prefix,
  separator,
  sequence_padding,
  status,
  metadata,
  source
)
values
  ('reference.lpg.cylinder', 'LPG cylinder references', 'Backend-owned public references for customer LPG cylinders.', 'lpg.cylinder', 'CYL', '-', 8, 'active', '{"module":"lpg","configurable":true}'::jsonb, 'platform.reference_seed'),
  ('reference.lpg.quote', 'LPG refill quote references', 'Backend-owned public references for LPG refill quotes.', 'lpg.quote', 'QTE', '-', 8, 'active', '{"module":"lpg","configurable":true}'::jsonb, 'platform.reference_seed'),
  ('reference.lpg.order', 'LPG refill order references', 'Backend-owned public references for LPG refill orders.', 'lpg.order', 'SKM', '-', 8, 'active', '{"module":"lpg","configurable":true}'::jsonb, 'platform.reference_seed'),
  ('reference.lpg.scan-session', 'LPG scan-session references', 'Backend-owned public references for LPG scan sessions.', 'lpg.scan-session', 'SCN', '-', 8, 'active', '{"module":"lpg","configurable":true}'::jsonb, 'platform.reference_seed'),
  ('reference.payment.deposit', 'Payment deposit references', 'Backend-owned public references for payment deposit requests.', 'payment.deposit', 'PAY', '-', 8, 'active', '{"engine":"payments","configurable":true}'::jsonb, 'platform.reference_seed'),
  ('reference.withdrawal.request', 'Withdrawal request references', 'Backend-owned public references for wallet withdrawal requests.', 'withdrawal.request', 'WDL', '-', 8, 'active', '{"engine":"withdrawals","configurable":true}'::jsonb, 'platform.reference_seed'),
  ('reference.commission.execution', 'Commission execution references', 'Backend-owned public references for commission executions.', 'commission.execution', 'COM', '-', 8, 'active', '{"engine":"commissions","configurable":true}'::jsonb, 'platform.reference_seed'),
  ('reference.settlement.statement', 'Settlement statement references', 'Backend-owned public references for settlement statements.', 'settlement.statement', 'STL', '-', 8, 'active', '{"engine":"settlements","configurable":true}'::jsonb, 'platform.reference_seed')
on conflict (key) do update
set display_name = excluded.display_name,
    description = excluded.description,
    subject_type = excluded.subject_type,
    prefix = excluded.prefix,
    separator = excluded.separator,
    sequence_padding = excluded.sequence_padding,
    status = excluded.status,
    metadata = public.reference_namespaces.metadata || excluded.metadata,
    source = excluded.source,
    updated_at = timezone('utc', now());

do $$
declare
  assigned_reference text;
  binding record;
  target_record record;
begin
  perform set_config('skima.reference_generation', 'true', true);
  perform set_config('skima.reference_assignment', 'true', true);

  for binding in
    select *
    from (values
      ('lpg_cylinders', 'reference.lpg.cylinder', 'lpg.cylinder'),
      ('lpg_refill_quotes', 'reference.lpg.quote', 'lpg.quote'),
      ('lpg_refill_orders', 'reference.lpg.order', 'lpg.order'),
      ('lpg_cylinder_scans', 'reference.lpg.scan-session', 'lpg.scan-session'),
      ('payment_deposit_requests', 'reference.payment.deposit', 'payment.deposit'),
      ('withdrawal_requests', 'reference.withdrawal.request', 'withdrawal.request'),
      ('commission_executions', 'reference.commission.execution', 'commission.execution'),
      ('settlement_statements', 'reference.settlement.statement', 'settlement.statement')
    ) as reference_binding(table_name, namespace_key, subject_type)
  loop
    for target_record in execute format(
      'select id, source, idempotency_key from public.%I where public_reference is null order by created_at asc, id asc',
      binding.table_name
    )
    loop
      assigned_reference := public.generate_public_reference(
        binding.namespace_key,
        binding.subject_type,
        target_record.id,
        target_record.source,
        target_record.idempotency_key,
        jsonb_build_object(
          'assigned_by', 'migration_backfill',
          'table_schema', 'public',
          'table_name', binding.table_name
        )
      );

      execute format('update public.%I set public_reference = $1 where id = $2', binding.table_name)
      using assigned_reference, target_record.id;
    end loop;
  end loop;

  perform set_config('skima.reference_assignment', 'false', true);
  perform set_config('skima.reference_generation', 'false', true);
end $$;

drop trigger if exists set_reference_namespaces_updated_at on public.reference_namespaces;
create trigger set_reference_namespaces_updated_at
before update on public.reference_namespaces
for each row execute function public.set_updated_at();

drop trigger if exists set_reference_sequences_updated_at on public.reference_sequences;
create trigger set_reference_sequences_updated_at
before update on public.reference_sequences
for each row execute function public.set_updated_at();

drop trigger if exists prevent_public_reference_record_update on public.public_references;
create trigger prevent_public_reference_record_update
before update on public.public_references
for each row execute function public.prevent_public_reference_record_mutation();

drop trigger if exists prevent_public_reference_record_delete on public.public_references;
create trigger prevent_public_reference_record_delete
before delete on public.public_references
for each row execute function public.prevent_public_reference_record_mutation();

drop trigger if exists prevent_reference_sequence_delete on public.reference_sequences;
create trigger prevent_reference_sequence_delete
before delete on public.reference_sequences
for each row execute function public.prevent_reference_sequence_delete();

do $$
declare
  binding record;
begin
  for binding in
    select *
    from (values
      ('lpg_cylinders', 'reference.lpg.cylinder', 'lpg.cylinder'),
      ('lpg_refill_quotes', 'reference.lpg.quote', 'lpg.quote'),
      ('lpg_refill_orders', 'reference.lpg.order', 'lpg.order'),
      ('lpg_cylinder_scans', 'reference.lpg.scan-session', 'lpg.scan-session'),
      ('payment_deposit_requests', 'reference.payment.deposit', 'payment.deposit'),
      ('withdrawal_requests', 'reference.withdrawal.request', 'withdrawal.request'),
      ('commission_executions', 'reference.commission.execution', 'commission.execution'),
      ('settlement_statements', 'reference.settlement.statement', 'settlement.statement')
    ) as reference_binding(table_name, namespace_key, subject_type)
  loop
    execute format('drop trigger if exists assign_public_reference_on_insert on public.%I', binding.table_name);
    execute format(
      'create trigger assign_public_reference_on_insert after insert on public.%I for each row execute function public.assign_public_reference_after_insert(%L, %L)',
      binding.table_name,
      binding.namespace_key,
      binding.subject_type
    );

    execute format('drop trigger if exists validate_public_reference_on_insert on public.%I', binding.table_name);
    execute format(
      'create trigger validate_public_reference_on_insert after insert on public.%I for each row execute function public.validate_public_reference_after_insert()',
      binding.table_name
    );

    execute format('drop trigger if exists prevent_public_reference_update on public.%I', binding.table_name);
    execute format(
      'create trigger prevent_public_reference_update before update on public.%I for each row execute function public.prevent_subject_public_reference_update()',
      binding.table_name
    );
  end loop;
end $$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'reference_namespaces',
    'public_references'
  ] loop
    execute format('drop trigger if exists audit_%I_mutations on public.%I', target_table, target_table);
    execute format(
      'create trigger audit_%I_mutations after insert or update or delete on public.%I for each row execute function public.record_table_audit()',
      target_table,
      target_table
    );
  end loop;
end $$;

alter table public.reference_namespaces enable row level security;
alter table public.reference_sequences enable row level security;
alter table public.public_references enable row level security;

drop policy if exists reference_namespaces_select_active_or_privileged on public.reference_namespaces;
drop policy if exists reference_namespaces_no_direct_insert on public.reference_namespaces;
drop policy if exists reference_namespaces_no_direct_update on public.reference_namespaces;
drop policy if exists reference_namespaces_no_direct_delete on public.reference_namespaces;
drop policy if exists reference_sequences_select_privileged on public.reference_sequences;
drop policy if exists reference_sequences_no_direct_insert on public.reference_sequences;
drop policy if exists reference_sequences_no_direct_update on public.reference_sequences;
drop policy if exists reference_sequences_no_direct_delete on public.reference_sequences;
drop policy if exists public_references_select_privileged on public.public_references;
drop policy if exists public_references_no_direct_insert on public.public_references;
drop policy if exists public_references_no_direct_update on public.public_references;
drop policy if exists public_references_no_direct_delete on public.public_references;

create policy reference_namespaces_select_active_or_privileged on public.reference_namespaces
for select to authenticated
using (
  status = 'active'
  or public.has_permission('platform.references.read', null)
  or public.has_permission('platform.references.manage', null)
  or public.can_read_platform_runtime()
);

create policy reference_namespaces_no_direct_insert on public.reference_namespaces
for insert to authenticated with check (false);

create policy reference_namespaces_no_direct_update on public.reference_namespaces
for update to authenticated using (false) with check (false);

create policy reference_namespaces_no_direct_delete on public.reference_namespaces
for delete to authenticated using (false);

create policy reference_sequences_select_privileged on public.reference_sequences
for select to authenticated
using (
  public.has_permission('platform.references.read', null)
  or public.has_permission('platform.references.manage', null)
  or public.can_read_platform_runtime()
);

create policy reference_sequences_no_direct_insert on public.reference_sequences
for insert to authenticated with check (false);

create policy reference_sequences_no_direct_update on public.reference_sequences
for update to authenticated using (false) with check (false);

create policy reference_sequences_no_direct_delete on public.reference_sequences
for delete to authenticated using (false);

create policy public_references_select_privileged on public.public_references
for select to authenticated
using (
  public.has_permission('platform.references.read', null)
  or public.has_permission('platform.references.manage', null)
  or public.can_read_platform_runtime()
);

create policy public_references_no_direct_insert on public.public_references
for insert to authenticated with check (false);

create policy public_references_no_direct_update on public.public_references
for update to authenticated using (false) with check (false);

create policy public_references_no_direct_delete on public.public_references
for delete to authenticated using (false);

grant select, insert, update, delete on
  public.reference_namespaces,
  public.reference_sequences,
  public.public_references
to authenticated, service_role;

revoke all on function public.configure_reference_namespace(text, text, text, text, text, text, integer, text, jsonb, text) from public;
revoke all on function public.generate_public_reference(text, text, uuid, text, text, jsonb) from public;
revoke all on function public.assign_public_reference_after_insert() from public;
revoke all on function public.validate_public_reference_after_insert() from public;
revoke all on function public.prevent_subject_public_reference_update() from public;
revoke all on function public.prevent_public_reference_record_mutation() from public;
revoke all on function public.prevent_reference_sequence_delete() from public;

grant execute on function public.configure_reference_namespace(text, text, text, text, text, text, integer, text, jsonb, text) to authenticated, service_role;
grant execute on function public.generate_public_reference(text, text, uuid, text, text, jsonb) to service_role;
grant execute on function public.assign_public_reference_after_insert() to service_role;
grant execute on function public.validate_public_reference_after_insert() to service_role;
grant execute on function public.prevent_subject_public_reference_update() to service_role;
grant execute on function public.prevent_public_reference_record_mutation() to service_role;
grant execute on function public.prevent_reference_sequence_delete() to service_role;

commit;
