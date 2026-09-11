import type { NavigationItem } from "@skima/frontend-core";

export type AdminWorkspaceKey =
  | "dashboard"
  | "partners"
  | "operations"
  | "money"
  | "services"
  | "intelligence"
  | "experience"
  | "platform";

export interface AdminWorkspaceDefinition {
  readonly key: AdminWorkspaceKey;
  readonly label: string;
  readonly description: string;
  readonly basePath: string;
  readonly icon: string;
  readonly screenKeys: readonly string[];
}

const screenRoutes: Readonly<Record<string, string>> = {
  overview: "/dashboard",
  company: "/partners/companies",
  applications: "/partners/applications",
  verification: "/partners/verification",
  fleet: "/partners/fleet",
  stations: "/partners/stations",
  "location-review": "/partners/location-review",
  drivers: "/partners/drivers",
  operations: "/operations/orders",
  coverage: "/operations/coverage",
  inventory: "/operations/inventory",
  quality: "/operations/quality",
  support: "/operations/support",
  revenue: "/money/revenue",
  finance: "/money/balances",
  "delivery-pricing": "/money/pricing/delivery",
  "driver-pricing": "/money/pricing/drivers",
  billing: "/services/utility-billing",
  catalog: "/services/catalog",
  ai: "/intelligence/ask",
  content: "/experience/content",
  policies: "/experience/policies",
  branding: "/experience/branding",
  access: "/platform/people-access",
  governance: "/platform/configuration",
  providers: "/platform/integrations",
  system: "/platform/system",
};

export const adminWorkspaceDefinitions: readonly AdminWorkspaceDefinition[] = [
  {
    key: "dashboard",
    label: "Home",
    description: "Platform overview, priorities and quick actions.",
    basePath: "/dashboard",
    icon: "dashboard",
    screenKeys: ["overview"],
  },
  {
    key: "partners",
    label: "People & Partners",
    description: "Applications, partner organisations, drivers, stations and verification.",
    basePath: "/partners",
    icon: "partners",
    screenKeys: ["applications", "company", "drivers", "stations", "verification", "location-review", "fleet"],
  },
  {
    key: "operations",
    label: "Operations",
    description: "Orders, coverage, station stock, service quality and support operations.",
    basePath: "/operations",
    icon: "operations",
    screenKeys: ["operations", "coverage", "inventory", "quality", "support"],
  },
  {
    key: "money",
    label: "Money",
    description: "Revenue, balances, withdrawals, settlements and pricing controls.",
    basePath: "/money",
    icon: "money",
    screenKeys: ["revenue", "finance", "delivery-pricing", "driver-pricing"],
  },
  {
    key: "services",
    label: "Services",
    description: "Utility billing, service catalogue and service availability.",
    basePath: "/services",
    icon: "services",
    screenKeys: ["billing", "catalog"],
  },
  {
    key: "intelligence",
    label: "SKIMA Intelligence",
    description: "Ask SKIMA, review attention signals and manage decision-support AI.",
    basePath: "/intelligence",
    icon: "intelligence",
    screenKeys: ["ai"],
  },
  {
    key: "experience",
    label: "Experience",
    description: "Brand, content, policies and customer-facing presentation.",
    basePath: "/experience",
    icon: "experience",
    screenKeys: ["content", "policies", "branding"],
  },
  {
    key: "platform",
    label: "Platform",
    description: "Admin access, configuration, integrations and system health.",
    basePath: "/platform",
    icon: "platform",
    screenKeys: ["access", "governance", "providers", "system"],
  },
] as const;

