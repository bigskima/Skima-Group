begin;

-- Deterministic finance reconciliation intelligence for SKIMA.
-- Advisory/read-only only: this runtime never posts ledger entries, changes wallet balances,
-- releases escrow, reverses transactions, pays settlements, or mutates financial policy.

create table if not exists public.ai_finance_reconciliation_rules (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  status text not null default 'active'
    check (status in ('draft','active','paused','retired')),
  config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ai_finance_reconciliation_findings (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.ai_finance_reconciliation_rules(id) on delete restrict,
  finding_key text not null unique,
  finding_type text not null
    check (finding_type in (
      'service_request_unbalanced',
      'settlement_missing_transaction',
      'deposit_missing_transaction'
    )),
  subject_type text not null
    check (subject_type in ('service_request','settlement_execution','payment_deposit')),
  subject_id uuid not null,
  currency_code text references public.currency_definitions(code) on delete restrict,
  severity text not null
    check (severity in ('info','warning','high','critical')),
  status text not null default 'open'
    check (status in ('open','resolved')),
  expected_amount numeric(28,8),
  observed_amount numeric(28,8),
  variance_amount numeric(28,8),
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  recommended_action text,
  generated_at timestamptz not null default timezone('utc', now()),
  last_detected_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_finance_reconciliation_findings_status_idx
on public.ai_finance_reconciliation_findings (status, severity, last_detected_at desc);

create index if not exists ai_finance_reconciliation_findings_subject_idx
on public.ai_finance_reconciliation_findings (subject_type, subject_id, status);

alter table public.ai_finance_reconciliation_rules enable row level security;
alter table public.ai_finance_reconciliation_findings enable row level security;

drop policy if exists ai_finance_rules_read_privileged on public.ai_finance_reconciliation_rules;
create policy ai_finance_rules_read_privileged
on public.ai_finance_reconciliation_rules
for select to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
  or public.has_permission('platform.financial.read', null)
  or public.has_permission('platform.financial.manage', null)
);

drop policy if exists ai_finance_rules_manage_privileged on public.ai_finance_reconciliation_rules;
create policy ai_finance_rules_manage_privileged
on public.ai_finance_reconciliation_rules
for all to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.manage', null)
)
with check (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.manage', null)
);

drop policy if exists ai_finance_findings_read_privileged on public.ai_finance_reconciliation_findings;
create policy ai_finance_findings_read_privileged
on public.ai_finance_reconciliation_findings
for select to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
  or public.has_permission('platform.financial.read', null)
  or public.has_permission('platform.financial.manage', null)
);

drop policy if exists ai_finance_findings_no_direct_insert on public.ai_finance_reconciliation_findings;
create policy ai_finance_findings_no_direct_insert
on public.ai_finance_reconciliation_findings
for insert to authenticated
with check (false);

drop policy if exists ai_finance_findings_no_direct_update on public.ai_finance_reconciliation_findings;
create policy ai_finance_findings_no_direct_update
on public.ai_finance_reconciliation_findings
for update to authenticated
using (false)
with check (false);

drop policy if exists ai_finance_findings_no_direct_delete on public.ai_finance_reconciliation_findings;
create policy ai_finance_findings_no_direct_delete
on public.ai_finance_reconciliation_findings
for delete to authenticated
using (false);

grant select on public.ai_finance_reconciliation_rules to authenticated;
grant select on public.ai_finance_reconciliation_findings to authenticated;
grant all on public.ai_finance_reconciliation_rules, public.ai_finance_reconciliation_findings to service_role;

insert into public.ai_finance_reconciliation_rules (
  key, display_name, status, config
)
values (
  'ai.finance.reconciliation.health',
  'Finance reconciliation health',
  'active',
  '{
    "lookback_days": 30,
    "minimum_variance": 0.01,
    "terminal_service_statuses": ["completed","settled","cancelled","failed","refunded"],
    "control": "advisory_only"
  }'::jsonb
)
on conflict (key) do update
set display_name = excluded.display_name,
    config = public.ai_finance_reconciliation_rules.config || excluded.config,
    updated_at = timezone('utc', now());

