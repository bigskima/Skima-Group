begin;

insert into public.provider_adapters (provider_kind, key, display_name, status, config, secret_ref)
values
  (
    'payment',
    'provider.payment.paystack',
    'Paystack NGN Payment Adapter',
    'inactive',
    '{
      "provider":"paystack",
      "currency":"NGN",
      "mode":"live_or_test_by_secret",
      "country":"NG",
      "supports":["initialize_payment","verify_transaction","process_webhook","resolve_bank_account","create_transfer_recipient","initiate_transfer","verify_transfer"],
      "webhook_signature":{"header":"x-paystack-signature","algorithm":"hmac_sha512","secret_ref":"SUPABASE_SECRET:PAYSTACK_SECRET_KEY"},
      "secret_refs":{"secret_key":"SUPABASE_SECRET:PAYSTACK_SECRET_KEY","public_key":"SUPABASE_SECRET:PAYSTACK_PUBLIC_KEY"}
    }'::jsonb,
    'SUPABASE_SECRET:PAYSTACK_SECRET_KEY'
  ),
  (
    'payment',
    'provider.payment.monnify',
    'Monnify NGN Payment Adapter',
    'inactive',
    '{
      "provider":"monnify",
      "currency":"NGN",
      "mode":"sandbox_or_live_by_secret",
      "country":"NG",
      "supports":["initialize_payment","verify_transaction","process_webhook","resolve_bank_account","create_transfer_recipient","initiate_transfer","verify_transfer","reserved_account"],
      "secret_refs":{"api_key":"SUPABASE_SECRET:MONNIFY_API_KEY","secret_key":"SUPABASE_SECRET:MONNIFY_SECRET_KEY","contract_code":"SUPABASE_SECRET:MONNIFY_CONTRACT_CODE","webhook_secret":"SUPABASE_SECRET:MONNIFY_WEBHOOK_SECRET"}
    }'::jsonb,
    'SUPABASE_SECRET:MONNIFY_SECRET_KEY'
  ),
  (
    'payment',
    'provider.payment.flutterwave',
    'Flutterwave NGN Payment Adapter',
    'inactive',
    '{
      "provider":"flutterwave",
      "currency":"NGN",
      "mode":"sandbox_or_live_by_secret",
      "country":"NG",
      "supports":["initialize_payment","verify_transaction","process_webhook","resolve_bank_account","create_transfer_recipient","initiate_transfer","verify_transfer"],
      "webhook_signature":{"header":"flutterwave-signature","algorithm":"hmac_sha256","secret_ref":"SUPABASE_SECRET:FLUTTERWAVE_WEBHOOK_SECRET_HASH"},
      "secret_refs":{"secret_key":"SUPABASE_SECRET:FLUTTERWAVE_SECRET_KEY","public_key":"SUPABASE_SECRET:FLUTTERWAVE_PUBLIC_KEY","encryption_key":"SUPABASE_SECRET:FLUTTERWAVE_ENCRYPTION_KEY","webhook_secret_hash":"SUPABASE_SECRET:FLUTTERWAVE_WEBHOOK_SECRET_HASH"}
    }'::jsonb,
    'SUPABASE_SECRET:FLUTTERWAVE_SECRET_KEY'
  ),
  (
    'notification',
    'provider.communication.resend',
    'Resend Email Communication Adapter',
    'inactive',
    '{
      "provider":"resend",
      "channels":["email"],
      "supports":["send_email","delivery_status","template_rendering"],
      "secret_refs":{"api_key":"SUPABASE_SECRET:RESEND_API_KEY","from_email":"SUPABASE_SECRET:RESEND_FROM_EMAIL"}
    }'::jsonb,
    'SUPABASE_SECRET:RESEND_API_KEY'
  ),
  (
    'notification',
    'provider.communication.twilio',
    'Twilio SMS And WhatsApp Communication Adapter',
    'inactive',
    '{
      "provider":"twilio",
      "channels":["sms","whatsapp"],
      "supports":["send_sms","send_whatsapp","delivery_status","template_rendering"],
      "secret_refs":{"account_sid":"SUPABASE_SECRET:TWILIO_ACCOUNT_SID","auth_token":"SUPABASE_SECRET:TWILIO_AUTH_TOKEN","sms_from":"SUPABASE_SECRET:TWILIO_SMS_FROM","whatsapp_from":"SUPABASE_SECRET:TWILIO_WHATSAPP_FROM"}
    }'::jsonb,
    'SUPABASE_SECRET:TWILIO_AUTH_TOKEN'
  )
on conflict (provider_kind, key) do update
set display_name = excluded.display_name,
    status = excluded.status,
    config = excluded.config,
    secret_ref = excluded.secret_ref,
    updated_at = timezone('utc', now());

update public.provider_adapters
set secret_ref = 'SUPABASE_SECRET:SKIMA_PAYMENT_SANDBOX_SECRET',
    updated_at = timezone('utc', now())
where provider_kind = 'payment'
  and key = 'provider.payment.sandbox'
  and secret_ref = 'SKIMA_PAYMENT_SANDBOX_SECRET';

update public.provider_adapters
set secret_ref = 'SUPABASE_SECRET:SKIMA_COMMUNICATION_SANDBOX_SECRET',
    updated_at = timezone('utc', now())
where provider_kind = 'notification'
  and key = 'provider.communication.sandbox'
  and secret_ref = 'SKIMA_COMMUNICATION_SANDBOX_SECRET';

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
    'platform.payments',
    'provider_selection',
    'global',
    null,
    '{
      "active_provider_key":"provider.payment.sandbox",
      "production_candidate_provider_keys":["provider.payment.paystack","provider.payment.monnify","provider.payment.flutterwave"],
      "selection_source":"configuration",
      "modules_call_provider_directly":false,
      "live_provider_requires_reviewer_approval":true
    }'::jsonb,
    false,
    'active',
    1
  ),
  (
    'platform.communication',
    'provider_selection',
    'global',
    null,
    '{
      "active_provider_key":"provider.communication.sandbox",
      "production_candidate_provider_keys":["provider.communication.resend","provider.communication.twilio"],
      "selection_source":"configuration",
      "modules_call_provider_directly":false,
      "live_provider_requires_reviewer_approval":true
    }'::jsonb,
    false,
    'active',
    1
  )
on conflict do nothing;

commit;
