import { useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import { AddressEngine, GeoCoordinates } from '../services/AddressEngine';

export function useLocation() {
  const [currentLocation, setCurrentLocation] = useState<GeoCoordinates>({
    latitude: 6.2209, // Awka Launch Zone Default
    longitude: 7.0671,
  });
  const [loading, setLoading] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [serviceStatus, setServiceStatus] = useState<{ supported: boolean; message: string }>({
    supported: true,
    message: 'Location verified within Awka Launch Zone',
  });

  const checkCoverage = useCallback((coords: GeoCoordinates) => {
    const res = AddressEngine.isWithinServiceArea(coords);
    setServiceStatus({
      supported: res.supported,
      message: res.message,
    });
    return res;
  }, []);

  const requestPermissionAndFetchLocation = useCallback(async () => {
    setLoading(true);
    try {
      if (Platform.OS === 'web') {
        // Web Geolocation API Support
        if (typeof window !== 'undefined' && 'geolocation' in navigator) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const coords: GeoCoordinates = {
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
              };
              setCurrentLocation(coords);
              checkCoverage(coords);
              setPermissionGranted(true);
              setLoading(false);
            },
            () => {
              // Fallback to Awka default if user denies browser prompt
              setLoading(false);
            }
          );
        } else {
          setLoading(false);
        }
      } else {
        // Native iOS & Android expo-location API
        const Location = require('expo-location');
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          setPermissionGranted(true);
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          });
          const coords: GeoCoordinates = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          };
          setCurrentLocation(coords);
          checkCoverage(coords);
        }
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  }, [checkCoverage]);

  const updateLocation = useCallback((coords: GeoCoordinates) => {
    setCurrentLocation(coords);
    checkCoverage(coords);
  }, [checkCoverage]);

  useEffect(() => {
    requestPermissionAndFetchLocation();
  }, [requestPermissionAndFetchLocation]);

  return {
    currentLocation,
    loading,
    permissionGranted,
    serviceStatus,
    updateLocation,
    requestPermissionAndFetchLocation,
    calculateFee: AddressEngine.calculateDeliveryFee,
  };
}
