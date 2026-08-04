import { ActionResponseSchema, createLpgIdempotencyKey, RecordArraySchema } from "../../shared/api/records";
import { useGatewayMutation } from "../../shared/api/useGatewayMutation";
import { useGatewayQuery } from "../../shared/api/useGatewayQuery";

export function useCylindersQuery() {
  return useGatewayQuery({ key: ["cylinders"], path: "/lpg/cylinders", schema: RecordArraySchema });
}

export interface RegisterCylinderInput {
  readonly cylinderIdentifier: string;
  readonly sizeKg: number;
  readonly maxCapacityKg: number;
  readonly brand?: string;
  readonly colour?: string;
  readonly imageAssetIds?: readonly string[];
  readonly ownershipProofMediaAssetId?: string;
  readonly serialNumber?: string;
}

export function useRegisterCylinderMutation() {
  const mutation = useGatewayMutation<unknown, ReturnType<typeof toRegisterCylinderPayload>>({
    invalidate: [["cylinders"]],
    path: "/lpg/cylinders",
    schema: ActionResponseSchema,
  });
  return { ...mutation, submit: (input: RegisterCylinderInput) => mutation.mutateAsync(toRegisterCylinderPayload(input)) };
}

export function toRegisterCylinderPayload(input: RegisterCylinderInput) {
  return {
    ...input,
    conditionStatus: "unknown",
    idempotencyKey: createLpgIdempotencyKey("register-cylinder", input.cylinderIdentifier),
    metadata: input.ownershipProofMediaAssetId
      ? { ownershipProofMediaAssetId: input.ownershipProofMediaAssetId }
      : {},
  };
}

export function useAttachCylinderMediaMutation() {
  const mutation = useGatewayMutation<unknown, {
    readonly cylinderId: string;
    readonly idempotencyKey: string;
    readonly mediaAssetId: string;
    readonly mediaRole: "image" | "ownership_proof";
  }>({
    invalidate: [["cylinders"]],
    path: "/lpg/cylinders/media",
    schema: ActionResponseSchema,
  });

  return {
    ...mutation,
    submit: (input: { readonly cylinderId: string; readonly mediaAssetId: string; readonly mediaRole: "image" | "ownership_proof" }) =>
      mutation.mutateAsync({
        ...input,
        idempotencyKey: createLpgIdempotencyKey("attach-cylinder-media", input.cylinderId),
      }),
  };
}

export function useCylinderHistoryQuery(cylinderId: string | null) {
  return useGatewayQuery({
    enabled: Boolean(cylinderId),
    key: ["cylinder-history", cylinderId],
    path: `/lpg/cylinders/history?cylinderId=${encodeURIComponent(cylinderId ?? "")}`,
    schema: RecordArraySchema,
  });
}
