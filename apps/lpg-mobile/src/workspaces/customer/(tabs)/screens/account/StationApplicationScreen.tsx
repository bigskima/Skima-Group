import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, LocateFixed, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useSession } from "@lpg/app/providers/SessionProvider";
import { ApplicationSubmissionPanel } from "@lpg/features/applications/ApplicationSubmissionPanel";
import {
  findCurrentApplication,
  findLpgApplicationType,
  getLatestApplicationPayload,
  useApplicationsQuery,
  useApplicationTypesQuery,
  useApplicationVersionsQuery,
} from "@lpg/features/applications/api";
import { useLpgConfigQuery } from "@lpg/features/config/api";
import { useDeviceLocation } from "@lpg/features/location/useDeviceLocation";
import { useStationsQuery } from "@lpg/features/stations/api";
import {
  getConfigRecords,
  getFirstRecordNumber,
  getFirstRecordString,
  getRecordId,
  getRecordObject,
  type PlatformRecord,
} from "@lpg/shared/api/records";
import { mutationErrorMessage, useGatewayCommandMutation } from "@lpg/shared/api/useGatewayMutation";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { WorkflowFormSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import { WorkflowHeader } from "@lpg/shared/ui/WorkflowScreen";
import type { CustomerScreenProps } from "../../navigation/customerRoutes";

export function StationApplicationScreen(props: CustomerScreenProps) {
  const session = useSession();
  const queryClient = useQueryClient();
  const applicationTypes = useApplicationTypesQuery();
  const applications = useApplicationsQuery();
  const config = useLpgConfigQuery();
  const stations = useStationsQuery();
  const stationType = findLpgApplicationType(applicationTypes.data, "business");
  const application = findCurrentApplication(applications.data, stationType);
  const applicationId = getRecordId(application);
  const versions = useApplicationVersionsQuery(applicationId);
  const payload = getLatestApplicationPayload(versions.data);
  const location = useDeviceLocation();
  const activation = useGatewayCommandMutation({
    onSuccess: async () => {
      await session.refreshContext();
      await queryClient.invalidateQueries({ queryKey: ["lpg-mobile"] });
    },
  });
  const profiles = getConfigRecords(config.data, "cylinderTypeProfiles");
  const applicationStatus = getFirstRecordString(application, ["status"]);
  const organizationId = getFirstRecordString(application, ["organization_id", "organizationId"]);
  const stationIsActive = (stations.data ?? []).some((station) =>
    getFirstRecordString(station, ["organization_id", "organizationId"]) === organizationId &&
    getFirstRecordString(station, ["approval_status", "approvalStatus"]) === "approved"
  );

  const [displayName, setDisplayName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState(props.context.user.email ?? "");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [capacityKg, setCapacityKg] = useState("");
  const [openingTime, setOpeningTime] = useState("");
  const [closingTime, setClosingTime] = useState("");
  const [supportedSizes, setSupportedSizes] = useState<readonly number[]>([]);

  useEffect(() => {
    if (!payload) return;
    const organization = getRecordObject(payload, "organization");
    const contact = getRecordObject(payload, "contact");
    const station = getRecordObject(payload, "station");
    setDisplayName(getFirstRecordString(organization, ["displayName", "display_name"]) ?? "");
    setLegalName(getFirstRecordString(organization, ["legalName", "legal_name"]) ?? "");
    setSlug(getFirstRecordString(organization, ["slug"]) ?? "");
    setEmail(getFirstRecordString(contact, ["email"]) ?? props.context.user.email ?? "");
    setPhone(getFirstRecordString(contact, ["phone"]) ?? "");
    setAddress(getFirstRecordString(station, ["formattedAddress", "formatted_address"]) ?? "");
    setLatitude(getFirstRecordNumber(station, ["latitude"]));
    setLongitude(getFirstRecordNumber(station, ["longitude"]));
    const capacity = getFirstRecordNumber(station, ["refillCapacityKg", "refill_capacity_kg"]);
    setCapacityKg(capacity === null ? "" : String(capacity));
    const hours = getRecordObject(station, "operatingHours");
    setOpeningTime(getFirstRecordString(hours, ["opensAt", "opens_at"]) ?? "");
    setClosingTime(getFirstRecordString(hours, ["closesAt", "closes_at"]) ?? "");
    const sizes = station?.["supportedCylinderSizesKg"];
    setSupportedSizes(Array.isArray(sizes) ? sizes.map(Number).filter((value) => Number.isFinite(value)) : []);
  }, [payload, props.context.user.email]);

  const submission = useMemo(() => ({
    contact: { email: email.trim(), phone: phone.trim() },
    organization: {
      displayName: displayName.trim(),
      legalName: legalName.trim(),
      slug: slug.trim(),
    },
    ownership: { ownerUserId: props.context.user.id },
    station: {
      formattedAddress: address.trim(),
      latitude,
      longitude,
      operatingHours: { closesAt: closingTime, opensAt: openingTime },
      refillCapacityKg: Number(capacityKg),
      supportedCylinderSizesKg: supportedSizes,
    },
  }), [address, capacityKg, closingTime, displayName, email, latitude, legalName, longitude, openingTime, phone, props.context.user.id, slug, supportedSizes]);

  const captureLocation = async () => {
    const next = await location.request();
    setLatitude(next.latitude);
    setLongitude(next.longitude);
  };

  const activate = () => {
    if (!applicationId || !organizationId || latitude === null || longitude === null) return;
    activation.mutate({
      path: "/lpg/stations/activate",
      payload: {
        applicationId,
        branchKey: slug,
        currentAvailableKg: Number(capacityKg),
        displayName,
        formattedAddress: address,
        idempotencyKey: `frontend:lpg-station-activation:${applicationId}`,
        latitude,
        longitude,
        operatingHours: { closesAt: closingTime, opensAt: openingTime },
        organizationId,
        ownerUserId: props.context.user.id,
        refillCapacityKg: Number(capacityKg),
        supportedCylinderSizesKg: supportedSizes,
      },
    });
  };

  const loading = applicationTypes.isLoading || applications.isLoading || config.isLoading || stations.isLoading || versions.isLoading;
  const error = applicationTypes.error ?? applications.error ?? config.error ?? stations.error ?? versions.error;
  const refresh = () => void Promise.all([applicationTypes.refetch(), applications.refetch(), config.refetch(), stations.refetch()]);

  return (
    <QueryState loading={loading} error={error} onRetry={refresh} skeleton={<WorkflowFormSkeleton />}>
      <WorkflowHeader title="Station Application" subtitle="Business approval and branch activation" onBack={props.navigation.goBack} />
      <div className="application-stage-bar">
        <span className={applicationStatus === "approved" ? "is-complete" : "is-current"}>1 Approval</span>
        <span className={applicationStatus === "approved" ? "is-current" : ""}>2 Activation</span>
        <button type="button" className="icon-button" aria-label="Refresh application status" onClick={refresh}><RefreshCw aria-hidden="true" /></button>
      </div>

      {!stationIsActive && applicationStatus !== "approved" ? (
        <ApplicationSubmissionPanel application={application} applicationType={stationType} payload={submission} submitLabel="Submit Station Application">
          <label>Station name<input value={displayName} onChange={(event) => { const value = event.currentTarget.value; setDisplayName(value); if (!slug) setSlug(toSlug(value)); }} required /></label>
          <label>Registered legal name<input value={legalName} onChange={(event) => setLegalName(event.currentTarget.value)} required /></label>
          <label>Organization key<input value={slug} onChange={(event) => setSlug(toSlug(event.currentTarget.value))} pattern="[a-z0-9-]+" required /></label>
          <label>Business email<input type="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} autoComplete="email" required /></label>
          <label>Business phone<input value={phone} onChange={(event) => setPhone(event.currentTarget.value)} autoComplete="tel" inputMode="tel" required /></label>
          <label>Station address<textarea value={address} onChange={(event) => setAddress(event.currentTarget.value)} required /></label>
          <button type="button" className="secondary-button" onClick={() => void captureLocation()} disabled={location.isLocating}><LocateFixed aria-hidden="true" />{location.isLocating ? "Locating" : latitude === null ? "Use Station Location" : "Location Captured"}</button>
          {location.error ? <p className="form-message is-error">{location.error}</p> : null}
          <label>Refill capacity (kg)<input type="number" min="1" step="0.1" value={capacityKg} onChange={(event) => setCapacityKg(event.currentTarget.value)} required /></label>
          <div className="form-grid two-column"><label>Opening time<input type="time" value={openingTime} onChange={(event) => setOpeningTime(event.currentTarget.value)} required /></label><label>Closing time<input type="time" value={closingTime} onChange={(event) => setClosingTime(event.currentTarget.value)} required /></label></div>
          <fieldset className="configured-options"><legend>Supported cylinder types</legend>{profiles.map((profile) => {
            const size = getFirstRecordNumber(profile, ["sizeKg", "size_kg"]);
            if (size === null) return null;
            return <label key={getFirstRecordString(profile, ["key"]) ?? String(size)}><input type="checkbox" checked={supportedSizes.includes(size)} onChange={() => setSupportedSizes((current) => current.includes(size) ? current.filter((item) => item !== size) : [...current, size])} />{getFirstRecordString(profile, ["displayName", "display_name"]) ?? `${size} kg`}</label>;
          })}</fieldset>
        </ApplicationSubmissionPanel>
      ) : null}

      {!stationIsActive && applicationStatus === "approved" ? (
        <section className="workflow-form activation-panel">
          <p className="form-message is-success"><CheckCircle2 aria-hidden="true" />Business application approved</p>
          <p>Confirm the approved branch details to begin receiving LPG jobs.</p>
          <button type="button" className="primary-button" onClick={activate} disabled={activation.isPending || !applicationId || !organizationId || latitude === null || longitude === null}>Activate Station</button>
          {activation.error ? <p className="form-message is-error">{mutationErrorMessage(activation.error)}</p> : null}
        </section>
      ) : null}

      {stationIsActive ? <section className="application-status-panel"><CheckCircle2 aria-hidden="true" /><div><h2>Station active</h2><p>Your station workspace access is controlled by the approved backend role manifest.</p></div></section> : null}
    </QueryState>
  );
}

function toSlug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
