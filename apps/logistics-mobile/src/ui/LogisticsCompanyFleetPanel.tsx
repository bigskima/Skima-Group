import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClientIdempotencyKey } from "@skima/frontend-core";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { asNumber, asString, useLogisticsQuery, useLogisticsRecordQuery } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { AppField } from "./AppField";
import { Card } from "./Card";
import { LogisticsMediaPicker } from "./LogisticsMediaPicker";
import { SectionHeader } from "./SectionHeader";
import { StatusPill } from "./StatusPill";

type Row = Record<string, unknown>;
const IdSchema = z.string().uuid();

function nested(row: Row | null | undefined, key: string): Row | null {
  const value = row?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function optionalNumber(value: string, label: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be a valid non-negative number.`);
  return parsed;
}

export function LogisticsCompanyFleetPanel({ organizationId }: { organizationId: string }) {
  const { palette } = useAppTheme();
  const { api } = useSession();
  const client = useQueryClient();
  const vehicles = useLogisticsQuery(
    ["company-fleet", organizationId],
    `/runtime/logistics/company/vehicles?organizationId=${encodeURIComponent(organizationId)}`,
    Boolean(organizationId),
    30_000,
  );
  const vehicleTypes = useLogisticsQuery(["company-fleet-vehicle-types"], "/runtime/logistics/company/vehicle-types", true, 120_000);
  const driversQuery = useLogisticsRecordQuery(
    ["company-fleet-drivers", organizationId],
    `/runtime/logistics/company/fleet-drivers?organizationId=${encodeURIComponent(organizationId)}`,
    Boolean(organizationId),
    30_000,
  );
  const drivers = useMemo(() => {
    const items = driversQuery.data?.drivers;
    return Array.isArray(items) ? items.filter((item): item is Row => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
  }, [driversQuery.data]);
  const [showForm, setShowForm] = useState(false);
  const [vehicleFormStep, setVehicleFormStep] = useState(1);
  const [vehicleTypeId, setVehicleTypeId] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [modelYear, setModelYear] = useState("");
  const [color, setColor] = useState("");
  const [maxLoadKg, setMaxLoadKg] = useState("");
  const [cargoVolume, setCargoVolume] = useState("");
  const [passengerCapacity, setPassengerCapacity] = useState("");
  const [fuelType, setFuelType] = useState("");
  const [insuranceExpiresAt, setInsuranceExpiresAt] = useState("");
  const [inspectionExpiresAt, setInspectionExpiresAt] = useState("");
  const [roadworthinessExpiresAt, setRoadworthinessExpiresAt] = useState("");
  const [selectedDriverByVehicle, setSelectedDriverByVehicle] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const registerVehicle = useMutation({
    mutationFn: async () => {
      if (!vehicleTypeId) throw new Error("Choose a vehicle type.");
      if (registrationNumber.trim().length < 3) throw new Error("Enter the vehicle registration number.");
      const parsedYear = modelYear.trim() ? Number(modelYear) : null;
      if (parsedYear !== null && (!Number.isInteger(parsedYear) || parsedYear < 1900 || parsedYear > new Date().getFullYear() + 1)) {
        throw new Error("Enter a valid vehicle model year.");
      }
      const parsedPassengers = passengerCapacity.trim() ? Number(passengerCapacity) : null;
      if (parsedPassengers !== null && (!Number.isInteger(parsedPassengers) || parsedPassengers < 0)) {
        throw new Error("Passenger capacity must be a whole number.");
      }
      return api.post("/runtime/logistics/company/vehicles", {
        organizationId,
        vehicleTypeId,
        registrationNumber: registrationNumber.trim().toUpperCase(),
        manufacturer: manufacturer.trim() || null,
        model: model.trim() || null,
        modelYear: parsedYear,
        color: color.trim() || null,
        maxLoadKg: optionalNumber(maxLoadKg, "Maximum load"),
        cargoVolumeM3: optionalNumber(cargoVolume, "Cargo volume"),
        passengerCapacity: parsedPassengers,
        fuelType: fuelType.trim() || null,
        insuranceExpiresAt: insuranceExpiresAt.trim() || null,
        inspectionExpiresAt: inspectionExpiresAt.trim() || null,
        roadworthinessExpiresAt: roadworthinessExpiresAt.trim() || null,
        idempotencyKey: createClientIdempotencyKey(
          "logistics.company.vehicle.register",
          `${organizationId}:${registrationNumber.trim().toUpperCase()}`,
        ),
      }, IdSchema);
    },
    onSuccess: async () => {
      setShowForm(false);
      setVehicleFormStep(1);
      setVehicleTypeId("");
      setRegistrationNumber("");
      setManufacturer("");
      setModel("");
      setModelYear("");
      setColor("");
      setMaxLoadKg("");
      setCargoVolume("");
      setPassengerCapacity("");
      setFuelType("");
      setInsuranceExpiresAt("");
      setInspectionExpiresAt("");
      setRoadworthinessExpiresAt("");
      setError(null);
      await vehicles.refetch();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "The vehicle could not be added."),
  });

  const assignDriver = useMutation({
    mutationFn: (input: { vehicleId: string; driverProfileId: string }) => api.post(
      "/runtime/logistics/company/vehicles/assign-driver",
      {
        organizationId,
        vehicleId: input.vehicleId,
        driverProfileId: input.driverProfileId,
        idempotencyKey: createClientIdempotencyKey(
          "logistics.company.vehicle.driver",
          `${organizationId}:${input.vehicleId}:${input.driverProfileId}`,
        ),
      },
      IdSchema,
    ),
    onSuccess: async () => {
      setError(null);
      await Promise.all([vehicles.refetch(), driversQuery.refetch()]);
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "The driver could not be assigned to this vehicle."),
  });

  const refresh = () => Promise.all([vehicles.refetch(), vehicleTypes.refetch(), driversQuery.refetch()]);
  const busy = registerVehicle.isPending || assignDriver.isPending;
  const approvedDrivers = drivers.filter((driver) => asString(driver, "verification_status") === "approved");
  const vehicleTypeLabel = (vehicle: Row) => asString(nested(vehicle, "vehicle_type"), "display_name") ?? "Company vehicle";

  return (
    <View style={styles.section}>
      <SectionHeader title="Company fleet" description="Your company owns and manages its vehicles, licensing records and driver assignments." />
      {vehicles.isPending || vehicleTypes.isPending || driversQuery.isPending ? (
        <Card padding="lg"><Text style={[styles.copy, { color: palette.muted }]}>Loading your company fleet…</Text></Card>
      ) : vehicles.error || vehicleTypes.error || driversQuery.error ? (
        <Card padding="lg" gap={spacing.sm}>
          <Text style={[styles.copy, { color: palette.muted }]}>Fleet information could not be loaded.</Text>
          <AppButton size="sm" variant="secondary" label="Retry" onPress={() => void refresh()} />
        </Card>
      ) : (
        <>
          {approvedDrivers.length ? (
            <View style={styles.driverDirectory}>
              <SectionHeader title="Company drivers" description="Keep a clear, current portrait for each approved driver. Customers see the assigned driver's photo before and during the booking." />
              {approvedDrivers.map((driver) => {
                const driverId = asString(driver, "driver_profile_id") ?? "";
                return (
                  <LogisticsMediaPicker
                    key={driverId}
                    entityType="driver"
                    entityId={driverId}
                    organizationId={organizationId}
                    mediaRole="driver.photo.public"
                    title={asString(driver, "display_name") ?? "Company driver"}
                    description="Public driver photo shown beside the vehicle assigned to the customer."
                    compact
                  />
                );
              })}
            </View>
          ) : null}
          {vehicles.data?.length ? vehicles.data.map((vehicle) => {
            const vehicleId = asString(vehicle, "id") ?? "";
            const driverId = selectedDriverByVehicle[vehicleId] ?? "";
            const currentDriver = drivers.find((driver) =>
              asString(driver, "driver_profile_id") === driverId
            );
            return (
              <Card key={vehicleId} padding="lg">
                <View style={styles.vehicleHeader}>
                  <View style={styles.vehicleCopy}>
                    <Text style={[styles.vehicleTitle, { color: palette.ink }]}>{vehicleTypeLabel(vehicle)}</Text>
                    <Text style={[styles.copy, { color: palette.muted }]}>
                      {[asString(vehicle, "manufacturer"), asString(vehicle, "model"), asString(vehicle, "model_year"), asString(vehicle, "registration_number")].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  <StatusPill status="company_managed" />
                </View>
                <Text style={[styles.copy, { color: palette.muted }]}>
                  Company-managed vehicle · SKIMA does not need to approve the vehicle or its licensing. The company is responsible for keeping the records current.
                </Text>
                <LogisticsMediaPicker
                  entityType="logistics_vehicle"
                  entityId={vehicleId}
                  organizationId={organizationId}
                  mediaRole="logistics.vehicle.photo.public"
                  title="Public vehicle photo"
                  description="Customers can see the actual vehicle assigned to their booking."
                  compact
                />
                <View style={[styles.compliance, { backgroundColor: palette.surfaceSubtle }]}>
                  <Text style={[styles.copy, { color: palette.muted }]}>
                    Insurance: {asString(vehicle, "insurance_expires_at") ?? "Not recorded"} · Inspection: {asString(vehicle, "inspection_expires_at") ?? "Not recorded"} · Roadworthiness: {asString(vehicle, "roadworthiness_expires_at") ?? "Not recorded"}
                  </Text>
                </View>
                <View style={styles.assignArea}>
                  <Text style={[styles.label, { color: palette.ink }]}>Assign a company driver</Text>
                  <View style={styles.driverChoices}>
                    {approvedDrivers.map((driver) => {
                      const id = asString(driver, "driver_profile_id") ?? "";
                      const name = asString(driver, "display_name") ?? "Approved driver";
                      const selected = id === driverId;
                      return (
                        <Pressable key={id} accessibilityRole="button" onPress={() =>
                          setSelectedDriverByVehicle((previous) => ({ ...previous, [vehicleId]: id }))
                        } style={[
                          styles.driverChoice,
                          { backgroundColor: selected ? palette.brandSofter : palette.surface, borderColor: selected ? palette.brand : palette.border },
                        ]}>
                          <Text numberOfLines={1} style={[styles.driverName, { color: selected ? palette.brand : palette.ink }]}>{name}</Text>
                          <Text style={[styles.copy, { color: palette.muted }]}>{asString(driver, "public_driver_id") ?? "Approved identity"}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <AppButton size="sm" label={assignDriver.isPending && assignDriver.variables?.vehicleId === vehicleId ? "Assigning…" : currentDriver ? "Update driver assignment" : "Assign selected driver"}
                    loading={assignDriver.isPending && assignDriver.variables?.vehicleId === vehicleId}
                    disabled={busy || !driverId || !currentDriver}
                    onPress={() => {
                      setError(null);
                      assignDriver.mutate({ vehicleId, driverProfileId: driverId });
                    }} />
                </View>
              </Card>
            );
          }) : (
            <Card padding="lg">
              <Text style={[styles.vehicleTitle, { color: palette.ink }]}>No company vehicles yet</Text>
              <Text style={[styles.copy, { color: palette.muted }]}>Add the vehicles your company operates. Each one can be photographed and assigned to one of your approved drivers.</Text>
            </Card>
          )}

          {showForm ? (
            <Card padding="lg" gap={spacing.md}>
              <Text style={[styles.vehicleTitle, { color: palette.ink }]}>Add a company vehicle</Text>
              <Text style={[styles.copy, { color: palette.muted }]}>This vehicle is registered directly to your company. SKIMA does not run a separate vehicle-approval step.</Text>
              <View style={styles.formProgress}>
                {[1, 2, 3].map((part) => <View key={part} style={[styles.formProgressSegment, { backgroundColor: part <= vehicleFormStep ? palette.brand : palette.border }]} />)}
                <Text style={[styles.formStepLabel, { color: palette.muted }]}>STEP {vehicleFormStep} OF 3</Text>
              </View>
              {vehicleFormStep === 1 ? (
                <View style={styles.formStep}>
                  <SectionHeader title="Vehicle identity" description="Start with the vehicle type and registration details." />
                  <Text style={[styles.label, { color: palette.ink }]}>Vehicle type</Text>
                  <View style={styles.driverChoices}>
                    {(vehicleTypes.data ?? []).map((type) => {
                      const id = asString(type, "id") ?? "";
                      const selected = id === vehicleTypeId;
                      return (
                        <Pressable key={id} accessibilityRole="button" onPress={() => setVehicleTypeId(id)}
                          style={[styles.driverChoice, { backgroundColor: selected ? palette.brandSofter : palette.surface, borderColor: selected ? palette.brand : palette.border }]}>
                          <Text style={[styles.driverName, { color: selected ? palette.brand : palette.ink }]}>{asString(type, "display_name") ?? asString(type, "key")}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <AppField label="Registration number" value={registrationNumber} onChangeText={setRegistrationNumber} placeholder="e.g. ABC-123XY" />
                  <AppField label="Manufacturer" value={manufacturer} onChangeText={setManufacturer} placeholder="e.g. Toyota" optional />
                  <AppField label="Model" value={model} onChangeText={setModel} placeholder="e.g. Hiace" optional />
                  <AppField label="Model year" value={modelYear} onChangeText={setModelYear} keyboardType="number-pad" placeholder="e.g. 2021" optional />
                  <AppField label="Colour" value={color} onChangeText={setColor} placeholder="e.g. White" optional />
                </View>
              ) : vehicleFormStep === 2 ? (
                <View style={styles.formStep}>
                  <SectionHeader title="Capacity & operation" description="Add the operating details that help match this vehicle to suitable customer jobs." />
                  <AppField label="Maximum load (kg)" value={maxLoadKg} onChangeText={setMaxLoadKg} keyboardType="decimal-pad" optional />
                  <AppField label="Cargo volume (m³)" value={cargoVolume} onChangeText={setCargoVolume} keyboardType="decimal-pad" optional />
                  <AppField label="Passenger capacity" value={passengerCapacity} onChangeText={setPassengerCapacity} keyboardType="number-pad" optional />
                  <AppField label="Fuel type" value={fuelType} onChangeText={setFuelType} placeholder="e.g. Petrol, Diesel or CNG" optional />
                </View>
              ) : (
                <View style={styles.formStep}>
                  <SectionHeader title="Company-managed licensing" description="Your company owns and maintains these records. SKIMA does not separately approve your company vehicle or its licences." />
                  <Text style={[styles.label, { color: palette.ink }]}>Enter dates as YYYY-MM-DD when available.</Text>
                  <AppField label="Insurance expiry" value={insuranceExpiresAt} onChangeText={setInsuranceExpiresAt} placeholder="YYYY-MM-DD" optional />
                  <AppField label="Inspection expiry" value={inspectionExpiresAt} onChangeText={setInspectionExpiresAt} placeholder="YYYY-MM-DD" optional />
                  <AppField label="Roadworthiness expiry" value={roadworthinessExpiresAt} onChangeText={setRoadworthinessExpiresAt} placeholder="YYYY-MM-DD" optional />
                </View>
              )}
              <View style={styles.actions}>
                <AppButton label="Cancel" variant="secondary" onPress={() => { setShowForm(false); setVehicleFormStep(1); }} />
                {vehicleFormStep > 1 ? (
                  <AppButton label="Back" variant="secondary" onPress={() => setVehicleFormStep((step) => Math.max(1, step - 1))} />
                ) : null}
                {vehicleFormStep < 3 ? (
                  <AppButton label="Continue" fullWidth
                    disabled={vehicleFormStep === 1 && (!vehicleTypeId || registrationNumber.trim().length < 3)}
                    onPress={() => { setError(null); setVehicleFormStep((step) => Math.min(3, step + 1)); }} />
                ) : (
                  <AppButton label="Add vehicle" fullWidth loading={registerVehicle.isPending}
                    disabled={busy || !vehicleTypeId || registrationNumber.trim().length < 3}
                    onPress={() => { setError(null); registerVehicle.mutate(); }} />
                )}
              </View>
            </Card>
          ) : (
            <AppButton label="Add a company vehicle" fullWidth variant="secondary" disabled={busy}
              onPress={() => { setVehicleFormStep(1); setShowForm(true); }} />
          )}
        </>
      )}
      {approvedDrivers.length === 0 && !driversQuery.isPending ? (
        <Card padding="md">
          <Text style={[styles.copy, { color: palette.muted }]}>No SKIMA-approved driver profiles are linked to this company yet. Invite or onboard a driver first; vehicle assignment opens when the driver's identity has been approved.</Text>
        </Card>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  formProgress: { flexDirection: "row", alignItems: "center", gap: 6 },
  formProgressSegment: { flex: 1, height: 5, borderRadius: radii.pill },
  formStepLabel: { ...typography.eyebrow, fontSize: 8, marginLeft: 4 },
  formStep: { gap: spacing.md },
  driverDirectory: { gap: spacing.sm },
  vehicleHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  vehicleCopy: { flex: 1, minWidth: 0, gap: 4 },
  vehicleTitle: { ...typography.bodyStrong, fontSize: 13 },
  copy: { ...typography.caption, fontSize: 10, lineHeight: 15 },
  compliance: { borderRadius: radii.md, padding: spacing.sm },
  assignArea: { gap: spacing.sm },
  label: { ...typography.caption, fontSize: 10, fontWeight: "800" },
  driverChoices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  driverChoice: { borderWidth: 1, borderRadius: radii.md, padding: spacing.sm, minWidth: 120, maxWidth: "100%", gap: 3 },
  driverName: { ...typography.caption, fontSize: 10, fontWeight: "800" },
  actions: { flexDirection: "row", gap: spacing.sm },
  error: { ...typography.caption, fontSize: 10, lineHeight: 15 },
});
