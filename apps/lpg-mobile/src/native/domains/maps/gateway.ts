import { z } from "zod";
import { useLpgConfig } from "../../api/domains";
import { useGatewayMutation } from "../../api/gateway";
import { firstString, nestedRecord } from "../../api/records";

export const AddressSchema = z.object({
  name: z.string().nullable().optional(),
  landmark: z.string().nullable().optional(),
  premise: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  route: z.string().nullable().optional(),
  streetNumber: z.string().nullable().optional(),
  district: z.string().nullable().optional(),
  locality: z.string().nullable().optional(),
  subLocality: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
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
