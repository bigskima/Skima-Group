import type { BusinessModuleVisualIdentity, MobileTone } from "@skima/mobile-design";

export type PhaseOneRole = "customer" | "driver" | "partner" | "admin";
export type PhaseOneTabKey = "home" | "services" | "orders" | "wallet" | "messages" | "account";
export type PhaseOneActionKind =
  | "request"
  | "lpgCylinder"
  | "location"
  | "application"
  | "deposit"
  | "otp"
  | "tracking"
  | "verification";

export interface PhaseOneNavigationItem {
  readonly key: PhaseOneTabKey;
  readonly label: string;
}

export interface PhaseOneQuickAction {
  readonly label: string;
  readonly action?: PhaseOneActionKind;
  readonly tab?: PhaseOneTabKey;
}

export interface PhaseOneRoleExperience {
  readonly eyebrow: string;
  readonly title: string;
  readonly subtitle: string;
  readonly nav: readonly PhaseOneNavigationItem[];
  readonly quickActions: readonly PhaseOneQuickAction[];
  readonly primaryTimeline: readonly string[];
}

export interface PhaseOneProductOption {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly tone: MobileTone;
}

export const phaseOneLpgExperience = {
  moduleKeys: ["lpg", "lpg-refill", "cooking-gas", "gas-refill"],
  identity: {
    moduleKey: "lpg",
    label: "LPG Refill",
    shortLabel: "LPG",
    category: "Energy",
    tone: "danger",
    fallbackInitials: "LG",
    fallbackIcon: "materials",
  } satisfies BusinessModuleVisualIdentity,
  customerJourney: [
    "Order received",
    "Payment reserved",
    "Driver assigned",
    "Cylinder pickup",
    "Station refill",
    "Returning to you",
    "Delivery verified",
  ],
  productOptions: [
    {
      key: "refill",
      label: "Cylinder Refill",
      description: "Pickup, refill, escrow, tracking, and verified delivery.",
      tone: "danger",
    },
    {
      key: "exchange",
      label: "Cylinder Exchange",
      description: "Use an approved exchange flow where a station supports it.",
      tone: "warning",
    },
    {
      key: "safety-check",
      label: "Safety Check",
      description: "Record cylinder checks through the Verification Engine.",
      tone: "info",
    },
  ] satisfies readonly PhaseOneProductOption[],
  roles: {
    customer: {
      eyebrow: "LPG delivery",
      title: "Refill your cylinder without the runaround.",
      subtitle: "Order, pay into escrow, track pickup, and verify delivery from one place.",
      nav: [
        { key: "home", label: "Home" },
        { key: "services", label: "Cylinders" },
        { key: "orders", label: "Orders" },
        { key: "wallet", label: "Wallet" },
        { key: "account", label: "Account" },
      ],
      quickActions: [
        { label: "Refill Cylinder", action: "request" },
        { label: "Register", action: "lpgCylinder" },
        { label: "Address", action: "location" },
        { label: "Wallet", tab: "wallet" },
      ],
      primaryTimeline: [
        "Cylinder selected",
        "Payment reserved",
        "Driver assigned",
        "Cylinder picked up",
        "Refill confirmed",
        "Delivery verified",
      ],
    },
    driver: {
      eyebrow: "Driver workspace",
      title: "Complete LPG jobs with less friction.",
      subtitle: "Accept jobs, scan cylinders, follow route steps, and receive commission.",
      nav: [
        { key: "home", label: "Jobs" },
        { key: "services", label: "Active" },
        { key: "orders", label: "Verify" },
        { key: "wallet", label: "Earnings" },
        { key: "account", label: "Account" },
      ],
      quickActions: [
        { label: "Available jobs", tab: "home" },
        { label: "Navigate", action: "tracking" },
        { label: "Scan", action: "verification" },
        { label: "Earnings", tab: "wallet" },
      ],
      primaryTimeline: [
        "Accept job",
        "Pickup scan",
        "Station scan",
        "Return route",
        "Delivery OTP",
      ],
    },
    partner: {
      eyebrow: "Station operations",
      title: "Run refill work from the counter.",
      subtitle:
        "Receive jobs, scan cylinders, enter kilograms, confirm refill, and track settlement.",
      nav: [
        { key: "home", label: "Station" },
        { key: "services", label: "Refills" },
        { key: "orders", label: "Scan" },
        { key: "wallet", label: "Settlement" },
        { key: "account", label: "Staff" },
      ],
      quickActions: [
        { label: "Incoming", tab: "home" },
        { label: "Scan", action: "verification" },
        { label: "Products", tab: "services" },
        { label: "Settlement", tab: "wallet" },
      ],
      primaryTimeline: [
        "Job received",
        "Cylinder scanned",
        "Kilograms entered",
        "Refill confirmed",
        "Settlement released",
      ],
    },
    admin: {
      eyebrow: "Skima control",
      title: "Keep LPG operations moving safely.",
      subtitle: "Monitor stations, drivers, orders, wallets, disputes, applications, and fraud.",
      nav: [
        { key: "home", label: "Overview" },
        { key: "services", label: "Orders" },
        { key: "orders", label: "Drivers" },
        { key: "wallet", label: "Finance" },
        { key: "account", label: "Admin" },
      ],
      quickActions: [
        { label: "Orders", tab: "services" },
        { label: "Drivers", tab: "orders" },
        { label: "Finance", tab: "wallet" },
        { label: "Reviews", action: "application" },
      ],
      primaryTimeline: [
        "Order funded",
        "Station matched",
        "Driver matched",
        "Refill settled",
        "Commission paid",
      ],
    },
  } satisfies Record<PhaseOneRole, PhaseOneRoleExperience>,
} as const;

export function resolvePhaseOneRoleExperience(role: PhaseOneRole): PhaseOneRoleExperience {
  return phaseOneLpgExperience.roles[role];
}

export function resolvePhaseOneIdentity(
  identities: readonly BusinessModuleVisualIdentity[],
): BusinessModuleVisualIdentity {
  return identities.find((identity) =>
    (phaseOneLpgExperience.moduleKeys as readonly string[]).includes(
      identity.moduleKey.toLowerCase(),
    )
  ) ?? phaseOneLpgExperience.identity;
}
