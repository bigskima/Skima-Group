import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";

const TASK = "skima-lpg-driver-tracking";
const CONFIG = "skima-lpg-driver-tracking-config";

type TrackingConfig = {
  gateway: string;
  anonKey: string;
  supabaseUrl: string;
  accessToken: string;
  refreshToken: string;
  driverProfileId: string;
  onlineStatus: "online" | "busy";
};

async function refreshSession(config: TrackingConfig): Promise<TrackingConfig> {
  const response = await fetch(
    `${config.supabaseUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=refresh_token`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: config.anonKey,
      },
      body: JSON.stringify({ refresh_token: config.refreshToken }),
    },
  );
  if (!response.ok)
    throw new Error("Driver tracking session could not refresh.");
  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
  };
  if (!body.access_token)
    throw new Error("Driver tracking session is invalid.");
  const updated = {
    ...config,
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? config.refreshToken,
  };
  await SecureStore.setItemAsync(CONFIG, JSON.stringify(updated));
  return updated;
}

async function postLocation(
  config: TrackingConfig,
  location: Location.LocationObject,
): Promise<void> {
  const recordedAt = new Date(location.timestamp).toISOString();
  const request = (accessToken: string) =>
    fetch(`${config.gateway.replace(/\/$/, "")}/lpg/driver-locations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: config.anonKey,
        authorization: `Bearer ${accessToken}`,
        "x-skima-client": "lpg-expo-background",
      },
      body: JSON.stringify({
        driverProfileId: config.driverProfileId,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracyMeters: location.coords.accuracy,
        headingDegrees: location.coords.heading,
        speedMetersPerSecond: location.coords.speed,
        onlineStatus: config.onlineStatus,
        purpose: "active-driver-tracking",
        recordedAt,
        source: "skima.lpg.mobile",
        metadata: { background: true },
        idempotencyKey: `skima:lpg:driver-location:${config.driverProfileId}:${location.timestamp}`,
      }),
    });
  let response = await request(config.accessToken);
  if (response.status === 401) {
    config = await refreshSession(config);
    response = await request(config.accessToken);
  }
  if (!response.ok) {
    throw new Error(`Driver location was rejected (${response.status}).`);
  }
}

TaskManager.defineTask(TASK, async ({ data, error }) => {
  if (error || !data) return;
  const stored = await SecureStore.getItemAsync(CONFIG);
  if (!stored) return;
  let config: TrackingConfig;
  try {
    config = JSON.parse(stored) as TrackingConfig;
  } catch {
    await SecureStore.deleteItemAsync(CONFIG);
    return;
  }
  const locations =
    (data as { locations?: Location.LocationObject[] }).locations ?? [];
  for (const location of locations) await postLocation(config, location);
});

export async function startDriverTracking(
  input: Omit<TrackingConfig, "gateway" | "anonKey" | "supabaseUrl">,
) {
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const gateway =
    process.env.EXPO_PUBLIC_API_GATEWAY_URL ||
    (supabaseUrl
      ? `${supabaseUrl.replace(/\/$/, "")}/functions/v1/api-gateway`
      : null);
  if (!gateway || !anonKey || !supabaseUrl) {
    throw new Error("Background tracking configuration is unavailable.");
  }
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) {
    throw new Error("Location permission is required for dispatch tracking.");
  }
  const background = await Location.requestBackgroundPermissionsAsync();
  if (!background.granted) {
    throw new Error(
      "Background location permission is required while you are online.",
    );
  }
  await SecureStore.setItemAsync(
    CONFIG,
    JSON.stringify({ ...input, gateway, anonKey, supabaseUrl }),
  );
  if (!(await Location.hasStartedLocationUpdatesAsync(TASK))) {
    await Location.startLocationUpdatesAsync(TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 30000,
      distanceInterval: 40,
      pausesUpdatesAutomatically: true,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "SKIMA driver is online",
        notificationBody:
          "Location is shared for authorised dispatch and active fulfilment.",
        notificationColor: "#D7192D",
      },
    });
  }
}

export async function stopDriverTracking() {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TASK)) {
      await Location.stopLocationUpdatesAsync(TASK);
    }
  } finally {
    await SecureStore.deleteItemAsync(CONFIG);
  }
}

export async function isDriverTracking() {
  return Location.hasStartedLocationUpdatesAsync(TASK);
}
