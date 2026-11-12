import * as DocumentPicker from "expo-document-picker";
import { Building2, ShieldCheck, Truck, UsersRound } from "lucide-react-native";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { z } from "zod";

import { domainQueries } from "../api/domains";
import { firstString, type PlatformRecord } from "../api/records";
import { uploadMedia } from "../media/upload";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { SectionHeader } from "./SectionHeader";
import { StatusPill } from "./StatusPill";

const kinds = [
  { key: "individual_owner", label: "Individual owner" },
  { key: "company", label: "Company" },
  { key: "fleet_operator", label: "Fleet operator" },
] as const;
const serviceOptions = [
  { key: "lpg", label: "LPG" },
  { key: "fuel", label: "Fuel" },
] as const;
const roles = [
  { key: "fleet_manager", label: "Fleet manager" },
  { key: "vehicle_manager", label: "Vehicle manager" },
  { key: "compliance_viewer", label: "Compliance viewer" },
] as const;

const InviteResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  expiresAt: z.string().optional(),
  inviteToken: z.string().optional(),
  inviteeEmail: z.string().optional(),
});

export function FleetPartnerPortalScreen() {
  const session = useSession();
  const { palette } = useAppTheme();
  const fleet = domainQueries.myFleet();
  const vehicleTypes = domainQueries.vehicleTypes();
  const [kind, setKind] = useState<(typeof kinds)[number]["key"]>("individual_owner");
  const [name, setName] = useState("");
  const [registration, setRegistration] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const [vehicleTypeId, setVehicleTypeId] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [plate, setPlate] = useState("");
  const [color, setColor] = useState("");
  const [fuelType, setFuelType] = useState("");
  const [maxLoad, setMaxLoad] = useState("");
  const [insuranceExpiresAt, setInsuranceExpiresAt] = useState("");
  const [inspectionExpiresAt, setInspectionExpiresAt] = useState("");
  const [roadworthinessExpiresAt, setRoadworthinessExpiresAt] = useState("");
  const [ownership, setOwnership] = useState("fleet_owned");
  const [legalOwnerName, setLegalOwnerName] = useState("");
  const [legalOwnerIdentifier, setLegalOwnerIdentifier] = useState("");
  const [authorizationReference, setAuthorizationReference] = useState("");
  const [serviceKeys, setServiceKeys] = useState<string[]>(["lpg", "fuel"]);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<(typeof roles)[number]["key"]>("fleet_manager");
  const [inviteReason, setInviteReason] = useState("Authorised to support fleet operations.");
  const [revokeStaffId, setRevokeStaffId] = useState<string | null>(null);
  const [revokeStaffReason, setRevokeStaffReason] = useState("");

  const applications = records(fleet.data?.applications);
  const partners = records(fleet.data?.partners);
  const vehicles = records(fleet.data?.vehicles);
  const assignments = records(fleet.data?.assignments);
  const staff = records(fleet.data?.staff);
  const staffInvitations = records(fleet.data?.staffInvitations);
  const drivers = records(fleet.data?.drivers).filter((driver) => firstString(driver, ["verificationStatus", "verification_status"]) === "approved");
  const docs = records(fleet.data?.applicationDocuments);
  const vehicleDocs = records(fleet.data?.vehicleDocuments);
  const requirements = records(fleet.data?.documentRequirements);
  const vehicleRequirements = records(fleet.data?.vehicleDocumentRequirements);
  const serviceLines = records(fleet.data?.serviceLines);
  const currentApplication = applications.find((row) =>
    ["submitted", "correction_required", "resubmitted"].includes(firstString(row, ["status"]) ?? "")
  ) ?? applications[0] ?? null;
  const applicationId = firstString(currentApplication, ["id"]);
  const partner = partners.find((row) =>
    firstString(row, ["verification_status"]) === "approved" &&
    firstString(row, ["operational_status"]) === "active"
  ) ?? null;
  const partnerId = firstString(partner, ["id"]);
  const hasOpenApplication = applications.some((row) =>
    ["submitted", "correction_required", "resubmitted", "approved"].includes(firstString(row, ["status"]) ?? "")
  );
  const applicableRequirements = useMemo(() => requirements.filter((requirement) => {
    const kindsForRequirement = Array.isArray(requirement.partner_kinds) ? requirement.partner_kinds : [];
    return kindsForRequirement.includes(kind) || (currentApplication &&
      kindsForRequirement.includes(firstString(currentApplication, ["partner_kind"]) ?? ""));
  }), [requirements, kind, currentApplication]);
  const activeVehicleTypes = (vehicleTypes.data ?? []).filter((row) => firstString(row, ["status"]) === "active");

  const submitFleetApplication = async () => {
    setBusy("application"); setError(""); setNotice("");
    try {
      await session.api.post("/runtime/fleet-applications", {
        partnerKind: kind,
        legalName: name.trim(),
        registrationIdentifier: registration.trim() || null,
        applicationPayload: { requestedServiceLines: ["lpg", "fuel"], source: "refill.fleet" },
        source: "skima.fleet.portal",
        idempotencyKey: idempotencyKey("fleet-application", `${kind}:${registration || name}`),
      }, z.string().uuid());
      await fleet.refetch();
      setNotice("Fleet application submitted. Upload the requested evidence below; SKIMA approval is still required.");
    } catch (cause) {
      setError(friendlyError(cause, "The fleet application could not be submitted."));
    } finally { setBusy(null); }
  };

  const uploadEvidence = async (requirement: PlatformRecord) => {
    if (!applicationId) { setError("Submit your fleet application first."); return; }
    const key = firstString(requirement, ["key"]);
    if (!key) return;
    const allowed = Array.isArray(requirement.allowed_content_types)
      ? requirement.allowed_content_types.filter((value): value is string => typeof value === "string")
      : ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    const picked = await DocumentPicker.getDocumentAsync({ type: allowed, copyToCacheDirectory: true, multiple: false });
    if (picked.canceled || !picked.assets[0]) return;
    const file = picked.assets[0];
    if (file.size && file.size > 10 * 1024 * 1024) { setError("Choose a PDF or image no larger than 10 MB."); return; }
    setBusy(`document:${key}`); setError(""); setNotice("");
    try {
      const ownerUserId = session.session?.user.id;
      if (!ownerUserId) throw new Error("Sign in again before uploading private documents.");
      const mediaAssetId = await uploadMedia({
        api: session.api, uri: file.uri, fileName: file.name,
        contentType: file.mimeType ?? "application/octet-stream",
        ownerUserId, assetTypeKey: "media.application-document",
        scope: `fleet-application:${applicationId}:${key}`,
      });
      await session.api.post("/runtime/fleet-applications/documents/register", {
        applicationId, requirementKey: key, mediaAssetId,
        idempotencyKey: idempotencyKey(`fleet-application-document:${key}`, `${applicationId}:${file.name}:${file.size ?? 0}`),
      }, z.string().uuid());
      await fleet.refetch();
      setNotice(`${firstString(requirement, ["display_name"]) ?? key} uploaded and submitted for review.`);
    } catch (cause) {
      setError(friendlyError(cause, "The fleet document could not be uploaded."));
    } finally { setBusy(null); }
  };

  const registerVehicle = async () => {
    if (!partnerId) return;
    if (!vehicleTypeId || !manufacturer.trim() || !model.trim() || !plate.trim() || serviceKeys.length === 0) {
      setError("Choose a vehicle type, enter the vehicle details and select LPG, Fuel or both."); return;
    }
    const expiryDates = [insuranceExpiresAt, inspectionExpiresAt, roadworthinessExpiresAt];
    if (expiryDates.some((date) => !/^\\d{4}-\\d{2}-\\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))) {
      setError("Enter valid YYYY-MM-DD expiry dates for insurance, inspection and roadworthiness. These dates are used for dispatch eligibility.");
      return;
    }
    if (ownership !== "fleet_owned" && (!legalOwnerName.trim() || !legalOwnerIdentifier.trim() || !authorizationReference.trim())) {
      setError("Leased, rented and third-party vehicles require the legal owner's details and an authorisation reference."); return;
    }
    setBusy("vehicle"); setError(""); setNotice("");
    try {
      await session.api.post("/runtime/fleet-vehicles/register", {
        vehicleTypeId, registrationNumber: plate.trim(), manufacturer: manufacturer.trim(), model: model.trim(),
        modelYear: year.trim() ? Number(year) : null, color: color.trim() || null,
        fuelType: fuelType.trim() || null, maxLoadKg: maxLoad.trim() ? Number(maxLoad) : null,
        cargoVolumeM3: null, ownershipRelationship: ownership, serviceKeys,
        insuranceExpiresAt, inspectionExpiresAt, roadworthinessExpiresAt,
        legalOwnerName: legalOwnerName.trim() || null,
        legalOwnerIdentifier: legalOwnerIdentifier.trim() || null,
        authorizationReference: authorizationReference.trim() || null,
        idempotencyKey: idempotencyKey("fleet-partner-vehicle", `${partnerId}:${plate.trim().toUpperCase()}`),
        reason: "Fleet partner registered a vehicle for independent compliance review.",
      }, z.string().uuid());
      await fleet.refetch();
      setPlate(""); setModel(""); setManufacturer(""); setYear(""); setColor(""); setFuelType(""); setMaxLoad("");
      setInsuranceExpiresAt(""); setInspectionExpiresAt(""); setRoadworthinessExpiresAt("");
      setLegalOwnerName(""); setLegalOwnerIdentifier(""); setAuthorizationReference("");
      setNotice("Vehicle registered. It remains pending until SKIMA completes vehicle and service-specific compliance review.");
    } catch (cause) {
      setError(friendlyError(cause, "The vehicle could not be registered."));
    } finally { setBusy(null); }
  };

  const presentInvitationLink = async (invitationId: string, inviteeEmail: string, existingToken?: string) => {
    const token = existingToken ?? (await session.api.post("/runtime/fleet-staff-invitations/issue-link", {
      invitationId,
    }, InviteResponseSchema)).inviteToken;
    if (!token) throw new Error("A fresh invitation link could not be issued. Try again.");
    const inviteUrl = `https://refill.skima.online/fleet-invite?token=${encodeURIComponent(token)}`;
    await Share.share({
      title: "SKIMA Fleet invitation",
      message: `You have been invited to a SKIMA fleet workspace. Sign in with ${inviteeEmail} and accept here: ${inviteUrl}`,
    });
  };

  const inviteStaff = async () => {
    if (!partnerId) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email || inviteReason.trim().length < 5) { setError("Enter the staff email and a reason of at least five characters."); return; }
    setBusy("invite"); setError(""); setNotice("");
    try {
      const invitation = await session.api.post("/runtime/fleet-staff-invitations", {
        fleetPartnerId: partnerId, email, role: inviteRole,
        reason: inviteReason.trim(),
        idempotencyKey: idempotencyKey("fleet-staff-invitation", `${partnerId}:${email}:${inviteRole}`),
      }, InviteResponseSchema);
      await fleet.refetch();
      setInviteEmail("");
      // The creation RPC returns the token only on first creation. If this is an
      // idempotent replay, rotate a fresh link rather than leaving an unshareable invite.
      await presentInvitationLink(invitation.id, email, invitation.inviteToken);
      setNotice("Invitation link issued. Share it with the invited email address; it expires after seven days.");
    } catch (cause) {
      setError(friendlyError(cause, "The fleet invitation could not be created or shared."));
    } finally { setBusy(null); }
  };

  const reissueInvitationLink = async (invitation: PlatformRecord) => {
    const invitationId = firstString(invitation, ["id"]);
    const email = firstString(invitation, ["email", "invitee_email"]);
    if (!invitationId || !email) return;
    setBusy(`invite-link:${invitationId}`); setError(""); setNotice("");
    try {
      await presentInvitationLink(invitationId, email);
      await fleet.refetch();
      setNotice(`A fresh seven-day invitation link was issued for ${email}.`);
    } catch (cause) {
      setError(friendlyError(cause, "A fresh fleet invitation link could not be issued."));
    } finally { setBusy(null); }
  };

  const revokeStaffAccess = async (staff: PlatformRecord) => {
    if (!partnerId) return;
    const staffId = firstString(staff, ["id"]);
    const reason = revokeStaffReason.trim();
    if (!staffId || reason.length < 5) {
      setError("Enter a reason of at least five characters before revoking staff access.");
      return;
    }
    setBusy(`revoke-staff:${staffId}`); setError(""); setNotice("");
    try {
      await session.api.post("/runtime/fleet-staff/status", {
        fleetPartnerId: partnerId,
        staffId,
        reason,
        idempotencyKey: idempotencyKey("fleet-staff-revocation", `${partnerId}:${staffId}:${reason}`),
      }, z.string().uuid());
      setRevokeStaffId(null); setRevokeStaffReason("");
      await fleet.refetch();
      setNotice("Staff access revoked. The change has been recorded in the fleet audit trail.");
    } catch (cause) {
      setError(friendlyError(cause, "Fleet staff access could not be revoked."));
    } finally { setBusy(null); }
  };

  const assignDriver = async (driverProfileId: string, vehicleId: string, serviceKey: "lpg" | "fuel") => {
    if (!partnerId) return;
    setBusy(`assign:${driverProfileId}:${serviceKey}`); setError(""); setNotice("");
    try {
      await session.api.post("/runtime/fleet-vehicles/assignments", {
        fleetPartnerId: partnerId, driverProfileId, vehicleId, serviceKey,
        relationship: "fleet_owned",
        reason: `Fleet owner authorised this driver for ${serviceKey.toUpperCase()} vehicle operations.`,
        idempotencyKey: idempotencyKey("fleet-driver-assignment", `${partnerId}:${driverProfileId}:${vehicleId}:${serviceKey}`),
      }, z.string().uuid());
      await fleet.refetch(); setNotice(`Driver assigned for ${serviceKey.toUpperCase()} operations.`);
    } catch (cause) {
      setError(friendlyError(cause, "The driver could not be assigned. Check vehicle, driver and service compliance."));
    } finally { setBusy(null); }
  };

  const uploadVehicleEvidence = async (vehicle: PlatformRecord, requirement: PlatformRecord) => {
    const vehicleId = firstString(vehicle, ["id"]);
    const requirementKey = firstString(requirement, ["key"]);
    const ownerUserId = session.session?.user.id;
    if (!vehicleId || !requirementKey || !ownerUserId) return;
    const picked = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
      copyToCacheDirectory: true, multiple: false,
    });
    if (picked.canceled || !picked.assets[0]) return;
    const file = picked.assets[0];
    if (file.size && file.size > 10 * 1024 * 1024) { setError("Choose a PDF or image no larger than 10 MB."); return; }
    setBusy(`vehicle-document:${vehicleId}:${requirementKey}`); setError(""); setNotice("");
    try {
      const mediaAssetId = await uploadMedia({
        api: session.api, uri: file.uri, fileName: file.name,
        contentType: file.mimeType ?? "application/octet-stream",
        ownerUserId, assetTypeKey: "media.application-document",
        scope: `fleet-vehicle:${vehicleId}:${requirementKey}`,
      });
      await session.api.post("/runtime/fleet-vehicles/documents", {
        vehicleId, requirementKey, mediaAssetId,
        validFrom: new Date().toISOString().slice(0, 10),
        validUntil: requirementKey === "vehicle.insurance" ? firstString(vehicle, ["insurance_expires_at"])
          : requirementKey === "vehicle.inspection" ? firstString(vehicle, ["inspection_expires_at"])
            : requirementKey === "vehicle.roadworthiness" ? firstString(vehicle, ["roadworthiness_expires_at"]) : null,
        reason: `Fleet owner submitted ${firstString(requirement, ["displayName"]) ?? requirementKey} for review.`,
        idempotencyKey: idempotencyKey(`fleet-vehicle-document:${requirementKey}`, `${vehicleId}:${file.name}:${file.size ?? 0}`),
      }, z.string().uuid());
      await fleet.refetch(); setNotice("Vehicle evidence uploaded and sent for independent SKIMA review.");
    } catch (cause) {
      setError(friendlyError(cause, "The vehicle document could not be uploaded."));
    } finally { setBusy(null); }
  };

  const resubmitApplication = async () => {
    if (!applicationId) return;
    setBusy("resubmit"); setError(""); setNotice("");
    try {
      await session.api.post("/runtime/fleet-applications/resubmit", {
        applicationId,
        applicationPayload: currentApplication?.application_payload && typeof currentApplication.application_payload === "object"
          ? currentApplication.application_payload as Record<string, unknown> : {},
        reason: "Resubmitted after providing the requested supporting evidence.",
        idempotencyKey: idempotencyKey("fleet-application-resubmit", applicationId),
      }, z.string().uuid());
      await fleet.refetch(); setNotice("Corrected fleet application resubmitted.");
    } catch (cause) {
      setError(friendlyError(cause, "The corrected application could not be resubmitted."));
    } finally { setBusy(null); }
  };

  if (fleet.isPending) return <ScreenSkeleton cards={4} />;

  return (
    <Screen eyebrow="Fleet owner portal" title="Your fleet"
      subtitle="Manage fleet ownership, authorised people and vehicles for LPG and Fuel in one place.">
      <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
        <Building2 color="#fff" size={28} />
        <View style={styles.copy}>
          <Text style={styles.heroTitle}>Your fleet, your authorised team</Text>
          <Text style={styles.heroBody}>Register vehicles for LPG, Fuel or both. Vehicle approval, service eligibility and driver assignments are reviewed separately.</Text>
        </View>
      </View>

      <View style={styles.metrics}>
        <Metric icon={<Building2 color={palette.brand} size={18} />} label="Fleet partners" value={partners.length} />
        <Metric icon={<Truck color={palette.brand} size={18} />} label="Vehicles" value={vehicles.length} />
        <Metric icon={<UsersRound color={palette.brand} size={18} />} label="Staff" value={staff.length} />
      </View>

      {error ? <Text accessibilityRole="alert" style={[styles.message,{color:palette.danger}]}>{error}</Text> : null}
      {notice ? <Text style={[styles.message,{color:palette.success}]}>{notice}</Text> : null}

      {!hasOpenApplication ? (
        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <SectionHeader title="Register a fleet partner" description="Choose the legal or operating capacity in which you are applying." />
          <View style={styles.chips}>{kinds.map((item) => (
            <Choice key={item.key} active={kind===item.key} label={item.label} onPress={() => setKind(item.key)} />
          ))}</View>
          <Field label={kind==="individual_owner" ? "Legal name" : "Registered name"} value={name} onChangeText={setName} placeholder="Name on registration documents" />
          <Field label="Registration identifier" value={registration} onChangeText={setRegistration} placeholder="Company or owner registration reference" />
          <View style={[styles.note,{backgroundColor:palette.surfaceSubtle}]}>
            <ShieldCheck color={palette.brand} size={18} />
            <Text style={[styles.noteText,{color:palette.muted}]}>Your application is not approved on submission. Upload the evidence requested after submission. SKIMA will review it before activating your fleet.</Text>
          </View>
          <AppButton fullWidth size="lg" label="Submit fleet application" loading={busy==="application"} disabled={name.trim().length<2 || busy!==null} onPress={() => void submitFleetApplication()} />
        </View>
      ) : (
        <View style={[styles.card,{backgroundColor:palette.surface,borderColor:palette.border}]}>
          <SectionHeader title="Application progress" description="Upload all required evidence and track SKIMA's decision." />
          <View style={styles.row}>
            <View style={styles.copy}>
              <Text style={[styles.cardTitle,{color:palette.ink}]}>{firstString(currentApplication,["legal_name"]) ?? "Fleet application"}</Text>
              <Text style={[styles.meta,{color:palette.muted}]}>Revision {String(currentApplication?.revision ?? 1)}</Text>
            </View>
            <StatusPill label={(firstString(currentApplication,["status"]) ?? "submitted").replaceAll("_"," ")}
              tone={firstString(currentApplication,["status"])==="approved" ? "success" : "warning"} />
          </View>
          {applicableRequirements.map((requirement) => {
            const key=firstString(requirement,["key"]) ?? "";
            const linked=docs.filter((doc) => firstString(doc,["applicationId","fleetApplicationId","fleet_application_id"])===applicationId
              && firstString(doc,["requirementKey","requirement_key"])===key);
            const latest=linked[0];
            const status=firstString(latest,["status"]) ?? "awaiting upload";
            return <View key={key} style={styles.documentRow}>
              <View style={styles.copy}>
                <Text style={[styles.cardTitle,{color:palette.ink}]}>{firstString(requirement,["display_name"]) ?? key}</Text>
                <Text style={[styles.meta,{color:palette.muted}]}>{firstString(requirement,["required"])==="false" || requirement.required===false ? "Optional" : "Required"} · {status.replaceAll("_"," ")}</Text>
                {firstString(latest,["decisionReason","decision_reason"]) ? <Text style={[styles.meta,{color:palette.danger}]}>{firstString(latest,["decisionReason","decision_reason"])}</Text> : null}
              </View>
              <AppButton size="sm" variant="secondary" label={busy===`document:${key}` ? "Uploading…" : "Upload"}
                disabled={busy!==null} onPress={() => void uploadEvidence(requirement)} />
            </View>;
          })}
          {firstString(currentApplication,["status"])==="correction_required" ? <AppButton fullWidth label="Resubmit corrected application" disabled={busy!==null} loading={busy==="resubmit"} onPress={() => void resubmitApplication()} /> : null}
          <Text style={[styles.meta,{color:palette.muted}]}>Documents must be approved individually before the fleet application can be approved.</Text>
        </View>
      )}

      {partner && partnerId ? (
        <>
          <View style={[styles.card,{backgroundColor:palette.surface,borderColor:palette.border}]}>
            <SectionHeader title="Register a vehicle" description="Each vehicle can request LPG, Fuel or both. SKIMA reviews the vehicle and service-line compliance before dispatch." />
            <Text style={[styles.meta,{color:palette.muted}]}>Vehicle type</Text>
            <View style={styles.chips}>{activeVehicleTypes.slice(0,10).map((item) => {
              const id=firstString(item,["id"]) ?? "";
              return <Choice key={id} active={vehicleTypeId===id} label={firstString(item,["display_name","name","key"]) ?? "Vehicle"} onPress={() => setVehicleTypeId(id)} />;
            })}</View>
            <Field label="Manufacturer" value={manufacturer} onChangeText={setManufacturer} placeholder="e.g. Toyota" />
            <Field label="Model" value={model} onChangeText={setModel} placeholder="e.g. Hilux" />
            <Field label="Registration number" value={plate} onChangeText={setPlate} placeholder="Vehicle plate number" />
            <View style={styles.twoCols}>
              <Field label="Model year" value={year} onChangeText={setYear} placeholder="2022" keyboardType="numeric" />
              <Field label="Colour" value={color} onChangeText={setColor} placeholder="White" />
            </View>
            <View style={styles.twoCols}>
              <Field label="Vehicle fuel type" value={fuelType} onChangeText={setFuelType} placeholder="Diesel / Petrol" />
              <Field label="Maximum load (kg)" value={maxLoad} onChangeText={setMaxLoad} placeholder="Optional" keyboardType="numeric" />
            </View>
            <Field label="Insurance valid until (YYYY-MM-DD)" value={insuranceExpiresAt} onChangeText={setInsuranceExpiresAt} placeholder="2027-10-31" />
            <View style={styles.twoCols}>
              <Field label="Inspection valid until" value={inspectionExpiresAt} onChangeText={setInspectionExpiresAt} placeholder="YYYY-MM-DD" />
              <Field label="Roadworthiness valid until" value={roadworthinessExpiresAt} onChangeText={setRoadworthinessExpiresAt} placeholder="YYYY-MM-DD" />
            </View>
            <Text style={[styles.meta,{color:palette.muted}]}>These dates must match the documents you upload. Expired evidence blocks dispatch until a replacement is approved.</Text>
            <Text style={[styles.meta,{color:palette.muted}]}>Ownership or operating relationship</Text>
            <View style={styles.chips}>
              {[
                ["fleet_owned","Owned by fleet"],["leased","Leased"],["rented","Rented"],["third_party_authorized","Third-party authorised"],
              ].map(([key,label])=><Choice key={key} active={ownership===key} label={label} onPress={()=>setOwnership(key)} />)}
            </View>
            {ownership!=="fleet_owned" ? (
              <View style={styles.assignmentGroup}>
                <Field label="Legal owner's name" value={legalOwnerName} onChangeText={setLegalOwnerName} placeholder="Name on vehicle ownership documents" />
                <Field label="Legal owner registration / identity reference" value={legalOwnerIdentifier} onChangeText={setLegalOwnerIdentifier} placeholder="Registered company or owner reference" />
                <Field label="Lease, rental or authorisation reference" value={authorizationReference} onChangeText={setAuthorizationReference} placeholder="Agreement or permission reference" />
                <Text style={[styles.meta,{color:palette.muted}]}>Upload the ownership or vehicle-use authorisation document in the vehicle evidence section after registration.</Text>
              </View>
            ) : null}
            <Text style={[styles.meta,{color:palette.muted}]}>Services requested</Text>
            <View style={styles.chips}>{serviceOptions.map((service) => {
              const selected=serviceKeys.includes(service.key);
              return <Choice key={service.key} active={selected} label={service.label} onPress={() => setServiceKeys((current) =>
                selected ? current.filter((key)=>key!==service.key) : [...current,service.key]
              )} />;
            })}</View>
            <AppButton fullWidth label="Register vehicle" loading={busy==="vehicle"} disabled={busy!==null} onPress={() => void registerVehicle()} />
          </View>

          <View style={[styles.card,{backgroundColor:palette.surface,borderColor:palette.border}]}>
            <SectionHeader title="Vehicles and service eligibility" description="A vehicle registration is not dispatch approval. LPG and Fuel are reviewed independently." />
            {vehicles.length===0 ? <EmptyState icon={<Truck color={palette.brand} size={24}/>} title="No vehicles registered" description="Your approved fleet can register its first vehicle above."/> :
              vehicles.map((vehicle) => {
                const id=firstString(vehicle,["id"]) ?? "";
                const lines=serviceLines.filter((line)=>firstString(line,["vehicle_id","vehicleId"])===id);
                const requestedServices=lines.map((line)=>firstString(line,["service_key"])).filter((key):key is string=>key==="lpg"||key==="fuel");
                const requirementsForVehicle=vehicleRequirements.filter((requirement)=>{
                  const moduleKey=firstString(requirement,["module_key","moduleKey"]);
                  return !moduleKey || requestedServices.includes(moduleKey as "lpg"|"fuel");
                });
                const ownershipEvidence=vehicle.metadata && typeof vehicle.metadata==="object" && !Array.isArray(vehicle.metadata)
                  ? (vehicle.metadata as Record<string,unknown>).fleetOwnershipEvidence as Record<string,unknown> | undefined : undefined;
                return <View key={id} style={styles.vehicleRow}>
                  <View style={styles.copy}>
                    <Text style={[styles.cardTitle,{color:palette.ink}]}>{firstString(vehicle,["manufacturer"]) ?? ""} {firstString(vehicle,["model"]) ?? ""}</Text>
                    <Text style={[styles.meta,{color:palette.muted}]}>{firstString(vehicle,["registration_number"]) ?? "Registration pending"} · {firstString(vehicle,["status"]) ?? "pending"}</Text>
                    {ownershipEvidence?.relationship && ownershipEvidence.relationship!=="fleet_owned" ? <Text style={[styles.meta,{color:palette.muted}]}>Legal owner: {String(ownershipEvidence.legalOwnerName ?? "Details supplied")} · {String(ownershipEvidence.relationship)}</Text> : null}
                    <View style={styles.chips}>{lines.map((line) => <StatusPill key={String(line.id)} label={`${firstString(line,["service_key"])?.toUpperCase()} · ${firstString(line,["status"])?.replaceAll("_"," ")}`}
                      tone={firstString(line,["status"])==="active" ? "success" : "warning"} />)}</View>
                  </View>
                  {requirementsForVehicle.map((requirement)=>{
                    const key=firstString(requirement,["key"]) ?? "";
                    const submitted=vehicleDocs.find((doc)=>firstString(doc,["vehicleId","vehicle_id"])===id &&
                      firstString(doc,["purposeKey","purpose_key"])===key);
                    const docStatus=firstString(submitted,["status"]) ?? "awaiting upload";
                    return <View key={key} style={styles.documentRow}>
                      <View style={styles.copy}>
                        <Text style={[styles.cardTitle,{color:palette.ink}]}>{firstString(requirement,["displayName","display_name"]) ?? key}</Text>
                        <Text style={[styles.meta,{color:palette.muted}]}>{docStatus.replaceAll("_"," ")}</Text>
                        {firstString(submitted,["decisionReason","decision_reason"]) ? <Text style={[styles.meta,{color:palette.danger}]}>{firstString(submitted,["decisionReason","decision_reason"])}</Text> : null}
                      </View>
                      <AppButton size="sm" variant="secondary" label="Upload / replace" disabled={busy!==null || docStatus==="approved"}
                        loading={busy===`vehicle-document:${id}:${key}`} onPress={()=>void uploadVehicleEvidence(vehicle,requirement)} />
                    </View>;
                  })}
                </View>;
              })}
            {vehicles.some((vehicle)=>firstString(vehicle,["status"])==="active") && drivers.length>0 ? (
              <View style={styles.assignmentGroup}>
                <SectionHeader title="Authorised driver assignments" description="Only SKIMA-approved drivers and vehicles cleared for the selected service can be assigned." />
                {drivers.map((driver) => {
                  const driverId=firstString(driver,["id","driverProfileId"]) ?? "";
                  const assigned=assignments.find((row)=>firstString(row,["driver_profile_id"])===driverId && firstString(row,["status"])==="active");
                  return <View key={driverId} style={styles.documentRow}>
                    <View style={styles.copy}>
                      <Text style={[styles.cardTitle,{color:palette.ink}]}>{firstString(driver,["displayName","driver_display_name","publicDriverId"]) ?? "Approved driver"}</Text>
                      <Text style={[styles.meta,{color:palette.muted}]}>{assigned ? "Vehicle assignment active" : "No active assignment"}</Text>
                    </View>
                    {!assigned ? <View style={styles.chips}>
                      {serviceOptions.map((service)=>{
                        const candidate=vehicles.find((vehicle)=>{
                          const vehicleId=firstString(vehicle,["id"]) ?? "";
                          return firstString(vehicle,["status"])==="active" &&
                            linesForService(service.key,vehicleId,serviceLines) &&
                            !assignments.some((row)=>firstString(row,["vehicle_id"])===vehicleId && firstString(row,["status"])==="active");
                        });
                        return candidate ? <AppButton key={service.key} size="sm" variant="secondary" label={`Assign ${service.label}`}
                          disabled={busy!==null} loading={busy===`assign:${driverId}:${service.key}`}
                          onPress={()=>void assignDriver(driverId,firstString(candidate,["id"]) ?? "",service.key)} /> : null;
                      })}
                    </View> : null}
                  </View>;
                })}
              </View>
            ) : null}
          </View>

          <View style={[styles.card,{backgroundColor:palette.surface,borderColor:palette.border}]}>
            <SectionHeader title="Invite authorised staff" description="Invited managers and compliance viewers receive role-limited access only after accepting the secure email-bound invitation." />
            <Field label="Email address" value={inviteEmail} onChangeText={setInviteEmail} placeholder="person@example.com" keyboardType="email-address" autoCapitalize="none" />
            <View style={styles.chips}>{roles.map((role)=><Choice key={role.key} active={inviteRole===role.key} label={role.label} onPress={()=>setInviteRole(role.key)} />)}</View>
            <Field label="Invitation reason" value={inviteReason} onChangeText={setInviteReason} placeholder="Reason for access" />
            <AppButton fullWidth label="Create invitation" loading={busy==="invite"} disabled={busy!==null} onPress={() => void inviteStaff()} />
            {staff.map((person,index)=>{
              const staffId = firstString(person, ["id"]);
              const role = firstString(person, ["access_role"]);
              const active = firstString(person, ["status"]) === "active";
              const canRevoke = active && role !== "owner_admin" && Boolean(staffId);
              return <View key={String(person.id ?? index)} style={styles.documentRow}>
                <View style={styles.copy}>
                  <Text style={[styles.cardTitle,{color:palette.ink}]}>{role?.replaceAll("_"," ") ?? "Fleet staff"}</Text>
                  <Text style={[styles.meta,{color:palette.muted}]}>{firstString(person,["user_id"]) ?? "Authorised SKIMA account"} · {firstString(person,["status"]) ?? "active"}</Text>
                  {revokeStaffId === staffId ? <>
                    <Field label="Reason for revocation" value={revokeStaffReason} onChangeText={setRevokeStaffReason} placeholder="Explain why access is being removed" />
                    <View style={styles.chips}>
                      <AppButton size="sm" variant="secondary" label="Cancel" disabled={busy!==null} onPress={()=>{setRevokeStaffId(null);setRevokeStaffReason("");}} />
                      <AppButton size="sm" label="Confirm revoke" loading={busy===`revoke-staff:${staffId}`} disabled={busy!==null || revokeStaffReason.trim().length<5} onPress={()=>void revokeStaffAccess(person)} />
                    </View>
                  </> : null}
                </View>
                {canRevoke && revokeStaffId !== staffId ? <AppButton size="sm" variant="secondary" label="Revoke access" disabled={busy!==null} onPress={()=>{setRevokeStaffId(staffId);setRevokeStaffReason("");setError("");}} /> : null}
              </View>;
            })}
            {staffInvitations.filter((invite)=>["pending","expired"].includes(firstString(invite,["status"]) ?? "")).map((invite)=>(
              <View key={String(invite.id)} style={styles.documentRow}>
                <View style={styles.copy}>
                  <Text style={[styles.cardTitle,{color:palette.ink}]}>{firstString(invite,["email","invitee_email"]) ?? "Invited staff"}</Text>
                  <Text style={[styles.meta,{color:palette.muted}]}>{firstString(invite,["role","access_role"])?.replaceAll("_"," ")} · {firstString(invite,["status"]) ?? "pending"}</Text>
                </View>
                <AppButton size="sm" variant="secondary"
                  label={firstString(invite,["status"])==="expired" ? "Renew link" : "Share link"}
                  loading={busy===`invite-link:${String(invite.id)}`} disabled={busy!==null}
                  onPress={()=>void reissueInvitationLink(invite)} />
              </View>
            ))}
          </View>
        </>
      ) : null}


    </Screen>
  );
}

