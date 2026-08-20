begin;

create or replace function public.assign_lpg_cylinder_tag_to_driver(
  target_public_tag_reference text,
  target_driver_profile_id uuid,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  tag_record public.lpg_cylinder_tags%rowtype;
  existing_history uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and not public.has_permission('lpg.cylinders.manage', null) then
    raise exception 'LPG cylinder management permission is required';
  end if;

  if target_driver_profile_id is null
    or not exists (select 1 from public.driver_profiles driver where driver.id = target_driver_profile_id) then
    raise exception 'target_driver_profile_id must reference a driver';
  end if;

  if nullif(btrim(coalesce(target_idempotency_key, '')), '') is null then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select tag.* into tag_record
  from public.lpg_cylinder_tags tag
  where tag.public_tag_reference = upper(btrim(target_public_tag_reference))
  for update;

  if not found then
    raise exception 'SKIMA cylinder tag was not found';
  end if;

  select history.id into existing_history
  from public.lpg_cylinder_tag_history history
  where history.tag_id = tag_record.id
    and history.idempotency_key = target_idempotency_key;

  if found then
    return tag_record.id;
  end if;

  if tag_record.cylinder_id is not null or tag_record.status not in ('issued', 'assigned') then
    raise exception 'only an unused SKIMA cylinder tag can be assigned';
  end if;

  update public.lpg_cylinder_tags
  set assigned_driver_profile_id = target_driver_profile_id,
      status = 'assigned',
      metadata = metadata || target_metadata
  where id = tag_record.id;

  insert into public.lpg_cylinder_tag_history (
    tag_id,
    driver_profile_id,
    event_type,
    from_status,
    to_status,
    metadata,
    idempotency_key
  )
  values (
    tag_record.id,
    target_driver_profile_id,
    'assigned',
    tag_record.status,
    'assigned',
    target_metadata,
    target_idempotency_key
  );

  return tag_record.id;
end;
$$;

create or replace function public.revoke_lpg_cylinder_tag(
  target_public_tag_reference text,
  target_idempotency_key text,
  target_reason text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  tag_record public.lpg_cylinder_tags%rowtype;
  active_replacement_exists boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and not public.has_permission('lpg.cylinders.manage', null) then
    raise exception 'LPG cylinder management permission is required';
  end if;

  if nullif(btrim(coalesce(target_idempotency_key, '')), '') is null then
    raise exception 'target_idempotency_key is required';
  end if;

  if nullif(btrim(coalesce(target_reason, '')), '') is null then
    raise exception 'target_reason is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select tag.* into tag_record
  from public.lpg_cylinder_tags tag
  where tag.public_tag_reference = upper(btrim(target_public_tag_reference))
  for update;

  if not found then
    raise exception 'SKIMA cylinder tag was not found';
  end if;

  if exists (
    select 1 from public.lpg_cylinder_tag_history history
    where history.tag_id = tag_record.id
      and history.idempotency_key = target_idempotency_key
  ) then
    return tag_record.id;
  end if;

  if tag_record.status in ('revoked', 'replaced', 'destroyed') then
    raise exception 'SKIMA cylinder tag is already inactive';
  end if;

  update public.lpg_cylinder_tags
  set status = 'revoked',
      revoked_at = timezone('utc', now()),
      revoked_by_user_id = auth.uid(),
      revocation_reason = btrim(target_reason),
      metadata = metadata || target_metadata
  where id = tag_record.id;

  if tag_record.cylinder_id is not null then
    select exists (
      select 1
      from public.lpg_cylinder_tags replacement
      where replacement.cylinder_id = tag_record.cylinder_id
        and replacement.id <> tag_record.id
        and replacement.status = 'active'
    ) into active_replacement_exists;

    if not active_replacement_exists then
      update public.lpg_cylinders
      set tag_status = 'replacement_pending',
          updated_at = timezone('utc', now())
      where id = tag_record.cylinder_id;
    end if;
  end if;

  insert into public.lpg_cylinder_tag_history (
    tag_id,
    cylinder_id,
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
    tag_record.assigned_driver_profile_id,
    'revoked',
    tag_record.status,
    'revoked',
    btrim(target_reason),
    target_metadata,
    target_idempotency_key
  );

  return tag_record.id;
end;
$$;

create or replace function public.replace_lpg_cylinder_tag(
  target_old_tag_reference text,
  target_new_tag_reference text,
  target_cylinder_id uuid,
  target_idempotency_key text,
  target_lpg_order_id uuid default null,
  target_reason text default 'physical_tag_replacement',
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_tag public.lpg_cylinder_tags%rowtype;
  new_tag public.lpg_cylinder_tags%rowtype;
  order_record public.lpg_refill_orders%rowtype;
  actor_driver_profile_id uuid;
  actor_authorized boolean := false;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'authentication is required';
  end if;

  if target_cylinder_id is null then
    raise exception 'target_cylinder_id is required';
  end if;

  if nullif(btrim(coalesce(target_idempotency_key, '')), '') is null then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select tag.* into old_tag
  from public.lpg_cylinder_tags tag
  where tag.public_tag_reference = upper(btrim(target_old_tag_reference))
  for update;

  if not found then
    raise exception 'existing SKIMA cylinder tag was not found';
  end if;

  select tag.* into new_tag
  from public.lpg_cylinder_tags tag
  where tag.public_tag_reference = upper(btrim(target_new_tag_reference))
  for update;

  if not found then
    raise exception 'replacement SKIMA cylinder tag was not found';
  end if;

  if old_tag.id = new_tag.id then
    raise exception 'replacement tag must be different from the current tag';
  end if;

  if exists (
    select 1 from public.lpg_cylinder_tag_history history
    where history.tag_id = new_tag.id
      and history.idempotency_key = target_idempotency_key
      and history.event_type = 'bound'
  ) then
    return new_tag.id;
  end if;

  if old_tag.cylinder_id <> target_cylinder_id then
    raise exception 'existing tag does not belong to the target cylinder';
  end if;

  if old_tag.status not in ('active', 'damaged', 'lost') then
    raise exception 'existing tag is not eligible for replacement';
  end if;

  if new_tag.cylinder_id is not null or new_tag.status not in ('issued', 'assigned') then
    raise exception 'replacement tag must be unused';
  end if;

  select driver.id into actor_driver_profile_id
  from public.driver_profiles driver
  where driver.user_id = auth.uid()
  order by driver.created_at desc
  limit 1;

  actor_authorized := coalesce(auth.role(), '') = 'service_role'
    or public.has_permission('lpg.cylinders.manage', null);

  if target_lpg_order_id is not null then
    select target_order.* into order_record
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

  if new_tag.assigned_driver_profile_id is not null
    and new_tag.assigned_driver_profile_id <> actor_driver_profile_id
    and coalesce(auth.role(), '') <> 'service_role'
    and not public.has_permission('lpg.cylinders.manage', null) then
    raise exception 'replacement tag is assigned to another driver';
  end if;

  update public.lpg_cylinder_tags
  set status = 'replaced',
      revoked_at = timezone('utc', now()),
      revoked_by_user_id = auth.uid(),
      revocation_reason = coalesce(nullif(btrim(target_reason), ''), 'physical_tag_replacement'),
      metadata = metadata || target_metadata
  where id = old_tag.id;

  update public.lpg_cylinder_tags
  set cylinder_id = target_cylinder_id,
      status = 'active',
      bound_at = timezone('utc', now()),
      bound_by_user_id = auth.uid(),
      replaces_tag_id = old_tag.id,
      metadata = metadata || target_metadata
  where id = new_tag.id;

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
    reason,
    metadata,
    idempotency_key
  )
  values (
    old_tag.id,
    target_cylinder_id,
    target_lpg_order_id,
    actor_driver_profile_id,
    'replaced',
    old_tag.status,
    'replaced',
    coalesce(nullif(btrim(target_reason), ''), 'physical_tag_replacement'),
    target_metadata || jsonb_build_object('replacementTagId', new_tag.id),
    target_idempotency_key
  );

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
    new_tag.id,
    target_cylinder_id,
    target_lpg_order_id,
    actor_driver_profile_id,
    'bound',
    new_tag.status,
    'active',
    coalesce(nullif(btrim(target_reason), ''), 'physical_tag_replacement'),
    target_metadata || jsonb_build_object('replacesTagId', old_tag.id),
    target_idempotency_key
  );

  return new_tag.id;
end;
$$;

revoke all on function public.assign_lpg_cylinder_tag_to_driver(text, uuid, text, jsonb) from public;
revoke all on function public.revoke_lpg_cylinder_tag(text, text, text, jsonb) from public;
revoke all on function public.replace_lpg_cylinder_tag(text, text, uuid, text, uuid, text, jsonb) from public;

grant execute on function public.assign_lpg_cylinder_tag_to_driver(text, uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.revoke_lpg_cylinder_tag(text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.replace_lpg_cylinder_tag(text, text, uuid, text, uuid, text, jsonb) to authenticated, service_role;

commit;
