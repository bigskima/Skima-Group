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
    screenKeys: ["applications", "verification", "location-review", "company", "drivers", "fleet", "stations"],
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
    description: "Revenue, balances, settlements and pricing controls.",
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
  "/partners": "/partners/applications",
  "/money": "/money/revenue",
  "/services": "/services/utility-billing",
  "/intelligence": "/intelligence/ask",
  "/experience": "/experience/content",
  "/platform": "/platform/people-access",
};

const v2ToLegacyExactRoutes = Object.fromEntries(
  Object.entries(legacyExactRoutes)
    .filter(([legacy]) => legacy !== "/partners" && legacy !== "/money" && legacy !== "/services" && legacy !== "/intelligence" && legacy !== "/experience" && legacy !== "/platform")
    .map(([legacy, v2]) => [v2, legacy]),
) as Readonly<Record<string, string>>;

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
      href: firstVisibleScreen.href,
      icon: workspace.icon,
    } satisfies NavigationItem];
  });
}

export function getAdminWorkspaceNavigation(
  workspaceKey: AdminWorkspaceKey,
  items: readonly NavigationItem[],
): readonly NavigationItem[] {
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
