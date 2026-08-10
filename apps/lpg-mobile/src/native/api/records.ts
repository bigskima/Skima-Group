import { z } from "zod";

export const PlatformRecordSchema = z.record(z.unknown());
export const RecordArraySchema = z.array(PlatformRecordSchema);
export const RecordObjectSchema = PlatformRecordSchema.nullable();
export type PlatformRecord = z.infer<typeof PlatformRecordSchema>;
export const ActionResponseSchema = z.union([z.string(), PlatformRecordSchema, z.null()]);

export function recordId(record: PlatformRecord): string | null {
  return firstString(record, ["id", "public_reference", "publicReference"]);
}
export function displayReference(record: PlatformRecord): string | null {
  return firstString(record, ["public_reference", "publicReference", "reference", "cylinder_identifier", "cylinderIdentifier", "id"]);
}
export function firstNumber(record: PlatformRecord | null | undefined, keys: readonly string[]): number | null {
  for (const key of keys) { const value = record?.[key]; if (typeof value === "number" && Number.isFinite(value)) return value; if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value); }
  return null;
}
export function firstString(record: PlatformRecord | null | undefined, keys: readonly string[]): string | null {
  for (const key of keys) { const value = record?.[key]; if (typeof value === "string" && value.trim()) return value; }
  return null;
}
export function displayTitle(record: PlatformRecord): string {
  return firstString(record, ["display_name", "displayName", "name", "label", "title", "cylinder_identifier", "cylinderIdentifier", "public_reference", "reference", "id"]) ?? "Record";
}
export function displayStatus(record: PlatformRecord): string | null {
  return firstString(record, ["workflow_state", "workflowState", "status", "state", "availability_status"]);
}
export function displaySubtitle(record: PlatformRecord): string | null {
  return firstString(record, ["formatted_address", "formattedAddress", "address", "description", "station_name", "organization_name", "updated_at", "created_at"]);
}
export function nestedRecord(record: PlatformRecord | null | undefined, key: string): PlatformRecord | null {
  const value = record?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as PlatformRecord : null;
}
export function nestedRecords(record: PlatformRecord | null | undefined, key: string): PlatformRecord[] {
  const value = record?.[key];
  return Array.isArray(value) ? value.filter((item): item is PlatformRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}
