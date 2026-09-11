import { z } from "zod";

export const UtilityRowSchema = z.record(z.unknown());
export const UtilitySnapshotSchema = z.object({
  categories: z.array(UtilityRowSchema),
  billers: z.array(UtilityRowSchema),
  products: z.array(UtilityRowSchema),
  routes: z.array(UtilityRowSchema),
  economics: z.array(UtilityRowSchema).default([]),
  providers: z.array(UtilityRowSchema),
  syncRuns: z.array(UtilityRowSchema).default([]),
  promotions: z.array(UtilityRowSchema),
  cashbacks: z.array(UtilityRowSchema),
  payments: z.array(UtilityRowSchema),
});
export const UtilityMutationIdSchema = z.string().uuid();
export const UtilityPreviewSchema = z.record(z.unknown());

export type UtilityRow = z.infer<typeof UtilityRowSchema>;
export type UtilitySnapshot = z.infer<typeof UtilitySnapshotSchema>;

export function utilityText(row: UtilityRow | null | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "string" ? value : "";
}

export function utilityFlag(row: UtilityRow | null | undefined, key: string) {
  return row?.[key] === true;
}

export function utilityNumber(row: UtilityRow | null | undefined, key: string) {
  const value = row?.[key];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function utilityObject(row: UtilityRow | null | undefined, key: string): UtilityRow | null {
  const value = row?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as UtilityRow : null;
}

export function utilityOptions(
  rows: readonly UtilityRow[],
  valueKey: string,
  labelKey: string,
  placeholder: string,
) {
  return [
    { label: placeholder, value: "" },
    ...rows
      .map((row) => ({ label: utilityText(row, labelKey) || "Unnamed", value: utilityText(row, valueKey) }))
      .filter((item) => item.value),
  ];
}

export function utilitySlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function normalizeUtilitySecretName(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/^SUPABASE_SECRET:/, "")
    .replace(/[^A-Z0-9_]/g, "_")
    .slice(0, 100);
}

export function utilityNumeric(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function utilityPositive(value: string) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

export function utilityNumberOrNull(value: string) {
  return value.trim() === "" ? null : Number(value);
}

export function utilityIntegerOrNull(value: string) {
  return value.trim() === "" ? null : Math.max(1, Math.trunc(Number(value)));
}

export function formatUtilityNaira(value: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 2,
  }).format(value);
}

export function friendlyUtilityText(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function utilityError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.replaceAll("target_", "").replaceAll("_", " ");
  }
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return String((error as { message: string }).message);
  }
  return "The utility billing action could not be completed. Please try again.";
}
