begin;

-- A station price is versioned: the current row is closed before its replacement
-- is inserted. The previous delegated guard rejected that trusted active -> retired
-- transition for station actors, which made every second price change fail.
create or replace function public.can_manage_delegated_lpg_station_price(
  target_station_branch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.lpg_station_branches station
    where station.id = target_station_branch_id
      and station.approval_status = 'approved'
      and station.compliance_status = 'approved'
      and (
        coalesce(auth.jwt() ->> 'role', '') = 'service_role'
        or public.is_platform_super_admin()
        or public.can_manage_lpg_operations()
        or public.has_permission_for_branch(
          'business.partner_price.manage',
          station.organization_id,
          station.branch_id
        )
        or public.can_operate_lpg_station_branch(
          station.id,
          'lpg.stations.manage'
        )
      )
  );
$$;

create or replace function public.enforce_delegated_lpg_catalog_price()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item_record public.catalog_items%rowtype;
  privileged_actor boolean;
  managed_lpg_price boolean;
  trusted_retirement boolean := false;
begin
  select * into item_record
  from public.catalog_items
  where id = new.item_id;

  if not found then
    raise exception 'catalog price item is required';
  end if;

  if item_record.module_id is distinct from (
    select id from public.business_modules where key = 'lpg'
  ) then
    return new;
  end if;

  if new.organization_id <> item_record.organization_id
    or new.branch_id is distinct from item_record.branch_id then
    raise exception 'catalog price organization and branch must match its item';
  end if;

  privileged_actor := coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or public.is_platform_super_admin()
    or public.can_manage_lpg_operations()
    or public.has_permission('platform.financial_policy.draft', null);

  managed_lpg_price := new.metadata ->> 'price_basis' = 'per_kg'
    or new.metadata ->> 'managed_field' = 'station_price_per_kg'
    or not privileged_actor;

  if managed_lpg_price and not exists (
    select 1
    from public.lpg_station_branches station
    where station.organization_id = new.organization_id
      and station.branch_id is not distinct from new.branch_id
      and station.approval_status = 'approved'
      and station.compliance_status = 'approved'
  ) then
    raise exception 'LPG station selling prices require an approved, compliant station branch';
  end if;

  if not privileged_actor and not public.has_permission_for_branch(
    'business.partner_price.manage', item_record.organization_id, item_record.branch_id
  ) and not exists (
    select 1
    from public.lpg_station_branches station
    where station.organization_id = item_record.organization_id
      and station.branch_id is not distinct from item_record.branch_id
      and public.can_operate_lpg_station_branch(station.id, 'lpg.stations.manage')
  ) then
    raise exception 'LPG station selling prices require delegated branch price permission';
  end if;

  if not managed_lpg_price then
    return new;
  end if;

  if new.amount <= 0
    or not exists (
      select 1
      from public.currency_definitions currency
      where currency.code = new.currency_code
        and currency.status = 'enabled'
    ) then
    raise exception 'delegated station price must be positive and use an enabled currency';
  end if;

  if tg_op = 'UPDATE' then
    trusted_retirement := old.status = 'active'
      and new.status = 'retired'
      and new.organization_id = old.organization_id
      and new.branch_id is not distinct from old.branch_id
      and new.item_id = old.item_id
      and new.variant_id is not distinct from old.variant_id
      and new.pricing_policy_id is not distinct from old.pricing_policy_id
      and new.currency_code = old.currency_code
      and new.amount = old.amount
      and new.compare_at_amount is not distinct from old.compare_at_amount
      and new.tax_behavior = old.tax_behavior
      and new.effective_from is not distinct from old.effective_from
      and new.effective_until is not null
      and (new.effective_from is null or new.effective_until > new.effective_from)
      and new.source = old.source
      and new.idempotency_key = old.idempotency_key
      and new.created_by is not distinct from old.created_by
      and new.created_at = old.created_at
      and (new.metadata - 'superseded_at' - 'superseded_by_idempotency_key') = old.metadata
      and nullif(new.metadata ->> 'superseded_by_idempotency_key', '') is not null;
  end if;

  -- Only the versioning RPC can produce this immutable retirement shape. Direct
  -- table writes remain denied by RLS, while the predecessor can now be closed.
  if trusted_retirement then
    return new;
  end if;

  if not privileged_actor and (
    new.variant_id is not null
    or new.pricing_policy_id is not null
    or new.tax_behavior <> 'exempt'
    or new.status not in ('active', 'scheduled')
  ) then
    raise exception 'station users may manage only their branch LPG selling price per kilogram';
  end if;

  new.metadata := new.metadata || jsonb_build_object(
    'price_basis', 'per_kg',
    'managed_field', 'station_price_per_kg'
  );

  if exists (
    select 1
    from public.catalog_prices price
    join public.catalog_items item on item.id = price.item_id
    where price.id is distinct from new.id
      and price.organization_id = new.organization_id
      and price.branch_id is not distinct from new.branch_id
      and price.currency_code = new.currency_code
      and price.status in ('active', 'scheduled')
      and item.module_id = item_record.module_id
      and price.metadata ->> 'price_basis' = 'per_kg'
      and tstzrange(
        coalesce(price.effective_from, '-infinity'::timestamptz),
        price.effective_until,
        '[)'
      ) && tstzrange(
        coalesce(new.effective_from, '-infinity'::timestamptz),
        new.effective_until,
        '[)'
      )
  ) then
    raise exception 'LPG station catalog price conflicts with another effective per-kilogram price';
  end if;

  return new;