const legacyExactRoutes: Readonly<Record<string, string>> = {
  "/": "/dashboard",
  "/company": "/partners/companies",
  "/access": "/platform/people-access",
  "/applications": "/partners/applications",
  "/verification": "/partners/verification",
  "/fleet": "/partners/fleet",
  "/stations": "/partners/stations",
  "/station-inventory": "/operations/inventory",
  "/support": "/operations/support",
  "/utility-billing": "/services/utility-billing",
  "/operations": "/operations/orders",
  "/coverage": "/operations/coverage",
  "/location-review": "/partners/location-review",
  "/drivers": "/partners/drivers",
  "/quality": "/operations/quality",
  "/finance": "/money/balances",
  "/delivery-pricing": "/money/pricing/delivery",
  "/driver-pricing": "/money/pricing/drivers",
  "/revenue": "/money/revenue",
  "/ai": "/intelligence/ask",
  "/content": "/experience/content",
  "/policies": "/experience/policies",
  "/branding": "/experience/branding",
  "/catalog": "/services/catalog",
  "/governance": "/platform/configuration",
  "/providers": "/platform/integrations",
  "/system": "/platform/system",
  "/services": "/services/utility-billing",
  "/intelligence": "/intelligence/ask",
  "/experience": "/experience/content",
  "/platform": "/platform/people-access",
};

const v2ToLegacyExactRoutes = Object.fromEntries(
  Object.entries(legacyExactRoutes)
    .filter(([legacy]) => legacy !== "/services" && legacy !== "/intelligence" && legacy !== "/experience" && legacy !== "/platform")
    .map(([legacy, v2]) => [v2, legacy]),
) as Readonly<Record<string, string>>;

const moneyScreenLabels: Readonly<Record<string, string>> = {
  "/money": "Money overview",
  "/money/revenue": "Revenue",
  "/money/balances": "Balances & deposits",
  "/money/withdrawals": "Withdrawals",
  "/money/settlements": "Settlements & escrow",
  "/money/pricing": "Pricing",
  "/money/pricing/delivery": "Delivery pricing",
  "/money/pricing/drivers": "Driver pricing",
  "/money/controls": "Financial controls",
};

const partnerScreenLabels: Readonly<Record<string, string>> = {
  "/partners": "People & Partners overview",
  "/partners/applications": "Applications",
  "/partners/companies": "Companies",
  "/partners/drivers": "Drivers",
  "/partners/stations": "Stations",
  "/partners/verification": "Verification",
  "/partners/location-review": "Location review",
  "/partners/fleet": "Fleet & vehicles",
};

export function toAdminV2NavigationItem(item: NavigationItem): NavigationItem {
  return {
    ...item,
    href: screenRoutes[item.key] ?? item.href,
  };
}

export function buildAdminCategoryNavigation(items: readonly NavigationItem[]): readonly NavigationItem[] {
  return adminWorkspaceDefinitions.flatMap((workspace) => {
    const firstVisibleScreen = workspace.screenKeys
      .map((key) => items.find((item) => item.key === key))
      .find((item): item is NavigationItem => Boolean(item));

    if (!firstVisibleScreen) return [];

    return [{
      key: workspace.key,
      label: workspace.label,
      href: workspace.key === "money" || workspace.key === "partners"
        ? workspace.basePath
        : firstVisibleScreen.href,
      icon: workspace.icon,
    } satisfies NavigationItem];
  });
}

export function getAdminWorkspaceNavigation(
  workspaceKey: AdminWorkspaceKey,
  items: readonly NavigationItem[],
): readonly NavigationItem[] {
  if (workspaceKey === "money") return buildMoneyWorkspaceNavigation(items);
  if (workspaceKey === "partners") return buildPartnersWorkspaceNavigation(items);

  const workspace = adminWorkspaceDefinitions.find((candidate) => candidate.key === workspaceKey);
  if (!workspace) return [];

  return workspace.screenKeys
    .map((key) => items.find((item) => item.key === key))
    .filter((item): item is NavigationItem => Boolean(item));
}

export function getAdminWorkspaceForRoute(route: string): AdminWorkspaceDefinition {
  const path = resolveAdminPath(route);
  return adminWorkspaceDefinitions.find((workspace) =>
    path === workspace.basePath || path.startsWith(`${workspace.basePath}/`)
  ) ?? adminWorkspaceDefinitions[0];
}

