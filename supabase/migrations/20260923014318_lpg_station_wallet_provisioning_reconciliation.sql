begin;

create or replace function public.ensure_lpg_station_finance_wallet(
  target_organization_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  wallet_id uuid;
begin
  if target_organization_id is null then
    raise exception 'target_organization_id is required';
  end if;

  if not exists (
    select 1
    from public.lpg_station_branches station
    where station.organization_id=target_organization_id
      and station.approval_status='approved'
  ) then
    raise exception 'approved LPG station organization is required';
  end if;

  select wallet.id into wallet_id
  from public.wallet_accounts wallet
  where wallet.wallet_type='partner'
    and wallet.owner_entity_type='organization'
    and wallet.owner_entity_id=target_organization_id
    and wallet.currency_code='NGN'
  order by wallet.created_at asc
  limit 1;

  if wallet_id is not null then
    update public.wallet_accounts
    set metadata=metadata || jsonb_build_object(
          'workspace','station',
          'wallet_purpose','lpg_station_settlement'
        ),
        updated_at=timezone('utc',now())
    where id=wallet_id
      and status<>'closed';
    return wallet_id;
  end if;

  insert into public.wallet_accounts(
    wallet_type,owner_entity_type,owner_entity_id,currency_code,status,
    metadata,created_by,source,idempotency_key
  )
  values(
    'partner','organization',target_organization_id,'NGN','active',
    jsonb_build_object(
      'workspace','station',
      'wallet_purpose','lpg_station_settlement',
      'provisioned_by','station_wallet_reconciliation'
    ),
    auth.uid(),
    'lpg.station_wallet_engine',
    'station-wallet:organization:' || target_organization_id::text
  )
  on conflict do nothing
  returning id into wallet_id;

  if wallet_id is null then
    select wallet.id into wallet_id
    from public.wallet_accounts wallet
    where wallet.wallet_type='partner'
      and wallet.owner_entity_type='organization'
      and wallet.owner_entity_id=target_organization_id
      and wallet.currency_code='NGN'
    order by wallet.created_at asc
    limit 1;
  end if;

  if wallet_id is null then
    raise exception 'station finance wallet provisioning failed';
  end if;

  insert into public.wallet_account_events(
    wallet_account_id,event_type,status,idempotency_key,metadata
  )
  select
    wallet_id,'created','active',
    'station-wallet:organization:' || target_organization_id::text || ':created',
    jsonb_build_object(
      'source','lpg.station_wallet_engine',
      'workspace','station',
      'wallet_purpose','lpg_station_settlement'
    )
  where not exists (
    select 1
    from public.wallet_account_events event
    where event.wallet_account_id=wallet_id
      and event.idempotency_key='station-wallet:organization:' || target_organization_id::text || ':created'
  );

  return wallet_id;
end;
$$;

revoke all on function public.ensure_lpg_station_finance_wallet(uuid) from public,anon,authenticated;
grant execute on function public.ensure_lpg_station_finance_wallet(uuid) to service_role;

create or replace function public.reconcile_lpg_station_finance_wallet_after_write()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if new.approval_status='approved' and new.organization_id is not null then
    perform public.ensure_lpg_station_finance_wallet(new.organization_id);
  end if;
  return new;
end;
$$;

revoke all on function public.reconcile_lpg_station_finance_wallet_after_write() from public,anon,authenticated;

drop trigger if exists reconcile_lpg_station_finance_wallet_after_write on public.lpg_station_branches;
create trigger reconcile_lpg_station_finance_wallet_after_write
after insert or update of approval_status,organization_id
on public.lpg_station_branches
for each row
execute function public.reconcile_lpg_station_finance_wallet_after_write();

do $$
declare
  station_org record;
begin
  for station_org in
    select distinct organization_id
    from public.lpg_station_branches
    where approval_status='approved'
      and organization_id is not null
  loop
    perform public.ensure_lpg_station_finance_wallet(station_org.organization_id);
  end loop;
end;
$$;

commit;
