import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useSession } from "../session/SessionProvider";

export const BillRecordSchema = z.record(z.string(), z.unknown());
export const BillArraySchema = z.array(BillRecordSchema);
export const BillObjectSchema = BillRecordSchema.nullable();
export const BillActionSchema = z.union([z.string(), BillRecordSchema, z.null()]);
export type BillRecord = z.infer<typeof BillRecordSchema>;

export function useBillsQuery<TSchema extends z.ZodTypeAny>(key: readonly unknown[], path: string, schema: TSchema, enabled = true, refetchInterval?: number) {
  const { api, session, status } = useSession();
  return useQuery<z.infer<TSchema>, Error>({
    queryKey: ["skima-bills", ...key, session?.user.id ?? "anonymous"],
    enabled: status === "authenticated" && Boolean(session?.access_token) && enabled,
    queryFn: ({ signal }) => api.get(path, schema, { signal }),
    refetchInterval,
    staleTime: 20_000,
  });
}
export function useBillsRecords(key: readonly unknown[], path: string, enabled = true, refetchInterval?: number) {
  return useBillsQuery(key, path, BillArraySchema, enabled, refetchInterval);
}
export function useBillsMutation(path: string, schema: z.ZodTypeAny, invalidate: readonly (readonly unknown[])[] = []) {
  const { api } = useSession();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.post(path, body, schema),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["skima-bills"] });
      for (const key of invalidate) await client.invalidateQueries({ queryKey: ["skima-bills", ...key] });
    },
  });
}
export function useStorefrontData() {
  const modules = useBillsRecords(["store","modules"], "/modules", true, 60_000);
  const settings = useBillsRecords(["store","settings"], "/runtime/storefront/settings", true, 60_000);
  const storeModule = modules.data?.find((row) => row.key === "store" && row.status === "active") ?? null;
  const activeSettings = settings.data?.find((row) => row.status === "active") ?? null;
  const enabled = Boolean(storeModule?.id && activeSettings?.organization_id);
  const categories = useBillsRecords(["store","categories"], "/runtime/catalog/categories", enabled, 60_000);
  const items = useBillsRecords(["store","items"], "/runtime/catalog/items", enabled, 60_000);
  const variants = useBillsRecords(["store","variants"], "/runtime/catalog/variants", enabled, 60_000);
  const prices = useBillsRecords(["store","prices"], "/runtime/catalog/prices", enabled, 60_000);
  const availability = useBillsRecords(["store","availability"], "/runtime/catalog/availability", enabled, 30_000);
  const media = useBillsRecords(["store","media"], "/runtime/catalog/media", enabled, 60_000);
  return { modules, settings, storeModule, activeSettings, categories, items, variants, prices, availability, media };
}
export function asString(record: any, ...keys: string[]) {
  for (const key of keys) { const value = record?.[key]; if (typeof value === "string" && value.trim()) return value; }
  return null;
}
export function asNumber(record: any, ...keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}
export function money(value: number, currency = "NGN") {
  try { return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(value); }
  catch { return currency + " " + value.toFixed(2); }
}
export function makeIdempotencyKey(prefix: string) {
  return prefix + ":" + Date.now().toString(36) + ":" + Math.random().toString(36).slice(2, 12);
}
