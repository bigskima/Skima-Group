import { Image } from "expo-image";
import { Crosshair, Minus, Plus } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";

export interface StreetMapCoordinate {
  latitude: number;
  longitude: number;
}
export interface StreetMapPoint extends StreetMapCoordinate {
  label?: string;
}
export interface StreetMapPreviewProps {
  coordinate?: StreetMapCoordinate | null;
  points?: readonly StreetMapPoint[];
  onSelectPoint?: (point: StreetMapCoordinate) => void;
  height?: number;
  initialZoom?: number;
  title?: string;
  interactive?: boolean;
}

const TILE_SIZE = 256;
const TILE_TEMPLATE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = "© OpenStreetMap contributors";
const DEFAULT_CENTER = { latitude: 9.082, longitude: 8.6753 };

type Tile = {
  key: string;
  url: string;
  left: number;
  top: number;
  size: number;
};

function validPoint(point: StreetMapCoordinate | null | undefined): point is StreetMapCoordinate {
  return Boolean(
    point &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180,
  );
}

function project(point: StreetMapCoordinate, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, point.latitude));
  const sin = Math.sin(latitude * Math.PI / 180);
  return {
    x: ((point.longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function unproject(x: number, y: number, zoom: number): StreetMapCoordinate {
  const scale = TILE_SIZE * 2 ** zoom;
  const longitude = x / scale * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y / scale;
  const latitude = 180 / Math.PI * Math.atan(Math.sinh(n));
  return { latitude, longitude };
}

function clampZoom(value: number) {
  return Math.max(3, Math.min(18, Math.round(value)));
}

export function StreetMapPreview({
  coordinate,
  points = [],
  onSelectPoint,
  height = 190,
  initialZoom = 15,
  title = "Map preview",
  interactive = Boolean(onSelectPoint),
}: StreetMapPreviewProps) {
  const initialPoint = validPoint(coordinate) ? coordinate : DEFAULT_CENTER;
  const [center, setCenter] = useState<StreetMapCoordinate>(initialPoint);
  const [zoom, setZoom] = useState(() => clampZoom(validPoint(coordinate) ? initialZoom : 6));
  const [size, setSize] = useState({ width: 360, height });
  const [failedTiles, setFailedTiles] = useState<string[]>([]);
  const centerRef = useRef(center);
  const zoomRef = useRef(zoom);
  const dragRef = useRef<{ center: StreetMapCoordinate; zoom: number; moved: boolean } | null>(null);
  centerRef.current = center;
  zoomRef.current = zoom;

  useEffect(() => {
    if (!validPoint(coordinate)) return;
    setCenter(coordinate);
    setZoom(clampZoom(initialZoom));
    setFailedTiles([]);
  }, [coordinate?.latitude, coordinate?.longitude, initialZoom]);

  const canvas = useMemo(() => {
    const centerPixel = project(center, zoom);
    const leftWorld = centerPixel.x - size.width / 2;
    const topWorld = centerPixel.y - size.height / 2;
    const firstX = Math.floor(leftWorld / TILE_SIZE);
    const lastX = Math.floor((leftWorld + size.width) / TILE_SIZE);
    const firstY = Math.floor(topWorld / TILE_SIZE);
    const lastY = Math.floor((topWorld + size.height) / TILE_SIZE);
    const tileCount = 2 ** zoom;
    const tiles: Tile[] = [];
    for (let y = firstY; y <= lastY; y += 1) {
      if (y < 0 || y >= tileCount) continue;
      for (let x = firstX; x <= lastX; x += 1) {
        const wrappedX = ((x % tileCount) + tileCount) % tileCount;
        const url = TILE_TEMPLATE
          .replace("{z}", String(zoom))
          .replace("{x}", String(wrappedX))
          .replace("{y}", String(y));
        tiles.push({
          key: String(zoom) + ":" + String(wrappedX) + ":" + String(y),
          url,
          left: x * TILE_SIZE - leftWorld,
          top: y * TILE_SIZE - topWorld,
          size: TILE_SIZE,
        });
      }
    }
    const markers = points.filter(validPoint).map((point) => {
      const pixel = project(point, zoom);
      return { ...point, left: pixel.x - leftWorld, top: pixel.y - topWorld };
    });
    const selectedPixel = validPoint(coordinate) ? project(coordinate, zoom) : null;
    return {
      tiles,
      markers,
      selected: selectedPixel
        ? { left: selectedPixel.x - leftWorld, top: selectedPixel.y - topWorld }
        : null,
      centerPixel,
    };
  }, [center.latitude, center.longitude, zoom, size.width, size.height, points, coordinate?.latitude, coordinate?.longitude]);

  const onLayout = (event: LayoutChangeEvent) => {
    const width = Math.max(240, event.nativeEvent.layout.width);
    const nextHeight = Math.max(150, event.nativeEvent.layout.height);
    setSize({ width, height: nextHeight });
  };

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => interactive,
    onMoveShouldSetPanResponder: (_event, gesture) =>
      interactive && (Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4),
    onPanResponderGrant: () => {
      dragRef.current = { center: centerRef.current, zoom: zoomRef.current, moved: false };
    },
    onPanResponderMove: (_event, gesture) => {
      const origin = dragRef.current;
      if (!origin) return;
      if (Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3) origin.moved = true;
      if (!origin.moved) return;
      const pixel = project(origin.center, origin.zoom);
      setCenter(unproject(pixel.x - gesture.dx, pixel.y - gesture.dy, origin.zoom));
    },
    onPanResponderRelease: (event, gesture) => {
      const origin = dragRef.current;
      dragRef.current = null;
      if (!origin || !interactive || !onSelectPoint) return;
      if (origin.moved || Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4) return;
      const originPixel = project(origin.center, origin.zoom);
      const tapped = unproject(
        originPixel.x + event.nativeEvent.locationX - size.width / 2,
        originPixel.y + event.nativeEvent.locationY - size.height / 2,
        origin.zoom,
      );
      setCenter(tapped);
      setFailedTiles([]);
      onSelectPoint(tapped);
    },
    onPanResponderTerminate: () => { dragRef.current = null; },
    onPanResponderTerminationRequest: () => false,
  }), [interactive, onSelectPoint, size.width, size.height]);

  const recenter = () => {
    const next = validPoint(coordinate) ? coordinate : DEFAULT_CENTER;
    setCenter(next);
    setZoom(clampZoom(validPoint(coordinate) ? initialZoom : 6));
    setFailedTiles([]);
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>OPENSTREETMAP</Text>
          <Text style={styles.title}>{title}</Text>
        </View>
        <View style={styles.actions}>
          <Pressable accessibilityLabel="Recenter map" accessibilityRole="button" onPress={recenter} style={styles.control}>
            <Crosshair size={17} color="#1B2733" />
          </Pressable>
          <Pressable accessibilityLabel="Zoom out" accessibilityRole="button" onPress={() => { setZoom((value) => clampZoom(value - 1)); setFailedTiles([]); }} style={styles.control}>
            <Minus size={17} color="#1B2733" />
          </Pressable>
          <Pressable accessibilityLabel="Zoom in" accessibilityRole="button" onPress={() => { setZoom((value) => clampZoom(value + 1)); setFailedTiles([]); }} style={styles.control}>
            <Plus size={17} color="#1B2733" />
          </Pressable>
        </View>
      </View>
      <View onLayout={onLayout} style={[styles.map, { height }]} {...(interactive ? panResponder.panHandlers : {})}>
        {canvas.tiles.map((tile) => (
          <Image
            key={tile.key}
            source={{ uri: tile.url }}
            contentFit="cover"
            cachePolicy="memory-disk"
            onError={() => setFailedTiles((current) => current.includes(tile.key) ? current : [...current, tile.key])}
            style={[styles.tile, { left: tile.left, top: tile.top, width: tile.size, height: tile.size }]}
          />
        ))}
        {canvas.markers.map((point, index) => (
          <View key={String(point.latitude) + ":" + String(point.longitude) + ":" + index} pointerEvents="none"
            style={[styles.markerWrap, { left: point.left - 55, top: point.top - 45 }]}>
            <View style={styles.marker}><View style={styles.markerDot} /></View>
            {point.label ? <Text numberOfLines={1} style={styles.markerLabel}>{point.label}</Text> : null}
          </View>
        ))}
        {canvas.selected ? (
          <View pointerEvents="none" style={[styles.selectedMarker, { left: canvas.selected.left - 12, top: canvas.selected.top - 34 }]}>
            <View style={styles.selectedPin}><View style={styles.selectedDot} /></View>
            <View style={styles.pinTail} />
          </View>
        ) : null}
        {interactive ? <View pointerEvents="none" style={styles.hint}><Text style={styles.hintText}>Drag to move · Tap to place pin</Text></View> : null}
        {failedTiles.length > 0 && failedTiles.length >= canvas.tiles.length ? (
          <View pointerEvents="none" style={styles.tileError}>
            <Text style={styles.tileErrorText}>Map tiles could not load. Check your internet connection; you can still enter the full address.</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.footer}>
        <Text style={styles.attribution}>{TILE_ATTRIBUTION}</Text>
        {validPoint(coordinate) ? <Text style={styles.coordinates}>{coordinate.latitude.toFixed(5)}, {coordinate.longitude.toFixed(5)}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: "100%", borderWidth: 1, borderColor: "#D9E0E6", borderRadius: 14, overflow: "hidden", backgroundColor: "#FFFFFF" },
  header: { minHeight: 50, paddingHorizontal: 11, paddingVertical: 8, gap: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerCopy: { flex: 1, gap: 2 },
  eyebrow: { color: "#6C7885", fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  title: { color: "#19232E", fontSize: 12, fontWeight: "900" },
  actions: { flexDirection: "row", gap: 5 },
  control: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#D9E0E6", borderRadius: 9, backgroundColor: "#FFFFFF" },
  map: { width: "100%", overflow: "hidden", backgroundColor: "#E8ECE8" },
  tile: { position: "absolute" },
  markerWrap: { position: "absolute", width: 110, alignItems: "center" },
  marker: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#FFFFFF", borderWidth: 3, borderColor: "#B52B32", alignItems: "center", justifyContent: "center" },
  markerDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#B52B32" },
  markerLabel: { maxWidth: 110, marginTop: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, overflow: "hidden", backgroundColor: "#FFFFFF", color: "#18222D", fontSize: 9, fontWeight: "900" },
  selectedMarker: { position: "absolute", width: 24, alignItems: "center" },
  selectedPin: { width: 23, height: 23, borderRadius: 12, backgroundColor: "#FFFFFF", borderWidth: 3, borderColor: "#B52B32", alignItems: "center", justifyContent: "center" },
  selectedDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#B52B32" },
  pinTail: { width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 9, borderLeftColor: "transparent", borderRightColor: "transparent", borderTopColor: "#B52B32", marginTop: -1 },
  hint: { position: "absolute", left: 8, bottom: 8, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 8, backgroundColor: "rgba(22,32,43,.84)" },
  hintText: { color: "#FFFFFF", fontSize: 9, fontWeight: "800" },
  tileError: { position: "absolute", left: 10, right: 10, top: 10, padding: 9, borderRadius: 8, backgroundColor: "rgba(255,255,255,.92)" },
  tileErrorText: { color: "#7B2126", fontSize: 10, lineHeight: 14 },
  footer: { minHeight: 25, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  attribution: { color: "#66717E", fontSize: 8 },
  coordinates: { color: "#66717E", fontSize: 8, fontVariant: ["tabular-nums"] },
});
