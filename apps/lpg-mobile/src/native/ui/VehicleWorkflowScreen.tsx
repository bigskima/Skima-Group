import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { CarFront, FileCheck2, Gauge, Plus, ShieldCheck, Truck } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { domainQueries } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import {
  ActionResponseSchema,
  displayReference,
  displayStatus,
  firstNumber,
  firstString,
  recordId,
  type PlatformRecord,
} from "../api/records";
import { useSession } from "../session/SessionProvider";
import { draftStore } from "../storage/drafts";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { PresentationMediaPanel } from "./PresentationMediaPanel";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { SectionHeader } from "./SectionHeader";
import { StatusPill } from "./StatusPill";
import { presentVehicleEligibility } from "./vehicleEligibility";

export function VehicleWorkflowScreen() {
  const session = useSession();
  const { palette } = useAppTheme();
  const owner = session.context?.profile?.id ?? session.context?.user.id ?? "";
  const draftCreatedAt = useRef(new Date().toISOString());
  const vehicles = domainQueries.vehicles();
  const compliance = domainQueries.vehicleAssignmentCompliance();
  const myVehicle = domainQueries.myVehicle();
  const vehicleTypes = domainQueries.vehicleTypes();
  const applicationTypes = domainQueries.applicationTypes();
  const applications = domainQueries.applications();
  const requirements = domainQueries.documentRequirements();
  const documents = domainQueries.documents();
  const drivers = domainQueries.drivers();
  const client = useQueryClient();

  const driver = drivers.data?.find((item) => firstString(item, ["user_id", "userId"]) === session.context?.user.id);
  const driverId = driver ? recordId(driver) : null;
  const applicationType = (applicationTypes.data ?? []).find(
    (item) => firstString(item, ["application_category", "applicationCategory"]) === "vehicle" && firstString(item, ["status"]) === "active",
  );
  const applicationTypeId = applicationType ? recordId(applicationType) : null;
  const current = (applications.data ?? []).find(
    (item) =>
      firstString(item, ["application_type_id", "applicationTypeId"]) === applicationTypeId &&
      !["approved", "rejected", "withdrawn", "expired"].includes(firstString(item, ["status"]) ?? ""),
  );
  const currentId = current ? recordId(current) : null;
  const requirementSetId = firstString(applicationType, ["document_requirement_set_id", "documentRequirementSetId"]);
  const required = (requirements.data ?? []).filter(
    (item) =>
      firstString(item, ["requirement_set_id", "requirementSetId"]) === requirementSetId &&
      item.is_required === true &&
      firstString(item, ["status"]) === "active",
  );
  const missing = required.filter(
    (requirement) =>
      !(documents.data ?? []).some(
        (document) =>
          firstString(document, ["application_id", "applicationId"]) === currentId &&
          (firstString(document, ["requirement_id", "requirementId"]) === recordId(requirement) ||
            firstString(document, ["requirement_key", "requirementKey"]) === firstString(requirement, ["key"])),
      ),
  );

  const [showForm, setShowForm] = useState(false);
  const [typeKey, setTypeKey] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [registration, setRegistration] = useState("");
  const [colour, setColour] = useState("");
  const [ownership, setOwnership] = useState("owned");
  const [capacity, setCapacity] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageSuccess, setMessageSuccess] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!owner) return;
    void draftStore.load(owner, "driver-vehicle-registration").then((draft) => {
      if (draft) {
        draftCreatedAt.current = draft.createdAt;
        setTypeKey(String(draft.values.typeKey ?? ""));
        setManufacturer(String(draft.values.manufacturer ?? ""));
        setModel(String(draft.values.model ?? ""));
        setYear(String(draft.values.year ?? ""));
        setRegistration(String(draft.values.registration ?? ""));
        setColour(String(draft.values.colour ?? ""));
        setOwnership(String(draft.values.ownership ?? "owned"));
        setCapacity(String(draft.values.capacity ?? ""));
        setShowForm(true);
      }
      setHydrated(true);
    });
  }, [owner]);

  useEffect(() => {
    if (!owner || !hydrated) return;
    const hasValues = [typeKey, manufacturer, model, year, registration, colour, capacity].some(Boolean);
    if (!hasValues) return;
    const now = new Date().toISOString();
    void draftStore.save({
      version: 1,
      type: "driver-vehicle-registration",
      ownerProfileId: owner,
      step: "vehicle-details",
      values: { typeKey, manufacturer, model, year, registration, colour, ownership, capacity },
      pendingMedia: [],
      createdAt: draftCreatedAt.current,
      updatedAt: now,
    });
  }, [capacity, colour, hydrated, manufacturer, model, owner, ownership, registration, typeKey, year]);

  const create = useGatewayMutation({ path: "/runtime/applications", schema: ActionResponseSchema });
  const update = useGatewayMutation({ path: "/runtime/applications/payload", schema: ActionResponseSchema });
  const submit = useGatewayMutation({ path: "/runtime/applications/submit", schema: ActionResponseSchema });

  const send = async () => {
    setMessage(null);
    const load = Number(capacity);
    if (
      !driverId ||
      !applicationType ||
      !typeKey ||
      !manufacturer.trim() ||
      !model.trim() ||
      !year.trim() ||
      !registration.trim() ||
      !colour.trim() ||
      !Number.isFinite(load) ||
      load <= 0
    ) {
      setMessageSuccess(false);
      setMessage("Complete every required vehicle field. An approved driver profile is also required.");
      return;
    }

    const payload = {
      vehicle: {
        driverProfileId: driverId,
        vehicleTypeKey: typeKey,
        manufacturer: manufacturer.trim(),
        model: model.trim(),
        year: year.trim(),
        registrationNumber: registration.trim().toUpperCase(),
        color: colour.trim(),
        ownershipType: ownership,
        maxLoadKg: load,
        capacityProfile: { maxLoadKg: load },
      },
    };

    try {
      let applicationId = current ? recordId(current) : null;
      if (applicationId) {
        await update.mutateAsync({
          applicationId,
          payload,
          idempotencyKey: idempotencyKey("vehicle-application-payload", applicationId),
        });
      } else {
        const result = await create.mutateAsync({
          applicationTypeKey: firstString(applicationType, ["key"]),
          payload,
          idempotencyKey: idempotencyKey("vehicle-application-create", registration.trim().toUpperCase()),
        });
        applicationId = resultId(result);
      }

      if (!applicationId) throw new Error("The vehicle application could not be created. Please try again.");
      await draftStore.clear(owner, "driver-vehicle-registration");
      await client.invalidateQueries({ queryKey: ["lpg-expo", "applications"] });

      if (required.length > 0 && (!currentId || applicationId !== currentId || missing.length > 0)) {
        router.push("/(driver)/vehicle-documents");
        return;
      }

      await submit.mutateAsync({
        applicationId,
        idempotencyKey: idempotencyKey("vehicle-application-submit", applicationId),
      });
      await client.invalidateQueries({ queryKey: ["lpg-expo", "applications"] });
      setShowForm(false);
      setMessageSuccess(true);
      setMessage("Vehicle submitted for SKIMA review.");
    } catch (cause) {
      setMessageSuccess(false);
      setMessage(friendlyError(cause, "Vehicle application could not be submitted."));
    }
  };

  const loading =
    vehicles.isPending || compliance.isPending || myVehicle.isPending ||
    vehicleTypes.isPending ||
    applicationTypes.isPending ||
    applications.isPending ||
    requirements.isPending ||
    documents.isPending ||
    drivers.isPending;
  const failed =
    vehicles.error || compliance.error || myVehicle.error || vehicleTypes.error || applicationTypes.error || applications.error || requirements.error || documents.error || drivers.error;
  const assignedVehicle = myVehicle.data?.current && typeof myVehicle.data.current === "object"
    ? myVehicle.data.current as PlatformRecord
    : null;
  const assignedEligibility = assignedVehicle?.eligibility && typeof assignedVehicle.eligibility === "object"
    ? assignedVehicle.eligibility as PlatformRecord
    : null;
  const eligibilityPresentation = presentVehicleEligibility(assignedEligibility);

  return (
    <Screen
      eyebrow="Driver capability"
      title="Vehicles"
      subtitle="Register and review the vehicles SKIMA can consider when matching you to eligible LPG work."
      action={
        <AppButton
          label={showForm ? "Close" : "Add vehicle"}
          size="sm"
          variant={showForm ? "ghost" : "primary"}
          icon={!showForm ? <Plus color="#FFFFFF" size={16} /> : undefined}
          onPress={() => setShowForm((value) => !value)}
        />
      }
    >
      {loading ? (
        <ScreenSkeleton cards={4} />
      ) : failed ? (
        <EmptyState
          icon={<Truck color={palette.brand} size={27} />}
          title="Vehicles could not be loaded"
          description="Check your connection and refresh your driver vehicle workspace."
          action={<AppButton label="Retry" onPress={() => void Promise.all([vehicles.refetch(), vehicleTypes.refetch(), applications.refetch()])} />}
        />
      ) : (
        <>
          <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
            <View style={styles.heroIcon}><Truck color="#FFFFFF" size={28} /></View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>APPROVED DRIVER CAPABILITY</Text>
              <Text style={styles.heroTitle}>{vehicles.data?.length ?? 0} registered {vehicles.data?.length === 1 ? "vehicle" : "vehicles"}</Text>
              <Text style={styles.heroBody}>Vehicle type, approval and load capacity are part of dispatch eligibility. SKIMA assigns jobs automatically; there is no manual job-accept step.</Text>
            </View>
          </View>

          <SectionHeader title="My vehicle" description="Your active driver and vehicle assignment, resolved from governed fleet records." />
          {assignedVehicle ? (
            <View style={[styles.vehicleCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={styles.vehicleHead}>
                <View style={[styles.vehicleIcon, { backgroundColor: palette.brandSoft }]}><Truck color={palette.brand} size={23} /></View>
                <View style={styles.vehicleCopy}>
                  <Text style={[styles.vehicleTitle, { color: palette.ink }]}>{firstString(assignedVehicle, ["manufacturer"]) ?? "Assigned vehicle"} {firstString(assignedVehicle, ["model"]) ?? ""}</Text>
                  <Text style={[styles.vehicleMeta, { color: palette.muted }]}>{firstString(assignedVehicle, ["registration_number"]) ?? "Registration pending"}</Text>
                </View>
                <StatusPill label={eligibilityPresentation.ready ? "Dispatch ready" : "Action required"} tone={eligibilityPresentation.ready ? "success" : "warning"} />
              </View>
              <View style={[styles.divider, { backgroundColor: palette.border }]} />
              <View style={styles.vehicleMetrics}>
                <VehicleMetric label="Owner / fleet" value={firstString(assignedVehicle, ["owner_name"]) ?? "Owner details pending"} />
                <VehicleMetric label="Relationship" value={friendly(firstString(assignedVehicle, ["relationship_type"]) ?? "pending")} />
              </View>
              <Text style={[styles.vehicleMeta, { color: palette.muted }]}>Assigned {firstString(assignedVehicle, ["starts_at"]) ? new Date(firstString(assignedVehicle, ["starts_at"])!).toLocaleDateString() : "date pending"}</Text>
              <Text style={[styles.vehicleMeta, { color: eligibilityPresentation.ready ? palette.success : palette.danger }]}>
                {eligibilityPresentation.message}
              </Text>
            </View>
          ) : (
            <EmptyState icon={<Truck color={palette.brand} size={27} />} title="No active vehicle assignment" description="A registered vehicle is not dispatch eligible until an approved assignment and all configured compliance evidence are present." />
          )}

          {current ? (
            <View style={[styles.reviewCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={[styles.reviewIcon, { backgroundColor: palette.warningSoft }]}><FileCheck2 color={palette.warning} size={22} /></View>
              <View style={styles.reviewCopy}>
                <Text style={[styles.reviewTitle, { color: palette.ink }]}>Vehicle application in review</Text>
                <Text style={[styles.reviewBody, { color: palette.muted }]}>{friendly(displayStatus(current) ?? "submitted")}</Text>
              </View>
              <StatusPill label={friendly(displayStatus(current) ?? "submitted")} tone="warning" />
            </View>
          ) : null}

          {current && missing.length > 0 ? (
            <AppButton
              label={`Add required vehicle documents (${missing.length})`}
              fullWidth
              variant="secondary"
              icon={<FileCheck2 color={palette.brand} size={17} />}
              onPress={() => router.push("/(driver)/vehicle-documents")}
            />
          ) : null}

          {showForm ? (
            <View style={[styles.formCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={styles.formHead}>
                <View style={[styles.formIcon, { backgroundColor: palette.brandSoft }]}><CarFront color={palette.brand} size={22} /></View>
                <View style={styles.formCopy}>
                  <Text style={[styles.formTitle, { color: palette.ink }]}>Vehicle approval application</Text>
                  <Text style={[styles.formBody, { color: palette.muted }]}>Add the vehicle you intend to use. SKIMA reviews it before that vehicle can be considered for dispatch.</Text>
                </View>
              </View>

              <FieldSection label="Vehicle type">
                <View style={styles.options}>
                  {(vehicleTypes.data ?? [])
                    .filter((item) => firstString(item, ["status"]) === "active")
                    .map((item) => {
                      const key = firstString(item, ["key"]) ?? "";
                      const selected = typeKey === key;
                      return (
                        <Pressable
                          key={key}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          onPress={() => setTypeKey(key)}
                          style={({ pressed }) => [
                            styles.option,
                            {
                              backgroundColor: selected ? palette.brand : palette.surfaceSubtle,
                              borderColor: selected ? palette.brand : palette.border,
                              opacity: pressed ? 0.82 : 1,
                            },
                          ]}
                        >
                          <Text style={[styles.optionText, { color: selected ? "#FFFFFF" : palette.ink }]}>{firstString(item, ["display_name", "displayName"]) ?? key}</Text>
                          {selected ? <ShieldCheck color="#FFFFFF" size={16} /> : null}
                        </Pressable>
                      );
                    })}
                </View>
              </FieldSection>

              <View style={styles.twoColumn}>
                <TextField label="Manufacturer" value={manufacturer} onChangeText={setManufacturer} placeholder="e.g. Toyota" />
                <TextField label="Model" value={model} onChangeText={setModel} placeholder="e.g. Hiace" />
              </View>
              <View style={styles.twoColumn}>
                <TextField label="Year" value={year} onChangeText={setYear} placeholder="2022" keyboardType="number-pad" />
                <TextField label="Colour" value={colour} onChangeText={setColour} placeholder="White" />
              </View>
              <TextField label="Registration number" value={registration} onChangeText={setRegistration} placeholder="Vehicle plate number" autoCapitalize="characters" />

              <FieldSection label="Ownership">
                <View style={styles.options}>
                  {["owned", "leased", "rented"].map((value) => {
                    const selected = ownership === value;
                    return (
                      <Pressable
                        key={value}
                        onPress={() => setOwnership(value)}
                        style={({ pressed }) => [
                          styles.option,
                          {
                            backgroundColor: selected ? palette.brand : palette.surfaceSubtle,
                            borderColor: selected ? palette.brand : palette.border,
                            opacity: pressed ? 0.82 : 1,
                          },
                        ]}
                      >
                        <Text style={[styles.optionText, { color: selected ? "#FFFFFF" : palette.ink }]}>{friendly(value)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </FieldSection>

              <TextField
                label="Verified maximum load (kg)"
                value={capacity}
                onChangeText={setCapacity}
                placeholder="Enter safe load capacity"
                keyboardType="decimal-pad"
                hint="Use the supported vehicle load figure that should be reviewed for LPG dispatch eligibility."
              />

              <View style={[styles.policyNote, { backgroundColor: palette.surfaceSubtle }]}>
                <Gauge color={palette.mutedStrong} size={18} />
                <Text style={[styles.policyText, { color: palette.muted }]}>Vehicle approval does not guarantee every LPG assignment. Dispatch still checks current availability, service coverage, vehicle capability and order requirements.</Text>
              </View>

              <AppButton
                label="Continue vehicle review"
                fullWidth
                size="lg"
                loading={create.isPending || update.isPending || submit.isPending}
                onPress={() => void send()}
              />
            </View>
          ) : null}

          <SectionHeader title="Your vehicles" description="Current vehicle records attached to this driver profile." />
          <View style={styles.vehicleList}>
            {(vehicles.data ?? []).length ? (
              (vehicles.data ?? []).map((vehicle, index) => {
                const id = recordId(vehicle);
                const vehicleStatus =
                  displayStatus(vehicle) ?? firstString(vehicle, ["verification_status", "verificationStatus"]) ?? "registered";
                const ownership = firstString(vehicle, ["ownership_relationship", "ownership_type"]) ?? "driver_owned";
                const complianceRecord = (compliance.data ?? []).find((item) => firstString(item, ["vehicle_id"]) === id);
                const warnings = complianceRecord && Array.isArray(complianceRecord.warnings)
                  ? complianceRecord.warnings.filter((item): item is string => typeof item === "string") : [];
                return (
                  <View key={id ?? String(index)} style={[styles.vehicleCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                    <View style={styles.vehicleHead}>
                      <View style={[styles.vehicleIcon, { backgroundColor: palette.brandSoft }]}><Truck color={palette.brand} size={23} /></View>
                      <View style={styles.vehicleCopy}>
                        <Text style={[styles.vehicleTitle, { color: palette.ink }]}>{firstString(vehicle, ["manufacturer"]) ?? "Vehicle"} {firstString(vehicle, ["model"]) ?? ""}</Text>
                        <Text style={[styles.vehicleMeta, { color: palette.muted }]}>{firstString(vehicle, ["registration_number", "registrationNumber"]) ?? displayReference(vehicle) ?? "Registration unavailable"}</Text>
                      </View>
                      <StatusPill label={friendly(vehicleStatus)} tone={vehicleTone(vehicleStatus)} />
                    </View>
                    <View style={[styles.divider, { backgroundColor: palette.border }]} />
                    <View style={styles.vehicleMetrics}>
                      <VehicleMetric label="Max load" value={`${firstNumber(vehicle, ["max_load_kg", "maxLoadKg"]) ?? "—"} kg`} />
                      <VehicleMetric label="Ownership" value={friendly(ownership)} />
                    </View>
                    <Text style={[styles.vehicleMeta, { color: warnings.length ? palette.danger : palette.success }]}>
                      {warnings.length ? `Compliance: ${warnings.map(friendly).join(", ")}` : "Assignment and compliance checks are current"}
                    </Text>
                    {id ? <PresentationMediaPanel subjectId={id} subjectType="vehicle" colour={firstString(vehicle, ["colour", "color"])} /> : null}
                  </View>
                );
              })
            ) : (
              <EmptyState
                icon={<Truck color={palette.brand} size={27} />}
                title="No approved vehicle yet"
                description="Add the vehicle you intend to use so SKIMA can review its type, identity and capacity for dispatch eligibility."
                action={<AppButton label="Add vehicle" onPress={() => setShowForm(true)} />}
              />
            )}
          </View>
        </>
      )}

      {message ? (
        <View style={[styles.message, { backgroundColor: messageSuccess ? palette.successSoft : palette.dangerSoft }]}>
          <Text accessibilityRole="alert" style={[styles.messageText, { color: messageSuccess ? palette.success : palette.danger }]}>{message}</Text>
        </View>
      ) : null}
    </Screen>
  );
}

function FieldSection({ label, children }: { label: string; children: React.ReactNode }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.fieldSection}>
      <Text style={[styles.fieldLabel, { color: palette.ink }]}>{label}</Text>
      {children}
    </View>
  );
}

function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
  hint,
}: {
  label: string;
  value: string;
  onChangeText(value: string): void;
  placeholder: string;
  keyboardType?: "default" | "number-pad" | "decimal-pad";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  hint?: string;
}) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.textField}>
      <Text style={[styles.fieldLabel, { color: palette.ink }]}>{label}</Text>
      <TextInput
        style={[styles.input, { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink }]}
        placeholder={placeholder}
        placeholderTextColor={palette.muted}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
      />
      {hint ? <Text style={[styles.hint, { color: palette.muted }]}>{hint}</Text> : null}
    </View>
  );
}

function VehicleMetric({ label, value }: { label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.vehicleMetric}>
      <Text style={[styles.metricLabel, { color: palette.muted }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: palette.ink }]}>{value}</Text>
    </View>
  );
}

function resultId(result: string | PlatformRecord | null) {
  return typeof result === "string" ? result : result ? firstString(result, ["id", "applicationId", "application_id"]) : null;
}

function friendly(value: string) {
  return value.replace(/[_-]/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function vehicleTone(value: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  const normalized = value.toLowerCase();
  if (["approved", "verified", "active"].some((part) => normalized.includes(part))) return "success";
  if (["rejected", "suspended", "deactivated"].some((part) => normalized.includes(part))) return "danger";
  if (["pending", "review", "submitted"].some((part) => normalized.includes(part))) return "warning";
  return "brand";
}

const styles = StyleSheet.create({
  hero: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  heroIcon: { width: 54, height: 54, borderRadius: 19, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" },
  heroCopy: { flex: 1, gap: 3 },
  heroEyebrow: { color: "rgba(255,255,255,.72)", ...typography.eyebrow, fontSize: 8 },
  heroTitle: { color: "#FFFFFF", ...typography.heading, fontSize: 21 },
  heroBody: { color: "rgba(255,255,255,.84)", ...typography.caption, lineHeight: 18 },
  reviewCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  reviewIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  reviewCopy: { flex: 1, minWidth: 0, gap: 2 },
  reviewTitle: { ...typography.bodyStrong, fontSize: 14 },
  reviewBody: { ...typography.caption },
  formCard: { gap: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  formHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  formIcon: { width: 46, height: 46, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  formCopy: { flex: 1, gap: 3 },
  formTitle: { ...typography.subheading, fontSize: 16 },
  formBody: { ...typography.caption, lineHeight: 18 },
  fieldSection: { gap: spacing.sm },
  fieldLabel: { ...typography.caption, fontSize: 13, fontWeight: "900" },
  options: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  option: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.pill },
  optionText: { ...typography.caption, fontWeight: "900" },
  twoColumn: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  textField: { flex: 1, minWidth: 150, gap: spacing.sm },
  input: { minHeight: 54, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, fontSize: 15 },
  hint: { ...typography.caption, lineHeight: 17 },
  policyNote: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderRadius: radii.md, padding: spacing.md },
  policyText: { flex: 1, ...typography.caption, lineHeight: 18 },
  vehicleList: { gap: spacing.md },
  vehicleCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  vehicleHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  vehicleIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  vehicleCopy: { flex: 1, minWidth: 0, gap: 2 },
  vehicleTitle: { ...typography.bodyStrong, fontSize: 15 },
  vehicleMeta: { ...typography.caption },
  divider: { height: StyleSheet.hairlineWidth },
  vehicleMetrics: { flexDirection: "row", gap: spacing.lg },
  vehicleMetric: { flex: 1, gap: 3 },
  metricLabel: { ...typography.caption, fontSize: 10 },
  metricValue: { ...typography.bodyStrong, fontSize: 14 },
  message: { borderRadius: radii.md, padding: spacing.md },
  messageText: { ...typography.caption, fontWeight: "800", textAlign: "center" },
});