end;
$$;

revoke all on function public.can_manage_delegated_lpg_station_price(uuid)
from public, anon;
grant execute on function public.can_manage_delegated_lpg_station_price(uuid)
to authenticated, service_role;
revoke all on function public.enforce_delegated_lpg_catalog_price()
from public, anon, authenticated;

-- Invitations are linked when a matching profile becomes available, so an
-- invite sent before account creation still appears inside the signed-in app.
create or replace function public.link_profile_organization_invitations()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  profile_email text;
begin
  select lower(auth_user.email)
  into profile_email
  from auth.users auth_user
  where auth_user.id = new.id;

  if profile_email is null then
    return new;
  end if;

  update public.organization_invitations invitation
  set invited_user_id = new.id,
      updated_at = timezone('utc', now())
  where invitation.invited_user_id is null
    and invitation.status = 'pending'
    and lower(invitation.invited_email) = profile_email;

  return new;
end;
$$;

drop trigger if exists link_profile_organization_invitations
on public.profiles;
create trigger link_profile_organization_invitations
after insert or update on public.profiles
for each row execute function public.link_profile_organization_invitations();

revoke all on function public.link_profile_organization_invitations()
from public, anon, authenticated;

update public.organization_invitations invitation
set invited_user_id = profile.id,
    updated_at = timezone('utc', now())
from public.profiles profile
join auth.users auth_user on auth_user.id = profile.id
where invitation.invited_user_id is null
  and invitation.status = 'pending'
  and lower(invitation.invited_email) = lower(auth_user.email);

