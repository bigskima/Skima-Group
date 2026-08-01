# Mobile Design Contract

This package defines the reusable mobile experience contract for Skima.

It is framework-light on purpose. The native mobile app can consume these tokens and definitions
whether the implementation uses Expo, React Native, or another approved mobile adapter later.

Exports include:

- mobile color tokens
- light, dark, and system interface preference options
- currency preference policy linked to backend currency definitions
- touch target and sheet/navigation interaction tokens
- role-aware mobile surface definitions
- permission-filtered mobile navigation
- reusable mobile onboarding steps
- data-driven business-module visual identity contracts
- media requirements for business logos, cover images, catalog images, vehicle images, driver
  avatars, document previews, QR payloads, and map previews

No business-specific component or LPG-only behavior belongs here.
