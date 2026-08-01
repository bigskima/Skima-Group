# Provider Credential Activation Runbook

This runbook records where to get production provider credentials and how to store them without
putting secrets in app code. Only `SUPABASE_URL` and `SUPABASE_ANON_KEY` are client-side values.
Everything below belongs in Supabase secrets, deployment shell, CI secrets, or provider dashboards.

Project ref for the hosted Skima dev project:

```powershell
npgladvhpidkgpyzdwxf
```

## Supabase Runtime Secrets

Create strong random values yourself for Skima-controlled secrets:

- `SKIMA_WORKER_SECRET`
- `SKIMA_PAYMENT_WEBHOOK_SECRET`
- `SKIMA_OUTBOUND_WEBHOOK_SANDBOX_SECRET`
- `SKIMA_PAYMENT_SANDBOX_SECRET`
- `SKIMA_COMMUNICATION_SANDBOX_SECRET`

Set them with:

```powershell
supabase secrets set SKIMA_WORKER_SECRET="<random-secret>" --project-ref npgladvhpidkgpyzdwxf
supabase secrets set SKIMA_PAYMENT_WEBHOOK_SECRET="<random-secret>" --project-ref npgladvhpidkgpyzdwxf
supabase secrets set SKIMA_OUTBOUND_WEBHOOK_SANDBOX_SECRET="<random-secret>" --project-ref npgladvhpidkgpyzdwxf
supabase secrets set SKIMA_PAYMENT_SANDBOX_SECRET="<random-secret>" --project-ref npgladvhpidkgpyzdwxf
supabase secrets set SKIMA_COMMUNICATION_SANDBOX_SECRET="<random-secret>" --project-ref npgladvhpidkgpyzdwxf
```

## NGN Payment Providers

Choose one active provider at a time. Paystack is the first NGN production adapter and is activated
by `20260728220000_paystack_webhook_and_in_app_otp_runtime.sql`. Monnify and Flutterwave remain
inactive candidates until their adapter execution code and certification gates are added.

### Paystack

Dashboard location:

- Paystack Dashboard -> Settings -> API Keys & Webhooks

Collect:

- `PAYSTACK_PUBLIC_KEY`
- `PAYSTACK_SECRET_KEY`
- optional `SKIMA_PAYSTACK_CALLBACK_URL`

Webhook:

- URL: `https://npgladvhpidkgpyzdwxf.supabase.co/functions/v1/payment-webhook`
- Paystack signs webhooks with `x-paystack-signature` using HMAC SHA512 and the secret key.

Set:

```powershell
supabase secrets set PAYSTACK_PUBLIC_KEY="<paystack-public-key>" --project-ref npgladvhpidkgpyzdwxf
supabase secrets set PAYSTACK_SECRET_KEY="<paystack-secret-key>" --project-ref npgladvhpidkgpyzdwxf
supabase secrets set SKIMA_PAYSTACK_CALLBACK_URL="https://<your-domain>/payments/callback" --project-ref npgladvhpidkgpyzdwxf
```

`SKIMA_PAYSTACK_CALLBACK_URL` is optional if the Paystack Dashboard callback URL is already
configured. When supplied, it must be HTTPS.

Official docs:

- https://paystack.com/docs/payments/webhooks/
- https://paystack.com/docs/payments/payment-channels/

### Monnify

Dashboard location:

- Monnify Dashboard -> Settings -> API Keys & Webhooks
- Monnify Dashboard -> Settings -> Contracts

Collect:

- `MONNIFY_API_KEY`
- `MONNIFY_SECRET_KEY`
- `MONNIFY_CONTRACT_CODE`
- `MONNIFY_WEBHOOK_SECRET`

Webhook:

- URL: `https://npgladvhpidkgpyzdwxf.supabase.co/functions/v1/payment-webhook`

Set:

```powershell
supabase secrets set MONNIFY_API_KEY="<monnify-api-key>" --project-ref npgladvhpidkgpyzdwxf
supabase secrets set MONNIFY_SECRET_KEY="<monnify-secret-key>" --project-ref npgladvhpidkgpyzdwxf
supabase secrets set MONNIFY_CONTRACT_CODE="<monnify-contract-code>" --project-ref npgladvhpidkgpyzdwxf
supabase secrets set MONNIFY_WEBHOOK_SECRET="<monnify-webhook-secret>" --project-ref npgladvhpidkgpyzdwxf
```

Official docs:

- https://developers.monnify.com/docs/collections/quickstart
- https://developers.monnify.com/docs/live

### Flutterwave

Dashboard location:

- Flutterwave Dashboard -> Settings -> Developers -> API Keys
- Flutterwave Dashboard -> Settings -> Webhooks

Collect:

