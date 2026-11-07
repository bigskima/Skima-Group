# SKIMA push notifications — four-app setup

This implementation uses one Supabase notification queue and Expo Push for Refill, Store, Logistics and Bills.

## What is implemented

- Each app registers a signed-in user's Expo push token against an app key and installation ID.
- An existing user-targeted notification_messages row on either the in_app or push channel is routed to the matching app installation when the payload identifies one SKIMA app and includes a title and body. OTP, organisation and unscoped messages are not forwarded.
- App-specific Android channels and deep-link routes are carried in the push payload.
- The protected skima-push-dispatch Edge Function sends queued notifications, records Expo tickets, retries temporary failures, checks provider receipts and disables tokens reported as unregistered.
- Android app configuration reads the app's Google Services file path from its EAS environment. No Firebase service-account key or JSON credential is committed.

## Provider credentials still required

Each app has a separate Expo project. Configure the correct EAS project ID in that app's EAS environment:

| App | EAS project ID variable | Private Firebase file secret |
|---|---|---|
| Refill | Existing project ID in app config | SKIMA_REFILL_GOOGLE_SERVICES_JSON_BASE64 |
| Store | EXPO_PUBLIC_STORE_EAS_PROJECT_ID | SKIMA_STORE_GOOGLE_SERVICES_JSON_BASE64 |
| Logistics | EXPO_PUBLIC_LOGISTICS_EAS_PROJECT_ID | SKIMA_LOGISTICS_GOOGLE_SERVICES_JSON_BASE64 |
| Bills | EXPO_PUBLIC_BILLS_EAS_PROJECT_ID | SKIMA_BILLS_GOOGLE_SERVICES_JSON_BASE64 |

For Android, create a separate Firebase Android app for each package name. Download its matching google-services.json and store its base64-encoded contents in that app's private EAS environment secret shown above. The EAS pre-install hook materialises it as that app's local google-services.json and verifies the package name before Expo config is evaluated. Do not put one app's JSON into another app's build. The optional SKIMA_<APP>_GOOGLE_SERVICES_FILE variable can select a different private build path when needed.

For remote FCM delivery, enable Firebase Cloud Messaging HTTP v1 and upload the matching Firebase service-account JSON to that Expo project using EAS credentials. The service-account JSON is private and must never be committed to this repository. Each app needs its own Android package, Firebase app and matching credentials.

For iOS, each app needs its own Bundle Identifier, Apple Developer team and APNs authentication key uploaded to its Expo project. Remote iOS push cannot be completed with only a client-side config or the notification permission prompt.

## Supabase dispatcher schedule

The phase-2 migration installs a one-minute cron schedule only when both of these Vault secrets exist:

- skima_supabase_url: project URL, e.g. https://<project-ref>.supabase.co
- skima_service_role_key: the project's service-role JWT

Create them in Supabase Dashboard → Vault → Secrets. If they are added after the migration has already run, execute this SQL in the project's SQL editor to create or recreate the schedule. The cron command reads secrets from Vault each time and does not store their literal values:

```sql
select cron.unschedule(jobid)
from cron.job
where jobname = 'skima-push-outbox-dispatch';

select cron.schedule(
  'skima-push-outbox-dispatch',
  '* * * * *',
  $job$
    select net.http_post(
      url := (select rtrim(decrypted_secret, '/') || '/functions/v1/skima-push-dispatch'
              from vault.decrypted_secrets where name = 'skima_supabase_url'),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret
          from vault.decrypted_secrets where name = 'skima_service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{"batchSize":100}'::jsonb,
      timeout_milliseconds := 15000
    );
  $job$
);
```

Optional: set the Edge Function secret EXPO_ACCESS_TOKEN to enable authenticated Expo Push access. It is not the Firebase service-account key.

## Client behaviour

Permission is requested only when the customer enables notifications in that app. Once permission is granted, the app registers its device token after sign-in and refreshes the registration if Expo rotates the token. The in-app notification history remains available independently of push settings.

## Android build output

- production-apk: internal Android APK for tester distribution.
- production-aab: Android App Bundle for Google Play submission.

Build each app with its own EAS project and matching credentials. Do not launch a build until that app's project ID, package and provider credentials are configured.