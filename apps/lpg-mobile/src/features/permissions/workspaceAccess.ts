import type { SessionContext } from "@skima/frontend-core";

import type { WorkspaceAccessManifest } from "./api";

export type LpgWorkspace = "customer" | "driver" | "station";
export type LpgTab =
  | "home"
  | "cylinders"
  | "orders"
  | "wallet"
  | "account"
  | "jobs"
  | "scan"
  | "earnings"
  | "settlements"
  | "dashboard"
  | "operations"
  | "finance"
  | "users";
export type InterfaceTheme = "system" | "light" | "dark";
export type LpgAction =
  | "refill"
  | "create-order"
  | "reserve-payment"
  | "register-cylinder"
  | "save-address"
  | "top-up"
  | "withdraw"
  | "scan-cylinder"
  | "accept-job"
  | "confirm-refill"
  | "record-inspection"
  | "request-delivery-challenge"
  | "verify-delivery-challenge"
  | "settle-station"
  | "execute-driver-commission"
  | "refund-order"
  | "apply-driver"
  | "apply-station"
  | "report-issue"
  | "support";

export interface LpgNavItem {
  readonly key: LpgTab;
  readonly label: string;
  readonly center?: boolean;
}

export interface LpgWorkspaceConfig {
  readonly key: LpgWorkspace;
  readonly label: string;
  readonly badge: string;
  readonly title: string;
  readonly subtitle: string;
  readonly nav: readonly LpgNavItem[];
}

export interface CurrencyOption {
  readonly code: string;
  readonly displayName: string;
  readonly symbol: string | null;
  readonly decimalPlaces: number;
  readonly status: string;
  readonly lockedForProfile: boolean;
  readonly hiddenByUser: boolean;
}

export interface CurrencyRecord {
  readonly code?: unknown;
  readonly display_name?: unknown;
  readonly symbol?: unknown;
  readonly decimal_places?: unknown;
  readonly status?: unknown;
  readonly metadata?: unknown;
}

export interface CurrencyPreferenceState {
  readonly effectiveCurrencies: readonly CurrencyOption[];
  readonly globallyEnabledCurrencies: readonly CurrencyOption[];
  readonly restrictedCodes: readonly string[];
}

export const workspaceConfigs: Readonly<Record<LpgWorkspace, LpgWorkspaceConfig>> = {
  customer: {
    badge: "LPG",
    key: "customer",
    label: "Customer",
    nav: [
      { key: "home", label: "Home" },
      { key: "cylinders", label: "Cylinders" },
      { key: "orders", label: "Orders" },
      { key: "wallet", label: "Wallet" },
      { key: "account", label: "Account" },
    ],
    subtitle: "Refill, track, verify, and pay safely from one app.",
    title: "Your LPG refill app",
  },
  driver: {
    badge: "DRIVER",
    key: "driver",
    label: "Driver",
    nav: [
      { key: "home", label: "Home" },
      { key: "jobs", label: "Jobs" },
      { key: "scan", label: "Scan", center: true },
      { key: "earnings", label: "Earnings" },
      { key: "account", label: "Account" },
    ],
    subtitle: "Accept qualified jobs, scan cylinders, deliver safely, and get paid.",
    title: "Drive. Deliver. Earn.",
  },
  station: {
    badge: "STATION",
    key: "station",
    label: "Station",
    nav: [
      { key: "dashboard", label: "Dashboard" },
      { key: "jobs", label: "Jobs" },
      { key: "scan", label: "Scan", center: true },
      { key: "settlements", label: "Settlements" },
      { key: "account", label: "Account" },
    ],
    subtitle: "Receive refill jobs, scan cylinders, manage stock, and settle earnings.",
    title: "Station operations",
  },
};

export const customerOnboardingSteps = [
  "Create account",
  "Verify phone",
  "Set profile",
  "Add cylinder",
  "Order refill",
] as const;

export const driverOnboardingSteps = [
  "Profile",
  "Vehicle",
  "Documents",
  "Review",
  "Approved",
] as const;

export const stationOnboardingSteps = [
  "Register",
  "Details",
  "Documents",
  "Review",
  "Live",
] as const;

