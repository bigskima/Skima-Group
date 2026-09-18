export const SKIMA_INTERNAL_FULFILLMENT_ID = "00000000-0000-0000-0000-000000000001";

export function isSkimaInternalFulfillmentId(value: string | null | undefined) {
  return value === SKIMA_INTERNAL_FULFILLMENT_ID;
}

export function isSkimaInternalFulfillmentChannel(value: unknown) {
  return value === "skima_internal";
}
