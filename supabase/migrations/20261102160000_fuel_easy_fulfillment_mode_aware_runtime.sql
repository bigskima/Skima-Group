begin;

-- Fuel remains its own liquid-fuel domain. The common order, escrow, dispatch,
-- OTP, wallet and settlement engines remain shared; no LPG cylinder workflow
-- is copied into this module.

alter table public.fuel_branch_product_offers
  add column if not exists admin_override_price_per_litre numeric(20,8),
  add column if not exists admin_override_reason text,
  add column if not exists admin_override_by uuid references public.profiles(id) on delete set null,
  add column if not exists admin_override_at timestamptz;

alter table public.fuel_order_operations
  add column if not exists delivery_challenge_id uuid references public.otp_challenges(id) on delete set null,
  add column if not exists delivery_verified_at timestamptz;

create table if not exists public.fuel_managed_product_prices (
  id uuid primary key default gen_random_uuid(),
  product_key text not null references public.fuel_products(key) on update cascade on delete restrict,
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  price_per_litre numeric(20,8) not null check (price_per_litre > 0),
  enabled boolean not null default false,
  effective_from timestamptz not null default timezone('utc',now()),
  effective_until timestamptz,
  change_reason text not null,
  source text not null default 'platform.fuel.managed_pricing',
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  unique(product_key,currency_code),
  check (effective_until is null or effective_until>effective_from)
);

create table if not exists public.fuel_managed_product_price_events (
  id uuid primary key default gen_random_uuid(),
  managed_price_id uuid not null references public.fuel_managed_product_prices(id) on delete restrict,
  product_key text not null references public.fuel_products(key) on update cascade on delete restrict,
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  event_key text not null check (event_key in ('created','price_changed','enabled','disabled')),
  before_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(before_snapshot)='object'),
  after_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(after_snapshot)='object'),
  actor_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  reason text not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default timezone('utc',now())
);

create table if not exists public.fuel_fulfillment_mode_controls (
  id uuid primary key default gen_random_uuid(),
  product_key text not null references public.fuel_products(key) on update cascade on delete restrict,
  fulfillment_mode text not null check (fulfillment_mode in ('station_managed','independent_driver','skima_managed')),
  enabled boolean not null default true,
  dispatch_policy_key text not null,
  reason text not null default 'Initial Fuel fulfillment mode configuration',
  idempotency_key text not null unique,
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  unique(product_key,fulfillment_mode)
);

create index if not exists fuel_managed_product_prices_active_idx
  on public.fuel_managed_product_prices(product_key,currency_code,enabled,effective_from);

create index if not exists fuel_fulfillment_mode_controls_enabled_idx
  on public.fuel_fulfillment_mode_controls(product_key,enabled,fulfillment_mode);

insert into public.fuel_fulfillment_mode_controls(
  product_key,fulfillment_mode,enabled,dispatch_policy_key,reason,idempotency_key
)
select product.key,
       modes.fulfillment_mode,
       true,
       case product.key
         when 'fuel.pms' then 'dispatch.fuel.pms.nearest-qualified-driver.v1'
         when 'fuel.ago' then 'dispatch.fuel.ago.nearest-qualified-driver.v1'
         else 'dispatch.fuel.dpk.nearest-qualified-driver.v1'
       end,
       'Preserve the three existing Fuel fulfillment choices while placing their global availability under SKIMA control.',
       'fuel-mode-seed:'||product.key||':'||modes.fulfillment_mode
from public.fuel_products product
cross join (values
  ('station_managed'),
  ('independent_driver'),
  ('skima_managed')
) as modes(fulfillment_mode)
where product.key in ('fuel.pms','fuel.ago','fuel.dpk')
on conflict(product_key,fulfillment_mode) do nothing;

create or replace function public.read_fuel_fulfillment_mode_controls()
returns table(
  product_key text,
  fulfillment_mode text,
  enabled boolean,
  dispatch_policy_key text,
  managed_price_configured boolean
)
language sql
stable
security definer
set search_path=public
as $$
  select control.product_key,
         control.fulfillment_mode,
         control.enabled,
         control.dispatch_policy_key,
         case when control.fulfillment_mode<>'skima_managed' then true
              else exists(
                select 1 from public.fuel_managed_product_prices managed
                where managed.product_key=control.product_key
                  and managed.enabled
                  and managed.currency_code in (
                    select currency.code from public.currency_definitions currency
                    where currency.status='enabled'
                  )
                  and managed.effective_from<=timezone('utc',now())
                  and (managed.effective_until is null or managed.effective_until>timezone('utc',now()))
              )
         end
  from public.fuel_fulfillment_mode_controls control
  join public.fuel_products product on product.key=control.product_key
  where product.status='enabled'
  order by control.product_key,control.fulfillment_mode;
$$;

