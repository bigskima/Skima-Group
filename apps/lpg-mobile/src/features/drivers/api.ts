import { RecordArraySchema } from "../../shared/api/records";
import { useGatewayQuery } from "../../shared/api/useGatewayQuery";

export function useDriversQuery() {
  return useGatewayQuery({ key: ["drivers"], path: "/runtime/drivers", schema: RecordArraySchema });
}

export function useVehiclesQuery() {
  return useGatewayQuery({ key: ["vehicles"], path: "/runtime/vehicles", schema: RecordArraySchema });
}

export function useVehicleTypesQuery() {
  return useGatewayQuery({
    key: ["vehicle-types"],
    path: "/runtime/vehicle-types",
    schema: RecordArraySchema,
  });
}

export function useDriverLocationsQuery() {
  return useGatewayQuery({
    key: ["driver-locations"],
    path: "/lpg/driver-locations",
    schema: RecordArraySchema,
  });
}
