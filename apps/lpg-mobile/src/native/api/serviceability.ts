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

const MatchedAreaSchema = z.object({
  key: z.string(),
  displayName: z.string(),
  type: z.enum([
    "country",
    "state",
    "lga",
    "city",
    "town",
    "locality",
    "radius",
    "polygon",
  ]),
});

export const LpgServiceabilitySchema = z.object({
  serviceable: z.boolean(),
  status: z.enum(["available", "unavailable"]),
  reason: z.enum(["included_area", "excluded_area", "outside_enabled_area"]),
  matchedArea: MatchedAreaSchema.nullable(),
  partnerOpportunity: z.boolean(),
});

export type LpgServiceability = z.infer<typeof LpgServiceabilitySchema>;

export function useLpgServiceability(location: PlatformRecord | null) {
  const session = useSession();
  const latitude = firstNumber(location, ["latitude", "lat"]);
  const longitude = firstNumber(location, ["longitude", "lng", "lon"]);
  const geography = serviceabilityGeography(location);
  const locationKey = recordId(location);
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
