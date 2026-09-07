import { useEffect, useState } from "react";

import {
  firstNumber,
  firstString,
  nestedRecord,
  type PlatformRecord,
} from "../../api/records";
import { idempotencyKey } from "../../utilities/idempotency";
import { useMapsGatewayAdapter } from "./gateway";

type LocationPoint = { latitude: number; longitude: number };

const GENERIC_LOCATION_LABELS = new Set([
  "home",
  "work",
  "pickup",
  "return",
  "delivery",
  "saved location",
  "saved order location",
  "selected map location",
  "station location",
]);

export function useResolvedLocationLabel(
  record: PlatformRecord | null,
  fallback: string,
  scope: string,
): string {
  const maps = useMapsGatewayAdapter();
  const storedLabel = readableStoredLocationLabel(record);
  const point = locationCoordinates(record);
  const pointKey = point
    ? `${point.latitude.toFixed(6)}:${point.longitude.toFixed(6)}`
    : "none";
  const [resolution, setResolution] = useState<{
    key: string;
    label: string | null;
  } | null>(null);

  useEffect(() => {
    let active = true;

    if (storedLabel || !point) {
      setResolution(null);
      return () => {
        active = false;
      };
    }

    setResolution((current) => current?.key === pointKey ? current : null);
    void maps.reverseGeocode.mutateAsync({
      latitude: point.latitude,
      longitude: point.longitude,
      idempotencyKey: idempotencyKey("display-reverse-geocode", `${scope}:${pointKey}`),
    }).then((lookup) => {
      if (!active) return;
      const direct = cleanReadableLabel(lookup.formattedAddress);
      const components = formatAddressRecord(
        lookup.addressComponents as unknown as PlatformRecord | null,
      );
      setResolution({ key: pointKey, label: direct ?? components });
    }).catch(() => {
      if (active) setResolution({ key: pointKey, label: null });
    });

    return () => {
      active = false;
    };
    // The point and stored label are the authoritative dependencies. The gateway
    // mutation is intentionally not included because its wrapper may be recreated
    // while React Query keeps the actual mutation behavior stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point?.latitude, point?.longitude, pointKey, scope, storedLabel]);

  if (storedLabel) return storedLabel;
  if (!point) return fallback;
  if (resolution?.key === pointKey) return resolution.label ?? fallback;
  return "Finding the address…";
}

export function readableStoredLocationLabel(
  record: PlatformRecord | null,
): string | null {
  if (!record) return null;

  for (const keySet of [
    ["formattedAddress", "formatted_address", "fullAddress", "full_address"],
    ["addressText", "address_text", "streetAddress", "street_address"],
  ] as const) {
    const value = cleanReadableLabel(firstString(record, [...keySet]));
    if (value) return value;
  }

  const address =
    nestedRecord(record, "address") ??
    nestedRecord(record, "addressComponents") ??
    nestedRecord(record, "address_components");
  const fromComponents = formatAddressRecord(address);
  if (fromComponents) return fromComponents;

  const label = cleanReadableLabel(
    firstString(record, ["label", "landmark", "name"]),
  );
  if (label && !GENERIC_LOCATION_LABELS.has(label.toLowerCase())) return label;
  return null;
}

export function locationCoordinates(
  record: PlatformRecord | null,
): LocationPoint | null {
  if (!record) return null;
  const nestedLocation =
    nestedRecord(record, "location") ??
    nestedRecord(record, "coordinates");
  const latitude =
    firstNumber(record, ["latitude", "lat"]) ??
    firstNumber(nestedLocation, ["latitude", "lat"]);
  const longitude =
    firstNumber(record, ["longitude", "lng", "lon"]) ??
    firstNumber(nestedLocation, ["longitude", "lng", "lon"]);

  return latitude !== null && longitude !== null
    ? { latitude, longitude }
    : null;
}

export function isInternalLocationLabel(value: string): boolean {
  const normalized = value.trim();
  return (
    /sandbox\s+location/i.test(normalized) ||
    /(?:latitude|longitude)\s*[:=]/i.test(normalized) ||
    /^-?\d{1,3}(?:\.\d+)?\s*[,/]\s*-?\d{1,3}(?:\.\d+)?$/i.test(normalized)
  );
}

function cleanReadableLabel(value: string | null): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized && !isInternalLocationLabel(normalized) ? normalized : null;
}

function formatAddressRecord(record: PlatformRecord | null): string | null {
  if (!record) return null;

  const direct = cleanReadableLabel(
    firstString(record, ["formattedAddress", "formatted_address"]),
  );
  if (direct) return direct;

  const parts = [
    firstString(record, ["houseNumber", "house_number", "streetNumber", "street_number"]),
    firstString(record, ["street", "road", "route"]),
    firstString(record, ["name", "premise", "landmark"]),
    firstString(record, ["neighbourhood", "neighborhood", "district", "subLocality", "sub_locality"]),
    firstString(record, ["locality", "city", "town", "village"]),
    firstString(record, ["lga"]),
    firstString(record, ["region", "state"]),
    firstString(record, ["postalCode", "postal_code"]),
    firstString(record, ["country"]),
  ].filter((part): part is string => Boolean(part));

  const seen = new Set<string>();
  const unique = parts.filter((part) => {
    const key = part.trim().toLowerCase();
    if (!key || seen.has(key) || isInternalLocationLabel(part)) return false;
    seen.add(key);
    return true;
  });

  return unique.length ? unique.join(", ") : null;
}
