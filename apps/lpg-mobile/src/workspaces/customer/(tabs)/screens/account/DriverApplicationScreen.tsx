import { CheckCircle2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ApplicationSubmissionPanel } from "@lpg/features/applications/ApplicationSubmissionPanel";
import {
  findCurrentApplication,
  findLpgApplicationType,
  getLatestApplicationPayload,
  useApplicationsQuery,
  useApplicationTypesQuery,
  useApplicationVersionsQuery,
} from "@lpg/features/applications/api";
import { useVehicleTypesQuery } from "@lpg/features/drivers/api";
import {
  formatStatus,
  getFirstRecordString,
  getRecordId,
  getRecordArray,
  getRecordObject,
  recordKey,
  statusTone,
} from "@lpg/shared/api/records";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { WorkflowFormSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import { StatusChip } from "@lpg/shared/ui/lpgComponents";
import { WorkflowHeader } from "@lpg/shared/ui/WorkflowScreen";
import type { CustomerScreenProps } from "../../navigation/customerRoutes";

export function DriverApplicationScreen(props: CustomerScreenProps) {
  const applicationTypes = useApplicationTypesQuery();
  const applications = useApplicationsQuery();
  const vehicleTypes = useVehicleTypesQuery();
  const driverType = findLpgApplicationType(applicationTypes.data, "driver");
  const vehicleType = findLpgApplicationType(applicationTypes.data, "vehicle");
  const driverApplication = findCurrentApplication(applications.data, driverType);
  const vehicleApplication = findCurrentApplication(applications.data, vehicleType);
  const driverVersions = useApplicationVersionsQuery(getRecordId(driverApplication));
  const vehicleVersions = useApplicationVersionsQuery(getRecordId(vehicleApplication));
  const driverPayload = getLatestApplicationPayload(driverVersions.data);
  const vehiclePayload = getLatestApplicationPayload(vehicleVersions.data);
  const driverStatus = getFirstRecordString(driverApplication, ["status"]);
  const driverProfileId = getFirstRecordString(driverApplication, ["activated_subject_id", "activatedSubjectId"]);

  const [fullName, setFullName] = useState(props.context.profile?.display_name ?? "");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [licenceNumber, setLicenceNumber] = useState("");
  const [serviceZone, setServiceZone] = useState("");
  const [selectedVehicleType, setSelectedVehicleType] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [colour, setColour] = useState("");
  const [maxLoadKg, setMaxLoadKg] = useState("");
  const [ownershipType, setOwnershipType] = useState("");
  const ownershipTypes = getRecordArray(getRecordObject(vehicleType, "metadata"), "ownershipTypes");

  useEffect(() => {
    if (!driverPayload) return;
    setFullName(readNestedString(driverPayload, "identity", "fullName") ?? props.context.profile?.display_name ?? "");
    setPhone(readNestedString(driverPayload, "contact", "phone") ?? "");
    setAddress(readNestedString(driverPayload, "identity", "address") ?? "");
    setLicenceNumber(readNestedString(driverPayload, "licence", "number") ?? "");
    setServiceZone(readNestedString(driverPayload, "service", "zone") ?? "");
  }, [driverPayload, props.context.profile?.display_name]);

  useEffect(() => {
    if (!vehiclePayload) return;
    const vehicle = getRecordObject(vehiclePayload, "vehicle");
    setSelectedVehicleType(getFirstRecordString(vehicle, ["vehicleTypeKey", "vehicle_type_key"]) ?? "");
    setManufacturer(getFirstRecordString(vehicle, ["manufacturer"]) ?? "");
    setModel(getFirstRecordString(vehicle, ["model"]) ?? "");
    setYear(getFirstRecordString(vehicle, ["year"]) ?? "");
    setRegistrationNumber(getFirstRecordString(vehicle, ["registrationNumber", "registration_number"]) ?? "");
    setColour(getFirstRecordString(vehicle, ["colour", "color"]) ?? "");
    setOwnershipType(getFirstRecordString(vehicle, ["ownershipType", "ownership_type"]) ?? "");
    const capacity = getRecordObject(vehicle, "capacityProfile");
    const load = capacity?.["maxLoadKg"];
    setMaxLoadKg(typeof load === "number" || typeof load === "string" ? String(load) : "");
  }, [vehiclePayload]);

  const driverSubmission = useMemo(() => ({
    contact: { email: props.context.user.email, phone: phone.trim() },
    identity: { address: address.trim(), fullName: fullName.trim() },
    licence: { number: licenceNumber.trim() },
    service: { zone: serviceZone.trim() },
    workingHours: {},
    zones: serviceZone.trim() ? [serviceZone.trim()] : [],
  }), [address, fullName, licenceNumber, phone, props.context.user.email, serviceZone]);

  const vehicleSubmission = useMemo(() => ({
    vehicle: {
      capacityProfile: { maxLoadKg: Number(maxLoadKg) },
      color: colour.trim(),
      driverProfileId,
      manufacturer: manufacturer.trim(),
      maxLoadKg: Number(maxLoadKg),
      model: model.trim(),
      ownershipType,
      registrationNumber: registrationNumber.trim(),
      vehicleTypeKey: selectedVehicleType,
      year: year.trim(),
    },
  }), [colour, driverProfileId, manufacturer, maxLoadKg, model, ownershipType, registrationNumber, selectedVehicleType, year]);

  const loading = applicationTypes.isLoading || applications.isLoading || vehicleTypes.isLoading ||
    driverVersions.isLoading || vehicleVersions.isLoading;
  const error = applicationTypes.error ?? applications.error ?? vehicleTypes.error ?? driverVersions.error ?? vehicleVersions.error;
  const refresh = () => void Promise.all([applicationTypes.refetch(), applications.refetch(), vehicleTypes.refetch()]);

  return (
    <QueryState loading={loading} error={error} onRetry={refresh} skeleton={<WorkflowFormSkeleton />}>
      <WorkflowHeader title="Driver Application" subtitle="Identity, licence, vehicle, and approval" onBack={props.navigation.goBack} />
      <div className="application-stage-bar">
        <span className={driverStatus === "approved" ? "is-complete" : "is-current"}>1 Driver</span>
        <span className={driverStatus === "approved" ? "is-current" : ""}>2 Vehicle</span>
        <button type="button" className="icon-button" aria-label="Refresh application status" onClick={refresh}><RefreshCw aria-hidden="true" /></button>
      </div>

      {driverStatus !== "approved" || !driverProfileId ? (
        <ApplicationSubmissionPanel
          application={driverApplication}
          applicationType={driverType}
          payload={driverSubmission}
          submitLabel="Submit Driver Application"
        >
          <label>Full name<input value={fullName} onChange={(event) => setFullName(event.currentTarget.value)} autoComplete="name" required /></label>
          <label>Phone number<input value={phone} onChange={(event) => setPhone(event.currentTarget.value)} autoComplete="tel" inputMode="tel" required /></label>
          <label>Residential address<textarea value={address} onChange={(event) => setAddress(event.currentTarget.value)} required /></label>
          <label>Driver licence number<input value={licenceNumber} onChange={(event) => setLicenceNumber(event.currentTarget.value)} autoCapitalize="characters" required /></label>
          <label>Preferred service zone<input value={serviceZone} onChange={(event) => setServiceZone(event.currentTarget.value)} required /></label>
        </ApplicationSubmissionPanel>
      ) : (
        <>
          <section className="form-message is-success"><CheckCircle2 aria-hidden="true" /><span>Driver identity approved</span><StatusChip tone="success" label="Approved" /></section>
          <ApplicationSubmissionPanel
            application={vehicleApplication}
            applicationType={vehicleType}
            payload={vehicleSubmission}
            submitLabel="Submit Vehicle Application"
          >
            <label>
              Vehicle type
              <select value={selectedVehicleType} onChange={(event) => setSelectedVehicleType(event.currentTarget.value)} required>
                <option value="">Choose configured vehicle type</option>
                {(vehicleTypes.data ?? []).filter((item) => getFirstRecordString(item, ["status"]) === "active").map((item, index) => {
                  const key = getFirstRecordString(item, ["key"]) ?? "";
                  return <option key={recordKey(item, `vehicle-type-${index}`)} value={key}>{getFirstRecordString(item, ["display_name", "displayName"]) ?? key}</option>;
                })}
              </select>
            </label>
            <label>Manufacturer<input value={manufacturer} onChange={(event) => setManufacturer(event.currentTarget.value)} required /></label>
            <label>Model<input value={model} onChange={(event) => setModel(event.currentTarget.value)} required /></label>
            <label>Year<input type="number" min="1900" max={new Date().getFullYear() + 1} value={year} onChange={(event) => setYear(event.currentTarget.value)} required /></label>
            <label>Registration number<input value={registrationNumber} onChange={(event) => setRegistrationNumber(event.currentTarget.value)} autoCapitalize="characters" required /></label>
            <label>Colour<input value={colour} onChange={(event) => setColour(event.currentTarget.value)} required /></label>
            <label>Ownership<select value={ownershipType} onChange={(event) => setOwnershipType(event.currentTarget.value)} required><option value="">Choose ownership type</option>{ownershipTypes.map((item, index) => { const key = getFirstRecordString(item, ["key"]) ?? ""; return <option key={recordKey(item, `ownership-${index}`)} value={key}>{getFirstRecordString(item, ["displayName", "display_name"]) ?? key}</option>; })}</select></label>
            <label>Verified maximum load (kg)<input type="number" min="1" step="0.1" value={maxLoadKg} onChange={(event) => setMaxLoadKg(event.currentTarget.value)} required /></label>
          </ApplicationSubmissionPanel>
        </>
      )}

      {vehicleApplication ? (
        <p className="application-outcome">Vehicle application: <StatusChip tone={statusTone(getFirstRecordString(vehicleApplication, ["status"]))} label={formatStatus(getFirstRecordString(vehicleApplication, ["status"]))} /></p>
      ) : null}
    </QueryState>
  );
}

function readNestedString(record: ReturnType<typeof getRecordObject>, parent: string, key: string): string | null {
  return getFirstRecordString(getRecordObject(record, parent), [key]);
}
