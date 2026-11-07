import { assert, assertStringIncludes } from "jsr:@std/assert@1.0.18";

const read = (path: string) => Deno.readTextFile(path);

Deno.test("four-app auth headers share the Refill compact brand layout", async () => {
  const shell = await read("apps/lpg-mobile/src/native/ui/AuthShell.tsx");
  for (const path of [
    "apps/store-mobile/src/screens/StoreAuthScreen.tsx",
    "apps/bills-mobile/src/screens/BillsAuthScreen.tsx",
    "apps/logistics-mobile/src/auth/SignInScreen.tsx",
  ]) {
    const screen = await read(path);
    assertStringIncludes(screen, "logoPlate");
    assertStringIncludes(screen, "BrandMark compact");
    assertStringIncludes(screen, "brandName");
    assertStringIncludes(screen, "brandCaption");
  }
  assertStringIncludes(shell, "BrandMark compact");
  assertStringIncludes(shell, "styles.logoPlate");
});

Deno.test("all four home promotion banners keep a consistent secondary footprint", async () => {
  const paths = [
    "apps/lpg-mobile/src/native/ui/PromotionBanner.tsx",
    "apps/store-mobile/src/ui/StorePromotionBanner.tsx",
    "apps/bills-mobile/src/ui/BillsPromotionBanner.tsx",
    "apps/logistics-mobile/src/ui/LogisticsPromotionBanner.tsx",
  ];
  const source = await Promise.all(paths.map(read));
  for (const banner of source) {
    assertStringIncludes(banner, "190");
    assertStringIncludes(banner, "mobile.home.promotion");
  }
  const admin = await read("apps/admin/src/features/experience/ContentWorkspaceV2.tsx");
  assertStringIncludes(admin, "Which SKIMA app should show this?");
  assertStringIncludes(admin, "routeOptionsForApp");
  assertStringIncludes(admin, "Referrals & rewards");
  assertStringIncludes(admin, "secondary home banner");
});

Deno.test("campaign routing covers each referral destination and uses named route choices", async () => {
  const editor = await read("apps/admin/src/features/experience/ContentWorkspaceV2.tsx");
  assertStringIncludes(editor, '{ label: "Referrals & rewards", value: "/(customer)/referrals" }');
  assertStringIncludes(editor, '{ label: "Referrals & rewards", value: "/referrals" }');
  const storeNavigation = await read("apps/store-mobile/src/navigation/storeNavigation.ts");
  const billsNavigation = await read("apps/bills-mobile/src/navigation/billsNavigation.ts");
  assertStringIncludes(storeNavigation, '"/referrals": "referrals"');
  assertStringIncludes(billsNavigation, '"/referrals": "referrals"');
  assertStringIncludes(editor, 'ctaType === "route"');
});

Deno.test("public app downloads use the existing shared quick-route registry and web fallback", async () => {
  const landing = await read("apps/website/index.html");
  const admin = await read("apps/admin/src/admin-app-links-workspace.tsx");
  assertStringIncludes(landing, 'id="apps"');
  assertStringIncludes(landing, "customer_service_discovery_links");
  assertStringIncludes(landing, "target.store||target.web");
  assertStringIncludes(admin, "customer_service_discovery_links");
  assertStringIncludes(admin, "web URL as the fallback");
});

Deno.test("the same referral programme is available in all four apps and admin", async () => {
  const screens = [
    "apps/lpg-mobile/src/native/ui/ReferralsScreen.tsx",
    "apps/store-mobile/src/screens/StoreReferralsScreen.tsx",
    "apps/bills-mobile/src/screens/BillsReferralsScreen.tsx",
    "apps/logistics-mobile/src/screens/LogisticsReferralsScreen.tsx",
  ];
  for (const path of screens) {
    const screen = await read(path);
    assertStringIncludes(screen, "read_my_referral_dashboard");
    assertStringIncludes(screen, "leaderboard");
    assertStringIncludes(screen, "activeCampaigns");
    assertStringIncludes(screen, "referralCode");
  }
  const signupScreens = [
    "apps/logistics-mobile/src/auth/SignInScreen.tsx",
    "apps/store-mobile/src/screens/StoreAuthScreen.tsx",
    "apps/bills-mobile/src/screens/BillsAuthScreen.tsx",
  ];
  for (const path of signupScreens) {
    const screen = await read(path);
    assertStringIncludes(screen, "referralCode");
    assertStringIncludes(screen, "optional");
  }
  const admin = await read("apps/admin/src/admin-referrals-workspace.tsx");
  for (const app of ['"refill"', '"store"', '"logistics"', '"bills"']) {
    assertStringIncludes(admin, app);
  }
});

Deno.test("cross-app finance analytics includes all four app identities and ledger movements", async () => {
  const workspace = await read("apps/admin/src/admin-financial-analytics-workspace.tsx");
  for (const app of ['"refill"', '"store"', '"logistics"', '"bills"']) {
    assertStringIncludes(workspace, app);
  }
  assertStringIncludes(workspace, "byApplication");
  assertStringIncludes(workspace, "Financial activity by app");
  assertStringIncludes(workspace, "heldAmount");
  assertStringIncludes(workspace, "releasedAmount");
  assertStringIncludes(workspace, "refundReversalAmount");
});

Deno.test("push delivery and private Firebase materialisation cover four app packages", async () => {
  const docs = await read("docs/53-skima-four-app-push-notifications.md");
  assertStringIncludes(docs, "skima_supabase_url");
  assertStringIncludes(docs, "skima_service_role_key");
  for (const app of ["REFILL", "STORE", "BILLS", "LOGISTICS"]) {
    const materializer = await read(`apps/${app === "REFILL" ? "lpg" : app.toLowerCase()}-mobile/scripts/materialize-google-services.cjs`);
    assertStringIncludes(materializer, `SKIMA_${app}_GOOGLE_SERVICES_JSON_BASE64`);
    assertStringIncludes(materializer, "google-services.json");
    assertStringIncludes(materializer, "package_name");
  }
  const lifecycleFiles = [
    "apps/lpg-mobile/src/native/notifications/PushRegistration.tsx",
    "apps/store-mobile/src/notifications/StoreNotificationLifecycle.tsx",
    "apps/bills-mobile/src/notifications/BillsNotificationLifecycle.tsx",
    "apps/logistics-mobile/src/notifications/LogisticsNotificationLifecycle.tsx",
  ];
  for (const path of lifecycleFiles) {
    const lifecycle = await read(path);
    assertStringIncludes(lifecycle, "register_skima_push_device");
  }
});

Deno.test("manual Android workflow builds APK or AAB for selected apps sequentially", async () => {
  const workflow = await read(".github/workflows/android-four-app-build.yml");
  assertStringIncludes(workflow, "workflow_dispatch");
  assertStringIncludes(workflow, "production-apk");
  assertStringIncludes(workflow, "production-aab");
  assertStringIncludes(workflow, "max-parallel: 1");
  assertStringIncludes(workflow, "EXPO_TOKEN");
  assertStringIncludes(workflow, "SKIMA_STORE_EAS_PROJECT_ID");
  assertStringIncludes(workflow, "SKIMA_BILLS_EAS_PROJECT_ID");
  assertStringIncludes(workflow, "SKIMA_LOGISTICS_EAS_PROJECT_ID");
});
