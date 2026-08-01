const requiredFiles = [
  "apps/mobile/index.html",
  "apps/mobile/vite.config.ts",
  "apps/mobile/vitest.config.ts",
  "apps/mobile/tsconfig.json",
  "apps/mobile/src/main.tsx",
  "apps/mobile/src/App.tsx",
  "apps/mobile/src/phase-one-lpg.ts",
  "apps/mobile/src/session.tsx",
  "apps/mobile/src/styles.css",
  "apps/mobile/src/mobile-foundation.test.ts",
  "packages/mobile-design/src/index.ts",
  "packages/mobile-design/README.md",
  "docs/30-mobile-experience-foundation.md",
] as const;

for (const path of requiredFiles) {
  const fileInfo = await Deno.stat(path).catch(() => null);
  requireCondition(fileInfo?.isFile === true, `Required mobile file is missing: ${path}.`);
}

const packageJson = JSON.parse(await Deno.readTextFile("package.json")) as {
  readonly scripts?: Readonly<Record<string, string>>;
};

for (
  const scriptName of [
    "mobile:dev",
    "mobile:check",
    "mobile:test",
    "mobile:build",
    "mobile:validate",
  ]
) {
  requireCondition(
    typeof packageJson.scripts?.[scriptName] === "string",
    `package.json must define ${scriptName}.`,
  );
}

const mobileAppSource = await Deno.readTextFile("apps/mobile/src/App.tsx");
const mobileSessionSource = await Deno.readTextFile("apps/mobile/src/session.tsx");
const mobileMainSource = await Deno.readTextFile("apps/mobile/src/main.tsx");
const phaseOneLpgSource = await Deno.readTextFile("apps/mobile/src/phase-one-lpg.ts");
const mobileDesignSource = await Deno.readTextFile("packages/mobile-design/src/index.ts");

for (
  const requirement of [
    "HomeScreen",
    "ServicesScreen",
    "OrdersScreen",
    "WalletScreen",
    "MessagesScreen",
    "AccountScreen",
    "ActionSheet",
    "RoleRail",
    "BottomNavigation",
    "data-theme",
    "useStoredPreference",
    "useResolvedTheme",
    "mobileAssetRequirements",
    "mobileInterfaceThemeOptions",
    "mobileCurrencyPreferencePolicy",
    "ModuleLogo",
    "business_logo",
    "vehicle_image",
    "qr_payload",
    "resolveModuleIdentity",
    "resolveServiceCategories",
    "resolveEnabledCurrencies",
    "phaseOneLpgExperience",
    "resolvePhaseOneRoleExperience",
    "resolvePhaseOneIdentity",
  ]
) {
  requireCondition(
    mobileAppSource.includes(requirement) || mobileDesignSource.includes(requirement) ||
      phaseOneLpgSource.includes(requirement),
    `Mobile foundation must include ${requirement}.`,
  );
}

for (
  const requirement of [
    "MobileSessionProvider",
    "useMobileSession",
    "createSkimaSupabaseClient",
    "createApiGatewayClient",
    "/runtime/session-context",
    "onAuthStateChange",
    "signInWithPassword",
    "QueryClientProvider",
  ]
) {
  requireCondition(
    mobileSessionSource.includes(requirement) || mobileMainSource.includes(requirement),
    `Connected mobile app must include ${requirement}.`,
  );
}

for (
  const requirement of [
    "useGatewayRecords",
    "/modules",
    "/runtime/wallet-balances",
    "/runtime/orders",
    "/runtime/service-requests",
    "/runtime/orders/assignments",
    "/runtime/drivers",
    "/runtime/vehicles",
    "/runtime/organization-branches",
    "/runtime/catalog/items",
    "/runtime/applications",
    "/runtime/documents",
    "/runtime/communications/messages",
    "/runtime/application-types",
    "/engines/currencies",
    "/engines/verification-definitions",
    "/runtime/payments/deposits",
    "/runtime/otp/challenges",
    "/runtime/otp/delivery",
    "/runtime/tracking/sessions",
    "/runtime/verifications",
    "createClientIdempotencyKey",
  ]
) {
  requireCondition(
    mobileAppSource.includes(requirement),
    `Connected mobile app must query ${requirement}.`,
  );
}

for (
  const forbiddenSecret of ["SERVICE_ROLE", "DB_PASSWORD", "PAYSTACK_SECRET", "GEMINI_API_KEY"]
) {
  requireCondition(
    !mobileAppSource.includes(forbiddenSecret) && !mobileSessionSource.includes(forbiddenSecret),
    `Mobile source must not reference backend secret ${forbiddenSecret}.`,
  );
}

for (const forbiddenBusinessComponent of ["LPGOrder", "GasStationCard", "RestaurantOrderTable"]) {
  requireCondition(
    !mobileAppSource.includes(forbiddenBusinessComponent) &&
      !mobileDesignSource.includes(forbiddenBusinessComponent),
    `Mobile foundation must not include business-specific component ${forbiddenBusinessComponent}.`,
  );
}

for (const forbiddenVisibleService of ["Ride", "Food", "Mart", "Restaurant"]) {
  requireCondition(
    !mobileAppSource.includes(`>${forbiddenVisibleService}<`) &&
      !mobileAppSource.includes(`label="${forbiddenVisibleService}"`) &&
      !phaseOneLpgSource.includes(`>${forbiddenVisibleService}<`) &&
      !phaseOneLpgSource.includes(`label="${forbiddenVisibleService}"`),
    `Mobile app must not hardcode visible service label ${forbiddenVisibleService}.`,
  );
}

requireCondition(
  !mobileDesignSource.includes("LPG"),
  "Shared mobile design contract must not contain LPG-specific product copy.",
);

console.log("Mobile foundation validation passed.");

function requireCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
