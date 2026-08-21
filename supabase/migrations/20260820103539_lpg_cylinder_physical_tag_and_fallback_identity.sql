begin;

-- A cylinder identity exists independently of a printable QR. The physical tag
-- lifecycle is additive to the existing SKIMA-owned public cylinder reference
-- and opaque digital QR credential.
alter table public.lpg_cylinders
add column if not exists tag_status text not null default 'untagged';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'lpg_cylinders_tag_status_check'
      and conrelid = 'public.lpg_cylinders'::regclass
  ) then
    alter table public.lpg_cylinders
      add constraint lpg_cylinders_tag_status_check
      check (tag_status in (
        'untagged',
        'tag_pending',
        'tagged',
        'tag_damaged',
        'tag_lost',
        'replacement_pending',
        'retired'
      ));
  end if;
end $$;

create or replace function public.sync_lpg_cylinder_tag_status_metadata()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.metadata := coalesce(new.metadata, '{}'::jsonb)
    || jsonb_build_object('physicalTagStatus', new.tag_status);
  return new;
end;
$$;

drop trigger if exists lpg_cylinders_sync_tag_status_metadata on public.lpg_cylinders;
create trigger lpg_cylinders_sync_tag_status_metadata
before insert or update of tag_status on public.lpg_cylinders
for each row execute function public.sync_lpg_cylinder_tag_status_metadata();

update public.lpg_cylinders
set metadata = coalesce(metadata, '{}'::jsonb)
  || jsonb_build_object('physicalTagStatus', tag_status)
where coalesce(metadata ->> 'physicalTagStatus', '') is distinct from tag_status;

