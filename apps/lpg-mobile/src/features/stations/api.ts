import { RecordArraySchema } from "../../shared/api/records";
import { useGatewayQuery } from "../../shared/api/useGatewayQuery";

export function useStationsQuery() {
  return useGatewayQuery({ key: ["stations"], path: "/lpg/stations", schema: RecordArraySchema });
}

export function useInspectionsQuery(enabled = true) {
  return useGatewayQuery({
    enabled,
    key: ["inspections"],
    path: "/lpg/inspections",
    schema: RecordArraySchema,
  });
}
