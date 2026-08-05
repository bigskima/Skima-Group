import {
  getFirstRecordString,
  getRecordId,
  getRecordObject,
  RecordArraySchema,
  type PlatformRecord,
} from "@lpg/shared/api/records";
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

export function useApplicationVersionsQuery(applicationId: string | null) {
  const path = applicationId
    ? `/runtime/applications/payload?applicationId=${encodeURIComponent(applicationId)}`
    : "/runtime/applications/payload";
  return useGatewayQuery({
    enabled: Boolean(applicationId),
    key: ["application-versions", applicationId],
    path,
    schema: RecordArraySchema,
  });
}

export function findLpgApplicationType(
  types: readonly PlatformRecord[] | undefined,
  category: "business" | "driver" | "vehicle",
): PlatformRecord | null {
  const active = (types ?? []).filter((type) =>
    getFirstRecordString(type, ["application_category", "applicationCategory"]) === category &&
    getFirstRecordString(type, ["status"]) === "active"
  );
  return active.find((type) =>
    getFirstRecordString(getRecordObject(type, "metadata"), ["bounded_context", "boundedContext"]) === "lpg"
  ) ?? (active.length === 1 ? active[0] : null);
}

export function findCurrentApplication(
  applications: readonly PlatformRecord[] | undefined,
  applicationType: PlatformRecord | null,
): PlatformRecord | null {
  const typeId = getRecordId(applicationType);
  if (!typeId) return null;
  return (applications ?? []).find((application) => {
    const status = getFirstRecordString(application, ["status"]);
    return getFirstRecordString(application, ["application_type_id", "applicationTypeId"]) === typeId &&
      !["expired", "rejected", "withdrawn"].includes(status ?? "");
  }) ?? null;
}

export function getLatestApplicationPayload(
  versions: readonly PlatformRecord[] | undefined,
): PlatformRecord | null {
  return getRecordObject(versions?.[0], "payload");
}
