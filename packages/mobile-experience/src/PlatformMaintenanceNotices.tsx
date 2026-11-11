import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { SupabaseClient } from "@supabase/supabase-js";

type MaintenanceImpact = "notice" | "degraded" | "unavailable";
type MaintenanceNotice = {
  serviceKey: string;
  impact: MaintenanceImpact;
  title: string;
  message: string;
  geographyName?: string | null;
};
export type MaintenanceNoticePalette = {
  canvas?: string;
  surface?: string;
  border?: string;
  brand?: string;
  brandSoft?: string;
  ink?: string;
  muted?: string;
  warning?: string;
  warningSoft?: string;
  danger?: string;
  dangerSoft?: string;
};

const fallbackPalette: Required<MaintenanceNoticePalette> = {
  canvas: "#111318",
  surface: "#1B1E25",
  border: "#343843",
  brand: "#E63D59",
  brandSoft: "#3A2029",
  ink: "#F5F5F7",
  muted: "#A6A8B1",
  warning: "#D89D39",
  warningSoft: "#362B1B",
  danger: "#F06767",
  dangerSoft: "#3A2225",
};

function parseNotices(value: unknown): MaintenanceNotice[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const items = (value as Record<string, unknown>).items;
  if (!Array.isArray(items)) return [];

  return items.flatMap((item): MaintenanceNotice[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const serviceKey = typeof row.serviceKey === "string" ? row.serviceKey : null;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const message = typeof row.message === "string" ? row.message.trim() : "";
    const rawImpact = row.impact;
    const impact: MaintenanceImpact =
      rawImpact === "unavailable" || rawImpact === "degraded" ? rawImpact : "notice";

    if (!serviceKey || !title || !message) return [];
    return [{
      serviceKey,
      impact,
      title,
      message,
      geographyName: typeof row.geographyName === "string" ? row.geographyName : null,
    }];
  });
}

/**
 * Shared, non-blocking customer banner for platform maintenance notices.
 * The database controls the affected service, message, timing and geography.
 * Errors here are intentionally non-fatal: a notice read must never prevent
 * customers from opening an otherwise available app.
 */
