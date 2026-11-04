import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { useSession } from "../session/SessionProvider";

interface FinanceEnvelope<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly message?: string;
}

function financeUrl() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (!url) throw new Error("SKIMA finance configuration is unavailable.");
  return `${url.replace(/\\/$/, "")}/functions/v1/finance-runtime`;
}

async function financeRequest<T>(input: {
  path: string;
  accessToken: string;
  schema: z.ZodType<T>;
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
}): Promise<T> {
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!anonKey) throw new Error("SKIMA finance configuration is unavailable.");
  const response = await fetch(`${financeUrl()}${input.path}`, {
    method: input.method ?? "GET",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      apikey: anonKey,
      "Content-Type": "application/json",
      "x-skima-client": "skima-logistics-expo",
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    signal: input.signal,
  });
  let envelope: FinanceEnvelope<unknown>;
  try {
    envelope = await response.json() as FinanceEnvelope<unknown>;
  } catch {
    throw new Error("The SKIMA finance service returned an unreadable response.");
  }
  if (!response.ok || envelope.ok !== true) {
    throw new Error(envelope.message || "The SKIMA finance request could not be completed.");
  }
  return input.schema.parse(envelope.data ?? null);
}

export function useLogisticsFinanceQuery<T>(input: {
  key: readonly unknown[];
  path: string;
  schema: z.ZodType<T>;
  enabled?: boolean;
  refetchInterval?: number;
}) {
  const { session, status } = useSession();
  return useQuery({
    queryKey: ["skima-logistics-finance", ...input.key, session?.user.id ?? "anonymous"],
    enabled: status === "authenticated" && Boolean(session?.access_token) && (input.enabled ?? true),
    queryFn: ({ signal }) => {
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error("An authenticated session is required.");
      return financeRequest({ path: input.path, accessToken, schema: input.schema, signal });
    },
    refetchInterval: input.refetchInterval,
  });
}

export function useLogisticsFinanceMutation<T, V>(input: {
  path: string;
  schema: z.ZodType<T>;
  invalidate?: readonly (readonly unknown[])[];
}) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  return useMutation<T, Error, V>({
    mutationFn: (body) => {
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error("An authenticated session is required.");
      return financeRequest({
        path: input.path,
        accessToken,
        schema: input.schema,
        method: "POST",
        body,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["skima-logistics-finance"] });
      await queryClient.invalidateQueries({ queryKey: ["skima-logistics", "customer-wallets"] });
      await queryClient.invalidateQueries({ queryKey: ["skima-logistics", "customer-wallet-balances"] });
      for (const key of input.invalidate ?? []) {
        await queryClient.invalidateQueries({ queryKey: ["skima-logistics-finance", ...key] });
      }
    },
  });
}
