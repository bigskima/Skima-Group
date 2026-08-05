import { RecordArraySchema, getFirstRecordString, type PlatformRecord } from "@lpg/shared/api/records";
import { useGatewayQuery } from "@lpg/shared/api/useGatewayQuery";

export function useEntityMediaLinksQuery(entityType: string, entityId: string | null) {
  const query = entityId
    ? `?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`
    : "";

  return useGatewayQuery({
    enabled: Boolean(entityId),
    key: ["entity-media-links", entityType, entityId],
    path: `/runtime/media/entity-links${query}`,
    schema: RecordArraySchema,
  });
}

export function firstLinkedMediaAssetId(
  links: readonly PlatformRecord[] | undefined,
  mediaRole?: string,
): string | null {
  const roleMatches = (links ?? []).filter((link) =>
    !mediaRole || getFirstRecordString(link, ["media_role", "mediaRole"]) === mediaRole
  );
  const primary = roleMatches.find((link) => link["is_primary"] === true || link["isPrimary"] === true);
  return getFirstRecordString(primary ?? roleMatches[0], ["media_asset_id", "mediaAssetId"]);
}
