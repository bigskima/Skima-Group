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
import {
  averageCoordinate,
  DEFAULT_MAP_CENTER,
  getMapsRuntimeConfig,
  type MapPoint,
} from "../domains/maps";
import { useAppTheme } from "../theme/ThemeProvider";
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

const TILE = 256;
const DEFAULT_HEIGHT = 420;
const EMERGENCY_RASTER_TILE_TEMPLATE =
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const EMERGENCY_ATTRIBUTION = "© OpenStreetMap contributors";

export function OperationalMap({
  points,
  connectPoints = false,
  height = DEFAULT_HEIGHT,
  initialZoom = points.length > 1 ? 13 : 20,
  maxZoom,
  minZoom = 3,
  onSelectPoint,
}: OperationalMapProps) {
  const { palette } = useAppTheme();
  const mapConfig = getMapsRuntimeConfig();
  const providerTileMaxZoom = mapConfig.tile.maxZoom;
  const effectiveMaxZoom = maxZoom ?? Math.max(21, providerTileMaxZoom);
  const [width, setWidth] = useState(720);
  const [useEmergencyTiles, setUseEmergencyTiles] = useState(false);
  const tileTemplate = useEmergencyTiles
    ? EMERGENCY_RASTER_TILE_TEMPLATE
    : mapConfig.tile.rasterTileTemplate;
  const attribution = useEmergencyTiles
    ? EMERGENCY_ATTRIBUTION
    : mapConfig.tile.attribution;
  const derivedCenter = useMemo(
    () => averageCoordinate(points) ?? (onSelectPoint ? DEFAULT_MAP_CENTER : null),
    [points, onSelectPoint],
  );
  const automaticZoom = points.length ? initialZoom : 6;
  const [center, setCenter] = useState(derivedCenter);
  const [zoom, setZoom] = useState(() => clamp(automaticZoom, minZoom, effectiveMaxZoom));
  const pointKey = points.map((point) => `${point.latitude}:${point.longitude}`).join("|");

  useEffect(() => {
    setUseEmergencyTiles(false);
  }, [mapConfig.tile.rasterTileTemplate]);

  useEffect(() => {
    if (!derivedCenter) return;
    setCenter(derivedCenter);
    setZoom(points.length > 1
      ? fitZoom(points, width, height, minZoom, effectiveMaxZoom)
      : clamp(points.length ? initialZoom : 6, minZoom, effectiveMaxZoom));
  }, [derivedCenter, pointKey, width, height, initialZoom, effectiveMaxZoom, minZoom]);

  const layout = center
    ? createLayout(center, points, width, height, zoom, tileTemplate, providerTileMaxZoom)
    : null;
  const onLayout = (event: LayoutChangeEvent) =>
    setWidth(Math.max(280, event.nativeEvent.layout.width));
  const recenter = () => {
    if (!derivedCenter) return;
    setCenter(derivedCenter);
    setZoom(points.length > 1
      ? fitZoom(points, width, height, minZoom, effectiveMaxZoom)
      : clamp(points.length ? initialZoom : 6, minZoom, effectiveMaxZoom));
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
        <View style={[styles.emptyPin, { backgroundColor: palette.elevated }]}><MapPin color={colors.brand} size={24} /></View>
        <Text style={[styles.emptyTitle, { color: palette.ink }]}>Your precise location will appear here</Text>
        <Text style={[styles.emptyBody, { color: palette.muted }]}>Use your current location or search for an address to begin.</Text>
      </View>
    );

  return (
    <Pressable
      accessibilityLabel={onSelectPoint ? "Interactive map. Tap to move the location pin." : "Map showing relevant locations"}
      onLayout={onLayout}
      onPress={select}
      style={[styles.map, { height, borderColor: palette.border }]}
    >
      {layout.tiles.map((tile) => (
        <Image
          key={`${tile.zoom}:${tile.x}:${tile.y}:${tile.left}`}
          source={tile.url}
          contentFit="cover"
          onError={() => setUseEmergencyTiles(true)}
          style={[styles.tile, { left: tile.left, top: tile.top, width: tile.size, height: tile.size }]}
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
      {layout.markers.map((marker, index) => {
        const tone = markerColor(marker.kind);
        return (
          <View
            key={`${marker.label}:${index}`}
            pointerEvents="none"
            style={[styles.markerWrap, { left: marker.left - 60, top: marker.top - 44 }]}
          >
            <View style={[styles.marker, { borderColor: tone }]}><View style={[styles.markerDot, { backgroundColor: tone }]} /></View>
            <View style={[styles.markerTip, { borderTopColor: tone }]} />
            <Text numberOfLines={1} style={styles.markerLabel}>{marker.label}</Text>
          </View>
        );
      })}
      {onSelectPoint
        ? <View pointerEvents="none" style={styles.selectionHint}><Text style={styles.selectionHintText}>Tap the exact entrance or pickup point</Text></View>
        : null}
      <View style={styles.controls}>
        <Pressable accessibilityLabel="Recenter map" onPress={(event) => { event.stopPropagation(); recenter(); }} style={styles.control}>
          <Crosshair color={colors.ink} size={19} />
        </Pressable>
        <Pressable accessibilityLabel="Zoom map in" onPress={(event) => { event.stopPropagation(); setZoom((value) => Math.min(effectiveMaxZoom, value + 1)); }} style={styles.control}>
          <Plus color={colors.ink} size={19} />
        </Pressable>
        <Pressable accessibilityLabel="Zoom map out" onPress={(event) => { event.stopPropagation(); setZoom((value) => Math.max(minZoom, value - 1)); }} style={styles.control}>
          <Minus color={colors.ink} size={19} />
        </Pressable>
      </View>
      <View pointerEvents="none" style={styles.zoomBadge}><Text style={styles.zoomText}>{onSelectPoint ? "Pinpoint mode" : "Map view"}</Text></View>
      <Text pointerEvents="none" style={styles.attribution}>{attribution}</Text>
    </Pressable>
  );
}

function fitZoom(points: readonly MapPoint[], width: number, height: number, minimum: number, maximum: number) {
  if (points.length < 2) return maximum;
  for (let zoom = maximum; zoom >= minimum; zoom -= 1) {
    const projected = points.map((point) => project(point.latitude, point.longitude, zoom));
    const xs = projected.map((point) => point.x);
    const ys = projected.map((point) => point.y);
    if (Math.max(...xs) - Math.min(...xs) <= width - 110
      && Math.max(...ys) - Math.min(...ys) <= height - 130)
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
  tileTemplate: string,
  tileMaxZoom: number,
) {
  const sourceZoom = Math.min(zoom, tileMaxZoom);
  const tileSize = TILE * 2 ** (zoom - sourceZoom);
  const centerPixel = project(center.latitude, center.longitude, zoom);
  const leftWorld = centerPixel.x - width / 2;
  const topWorld = centerPixel.y - height / 2;
  const firstTileX = Math.floor(leftWorld / tileSize);
  const lastTileX = Math.floor((leftWorld + width) / tileSize);
  const firstTileY = Math.floor(topWorld / tileSize);
  const lastTileY = Math.floor((topWorld + height) / tileSize);
  const count = 2 ** sourceZoom;
  const tiles: { x: number; y: number; left: number; top: number; size: number; zoom: number; url: string }[] = [];
  for (let y = firstTileY; y <= lastTileY; y += 1)
    for (let x = firstTileX; x <= lastTileX; x += 1) {
      if (y < 0 || y >= count) continue;
      const wrappedX = ((x % count) + count) % count;
      tiles.push({
        x: wrappedX,
        y,
        left: x * tileSize - leftWorld,
        top: y * tileSize - topWorld,
        size: tileSize,
        zoom: sourceZoom,
        url: tileTemplate.replace("{z}", String(sourceZoom)).replace("{x}", String(wrappedX)).replace("{y}", String(y)),
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
  map: { width: "100%", overflow: "hidden", borderRadius: radii.lg, borderWidth: 1, backgroundColor: "#DCE5DF" },
  tile: { position: "absolute" },
  segment: { position: "absolute", height: 5, borderRadius: 3, backgroundColor: colors.brand, transformOrigin: "left center" },
  markerWrap: { position: "absolute", width: 120, alignItems: "center" },
  marker: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 17, borderWidth: 4, backgroundColor: "white", boxShadow: "0 4px 14px rgba(0,0,0,.22)" },
  markerDot: { width: 10, height: 10, borderRadius: 5 },
  markerTip: { width: 0, height: 0, marginTop: -2, borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 10, borderLeftColor: "transparent", borderRightColor: "transparent" },
  markerLabel: { maxWidth: 120, marginTop: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.pill, overflow: "hidden", color: colors.ink, backgroundColor: "white", fontSize: 11, fontWeight: "900", boxShadow: "0 3px 12px rgba(0,0,0,.14)" },
  controls: { position: "absolute", right: spacing.sm, top: spacing.sm, gap: 5 },
  control: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: "white", boxShadow: "0 4px 14px rgba(0,0,0,.16)" },
  selectionHint: { position: "absolute", top: spacing.sm, left: spacing.sm, maxWidth: "68%", paddingHorizontal: 11, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: "rgba(23,33,27,.84)" },
  selectionHintText: { color: "white", fontSize: 11, fontWeight: "800" },
  zoomBadge: { position: "absolute", left: spacing.sm, bottom: spacing.sm, paddingHorizontal: 9, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: "rgba(255,255,255,.92)" },
  zoomText: { color: colors.ink, fontSize: 10, fontWeight: "800" },
  attribution: { position: "absolute", right: 5, bottom: 3, paddingHorizontal: 4, color: colors.ink, backgroundColor: "rgba(255,255,255,.84)", fontSize: 9 },
  empty: { alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: radii.lg, borderWidth: 1 },
  emptyPin: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22 },
  emptyTitle: { fontSize: 16, fontWeight: "900" },
  emptyBody: { maxWidth: 420, paddingHorizontal: spacing.lg, textAlign: "center", fontSize: 13, lineHeight: 19 },
});
