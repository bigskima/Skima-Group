import type { DeviceLocation } from "@lpg/features/location/useDeviceLocation";
import { createLpgIdempotencyKey } from "@lpg/shared/api/records";

export type DriverOnlineStatus = "busy" | "offline" | "online";

export interface DriverLocationPayloadInput {
  readonly driverProfileId: string;
  readonly location: DeviceLocation;
  readonly lpgOrderId?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly onlineStatus: DriverOnlineStatus;
  readonly purpose: string;
}

export function buildDriverLocationPayload(input: DriverLocationPayloadInput) {
  return {
    accuracyMeters: input.location.accuracyMeters,
    driverProfileId: input.driverProfileId,
    headingDegrees: input.location.headingDegrees,
    idempotencyKey: createLpgIdempotencyKey(input.purpose, `${input.driverProfileId}:${input.location.recordedAt}`),
    latitude: input.location.latitude,
    longitude: input.location.longitude,
    lpgOrderId: input.lpgOrderId ?? undefined,
    metadata: input.metadata ?? {},
    onlineStatus: input.onlineStatus,
    recordedAt: input.location.recordedAt,
    source: "skima.lpg.mobile",
    speedMetersPerSecond: input.location.speedMetersPerSecond,
  };
}
