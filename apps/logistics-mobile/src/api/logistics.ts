import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiGatewayError } from "@skima/frontend-core";
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

export function useLogisticsRecordQuery(key: readonly unknown[], path: string, enabled = true, refetchInterval?: number) {
  const { api, session, status } = useSession();
  return useQuery<LogisticsRecord>({
    queryKey: ["skima-logistics", ...key, session?.user.id ?? "anonymous"],
    enabled: status === "authenticated" && enabled,
    queryFn: ({ signal }) => api.get(path, RecordSchema, { signal }),
    refetchInterval,
    staleTime: 20_000,
  });
}

export function useCreateLogisticsJob() {
  const { api, supabase } = useSession();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { payload: Record<string, unknown>; idempotencyKey: string }) => {
      try {
        return await api.post("/runtime/logistics/jobs", input, IdSchema);
      } catch (cause) {
        // Only recover when the API Gateway request itself failed or timed out.
        // Application and permission errors must still surface unchanged.
        if (!(cause instanceof ApiGatewayError) || !["network_error", "request_timeout"].includes(cause.code)) {
          throw cause;
        }
        // This authenticated RPC enforces auth.uid() ownership and reuses the
        // same idempotency key if the gateway committed but lost its response.
        const { data, error } = await supabase.rpc("create_logistics_job", {
          target_payload: input.payload,
          target_idempotency_key: input.idempotencyKey,
        });
        if (error) throw error;
        return IdSchema.parse(data);
      }
    },
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
