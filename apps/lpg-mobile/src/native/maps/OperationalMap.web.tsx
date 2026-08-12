import { Image } from "expo-image";
import { Crosshair, MapPin, Minus, Plus } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
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

const TILE = 256;
const DEFAULT_HEIGHT = 420;
const tileTemplate =
  process.env.EXPO_PUBLIC_MAP_TILE_URL ??
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export function OperationalMap({
  points,
  connectPoints = false,
  height = DEFAULT_HEIGHT,
  initialZoom = points.length > 1 ? 13 : 18,
  maxZoom = 19,
  minZoom = 3,
  onSelectPoint,
}: OperationalMapProps) {
  const { palette } = useAppTheme();
  const [width, setWidth] = useState(720);
  const derivedCenter = useMemo(() => averagePoint(points), [points]);
  const [center, setCenter] = useState(derivedCenter);
  const [zoom, setZoom] = useState(() => clamp(initialZoom, minZoom, maxZoom));
  const pointKey = points.map((point) => `${point.latitude}:${point.longitude}`).join("|");

  useEffect(() => {
    if (!derivedCenter) return;
    setCenter(derivedCenter);
    setZoom(
      points.length > 1
        ? fitZoom(points, width, height, minZoom, maxZoom)
        : clamp(initialZoom, minZoom, maxZoom),
    );
  }, [pointKey, width, height, initialZoom, maxZoom, minZoom]);

  const layout = center ? createLayout(center, points, width, height, zoom) : null;
  const onLayout = (event: LayoutChangeEvent) =>
    setWidth(Math.max(280, event.nativeEvent.layout.width));
  const recenter = () => {
    if (!derivedCenter) return;
    setCenter(derivedCenter);
    setZoom(points.length > 1 ? fitZoom(points, width, height, minZoom, maxZoom) : clamp(initialZoom, minZoom, maxZoom));
  };
  const select = (event: GestureResponderEvent) => {
    if (!center || !onSelectPoint) return;
    const centerPixel = project(center.latitude, center.longitude, zoom);
    const worldX = centerPixel.x + event.nativeEvent.locationX - width / 2;
    const worldY = centerPixel.y + event.nativeEvent.locationY - height / 2;
    onSelectPoint(unproject(worldX, worldY, zoom));
  };

  if (!center || !layout)
    return (
      <View onLayout={onLayout} style={[styles.empty, { height, backgroundColor: palette.soft, borderColor: palette.border }]}>
        <MapPin color={palette.muted} size={32} />
        <Text style={[styles.emptyTitle, { color: palette.ink }]}>Choose a location</Text>
        <Text style={[styles.emptyBody, { color: palette.muted }]}>Use your current location or search for an address to begin.</Text>
      </View>
    );

  return (
    <Pressable
      accessibilityLabel={onSelectPoint ? "Interactive map. Tap to move the selected location pin." : "Map showing SKIMA locations"}
      onLayout={onLayout}
      onPress={select}
      style={[styles.map, { height, borderColor: palette.border }]}
    >
      {layout.tiles.map((tile) => (
        <Image
          key={`${zoom}:${tile.x}:${tile.y}`}
          source={tile.url}
          contentFit="cover"
          style={[styles.tile, { left: tile.left, top: tile.top }]}
          transition={60}
        />
      ))}
      {connectPoints
        ? layout.segments.map((segment, index) => (
            <View
              key={`route:${index}`}
              style={[
                styles.segment,
                {
                  left: segment.left,
                  top: segment.top,
                  width: segment.length,
                  transform: [{ rotate: `${segment.angle}rad` }],
                },
              ]}
            />
          ))
        : null}
      {layout.markers.map((marker, index) => (
        <View key={`${marker.label}:${index}`} pointerEvents="none" style={[styles.marker, { left: marker.left - 60, top: marker.top - 36 }]}>
          <View style={[styles.markerHalo, marker.kind === "destination" && styles.destinationHalo]}>
            <MapPin
              color={markerColor(marker.kind)}
              fill="white"
              size={marker.kind === "driver" ? 36 : 32}
            />
          </View>
          <Text numberOfLines={1} style={styles.markerLabel}>{marker.label}</Text>
        </View>
      ))}
      {onSelectPoint ? <View pointerEvents="none" style={styles.selectionHint}><Text style={styles.selectionHintText}>Tap anywhere to move the pin</Text></View> : null}
      <View style={styles.controls}>
        <Pressable accessibilityLabel="Recenter map" onPress={(event) => { event.stopPropagation(); recenter(); }} style={styles.control}>
          <Crosshair color={colors.ink} size={19} />
        </Pressable>
        <Pressable accessibilityLabel="Zoom map in" onPress={(event) => { event.stopPropagation(); setZoom((value) => Math.min(maxZoom, value + 1)); }} style={styles.control}>
          <Plus color={colors.ink} size={19} />
        </Pressable>
        <Pressable accessibilityLabel="Zoom map out" onPress={(event) => { event.stopPropagation(); setZoom((value) => Math.max(minZoom, value - 1)); }} style={styles.control}>
          <Minus color={colors.ink} size={19} />
        </Pressable>
      </View>
      <View pointerEvents="none" style={styles.zoomBadge}><Text style={styles.zoomText}>Zoom {zoom}</Text></View>
      <Text pointerEvents="none" style={styles.attribution}>© OpenStreetMap contributors</Text>
    </Pressable>
  );
}

