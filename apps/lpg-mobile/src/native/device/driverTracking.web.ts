type TrackingConfig = {
  gateway: string;
  anonKey: string;
  supabaseUrl: string;
  accessToken: string;
  refreshToken: string;
  trackingKind?: "independent" | "station_managed";
  driverProfileId?: string;
  stationDriverId?: string;
  lpgOrderId?: string;
  onlineStatus: "online" | "busy";
};

type IndependentTrackingInput = {
  driverProfileId: string;
  accessToken: string;
  refreshToken: string;
  onlineStatus: "online" | "busy";
};

type StationManagedTrackingInput = {
  stationDriverId: string;
  lpgOrderId: string;
  accessToken: string;
  refreshToken: string;
  onlineStatus?: "busy";
};

const CONFIG = "skima:lpg:web-driver-tracking:v1";
let watchId: number | null = null;

async function refreshSession(config: TrackingConfig): Promise<TrackingConfig> {
  const response = await fetch(
    config.supabaseUrl.replace(/\/$/, "") + "/auth/v1/token?grant_type=refresh_token",
    {
      method: "POST",
      headers: { "content-type": "application/json", apikey: config.anonKey },
      body: JSON.stringify({ refresh_token: config.refreshToken }),
    },
  );
  if (!response.ok) throw new Error("Driver tracking session could not refresh.");
  const body = (await response.json()) as { access_token?: string; refresh_token?: string };
  if (!body.access_token) throw new Error("Driver tracking session is invalid.");
  const updated = { ...config, accessToken: body.access_token, refreshToken: body.refresh_token ?? config.refreshToken };
  localStorage.setItem(CONFIG, JSON.stringify(updated));
  return updated;
}

async function postPosition(initialConfig: TrackingConfig, position: GeolocationPosition) {
  let config = initialConfig;
  const recordedAt = new Date(position.timestamp).toISOString();
  const stationManaged = config.trackingKind === "station_managed";
  if (stationManaged && (!config.stationDriverId || !config.lpgOrderId)) {
    throw new Error("A Station Managed driver and order are required for live tracking.");
  }
  if (!stationManaged && !config.driverProfileId) {
    throw new Error("An approved driver profile is required for live tracking.");
  }
  const identity = stationManaged ? String(config.stationDriverId) + ":" + String(config.lpgOrderId) : String(config.driverProfileId);
  const payload = {
    ...(stationManaged
      ? { stationDriverId: config.stationDriverId, lpgOrderId: config.lpgOrderId }
      : { driverProfileId: config.driverProfileId }),
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyMeters: position.coords.accuracy,
    headingDegrees: position.coords.heading,
    speedMetersPerSecond: position.coords.speed,
    onlineStatus: config.onlineStatus,
    purpose: "active-driver-tracking",
    recordedAt,
    source: stationManaged ? "skima.lpg.station_managed_driver.web" : "skima.lpg.web",
    metadata: { background: false, browserLiveTracking: true, stationManaged },
    idempotencyKey: "skima:lpg:web-driver-location:" + identity + ":" + position.timestamp,
  };
  const send = (token: string) => fetch(config.gateway.replace(/\/$/, "") + "/lpg/driver-locations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: config.anonKey,
      authorization: "Bearer " + token,
      "x-skima-client": "lpg-expo-web-tracking",
    },
    body: JSON.stringify(payload),
  });
  let response = await send(config.accessToken);
  if (response.status === 401) {
    config = await refreshSession(config);
    response = await send(config.accessToken);
  }
  if (!response.ok) throw new Error("Driver location was rejected (" + response.status + ").");
}

async function startTracking(input: Omit<TrackingConfig, "gateway" | "anonKey" | "supabaseUrl">) {
  if (!navigator.geolocation) throw new Error("This browser does not provide device location.");
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const gateway = process.env.EXPO_PUBLIC_API_GATEWAY_URL || (supabaseUrl ? supabaseUrl.replace(/\/$/, "") + "/functions/v1/api-gateway" : null);
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

export async function startDriverTracking(input: IndependentTrackingInput) {
  await startTracking({ ...input, trackingKind: "independent" });
}

export async function startStationManagedDriverTracking(input: StationManagedTrackingInput) {
  await startTracking({ ...input, onlineStatus: input.onlineStatus ?? "busy", trackingKind: "station_managed" });
}

export async function getTrackedStationManagedOrderId(): Promise<string | null> {
  const stored = localStorage.getItem(CONFIG);
  if (!stored) return null;
  try {
    const value = JSON.parse(stored) as TrackingConfig;
    return value.trackingKind === "station_managed" ? value.lpgOrderId ?? null : null;
  } catch {
    localStorage.removeItem(CONFIG);
    return null;
  }
}

export async function stopDriverTracking() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  localStorage.removeItem(CONFIG);
}

export async function isDriverTracking() {
  return watchId !== null;
}
