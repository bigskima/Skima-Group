begin;

-- Verified Fuel delivery can open only the platform-purpose wallets required
-- by that exact settlement. This is intentionally narrower than platform
-- financial or revenue-management permission.
create or replace function public.can_create_fuel_verified_platform_purpose_wallet(
  target_wallet_type text,
  target_currency_code text,
  target_source text,
  target_idempotency_key text
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select target_wallet_type in ('platform_revenue','platform_liability')
     and target_source='fuel.settlement_engine'
     and pg_trigger_depth()>0
     and exists(
       select 1
       from public.order_records order_record
       join public.fuel_order_operations operation on operation.order_id=order_record.id
       where order_record.currency_code=target_currency_code
         and target_idempotency_key in (
           'fuel-settlement:'||order_record.id::text||':revenue-wallet',
           'fuel-settlement:'||order_record.id::text||':tax-liability-wallet'
         )
         and operation.stage_key='completed'
         and operation.delivery_verified_at is not null
         and operation.delivery_challenge_id is not null
         and operation.settlement_execution_id is null
         and public.fuel_delivery_challenge_is_verified(order_record.id,operation.delivery_challenge_id)
         and exists(
           select 1 from public.fuel_order_commercial_snapshots quote
           where quote.order_id=order_record.id
             and quote.status='accepted'
             and quote.currency_code=target_currency_code
         )
     );
$$;

do $patch$
declare
  function_sql text;
  old_guard text;
  new_guard text;
begin
  select pg_get_functiondef(
    'public.ensure_platform_purpose_wallet(text,text,text,text,text)'::regprocedure
  ) into function_sql;

  -- The live project and the clean-install baseline format this function
  -- differently. Support both without replacing the surrounding LPG and
  -- platform-admin authorization branches.
  old_guard:=$old$if not public.has_permission('platform.revenue.manage',null) then raise exception 'platform revenue management permission is required'; end if;$old$;
  new_guard:=$new$if not public.has_permission('platform.revenue.manage',null)
      and not public.can_create_fuel_verified_platform_purpose_wallet(
        target_wallet_type,target_currency_code,target_source,target_idempotency_key
      ) then raise exception 'platform revenue management permission is required'; end if;$new$;
  if position(old_guard in function_sql)>0 then
    function_sql:=replace(function_sql,old_guard,new_guard);
  else
    old_guard:=$old$      if not public.has_permission('platform.revenue.manage', null) then
        raise exception 'platform revenue management permission is required';
      end if;$old$;
    new_guard:=$new$      if not public.has_permission('platform.revenue.manage', null)
        and not public.can_create_fuel_verified_platform_purpose_wallet(
          target_wallet_type,target_currency_code,target_source,target_idempotency_key
        ) then
        raise exception 'platform revenue management permission is required';
      end if;$new$;
    if position(old_guard in function_sql)=0 then
      raise exception 'ensure_platform_purpose_wallet revenue authorization anchor changed; refusing an unsafe Fuel exception';
    end if;
    function_sql:=replace(function_sql,old_guard,new_guard);
  end if;

  old_guard:=$old$elsif not public.has_permission('platform.financial.manage',null) and not public.has_permission('platform.wallets.manage',null) then raise exception 'platform financial management permission is required';$old$;
  new_guard:=$new$elsif not public.has_permission('platform.financial.manage',null)
      and not public.has_permission('platform.wallets.manage',null)
      and not public.can_create_fuel_verified_platform_purpose_wallet(
        target_wallet_type,target_currency_code,target_source,target_idempotency_key
      ) then raise exception 'platform financial management permission is required';$new$;
  if position(old_guard in function_sql)>0 then
    function_sql:=replace(function_sql,old_guard,new_guard);
  else
    old_guard:=$old$    elsif not public.has_permission('platform.financial.manage', null)
      and not public.has_permission('platform.wallets.manage', null) then
      raise exception 'platform financial management permission is required';$old$;
    new_guard:=$new$    elsif not public.has_permission('platform.financial.manage', null)
      and not public.has_permission('platform.wallets.manage', null)
      and not public.can_create_fuel_verified_platform_purpose_wallet(
        target_wallet_type,target_currency_code,target_source,target_idempotency_key
      ) then
      raise exception 'platform financial management permission is required';$new$;
    if position(old_guard in function_sql)=0 then
      raise exception 'ensure_platform_purpose_wallet financial authorization anchor changed; refusing an unsafe Fuel exception';
    end if;
    function_sql:=replace(function_sql,old_guard,new_guard);
  end if;

  execute function_sql;
end;
$patch$;

-- The allocation status changes before its immutable custody event is inserted.
-- Remove the earlier pre-event trigger and rely on the AFTER INSERT custody
-- trigger added in the Fuel automatic progression migration.
drop trigger if exists fuel_auto_progress_after_driver_handover on public.fuel_container_allocations;

revoke all on function public.can_create_fuel_verified_platform_purpose_wallet(text,text,text,text) from public,anon,authenticated;
grant execute on function public.can_create_fuel_verified_platform_purpose_wallet(text,text,text,text) to service_role;

notify pgrst,'reload schema';
commit;
