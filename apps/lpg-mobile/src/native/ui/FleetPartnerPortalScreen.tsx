import * as DocumentPicker from "expo-document-picker";
import { Building2, CheckCircle2, FileCheck2, ShieldCheck, Truck, UsersRound } from "lucide-react-native";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { z } from "zod";

import { domainQueries } from "../api/domains";
import { ActionResponseSchema, firstString, type PlatformRecord } from "../api/records";
import { uploadFileToRuntime } from "../media/upload";
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
  { key: "driver_operator", label: "Authorised driver" },
] as const;

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
  const [ownership, setOwnership] = useState("fleet_owned");
  const [serviceKeys, setServiceKeys] = useState<string[]>(["lpg", "fuel"]);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<(typeof roles)[number]["key"]>("fleet_manager");
  const [inviteReason, setInviteReason] = useState("Authorised to support fleet operations.");

  const applications = records(fleet.data?.applications);
  const partners = records(fleet.data?.partners);
  const vehicles = records(fleet.data?.vehicles);
  const assignments = records(fleet.data?.assignments);
  const staff = records(fleet.data?.staff);
  const invitations = records(fleet.data?.invitations);
  const drivers = records(fleet.data?.drivers);
  const docs = records(fleet.data?.applicationDocuments);
  const requirements = records(fleet.data?.documentRequirements);
  const serviceLines = records(fleet.data?.serviceLines);
  const currentApplication = applications.find((row) =>
    ["submitted", "correction_required", "resubmitted"].includes(firstString(row, ["status"]) ?? "")
  ) ?? applications[0] ?? null;
  const applicationId = firstString(currentApplication, ["id"]);
  const partner = partners.find((row) =>
    firstString(row, ["verification_status"]) === "approved" &&
    firstString(row, ["operational_status"]) === "active"
  ) ?? partners[0] ?? null;
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
      const uploaded = await uploadFileToRuntime({
        api: session.api, uri: file.uri, fileName: file.name,
        contentType: file.mimeType ?? "application/octet-stream",
        scope: `fleet-document-${applicationId}-${key}`,
      });
      await session.api.post("/runtime/fleet-applications/document-submissions", {
        applicationId, requirementKey: key,
        storageBucket: uploaded.storageBucket, storagePath: uploaded.storagePath,
        contentType: uploaded.contentType, byteSize: uploaded.byteSize,
        source: "skima.lpg.mobile.fleet",
        idempotencyKey: `${uploaded.idempotencyKey}:fleet-document`,
        metadata: { originalFileName: file.name },
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
    setBusy("vehicle"); setError(""); setNotice("");
    try {
      await session.api.post("/runtime/my-fleet/vehicles", {
        fleetPartnerId: partnerId, vehicleTypeId, registrationNumber: plate.trim(),
        manufacturer: manufacturer.trim(), model: model.trim(),
        modelYear: year.trim() ? Number(year) : null, color: color.trim() || null,
        fuelType: fuelType.trim() || null, maxLoadKg: maxLoad.trim() ? Number(maxLoad) : null,
        ownershipRelationship: ownership, serviceKeys,
        idempotencyKey: idempotencyKey("fleet-partner-vehicle", `${partnerId}:${plate.trim().toUpperCase()}`),
        metadata: { requestedFrom: "fleet_owner_portal" },
      }, z.string().uuid());
      await fleet.refetch();
      setPlate(""); setModel(""); setManufacturer(""); setYear(""); setColor(""); setFuelType(""); setMaxLoad("");
      setNotice("Vehicle registered. It remains pending until SKIMA completes vehicle and service-specific compliance review.");
    } catch (cause) {
      setError(friendlyError(cause, "The vehicle could not be registered."));
    } finally { setBusy(null); }
  };

  const inviteStaff = async () => {
    if (!partnerId) return;
    if (!inviteEmail.trim() || inviteReason.trim().length < 5) { setError("Enter the staff email and a reason of at least five characters."); return; }
    setBusy("invite"); setError(""); setNotice("");
    try {
      await session.api.post("/runtime/my-fleet/staff/invitations", {
        fleetPartnerId: partnerId, email: inviteEmail.trim(), accessRole: inviteRole,
        reason: inviteReason.trim(),
        idempotencyKey: idempotencyKey("fleet-staff-invitation", `${partnerId}:${inviteEmail.toLowerCase()}:${inviteRole}`),
      }, z.string().uuid());
      await fleet.refetch(); setInviteEmail("");
      setNotice("Invitation created. The invited person must sign in with that email and accept it in their Fleet portal.");
    } catch (cause) {
      setError(friendlyError(cause, "The fleet invitation could not be created."));
    } finally { setBusy(null); }
  };

  const acceptInvitation = async (invitationId: string) => {
    setBusy(`accept:${invitationId}`); setError(""); setNotice("");
    try {
      await session.api.post("/runtime/my-fleet/staff/invitations/accept", { invitationId }, z.string().uuid());
      await fleet.refetch(); setNotice("Fleet invitation accepted.");
    } catch (cause) {
      setError(friendlyError(cause, "This fleet invitation could not be accepted."));
    } finally { setBusy(null); }
  };

  const assignDriver = async (driverProfileId: string, vehicleId: string) => {
    setBusy(`assign:${driverProfileId}`); setError(""); setNotice("");
    try {
      await session.api.post("/runtime/vehicle-assignments", {
        driverProfileId, vehicleId, relationship: "fleet_owned",
        startsAt: new Date().toISOString(), metadata: { source: "fleet_owner_portal" },
      }, ActionResponseSchema);
      await fleet.refetch(); setNotice("Driver assignment submitted.");
    } catch (cause) {
      setError(friendlyError(cause, "The driver could not be assigned. Check vehicle approval and driver authorisation."));
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
            const linked=docs.filter((doc) => firstString(doc,["fleetApplicationId","fleet_application_id"])===applicationId
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
            <Text style={[styles.meta,{color:palette.muted}]}>Ownership or operating relationship</Text>
            <View style={styles.chips}>
              {[
                ["fleet_owned","Owned by fleet"],["leased","Leased"],["rented","Rented"],["third_party_authorized","Third-party authorised"],
              ].map(([key,label])=><Choice key={key} active={ownership===key} label={label} onPress={()=>setOwnership(key)} />)}
            </View>
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
                return <View key={id} style={styles.vehicleRow}>
                  <View style={styles.copy}>
                    <Text style={[styles.cardTitle,{color:palette.ink}]}>{firstString(vehicle,["manufacturer"]) ?? ""} {firstString(vehicle,["model"]) ?? ""}</Text>
                    <Text style={[styles.meta,{color:palette.muted}]}>{firstString(vehicle,["registration_number"]) ?? "Registration pending"} · {firstString(vehicle,["status"]) ?? "pending"}</Text>
                    <View style={styles.chips}>{lines.map((line) => <StatusPill key={String(line.id)} label={`${firstString(line,["service_key"])} · ${firstString(line,["status"])}`}
                      tone={firstString(line,["status"])==="approved" ? "success" : "warning"} />)}</View>
                  </View>
                </View>;
              })}
            {vehicles.some((vehicle)=>firstString(vehicle,["status"])==="active") && drivers.length>0 ? (
              <View style={styles.assignmentGroup}>
                <SectionHeader title="Authorised driver assignments" description="Only fleet-invited, verified SKIMA drivers can receive an active fleet vehicle." />
                {drivers.map((driver) => {
                  const driverId=firstString(driver,["driverProfileId"]) ?? "";
                  const assigned=assignments.find((row)=>firstString(row,["driver_profile_id"])===driverId && firstString(row,["status"])==="active");
                  return <View key={driverId} style={styles.documentRow}>
                    <View style={styles.copy}>
                      <Text style={[styles.cardTitle,{color:palette.ink}]}>{firstString(driver,["displayName"]) ?? "Approved driver"}</Text>
                      <Text style={[styles.meta,{color:palette.muted}]}>{assigned ? "Vehicle assignment active" : "No active assignment"}</Text>
                    </View>
                    {!assigned ? <AppButton size="sm" variant="secondary" label="Assign vehicle" disabled={busy!==null}
                      onPress={() => {
                        const available=vehicles.find((vehicle)=>firstString(vehicle,["status"])==="active"
                          && !assignments.some((row)=>firstString(row,["vehicle_id"])===firstString(vehicle,["id"]) && firstString(row,["status"])==="active"));
                        if (available) void assignDriver(driverId,firstString(available,["id"]) ?? "");
                        else setError("No unassigned active vehicle is available.");
                      }} /> : null}
                  </View>;
                })}
              </View>
            ) : null}
          </View>

          <View style={[styles.card,{backgroundColor:palette.surface,borderColor:palette.border}]}>
            <SectionHeader title="Invite authorised people" description="Only invited and accepted people gain access to this fleet. Driver operators must already have an approved SKIMA Driver profile." />
            <Field label="Email address" value={inviteEmail} onChangeText={setInviteEmail} placeholder="person@example.com" keyboardType="email-address" autoCapitalize="none" />
            <View style={styles.chips}>{roles.map((role)=><Choice key={role.key} active={inviteRole===role.key} label={role.label} onPress={()=>setInviteRole(role.key)} />)}</View>
            <Field label="Invitation reason" value={inviteReason} onChangeText={setInviteReason} placeholder="Reason for access" />
            <AppButton fullWidth label="Create invitation" loading={busy==="invite"} disabled={busy!==null} onPress={() => void inviteStaff()} />
            {staff.map((person,index)=><View key={String(person.id ?? index)} style={styles.documentRow}>
              <View style={styles.copy}>
                <Text style={[styles.cardTitle,{color:palette.ink}]}>{firstString(person,["access_role"])?.replaceAll("_"," ") ?? "Fleet staff"}</Text>
                <Text style={[styles.meta,{color:palette.muted}]}>{firstString(person,["user_id"]) ?? "Authorised SKIMA account"} · {firstString(person,["status"]) ?? "active"}</Text>
              </View>
            </View>)}
          </View>
        </>
      ) : null}

      {invitations.length>0 ? (
        <View style={[styles.card,{backgroundColor:palette.surface,borderColor:palette.border}]}>
          <SectionHeader title="Fleet invitations" description="Accept invitations sent to your signed-in email address." />
          {invitations.map((invitation) => {
            const id=firstString(invitation,["id"]) ?? "";
            return <View key={id} style={styles.documentRow}>
              <View style={styles.copy}>
                <Text style={[styles.cardTitle,{color:palette.ink}]}>{firstString(invitation,["accessRole"])?.replaceAll("_"," ") ?? "Fleet access"}</Text>
                <Text style={[styles.meta,{color:palette.muted}]}>{firstString(invitation,["invitedEmail"])} · expires {firstString(invitation,["expiresAt"])}</Text>
              </View>
              <AppButton size="sm" label="Accept" loading={busy===`accept:${id}`} disabled={busy!==null} onPress={() => void acceptInvitation(id)} />
            </View>;
          })}
        </View>
      ) : null}
    </Screen>
  );
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