create table if not exists public.lpg_cylinder_tags (
  id uuid primary key default gen_random_uuid(),
  cylinder_id uuid references public.lpg_cylinders(id) on delete restrict,
  public_tag_reference text not null unique
    check (public_tag_reference ~ '^SKTAG-[A-Z0-9]{8,24}$'),
  credential_hash text not null unique
    check (credential_hash ~ '^[a-f0-9]{64}$'),
  tag_type text not null default 'qr'
    check (tag_type in ('qr', 'nfc', 'barcode', 'other')),
  status text not null default 'issued'
    check (status in ('issued', 'assigned', 'active', 'damaged', 'lost', 'revoked', 'replaced', 'destroyed')),
  assigned_driver_profile_id uuid references public.driver_profiles(id) on delete set null,
  issued_at timestamptz not null default timezone('utc', now()),
  bound_at timestamptz,
  bound_by_user_id uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  revoked_by_user_id uuid references public.profiles(id) on delete set null,
  revocation_reason text,
  replaces_tag_id uuid references public.lpg_cylinder_tags(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists lpg_cylinder_tags_one_active_per_cylinder
on public.lpg_cylinder_tags (cylinder_id)
where cylinder_id is not null and status = 'active';

create index if not exists lpg_cylinder_tags_driver_status_idx
on public.lpg_cylinder_tags (assigned_driver_profile_id, status, created_at desc);

create index if not exists lpg_cylinder_tags_cylinder_history_idx
on public.lpg_cylinder_tags (cylinder_id, created_at desc);

create table if not exists public.lpg_cylinder_tag_history (
  id uuid primary key default gen_random_uuid(),
  tag_id uuid not null references public.lpg_cylinder_tags(id) on delete restrict,
  cylinder_id uuid references public.lpg_cylinders(id) on delete restrict,
  lpg_order_id uuid references public.lpg_refill_orders(id) on delete set null,
  driver_profile_id uuid references public.driver_profiles(id) on delete set null,
  station_branch_id uuid references public.lpg_station_branches(id) on delete set null,
  event_type text not null
    check (event_type in ('issued', 'assigned', 'bound', 'damaged', 'lost', 'revoked', 'replaced', 'destroyed')),
  from_status text,
  to_status text,
  reason text,
  actor_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (tag_id, idempotency_key)
);

create index if not exists lpg_cylinder_tag_history_cylinder_created_idx
on public.lpg_cylinder_tag_history (cylinder_id, created_at desc);

create index if not exists lpg_cylinder_tag_history_order_created_idx
on public.lpg_cylinder_tag_history (lpg_order_id, created_at desc)
where lpg_order_id is not null;

drop trigger if exists set_lpg_cylinder_tags_updated_at on public.lpg_cylinder_tags;
create trigger set_lpg_cylinder_tags_updated_at
before update on public.lpg_cylinder_tags
for each row execute function public.set_updated_at();

create or replace function public.hash_lpg_cylinder_tag_credential(target_credential text)
returns text
language sql
immutable
strict
set search_path = public, extensions, pg_temp
as $$
  select encode(extensions.digest(target_credential, 'sha256'), 'hex');
$$;

create or replace function public.issue_lpg_cylinder_tag(
  target_tag_type text default 'qr',
  target_assigned_driver_profile_id uuid default null,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  raw_credential text;
  tag_reference text;
  tag_id uuid;
  tag_status text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and not public.has_permission('lpg.cylinders.manage', null) then
    raise exception 'LPG cylinder management permission is required';
  end if;

  if target_tag_type not in ('qr', 'nfc', 'barcode', 'other') then
    raise exception 'target_tag_type is not supported';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  if target_assigned_driver_profile_id is not null
    and not exists (
      select 1 from public.driver_profiles driver
      where driver.id = target_assigned_driver_profile_id
    ) then
    raise exception 'target_assigned_driver_profile_id must reference a driver';
  end if;

  raw_credential := 'skima:tag:v1:' || encode(extensions.gen_random_bytes(24), 'hex');
  tag_reference := 'SKTAG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  tag_status := case when target_assigned_driver_profile_id is null then 'issued' else 'assigned' end;

  insert into public.lpg_cylinder_tags (
    public_tag_reference,
    credential_hash,
    tag_type,
    status,
    assigned_driver_profile_id,
    metadata
  )
  values (
    tag_reference,
    public.hash_lpg_cylinder_tag_credential(raw_credential),
    target_tag_type,
    tag_status,
    target_assigned_driver_profile_id,
    target_metadata
  )
  returning id into tag_id;

  insert into public.lpg_cylinder_tag_history (
    tag_id,
    driver_profile_id,
    event_type,
    to_status,
    metadata,
    idempotency_key
  )
  values (
    tag_id,
    target_assigned_driver_profile_id,
    case when target_assigned_driver_profile_id is null then 'issued' else 'assigned' end,
    tag_status,
    jsonb_build_object('tagType', target_tag_type),
    'issue:' || tag_id::text
  );

  -- The raw credential is returned only at issuance time so it can be encoded
  -- into the controlled physical tag. Only its SHA-256 digest is persisted.
  return jsonb_build_object(
    'tagId', tag_id,
    'publicTagReference', tag_reference,
    'tagType', target_tag_type,
    'status', tag_status,
    'credential', raw_credential
  );
end;
$$;

create or replace function public.bind_lpg_cylinder_tag(
  target_public_tag_reference text,
  target_cylinder_id uuid,
  target_idempotency_key text,
  target_lpg_order_id uuid default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  tag_record public.lpg_cylinder_tags%rowtype;
  order_record public.lpg_refill_orders%rowtype;
  actor_driver_profile_id uuid;
  actor_authorized boolean := false;
  existing_history_id uuid;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'authentication is required';
  end if;

  if target_cylinder_id is null then
    raise exception 'target_cylinder_id is required';
  end if;

  if nullif(btrim(coalesce(target_public_tag_reference, '')), '') is null then
    raise exception 'target_public_tag_reference is required';
  end if;

  if nullif(btrim(coalesce(target_idempotency_key, '')), '') is null then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select history.id
  into existing_history_id
  from public.lpg_cylinder_tag_history history
  join public.lpg_cylinder_tags tag on tag.id = history.tag_id
  where tag.public_tag_reference = upper(btrim(target_public_tag_reference))
    and history.idempotency_key = target_idempotency_key;

  if found then
    select tag.* into tag_record
    from public.lpg_cylinder_tags tag
    where tag.public_tag_reference = upper(btrim(target_public_tag_reference));
    return tag_record.id;
  end if;

  if not exists (
    select 1 from public.lpg_cylinders cylinder where cylinder.id = target_cylinder_id
  ) then
    raise exception 'target_cylinder_id must reference a cylinder';
  end if;

  select driver.id
  into actor_driver_profile_id
  from public.driver_profiles driver
  where driver.user_id = auth.uid()
  order by driver.created_at desc
  limit 1;

  actor_authorized := coalesce(auth.role(), '') = 'service_role'
    or public.has_permission('lpg.cylinders.manage', null);

  if target_lpg_order_id is not null then
    select target_order.*
    into order_record
    from public.lpg_refill_orders target_order
    where target_order.id = target_lpg_order_id;

    if not found then
      raise exception 'target_lpg_order_id must reference an LPG order';
    end if;

    if order_record.cylinder_id <> target_cylinder_id then
      raise exception 'target cylinder does not belong to the LPG order';
    end if;

    actor_authorized := actor_authorized
      or (
        actor_driver_profile_id is not null
        and order_record.driver_profile_id = actor_driver_profile_id
        and order_record.status in (
          'driver_accepted',
          'pickup_en_route',
          'pickup_verified',
          'station_en_route',
          'station_verified',
          'return_en_route',
          'delivery_verification_pending'
        )
      );
  end if;

  if not actor_authorized then
    raise exception 'assigned driver or LPG cylinder management permission is required';
  end if;

  select tag.*
  into tag_record
  from public.lpg_cylinder_tags tag
  where tag.public_tag_reference = upper(btrim(target_public_tag_reference))
  for update;

  if not found then
    raise exception 'SKIMA cylinder tag was not found';
  end if;

  if tag_record.status not in ('issued', 'assigned') then
    raise exception 'SKIMA cylinder tag is not available for binding';
  end if;

  if tag_record.assigned_driver_profile_id is not null
    and not actor_authorized then
    raise exception 'SKIMA cylinder tag is not assigned to this actor';
  end if;

  if tag_record.assigned_driver_profile_id is not null
    and actor_driver_profile_id is not null
    and tag_record.assigned_driver_profile_id <> actor_driver_profile_id
    and coalesce(auth.role(), '') <> 'service_role'
    and not public.has_permission('lpg.cylinders.manage', null) then
    raise exception 'SKIMA cylinder tag is assigned to another driver';
  end if;

  if exists (
    select 1
    from public.lpg_cylinder_tags active_tag
    where active_tag.cylinder_id = target_cylinder_id
      and active_tag.status = 'active'
      and active_tag.id <> tag_record.id
  ) then
    raise exception 'cylinder already has an active SKIMA physical tag';
  end if;

  update public.lpg_cylinder_tags
  set cylinder_id = target_cylinder_id,
      status = 'active',
      bound_at = timezone('utc', now()),
      bound_by_user_id = auth.uid(),
      metadata = metadata || target_metadata
  where id = tag_record.id;

  update public.lpg_cylinders
  set tag_status = 'tagged',
      updated_at = timezone('utc', now())
  where id = target_cylinder_id;

  insert into public.lpg_cylinder_tag_history (
    tag_id,
    cylinder_id,
    lpg_order_id,
    driver_profile_id,
    event_type,
    from_status,
    to_status,
    metadata,
    idempotency_key
  )
  values (
    tag_record.id,
    target_cylinder_id,
    target_lpg_order_id,
    actor_driver_profile_id,
    'bound',
    tag_record.status,
    'active',
    target_metadata,
    target_idempotency_key
  );

  return tag_record.id;
end;
$$;

create or replace function public.report_lpg_cylinder_tag_condition(
  target_public_tag_reference text,
  target_condition text,
  target_idempotency_key text,
  target_reason text default null,
  target_lpg_order_id uuid default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  tag_record public.lpg_cylinder_tags%rowtype;
  cylinder_record public.lpg_cylinders%rowtype;
  actor_driver_profile_id uuid;
  actor_authorized boolean := false;
  next_tag_status text;
  next_cylinder_tag_status text;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'authentication is required';
  end if;

  if target_condition not in ('damaged', 'lost') then
    raise exception 'target_condition must be damaged or lost';
  end if;

  if nullif(btrim(coalesce(target_idempotency_key, '')), '') is null then
    raise exception 'target_idempotency_key is required';
  end if;

  select tag.* into tag_record
  from public.lpg_cylinder_tags tag
  where tag.public_tag_reference = upper(btrim(target_public_tag_reference))
  for update;

  if not found or tag_record.cylinder_id is null then
    raise exception 'bound SKIMA cylinder tag was not found';
  end if;

  if exists (
    select 1 from public.lpg_cylinder_tag_history history
    where history.tag_id = tag_record.id
      and history.idempotency_key = target_idempotency_key
  ) then
    return tag_record.id;
  end if;

  select cylinder.* into cylinder_record
  from public.lpg_cylinders cylinder
  where cylinder.id = tag_record.cylinder_id;

  select driver.id into actor_driver_profile_id
  from public.driver_profiles driver
  where driver.user_id = auth.uid()
  order by driver.created_at desc
  limit 1;

  actor_authorized := coalesce(auth.role(), '') = 'service_role'
    or public.has_permission('lpg.cylinders.manage', null)
    or cylinder_record.owner_user_id = auth.uid();

  if target_lpg_order_id is not null then
    actor_authorized := actor_authorized or exists (
      select 1
      from public.lpg_refill_orders target_order
      where target_order.id = target_lpg_order_id
        and target_order.cylinder_id = tag_record.cylinder_id
        and target_order.driver_profile_id = actor_driver_profile_id
    );
  end if;

  if not actor_authorized then
    raise exception 'cylinder owner, assigned driver, or LPG cylinder management permission is required';
  end if;

  next_tag_status := target_condition;
  next_cylinder_tag_status := case
    when target_condition = 'damaged' then 'tag_damaged'
    else 'tag_lost'
  end;

  update public.lpg_cylinder_tags
  set status = next_tag_status,
      revoked_at = case when target_condition = 'lost' then timezone('utc', now()) else revoked_at end,
      revoked_by_user_id = case when target_condition = 'lost' then auth.uid() else revoked_by_user_id end,
      revocation_reason = case when target_condition = 'lost' then coalesce(nullif(btrim(target_reason), ''), 'reported_lost') else revocation_reason end,
      metadata = metadata || target_metadata
  where id = tag_record.id;

  update public.lpg_cylinders
  set tag_status = next_cylinder_tag_status,
      updated_at = timezone('utc', now())
  where id = tag_record.cylinder_id;

  insert into public.lpg_cylinder_tag_history (
    tag_id,
    cylinder_id,
    lpg_order_id,
    driver_profile_id,
    event_type,
    from_status,
    to_status,
    reason,
    metadata,
    idempotency_key
  )
  values (
    tag_record.id,
    tag_record.cylinder_id,
    target_lpg_order_id,
    actor_driver_profile_id,
    target_condition,
    tag_record.status,
    next_tag_status,
    nullif(btrim(coalesce(target_reason, '')), ''),
    target_metadata,
    target_idempotency_key
  );

  return tag_record.id;
end;
$$;

-- Replaces the previous QR-only trigger. It preserves strict order/cylinder
-- matching while accepting a human-readable SKIMA cylinder reference as the
-- audited fallback and supporting future controlled physical tag credentials.
create or replace function public.verify_lpg_scan_cylinder_identity()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  cylinder_record record;
  scanned_cylinder_id text;
  scanned_reference text;
  scanned_token text;
  verification_method text;
  matched_tag record;
begin
  select cylinder.id,
         cylinder.public_reference,
         cylinder.cylinder_identifier,
         cylinder.qr_payload,
         cylinder.barcode_payload,
         cylinder.tag_status
  into cylinder_record
  from public.lpg_cylinders cylinder
  where cylinder.id = new.cylinder_id;

  if not found then
    raise exception 'scan cylinder does not exist';
  end if;

  scanned_cylinder_id := nullif(btrim(coalesce(new.payload ->> 'scannedCylinderId', '')), '');
  scanned_reference := nullif(btrim(coalesce(new.payload ->> 'scannedPublicReference', '')), '');
  scanned_token := nullif(btrim(coalesce(new.payload ->> 'scannedToken', '')), '');

  if scanned_cylinder_id is not null and scanned_cylinder_id <> cylinder_record.id::text then
    raise exception 'scanned cylinder does not match the LPG order cylinder';
  end if;

  if scanned_reference is not null
    and upper(scanned_reference) <> upper(coalesce(cylinder_record.public_reference, '')) then
    raise exception 'scanned cylinder does not match the LPG order cylinder';
  end if;

  if scanned_token is null then
    raise exception 'a SKIMA cylinder credential or Cylinder ID is required';
  end if;

  if scanned_token is not distinct from cylinder_record.qr_payload
    or scanned_token is not distinct from cylinder_record.barcode_payload then
    verification_method := 'qr_scan';
  else
    select tag.id, tag.public_tag_reference, tag.tag_type
    into matched_tag
    from public.lpg_cylinder_tags tag
    where tag.cylinder_id = cylinder_record.id
      and tag.status = 'active'
      and tag.credential_hash = public.hash_lpg_cylinder_tag_credential(scanned_token)
    limit 1;

    if found then
      verification_method := case matched_tag.tag_type
        when 'nfc' then 'nfc_tag'
        when 'barcode' then 'barcode_tag'
        else 'qr_tag'
      end;
    elsif upper(scanned_token) = upper(coalesce(cylinder_record.public_reference, ''))
      or upper(scanned_token) = upper(coalesce(cylinder_record.cylinder_identifier, '')) then
      verification_method := 'manual_cylinder_id';
    else
      raise exception 'scanned cylinder does not match the LPG order cylinder';
    end if;
  end if;

  new.payload := (new.payload - 'scannedPublicReference') || jsonb_strip_nulls(jsonb_build_object(
    'verifiedCylinderId', cylinder_record.id,
    'verifiedCylinderReference', cylinder_record.public_reference,
    'identityVerified', true,
    'credentialVerified', verification_method <> 'manual_cylinder_id',
    'verificationMethod', verification_method,
    'physicalTagStatus', cylinder_record.tag_status,
    'verifiedTagId', matched_tag.id,
    'verifiedTagReference', matched_tag.public_tag_reference
  ));

  return new;
end;
$$;

-- Keep fallback availability governed by the existing LPG policy registry.
insert into public.lpg_operation_policies (
  key,
  display_name,
  policy_kind,
  priority,
  policy,
  status,
  source,
  idempotency_key,
  metadata
)
values (
  'lpg.verification.fallbacks.phase_one',
  'LPG cylinder fallback verification',
  'scan',
  120,
  '{"qr":true,"manualCylinderId":true,"stationAssignedQueue":true,"orderReference":true,"driverIdentity":true,"orderPin":false,"adminOverride":false,"firstServicePhysicalTagRequired":false}'::jsonb,
  'active',
  'lpg.config_seed',
  'lpg-verification-fallbacks-phase-one-v1',
  '{"module":"lpg","governed":true,"purpose":"cylinder_identity_fallbacks"}'::jsonb
)
on conflict (key) do nothing;

alter table public.lpg_cylinder_tags enable row level security;
alter table public.lpg_cylinder_tag_history enable row level security;

drop policy if exists lpg_cylinder_tags_select_scope on public.lpg_cylinder_tags;
create policy lpg_cylinder_tags_select_scope
on public.lpg_cylinder_tags
for select to authenticated
using (
  exists (
    select 1
    from public.lpg_cylinders cylinder
    where cylinder.id = lpg_cylinder_tags.cylinder_id
      and cylinder.owner_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.driver_profiles driver
    where driver.id = lpg_cylinder_tags.assigned_driver_profile_id
      and driver.user_id = auth.uid()
  )
  or public.has_permission('lpg.cylinders.read', null)
  or public.has_permission('lpg.cylinders.manage', null)
);

drop policy if exists lpg_cylinder_tags_no_direct_insert on public.lpg_cylinder_tags;
create policy lpg_cylinder_tags_no_direct_insert
on public.lpg_cylinder_tags
for insert to authenticated
with check (false);

drop policy if exists lpg_cylinder_tags_no_direct_update on public.lpg_cylinder_tags;
create policy lpg_cylinder_tags_no_direct_update
on public.lpg_cylinder_tags
for update to authenticated
using (false)
with check (false);

drop policy if exists lpg_cylinder_tags_no_direct_delete on public.lpg_cylinder_tags;
create policy lpg_cylinder_tags_no_direct_delete
on public.lpg_cylinder_tags
for delete to authenticated
using (false);

drop policy if exists lpg_cylinder_tag_history_select_scope on public.lpg_cylinder_tag_history;
create policy lpg_cylinder_tag_history_select_scope
on public.lpg_cylinder_tag_history
for select to authenticated
using (
  exists (
    select 1
    from public.lpg_cylinders cylinder
    where cylinder.id = lpg_cylinder_tag_history.cylinder_id
      and cylinder.owner_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.driver_profiles driver
    where driver.id = lpg_cylinder_tag_history.driver_profile_id
      and driver.user_id = auth.uid()
  )
  or public.has_permission('lpg.cylinders.read', null)
  or public.has_permission('lpg.cylinders.manage', null)
);

drop policy if exists lpg_cylinder_tag_history_no_direct_insert on public.lpg_cylinder_tag_history;
create policy lpg_cylinder_tag_history_no_direct_insert
on public.lpg_cylinder_tag_history
for insert to authenticated
with check (false);

drop policy if exists lpg_cylinder_tag_history_no_direct_update on public.lpg_cylinder_tag_history;
create policy lpg_cylinder_tag_history_no_direct_update
on public.lpg_cylinder_tag_history
for update to authenticated
using (false)
with check (false);

drop policy if exists lpg_cylinder_tag_history_no_direct_delete on public.lpg_cylinder_tag_history;
create policy lpg_cylinder_tag_history_no_direct_delete
on public.lpg_cylinder_tag_history
for delete to authenticated
using (false);

grant select on public.lpg_cylinder_tags to authenticated;
grant select on public.lpg_cylinder_tag_history to authenticated;

revoke all on function public.hash_lpg_cylinder_tag_credential(text) from public;
revoke all on function public.issue_lpg_cylinder_tag(text, uuid, jsonb) from public;
revoke all on function public.bind_lpg_cylinder_tag(text, uuid, text, uuid, jsonb) from public;
revoke all on function public.report_lpg_cylinder_tag_condition(text, text, text, text, uuid, jsonb) from public;
revoke all on function public.verify_lpg_scan_cylinder_identity() from public;

grant execute on function public.hash_lpg_cylinder_tag_credential(text) to authenticated, service_role;
grant execute on function public.issue_lpg_cylinder_tag(text, uuid, jsonb) to authenticated, service_role;
grant execute on function public.bind_lpg_cylinder_tag(text, uuid, text, uuid, jsonb) to authenticated, service_role;
grant execute on function public.report_lpg_cylinder_tag_condition(text, text, text, text, uuid, jsonb) to authenticated, service_role;

commit;
