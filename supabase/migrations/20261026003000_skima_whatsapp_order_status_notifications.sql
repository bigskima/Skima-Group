begin;

alter table public.skima_whatsapp_contacts
  add column if not exists order_status_notifications_opt_in boolean not null default false,
  add column if not exists order_status_notifications_opted_in_at timestamptz,
  add column if not exists order_status_notifications_opted_out_at timestamptz;

create table if not exists public.skima_whatsapp_order_notifications (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.skima_whatsapp_contacts(id) on delete cascade,
  lpg_order_id uuid not null references public.lpg_refill_orders(id) on delete cascade,
  transition_key text not null,
  template_key text not null default 'lpg_order_status'
    check (template_key = 'lpg_order_status'),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'sent', 'failed', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 8),
  next_attempt_at timestamptz not null default timezone('utc', now()),
  locked_at timestamptz,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  provider_message_id text unique,
  provider_delivery_status text
    check (provider_delivery_status is null or provider_delivery_status in ('sent', 'delivered', 'read', 'failed')),
  provider_status_at timestamptz,
  provider_error_code text,
  last_error_code text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (lpg_order_id, transition_key)
);

create index if not exists skima_whatsapp_order_notifications_due_idx
  on public.skima_whatsapp_order_notifications(status, next_attempt_at, created_at)
  where status in ('queued', 'processing');
create index if not exists skima_whatsapp_order_notifications_order_idx
  on public.skima_whatsapp_order_notifications(lpg_order_id, created_at desc);

alter table public.skima_whatsapp_order_notifications enable row level security;

drop policy if exists skima_whatsapp_order_notifications_service_role_all
  on public.skima_whatsapp_order_notifications;
create policy skima_whatsapp_order_notifications_service_role_all
  on public.skima_whatsapp_order_notifications for all to service_role
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

revoke all on public.skima_whatsapp_order_notifications from public, anon, authenticated;
grant all on public.skima_whatsapp_order_notifications to service_role;