- `FLUTTERWAVE_PUBLIC_KEY`
- `FLUTTERWAVE_SECRET_KEY`
- `FLUTTERWAVE_ENCRYPTION_KEY`
- `FLUTTERWAVE_WEBHOOK_SECRET_HASH`

Webhook:

- URL: `https://npgladvhpidkgpyzdwxf.supabase.co/functions/v1/payment-webhook`
- Flutterwave signs webhooks with `flutterwave-signature` and a secret hash.

Set:

```powershell
supabase secrets set FLUTTERWAVE_PUBLIC_KEY="<flutterwave-public-key>" --project-ref npgladvhpidkgpyzdwxf
supabase secrets set FLUTTERWAVE_SECRET_KEY="<flutterwave-secret-key>" --project-ref npgladvhpidkgpyzdwxf
supabase secrets set FLUTTERWAVE_ENCRYPTION_KEY="<flutterwave-encryption-key>" --project-ref npgladvhpidkgpyzdwxf
supabase secrets set FLUTTERWAVE_WEBHOOK_SECRET_HASH="<flutterwave-webhook-secret-hash>" --project-ref npgladvhpidkgpyzdwxf
```

Official docs:

- https://developer.flutterwave.com/docs/webhooks
- https://developer.flutterwave.com/v3.0/docs/best-practices

## Communication Providers

Resend and Twilio are currently paused. Their adapter records remain in the database as `disabled`
so they can be reactivated later without rebuilding the platform. Do not set these secrets until
production communication delivery is back in scope.

### Resend Email

Dashboard location:

- Resend Dashboard -> API Keys

Collect:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

Set:

```powershell
supabase secrets set RESEND_API_KEY="<resend-api-key>" --project-ref npgladvhpidkgpyzdwxf
supabase secrets set RESEND_FROM_EMAIL="<verified-sender-email>" --project-ref npgladvhpidkgpyzdwxf
```

Official docs:

- https://resend.com/docs/dashboard/api-keys/introduction

### Twilio SMS And WhatsApp

Dashboard location:

- Twilio Console -> Account Info
- Twilio Console -> Messaging
- Twilio Console -> WhatsApp Senders or WhatsApp Sandbox during testing

Collect:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_SMS_FROM`
- `TWILIO_WHATSAPP_FROM`

Set:

```powershell
supabase secrets set TWILIO_ACCOUNT_SID="<twilio-account-sid>" --project-ref npgladvhpidkgpyzdwxf
supabase secrets set TWILIO_AUTH_TOKEN="<twilio-auth-token>" --project-ref npgladvhpidkgpyzdwxf
supabase secrets set TWILIO_SMS_FROM="<twilio-sms-number>" --project-ref npgladvhpidkgpyzdwxf
supabase secrets set TWILIO_WHATSAPP_FROM="<twilio-whatsapp-sender>" --project-ref npgladvhpidkgpyzdwxf
```

Official docs:

- https://www.twilio.com/docs/whatsapp/quickstart

## AI Provider

### Google Gemini

Dashboard location:

- Google AI Studio -> API Keys

Collect:

- `GEMINI_API_KEY`

Set:

```powershell
supabase secrets set GEMINI_API_KEY="<gemini-api-key>" --project-ref npgladvhpidkgpyzdwxf
```

Official docs:

- https://ai.google.dev/gemini-api/docs/api-key

## Maps Providers

### Google Maps Platform

Dashboard location:

- Google Cloud Console -> APIs & Services -> Credentials

Collect:

- `GOOGLE_MAPS_API_KEY`

Set:

```powershell
supabase secrets set GOOGLE_MAPS_API_KEY="<google-maps-api-key>" --project-ref npgladvhpidkgpyzdwxf
```

Official docs:

- https://developers.google.com/maps/documentation/javascript/get-api-key

Optional future providers:

```powershell
supabase secrets set MAPBOX_ACCESS_TOKEN="<mapbox-access-token>" --project-ref npgladvhpidkgpyzdwxf
supabase secrets set HERE_API_KEY="<here-api-key>" --project-ref npgladvhpidkgpyzdwxf
```

## Activation Rule

Do not activate a live provider just because secrets exist.

Before switching from sandbox to live:

- provider account is verified
- webhook URL is configured
- webhook signature verification is implemented for that provider
- deposit and transfer sandbox tests pass
- duplicate webhook test passes
- reconciliation test passes
- for communication providers, external delivery is explicitly unpaused in
  `platform.communication.provider_selection`
- reviewer approves the provider activation

Activation is done by configuration:

- set the selected provider adapter status to `active`
- update the relevant `platform.payments.provider_selection` or
  `platform.communication.provider_selection` configuration entry
- redeploy Edge Functions if adapter execution code changed
- rerun hosted gates
