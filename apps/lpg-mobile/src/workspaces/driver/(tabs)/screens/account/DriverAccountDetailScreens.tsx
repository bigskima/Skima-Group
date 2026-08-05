import { FileCheck2, MapPin, ShieldCheck, Truck, UserRound } from "lucide-react";

import {
  findLpgApplicationType,
  useApplicationsQuery,
  useApplicationTypesQuery,
  useDocumentsQuery,
  useDocumentRequirementsQuery,
} from "@lpg/features/applications/api";
import { useDriversQuery, useVehiclesQuery, useVehicleTypesQuery } from "@lpg/features/drivers/api";
import { firstLinkedMediaAssetId, useEntityMediaLinksQuery } from "@lpg/features/media/api";
import { RuntimeMediaImage } from "@lpg/features/media/RuntimeMediaImage";
import { formatStatus, getFirstRecordNumber, getFirstRecordString, getRecordId, getRecordObject, recordKey, statusTone } from "@lpg/shared/api/records";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { MenuRow, ProfileCard, StatusChip } from "@lpg/shared/ui/lpgComponents";
import { AccountSkeleton, ActivityListSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import { RecordField, WorkflowHeader } from "@lpg/shared/ui/WorkflowScreen";
import type { DriverScreenProps } from "../../navigation/driverRoutes";

export function DriverProfileScreen(props: DriverScreenProps) {
  const drivers = useDriversQuery();
  const driver = drivers.data?.find((record) => getFirstRecordString(record, ["user_id", "userId"]) === props.context.user.id) ?? null;
  const mediaLinks = useEntityMediaLinksQuery("driver", getRecordId(driver));
  const identity = getRecordObject(driver, "identity_profile");
  const licence = getRecordObject(driver, "license_profile");
  return <QueryState loading={drivers.isLoading || mediaLinks.isLoading} error={drivers.error ?? mediaLinks.error} skeleton={<AccountSkeleton />}>
    <WorkflowHeader title="Driver Profile" subtitle="Approved identity record" onBack={props.navigation.goBack} />
    <ProfileCard context={props.context} media={<RuntimeMediaImage assetId={firstLinkedMediaAssetId(mediaLinks.data, "profile.photo")} alt="Driver profile" />} />
    <section className="panel-card"><StatusChip tone={statusTone(getFirstRecordString(driver, ["verification_status"]))} label={formatStatus(getFirstRecordString(driver, ["verification_status"]))} /><RecordField label="Full name" value={getFirstRecordString(identity, ["fullName", "full_name"]) ?? props.context.profile?.display_name ?? "Not available"} /><RecordField label="Address" value={getFirstRecordString(identity, ["address"]) ?? "Not available"} /><RecordField label="Licence" value={getFirstRecordString(licence, ["number"]) ?? "Not available"} /><RecordField label="Operational status" value={formatStatus(getFirstRecordString(driver, ["operational_status"]))} /></section>
  </QueryState>;
}

export function DriverVehicleScreen(props: DriverScreenProps) {
  const vehicles = useVehiclesQuery();
  const vehicleTypes = useVehicleTypesQuery();
  const vehicle = vehicles.data?.find((record) => getFirstRecordString(record, ["owner_user_id", "ownerUserId"]) === props.context.user.id) ?? vehicles.data?.[0] ?? null;
  const mediaLinks = useEntityMediaLinksQuery("vehicle", getRecordId(vehicle));
  const typeId = getFirstRecordString(vehicle, ["vehicle_type_id", "vehicleTypeId"]);
  const type = vehicleTypes.data?.find((record) => getRecordId(record) === typeId) ?? null;
  return <QueryState loading={vehicles.isLoading || vehicleTypes.isLoading || mediaLinks.isLoading} error={vehicles.error ?? vehicleTypes.error ?? mediaLinks.error} skeleton={<AccountSkeleton />}>
    <WorkflowHeader title="Vehicle" subtitle="Approved delivery vehicle" onBack={props.navigation.goBack} />
    <section className="vehicle-detail-panel"><span><RuntimeMediaImage assetId={firstLinkedMediaAssetId(mediaLinks.data, "vehicle.photo")} alt="Approved vehicle" fallback={<Truck aria-hidden="true" />} /></span><div><StatusChip tone={statusTone(getFirstRecordString(vehicle, ["status"]))} label={formatStatus(getFirstRecordString(vehicle, ["status"]))} /><h2>{[getFirstRecordString(vehicle, ["manufacturer"]), getFirstRecordString(vehicle, ["model"])].filter(Boolean).join(" ") || getFirstRecordString(type, ["display_name", "displayName"]) || "Vehicle"}</h2><p>{getFirstRecordString(vehicle, ["registration_number", "registrationNumber"]) ?? "Registration unavailable"}</p></div></section>
    <section className="panel-card"><RecordField label="Vehicle type" value={getFirstRecordString(type, ["display_name", "displayName"]) ?? "Not available"} /><RecordField label="Model year" value={getFirstRecordNumber(vehicle, ["model_year", "modelYear"]) ?? "Not available"} /><RecordField label="Colour" value={getFirstRecordString(vehicle, ["color", "colour"]) ?? "Not available"} /><RecordField label="Maximum load" value={getFirstRecordNumber(vehicle, ["max_load_kg", "maxLoadKg"]) !== null ? `${getFirstRecordNumber(vehicle, ["max_load_kg", "maxLoadKg"])} kg` : "Not available"} /><RecordField label="Insurance expiry" value={getFirstRecordString(vehicle, ["insurance_expires_at", "insuranceExpiresAt"]) ?? "Not available"} /><RecordField label="Inspection expiry" value={getFirstRecordString(vehicle, ["inspection_expires_at", "inspectionExpiresAt"]) ?? "Not available"} /></section>
  </QueryState>;
}

export function DriverDocumentsScreen(props: DriverScreenProps) {
  const types = useApplicationTypesQuery();
  const applications = useApplicationsQuery();
  const requirements = useDocumentRequirementsQuery();
  const documents = useDocumentsQuery();
  const driverTypeId = getRecordId(findLpgApplicationType(types.data, "driver"));
  const vehicleTypeId = getRecordId(findLpgApplicationType(types.data, "vehicle"));
  const applicationIds = (applications.data ?? []).filter((application) => [driverTypeId, vehicleTypeId].includes(getFirstRecordString(application, ["application_type_id", "applicationTypeId"]))).map((application) => getRecordId(application)).filter((id): id is string => Boolean(id));
  const visibleDocuments = (documents.data ?? []).filter((document) => applicationIds.includes(getFirstRecordString(document, ["application_id", "applicationId"]) ?? ""));
  const loading = types.isLoading || applications.isLoading || requirements.isLoading || documents.isLoading;
  const error = types.error ?? applications.error ?? requirements.error ?? documents.error;
  return <QueryState loading={loading} error={error} skeleton={<ActivityListSkeleton />}>
    <WorkflowHeader title="Documents" subtitle="Driver and vehicle evidence" onBack={props.navigation.goBack} />
    <section className="panel-card">{visibleDocuments.map((document, index) => {
      const requirementId = getFirstRecordString(document, ["requirement_id", "requirementId"]);
      const requirement = requirements.data?.find((record) => getRecordId(record) === requirementId);
      return <MenuRow key={recordKey(document, `driver-document-${index}`)} icon={<FileCheck2 />} title={getFirstRecordString(requirement, ["display_name", "displayName"]) ?? "Application document"} text={formatStatus(getFirstRecordString(document, ["status"]))} trailing={<StatusChip tone={statusTone(getFirstRecordString(document, ["status"]))} label={formatStatus(getFirstRecordString(document, ["status"]))} />} />;
    })}</section>
  </QueryState>;
}

export function DriverServiceZoneScreen(props: DriverScreenProps) {
  const drivers = useDriversQuery();
  const driver = drivers.data?.find((record) => getFirstRecordString(record, ["user_id", "userId"]) === props.context.user.id) ?? null;
  const service = getRecordObject(driver, "service_profile");
  const zones = service?.["zones"];
  const zoneLabels = Array.isArray(zones) ? zones.filter((item): item is string => typeof item === "string").join(", ") : getFirstRecordString(service, ["zone"]);
  return <QueryState loading={drivers.isLoading} error={drivers.error} skeleton={<AccountSkeleton />}>
    <WorkflowHeader title="Service Zone" subtitle="Approved dispatch coverage" onBack={props.navigation.goBack} />
    <section className="panel-card"><MenuRow icon={<MapPin />} title="Approved zones" text={zoneLabels || "No service zone returned"} /><MenuRow icon={<ShieldCheck />} title="Verification" text={formatStatus(getFirstRecordString(driver, ["verification_status"]))} /><button type="button" className="primary-button" onClick={() => props.navigation.navigate("availability")}><UserRound aria-hidden="true" />Update Availability</button></section>
  </QueryState>;
}
