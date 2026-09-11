import { readFile, writeFile } from "node:fs/promises";

function replaceExact(source, before, after, label) {
  if (!source.includes(before)) throw new Error("Phase 3 patch could not find " + label);
  return source.replace(before, after);
}

function removeBetween(source, start, end, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) throw new Error("Phase 3 patch could not find " + label);
  return source.slice(0, startIndex) + source.slice(endIndex);
}

const path = "apps/admin/src/App.tsx";
let source = await readFile(path, "utf8");

source = replaceExact(
  source,
  `import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";`,
  `import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";`,
  "React import",
);

source = replaceExact(
  source,
  `import { AdminShell } from "./AdminShell";\nimport { AdminBrandLogo } from "./admin-brand-logo";\nimport { AdminResourceConsole } from "./admin-resource-console";\nimport { AdminCompanyWorkspace } from "./admin-company-workspace";\nimport { AdminSystemWorkspace } from "./admin-system-workspace";\nimport { AdminAccessWorkspace } from "./admin-access-workspace";\nimport { AdminAiWorkspace } from "./admin-ai-workspace";\nimport { AdminContentWorkspace } from "./admin-content-workspace";\nimport { AdminFleetWorkspace } from "./admin-fleet-workspace";\nimport { AdminOperationsWorkspace } from "./admin-operations-workspace";\nimport { AdminDriverParticipationWorkspace } from "./admin-driver-participation-workspace";\nimport { AdminDeliveryPricingWorkspace, AdminDriverPricingWorkspace } from "./admin-delivery-pricing-workspace";\nimport { AdminPartnerLocationReviewWorkspace } from "./admin-partner-location-review-workspace";\nimport { AdminPolicyWorkspace } from "./admin-policy-workspace";\nimport { AdminQualityWorkspace } from "./admin-quality-workspace";\nimport { AdminRevenueWorkspace } from "./admin-revenue-workspace";\nimport { AdminServiceCoverageWorkspace } from "./admin-service-coverage-workspace";\nimport { AdminStartupBrandingWorkspace } from "./admin-startup-branding-workspace";\nimport { AdminStationPricingWorkspace } from "./admin-station-pricing-workspace";\nimport { AdminStationInventoryWorkspace } from "./admin-station-inventory-workspace";\nimport { AdminSupportWorkspace } from "./admin-support-workspace";\nimport { AdminUtilityBillingWorkspace } from "./admin-utility-billing-workspace";\nimport { AdminVerificationWorkspace } from "./admin-verification-workspace";\nimport {\n  catalogConsoleConfig,\n  financeConsoleConfig,\n  governanceConsoleConfig,\n  integrationConsoleConfig,\n} from "./admin-resource-config";\nimport { useSessionState } from "./session";`,
  `import { AdminShell } from "./AdminShell";\nimport { AdminLoginView } from "./admin-login-view";\nimport { foundationNavigation } from "./admin-navigation-config";\nimport { AdminWorkspaceRouter } from "./admin-workspace-router";\nimport { useSessionState } from "./session";`,
  "admin workspace import block",
);

source = removeBetween(
  source,
  `const foundationNavigation: readonly NavigationItem[] = [`,
  `export function App() {`,
  "navigation configuration block",
);
source = `// SKIMA Admin composition root. Navigation, authentication, and workspace routing\n// live in dedicated modules; domain workspaces retain their existing API contracts.\n` + source;

source = replaceExact(source, `return <LoginView />;`, `return <AdminLoginView />;`, "login render");
source = replaceExact(
  source,
  `<Workspace route={workspaceRoute} onNavigate={navigate} />`,
  `<AdminWorkspaceRouter\n          route={workspaceRoute}\n          onNavigate={navigate}\n          applicationsWorkspace={<ApplicationsWorkspace />}\n          overviewWorkspace={<OverviewWorkspace onNavigate={navigate} />}\n        />`,
  "workspace router render",
);

source = removeBetween(source, `function LoginView() {`, `function Workspace(`, "legacy login view");
source = removeBetween(source, `function Workspace(`, `function OverviewWorkspace(`, "legacy workspace router");

await writeFile(path, source);
console.log("Phase 3 admin shell/router modularization applied.");
