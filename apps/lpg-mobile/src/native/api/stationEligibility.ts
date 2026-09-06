import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useSession } from "../session/SessionProvider";

const EligibleStationSchema = z.object({
  station_branch_id: z.string().uuid(),
  display_name: z.string(),
  formatted_address: z.string(),
  latitude: z.coerce.number(),
  longitude: z.coerce.number(),
  service_radius_meters: z.number().nullable(),
  pickup_distance_meters: z.coerce.number(),
  return_distance_meters: z.coerce.number(),
  route_proxy_distance_meters: z.coerce.number(),
  currency_code: z.string(),
  price_per_kg: z.coerce.number(),
  current_available_kg: z.coerce.number(),
  refill_capacity_kg: z.coerce.number(),
  supported_cylinder_sizes_kg: z.array(z.coerce.number()),
  cylinder_size_kg: z.coerce.number(),
});

const EligibleStationsSchema = z.array(EligibleStationSchema);

export type EligibleLpgStation = z.infer<typeof EligibleStationSchema>;

interface EligibleStationParams {
  pickupLocationId: string | null;
  deliveryLocationId: string | null;
  cylinderId: string | null;
  requestedKg: number | null;
  requestedAmount?: number | null;
  enabled?: boolean;
  limit?: number;
}

export function useEligibleLpgStations({
  pickupLocationId,
  deliveryLocationId,
  cylinderId,
  requestedKg,
  requestedAmount = null,
  enabled = true,
  limit = 10,
}: EligibleStationParams) {
  const session = useSession();
  const canLoad = Boolean(
    enabled &&
      session.status === "authenticated" &&
      pickupLocationId &&
      deliveryLocationId &&
      cylinderId &&
      ((requestedKg !== null && Number.isFinite(requestedKg) && requestedKg > 0) ||
        (requestedAmount !== null && Number.isFinite(requestedAmount) && requestedAmount > 0)),
  );

  return useQuery({
    queryKey: [
      "lpg-eligible-stations",
      pickupLocationId,
      deliveryLocationId,
      cylinderId,
      requestedKg,
      requestedAmount,
      limit,
    ],
    enabled: canLoad,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = requestedAmount !== null
        ? await session.supabase.rpc("read_lpg_eligible_stations_for_amount", {
            target_pickup_location_id: pickupLocationId,
            target_delivery_location_id: deliveryLocationId,
            target_cylinder_id: cylinderId,
            target_requested_amount: requestedAmount,
            target_limit: limit,
          })
        : await session.supabase.rpc("read_lpg_eligible_stations", {
            target_pickup_location_id: pickupLocationId,
            target_delivery_location_id: deliveryLocationId,
            target_cylinder_id: cylinderId,
            target_requested_kg: requestedKg,
            target_limit: limit,
          });

      if (error) throw error;
      return EligibleStationsSchema.parse(data ?? []);
    },
  });
}
