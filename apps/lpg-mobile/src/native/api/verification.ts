import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { useSession } from "../session/SessionProvider";

export const VerificationCheckSchema = z.object({
  id: z.string().uuid(),
  verificationKey: z.string(),
  displayName: z.string(),
  verificationMode: z.string(),
  required: z.boolean(),
  manualFallbackAllowed: z.boolean(),
  satisfiesDocumentKeys: z.array(z.string()).default([]),
  priority: z.coerce.number().default(100),
  metadata: z.record(z.unknown()).default({}),
  automaticAvailable: z.boolean(),
  providerDisplayName: z.string().nullable().optional(),
  sessionId: z.string().uuid().nullable().optional(),
  status: z.string(),
  providerStatus: z.string().nullable().optional(),
  failureCode: z.string().nullable().optional(),
  failureMessage: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
}).passthrough();

export const VerificationChecksSchema = z.array(VerificationCheckSchema);

export const VerificationSessionSchema = z.object({
  id: z.string().uuid(),
  verificationKey: z.string().nullable().optional(),
  status: z.string(),
  verificationUrl: z.string().nullable().optional(),
  providerSessionId: z.string().nullable().optional(),
  providerStatus: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  reconciliation: z.record(z.unknown()).nullable().optional(),
}).passthrough();

export const VerificationReconciliationSchema = z.object({
  applicationId: z.string().uuid().optional(),
  autoDecided: z.boolean().optional(),
  unresolvedVerificationCount: z.coerce.number().optional(),
  manualReviewCount: z.coerce.number().optional(),
  pending: z.boolean().optional(),
  message: z.string().optional(),
}).passthrough();

export type VerificationCheck = z.output<typeof VerificationCheckSchema>;
export type VerificationSession = z.output<typeof VerificationSessionSchema>;

interface VerificationEnvelope<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly message?: string;
  readonly details?: Record<string, unknown>;
  readonly requestId?: string;
}

function verificationBaseUrl(): string {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) throw new Error("EXPO_PUBLIC_SUPABASE_URL is required.");
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/verification-runtime`;
}

async function verificationRequest<TSchema extends z.ZodTypeAny>(input: {
  path: string;
  token: string;
  schema: TSchema;
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
}): Promise<z.output<TSchema>> {
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!anonKey) throw new Error("EXPO_PUBLIC_SUPABASE_ANON_KEY is required.");

  const response = await fetch(`${verificationBaseUrl()}${input.path}`, {
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

  let envelope: VerificationEnvelope<unknown>;
  try {
    envelope = await response.json() as VerificationEnvelope<unknown>;
  } catch {
    throw new Error("The SKIMA verification service returned an unreadable response.");
  }

  if (!response.ok || envelope.ok !== true) {
    throw new Error(
      envelope.message ||
        "SKIMA could not complete this verification request. You can retry or use an allowed fallback.",
    );
  }

  return input.schema.parse(envelope.data ?? null);
}

export function useApplicationVerification(applicationId: string | null | undefined) {
  const session = useSession();

  return useQuery({
    queryKey: [
      "lpg-expo",
      "verification-runtime",
      "application",
      applicationId ?? "none",
      session.session?.user.id ?? "anonymous",
    ],
    enabled:
      session.status === "authenticated" &&
      Boolean(session.session?.access_token) &&
      Boolean(applicationId),
    queryFn: ({ signal }) => {
      const token = session.session?.access_token;
      if (!token || !applicationId) throw new Error("An application and signed-in session are required.");
      return verificationRequest({
        path: `/requirements?applicationId=${encodeURIComponent(applicationId)}`,
        token,
        schema: VerificationChecksSchema,
        signal,
      });
    },
  });
}

export function useStartVerification() {
  const session = useSession();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      applicationId: string;
      verificationKey: string;
      idempotencyKey: string;
    }) => {
      const token = session.session?.access_token;
      if (!token) throw new Error("An authenticated session is required.");
      return verificationRequest({
        path: "/sessions",
        token,
        schema: VerificationSessionSchema,
        method: "POST",
        body: input,
      });
    },
    onSuccess: async (_data, input) => {
      await client.invalidateQueries({
        queryKey: ["lpg-expo", "verification-runtime", "application", input.applicationId],
      });
    },
  });
}

export function useRefreshVerification() {
  const session = useSession();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      applicationId: string;
      sessionId: string;
      idempotencyKey: string;
    }) => {
      const token = session.session?.access_token;
      if (!token) throw new Error("An authenticated session is required.");
      return verificationRequest({
        path: "/sessions/refresh",
        token,
        schema: VerificationSessionSchema,
        method: "POST",
        body: {
          sessionId: input.sessionId,
          idempotencyKey: input.idempotencyKey,
        },
      });
    },
    onSuccess: async (_data, input) => {
      await client.invalidateQueries({
        queryKey: ["lpg-expo", "verification-runtime", "application", input.applicationId],
      });
      await client.invalidateQueries({ queryKey: ["lpg-expo", "applications"] });
      await client.invalidateQueries({ queryKey: ["lpg-expo", "documents"] });
    },
  });
}

export function useReconcileApplicationVerification() {
  const session = useSession();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      applicationId: string;
      idempotencyKey: string;
    }) => {
      const token = session.session?.access_token;
      if (!token) throw new Error("An authenticated session is required.");
      return verificationRequest({
        path: "/applications/reconcile",
        token,
        schema: VerificationReconciliationSchema,
        method: "POST",
        body: input,
      });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["lpg-expo", "applications"] });
      await client.invalidateQueries({ queryKey: ["lpg-expo", "verification-runtime"] });
    },
  });
}

export function satisfiedVerificationDocumentKeys(
  checks: readonly VerificationCheck[] | undefined,
): ReadonlySet<string> {
  return new Set(
    (checks ?? [])
      .filter((check) => check.status === "passed")
      .flatMap((check) => check.satisfiesDocumentKeys),
  );
}

export function verificationForDocumentKey(
  checks: readonly VerificationCheck[] | undefined,
  documentKey: string,
): VerificationCheck | null {
  return (
    (checks ?? []).find((check) => check.satisfiesDocumentKeys.includes(documentKey)) ??
    null
  );
}

export function shouldShowVerificationFallback(
  check: VerificationCheck | null | undefined,
): boolean {
  if (!check) return true;
  if (check.status === "passed") return false;
  if (!check.manualFallbackAllowed) return false;
  if (!check.automaticAvailable) return true;
  return ["failed", "expired", "manual_fallback", "cancelled"].includes(check.status);
}