export function getAdminScreenLabel(route: string, items: readonly NavigationItem[]): string {
  const path = resolveAdminPath(route);
  if (moneyScreenLabels[path]) return moneyScreenLabels[path];
  if (partnerScreenLabels[path]) return partnerScreenLabels[path];

  const exact = items.find((item) => item.href === path);
  if (exact) return exact.label;

  const nested = items
    .filter((item) => path.startsWith(`${item.href}/`))
    .sort((left, right) => right.href.length - left.href.length)[0];

  return nested?.label ?? getAdminWorkspaceForRoute(path).label;
}

export function resolveAdminPath(rawPath: string): string {
  const path = normalizePath(rawPath);

  if (path.startsWith("/stations/")) {
    return `/partners/stations/${path.slice("/stations/".length)}`;
  }

  return legacyExactRoutes[path] ?? path;
}

export function toLegacyAdminWorkspacePath(rawPath: string): string {
  const path = normalizePath(rawPath);

  if (path.startsWith("/partners/stations/")) {
    return `/stations/${path.slice("/partners/stations/".length)}`;
  }

  return v2ToLegacyExactRoutes[path] ?? path;
}

export function normalizePath(rawPath: string): string {
  const withoutQuery = rawPath.split(/[?#]/, 1)[0]?.trim() || "/";
  const withLeadingSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  const normalized = withLeadingSlash.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return normalized || "/";
}

function buildMoneyWorkspaceNavigation(items: readonly NavigationItem[]): readonly NavigationItem[] {
  const revenue = items.find((item) => item.key === "revenue");
  const finance = items.find((item) => item.key === "finance");
  const deliveryPricing = items.find((item) => item.key === "delivery-pricing");
  const driverPricing = items.find((item) => item.key === "driver-pricing");
  const first = revenue ?? finance ?? deliveryPricing ?? driverPricing;

  if (!first) return [];

  const navigation: NavigationItem[] = [
    {
      key: "money-overview",
      label: "Overview",
      href: "/money",
      icon: "overview",
      requiredPermissions: first.requiredPermissions,
    },
  ];

  if (revenue) {
    navigation.push({ ...revenue, label: "Revenue", href: "/money/revenue" });
  }

  if (finance) {
    navigation.push(
      { ...finance, key: "money-balances", label: "Balances & deposits", href: "/money/balances" },
      { ...finance, key: "money-withdrawals", label: "Withdrawals", href: "/money/withdrawals" },
      { ...finance, key: "money-settlements", label: "Settlements & escrow", href: "/money/settlements" },
    );
  }

  if (deliveryPricing || driverPricing) {
    const pricingPermissionSource = deliveryPricing ?? driverPricing!;
    navigation.push({
      ...pricingPermissionSource,
      key: "money-pricing",
      label: "Pricing",
      href: "/money/pricing",
    });
  }

  if (revenue || deliveryPricing || driverPricing) {
    const controlPermissionSource = revenue ?? deliveryPricing ?? driverPricing!;
    navigation.push({
      ...controlPermissionSource,
      key: "money-controls",
      label: "Financial controls",
      href: "/money/controls",
    });
  }

  return navigation;
}

function buildPartnersWorkspaceNavigation(items: readonly NavigationItem[]): readonly NavigationItem[] {
  const orderedKeys = ["applications", "company", "drivers", "stations", "verification", "location-review", "fleet"] as const;
  const visibleItems = orderedKeys
    .map((key) => items.find((item) => item.key === key))
    .filter((item): item is NavigationItem => Boolean(item));
  const first = visibleItems[0];

  if (!first) return [];

  return [
    {
      key: "partners-overview",
      label: "Overview",
      href: "/partners",
      icon: "overview",
      requiredPermissions: first.requiredPermissions,
    },
    ...visibleItems.map((item) => {
      if (item.key === "company") return { ...item, label: "Companies" };
      if (item.key === "drivers") return { ...item, label: "Drivers" };
      if (item.key === "stations") return { ...item, label: "Stations" };
      if (item.key === "location-review") return { ...item, label: "Location review" };
      if (item.key === "fleet") return { ...item, label: "Fleet & vehicles" };
      return item;
    }),
  ];
}
