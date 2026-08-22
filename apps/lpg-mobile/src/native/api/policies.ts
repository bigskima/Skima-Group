import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { useSession } from "../session/SessionProvider";
import { idempotencyKey } from "../utilities/idempotency";

const PolicyDocumentSchema = z.object({
  key: z.string(),
  title: z.string(),
  audience: z.enum(["customer", "partner", "public"]),
  serviceScope: z.string(),
  sourceUrl: z.string().nullable().optional(),
  isRequired: z.boolean(),
  acceptanceStatement: z.string(),
  published: z.boolean(),
  versionId: z.string().uuid().optional(),
  versionLabel: z.string().optional(),
  summary: z.string().optional(),
  content: z.string().optional(),
  contentFormat: z.enum(["markdown", "plain_text", "html"]).optional(),
  contentHash: z.string().optional(),
  effectiveFrom: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  requiresReacceptance: z.boolean().optional(),
});

export type PolicyDocument = z.infer<typeof PolicyDocumentSchema>;

export function useCurrentPolicy(policyKey: string) {
  const session = useSession();
  return useQuery({
    queryKey: ["policy", "current", policyKey],
    retry: 1,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await session.supabase.rpc("read_current_policy", {
        target_policy_key: policyKey,
      });
      if (error) throw error;
      return PolicyDocumentSchema.parse(data);
    },
  });
}

export function useCurrentPolicyAcceptance(
  policyKey: string,
  applicationId: string | null,
  published: boolean,
) {
  const session = useSession();
  return useQuery({
    queryKey: ["policy", "accepted", policyKey, applicationId],
    enabled: session.status === "authenticated" && published,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await session.supabase.rpc(
        "has_accepted_current_policy",
        {
          target_policy_key: policyKey,
          target_application_id: applicationId,
        },
      );
      if (error) throw error;
      return data === true;
    },
  });
}

export function useAcceptPolicy(policyKey: string, applicationId: string | null) {
  const session = useSession();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      versionId,
      acceptanceStatement,
      roleKey,
    }: {
      readonly versionId: string;
      readonly acceptanceStatement: string;
      readonly roleKey: string | null;
    }) => {
      if (session.status !== "authenticated") {
        throw new Error("Sign in before accepting these terms.");
      }
      const { data, error } = await session.supabase.rpc("accept_policy", {
        target_policy_key: policyKey,
        target_policy_version_id: versionId,
        target_application_id: applicationId,
        target_role_key: roleKey,
        target_acceptance_statement: acceptanceStatement,
        target_source: "skima.lpg.mobile",
        target_idempotency_key: idempotencyKey(
          "policy-acceptance",
          `${policyKey}:${versionId}:${applicationId ?? "account"}`,
        ),
        target_metadata: { surface: "policy_document" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["policy", "accepted", policyKey, applicationId],
      });
    },
  });
}
