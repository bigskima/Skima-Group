type TrackingConfig = {
  gateway: string;
  anonKey: string;
  supabaseUrl: string;
  accessToken: string;
  refreshToken: string;
  driverProfileId: string;
  onlineStatus: "online" | "busy";
};

const CONFIG = "skima:lpg:web-driver-tracking:v1";
let watchId: number | null = null;

async function postPosition(config: TrackingConfig, position: GeolocationPosition) {
  const recordedAt = new Date(position.timestamp).toISOString();
  const response = await fetch(`${config.gateway.replace(/\/$/, "")}/lpg/driver-locations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: config.anonKey,
      authorization: `Bearer ${config.accessToken}`,
      "x-skima-client": "lpg-expo-web-tracking",
    },
    body: JSON.stringify({
      driverProfileId: config.driverProfileId,
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyMeters: position.coords.accuracy,
      headingDegrees: position.coords.heading,
      speedMetersPerSecond: position.coords.speed,
      onlineStatus: config.onlineStatus,
      purpose: "active-driver-tracking",
      recordedAt,
      source: "skima.lpg.web",
      metadata: { background: false, browserLiveTracking: true },
      idempotencyKey: `skima:lpg:web-driver-location:${config.driverProfileId}:${position.timestamp}`,
    }),
  });
  if (!response.ok) throw new Error(`Driver location was rejected (${response.status}).`);
}

export async function startDriverTracking(input: Omit<TrackingConfig, "gateway" | "anonKey" | "supabaseUrl">) {
  if (!navigator.geolocation) throw new Error("This browser does not provide device location.");
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const gateway = process.env.EXPO_PUBLIC_API_GATEWAY_URL || (supabaseUrl ? `${supabaseUrl.replace(/\/$/, "")}/functions/v1/api-gateway` : null);
  if (!gateway || !anonKey || !supabaseUrl) throw new Error("Live tracking is temporarily unavailable. Try again shortly.");
  const config: TrackingConfig = { ...input, gateway, anonKey, supabaseUrl };
  localStorage.setItem(CONFIG, JSON.stringify(config));
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    (position) => void postPosition(config, position).catch(() => undefined),
    () => undefined,
    { enableHighAccuracy: true, maximumAge: 3_000, timeout: 20_000 },
  );
}

export async function stopDriverTracking() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  localStorage.removeItem(CONFIG);
}

export async function isDriverTracking() {
  return watchId !== null;
}
