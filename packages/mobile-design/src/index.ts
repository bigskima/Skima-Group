export type MobileAudience = "customer" | "driver" | "partner" | "admin" | "platform";
export type MobileTone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";
export type MobileInterfaceTheme = "system" | "light" | "dark";
export type MobileAssetRole =
  | "business_logo"
  | "business_cover"
  | "catalog_image"
  | "vehicle_image"
  | "driver_avatar"
  | "document_preview"
  | "qr_payload"
  | "map_preview";

export interface MobileColorTokens {
  readonly page: string;
  readonly surface: string;
  readonly surfaceRaised: string;
  readonly text: string;
  readonly muted: string;
  readonly border: string;
  readonly primary: string;
  readonly accent: string;
  readonly success: string;
  readonly warning: string;
  readonly danger: string;
  readonly info: string;
}

export interface MobileInteractionTokens {
  readonly touchTargetMin: number;
  readonly bottomNavigationHeight: number;
  readonly sheetHandleWidth: number;
  readonly sheetHandleHeight: number;
  readonly cardRadius: number;
  readonly controlRadius: number;
  readonly compactGap: number;
  readonly comfortableGap: number;
}

export interface MobilePreferenceOption<TValue extends string = string> {
  readonly value: TValue;
  readonly label: string;
  readonly description: string;
}

export interface MobileSurfaceDefinition {
  readonly key: string;
  readonly label: string;
  readonly audience: MobileAudience;
  readonly description: string;
  readonly requiredPermissions?: readonly string[];
  readonly requiredModules?: readonly string[];
  readonly priority: number;
}

export interface MobileNavigationItem {
  readonly key: string;
  readonly label: string;
  readonly surfaceKey: string;
  readonly audience: MobileAudience;
  readonly requiredPermissions?: readonly string[];
  readonly requiredModules?: readonly string[];
}

export interface MobileOnboardingStep {
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly audience: MobileAudience;
  readonly surfaceKey: string;
  readonly requiredPermissions?: readonly string[];
}

export interface MobileAssetRequirement {
  readonly role: MobileAssetRole;
  readonly label: string;
  readonly aspectRatio: string;
  readonly minWidth: number;
  readonly minHeight: number;
  readonly requiredFor: readonly MobileAudience[];
  readonly description: string;
}

export interface BusinessModuleVisualIdentity {
  readonly moduleKey: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly category: string;
  readonly tone: MobileTone;
  readonly logoUrl?: string | null;
  readonly coverImageUrl?: string | null;
  readonly fallbackInitials: string;
  readonly fallbackIcon:
    | "building"
    | "meal"
    | "medical"
    | "basket"
    | "parcel"
    | "vehicle"
    | "laundry"
    | "water"
    | "materials";
}

export interface MobilePermissionContext {
  readonly permissions: readonly string[];
  readonly enabledModules?: readonly string[];
}

export const mobileColorTokens: MobileColorTokens = {
  page: "#F4F6F8",
  surface: "#FFFFFF",
  surfaceRaised: "#FBFCFE",
  text: "#17202E",
  muted: "#667386",
  border: "#D8E0EA",
  primary: "#0F8F7D",
  accent: "#5750D8",
  success: "#167347",
  warning: "#A85A05",
  danger: "#B4232A",
  info: "#2367D1",
};

export const mobileInteractionTokens: MobileInteractionTokens = {
  touchTargetMin: 44,
  bottomNavigationHeight: 72,
  sheetHandleWidth: 44,
  sheetHandleHeight: 5,
  cardRadius: 8,
  controlRadius: 8,
  compactGap: 8,
  comfortableGap: 16,
};

export const mobileInterfaceThemeOptions: readonly MobilePreferenceOption<MobileInterfaceTheme>[] =
  [
    {
      value: "system",
      label: "System",
      description: "Follow the device appearance preference.",
    },
    {
      value: "light",
      label: "Light",
      description: "Use the bright Skima interface.",
    },
    {
      value: "dark",
      label: "Dark",
      description: "Use the dark Skima interface.",
    },
  ] as const;

export const mobileCurrencyPreferencePolicy = {
  source: "currency_definitions",
  enabledStatus: "active",
  clientFallbackCode: "NGN",
} as const;