export function PlatformMaintenanceNotices({
  supabase,
  serviceKeys,
  palette,
  latitude = null,
  longitude = null,
  geographyIds = [],
  geographyNames = [],
  countryCode = null,
  resolveLocation,
}: {
  supabase: SupabaseClient;
  serviceKeys: readonly string[];
  palette?: MaintenanceNoticePalette;
  latitude?: number | null;
  longitude?: number | null;
  geographyIds?: readonly string[];
  geographyNames?: readonly string[];
  countryCode?: string | null;
  resolveLocation?: () => Promise<{
    latitude: number;
    longitude: number;
    geographyNames?: string[];
    countryCode?: string | null;
  }>;
}) {
  const [notices, setNotices] = useState<MaintenanceNotice[]>([]);
  const [requiresLocation, setRequiresLocation] = useState(false);
  const [location, setLocation] = useState<{
    latitude: number;
    longitude: number;
    geographyNames?: string[];
    countryCode?: string | null;
  } | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const p = { ...fallbackPalette, ...(palette ?? {}) };
  const serviceKeyToken = useMemo(
    () => Array.from(new Set(serviceKeys.map((key) => key.trim().toLowerCase()).filter(Boolean))).join("|"),
    [serviceKeys],
  );
  const geographyIdToken = useMemo(
    () => Array.from(new Set(geographyIds.filter(Boolean))).join("|"),
    [geographyIds],
  );
  const geographyNameToken = useMemo(
    () => Array.from(new Set(geographyNames.map((name) => name.trim()).filter(Boolean))).join("|"),
    [geographyNames],
  );

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (!serviceKeyToken) {
        if (active) setNotices([]);
        return;
      }
      try {
        const { data, error } = await supabase.rpc("read_customer_service_maintenance", {
          target_service_keys: serviceKeyToken.split("|"),
          target_latitude: location?.latitude ?? latitude,
          target_longitude: location?.longitude ?? longitude,
          target_geography_ids: geographyIdToken ? geographyIdToken.split("|") : [],
          target_geography_names: location?.geographyNames?.length
            ? location.geographyNames
            : geographyNameToken ? geographyNameToken.split("|") : [],
          target_country_code: location?.countryCode ?? countryCode,
        });
        if (error) throw error;
        if (active) {
          setNotices(parseNotices(data));
          setRequiresLocation(Boolean(
            data && typeof data === "object" && !Array.isArray(data) &&
            (data as Record<string, unknown>).requiresLocation === true
          ));
        }
      } catch {
        // Maintenance communication is informative, not an availability gate.
        // If it cannot be fetched, keep the app usable and retry on the next pass.
      }
    };

    void refresh();
    const interval = setInterval(() => void refresh(), 60_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [
    supabase,
    serviceKeyToken,
    latitude,
    longitude,
    geographyIdToken,
    geographyNameToken,
    countryCode,
    location,
  ]);

  const checkLocalNotices = async () => {
    setLocationBusy(true);
    setLocationError(null);
    try {
      if (!resolveLocation) throw new Error("Local location checks are not available in this app.");
      const point = await resolveLocation();
      setLocation({
        latitude: point.latitude,
        longitude: point.longitude,
      });
    } catch {
      setLocationError("Allow location access to check whether this service has a local notice.");
    } finally {
      setLocationBusy(false);
    }
  };

  if (!notices.length && !requiresLocation) return null;

  return (
    <View
      accessibilityRole="summary"
      style={{
        gap: 7,
        paddingHorizontal: 12,
        paddingTop: 8,
        backgroundColor: p.canvas,
      }}
    >
      {notices.map((notice) => {
        const unavailable = notice.impact === "unavailable";
        const accent = unavailable ? p.danger : p.warning;
        const background = unavailable ? p.dangerSoft : p.warningSoft;
        return (
          <View
            key={notice.serviceKey}
            style={{
              borderRadius: 12,
              borderWidth: 1,
              borderColor: accent,
              backgroundColor: background,
              paddingHorizontal: 12,
              paddingVertical: 10,
              gap: 3,
            }}
          >
            <Text style={{ color: accent, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 }}>
              {unavailable ? "SERVICE TEMPORARILY UNAVAILABLE" : notice.impact === "degraded" ? "SERVICE MAY BE INTERRUPTED" : "SERVICE UPDATE"}
            </Text>
            <Text style={{ color: p.ink, fontSize: 12, fontWeight: "900" }}>{notice.title}</Text>
            <Text style={{ color: p.muted, fontSize: 10, lineHeight: 15 }}>{notice.message}</Text>
            {notice.geographyName ? (
              <Text style={{ color: p.muted, fontSize: 9, fontWeight: "700" }}>
                Affected area: {notice.geographyName}
              </Text>
            ) : null}
          </View>
        );
      })}
      {requiresLocation ? (
        <View style={{
          borderRadius: 12,
          borderWidth: 1,
          borderColor: p.border,
          backgroundColor: p.surface,
          paddingHorizontal: 12,
          paddingVertical: 10,
          gap: 7,
        }}>
          <Text style={{ color: p.ink, fontSize: 10, fontWeight: "800" }}>
            Check service notices for your area
          </Text>
          <Text style={{ color: p.muted, fontSize: 9, lineHeight: 14 }}>
            Some maintenance notices apply only to selected locations. Location is checked only when you choose this option.
          </Text>
          {locationError ? <Text style={{ color: p.danger, fontSize: 9 }}>{locationError}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={locationBusy || !resolveLocation}
            onPress={() => void checkLocalNotices()}
            style={{
              minHeight: 36,
              alignSelf: "flex-start",
              paddingHorizontal: 12,
              borderRadius: 9,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: p.brandSoft,
              flexDirection: "row",
              gap: 7,
              opacity: locationBusy || !resolveLocation ? 0.5 : 1,
            }}
          >
            {locationBusy ? <ActivityIndicator size="small" color={p.brand} /> : null}
            <Text style={{ color: p.brand, fontSize: 10, fontWeight: "900" }}>
              {locationBusy ? "Checking…" : location ? "Check my area again" : "Check my area"}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
