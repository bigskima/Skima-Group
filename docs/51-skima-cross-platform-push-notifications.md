# SKIMA Cross-Platform Push Notification Architecture

**Status:** Provider-ready architecture; production credentials pending  
**Date:** 2026-11-04  
**Primary mobile framework:** Expo / React Native  
**Backend:** Existing shared SKIMA Supabase project  
**Initial delivery adapter:** Expo Push Service, backed by FCM (Android) and APNs (iOS)

## 1. Purpose and constraints

SKIMA needs one notification capability that serves Refill, Store, Logistics and Bills on Android and iOS while preserving product-level separation.

The system must be designed and partially implemented before Firebase or Apple credentials are available. Missing credentials must block real remote delivery and production push readiness—not block API contracts, the in-app inbox, event creation, token lifecycle code, mocked tests or the rest of the applications.

This architecture does not require a new Supabase project, a separate user account per app or four notification backends.

The system must:

- Support Android and iOS through one app-facing notification contract.
- Keep product events, preferences and notification destinations correctly scoped.
- Reuse existing authentication, notification inbox, event and workflow infrastructure where suitable.
- Keep private provider credentials in managed server/EAS credential stores.
- Remain replaceable between Expo Push Service and direct FCM/APNs adapters.
- Provide explicit readiness states when credentials or app registrations are absent.
- Avoid fake remote tokens, false-success states and silent notification drops.

## 2. Repository audit: current state

Observed in the repository on 2026-11-04:

| Area | Observed state | Consequence |
|---|---|---|
| Refill native app | ``expo-notifications`` is installed and its config plugin is present in ``apps/lpg-mobile/app.config.ts`` | Refill has a native notification foundation |
| Refill local handling | ``src/native/notifications/presenter.native.ts`` schedules a local notification; ``useNotificationLifecycle.native.ts`` handles foreground presentation, requests permission and routes from local ``data.path`` | Useful local handling, but not proof of a complete remote push system |
| Remote registration | A targeted code search did not find an ``ExpoPushToken`` or ``push_token`` registration path | Remote device-token registration needs a full audit and implementation |
| Logistics native app | Its current ``package.json`` and ``app.config.ts`` do not list ``expo-notifications`` or its config plugin | Logistics must be brought onto the shared notification client foundation |
| Native identities | Refill uses Android/iOS ID ``com.skima.lpg``; Logistics uses ``com.skima.logistics`` | Preserve existing store identities |
| Provider secrets | Firebase FCM V1 and Apple APNs credentials have not been supplied/configured | Real production push is not yet credential-ready |

A focused code search is not a substitute for a full implementation audit. Before changing notification tables or routes, inspect the complete inbox, event and communication runtime and reuse suitable pieces. The in-app inbox remains useful when push credentials are absent.

## 3. Recommended delivery design

Use Expo Notifications in the mobile apps and Expo Push Service as the initial server delivery adapter. Expo abstracts the platform transport: Android delivery is backed by Firebase Cloud Messaging (FCM), and iOS delivery by Apple Push Notification service (APNs).

Keep server delivery behind a provider adapter. The platform may later use direct FCM/APNs if advanced capabilities or operational requirements justify it. Product modules must not call FCM or APNs directly.

Logical flow:

```text
Product event / workflow
        |
        v
Existing SKIMA event + notification runtime
        |
        v
Notification policy and product-scope validation
        |
        +----> Existing in-app notification inbox
        |
        v
Durable push outbox / dispatch queue
        |
        v
Push delivery adapter
        |
        +----> Expo Push Service ----> FCM ----> Android device
        |
        +----> Expo Push Service ----> APNs ----> iOS device
        |
        v
Ticket / receipt processing, retries and invalid-token cleanup
```

Expo Push Service is the recommended initial adapter because Refill already uses Expo Notifications and the product family uses Expo/React Native. Business modules must not depend on Expo-specific token details. If direct FCM/APNs is selected later, the device-registration contract and business events should remain stable.

Official references:

