begin;

alter table public.logistics_company_payment_settings
  drop constraint if exists logistics_company_payment_settings_default_driver_payment_method_check;
alter table public.logistics_company_payment_settings
  add constraint logistics_company_payment_settings_driver_payment_method_check
  check (default_driver_payment_method in ('bank_transfer','cash','other','offline'));

alter table public.logistics_driver_payment_records
  drop constraint if exists logistics_driver_payment_records_payment_method_check;
alter table public.logistics_driver_payment_records
  add constraint logistics_driver_payment_records_external_payment_method_check
  check (payment_method in ('bank_transfer','cash','other','offline'));

create or replace function public.update_logistics_company_payment_settings(
  target_organization_id uuid,
  target_default_driver_payment_method text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.logistics_company_payment_settings%rowtype;
begin
  if auth.uid() is null or not public.can_manage_logistics_company(target_organization_id) then
    raise exception using errcode = '42501', message = 'company payment settings update is restricted to company owners';
  end if;
  if target_default_driver_payment_method is null
    or target_default_driver_payment_method not in ('bank_transfer','cash','other','offline') then
    raise exception 'choose bank transfer, cash, other or offline payment';
  end if;

  insert into public.logistics_company_payment_settings (
    organization_id, default_driver_payment_method, updated_by, updated_at
  ) values (
    target_organization_id, target_default_driver_payment_method, auth.uid(), timezone('utc', now())
  )
  on conflict (organization_id) do update
    set default_driver_payment_method = excluded.default_driver_payment_method,
        updated_by = excluded.updated_by,
        updated_at = timezone('utc', now())
  returning * into result;

  return jsonb_build_object(
    'organization_id', result.organization_id,
    'default_driver_payment_method', result.default_driver_payment_method,
    'updated_at', result.updated_at
  );
end;
$$;

create or replace function public.record_logistics_driver_payment(
  target_booking_id uuid,
  target_amount numeric,
  target_payment_method text,
  target_note text default null,
  target_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  booking_record public.logistics_bookings%rowtype;
  assignment_record public.logistics_booking_driver_assignments%rowtype;
  settings_record public.logistics_company_payment_settings%rowtype;
  payment_record public.logistics_driver_payment_records%rowtype;
  currency_decimals integer;
  permitted_amount numeric(28,8);
begin
  if actor is null then raise exception 'authentication is required'; end if;
  if target_booking_id is null or target_amount is null or target_amount <= 0
    or target_payment_method is null
    or target_payment_method not in ('bank_transfer','cash','other','offline')
    or target_idempotency_key is null
    or char_length(btrim(target_idempotency_key)) not between 8 and 180
    or coalesce(length(btrim(target_note)),0) < 3 then
    raise exception 'booking, positive amount, supported payment channel, reference and valid idempotency key are required';
  end if;

  select * into booking_record
  from public.logistics_bookings
  where id = target_booking_id
  for update;
  if not found then raise exception 'Logistics booking was not found'; end if;
  if not public.can_manage_logistics_company(booking_record.provider_organization_id) then
    raise exception using errcode = '42501', message = 'only an authorized company owner can record driver payments';
  end if;
  if booking_record.status not in ('settled','completed_offline') then
    raise exception 'driver payment is available only after customer-confirmed job completion';
  end if;

  select * into assignment_record
  from public.logistics_booking_driver_assignments
  where booking_id = booking_record.id
    and provider_organization_id = booking_record.provider_organization_id
    and status = 'completed'
  order by completed_at desc nulls last, created_at desc
  limit 1
  for update;
  if not found then raise exception 'the assigned driver has not completed this Logistics job'; end if;

  select * into settings_record
  from public.logistics_company_payment_settings
  where organization_id = booking_record.provider_organization_id;
  if coalesce(settings_record.default_driver_payment_method, 'offline') <> target_payment_method then
    raise exception 'payment channel differs from the company setting; update the company setting first';
  end if;

  select decimal_places into currency_decimals
  from public.currency_definitions
  where code = booking_record.currency_code and status = 'enabled';
  if currency_decimals is null or target_amount <> trunc(target_amount, currency_decimals) then
    raise exception 'driver payment amount exceeds the currency decimal precision';
  end if;

  permitted_amount := case
    when booking_record.payment_mode = 'online_wallet' then booking_record.provider_net_amount
    else booking_record.delivery_amount
  end;
  if permitted_amount <= 0 or target_amount > permitted_amount then
    raise exception 'driver payment cannot exceed the provider amount for this booking';
  end if;

  select * into payment_record
  from public.logistics_driver_payment_records
  where booking_id = booking_record.id or idempotency_key = target_idempotency_key;
  if found then
    if payment_record.booking_id <> booking_record.id
      or payment_record.amount <> target_amount
      or payment_record.payment_method <> target_payment_method
      or payment_record.provider_organization_id <> booking_record.provider_organization_id then
      raise exception 'driver payment idempotency key or booking has already been used with different details';
    end if;
    return jsonb_build_object(
      'id',payment_record.id,'booking_id',payment_record.booking_id,'amount',payment_record.amount,
      'currency_code',payment_record.currency_code,'payment_method',payment_record.payment_method,
      'status',payment_record.status,'financial_transaction_id',null,'idempotent_replay',true
    );
  end if;

  insert into public.logistics_driver_payment_records (
    booking_id,provider_organization_id,driver_profile_id,driver_user_id,
    currency_code,amount,payment_method,status,financial_transaction_id,note,
    idempotency_key,paid_by,metadata
  ) values (
    booking_record.id,booking_record.provider_organization_id,assignment_record.driver_profile_id,
    assignment_record.driver_user_id,booking_record.currency_code,target_amount,target_payment_method,
    'recorded_offline',null,nullif(btrim(target_note),''),target_idempotency_key,actor,
    jsonb_build_object(
      'source','logistics.company.driver_payments',
      'booking_status',booking_record.status,
      'settlement_mode',booking_record.payment_mode,
      'external_payment_reference',true
    )
  ) returning * into payment_record;

  return jsonb_build_object(
    'id',payment_record.id,'booking_id',payment_record.booking_id,'amount',payment_record.amount,
    'currency_code',payment_record.currency_code,'payment_method',payment_record.payment_method,
    'status',payment_record.status,'financial_transaction_id',null,'idempotent_replay',false
  );
end;
$$;

notify pgrst,'reload schema';
commit;
