import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  firstNumber,
  firstString,
  nestedRecord,
  recordId,
  type PlatformRecord,
} from "./records";
import { useSession } from "../session/SessionProvider";

const UniversalMatchedAreaSchema = z.object({
  id: z.string().uuid(),
  policyId: z.string().uuid(),
});

export const ServiceabilityReasonSchema = z.enum([
  "AVAILABLE",
  "SERVICE_NOT_LAUNCHED",
  "AREA_EXCLUDED",
  "SERVICE_PAUSED",
  "LOCATION_REQUIRED",
  "LOCATION_TOO_INACCURATE",
  "POLICY_CONFIGURATION_CONFLICT",
  "NO_ELIGIBLE_STATION",
  "NO_ELIGIBLE_DRIVER",
  "TEMPORARILY_UNAVAILABLE",
]);

export const LpgServiceabilitySchema = z.object({
  serviceable: z.boolean(),
  status: z.enum(["available", "unavailable"]),
  reason: ServiceabilityReasonSchema,
  matchedArea: UniversalMatchedAreaSchema.nullable(),
  partnerOpportunity: z.boolean(),
  partnerOpportunities: z.object({
    driver: z.boolean(),
    station: z.boolean(),
  }).optional(),
});

export type LpgServiceability = z.infer<typeof LpgServiceabilitySchema>;

export function useLpgServiceability(location: PlatformRecord | null) {
  const session = useSession();
  const latitude = firstNumber(location, ["latitude", "lat"]);
  const longitude = firstNumber(location, ["longitude", "lng", "lon"]);
  const geography = serviceabilityGeography(location);
  const locationKey = location ? recordId(location) : null;
  const enabled =
    session.status === "authenticated" &&
    location !== null &&
    latitude !== null &&
    longitude !== null;

  return useQuery({
    queryKey: [
      "lpg",
      "serviceability",
      locationKey,
      latitude,
      longitude,
      geography,
    ],
    enabled,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await session.supabase.rpc(
        "resolve_lpg_serviceability",
        {
          p_latitude: latitude!,
          p_longitude: longitude!,
          p_geography: geography,
        },
      );
      if (error) throw error;
      return LpgServiceabilitySchema.parse(data);
    },
  });
}

export function serviceabilityGeography(
  location: PlatformRecord | null,
): Record<string, unknown> {
  if (!location) return {};
  const metadata = nestedRecord(location, "metadata");
  const geography: Record<string, unknown> = metadata ? { ...metadata } : {};
  const formattedAddress = firstString(location, [
    "formatted_address",
    "formattedAddress",
    "address",
  ]);
  if (formattedAddress) geography.formattedAddress = formattedAddress;
  return geography;
}
