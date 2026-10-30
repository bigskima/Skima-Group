import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { CarFront, FileCheck2, Gauge, Plus, ShieldCheck, Truck } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { domainQueries } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import {
  satisfiedVerificationDocumentKeys,
  useApplicationVerification,
} from "../api/verification";
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
import {
  applicationRequirementApplies,
  applicationRequirementIsRequired,
} from "../api/documentRequirements";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { PresentationMediaPanel } from "./PresentationMediaPanel";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { SectionHeader } from "./SectionHeader";
import { StatusPill } from "./StatusPill";
import { presentVehicleEligibility } from "./vehicleEligibility";

type VehicleFormStep = "details" | "capacity" | "review";

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
  const currentApplicationPayload = current?.application_payload &&
      typeof current.application_payload === "object" &&
      !Array.isArray(current.application_payload)
    ? current.application_payload as Record<string, unknown>
    : {};
  const verification = useApplicationVerification(currentId);
  const verifiedDocumentKeys = satisfiedVerificationDocumentKeys(verification.data);
  const requirementSetId = firstString(applicationType, ["document_requirement_set_id", "documentRequirementSetId"]);
  const required = (requirements.data ?? []).filter(
    (item) =>
      firstString(item, ["requirement_set_id", "requirementSetId"]) === requirementSetId &&
      applicationRequirementIsRequired(item, currentApplicationPayload) &&
      firstString(item, ["status"]) === "active",
  );
  const vehicleRequirementsConfigured = Boolean(requirementSetId && required.length > 0);
  const missing = required.filter(
    (requirement) => {
      const requirementKey = firstString(requirement, ["key"]) ?? "";
      if (verifiedDocumentKeys.has(requirementKey)) return false;
      return !(documents.data ?? []).some(
        (document) =>
          firstString(document, ["application_id", "applicationId"]) === currentId &&
          (firstString(document, ["requirement_id", "requirementId"]) === recordId(requirement) ||
            firstString(document, ["requirement_key", "requirementKey"]) === firstString(requirement, ["key"])),
      );
    },
  );

  const [showForm, setShowForm] = useState(false);
  const [formStep, setFormStep] = useState<VehicleFormStep>("details");
  const [typeKey, setTypeKey] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [registration, setRegistration] = useState("");
  const [colour, setColour] = useState("");
  const [ownership, setOwnership] = useState("driver_owned");
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
        const savedOwnership = String(draft.values.ownership ?? "driver_owned");
        setOwnership(savedOwnership === "owned" ? "driver_owned" : savedOwnership);
        setCapacity(String(draft.values.capacity ?? ""));
        setFormStep(
          draft.step === "vehicle-review"
            ? "review"
            : draft.step === "vehicle-capacity"
              ? "capacity"
              : "details",
        );
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
      step: `vehicle-${formStep}`,
      values: { typeKey, manufacturer, model, year, registration, colour, ownership, capacity },
      pendingMedia: [],
      createdAt: draftCreatedAt.current,
      updatedAt: now,
    });
  }, [capacity, colour, formStep, hydrated, manufacturer, model, owner, ownership, registration, typeKey, year]);

  const create = useGatewayMutation({ path: "/runtime/applications", schema: ActionResponseSchema });
  const update = useGatewayMutation({ path: "/runtime/applications/payload", schema: ActionResponseSchema });
  const submit = useGatewayMutation({ path: "/runtime/applications/submit", schema: ActionResponseSchema });

  const retryWorkspace = async () => {
    await Promise.allSettled([
      vehicles.refetch(),
      compliance.refetch(),
      myVehicle.refetch(),
      vehicleTypes.refetch(),
      applicationTypes.refetch(),
      applications.refetch(),
      requirements.refetch(),
      documents.refetch(),
      drivers.refetch(),
    ]);
  };

  const openForm = () => {
    setMessage(null);
    setMessageSuccess(false);
    const pendingPrerequisites = [
      drivers.isPending,
      vehicleTypes.isPending,
      applicationTypes.isPending,
      applications.isPending,
      requirements.isPending,
      documents.isPending,
    ].some(Boolean);
    const failedPrerequisites = [
      drivers.error,
      vehicleTypes.error,
      applicationTypes.error,
      applications.error,
      requirements.error,
      documents.error,
    ].some(Boolean);

    if (pendingPrerequisites || failedPrerequisites) {
      setMessage("Your driver and vehicle application details are not fully loaded yet. Refresh this workspace and try again.");
      void retryWorkspace();
      return;
    }
    if (!driverId || !applicationType) {
      setMessage("An approved driver profile and an active LPG vehicle application type are required before you can add a vehicle.");
      return;
    }
    if (!(vehicleTypes.data ?? []).length) {
      setMessage("No active vehicle types are configured yet. Please contact SKIMA support.");
      return;
    }
    if (!vehicleRequirementsConfigured) {
      setMessage("SKIMA's required LPG vehicle evidence checklist is not available. We cannot safely start a vehicle application until it is restored.");
      return;
    }

    setFormStep("details");
    setShowForm(true);
  };

  const closeForm = () => {
    setMessage(null);
    setFormStep("details");
    setShowForm(false);
  };

  const continueFromDetails = () => {
    setMessage(null);
    if (!typeKey || !manufacturer.trim() || !model.trim() || !year.trim() || !registration.trim() || !colour.trim()) {
      setMessageSuccess(false);
      setMessage("Complete the vehicle details before continuing to ownership and capacity.");
      return;
    }
    setFormStep("capacity");
  };

  const continueToReview = () => {
    setMessage(null);
    const load = Number(capacity);
    if (!ownership || !Number.isFinite(load) || load <= 0) {
      setMessageSuccess(false);
      setMessage("Choose the ownership type and enter a valid maximum load before reviewing the vehicle.");
      return;
    }
    setFormStep("review");
  };

  const send = async () => {
    setMessage(null);
    const load = Number(capacity);
    if (
      drivers.error ||
      vehicleTypes.error ||
      applicationTypes.error ||
      applications.error ||
      requirements.error ||
      documents.error
    ) {
      setMessageSuccess(false);
      setMessage("Some required vehicle application data could not be loaded. Refresh the workspace and try again.");
      void retryWorkspace();
      return;
    }
    const yearNumber = Number(year);
    if (
      !driverId ||
      !applicationType ||
      !vehicleRequirementsConfigured ||
      !typeKey ||
      !manufacturer.trim() ||
      !model.trim() ||
      !/^\d{4}$/.test(year.trim()) ||
      yearNumber < 1900 ||
      yearNumber > new Date().getFullYear() + 1 ||
      !registration.trim() ||
      !colour.trim() ||
      !["driver_owned", "leased", "rented"].includes(ownership) ||
      !Number.isFinite(load) ||
      load <= 0
    ) {
      setMessageSuccess(false);
      setMessage("Complete every required vehicle field. Choose a valid ownership type and enter a four-digit model year and maximum load.");
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
      closeForm();
      setMessageSuccess(true);
      setMessage("Vehicle submitted for SKIMA review.");
    } catch (cause) {
      setMessageSuccess(false);
      setMessage(friendlyError(cause, "Vehicle application could not be submitted."));
    }
  };

  const loading = [
    vehicles,
    compliance,
    myVehicle,
    vehicleTypes,
    applicationTypes,
    applications,
    requirements,
    documents,
    drivers,
  ].every((query) => query.isPending);

  const workspaceErrors = [
    vehicles.error ? { label: "Registered vehicles", error: vehicles.error } : null,
    compliance.error ? { label: "Vehicle compliance", error: compliance.error } : null,
    myVehicle.error ? { label: "Current assignment", error: myVehicle.error } : null,
    vehicleTypes.error ? { label: "Vehicle types", error: vehicleTypes.error } : null,
    applicationTypes.error ? { label: "Application setup", error: applicationTypes.error } : null,
    applications.error ? { label: "Applications", error: applications.error } : null,
    requirements.error ? { label: "Document requirements", error: requirements.error } : null,
    documents.error ? { label: "Uploaded documents", error: documents.error } : null,
    drivers.error ? { label: "Driver profile", error: drivers.error } : null,
  ].filter((item): item is { label: string; error: Error } => item !== null);
  const assignedVehicle = myVehicle.data?.current && typeof myVehicle.data.current === "object"
    ? myVehicle.data.current as PlatformRecord
    : null;
  const assignedEligibility = assignedVehicle?.eligibility && typeof assignedVehicle.eligibility === "object"
    ? assignedVehicle.eligibility as PlatformRecord
    : null;
  const eligibilityPresentation = presentVehicleEligibility(assignedEligibility);
  const selectedVehicleType = (vehicleTypes.data ?? []).find((item) => firstString(item, ["key"]) === typeKey);

  return (
    <Screen
      eyebrow="Driver capability"
      title="Vehicles"
      subtitle="Add the vehicles you use for SKIMA LPG jobs and track their approval."
      action={
        <AppButton
          label={showForm ? "Close" : "Add vehicle"}
          size="sm"
          variant={showForm ? "ghost" : "primary"}
          icon={!showForm ? <Plus color="#FFFFFF" size={16} /> : undefined}
          onPress={showForm ? closeForm : openForm}
        />
      }
    >
      {loading ? (
        <ScreenSkeleton cards={4} />
      ) : (
        <>
          {workspaceErrors.length > 0 ? (
            <View style={[styles.dataWarning, { backgroundColor: palette.warningSoft, borderColor: palette.border }]}>
              <Text style={[styles.dataWarningTitle, { color: palette.ink }]}>Some vehicle information is temporarily unavailable</Text>
              {workspaceErrors.map((item) => (
                <Text key={item.label} style={[styles.dataWarningBody, { color: palette.muted }]}>
                  {item.label}: {friendlyError(item.error, "Could not be loaded.")}
                </Text>
              ))}
              <AppButton label="Refresh workspace" size="sm" variant="secondary" onPress={() => void retryWorkspace()} />
            </View>
          ) : null}

          <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
            <View style={styles.heroIcon}><Truck color="#FFFFFF" size={28} /></View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>APPROVED DRIVER CAPABILITY</Text>
              <Text style={styles.heroTitle}>
                {vehicles.error
                  ? "Vehicle list unavailable"
                  : vehicles.isPending
                    ? "Loading vehicles…"
                    : `${vehicles.data?.length ?? 0} registered ${vehicles.data?.length === 1 ? "vehicle" : "vehicles"}`}
              </Text>
              <Text style={styles.heroBody}>Your vehicle type, approval and load capacity affect the jobs you can receive. SKIMA assigns suitable jobs automatically.</Text>
            </View>
          </View>

          <SectionHeader title="My vehicle" description="Your current approved vehicle." />
          {myVehicle.isPending ? (
            <Text style={[styles.vehicleMeta, { color: palette.muted }]}>Loading your current vehicle assignment…</Text>
          ) : myVehicle.error ? (
            <Text style={[styles.vehicleMeta, { color: palette.warning }]}>Your current assignment could not be loaded. The rest of this workspace remains available.</Text>
          ) : assignedVehicle ? (
            <View style={[styles.vehicleCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={styles.vehicleHead}>
                <View style={[styles.vehicleIcon, { backgroundColor: palette.brandSoft }]}><Truck color={palette.brand} size={23} /></View>
                <View style={styles.vehicleCopy}>
                  <Text style={[styles.vehicleTitle, { color: palette.ink }]}>{firstString(assignedVehicle, ["manufacturer"]) ?? "Assigned vehicle"} {firstString(assignedVehicle, ["model"]) ?? ""}</Text>
                  <Text style={[styles.vehicleMeta, { color: palette.muted }]}>{firstString(assignedVehicle, ["registration_number"]) ?? "Registration pending"}</Text>
                </View>
                <StatusPill label={eligibilityPresentation.ready ? "Ready for jobs" : "Action required"} tone={eligibilityPresentation.ready ? "success" : "warning"} />
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
            <EmptyState icon={<Truck color={palette.brand} size={27} />} title="No active vehicle assignment" description="A registered vehicle can receive jobs after SKIMA approves its assignment and required documents." />
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
                  <Text style={[styles.formBody, { color: palette.muted }]}>Complete one focused section at a time. Your draft is saved automatically and the existing SKIMA verification flow stays unchanged.</Text>
                </View>
              </View>

              <VehicleFormProgress step={formStep} />

              {formStep === "details" ? (
                <>
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

                  <AppButton label="Continue to ownership & capacity" fullWidth size="lg" onPress={continueFromDetails} />
                </>
              ) : null}

              {formStep === "capacity" ? (
                <>
                  <FieldSection label="Ownership">
                    <View style={styles.options}>
                      {["driver_owned", "leased", "rented"].map((value) => {
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
                    <Text style={[styles.policyText, { color: palette.muted }]}>Job offers depend on your availability, approved service areas, vehicle and the order requirements.</Text>
                  </View>

                  <AppButton label="Back to vehicle details" fullWidth variant="ghost" onPress={() => setFormStep("details")} />
                  <AppButton label="Review vehicle" fullWidth size="lg" onPress={continueToReview} />
                </>
              ) : null}

              {formStep === "review" ? (
                <>
                  <View style={[styles.reviewSummary, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
                    <Text style={[styles.reviewSummaryTitle, { color: palette.ink }]}>Review before verification</Text>
                    <VehicleReviewRow label="Vehicle type" value={firstString(selectedVehicleType, ["display_name", "displayName"]) ?? friendly(typeKey)} />
                    <VehicleReviewRow label="Vehicle" value={`${manufacturer.trim()} ${model.trim()} · ${year.trim()}`} />
                    <VehicleReviewRow label="Registration" value={registration.trim().toUpperCase()} />
                    <VehicleReviewRow label="Colour" value={colour.trim()} />
                    <VehicleReviewRow label="Ownership" value={friendly(ownership)} />
                    <VehicleReviewRow label="Maximum load" value={`${capacity.trim()} kg`} />
                  </View>

                  <View style={[styles.policyNote, { backgroundColor: palette.brandSoft }]}>
                    <ShieldCheck color={palette.brand} size={18} />
                    <Text style={[styles.policyText, { color: palette.mutedStrong }]}>Continuing uses the existing SKIMA vehicle application and automatic-verification rules. Required documents are requested only when the runtime says they are still needed.</Text>
                  </View>

                  <AppButton label="Back to ownership & capacity" fullWidth variant="ghost" onPress={() => setFormStep("capacity")} />
                  <AppButton
                    label="Continue vehicle verification"
                    fullWidth
                    size="lg"
                    loading={create.isPending || update.isPending || submit.isPending}
                    onPress={() => void send()}
                  />
                </>
              ) : null}
            </View>
          ) : null}

          <SectionHeader title="Your vehicles" description="Vehicles added to your driver profile." />
          <View style={styles.vehicleList}>
            {vehicles.isPending ? (
              <Text style={[styles.vehicleMeta, { color: palette.muted }]}>Loading registered vehicles…</Text>
            ) : vehicles.error ? (
              <Text style={[styles.vehicleMeta, { color: palette.warning }]}>Your vehicle list could not be loaded. You can still start an application when the required driver and vehicle setup is available.</Text>
            ) : (vehicles.data ?? []).length ? (
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
                    <Text style={[styles.vehicleMeta, { color: compliance.error ? palette.warning : warnings.length ? palette.danger : palette.success }]}>
                      {compliance.error
                        ? "Compliance status could not be loaded."
                        : warnings.length
                          ? `Compliance: ${warnings.map(friendly).join(", ")}`
                          : "Assignment and compliance checks are current"}
                    </Text>
                    {id ? <PresentationMediaPanel subjectId={id} subjectType="vehicle" colour={firstString(vehicle, ["colour", "color"])} /> : null}
                  </View>
                );
              })
            ) : (
              <EmptyState
                icon={<Truck color={palette.brand} size={27} />}
                title="No approved vehicle yet"
                description="Add the vehicle you intend to use so SKIMA can review its type and capacity."
                action={<AppButton label="Add vehicle" onPress={openForm} />}
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

function VehicleFormProgress({ step }: { step: VehicleFormStep }) {
  const { palette } = useAppTheme();
  const steps: Array<{ key: VehicleFormStep; label: string }> = [
    { key: "details", label: "Vehicle" },
    { key: "capacity", label: "Capacity" },
    { key: "review", label: "Review" },
  ];
  const activeIndex = steps.findIndex((item) => item.key === step);

  return (
    <View style={styles.progressRow} accessibilityLabel={`Vehicle application step ${activeIndex + 1} of ${steps.length}`}>
      {steps.map((item, index) => {
        const active = item.key === step;
        const complete = index < activeIndex;
        return (
          <View key={item.key} style={[styles.progressStep, { backgroundColor: active ? palette.brand : complete ? palette.successSoft : palette.surfaceSubtle, borderColor: active ? palette.brand : complete ? palette.success : palette.border }]}>
            <Text style={[styles.progressNumber, { color: active ? "#FFFFFF" : complete ? palette.success : palette.mutedStrong }]}>{complete ? "✓" : index + 1}</Text>
            <Text style={[styles.progressLabel, { color: active ? "#FFFFFF" : complete ? palette.success : palette.mutedStrong }]}>{item.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

function VehicleReviewRow({ label, value }: { label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={[styles.reviewSummaryRow, { borderBottomColor: palette.border }]}>
      <Text style={[styles.reviewSummaryLabel, { color: palette.muted }]}>{label}</Text>
      <Text style={[styles.reviewSummaryValue, { color: palette.ink }]}>{value || "Not provided"}</Text>
    </View>
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
  progressRow: { flexDirection: "row", gap: spacing.sm },
  progressStep: { flex: 1, minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.pill, paddingHorizontal: spacing.sm },
  progressNumber: { ...typography.caption, fontWeight: "900", fontSize: 11 },
  progressLabel: { ...typography.caption, fontWeight: "900", fontSize: 11 },
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
  reviewSummary: { gap: 0, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, paddingHorizontal: spacing.md },
  reviewSummaryTitle: { ...typography.bodyStrong, fontSize: 15, paddingVertical: spacing.md },
  reviewSummaryRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.sm + 2 },
  reviewSummaryLabel: { ...typography.caption, flex: 0.8 },
  reviewSummaryValue: { ...typography.bodyStrong, fontSize: 13, flex: 1.2, textAlign: "right" },
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
  dataWarning: { gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  dataWarningTitle: { ...typography.bodyStrong, fontSize: 14 },
  dataWarningBody: { ...typography.caption, lineHeight: 18 },
  message: { borderRadius: radii.md, padding: spacing.md },
  messageText: { ...typography.caption, fontWeight: "800", textAlign: "center" },
});