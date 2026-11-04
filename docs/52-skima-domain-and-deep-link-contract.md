# SKIMA Domain Configuration and Application Deep-Link Contract

**Status:** Domain-independent design; actual root domain not purchased or selected  
**Date:** 2026-11-04  
**Applies to:** Public website, Admin, Refill, Store, Logistics and Bills

## 1. Purpose

SKIMA must be able to use the product host pattern below without locking source code to `.online` or any other top-level domain:

- Public website: `https://<root-domain>`
- Admin: `https://admin.<root-domain>`
- Refill: `https://refill.<root-domain>`
- Store: `https://store.<root-domain>`
- Logistics: `https://logistics.<root-domain>`
- Bills: `https://bills.<root-domain>`

The actual domain may eventually be `.online`, `.com`, `.xyz`, `.org` or another domain SKIMA can register and control. The product architecture must work unchanged regardless of the final suffix.

This document does not assert that `skima.online` or another exact domain is available. Domain availability must be checked with an accredited registrar and confirmed by successful registration before using it in production.

## 2. Domain names are configuration, not product identity

A hostname is a deployment address. It is not an application's permanent identity.

Never use a domain name as:

- an Android package name;
- an iOS bundle identifier;
- an EAS project ID;
- a Supabase project reference;
- a user or organisation ID;
- a transaction key or financial identifier;
- a required database enum or business-module key.

The existing mobile identities remain:

| Product | Android package | iOS bundle identifier | Custom scheme |
|---|---|---|---|
| Refill | `com.skima.lpg` | `com.skima.lpg` | `skima-lpg` |
| Logistics | `com.skima.logistics` | `com.skima.logistics` | `skima-logistics` |

Store and Bills will receive distinct package/bundle identifiers before their first public app registration. A domain purchase or domain migration must not trigger bundle-ID changes.

## 3. Central URL configuration contract

Create one shared domain/URL resolver. Product components must not contain literal SKIMA production hostnames.

The resolver should read explicit public base URL configuration:

| Variable | Example shape (placeholder only) |
|---|---|
| `SKIMA_ROOT_DOMAIN` | `example.tld` |
| `SKIMA_PUBLIC_BASE_URL` | `https://example.tld` |
| `SKIMA_ADMIN_BASE_URL` | `https://admin.example.tld` |
| `SKIMA_REFILL_BASE_URL` | `https://refill.example.tld` |
| `SKIMA_STORE_BASE_URL` | `https://store.example.tld` |
| `SKIMA_LOGISTICS_BASE_URL` | `https://logistics.example.tld` |
| `SKIMA_BILLS_BASE_URL` | `https://bills.example.tld` |

Explicit service URLs are intentional. The default pattern derives each subdomain from the configured root domain, while explicit overrides allow products to be hosted separately, use a temporary preview host, or migrate independently.

Configuration rules:

1. Validate every URL as HTTPS in production.
2. Reject credentials, query strings and fragments in configured base URLs.
3. Normalize trailing slashes.
4. Keep local development and preview URLs separate from production.
5. Validate hosts against an approved environment allowlist.
6. Expose only public URLs to browser/mobile clients.
7. Keep API keys, Supabase service-role values and provider credentials out of these variables.
8. Fail clearly at startup when a required production host is missing or malformed.
9. Do not silently fall back to a stale production domain.

A shared resolver should provide typed functions such as:

- `getProductBaseUrl("refill")`
- `buildProductUrl("store", "/products/{id}")`
- `getPublicSiteUrl()`
- `getAppInstallUrl("bills", "android")`
- `getAppInstallUrl("bills", "ios")`

The functions validate path segments, encode identifiers and reject protocol-relative or arbitrary external URLs. Do not build URLs by concatenating untrusted route strings.

## 4. Canonical route contract

Cross-product URLs must use stable, product-owned paths. Example shapes:

| Destination | Canonical path |
|---|---|
| Store product | `/products/{productId}` |
| Store category | `/categories/{categorySlug}` |
| Store order | `/orders/{orderId}` |
| Bills electricity | `/electricity` |
| Bills transaction | `/transactions/{transactionId}` |
| Logistics service | `/services/{serviceId}` |
| Logistics booking | `/bookings/{bookingId}` |
| Refill order | `/orders/{orderId}` |

