begin;

-- A driver may provision only the driver's own approved driver wallet.
-- This is needed by the existing delivery-triggered commission release path:
-- execute_lpg_driver_commission runs as the assigned driver and calls
-- ensure_wallet_account when a driver wallet has not yet been provisioned.
-- It does not grant platform wallet administration or cross-driver access.
do $$
declare
  function_definition text;
  old_declaration constant text := $old$  can_create_self_wallet boolean;$old$;
  new_declaration constant text := $new$  can_create_self_wallet boolean;
  can_create_driver_wallet boolean;$new$;
  old_authorization constant text := $old$  can_create_self_wallet :=
    target_owner_entity_type = 'user'
    and target_owner_entity_id = auth.uid()
    and target_wallet_type in ('customer', 'refund', 'bonus', 'loyalty', 'generic');

  if auth.role() <> 'service_role'
    and not public.has_permission('platform.wallets.manage', null)
    and not can_create_self_wallet then$old$;
  new_authorization constant text := $new$  can_create_self_wallet :=
    target_owner_entity_type = 'user'
    and target_owner_entity_id = auth.uid()
    and target_wallet_type in ('customer', 'refund', 'bonus', 'loyalty', 'generic');

  can_create_driver_wallet :=
    target_wallet_type = 'driver'
    and target_owner_entity_type = 'driver'
    and exists (
      select 1
      from public.driver_profiles driver
      where driver.id = target_owner_entity_id
        and driver.user_id = auth.uid()
        and driver.verification_status = 'approved'
    );

  if auth.role() <> 'service_role'
    and not public.has_permission('platform.wallets.manage', null)
    and not can_create_self_wallet
    and not can_create_driver_wallet then$new$;
begin
  function_definition := pg_get_functiondef(
    'public.ensure_wallet_account(text,text,uuid,text,text,jsonb,text)'::regprocedure
  );

  if position(new_declaration in function_definition) > 0
     and position(new_authorization in function_definition) > 0 then
    return;
  end if;

  if position(old_declaration in function_definition) = 0
     or position(old_authorization in function_definition) = 0 then
    raise exception 'ensure_wallet_account no longer contains the expected self-wallet authorization guard';
  end if;

  function_definition := replace(function_definition, old_declaration, new_declaration);
  function_definition := replace(function_definition, old_authorization, new_authorization);
  execute function_definition;
end;
$$;

comment on function public.ensure_wallet_account(text, text, uuid, text, text, jsonb, text) is
  'Creates idempotent wallet accounts. Platform wallet management remains required except for narrowly scoped self-owned customer wallets and an approved driver creating only their own driver payout wallet.';

commit;
