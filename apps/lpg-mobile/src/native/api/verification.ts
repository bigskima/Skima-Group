import { z } from "zod";

import { useGatewayMutation, useGatewayQuery } from "./gateway";

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

export function useApplicationVerification(
  applicationId: string | null | undefined,
) {
  return useGatewayQuery({
    key: ["partner-verification", "application", applicationId ?? "none"],
    path:
      `/runtime/partner-verification/requirements?applicationId=${encodeURIComponent(applicationId ?? "")}`,
    schema: VerificationChecksSchema,
    enabled: Boolean(applicationId),
  });
}

export function useStartVerification() {
  return useGatewayMutation<
    VerificationSession,
    {
      applicationId: string;
      verificationKey: string;
      idempotencyKey: string;
    }
  >({
    path: "/runtime/partner-verification/sessions",
    schema: VerificationSessionSchema,
    invalidate: [["partner-verification"]],
  });
}

export function useRefreshVerification() {
  return useGatewayMutation<
    VerificationSession,
    {
      applicationId: string;
      sessionId: string;
      idempotencyKey: string;
    }
  >({
    path: "/runtime/partner-verification/sessions/refresh",
    schema: VerificationSessionSchema,
    invalidate: [
      ["partner-verification"],
      ["applications"],
      ["documents"],
    ],
  });
}

export function useReconcileApplicationVerification() {
  return useGatewayMutation<
    z.output<typeof VerificationReconciliationSchema>,
    {
      applicationId: string;
      idempotencyKey: string;
    }
  >({
    path: "/runtime/partner-verification/applications/reconcile",
    schema: VerificationReconciliationSchema,
    invalidate: [
      ["partner-verification"],
      ["applications"],
      ["documents"],
    ],
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
    (checks ?? []).find((check) =>
      check.satisfiesDocumentKeys.includes(documentKey)
    ) ?? null
  );
}

export function shouldShowVerificationFallback(
  check: VerificationCheck | null | undefined,
): boolean {
  if (!check) return true;
  if (check.status === "passed") return false;
  if (!check.manualFallbackAllowed) return false;
  if (!check.automaticAvailable) return true;
  return ["failed", "expired", "manual_fallback", "cancelled"].includes(
    check.status,
  );
}
