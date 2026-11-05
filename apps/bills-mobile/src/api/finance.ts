import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { useSession } from "../session/SessionProvider";

type FinanceEnvelope<T> = { ok: boolean; data?: T; message?: string };
function endpoint() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (!url) throw new Error("SKIMA finance configuration is unavailable.");
  return url.replace(/\\/$/, "") + "/functions/v1/finance-runtime";
}
async function request<T>(input: { path: string; token: string; schema: z.ZodType<T>; method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!anonKey) throw new Error("SKIMA finance configuration is unavailable.");
  const response = await fetch(endpoint() + input.path, {
    method: input.method ?? "GET",
    headers: { Authorization: "Bearer " + input.token, apikey: anonKey, "Content-Type": "application/json", "x-skima-client": "skima-bills-expo" },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    signal: input.signal,
  });
  let envelope: FinanceEnvelope<unknown>;
  try { envelope = await response.json() as FinanceEnvelope<unknown>; }
  catch { throw new Error("The SKIMA finance service returned an unreadable response."); }
  if (!response.ok || envelope.ok !== true) throw new Error(envelope.message || "The SKIMA finance request could not be completed.");
  return input.schema.parse(envelope.data ?? null);
}
export function useBillsFinanceQuery<T>(input: { key: readonly unknown[]; path: string; schema: z.ZodType<T>; enabled?: boolean; refetchInterval?: number }) {
  const { session, status } = useSession();
  return useQuery({
    queryKey: ["skima-bills-finance", ...input.key, session?.user.id ?? "anonymous"],
    enabled: status === "authenticated" && Boolean(session?.access_token) && (input.enabled ?? true),
    queryFn: ({ signal }) => {
      const token = session?.access_token;
      if (!token) throw new Error("An authenticated session is required.");
      return request({ path: input.path, token, schema: input.schema, signal });
    },
    refetchInterval: input.refetchInterval,
  });
}
export function useBillsFinanceMutation<T>(path: string, schema: z.ZodType<T>) {
  const { session } = useSession();
  const client = useQueryClient();
  return useMutation<T, Error, Record<string, unknown>>({
    mutationFn: (body) => {
      const token = session?.access_token;
      if (!token) throw new Error("An authenticated session is required.");
      return request({ path, token, schema, method: "POST", body });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["skima-bills-finance"] });
      await client.invalidateQueries({ queryKey: ["skima-bills"] });
    },
  });
}
