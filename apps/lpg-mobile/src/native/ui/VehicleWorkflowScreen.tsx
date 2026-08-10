import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Truck } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
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
import { colors, radii, spacing } from "../theme/tokens";
import { idempotencyKey } from "../utilities/idempotency";
import { Card } from "./Card";
import { PresentationMediaPanel } from "./PresentationMediaPanel";
import { Screen } from "./Screen";
export function VehicleWorkflowScreen() {
  const session = useSession();
  const owner = session.context?.profile?.id ?? session.context?.user.id ?? "";
  const draftCreatedAt = useRef(new Date().toISOString());
  const vehicles = domainQueries.vehicles();
  const vehicleTypes = domainQueries.vehicleTypes();
  const applicationTypes = domainQueries.applicationTypes();
  const applications = domainQueries.applications();
  const requirements = domainQueries.documentRequirements();
  const documents = domainQueries.documents();
  const drivers = domainQueries.drivers();
  const client = useQueryClient();
  const driver = drivers.data?.find(
    (item) =>
      firstString(item, ["user_id", "userId"]) === session.context?.user.id,
  );
  const driverId = driver ? recordId(driver) : null;
  const applicationType = (applicationTypes.data ?? []).find(
    (item) =>
      firstString(item, ["application_category", "applicationCategory"]) ===
        "vehicle" && firstString(item, ["status"]) === "active",
  );
  const applicationTypeId = applicationType ? recordId(applicationType) : null;
  const current = (applications.data ?? []).find(
    (item) =>
      firstString(item, ["application_type_id", "applicationTypeId"]) ===
        applicationTypeId &&
      !["approved", "rejected", "withdrawn", "expired"].includes(
        firstString(item, ["status"]) ?? "",
      ),
  );
  const currentId = current ? recordId(current) : null;
  const requirementSetId = firstString(applicationType, [
    "document_requirement_set_id",
    "documentRequirementSetId",
  ]);
  const required = (requirements.data ?? []).filter(
    (item) =>
      firstString(item, ["requirement_set_id", "requirementSetId"]) ===
        requirementSetId &&
      item.is_required === true &&
      firstString(item, ["status"]) === "active",
  );
  const missing = required.filter(
    (requirement) =>
      !(documents.data ?? []).some(
        (document) =>
          firstString(document, ["application_id", "applicationId"]) ===
            currentId &&
          (firstString(document, ["requirement_id", "requirementId"]) ===
            recordId(requirement) ||
            firstString(document, ["requirement_key", "requirementKey"]) ===
              firstString(requirement, ["key"])),
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
    const hasValues = [
      typeKey,
      manufacturer,
      model,
      year,
      registration,
      colour,
      capacity,
    ].some(Boolean);
    if (!hasValues) return;
    const now = new Date().toISOString();
    void draftStore.save({
      version: 1,
      type: "driver-vehicle-registration",
      ownerProfileId: owner,
      step: "vehicle-details",
      values: {
        typeKey,
        manufacturer,
        model,
        year,
        registration,
        colour,
        ownership,
        capacity,
      },
      pendingMedia: [],
      createdAt: draftCreatedAt.current,
      updatedAt: now,
    });
  }, [
    capacity,
    colour,
    hydrated,
    manufacturer,
    model,
    owner,
    ownership,
    registration,
    typeKey,
    year,
  ]);
  const create = useGatewayMutation({
    path: "/runtime/applications",
    schema: ActionResponseSchema,
  });
  const update = useGatewayMutation({
    path: "/runtime/applications/payload",
    schema: ActionResponseSchema,
  });
  const submit = useGatewayMutation({
    path: "/runtime/applications/submit",
    schema: ActionResponseSchema,
  });
  const send = async () => {
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
      setMessage(
        "Complete all vehicle and capacity fields. An approved driver profile is required.",
      );
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
      if (applicationId)
        await update.mutateAsync({
          applicationId,
          payload,
          idempotencyKey: idempotencyKey(
            "vehicle-application-payload",
            applicationId,
          ),
        });
      else {
        const result = await create.mutateAsync({
          applicationTypeKey: firstString(applicationType, ["key"]),
          payload,
          idempotencyKey: idempotencyKey(
            "vehicle-application-create",
            registration.trim().toUpperCase(),
          ),
        });
        applicationId = resultId(result);
      }
      if (!applicationId)
        throw new Error(
          "The approval service did not return an application identifier.",
        );
      await draftStore.clear(owner, "driver-vehicle-registration");
      await client.invalidateQueries({
        queryKey: ["lpg-expo", "applications"],
      });
      if (
        required.length > 0 &&
        (!currentId || applicationId !== currentId || missing.length > 0)
      ) {
        router.push("/(driver)/vehicle-documents");
        return;
      }
      await submit.mutateAsync({
        applicationId,
        idempotencyKey: idempotencyKey(
          "vehicle-application-submit",
          applicationId,
        ),
      });
      await client.invalidateQueries({
        queryKey: ["lpg-expo", "applications"],
      });
      setShowForm(false);
      setMessage("Vehicle submitted to the configured approval workflow.");
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Vehicle application could not be submitted.",
      );
    }
  };
  const loading =
    vehicles.isPending ||
    vehicleTypes.isPending ||
    applicationTypes.isPending ||
    applications.isPending ||
    requirements.isPending ||
    documents.isPending ||
    drivers.isPending;
  return (
    <Screen
      eyebrow="Driver capability"
      title="Vehicles"
      action={
        <Pressable
          onPress={() => setShowForm((value) => !value)}
          style={styles.action}
        >
          <Text style={styles.actionText}>
            {showForm ? "Close" : "Add vehicle"}
          </Text>
        </Pressable>
      }
    >
      {loading ? (
        <ActivityIndicator color={colors.brand} />
      ) : (
        <>
          {current ? (
            <View style={styles.pending}>
              <Truck color={colors.brand} size={24} />
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Vehicle application in review</Text>
                <Text style={styles.body}>
                  {(displayStatus(current) ?? "submitted").replace(
                    /[_-]/g,
                    " ",
                  )}
                </Text>
              </View>
            </View>
          ) : null}
          {current && missing.length > 0 ? (
            <Pressable
              style={styles.secondary}
              onPress={() => router.push("/(driver)/vehicle-documents")}
            >
              <Text style={styles.secondaryText}>
                Add required vehicle documents ({missing.length})
              </Text>
            </Pressable>
          ) : null}
          {showForm ? (
            <Card>
              <Text style={styles.title}>Vehicle approval application</Text>
              <Text style={styles.body}>
                Available types and approval are supplied by the platform. The
                vehicle is not dispatch-eligible until backend approval.
              </Text>
              <View style={styles.options}>
                {(vehicleTypes.data ?? [])
                  .filter((item) => firstString(item, ["status"]) === "active")
                  .map((item) => {
                    const key = firstString(item, ["key"]) ?? "";
                    return (
                      <Pressable
                        key={key}
                        onPress={() => setTypeKey(key)}
                        style={[
                          styles.option,
                          typeKey === key && styles.selected,
                        ]}
                      >
                        <Text style={styles.optionText}>
                          {firstString(item, ["display_name", "displayName"]) ??
                            key}
                        </Text>
                      </Pressable>
                    );
                  })}
              </View>
              <TextInput
                style={styles.input}
                placeholder="Manufacturer"
                placeholderTextColor={colors.muted}
                value={manufacturer}
                onChangeText={setManufacturer}
              />
              <TextInput
                style={styles.input}
                placeholder="Model"
                placeholderTextColor={colors.muted}
                value={model}
                onChangeText={setModel}
              />
              <TextInput
                style={styles.input}
                placeholder="Year"
                keyboardType="number-pad"
                placeholderTextColor={colors.muted}
                value={year}
                onChangeText={setYear}
              />
              <TextInput
                style={styles.input}
                placeholder="Registration number"
                autoCapitalize="characters"
                placeholderTextColor={colors.muted}
                value={registration}
                onChangeText={setRegistration}
              />
              <TextInput
                style={styles.input}
                placeholder="Colour"
                placeholderTextColor={colors.muted}
                value={colour}
                onChangeText={setColour}
              />
              <View style={styles.options}>
                {["owned", "leased", "rented"].map((value) => (
                  <Pressable
                    key={value}
                    onPress={() => setOwnership(value)}
                    style={[
                      styles.option,
                      ownership === value && styles.selected,
                    ]}
                  >
                    <Text style={styles.optionText}>{value}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                style={styles.input}
                placeholder="Verified maximum load (kg)"
                keyboardType="decimal-pad"
                placeholderTextColor={colors.muted}
                value={capacity}
                onChangeText={setCapacity}
              />
              <Pressable
                disabled={
                  create.isPending || update.isPending || submit.isPending
                }
                onPress={() => void send()}
                style={styles.primary}
              >
                {create.isPending || update.isPending || submit.isPending ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.primaryText}>
                    Submit vehicle for approval
                  </Text>
                )}
              </Pressable>
            </Card>
          ) : null}
          {(vehicles.data ?? []).map((vehicle, index) => {
            const id = recordId(vehicle);
            return (
              <Card key={id ?? String(index)}>
                <View style={styles.row}>
                  <View style={styles.vehicleIcon}>
                    <Truck color={colors.brand} size={24} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>
                      {firstString(vehicle, ["manufacturer"]) ?? "Vehicle"}{" "}
                      {firstString(vehicle, ["model"]) ?? ""}
                    </Text>
                    <Text style={styles.body}>
                      {firstString(vehicle, [
                        "registration_number",
                        "registrationNumber",
                      ]) ?? displayReference(vehicle)}{" "}
                      ·{" "}
                      {firstNumber(vehicle, ["max_load_kg", "maxLoadKg"]) ??
                        "Configured"}{" "}
                      kg
                    </Text>
                    <Text style={styles.status}>
                      {(
                        displayStatus(vehicle) ??
                        firstString(vehicle, [
                          "verification_status",
                          "verificationStatus",
                        ]) ??
                        "registered"
                      ).replace(/[_-]/g, " ")}
                    </Text>
                  </View>
                </View>
                {id ? (
                  <PresentationMediaPanel
                    subjectId={id}
                    subjectType="vehicle"
                    colour={firstString(vehicle, ["colour", "color"])}
                  />
                ) : null}
              </Card>
            );
          })}
          {(vehicles.data ?? []).length === 0 && !showForm ? (
            <Text style={styles.empty}>
              No approved vehicle is attached to this driver profile.
            </Text>
          ) : null}
        </>
      )}
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <Pressable onPress={() => router.back()}>
        <Text style={styles.back}>Back to account</Text>
      </Pressable>
    </Screen>
  );
}
function resultId(result: string | PlatformRecord | null) {
  return typeof result === "string"
    ? result
    : result
      ? firstString(result, ["id", "applicationId", "application_id"])
      : null;
}
const styles = StyleSheet.create({
  action: {
    backgroundColor: colors.brand,
    borderRadius: radii.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  actionText: { color: "white", fontWeight: "900" },
  pending: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: "#FFF0F1",
    borderWidth: 1,
    borderColor: "#F2C4C9",
  },
  title: { color: colors.ink, fontSize: 17, fontWeight: "900" },
  body: { color: colors.muted, lineHeight: 20 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  option: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
  },
  selected: { borderColor: colors.brand, backgroundColor: "#FFF0F1" },
  optionText: {
    color: colors.ink,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  input: {
    minHeight: 54,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    color: colors.ink,
  },
  primary: {
    minHeight: 55,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.brand,
  },
  primaryText: { color: "white", fontWeight: "900" },
  secondary: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radii.md,
  },
  secondaryText: { color: colors.brand, fontWeight: "900" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  vehicleIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF0F1",
  },
  status: {
    color: colors.brandDark,
    fontWeight: "800",
    textTransform: "capitalize",
    marginTop: 4,
  },
  empty: { color: colors.muted, textAlign: "center", padding: spacing.xl },
  message: { color: colors.brandDark, fontWeight: "700" },
  back: { color: colors.brand, fontWeight: "800" },
});
