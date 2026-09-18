# SKIMA LPG Android production release

This runbook covers the native Expo application in `apps/lpg-mobile`.

## Release artifacts

The project intentionally has two Android release profiles:

- `production-apk` — signed APK for direct installation and production-device acceptance testing.
- `production` — signed Android App Bundle (AAB) for Google Play.

Google Play production distribution should use the `production` AAB profile. The APK profile exists for direct installation and release verification.

## One-time Expo account bootstrap

The repository is EAS-ready, but the Expo account must own a linked EAS project and Android signing credentials before a non-interactive GitHub build can succeed.

From the repository root:

```bash
cd apps/lpg-mobile
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest credentials -p android
```

During credential setup, allow EAS to generate and manage the Android keystore if SKIMA does not already have one. Do not commit the keystore to Git.

Copy the EAS project ID into this GitHub repository variable:

```text
EXPO_PUBLIC_EAS_PROJECT_ID
```

Create an Expo personal access token and save it as this GitHub repository secret:

```text
EXPO_TOKEN
```

The project ID is not a private credential. The Expo token is.

## EAS production environment

Both Android release profiles consume the EAS `production` environment. Configure these client-safe values in Expo/EAS before the first remote build:

```text
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
EXPO_PUBLIC_API_GATEWAY_URL
EXPO_PUBLIC_MAP_TILE_PROVIDER
EXPO_PUBLIC_MAP_TILE_URL
EXPO_PUBLIC_MAP_STYLE_URL
EXPO_PUBLIC_MAP_ATTRIBUTION
EXPO_PUBLIC_MAP_TILE_MAX_ZOOM
```

Never place service-role keys, payment secret keys, Didit secrets, Flutterwave secrets, webhook secrets, or any other private server credential in `EXPO_PUBLIC_*`.

## GitHub APK build

Open GitHub Actions and run:

```text
Android production APK
```

The workflow installs the locked LPG dependency set, typechecks the app, runs Expo Doctor, validates the resolved Expo configuration, then starts a signed EAS `production-apk` build and waits for it to finish.

The workflow is manual on purpose so routine commits do not consume EAS build quota.

Use the optional `clear_cache` input only when a native dependency or stale EAS cache is suspected.

## Local release commands

Signed APK:

```bash
cd apps/lpg-mobile
npx eas-cli@latest build --platform android --profile production-apk
```

Google Play AAB:

```bash
cd apps/lpg-mobile
npx eas-cli@latest build --platform android --profile production
```

## Versioning

EAS is the source of truth for Android `versionCode`. Both release profiles use remote versioning and automatic incrementing so CI does not create duplicate Android build versions.

The public app version remains `1.0.0` until an intentional product release changes it.

## Android background location

SKIMA driver fulfilment uses an Expo background location task. The native configuration therefore enables Android background location and the Android foreground location service, plus iOS background location mode.

Google Play treats background location as a sensitive capability. Before Play Store production submission, complete the Play Console background-location declaration and ensure the store disclosure and privacy copy match SKIMA's driver fulfilment use case.

## Asset status

The bundled `assets/skima-splash-logo.png` is a square 1254 × 1254 PNG and is used for the app icon and native splash branding.

A dedicated Android adaptive foreground/monochrome icon is still a design-quality enhancement. Add one when an approved SKIMA icon-only asset is available rather than inventing or stretching a brand asset just to fill the adaptive-icon slots.
