import { RecordArraySchema } from "@lpg/shared/api/records";
import { useGatewayQuery } from "@lpg/shared/api/useGatewayQuery";

export function useTrackingSessionsQuery() {
  return useGatewayQuery({ key: ["tracking-sessions"], path: "/runtime/tracking/sessions", schema: RecordArraySchema });
}

export function useTrackingPointsQuery(trackingSessionId: string | null) {
  return useGatewayQuery({
    enabled: Boolean(trackingSessionId),
    key: ["tracking-points", trackingSessionId],
    path: `/runtime/tracking/points?trackingSessionId=${encodeURIComponent(trackingSessionId ?? "")}`,
    schema: RecordArraySchema,
  });
}
