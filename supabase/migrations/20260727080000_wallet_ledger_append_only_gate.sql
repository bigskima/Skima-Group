begin;

create or replace function public.verify_wallet_ledger_append_only()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  source_wallet_id uuid;
  target_wallet_id uuid;
  verification_transaction_id uuid;
  verification_ledger_entry_id uuid;
  update_blocked boolean := false;
  delete_blocked boolean := false;
begin
  if auth.role() <> 'service_role' then
    raise exception 'wallet ledger verification is service-role-only';
  end if;

  select wallet.id
  into source_wallet_id
  from public.wallet_accounts wallet
  where wallet.wallet_type = 'platform'
    and wallet.owner_entity_type = 'platform'
    and wallet.currency_code = 'NGN'
    and wallet.status = 'active'
  limit 1;

  select wallet.id
  into target_wallet_id
  from public.wallet_accounts wallet
  where wallet.wallet_type = 'escrow'
    and wallet.owner_entity_type = 'platform'
    and wallet.currency_code = 'NGN'
    and wallet.status = 'active'
  limit 1;

  if source_wallet_id is null or target_wallet_id is null then
    raise exception 'real platform and escrow NGN wallets are required before ledger verification';
  end if;

  begin
    verification_transaction_id := public.post_financial_transaction(
      'transfer',
      'NGN',
      'platform.wallet_ledger_verification',
      'platform.wallet',
      source_wallet_id,
      jsonb_build_array(
        jsonb_build_object(
          'wallet_id',
          source_wallet_id,
          'direction',
          'debit',
          'amount',
          '0.01',
          'entry_type',
          'adjustment',
          'metadata',
          jsonb_build_object('verification_scope', 'append_only')
        ),
        jsonb_build_object(
          'wallet_id',
          target_wallet_id,
          'direction',
          'credit',
          'amount',
          '0.01',
          'entry_type',
          'adjustment',
          'metadata',
          jsonb_build_object('verification_scope', 'append_only')
        )
      ),
      'wallet-ledger-verification:' || gen_random_uuid()::text,
      null,
      null,
      jsonb_build_object('verification_scope', 'append_only'),
      jsonb_build_object('verification_scope', 'append_only')
    );

    select ledger.id
    into verification_ledger_entry_id
    from public.wallet_ledger_entries ledger
    where ledger.transaction_id = verification_transaction_id
    limit 1;

    if verification_ledger_entry_id is null then
      raise exception 'wallet ledger verification could not create a transient ledger entry';
    end if;

    begin
      update public.wallet_ledger_entries
      set metadata = metadata || jsonb_build_object('mutation_attempt', 'update')
      where id = verification_ledger_entry_id;
    exception
      when others then
        update_blocked := true;
    end;

    begin
      delete from public.wallet_ledger_entries
      where id = verification_ledger_entry_id;
    exception
      when others then
        delete_blocked := true;
    end;

    raise exception 'rollback wallet ledger append-only verifier';
  exception
    when raise_exception then
      if sqlerrm <> 'rollback wallet ledger append-only verifier' then
        raise;
      end if;
  end;

  return update_blocked and delete_blocked;
end;
$$;

revoke all on function public.verify_wallet_ledger_append_only() from public;
revoke all on function public.verify_wallet_ledger_append_only() from anon;
revoke all on function public.verify_wallet_ledger_append_only() from authenticated;
grant execute on function public.verify_wallet_ledger_append_only() to service_role;

commit;