- Expo push overview: https://docs.expo.dev/push-notifications/overview/
- Expo setup and testing: https://docs.expo.dev/push-notifications/push-notifications-setup/
- Expo server sending: https://docs.expo.dev/push-notifications/sending-notifications/
- Expo notification handling: https://docs.expo.dev/push-notifications/receiving-notifications/
- Alternative push services: https://docs.expo.dev/guides/using-push-notifications-services/

## 4. Application identity and Expo project identity

Each standalone native application has its own application identity and Expo/EAS project configuration.

Current native identities that must remain stable:

| App | Android package | iOS bundle identifier | Existing custom scheme |
|---|---|---|---|
| Refill | ``com.skima.lpg`` | ``com.skima.lpg`` | ``skima-lpg`` |
| Logistics | ``com.skima.logistics`` | ``com.skima.logistics`` | ``skima-logistics`` |

Store and Bills must receive distinct Android package names and iOS bundle identifiers before their first store registration and production build. Do not reuse a package/bundle ID across apps.

Use a distinct EAS project ID for each standalone product app. The Expo project ID is used to associate an Expo push token with the correct project. Resolve it from app configuration (for example ``Constants.expoConfig?.extra?.eas?.projectId`` with the EAS config fallback), not from one shared hardcoded literal.

Refill uses its existing ``EXPO_PUBLIC_EAS_PROJECT_ID`` configuration. Store, Logistics and Bills each require their own ``EXPO_PUBLIC_STORE_EAS_PROJECT_ID``, ``EXPO_PUBLIC_LOGISTICS_EAS_PROJECT_ID`` and ``EXPO_PUBLIC_BILLS_EAS_PROJECT_ID`` values in the matching EAS production environment. Do not use a shared project ID as a fallback between products; that would associate device tokens with the wrong app identity.

An EAS project ID is not a Firebase or Apple secret. It is a public project identifier; credentials remain protected in EAS.

## 5. Device registration contract

A remote push token belongs to an app installation and application identity, not merely to a person.

After a signed-in user receives a contextual explanation and grants permission:

1. Read current OS notification permission.
2. Request permission at a meaningful point in the journey; do not interrupt first launch with an unexplained prompt.
3. Resolve the current app identity and EAS project ID from app configuration.
4. Obtain the Expo push token for that project using ``getExpoPushTokenAsync({ projectId })``.
5. Register or refresh the token through an authenticated SKIMA API/Edge Function.
6. Save permission and token state with product, platform, environment and installation scope.
7. Listen for token changes where supported and update the registration safely.
8. Attach notification-response handling and route validation.
9. On sign-out or account switch, detach the installation from the previous user without deleting the device's local permission setting.

The registration endpoint must be authenticated, rate-limited, schema-validated and idempotent. A client must not register a token on behalf of another user, claim another product's app identity or override an installation's platform/environment.

Logical record fields:

| Field | Purpose |
|---|---|
| ``id`` | Stable registration record ID |
| ``user_id`` | Current authenticated SKIMA user |
| ``app_key`` | ``refill``, ``store``, ``logistics`` or ``bills`` |
| ``platform`` | ``android`` or ``ios`` |
| ``provider`` | Initially ``expo``; future adapter key |
| ``expo_project_id`` | EAS project identity used to obtain the token |
| ``push_token`` | Expo push token stored server-side |
| ``environment`` | ``development``, ``preview`` or ``production`` |
| ``permission_status`` | ``granted``, ``denied``, ``undetermined`` or ``unavailable`` |
| ``installation_key`` | App-generated opaque installation identifier |
| ``active`` | Whether the registration may receive pushes |
| ``last_seen_at`` | Last successful registration/refresh |
| ``invalidated_at`` | When the provider confirmed the token is no longer usable |

Use a uniqueness strategy for provider token and app identity. An installation can be associated with a different account after sign-out/sign-in; enforce a single active ownership policy and audit reassignment.

Do not rely on Android advertising IDs or iOS IDFA. Do not collect location or unrelated device identifiers for notification registration.

## 6. Product-scoped notification policy

Every notification must have an explicit product owner. Product scope is required at event creation, inbox persistence, push dispatch, preference checks and route resolution.

