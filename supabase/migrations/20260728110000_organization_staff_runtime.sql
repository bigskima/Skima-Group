begin;

alter table public.user_roles
add column if not exists branch_id uuid;

alter table public.user_roles
add column if not exists access_scope jsonb not null default '{}'::jsonb
  check (jsonb_typeof(access_scope) = 'object');

create table if not exists public.organization_branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  address jsonb not null default '{}'::jsonb
    check (jsonb_typeof(address) = 'object'),
  geo_location jsonb not null default '{}'::jsonb
    check (jsonb_typeof(geo_location) = 'object'),
  status text not null default 'active'
    check (status in ('draft', 'active', 'paused', 'suspended', 'archived')),
  source text not null default 'platform.organization_staff_engine'
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, key),
  unique (source, idempotency_key)
);

alter table public.user_roles
drop constraint if exists user_roles_branch_id_fkey;

alter table public.user_roles
add constraint user_roles_branch_id_fkey
foreign key (branch_id) references public.organization_branches(id) on delete set null;

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invited_email text not null check (position('@' in invited_email) > 1),
  invited_user_id uuid references public.profiles(id) on delete set null,
  invited_by uuid references public.profiles(id) on delete set null default auth.uid(),
  membership_type text not null default 'member'
    check (membership_type in ('admin', 'member', 'viewer')),
  role_id uuid not null references public.roles(id) on delete restrict,
  branch_id uuid references public.organization_branches(id) on delete set null,
  token_hash text not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'expired', 'revoked')),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  source text not null default 'platform.organization_staff_engine'
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create table if not exists public.organization_staff_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.organization_branches(id) on delete set null,
  invitation_id uuid references public.organization_invitations(id) on delete set null,
  role_id uuid references public.roles(id) on delete set null,
  actor_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  subject_user_id uuid references public.profiles(id) on delete set null,
  event_type_key text not null
    check (event_type_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  from_status text,
  to_status text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, idempotency_key)
);

create index if not exists organization_branches_org_status_idx
on public.organization_branches (organization_id, status);

create index if not exists user_roles_branch_idx
on public.user_roles (organization_id, branch_id, user_id, status);

create index if not exists organization_invitations_email_status_idx
on public.organization_invitations (lower(invited_email), status, expires_at);

create index if not exists organization_staff_events_org_idx
on public.organization_staff_events (organization_id, created_at desc);

create or replace function public.has_permission(
  target_permission text,
  target_organization_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles assigned_role
    join public.roles role_record on role_record.id = assigned_role.role_id
    join public.role_permissions role_permission on role_permission.role_id = role_record.id
    join public.permissions permission_record on permission_record.id = role_permission.permission_id
    where assigned_role.user_id = auth.uid()
      and assigned_role.status = 'active'
      and role_record.status = 'active'
      and permission_record.key = target_permission
      and (assigned_role.ends_at is null or assigned_role.ends_at > timezone('utc', now()))
      and (
        assigned_role.organization_id is null
        or exists (
          select 1
          from public.organization_memberships membership
          where membership.organization_id = assigned_role.organization_id
            and membership.user_id = auth.uid()
            and membership.status = 'active'
        )
      )
      and (
        target_organization_id is null
        or assigned_role.organization_id is null
        or assigned_role.organization_id = target_organization_id
      )
      and (
        role_record.organization_id is null
        or target_organization_id is null
        or role_record.organization_id = target_organization_id
      )
  );
$$;

create or replace function public.has_permission_for_branch(
  target_permission text,
  target_organization_id uuid,
  target_branch_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles assigned_role
    join public.roles role_record on role_record.id = assigned_role.role_id
    join public.role_permissions role_permission on role_permission.role_id = role_record.id
    join public.permissions permission_record on permission_record.id = role_permission.permission_id
    join public.organization_memberships membership
      on membership.organization_id = assigned_role.organization_id
      and membership.user_id = assigned_role.user_id
      and membership.status = 'active'
    where assigned_role.user_id = auth.uid()
      and assigned_role.organization_id = target_organization_id
      and assigned_role.status = 'active'
      and role_record.organization_id = target_organization_id
      and role_record.status = 'active'
      and permission_record.key = target_permission
      and (assigned_role.ends_at is null or assigned_role.ends_at > timezone('utc', now()))
      and (
        target_branch_id is null
        or assigned_role.branch_id is null
        or assigned_role.branch_id = target_branch_id
      )
  );
