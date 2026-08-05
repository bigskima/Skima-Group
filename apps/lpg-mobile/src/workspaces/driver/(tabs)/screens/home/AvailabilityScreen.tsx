import { LocateFixed, Radio, RadioTower } from "lucide-react";
import { type FormEvent, useState } from "react";

import { useSession } from "@lpg/app/providers/SessionProvider";
import { useDriversQuery, useDriverLocationsQuery } from "@lpg/features/drivers/api";
import { buildDriverLocationPayload, type DriverOnlineStatus } from "@lpg/features/drivers/locationPayload";
import { useDeviceLocation } from "@lpg/features/location/useDeviceLocation";
import { ActionResponseSchema, getFirstRecordString, getRecordId, type ActionResult } from "@lpg/shared/api/records";
import { useGatewayMutation } from "@lpg/shared/api/useGatewayMutation";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { WorkflowFormSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import { RecordField, WorkflowForm, WorkflowHeader } from "@lpg/shared/ui/WorkflowScreen";
import type { DriverScreenProps } from "../../navigation/driverRoutes";

export function AvailabilityScreen(props: DriverScreenProps) {
  const session = useSession();
  const drivers = useDriversQuery();
  const locations = useDriverLocationsQuery();
  const deviceLocation = useDeviceLocation();
  const driver = drivers.data?.find((record) => getFirstRecordString(record, ["user_id", "userId"]) === props.context.user.id) ?? null;
  const driverId = getRecordId(driver);
  const latest = locations.data?.find((record) => getFirstRecordString(record, ["driver_profile_id", "driverProfileId"]) === driverId) ?? null;
  const [onlineStatus, setOnlineStatus] = useState<DriverOnlineStatus>(
    normalizeOnlineStatus(getFirstRecordString(latest, ["online_status", "onlineStatus"])),
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<Error | null>(null);
  const mutation = useGatewayMutation<ActionResult, Record<string, unknown>>({
    invalidate: [["driver-locations"], ["drivers"]],
    path: "/lpg/driver-locations",
    schema: ActionResponseSchema,
  });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(null);
    setLocalError(null);
    try {
      if (!driverId) throw new Error("An approved driver profile is required.");
      const position = await deviceLocation.request();
      await mutation.mutateAsync(buildDriverLocationPayload({
        driverProfileId: driverId,
        location: position,
        onlineStatus,
        purpose: "driver-availability",
      }));
      setNotice("Availability and location updated.");
      await session.refreshContext();
    } catch (error) {
      setLocalError(error instanceof Error ? error : new Error("Availability could not be updated."));
    }
  };

  return <QueryState loading={drivers.isLoading || locations.isLoading} error={drivers.error ?? locations.error} skeleton={<WorkflowFormSkeleton />}>
    <WorkflowHeader title="Availability" subtitle="Driver presence and dispatch location" onBack={props.navigation.goBack} />
    <section className="panel-card">
      <RecordField label="Current status" value={getFirstRecordString(latest, ["online_status", "onlineStatus"]) ?? "No location recorded"} />
      <RecordField label="Last update" value={getFirstRecordString(latest, ["recorded_at", "recordedAt"]) ? new Date(getFirstRecordString(latest, ["recorded_at", "recordedAt"]) ?? "").toLocaleString() : "Not available"} />
    </section>
    <WorkflowForm error={localError ?? mutation.error ?? (deviceLocation.error ? new Error(deviceLocation.error) : undefined)} isPending={mutation.isPending || deviceLocation.isLocating} notice={notice} onSubmit={(event) => void submit(event)} submitLabel="Update Availability">
      <label>Status<select value={onlineStatus} onChange={(event) => setOnlineStatus(normalizeOnlineStatus(event.currentTarget.value))}><option value="online">Online</option><option value="busy">Busy</option><option value="offline">Offline</option></select></label>
      <p className="action-copy">{onlineStatus === "online" ? <RadioTower aria-hidden="true" /> : <Radio aria-hidden="true" />}The dispatch policy uses the location recorded when you submit.</p>
      <p className="action-copy"><LocateFixed aria-hidden="true" />Location access is requested only for this update.</p>
    </WorkflowForm>
  </QueryState>;
}

function normalizeOnlineStatus(value: string | null): DriverOnlineStatus {
  return value === "busy" || value === "offline" || value === "online" ? value : "online";
}