create or replace function public.set_fuel_fulfillment_mode_control(
  target_product_key text,
  target_fulfillment_mode text,
  target_enabled boolean,
  target_reason text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  control_id uuid;
begin
  if auth.role()<>'service_role'
     and not public.can_manage_fuel_platform()
     and not public.has_permission('platform.dispatch.manage',null) then
    raise exception using errcode='42501',message='Platform Fuel or dispatch management permission is required';
  end if;
  if target_product_key not in ('fuel.pms','fuel.ago','fuel.dpk')
     or target_fulfillment_mode not in ('station_managed','independent_driver','skima_managed')
     or target_enabled is null
     or coalesce(length(btrim(target_reason)),0)<5
     or coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='A valid product, fulfillment mode, enabled state, reason and idempotency key are required';
  end if;
  update public.fuel_fulfillment_mode_controls
  set enabled=target_enabled,
      reason=btrim(target_reason),
      idempotency_key=target_idempotency_key,
      updated_by=auth.uid(),
      updated_at=timezone('utc',now())
  where product_key=target_product_key and fulfillment_mode=target_fulfillment_mode
  returning id into control_id;
  if control_id is null then
    raise exception using errcode='P0002',message='Fuel fulfillment mode control was not found';
  end if;
  return control_id;
end;
$$;

create or replace function public.configure_fuel_managed_product_price(
  target_product_key text,
  target_currency_code text,
  target_price_per_litre numeric,
  target_enabled boolean,
  target_reason text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  existing public.fuel_managed_product_prices%rowtype;
  price_id uuid;
  event_key text;
  before_value jsonb:='{}'::jsonb;
begin
  if auth.role()<>'service_role'
     and not public.can_manage_fuel_platform()
     and not public.has_permission('platform.financial_policy.manage',null)
     and not public.has_permission('platform.revenue.manage',null) then
    raise exception using errcode='42501',message='Platform Fuel or revenue pricing permission is required';
  end if;
  if target_product_key not in ('fuel.pms','fuel.ago','fuel.dpk')
     or target_currency_code is null
     or target_price_per_litre is null or target_price_per_litre<=0
     or target_enabled is null
     or coalesce(length(btrim(target_reason)),0)<5
     or coalesce(btrim(target_idempotency_key),'')=''
     or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='Valid managed product price, currency, enabled state, reason and idempotency key are required';
  end if;
  if not exists(select 1 from public.currency_definitions where code=target_currency_code and status='enabled') then
    raise exception using errcode='23514',message='The selected Fuel price currency is not enabled';
  end if;
  select * into existing
  from public.fuel_managed_product_prices
  where product_key=target_product_key and currency_code=target_currency_code
  for update;
  if found then before_value:=to_jsonb(existing); end if;

  insert into public.fuel_managed_product_prices(
    product_key,currency_code,price_per_litre,enabled,effective_from,effective_until,
    change_reason,idempotency_key,metadata,created_by,updated_by
  )
  values(
    target_product_key,target_currency_code,target_price_per_litre,target_enabled,
    timezone('utc',now()),null,btrim(target_reason),target_idempotency_key,target_metadata,
    auth.uid(),auth.uid()
  )
  on conflict(product_key,currency_code) do update
  set price_per_litre=excluded.price_per_litre,
      enabled=excluded.enabled,
      effective_from=excluded.effective_from,
      effective_until=null,
      change_reason=excluded.change_reason,
      idempotency_key=excluded.idempotency_key,
      metadata=public.fuel_managed_product_prices.metadata||excluded.metadata,
      updated_by=auth.uid(),
      updated_at=timezone('utc',now())
  returning id into price_id;

  event_key:=case
    when before_value='{}'::jsonb then 'created'
    when target_enabled and coalesce((before_value->>'enabled')::boolean,false)=false then 'enabled'
    when not target_enabled and coalesce((before_value->>'enabled')::boolean,false)=true then 'disabled'
    else 'price_changed'
  end;
  insert into public.fuel_managed_product_price_events(
    managed_price_id,product_key,currency_code,event_key,before_snapshot,after_snapshot,
    actor_user_id,reason,idempotency_key
  )
  values(price_id,target_product_key,target_currency_code,event_key,before_value,
         (select to_jsonb(price) from public.fuel_managed_product_prices price where price.id=price_id),
         auth.uid(),btrim(target_reason),target_idempotency_key||':event');
  return price_id;
end;
$$;

create or replace function public.configure_fuel_station_product_offer(
  target_actor_user_id uuid,
  target_branch_id uuid,
  target_product_key text,
  target_currency_code text,
  target_price_per_litre numeric,
  target_minimum_litres numeric,
  target_maximum_litres numeric,
  target_fulfillment_modes text[],
  target_status text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  offer_record public.fuel_branch_product_offers%rowtype;
  allowed_modes text[];
  resolved_offer_id uuid;
begin
  if target_actor_user_id is null or target_actor_user_id is distinct from auth.uid() then
    raise exception using errcode='42501',message='The signed-in station operator must match the offer actor';
  end if;
  if not public.can_manage_fuel_offer_branch(target_branch_id) then
    raise exception using errcode='42501',message='Branch Fuel management permission is required';
  end if;
  if target_product_key not in ('fuel.pms','fuel.ago','fuel.dpk')
     or target_currency_code is null
     or target_price_per_litre is null or target_price_per_litre<=0
     or target_minimum_litres is null or target_minimum_litres<=0
     or target_maximum_litres is null or target_maximum_litres<target_minimum_litres
     or target_status not in ('draft','active','paused')
     or coalesce(array_length(target_fulfillment_modes,1),0)=0
     or not (target_fulfillment_modes <@ array['station_managed','independent_driver','skima_managed']::text[])
     or coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='Station offer requires a valid product, price, litre range, fulfillment modes, status and idempotency key';
  end if;

  if not exists(
    select 1 from public.fuel_products product
    where product.key=target_product_key and product.status='enabled'
  ) then
    raise exception using errcode='55000',message='This Fuel product is globally disabled by SKIMA. The station cannot enable or sell it.';
  end if;

  select coalesce(array_agg(control.fulfillment_mode order by control.fulfillment_mode),'{}'::text[])
  into allowed_modes
  from public.fuel_fulfillment_mode_controls control
  where control.product_key=target_product_key and control.enabled;
  if not target_fulfillment_modes <@ allowed_modes then
    raise exception using errcode='55000',message='One or more selected fulfillment modes are disabled in SKIMA platform settings';
  end if;

  select * into offer_record
  from public.fuel_branch_product_offers
  where branch_id=target_branch_id
    and product_key=target_product_key
    and currency_code=target_currency_code
  for update;

  if target_status='active' and not exists(
    select 1 from public.currency_definitions currency
    where currency.code=target_currency_code and currency.status='enabled'
  ) then
    raise exception using errcode='23514',message='Fuel offer currency must be enabled';
  end if;

  -- Stations own their product selection and local selling price. Global
  -- platform fees, container charges, delivery policy, tax and admin overrides
  -- remain centrally governed and are never overwritten by this station form.
  resolved_offer_id:=public.configure_fuel_branch_product_offer(
    target_branch_id,
    target_product_key,
    target_currency_code,
    target_price_per_litre,
    target_minimum_litres,
    target_maximum_litres,
    coalesce(offer_record.container_purchase_amount,0),
    coalesce(offer_record.container_rental_amount,0),
    coalesce(offer_record.refundable_deposit_amount,0),
    coalesce(offer_record.driver_delivery_fee_amount,0),
    coalesce(offer_record.platform_fee_amount,0),
    coalesce(offer_record.tax_rate_percent,0),
    target_fulfillment_modes,
    target_status,
    target_idempotency_key,
    coalesce(offer_record.metadata,'{}'::jsonb)
      || jsonb_build_object('station_configured_by',target_actor_user_id,'station_configured_at',timezone('utc',now()))
  );
  return resolved_offer_id;
end;
$$;

create or replace function public.configure_fuel_station_price_override(
  target_offer_id uuid,
  target_override_price_per_litre numeric,
  target_reason text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  offer_record public.fuel_branch_product_offers%rowtype;
  updated_id uuid;
begin
  if auth.role()<>'service_role'
     and not public.can_manage_fuel_platform()
     and not public.has_permission('platform.financial_policy.manage',null) then
    raise exception using errcode='42501',message='Platform Fuel pricing permission is required for a station price override';
  end if;
  if target_offer_id is null
     or (target_override_price_per_litre is not null and target_override_price_per_litre<=0)
     or coalesce(length(btrim(target_reason)),0)<5
     or coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='Station price override requires an offer, a positive override or null to clear, a reason and idempotency key';
  end if;
  select * into offer_record from public.fuel_branch_product_offers where id=target_offer_id for update;
  if not found then raise exception using errcode='P0002',message='Fuel station offer was not found'; end if;

  update public.fuel_branch_product_offers
  set admin_override_price_per_litre=target_override_price_per_litre,
      admin_override_reason=btrim(target_reason),
      admin_override_by=auth.uid(),
      admin_override_at=timezone('utc',now()),
      metadata=metadata||jsonb_build_object(
        'last_admin_override_key',target_idempotency_key,
        'last_admin_override_reason',btrim(target_reason)
      ),
      updated_by=auth.uid(),
      updated_at=timezone('utc',now())
  where id=target_offer_id
  returning id into updated_id;

  insert into public.fuel_branch_product_offer_events(
    offer_id,branch_id,product_key,event_key,before_snapshot,after_snapshot,actor_user_id,idempotency_key
  )
  values(
    target_offer_id,offer_record.branch_id,offer_record.product_key,'updated',
    to_jsonb(offer_record),
    (select to_jsonb(updated) from public.fuel_branch_product_offers updated where updated.id=target_offer_id),
    auth.uid(),target_idempotency_key
  );
  return updated_id;
end;
$$;

create or replace function public.read_fuel_admin_pricing_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  result jsonb;
begin
  if auth.role()<>'service_role'
     and not public.can_manage_fuel_platform()
     and not public.has_permission('platform.financial_policy.read',null)
     and not public.has_permission('platform.revenue.read',null) then
    raise exception using errcode='42501',message='Platform Fuel pricing read permission is required';
  end if;
  select jsonb_build_object(
    'products',coalesce((select jsonb_agg(to_jsonb(p) order by p.key) from public.fuel_products p),'[]'::jsonb),
    'branches',coalesce((select jsonb_agg(jsonb_build_object(
      'id',b.id,'organization_id',b.organization_id,'key',b.key,'display_name',b.display_name,'status',b.status
    ) order by b.display_name) from public.organization_branches b where b.status='active'),'[]'::jsonb),
    'offers',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object(
      'branch',jsonb_build_object('display_name',b.display_name,'key',b.key)
    ) order by b.display_name,o.product_key,o.currency_code)
      from public.fuel_branch_product_offers o
      join public.organization_branches b on b.id=o.branch_id),'[]'::jsonb),
    'managedPrices',coalesce((select jsonb_agg(to_jsonb(m) order by m.product_key,m.currency_code)
      from public.fuel_managed_product_prices m),'[]'::jsonb),
    'modeControls',coalesce((select jsonb_agg(to_jsonb(c) order by c.product_key,c.fulfillment_mode)
      from public.fuel_fulfillment_mode_controls c),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;

alter table public.fuel_managed_product_prices enable row level security;
alter table public.fuel_managed_product_price_events enable row level security;
alter table public.fuel_fulfillment_mode_controls enable row level security;

drop policy if exists fuel_managed_product_prices_read_enabled on public.fuel_managed_product_prices;
create policy fuel_managed_product_prices_read_enabled
on public.fuel_managed_product_prices for select to authenticated
using (
  (enabled and exists(select 1 from public.fuel_products product where product.key=product_key and product.status='enabled'))
  or public.can_manage_fuel_platform()
  or public.has_permission('platform.financial_policy.read',null)
  or public.has_permission('platform.revenue.read',null)
);

drop policy if exists fuel_managed_product_price_events_read_admin on public.fuel_managed_product_price_events;
create policy fuel_managed_product_price_events_read_admin
on public.fuel_managed_product_price_events for select to authenticated
using (public.can_manage_fuel_platform() or public.has_permission('platform.financial_policy.read',null));

drop policy if exists fuel_fulfillment_mode_controls_read_authenticated on public.fuel_fulfillment_mode_controls;
create policy fuel_fulfillment_mode_controls_read_authenticated
on public.fuel_fulfillment_mode_controls for select to authenticated
using (true);

grant select on public.fuel_managed_product_prices,public.fuel_managed_product_price_events,public.fuel_fulfillment_mode_controls to authenticated,service_role;

revoke all on function public.read_fuel_fulfillment_mode_controls() from public,anon;
revoke all on function public.set_fuel_fulfillment_mode_control(text,text,boolean,text,text) from public,anon;
revoke all on function public.configure_fuel_managed_product_price(text,text,numeric,boolean,text,text,jsonb) from public,anon;
revoke all on function public.configure_fuel_station_product_offer(uuid,uuid,text,text,numeric,numeric,numeric,text[],text,text) from public,anon;
revoke all on function public.configure_fuel_station_price_override(uuid,numeric,text,text) from public,anon;
revoke all on function public.read_fuel_admin_pricing_workspace() from public,anon;

grant execute on function public.read_fuel_fulfillment_mode_controls() to authenticated,service_role;
grant execute on function public.set_fuel_fulfillment_mode_control(text,text,boolean,text,text) to authenticated,service_role;
grant execute on function public.configure_fuel_managed_product_price(text,text,numeric,boolean,text,text,jsonb) to authenticated,service_role;
grant execute on function public.configure_fuel_station_product_offer(uuid,uuid,text,text,numeric,numeric,numeric,text[],text,text) to authenticated;
grant execute on function public.configure_fuel_station_price_override(uuid,numeric,text,text) to authenticated,service_role;
grant execute on function public.read_fuel_admin_pricing_workspace() to authenticated,service_role;

-- A station's local offer can never override the platform-wide product kill switch.
create or replace function public.enforce_fuel_branch_offer_global_controls()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.status='active' and not exists(
    select 1 from public.fuel_products product
    where product.key=new.product_key and product.status='enabled'
  ) then
    raise exception using errcode='55000',message='Fuel product is globally disabled by SKIMA and cannot be sold by any station';
  end if;
  return new;
end;
$$;

drop trigger if exists fuel_branch_offer_global_controls on public.fuel_branch_product_offers;
create trigger fuel_branch_offer_global_controls
before insert or update of status,product_key on public.fuel_branch_product_offers
for each row execute function public.enforce_fuel_branch_offer_global_controls();

-- Customer and quote reads are always filtered by the global product and
-- mode switches; branch offers remain station-owned and separate.
create or replace function public.fuel_managed_price_is_available(
  target_product_key text,
  target_currency_code text
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1 from public.fuel_managed_product_prices price
    where price.product_key=target_product_key
      and price.currency_code=target_currency_code
      and price.enabled
      and price.effective_from<=timezone('utc',now())
      and (price.effective_until is null or price.effective_until>timezone('utc',now()))
  );
$$;

-- The OTP verified event is the only authenticated-user route into Fuel
-- completion and settlement. All other automatic transitions still originate
-- from trusted stock/custody runtime events.
create or replace function public.fuel_delivery_challenge_is_verified(
  target_order_id uuid,
  target_challenge_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.otp_challenges challenge
    join public.order_records order_record on order_record.id=target_order_id
    join public.fuel_order_operations operation on operation.order_id=order_record.id
    where challenge.id=target_challenge_id
      and challenge.purpose='fuel.delivery.verification'
      and challenge.status='verified'
      and challenge.user_id=order_record.requester_user_id
      and operation.delivery_challenge_id=challenge.id
      and challenge.metadata->>'fuel_order_id'=order_record.id::text
      and challenge.metadata->>'module_key'='fuel'
  );
$$;

create or replace function public.can_advance_fuel_order_from_verified_otp(target_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select pg_trigger_depth()>0 and exists(
    select 1 from public.fuel_order_operations operation
    where operation.order_id=target_order_id
      and operation.stage_key='delivered'
      and operation.delivery_challenge_id is not null
      and public.fuel_delivery_challenge_is_verified(target_order_id,operation.delivery_challenge_id)
  );
$$;

create or replace function public.can_complete_fuel_delivery_settlement(target_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select pg_trigger_depth()>0 and exists(
    select 1 from public.fuel_order_operations operation
    where operation.order_id=target_order_id
      and operation.stage_key='completed'
      and operation.delivery_verified_at is not null
      and operation.delivery_challenge_id is not null
      and public.fuel_delivery_challenge_is_verified(target_order_id,operation.delivery_challenge_id)
      and operation.settlement_execution_id is null
  );
$$;

create or replace function public.can_settle_verified_fuel_service_request(target_service_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select pg_trigger_depth()>0 and exists(
    select 1
    from public.order_records order_record
    join public.fuel_order_operations operation on operation.order_id=order_record.id
    where order_record.service_request_id=target_service_request_id
      and operation.stage_key='completed'
      and operation.delivery_verified_at is not null
      and operation.delivery_challenge_id is not null
      and public.fuel_delivery_challenge_is_verified(order_record.id,operation.delivery_challenge_id)
      and operation.settlement_execution_id is null
  );
$$;

create or replace function public.can_post_verified_fuel_financial_transaction(
  target_subject_type text,
  target_subject_id uuid,
  target_source text,
  target_metadata jsonb
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select target_subject_type='service_request'
     and target_source='fuel.settlement_engine'
     and pg_trigger_depth()>0
     and exists(
       select 1
       from public.order_records order_record
       join public.fuel_order_operations operation on operation.order_id=order_record.id
       where order_record.service_request_id=target_subject_id
         and order_record.id::text=target_metadata->>'fuel_order_id'
         and operation.stage_key='completed'
         and operation.delivery_verified_at is not null
         and operation.delivery_challenge_id is not null
         and public.fuel_delivery_challenge_is_verified(order_record.id,operation.delivery_challenge_id)
         and operation.settlement_execution_id is null
     );
$$;

create or replace function public.can_create_fuel_verified_settlement_wallet(
  target_wallet_type text,
  target_owner_entity_type text,
  target_owner_entity_id uuid,
  target_currency_code text,
  target_source text,
  target_metadata jsonb
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select target_source='fuel.settlement_engine'
     and pg_trigger_depth()>0
     and exists(
       select 1
       from public.order_records order_record
       join public.fuel_order_operations operation on operation.order_id=order_record.id
       join public.organization_branches branch on branch.id=operation.station_branch_id
       left join public.order_assignments assignment
         on assignment.order_id=operation.order_id
        and assignment.participant_role='driver'
        and assignment.entity_type='driver'
        and assignment.status in ('active','completed')
       where order_record.id::text=target_metadata->>'fuel_order_id'
         and order_record.currency_code=target_currency_code
         and operation.stage_key='completed'
         and operation.delivery_verified_at is not null
         and operation.delivery_challenge_id is not null
         and operation.settlement_execution_id is null
         and public.fuel_delivery_challenge_is_verified(order_record.id,operation.delivery_challenge_id)
         and (
           (target_wallet_type='partner'
             and target_owner_entity_type='organization'
             and target_owner_entity_id=branch.organization_id)
           or
           (target_wallet_type='driver'
             and target_owner_entity_type='driver'
             and target_owner_entity_id=assignment.entity_id)
         )
     );
$$;

-- Replace only the authorization clauses in shared financial functions, with
-- a narrowly scoped exception for the signed-in customer's verified Fuel OTP.


create or replace function public.request_fuel_delivery_challenge(
  target_order_id uuid,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  order_record public.order_records%rowtype;
  operation_record public.fuel_order_operations%rowtype;
  user_record auth.users%rowtype;
  challenge_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='Customer authentication is required for Fuel delivery verification';
  end if;
  if target_order_id is null
     or coalesce(btrim(target_idempotency_key),'')=''
     or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='Fuel order, idempotency key and object metadata are required';
  end if;

  select * into order_record
  from public.order_records
  where id=target_order_id
  for update;
  if not found or not exists(
    select 1 from public.business_modules module
    where module.id=order_record.module_id and module.key='fuel'
  ) then
    raise exception using errcode='P0002',message='Fuel order was not found';
  end if;
  if order_record.requester_user_id is distinct from auth.uid() then
    raise exception using errcode='42501',message='Only the customer who placed this Fuel order can verify its delivery';
  end if;

  select * into operation_record
  from public.fuel_order_operations
  where order_id=target_order_id
  for update;
  if not found or operation_record.stage_key<>'delivered' then
    raise exception using errcode='55000',message='Fuel delivery must be recorded by the assigned driver before the customer can verify it';
  end if;
  if operation_record.delivery_verified_at is not null then
    raise exception using errcode='55000',message='This Fuel delivery has already been verified by the customer';
  end if;

  select * into user_record from auth.users where id=auth.uid();
  if not found or user_record.email is null or user_record.email_confirmed_at is null then
    raise exception using errcode='55000',message='A verified account email is required for Fuel delivery verification';
  end if;

  select challenge.id into challenge_id
  from public.otp_challenges challenge
  where challenge.user_id=auth.uid()
    and challenge.purpose='fuel.delivery.verification'
    and challenge.status='pending'
    and challenge.expires_at>timezone('utc',now())
    and challenge.metadata->>'fuel_order_id'=target_order_id::text
    and challenge.metadata->>'module_key'='fuel'
  order by challenge.created_at desc
  limit 1;

  if challenge_id is null then
    challenge_id:=public.request_otp_challenge(
      'fuel.delivery.verification',
      'in_app',
      user_record.email,
      600,
      5,
      'platform.fuel.otp',
      target_idempotency_key,
      target_metadata||jsonb_build_object(
        'module_key','fuel',
        'fuel_order_id',target_order_id,
        'service_request_id',order_record.service_request_id,
        'delivery_stage','delivered'
      )
    );
  end if;

  update public.fuel_order_operations
  set delivery_challenge_id=challenge_id,
      updated_at=timezone('utc',now())
  where order_id=target_order_id;

  return jsonb_build_object(
    'challenge_id',challenge_id,
    'purpose','fuel.delivery.verification',
    'channel','in_app',
    'expires_in_seconds',600
  );
end;
$$;

create or replace function public.verify_fuel_delivery_challenge(
  target_order_id uuid,
  target_challenge_id uuid,
  target_code text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  order_record public.order_records%rowtype;
  operation_record public.fuel_order_operations%rowtype;
  challenge_record public.otp_challenges%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='Customer authentication is required for Fuel delivery verification';
  end if;
  select * into order_record from public.order_records where id=target_order_id for update;
  select * into operation_record from public.fuel_order_operations where order_id=target_order_id for update;
  select * into challenge_record from public.otp_challenges where id=target_challenge_id;
  if order_record.id is null or operation_record.order_id is null or challenge_record.id is null
     or order_record.requester_user_id is distinct from auth.uid()
     or operation_record.delivery_challenge_id is distinct from target_challenge_id
     or operation_record.stage_key<>'delivered'
     or challenge_record.user_id is distinct from auth.uid()
     or challenge_record.purpose<>'fuel.delivery.verification'
     or challenge_record.metadata->>'fuel_order_id'<>target_order_id::text
     or challenge_record.metadata->>'module_key'<>'fuel' then
    raise exception using errcode='42501',message='This one-time code is not valid for the current customer Fuel delivery';
  end if;
  if challenge_record.status='verified' then return challenge_record.id; end if;

  return public.verify_otp_challenge(
    target_challenge_id,
    target_code,
    target_idempotency_key,
    target_metadata||jsonb_build_object('module_key','fuel','fuel_order_id',target_order_id)
  );
end;
$$;

create or replace function public.complete_fuel_delivery_on_verified_otp()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  order_record public.order_records%rowtype;
  operation_record public.fuel_order_operations%rowtype;
  next_stage text;
begin
  if new.purpose<>'fuel.delivery.verification'
     or new.status<>'verified'
     or old.status='verified' then
    return new;
  end if;
  if new.metadata->>'module_key'<>'fuel'
     or nullif(new.metadata->>'fuel_order_id','') is null then
    return new;
  end if;

  select * into order_record
  from public.order_records
  where id=(new.metadata->>'fuel_order_id')::uuid;
  if not found or order_record.requester_user_id is distinct from new.user_id
     or not exists(select 1 from public.business_modules module where module.id=order_record.module_id and module.key='fuel') then
    return new;
  end if;

  select * into operation_record
  from public.fuel_order_operations
  where order_id=order_record.id
  for update;
  if not found
     or operation_record.delivery_challenge_id is distinct from new.id
     or operation_record.stage_key<>'delivered'
     or operation_record.delivery_verified_at is not null
     or not public.fuel_delivery_challenge_is_verified(order_record.id,new.id) then
    return new;
  end if;

  next_stage:=case when operation_record.container_mode='rental' then 'return_due' else 'completed' end;

  update public.fuel_order_operations
  set delivery_verified_at=timezone('utc',now()),
      metadata=metadata||jsonb_build_object(
        'customer_delivery_verified',true,
        'delivery_challenge_id',new.id,
        'delivery_verified_at',timezone('utc',now())
      ),
      updated_at=timezone('utc',now())
  where order_id=order_record.id;

  perform public.record_fuel_order_stage(
    order_record.id,
    next_stage,
    'fuel-customer-otp:'||order_record.id::text||':'||new.id::text,
    'Customer verified the complete Fuel delivery with the order-specific OTP',
    jsonb_build_object('verification','customer_otp','challenge_id',new.id,'rental_container_return_required',operation_record.container_mode='rental')
  );
  return new;
end;
$$;

drop trigger if exists fuel_delivery_otp_auto_completion on public.otp_challenges;
create trigger fuel_delivery_otp_auto_completion
after update of status on public.otp_challenges
for each row execute function public.complete_fuel_delivery_on_verified_otp();

revoke all on function public.complete_fuel_delivery_on_verified_otp() from public,anon,authenticated;
revoke all on function public.request_fuel_delivery_challenge(uuid,text,jsonb) from public,anon;
revoke all on function public.verify_fuel_delivery_challenge(uuid,uuid,text,text,jsonb) from public,anon;
grant execute on function public.request_fuel_delivery_challenge(uuid,text,jsonb) to authenticated,service_role;
grant execute on function public.verify_fuel_delivery_challenge(uuid,uuid,text,text,jsonb) to authenticated,service_role;

-- Automatic progression: staff record real operational events once; these
-- database triggers advance the order as soon as the entire prerequisite set
-- is satisfied, so there is no duplicate "advance stage" button.
create or replace function public.advance_fuel_order_after_stock_reservation()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  operation_record public.fuel_order_operations%rowtype;
  reserved_total numeric(16,3);
  order_id_value uuid;
begin
  order_id_value:=coalesce(new.order_id,old.order_id);
  select * into operation_record from public.fuel_order_operations where order_id=order_id_value for update;
  if not found or operation_record.stage_key<>'awaiting_station_acceptance' then return new; end if;

  select coalesce(sum(greatest(reservation.reserved_litres-reservation.consumed_litres,0)),0)
  into reserved_total
  from public.fuel_order_stock_reservations reservation
  where reservation.order_id=order_id_value
    and reservation.status in ('reserved','partially_consumed','consumed');

  if reserved_total+coalesce(operation_record.filled_litres,0)>=operation_record.requested_litres-0.001 then
    perform public.record_fuel_order_stage(
      order_id_value,'stock_reserved','fuel-auto-stock-reserved:'||order_id_value::text,
      'Full ordered quantity reserved from station stock',
      jsonb_build_object('progression','stock_reservation_complete','automatic',true)
    );
    perform public.record_fuel_order_stage(
      order_id_value,'station_filling','fuel-auto-station-filling:'||order_id_value::text,
      'Station stock is reserved; station filling can begin',
      jsonb_build_object('progression','stock_reservation_complete','automatic',true)
    );
  end if;
  return new;
end;
$$;

create or replace function public.advance_fuel_order_after_station_preparation()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  order_id_value uuid;
  operation_record public.fuel_order_operations%rowtype;
  prepared_count integer;
  prepared_litres numeric(16,3);
  consumed_litres numeric(16,3);
  quote_record public.fuel_order_commercial_snapshots%rowtype;
  allocated_container_amount numeric(20,8);
  allocated_deposit_amount numeric(20,8);
begin
  order_id_value:=coalesce(new.order_id,old.order_id);
  select * into operation_record from public.fuel_order_operations where order_id=order_id_value for update;
  if not found or operation_record.stage_key<>'station_filling' then return new; end if;

  select count(*),coalesce(sum(allocation.allocated_litres),0),
         coalesce(sum(case when allocation.allocation_mode='purchase' then allocation.purchase_amount else allocation.rental_amount end),0),
         coalesce(sum(allocation.refundable_deposit_amount),0)
  into prepared_count,prepared_litres,allocated_container_amount,allocated_deposit_amount
  from public.fuel_container_allocations allocation
  where allocation.order_id=order_id_value and allocation.status='station_prepared';

  select coalesce(sum(reservation.consumed_litres),0)
  into consumed_litres
  from public.fuel_order_stock_reservations reservation
  where reservation.order_id=order_id_value
    and reservation.status in ('consumed','partially_consumed');

  if prepared_count<>operation_record.container_count
     or prepared_litres<operation_record.requested_litres-0.001
     or abs(coalesce(operation_record.filled_litres,0)-operation_record.requested_litres)>0.001
     or consumed_litres<operation_record.requested_litres-0.001 then
    return new;
  end if;

  select * into quote_record
  from public.fuel_order_commercial_snapshots
  where order_id=order_id_value and status='accepted';
  if not found
     or abs(allocated_container_amount-quote_record.container_amount)>0.001
     or abs(allocated_deposit_amount-quote_record.refundable_deposit_amount)>0.001 then
    return new;
  end if;

  perform public.record_fuel_order_stage(
    order_id_value,'ready_for_driver','fuel-auto-ready-for-driver:'||order_id_value::text,
    'All ordered litres and containers are filled, measured and reconciled',
    jsonb_build_object('progression','station_preparation_complete','automatic',true)
  );
  return new;
end;
$$;

create or replace function public.advance_fuel_order_after_driver_handover()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  order_id_value uuid;
  operation_record public.fuel_order_operations%rowtype;
  with_driver_count integer;
begin
  order_id_value:=coalesce(new.order_id,old.order_id);
  select * into operation_record from public.fuel_order_operations where order_id=order_id_value for update;
  if not found or operation_record.stage_key<>'driver_assigned' then return new; end if;

  select count(*) into with_driver_count
  from public.fuel_container_allocations allocation
  where allocation.order_id=order_id_value and allocation.status='with_driver';

  if with_driver_count<>operation_record.container_count then return new; end if;

  if not exists(
    select 1 from public.order_assignments assignment
    where assignment.order_id=order_id_value
      and assignment.participant_role='driver'
      and assignment.entity_type='driver'
      and assignment.status='active'
  ) then return new; end if;

  perform public.record_fuel_order_stage(
    order_id_value,'station_handover','fuel-auto-station-handover:'||order_id_value::text,
    'The station recorded custody transfer of every filled container to the assigned driver',
    jsonb_build_object('progression','station_driver_handover_complete','automatic',true)
  );
  perform public.record_fuel_order_stage(
    order_id_value,'out_for_delivery','fuel-auto-out-for-delivery:'||order_id_value::text,
    'The full filled order is with the assigned driver and is out for delivery',
    jsonb_build_object('progression','station_driver_handover_complete','automatic',true)
  );
  return new;
end;
$$;

create or replace function public.complete_fuel_rental_after_station_inspection()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.stage_key='inspection_passed'
     and old.stage_key is distinct from new.stage_key
     and new.container_mode='rental'
     and new.delivery_verified_at is not null then
    perform public.record_fuel_order_stage(
      new.order_id,'completed','fuel-auto-rental-completed:'||new.order_id::text,
      'All returned rental containers passed station inspection',
      jsonb_build_object('progression','station_rental_inspection_complete','automatic',true)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists fuel_auto_progress_after_reservation_insert on public.fuel_order_stock_reservations;
create trigger fuel_auto_progress_after_reservation_insert
after insert or update of reserved_litres,consumed_litres,status on public.fuel_order_stock_reservations
for each row execute function public.advance_fuel_order_after_stock_reservation();

drop trigger if exists fuel_auto_progress_after_station_fill on public.fuel_container_allocations;
create trigger fuel_auto_progress_after_station_fill
after insert or update of status,filled_litres on public.fuel_container_allocations
for each row execute function public.advance_fuel_order_after_station_preparation();

drop trigger if exists fuel_auto_progress_after_stock_consumption on public.fuel_order_stock_reservations;
create trigger fuel_auto_progress_after_stock_consumption
after update of consumed_litres,status on public.fuel_order_stock_reservations
for each row execute function public.advance_fuel_order_after_station_preparation();

drop trigger if exists fuel_auto_progress_after_driver_handover on public.fuel_container_allocations;
create trigger fuel_auto_progress_after_driver_handover
after update of status on public.fuel_container_allocations
for each row execute function public.advance_fuel_order_after_driver_handover();

drop trigger if exists fuel_auto_complete_rental_after_inspection on public.fuel_order_operations;
create trigger fuel_auto_complete_rental_after_inspection
after update of stage_key on public.fuel_order_operations
for each row execute function public.complete_fuel_rental_after_station_inspection();

-- The driver records physical delivery once. Settlement remains blocked until
-- the customer verifies the order-specific OTP.
do $patch$
declare
  function_sql text;
  old_block text;
  new_block text;
begin
  select pg_get_functiondef('public.confirm_fuel_customer_delivery(uuid,uuid,numeric,text,jsonb)'::regprocedure) into function_sql;
  old_block:=$old$  if operation_record.container_mode='rental' then
    perform public.record_fuel_order_stage(
      target_order_id,
      'return_due',
      target_idempotency_key||':stage-return-due',
      'Rental containers must be returned by the customer to the assigned driver',
      target_metadata||jsonb_build_object('rental_container_return_required',true)
    );
  else
    perform public.record_fuel_order_stage(
      target_order_id,
      'completed',
      target_idempotency_key||':stage-completed',
      'Purchased containers delivered and ownership transferred',
      target_metadata||jsonb_build_object('driver_delivery_completed',true)
    );
  end if;$old$;
  new_block:=$new$  -- Do not close or settle here. The customer OTP trigger moves
  -- purchased orders to completed and rentals to return_due.
  null;$new$;
  if position(old_block in function_sql)=0 then raise exception 'Fuel driver delivery completion block changed; refusing an unsafe patch'; end if;
  execute replace(function_sql,old_block,new_block);
end;
$patch$;

-- Use separate retail and supplier values for SKIMA Managed. For station and
-- independent modes, the station's price (or a platform override) is both the
-- customer fuel price and station principal. For SKIMA Managed, the platform
-- retail price is charged while the station receives its own supply price.
do $patch$
declare
  function_sql text;
  old_decl text;
  new_decl text;
  old_price text;
  new_price text;
  old_snapshot text;
  new_snapshot text;
begin
  select pg_get_functiondef('public.create_fuel_commercial_quote(uuid,text,jsonb)'::regprocedure) into function_sql;
  old_decl:=$old$  admin_product_fee_amount numeric(20,8):=0;$old$;
  new_decl:=$new$  admin_product_fee_amount numeric(20,8):=0;
  customer_unit_price numeric(20,8);
  station_supply_unit_price numeric(20,8);
  station_supply_amount numeric(20,8);
  managed_product_margin_amount numeric(20,8):=0;
  mode_is_enabled boolean;$new$;
  if position(old_decl in function_sql)=0 then raise exception 'Fuel quote declarations changed; refusing an unsafe patch'; end if;
  function_sql:=replace(function_sql,old_decl,new_decl);

  old_price:=$old$  fuel_amount:=round(operation_record.requested_litres*offer_record.price_per_litre,currency_decimals);$old$;
  new_price:=$new$  select control.enabled into mode_is_enabled
  from public.fuel_fulfillment_mode_controls control
  where control.product_key=operation_record.product_key
    and control.fulfillment_mode=operation_record.fulfillment_mode;
  if not found or not mode_is_enabled then
    raise exception using errcode='55000',message='This Fuel fulfillment mode is currently disabled by SKIMA';
  end if;

  station_supply_unit_price:=coalesce(offer_record.admin_override_price_per_litre,offer_record.price_per_litre);
  if operation_record.fulfillment_mode='skima_managed' then
    select managed.price_per_litre into customer_unit_price
    from public.fuel_managed_product_prices managed
    where managed.product_key=operation_record.product_key
      and managed.currency_code=order_record.currency_code
      and managed.enabled
      and managed.effective_from<=now_value
      and (managed.effective_until is null or managed.effective_until>now_value)
    for share;
    if not found then
      raise exception using errcode='55000',message='SKIMA Managed retail pricing has not been configured for this Fuel product and currency';
    end if;
    if customer_unit_price<station_supply_unit_price then
      raise exception using errcode='23514',message='SKIMA Managed retail price cannot be below the current station supply price';
    end if;
  else
    customer_unit_price:=station_supply_unit_price;
  end if;
  fuel_amount:=round(operation_record.requested_litres*customer_unit_price,currency_decimals);
  station_supply_amount:=round(operation_record.requested_litres*station_supply_unit_price,currency_decimals);
  managed_product_margin_amount:=case when operation_record.fulfillment_mode='skima_managed'
    then round(fuel_amount-station_supply_amount,currency_decimals) else 0 end;$new$;
  if position(old_price in function_sql)=0 then raise exception 'Fuel quote price calculation changed; refusing an unsafe patch'; end if;
  function_sql:=replace(function_sql,old_price,new_price);

  old_snapshot:=$old$    'fuel_unit_price',offer_record.price_per_litre,
    'fuel_amount',fuel_amount,$old$;
  new_snapshot:=$new$    'fuel_unit_price',customer_unit_price,
    'fuel_amount',fuel_amount,
    'station_supply_unit_price',station_supply_unit_price,
    'station_supply_amount',station_supply_amount,
    'managed_product_margin_amount',managed_product_margin_amount,
    'pricing_owner',case when operation_record.fulfillment_mode='skima_managed' then 'skima_platform' else 'station' end,$new$;
  if position(old_snapshot in function_sql)=0 then raise exception 'Fuel quote snapshot changed; refusing an unsafe patch'; end if;
  function_sql:=replace(function_sql,old_snapshot,new_snapshot);
  execute function_sql;
end;
$patch$;

-- Settlement pays the station's snapshotted supply amount, not the SKIMA
-- Managed retail price. The retail/supply spread becomes SKIMA revenue.
do $patch$
declare
  function_sql text;
  old_decl text;
  new_decl text;
  old_calc text;
  new_calc text;
  old_station_meta text;
  new_station_meta text;
  old_wallet_meta text;
  new_wallet_meta text;
begin
  select pg_get_functiondef('public.settle_fuel_order(uuid,text,jsonb)'::regprocedure) into function_sql;
  old_decl:=$old$  platform_revenue_amount numeric(28,8);$old$;
  new_decl:=$new$  platform_revenue_amount numeric(28,8);
  managed_product_margin_amount numeric(28,8):=0;
  station_supply_amount numeric(28,8);$new$;
  if position(old_decl in function_sql)=0 then raise exception 'Fuel settlement declarations changed; refusing an unsafe patch'; end if;
  function_sql:=replace(function_sql,old_decl,new_decl);

  old_calc:=$old$  station_payout_amount := quote_record.fuel_amount;
  driver_payout_amount := 0;$old$;
  new_calc:=$new$  station_supply_amount:=coalesce(
    nullif(quote_record.component_snapshot->>'station_supply_amount','')::numeric,
    quote_record.fuel_amount
  );
  managed_product_margin_amount:=coalesce(
    nullif(quote_record.component_snapshot->>'managed_product_margin_amount','')::numeric,
    0
  );
  station_payout_amount := station_supply_amount;
  driver_payout_amount := 0;$new$;
  if position(old_calc in function_sql)=0 then raise exception 'Fuel station payout calculation changed; refusing an unsafe patch'; end if;
  function_sql:=replace(function_sql,old_calc,new_calc);

  old_calc:=$old$  platform_revenue_amount := quote_record.container_amount+quote_record.platform_fee_amount;$old$;
  new_calc:=$new$  platform_revenue_amount := quote_record.container_amount+quote_record.platform_fee_amount+managed_product_margin_amount;$new$;
  if position(old_calc in function_sql)=0 then raise exception 'Fuel platform revenue calculation changed; refusing an unsafe patch'; end if;
  function_sql:=replace(function_sql,old_calc,new_calc);

  old_wallet_meta:=$old$jsonb_build_object('wallet_purpose','fuel_station_settlement','station_branch_id',operation_record.station_branch_id)$old$;
  new_wallet_meta:=$new$jsonb_build_object('wallet_purpose','fuel_station_settlement','station_branch_id',operation_record.station_branch_id,'fuel_order_id',target_order_id)$new$;
  if position(old_wallet_meta in function_sql)=0 then raise exception 'Fuel station wallet metadata changed; refusing an unsafe patch'; end if;
  function_sql:=replace(function_sql,old_wallet_meta,new_wallet_meta);

  old_wallet_meta:=$old$jsonb_build_object('wallet_purpose','fuel_delivery_earnings','driver_profile_id',driver_profile_record.id)$old$;
  new_wallet_meta:=$new$jsonb_build_object('wallet_purpose','fuel_delivery_earnings','driver_profile_id',driver_profile_record.id,'fuel_order_id',target_order_id)$new$;
  if position(old_wallet_meta in function_sql)=0 then raise exception 'Fuel driver wallet metadata changed; refusing an unsafe patch'; end if;
  function_sql:=replace(function_sql,old_wallet_meta,new_wallet_meta);
  execute function_sql;
end;
$patch$;

-- Trigger nesting is deliberately scoped to the OTP-verified Fuel order. No
-- customer receives general platform financial, settlement or wallet rights.
do $patch$
declare function_sql text; old_guard text; new_guard text;
begin
  select pg_get_functiondef('public.execute_service_request_settlement(uuid,uuid,jsonb,text,text,jsonb)'::regprocedure) into function_sql;
  old_guard:=$old$  if auth.role() <> 'service_role'
    and not public.has_permission('platform.settlement.execute', null)
    and not public.can_execute_platform_runtime() then
    raise exception 'settlement execution permission is required';
  end if;$old$;
  new_guard:=$new$  if auth.role() <> 'service_role'
    and not public.has_permission('platform.settlement.execute', null)
    and not public.can_execute_platform_runtime()
    and not public.can_settle_verified_fuel_service_request(target_service_request_id) then
    raise exception 'settlement execution permission is required';
  end if;$new$;
  if position(old_guard in function_sql)=0 then raise exception 'execute_service_request_settlement authorization changed; refusing an unsafe patch'; end if;
  execute replace(function_sql,old_guard,new_guard);

  select pg_get_functiondef('public.post_financial_transaction(text,text,text,text,uuid,jsonb,text,uuid,text,jsonb,jsonb)'::regprocedure) into function_sql;
  old_guard:=$old$    ) then
    raise exception 'platform financial management permission is required';
  end if;$old$;
  new_guard:=$new$      or public.can_post_verified_fuel_financial_transaction(
        target_subject_type,target_subject_id,target_source,target_metadata
      )
    ) then
    raise exception 'platform financial management permission is required';
  end if;$new$;
  if position(old_guard in function_sql)=0 then raise exception 'post_financial_transaction authorization changed; refusing an unsafe patch'; end if;
  execute replace(function_sql,old_guard,new_guard);

  select pg_get_functiondef('public.ensure_wallet_account(text,text,uuid,text,text,jsonb,text)'::regprocedure) into function_sql;
  old_guard:=$old$  if auth.role() <> 'service_role'
    and not public.has_permission('platform.wallets.manage', null)
    and not can_create_self_wallet
    and not can_create_driver_wallet then
    raise exception 'platform wallet management permission is required';
  end if;$old$;
  new_guard:=$new$  if auth.role() <> 'service_role'
    and not public.has_permission('platform.wallets.manage', null)
    and not can_create_self_wallet
    and not can_create_driver_wallet
    and not public.can_create_fuel_verified_settlement_wallet(
      target_wallet_type,target_owner_entity_type,target_owner_entity_id,
      target_currency_code,target_source,target_metadata
    ) then
    raise exception 'platform wallet management permission is required';
  end if;$new$;
  if position(old_guard in function_sql)=0 then raise exception 'ensure_wallet_account authorization changed; refusing an unsafe patch'; end if;
  execute replace(function_sql,old_guard,new_guard);
end;
$patch$;

-- No second status click after the station has measured and handed over fuel.
-- The existing service-side stage calls are removed; triggers now own them.


create or replace function public.advance_fuel_order_after_stock_reservation()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  operation_record public.fuel_order_operations%rowtype;
  reserved_total numeric(16,3);
  order_id_value uuid;
begin
  order_id_value:=coalesce(new.order_id,old.order_id);
  select * into operation_record from public.fuel_order_operations where order_id=order_id_value for update;
  if not found or operation_record.stage_key<>'awaiting_station_acceptance' then return new; end if;
  select coalesce(sum(greatest(reservation.reserved_litres-reservation.consumed_litres,0)),0)
  into reserved_total
  from public.fuel_order_stock_reservations reservation
  where reservation.order_id=order_id_value
    and reservation.status in ('reserved','partially_consumed','consumed');
  if reserved_total+coalesce(operation_record.filled_litres,0)>=operation_record.requested_litres-0.001 then
    perform public.record_fuel_order_stage(order_id_value,'stock_reserved','fuel-auto-stock-reserved:'||order_id_value::text,
      'Full ordered quantity reserved from station stock',jsonb_build_object('progression','stock_reservation_complete','automatic',true));
    perform public.record_fuel_order_stage(order_id_value,'station_filling','fuel-auto-station-filling:'||order_id_value::text,
      'Station stock is reserved; station filling can begin',jsonb_build_object('progression','stock_reservation_complete','automatic',true));
  end if;
  return new;
end;
$$;

create or replace function public.advance_fuel_order_after_station_preparation()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  order_id_value uuid;
  operation_record public.fuel_order_operations%rowtype;
  prepared_count integer;
  prepared_litres numeric(16,3);
  consumed_litres numeric(16,3);
  quote_record public.fuel_order_commercial_snapshots%rowtype;
  allocated_container_amount numeric(20,8);
  allocated_deposit_amount numeric(20,8);
begin
  order_id_value:=coalesce(new.order_id,old.order_id);
  select * into operation_record from public.fuel_order_operations where order_id=order_id_value for update;
  if not found or operation_record.stage_key<>'station_filling' then return new; end if;
  select count(*),coalesce(sum(allocation.allocated_litres),0),
         coalesce(sum(case when allocation.allocation_mode='purchase' then allocation.purchase_amount else allocation.rental_amount end),0),
         coalesce(sum(allocation.refundable_deposit_amount),0)
  into prepared_count,prepared_litres,allocated_container_amount,allocated_deposit_amount
  from public.fuel_container_allocations allocation
  where allocation.order_id=order_id_value and allocation.status='station_prepared';
  select coalesce(sum(reservation.consumed_litres),0) into consumed_litres
  from public.fuel_order_stock_reservations reservation
  where reservation.order_id=order_id_value and reservation.status in ('consumed','partially_consumed');
  if prepared_count<>operation_record.container_count
     or prepared_litres<operation_record.requested_litres-0.001
     or abs(coalesce(operation_record.filled_litres,0)-operation_record.requested_litres)>0.001
     or consumed_litres<operation_record.requested_litres-0.001 then
    return new;
  end if;
  select * into quote_record from public.fuel_order_commercial_snapshots
  where order_id=order_id_value and status='accepted';
  if not found
     or abs(allocated_container_amount-quote_record.container_amount)>0.001
     or abs(allocated_deposit_amount-quote_record.refundable_deposit_amount)>0.001 then
    return new;
  end if;
  perform public.record_fuel_order_stage(order_id_value,'ready_for_driver','fuel-auto-ready-for-driver:'||order_id_value::text,
    'All ordered litres and containers are filled, measured and reconciled',
    jsonb_build_object('progression','station_preparation_complete','automatic',true));
  return new;
end;
$$;

create or replace function public.advance_fuel_order_after_driver_handover()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  order_id_value uuid;
  operation_record public.fuel_order_operations%rowtype;
  with_driver_count integer;
begin
  order_id_value:=coalesce(new.order_id,old.order_id);
  select * into operation_record from public.fuel_order_operations where order_id=order_id_value for update;
  if not found or operation_record.stage_key<>'driver_assigned' then return new; end if;
  select count(*) into with_driver_count from public.fuel_container_allocations allocation
  where allocation.order_id=order_id_value and allocation.status='with_driver';
  if with_driver_count<>operation_record.container_count then return new; end if;
  if not exists(select 1 from public.order_assignments assignment where assignment.order_id=order_id_value
      and assignment.participant_role='driver' and assignment.entity_type='driver' and assignment.status='active') then
    return new;
  end if;
  perform public.record_fuel_order_stage(order_id_value,'station_handover','fuel-auto-station-handover:'||order_id_value::text,
    'The station recorded custody transfer of every filled container to the assigned driver',
    jsonb_build_object('progression','station_driver_handover_complete','automatic',true));
  perform public.record_fuel_order_stage(order_id_value,'out_for_delivery','fuel-auto-out-for-delivery:'||order_id_value::text,
    'The full filled order is with the assigned driver and is out for delivery',
    jsonb_build_object('progression','station_driver_handover_complete','automatic',true));
  return new;
end;
$$;

create or replace function public.complete_fuel_rental_after_station_inspection()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.stage_key='inspection_passed' and old.stage_key is distinct from new.stage_key
     and new.container_mode='rental' and new.delivery_verified_at is not null then
    perform public.record_fuel_order_stage(new.order_id,'completed','fuel-auto-rental-completed:'||new.order_id::text,
      'All returned rental containers passed station inspection',
      jsonb_build_object('progression','station_rental_inspection_complete','automatic',true));
  end if;
  return new;
end;
$$;

drop trigger if exists fuel_auto_progress_after_reservation_insert on public.fuel_order_stock_reservations;
create trigger fuel_auto_progress_after_reservation_insert
after insert or update of reserved_litres,consumed_litres,status on public.fuel_order_stock_reservations
for each row execute function public.advance_fuel_order_after_stock_reservation();

drop trigger if exists fuel_auto_progress_after_station_fill on public.fuel_container_allocations;
create trigger fuel_auto_progress_after_station_fill
after insert or update of status,filled_litres on public.fuel_container_allocations
for each row execute function public.advance_fuel_order_after_station_preparation();

drop trigger if exists fuel_auto_progress_after_driver_handover on public.fuel_container_allocations;
create trigger fuel_auto_progress_after_driver_handover
after update of status on public.fuel_container_allocations
for each row execute function public.advance_fuel_order_after_driver_handover();

drop trigger if exists fuel_auto_complete_rental_after_inspection on public.fuel_order_operations;
create trigger fuel_auto_complete_rental_after_inspection
after update of stage_key on public.fuel_order_operations
for each row execute function public.complete_fuel_rental_after_station_inspection();

create index if not exists fuel_order_operations_delivery_verification_idx
  on public.fuel_order_operations(delivery_challenge_id,delivery_verified_at,stage_key);

notify pgrst,'reload schema';
commit;
