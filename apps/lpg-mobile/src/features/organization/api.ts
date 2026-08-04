import { RecordArraySchema } from "@lpg/shared/api/records";
import { useGatewayQuery } from "@lpg/shared/api/useGatewayQuery";

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
