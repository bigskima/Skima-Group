import { RecordArraySchema, RecordObjectSchema } from "../../shared/api/records";
import { useGatewayQuery } from "../../shared/api/useGatewayQuery";

export function useLpgConfigQuery() {
  return useGatewayQuery({ key: ["config"], path: "/lpg/config", schema: RecordObjectSchema });
}

export function useCurrenciesQuery() {
  return useGatewayQuery({
    key: ["currencies"],
    path: "/engines/currencies",
    schema: RecordArraySchema,
  });
}

export function useProviderAdaptersQuery() {
  return useGatewayQuery({
    key: ["provider-adapters"],
    path: "/engines/provider-adapters",
    schema: RecordArraySchema,
  });
}