create or replace function public.validate_ai_finance_reconciliation_rule_config()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  lookback_days integer;
  minimum_variance numeric;
begin
  if jsonb_typeof(new.config) <> 'object' then
    raise exception 'finance reconciliation configuration must be an object';
  end if;

  if coalesce(new.config ->> 'control', '') <> 'advisory_only' then
    raise exception 'finance reconciliation intelligence must remain advisory_only';
  end if;

  if coalesce(new.config ->> 'lookback_days', '') !~ '^[0-9]+$' then
    raise exception 'finance reconciliation lookback_days must be a whole number';
  end if;

  lookback_days := (new.config ->> 'lookback_days')::integer;
  if lookback_days not between 1 and 365 then
    raise exception 'finance reconciliation lookback_days must be between 1 and 365';
  end if;

  if coalesce(new.config ->> 'minimum_variance', '') !~ '^[0-9]+([.][0-9]+)?$' then
    raise exception 'finance reconciliation minimum_variance must be non-negative numeric text';
  end if;

  minimum_variance := (new.config ->> 'minimum_variance')::numeric;
  if minimum_variance < 0 then
    raise exception 'finance reconciliation minimum_variance cannot be negative';
  end if;

  if jsonb_typeof(new.config -> 'terminal_service_statuses') <> 'array'
    or jsonb_array_length(new.config -> 'terminal_service_statuses') = 0 then
    raise exception 'finance reconciliation terminal_service_statuses must be a non-empty array';
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(new.config -> 'terminal_service_statuses') value
    where value not in ('completed','settled','cancelled','failed','refunded')
  ) then
    raise exception 'finance reconciliation terminal_service_statuses contains an unsupported state';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_ai_finance_reconciliation_rule_config
on public.ai_finance_reconciliation_rules;

create trigger validate_ai_finance_reconciliation_rule_config
before insert or update of config
on public.ai_finance_reconciliation_rules
for each row
execute function public.validate_ai_finance_reconciliation_rule_config();

update public.ai_finance_reconciliation_rules
set config = config,
    updated_at = updated_at
where key = 'ai.finance.reconciliation.health';

create or replace function public.refresh_ai_finance_reconciliation_findings()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rule_record public.ai_finance_reconciliation_rules%rowtype;
  detected_keys text[] := array[]::text[];
  now_at timestamptz := timezone('utc', now());
  lookback_days integer;
  minimum_variance numeric;
  finding_record record;
  finding_key_value text;
  finding_severity text;
  refreshed_count integer := 0;
  resolved_count integer := 0;
