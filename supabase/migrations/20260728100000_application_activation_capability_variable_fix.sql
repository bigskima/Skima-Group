begin;

create or replace function public.activate_approved_application(target_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  application_record record;
  application_type_record record;
  version_record record;
  organization_payload jsonb;
  vehicle_payload jsonb;
  slug_value text;
  display_name_value text;
  legal_name_value text;
  partner_type_key_value text;
  vehicle_type_key_value text;
  vehicle_type_id uuid;
  target_organization_id uuid;
  target_partner_id uuid;
  target_driver_id uuid;
  target_vehicle_id uuid;
  owner_role_id uuid;
  requested_capability_key text;
begin
  select application_record_table.*
  into application_record
  from public.application_records application_record_table
  where application_record_table.id = target_application_id
  for update;

  if not found then
    raise exception 'target_application_id must reference an existing application';
  end if;

  if application_record.status <> 'approved' then
    raise exception 'only approved applications can be activated';
  end if;

  select application_type.*
  into application_type_record
  from public.application_type_definitions application_type
  where application_type.id = application_record.application_type_id;

  select application_version.*
  into version_record
  from public.application_versions application_version
  where application_version.application_id = target_application_id
    and application_version.version = application_record.active_version;

  if application_type_record.application_category = 'business' then
    organization_payload := coalesce(
      version_record.payload -> 'organization',
      version_record.payload -> 'business',
      '{}'::jsonb
    );
    slug_value := nullif(organization_payload ->> 'slug', '');
    display_name_value := coalesce(
      nullif(organization_payload ->> 'displayName', ''),
      nullif(organization_payload ->> 'display_name', ''),
      nullif(version_record.payload ->> 'displayName', '')
    );
    legal_name_value := coalesce(
      nullif(organization_payload ->> 'legalName', ''),
      nullif(organization_payload ->> 'legal_name', ''),
      display_name_value
    );
    partner_type_key_value := coalesce(
      nullif(organization_payload ->> 'partnerTypeKey', ''),
      nullif(organization_payload ->> 'partner_type_key', ''),
      application_type_record.key
    );

    if slug_value is null or display_name_value is null then
      raise exception 'approved business applications require organization slug and display name';
    end if;

    if application_record.organization_id is null then
      insert into public.organizations (
        slug,
        legal_name,
        display_name,
        status,
        metadata,
        created_by
      )
      values (
        slug_value,
        legal_name_value,
        display_name_value,
        'active',
        jsonb_build_object('application_id', target_application_id),
        application_record.applicant_user_id
      )
      returning id into target_organization_id;
    else
      target_organization_id := application_record.organization_id;

      update public.organizations
      set legal_name = legal_name_value,
          display_name = display_name_value,
          status = 'active',
          metadata = metadata || jsonb_build_object('application_id', target_application_id),
          updated_at = timezone('utc', now())
      where id = target_organization_id;
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
      target_organization_id,
      application_record.applicant_user_id,
      'owner',
      'active',
      jsonb_build_object('source_application_id', target_application_id),
      auth.uid()
    )
    on conflict (organization_id, user_id) do update
    set membership_type = 'owner',
        status = 'active',
        metadata = public.organization_memberships.metadata || excluded.metadata,
        updated_at = timezone('utc', now());

    insert into public.roles (
      organization_id,
      key,
      display_name,
      description,
      status,
      metadata,
      created_by
    )
    values (
      target_organization_id,
      'business.owner',
      'Business Owner',
      'Organization owner role created by the application approval engine.',
      'active',
      jsonb_build_object('source_application_id', target_application_id),
      auth.uid()
    )
    on conflict do nothing;

    select role_record.id
    into owner_role_id
    from public.roles role_record
    where role_record.organization_id = target_organization_id
      and role_record.key = 'business.owner';

    insert into public.role_permissions (role_id, permission_id)
    select owner_role_id, permission_record.id
    from public.permissions permission_record
    where permission_record.key in (
      'business.applications.manage',
      'business.documents.manage',
      'business.staff.manage',
      'business.catalog.manage',
      'business.orders.manage',
      'business.finance.read',
      'business.settlements.read'
    )
    on conflict do nothing;

    insert into public.user_roles (
      organization_id,
      user_id,
      role_id,
      status,
      created_by
    )
    values (
      target_organization_id,
      application_record.applicant_user_id,
      owner_role_id,
      'active',
      auth.uid()
    )
    on conflict (organization_id, user_id, role_id) do update
    set status = 'active',
        updated_at = timezone('utc', now());

    insert into public.partner_profiles (
      organization_id,
      partner_type_key,
      status,
      behavior_config,
      metadata,
      created_by
    )
    values (
      target_organization_id,
      partner_type_key_value,
      'active',
      coalesce(application_type_record.activation_policy -> 'partner_behavior', '{}'::jsonb),
      jsonb_build_object('source_application_id', target_application_id),
      application_record.applicant_user_id
    )
    on conflict (organization_id) do update
    set partner_type_key = excluded.partner_type_key,
        status = 'active',
        behavior_config = public.partner_profiles.behavior_config || excluded.behavior_config,
        metadata = public.partner_profiles.metadata || excluded.metadata,
        updated_at = timezone('utc', now())
    returning id into target_partner_id;

    update public.application_records
    set organization_id = target_organization_id,
        activated_subject_type = 'partner',
        activated_subject_id = target_partner_id,
        updated_at = timezone('utc', now())
    where id = target_application_id;

    return jsonb_build_object(
      'activated_subject_type',
      'partner',
      'activated_subject_id',
      target_partner_id,
      'organization_id',
      target_organization_id
    );
  end if;

  if application_type_record.application_category = 'driver' then
    insert into public.driver_profiles (
      user_id,
      organization_id,
      operational_status,
      verification_status,
      metadata,
      created_by
    )
    values (
      application_record.applicant_user_id,
      application_record.organization_id,
      'offline',
      'approved',
      jsonb_build_object('source_application_id', target_application_id),
      auth.uid()
    )
    on conflict (user_id) do update
    set verification_status = 'approved',
        metadata = public.driver_profiles.metadata || excluded.metadata,
        updated_at = timezone('utc', now())
    returning id into target_driver_id;

    if jsonb_typeof(version_record.payload -> 'capabilityKeys') = 'array' then
      for requested_capability_key in
        select jsonb_array_elements_text(version_record.payload -> 'capabilityKeys')
      loop
        if not exists (
          select 1
          from public.capability_definitions capability
          where capability.key = requested_capability_key
            and capability.status = 'active'
        ) then
          raise exception 'approved driver capability is not configured: %', requested_capability_key;
        end if;

        insert into public.entity_capabilities (
          entity_type,
          entity_id,
          capability_key,
          constraints,
          status,
          verified_at,
          created_by
        )
        values (
          'driver',
          target_driver_id,
          requested_capability_key,
          jsonb_build_object('source_application_id', target_application_id),
          'active',
          timezone('utc', now()),
          auth.uid()
        )
        on conflict (entity_type, entity_id, capability_key) do update
        set status = 'active',
            verified_at = timezone('utc', now()),
            constraints = public.entity_capabilities.constraints || excluded.constraints,
            updated_at = timezone('utc', now());
      end loop;
    end if;

    update public.application_records
    set activated_subject_type = 'driver',
        activated_subject_id = target_driver_id,
        updated_at = timezone('utc', now())
    where id = target_application_id;

    return jsonb_build_object(
      'activated_subject_type',
      'driver',
      'activated_subject_id',
      target_driver_id
    );
  end if;

  if application_type_record.application_category = 'vehicle' then
    vehicle_payload := coalesce(version_record.payload -> 'vehicle', '{}'::jsonb);
    vehicle_type_key_value := coalesce(
      nullif(vehicle_payload ->> 'vehicleTypeKey', ''),
      nullif(vehicle_payload ->> 'vehicle_type_key', '')
    );

    if vehicle_type_key_value is null then
      raise exception 'approved vehicle applications require vehicle type key';
    end if;

    select vehicle_type.id
    into vehicle_type_id
    from public.vehicle_types vehicle_type
    where vehicle_type.key = vehicle_type_key_value
      and vehicle_type.status = 'active';

    if not found then
      raise exception 'approved vehicle type is not configured';
    end if;

    insert into public.vehicles (
      organization_id,
      owner_user_id,
      vehicle_type_id,
      status,
      capacity_profile,
      metadata,
      created_by
    )
    values (
      application_record.organization_id,
      application_record.applicant_user_id,
      vehicle_type_id,
      'active',
      coalesce(vehicle_payload -> 'capacityProfile', vehicle_payload -> 'capacity_profile', '{}'::jsonb),
      coalesce(vehicle_payload -> 'metadata', '{}'::jsonb) ||
        jsonb_build_object('source_application_id', target_application_id),
      auth.uid()
    )
    returning id into target_vehicle_id;

    if jsonb_typeof(vehicle_payload -> 'capabilityKeys') = 'array' then
      for requested_capability_key in
        select jsonb_array_elements_text(vehicle_payload -> 'capabilityKeys')
      loop
        if not exists (
          select 1
          from public.capability_definitions capability
          where capability.key = requested_capability_key
            and capability.status = 'active'
        ) then
          raise exception 'approved vehicle capability is not configured: %', requested_capability_key;
        end if;

        insert into public.entity_capabilities (
          entity_type,
          entity_id,
          capability_key,
          constraints,
          status,
          verified_at,
          created_by
        )
        values (
          'vehicle',
          target_vehicle_id,
          requested_capability_key,
          jsonb_build_object('source_application_id', target_application_id),
          'active',
          timezone('utc', now()),
          auth.uid()
        )
        on conflict (entity_type, entity_id, capability_key) do update
        set status = 'active',
            verified_at = timezone('utc', now()),
            constraints = public.entity_capabilities.constraints || excluded.constraints,
            updated_at = timezone('utc', now());
      end loop;
    end if;

    update public.application_records
    set activated_subject_type = 'vehicle',
        activated_subject_id = target_vehicle_id,
        updated_at = timezone('utc', now())
    where id = target_application_id;

    return jsonb_build_object(
      'activated_subject_type',
      'vehicle',
      'activated_subject_id',
      target_vehicle_id
    );
  end if;

  update public.application_records
  set activated_subject_type = application_type_record.application_category,
      activated_subject_id = target_application_id,
      updated_at = timezone('utc', now())
  where id = target_application_id;

  return jsonb_build_object(
    'activated_subject_type',
    application_type_record.application_category,
    'activated_subject_id',
    target_application_id
  );
end;
$$;

grant execute on function public.activate_approved_application(uuid) to service_role;

commit;
