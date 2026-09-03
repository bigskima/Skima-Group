export type MapsOperation = "autocomplete" | "geocode" | "reverse_geocode" | "route_estimate";

export interface MapsCoordinate {
  readonly latitude: number;
  readonly longitude: number;
}

export interface NormalizedAddressComponents {
  readonly name: string | null;
  readonly landmark: string | null;
  readonly premise: string | null;
  readonly houseNumber: string | null;
  readonly street: string | null;
  readonly route: string | null;
  readonly streetNumber: string | null;
  readonly district: string | null;
  readonly neighbourhood: string | null;
  readonly locality: string | null;
  readonly subLocality: string | null;
  readonly city: string | null;
  readonly town: string | null;
  readonly village: string | null;
  readonly lga: string | null;
  readonly region: string | null;
  readonly state: string | null;
  readonly stateCode: string | null;
  readonly postalCode: string | null;
  readonly country: string | null;
  readonly countryCode: string | null;
}

export interface NormalizedMapLookup {
  readonly addressComponents: NormalizedAddressComponents;
  readonly formattedAddress: string | null;
  readonly location: MapsCoordinate;
  readonly locationType: string | null;
  readonly operation: "geocode" | "reverse_geocode";
  readonly placeId: string | null;
  readonly provider: "locationiq";
  readonly providerAttribution: string;
}

export interface NormalizedAutocompleteResult {
  readonly operation: "autocomplete";
  readonly predictions: readonly Readonly<Record<string, unknown>>[];
  readonly provider: "locationiq";
  readonly providerAttribution: string;
}

export interface NormalizedRouteEstimate {
  readonly distanceMeters: number;
  readonly duration: string;
  readonly encodedPolyline: string | null;
  readonly operation: "route_estimate";
  readonly provider: "locationiq";
  readonly providerAttribution: string;
  readonly routeGeometry: Readonly<Record<string, unknown>> | null;
  readonly staticDuration: string;
  readonly summary: string | null;
}

export interface ProviderResult<TData> {
  readonly data: TData;
  readonly latencyMs: number;
}

export interface LocationIqMapsAdapterConfig {
  readonly accessToken: string;
  readonly autocompleteBaseUrl: string;
  readonly geocodingBaseUrl: string;
  readonly routingBaseUrl: string;
  readonly countryCodes: readonly string[];
  readonly language: string;
  readonly autocompleteResultLimit: number;
  readonly timeoutMs: number;
  readonly retryCount: number;
  readonly attribution: string;
  readonly fetcher?: typeof fetch;
}

export interface LocationIqMapsAdapter {
  readonly key: "provider.maps.locationiq";
  autocomplete(input: string): Promise<ProviderResult<NormalizedAutocompleteResult>>;
  geocode(address: string): Promise<ProviderResult<NormalizedMapLookup>>;
  reverseGeocode(point: MapsCoordinate): Promise<ProviderResult<NormalizedMapLookup>>;
  routeEstimate(
    origin: MapsCoordinate,
    destination: MapsCoordinate,
  ): Promise<ProviderResult<NormalizedRouteEstimate>>;
}

export type LocationProviderErrorCode =
  | "invalid_request"
  | "not_found"
  | "provider_authentication_failed"
  | "provider_rate_limited"
  | "provider_timeout"
  | "provider_unavailable"
  | "provider_response_invalid";

