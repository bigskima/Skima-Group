begin;

create or replace function public.queue_withdrawal_event_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  withdrawal_record record;
  wallet_record record;
  notification_title text;
  notification_body text;
  deep_link text;
begin
  select withdrawal.*
  into withdrawal_record
  from public.withdrawal_requests withdrawal
  where withdrawal.id = new.withdrawal_request_id;

  if not found or withdrawal_record.requested_by is null then
    return new;
  end if;

  select wallet.*
  into wallet_record
  from public.wallet_accounts wallet
  where wallet.id = withdrawal_record.wallet_id;

  notification_title := case new.event_type
    when 'requested' then 'Withdrawal submitted'
    when 'approved' then 'Withdrawal approved'
    when 'processing' then 'Withdrawal processing'
    when 'succeeded' then 'Withdrawal completed'
    when 'failed' then 'Withdrawal failed'
    when 'reversed' then 'Withdrawal reversed'
    when 'cancelled' then 'Withdrawal cancelled'
    else 'Withdrawal update'
  end;

  notification_body := case new.event_type
    when 'requested' then 'Your withdrawal request was received by SKIMA.'
    when 'approved' then 'Your withdrawal was approved and the funds are reserved for transfer.'
    when 'processing' then 'Your withdrawal is being processed by the payment provider.'
    when 'succeeded' then 'Your withdrawal was completed successfully.'
    when 'failed' then 'The withdrawal could not be completed. Any reserved funds are returned according to the transaction state.'
    when 'reversed' then 'The withdrawal was reversed and the applicable funds were returned to your SKIMA wallet.'
    when 'cancelled' then 'The withdrawal was cancelled.'
    else 'The status of your withdrawal changed.'
  end;

  deep_link := case
    when wallet_record.owner_entity_type = 'driver' then '/(driver)/earnings'
    when wallet_record.owner_entity_type in ('organization','partner') then '/(station)/earnings'
    else '/(customer)/transactions'
  end;

  begin
    perform public.queue_communication_message(
      'in_app',
      'wallet.withdrawal.' || new.event_type,
      'user',
      withdrawal_record.requested_by,
      null,
      jsonb_build_object(
        'title', notification_title,
        'body', notification_body,
        'category', 'wallet',
        'deepLink', deep_link,
        'withdrawalRequestId', withdrawal_record.id,
        'publicReference', withdrawal_record.public_reference,
        'status', new.status,
        'amount', withdrawal_record.amount,
        'currencyCode', withdrawal_record.currency_code
      ),
      'provider.communication.sandbox',
      'platform.withdrawal_notifications',
      'withdrawal-notification:' || new.id::text,
      jsonb_build_object(
        'event_type', new.event_type,
        'withdrawal_request_id', withdrawal_record.id
      )
    );
  exception when others then
    -- Financial execution must never fail because a notification provider is unavailable.
    null;
  end;

  return new;
end;
$$;

drop trigger if exists withdrawal_event_notification_trigger on public.withdrawal_events;
create trigger withdrawal_event_notification_trigger
after insert on public.withdrawal_events
for each row execute function public.queue_withdrawal_event_notification();

create or replace function public.queue_utility_payment_status_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  notification_title text;
  notification_body text;
begin
  if new.customer_user_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  notification_title := case new.status
    when 'awaiting_payment' then 'Utility payment created'
    when 'payment_reserved' then 'Utility payment reserved'
    when 'processing' then 'Utility payment processing'
    when 'reconciliation_required' then 'Utility payment needs confirmation'
    when 'succeeded' then 'Utility payment completed'
    when 'failed' then 'Utility payment failed'
    when 'reversed' then 'Utility payment reversed'
    else 'Utility payment update'
  end;

  notification_body := case new.status
    when 'awaiting_payment' then 'Complete or confirm payment to continue this utility purchase.'
    when 'payment_reserved' then 'Your funds are reserved while SKIMA sends the utility purchase to the provider.'
    when 'processing' then 'The utility provider is processing your purchase.'
    when 'reconciliation_required' then 'SKIMA is confirming the provider result before finalizing this utility payment.'
    when 'succeeded' then 'Your utility payment completed successfully.'
    when 'failed' then 'The utility payment was unsuccessful. Open Pay Bills for the latest status.'
    when 'reversed' then 'The utility payment was reversed and the applicable funds were returned.'
    else 'The status of your utility payment changed.'
  end;

  begin
    perform public.queue_communication_message(
      'in_app',
      'utility.payment.' || new.status,
      'user',
      new.customer_user_id,
      null,
      jsonb_build_object(
        'title', notification_title,
        'body', notification_body,
        'category', case when new.status = 'reversed' then 'wallet' else 'utility' end,
        'deepLink', '/(customer)/bills',
        'utilityPaymentId', new.id,
        'publicReference', new.public_reference,
        'status', new.status,
        'amount', new.total_amount,
        'currencyCode', new.currency_code
      ),
      'provider.communication.sandbox',
      'platform.utility_notifications',
      'utility-notification:' || new.id::text || ':' || new.status,
      jsonb_build_object(
        'utility_payment_id', new.id,
        'status', new.status
      )
    );
  exception when others then
    -- Utility fulfillment must not roll back solely because notification delivery is unavailable.
    null;
  end;

  return new;
end;
$$;

drop trigger if exists utility_payment_status_notification_trigger on public.utility_payment_requests;
create trigger utility_payment_status_notification_trigger
after insert or update of status on public.utility_payment_requests
for each row execute function public.queue_utility_payment_status_notification();

revoke all on function public.queue_withdrawal_event_notification() from public, anon, authenticated;
revoke all on function public.queue_utility_payment_status_notification() from public, anon, authenticated;

grant execute on function public.queue_withdrawal_event_notification() to service_role;
grant execute on function public.queue_utility_payment_status_notification() to service_role;

commit;
