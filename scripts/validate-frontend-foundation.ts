const requiredFiles = [
  "apps/admin/index.html",
  "apps/admin/vite.config.ts",
  "apps/admin/vitest.config.ts",
  "apps/admin/tsconfig.json",
  "apps/admin/src/main.tsx",
  "apps/admin/src/App.tsx",
  "apps/admin/src/admin-resource-config.ts",
  "apps/admin/src/admin-resource-console.tsx",
  "apps/admin/src/session.tsx",
  "apps/admin/src/frontend-core.test.ts",
  "packages/frontend-core/src/index.ts",
  "packages/mobile-design/src/index.ts",
  "packages/ui/src/index.tsx",
  "packages/ui/src/styles.css",
  "docs/27-frontend-architecture.md",
  "docs/28-design-system.md",
  "docs/29-admin-console.md",
  "docs/30-mobile-experience-foundation.md",
] as const;

for (const path of requiredFiles) {
  const fileInfo = await Deno.stat(path).catch(() => null);
  requireCondition(
    fileInfo?.isFile === true,
    `Required frontend foundation file is missing: ${path}.`,
  );
}

const packageJson = JSON.parse(await Deno.readTextFile("package.json")) as {
  readonly scripts?: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
};

for (
  const scriptName of [
    "frontend:build",
    "frontend:check",
    "frontend:test",
    "frontend:validate",
  ]
) {
  requireCondition(
    typeof packageJson.scripts?.[scriptName] === "string",
    `package.json must define ${scriptName}.`,
  );
}

for (
  const dependencyName of [
    "react",
    "react-dom",
    "@supabase/supabase-js",
    "@tanstack/react-query",
    "zod",
    "lucide-react",
  ]
) {
  requireCondition(
    typeof packageJson.dependencies?.[dependencyName] === "string",
    `package.json must declare frontend dependency ${dependencyName}.`,
  );
}

for (const dependencyName of ["vite", "vitest", "typescript"]) {
  requireCondition(
    typeof packageJson.devDependencies?.[dependencyName] === "string",
    `package.json must declare frontend dev dependency ${dependencyName}.`,
  );
}

const coreSource = await Deno.readTextFile("packages/frontend-core/src/index.ts");
const mobileDesignSource = await Deno.readTextFile("packages/mobile-design/src/index.ts");
const uiSource = await Deno.readTextFile("packages/ui/src/index.tsx");
const uiStyles = await Deno.readTextFile("packages/ui/src/styles.css");
const appSource = await Deno.readTextFile("apps/admin/src/App.tsx");
const adminResourceConfigSource = await Deno.readTextFile(
  "apps/admin/src/admin-resource-config.ts",
);
const adminResourceConsoleSource = await Deno.readTextFile(
  "apps/admin/src/admin-resource-console.tsx",
);
const sessionSource = await Deno.readTextFile("apps/admin/src/session.tsx");

for (
  const requiredExport of [
    "createSkimaSupabaseClient",
    "createApiGatewayClient",
    "createClientIdempotencyKey",
    "SessionContextSchema",
    "filterNavigationItems",
    "resolveOnboardingFlow",
    "formatMoney",
  ]
) {
  requireMatch(
    coreSource,
    new RegExp(`export .*${requiredExport}`),
    `${requiredExport} must be exported from frontend core.`,
  );
}

for (
  const componentName of [
    "Button",
    "IconButton",
    "TextInput",
    "TextAreaInput",
    "SelectInput",
    "CheckboxField",
    "DataTable",
    "DetailList",
    "Dialog",
    "PageShell",
    "OnboardingChecklist",
    "MoneyDisplay",
    "PermissionGate",
  ]
) {
  requireMatch(
    uiSource,
    new RegExp(`export .*${componentName}`),
    `${componentName} must be part of the UI foundation.`,
  );
}

for (
  const token of [
    "--sk-color-primary",
    "--sk-color-surface",
    "--sk-color-danger",
    "--sk-radius-md",
    "--sk-space-4",
    "--sk-focus",
  ]
) {
  requireCondition(uiStyles.includes(token), `Design token is missing: ${token}.`);
}

requireCondition(
  coreSource.includes("VITE_SUPABASE_URL") && coreSource.includes("VITE_SUPABASE_ANON_KEY"),
  "Frontend core must read only client-safe Vite Supabase env values.",
);

