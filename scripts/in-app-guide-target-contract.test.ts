const provider = await Deno.readTextFile("apps/lpg-mobile/src/native/onboarding/InAppGuideProvider.tsx");
const tabs = await Deno.readTextFile("apps/lpg-mobile/src/native/navigation/WorkspaceTabs.tsx");
const premiumDashboard = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/PremiumDashboard.tsx");
const stationDashboard = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/StationDashboardScreen.tsx");
const accountSettings = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/WorkspaceAccountSettingsScreen.tsx");
const customerLayout = await Deno.readTextFile("apps/lpg-mobile/app/(customer)/_layout.tsx");
const driverLayout = await Deno.readTextFile("apps/lpg-mobile/app/(driver)/_layout.tsx");
const stationLayout = await Deno.readTextFile("apps/lpg-mobile/app/(station)/_layout.tsx");
const migration = await Deno.readTextFile("supabase/migrations/20261025170100_lpg_in_app_guide_route_target_alignment.sql");

function requireText(source: string, fragment: string, label: string) {
  if (!source.includes(fragment)) {
    throw new Error(`${label}: missing required tour contract fragment: ${fragment}`);
  }
}

Deno.test("tour targets are scoped by workspace and match the visible target components", () => {
  requireText(tabs, "targetKey={`nav.${guideScope}.${name}`}", "workspace tab anchors");
  requireText(customerLayout, 'guideScope="customer"', "customer tab scope");
  requireText(driverLayout, 'guideScope="driver"', "driver tab scope");
  requireText(stationLayout, 'guideScope="station"', "station tab scope");
  requireText(premiumDashboard, 'targetKey={`${workspace}.workspace-switcher`}', "customer/driver home switcher");
  requireText(stationDashboard, 'targetKey="station.workspace-switcher"', "station home switcher");
  requireText(premiumDashboard, 'targetKey="customer.location"', "customer delivery location");
  requireText(premiumDashboard, 'targetKey="customer.primary-action"', "customer refill action");
  requireText(premiumDashboard, 'targetKey="driver.operations"', "driver quick actions");
  requireText(stationDashboard, 'targetKey="station.operations"', "station reception actions");
  requireText(accountSettings, 'targetKey={`account.${workspace}.app-guide`}', "account guide replay entry");

  const expectedKeys = [
    "customer.workspace-switcher",
    "customer.location",
    "customer.primary-action",
    "nav.customer.cylinders",
    "nav.customer.orders",
    "nav.customer.wallet",
    "nav.customer.account",
    "account.customer.app-guide",
    "driver.workspace-switcher",
    "driver.operations",
    "nav.driver.jobs",
    "nav.driver.scan",
    "nav.driver.earnings",
    "nav.driver.account",
    "account.driver.app-guide",
    "station.workspace-switcher",
    "station.operations",
    "nav.station.jobs",
    "nav.station.scan",
    "nav.station.settlements",
    "nav.station.account",
    "account.station.app-guide",
  ];
  for (const key of expectedKeys) requireText(migration, `'${key}'`, `server tour target ${key}`);

  if (migration.includes("'common.workspace-switcher'")) {
    throw new Error("The updated server guide must not reuse the old cross-workspace switcher key.");
  }
});

Deno.test("tour waits for the requested route and resolved anchor before enabling Next", () => {
  requireText(provider, 'import { router, usePathname, useSegments } from "expo-router";', "route segment tracking");
  requireText(provider, "const requiredRoute = normalizeGuideRoute(step.route);", "requested route normalization");
  requireText(provider, "if (activeGuideRoute !== requiredRoute)", "route-confirmed measurement");
  requireText(provider, "target.measureInWindow", "anchor measurement");
  requireText(provider, "const visibleLeft = Math.max(x, 0);", "viewport-clipped anchor measurement");
  requireText(provider, "if (visibleRight > visibleLeft && visibleBottom > visibleTop)", "off-screen target guard");
  requireText(provider, "disabled={!rect && !targetUnavailable}", "no progression before an anchor or explicit fallback");
  requireText(provider, "targetsRef.current.get(key) === previousNode", "stale ref protection");
  requireText(provider, "This control could not be found on this screen, so we will not point to another place.", "honest no-anchor fallback");
});

Deno.test("tour content version 2 aligns copy and resets completed guide progress", () => {
  requireText(migration, "version = 3", "tour version increment");
  requireText(migration, "tourContentVersion', 3", "guide content version metadata");
  requireText(migration, "Station Managed delivery settings", "station fulfilment tour copy");
  requireText(migration, "wallet", "customer wallet context");
  requireText(migration, "Replay this tour", "replay entry guidance");

  const rows = [...migration.matchAll(/\('lpg\.(customer|driver|station)\.core-tour',(\d+),'([^']+)','([^']+)'/g)];
  if (rows.length !== 22) {
    throw new Error(`Expected 22 canonical tour steps, found ${rows.length}.`);
  }
  const unique = new Set(rows.map((row) => `${row[1]}:${row[4]}`));
  if (unique.size !== rows.length) {
    throw new Error("A tour target key is repeated within the same workspace guide.");
  }
});
