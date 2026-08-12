begin;

insert into public.permissions (key, description, risk_level)
values
  ('platform.content.read', 'Read platform product content placements and publications.', 'standard'),
  ('platform.content.manage', 'Manage platform product content placements and publication state.', 'high')
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    updated_at = timezone('utc', now());

insert into public.role_permissions (role_id, permission_id)
select role_record.id, permission_record.id
from public.roles role_record
cross join public.permissions permission_record
where role_record.key = 'platform.admin'
  and role_record.organization_id is null
  and permission_record.key in ('platform.content.read', 'platform.content.manage')
on conflict do nothing;

select public.configure_platform_admin_role(
  'platform.company_admin',
  'Company Admin',
  'Govern company records, applications, organization users, and content across modules.',
  array[
    'platform.organizations.read',
    'platform.organizations.manage',
    'platform.users.read',
    'platform.users.manage',
    'platform.applications.read',
    'platform.applications.manage',
    'platform.applications.review',
    'platform.content.read',
    'platform.content.manage',
    'platform.configuration.read'
  ],
  '{"system_role":true,"admin_area":"company"}'::jsonb,
  'active'
);

select public.configure_platform_admin_role(
  'platform.content_admin',
  'Content Admin',
  'Manage brand assets, onboarding content, promotion banners, and product publications.',
  array[
    'platform.content.read',
    'platform.content.manage',
    'platform.assets.manage',
    'platform.configuration.read'
  ],
  '{"system_role":true,"admin_area":"content"}'::jsonb,
  'active'
);

select public.configure_platform_admin_role(
  'platform.security_admin',
  'Security Admin',
  'Manage administrator roles, user access, profiles, and audit investigations.',
  array[
    'platform.admins.read',
    'platform.admins.manage',
    'platform.admins.super_manage',
    'platform.users.read',
    'platform.users.manage',
    'platform.roles.read',
    'platform.roles.manage',
    'platform.audit.read',
    'platform.logs.read'
  ],
  '{"system_role":true,"admin_area":"security"}'::jsonb,
  'active'
);

select public.configure_platform_admin_role(
  'platform.system_admin',
  'System Admin',
  'Control health checks, background jobs, providers, configuration, webhooks, cache, and rate limits.',
  array[
    'platform.health.read',
    'platform.health.manage',
    'platform.jobs.manage',
    'platform.logs.read',
    'platform.audit.read',
    'platform.configuration.read',
    'platform.configuration.manage',
    'platform.providers.read',
    'platform.providers.manage',
    'platform.webhooks.manage',
    'platform.api_clients.manage',
    'platform.rate_limits.manage',
    'platform.cache.read',
    'platform.cache.manage'
  ],
  '{"system_role":true,"admin_area":"system"}'::jsonb,
  'active'
);

select public.configure_platform_admin_role(
  'platform.finance_admin',
  'Finance Admin',
  'Manage finance, wallet, settlement, commission, withdrawal, and reconciliation operations.',
  array[
    'platform.financial.read',
    'platform.financial.manage',
    'platform.wallets.read',
    'platform.wallets.manage',
    'platform.payments.read',
    'platform.escrow.read',
    'platform.escrow.manage',
    'platform.settlement.read',
    'platform.settlement.manage',
    'platform.settlement.execute',
    'platform.commissions.execute',
    'platform.withdrawals.read',
    'platform.withdrawals.execute',
    'platform.reconciliation.execute',
    'platform.audit.read'
  ],
  '{"system_role":true,"admin_area":"finance"}'::jsonb,
  'active'
);

update public.platform_admin_role_templates
set is_system = true,
    updated_at = timezone('utc', now())
where key in (
  'platform.company_admin',
  'platform.content_admin',
  'platform.security_admin',
  'platform.system_admin',
  'platform.finance_admin'
);

select public.configure_platform_admin_role(
  'platform.super_admin',
  'Platform Super Admin',
  'Protected recovery owner with full platform authority.',
  array(
    select permission_record.key
    from public.permissions permission_record
    order by permission_record.key
  ),
  '{"system_role":true,"admin_area":"owner","protected":true}'::jsonb,
  'active'
);

