export type MapRendererProvider = "maplibre" | "web_raster_fallback";

export interface Coordinate {
  latitude: number;
  longitude: number;
}

export const DEFAULT_MAP_CENTER: Coordinate = {
  latitude: 9.082,
  longitude: 8.6753,
};

export interface MapPoint extends Coordinate {
  label: string;
  kind?: "driver" | "destination" | "pickup" | "station" | "location";
}

export interface MapProvider {
  key: string;
  renderer: MapRendererProvider;
}

export interface TileProvider {
  key: string;
  styleUrl: string;
  rasterTileTemplate: string;
  attribution: string;
  maxZoom: number;
}

export interface GeocodingProvider {
  searchPlaces(input: string): Promise<unknown>;
}

export interface ReverseGeocodingProvider {
  reverseGeocode(point: Coordinate): Promise<unknown>;
}

export interface RoutingProvider {
  calculateRoute(points: readonly Coordinate[]): Promise<unknown>;
}

export interface DistanceMatrixProvider {
  calculateDistanceMatrix(points: readonly Coordinate[]): Promise<unknown>;
}

export interface LocationProvider {
  getCurrentLocation(): Promise<Coordinate>;
}

export interface TrackingProvider {
  subscribeToDriverLocation(driverId: string, listener: (point: Coordinate) => void): () => void;
  updateDriverLocation(point: Coordinate): Promise<void>;
}

export interface MapMatchingProvider {
  matchToRoadNetwork(points: readonly Coordinate[]): Promise<readonly Coordinate[]>;
}

export interface MapsRuntimeConfig {
  renderer: MapProvider;
  tile: TileProvider;
  geocodingProviderKey: string;
  reverseGeocodingProviderKey: string;
  routingProviderKey: string;
  distanceMatrixProviderKey: string;
  locationProviderKey: string;
  trackingProviderKey: string;
  mapMatchingProviderKey: string;
}

const KEYLESS_RASTER_TILE_TEMPLATE =
  "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png";
const KEYLESS_MAP_STYLE_URL = "https://demotiles.maplibre.org/style.json";
const KEYLESS_ATTRIBUTION = "© OpenStreetMap contributors, © CARTO";

export function getMapsRuntimeConfig(): MapsRuntimeConfig {
  const tileMaxZoom = Number(process.env.EXPO_PUBLIC_MAP_TILE_MAX_ZOOM);
  const configuredRaster = process.env.EXPO_PUBLIC_MAP_TILE_URL?.trim();
  const configuredStyle = process.env.EXPO_PUBLIC_MAP_STYLE_URL?.trim();
  const safeRaster = isUsablePublicTileTemplate(configuredRaster)
    ? configuredRaster!
    : KEYLESS_RASTER_TILE_TEMPLATE;
  const safeStyle = isUsablePublicStyleUrl(configuredStyle)
    ? configuredStyle!
    : KEYLESS_MAP_STYLE_URL;
  const usingRasterFallback = safeRaster === KEYLESS_RASTER_TILE_TEMPLATE &&
    Boolean(configuredRaster && configuredRaster !== KEYLESS_RASTER_TILE_TEMPLATE);

  return {
    renderer: {
      key: readEnv("EXPO_PUBLIC_MAP_RENDERER_PROVIDER", "maplibre"),
      renderer: "maplibre",
    },
    tile: {
      key: usingRasterFallback
        ? "keyless_raster_fallback"
        : readEnv("EXPO_PUBLIC_MAP_TILE_PROVIDER", "carto_voyager"),
      styleUrl: safeStyle,
      rasterTileTemplate: safeRaster,
      attribution: usingRasterFallback
        ? KEYLESS_ATTRIBUTION
        : readEnv("EXPO_PUBLIC_MAP_ATTRIBUTION", KEYLESS_ATTRIBUTION),
      maxZoom: Number.isFinite(tileMaxZoom) ? clamp(Math.round(tileMaxZoom), 1, 24) : 19,
    },
    geocodingProviderKey: readEnv("EXPO_PUBLIC_MAP_GEOCODING_PROVIDER", "skima_gateway"),
    reverseGeocodingProviderKey: readEnv("EXPO_PUBLIC_MAP_REVERSE_GEOCODING_PROVIDER", "skima_gateway"),
    routingProviderKey: readEnv("EXPO_PUBLIC_MAP_ROUTING_PROVIDER", "skima_gateway"),
    distanceMatrixProviderKey: readEnv("EXPO_PUBLIC_MAP_DISTANCE_MATRIX_PROVIDER", "skima_gateway"),
    locationProviderKey: readEnv("EXPO_PUBLIC_LOCATION_PROVIDER", "expo_location"),
    trackingProviderKey: readEnv("EXPO_PUBLIC_TRACKING_PROVIDER", "skima_gateway"),
    mapMatchingProviderKey: readEnv("EXPO_PUBLIC_MAP_MATCHING_PROVIDER", "skima_gateway"),
  };
}

export function toLngLat(point: Coordinate): [number, number] {
  return [point.longitude, point.latitude];
}

export function fromLngLat(point: readonly [number, number]): Coordinate {
  return { longitude: point[0], latitude: point[1] };
}

export function pointCollection(points: readonly MapPoint[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map((point) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: toLngLat(point) },
      properties: {
        label: point.label,
        kind: point.kind ?? "location",
      },
    })),
  };
}

export function routeCollection(points: readonly Coordinate[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.length > 1
      ? [{
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: points.map(toLngLat),
          },
          properties: { kind: "route" },
        }]
      : [],
  };
}

export function cameraBounds(points: readonly Coordinate[]): [number, number, number, number] | null {
  if (!points.length) return null;
  const longitudes = points.map((point) => point.longitude);
  const latitudes = points.map((point) => point.latitude);
  return [
    Math.min(...longitudes),
    Math.min(...latitudes),
    Math.max(...longitudes),
    Math.max(...latitudes),
  ];
}

export function averageCoordinate(points: readonly Coordinate[]): Coordinate | null {
  if (!points.length) return null;
  return {
    latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
    longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length,
  };
}

export function isUsablePublicTileTemplate(value?: string | null): value is string {
  if (!value) return false;
  const normalized = value.trim();
  if (!/^https:\/\//i.test(normalized)) return false;
  if (!["{z}", "{x}", "{y}"].every((token) => normalized.includes(token))) return false;
  return !requiresPublicMapCredential(normalized);
}

export function isUsablePublicStyleUrl(value?: string | null): value is string {
  if (!value) return false;
  const normalized = value.trim();
  if (!/^https:\/\//i.test(normalized)) return false;
  return !requiresPublicMapCredential(normalized);
}

function requiresPublicMapCredential(value: string) {
  const normalized = value.toLowerCase();
  const credentialMarkers = [
    "{access_token}",
    "{accesstoken}",
    "{api_key}",
    "{apikey}",
    "{key}",
    "access_token=",
    "api_key=",
    "apikey=",
    "token=",
    "key=",
  ];
  const credentialProviders = [
    "locationiq.com",
    "maps.googleapis.com",
    "api.mapbox.com",
    "tiles.mapbox.com",
    "api.maptiler.com",
  ];
  return credentialMarkers.some((marker) => normalized.includes(marker)) ||
    credentialProviders.some((provider) => normalized.includes(provider));
}

function readEnv(key: string, fallback: string) {
  const value = process.env[key]?.trim();
  return value || fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