These are route contract examples. Confirm exact route names against the destination app router before enabling a link.

Every app must publish a route allowlist. The resolver may generate only supported routes. The destination app must validate the incoming route again before navigation and must fetch sensitive record data from the authenticated backend.

Do not place tokens, passwords, wallet secrets, full addresses, payment credentials or other sensitive customer details in a URL.

## 5. Installed app versus web fallback

Use HTTPS links as the canonical entry point.

Expected behavior:

1. If the destination app is installed and the host is verified for that app, open the app at the corresponding route.
2. If the destination app is not installed, show the destination website at the same route.
3. The website should show a clear Android/Google Play and iOS/App Store installation action when store listings are configured.
4. If the app is installed but the requested record is not accessible, show a safe fallback and explain that the customer must sign in or does not have access.
5. If the requested route is not supported, show the product home page rather than a blank screen.

Do not assume that a normal browser redirect can detect every installed-app state reliably. Use operating-system-verified app links and test browser behavior on supported devices.

### Installation handoff

If the customer follows a product link before installing the app:

- render the website fallback;
- preserve only a safe, allowlisted destination path and opaque resource ID;
- offer the correct store listing;
- use a tested deferred-link mechanism if the product needs to resume the destination after installation;
- after first launch, require authentication and authorization before opening protected content.

If deferred-link support is not implemented, land at the app home screen and make the intended destination available through a safe web page or in-app continuation. Never claim deferred routing works until tested.

## 6. Android App Links

For each Android product:

1. Configure an HTTPS intent filter for the product's approved host(s).
2. Enable verified App Links (`android:autoVerify` through the appropriate Expo config/plugin/native manifest setup).
3. Host a valid `/.well-known/assetlinks.json` on every host that claims links for the app.
4. Include the exact Android package name and SHA-256 signing-certificate fingerprint.
5. Use the Play App Signing certificate fingerprint for the public Play release, not an unrelated local debug keystore fingerprint.
6. Verify the domain-to-app association on physical devices and through Android App Links tooling.

The Digital Asset Links file must be hosted over HTTPS with the required JSON content type and must be publicly accessible without authentication or redirects that break verification.

Official Android reference: https://developer.android.com/training/app-links/verify-android-applinks

## 7. iOS Universal Links

For each iOS product:

1. Register the exact iOS App ID and bundle identifier in the Apple Developer account.
2. Enable the Associated Domains capability.
3. Add the approved host(s) as `applinks:<host>` entitlement entries.
4. Host the Apple App Site Association file at `/.well-known/apple-app-site-association` on each relevant host.
5. Define the path/components rules for only the routes the app can handle.
6. Serve the file over HTTPS without a file extension and with an appropriate JSON response.
7. Test installation, upgrade, app-not-installed fallback and route handling on physical iOS devices.

Do not assume that associating the root website automatically configures every subdomain. Explicitly configure and verify the public website and each app host required for Universal Links.

Official Apple reference: https://developer.apple.com/documentation/xcode/supporting-associated-domains

## 8. Expo / React Native implementation

The mobile apps use Expo/React Native. Use the supported Expo linking and app configuration mechanism for the installed SDK version.

Each standalone app needs:

- a stable custom scheme for legacy/in-app routing where useful;
- canonical HTTPS app-link support;
- a product route allowlist;
- safe route parsing;
- authenticated route continuation;
- notification payload routing that uses the same route allowlist;
- web fallback behavior.

Custom schemes such as `skima-lpg://` are useful for app-to-app or development flows but are not the preferred public canonical link. Another app could claim a custom scheme. Verified HTTPS links provide domain ownership verification.

Never embed the eventual production domain as a permanent native application identifier. The canonical root host is runtime/build configuration. Updating the domain should not require changing the Android package, iOS bundle ID or EAS project ID.

## 9. Store, Bills, Logistics and Refill cross-navigation

Examples using a placeholder domain:

- Refill → Store product: `https://store.example.tld/products/{productId}`
- Logistics → Store category: `https://store.example.tld/categories/{categorySlug}`
- Bills → Store home: `https://store.example.tld/`
- Store → Bills electricity: `https://bills.example.tld/electricity`
- Store order notification → Store order: `https://store.example.tld/orders/{orderId}`

Embedded Store sections in Refill, Logistics and Bills should remain curated entry points into the same Store catalogue and checkout services. A “Full Store experience” CTA opens the canonical Store link. The installed Store app handles it when available; otherwise the Store website provides a useful fallback and installation CTA.

Bills remains a complete standalone product. Refill and Logistics retain their deliberately limited Bills flows. Cross-navigation is not permission to mix product data or notification scope.

## 10. Domain purchase and deployment checklist

Before choosing the root domain:

- check exact-name availability at a registrar;
- confirm the registrant is SKIMA/the intended legal entity or authorised owner;
- enable registrar account MFA and domain transfer lock;
- use reliable renewal and recovery email details;
- enable DNSSEC if supported by the chosen DNS provider and deployment design;
- keep registrar ownership separate from a developer's personal account where practical.

After purchase:

1. Configure DNS records for the public site and each product host.
2. Connect each host to the correct Vercel/Netlify deployment or hosting target.
3. Verify DNS ownership and TLS/HTTPS certificates.
4. Configure canonical base URL environment values in the deployment environments.
5. Publish Android `assetlinks.json` and iOS `apple-app-site-association` files.
6. Update EAS/Expo linking configuration and rebuild native apps when native entitlements/intent filters change.
7. Configure OAuth redirect allowlists, Supabase Auth redirect URLs, payment return URLs and provider webhook URLs where applicable.
8. Update email links, QR codes, campaign CTAs, support links and notification destinations through the central URL resolver.
9. Test every product host, deep link, fallback, authentication continuation and error route.
10. Retain the old host during migration with HTTPS redirects and verified associations for an intentional transition period.

DNS records and HTTPS certificates are deployment configuration. Do not hardcode DNS records or certificate details in application logic.

## 11. Domain migration

Changing from one TLD to another should be a configuration and deployment operation, not a product rewrite.

Migration sequence:

1. Purchase and verify the new root domain.
2. Configure all new product hosts and TLS.
3. Deploy canonical URL configuration to preview environments.
4. Publish and verify App Links and Universal Links on the new hosts.
5. Update Supabase Auth redirect allowlists, OAuth callback URLs, payment return URLs and external provider registrations.
6. Test the new hosts with current released app versions.
7. Update public links, QR codes, emails and notification destinations.
8. Keep the old domain live with safe HTTPS redirects while old links remain in circulation.
9. Remove the old association only after the transition and compatibility period is complete.

The native package names and bundle identifiers remain unchanged.

## 12. Operational and security requirements

- Use HTTPS for all production public hosts.
- Do not redirect authenticated API requests to an unexpected host.
- Validate inbound paths and reject arbitrary external destinations to prevent open redirects.
- Never put bearer tokens or secrets in deep-link query parameters.
- Apply server authorization after deep-link navigation; a link is not proof of entitlement.
- Avoid leaking private record details in link previews or notification payloads.
- Keep local, preview and production domains distinct.
- Restrict Supabase Auth redirect URLs to approved hosts and exact required paths.
- Monitor broken app links, invalid association files, certificate expiry and domain renewal.

## 13. Acceptance criteria

The contract is satisfied when:

- the final TLD can be chosen later without application source-code rewrites;
- all product base URLs come from validated configuration;
- each product's native identity remains independent of its domain;
- verified Android App Links and iOS Universal Links open the correct installed app;
- browser fallback works when an app is not installed;
- store installation links are configurable and are not fabricated before listing IDs exist;
- safe route continuation works after authentication;
- unauthorised routes never expose data;
- cross-app links preserve product boundaries and notification scope;
- domain migration can be completed using DNS, host configuration, association files, redirects and provider allowlist updates.

## Related documents

- [SKIMA product ecosystem architecture](50-skima-product-ecosystem-architecture.md)
- [SKIMA cross-platform push notifications](51-skima-cross-platform-push-notifications.md)
- [Design system](28-design-system.md)
- [Mobile experience foundation](30-mobile-experience-foundation.md)