export const mobileFoundationSurfaces: readonly MobileSurfaceDefinition[] = [
  {
    key: "home",
    label: "Home",
    audience: "customer",
    description: "Role-aware work summary with active requests, wallet state, and alerts.",
    priority: 10,
  },
  {
    key: "tasks",
    label: "Tasks",
    audience: "driver",
    description:
      "Qualified assignments, availability, vehicle status, route state, verification, and earnings.",
    requiredPermissions: ["platform.driver.read"],
    priority: 20,
  },
  {
    key: "fleet",
    label: "Fleet",
    audience: "driver",
    description:
      "Driver profile, vehicles, documents, capabilities, zones, and dispatch eligibility.",
    requiredPermissions: ["platform.driver.read"],
    priority: 25,
  },
  {
    key: "business",
    label: "Business",
    audience: "partner",
    description: "Orders, catalog, availability, staff, branches, and settlement visibility.",
    requiredPermissions: ["platform.organizations.read"],
    priority: 30,
  },
  {
    key: "catalog",
    label: "Catalog",
    audience: "partner",
    description:
      "Products, services, images, prices, stock, capacity, availability, and branch policies.",
    requiredPermissions: ["platform.catalog.manage"],
    priority: 35,
  },
  {
    key: "wallet",
    label: "Wallet",
    audience: "customer",
    description: "Balances, deposits, withdrawals, escrow, refunds, and transaction history.",
    requiredPermissions: ["platform.financial.read"],
    priority: 40,
  },
  {
    key: "verify",
    label: "Verify",
    audience: "customer",
    description: "QR scanning and OTP flows backed by the reusable Verification Engine.",
    requiredPermissions: ["platform.verification.read"],
    priority: 50,
  },
  {
    key: "updates",
    label: "Updates",
    audience: "customer",
    description: "In-app notifications, support entry points, and AI-assisted summaries.",
    priority: 60,
  },
] as const;

export const mobileNavigationItems: readonly MobileNavigationItem[] = [
  { key: "home", label: "Home", surfaceKey: "home", audience: "customer" },
  {
    key: "tasks",
    label: "Tasks",
    surfaceKey: "tasks",
    audience: "driver",
    requiredPermissions: ["platform.driver.read"],
  },
  {
    key: "fleet",
    label: "Fleet",
    surfaceKey: "fleet",
    audience: "driver",
    requiredPermissions: ["platform.driver.read"],
  },
  {
    key: "business",
    label: "Business",
    surfaceKey: "business",
    audience: "partner",
    requiredPermissions: ["platform.organizations.read"],
  },
  {
    key: "catalog",
    label: "Catalog",
    surfaceKey: "catalog",
    audience: "partner",
    requiredPermissions: ["platform.catalog.manage"],
  },
  {
    key: "wallet",
    label: "Wallet",
    surfaceKey: "wallet",
    audience: "customer",
    requiredPermissions: ["platform.financial.read"],
  },
  {
    key: "verify",
    label: "Verify",
    surfaceKey: "verify",
    audience: "customer",
    requiredPermissions: ["platform.verification.read"],
  },
  { key: "updates", label: "Updates", surfaceKey: "updates", audience: "customer" },
] as const;

