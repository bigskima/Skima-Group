begin;

insert into public.permissions (key, description, risk_level)
values
  ('module.lpg.read', 'Read LPG module configuration and operational records.', 'standard'),
  ('module.lpg.manage', 'Manage LPG module configuration.', 'critical'),
  ('module.lpg.operate', 'Operate LPG module workflows through configured platform engines.', 'high')
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    updated_at = timezone('utc', now());

insert into public.capability_definitions (key, category, description, schema, status)
values
  (
    'capability.cargo.pressurized-cylinder',
    'cargo',
    'Can carry regulated pressurized cylinder cargo under module-defined restrictions.',
    '{"requires_training":true,"requires_documentation":true,"constraints_source":"module_configuration"}'::jsonb,
    'active'
  ),
  (
    'capability.cargo.returnable-container',
    'cargo',
    'Can handle returnable container custody with verification receipts.',
    '{"requires_custody_events":true,"container_identity_required":true}'::jsonb,
    'active'
  ),
  (
    'capability.driver.cylinder-handling',
    'driver',
    'Driver is eligible for module-configured cylinder handling workflows.',
    '{"requires_verification":true,"approval_source":"driver_engine"}'::jsonb,
    'active'
  ),
  (
    'capability.partner.refill-fulfillment',
    'partner',
    'Partner can perform module-configured refill or fulfillment confirmation steps.',
    '{"requires_partner_verification":true,"confirmation_source":"verification_engine"}'::jsonb,
    'active'
  )
on conflict (key) do update
set category = excluded.category,
    description = excluded.description,
    schema = excluded.schema,
    status = excluded.status,
    updated_at = timezone('utc', now());

insert into public.vehicle_types (key, display_name, capability_schema, status)
values
  (
    'vehicle.motorcycle',
    'Motorcycle',
    '{"mode":"road","cargo_capacity_source":"vehicle_profile","supports_small_loads":true}'::jsonb,
    'active'
  ),
  (
    'vehicle.tricycle',
    'Tricycle',
    '{"mode":"road","cargo_capacity_source":"vehicle_profile","supports_medium_loads":true}'::jsonb,
    'active'
  ),
  (
    'vehicle.car',
    'Car',
    '{"mode":"road","cargo_capacity_source":"vehicle_profile","supports_light_commerce":true}'::jsonb,
    'active'
  ),
  (
    'vehicle.pickup',
    'Pickup',
    '{"mode":"road","cargo_capacity_source":"vehicle_profile","supports_open_bed_cargo":true}'::jsonb,
    'active'
  ),
  (
    'vehicle.van',
    'Van',
    '{"mode":"road","cargo_capacity_source":"vehicle_profile","supports_enclosed_cargo":true}'::jsonb,
    'active'
  ),
  (
    'vehicle.mini-truck',
    'Mini Truck',
    '{"mode":"road","cargo_capacity_source":"vehicle_profile","supports_bulk_cargo":true}'::jsonb,
    'active'
  ),
  (
    'vehicle.truck',
    'Truck',
    '{"mode":"road","cargo_capacity_source":"vehicle_profile","supports_heavy_cargo":true}'::jsonb,
    'active'
  )
on conflict (key) do update
set display_name = excluded.display_name,
    capability_schema = excluded.capability_schema,
    status = excluded.status,
    updated_at = timezone('utc', now());

