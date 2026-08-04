import { FileCheck2, MapPin, Settings, Truck } from "lucide-react";

import { useDriversQuery, useVehiclesQuery } from "@lpg/features/drivers/api";
import { getFirstRecordString } from "@lpg/shared/api/records";
import { MenuRow, PageHeading, ProfileCard } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import type { DriverScreenProps } from "../../navigation/driverRoutes";

export function DriverAccountScreen(props: DriverScreenProps) {
  const drivers = useDriversQuery();
  const vehicles = useVehiclesQuery();
  const vehicle = vehicles.data?.[0];
  const vehicleLabel = [vehicle?.manufacturer, vehicle?.model, vehicle?.registration_number].filter(Boolean).join(" ") || "No active vehicle returned";

  return (
    <QueryState loading={drivers.isLoading || vehicles.isLoading} error={drivers.error ?? vehicles.error}>
      <PageHeading title="Driver Account" />
      <ProfileCard context={props.context} />
      <section className="panel-card">
        <button type="button" className="unstyled-record-button" onClick={() => props.navigation.navigate("vehicle")}><MenuRow icon={<Truck />} title="Vehicle" text={vehicleLabel} /></button>
        <button type="button" className="unstyled-record-button" onClick={() => props.navigation.navigate("documents")}><MenuRow icon={<FileCheck2 />} title="Documents" text="Backend-managed driver and vehicle records" /></button>
        <button type="button" className="unstyled-record-button" onClick={() => props.navigation.navigate("service-zone")}><MenuRow icon={<MapPin />} title="Service Zone" text={getFirstRecordString(drivers.data?.[0], ["service_zone", "zone_name"]) ?? "No zone returned"} /></button>
        <MenuRow icon={<Settings />} title="Settings" text="Appearance, currency, security, and support" />
      </section>
    </QueryState>
  );
}