export function resolveAvailableWorkspaces(
  context: SessionContext,
  manifest?: WorkspaceAccessManifest | null,
): readonly LpgWorkspace[] {
  if (manifest) {
    const confirmed = manifest.workspaces
      .filter((workspace) => workspace.status === "active")
      .map((workspace) => workspace.key);
    return (["customer", "driver", "station"] as const).filter((workspace) =>
      workspace === "customer" || confirmed.includes(workspace)
    );
  }

  const permissions = new Set(context.permissions);
  for (const role of context.roles) {
    for (const permission of role.permissions) {
      permissions.add(permission);
    }
  }
  const hasActiveOrganization = context.organizations.some((organization) =>
    organization.status === "active"
  );
  const hasStationRole = context.roles.some((role) =>
    role.status === "active" && typeof role.key === "string" && role.key.startsWith("lpg.station.")
  );
  const workspaces: LpgWorkspace[] = ["customer"];

  const hasDriverAccess = permissions.has("platform.drivers.read") ||
    context.roles.some((role) =>
      role.status === "active" &&
      (role.key?.startsWith("driver.") === true || role.key?.startsWith("lpg.driver.") === true)
    );

  if (hasDriverAccess) {
    workspaces.push("driver");
  }

  if (
    hasStationRole ||
    (hasActiveOrganization && permissions.has("lpg.stations.read")) ||
    permissions.has("lpg.stations.read") ||
    permissions.has("business.orders.read")
  ) {
    workspaces.push("station");
  }

  return workspaces;
}

export function getInitialTab(workspace: LpgWorkspace): LpgTab {
  return workspaceConfigs[workspace].nav[0]?.key ?? "home";
}

export function isWorkspaceTab(workspace: LpgWorkspace, tab: LpgTab): boolean {
  return workspaceConfigs[workspace].nav.some((item) => item.key === tab);
}

export function resolveProfileName(context: SessionContext): string {
  return context.profile?.display_name ?? context.user.email?.split("@")[0] ?? "there";
}

export function resolveEffectiveCurrencies(input: {
  readonly currencyRecords: readonly CurrencyRecord[];
  readonly profileMetadata: Readonly<Record<string, unknown>>;
  readonly userHiddenCodes: readonly string[];
}): CurrencyPreferenceState {
  const globallyEnabledCurrencies = normalizeCurrencyRecords(input.currencyRecords);
  const userHiddenCodes = new Set(input.userHiddenCodes.map((code) => code.toUpperCase()));
  const restrictedCodes = new Set(readStringArray(input.profileMetadata, [
    "disabledCurrencyCodes",
    "disabled_currency_codes",
    "restrictedCurrencyCodes",
    "restricted_currency_codes",
  ]).map((code) => code.toUpperCase()));
  const explicitlyAllowedCodes = readStringArray(input.profileMetadata, [
    "enabledCurrencyCodes",
    "enabled_currency_codes",
    "allowedCurrencyCodes",
    "allowed_currency_codes",
  ]).map((code) => code.toUpperCase());
  const allowedSet = explicitlyAllowedCodes.length > 0 ? new Set(explicitlyAllowedCodes) : null;

  const effectiveCurrencies = globallyEnabledCurrencies
    .map((currency) => ({
      ...currency,
      hiddenByUser: userHiddenCodes.has(currency.code),
      lockedForProfile: restrictedCodes.has(currency.code) ||
        (allowedSet ? !allowedSet.has(currency.code) : false),
    }))
    .filter((currency) => !currency.lockedForProfile && !currency.hiddenByUser);

  return {
    effectiveCurrencies: effectiveCurrencies.length > 0
      ? effectiveCurrencies
      : globallyEnabledCurrencies.slice(0, 1),
    globallyEnabledCurrencies: globallyEnabledCurrencies.map((currency) => ({
      ...currency,
      hiddenByUser: userHiddenCodes.has(currency.code),
      lockedForProfile: restrictedCodes.has(currency.code) ||
        (allowedSet ? !allowedSet.has(currency.code) : false),
    })),
    restrictedCodes: Array.from(restrictedCodes),
  };
}

function normalizeCurrencyRecords(records: readonly CurrencyRecord[]): CurrencyOption[] {
  return records
    .filter((record) => readString(record.status, "active") === "active")
    .map((record) => ({
      code: readString(record.code, "").toUpperCase(),
      decimalPlaces: readNumber(record.decimal_places, 2),
      displayName: readString(record.display_name, readString(record.code, "")),
      hiddenByUser: false,
      lockedForProfile: false,
      status: "active",
      symbol: readNullableString(record.symbol),
    }))
    .filter((currency) => currency.code.length > 0);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readStringArray(
  metadata: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string[] {
  for (const key of keys) {
    const value = metadata[key];

    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string");
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = value as Readonly<Record<string, unknown>>;
      const codes = nested.codes;

      if (Array.isArray(codes)) {
        return codes.filter((item): item is string => typeof item === "string");
      }
    }
  }

  const currencyPreferences = metadata.currencyPreferences ?? metadata.currency_preferences;

  if (currencyPreferences && typeof currencyPreferences === "object" && !Array.isArray(currencyPreferences)) {
    return readStringArray(currencyPreferences as Readonly<Record<string, unknown>>, keys);
  }

  return [];
}
