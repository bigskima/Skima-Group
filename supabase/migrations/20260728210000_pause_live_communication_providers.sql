begin;

update public.provider_adapters
set status = 'disabled',
    config = config || '{
      "paused":true,
      "paused_reason":"No production email, SMS, or WhatsApp provider is enabled yet.",
      "reactivation_requires":"provider credentials, sandbox/live certification, and reviewer approval"
    }'::jsonb,
    updated_at = timezone('utc', now())
where provider_kind = 'notification'
  and key in ('provider.communication.resend', 'provider.communication.twilio');

insert into public.configuration_entries (
  namespace,
  key,
  scope_type,
  scope_id,
  value,
  is_secret,
  status,
  version
)
values
  (
    'platform.communication',
    'provider_selection',
    'global',
    null,
    '{
      "active_provider_key":"provider.communication.sandbox",
      "external_delivery_enabled":false,
      "otp_delivery_mode":"backend_generated_in_app_sandbox",
      "disabled_provider_keys":["provider.communication.resend","provider.communication.twilio"],
      "production_candidate_provider_keys":["provider.communication.resend","provider.communication.twilio"],
      "selection_source":"configuration",
      "modules_call_provider_directly":false,
      "live_provider_requires_reviewer_approval":true
    }'::jsonb,
    false,
    'active',
    2
  ),
  (
    'platform.verification',
    'qr_scan_policy',
    'global',
    null,
    '{
      "scanner_surface":"frontend_camera_or_device_scanner",
      "backend_authority":"verification_engine",
      "api_route":"/runtime/verifications",
      "payload_contract":["definitionKey","scannedEntityType","scannedEntityId","scanPayload","result","metadata","idempotencyKey"],
      "business_specific_meaning_source":"verification_definitions",
      "workflow_progression_source":"configured_event_type",
      "modules_call_scanner_provider_directly":false
    }'::jsonb,
    false,
    'active',
    1
  )
on conflict do nothing;

update public.configuration_entries
set value = '{
      "active_provider_key":"provider.communication.sandbox",
      "external_delivery_enabled":false,
      "otp_delivery_mode":"backend_generated_in_app_sandbox",
      "disabled_provider_keys":["provider.communication.resend","provider.communication.twilio"],
      "production_candidate_provider_keys":["provider.communication.resend","provider.communication.twilio"],
      "selection_source":"configuration",
      "modules_call_provider_directly":false,
      "live_provider_requires_reviewer_approval":true
    }'::jsonb,
    status = 'active',
    updated_at = timezone('utc', now())
where namespace = 'platform.communication'
  and key = 'provider_selection'
  and scope_type = 'global'
  and coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid) =
    '00000000-0000-0000-0000-000000000000'::uuid
  and version = 2;

update public.configuration_entries
set status = 'retired',
    updated_at = timezone('utc', now())
where namespace = 'platform.communication'
  and key = 'provider_selection'
  and scope_type = 'global'
  and coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid) =
    '00000000-0000-0000-0000-000000000000'::uuid
  and version <> 2;

commit;
