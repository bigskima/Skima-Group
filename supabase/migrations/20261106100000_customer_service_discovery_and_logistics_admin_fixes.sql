begin;

create table if not exists public.customer_service_discovery_links (
  service_key text primary key check (service_key ~ '^[a-z][a-z0-9_:-]{1,80}$'),
  display_name text not null,
  description text not null default '',
  web_url text not null check (web_url ~ '^https?://'),
  android_store_url text check (android_store_url is null or android_store_url ~ '^https?://'),
  ios_store_url text check (ios_store_url is null or ios_store_url ~ '^https?://'),
  is_active boolean not null default true,
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references auth.users(id)
);

alter table public.customer_service_discovery_links enable row level security;

drop policy if exists customer_service_discovery_links_public_read on public.customer_service_discovery_links;
create policy customer_service_discovery_links_public_read
  on public.customer_service_discovery_links for select to anon, authenticated
  using (is_active = true);

drop policy if exists customer_service_discovery_links_super_admin_insert on public.customer_service_discovery_links;
create policy customer_service_discovery_links_super_admin_insert
  on public.customer_service_discovery_links for insert to authenticated
  with check (public.is_platform_super_admin());

drop policy if exists customer_service_discovery_links_super_admin_update on public.customer_service_discovery_links;
create policy customer_service_discovery_links_super_admin_update
  on public.customer_service_discovery_links for update to authenticated
  using (public.is_platform_super_admin())
  with check (public.is_platform_super_admin());

grant select on public.customer_service_discovery_links to anon, authenticated;
grant insert, update on public.customer_service_discovery_links to authenticated;

insert into public.customer_service_discovery_links
  (service_key, display_name, description, web_url, sort_order, metadata)
values
  ('refill', 'LPG Refill', 'Order a cylinder refill and delivery.', 'https://refills.skima.online/', 10, jsonb_build_object('product', 'refill')),
  ('logistics', 'Logistics', 'Find transport, delivery and other logistics services.', 'https://logistics.skima.online/', 20, jsonb_build_object('product', 'logistics')),
  ('store', 'Store', 'Shop products and everyday essentials.', 'https://store.skima.online/', 30, jsonb_build_object('product', 'store')),
  ('bills', 'Bills', 'Pay supported utility and service bills.', 'https://bills.skima.online/', 40, jsonb_build_object('product', 'bills'))
on conflict (service_key) do update
set display_name = excluded.display_name,
    description = excluded.description,
    web_url = excluded.web_url,
    is_active = true,
    sort_order = excluded.sort_order,
    android_store_url = coalesce(public.customer_service_discovery_links.android_store_url, excluded.android_store_url),
    ios_store_url = coalesce(public.customer_service_discovery_links.ios_store_url, excluded.ios_store_url),
    metadata = public.customer_service_discovery_links.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

create or replace function public.set_logistics_provider_verification(
  target_organization_id uuid,
  target_decision text,
  target_reason text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  provider_id uuid;
begin
  if not public.is_platform_super_admin() and not public.has_permission('logistics.marketplace.manage', null) then
    raise exception 'logistics marketplace administration permission is required';
  end if;
  if target_decision is null or target_decision not in ('verified', 'rejected', 'suspended') then
    raise exception 'verification decision is not supported';
  end if;
  if target_reason is null or char_length(btrim(target_reason)) < 5 then
    raise exception 'a verification reason is required';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'idempotency key is required';
  end if;

  update public.logistics_provider_profiles
  set verification_status = target_decision,
      operational_status = case
        when target_decision = 'verified' and operational_status = 'onboarding' then 'active'
        when target_decision in ('rejected', 'suspended') then 'suspended'
        else operational_status
      end,
      verified_by = case when target_decision = 'verified' then auth.uid() else verified_by end,
      verified_at = case when target_decision = 'verified' then timezone('utc', now()) else verified_at end,
      verification_reason = btrim(target_reason),
      updated_at = timezone('utc', now())
  where organization_id = target_organization_id
  returning id into provider_id;

  if provider_id is null then raise exception 'logistics provider company was not found'; end if;

  update public.organizations
  set status = case
        when target_decision = 'verified' then 'active'
        when target_decision = 'suspended' then 'suspended'
        else status
      end,
      updated_at = timezone('utc', now())
  where id = target_organization_id;

  if target_decision = 'verified' then
    update public.logistics_provider_services
    set status = 'active', updated_at = timezone('utc', now())
    where organization_id = target_organization_id and status = 'draft';
  end if;

  return provider_id;
end;
$$;

notify pgrst, 'reload schema';
commit;