create or replace function public.set_skima_whatsapp_order_notifications(
  target_whatsapp_wa_id text,
  target_opt_in boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  contact_record public.skima_whatsapp_contacts%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if target_whatsapp_wa_id is null
     or btrim(target_whatsapp_wa_id) !~ '^[0-9]{6,20}$'
     or target_opt_in is null then
    raise exception using errcode = '22023', message = 'valid WhatsApp number and notification preference are required';
  end if;

  select * into contact_record
  from public.skima_whatsapp_contacts
  where whatsapp_wa_id = btrim(target_whatsapp_wa_id)
    and link_status = 'linked'
    and profile_id is not null
  for update;

  if not found or not exists (
    select 1 from public.profiles p
    where p.id = contact_record.profile_id and p.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'active linked SKIMA customer required';
  end if;

  update public.skima_whatsapp_contacts
  set order_status_notifications_opt_in = target_opt_in,
      order_status_notifications_opted_in_at = case
        when target_opt_in then timezone('utc', now())
        else order_status_notifications_opted_in_at
      end,
      order_status_notifications_opted_out_at = case
        when target_opt_in then null
        else timezone('utc', now())
      end,
      updated_at = timezone('utc', now())
  where id = contact_record.id;

  if not target_opt_in then
    update public.skima_whatsapp_order_notifications
    set status = 'cancelled',
        last_error_code = 'customer_opted_out',
        updated_at = timezone('utc', now())
    where contact_id = contact_record.id
      and status = 'queued';
  end if;

  return true;
end;
$$;

create or replace function public.queue_skima_whatsapp_order_status_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  next_key text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.status is not distinct from old.status
     and new.payment_status is not distinct from old.payment_status then
    return new;
  end if;

  next_key := concat(
    'status:', coalesce(old.status, 'null'), '->', coalesce(new.status, 'null'),
    '|payment:', coalesce(old.payment_status, 'null'), '->', coalesce(new.payment_status, 'null')
  );

  insert into public.skima_whatsapp_order_notifications(
    contact_id, lpg_order_id, transition_key, payload
  )
  select
    contact.id,
    new.id,
    next_key,
    jsonb_build_object(
      'publicReference', new.public_reference,
      'orderStatus', new.status,
      'paymentStatus', new.payment_status,
      'totalAmount', new.total_amount,
      'currencyCode', new.currency_code,
      'updatedAt', new.updated_at
    )
  from public.skima_whatsapp_contacts contact
  where contact.profile_id = new.customer_user_id
    and contact.link_status = 'linked'
    and contact.order_status_notifications_opt_in = true
  on conflict (lpg_order_id, transition_key) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_skima_whatsapp_queue_lpg_order_status
  on public.lpg_refill_orders;
create trigger trg_skima_whatsapp_queue_lpg_order_status
  after update of status, payment_status on public.lpg_refill_orders
  for each row
  when (old.status is distinct from new.status or old.payment_status is distinct from new.payment_status)
  execute function public.queue_skima_whatsapp_order_status_notification();

create or replace function public.claim_skima_whatsapp_order_notifications(
  target_limit integer default 25
)
returns table (
  notification_id uuid,
  whatsapp_wa_id text,
  lpg_order_id uuid,
  payload jsonb,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if target_limit is null or target_limit < 1 or target_limit > 100 then
    raise exception using errcode = '22023', message = 'target_limit must be between 1 and 100';
  end if;

  update public.skima_whatsapp_order_notifications n
  set status = 'failed',
      last_error_code = coalesce(n.last_error_code, 'retry_limit_exhausted'),
      locked_at = null,
      updated_at = timezone('utc', now())
  where n.status = 'processing'
    and n.locked_at < timezone('utc', now()) - interval '5 minutes'
    and n.attempt_count >= 8;

  return query
  with due as (
    select n.id
    from public.skima_whatsapp_order_notifications n
    join public.skima_whatsapp_contacts contact on contact.id = n.contact_id
    where contact.link_status = 'linked'
      and contact.profile_id is not null
      and contact.order_status_notifications_opt_in = true
      and n.attempt_count < 8
      and n.next_attempt_at <= timezone('utc', now())
      and (
        n.status = 'queued'
        or (n.status = 'processing' and n.locked_at < timezone('utc', now()) - interval '5 minutes')
      )
    order by n.next_attempt_at, n.created_at
    limit target_limit
    for update of n skip locked
  ),
  claimed as (
    update public.skima_whatsapp_order_notifications n
    set status = 'processing',
        attempt_count = n.attempt_count + 1,
        locked_at = timezone('utc', now()),
        last_attempt_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    from due
    where n.id = due.id
    returning n.id, n.contact_id, n.lpg_order_id, n.payload, n.attempt_count
  )
  select claimed.id, contact.whatsapp_wa_id, claimed.lpg_order_id, claimed.payload, claimed.attempt_count
  from claimed
  join public.skima_whatsapp_contacts contact on contact.id = claimed.contact_id;
end;
$$;

revoke all on function public.set_skima_whatsapp_order_notifications(text, boolean) from public, anon, authenticated;
revoke all on function public.queue_skima_whatsapp_order_status_notification() from public, anon, authenticated;
revoke all on function public.claim_skima_whatsapp_order_notifications(integer) from public, anon, authenticated;
grant execute on function public.set_skima_whatsapp_order_notifications(text, boolean) to service_role;
grant execute on function public.claim_skima_whatsapp_order_notifications(integer) to service_role;

-- Create the poller even before Meta credentials are configured. The cron command
-- remains inert until both Vault values exist, then starts delivering opt-in updates.
do $
begin
  if to_regclass('vault.decrypted_secrets') is not null
     and to_regclass('cron.job') is not null then
    perform cron.schedule(
      'skima-whatsapp-order-notifications',
      '* * * * *',
      $cron$
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets where name = 'skima_whatsapp_dispatch_url' limit 1),
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'skima_whatsapp_dispatch_secret' limit 1)
          ),
          body := '{"mode":"dispatch"}'::jsonb
        )
        where exists (select 1 from vault.decrypted_secrets where name = 'skima_whatsapp_dispatch_url')
          and exists (select 1 from vault.decrypted_secrets where name = 'skima_whatsapp_dispatch_secret');
      $cron$
    );
  end if;
end;
$;

commit;
