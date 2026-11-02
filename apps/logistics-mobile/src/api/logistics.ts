import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useSession } from "../session/SessionProvider";

export type LogisticsRecord = Record<string, unknown>;
export const RecordSchema = z.record(z.string(), z.unknown());
export const RecordArraySchema = z.array(RecordSchema);
export const IdSchema = z.string().uuid();

export function useLogisticsQuery(key: readonly unknown[], path: string, enabled = true, refetchInterval?: number) {
  const { api, session, status } = useSession();
  return useQuery<LogisticsRecord[]>({
    queryKey: ["skima-logistics", ...key, session?.user.id ?? "anonymous"],
    enabled: status === "authenticated" && enabled,
    queryFn: ({ signal }) => api.get(path, RecordArraySchema, { signal }),
    refetchInterval,
    staleTime: 20_000,
  });
}

export function useLogisticsRecordQuery(key: readonly unknown[], path: string, enabled = true) {
  const { api, session, status } = useSession();
  return useQuery<LogisticsRecord>({
    queryKey: ["skima-logistics", ...key, session?.user.id ?? "anonymous"],
    enabled: status === "authenticated" && enabled,
    queryFn: ({ signal }) => api.get(path, RecordSchema, { signal }),
    staleTime: 20_000,
  });
}

export function useCreateLogisticsJob() {
  const { api } = useSession();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { payload: Record<string, unknown>; idempotencyKey: string }) =>
      api.post("/runtime/logistics/jobs", input, IdSchema),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["skima-logistics", "jobs"] });
      await client.invalidateQueries({ queryKey: ["skima-logistics", "opportunities"] });
    },
  });
}

export function asString(record: Record<string, unknown> | null | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

export function asNumber(record: Record<string, unknown> | null | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}
