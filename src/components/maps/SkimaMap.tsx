import React from 'react';
import { DimensionValue, StyleSheet, Text, View } from 'react-native';
import { Colors, Radius, Spacing } from '../../design-system/theme';

export interface MapCoordinates {
  latitude: number;
  longitude: number;
}

export interface SkimaMapProps {
  initialRegion?: {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  };
  driverLocation?: MapCoordinates;
  customerLocation?: MapCoordinates;
  stationLocations?: Array<{ id: string; name: string; latitude: number; longitude: number }>;
  height?: DimensionValue;
  showRadarPolygon?: boolean;
}

export const SkimaMap: React.FC<SkimaMapProps> = ({
  driverLocation,
  customerLocation,
  stationLocations = [],
  height = 240,
  showRadarPolygon = true,
}) => {
  return (
    <View style={[styles.mapContainer, { height }]}>
      <View style={styles.canvasBackground}>
        {showRadarPolygon && (
          <View style={styles.radarRingWrapper}>
            <View style={[styles.radarRing, styles.ringOuter]} />
            <View style={[styles.radarRing, styles.ringMiddle]} />
            <View style={[styles.radarRing, styles.ringInner]} />
          </View>
        )}

        {stationLocations.map((station) => (
          <View key={station.id} style={styles.stationMarker}>
            <Text style={styles.markerText}>{station.name.substring(0, 3).toUpperCase()}</Text>
          </View>
        ))}

        {driverLocation && (
          <View style={styles.driverPin}>
            <View style={styles.driverPinPulse} />
            <Text style={styles.pinText}>Driver</Text>
          </View>
        )}

        {customerLocation && (
          <View style={styles.customerPin}>
            <Text style={styles.pinText}>Destination</Text>
          </View>
        )}

        <View style={styles.mapLabelContainer}>
          <Text style={styles.mapLabelText}>Skima Map Engine - Awka Zone (6.2209 N, 7.0671 E)</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  mapContainer: {
    width: '100%',
    borderRadius: Radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.bgCardBorder,
    marginVertical: Spacing.xs,
  },
  canvasBackground: {
    flex: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  radarRingWrapper: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarRing: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(6, 182, 212, 0.25)',
  },
  ringOuter: { width: 220, height: 220 },
  ringMiddle: { width: 140, height: 140 },
  ringInner: { width: 70, height: 70 },
  stationMarker: {
    position: 'absolute',
    top: '30%',
    left: '25%',
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderColor: Colors.accentGreen,
    borderWidth: 1,
    padding: 4,
    borderRadius: Radius.sm,
  },
  driverPin: {
    position: 'absolute',
    top: '45%',
    left: '52%',
    backgroundColor: Colors.accentFlame,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    shadowColor: Colors.accentFlame,
    shadowRadius: 8,
    shadowOpacity: 0.5,
  },
  driverPinPulse: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    borderRadius: Radius.sm,
    backgroundColor: Colors.accentFlame,
    opacity: 0.3,
  },
  customerPin: {
    position: 'absolute',
    top: '65%',
    left: '70%',
    backgroundColor: Colors.accentTeal,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.sm,
  },
  markerText: { color: Colors.accentGreen, fontSize: 10, fontWeight: '700' },
  pinText: { color: '#FFF', fontSize: 10, fontWeight: '700' },
  mapLabelContainer: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(9, 13, 22, 0.85)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.bgCardBorder,
  },
  mapLabelText: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
});