drop policy if exists organization_invitations_select_related_or_privileged
on public.organization_invitations;
create policy organization_invitations_select_related_or_privileged
on public.organization_invitations
for select to authenticated
using (
  public.can_manage_organization_staff(organization_id)
  or invited_user_id = (select auth.uid())
  or lower(invited_email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
);

create or replace function public.accept_organization_invitation(
  target_invitation_id uuid,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invitation_record public.organization_invitations%rowtype;
  accepting_user_id uuid := auth.uid();
  accepting_email text;
begin
  if accepting_user_id is null then
    raise exception 'authenticated user context is required';
  end if;
  if target_invitation_id is null then
    raise exception 'target_invitation_id is required';
  end if;
  if nullif(btrim(target_idempotency_key), '') is null then
    raise exception 'target_idempotency_key is required';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select lower(auth_user.email)
  into accepting_email
  from auth.users auth_user
  where auth_user.id = accepting_user_id;

  select * into invitation_record
  from public.organization_invitations invitation
  where invitation.id = target_invitation_id
  for update;

  if not found then
    raise exception 'invitation was not found';
  end if;
  if accepting_email is null
    or lower(invitation_record.invited_email) <> accepting_email
    or (invitation_record.invited_user_id is not null
      and invitation_record.invited_user_id <> accepting_user_id) then
    raise exception 'only the invited user can respond to this invitation';
  end if;
  if invitation_record.status in ('accepted', 'expired') then
    return invitation_record.id;
  end if;
  if invitation_record.status <> 'pending' then
    raise exception 'this invitation has already been answered';
  end if;

  if invitation_record.expires_at <= timezone('utc', now()) then
    update public.organization_invitations
    set invited_user_id = accepting_user_id,
        status = 'expired',
        metadata = metadata || target_metadata,
        updated_at = timezone('utc', now())
    where id = target_invitation_id;

    perform public.record_organization_staff_event(
      invitation_record.organization_id,
      'event.organization.staff.expired',
      target_idempotency_key || ':event',
      accepting_user_id,
      target_invitation_id,
      invitation_record.role_id,
      invitation_record.branch_id,
      'pending',
      'expired',
      target_metadata
    );
    return target_invitation_id;
  end if;

  insert into public.organization_memberships (
    organization_id, user_id, membership_type, status, metadata, created_by
  ) values (
    invitation_record.organization_id,
    accepting_user_id,
    invitation_record.membership_type,
    'active',
    jsonb_build_object('source_invitation_id', target_invitation_id),
    invitation_record.invited_by
  )
  on conflict (organization_id, user_id) do update
  set membership_type = excluded.membership_type,
      status = 'active',
      metadata = public.organization_memberships.metadata || excluded.metadata,
      updated_at = timezone('utc', now());

  insert into public.user_roles (
    organization_id, user_id, role_id, branch_id, access_scope, status, created_by
  ) values (
    invitation_record.organization_id,
    accepting_user_id,
    invitation_record.role_id,
    invitation_record.branch_id,
    jsonb_build_object('source_invitation_id', target_invitation_id),
    'active',
    invitation_record.invited_by
  )
  on conflict (organization_id, user_id, role_id) do update
  set branch_id = excluded.branch_id,
      access_scope = public.user_roles.access_scope || excluded.access_scope,
      status = 'active',
      updated_at = timezone('utc', now());

  update public.organization_invitations
  set invited_user_id = accepting_user_id,
      status = 'accepted',
      accepted_at = timezone('utc', now()),
      metadata = metadata || target_metadata,
      updated_at = timezone('utc', now())
  where id = target_invitation_id;

  perform public.record_organization_staff_event(
    invitation_record.organization_id,
    'event.organization.staff.accepted',
    target_idempotency_key || ':event',
    accepting_user_id,
    target_invitation_id,
    invitation_record.role_id,
    invitation_record.branch_id,
    'pending',
    'accepted',
    target_metadata
  );

  return target_invitation_id;
end;
$$;

create or replace function public.decline_organization_invitation(
  target_invitation_id uuid,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invitation_record public.organization_invitations%rowtype;
  declining_user_id uuid := auth.uid();
  declining_email text;
  next_status text;
begin
  if declining_user_id is null then
    raise exception 'authenticated user context is required';
  end if;
  if target_invitation_id is null then
    raise exception 'target_invitation_id is required';
  end if;
  if nullif(btrim(target_idempotency_key), '') is null then
    raise exception 'target_idempotency_key is required';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select lower(auth_user.email)
  into declining_email
  from auth.users auth_user
  where auth_user.id = declining_user_id;

  select * into invitation_record
  from public.organization_invitations invitation
  where invitation.id = target_invitation_id
  for update;

  if not found then
    raise exception 'invitation was not found';
  end if;
  if declining_email is null
    or lower(invitation_record.invited_email) <> declining_email
    or (invitation_record.invited_user_id is not null
      and invitation_record.invited_user_id <> declining_user_id) then
    raise exception 'only the invited user can respond to this invitation';
  end if;
  if invitation_record.status in ('declined', 'expired') then
    return invitation_record.id;
  end if;
  if invitation_record.status <> 'pending' then
    raise exception 'this invitation has already been answered';
  end if;

  next_status := case
    when invitation_record.expires_at <= timezone('utc', now()) then 'expired'
    else 'declined'
  end;

  update public.organization_invitations
  set invited_user_id = declining_user_id,
      status = next_status,
      metadata = metadata || target_metadata,
      updated_at = timezone('utc', now())
  where id = target_invitation_id;

  perform public.record_organization_staff_event(
    invitation_record.organization_id,
    'event.organization.staff.' || next_status,
    target_idempotency_key || ':event',
    declining_user_id,
    target_invitation_id,
    invitation_record.role_id,
    invitation_record.branch_id,
    'pending',
    next_status,
    target_metadata
  );

  return target_invitation_id;
end;
$$;

revoke all on function public.accept_organization_invitation(uuid, text, jsonb)
from public, anon;
grant execute on function public.accept_organization_invitation(uuid, text, jsonb)
to authenticated, service_role;
revoke all on function public.decline_organization_invitation(uuid, text, jsonb)
from public, anon;
grant execute on function public.decline_organization_invitation(uuid, text, jsonb)
to authenticated, service_role;

create or replace function public.notify_organization_invitation_in_app()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  station_name text;
  role_name text;
  message_title text;
  message_body text;
  message_payload jsonb;
begin
  if new.invited_user_id is null then
    return new;
  end if;

  select coalesce(
    (
      select station.display_name
      from public.lpg_station_branches station
      where station.organization_id = new.organization_id
        and station.branch_id is not distinct from new.branch_id
      limit 1
    ),
    (
      select branch.display_name
      from public.organization_branches branch
      where branch.id = new.branch_id
      limit 1
    ),
    organization.display_name
  )
  into station_name
  from public.organizations organization
  where organization.id = new.organization_id;

  select role.display_name
  into role_name
  from public.roles role
  where role.id = new.role_id;

  station_name := coalesce(nullif(btrim(station_name), ''), 'Your station');
  role_name := coalesce(nullif(btrim(role_name), ''), 'Team member');

  case new.status
    when 'pending' then
      message_title := 'Station invitation';
      message_body := format(
        '%s has invited you to join their team as a %s.',
        station_name,
        role_name
      );
    when 'accepted' then
      message_title := 'Invitation accepted';
      message_body := format('You joined %s as a %s.', station_name, role_name);
    when 'declined' then
      message_title := 'Invitation declined';
      message_body := format('You declined the invitation from %s.', station_name);
    when 'expired' then
      message_title := 'Invitation expired';
      message_body := format('The invitation from %s has expired.', station_name);
    else
      message_title := 'Invitation no longer available';
      message_body := format('The invitation from %s is no longer available.', station_name);
  end case;

  message_payload := jsonb_strip_nulls(jsonb_build_object(
    'title', message_title,
    'body', message_body,
    'category', 'partner',
    'invitationId', new.id,
    'organizationId', new.organization_id,
    'branchId', new.branch_id,
    'stationName', station_name,
    'roleDisplayName', role_name,
    'invitationStatus', new.status,
    'expiresAt', new.expires_at,
    'deepLink', '/invitations/' || new.id::text
  ));

  insert into public.communication_messages (
    channel,
    purpose,
    recipient_entity_type,
    recipient_entity_id,
    recipient_address,
    status,
    payload,
    source,
    idempotency_key,
    metadata,
    created_by
  ) values (
    'in_app',
    'organization.staff.invitation',
    'user',
    new.invited_user_id,
    null,
    'queued',
    message_payload,
    'skima.organization.invitation',
    'organization-invitation:' || new.id::text,
    jsonb_build_object(
      'invitationId', new.id,
      'organizationId', new.organization_id,
      'invitationStatus', new.status
    ),
    new.invited_by
  )
  on conflict (source, idempotency_key) do update
  set recipient_entity_id = excluded.recipient_entity_id,
      payload = excluded.payload,
      metadata = public.communication_messages.metadata || excluded.metadata,
      updated_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists organization_invitation_in_app_notice
on public.organization_invitations;
create trigger organization_invitation_in_app_notice
after insert or update on public.organization_invitations
for each row execute function public.notify_organization_invitation_in_app();

revoke all on function public.notify_organization_invitation_in_app()
from public, anon, authenticated;

-- Rebuild existing messages with station, role, and final-state context.
update public.organization_invitations invitation
set updated_at = invitation.updated_at
where invitation.invited_user_id is not null;

-- A narrow Admin read model keeps catalog identifiers out of the UI while
-- preserving the selected station in the route and mutation context.
create or replace function public.read_lpg_admin_station_pricing(
  target_station_branch_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  lpg_module_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
    and not public.is_platform_super_admin()
    and not public.can_manage_lpg_operations()
    and not public.has_permission('platform.partner_price.manage', null) then
    raise exception 'platform station pricing permission is required';
  end if;

  select module.id into lpg_module_id
  from public.business_modules module
  where module.key = 'lpg'
    and module.status = 'active'
  limit 1;

  return coalesce((
    select jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'stationBranchId', station.id,
        'stationName', station.display_name,
        'organizationName', organization.display_name,
        'approvalStatus', station.approval_status,
        'complianceStatus', station.compliance_status,
        'canSetPrice',
          station.approval_status = 'approved'
          and station.compliance_status = 'approved'
          and catalog_item.id is not null,
        'catalogItemId', catalog_item.id,
        'currentPricePerKg', current_price.amount,
        'currencyCode', coalesce(current_price.currency_code, 'NGN'),
        'priceConfigured', current_price.id is not null,
        'priceUpdatedAt', current_price.updated_at
      ))
      order by station.display_name
    )
    from public.lpg_station_branches station
    join public.organizations organization
      on organization.id = station.organization_id
    left join lateral (
      select item.*
      from public.catalog_items item
      where item.organization_id = station.organization_id
        and item.branch_id is not distinct from station.branch_id
        and item.module_id = lpg_module_id
        and item.status = 'active'
        and item.metadata ->> 'price_basis' = 'per_kg'
      order by
        (item.metadata ->> 'canonical_lpg_refill' = 'true') desc,
        item.created_at asc
      limit 1
    ) catalog_item on true
    left join lateral (
      select price.*
      from public.catalog_prices price
      where price.item_id = catalog_item.id
        and price.organization_id = station.organization_id
        and price.branch_id is not distinct from station.branch_id
        and price.currency_code = 'NGN'
        and price.status = 'active'
        and price.metadata ->> 'price_basis' = 'per_kg'
        and coalesce(price.effective_from, '-infinity'::timestamptz)
          <= timezone('utc', now())
        and (
          price.effective_until is null
          or price.effective_until > timezone('utc', now())
        )
      order by price.effective_from desc, price.created_at desc
      limit 1
    ) current_price on true
    where target_station_branch_id is null
      or station.id = target_station_branch_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.read_lpg_admin_station_pricing(uuid)
from public, anon;
grant execute on function public.read_lpg_admin_station_pricing(uuid)
to authenticated, service_role;

-- Repair any eligible legacy station that predates automatic catalog
-- provisioning. The helper is idempotent and creates no price value.
do $$
declare
  station_record record;
begin
  for station_record in
    select station.id
    from public.lpg_station_branches station
    where station.approval_status = 'approved'
      and station.compliance_status = 'approved'
  loop
    perform public.ensure_lpg_station_refill_catalog_item(station_record.id);
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;
