import type { NavigationItem } from "@skima/frontend-core";

// Single source of truth for the SKIMA admin shell navigation. Workspace rendering
// remains in admin-workspace-router.tsx so composition concerns stay out of App.tsx.
export const foundationNavigation: readonly NavigationItem[] = [
  { key: "overview", label: "Overview", href: "/", icon: "overview" },
  { key: "company", label: "Companies", href: "/company", icon: "company", requiredPermissions: ["platform.organizations.read"] },
  { key: "access", label: "People & Access", href: "/access", icon: "access", requiredPermissions: ["platform.admins.read"] },
  { key: "applications", label: "Applications", href: "/applications", icon: "applications", requiredPermissions: ["platform.applications.read"] },
  { key: "verification", label: "Verification", href: "/verification", icon: "verification", requiredPermissions: ["platform.verification.read"] },
  { key: "fleet", label: "Fleet & Vehicles", href: "/fleet", icon: "fleet", requiredPermissions: ["platform.fleets.read"] },
  { key: "stations", label: "Stations", href: "/stations", icon: "stations", requiredPermissions: ["platform.partner_price.manage"] },
  { key: "inventory", label: "Station Inventory", href: "/station-inventory", icon: "inventory", requiredPermissions: ["platform.inventory.manage"] },
  { key: "support", label: "Support Inbox", href: "/support", icon: "support", requiredPermissions: ["platform.support.read"] },
  { key: "billing", label: "Utility Billing", href: "/utility-billing", icon: "billing", requiredPermissions: ["platform.billing.read"] },
  { key: "operations", label: "Operations", href: "/operations", icon: "operations", requiredPermissions: ["lpg.orders.manage"] },
  { key: "coverage", label: "Service Coverage", href: "/coverage", icon: "coverage", requiredPermissions: ["platform.coverage.read"] },
  { key: "location-review", label: "Location Review", href: "/location-review", icon: "locationReview", requiredPermissions: ["platform.applications.review"] },
  { key: "drivers", label: "Driver Participation", href: "/drivers", icon: "drivers", requiredPermissions: ["platform.drivers.read"] },
  { key: "quality", label: "Service Quality", href: "/quality", icon: "quality", requiredPermissions: ["lpg.quality.read"] },
  { key: "finance", label: "Wallets & Settlements", href: "/finance", icon: "finance", requiredPermissions: ["platform.financial.read"] },
  { key: "delivery-pricing", label: "Delivery Pricing", href: "/delivery-pricing", icon: "deliveryPricing", requiredPermissions: ["platform.financial_policy.read"] },
  { key: "driver-pricing", label: "Driver Pricing", href: "/driver-pricing", icon: "driverPricing", requiredPermissions: ["platform.financial_policy.read"] },
  { key: "revenue", label: "Money & Revenue", href: "/revenue", icon: "revenue", requiredPermissions: ["platform.revenue.read"] },
  { key: "ai", label: "SKIMA Intelligence", href: "/ai", icon: "ai", requiredPermissions: ["platform.ai.read"] },
  { key: "content", label: "Brand & Content", href: "/content", icon: "content", requiredPermissions: ["platform.content.read"] },
  { key: "policies", label: "Terms & Policies", href: "/policies", icon: "policies", requiredPermissions: ["platform.policy.read"] },
  { key: "branding", label: "App Branding", href: "/branding", icon: "branding", requiredPermissions: ["platform.configuration.read"] },
  { key: "catalog", label: "Services", href: "/catalog", icon: "catalog", requiredPermissions: ["platform.configuration.read"] },
  { key: "governance", label: "Configuration", href: "/governance", icon: "governance", requiredPermissions: ["platform.configuration.read"] },
  { key: "providers", label: "Integrations", href: "/providers", icon: "providers", requiredPermissions: ["platform.providers.manage"] },
  { key: "system", label: "System Health & History", href: "/system", icon: "system", requiredPermissions: ["platform.health.read"] },
];

export interface AdminNavigationPermissionRule {
  readonly requiredPermissions?: readonly string[];
  readonly anyOfPermissions?: readonly string[];
}

const navigationAnyOfPermissions: Readonly<Record<string, readonly string[]>> = {
  verification: [
    "platform.verification.read",
    "platform.verification.manage",
    "platform.applications.review",
  ],
  operations: [
    "lpg.orders.manage",
    "lpg.dispatch.execute",
    "lpg.cylinders.manage",
    "lpg.safety.manage",
    "lpg.config.manage",
  ],
  coverage: [
    "platform.coverage.read",
    "platform.coverage.manage",
    "lpg.config.manage",
  ],
  drivers: [
    "platform.drivers.read",
    "platform.drivers.manage",
    "platform.drivers.verify",
  ],
  quality: [
    "lpg.quality.read",
    "lpg.quality.manage",
    "lpg.operations.manage",
  ],
  "delivery-pricing": [
    "platform.financial_policy.read",
    "platform.financial_policy.draft",
    "platform.financial_policy.approve",
    "platform.financial_policy.activate",
  ],
  "driver-pricing": [
    "platform.financial_policy.read",
    "platform.financial_policy.draft",
    "platform.financial_policy.approve",
    "platform.financial_policy.activate",
  ],
};

export function getAdminNavigationPermissionRule(key: string): AdminNavigationPermissionRule {
  const anyOfPermissions = navigationAnyOfPermissions[key];
  if (anyOfPermissions) return { anyOfPermissions };

  const item = foundationNavigation.find((candidate) => candidate.key === key);
  return { requiredPermissions: item?.requiredPermissions };
}

export function canAccessAdminNavigationKey(
  key: string,
  can: (permission: string) => boolean,
): boolean {
  const rule = getAdminNavigationPermissionRule(key);
  const hasAllRequired = (rule.requiredPermissions ?? []).every((permission) => can(permission));
  const anyOf = rule.anyOfPermissions ?? [];
  const hasAnyRequired = anyOf.length === 0 || anyOf.some((permission) => can(permission));
  return hasAllRequired && hasAnyRequired;
}
