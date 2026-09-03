import { z } from "zod";
import { useLpgConfig } from "../../api/domains";
import { useGatewayMutation } from "../../api/gateway";
import { firstString, nestedRecord } from "../../api/records";
import type { OperationalAddress, OperationalLocation } from "../../device/location";
import { idempotencyKey } from "../../utilities/idempotency";

export const AddressSchema = z.object({
  name: z.string().nullable().optional(),
  landmark: z.string().nullable().optional(),
  premise: z.string().nullable().optional(),
  houseNumber: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  route: z.string().nullable().optional(),
  streetNumber: z.string().nullable().optional(),
  district: z.string().nullable().optional(),
  neighbourhood: z.string().nullable().optional(),
  locality: z.string().nullable().optional(),
  subLocality: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  town: z.string().nullable().optional(),
  village: z.string().nullable().optional(),
  lga: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  stateCode: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  countryCode: z.string().nullable().optional(),
}).passthrough();

export const MapLookupSchema = z.object({
  addressComponents: AddressSchema.nullable().optional(),
  formattedAddress: z.string().nullable().optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }),
  placeId: z.string().nullable().optional(),
  provider: z.string(),
}).passthrough();

export const AutocompleteSchema = z.object({
  predictions: z.array(z.record(z.unknown())),
  provider: z.string(),
}).passthrough();

export const RouteEstimateSchema = z.object({
  distanceMeters: z.number().nonnegative(),
  duration: z.string().nullable().optional(),
  encodedPolyline: z.string().nullable().optional(),
  operation: z.literal("route_estimate"),
  provider: z.string(),
  providerAttribution: z.string().nullable().optional(),
  routeGeometry: z.record(z.unknown()).nullable().optional(),
  staticDuration: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
}).passthrough();

export type AddressPayload = z.infer<typeof AddressSchema>;
export type MapLookup = z.infer<typeof MapLookupSchema>;
type AutocompleteResult = z.infer<typeof AutocompleteSchema>;
type AutocompleteInput = {
  input: string;
  countryComponent?: string;
  idempotencyKey: string;
};
type GeocodeInput = { address: string; idempotencyKey: string };
type ReverseGeocodeInput = { latitude: number; longitude: number; idempotencyKey: string };
type RouteEstimateInput = {
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  idempotencyKey: string;
};

export function useMapsGatewayAdapter() {
  const runtimeConfig = useLpgConfig();
  const geography = nestedRecord(runtimeConfig.data, "geography");
  const configuredCountryComponent = countryComponentFromGeography(geography);

  const autocompleteMutation = useGatewayMutation<AutocompleteResult, AutocompleteInput>({
    path: "/lpg/maps/autocomplete",
    schema: AutocompleteSchema,
  });
  const geocode = useGatewayMutation<MapLookup, GeocodeInput>({
    path: "/lpg/maps/geocode",
    schema: MapLookupSchema,
  });
  const reverseGeocode = useGatewayMutation<MapLookup, ReverseGeocodeInput>({
    path: "/lpg/maps/reverse-geocode",
    schema: MapLookupSchema,
  });
  const routeEstimate = useGatewayMutation<z.infer<typeof RouteEstimateSchema>, RouteEstimateInput>({
    path: "/lpg/maps/route-estimate",
    schema: RouteEstimateSchema,
  });

  return {
    autocomplete: {
      ...autocompleteMutation,
      mutateAsync: (input: AutocompleteInput) =>
        autocompleteMutation.mutateAsync({
          ...input,
          // Geography policy is backend-configured. Screen-level values are never
          // authoritative, which keeps expansion out of client code.
          countryComponent: configuredCountryComponent,
        }),
    },
    geocode,
    reverseGeocode,
    routeEstimate,
    resolveOperationalLocation: async (point: OperationalLocation): Promise<OperationalLocation> => {
      try {
        const lookup = await reverseGeocode.mutateAsync({
          idempotencyKey: idempotencyKey(
            "operational-reverse-location",
            `${point.latitude.toFixed(4)}:${point.longitude.toFixed(4)}`,
          ),
          latitude: point.latitude,
          longitude: point.longitude,
        });
        const providerAddress = operationalAddress(lookup.addressComponents);
        return {
          ...point,
          address: mergeOperationalAddress(providerAddress, point.address),
          formattedAddress: cleanText(lookup.formattedAddress) ?? point.formattedAddress,
          providerPlaceId: lookup.placeId ?? point.providerPlaceId ?? null,
          providerSource: "maps_adapter",
        };
      } catch {
        // Device geocoding and raw coordinates remain safe fallbacks. A provider
        // outage must never block onboarding or location capture.
        return point;
      }
    },
  };
}

function countryComponentFromGeography(
  geography: ReturnType<typeof nestedRecord>,
): string | undefined {
  const configuredCodes = geography?.search_country_codes;
  const firstConfiguredCode = Array.isArray(configuredCodes)
    ? configuredCodes.find((item): item is string => typeof item === "string" && item.trim().length === 2)
    : null;
  const countryCode =
    firstConfiguredCode ??
    firstString(geography, ["default_country_code", "defaultCountryCode"]);

  return countryCode ? `country:${countryCode.trim().toLowerCase()}` : undefined;
}

function operationalAddress(value: AddressPayload | null | undefined): OperationalAddress {
  const route = cleanText(value?.street) ?? cleanText(value?.route);
  const streetNumber = cleanText(value?.streetNumber);
  return {
    name: cleanText(value?.name) ?? cleanText(value?.landmark) ?? cleanText(value?.premise),
    street: streetNumber && route && !route.startsWith(streetNumber)
      ? `${streetNumber} ${route}`
      : route,
    district: cleanText(value?.district) ?? cleanText(value?.locality) ?? cleanText(value?.subLocality),
    city: cleanText(value?.city) ?? cleanText(value?.town) ?? cleanText(value?.village),
    region: cleanText(value?.region) ?? cleanText(value?.state),
    postalCode: cleanText(value?.postalCode),
    country: cleanText(value?.country),
    countryCode: cleanText(value?.countryCode),
    neighbourhood: cleanText(value?.neighbourhood) ?? cleanText(value?.subLocality),
    town: cleanText(value?.town),
    village: cleanText(value?.village),
    lga: cleanText(value?.lga),
    state: cleanText(value?.state) ?? cleanText(value?.region),
    stateCode: cleanText(value?.stateCode),
  };
}

function mergeOperationalAddress(
  primary: OperationalAddress,
  fallback: OperationalAddress,
): OperationalAddress {
  return {
    name: primary.name ?? fallback.name,
    street: primary.street ?? fallback.street,
    district: primary.district ?? fallback.district,
    city: primary.city ?? fallback.city,
    region: primary.region ?? fallback.region,
    postalCode: primary.postalCode ?? fallback.postalCode,
    country: primary.country ?? fallback.country,
    countryCode: primary.countryCode ?? fallback.countryCode,
    neighbourhood: primary.neighbourhood ?? fallback.neighbourhood,
    town: primary.town ?? fallback.town,
    village: primary.village ?? fallback.village,
    lga: primary.lga ?? fallback.lga,
    state: primary.state ?? fallback.state,
    stateCode: primary.stateCode ?? fallback.stateCode,
  };
}

function cleanText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
