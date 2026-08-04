import { formatMoney, normalizeStatusLabel } from "@skima/frontend-core";

import {
  displayReference,
  findRecordById,
  formatStatus,
  getConfigRecords,
  getFirstRecordNumber,
  getFirstRecordString,
  getPublicReference,
  getRecordNumber,
  getRecordString,
  getStatus,
  lpgOrderSteps,
  orderProgressIndex,
  type PlatformRecord,
} from "../api/records";

export function walletTotal(
  records: readonly PlatformRecord[],
  currencyCode: string,
): number {
  return walletTotalByField(records, currencyCode, "balance");
}

export function walletTotalByField(
  records: readonly PlatformRecord[],
  currencyCode: string,
  fieldKey: string,
): number {
  return records.reduce((total, record) => {
    const recordCurrency = getFirstRecordString(record, ["currency_code", "currencyCode"]) ??
      currencyCode;
    if (recordCurrency !== currencyCode) return total;
    return total + (getRecordNumber(record, fieldKey) ?? 0);
  }, 0);
}

export function moneyFromRecord(
  record: PlatformRecord | null | undefined,
  keys: readonly string[],
  currencyCode: string,
  fallback = "Awaiting amount",
): string {
  const amount = getFirstRecordNumber(record, keys);
  return amount !== null ? formatMoney(amount, currencyCode) : fallback;
}

export function formatDate(record: PlatformRecord | null | undefined, key: string): string {
  const value = getRecordString(record, key);
  return value ? formatDateValue(value) : "Not recorded";
}

export function formatDateValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";

  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatTimeValue(value: string | null | undefined): string {
  if (!value) return "Pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Pending";

  return new Intl.DateTimeFormat("en-NG", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatCylinderTitle(cylinder: PlatformRecord | null | undefined): string {
  if (!cylinder) return "Registered cylinder";

  const size = getFirstRecordNumber(cylinder, ["size_kg", "sizeKg"]);
  return size !== null ? `${size}kg Cylinder` : "Registered cylinder";
}

export function cylinderDescription(cylinder: PlatformRecord | null | undefined): string {
  const reference = getPublicReference(cylinder) ??
    getFirstRecordString(cylinder, ["cylinder_identifier", "cylinderIdentifier"]) ??
    "Reference pending";
  const colour = getFirstRecordString(cylinder, ["colour", "color"]);
  const brand = getFirstRecordString(cylinder, ["brand", "manufacturer"]);

  return [reference, colour, brand].filter(Boolean).join(" - ");
}

export function cylinderForOrder(
  cylinders: readonly PlatformRecord[],
  order: PlatformRecord | null | undefined,
): PlatformRecord | null {
  return findRecordById(
    cylinders,
    getFirstRecordString(order, ["cylinder_id", "cylinderId"]),
  );
}

export function stationForOrder(
  stations: readonly PlatformRecord[],
  order: PlatformRecord | null | undefined,
): PlatformRecord | null {
  return findRecordById(
    stations,
    getFirstRecordString(order, ["station_branch_id", "stationBranchId"]),
  );
}

export function orderHeadline(order: PlatformRecord | null | undefined): string {
  const status = getStatus(order, "pending");
  if (status.includes("delivered")) return "Delivered";
  if (status.includes("station") || status.includes("refill")) return "Refill in progress";
  if (status.includes("payment")) return "Payment reserved";
  return formatStatus(status);
}

export function orderSubtext(order: PlatformRecord | null | undefined): string {
  const status = getStatus(order, "");
  if (status.includes("station") || status.includes("refill")) {
    return "Your cylinder refill state is being updated through verified station events.";
  }
  if (status.includes("delivery") || status.includes("return")) {
    return "Your driver is returning with delivery verification enabled.";
  }
  if (status.includes("payment")) {
    return "Funds are reserved while dispatch and fulfilment continue.";
  }
  return "Track each verified step of your LPG refill.";
}

export function orderTimelineItems(
  order: PlatformRecord | null | undefined,
): readonly (readonly [string, string, boolean])[] {
  if (!order) return [];

  const status = getStatus(order, "pending");
  const activeIndex = orderProgressIndex(status);
  const createdAt = getFirstRecordString(order, ["created_at", "createdAt"]);
  const updatedAt = getFirstRecordString(order, ["updated_at", "updatedAt"]);

  return lpgOrderSteps.map((label, index) => [
    index === activeIndex ? formatTimeValue(updatedAt) : index === 0 ? formatTimeValue(createdAt) : "Pending",
    index === activeIndex ? `${label} - current` : label,
    index <= activeIndex,
  ]);
}

export function pricingAmount(
  config: PlatformRecord | null | undefined,
  currencyCode: string,
): string {
  const pricing = getConfigRecords(config, "pricing").find((record) =>
    (getFirstRecordString(record, ["currencyCode", "currency_code"]) ?? currencyCode) ===
      currencyCode
  );
  const pricePerKg = getFirstRecordNumber(pricing, ["pricePerKg", "price_per_kg"]);
  return pricePerKg !== null ? `${formatMoney(pricePerKg, currencyCode)}/kg` : "Configured by backend";
}

export function transactionRows(input: {
  readonly commissions: readonly PlatformRecord[];
  readonly deposits: readonly PlatformRecord[];
  readonly settlements: readonly PlatformRecord[];
  readonly withdrawals: readonly PlatformRecord[];
}): readonly PlatformRecord[] {
  const rows = [
    ...input.deposits.map((record) => ({ ...record, transactionKind: "Top Up" })),
    ...input.withdrawals.map((record) => ({ ...record, transactionKind: "Withdrawal" })),
    ...input.settlements.map((record) => ({ ...record, transactionKind: "Settlement" })),
    ...input.commissions.map((record) => ({ ...record, transactionKind: "Driver Commission" })),
  ];

  return rows.sort((left, right) =>
    dateValue(getFirstRecordString(right, ["created_at", "requested_at", "updated_at"])) -
    dateValue(getFirstRecordString(left, ["created_at", "requested_at", "updated_at"]))
  );
}

export function transactionAmount(record: PlatformRecord): number | null {
  const kind = getRecordString(record, "transactionKind");
  const amount = getFirstRecordNumber(record, [
    "amount",
    "total_debit_amount",
    "net_amount",
    "gross_amount",
    "hold_amount",
  ]);

  if (amount === null) return null;
  return kind === "Withdrawal" ? -Math.abs(amount) : amount;
}

export function transactionTitle(record: PlatformRecord): string {
  return getRecordString(record, "transactionKind") ?? "Wallet activity";
}

export function transactionText(record: PlatformRecord): string {
  return displayReference(record, normalizeStatusLabel(getStatus(record, "recorded")));
}

function dateValue(value: string | null): number {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}
