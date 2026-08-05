import { FileCheck2, MapPin, Settings, Truck } from "lucide-react";

import { useDriversQuery, useVehiclesQuery } from "@lpg/features/drivers/api";
import { firstLinkedMediaAssetId, useEntityMediaLinksQuery } from "@lpg/features/media/api";
import { RuntimeMediaImage } from "@lpg/features/media/RuntimeMediaImage";
import { getFirstRecordString, getRecordId } from "@lpg/shared/api/records";
import { MenuRow, PageHeading, ProfileCard } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { AccountSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import type { DriverScreenProps } from "../../navigation/driverRoutes";

export function DriverAccountScreen(props: DriverScreenProps) {
  const drivers = useDriversQuery();
  const vehicles = useVehiclesQuery();
  const driver = drivers.data?.find((record) => getFirstRecordString(record, ["user_id", "userId"]) === props.context.user.id) ?? drivers.data?.[0] ?? null;
  const mediaLinks = useEntityMediaLinksQuery("driver", getRecordId(driver));
  const vehicle = vehicles.data?.[0];
  const vehicleLabel = [vehicle?.manufacturer, vehicle?.model, vehicle?.registration_number].filter(Boolean).join(" ") || "No active vehicle returned";

  return (
    <QueryState loading={drivers.isLoading || vehicles.isLoading || mediaLinks.isLoading} error={drivers.error ?? vehicles.error ?? mediaLinks.error} skeleton={<AccountSkeleton />}>
      <PageHeading title="Driver Account" />
      <ProfileCard context={props.context} media={<RuntimeMediaImage assetId={firstLinkedMediaAssetId(mediaLinks.data, "profile.photo")} alt="Driver profile" />} />
      <section className="panel-card">
        <button type="button" className="unstyled-record-button" onClick={() => props.navigation.navigate("vehicle")}><MenuRow icon={<Truck />} title="Vehicle" text={vehicleLabel} /></button>
        <button type="button" className="unstyled-record-button" onClick={() => props.navigation.navigate("documents")}><MenuRow icon={<FileCheck2 />} title="Documents" text="Backend-managed driver and vehicle records" /></button>
        <button type="button" className="unstyled-record-button" onClick={() => props.navigation.navigate("service-zone")}><MenuRow icon={<MapPin />} title="Service Zone" text={getFirstRecordString(drivers.data?.[0], ["service_zone", "zone_name"]) ?? "No zone returned"} /></button>
        <MenuRow icon={<Settings />} title="Settings" text="Appearance, currency, security, and support" />
      </section>
    </QueryState>
  );
}
