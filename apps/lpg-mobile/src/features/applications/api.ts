import { RecordArraySchema } from "@lpg/shared/api/records";
import { useGatewayQuery } from "@lpg/shared/api/useGatewayQuery";

export function useApplicationTypesQuery() {
  return useGatewayQuery({ key: ["application-types"], path: "/runtime/application-types", schema: RecordArraySchema });
}

export function useApplicationsQuery() {
  return useGatewayQuery({ key: ["applications"], path: "/runtime/applications", schema: RecordArraySchema });
}

export function useDocumentRequirementsQuery() {
  return useGatewayQuery({ key: ["document-requirements"], path: "/runtime/documents/requirements", schema: RecordArraySchema });
}

export function useDocumentsQuery() {
  return useGatewayQuery({ key: ["documents"], path: "/runtime/documents", schema: RecordArraySchema });
}
