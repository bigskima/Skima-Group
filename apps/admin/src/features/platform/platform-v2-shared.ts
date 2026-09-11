import { z } from "zod";

export const PlatformRowSchema = z.record(z.unknown());
export const PlatformRowsSchema = z.array(PlatformRowSchema);
export const PlatformMutationSchema = z.unknown();

export type PlatformRow = z.infer<typeof PlatformRowSchema>;

export function text(row: PlatformRow | null | undefined, key: string): string {
  const value = row?.[key];
  return typeof value === "string" ? value : "";
}

export function firstText(row: PlatformRow | null | undefined, keys: readonly string[]): string {
  for (const key of keys) {
    const value = text(row, key).trim();
    if (value) return value;
  }
  return "";
}

export function numberValue(row: PlatformRow | null | undefined, key: string): number {
  const value = row?.[key];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function booleanValue(row: PlatformRow | null | undefined, key: string): boolean {
  return row?.[key] === true;
}

export function friendly(value: string): string {
  const normalized = value.trim().replaceAll("_", " ").replaceAll("-", " ");
  return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
}

export function formatDate(value: string): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.|\.$/g, "")
    .slice(0, 110);
}

export function listFromInput(value: string): string[] {
  return Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean)));
}

export function rowId(row: PlatformRow): string {
  return firstText(row, ["id", "key", "url", "display_name", "displayName"]) || JSON.stringify(row);
}

export function rowLabel(row: PlatformRow, fallback = "Record"): string {
  return firstText(row, ["display_name", "displayName", "name", "title", "key", "url"]) || fallback;
}

export function optionRows(
  rows: readonly PlatformRow[],
  placeholder: string,
  valueKeys: readonly string[] = ["id", "key"],
  labelKeys: readonly string[] = ["display_name", "displayName", "name", "key"],
) {
  return [
    { label: placeholder, value: "" },
    ...rows.flatMap((row) => {
      const value = firstText(row, valueKeys);
      if (!value) return [];
      return [{ label: firstText(row, labelKeys) || value, value }];
    }),
  ];
}

export function statusTone(value: string): "neutral" | "success" | "warning" | "danger" | "info" {
  const normalized = value.toLowerCase();
  if (["active", "healthy", "ok", "success", "successful", "completed", "delivered", "verified"].includes(normalized)) return "success";
  if (["draft", "queued", "pending", "paused", "degraded", "retrying", "processing", "warning"].includes(normalized)) return "warning";
  if (["failed", "error", "disabled", "suspended", "unhealthy", "critical", "revoked"].includes(normalized)) return "danger";
  if (["configured", "available", "ready"].includes(normalized)) return "info";
  return "neutral";
}

export function readError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = [record.message, record.details, record.hint, record.code]
      .find((value) => typeof value === "string" && value.trim());
    if (typeof message === "string") return message;
  }
  return "The platform request could not be completed. Refresh and try again.";
}