begin
  select * into rule_record
  from public.ai_finance_reconciliation_rules
  where key = 'ai.finance.reconciliation.health'
    and status = 'active';

  if rule_record.id is null then
    return jsonb_build_object(
      'status', 'skipped',
      'reason', 'finance_reconciliation_rule_inactive',
      'refreshedCount', 0,
      'resolvedCount', 0,
      'refreshedAt', now_at,
      'control', 'advisory_only'
    );
  end if;

  lookback_days := greatest(
    1,
    least(365, (rule_record.config ->> 'lookback_days')::integer)
  );
  minimum_variance := greatest(
    0::numeric,
    (rule_record.config ->> 'minimum_variance')::numeric
  );

  for finding_record in
    with request_scope as (
      select request.id, request.status, request.updated_at
      from public.service_requests request
      where request.updated_at >= now_at - make_interval(days => lookback_days)
        and exists (
          select 1
          from jsonb_array_elements_text(rule_record.config -> 'terminal_service_statuses') allowed(status)
          where allowed.status = request.status
        )
    ),
    reconciled as (
      select
        request.id as service_request_id,
        request.status as service_status,
        coalesce((
          select max(quote.total_amount)
          from public.price_quotes quote
          where quote.service_request_id = request.id
            and quote.status = 'accepted'
        ), 0)::numeric(28,8) as quote_total,
        coalesce((
          select max(order_record.total_amount)
          from public.order_records order_record
          where order_record.service_request_id = request.id
        ), 0)::numeric(28,8) as order_total,
        coalesce((
          select sum(transaction.total_amount)
          from public.financial_transactions transaction
          where transaction.subject_type = 'service_request'
            and transaction.subject_id = request.id
            and transaction.transaction_type = 'hold'
            and transaction.status = 'posted'
        ), 0)::numeric(28,8) as hold_total,
        coalesce((
          select sum(transaction.total_amount)
          from public.financial_transactions transaction
          where transaction.subject_type = 'service_request'
            and transaction.subject_id = request.id
            and transaction.transaction_type = 'release'
            and transaction.status = 'posted'
        ), 0)::numeric(28,8) as release_total,
        coalesce((
          select sum(transaction.total_amount)
          from public.financial_transactions transaction
          where transaction.subject_type = 'service_request'
            and transaction.subject_id = request.id
            and transaction.transaction_type = 'refund'
            and transaction.status = 'posted'
        ), 0)::numeric(28,8) as refund_total,
        request.updated_at
      from request_scope request
    )
    select
      reconciliation.service_request_id,
      reconciliation.service_status,
      reconciliation.quote_total,
      reconciliation.order_total,
      greatest(reconciliation.quote_total, reconciliation.order_total)::numeric(28,8) as expected_total,
      reconciliation.hold_total,
      reconciliation.release_total,
      reconciliation.refund_total,
      greatest(
        abs(reconciliation.hold_total - greatest(reconciliation.quote_total, reconciliation.order_total)),
        abs(reconciliation.hold_total - (reconciliation.release_total + reconciliation.refund_total))
      )::numeric(28,8) as variance_amount,
      reconciliation.updated_at
    from reconciled reconciliation
    where greatest(reconciliation.quote_total, reconciliation.order_total) > 0
      and not (
        reconciliation.hold_total = greatest(reconciliation.quote_total, reconciliation.order_total)
        and reconciliation.hold_total = reconciliation.release_total + reconciliation.refund_total
      )
    order by variance_amount desc, reconciliation.updated_at desc
    limit 250
  loop
    if finding_record.variance_amount < minimum_variance then
      continue;
    end if;

    finding_key_value :=
      'ai.finance.service_request.unbalanced:' || finding_record.service_request_id::text;
    detected_keys := array_append(detected_keys, finding_key_value);
    finding_severity := case
      when finding_record.service_status in ('completed','settled')
        and finding_record.variance_amount >= greatest(finding_record.expected_total * 0.25, 1000::numeric)
        then 'critical'
      when finding_record.service_status in ('completed','settled') then 'high'
      else 'warning'
    end;

    insert into public.ai_finance_reconciliation_findings (
      rule_id, finding_key, finding_type, subject_type, subject_id, currency_code,
      severity, status, expected_amount, observed_amount, variance_amount, evidence,
      recommended_action, generated_at, last_detected_at, resolved_at, version
    )
    values (
      rule_record.id,
      finding_key_value,
      'service_request_unbalanced',
      'service_request',
      finding_record.service_request_id,
      null,
      finding_severity,
      'open',
      finding_record.expected_total,
      finding_record.release_total + finding_record.refund_total,
      finding_record.variance_amount,
      jsonb_build_object(
        'advisoryOnly', true,
        'serviceStatus', finding_record.service_status,
        'quoteTotal', finding_record.quote_total,
        'orderTotal', finding_record.order_total,
        'expectedTotal', finding_record.expected_total,
        'holdTotal', finding_record.hold_total,
        'releaseTotal', finding_record.release_total,
        'refundTotal', finding_record.refund_total,
        'authoritativeCheck', 'reconcile_service_request_financials',
        'doesNotPostLedger', true,
        'doesNotMoveFunds', true
      ),
      'Run the existing service-request reconciliation view and review the underlying quote, hold, release and refund records before making any financial correction.',
      now_at,
      now_at,
      null,
      1
    )
    on conflict (finding_key) do update
    set severity = excluded.severity,
        status = 'open',
        expected_amount = excluded.expected_amount,
        observed_amount = excluded.observed_amount,
        variance_amount = excluded.variance_amount,
        evidence = excluded.evidence,
        recommended_action = excluded.recommended_action,
        generated_at = excluded.generated_at,
        last_detected_at = excluded.last_detected_at,
        resolved_at = null,
        version = public.ai_finance_reconciliation_findings.version + 1,
        updated_at = timezone('utc', now());

    refreshed_count := refreshed_count + 1;
  end loop;

  for finding_record in
    select
      settlement.id,
      settlement.service_request_id,
      settlement.currency_code,
      settlement.gross_amount,
      settlement.created_at
    from public.settlement_executions settlement
    where settlement.status = 'posted'
      and settlement.transaction_id is null
      and settlement.created_at >= now_at - make_interval(days => lookback_days)
    order by settlement.created_at desc
    limit 250
  loop
    finding_key_value :=
      'ai.finance.settlement.missing_transaction:' || finding_record.id::text;
    detected_keys := array_append(detected_keys, finding_key_value);

    insert into public.ai_finance_reconciliation_findings (
      rule_id, finding_key, finding_type, subject_type, subject_id, currency_code,
      severity, status, expected_amount, observed_amount, variance_amount, evidence,
      recommended_action, generated_at, last_detected_at, resolved_at, version
    )
    values (
      rule_record.id,
      finding_key_value,
      'settlement_missing_transaction',
      'settlement_execution',
      finding_record.id,
      finding_record.currency_code,
      'high',
      'open',
      finding_record.gross_amount,
      null,
      finding_record.gross_amount,
      jsonb_build_object(
        'advisoryOnly', true,
        'serviceRequestId', finding_record.service_request_id,
        'settlementGrossAmount', finding_record.gross_amount,
        'postedWithoutTransactionId', true,
        'doesNotPostLedger', true,
        'doesNotMoveFunds', true
      ),
      'Review this posted settlement against its escrow and ledger transaction. Do not create an adjustment until the authoritative settlement and ledger records have been investigated.',
      now_at,
      now_at,
      null,
      1
    )
    on conflict (finding_key) do update
    set severity = excluded.severity,
        status = 'open',
        expected_amount = excluded.expected_amount,
        observed_amount = excluded.observed_amount,
        variance_amount = excluded.variance_amount,
        evidence = excluded.evidence,
        recommended_action = excluded.recommended_action,
        generated_at = excluded.generated_at,
        last_detected_at = excluded.last_detected_at,
        resolved_at = null,
        version = public.ai_finance_reconciliation_findings.version + 1,
        updated_at = timezone('utc', now());

    refreshed_count := refreshed_count + 1;
  end loop;

  for finding_record in
    select
      deposit.id,
      deposit.currency_code,
      deposit.amount,
      deposit.provider_reference,
      deposit.created_at
    from public.payment_deposit_requests deposit
    where deposit.status = 'succeeded'
      and deposit.transaction_id is null
      and deposit.created_at >= now_at - make_interval(days => lookback_days)
    order by deposit.created_at desc
    limit 250
  loop
    finding_key_value :=
      'ai.finance.deposit.missing_transaction:' || finding_record.id::text;
    detected_keys := array_append(detected_keys, finding_key_value);

    insert into public.ai_finance_reconciliation_findings (
      rule_id, finding_key, finding_type, subject_type, subject_id, currency_code,
      severity, status, expected_amount, observed_amount, variance_amount, evidence,
      recommended_action, generated_at, last_detected_at, resolved_at, version
    )
    values (
      rule_record.id,
      finding_key_value,
      'deposit_missing_transaction',
      'payment_deposit',
      finding_record.id,
      finding_record.currency_code,
      'high',
      'open',
      finding_record.amount,
      null,
      finding_record.amount,
      jsonb_build_object(
        'advisoryOnly', true,
        'providerReference', finding_record.provider_reference,
        'depositSucceededWithoutTransactionId', true,
        'doesNotPostLedger', true,
        'doesNotMoveFunds', true
      ),
      'Review the payment provider receipt and deposit event trail against the ledger before any manual correction is considered.',
      now_at,
      now_at,
      null,
      1
    )
    on conflict (finding_key) do update
    set severity = excluded.severity,
        status = 'open',
        expected_amount = excluded.expected_amount,
        observed_amount = excluded.observed_amount,
        variance_amount = excluded.variance_amount,
        evidence = excluded.evidence,
        recommended_action = excluded.recommended_action,
        generated_at = excluded.generated_at,
        last_detected_at = excluded.last_detected_at,
        resolved_at = null,
        version = public.ai_finance_reconciliation_findings.version + 1,
        updated_at = timezone('utc', now());

    refreshed_count := refreshed_count + 1;
  end loop;

  with resolved as (
    update public.ai_finance_reconciliation_findings finding
    set status = 'resolved',
        resolved_at = now_at,
        updated_at = now_at
    where finding.status = 'open'
      and finding.rule_id = rule_record.id
      and finding.finding_key <> all(coalesce(detected_keys, array[]::text[]))
    returning finding.id
  )
  select count(*) into resolved_count from resolved;

  return jsonb_build_object(
    'status', 'completed',
    'refreshedCount', refreshed_count,
    'resolvedCount', resolved_count,
    'refreshedAt', now_at,
    'control', 'advisory_only'
  );
