import type { NavigationItem } from "@skima/frontend-core";

export type AdminWorkspaceKey =
  | "dashboard"
  | "partners"
  | "operations"
  | "money"
  | "services"
  | "refill"
  | "bills"
  | "store"
  | "logistics"
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
  "money-analytics": "/money/analytics",
  "delivery-pricing": "/money/pricing/delivery",
  "driver-pricing": "/money/pricing/drivers",
  "logistics-fees": "/money/pricing/logistics",
  billing: "/services/utility-billing",
  refill: "/refill",
  bills: "/bills",
  catalog: "/services/catalog",
  store: "/store",
  logistics: "/logistics",
  fuel: "/services/fuel",
  ai: "/intelligence/ask",
  content: "/experience/content",
  policies: "/experience/policies",
  branding: "/experience/branding",
  "app-links": "/experience/app-links",
  referrals: "/experience/referrals",
  "social-links": "/experience/social-links",
  access: "/platform/people-access",
  governance: "/platform/configuration",
  providers: "/platform/integrations",
  system: "/platform/system",
  guide: "/platform/guide",
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
    screenKeys: ["revenue", "finance", "delivery-pricing", "driver-pricing", "logistics-fees"],
  },
  {
    key: "services",
    label: "Services",
    description: "Shared service catalogue and service availability controls across SKIMA products.",
    basePath: "/services",
    icon: "services",
    screenKeys: ["catalog"],
  },
  {
    key: "refill",
    label: "Refill",
    description: "Manage SKIMA LPG refill operations, stations, stock, service coverage and supported fuel products from one dedicated workspace.",
    basePath: "/refill",
    icon: "refill",
    screenKeys: ["refill"],
  },
  {
    key: "bills",
    label: "Bills",
    description: "Manage bill-payment providers, product catalogue, routing, pricing, campaigns and transaction operations.",
    basePath: "/bills",
    icon: "bills",
    screenKeys: ["bills"],
  },
  {
    key: "store",
    label: "Store",
    description: "SKIMA direct commerce: products, offers, stock and customer orders.",
    basePath: "/store",
    icon: "store",
    screenKeys: ["store"],
  },
  {
    key: "logistics",
    label: "Logistics",
    description: "Run the nationwide logistics marketplace: providers, jobs, bookings, incidents and customer disputes.",
    basePath: "/logistics",
    icon: "logistics",
    screenKeys: ["logistics"],
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
    screenKeys: ["content", "policies", "branding", "app-links", "referrals", "social-links"],
  },
  {
    key: "platform",
    label: "Platform",
    description: "Admin access, configuration, integrations and system health.",
    basePath: "/platform",
    icon: "platform",
    screenKeys: ["access", "governance", "providers", "system", "guide"],
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
  "/admin-guide": "/platform/guide",
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
  "/money/analytics": "Financial analytics",
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
  "/partners/stations/managed-fulfillment": "Station Managed Fulfillment",
  "/partners/verification": "Verification",
  "/partners/location-review": "Location review",
  "/partners/fleet": "Fleet & vehicles",
};

const operationsScreenLabels: Readonly<Record<string, string>> = {
  "/operations": "Operations overview",
  "/operations/orders": "Orders & dispatch",
  "/operations/coverage": "Service coverage",
  "/operations/inventory": "Station stock",
  "/operations/quality": "Service quality",
  "/operations/support": "Support",
};

const servicesScreenLabels: Readonly<Record<string, string>> = {
  "/services": "Services overview",
  "/services/utility-billing": "Utility billing",
  "/services/catalog": "Service catalog",
  "/services/fuel": "Fuel administration",
  "/services/availability": "Service availability",
};

const refillScreenLabels: Readonly<Record<string, string>> = {
  "/refill": "Refill overview",
  "/refill/orders": "Orders & dispatch",
  "/refill/stations": "Stations & refill partners",
  "/refill/drivers": "Drivers & fleet readiness",
  "/refill/inventory": "Station inventory",
  "/refill/coverage": "Service coverage",
  "/refill/fuel": "Fuel products",
  "/refill/fulfillment": "SKIMA fulfillment",
};

const billsScreenLabels: Readonly<Record<string, string>> = {
  "/bills": "Bills overview",
  "/bills/providers": "Providers",
  "/bills/catalogue": "Bills catalogue",
  "/bills/routing": "Provider routing",
  "/bills/economics": "Pricing & economics",
  "/bills/campaigns": "Campaigns",
  "/bills/operations": "Payment operations",
  "/bills/live-test": "Live provider test",
  "/bills/advanced": "Advanced utility setup",
};

const storeScreenLabels: Readonly<Record<string, string>> = {
  "/store": "SKIMA Store",
};

const logisticsScreenLabels: Readonly<Record<string, string>> = {
  "/logistics": "Logistics overview",
  "/logistics/providers": "Provider companies",
  "/logistics/categories": "Service categories",
  "/logistics/bookings": "Bookings & dispatch",
  "/logistics/incidents": "Incidents & cargo recovery",
  "/logistics/disputes": "Customer disputes",
};

