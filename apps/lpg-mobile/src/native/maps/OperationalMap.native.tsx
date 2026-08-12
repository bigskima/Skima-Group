import MapView, { Marker, Polyline, type MapPressEvent } from "react-native-maps";
import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";

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
  maxZoom = 21,
  minZoom = 3,
  onSelectPoint,
}: OperationalMapProps) {
  const map = useRef<MapView>(null);
  const first = points[0];
  const pointKey = points.map((point) => `${point.latitude}:${point.longitude}`).join("|");
  const focus = (animated: boolean) => {
    if (!first) return;
    if (points.length > 1)
      map.current?.fitToCoordinates([...points], {
        edgePadding: { top: 70, right: 50, bottom: 70, left: 50 },
        animated,
      });
    else
      map.current?.animateToRegion(
        { ...first, latitudeDelta: 0.0035, longitudeDelta: 0.0035 },
        animated ? 350 : 0,
      );
  };
  useEffect(() => focus(true), [pointKey]);
  if (!first) return <View style={[styles.empty, { height }]} />;
  const select = (event: MapPressEvent) => onSelectPoint?.(event.nativeEvent.coordinate);
  return (
    <MapView
      ref={map}
      style={[styles.map, { height }]}
      initialRegion={{ ...first, latitudeDelta: 0.0035, longitudeDelta: 0.0035 }}
      minZoomLevel={minZoom}
      maxZoomLevel={maxZoom}
      onMapReady={() => focus(false)}
      onPress={select}
      pitchEnabled
      rotateEnabled={false}
      scrollEnabled
      showsCompass
      showsMyLocationButton
      zoomControlEnabled
      zoomEnabled
    >
      {points.map((point, index) => (
        <Marker
          key={`${point.latitude}:${point.longitude}:${index}`}
          coordinate={point}
          title={point.label}
          pinColor={point.kind === "destination" ? "#129447" : point.kind === "pickup" ? "#E8B84A" : point.kind === "station" ? "#2256A3" : "#ED1C2E"}
        />
      ))}
      {connectPoints && points.length > 1 ? <Polyline coordinates={[...points]} strokeColor="#ED1C2E" strokeWidth={5} /> : null}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { width: "100%", overflow: "hidden", borderRadius: 28 },
  empty: { width: "100%", borderRadius: 28, backgroundColor: "#E8ECE9" },
});