insert into public.event_types (key, description, schema, status)
values
  ('event.request.created', 'A configured service request has been created.', '{}'::jsonb, 'active'),
  ('event.request.validated', 'A configured service request has passed validation.', '{}'::jsonb, 'active'),
  ('event.partner.matched', 'A configured partner match was produced.', '{}'::jsonb, 'active'),
  ('event.partner.accepted', 'A configured partner accepted the request.', '{}'::jsonb, 'active'),
  ('event.driver.matched', 'A configured driver match was produced.', '{}'::jsonb, 'active'),
  ('event.driver.assigned', 'A configured driver assignment was accepted.', '{}'::jsonb, 'active'),
  ('event.payment.received', 'A configured payment was received by the platform gateway.', '{}'::jsonb, 'active'),
  ('event.escrow.held', 'A configured escrow hold was created.', '{}'::jsonb, 'active'),
  ('event.pickup.confirmed', 'A configured pickup verification completed.', '{}'::jsonb, 'active'),
  (
    'event.partner.fulfillment.confirmed',
    'A configured partner fulfillment verification completed.',
    '{}'::jsonb,
    'active'
  ),
  ('event.delivery.completed', 'A configured delivery completion was verified.', '{}'::jsonb, 'active'),
  ('event.settlement.released', 'A configured settlement release completed.', '{}'::jsonb, 'active'),
  ('event.customer.rated', 'A configured customer rating was recorded.', '{}'::jsonb, 'active'),
  ('event.request.cancelled', 'A configured request was cancelled.', '{}'::jsonb, 'active')
on conflict (key) do update
set description = excluded.description,
    schema = excluded.schema,
    status = excluded.status,
    updated_at = timezone('utc', now());

do $$
declare
  target_module_id uuid;
  target_module_version_id uuid;
  target_workflow_id uuid;
  target_workflow_version_id uuid;
  component_record record;
