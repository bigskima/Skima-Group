begin;

set local lock_timeout='10s';
set local statement_timeout='0';

-- Real-money utility purchases must never be auto-refunded just because the
-- provider is slow or an initial purchase call returned an ambiguous result.
-- Escalate unresolved payments to an explicit reconciliation state instead.
alter table public.utility_payment_requests
  drop constraint if exists utility_payment_requests_status_check;

alter table public.utility_payment_requests
  add constraint utility_payment_requests_status_check
  check (
    status in (
      'awaiting_payment',
      'payment_reserved',
      'processing',
      'reconciliation_required',
      'succeeded',
      'failed',
      'reversed'
    )
  );

create or replace function public.mark_stale_utility_reconciliations(
  target_max_attempts integer default 20
)
returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  affected integer:=0;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',
      message='utility reconciliation escalation is server-only';
  end if;

  if target_max_attempts is null or target_max_attempts<3 or target_max_attempts>100 then
    raise exception 'target_max_attempts must be between 3 and 100';
  end if;

  update public.utility_payment_requests request
  set
    status='reconciliation_required',
    next_reconcile_at=null,
    last_error_code=coalesce(request.last_error_code,'utility_reconciliation_required'),
    last_error_message=coalesce(
      request.last_error_message,
      'Provider outcome is still unresolved. Customer funds remain safely reserved while SKIMA performs an authoritative status check.'
    ),
    updated_at=timezone('utc',now())
  where request.status='processing'
    and request.reconciliation_attempts>=target_max_attempts
    and coalesce(request.next_reconcile_at,timezone('utc',now()))<=timezone('utc',now());

  get diagnostics affected=row_count;
  return affected;
end;
$$;

revoke all on function public.mark_stale_utility_reconciliations(integer)
from public,anon,authenticated;
grant execute on function public.mark_stale_utility_reconciliations(integer)
to service_role;

create or replace function public.claim_utility_payment_requests(
  target_limit integer default 25
)
returns table(
  request_id uuid,
  action text,
  provider_key text,
  provider_biller_code text,
  provider_product_code text,
  customer_identifier text,
  amount numeric,
  public_reference text,
  provider_reference text,
  fulfillment_attempts integer,
  reconciliation_attempts integer
)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',
      message='utility fulfillment claiming is server-only';
  end if;

  if target_limit is null or target_limit<1 or target_limit>100 then
    raise exception 'target_limit must be between 1 and 100';
  end if;

  perform public.mark_stale_utility_reconciliations(20);

  return query
  with candidates as (
    select request.id
    from public.utility_payment_requests request
    where
      request.status='payment_reserved'
      or (
        request.status='processing'
        and request.reconciliation_attempts<20
        and coalesce(request.next_reconcile_at,timezone('utc',now()))<=timezone('utc',now())
      )
    order by
      case when request.status='payment_reserved' then 0 else 1 end,
      request.created_at
    for update skip locked
    limit target_limit
  ),
  claimed as (
    update public.utility_payment_requests request
    set
      status='processing',
      processing_started_at=coalesce(request.processing_started_at,timezone('utc',now())),
      fulfillment_attempts=request.fulfillment_attempts
        + case when request.status='payment_reserved' then 1 else 0 end,
      reconciliation_attempts=request.reconciliation_attempts
        + case when request.status='processing' then 1 else 0 end,
      provider_attempted_at=case
        when request.status='payment_reserved' then timezone('utc',now())
        else request.provider_attempted_at
      end,
      next_reconcile_at=timezone('utc',now())+interval '2 minutes',
      updated_at=timezone('utc',now())
    from candidates
    where request.id=candidates.id
    returning request.*
  )
  select
    request.id,
    case
      when request.provider_reference is null
        and request.reconciliation_attempts=0 then 'purchase'
      else 'status'
    end,
    provider.key,
    coalesce(
      nullif(product.metadata->>'providerBillerCode',''),
      nullif(route.metadata->>'providerBillerCode','')
    ),
    route.provider_product_code,
    request.customer_identifier,
    request.subtotal_amount,
    request.public_reference,
    request.provider_reference,
    request.fulfillment_attempts,
    request.reconciliation_attempts
  from claimed request
  join public.utility_provider_routes route on route.id=request.provider_route_id
  join public.provider_adapters provider on provider.id=route.provider_adapter_id
  join public.utility_products product on product.id=request.product_id;
