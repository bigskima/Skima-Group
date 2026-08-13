import { z } from "zod";
import { useGatewayMutation } from "../../api/gateway";

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

export function useMapsGatewayAdapter() {
  return {
    autocomplete: useGatewayMutation({
      path: "/lpg/maps/autocomplete",
      schema: AutocompleteSchema,
    }),
    geocode: useGatewayMutation({
      path: "/lpg/maps/geocode",
      schema: MapLookupSchema,
    }),
    reverseGeocode: useGatewayMutation({
      path: "/lpg/maps/reverse-geocode",
      schema: MapLookupSchema,
    }),
  };
}