export class LocationProviderError extends Error {
  readonly code: LocationProviderErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(
    code: LocationProviderErrorCode,
    message: string,
    httpStatus: number,
    retryable = false,
  ) {
    super(message);
    this.name = "LocationProviderError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

export function createLocationIqMapsAdapter(
  configuration: LocationIqMapsAdapterConfig,
): LocationIqMapsAdapter {
  const accessToken = requiredSecret(configuration.accessToken);
  const autocompleteBaseUrl = allowedBaseUrl(configuration.autocompleteBaseUrl);
  const geocodingBaseUrl = allowedBaseUrl(configuration.geocodingBaseUrl);
  const routingBaseUrl = allowedBaseUrl(configuration.routingBaseUrl);
  const countryCodes = configuration.countryCodes
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[a-z]{2}$/.test(value));
  const language = /^[a-z]{2}$/i.test(configuration.language.trim())
    ? configuration.language.trim().toLowerCase()
    : "en";
  const resultLimit = clamp(Math.round(configuration.autocompleteResultLimit), 1, 20);
  const timeoutMs = clamp(Math.round(configuration.timeoutMs), 1_000, 20_000);
  const retryCount = clamp(Math.round(configuration.retryCount), 0, 2);
  const attribution = configuration.attribution.trim() || "LocationIQ; OpenStreetMap contributors";
  const fetcher = configuration.fetcher ?? globalThis.fetch.bind(globalThis);

  const providerGet = async (url: URL): Promise<ProviderResult<unknown>> => {
    url.searchParams.set("key", accessToken);
    const startedAt = performance.now();
    let lastError: LocationProviderError | null = null;

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetcher(url, {
          headers: { accept: "application/json" },
          method: "GET",
          signal: controller.signal,
        });
        const payload = await readJson(response);
        if (!response.ok) throw providerHttpError(response.status, payload);
        return {
          data: payload,
          latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        };
      } catch (cause) {
        const error = normalizeProviderError(cause);
        lastError = error;
        if (!error.retryable || attempt >= retryCount) throw error;
        await shortBackoff(attempt);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError ?? new LocationProviderError(
      "provider_unavailable",
      "The address service is temporarily unavailable.",
      503,
      true,
    );
  };

  return {
    key: "provider.maps.locationiq",

    async autocomplete(input) {
      const query = requiredText(
        input,
        "Enter at least three characters to search for an address.",
      );
      if (query.length < 3 || query.length > 200) {
        throw new LocationProviderError(
          "invalid_request",
          "Enter between 3 and 200 characters to search for an address.",
          400,
        );
      }
      const url = endpointUrl(autocompleteBaseUrl, "autocomplete");
      url.searchParams.set("q", query);
      url.searchParams.set("limit", String(resultLimit));
      url.searchParams.set("normalizecity", "1");
      url.searchParams.set("accept-language", language);
      if (countryCodes.length) url.searchParams.set("countrycodes", countryCodes.join(","));

      const response = await providerGet(url);
      const results = requireArray(response.data);
      return {
        latencyMs: response.latencyMs,
        data: {
          operation: "autocomplete",
          predictions: results.flatMap((value) => {
            const result = optionalRecord(value);
            if (!result) return [];
            const description = optionalText(result.display_name);
            const coordinate = readCoordinate(result);
            if (!description || !coordinate) return [];
            const normalized = normalizeLookup(result, "geocode", attribution);
            const mainText = optionalText(result.display_place) ??
              description.split(",")[0]?.trim() ?? description;
            const secondaryText = optionalText(result.display_address) ??
              description.slice(mainText.length).replace(/^,\s*/, "");
            return [{
              description,
              addressComponents: normalized.addressComponents,
              formattedAddress: normalized.formattedAddress,
              location: coordinate,
              matchedSubstrings: [{ length: Math.min(query.length, mainText.length), offset: 0 }],
              placeId: providerReference(result),
              provider: "locationiq",
              structuredFormatting: { mainText, secondaryText },
            }];
          }),
          provider: "locationiq",
          providerAttribution: attribution,
        },
      };
    },

    async geocode(address) {
      const query = requiredText(address, "Enter an address to locate.");
      if (query.length > 500) {
        throw new LocationProviderError("invalid_request", "The address is too long.", 400);
      }
      const url = endpointUrl(geocodingBaseUrl, "search");
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("normalizeaddress", "1");
      url.searchParams.set("normalizecity", "1");
      url.searchParams.set("limit", "1");
      url.searchParams.set("accept-language", language);
      if (countryCodes.length) url.searchParams.set("countrycodes", countryCodes.join(","));

      const response = await providerGet(url);
      const first = optionalRecord(requireArray(response.data)[0]);
      if (!first) throw notFoundError();
      return {
        latencyMs: response.latencyMs,
        data: normalizeLookup(first, "geocode", attribution),
      };
    },

    async reverseGeocode(point) {
      validateCoordinate(point);
      const url = endpointUrl(geocodingBaseUrl, "reverse");
      url.searchParams.set("lat", String(point.latitude));
      url.searchParams.set("lon", String(point.longitude));
      url.searchParams.set("format", "json");
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("normalizeaddress", "1");
      url.searchParams.set("normalizecity", "1");
      url.searchParams.set("accept-language", language);

      const response = await providerGet(url);
      const result = optionalRecord(response.data);
      if (!result) throw notFoundError();
      return {
        latencyMs: response.latencyMs,
        data: normalizeLookup(result, "reverse_geocode", attribution),
      };
    },

    async routeEstimate(origin, destination) {
      validateCoordinate(origin);
      validateCoordinate(destination);
      const coordinates =
        `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
      const url = endpointUrl(routingBaseUrl, `directions/driving/${coordinates}`);
      url.searchParams.set("alternatives", "false");
      url.searchParams.set("steps", "false");
      url.searchParams.set("geometries", "geojson");
      url.searchParams.set("overview", "simplified");

      const response = await providerGet(url);
      const payload = requireRecord(response.data);
      const providerCode = optionalText(payload.code)?.toLowerCase();
      if (providerCode && providerCode !== "ok") {
        if (providerCode === "noroute") {
          throw notFoundError("No road route was found for those points.");
        }
        throw new LocationProviderError(
          "provider_unavailable",
          "A route could not be calculated right now.",
          503,
        );
      }
      const routeValues = Array.isArray(payload.routes)
        ? payload.routes
        : optionalRecord(payload.routes)
        ? [payload.routes]
        : [];
      const route = optionalRecord(routeValues[0]);
      if (!route) throw notFoundError("No road route was found for those points.");
      const distanceMeters = finiteNumber(route.distance);
      const durationSeconds = finiteNumber(route.duration);
      if (distanceMeters === null || durationSeconds === null) {
        throw invalidResponseError();
      }
      const geometry = optionalRecord(route.geometry);
      const summary = optionalText(route.summary) ?? routeSummary(route.legs);
      const roundedDuration = Math.max(0, Math.round(durationSeconds));
      return {
        latencyMs: response.latencyMs,
        data: {
          distanceMeters: Math.max(0, Math.round(distanceMeters)),
          duration: `${roundedDuration}s`,
          encodedPolyline: typeof route.geometry === "string" ? route.geometry : null,
          operation: "route_estimate",
          provider: "locationiq",
          providerAttribution: attribution,
          routeGeometry: geometry,
          staticDuration: `${roundedDuration}s`,
          summary,
        },
      };
    },
  };
}

function normalizeLookup(
  result: Readonly<Record<string, unknown>>,
  operation: "geocode" | "reverse_geocode",
  attribution: string,
): NormalizedMapLookup {
  const location = readCoordinate(result);
  if (!location) throw invalidResponseError();
  const address = optionalRecord(result.address) ?? {};
  const route = firstText(address, ["road", "pedestrian", "footway", "path"]);
  const streetNumber = firstText(address, ["house_number"]);
  const premise = firstText(address, ["building", "amenity", "shop", "office"]);
  const name = firstText(address, ["name", "attraction", "tourism"]) ??
    optionalText(result.display_place) ?? premise;
  const district = firstText(address, [
    "city_district",
    "district",
    "suburb",
    "neighbourhood",
    "quarter",
    "county",
  ]);
  const neighbourhood = firstText(address, ["neighbourhood", "suburb", "quarter"]);
  const city = firstText(address, ["city", "municipality", "locality"]);
  const town = firstText(address, ["town"]);
  const village = firstText(address, ["village", "hamlet"]);
  const lga = firstText(address, ["county", "state_district", "city_district"]);
  const region = firstText(address, ["state", "state_district", "region"]);
  const stateCode = firstText(address, ["state_code", "ISO3166-2-lvl4", "ISO3166-2-lvl3"]);
  const countryCode = firstText(address, ["country_code"])?.toUpperCase() ?? null;

  return {
    addressComponents: {
      name,
      landmark: name,
      premise,
      houseNumber: streetNumber,
      street: [streetNumber, route].filter(Boolean).join(" ") || route,
      route,
      streetNumber,
      district,
      neighbourhood,
      locality: district,
      subLocality: neighbourhood,
      city: city ?? town ?? village,
      town,
      village,
      lga,
      region,
      state: region,
      stateCode,
      postalCode: firstText(address, ["postcode", "postal_code"]),
      country: firstText(address, ["country"]),
      countryCode,
    },
    formattedAddress: optionalText(result.display_name),
    location,
    locationType: optionalText(result.type) ?? optionalText(result.class),
    operation,
    placeId: providerReference(result),
    provider: "locationiq",
    providerAttribution: attribution,
  };
}

function readCoordinate(value: Readonly<Record<string, unknown>>): MapsCoordinate | null {
  const latitude = finiteNumber(value.lat);
  const longitude = finiteNumber(value.lon);
  if (latitude === null || longitude === null) return null;
  const point = { latitude, longitude };
  try {
    validateCoordinate(point);
    return point;
  } catch {
    return null;
  }
}

function validateCoordinate(point: MapsCoordinate): void {
  if (
    !Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90 ||
    !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180
  ) {
    throw new LocationProviderError("invalid_request", "Choose a valid map location.", 400);
  }
}

function providerReference(value: Readonly<Record<string, unknown>>): string | null {
  const placeId = optionalText(value.place_id);
  if (placeId) return `locationiq:${placeId}`;
  const osmId = optionalText(value.osm_id);
  const osmType = optionalText(value.osm_type);
  return osmId ? `locationiq:${osmType ?? "osm"}:${osmId}` : null;
}

function routeSummary(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    const leg = optionalRecord(item);
    const summary = leg ? optionalText(leg.summary) : null;
    if (summary) return summary;
  }
  return null;
}

function allowedBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LocationProviderError(
      "provider_unavailable",
      "The address service is not configured correctly.",
      503,
    );
  }
  if (
    url.protocol !== "https:" ||
    (url.hostname !== "locationiq.com" && !url.hostname.endsWith(".locationiq.com"))
  ) {
    throw new LocationProviderError(
      "provider_unavailable",
      "The address service is not configured correctly.",
      503,
    );
  }
  return url;
}

function endpointUrl(base: URL, path: string): URL {
  const root = base.toString().replace(/\/$/, "");
  return new URL(`${root}/${path.replace(/^\//, "")}`);
}

function providerHttpError(status: number, payload: unknown): LocationProviderError {
  if (status === 400 || status === 404) {
    return notFoundError();
  }
  if (status === 401 || status === 403) {
    return new LocationProviderError(
      "provider_authentication_failed",
      "The address service is temporarily unavailable.",
      503,
    );
  }
  if (status === 429) {
    return new LocationProviderError(
      "provider_rate_limited",
      "Address lookup is busy. Wait a moment and try again.",
      429,
    );
  }
  const providerMessage = optionalText(optionalRecord(payload)?.error) ??
    optionalText(optionalRecord(payload)?.message);
  return new LocationProviderError(
    "provider_unavailable",
    providerMessage && status < 500
      ? "The address could not be resolved. Check it and try again."
      : "The address service is temporarily unavailable.",
    status >= 500 ? 503 : 502,
    status >= 500,
  );
}

function normalizeProviderError(cause: unknown): LocationProviderError {
  if (cause instanceof LocationProviderError) return cause;
  if (cause instanceof DOMException && cause.name === "AbortError") {
    return new LocationProviderError(
      "provider_timeout",
      "Address lookup took too long. Try again.",
      504,
      true,
    );
  }
  return new LocationProviderError(
    "provider_unavailable",
    "The address service is temporarily unavailable.",
    503,
    true,
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw invalidResponseError();
  }
}

function notFoundError(message = "No matching address was found."): LocationProviderError {
  return new LocationProviderError("not_found", message, 404);
}

function invalidResponseError(): LocationProviderError {
  return new LocationProviderError(
    "provider_response_invalid",
    "The address service returned an invalid response.",
    502,
  );
}

function requiredSecret(value: string): string {
  if (!value.trim()) {
    throw new LocationProviderError(
      "provider_authentication_failed",
      "The address service is temporarily unavailable.",
      503,
    );
  }
  return value.trim();
}

function requiredText(value: string, message: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) throw new LocationProviderError("invalid_request", message, 400);
  return normalized;
}

function requireArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw invalidResponseError();
  return value;
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  const result = optionalRecord(value);
  if (!result) throw invalidResponseError();
  return result;
}

function optionalRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function optionalText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function firstText(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = optionalText(record[key]);
    if (value) return value;
  }
  return null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
    ? Number(value)
    : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function shortBackoff(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
}
