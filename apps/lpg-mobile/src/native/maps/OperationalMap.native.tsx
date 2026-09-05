import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  NativeUserLocation,
  ViewAnnotation,
  type CameraRef,
} from "@maplibre/maplibre-react-native";
import { Crosshair, MapPin } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  averageCoordinate,
  cameraBounds,
  DEFAULT_MAP_CENTER,
  fromLngLat,
  getMapsRuntimeConfig,
  pointCollection,
  routeCollection,
  toLngLat,
  type MapPoint,
} from "../domains/maps";
import { colors, radii, spacing } from "../theme/tokens";

export type { MapPoint } from "../domains/maps";

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
  const camera = useRef<CameraRef>(null);
  const mapConfig = getMapsRuntimeConfig();
  const first = points[0] ?? averageCoordinate(points) ?? (onSelectPoint ? DEFAULT_MAP_CENTER : null);
  const pointKey = points.map((point) => `${point.latitude}:${point.longitude}`).join("|");
  const zoom = clamp(points.length ? initialZoom : 6, minZoom, maxZoom);
  const markers = useMemo(() => pointCollection(points), [pointKey]);
  const route = useMemo(() => routeCollection(points), [pointKey]);

  const focus = useCallback((animated: boolean) => {
    if (!camera.current || !first) return;
    if (points.length > 1) {
      const bounds = cameraBounds(points);
      if (bounds) {
        camera.current.fitBounds(bounds, {
          padding: { top: 64, right: 46, bottom: 72, left: 46 },
          duration: animated ? 320 : 0,
        });
      }
      return;
    }
    camera.current.easeTo({
      center: toLngLat(first),
      zoom,
      pitch: 0,
      bearing: 0,
      duration: animated ? 320 : 0,
    });
  }, [first?.latitude, first?.longitude, pointKey, zoom]);

  useEffect(() => {
    focus(true);
  }, [focus]);

  if (!first)
    return (
      <View style={[styles.empty, { height }]}>
        <View style={styles.emptyPin}><MapPin color={colors.brand} size={20} /></View>
        <Text style={styles.emptyTitle}>Your precise location will appear here</Text>
      </View>
    );

  return (
    <View style={[styles.frame, { height }]}>
      <Map
        accessibilityLabel={onSelectPoint ? "Interactive location map" : "Map showing relevant locations"}
        attribution
        attributionPosition={{ bottom: 4, left: 8 }}
        compass
        compassPosition={{ top: 10, right: 10 }}
        doubleTapZoom
        dragPan
        logo={false}
        mapStyle={mapConfig.tile.styleUrl}
        onPress={(event) => {
          if (!onSelectPoint) return;
          onSelectPoint(fromLngLat(event.nativeEvent.lngLat));
        }}
        preferredFramesPerSecond={60}
        style={StyleSheet.absoluteFill}
        touchPitch={false}
        touchRotate={false}
        touchZoom
      >
        <Camera
          initialViewState={{
            center: toLngLat(first),
            zoom,
            pitch: 0,
            bearing: 0,
          }}
          maxZoom={maxZoom}
          minZoom={minZoom}
          ref={camera}
        />
        <NativeUserLocation />
        {connectPoints && points.length > 1 ? (
          <GeoJSONSource id="skima-route-source" data={route} lineMetrics>
            <Layer
              id="skima-route-line"
              source="skima-route-source"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{ "line-color": colors.brand, "line-width": 5, "line-opacity": 0.9 }}
            />
          </GeoJSONSource>
        ) : null}
        <GeoJSONSource id="skima-operational-points" data={markers}>
          <Layer
            id="skima-operational-point-halo"
            source="skima-operational-points"
            type="circle"
            paint={{
              "circle-color": "#FFFFFF",
              "circle-radius": 13,
              "circle-stroke-color": ["match", ["get", "kind"], "driver", "#2256A3", "destination", colors.success, "pickup", "#A96D00", colors.brand],
              "circle-stroke-width": 4,
            }}
          />
          <Layer
            id="skima-operational-point-dot"
            source="skima-operational-points"
            type="circle"
            paint={{
              "circle-color": ["match", ["get", "kind"], "driver", "#2256A3", "destination", colors.success, "pickup", "#A96D00", colors.brand],
              "circle-radius": 5,
            }}
          />
        </GeoJSONSource>
        {points.map((point, index) => (
          <ViewAnnotation
            anchor="bottom"
            id={`skima-point-${index}`}
            key={`${point.latitude}:${point.longitude}:${index}`}
            lngLat={toLngLat(point)}
            offset={[0, -18]}
          >
            <Text numberOfLines={1} style={styles.markerLabel}>{point.label}</Text>
          </ViewAnnotation>
        ))}
      </Map>

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

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

const styles = StyleSheet.create({
  frame: { width: "100%", overflow: "hidden", borderRadius: radii.lg, backgroundColor: "#DCE5DF" },
  empty: { width: "100%", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: radii.lg, backgroundColor: "#E8ECE9" },
  emptyPin: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 21, backgroundColor: "white" },
  emptyTitle: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  hint: { position: "absolute", left: spacing.sm, top: spacing.sm, maxWidth: "72%", paddingHorizontal: 11, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: "rgba(23,33,27,.84)" },
  hintText: { color: "white", fontSize: 11, fontWeight: "800" },
  markerLabel: { maxWidth: 120, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.pill, overflow: "hidden", color: colors.ink, backgroundColor: "white", fontSize: 11, fontWeight: "900", elevation: 5 },
  recenter: { position: "absolute", right: spacing.sm, bottom: spacing.sm, width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: "white", elevation: 7 },
});
