-- Customer-owned saved utility billers for the standalone SKIMA Bills experience.
create table if not exists public.utility_saved_beneficiaries (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.utility_products(id) on delete cascade,
  display_name text not null check (btrim(display_name) <> ''),
  customer_identifier text not null check (btrim(customer_identifier) <> ''),
  recipient_phone text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_user_id, product_id, customer_identifier)
);

create index if not exists utility_saved_beneficiaries_customer_updated_idx
  on public.utility_saved_beneficiaries (customer_user_id, updated_at desc);

alter table public.utility_saved_beneficiaries enable row level security;

create policy utility_saved_beneficiaries_owner_select
  on public.utility_saved_beneficiaries for select
  using (customer_user_id = auth.uid());

create policy utility_saved_beneficiaries_owner_insert
  on public.utility_saved_beneficiaries for insert
  with check (customer_user_id = auth.uid());

create policy utility_saved_beneficiaries_owner_update
  on public.utility_saved_beneficiaries for update
  using (customer_user_id = auth.uid())
  with check (customer_user_id = auth.uid());

create policy utility_saved_beneficiaries_owner_delete
  on public.utility_saved_beneficiaries for delete
  using (customer_user_id = auth.uid());

grant select, insert, update, delete on public.utility_saved_beneficiaries to authenticated;
