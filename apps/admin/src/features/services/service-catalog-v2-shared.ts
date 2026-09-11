import { z } from "zod";

export const CatalogRecordSchema = z.record(z.unknown());
export const CatalogRecordArraySchema = z.array(CatalogRecordSchema);
export const CatalogMutationSchema = z.unknown();

export type CatalogRecord = z.infer<typeof CatalogRecordSchema>;

export function catalogText(record: CatalogRecord | null | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "string" ? value : "";
}

export function catalogNumber(record: CatalogRecord | null | undefined, key: string) {
  const value = record?.[key];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function catalogLabel(record: CatalogRecord | null | undefined, fallback = "Unnamed") {
  return catalogText(record, "display_name") || catalogText(record, "name") || catalogText(record, "key") || fallback;
}

export function catalogOptions(
  records: readonly CatalogRecord[],
  valueKey: string,
  placeholder: string,
) {
  return [
    { label: placeholder, value: "" },
    ...records
      .map((record) => ({ label: catalogLabel(record), value: catalogText(record, valueKey) }))
      .filter((option) => option.value),
  ];
}

export function catalogSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function catalogOptionalNumber(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function catalogOptionalIso(value: string) {
  if (!value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function catalogList(value: string) {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

export function catalogFriendly(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function catalogError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return String((error as { message: string }).message);
  }
  return "The service catalog action could not be completed. Please try again.";
}