| Product | Example event families |
|---|---|
| Refill | Refill order updates, driver/station progress, wallet/payment result, cylinder verification |
| Store | Order confirmation, dispatch, delivery, refund and stock/order messages |
| Logistics | Booking acceptance, provider response, dispatch, tracking, completion, dispute and wallet events |
| Bills | Bill payment processing, success, failure, reversal, receipt availability and provider outage |

A user having one SKIMA account does not mean every app should deliver every notification to every registered device.

Default behavior:

- Send Refill notifications to active Refill registrations.
- Send Store notifications to active Store registrations.
- Send Logistics notifications to active Logistics registrations.
- Send Bills notifications to active Bills registrations.
- Respect user preferences and product notification policy.
- Allow users to disable optional categories without suppressing critical transactional/security notifications required by platform policy.
- Never send sensitive content simply because a token exists.

Cross-app handoff notifications must use an explicit product destination and validated deep link. A Store order event should route to Store, not to the Refill order screen.

## 7. Notification payload and deep-link safety

Use a compact, versioned payload. Example:

```json
{
  "version": 1,
  "app": "logistics",
  "notificationId": "server-notification-id",
  "event": "booking.status.changed",
  "route": {
    "path": "/bookings/opaque-booking-id"
  }
}
```

This is a contract illustration, not a real record.

Rules:

- Payloads contain identifiers and navigation hints, not secrets.
- Never include passwords, access/refresh tokens, full addresses, payment credentials or unnecessary personal data.
- Validate route values against an allowlist for the destination application.
- Reject absolute URLs, protocol-relative URLs, malformed routes and paths outside the app's route map.
- Fetch the actual record from the authenticated backend after the app opens.
- If signed out, route to sign-in and resume a safe destination only after authentication and authorization.
- If a record is unavailable or access is denied, show a safe fallback screen.

Use the canonical URL and app-link rules in [Application URLs and Deep Links](52-skima-domain-and-deep-link-contract.md).

## 8. Server-side dispatch and reliability

The mobile client must never send a push directly to another user's token. Sending happens through a trusted backend worker or Edge Function.

Recommended pipeline:

1. A committed business event creates or references a canonical in-app notification.
2. Notification policy resolves app scope, category, recipient, preference and eligibility.
3. A durable outbox item is inserted with a stable idempotency key.
4. A worker claims eligible items through a concurrency-safe mechanism.
5. The worker loads active token registrations for the exact product, platform and environment.
6. The delivery adapter sends a bounded batch through Expo Push Service.
7. Provider tickets and later receipts are recorded.
8. Transient failures are retried with bounded exponential backoff and jitter.
9. Permanent invalid-token responses deactivate the affected registration.
10. Exhausted attempts move to an observable dead-letter state and remain available for controlled replay.
11. Dispatch outcomes, provider response classes and retry decisions are auditable without logging private credentials.

Suggested outbox fields include notification ID, event ID, app key, recipient user ID, token-registration ID, idempotency key, status, attempt count, next attempt time, provider ticket/receipt ID, last safe error code, created/updated/sent timestamps and correlation ID.

Do not create a second ledger or treat a push receipt as proof that a business action happened. Notification delivery is informational; the order/payment/bill record remains authoritative.

### Failure rules

| Failure | Expected behavior |
|---|---|
| Missing FCM/APNs credentials | Mark remote delivery as not configured; preserve in-app inbox |
| Missing user permission | Do not send; keep registration permission state current |
| Invalid token | Deactivate registration and stop retrying that token |
| Provider rate limit or temporary outage | Retry with bounded backoff |
| Provider ticket accepted but receipt not available | Keep pending/receipt state; do not claim delivery |
| Ambiguous provider result | Reconcile ticket/receipt before any blind resend |
| Malformed or unauthorized route | Reject route and open a safe app destination |
| User signed out or switched account | Do not expose previous account's private content |

## 9. Client handling and UX

Every app uses a shared notification client contract implemented against the Expo SDK version installed by that app.

The shared contract covers:

- Permission state and contextual permission request.
- Token acquisition and registration.
- Token refresh and account-switch handling.
- Foreground notification presentation.
- Notification tap/response handling.
- Badge updates and Android notification channels.
- App-specific category preferences.
- Safe route validation and navigation.
- Registration error reporting that does not expose provider secrets.