function averagePoint(points: readonly MapPoint[]) {
  if (!points.length) return null;
  return {
    latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
    longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length,
  };
}

function fitZoom(points: readonly MapPoint[], width: number, height: number, minimum: number, maximum: number) {
  if (points.length < 2) return maximum;
  for (let zoom = maximum; zoom >= minimum; zoom -= 1) {
    const projected = points.map((point) => project(point.latitude, point.longitude, zoom));
    const xs = projected.map((point) => point.x);
    const ys = projected.map((point) => point.y);
    if (Math.max(...xs) - Math.min(...xs) <= width - 110 && Math.max(...ys) - Math.min(...ys) <= height - 130)
      return zoom;
  }
  return minimum;
}

function createLayout(
  center: { latitude: number; longitude: number },
  points: readonly MapPoint[],
  width: number,
  height: number,
  zoom: number,
) {
  const centerPixel = project(center.latitude, center.longitude, zoom);
  const leftWorld = centerPixel.x - width / 2;
  const topWorld = centerPixel.y - height / 2;
  const firstTileX = Math.floor(leftWorld / TILE);
  const lastTileX = Math.floor((leftWorld + width) / TILE);
  const firstTileY = Math.floor(topWorld / TILE);
  const lastTileY = Math.floor((topWorld + height) / TILE);
  const count = 2 ** zoom;
  const tiles: { x: number; y: number; left: number; top: number; url: string }[] = [];
  for (let y = firstTileY; y <= lastTileY; y += 1)
    for (let x = firstTileX; x <= lastTileX; x += 1) {
      if (y < 0 || y >= count) continue;
      const wrappedX = ((x % count) + count) % count;
      tiles.push({
        x: wrappedX,
        y,
        left: x * TILE - leftWorld,
        top: y * TILE - topWorld,
        url: tileTemplate.replace("{z}", String(zoom)).replace("{x}", String(wrappedX)).replace("{y}", String(y)),
      });
    }
  const markers = points.map((point) => {
    const pixel = project(point.latitude, point.longitude, zoom);
    return { ...point, left: pixel.x - leftWorld, top: pixel.y - topWorld };
  });
  const segments = markers.slice(1).map((point, index) => {
    const previous = markers[index];
    const dx = point.left - previous.left;
    const dy = point.top - previous.top;
    return { left: previous.left, top: previous.top, length: Math.sqrt(dx * dx + dy * dy), angle: Math.atan2(dy, dx) };
  });
  return { tiles, markers, segments };
}

function project(latitude: number, longitude: number, zoom: number) {
  const scale = TILE * 2 ** zoom;
  const boundedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const sin = Math.sin((boundedLatitude * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function unproject(x: number, y: number, zoom: number) {
  const scale = TILE * 2 ** zoom;
  const longitude = x / scale * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y / scale;
  const latitude = 180 / Math.PI * Math.atan(Math.sinh(n));
  return { latitude, longitude };
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
  map: { width: "100%", overflow: "hidden", borderRadius: 28, borderWidth: 1, backgroundColor: "#DCE5DF" },
  tile: { position: "absolute", width: TILE, height: TILE },
  segment: { position: "absolute", height: 5, borderRadius: 3, backgroundColor: colors.brand, transformOrigin: "left center" },
  marker: { position: "absolute", width: 120, alignItems: "center" },
  markerHalo: { alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(237,28,46,.18)" },
  destinationHalo: { backgroundColor: "rgba(18,148,71,.18)" },
  markerLabel: { maxWidth: 120, marginTop: 2, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.pill, overflow: "hidden", color: colors.ink, backgroundColor: "white", fontSize: 11, fontWeight: "900", boxShadow: "0 3px 12px rgba(0,0,0,.14)" },
  controls: { position: "absolute", right: spacing.sm, top: spacing.sm, gap: 5 },
  control: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: "white", boxShadow: "0 4px 14px rgba(0,0,0,.16)" },
  selectionHint: { position: "absolute", top: spacing.sm, left: spacing.sm, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: "rgba(23,33,27,.84)" },
  selectionHintText: { color: "white", fontSize: 12, fontWeight: "800" },
  zoomBadge: { position: "absolute", left: spacing.sm, bottom: spacing.sm, paddingHorizontal: 9, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: "rgba(255,255,255,.9)" },
  zoomText: { color: colors.ink, fontSize: 10, fontWeight: "800" },
  attribution: { position: "absolute", right: 5, bottom: 3, paddingHorizontal: 4, color: colors.ink, backgroundColor: "rgba(255,255,255,.84)", fontSize: 9 },
  empty: { alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: 28, borderWidth: 1 },
  emptyTitle: { fontSize: 18, fontWeight: "900" },
  emptyBody: { maxWidth: 420, paddingHorizontal: spacing.lg, textAlign: "center", lineHeight: 20 },
});