end;
$$;

revoke all on function public.claim_utility_payment_requests(integer)
from public,anon,authenticated;
grant execute on function public.claim_utility_payment_requests(integer)
to service_role;

create or replace function public.request_utility_reconciliation(
  target_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  request_record public.utility_payment_requests%rowtype;
begin
  if not(
    public.has_permission('platform.billing.manage',null)
    or public.is_platform_super_admin()
  ) then
    raise exception using errcode='42501',
      message='bill service management permission is required';
  end if;

  select * into request_record
  from public.utility_payment_requests
  where id=target_request_id
  for update;

  if not found then
    raise exception 'utility payment request was not found';
  end if;

  if request_record.status not in ('processing','reconciliation_required') then
    raise exception 'only unresolved utility payments can be reconciled';
  end if;

  if request_record.fulfillment_attempts<1 then
    raise exception 'utility purchase was never attempted; reconciliation cannot replace an initial purchase';
  end if;

  update public.utility_payment_requests
  set
    status='processing',
    next_reconcile_at=timezone('utc',now()),
    last_error_code=null,
    last_error_message=null,
    updated_at=timezone('utc',now())
  where id=target_request_id;

  insert into public.audit_logs(
    actor_user_id,action,entity_type,entity_id,after_state,metadata
  )
  values(
    auth.uid(),
    'utility.payment.reconciliation_requested',
    'utility_payment_request',
    target_request_id,
    jsonb_build_object(
      'status','processing',
      'publicReference',request_record.public_reference,
      'previousStatus',request_record.status
    ),
    jsonb_build_object('source','skima.admin.utility_billing')
  );

  return target_request_id;
end;
$$;

revoke all on function public.request_utility_reconciliation(uuid)
from public,anon;
grant execute on function public.request_utility_reconciliation(uuid)
to authenticated,service_role;

create or replace function public.resolve_utility_webhook_request(
  target_provider_key text,
  target_references text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  result jsonb;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',
      message='utility webhook resolution is server-only';
  end if;

  if target_references is null or cardinality(target_references)=0 then
    return null;
  end if;

  select jsonb_build_object(
    'requestId',request.id,
    'publicReference',request.public_reference,
    'providerReference',request.provider_reference,
    'status',request.status,
    'providerKey',provider.key
  )
  into result
  from public.utility_payment_requests request
  join public.utility_provider_routes route on route.id=request.provider_route_id
  join public.provider_adapters provider on provider.id=route.provider_adapter_id
  where provider.provider_kind='utility'
    and provider.key=target_provider_key
    and (
      request.public_reference=any(target_references)
      or request.provider_reference=any(target_references)
    )
  order by
    case when request.public_reference=any(target_references) then 0 else 1 end,
    request.created_at desc
  limit 1;

  return result;
end;
$$;

revoke all on function public.resolve_utility_webhook_request(text,text[])
from public,anon,authenticated;
grant execute on function public.resolve_utility_webhook_request(text,text[])
to service_role;

-- The database stores only the Edge-secret reference and public webhook path.
-- No webhook secret value is stored here.
update public.provider_adapters
set config=coalesce(config,'{}'::jsonb)||jsonb_build_object(
  'webhook',jsonb_build_object(
    'path','/functions/v1/utility-provider-webhook/flutterwave',
    'secretRef','SUPABASE_SECRET:FLUTTERWAVE_WEBHOOK_SECRET',
    'credentialSource','supabase_edge_function_secret',
    'authoritativeStatusVerification',true
  )
),
updated_at=timezone('utc',now())
where provider_kind='utility'
  and key='provider.utility.flutterwave';

notify pgrst,'reload schema';

commit;