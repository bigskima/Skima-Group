import { createClientIdempotencyKey, normalizeStatusLabel, type SessionContext } from "@skima/frontend-core";
import { z } from "zod";

export type PlatformRecord = Readonly<Record<string, unknown>>;
export type ActionResult = string | PlatformRecord | null;

export const RecordArraySchema = z.array(z.record(z.unknown()));
export const RecordObjectSchema = z.record(z.unknown());
export const ActionResponseSchema = z.union([z.string(), z.record(z.unknown()), z.null()]);

export const lpgOrderSteps = [
  "Confirmed",
  "Payment",
  "Driver",
  "Pickup",
  "Station",
  "Return",
  "Delivery",
] as const;

const terminalStatuses = new Set(["completed", "cancelled", "refunded", "failed"]);

export function createLpgIdempotencyKey(action: string, targetId?: string | null): string {
  return createClientIdempotencyKey(`lpg-mobile-${action}`, targetId ?? undefined);
}

export function getRecordString(
  record: PlatformRecord | null | undefined,
  key: string,
): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function getFirstRecordString(
  record: PlatformRecord | null | undefined,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = getRecordString(record, key);
    if (value) return value;
  }

  return null;
}

export function getRecordNumber(
  record: PlatformRecord | null | undefined,
  key: string,
): number | null {
  const value = record?.[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function getFirstRecordNumber(
  record: PlatformRecord | null | undefined,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = getRecordNumber(record, key);
    if (value !== null) return value;
  }

  return null;
}

export function getRecordObject(
  record: PlatformRecord | null | undefined,
  key: string,
): PlatformRecord | null {
  const value = record?.[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as PlatformRecord
    : null;
}

export function getRecordArray(
  record: PlatformRecord | null | undefined,
  key: string,
): readonly PlatformRecord[] {
  const value = record?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is PlatformRecord =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
    )
    : [];
}

export function getPublicReference(record: PlatformRecord | null | undefined): string | null {
  return getFirstRecordString(record, ["publicReference", "public_reference"]);
}

export function getRecordId(record: PlatformRecord | null | undefined): string | null {
  return getFirstRecordString(record, ["id", "lpgOrderId", "lpg_order_id", "orderId", "order_id"]);
}

export function getActionResultId(result: unknown): string | null {
  if (typeof result === "string" && result.length > 0) return result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return getRecordId(result as PlatformRecord);
  }
  return null;
}

export function getActionRecordId(result: ActionResult | unknown): string | null {
  if (typeof result === "string" && result.trim()) return result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  return getRecordId(result as PlatformRecord) ??
    getFirstRecordString(result as PlatformRecord, ["result", "recordId", "record_id"]);
}

export function displayReference(
  record: PlatformRecord | null | undefined,
  pendingLabel = "Reference pending",
): string {
  return getPublicReference(record) ?? pendingLabel;
}

export function recordKey(record: PlatformRecord, fallback: string): string {
  return getRecordId(record) ??
    getPublicReference(record) ??
    getFirstRecordString(record, ["key", "created_at", "updated_at"]) ??
    fallback;
}

export function findRecordById(
  records: readonly PlatformRecord[],
  id: string | null | undefined,
): PlatformRecord | null {
  if (!id) return null;
  return records.find((record) => getRecordId(record) === id) ?? null;
}

export function getStatus(record: PlatformRecord | null | undefined, fallback = "pending"): string {
  return getFirstRecordString(record, ["status", "lpg_status", "payment_status", "assignmentStatus"]) ??
    fallback;
}

export function isTerminalStatus(status: string | null | undefined): boolean {
  return terminalStatuses.has((status ?? "").toLowerCase());
}

export function statusTone(status: string | null | undefined): "success" | "warning" | "danger" | "info" {
  const normalized = (status ?? "").toLowerCase();

  if (normalized.includes("completed") || normalized.includes("delivered") || normalized.includes("verified") || normalized.includes("approved") || normalized.includes("paid") || normalized.includes("active") || normalized.includes("available")) {
    return "success";
  }

  if (normalized.includes("cancel") || normalized.includes("failed") || normalized.includes("refund") || normalized.includes("dispute") || normalized.includes("unsafe") || normalized.includes("blocked")) {
    return "danger";
  }

  if (normalized.includes("pending") || normalized.includes("await") || normalized.includes("offered") || normalized.includes("processing") || normalized.includes("inspection")) {
    return "warning";
  }

  return "info";
}

export function orderProgressIndex(status: string | null | undefined): number {
  const normalized = (status ?? "").toLowerCase();

  if (normalized.includes("delivered") || normalized.includes("completed")) return 6;
  if (normalized.includes("delivery") || normalized.includes("return")) return 5;
  if (normalized.includes("refill") || normalized.includes("station")) return 4;
  if (normalized.includes("pickup")) return 3;
  if (normalized.includes("driver") || normalized.includes("assignment")) return 2;
  if (normalized.includes("payment")) return 1;
  return 0;
}

export function formatStatus(status: string | null | undefined, fallback = "Pending"): string {
  return status ? normalizeStatusLabel(status) : fallback;
}

export function hasPermission(context: SessionContext, permission: string): boolean {
  return context.permissions.includes(permission) ||
    context.roles.some((role) => role.permissions.includes(permission));
}

export function hasAnyPermission(context: SessionContext, permissions: readonly string[]): boolean {
  return permissions.some((permission) => hasPermission(context, permission));
}

export function canReadStationFinance(context: SessionContext): boolean {
  return Boolean(context.platformAdmin) ||
    hasAnyPermission(context, [
      "lpg.orders.finance",
      "business.finance.read",
      "business.settlements.read",
    ]);
}

export function getPolicyRecord(
  config: PlatformRecord | null | undefined,
  policyKey: string,
): PlatformRecord | null {
  const policies = getRecordObject(config, "policies");
  const policy = getRecordObject(policies, policyKey);
  return policy ? getRecordObject(policy, "policy") ?? policy : null;
}

export function getConfigRecords(
  config: PlatformRecord | null | undefined,
  key: string,
): readonly PlatformRecord[] {
  return getRecordArray(config, key);
}

export function getPolicyNumberArray(
  config: PlatformRecord | null | undefined,
  policyKey: string,
  fieldKey: string,
): readonly number[] {
  const policy = getPolicyRecord(config, policyKey);
  const value = policy?.[fieldKey];
  return Array.isArray(value)
    ? value
      .map((item) => typeof item === "number" ? item : Number(item))
      .filter((item) => Number.isFinite(item) && item > 0)
    : [];
}
