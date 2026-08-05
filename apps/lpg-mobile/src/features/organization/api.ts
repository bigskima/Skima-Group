import { RecordArraySchema } from "@lpg/shared/api/records";
import { useGatewayQuery } from "@lpg/shared/api/useGatewayQuery";

export function useOrganizationBranchesQuery() {
  return useGatewayQuery({ key: ["organization-branches"], path: "/runtime/organization-branches", schema: RecordArraySchema });
}

export function useOrganizationRolesQuery() {
  return useGatewayQuery({ key: ["organization-roles"], path: "/runtime/organization-roles", schema: RecordArraySchema });
}

export function useOrganizationMembershipsQuery() {
  return useGatewayQuery({ key: ["organization-memberships"], path: "/runtime/organization-memberships", schema: RecordArraySchema });
}

export function useOrganizationUserRolesQuery() {
  return useGatewayQuery({ key: ["organization-user-roles"], path: "/runtime/organization-user-roles", schema: RecordArraySchema });
}

export function useOrganizationInvitationsQuery() {
  return useGatewayQuery({ key: ["organization-invitations"], path: "/runtime/organization-invitations", schema: RecordArraySchema });
}

export function useOrganizationStaffDirectoryQuery(organizationId: string | null) {
  return useGatewayQuery({
    enabled: Boolean(organizationId),
    key: ["organization-staff-directory", organizationId],
    path: organizationId ? `/runtime/organization-staff/directory?organizationId=${encodeURIComponent(organizationId)}` : "/runtime/organization-staff/directory",
    schema: RecordArraySchema,
  });
}