create or replace function public.configure_platform_organization(
  target_organization_id uuid default null,
  target_slug text default null,
  target_display_name text default null,
  target_legal_name text default null,
  target_status text default 'active',
  target_metadata jsonb default '{}'::jsonb,
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  organization_record_id uuid;
begin
  if auth.role() <> 'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.organizations.manage', target_organization_id) then
    raise exception 'not authorized to manage platform organizations';
  end if;

  if target_slug is null
    or target_slug !~ '^[a-z][a-z0-9-]{2,62}[a-z0-9]$'
    or target_slug ~ '--' then
    raise exception 'target_slug must be a valid organization slug';
  end if;

  if target_display_name is null or btrim(target_display_name) = '' then
    raise exception 'target_display_name is required';
  end if;

  if target_status not in ('pending', 'active', 'suspended', 'archived') then
    raise exception 'target_status must be pending, active, suspended, or archived';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  if target_idempotency_key is not null and btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key cannot be blank';
  end if;

  if target_organization_id is null then
    insert into public.organizations (
      slug,
      display_name,
      legal_name,
      status,
      metadata,
      created_by
    )
    values (
      target_slug,
      target_display_name,
      target_legal_name,
      target_status,
      target_metadata,
      auth.uid()
    )
    on conflict (slug) do update
    set display_name = excluded.display_name,
        legal_name = excluded.legal_name,
        status = excluded.status,
        metadata = excluded.metadata,
        updated_at = timezone('utc', now())
    returning id into organization_record_id;
  else
    update public.organizations
    set slug = target_slug,
        display_name = target_display_name,
        legal_name = target_legal_name,
        status = target_status,
        metadata = target_metadata,
        updated_at = timezone('utc', now())
    where id = target_organization_id
    returning id into organization_record_id;

    if organization_record_id is null then
      raise exception 'target organization was not found';
    end if;
  end if;

  return organization_record_id;
end;
$$;

create or replace function public.configure_product_content_placement(
  target_key text,
  target_display_name text,
  target_surface_key text,
  target_content_kind text,
  target_allowed_audiences text[] default array['public']::text[],
  target_status text default 'active',
  target_constraints jsonb default '{}'::jsonb,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  placement_record_id uuid;
  normalized_audiences text[];
begin
  if auth.role() <> 'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.content.manage', null) then
    raise exception 'not authorized to manage product content placements';
  end if;

  if target_key is null or target_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_key must be a valid platform key';
  end if;

  if target_surface_key is null or target_surface_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_surface_key must be a valid platform key';
  end if;

  if target_display_name is null or btrim(target_display_name) = '' then
    raise exception 'target_display_name is required';
  end if;

  if target_content_kind not in ('brand', 'onboarding', 'promotion', 'safety', 'empty_state', 'illustration', 'service') then
    raise exception 'target_content_kind is not supported';
  end if;

  if target_status not in ('active', 'inactive', 'retired') then
    raise exception 'target_status must be active, inactive, or retired';
  end if;

  if target_constraints is null or jsonb_typeof(target_constraints) <> 'object' then
    raise exception 'target_constraints must be a JSON object';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select coalesce(array_agg(distinct audience order by audience), array['public']::text[])
  into normalized_audiences
  from unnest(coalesce(target_allowed_audiences, array['public']::text[])) as audience_input(audience)
  where audience is not null and btrim(audience) <> '';

  if cardinality(normalized_audiences) = 0 then
    normalized_audiences := array['public']::text[];
  end if;

  insert into public.product_content_placements (
    key,
    display_name,
    surface_key,
    content_kind,
    allowed_audiences,
    status,
    constraints,
    metadata,
    created_by,
    updated_by
  )
  values (
    target_key,
    target_display_name,
    target_surface_key,
    target_content_kind,
    normalized_audiences,
    target_status,
    target_constraints,
    target_metadata,
    auth.uid(),
    auth.uid()
  )
  on conflict (key) do update
  set display_name = excluded.display_name,
      surface_key = excluded.surface_key,
      content_kind = excluded.content_kind,
      allowed_audiences = excluded.allowed_audiences,
      status = excluded.status,
      constraints = excluded.constraints,
      metadata = excluded.metadata,
      updated_by = auth.uid(),
      updated_at = timezone('utc', now())
  returning id into placement_record_id;

  return placement_record_id;
end;
$$;

