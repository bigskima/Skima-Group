import { ActionResponseSchema, createLpgIdempotencyKey, RecordArraySchema } from "../../shared/api/records";
import { useGatewayMutation } from "../../shared/api/useGatewayMutation";
import { useGatewayQuery } from "../../shared/api/useGatewayQuery";

export function useLocationsQuery() {
  return useGatewayQuery({ key: ["locations"], path: "/lpg/locations", schema: RecordArraySchema });
}

export interface CreateLocationInput {
  readonly label: string;
  readonly formattedAddress: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly deliveryInstructions?: string;
}

export function useCreateLocationMutation() {
  const mutation = useGatewayMutation<unknown, CreateLocationInput & { readonly idempotencyKey: string }>({
    invalidate: [["locations"]], path: "/lpg/locations", schema: ActionResponseSchema,
  });
  return {
    ...mutation,
    submit: (input: CreateLocationInput) => mutation.mutateAsync({
      ...input,
      idempotencyKey: createLpgIdempotencyKey("create-location", input.label),
    }),
  };
}

export function useApplicationsQuery() {
  return useGatewayQuery({
    key: ["applications"],
    path: "/runtime/applications",
    schema: RecordArraySchema,
  });
}