for (
  const forbiddenSecret of ["SERVICE_ROLE", "DB_PASSWORD", "PAYSTACK_SECRET", "GEMINI_API_KEY"]
) {
  requireCondition(
    !coreSource.includes(forbiddenSecret) && !sessionSource.includes(forbiddenSecret) &&
      !appSource.includes(forbiddenSecret),
    `Frontend source must not reference backend secret ${forbiddenSecret}.`,
  );
}

requireCondition(
  sessionSource.includes("/runtime/session-context"),
  "Session provider must load backend-driven session context.",
);

requireCondition(
  appSource.includes("filterNavigationItems") && appSource.includes("requiredPermissions"),
  "App shell navigation must be permission-aware.",
);

requireCondition(
  appSource.includes("operatorOnboardingFlow") && appSource.includes("OnboardingChecklist"),
  "Milestone 4 must include reusable in-app onboarding scaffolding.",
);

requireCondition(
  uiSource.includes("data-label") && uiStyles.includes("max-width: 720px"),
  "Responsive table records must convert into labeled mobile card rows.",
);

for (
  const mobileRequirement of [
    "mobileColorTokens",
    "mobileInteractionTokens",
    "filterMobileNavigation",
    "mobileOnboardingSteps",
    "wallet",
    "verify",
    "updates",
  ]
) {
  requireCondition(
    mobileDesignSource.includes(mobileRequirement),
    `Mobile design foundation must include ${mobileRequirement}.`,
  );
}

requireCondition(
  adminResourceConsoleSource.includes("AdminResourceConsole") &&
    adminResourceConsoleSource.includes("createClientIdempotencyKey"),
  "Admin console actions must use the reusable governed resource console.",
);

requireCondition(
  adminResourceConfigSource.includes("/runtime/withdrawals/approve") &&
    adminResourceConfigSource.includes("/runtime/escrow/release") &&
    adminResourceConfigSource.includes("/runtime/organization-staff/status") &&
    adminResourceConfigSource.includes("/admin/profiles/status"),
  "Admin action catalog must cover governed finance and organization controls.",
);

const foundationSource = [
  await Deno.readTextFile("apps/admin/src/App.tsx"),
  await Deno.readTextFile("apps/admin/src/admin-resource-config.ts"),
  await Deno.readTextFile("apps/admin/src/admin-resource-console.tsx"),
  await Deno.readTextFile("apps/admin/src/session.tsx"),
  await Deno.readTextFile("packages/frontend-core/src/index.ts"),
  await Deno.readTextFile("packages/mobile-design/src/index.ts"),
  await Deno.readTextFile("packages/ui/src/index.tsx"),
].join("\n");

for (
  const forbiddenBusinessTerm of [
    "LPGOrder",
    "GasStation",
    "CylinderStatus",
    "RestaurantOrder",
    "RideDriver",
  ]
) {
  requireCondition(
    !foundationSource.includes(forbiddenBusinessTerm),
    `Frontend foundation must not include business-specific component ${forbiddenBusinessTerm}.`,
  );
}

const visibleCopySource = [
  await Deno.readTextFile("apps/admin/src/App.tsx"),
  await Deno.readTextFile("apps/admin/src/admin-resource-config.ts"),
  await Deno.readTextFile("apps/admin/src/admin-resource-console.tsx"),
  await Deno.readTextFile("apps/admin/src/bootstrap.ts"),
  await Deno.readTextFile("apps/admin/src/main.tsx"),
  await Deno.readTextFile("packages/frontend-core/src/index.ts"),
  await Deno.readTextFile("packages/ui/src/index.tsx"),
].join("\n");

for (
  const forbiddenVisiblePhrase of [
    "Frontend startup error",
    "The frontend could not start",
    "Platform operations",
    "Control Plane",
    "Engine Routes",
    "Runtime Routes",
    "Module Routes",
    "Provider Adapters",
    "Provider Operations",
    "Workspace unavailable",
    "workspace could not",
    "No records returned for this workspace",
    "The network request failed.",
    "Operator Onboarding",
  ]
) {
  requireCondition(
    !visibleCopySource.includes(forbiddenVisiblePhrase),
    `User-facing frontend copy must not expose internal phrase: ${forbiddenVisiblePhrase}.`,
  );
}

console.log("Frontend foundation validation passed.");

function requireCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function requireMatch(value: string, pattern: RegExp, message: string): void {
  if (!pattern.exec(value)) {
    throw new Error(message);
  }
}
