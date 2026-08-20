import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { useSession } from "../session/SessionProvider";

interface FinanceEnvelope<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly message?: string;
  readonly requestId?: string;
  readonly walletId?: string;
}

function financeBaseUrl(): string {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) throw new Error("EXPO_PUBLIC_SUPABASE_URL is required.");
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/finance-runtime`;
}

async function financeRequest<T>(input: {
  path: string;
  token: string;
  schema: z.ZodType<T>;
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
}): Promise<T> {
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!anonKey) throw new Error("EXPO_PUBLIC_SUPABASE_ANON_KEY is required.");

  const response = await fetch(`${financeBaseUrl()}${input.path}`, {
    method: input.method ?? "GET",
    headers: {
      Authorization: `Bearer ${input.token}`,
      apikey: anonKey,
      "Content-Type": "application/json",
      "x-skima-client": "lpg-expo",
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

export function useFinanceQuery<T>(input: {
  key: readonly unknown[];
  path: string;
  schema: z.ZodType<T>;
  enabled?: boolean;
  refetchInterval?: number;
}) {
  const session = useSession();
  return useQuery({
    queryKey: ["lpg-expo", "finance-runtime", ...input.key, session.session?.user.id ?? "anonymous"],
    enabled: session.status === "authenticated" && Boolean(session.session?.access_token) && (input.enabled ?? true),
    queryFn: ({ signal }) => {
      const token = session.session?.access_token;
      if (!token) throw new Error("An authenticated session is required.");
      return financeRequest({ path: input.path, token, schema: input.schema, signal });
    },
    refetchInterval: input.refetchInterval,
  });
}

export function useFinanceMutation<T, V>(input: {
  path: string;
  schema: z.ZodType<T>;
  invalidate?: readonly (readonly unknown[])[];
}) {
  const session = useSession();
  const client = useQueryClient();
  return useMutation<T, Error, V>({
    mutationFn: (body) => {
      const token = session.session?.access_token;
      if (!token) throw new Error("An authenticated session is required.");
      return financeRequest({
        path: input.path,
        token,
        schema: input.schema,
        method: "POST",
        body,
      });
    },
    onSuccess: async () => {
      for (const key of input.invalidate ?? []) {
        await client.invalidateQueries({ queryKey: ["lpg-expo", ...key] });
      }
      await client.invalidateQueries({ queryKey: ["lpg-expo", "finance-runtime"] });
    },
  });
}