end;
$$;

revoke all on function public.refresh_ai_finance_reconciliation_findings()
from public, anon, authenticated;
grant execute on function public.refresh_ai_finance_reconciliation_findings()
to service_role;

create or replace function public.read_ai_finance_reconciliation_findings(
  target_minimum_severity text default 'warning',
  target_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  minimum_rank integer;
  result jsonb;
begin
  if not (
    auth.role() = 'service_role'
    or public.is_platform_super_admin()
    or public.has_permission('platform.ai.read', null)
    or public.has_permission('platform.ai.manage', null)
    or public.has_permission('platform.financial.read', null)
    or public.has_permission('platform.financial.manage', null)
  ) then
    raise exception using errcode = '42501', message = 'finance reconciliation intelligence read permission is required';
  end if;

  minimum_rank := case target_minimum_severity
    when 'info' then 1
    when 'warning' then 2
    when 'high' then 3
    when 'critical' then 4
    else -1
  end;

  if minimum_rank < 0 then
    raise exception using errcode = '22023', message = 'unsupported minimum finance finding severity';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', finding.id,
        'findingKey', finding.finding_key,
        'findingType', finding.finding_type,
        'subjectType', finding.subject_type,
        'subjectId', finding.subject_id,
        'currencyCode', finding.currency_code,
        'severity', finding.severity,
        'status', finding.status,
        'expectedAmount', finding.expected_amount,
        'observedAmount', finding.observed_amount,
        'varianceAmount', finding.variance_amount,
        'evidence', finding.evidence,
        'recommendedAction', finding.recommended_action,
        'generatedAt', finding.generated_at,
        'lastDetectedAt', finding.last_detected_at,
        'version', finding.version
      )
      order by
        case finding.severity
          when 'critical' then 4
          when 'high' then 3
          when 'warning' then 2
          else 1
        end desc,
        finding.last_detected_at desc
    ),
    '[]'::jsonb
  )
  into result
  from (
    select finding.*
    from public.ai_finance_reconciliation_findings finding
    where finding.status = 'open'
      and (
        case finding.severity
          when 'critical' then 4
          when 'high' then 3
          when 'warning' then 2
          else 1
        end
      ) >= minimum_rank
    order by
      case finding.severity
        when 'critical' then 4
        when 'high' then 3
        when 'warning' then 2
        else 1
      end desc,
      finding.last_detected_at desc
    limit least(greatest(coalesce(target_limit, 100), 1), 500)
  ) finding;

  return result;
end;
$$;

revoke all on function public.read_ai_finance_reconciliation_findings(text,integer)
from public, anon;
grant execute on function public.read_ai_finance_reconciliation_findings(text,integer)
to authenticated, service_role;

commit;