Use app-specific notification channel IDs on Android (for example ``operations``, ``transactions``, ``delivery`` and optional ``promotions``) and keep IDs stable after release. On iOS, use supported notification categories and foreground presentation rules. Expose user controls in app settings and respect OS-level permission changes.

Do not prompt repeatedly after a user denies permission. Provide an explanation and a route to OS settings only when appropriate.

Keep the inbox usable if push is disabled. In-app notifications and remote push are two delivery surfaces for the same canonical event, not two independently created business records.

## 10. Credential readiness: build before keys arrive

Use explicit readiness states:

- ``not_configured``: provider credentials or application registration are absent.
- ``configured``: credentials and app identity have been added.
- ``verified``: non-spending provider checks and native build configuration pass.
- ``device_tested``: a real development/preview device received a test notification.
- ``production_ready``: production credentials, builds, tests, monitoring and runbook are approved.

Before credentials arrive, it is safe to build and test:

- Shared notification types and app identity registry.
- Token-registration API contract and authorization.
- Preference model and product-scoped routing.
- Outbox, worker state machine and idempotency behavior.
- In-app inbox integration.
- Local notification display and tap-routing tests.
- Mock adapter tests for success, invalid token, rate limit, timeout and retry.
- Observability, error taxonomy and Admin readiness display.

It is not safe to claim remote push is working, generate fake production tokens or mark an app production-ready before real credentials and physical-device tests succeed.

## 11. Android credential setup: Firebase FCM V1

When SKIMA has its Google/Firebase credentials:

1. Create or select the approved Firebase project for the relevant environment.
2. Register every Android app using its exact existing/proposed package name. One Firebase project may contain multiple registered Android app entries.
3. Download the matching ``google-services.json`` separately for each app.
4. Add the correct file to that app's Expo configuration through ``android.googleServicesFile`` or the repository's approved secure build configuration.
5. Enable Firebase Cloud Messaging API as required by the current Firebase setup.
6. Create or select a service account with the minimum FCM send permission needed.
7. Generate a private JSON service-account key only when required by the chosen EAS/Expo configuration.
8. Upload the FCM V1 service-account JSON into EAS credentials for each relevant EAS project. A service account may be reused across app EAS projects only when it is scoped to the intended Firebase project and securely managed.
9. Never commit the private service-account JSON to Git or include it in a mobile bundle. The ``google-services.json`` client configuration is distinct from the private service-account key; review its values and repository policy before committing.
10. Build a development/preview binary and test on a device with Google Play services before production release.

Expo guide: https://docs.expo.dev/push-notifications/fcm-credentials/

## 12. iOS credential setup: Apple APNs

When SKIMA has enrolled in the Apple Developer Program and registered the iOS app identifiers:

1. Confirm the Apple Team ID and bundle identifier for each app.
2. Enable Push Notifications capability for each iOS App ID.
3. Create an APNs authentication key in Apple Developer → Certificates, Identifiers & Profiles → Keys.
4. Save the downloaded ``.p8`` file securely; Apple only makes the private key available for download at creation time.
5. Record the APNs Key ID and Apple Team ID.
6. Configure the APNs key in EAS credentials for every relevant iOS EAS project.
7. Ensure the app's provisioning/build configuration includes the push capability.
8. Build a development/preview binary and test on a physical iOS device.
9. Validate production credentials and App Store build configuration separately before release.

Apple APNs key creation: https://developer.apple.com/help/account/keys/create-a-private-key/  
Expo managed credentials: https://docs.expo.dev/app-signing/managed-credentials/

An APNs authentication key can be used for multiple apps belonging to the same Apple Developer team, subject to Apple's current key/service configuration. Configure it in each relevant EAS project; do not create duplicate keys without operational need.

## 13. Expo application setup

For each standalone Expo app:

- Install SDK-compatible versions of ``expo-notifications`` and ``expo-constants`` using ``npx expo install``.
- Add the ``expo-notifications`` config plugin.
- Resolve that app's own EAS ``projectId``.
- Configure Android's matching ``google-services.json`` when FCM is enabled.
- Configure iOS notification entitlements/capabilities through managed build configuration.
- Implement a shared notification lifecycle and token registration module.
- Declare Android notification permission/channel behavior appropriate to the app.
- Test foreground, background, killed-app tap, sign-out, account switching and permission-denied flows.

