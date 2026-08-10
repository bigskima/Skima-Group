import { Image } from "expo-image";
import { MapPin, Minus, Plus } from "lucide-react-native";
import { useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { colors, radii, spacing } from "../theme/tokens";

export interface MapPoint {
  latitude: number;
  longitude: number;
  label: string;
}
const TILE = 256;
const HEIGHT = 360;
const tileTemplate =
  process.env.EXPO_PUBLIC_MAP_TILE_URL ??
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export function OperationalMap({
  points,
  connectPoints = false,
}: {
  points: readonly MapPoint[];
  connectPoints?: boolean;
}) {
  const [width, setWidth] = useState(720);
  const [zoom, setZoom] = useState(13);
  const center = useMemo(
    () =>
      points.length
        ? {
            latitude:
              points.reduce((sum, point) => sum + point.latitude, 0) /
              points.length,
            longitude:
              points.reduce((sum, point) => sum + point.longitude, 0) /
              points.length,
          }
        : null,
    [points],
  );
  const layout = center
    ? createLayout(center, points, width, HEIGHT, zoom)
    : null;
  const onLayout = (event: LayoutChangeEvent) =>
    setWidth(Math.max(280, event.nativeEvent.layout.width));
  if (!center || !layout)
    return (
      <View onLayout={onLayout} style={styles.empty}>
        <MapPin color={colors.muted} size={32} />
        <Text style={styles.emptyTitle}>Location unavailable</Text>
        <Text style={styles.emptyBody}>
          SKIMA has not received an authorised coordinate for this workflow.
        </Text>
      </View>
    );
  return (
    <View
      onLayout={onLayout}
      style={styles.map}
      accessibilityLabel="Map showing authorised SKIMA locations"
    >
      {layout.tiles.map((tile) => (
        <Image
          key={`${zoom}:${tile.x}:${tile.y}`}
          source={tile.url}
          contentFit="cover"
          style={[styles.tile, { left: tile.left, top: tile.top }]}
          transition={80}
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
        <View
          key={`${marker.label}:${index}`}
          style={[
            styles.marker,
            { left: marker.left - 15, top: marker.top - 30 },
          ]}
        >
          <MapPin color={colors.brand} fill="white" size={30} />
          <Text numberOfLines={1} style={styles.markerLabel}>
            {marker.label}
          </Text>
        </View>
      ))}
      <View style={styles.controls}>
        <Pressable
          accessibilityLabel="Zoom map in"
          onPress={() => setZoom((value) => Math.min(18, value + 1))}
          style={styles.control}
        >
          <Plus color={colors.ink} size={19} />
        </Pressable>
        <Pressable
          accessibilityLabel="Zoom map out"
          onPress={() => setZoom((value) => Math.max(3, value - 1))}
          style={styles.control}
        >
          <Minus color={colors.ink} size={19} />
        </Pressable>
      </View>
      <Text style={styles.attribution}>© OpenStreetMap contributors</Text>
    </View>
  );
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
  const tiles: {
    x: number;
    y: number;
    left: number;
    top: number;
    url: string;
  }[] = [];
  for (let y = firstTileY; y <= lastTileY; y += 1)
    for (let x = firstTileX; x <= lastTileX; x += 1) {
      if (y < 0 || y >= count) continue;
      const wrappedX = ((x % count) + count) % count;
      tiles.push({
        x: wrappedX,
        y,
        left: x * TILE - leftWorld,
        top: y * TILE - topWorld,
        url: tileTemplate
          .replace("{z}", String(zoom))
          .replace("{x}", String(wrappedX))
          .replace("{y}", String(y)),
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
    return {
      left: previous.left,
      top: previous.top,
      length: Math.sqrt(dx * dx + dy * dy),
      angle: Math.atan2(dy, dx),
    };
  });
  return { tiles, markers, segments };
}
function project(latitude: number, longitude: number, zoom: number) {
  const scale = TILE * 2 ** zoom;
  const boundedLatitude = Math.max(
    -85.05112878,
    Math.min(85.05112878, latitude),
  );
  const sin = Math.sin((boundedLatitude * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}
const styles = StyleSheet.create({
  map: {
    width: "100%",
    height: HEIGHT,
    overflow: "hidden",
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#DCE5DF",
  },
  tile: { position: "absolute", width: TILE, height: TILE },
  segment: {
    position: "absolute",
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.brand,
    transformOrigin: "left center",
  },
  marker: { position: "absolute", width: 130, alignItems: "center" },
  markerLabel: {
    maxWidth: 130,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radii.pill,
    overflow: "hidden",
    color: colors.ink,
    backgroundColor: "white",
    fontSize: 11,
    fontWeight: "800",
  },
  controls: {
    position: "absolute",
    right: spacing.sm,
    top: spacing.sm,
    gap: 2,
  },
  control: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: colors.border,
  },
  attribution: {
    position: "absolute",
    right: 5,
    bottom: 3,
    paddingHorizontal: 4,
    color: colors.ink,
    backgroundColor: "rgba(255,255,255,.84)",
    fontSize: 10,
  },
  empty: {
    height: HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#EEF2EF",
  },
  emptyTitle: { color: colors.ink, fontSize: 17, fontWeight: "900" },
  emptyBody: {
    maxWidth: 420,
    paddingHorizontal: spacing.lg,
    color: colors.muted,
    textAlign: "center",
    lineHeight: 20,
  },
});