create or replace function public.configure_product_content_publication(
  target_publication_id uuid default null,
  target_publication_key text default null,
  target_placement_key text default null,
  target_organization_id uuid default null,
  target_module_key text default null,
  target_audience_keys text[] default array['public']::text[],
  target_country_codes text[] default '{}'::text[],
  target_regions text[] default '{}'::text[],
  target_cities text[] default '{}'::text[],
  target_title text default null,
  target_body text default null,
  target_accessibility_label text default null,
  target_cta_label text default null,
  target_cta_action jsonb default '{}'::jsonb,
  target_media_asset_id uuid default null,
  target_priority integer default 0,
  target_status text default 'draft',
  target_starts_at timestamptz default null,
  target_ends_at timestamptz default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  publication_record_id uuid;
  normalized_audiences text[];
begin
  if auth.role() <> 'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.content.manage', target_organization_id)
    and not public.has_permission('platform.content.manage', null) then
    raise exception 'not authorized to manage product content publications';
  end if;

  if target_publication_id is null then
    if target_publication_key is null or target_publication_key !~ '^[a-z][a-z0-9_.:-]{2,160}$' then
      raise exception 'target_publication_key must be a valid platform key';
    end if;
  end if;

  if target_placement_key is null or target_placement_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_placement_key must be a valid platform key';
  end if;

  if target_module_key is not null and target_module_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_module_key must be a valid platform key';
  end if;

  if target_status not in ('draft', 'published', 'paused', 'retired') then
    raise exception 'target_status must be draft, published, paused, or retired';
  end if;

  if target_cta_action is null or jsonb_typeof(target_cta_action) <> 'object' then
    raise exception 'target_cta_action must be a JSON object';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  if target_ends_at is not null and target_starts_at is not null and target_ends_at <= target_starts_at then
    raise exception 'target_ends_at must be after target_starts_at';
  end if;

  if not exists (
    select 1
    from public.product_content_placements placement
    where placement.key = target_placement_key
      and placement.status <> 'retired'
  ) then
    raise exception 'target_placement_key must reference an active content placement';
  end if;

  select coalesce(array_agg(distinct audience order by audience), array['public']::text[])
  into normalized_audiences
  from unnest(coalesce(target_audience_keys, array['public']::text[])) as audience_input(audience)
  where audience is not null and btrim(audience) <> '';

  if cardinality(normalized_audiences) = 0 then
    normalized_audiences := array['public']::text[];
  end if;

  if target_publication_id is null then
    select publication.id into publication_record_id
    from public.product_content_publications publication
    where publication.publication_key = target_publication_key;
  else
    publication_record_id := target_publication_id;
  end if;

  if publication_record_id is null then
    insert into public.product_content_publications (
      publication_key,
      placement_key,
      organization_id,
      module_key,
      audience_keys,
      country_codes,
      regions,
      cities,
      title,
      body,
      accessibility_label,
      cta_label,
      cta_action,
      media_asset_id,
      priority,
      status,
      starts_at,
      ends_at,
      published_at,
      metadata,
      created_by,
      updated_by
    )
    values (
      target_publication_key,
      target_placement_key,
      target_organization_id,
      target_module_key,
      normalized_audiences,
      coalesce(target_country_codes, '{}'::text[]),
      coalesce(target_regions, '{}'::text[]),
      coalesce(target_cities, '{}'::text[]),
      target_title,
      target_body,
      target_accessibility_label,
      target_cta_label,
      target_cta_action,
      target_media_asset_id,
      coalesce(target_priority, 0),
      target_status,
      target_starts_at,
      target_ends_at,
      case when target_status = 'published' then timezone('utc', now()) else null end,
      target_metadata,
      auth.uid(),
      auth.uid()
    )
    returning id into publication_record_id;
  else
    update public.product_content_publications
    set publication_key = coalesce(target_publication_key, publication_key),
        placement_key = target_placement_key,
        organization_id = target_organization_id,
        module_key = target_module_key,
        audience_keys = normalized_audiences,
        country_codes = coalesce(target_country_codes, '{}'::text[]),
        regions = coalesce(target_regions, '{}'::text[]),
        cities = coalesce(target_cities, '{}'::text[]),
        title = target_title,
        body = target_body,
        accessibility_label = target_accessibility_label,
        cta_label = target_cta_label,
        cta_action = target_cta_action,
        media_asset_id = target_media_asset_id,
        priority = coalesce(target_priority, 0),
        status = target_status,
        starts_at = target_starts_at,
        ends_at = target_ends_at,
        published_at = case
          when target_status = 'published' and published_at is null then timezone('utc', now())
          else published_at
        end,
        metadata = target_metadata,
        revision = revision + 1,
        updated_by = auth.uid(),
        updated_at = timezone('utc', now())
    where id = publication_record_id
    returning id into publication_record_id;

    if publication_record_id is null then
      raise exception 'target publication was not found';
    end if;
  end if;

  return publication_record_id;
end;
$$;

