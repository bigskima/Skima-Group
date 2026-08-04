import { useCallback, useState } from "react";

export interface DeviceLocation {
  readonly accuracyMeters: number | null;
  readonly headingDegrees: number | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly recordedAt: string;
  readonly speedMetersPerSecond: number | null;
}

export function useDeviceLocation() {
  const [location, setLocation] = useState<DeviceLocation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);

  const request = useCallback(async (): Promise<DeviceLocation> => {
    if (!navigator.geolocation) {
      throw new Error("Location services are not available on this device.");
    }

    setIsLocating(true);
    setError(null);

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 15_000,
          timeout: 20_000,
        });
      });
      const next: DeviceLocation = {
        accuracyMeters: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        headingDegrees: position.coords.heading,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        recordedAt: new Date(position.timestamp).toISOString(),
        speedMetersPerSecond: position.coords.speed,
      };
      setLocation(next);
      return next;
    } catch (locationError) {
      const message = locationError instanceof Error
        ? locationError.message
        : locationError && typeof locationError === "object" && "message" in locationError
        ? String(locationError.message)
        : "Your location could not be read.";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLocating(false);
    }
  }, []);

  return { error, isLocating, location, request };
}