function linesForService(serviceKey: "lpg" | "fuel", vehicleId: string, lines: PlatformRecord[]) {
  return lines.some((line) => firstString(line, ["vehicle_id", "vehicleId"]) === vehicleId &&
    firstString(line, ["service_key"]) === serviceKey && firstString(line, ["status"]) === "active");
}

export function FleetInviteAcceptanceScreen({ token }: { token: string }) {
  const session = useSession();
  const { palette } = useAppTheme();
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState("");
  const [error,setError] = useState("");
  const accept = async () => {
    if (!token) { setError("This invitation link is missing its secure token."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await session.api.post("/runtime/fleet-staff-invitations/accept",{inviteToken:token},z.string().uuid());
      setNotice("Fleet invitation accepted. Your authorised workspace is now available.");
    } catch (cause) {
      setError(friendlyError(cause,"This invitation could not be accepted. Sign in with the exact invited email address and try again."));
    } finally { setBusy(false); }
  };
  return <Screen eyebrow="Fleet invitation" title="Join a fleet" subtitle="Sign in with the exact email address the fleet owner invited.">
    {error ? <Text accessibilityRole="alert" style={[styles.message,{color:palette.danger}]}>{error}</Text> : null}
    {notice ? <Text style={[styles.message,{color:palette.success}]}>{notice}</Text> : null}
    <AppButton fullWidth label="Accept fleet invitation" loading={busy} disabled={!token || session.status!=="authenticated"} onPress={()=>void accept()} />
  </Screen>;
}

function records(value: unknown): PlatformRecord[] {
  return Array.isArray(value) ? value.filter((item): item is PlatformRecord => Boolean(item) && typeof item==="object") : [];
}
function Field(props: {label:string;value:string;onChangeText:(value:string)=>void;placeholder?:string;keyboardType?: "default"|"numeric"|"email-address";autoCapitalize?:"none"|"sentences"|"words"|"characters"}) {
  const {palette}=useAppTheme();
  return <View style={styles.field}><Text style={[styles.fieldLabel,{color:palette.ink}]}>{props.label}</Text>
    <TextInput value={props.value} onChangeText={props.onChangeText} placeholder={props.placeholder}
      keyboardType={props.keyboardType ?? "default"} autoCapitalize={props.autoCapitalize ?? "sentences"}
      placeholderTextColor={palette.muted} style={[styles.input,{color:palette.ink,borderColor:palette.border,backgroundColor:palette.surfaceSubtle}]} /></View>;
}
function Choice(props:{label:string;active:boolean;onPress:()=>void}) {
  const {palette}=useAppTheme();
  return <Pressable onPress={props.onPress} style={[styles.choice,{backgroundColor:props.active?palette.brand:palette.surface,borderColor:props.active?palette.brand:palette.border}]}>
    <Text style={{color:props.active?"#fff":palette.ink,fontWeight:"800",fontSize:11}}>{props.label}</Text></Pressable>;
}
function Metric({icon,label,value}:{icon:ReactNode;label:string;value:number}) {
  const {palette}=useAppTheme();
  return <View style={[styles.metric,{backgroundColor:palette.surface,borderColor:palette.border}]}>{icon}
    <Text style={[styles.metricValue,{color:palette.ink}]}>{value}</Text><Text style={[styles.meta,{color:palette.muted}]}>{label}</Text></View>;
}
const styles=StyleSheet.create({
  hero:{borderRadius:radii.xl,padding:spacing.lg,flexDirection:"row",gap:spacing.md},
  copy:{flex:1,gap:5},heroTitle:{...typography.heading,color:"#fff"},heroBody:{...typography.body,color:"rgba(255,255,255,.84)"},
  metrics:{flexDirection:"row",gap:spacing.sm},metric:{flex:1,borderWidth:1,borderRadius:radii.lg,padding:spacing.md,gap:4},metricValue:{...typography.heading},
  card:{borderWidth:1,borderRadius:radii.xl,padding:spacing.lg,gap:spacing.md},
  chips:{flexDirection:"row",flexWrap:"wrap",gap:spacing.xs},choice:{borderWidth:1,borderRadius:radii.pill,paddingHorizontal:spacing.md,paddingVertical:9},
  field:{gap:6},fieldLabel:{...typography.caption,fontWeight:"800"},input:{borderWidth:1,borderRadius:radii.lg,paddingHorizontal:14,paddingVertical:12,...typography.body},
  note:{flexDirection:"row",gap:spacing.sm,padding:spacing.md,borderRadius:radii.md},noteText:{...typography.caption,flex:1},
  message:{...typography.caption,fontWeight:"800"},row:{flexDirection:"row",alignItems:"center",gap:spacing.md},
  cardTitle:{...typography.bodyStrong},meta:{...typography.caption},documentRow:{flexDirection:"row",alignItems:"center",gap:spacing.md,paddingVertical:spacing.sm,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:"rgba(128,128,128,.2)"},
  vehicleRow:{paddingVertical:spacing.sm,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:"rgba(128,128,128,.2)"},assignmentGroup:{gap:spacing.sm},
  twoCols:{flexDirection:"row",gap:spacing.sm},assignmentText:{...typography.caption},
});