begin
  insert into public.business_modules (
    key,
    display_name,
    description,
    status,
    metadata
  )
  values (
    'lpg',
    'LPG',
    'First business module configured through the reusable platform engines.',
    'active',
    '{"category":"commerce.fulfillment","configured_by":"business_module_framework","core_platform_dependency":"configuration_only"}'::jsonb
  )
  on conflict (key) do update
  set display_name = excluded.display_name,
      description = excluded.description,
      status = excluded.status,
      metadata = excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into target_module_id;

  insert into public.business_module_events (
    module_id,
    event_type,
    idempotency_key,
    metadata
  )
  values (
    target_module_id,
    'configured',
    'migration:20260728010000:lpg:module',
    '{"module_key":"lpg"}'::jsonb
  )
  on conflict do nothing;

  if not exists (
    select 1
    from public.pricing_policies policy
    where policy.key = 'pricing.lpg.fixed.v1'
      and policy.scope_type = 'module'
      and policy.scope_id = target_module_id
      and policy.version = 1
  ) then
    insert into public.pricing_policies (
      key,
      display_name,
      pricing_mode,
      scope_type,
      scope_id,
      currency_code,
      rules,
      status,
      version
    )
    values (
      'pricing.lpg.fixed.v1',
      'LPG Fixed Pricing Policy',
      'fixed',
      'module',
      target_module_id,
      'NGN',
      '{"amount_source":"module_or_partner_price_book","currency_code":"NGN","requires_active_price_book":true,"manual_override_allowed":true}'::jsonb,
      'active',
      1
    );
  else
    update public.pricing_policies
    set display_name = 'LPG Fixed Pricing Policy',
        pricing_mode = 'fixed',
        currency_code = 'NGN',
        rules = '{"amount_source":"module_or_partner_price_book","currency_code":"NGN","requires_active_price_book":true,"manual_override_allowed":true}'::jsonb,
        status = 'active',
        updated_at = timezone('utc', now())
    where key = 'pricing.lpg.fixed.v1'
      and scope_type = 'module'
      and scope_id = target_module_id
      and version = 1;
  end if;

  if not exists (
    select 1
    from public.settlement_policies policy
    where policy.key = 'settlement.lpg.escrow.station-driver.v1'
      and policy.scope_type = 'module'
      and policy.scope_id = target_module_id
      and policy.version = 1
  ) then
    insert into public.settlement_policies (
      key,
      display_name,
      scope_type,
      scope_id,
      flow_schema,
      beneficiary_schema,
      release_policy,
      status,
      version
    )
    values (
      'settlement.lpg.escrow.station-driver.v1',
      'LPG Escrow Settlement Policy',
      'module',
      target_module_id,
      '{"intake":"customer_to_platform_gateway","holding_wallet":"escrow","direct_partner_payment":false,"direct_driver_payment":false}'::jsonb,
      '{"beneficiaries":[{"role":"partner","release_event":"event.partner.fulfillment.confirmed","amount_source":"fulfillment_price_component"},{"role":"driver","release_event":"event.delivery.completed","amount_source":"driver_commission_policy"},{"role":"platform","release_event":"event.settlement.released","amount_source":"platform_fee_policy"}]}'::jsonb,
      '{"release_controller":"workflow_engine","refund_controller":"escrow_engine","dispute_controller":"policy_engine","timeout_source":"module_configuration"}'::jsonb,
      'active',
      1
    );
  else
    update public.settlement_policies
    set display_name = 'LPG Escrow Settlement Policy',
        flow_schema = '{"intake":"customer_to_platform_gateway","holding_wallet":"escrow","direct_partner_payment":false,"direct_driver_payment":false}'::jsonb,
        beneficiary_schema = '{"beneficiaries":[{"role":"partner","release_event":"event.partner.fulfillment.confirmed","amount_source":"fulfillment_price_component"},{"role":"driver","release_event":"event.delivery.completed","amount_source":"driver_commission_policy"},{"role":"platform","release_event":"event.settlement.released","amount_source":"platform_fee_policy"}]}'::jsonb,
        release_policy = '{"release_controller":"workflow_engine","refund_controller":"escrow_engine","dispute_controller":"policy_engine","timeout_source":"module_configuration"}'::jsonb,
        status = 'active',
        updated_at = timezone('utc', now())
    where key = 'settlement.lpg.escrow.station-driver.v1'
      and scope_type = 'module'
      and scope_id = target_module_id
      and version = 1;
  end if;

  insert into public.dispatch_policies (key, display_name, matching_strategy, rules, status)
  values (
    'dispatch.lpg.nearest-qualified-driver.v1',
    'LPG Nearest Qualified Driver',
    'capability_distance',
    '{"candidate_type":"driver","distance_priority":true,"availability_required":true,"manual_override_allowed":true,"required_capabilities":["capability.driver.cylinder-handling","capability.cargo.pressurized-cylinder"],"capacity_source":"vehicle.capacity_profile","zone_source":"driver_profile"}'::jsonb,
    'active'
  )
  on conflict (key) do update
  set display_name = excluded.display_name,
      matching_strategy = excluded.matching_strategy,
      rules = excluded.rules,
      status = excluded.status,
      updated_at = timezone('utc', now());

  insert into public.verification_definitions (
    key,
    display_name,
    verification_mode,
    schema,
    event_type_key,
    status
  )
  values
    (
      'verification.lpg.pickup.asset_scan',
      'LPG Pickup Asset Scan',
      'scan',
      '{"answers":["who","what","why","where","when","workflow_event"],"scanned_entity_type":"asset","requires_location":true}'::jsonb,
      'event.pickup.confirmed',
      'active'
    ),
    (
      'verification.lpg.partner.fulfillment_scan',
      'LPG Partner Fulfillment Scan',
      'scan',
      '{"answers":["who","what","why","where","when","workflow_event"],"scanned_entity_type":"asset","requires_partner_context":true,"requires_location":true}'::jsonb,
      'event.partner.fulfillment.confirmed',
      'active'
    ),
    (
      'verification.lpg.delivery.asset_scan',
      'LPG Delivery Asset Scan',
      'scan',
      '{"answers":["who","what","why","where","when","workflow_event"],"scanned_entity_type":"asset","requires_customer_confirmation":true,"requires_location":true}'::jsonb,
      'event.delivery.completed',
      'active'
    ),
    (
      'verification.lpg.driver.training_certificate',
      'LPG Driver Training Certificate',
      'document',
      '{"document_owner":"driver","approval_source":"driver_engine","expires":true}'::jsonb,
      null,
      'active'
    ),
    (
      'verification.lpg.partner.operational_permit',
      'LPG Partner Operational Permit',
      'document',
      '{"document_owner":"partner","approval_source":"partner_engine","expires":true}'::jsonb,
      null,
      'active'
    )
  on conflict (key) do update
  set display_name = excluded.display_name,
      verification_mode = excluded.verification_mode,
      schema = excluded.schema,
      event_type_key = excluded.event_type_key,
      status = excluded.status,
      updated_at = timezone('utc', now());

  insert into public.notification_templates (
    key,
    channel,
    locale,
    subject_template,
    body_template,
    variables_schema,
    status
  )
  values
    (
      'notification.lpg.request.created',
      'in_app',
      'en',
      'Request received',
      'Your request has been received and is moving through the configured workflow.',
      '{"required":["request_reference"]}'::jsonb,
      'active'
    ),
    (
      'notification.lpg.driver.assigned',
      'in_app',
      'en',
      'Driver assigned',
      'A qualified driver has been assigned through the dispatch engine.',
      '{"required":["request_reference","driver_reference"]}'::jsonb,
      'active'
    ),
    (
      'notification.lpg.delivery.completed',
      'in_app',
      'en',
      'Delivery completed',
      'Delivery has been completed and settlement is ready for release.',
      '{"required":["request_reference"]}'::jsonb,
      'active'
    )
  on conflict (key) do update
  set channel = excluded.channel,
      locale = excluded.locale,
      subject_template = excluded.subject_template,
      body_template = excluded.body_template,
      variables_schema = excluded.variables_schema,
      status = excluded.status,
      updated_at = timezone('utc', now());

  insert into public.ai_task_definitions (
    key,
    display_name,
    task_type,
    prompt_config,
    output_schema,
    status
  )
  values (
    'ai.lpg.dispatch.recommendation',
    'LPG Dispatch Recommendation',
    'dispatch',
    '{"decision_boundary":"assist_only","human_or_policy_confirmation_required":true,"inputs":["location","availability","capabilities","capacity","zone","priority"]}'::jsonb,
    '{"type":"object","required":["recommended_candidates","rationale"],"properties":{"recommended_candidates":{"type":"array"},"rationale":{"type":"string"}}}'::jsonb,
    'active'
  )
  on conflict (key) do update
  set display_name = excluded.display_name,
      task_type = excluded.task_type,
      prompt_config = excluded.prompt_config,
      output_schema = excluded.output_schema,
      status = excluded.status,
      updated_at = timezone('utc', now());

  insert into public.workflow_definitions (
    key,
    display_name,
    description,
    status,
    metadata
  )
  values (
    'workflow.lpg.fulfillment',
    'LPG Fulfillment Workflow',
    'Configured LPG fulfillment workflow executed by the reusable workflow engine.',
    'active',
    '{"module_key":"lpg","engine":"workflow"}'::jsonb
  )
  on conflict (key) do update
  set display_name = excluded.display_name,
      description = excluded.description,
      status = excluded.status,
      metadata = excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into target_workflow_id;

  insert into public.workflow_versions (
    workflow_id,
    version,
    status,
    definition,
    activated_at
  )
  values (
    target_workflow_id,
    1,
    'active',
    '{"module_key":"lpg","pricing_policy":"pricing.lpg.fixed.v1","settlement_policy":"settlement.lpg.escrow.station-driver.v1","dispatch_policy":"dispatch.lpg.nearest-qualified-driver.v1"}'::jsonb,
    timezone('utc', now())
  )
  on conflict (workflow_id, version) do update
  set status = excluded.status,
      definition = excluded.definition,
      activated_at = coalesce(public.workflow_versions.activated_at, excluded.activated_at),
      updated_at = timezone('utc', now())
  returning id into target_workflow_version_id;

  insert into public.workflow_states (workflow_version_id, key, display_name, state_type, metadata)
  values
    (target_workflow_version_id, 'requested', 'Requested', 'initial', '{}'::jsonb),
    (target_workflow_version_id, 'validated', 'Validated', 'normal', '{}'::jsonb),
    (target_workflow_version_id, 'partner_matched', 'Partner Matched', 'normal', '{}'::jsonb),
    (target_workflow_version_id, 'partner_accepted', 'Partner Accepted', 'normal', '{}'::jsonb),
    (target_workflow_version_id, 'driver_matched', 'Driver Matched', 'normal', '{}'::jsonb),
    (target_workflow_version_id, 'driver_assigned', 'Driver Assigned', 'normal', '{}'::jsonb),
    (target_workflow_version_id, 'escrow_held', 'Escrow Held', 'normal', '{}'::jsonb),
    (target_workflow_version_id, 'pickup_confirmed', 'Pickup Confirmed', 'normal', '{}'::jsonb),
    (target_workflow_version_id, 'partner_fulfilled', 'Partner Fulfilled', 'normal', '{}'::jsonb),
    (target_workflow_version_id, 'delivered', 'Delivered', 'normal', '{}'::jsonb),
    (target_workflow_version_id, 'settled', 'Settled', 'terminal', '{}'::jsonb),
    (target_workflow_version_id, 'cancelled', 'Cancelled', 'failure', '{}'::jsonb)
  on conflict (workflow_version_id, key) do update
  set display_name = excluded.display_name,
      state_type = excluded.state_type,
      metadata = excluded.metadata,
      updated_at = timezone('utc', now());

  insert into public.workflow_transitions (
    workflow_version_id,
    from_state_key,
    to_state_key,
    event_type_key,
    guard_policy_key,
    action_policy_keys,
    metadata
  )
  values
    (
      target_workflow_version_id,
      'requested',
      'validated',
      'event.request.validated',
      null,
      array[]::text[],
      '{}'::jsonb
    ),
    (
      target_workflow_version_id,
      'requested',
      'cancelled',
      'event.request.cancelled',
      null,
      array[]::text[],
      '{}'::jsonb
    ),
    (
      target_workflow_version_id,
      'validated',
      'partner_matched',
      'event.partner.matched',
      null,
      array['dispatch.lpg.nearest-qualified-driver.v1'],
      '{}'::jsonb
    ),
    (
      target_workflow_version_id,
      'partner_matched',
      'partner_accepted',
      'event.partner.accepted',
      null,
      array[]::text[],
      '{}'::jsonb
    ),
    (
      target_workflow_version_id,
      'partner_accepted',
      'driver_matched',
      'event.driver.matched',
      null,
      array['dispatch.lpg.nearest-qualified-driver.v1'],
      '{}'::jsonb
    ),
    (
      target_workflow_version_id,
      'driver_matched',
      'driver_assigned',
      'event.driver.assigned',
      null,
      array[]::text[],
      '{}'::jsonb
    ),
    (
      target_workflow_version_id,
      'driver_assigned',
      'escrow_held',
      'event.escrow.held',
      null,
      array['settlement.lpg.escrow.station-driver.v1'],
      '{}'::jsonb
    ),
    (
      target_workflow_version_id,
      'escrow_held',
      'pickup_confirmed',
      'event.pickup.confirmed',
      null,
      array['verification.lpg.pickup.asset_scan'],
      '{}'::jsonb
    ),
    (
      target_workflow_version_id,
      'pickup_confirmed',
      'partner_fulfilled',
      'event.partner.fulfillment.confirmed',
      null,
      array['verification.lpg.partner.fulfillment_scan'],
      '{}'::jsonb
    ),
    (
      target_workflow_version_id,
      'partner_fulfilled',
      'delivered',
      'event.delivery.completed',
      null,
      array['verification.lpg.delivery.asset_scan'],
      '{}'::jsonb
    ),
    (
      target_workflow_version_id,
      'delivered',
      'settled',
      'event.settlement.released',
      null,
      array['settlement.lpg.escrow.station-driver.v1'],
      '{}'::jsonb
    )
  on conflict (workflow_version_id, from_state_key, event_type_key) do update
  set to_state_key = excluded.to_state_key,
      guard_policy_key = excluded.guard_policy_key,
      action_policy_keys = excluded.action_policy_keys,
      metadata = excluded.metadata,
      updated_at = timezone('utc', now());

  insert into public.business_module_versions (
    module_id,
    version,
    status,
    manifest,
    activated_at
  )
  values (
    target_module_id,
    1,
    'active',
    '{"module_key":"lpg","business_category":"commerce.fulfillment","engines":["workflow","pricing","settlement","wallet","financial","escrow","dispatch","tracking","verification","notification","ai"],"activation":"configuration_only"}'::jsonb,
    timezone('utc', now())
  )
  on conflict (module_id, version) do update
  set status = excluded.status,
      manifest = excluded.manifest,
      activated_at = coalesce(public.business_module_versions.activated_at, excluded.activated_at),
      retired_at = null,
      updated_at = timezone('utc', now())
  returning id into target_module_version_id;

  for component_record in
    select *
    from (
      values
        (
          'capability',
          'lpg.capability.pressurized-cylinder',
          'capability.cargo.pressurized-cylinder',
          true,
          '{"purpose":"cargo_requirement"}'::jsonb
        ),
        (
          'capability',
          'lpg.capability.returnable-container',
          'capability.cargo.returnable-container',
          true,
          '{"purpose":"asset_custody"}'::jsonb
        ),
        (
          'capability',
          'lpg.capability.driver-cylinder-handling',
          'capability.driver.cylinder-handling',
          true,
          '{"purpose":"driver_requirement"}'::jsonb
        ),
        (
          'capability',
          'lpg.capability.partner-refill-fulfillment',
          'capability.partner.refill-fulfillment',
          true,
          '{"purpose":"partner_requirement"}'::jsonb
        ),
        (
          'workflow',
          'lpg.workflow.fulfillment',
          'workflow.lpg.fulfillment',
          true,
          '{"entry_event":"event.request.created","terminal_event":"event.settlement.released"}'::jsonb
        ),
        (
          'pricing_policy',
          'lpg.pricing.fixed',
          'pricing.lpg.fixed.v1',
          true,
          '{"mode":"fixed","amounts_source":"module_or_partner_price_book"}'::jsonb
        ),
        (
          'settlement_policy',
          'lpg.settlement.escrow-station-driver',
          'settlement.lpg.escrow.station-driver.v1',
          true,
          '{"release_source":"workflow_events"}'::jsonb
        ),
        (
          'event',
          'lpg.event.request-created',
          'event.request.created',
          true,
          '{}'::jsonb
        ),
        (
          'event',
          'lpg.event.partner-fulfillment-confirmed',
          'event.partner.fulfillment.confirmed',
          true,
          '{}'::jsonb
        ),
        (
          'event',
          'lpg.event.delivery-completed',
          'event.delivery.completed',
          true,
          '{}'::jsonb
        ),
        (
          'permission',
          'lpg.permission.read',
          'module.lpg.read',
          true,
          '{}'::jsonb
        ),
        (
          'permission',
          'lpg.permission.manage',
          'module.lpg.manage',
          true,
          '{}'::jsonb
        ),
        (
          'permission',
          'lpg.permission.operate',
          'module.lpg.operate',
          true,
          '{}'::jsonb
        ),
        (
          'vehicle_requirement',
          'lpg.vehicle.motorcycle',
          'vehicle.motorcycle',
          false,
          '{"capacity_profile_required":true}'::jsonb
        ),
        (
          'vehicle_requirement',
          'lpg.vehicle.tricycle',
          'vehicle.tricycle',
          false,
          '{"capacity_profile_required":true}'::jsonb
        ),
        (
          'vehicle_requirement',
          'lpg.vehicle.pickup',
          'vehicle.pickup',
          false,
          '{"capacity_profile_required":true}'::jsonb
        ),
        (
          'driver_requirement',
          'lpg.driver.training-certificate',
          'verification.lpg.driver.training_certificate',
          true,
          '{"verification_owner":"driver"}'::jsonb
        ),
        (
          'document_requirement',
          'lpg.partner.operational-permit',
          'verification.lpg.partner.operational_permit',
          true,
          '{"verification_owner":"partner"}'::jsonb
        ),
        (
          'ai_behavior',
          'lpg.ai.dispatch-recommendation',
          'ai.lpg.dispatch.recommendation',
          false,
          '{"control":"assist_only"}'::jsonb
        ),
        (
          'report',
          'lpg.report.operations',
          null,
          false,
          '{"metrics":["requests","fulfillments","delivery_completion","settlement_release"],"source":"configured_events"}'::jsonb
        ),
        (
          'screen',
          'lpg.screen.customer-request',
          null,
          false,
          '{"blueprint_key":"screen.customer.request","target":"native","permission_keys":["module.lpg.read"]}'::jsonb
        ),
        (
          'screen',
          'lpg.screen.partner-fulfillment',
          null,
          false,
          '{"blueprint_key":"screen.partner.fulfillment","target":"web","permission_keys":["module.lpg.operate"]}'::jsonb
        ),
        (
          'screen',
          'lpg.screen.driver-assignment',
          null,
          false,
          '{"blueprint_key":"screen.driver.assignment","target":"native","permission_keys":["module.lpg.operate"]}'::jsonb
        )
    ) as component(component_type, component_key, reference_key, is_required, config)
  loop
    insert into public.business_module_components (
      module_version_id,
      component_type,
      component_key,
      reference_key,
      is_required,
      config,
      status
    )
    values (
      target_module_version_id,
      component_record.component_type,
      component_record.component_key,
      component_record.reference_key,
      component_record.is_required,
      component_record.config,
      'active'
    )
    on conflict (module_version_id, component_type, component_key) do update
    set reference_key = excluded.reference_key,
        is_required = excluded.is_required,
        config = excluded.config,
        status = excluded.status,
        updated_at = timezone('utc', now());
  end loop;

  insert into public.configuration_entries (
    namespace,
    key,
    scope_type,
    scope_id,
    value,
    status,
    version
  )
  select
    'module.lpg',
    'runtime_policy',
    'module',
    target_module_id,
    '{"pricing_policy":"pricing.lpg.fixed.v1","settlement_policy":"settlement.lpg.escrow.station-driver.v1","dispatch_policy":"dispatch.lpg.nearest-qualified-driver.v1","workflow":"workflow.lpg.fulfillment","currency":"NGN"}'::jsonb,
    'active',
    1
  where not exists (
    select 1
    from public.configuration_entries config
    where config.namespace = 'module.lpg'
      and config.key = 'runtime_policy'
      and config.scope_type = 'module'
      and config.scope_id = target_module_id
      and config.version = 1
  );

  update public.configuration_entries
  set value = '{"pricing_policy":"pricing.lpg.fixed.v1","settlement_policy":"settlement.lpg.escrow.station-driver.v1","dispatch_policy":"dispatch.lpg.nearest-qualified-driver.v1","workflow":"workflow.lpg.fulfillment","currency":"NGN"}'::jsonb,
      status = 'active',
      updated_at = timezone('utc', now())
  where namespace = 'module.lpg'
    and key = 'runtime_policy'
    and scope_type = 'module'
    and scope_id = target_module_id
    and version = 1;

  insert into public.business_module_events (
    module_id,
    module_version_id,
    event_type,
    idempotency_key,
    metadata
  )
  values (
    target_module_id,
    target_module_version_id,
    'version_activated',
    'migration:20260728010000:lpg:v1',
    '{"module_key":"lpg","version":1}'::jsonb
  )
  on conflict do nothing;
end $$;

commit;
