import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, History, Plus, RefreshCcw, ShieldCheck, Truck, UserRoundCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";

import { createClientIdempotencyKey, normalizeStatusLabel } from "@skima/frontend-core";
import {
  Button,
  Dialog,
  ErrorState,
  LoadingState,
  MetricTile,
  PageHeader,
  SelectInput,
  StatusBadge,
  TextAreaInput,
  TextInput,
} from "@skima/ui";

import { useSessionState } from "./session";

const VehicleTypeSchema = z.object({
  vehicleTypeId: z.string().uuid(),
  key: z.string(),
  label: z.string(),
});
const VehicleTypeListSchema = z.array(VehicleTypeSchema);

const VehicleSchema = z.object({
  vehicleId: z.string().uuid(),
  registrationNumber: z.string().nullable(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  modelYear: z.coerce.number().nullable(),
  color: z.string().nullable(),
  status: z.string(),
  platformOwned: z.boolean(),
  vehicleTypeId: z.string().uuid().nullable(),
  vehicleTypeLabel: z.string().nullable(),
  maxLoadKg: z.coerce.number().nullable(),
  insuranceExpiresAt: z.string().nullable(),
  inspectionExpiresAt: z.string().nullable(),
  roadworthinessExpiresAt: z.string().nullable(),
  complianceReady: z.boolean(),
  currentAssignmentId: z.string().uuid().nullable(),
  currentDriverProfileId: z.string().uuid().nullable(),
  currentDriverName: z.string().nullable(),
  currentDriverPublicId: z.string().nullable(),
  availableForAssignment: z.boolean(),
});
const VehicleListSchema = z.array(VehicleSchema);
type FleetVehicle = z.infer<typeof VehicleSchema>;

const DriverSchema = z.object({
  driverProfileId: z.string().uuid(),
  displayName: z.string(),
  publicDriverId: z.string().nullable(),
  isManaged: z.boolean(),
  verificationStatus: z.string(),
});
const DriverListSchema = z.array(DriverSchema.passthrough());
type ManagedDriver = z.infer<typeof DriverSchema>;

type VehicleForm = {
  vehicleTypeId: string;
  registrationNumber: string;
  manufacturer: string;
  model: string;
  modelYear: string;
  color: string;
  maxLoadKg: string;
  vin: string;
  fuelType: string;
  insuranceExpiresAt: string;
  inspectionExpiresAt: string;
  roadworthinessExpiresAt: string;
  reason: string;
};

const emptyVehicleForm: VehicleForm = {
  vehicleTypeId: "",
  registrationNumber: "",
  manufacturer: "",
  model: "",
  modelYear: "",
  color: "",
  maxLoadKg: "",
  vin: "",
  fuelType: "",
  insuranceExpiresAt: "",
  inspectionExpiresAt: "",
  roadworthinessExpiresAt: "",
  reason: "",
};

export function AdminSkimaFleetWorkspace(props: { readonly onNavigate: (href: string) => void }) {
  const { supabase, status, context } = useSessionState();
  const queryClient = useQueryClient();
  const [registerOpen, setRegisterOpen] = useState(false);
  const [vehicleForm, setVehicleForm] = useState<VehicleForm>(emptyVehicleForm);
  const [assignmentVehicle, setAssignmentVehicle] = useState<FleetVehicle | null>(null);
  const [assignmentDriverId, setAssignmentDriverId] = useState("");
  const [assignmentReason, setAssignmentReason] = useState("");
  const [unassignVehicle, setUnassignVehicle] = useState<FleetVehicle | null>(null);
  const [unassignReason, setUnassignReason] = useState("");
  const [reviewVehicle, setReviewVehicle] = useState<FleetVehicle | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const isSuperAdmin = context?.platformAdmin?.admin_kind === "super_admin";
  const canManageFleet = Boolean(
    isSuperAdmin ||
      context?.permissions.includes("platform.fleets.manage") ||
      context?.permissions.includes("platform.vehicles.manage"),
  );

  const vehicleTypes = useQuery({
    queryKey: ["platform-fleet-vehicle-types"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_platform_fleet_vehicle_types");
      if (error) throw error;
      return VehicleTypeListSchema.parse(data ?? []);
    },
  });

  const vehicles = useQuery({
    queryKey: ["platform-fleet-vehicles"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_platform_fleet_vehicle_options");
      if (error) throw error;
      return VehicleListSchema.parse(data ?? []);
    },
  });

  const drivers = useQuery({
    queryKey: ["lpg-managed-drivers-admin"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_lpg_managed_driver_admin", {
        target_driver_profile_id: null,
      });
      if (error) throw error;
      return DriverListSchema.parse(data ?? []);
    },
  });

  const managedDrivers = useMemo(
    () => (drivers.data ?? []).filter((driver) => driver.isManaged && driver.verificationStatus === "approved"),
    [drivers.data],
  );
  const fleet = vehicles.data ?? [];
  const assignedCount = fleet.filter((vehicle) => Boolean(vehicle.currentAssignmentId)).length;
  const readyCount = fleet.filter((vehicle) => vehicle.status === "active" && vehicle.complianceReady).length;
  const pendingCount = fleet.filter((vehicle) => vehicle.status !== "active" || !vehicle.complianceReady).length;

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["platform-fleet-vehicles"] }),
      queryClient.invalidateQueries({ queryKey: ["lpg-managed-drivers-admin"] }),
      queryClient.invalidateQueries({ queryKey: ["fleet-admin"] }),
      queryClient.invalidateQueries({ queryKey: ["lpg-launch-assurance-readiness"] }),
    ]);
  };

  const registerVehicle = useMutation({
    mutationFn: async () => {
      if (!vehicleForm.vehicleTypeId || !vehicleForm.registrationNumber.trim() || !vehicleForm.manufacturer.trim() || !vehicleForm.model.trim() || !vehicleForm.reason.trim()) {
        throw new Error("Vehicle type, registration number, manufacturer, model and an admin reason are required.");
      }
      const { data, error } = await supabase.rpc("register_platform_fleet_vehicle", {
        target_color: vehicleForm.color.trim() || null,
        target_fuel_type: vehicleForm.fuelType.trim() || null,
        target_idempotency_key: createClientIdempotencyKey("admin.skima-fleet.register", vehicleForm.registrationNumber.trim().toUpperCase()),
        target_inspection_expires_at: vehicleForm.inspectionExpiresAt || null,
        target_insurance_expires_at: vehicleForm.insuranceExpiresAt || null,
        target_manufacturer: vehicleForm.manufacturer.trim(),
        target_max_load_kg: vehicleForm.maxLoadKg ? Number(vehicleForm.maxLoadKg) : null,
        target_metadata: { surface: "skima_fleet" },
        target_model: vehicleForm.model.trim(),
        target_model_year: vehicleForm.modelYear ? Number(vehicleForm.modelYear) : null,
        target_reason: vehicleForm.reason.trim(),
        target_registration_number: vehicleForm.registrationNumber.trim(),
        target_roadworthiness_expires_at: vehicleForm.roadworthinessExpiresAt || null,
        target_vehicle_type_id: vehicleForm.vehicleTypeId,
        target_vin: vehicleForm.vin.trim() || null,
      });
      if (error) throw error;
      return z.string().uuid().parse(data);
    },
    onSuccess: async () => {
      setRegisterOpen(false);
      setVehicleForm(emptyVehicleForm);
      setNotice("SKIMA vehicle registered. It remains unavailable for dispatch until compliance is complete and the vehicle is approved.");
      await refresh();
    },
  });

  const assignVehicle = useMutation({
    mutationFn: async () => {
      if (!assignmentVehicle || !assignmentDriverId || !assignmentReason.trim()) {
        throw new Error("Choose a Managed Driver and enter an assignment reason.");
      }
      const { error } = await supabase.rpc("assign_platform_fleet_vehicle", {
        target_driver_profile_id: assignmentDriverId,
        target_metadata: { surface: "skima_fleet" },
        target_reason: assignmentReason.trim(),
        target_starts_at: new Date().toISOString(),
        target_vehicle_id: assignmentVehicle.vehicleId,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setNotice("SKIMA vehicle assignment updated.");
      setAssignmentVehicle(null);
      setAssignmentDriverId("");
      setAssignmentReason("");
      await refresh();
    },
  });

  const unassign = useMutation({
    mutationFn: async () => {
      if (!unassignVehicle?.currentAssignmentId || !unassignReason.trim()) throw new Error("Enter an unassignment reason.");
      const { error } = await supabase.rpc("unassign_platform_fleet_vehicle", {
        target_assignment_id: unassignVehicle.currentAssignmentId,
        target_reason: unassignReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setNotice("SKIMA vehicle unassigned. It can now be assigned to another Managed Driver.");
      setUnassignVehicle(null);
      setUnassignReason("");
      await refresh();
    },
  });

  const approveVehicle = useMutation({
    mutationFn: async () => {
      if (!reviewVehicle || !reviewReason.trim()) throw new Error("Enter an approval reason.");
      const { error } = await supabase.rpc("decide_vehicle_lifecycle", {
        target_decision: "approved",
        target_idempotency_key: createClientIdempotencyKey("admin.skima-fleet.approve", reviewVehicle.vehicleId),
        target_reason: reviewReason.trim(),
        target_vehicle_id: reviewVehicle.vehicleId,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setNotice("SKIMA vehicle approved and activated.");
      setReviewVehicle(null);
      setReviewReason("");
      await refresh();
    },
  });

  if (vehicles.isPending || vehicleTypes.isPending || drivers.isPending) return <LoadingState label="Loading SKIMA Fleet…" />;
  const queryError = vehicles.error ?? vehicleTypes.error ?? drivers.error;
  if (queryError) return <ErrorState error={queryError} onRetry={() => void refresh()} />;

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="People & Partners · SKIMA Fleet"
        title="SKIMA Fleet"
        description="Register vehicles owned by SKIMA and assign them to SKIMA Managed Drivers. Managed Drivers do not use personal vehicles for SKIMA internal fulfillment."
        actions={(
          <div className="sk-inline-actions">
            <Button variant="outline" icon={History} onClick={() => props.onNavigate("/partners/fleet/advanced")}>Advanced fleet</Button>
            <Button icon={Plus} disabled={!canManageFleet} onClick={() => setRegisterOpen(true)}>Add SKIMA Vehicle</Button>
            <Button variant="outline" icon={RefreshCcw} onClick={() => void refresh()}>Refresh</Button>
          </div>
        )}
      />

      {notice ? <div className="sk-panel"><StatusBadge tone="success">{notice}</StatusBadge></div> : null}

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="SKIMA vehicles" value={fleet.length} icon={Truck} />
        <MetricTile label="Ready for service" value={readyCount} icon={ShieldCheck} tone={readyCount ? "success" : "warning"} />
        <MetricTile label="Assigned" value={assignedCount} icon={UserRoundCheck} />
        <MetricTile label="Need setup" value={pendingCount} icon={CheckCircle2} tone={pendingCount ? "warning" : "success"} />
      </section>

      <section className="sk-panel stack-md">
        <div className="section-heading">
          <div>
            <span className="section-kicker">Company assets</span>
            <h2>SKIMA-owned vehicles</h2>
            <p className="skima-muted">A vehicle must pass the existing compliance checks and be active before it can be assigned for live Managed Driver dispatch.</p>
          </div>
        </div>

        {fleet.length ? fleet.map((vehicle) => {
          const ready = vehicle.status === "active" && vehicle.complianceReady;
          const vehicleName = `${vehicle.manufacturer ?? "Vehicle"} ${vehicle.model ?? ""}`.trim();
          return (
            <div className="sk-panel stack-md" key={vehicle.vehicleId}>
              <div className="skima-list-row">
                <div>
                  <strong>{vehicle.registrationNumber ?? vehicleName}</strong>
                  <span>{vehicleName} · {vehicle.vehicleTypeLabel ?? "Vehicle"}</span>
                </div>
                <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <StatusBadge tone="info">SKIMA property</StatusBadge>
                  <StatusBadge tone={ready ? "success" : "warning"}>{ready ? "Service ready" : normalizeStatusLabel(vehicle.status)}</StatusBadge>
                </div>
              </div>

              <div className="skima-grid skima-grid--compact">
                <div className="sk-panel"><small>Assigned Driver</small><h3>{vehicle.currentDriverName ?? "Not assigned"}</h3><span>{vehicle.currentDriverPublicId ?? "Available for assignment"}</span></div>
                <div className="sk-panel"><small>Compliance</small><h3>{vehicle.complianceReady ? "Complete" : "Needs attention"}</h3><span>{vehicle.complianceReady ? "Vehicle compliance is valid" : "Complete vehicle compliance before approval"}</span></div>
                <div className="sk-panel"><small>Maximum load</small><h3>{vehicle.maxLoadKg == null ? "Not set" : `${vehicle.maxLoadKg} kg`}</h3><span>{vehicle.color ?? "Colour not set"}</span></div>
              </div>

              <div className="sk-inline-actions">
                {vehicle.status !== "active" && vehicle.complianceReady ? <Button size="sm" disabled={!canManageFleet} onClick={() => setReviewVehicle(vehicle)}>Approve vehicle</Button> : null}
                {ready ? <Button size="sm" variant="outline" disabled={!canManageFleet || !managedDrivers.length} onClick={() => { setAssignmentVehicle(vehicle); setAssignmentDriverId(vehicle.currentDriverProfileId ?? managedDrivers[0]?.driverProfileId ?? ""); setAssignmentReason(""); }}>{vehicle.currentAssignmentId ? "Change Driver" : "Assign Driver"}</Button> : null}
                {vehicle.currentAssignmentId ? <Button size="sm" variant="outline" disabled={!canManageFleet} onClick={() => setUnassignVehicle(vehicle)}>Unassign</Button> : null}
                {!vehicle.complianceReady ? <Button size="sm" variant="ghost" onClick={() => props.onNavigate("/partners/fleet/advanced")}>Open compliance review</Button> : null}
              </div>
            </div>
          );
        }) : <p className="skima-muted">No SKIMA-owned vehicles are registered yet. Add the first company vehicle to begin assigning fleet assets to Managed Drivers.</p>}
      </section>

      <Dialog
        isOpen={registerOpen}
        title="Add SKIMA Vehicle"
        onClose={() => setRegisterOpen(false)}
        footer={<><Button variant="secondary" onClick={() => setRegisterOpen(false)}>Cancel</Button><Button isLoading={registerVehicle.isPending} disabled={!canManageFleet} onClick={() => registerVehicle.mutate()}>Register SKIMA Vehicle</Button></>}
      >
        <div className="stack-md">
          <p className="skima-muted">This records the vehicle as SKIMA property. It will start as Pending until the existing compliance checks are complete and an admin approves it.</p>
          <SelectInput label="Vehicle type" value={vehicleForm.vehicleTypeId} onChange={(event) => setVehicleForm((current) => ({ ...current, vehicleTypeId: event.currentTarget.value }))} options={[{ label: "Choose vehicle type", value: "" }, ...(vehicleTypes.data ?? []).map((type) => ({ label: type.label, value: type.vehicleTypeId }))]} />
          <div className="skima-form-grid">
            <TextInput label="Registration number" value={vehicleForm.registrationNumber} onChange={(event) => setVehicleForm((current) => ({ ...current, registrationNumber: event.currentTarget.value }))} />
            <TextInput label="Manufacturer" value={vehicleForm.manufacturer} onChange={(event) => setVehicleForm((current) => ({ ...current, manufacturer: event.currentTarget.value }))} />
            <TextInput label="Model" value={vehicleForm.model} onChange={(event) => setVehicleForm((current) => ({ ...current, model: event.currentTarget.value }))} />
            <TextInput label="Model year" type="number" value={vehicleForm.modelYear} onChange={(event) => setVehicleForm((current) => ({ ...current, modelYear: event.currentTarget.value }))} />
            <TextInput label="Colour" value={vehicleForm.color} onChange={(event) => setVehicleForm((current) => ({ ...current, color: event.currentTarget.value }))} />
            <TextInput label="Maximum load (kg)" type="number" min="0" step="0.01" value={vehicleForm.maxLoadKg} onChange={(event) => setVehicleForm((current) => ({ ...current, maxLoadKg: event.currentTarget.value }))} />
            <TextInput label="VIN / chassis number" value={vehicleForm.vin} onChange={(event) => setVehicleForm((current) => ({ ...current, vin: event.currentTarget.value }))} />
            <TextInput label="Fuel type" value={vehicleForm.fuelType} onChange={(event) => setVehicleForm((current) => ({ ...current, fuelType: event.currentTarget.value }))} />
            <TextInput label="Insurance expiry" type="date" value={vehicleForm.insuranceExpiresAt} onChange={(event) => setVehicleForm((current) => ({ ...current, insuranceExpiresAt: event.currentTarget.value }))} />
            <TextInput label="Inspection expiry" type="date" value={vehicleForm.inspectionExpiresAt} onChange={(event) => setVehicleForm((current) => ({ ...current, inspectionExpiresAt: event.currentTarget.value }))} />
            <TextInput label="Roadworthiness expiry" type="date" value={vehicleForm.roadworthinessExpiresAt} onChange={(event) => setVehicleForm((current) => ({ ...current, roadworthinessExpiresAt: event.currentTarget.value }))} />
          </div>
          <TextAreaInput label="Why is this vehicle being added?" value={vehicleForm.reason} onChange={(event) => setVehicleForm((current) => ({ ...current, reason: event.currentTarget.value }))} placeholder="Example: Purchased for Awka Managed Driver launch operations" />
          {registerVehicle.error ? <ErrorState error={registerVehicle.error} /> : null}
        </div>
      </Dialog>

      <Dialog
        isOpen={Boolean(assignmentVehicle)}
        title={assignmentVehicle?.currentAssignmentId ? "Change Assigned Driver" : "Assign SKIMA Vehicle"}
        onClose={() => setAssignmentVehicle(null)}
        footer={<><Button variant="secondary" onClick={() => setAssignmentVehicle(null)}>Cancel</Button><Button isLoading={assignVehicle.isPending} disabled={!assignmentDriverId || !assignmentReason.trim()} onClick={() => assignVehicle.mutate()}>Save assignment</Button></>}
      >
        <div className="stack-md">
          <p className="skima-muted">{assignmentVehicle?.registrationNumber} remains SKIMA property. You are only changing which Managed Driver operates it.</p>
          <SelectInput label="SKIMA Managed Driver" value={assignmentDriverId} onChange={(event) => setAssignmentDriverId(event.currentTarget.value)} options={[{ label: "Choose Managed Driver", value: "" }, ...managedDrivers.map((driver) => ({ label: driverLabel(driver), value: driver.driverProfileId }))]} />
          <TextAreaInput label="Assignment reason" value={assignmentReason} onChange={(event) => setAssignmentReason(event.currentTarget.value)} placeholder="Example: Primary Awka launch vehicle" />
          {assignVehicle.error ? <ErrorState error={assignVehicle.error} /> : null}
        </div>
      </Dialog>

      <Dialog
        isOpen={Boolean(unassignVehicle)}
        title="Unassign SKIMA Vehicle"
        onClose={() => setUnassignVehicle(null)}
        footer={<><Button variant="secondary" onClick={() => setUnassignVehicle(null)}>Cancel</Button><Button isLoading={unassign.isPending} disabled={!unassignReason.trim()} onClick={() => unassign.mutate()}>Unassign vehicle</Button></>}
      >
        <div className="stack-md">
          <p className="skima-muted">The vehicle remains SKIMA property and becomes available for another Managed Driver.</p>
          <TextAreaInput label="Reason" value={unassignReason} onChange={(event) => setUnassignReason(event.currentTarget.value)} />
          {unassign.error ? <ErrorState error={unassign.error} /> : null}
        </div>
      </Dialog>

      <Dialog
        isOpen={Boolean(reviewVehicle)}
        title="Approve SKIMA Vehicle"
        onClose={() => setReviewVehicle(null)}
        footer={<><Button variant="secondary" onClick={() => setReviewVehicle(null)}>Cancel</Button><Button isLoading={approveVehicle.isPending} disabled={!reviewReason.trim()} onClick={() => approveVehicle.mutate()}>Approve & activate</Button></>}
      >
        <div className="stack-md">
          <p className="skima-muted">Approval activates this SKIMA-owned vehicle for assignment only after its configured compliance requirements are complete.</p>
          <TextAreaInput label="Approval reason" value={reviewReason} onChange={(event) => setReviewReason(event.currentTarget.value)} />
          {approveVehicle.error ? <ErrorState error={approveVehicle.error} /> : null}
        </div>
      </Dialog>
    </div>
  );
}

function driverLabel(driver: ManagedDriver) {
  return driver.publicDriverId ? `${driver.displayName} · ${driver.publicDriverId}` : driver.displayName;
}
