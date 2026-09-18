import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { useSession } from "../session/SessionProvider";
import { SKIMA_INTERNAL_FULFILLMENT_ID } from "./lpgFulfillment";

export function useGatewayQuery<TSchema extends z.ZodTypeAny>(input: {
  key: readonly unknown[];
  path: string;
  schema: TSchema;
  enabled?: boolean;
  refetchInterval?: number;
  persist?: boolean;
  globalError?: boolean;
}) {
  const session = useSession();
  return useQuery<z.output<TSchema>>({
    queryKey: [
      "lpg-expo",
      ...input.key,
      session.session?.user.id ?? "anonymous",
    ],
    enabled: session.status === "authenticated" && (input.enabled ?? true),
    queryFn: ({ signal }) =>
      session.api.get(input.path, input.schema, { signal }),
    refetchInterval: input.refetchInterval,
    meta: {
      globalError: input.globalError === true,
      persist: input.persist === true,
    },
  });
}

export function useGatewayMutation<T, V>(input: {
  path: string;
  schema: z.ZodType<T>;
  invalidate?: readonly (readonly unknown[])[];
}) {
  const session = useSession();
  const client = useQueryClient();
  return useMutation<T, Error, V>({
    mutationFn: async (body) => {
      const payload = asRecord(body);

      // The customer refill screen intentionally treats SKIMA-managed
      // fulfillment as a station-shaped option so marketplace and internal
      // fulfillment share one selection UX. The public API gateway still
      // builds marketplace route snapshots around physical station branches,
      // so resolve the internal policy route and quote directly through the
      // authenticated Supabase RPC when the digital sentinel is selected.
      if (input.path === "/lpg/quotes" && payload.stationBranchId === SKIMA_INTERNAL_FULFILLMENT_ID) {
        const pickupLocationId = requirePayloadString(payload.pickupLocationId, "pickupLocationId");
        const deliveryLocationId = requirePayloadString(payload.deliveryLocationId, "deliveryLocationId");
        const cylinderId = requirePayloadString(payload.cylinderId, "cylinderId");
        const idempotencyKey = requirePayloadString(payload.idempotencyKey, "idempotencyKey");
        const requestedAmount = optionalPayloadNumber(payload.requestedAmount, "requestedAmount");
        const requestedKg = requestedAmount === null
          ? requirePayloadNumber(payload.requestedKg, "requestedKg")
          : null;

        const routeResult = await session.supabase.rpc("resolve_lpg_internal_route_snapshot", {
          target_delivery_location_id: deliveryLocationId,
          target_pickup_location_id: pickupLocationId,
        });
        if (routeResult.error) throw routeResult.error;

        const quoteResult = await session.supabase.rpc("create_lpg_refill_quote_from_purchase_input", {
          target_cylinder_id: cylinderId,
          target_delivery_instructions: optionalPayloadString(payload.deliveryInstructions),
          target_delivery_location_id: deliveryLocationId,
          target_idempotency_key: idempotencyKey,
          target_metadata: asRecord(payload.metadata),
          target_pickup_location_id: pickupLocationId,
          target_preferred_time: optionalPayloadString(payload.preferredTime),
          target_requested_amount: requestedAmount,
          target_requested_kg: requestedKg,
          target_route_snapshot: routeResult.data ?? {},
          target_source: optionalPayloadString(payload.source) ?? "skima.lpg.mobile",
          target_station_branch_id: SKIMA_INTERNAL_FULFILLMENT_ID,
        });
        if (quoteResult.error) throw quoteResult.error;
        return input.schema.parse(quoteResult.data);
      }

      return session.api.post(input.path, body, input.schema);
    },
    onSuccess: async () => {
      for (const key of input.invalidate ?? [])
        await client.invalidateQueries({ queryKey: ["lpg-expo", ...key] });
    },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requirePayloadString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function optionalPayloadString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requirePayloadNumber(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a number`);
  return parsed;
}

function optionalPayloadNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  return requirePayloadNumber(value, field);
}