create or replace function public.set_product_content_publication_status(
  target_publication_id uuid,
  target_status text,
  target_reason text default null,
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  organization_record_id uuid;
  publication_record_id uuid;
begin
  if target_publication_id is null then
    raise exception 'target_publication_id is required';
  end if;

  if target_status not in ('draft', 'published', 'paused', 'retired') then
    raise exception 'target_status must be draft, published, paused, or retired';
  end if;

  select publication.organization_id
  into organization_record_id
  from public.product_content_publications publication
  where publication.id = target_publication_id;

  if not found then
    raise exception 'target publication was not found';
  end if;

  if auth.role() <> 'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.content.manage', organization_record_id)
    and not public.has_permission('platform.content.manage', null) then
    raise exception 'not authorized to change product content publication state';
  end if;

  if target_idempotency_key is not null and btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key cannot be blank';
  end if;

  update public.product_content_publications
  set status = target_status,
      published_at = case
        when target_status = 'published' and published_at is null then timezone('utc', now())
        else published_at
      end,
      metadata = case
        when target_reason is null or btrim(target_reason) = '' then metadata
        else jsonb_set(metadata, '{last_status_reason}', to_jsonb(target_reason), true)
      end,
      updated_by = auth.uid(),
      updated_at = timezone('utc', now())
  where id = target_publication_id
  returning id into publication_record_id;

  return publication_record_id;
end;
$$;

create or replace function public.set_background_job_status(
  target_job_id uuid,
  target_action text,
  target_reason text default null,
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  job_record_id uuid;
begin
  if auth.role() <> 'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.jobs.manage', null) then
    raise exception 'not authorized to manage background jobs';
  end if;

  if target_job_id is null then
    raise exception 'target_job_id is required';
  end if;

  if target_action not in ('retry', 'cancel') then
    raise exception 'target_action must be retry or cancel';
  end if;

  if target_idempotency_key is not null and btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key cannot be blank';
  end if;

  if target_action = 'retry' then
    update public.background_jobs
    set status = 'queued',
        run_at = timezone('utc', now()),
        locked_until = null,
        locked_by = null,
        last_error = null,
        updated_at = timezone('utc', now())
    where id = target_job_id
      and status in ('failed', 'cancelled')
    returning id into job_record_id;
  else
    update public.background_jobs
    set status = 'cancelled',
        locked_until = null,
        locked_by = null,
        updated_at = timezone('utc', now())
    where id = target_job_id
      and status in ('queued', 'running', 'failed')
    returning id into job_record_id;
  end if;

  if job_record_id is null then
    raise exception 'background job was not found or is not in a controllable state';
  end if;

  insert into public.application_logs (
    severity,
    source,
    message,
    context,
    actor_user_id
  )
  values (
    'notice',
    'platform.admin.jobs',
    'Background job control action requested.',
    jsonb_build_object(
      'job_id',
      target_job_id,
      'action',
      target_action,
      'reason',
      target_reason
    ),
    auth.uid()
  );

  return job_record_id;
end;
$$;

revoke all on function public.configure_platform_organization(uuid, text, text, text, text, jsonb, text) from public;
revoke all on function public.configure_product_content_placement(text, text, text, text, text[], text, jsonb, jsonb) from public;
revoke all on function public.configure_product_content_publication(uuid, text, text, uuid, text, text[], text[], text[], text[], text, text, text, text, jsonb, uuid, integer, text, timestamptz, timestamptz, jsonb) from public;
revoke all on function public.set_product_content_publication_status(uuid, text, text, text) from public;
revoke all on function public.set_background_job_status(uuid, text, text, text) from public;

grant execute on function public.configure_platform_organization(uuid, text, text, text, text, jsonb, text) to authenticated, service_role;
grant execute on function public.configure_product_content_placement(text, text, text, text, text[], text, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.configure_product_content_publication(uuid, text, text, uuid, text, text[], text[], text[], text[], text, text, text, text, jsonb, uuid, integer, text, timestamptz, timestamptz, jsonb) to authenticated, service_role;
grant execute on function public.set_product_content_publication_status(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.set_background_job_status(uuid, text, text, text) to authenticated, service_role;

drop policy if exists product_content_placements_read_privileged on public.product_content_placements;
create policy product_content_placements_read_privileged
on public.product_content_placements
for select to authenticated
using (
  public.has_permission('platform.content.read', null)
  or public.has_permission('platform.content.manage', null)
);

drop policy if exists product_content_publications_read_privileged on public.product_content_publications;
create policy product_content_publications_read_privileged
on public.product_content_publications
for select to authenticated
using (
  public.has_permission('platform.content.read', organization_id)
  or public.has_permission('platform.content.read', null)
  or public.has_permission('platform.content.manage', organization_id)
  or public.has_permission('platform.content.manage', null)
);

grant select on table public.product_content_placements to authenticated;
grant select on table public.product_content_publications to authenticated;

commit;
