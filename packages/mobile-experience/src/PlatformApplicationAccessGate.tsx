import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { SupabaseClient } from "@supabase/supabase-js";

type Palette = {
  canvas?: string;
  surface?: string;
  border?: string;
  brand?: string;
  brandSoft?: string;
  ink?: string;
  muted?: string;
  danger?: string;
  dangerSoft?: string;
};
type ResolvedLocation = {
  latitude: number;
  longitude: number;
  formattedAddress?: string | null;
  address?: {
    countryCode?: string | null;
    country?: string | null;
    region?: string | null;
    city?: string | null;
    district?: string | null;
    street?: string | null;
  } | null;
};
type GateState =
  | { status: "loading" }
  | { status: "needs-location"; title: string; message: string }
  | { status: "blocked"; title: string; message: string; geographyName: string | null }
  | { status: "error"; message: string }
  | { status: "allowed" };

const fallback = {
  canvas: "#F7F7F8",
  surface: "#FFFFFF",
  border: "#E4E4E7",
  brand: "#E33B55",
  brandSoft: "#FCECEF",
  ink: "#19191D",
  muted: "#74747D",
  danger: "#B42336",
  dangerSoft: "#FCE8EA",
};

/**
 * Enforces the admin-configured driver/station application entry overlay.
 * Read failures are fail-open so an unavailable control-plane endpoint does
 * not break the application itself. Actual submission is independently
 * protected by a database trigger using the same policy resolver.
 */
export function PlatformApplicationAccessGate({
  applicationKey,
  supabase,
  palette,
  resolveLocation,
  children,
}: {
  applicationKey: "driver" | "station";
  supabase: SupabaseClient;
  palette?: Palette;
  resolveLocation: () => Promise<ResolvedLocation>;
  children: ReactNode;
}) {
  const colors = { ...fallback, ...(palette ?? {}) };
  const [state, setState] = useState<GateState>({ status: "loading" });
  const resolveLocationRef = useRef(resolveLocation);
  resolveLocationRef.current = resolveLocation;

  const checkAccess = useCallback(async (location?: ResolvedLocation) => {
    setState({ status: "loading" });
    try {
      const address = location?.address ?? null;
      const names = [
        address?.country,
        address?.region,
        address?.city,
        address?.district,
        location?.formattedAddress,
      ].filter((value): value is string => Boolean(value?.trim()));

      const { data, error } = await supabase.rpc("read_customer_application_access", {
        target_application_key: applicationKey,
        target_latitude: location?.latitude ?? null,
        target_longitude: location?.longitude ?? null,
        target_geography_ids: [],
        target_geography_names: names,
        target_country_code: address?.countryCode?.trim().toUpperCase() || null,
      });
      if (error) throw error;

      const result = data && typeof data === "object" && !Array.isArray(data)
        ? data as Record<string, unknown>
        : {};
      if (result.requiresLocation === true && !location) {
        setState({
          status: "needs-location",
          title: "Check application availability in your area",
          message: "SKIMA has location-specific application rules. Confirm your operating location to see whether new applications are currently accepted there.",
        });
        return;
      }
      if (result.requiresLocation === true && location) {
        setState({
          status: "needs-location",
          title: "We could not match this location yet",
          message: "We could not match your location to the configured service areas. Check your GPS permission and try again, or contact SKIMA Support for help.",
        });
        return;
      }
      if (result.blocked === true) {
        setState({
          status: "blocked",
          title: typeof result.title === "string" && result.title.trim()
            ? result.title
            : "Applications temporarily unavailable",
          message: typeof result.message === "string" && result.message.trim()
            ? result.message
            : "New applications are not available in this area at the moment. Please check again later.",
          geographyName: typeof result.geographyName === "string" ? result.geographyName : null,
        });
        return;
      }
      setState({ status: "allowed" });
    } catch {
      // Existing application functionality remains usable if the new read
      // endpoint is unavailable. The database submission guard still applies.
      setState({ status: "allowed" });
    }
  }, [supabase, applicationKey]);

  useEffect(() => {
    void checkAccess();
  }, [checkAccess]);

  const requestLocation = async () => {
    setState({ status: "loading" });
    try {
      const location = await resolveLocationRef.current();
      await checkAccess(location);
    } catch {
      setState({
        status: "error",
        message: "We could not confirm your operating location. Allow location access and try again.",
      });
    }
  };

  if (state.status === "allowed") return <>{children}</>;

  return (
    <View
      accessibilityViewIsModal
      style={{
        flex: 1,
        justifyContent: "center",
        padding: 22,
        backgroundColor: colors.canvas,
      }}
    >
      <View
        style={{
          borderRadius: 20,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          padding: 20,
          gap: 12,
        }}
      >
        <View style={{
          width: 42,
          height: 42,
          borderRadius: 13,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.brandSoft,
        }}>
          <Text style={{ color: colors.brand, fontSize: 21, fontWeight: "900" }}>!</Text>
        </View>
        <Text style={{ color: colors.ink, fontSize: 19, fontWeight: "900" }}>
          {state.status === "loading"
            ? "Checking application access"
            : state.status === "blocked"
              ? state.title
              : state.status === "needs-location"
                ? state.title
                : "Location check needed"}
        </Text>
        {state.status === "loading" ? (
          <View style={{ paddingVertical: 16, alignItems: "flex-start" }}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : (
          <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 20 }}>
            {state.status === "blocked"
              ? state.message
              : state.status === "error"
                ? state.message
                : state.message}
          </Text>
        )}
        {state.status === "blocked" && state.geographyName ? (
          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "800" }}>
            Affected area: {state.geographyName}
          </Text>
        ) : null}
        {state.status === "needs-location" || state.status === "error" ? (
          <Pressable
            onPress={() => void requestLocation()}
            style={{
              minHeight: 46,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.brand,
              paddingHorizontal: 14,
            }}
          >
            <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "900" }}>
              Check my location
            </Text>
          </Pressable>
        ) : null}
        {state.status === "blocked" ? (
          <Pressable
            onPress={() => void checkAccess()}
            style={{
              minHeight: 44,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: colors.border,
              paddingHorizontal: 14,
            }}
          >
            <Text style={{ color: colors.ink, fontSize: 12, fontWeight: "800" }}>
              Check availability again
            </Text>
          </Pressable>
        ) : null}
        <Text style={{ color: colors.muted, fontSize: 10, lineHeight: 15 }}>
          Existing applications and their status remain available. This control only affects starting or submitting a new {applicationKey} application.
        </Text>
      </View>
    </View>
  );
}
