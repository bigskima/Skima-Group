# SKIMA Public Website

Production-facing public website for https://skima.online.

## Customer product structure

SKIMA has two customer mobile apps planned for Google Play distribution:

- Refill: https://refill.skima.online/
- Logistics: https://logistics.skima.online/

The website retains four complete, independent service destinations. Bills and Store remain full web products and are also available as complete workspaces inside the Refill and Logistics mobile apps respectively:

- Refill: https://refill.skima.online/
- Logistics: https://logistics.skima.online/
- Bills: https://bills.skima.online/
- Store: https://store.skima.online/

The app-download section lists only Refill and Logistics. The service cards and footer continue to link to all four web products. Do not remove Bills or Store from web discovery or deployment configuration when changing the mobile release plan.

## Deploy on Vercel

Create a Vercel project connected to bigskima/Skima-Group with the project root directory set to `apps/website`. This is a static site and does not need a build step.

## Public assets

- `assets/skima-home-hero.svg` — original AI-generated campaign photograph embedded as a self-contained WebP image. It is illustrative campaign artwork, not a documentary photograph of SKIMA staff, vehicles or customers.
- `assets/skima-mark.svg` — the existing SKIMA app symbol bundled from `apps/lpg-mobile/assets/skima-splash-logo.png`.

The service cards use native vector icons and CSS treatments. They do not use fabricated stock photographs.
