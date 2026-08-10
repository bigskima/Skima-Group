import MapView, { Marker, Polyline } from "react-native-maps";
import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
export interface MapPoint {
  latitude: number;
  longitude: number;
  label: string;
  kind?: "driver" | "destination" | "pickup" | "station" | "location";
}
export function OperationalMap({
  points,
  connectPoints = false,
}: {
  points: readonly MapPoint[];
  connectPoints?: boolean;
}) {
  const map = useRef<MapView>(null);
  const first = points[0];
  useEffect(() => {
    if (points.length > 1)
      map.current?.fitToCoordinates([...points], {
        edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
        animated: true,
      });
  }, [points]);
  if (!first) return <View style={styles.empty} />;
  return (
    <MapView
      ref={map}
      style={styles.map}
      initialRegion={{ ...first, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
      onMapReady={() =>
        points.length > 1 &&
        map.current?.fitToCoordinates([...points], {
          edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
          animated: false,
        })
      }
    >
      {points.map((point, index) => (
        <Marker
          key={`${point.latitude}:${point.longitude}:${index}`}
          coordinate={point}
          title={point.label}
          pinColor={point.kind === "destination" ? "#129447" : point.kind === "pickup" ? "#E8B84A" : "#ED1C2E"}
        />
      ))}
      {connectPoints && points.length > 1 ? (
        <Polyline
          coordinates={[...points]}
          strokeColor="#ED1C2E"
          strokeWidth={4}
        />
      ) : null}
    </MapView>
  );
}
const styles = StyleSheet.create({
  map: { width: "100%", height: 360 },
  empty: { height: 260, backgroundColor: "#E8ECE9" },
});
