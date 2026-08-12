import MapView, { Marker, Polyline, type MapPressEvent } from "react-native-maps";
import { Crosshair } from "lucide-react-native";
import { useCallback, useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radii, spacing } from "../theme/tokens";

export interface MapPoint {
  latitude: number;
  longitude: number;
  label: string;
  kind?: "driver" | "destination" | "pickup" | "station" | "location";
}

export interface OperationalMapProps {
  points: readonly MapPoint[];
  connectPoints?: boolean;
  height?: number;
  initialZoom?: number;
  maxZoom?: number;
  minZoom?: number;
  onSelectPoint?: (point: { latitude: number; longitude: number }) => void;
}

export function OperationalMap({
  points,
  connectPoints = false,
  height = 420,
  initialZoom = points.length > 1 ? 14 : 20,
  maxZoom = 21,
  minZoom = 3,
  onSelectPoint,
}: OperationalMapProps) {
  const map = useRef<MapView>(null);
  const first = points[0];
  const pointKey = points.map((point) => `${point.latitude}:${point.longitude}`).join("|");
  const zoom = clamp(initialZoom, minZoom, maxZoom);

  const focus = useCallback((animated: boolean) => {
    if (!first || !map.current) return;
    if (points.length > 1) {
      map.current.fitToCoordinates([...points], {
        edgePadding: { top: 64, right: 46, bottom: 72, left: 46 },
        animated,
      });
      return;
    }
    map.current.animateCamera(
      { center: first, pitch: 0, heading: 0, zoom },
      { duration: animated ? 320 : 0 },
    );
  }, [first?.latitude, first?.longitude, pointKey, zoom]);

  useEffect(() => {
    focus(true);
  }, [focus]);

  if (!first)
    return (
      <View style={[styles.empty, { height }]}>
        <View style={styles.emptyPin}><View style={styles.emptyDot} /></View>
        <Text style={styles.emptyTitle}>Your precise location will appear here</Text>
      </View>
    );

  const select = (event: MapPressEvent) => onSelectPoint?.(event.nativeEvent.coordinate);
  return (
    <View style={[styles.frame, { height }]}>
      <MapView
        ref={map}
        accessibilityLabel={onSelectPoint ? "Interactive location map" : "Map showing operational locations"}
        style={StyleSheet.absoluteFill}
        initialCamera={{ center: first, pitch: 0, heading: 0, altitude: 0, zoom }}
        minZoomLevel={minZoom}
        maxZoomLevel={maxZoom}
        onMapReady={() => focus(false)}
        onPress={select}
        pitchEnabled
        rotateEnabled={false}
        scrollEnabled
        showsBuildings
        showsCompass
        showsPointsOfInterests
        toolbarEnabled={false}
        zoomControlEnabled
        zoomEnabled
      >
        {points.map((point, index) => {
          const tone = markerColor(point.kind);
          return (
            <Marker
              anchor={{ x: 0.5, y: 1 }}
              coordinate={point}
              key={`${point.latitude}:${point.longitude}:${index}`}
              title={point.label}
            >
              <View style={styles.markerWrap}>
                <View style={[styles.marker, { borderColor: tone }]}>
                  <View style={[styles.markerDot, { backgroundColor: tone }]} />
                </View>
                <View style={[styles.markerTip, { borderTopColor: tone }]} />
              </View>
            </Marker>
          );
        })}
        {connectPoints && points.length > 1
          ? <Polyline coordinates={[...points]} strokeColor={colors.brand} strokeWidth={5} />
          : null}
      </MapView>

      {onSelectPoint
        ? <View pointerEvents="none" style={styles.hint}><Text style={styles.hintText}>Tap the exact entrance or pickup point</Text></View>
        : null}
      <Pressable
        accessibilityLabel="Recenter map"
        onPress={() => focus(true)}
        style={styles.recenter}
      >
        <Crosshair color={colors.ink} size={20} />
      </Pressable>
    </View>
  );
}

function markerColor(kind: MapPoint["kind"]) {
  if (kind === "destination") return colors.success;
  if (kind === "pickup") return "#A96D00";
  if (kind === "station") return "#2256A3";
  return colors.brand;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

const styles = StyleSheet.create({
  frame: { width: "100%", overflow: "hidden", borderRadius: radii.lg, backgroundColor: "#DCE5DF" },
  empty: { width: "100%", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: radii.lg, backgroundColor: "#E8ECE9" },
  emptyPin: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 17, backgroundColor: "white" },
  emptyDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
  emptyTitle: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  markerWrap: { alignItems: "center" },
  marker: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 17, borderWidth: 4, backgroundColor: "white", elevation: 7 },
  markerDot: { width: 10, height: 10, borderRadius: 5 },
  markerTip: { width: 0, height: 0, marginTop: -2, borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 10, borderLeftColor: "transparent", borderRightColor: "transparent" },
  hint: { position: "absolute", left: spacing.sm, top: spacing.sm, maxWidth: "72%", paddingHorizontal: 11, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: "rgba(23,33,27,.84)" },
  hintText: { color: "white", fontSize: 11, fontWeight: "800" },
  recenter: { position: "absolute", right: spacing.sm, top: spacing.sm, width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: "white", elevation: 7 },
});