const intelligenceScreenLabels: Readonly<Record<string, string>> = {
  "/intelligence": "SKIMA Intelligence overview",
  "/intelligence/ask": "SKIMA Intelligence",
};

const experienceScreenLabels: Readonly<Record<string, string>> = {
  "/experience": "Experience overview",
  "/experience/content": "Brand & content",
  "/experience/policies": "Terms & policies",
  "/experience/branding": "App branding",
  "/experience/app-links": "App downloads & quick routes",
  "/experience/referrals": "Referrals & campaigns",
  "/experience/social-links": "Social media",
};

const platformScreenLabels: Readonly<Record<string, string>> = {
  "/platform": "Platform overview",
  "/platform/people-access": "People & access",
  "/platform/configuration": "Configuration",
  "/platform/integrations": "Integrations",
  "/platform/system": "System health",
  "/platform/guide": "Admin guide",
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

    const hasLanding = [
      "money",
      "partners",
      "operations",
      "services",
      "refill",
      "bills",
      "store",
      "logistics",
      "intelligence",
      "experience",
      "platform",
    ].includes(workspace.key);

    return [{
      key: workspace.key,
      label: workspace.label,
      href: hasLanding ? workspace.basePath : firstVisibleScreen.href,
      icon: workspace.icon,
    } satisfies NavigationItem];
  });
}

