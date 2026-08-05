import { RecordArraySchema, RecordObjectSchema } from "../../shared/api/records";
import { useGatewayQuery } from "../../shared/api/useGatewayQuery";

export function useStationsQuery() {
  return useGatewayQuery({ key: ["stations"], path: "/lpg/stations", schema: RecordArraySchema });
}

export function useStationRuntimeQuery(stationBranchId: string | null = null) {
  const query = stationBranchId ? `?stationBranchId=${encodeURIComponent(stationBranchId)}` : "";
  return useGatewayQuery({
    key: ["station-runtime", stationBranchId],
    path: `/lpg/stations/runtime${query}`,
    schema: RecordObjectSchema,
  });
}

export function useInspectionsQuery(enabled = true) {
  return useGatewayQuery({
    enabled,
    key: ["inspections"],
    path: "/lpg/inspections",
    schema: RecordArraySchema,
  });
}
