begin;

-- Normal tag binding is only for a cylinder that has never had a physical
-- SKIMA tag. Damaged, lost, revoked, or previously tagged cylinders must use
-- replace_lpg_cylinder_tag so the old/new relationship is preserved.
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
  cylinder_record public.lpg_cylinders%rowtype;
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

  select cylinder.*
  into cylinder_record
  from public.lpg_cylinders cylinder
  where cylinder.id = target_cylinder_id
  for update;

  if not found then
    raise exception 'target_cylinder_id must reference a cylinder';
  end if;

  if cylinder_record.tag_status not in ('untagged', 'tag_pending')
    or exists (
      select 1
      from public.lpg_cylinder_tags previous_tag
      where previous_tag.cylinder_id = target_cylinder_id
    ) then
    raise exception 'cylinder has prior SKIMA tag history; use the controlled replacement flow';
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

  if tag_record.status not in ('issued', 'assigned') or tag_record.cylinder_id is not null then
    raise exception 'SKIMA cylinder tag is not available for binding';
  end if;

  if tag_record.assigned_driver_profile_id is not null
    and actor_driver_profile_id is not null
    and tag_record.assigned_driver_profile_id <> actor_driver_profile_id
    and coalesce(auth.role(), '') <> 'service_role'
    and not public.has_permission('lpg.cylinders.manage', null) then
    raise exception 'SKIMA cylinder tag is assigned to another driver';
  end if;

  if tag_record.assigned_driver_profile_id is not null
    and actor_driver_profile_id is null
    and coalesce(auth.role(), '') <> 'service_role'
    and not public.has_permission('lpg.cylinders.manage', null) then
    raise exception 'SKIMA cylinder tag is assigned to a driver';
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

-- The digest helper is an implementation detail. Authenticated clients do not
-- need to invoke it directly; security-definer functions and triggers can.
revoke execute on function public.hash_lpg_cylinder_tag_credential(text) from authenticated;
grant execute on function public.hash_lpg_cylinder_tag_credential(text) to service_role;

commit;
