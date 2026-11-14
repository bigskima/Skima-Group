import { z } from "zod";

export const PlatformRecordSchema = z.record(z.unknown());
export const RecordArraySchema = z.array(PlatformRecordSchema);
export const RecordObjectSchema = PlatformRecordSchema.nullable();
export type PlatformRecord = z.infer<typeof PlatformRecordSchema>;
export const ActionResponseSchema = z.union([z.string(), PlatformRecordSchema, z.null()]);

export function recordId(record: PlatformRecord): string | null {
  return firstString(record, ["id", "lpgOrderId", "lpg_order_id", "public_reference", "publicReference"]);
}
export function displayReference(record: PlatformRecord): string | null {
  return firstString(record, ["public_reference", "publicReference", "reference", "cylinder_identifier", "cylinderIdentifier", "id"]);
}
export function cylinderPermanentIdentifier(record: PlatformRecord | null | undefined): string | null {
  const identifier = firstString(record, ["cylinder_identifier", "cylinderIdentifier"]);
  if (identifier && !["none", "null", "n/a", "na", "unknown"].includes(identifier.trim().toLowerCase())) {
    return identifier.trim();
  }
  return firstString(record, ["public_reference", "publicReference", "cylinder_reference", "cylinderReference", "reference"]);
}
export function cylinderRegistryReference(record: PlatformRecord | null | undefined): string | null {
  return firstString(record, ["public_reference", "publicReference", "cylinder_reference", "cylinderReference", "reference"]);
}
export function firstNumber(record: PlatformRecord | null | undefined, keys: readonly string[]): number | null {
  for (const key of keys) { const value = record?.[key]; if (typeof value === "number" && Number.isFinite(value)) return value; if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value); }
  return null;
}
export function firstString(record: PlatformRecord | null | undefined, keys: readonly string[]): string | null {
  for (const key of keys) { const value = record?.[key]; if (typeof value === "string" && value.trim()) return value; }
  return null;
}
export function displayTitle(record: PlatformRecord): string {
  return firstString(record, ["display_name", "displayName", "name", "label", "title", "cylinder_identifier", "cylinderIdentifier", "public_reference", "reference", "id"]) ?? "Record";
}
export function displayStatus(record: PlatformRecord): string | null {
  return firstString(record, ["workflow_state", "workflowState", "status", "state", "availability_status"]);
}
export function displaySubtitle(record: PlatformRecord): string | null {
  return displayLocationAddress(record)
    ?? firstString(record, ["address", "description", "station_name", "organization_name", "updated_at", "created_at"]);
}

/**
 * Builds a street-first address for customer and driver surfaces. Older saved
 * locations may have a road name in metadata.addressComponents.name even when
 * the structured street field is blank, so recover that road without
 * mistaking ordinary building/landmark names for streets.
 */
export function displayLocationAddress(record: PlatformRecord | null | undefined): string | null {
  if (!record) return null;
  const metadata = nestedRecord(record, "metadata");
  const components =
    nestedRecord(record, "address")
    ?? nestedRecord(record, "addressComponents")
    ?? nestedRecord(record, "address_components")
    ?? nestedRecord(metadata, "addressComponents")
    ?? nestedRecord(metadata, "address_components")
    ?? nestedRecord(metadata, "addressSnapshot")
    ?? nestedRecord(metadata, "address_snapshot");
  const componentName = firstString(components, ["name"]);
  const street = firstString(record, ["street_line", "streetLine", "street", "route", "road"])
    ?? firstString(components, ["street", "route", "road", "street_name", "streetName"])
    ?? (isLikelyStreetName(componentName) ? componentName : null);
  const houseNumber = firstString(record, ["house_number", "houseNumber", "street_number", "streetNumber"])
    ?? firstString(components, ["houseNumber", "house_number", "streetNumber", "street_number"]);
  const streetLine = street && houseNumber
    && !street.toLocaleLowerCase().startsWith(houseNumber.toLocaleLowerCase() + " ")
    ? houseNumber + " " + street
    : street ?? houseNumber;
  const formatted = firstString(record, ["formatted_address", "formattedAddress", "street_address", "streetAddress", "address"]);
  const locality = [
    firstString(components, ["neighbourhood", "neighborhood", "subLocality", "sub_locality"]),
    firstString(components, ["district", "locality", "city_district", "lga", "county"]),
    firstString(components, ["city", "town", "village"]),
    firstString(components, ["region", "state"]),
    firstString(components, ["country"]),
  ];
  const base = formatted ?? uniqueAddressParts(locality).join(", ");
  if (streetLine) {
    const streetName = street ?? streetLine;
    const normalizedBase = base.toLocaleLowerCase();
    const alreadyIncludesStreet = normalizedBase.includes(streetName.toLocaleLowerCase());
    const alreadyIncludesStreetLine = normalizedBase.includes(streetLine.toLocaleLowerCase());
    if (!base) return streetLine;
    if (!alreadyIncludesStreet && !alreadyIncludesStreetLine) return streetLine + ", " + base;
    if (houseNumber && !normalizedBase.includes(houseNumber.toLocaleLowerCase()) && !alreadyIncludesStreetLine) {
      return streetLine + ", " + base;
    }
  }
  return base || streetLine || null;
}

function isLikelyStreetName(value: string | null): boolean {
  if (!value) return false;
  return /(?:^|\s)(?:road|rd\.?|street|st\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?|close|crescent|cr\.?|way|boulevard|blvd\.?|highway|hwy\.?|expressway|parkway|pkwy\.?|terrace|court|ct\.?|place|pl\.?|square|sq\.?|path|bypass)\.?$/i.test(value.trim());
}

function uniqueAddressParts(values: Array<string | null>) {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const part = value?.trim();
    if (!part) return [];
    const key = part.toLocaleLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [part];
  });
}
export function nestedRecord(record: PlatformRecord | null | undefined, key: string): PlatformRecord | null {
  const value = record?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as PlatformRecord : null;
}
export function nestedRecords(record: PlatformRecord | null | undefined, key: string): PlatformRecord[] {
  const value = record?.[key];
  return Array.isArray(value) ? value.filter((item): item is PlatformRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}
