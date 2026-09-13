export type JsonRecord = Readonly<Record<string, unknown>>;

export type UtilityProviderContext = Readonly<{
  id: string;
  key: string;
  displayName: string;
  status: string;
  secretRef: string | null;
  config: JsonRecord;
}>;

export type UtilityCatalogItem = Readonly<{
  itemType: "category" | "biller" | "product";
  externalKey: string;
  canonicalKey: string;
  canonicalParentKey?: string | null;
  displayName: string;
  providerProductCode?: string | null;
  amountMode?: "customer" | "fixed" | "provider" | null;
  fixedAmount?: number | null;
  minimumAmount?: number | null;
  maximumAmount?: number | null;
  currencyCode?: string;
  customerIdentifierLabel?: string | null;
  customerIdentifierHint?: string | null;
  normalizedPayload?: JsonRecord;
  rawPayload?: JsonRecord;
  status?: "available" | "unavailable";
}>;

export type UtilityAdapter = Readonly<{
  kind: string;
  testConnection(): Promise<JsonRecord>;
  fetchCatalog(options: Readonly<{ categoryCodes?: string[] }>): Promise<UtilityCatalogItem[]>;
  validateCustomer(input: Readonly<{
    billerCode: string;
    itemCode: string;
    customerIdentifier: string;
  }>): Promise<JsonRecord>;
  purchase(input: Readonly<{
    billerCode: string;
    itemCode: string;
    customerIdentifier: string;
    amount: number;
    reference: string;
    callbackUrl?: string | null;
  }>): Promise<JsonRecord>;
  readStatus(reference: string): Promise<JsonRecord>;
}>;

export class UtilityProviderRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 502,
    readonly details: JsonRecord = {},
  ) {
    super(message);
    this.name = "UtilityProviderRuntimeError";
  }
}

export function requireRecord(value: unknown, message = "The utility provider returned an invalid response."): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UtilityProviderRuntimeError("utility_provider_response_invalid", message, 502);
  }
  return value as JsonRecord;
}

export function optionalRecord(value: unknown): JsonRecord | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

export function requireString(value: unknown, message = "The utility provider returned an incomplete response."): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string" || !value.trim()) {
    throw new UtilityProviderRuntimeError("utility_provider_response_invalid", message, 502);
  }
  return value.trim();
}

export function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function optionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function optionalBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1"].includes(normalized)) return true;
    if (["false", "no", "0"].includes(normalized)) return false;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return null;
}

export function slug(value: string): string {
  const result = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return result || "service";
}

export function defaultIdentifierLabel(categoryKey: string): string {
  if (categoryKey === "airtime" || categoryKey === "data") return "Phone number";
  if (categoryKey === "electricity") return "Meter number";
  if (categoryKey === "cable-tv") return "Smart card or decoder number";
  return "Account number";
}

export function defaultIdentifierHint(categoryKey: string): string {
  if (categoryKey === "airtime" || categoryKey === "data") {
    return "Enter the phone number that should receive this service.";
  }
  if (categoryKey === "electricity") {
    return "Enter the meter number for the electricity account.";
  }
  return "Enter the account identifier supplied by the service company.";
}

export function readPath(value: unknown, path: string | null | undefined): unknown {
  if (!path) return value;
  const segments = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((item) => item.trim())
    .filter(Boolean);
  let current: unknown = value;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function firstPath(value: unknown, paths: readonly string[]): unknown {
  for (const path of paths) {
    const resolved = readPath(value, path);
    if (resolved !== undefined && resolved !== null && resolved !== "") return resolved;
  }
  return undefined;
}

export function normalizeProviderStatus(
  raw: unknown,
  custom: JsonRecord | null = null,
): "processing" | "succeeded" | "failed" | "reversed" {
  const normalized = String(raw ?? "").trim().toLowerCase();
  const values = (key: string, defaults: string[]) => {
    const configured = custom?.[key];
    return Array.isArray(configured)
      ? configured.map((item) => String(item).trim().toLowerCase()).filter(Boolean)
      : defaults;
  };
  if (values("succeeded", ["success", "successful", "succeeded", "completed", "complete", "delivered", "paid", "200"]).includes(normalized)) {
    return "succeeded";
  }
  if (values("reversed", ["reversed", "refunded", "refund", "reversal"]).includes(normalized)) {
    return "reversed";
  }
  if (values("failed", ["failed", "failure", "declined", "cancelled", "canceled", "error", "rejected"]).includes(normalized)) {
    return "failed";
  }
  return "processing";
}

export function isSafeHeaderName(value: string): boolean {
  if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,80}$/.test(value)) return false;
  return !["host", "content-length", "connection", "cookie", "set-cookie", "origin"].includes(value.toLowerCase());
}
