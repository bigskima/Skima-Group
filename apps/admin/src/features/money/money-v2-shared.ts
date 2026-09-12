import { formatMoney } from "@skima/frontend-core";
import { z } from "zod";

export const MoneyRowSchema = z.record(z.unknown());
export const MoneyRowsSchema = z.array(MoneyRowSchema);
export const MoneyMutationSchema = z.unknown();

export type MoneyRow = z.infer<typeof MoneyRowSchema>;

export function text(row: MoneyRow | null | undefined, key: string): string {
  const value = row?.[key];
  return typeof value === "string" ? value : "";
}

export function firstText(row: MoneyRow | null | undefined, keys: readonly string[]): string {
  for (const key of keys) {
    const value = text(row, key).trim();
    if (value) return value;
  }
  return "";
}

export function numberValue(row: MoneyRow | null | undefined, key: string): number {
  const value = row?.[key];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function currency(row: MoneyRow | null | undefined): string {
  return firstText(row, ["currency_code", "currencyCode"]) || "NGN";
}

export function friendly(value: string): string {
  return value.trim().replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export function statusTone(value: string): "neutral" | "success" | "warning" | "danger" | "info" {
  const normalized = value.toLowerCase();
  if (["active", "completed", "successful", "success", "paid", "settled", "approved", "verified", "released"].includes(normalized)) return "success";
  if (["pending", "processing", "requested", "queued", "reserved", "held", "review", "awaiting_approval"].includes(normalized)) return "warning";
  if (["failed", "rejected", "cancelled", "canceled", "refunded", "reversed", "disabled"].includes(normalized)) return "danger";
  if (["configured", "initiated"].includes(normalized)) return "info";
  return "neutral";
}

export function formatMajorMoney(value: number, code = "NGN"): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${code} ${value.toLocaleString()}`;
  }
}

export function formatMinorMoney(value: number, code = "NGN"): string {
  return formatMoney(value, code);
}

export function formatMoneyBreakdown(
  rows: readonly MoneyRow[],
  amountKey: string,
  unit: "major" | "minor",
): string {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const code = currency(row);
    totals.set(code, (totals.get(code) ?? 0) + numberValue(row, amountKey));
  }

  if (totals.size === 0) return "—";

  return Array.from(totals.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, value]) => unit === "minor" ? formatMinorMoney(value, code) : formatMajorMoney(value, code))
    .join(" · ");
}

export function formatDate(value: string): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function rowId(row: MoneyRow): string {
  return firstText(row, ["id", "public_reference", "provider_reference", "key"]) || JSON.stringify(row);
}

export function walletLabel(row: MoneyRow | null | undefined): string {
  if (!row) return "Wallet";
  const type = friendly(firstText(row, ["wallet_type", "walletType"]) || "wallet");
  const owner = friendly(firstText(row, ["owner_entity_type", "ownerEntityType"]) || "account");
  return `${owner} · ${type} · ${currency(row)}`;
}

export function shortReference(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "Reference unavailable";
  if (trimmed.length <= 16) return trimmed;
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-5)}`;
}

export function readError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = [record.message, record.details, record.hint, record.code]
      .find((value) => typeof value === "string" && value.trim());
    if (typeof message === "string") return message;
  }
  return "Financial information could not be loaded. Refresh and try again.";
}
