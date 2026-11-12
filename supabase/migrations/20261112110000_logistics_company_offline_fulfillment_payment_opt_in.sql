begin;

-- Offline fulfilment is a provider-controlled payment option. It is independent
-- from the company's preferred way of paying its own drivers.
alter table public.logistics_company_payment_settings
  add column if not exists accepts_offline_customer_payment boolean not null default false;

-- Company owners can inspect this preference alongside the existing driver
-- payment method. Missing rows default to opt-out.
create or replace function public.read_logistics_company_payment_settings(
  target_organization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  result public.logistics_company_payment_settings%rowtype;
begin
  if auth.uid() is null or not public.can_manage_logistics_company(target_organization_id) then
    raise exception using errcode = '42501',
      message = 'company payment settings access is restricted to company owners';
  end if;

  select * into result
  from public.logistics_company_payment_settings
  where organization_id = target_organization_id;

  return jsonb_build_object(
    'organization_id', target_organization_id,
    'default_driver_payment_method', coalesce(result.default_driver_payment_method, 'offline'),
    'accepts_offline_customer_payment', coalesce(result.accepts_offline_customer_payment, false),
    'updated_at', result.updated_at
  );
end;
$function$;

-- Public-facing read model: expose only this one payment capability, and only
-- for verified, operational provider companies. Do not expose company finance data.
create or replace function public.read_logistics_provider_payment_options(
  target_organization_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  select jsonb_build_object(
    'organization_id', provider.organization_id,
    'accepts_offline_customer_payment',
      coalesce(settings.accepts_offline_customer_payment, false)
  )
  from public.logistics_provider_profiles provider
  left join public.logistics_company_payment_settings settings
    on settings.organization_id = provider.organization_id
  where auth.uid() is not null
    and provider.organization_id = target_organization_id
    and provider.verification_status = 'verified'
    and provider.operational_status = 'active'
  limit 1;
$function$;

revoke all on function public.read_logistics_provider_payment_options(uuid)
  from public, anon;
grant execute on function public.read_logistics_provider_payment_options(uuid)
  to authenticated;

-- Only a company owner may change whether their company accepts direct/offline
-- payment of the delivery price. The provider receival fee policy is unchanged.
create or replace function public.update_logistics_company_offline_payment_acceptance(
  target_organization_id uuid,
  target_accepts_offline_customer_payment boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  result public.logistics_company_payment_settings%rowtype;
begin
  if auth.uid() is null or not public.can_manage_logistics_company(target_organization_id) then
    raise exception using errcode = '42501',
      message = 'offline payment preference updates are restricted to company owners';
  end if;

  if target_accepts_offline_customer_payment is null then
    raise exception using errcode = '22023',
      message = 'choose whether your company accepts offline customer payments';
  end if;

  insert into public.logistics_company_payment_settings (
    organization_id,
    accepts_offline_customer_payment,
    updated_by,
    updated_at
  )
  values (
    target_organization_id,
    target_accepts_offline_customer_payment,
    auth.uid(),
    timezone('utc', now())
  )
  on conflict (organization_id) do update
    set accepts_offline_customer_payment = excluded.accepts_offline_customer_payment,
        updated_by = excluded.updated_by,
        updated_at = timezone('utc', now())
  returning * into result;

  return jsonb_build_object(
    'organization_id', result.organization_id,
    'accepts_offline_customer_payment', result.accepts_offline_customer_payment,
    'updated_at', result.updated_at
  );
end;
$function$;

revoke all on function public.update_logistics_company_offline_payment_acceptance(uuid, boolean)
  from public, anon;
grant execute on function public.update_logistics_company_offline_payment_acceptance(uuid, boolean)
  to authenticated;

-- Enforce company opt-in in the booking transaction itself. Hiding the choice
-- in the app is not sufficient: API callers cannot create an offline booking
-- for a company that has not accepted offline fulfilment.
do $offline_booking_acceptance_guard$
declare
  function_sql text;
  old_guard text := $old_guard$
  if job_record.requester_user_id <> actor then
    raise exception 'only the customer who created the job may book a provider offer';
  end if;
  $old_guard$;
  new_guard text := $new_guard$
  if job_record.requester_user_id <> actor then
    raise exception 'only the customer who created the job may book a provider offer';
  end if;

  if target_payment_mode = 'offline' and not exists (
    select 1
    from public.logistics_company_payment_settings payment_settings
    where payment_settings.organization_id = offer_record.organization_id
      and payment_settings.accepts_offline_customer_payment = true
  ) then
    raise exception using errcode = '22023',
      message = 'This logistics company does not accept offline fulfilment payment. Choose online wallet payment.';
  end if;
  $new_guard$;
begin
  function_sql := pg_get_functiondef(
    'public.create_logistics_booking_for_offer(uuid,text,text)'::regprocedure
  );
  if position(old_guard in function_sql) = 0 then
    raise exception 'Logistics booking owner guard changed; refusing an unsafe offline-payment patch';
  end if;
  function_sql := replace(function_sql, old_guard, new_guard);
  execute function_sql;
end;
$offline_booking_acceptance_guard$;

commit;
