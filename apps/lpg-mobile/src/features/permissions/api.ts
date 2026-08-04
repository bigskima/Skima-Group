import { z } from "zod";

import { useGatewayQuery } from "../../shared/api/useGatewayQuery";

export const WorkspaceAccessRecordSchema = z.object({
  branchIds: z.array(z.string().uuid()),
  capabilityKeys: z.array(z.string()),
  key: z.enum(["customer", "driver", "station"]),
  organizationIds: z.array(z.string().uuid()),
  status: z.string(),
  subjectId: z.string().uuid(),
  subjectType: z.string(),
  stationIds: z.array(z.string().uuid()).optional(),
  vehicleIds: z.array(z.string().uuid()).optional(),
});

export const WorkspaceAccessManifestSchema = z.object({
  workspaces: z.array(WorkspaceAccessRecordSchema),
});

export type WorkspaceAccessManifest = z.infer<typeof WorkspaceAccessManifestSchema>;

export function useWorkspaceAccessQuery() {
  return useGatewayQuery({
    key: ["workspace-access"],
    path: "/lpg/workspace-access",
    schema: WorkspaceAccessManifestSchema,
  });
}