export function getAdminWorkspaceNavigation(
  workspaceKey: AdminWorkspaceKey,
  items: readonly NavigationItem[],
): readonly NavigationItem[] {
  if (workspaceKey === "logistics") return buildLogisticsWorkspaceNavigation(items);
  if (workspaceKey === "money") return buildMoneyWorkspaceNavigation(items);
  if (workspaceKey === "partners") return buildPartnersWorkspaceNavigation(items);
  if (workspaceKey === "operations") return buildOperationsWorkspaceNavigation(items);
  if (workspaceKey === "services") return buildServicesWorkspaceNavigation(items);
  if (workspaceKey === "refill") return buildRefillWorkspaceNavigation(items);
  if (workspaceKey === "bills") return buildBillsWorkspaceNavigation(items);
  if (workspaceKey === "intelligence") return buildIntelligenceWorkspaceNavigation(items);
  if (workspaceKey === "experience") return buildExperienceWorkspaceNavigation(items);
  if (workspaceKey === "platform") return buildPlatformWorkspaceNavigation(items);

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
  if (operationsScreenLabels[path]) return operationsScreenLabels[path];
  if (servicesScreenLabels[path]) return servicesScreenLabels[path];
  if (refillScreenLabels[path]) return refillScreenLabels[path];
  if (billsScreenLabels[path]) return billsScreenLabels[path];
  if (logisticsScreenLabels[path]) return logisticsScreenLabels[path];
  if (intelligenceScreenLabels[path]) return intelligenceScreenLabels[path];
  if (experienceScreenLabels[path]) return experienceScreenLabels[path];
  if (platformScreenLabels[path]) return platformScreenLabels[path];

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

  if (
    path === "/operations" ||
    path === "/services" ||
    path === "/refill" ||
    path === "/bills" ||
    path === "/intelligence" ||
    path === "/experience" ||
    path === "/platform"
  ) {
    return path;
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

function buildLogisticsWorkspaceNavigation(items: readonly NavigationItem[]): readonly NavigationItem[] {
  const root = items.find((item) => item.key === "logistics");
  if (!root) return [];
  return [
    { ...root, key: "logistics-overview", label: "Overview", href: "/logistics" },
    { ...root, key: "logistics-providers", label: "Providers", href: "/logistics/providers" },
    { ...root, key: "logistics-bookings", label: "Bookings & dispatch", href: "/logistics/bookings" },
    { ...root, key: "logistics-incidents", label: "Incidents & recovery", href: "/logistics/incidents" },
    { ...root, key: "logistics-disputes", label: "Customer disputes", href: "/logistics/disputes" },
    { ...root, key: "logistics-categories", label: "Service categories", href: "/logistics/categories" },
  ];
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
      { ...finance, key: "money-analytics", label: "Financial analytics", href: "/money/analytics" },
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

function buildOperationsWorkspaceNavigation(items: readonly NavigationItem[]): readonly NavigationItem[] {
  const orderedKeys = ["operations", "coverage", "inventory", "quality", "support"] as const;
  const visibleItems = orderedKeys
    .map((key) => items.find((item) => item.key === key))
    .filter((item): item is NavigationItem => Boolean(item));
  const first = visibleItems[0];

  if (!first) return [];

  return [
    {
      key: "operations-overview",
      label: "Overview",
      href: "/operations",
      icon: "overview",
      requiredPermissions: first.requiredPermissions,
    },
    ...visibleItems.map((item) => {
      if (item.key === "operations") return { ...item, label: "Orders & dispatch" };
      if (item.key === "coverage") return { ...item, label: "Service coverage" };
      if (item.key === "inventory") return { ...item, label: "Station stock" };
      if (item.key === "quality") return { ...item, label: "Service quality" };
      if (item.key === "support") return { ...item, label: "Support" };
      return item;
    }),
  ];
}


function buildRefillWorkspaceNavigation(items: readonly NavigationItem[]): readonly NavigationItem[] {
  const root = items.find((item) => item.key === "refill");
  if (!root) return [];
  const sections = [
    ["operations", "Orders & dispatch", "/refill/orders"],
    ["stations", "Stations & refill partners", "/refill/stations"],
    ["drivers", "Drivers & fleet readiness", "/refill/drivers"],
    ["inventory", "Station inventory", "/refill/inventory"],
    ["coverage", "Service coverage", "/refill/coverage"],
    ["fuel", "Fuel products", "/refill/fuel"],
    ["delivery-pricing", "SKIMA fulfillment", "/refill/fulfillment"],
  ] as const;
  return [
    { ...root, key: "refill-overview", label: "Overview", href: "/refill" },
    ...sections.flatMap(([sourceKey, label, href]) => {
      const source = items.find((item) => item.key === sourceKey);
      return source ? [{ ...source, key: "refill-" + sourceKey, label, href }] : [];
    }),
  ];
}

function buildBillsWorkspaceNavigation(items: readonly NavigationItem[]): readonly NavigationItem[] {
  const root = items.find((item) => item.key === "bills");
  const billing = items.find((item) => item.key === "billing");
  if (!root || !billing) return [];
  return [
    { ...root, key: "bills-overview", label: "Overview", href: "/bills" },
    { ...billing, key: "bills-providers", label: "Providers", href: "/bills/providers" },
    { ...billing, key: "bills-catalogue", label: "Catalogue", href: "/bills/catalogue" },
    { ...billing, key: "bills-routing", label: "Routing", href: "/bills/routing" },
    { ...billing, key: "bills-economics", label: "Economics", href: "/bills/economics" },
    { ...billing, key: "bills-campaigns", label: "Campaigns", href: "/bills/campaigns" },
    { ...billing, key: "bills-operations", label: "Operations", href: "/bills/operations" },
    { ...billing, key: "bills-live-test", label: "Live test", href: "/bills/live-test" },
  ];
}

function buildServicesWorkspaceNavigation(items: readonly NavigationItem[]): readonly NavigationItem[] {
  const catalog = items.find((item) => item.key === "catalog");
  const first = catalog;

  if (!first) return [];

  const navigation: NavigationItem[] = [
    {
      key: "services-overview",
      label: "Overview",
      href: "/services",
      icon: "overview",
      requiredPermissions: first.requiredPermissions,
    },
  ];

  if (catalog) {
    navigation.push(
      { ...catalog, label: "Service catalog", href: "/services/catalog" },
      {
        ...catalog,
        key: "service-availability",
        label: "Service availability",
        href: "/services/availability",
      },
    );
  }

  return navigation;
}

function buildIntelligenceWorkspaceNavigation(items: readonly NavigationItem[]): readonly NavigationItem[] {
  const intelligence = items.find((item) => item.key === "ai");

  if (!intelligence) return [];

  return [
    {
      key: "intelligence-overview",
      label: "Overview",
      href: "/intelligence",
      icon: "overview",
      requiredPermissions: intelligence.requiredPermissions,
    },
    {
      ...intelligence,
      label: "Intelligence workspace",
      href: "/intelligence/ask",
    },
  ];
}

function buildExperienceWorkspaceNavigation(items: readonly NavigationItem[]): readonly NavigationItem[] {
  const orderedKeys = ["content", "policies", "branding", "app-links", "referrals", "social-links"] as const;
  const visibleItems = orderedKeys
    .map((key) => items.find((item) => item.key === key))
    .filter((item): item is NavigationItem => Boolean(item));
  const first = visibleItems[0];

  if (!first) return [];

  return [
    {
      key: "experience-overview",
      label: "Overview",
      href: "/experience",
      icon: "overview",
      requiredPermissions: first.requiredPermissions,
    },
    ...visibleItems.map((item) => {
      if (item.key === "content") return { ...item, label: "Brand & content" };
      if (item.key === "policies") return { ...item, label: "Terms & policies" };
      if (item.key === "branding") return { ...item, label: "App branding" };
      return item;
    }),
  ];
}

function buildPlatformWorkspaceNavigation(items: readonly NavigationItem[]): readonly NavigationItem[] {
  const orderedKeys = ["access", "governance", "providers", "system", "guide"] as const;
  const visibleItems = orderedKeys
    .map((key) => items.find((item) => item.key === key))
    .filter((item): item is NavigationItem => Boolean(item));
  const first = visibleItems[0];

  if (!first) return [];

  return [
    {
      key: "platform-overview",
      label: "Overview",
      href: "/platform",
      icon: "overview",
      requiredPermissions: first.requiredPermissions,
    },
    ...visibleItems.map((item) => {
      if (item.key === "access") return { ...item, label: "People & access" };
      if (item.key === "governance") return { ...item, label: "Configuration" };
      if (item.key === "providers") return { ...item, label: "Integrations" };
      if (item.key === "system") return { ...item, label: "System health" };
      if (item.key === "guide") return { ...item, label: "Admin guide" };
      return item;
    }),
  ];
}
