begin;

-- Fee-bearing payouts must be approved by the trusted finance runtime. This
-- prevents legacy user-token approval code from ever sending `amount + fee` to
-- an external provider. Zero-fee legacy withdrawals remain backward compatible.
create or replace function public.guard_fee_bearing_withdrawal_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved'
    and old.status = 'requested'
    and coalesce(new.fee_amount, 0) > 0
    and auth.role() <> 'service_role' then
    raise exception 'fee-bearing withdrawals require the trusted finance runtime';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_fee_bearing_withdrawal_approval
on public.withdrawal_requests;

create trigger guard_fee_bearing_withdrawal_approval
before update on public.withdrawal_requests
for each row
execute function public.guard_fee_bearing_withdrawal_approval();

-- Paystack reports amounts in kobo. Refuse a successful deposit event unless
-- the provider actually charged the exact wallet-credit + SKIMA-fee total. This
-- protects against stale clients that still initialize only the wallet-credit
-- amount after a future deposit fee is enabled.
create or replace function public.guard_paystack_deposit_amount()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_kobo numeric;
  received_kobo numeric;
begin
  if new.deposit_request_id is null
    or new.event_type <> 'deposit.succeeded'
    or new.source not like 'provider.payment.paystack%' then
    return new;
  end if;

  select round(deposit.total_charge_amount * 100, 0)
  into expected_kobo
  from public.payment_deposit_requests deposit
  where deposit.id = new.deposit_request_id;

  received_kobo := nullif(new.payload #>> '{data,amount}', '')::numeric;

  if expected_kobo is null then
    raise exception 'Paystack deposit request could not be resolved';
  end if;

  if received_kobo is null or received_kobo <> expected_kobo then
    raise exception 'Paystack deposit amount does not match the authorized SKIMA charge';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_paystack_deposit_amount
on public.payment_webhook_events;

create trigger guard_paystack_deposit_amount
before insert on public.payment_webhook_events
for each row
execute function public.guard_paystack_deposit_amount();

commit;