$$;

create or replace function public.can_manage_organization_staff(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or public.has_permission('platform.organizations.manage', target_organization_id)
    or public.has_permission('business.staff.manage', target_organization_id)
    or public.is_organization_creator(target_organization_id);
$$;

create or replace function public.can_read_organization_staff(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or public.can_manage_organization_staff(target_organization_id)
    or public.is_organization_member(target_organization_id);
$$;

create or replace function public.prevent_organization_staff_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'organization staff events are append-only';
end;
$$;

create or replace function public.record_organization_staff_event(
  target_organization_id uuid,
  target_event_type_key text,
  target_idempotency_key text,
  target_subject_user_id uuid default null,
  target_invitation_id uuid default null,
  target_role_id uuid default null,
  target_branch_id uuid default null,
  target_from_status text default null,
  target_to_status text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  event_id uuid;
begin
  if target_organization_id is null then
    raise exception 'target_organization_id is required';
  end if;

  if target_event_type_key is null
    or target_event_type_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_event_type_key must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  insert into public.organization_staff_events (
    organization_id,
    branch_id,
    invitation_id,
    role_id,
    subject_user_id,
    event_type_key,
    from_status,
    to_status,
    idempotency_key,
    metadata
  )
  values (
    target_organization_id,
    target_branch_id,
    target_invitation_id,
    target_role_id,
    target_subject_user_id,
    target_event_type_key,
    target_from_status,
    target_to_status,
    target_idempotency_key,
    target_metadata
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning id into event_id;

  if event_id is null then
    select existing.id
    into event_id
    from public.organization_staff_events existing
    where existing.organization_id = target_organization_id
      and existing.idempotency_key = target_idempotency_key;
  end if;

  return event_id;
end;
$$;

create or replace function public.create_organization_branch(
  target_organization_id uuid,
  target_branch_key text,
  target_display_name text,
  target_address jsonb,
  target_geo_location jsonb,
  target_status text,
  target_source text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  branch_id uuid;
  existing_record record;
begin
  if not public.can_manage_organization_staff(target_organization_id) then
    raise exception 'organization staff management permission is required';
  end if;

  if target_branch_key is null or target_branch_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_branch_key must be a valid platform key';
  end if;

  if target_display_name is null or btrim(target_display_name) = '' then
    raise exception 'target_display_name is required';
  end if;

  if target_address is null or jsonb_typeof(target_address) <> 'object'
    or target_geo_location is null or jsonb_typeof(target_geo_location) <> 'object'
    or target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'branch JSON inputs must be objects';
  end if;

  if target_status not in ('draft', 'active', 'paused', 'suspended', 'archived') then
    raise exception 'target_status is not supported';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  insert into public.organization_branches (
    organization_id,
    key,
    display_name,
    address,
    geo_location,
    status,
    source,
    idempotency_key,
    metadata
  )
  values (
    target_organization_id,
    target_branch_key,
    target_display_name,
    target_address,
    target_geo_location,
    target_status,
    target_source,
    target_idempotency_key,
    target_metadata
  )
  on conflict (source, idempotency_key)
  do nothing
  returning id into branch_id;

  if branch_id is null then
    select existing.*
    into existing_record
    from public.organization_branches existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'branch idempotency lookup failed';
    end if;

    return existing_record.id;
  end if;

  perform public.record_organization_staff_event(
    target_organization_id,
    'event.organization.branch.created',
    target_idempotency_key || ':event',
    null,
    null,
    null,
    branch_id,
    null,
    target_status,
    target_metadata
  );

  return branch_id;
end;
$$;

create or replace function public.configure_organization_role(
  target_organization_id uuid,
  target_role_key text,
  target_display_name text,
  target_permission_keys text[],
  target_description text,
  target_branch_id uuid,
  target_source text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  configured_role_id uuid;
  permission_key text;
  permission_count integer;
begin
  if not public.can_manage_organization_staff(target_organization_id) then
    raise exception 'organization staff management permission is required';
  end if;

  if target_role_key is null or target_role_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_role_key must be a valid platform key';
  end if;

  if target_display_name is null or btrim(target_display_name) = '' then
    raise exception 'target_display_name is required';
  end if;

  if target_permission_keys is null or array_length(target_permission_keys, 1) is null then
    raise exception 'target_permission_keys is required';
  end if;

  foreach permission_key in array target_permission_keys loop
    if permission_key is null or permission_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
      raise exception 'target_permission_keys contains an invalid permission key';
    end if;

    if permission_key like 'platform.%' then
      raise exception 'organization roles cannot grant platform permissions';
    end if;
  end loop;

  select count(*)
  into permission_count
  from public.permissions permission_record
  where permission_record.key = any(target_permission_keys);

  if permission_count <> array_length(target_permission_keys, 1) then
    raise exception 'target_permission_keys must reference configured permissions';
  end if;

  if target_branch_id is not null and not exists (
    select 1
    from public.organization_branches branch
    where branch.id = target_branch_id
      and branch.organization_id = target_organization_id
      and branch.status = 'active'
  ) then
    raise exception 'target_branch_id must reference an active branch in the organization';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  insert into public.roles (
    organization_id,
    key,
    display_name,
    description,
    status,
    metadata
  )
  values (
    target_organization_id,
    target_role_key,
    target_display_name,
    target_description,
    'active',
    target_metadata || jsonb_build_object(
      'source',
      target_source,
      'idempotency_key',
      target_idempotency_key,
      'branch_id',
      target_branch_id
    )
  )
  on conflict do nothing
  returning id into configured_role_id;

  if configured_role_id is null then
    select existing.id
    into configured_role_id
    from public.roles existing
    where existing.organization_id = target_organization_id
      and existing.key = target_role_key;

    if configured_role_id is null then
      raise exception 'organization role idempotency lookup failed';
    end if;

    update public.roles
    set display_name = target_display_name,
        description = target_description,
        status = 'active',
        metadata = metadata || target_metadata || jsonb_build_object(
          'source',
          target_source,
          'idempotency_key',
          target_idempotency_key,
          'branch_id',
          target_branch_id
        ),
        updated_at = timezone('utc', now())
    where id = configured_role_id;
  end if;

  delete from public.role_permissions
  where role_permissions.role_id = configured_role_id;

  insert into public.role_permissions (
    role_id,
    permission_id,
    conditions
  )
  select
    configured_role_id,
    permission_record.id,
    jsonb_build_object('branch_id', target_branch_id)
  from public.permissions permission_record
  where permission_record.key = any(target_permission_keys);

  perform public.record_organization_staff_event(
    target_organization_id,
    'event.organization.role.configured',
    target_idempotency_key || ':event',
    null,
    null,
    configured_role_id,
    target_branch_id,
    null,
    'active',
    target_metadata || jsonb_build_object('permission_keys', target_permission_keys)
  );

  return configured_role_id;
end;
$$;

create or replace function public.invite_organization_staff(
  target_organization_id uuid,
  target_invited_email text,
  target_role_key text,
  target_branch_key text,
  target_membership_type text,
  target_expires_at timestamptz,
  target_source text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  role_record record;
  target_branch_id uuid;
  invited_profile_id uuid;
  invitation_id uuid;
  existing_record record;
begin
  if not public.can_manage_organization_staff(target_organization_id) then
    raise exception 'organization staff management permission is required';
  end if;

  if target_invited_email is null or position('@' in target_invited_email) <= 1 then
    raise exception 'target_invited_email must be a valid email address';
  end if;

  if target_role_key is null or target_role_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_role_key must be a valid platform key';
  end if;

  if target_membership_type not in ('admin', 'member', 'viewer') then
    raise exception 'target_membership_type is not supported';
  end if;

  if target_expires_at is null or target_expires_at <= timezone('utc', now()) then
    raise exception 'target_expires_at must be in the future';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select role.id, role.key
  into role_record
  from public.roles role
  where role.organization_id = target_organization_id
    and role.key = target_role_key
    and role.status = 'active';

  if not found then
    raise exception 'target_role_key must reference an active organization role';
  end if;

  if target_branch_key is not null then
    select branch.id
    into target_branch_id
    from public.organization_branches branch
    where branch.organization_id = target_organization_id
      and branch.key = target_branch_key
      and branch.status = 'active';

    if not found then
      raise exception 'target_branch_key must reference an active organization branch';
    end if;
  end if;

  select auth_user.id
  into invited_profile_id
  from auth.users auth_user
  where lower(auth_user.email) = lower(target_invited_email)
  order by auth_user.created_at asc
  limit 1;

  insert into public.organization_invitations (
    organization_id,
    invited_email,
    invited_user_id,
    membership_type,
    role_id,
    branch_id,
    token_hash,
    status,
    expires_at,
    source,
    idempotency_key,
    metadata
  )
  values (
    target_organization_id,
    lower(target_invited_email),
    invited_profile_id,
    target_membership_type,
    role_record.id,
    target_branch_id,
    gen_random_uuid()::text,
    'pending',
    target_expires_at,
    target_source,
    target_idempotency_key,
    target_metadata
  )
  on conflict (source, idempotency_key)
  do nothing
  returning id into invitation_id;

  if invitation_id is null then
    select existing.*
    into existing_record
    from public.organization_invitations existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'invitation idempotency lookup failed';
    end if;

    return existing_record.id;
  end if;

  perform public.record_organization_staff_event(
    target_organization_id,
    'event.organization.staff.invited',
    target_idempotency_key || ':event',
    invited_profile_id,
    invitation_id,
    role_record.id,
    target_branch_id,
    null,
    'pending',
    target_metadata
  );

  return invitation_id;
end;
$$;

create or replace function public.accept_organization_invitation(
  target_invitation_id uuid,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation_record record;
  accepting_user_id uuid;
  accepting_email text;
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  if target_invitation_id is null then
    raise exception 'target_invitation_id is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  accepting_user_id := auth.uid();

  select auth_user.email
  into accepting_email
  from auth.users auth_user
  where auth_user.id = accepting_user_id;

  if accepting_email is null then
    raise exception 'accepting user email was not found';
  end if;

  select invitation.*
  into invitation_record
  from public.organization_invitations invitation
  where invitation.id = target_invitation_id
  for update;

  if not found then
    raise exception 'target_invitation_id must reference an existing invitation';
  end if;

  if invitation_record.status = 'accepted' then
    return invitation_record.id;
  end if;

  if invitation_record.status <> 'pending' then
    raise exception 'only pending invitations can be accepted';
  end if;

  if invitation_record.expires_at <= timezone('utc', now()) then
    update public.organization_invitations
    set status = 'expired',
        updated_at = timezone('utc', now())
    where id = target_invitation_id;

    raise exception 'invitation has expired';
  end if;

  if lower(invitation_record.invited_email) <> lower(accepting_email) then
    raise exception 'invitation email does not match the authenticated user';
  end if;

  insert into public.organization_memberships (
    organization_id,
    user_id,
    membership_type,
    status,
    metadata,
    created_by
  )
  values (
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
    organization_id,
    user_id,
    role_id,
    branch_id,
    access_scope,
    status,
    created_by
  )
  values (
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

create or replace function public.set_organization_staff_status(
  target_organization_id uuid,
  target_user_id uuid,
  target_status text,
  target_reason text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  membership_record record;
  active_owner_count integer;
begin
  if not public.can_manage_organization_staff(target_organization_id) then
    raise exception 'organization staff management permission is required';
  end if;

  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;

  if target_status not in ('active', 'suspended', 'removed') then
    raise exception 'target_status is not supported';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select membership.*
  into membership_record
  from public.organization_memberships membership
  where membership.organization_id = target_organization_id
    and membership.user_id = target_user_id
  for update;

  if not found then
    raise exception 'target_user_id must be an organization member';
  end if;

  if membership_record.membership_type = 'owner' and target_status <> 'active' then
    select count(*)
    into active_owner_count
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.membership_type = 'owner'
      and membership.status = 'active'
      and membership.user_id <> target_user_id;

    if active_owner_count = 0 then
      raise exception 'organization must retain at least one active owner';
    end if;
  end if;

  update public.organization_memberships
  set status = target_status,
      metadata = metadata || target_metadata || jsonb_build_object('status_reason', target_reason),
      updated_at = timezone('utc', now())
  where id = membership_record.id;

  update public.user_roles
  set status = case when target_status = 'active' then 'active' else 'suspended' end,
      updated_at = timezone('utc', now())
  where organization_id = target_organization_id
    and user_id = target_user_id;

  perform public.record_organization_staff_event(
    target_organization_id,
    'event.organization.staff.status_changed',
    target_idempotency_key || ':event',
    target_user_id,
    null,
    null,
    null,
    membership_record.status,
    target_status,
    target_metadata || jsonb_build_object('reason', target_reason)
  );

  return membership_record.id;
end;
$$;

create or replace function public.transfer_organization_ownership(
  target_organization_id uuid,
  target_from_user_id uuid,
  target_to_user_id uuid,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_role_id uuid;
begin
  if not public.can_manage_organization_staff(target_organization_id) then
    raise exception 'organization staff management permission is required';
  end if;

  if target_from_user_id is null or target_to_user_id is null then
    raise exception 'target_from_user_id and target_to_user_id are required';
  end if;

  if target_from_user_id = target_to_user_id then
    raise exception 'ownership transfer requires two different users';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_from_user_id
      and membership.membership_type = 'owner'
      and membership.status = 'active'
  ) then
    raise exception 'target_from_user_id must be an active owner';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_to_user_id
      and membership.status = 'active'
  ) then
    raise exception 'target_to_user_id must be an active organization member';
  end if;

  select role_record.id
  into owner_role_id
  from public.roles role_record
  where role_record.organization_id = target_organization_id
    and role_record.key = 'business.owner'
    and role_record.status = 'active';

  if owner_role_id is null then
    raise exception 'business owner role is not configured for this organization';
  end if;

  update public.organization_memberships
  set membership_type = 'admin',
      updated_at = timezone('utc', now())
  where organization_id = target_organization_id
    and user_id = target_from_user_id;

  update public.user_roles
  set status = 'suspended',
      updated_at = timezone('utc', now())
  where organization_id = target_organization_id
    and user_id = target_from_user_id
    and role_id = owner_role_id;

  update public.organization_memberships
  set membership_type = 'owner',
      status = 'active',
      updated_at = timezone('utc', now())
  where organization_id = target_organization_id
    and user_id = target_to_user_id;

  insert into public.user_roles (
    organization_id,
    user_id,
    role_id,
    access_scope,
    status,
    created_by
  )
  values (
    target_organization_id,
    target_to_user_id,
    owner_role_id,
    jsonb_build_object('source', 'platform.organization_staff_engine'),
    'active',
    auth.uid()
  )
  on conflict (organization_id, user_id, role_id) do update
  set status = 'active',
      access_scope = public.user_roles.access_scope || excluded.access_scope,
      updated_at = timezone('utc', now());

  perform public.record_organization_staff_event(
    target_organization_id,
    'event.organization.ownership.transferred',
    target_idempotency_key || ':event',
    target_to_user_id,
    null,
    owner_role_id,
    null,
    'admin',
    'owner',
    target_metadata || jsonb_build_object('from_user_id', target_from_user_id)
  );

  return owner_role_id;
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'organization_branches',
    'organization_invitations'
  ] loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I', target_table, target_table);
    execute format(
      'create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      target_table,
      target_table
    );
  end loop;
end $$;

drop trigger if exists prevent_organization_staff_events_update on public.organization_staff_events;
create trigger prevent_organization_staff_events_update
before update on public.organization_staff_events
for each row execute function public.prevent_organization_staff_event_mutation();

drop trigger if exists prevent_organization_staff_events_delete on public.organization_staff_events;
create trigger prevent_organization_staff_events_delete
before delete on public.organization_staff_events
for each row execute function public.prevent_organization_staff_event_mutation();

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'organization_branches',
    'organization_invitations',
    'organization_staff_events'
  ] loop
    execute format('drop trigger if exists audit_%I_mutations on public.%I', target_table, target_table);
    execute format(
      'create trigger audit_%I_mutations after insert or update or delete on public.%I for each row execute function public.record_table_audit()',
      target_table,
      target_table
    );
  end loop;
end $$;

alter table public.organization_branches enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.organization_staff_events enable row level security;

drop policy if exists organization_memberships_manage_privileged on public.organization_memberships;
drop policy if exists organization_memberships_no_direct_insert on public.organization_memberships;
drop policy if exists organization_memberships_no_direct_update on public.organization_memberships;
drop policy if exists organization_memberships_no_direct_delete on public.organization_memberships;
drop policy if exists user_roles_manage_privileged on public.user_roles;
drop policy if exists user_roles_no_direct_insert on public.user_roles;
drop policy if exists user_roles_no_direct_update on public.user_roles;
drop policy if exists user_roles_no_direct_delete on public.user_roles;
drop policy if exists organization_branches_select_member_or_privileged on public.organization_branches;
drop policy if exists organization_branches_no_direct_insert on public.organization_branches;
drop policy if exists organization_branches_no_direct_update on public.organization_branches;
drop policy if exists organization_branches_no_direct_delete on public.organization_branches;
drop policy if exists organization_invitations_select_related_or_privileged on public.organization_invitations;
drop policy if exists organization_invitations_no_direct_insert on public.organization_invitations;
drop policy if exists organization_invitations_no_direct_update on public.organization_invitations;
drop policy if exists organization_invitations_no_direct_delete on public.organization_invitations;
drop policy if exists organization_staff_events_select_member_or_privileged on public.organization_staff_events;
drop policy if exists organization_staff_events_no_direct_insert on public.organization_staff_events;
drop policy if exists organization_staff_events_no_direct_update on public.organization_staff_events;
drop policy if exists organization_staff_events_no_direct_delete on public.organization_staff_events;

create policy organization_memberships_no_direct_insert on public.organization_memberships
for insert to authenticated
with check (false);

create policy organization_memberships_no_direct_update on public.organization_memberships
for update to authenticated
using (false)
with check (false);

create policy organization_memberships_no_direct_delete on public.organization_memberships
for delete to authenticated
using (false);

create policy user_roles_no_direct_insert on public.user_roles
for insert to authenticated
with check (false);

create policy user_roles_no_direct_update on public.user_roles
for update to authenticated
using (false)
with check (false);

create policy user_roles_no_direct_delete on public.user_roles
for delete to authenticated
using (false);

create policy organization_branches_select_member_or_privileged on public.organization_branches
for select to authenticated
using (public.can_read_organization_staff(organization_id));

create policy organization_branches_no_direct_insert on public.organization_branches
for insert to authenticated
with check (false);

create policy organization_branches_no_direct_update on public.organization_branches
for update to authenticated
using (false)
with check (false);

create policy organization_branches_no_direct_delete on public.organization_branches
for delete to authenticated
using (false);

create policy organization_invitations_select_related_or_privileged on public.organization_invitations
for select to authenticated
using (
  public.can_manage_organization_staff(organization_id)
  or invited_user_id = auth.uid()
);

create policy organization_invitations_no_direct_insert on public.organization_invitations
for insert to authenticated
with check (false);

create policy organization_invitations_no_direct_update on public.organization_invitations
for update to authenticated
using (false)
with check (false);

create policy organization_invitations_no_direct_delete on public.organization_invitations
for delete to authenticated
using (false);

create policy organization_staff_events_select_member_or_privileged on public.organization_staff_events
for select to authenticated
using (public.can_read_organization_staff(organization_id));

create policy organization_staff_events_no_direct_insert on public.organization_staff_events
for insert to authenticated
with check (false);

create policy organization_staff_events_no_direct_update on public.organization_staff_events
for update to authenticated
using (false)
with check (false);

create policy organization_staff_events_no_direct_delete on public.organization_staff_events
for delete to authenticated
using (false);

grant select, insert, update, delete on
  public.organization_branches,
  public.organization_invitations,
  public.organization_staff_events
to authenticated;

grant select, insert, update, delete on
  public.organization_branches,
  public.organization_invitations,
  public.organization_staff_events
to service_role;

revoke all on function public.has_permission(text, uuid) from public;
revoke all on function public.has_permission_for_branch(text, uuid, uuid) from public;
revoke all on function public.can_manage_organization_staff(uuid) from public;
revoke all on function public.can_read_organization_staff(uuid) from public;
revoke all on function public.record_organization_staff_event(uuid, text, text, uuid, uuid, uuid, uuid, text, text, jsonb) from public;
revoke all on function public.create_organization_branch(uuid, text, text, jsonb, jsonb, text, text, text, jsonb) from public;
revoke all on function public.configure_organization_role(uuid, text, text, text[], text, uuid, text, text, jsonb) from public;
revoke all on function public.invite_organization_staff(uuid, text, text, text, text, timestamptz, text, text, jsonb) from public;
revoke all on function public.accept_organization_invitation(uuid, text, jsonb) from public;
revoke all on function public.set_organization_staff_status(uuid, uuid, text, text, text, jsonb) from public;
revoke all on function public.transfer_organization_ownership(uuid, uuid, uuid, text, jsonb) from public;

revoke all on function public.has_permission(text, uuid) from anon;
revoke all on function public.has_permission_for_branch(text, uuid, uuid) from anon;
revoke all on function public.can_manage_organization_staff(uuid) from anon;
revoke all on function public.can_read_organization_staff(uuid) from anon;
revoke all on function public.record_organization_staff_event(uuid, text, text, uuid, uuid, uuid, uuid, text, text, jsonb) from anon;
revoke all on function public.create_organization_branch(uuid, text, text, jsonb, jsonb, text, text, text, jsonb) from anon;
revoke all on function public.configure_organization_role(uuid, text, text, text[], text, uuid, text, text, jsonb) from anon;
revoke all on function public.invite_organization_staff(uuid, text, text, text, text, timestamptz, text, text, jsonb) from anon;
revoke all on function public.accept_organization_invitation(uuid, text, jsonb) from anon;
revoke all on function public.set_organization_staff_status(uuid, uuid, text, text, text, jsonb) from anon;
revoke all on function public.transfer_organization_ownership(uuid, uuid, uuid, text, jsonb) from anon;

grant execute on function public.has_permission(text, uuid) to authenticated, service_role;
grant execute on function public.has_permission_for_branch(text, uuid, uuid) to authenticated, service_role;
grant execute on function public.can_manage_organization_staff(uuid) to authenticated, service_role;
grant execute on function public.can_read_organization_staff(uuid) to authenticated, service_role;
grant execute on function public.create_organization_branch(uuid, text, text, jsonb, jsonb, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.configure_organization_role(uuid, text, text, text[], text, uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function public.invite_organization_staff(uuid, text, text, text, text, timestamptz, text, text, jsonb) to authenticated, service_role;
grant execute on function public.accept_organization_invitation(uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.set_organization_staff_status(uuid, uuid, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.transfer_organization_ownership(uuid, uuid, uuid, text, jsonb) to authenticated, service_role;

commit;