export const mobileAssetRequirements: readonly MobileAssetRequirement[] = [
  {
    role: "business_logo",
    label: "Business Logo",
    aspectRatio: "1:1",
    minWidth: 512,
    minHeight: 512,
    requiredFor: ["partner"],
    description: "Primary identity mark for partner cards, receipts, order views, and catalog.",
  },
  {
    role: "business_cover",
    label: "Business Cover",
    aspectRatio: "16:9",
    minWidth: 1280,
    minHeight: 720,
    requiredFor: ["partner"],
    description: "Cover media for partner profile headers, service discovery, and module cards.",
  },
  {
    role: "catalog_image",
    label: "Catalog Image",
    aspectRatio: "4:3",
    minWidth: 900,
    minHeight: 675,
    requiredFor: ["partner", "customer"],
    description: "Product or service media controlled by the reusable catalog and media engines.",
  },
  {
    role: "vehicle_image",
    label: "Vehicle Image",
    aspectRatio: "4:3",
    minWidth: 900,
    minHeight: 675,
    requiredFor: ["driver"],
    description: "Vehicle verification and fleet display media reviewed through the document flow.",
  },
  {
    role: "driver_avatar",
    label: "Driver Avatar",
    aspectRatio: "1:1",
    minWidth: 512,
    minHeight: 512,
    requiredFor: ["driver"],
    description: "Driver profile image for assignment, support, verification, and trust surfaces.",
  },
  {
    role: "document_preview",
    label: "Document Preview",
    aspectRatio: "4:3",
    minWidth: 1200,
    minHeight: 900,
    requiredFor: ["driver", "partner"],
    description: "Secure document preview for identity, vehicle, ownership, and compliance review.",
  },
  {
    role: "qr_payload",
    label: "Verification QR",
    aspectRatio: "1:1",
    minWidth: 512,
    minHeight: 512,
    requiredFor: ["customer", "driver", "partner"],
    description: "QR payload rendered by the frontend and verified by the Verification Engine.",
  },
  {
    role: "map_preview",
    label: "Map Preview",
    aspectRatio: "16:9",
    minWidth: 1280,
    minHeight: 720,
    requiredFor: ["customer", "driver", "partner"],
    description: "Normalized map preview from the backend location service and map adapter.",
  },
] as const;

export const businessModuleVisualIdentities: readonly BusinessModuleVisualIdentity[] = [] as const;

export const mobileOnboardingSteps: readonly MobileOnboardingStep[] = [
  {
    key: "account",
    title: "Secure Account",
    description: "Sign in, restore session, and confirm the active role context.",
    audience: "customer",
    surfaceKey: "home",
  },
  {
    key: "wallet",
    title: "Wallet Ready",
    description: "Review wallet status, deposits, withdrawals, escrow, and refunds.",
    audience: "customer",
    surfaceKey: "wallet",
    requiredPermissions: ["platform.financial.read"],
  },
  {
    key: "verification",
    title: "Verification",
    description: "Use QR and OTP flows only through backend-approved verification events.",
    audience: "customer",
    surfaceKey: "verify",
    requiredPermissions: ["platform.verification.read"],
  },
  {
    key: "availability",
    title: "Availability",
    description: "Drivers and partners manage availability through policy-backed controls.",
    audience: "driver",
    surfaceKey: "tasks",
    requiredPermissions: ["platform.driver.read"],
  },
  {
    key: "business",
    title: "Business Operations",
    description: "Approved partners manage orders, catalog, staff, branches, and settlements.",
    audience: "partner",
    surfaceKey: "business",
    requiredPermissions: ["platform.organizations.read"],
  },
] as const;

export function getBusinessModuleVisualIdentity(
  moduleKey: string,
): BusinessModuleVisualIdentity | null {
  return businessModuleVisualIdentities.find((module) => module.moduleKey === moduleKey) ?? null;
}

export function filterMobileNavigation(
  items: readonly MobileNavigationItem[],
  context: MobilePermissionContext,
): MobileNavigationItem[] {
  return items.filter((item) =>
    hasAll(context.permissions, item.requiredPermissions) &&
    hasAll(context.enabledModules ?? [], item.requiredModules)
  );
}

export function validateMobileSurface(surface: MobileSurfaceDefinition): void {
  if (!surface.key.trim()) {
    throw new Error("Mobile surface key is required.");
  }

  if (!surface.label.trim()) {
    throw new Error("Mobile surface label is required.");
  }

  if (surface.priority <= 0) {
    throw new Error("Mobile surface priority must be positive.");
  }
}

export function validateBusinessModuleVisualIdentity(
  identity: BusinessModuleVisualIdentity,
): void {
  if (!identity.moduleKey.trim()) {
    throw new Error("Business module key is required.");
  }

  if (!identity.label.trim() || !identity.shortLabel.trim()) {
    throw new Error("Business module labels are required.");
  }

  if (!/^[A-Z0-9]{2,4}$/.test(identity.fallbackInitials)) {
    throw new Error("Business module fallback initials must be 2 to 4 uppercase characters.");
  }
}

function hasAll(granted: readonly string[], required: readonly string[] | undefined): boolean {
  if (!required || required.length === 0) {
    return true;
  }

  const grantedSet = new Set(granted);

  return required.every((value) => grantedSet.has(value));
}