Do not add plugin configuration without installing the matching SDK dependency and validating native config. Do not hand-edit generated native build artifacts if the repository uses managed Expo configuration; use app config and config plugins.

The current Refill app already includes ``expo-notifications``; Logistics, Store and Bills must be brought onto the shared implementation when their app foundations are ready. Do not assume the dependency exists in all apps today.

Expo setup guide: https://docs.expo.dev/push-notifications/push-notifications-setup/

## 14. Secrets and operational security

- Firebase service-account private JSON and Apple ``.p8`` are credentials; store them in EAS or an approved secret manager.
- Do not commit private keys, service-account JSON, APNs signing material or provider authorization headers.
- Do not expose private credentials through ``EXPO_PUBLIC_*``, Vite client variables, runtime app config or logs.
- Keep public app identifiers, host names and EAS project IDs separate from secrets.
- Limit service-account roles and rotate/revoke credentials after suspected exposure.
- Use separate credentials and registrations for development/preview versus production where practical.
- Never log complete push tokens with user identity in routine production logs. Mask or redact values.
- Apply authorization, rate limits and RLS/Edge Function checks to token registration and preference changes.
- Make dispatch safe against replay, duplicated events and concurrent workers.

## 15. Test and release matrix

| Test | Android | iOS |
|---|---:|---:|
| Permission allowed/denied/undetermined | Required | Required |
| Token created for correct app/EAS project | Required | Required |
| Registration is authenticated and idempotent | Required | Required |
| Product scope prevents cross-app notification | Required | Required |
| Foreground presentation | Required | Required |
| Background notification tap opens valid route | Required | Required |
| Killed app opens valid route after tap | Required | Required |
| Signed-out destination requires authentication | Required | Required |
| Token invalidation and retry behavior | Backend contract test | Backend contract test |
| Provider receipt processing | Required when credentials exist | Required when credentials exist |
| Real physical-device test | Required before production | Required before production |

For current Expo SDK generations, do not use Expo Go as proof of production push capability. Use a development or preview build with the actual native configuration and credentials. See https://docs.expo.dev/push-notifications/faq/

## 16. Implementation sequence

1. Audit existing notification inbox, event/outbox, Refill native handler and notification-related migrations.
2. Define product/app identity constants and validated notification payload schema.
3. Define authenticated token registration, refresh and deactivation contracts.
4. Reuse or extend existing notification storage without creating duplicate inbox/outbox concepts.
5. Implement Expo delivery adapter and a mock adapter for deterministic tests.
6. Implement receipt processing, retry, invalid-token cleanup and delivery observability.
7. Move Refill's local notification handling to the shared lifecycle without losing working behavior.
8. Bring Logistics onto the same client contract; add Store and Bills when their app foundations are prepared.
9. Configure Firebase/APNs credentials when available and run physical-device tests.
10. Enable production remote dispatch only after app identity, credentials, builds, tests, route, privacy and monitoring checks pass.

## 17. Definition of done

The notification system is complete only when:

- Android and iOS share one product-aware client contract.
- Every app has a distinct app identity and correct EAS project ID.
- Device registrations are authenticated, idempotent, app-scoped and environment-scoped.
- Push originates from authoritative server events and is delivered through a replaceable adapter.
- The in-app inbox works without push credentials.
- Foreground/background/killed-app notification handling routes safely.
- Retries, provider receipts, invalid tokens and dead letters are observable.
- No private provider credential is committed or bundled.
- Each app passes real device tests with its own configured platform credentials.
- Missing credentials are reported as a readiness gap, never disguised as successful delivery.

## Related documents

- [SKIMA product ecosystem architecture](50-skima-product-ecosystem-architecture.md)
- [Application URLs and domain configuration](52-skima-domain-and-deep-link-contract.md)
- [SKIMA platform constitution](../SKIMA_PLATFORM_CONSTITUTION.md)
- [Mobile experience foundation](30-mobile-experience-foundation.md)
