import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPinned, RefreshCcw, ShieldCheck, Truck, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";

import { createClientIdempotencyKey, normalizeStatusLabel } from "@skima/frontend-core";
import {
  Button,
  ErrorState,
  LoadingState,
  MetricTile,
  PageHeader,
  SelectInput,
  StatusBadge,
  TextAreaInput,
} from "@skima/ui";

import { useSessionState } from "./session";

const DriverSchema = z.object({
  driverProfileId: z.string().uuid(),
  displayName: z.string(),
  publicDriverId: z.string().nullable(),
  verificationStatus: z.string(),
  operationalStatus: z.string(),
  isManaged: z.boolean(),
  vehicleReady: z.boolean(),
  coverageReady: z.boolean(),
  activeVehicleCount: z.coerce.number().int().nonnegative(),
  serviceAreaCount: z.coerce.number().int().nonnegative(),
});
const DriverListSchema = z.array(DriverSchema.passthrough());
type Driver = z.infer<typeof DriverSchema>;

const AreaSchema = z.object({
  key: z.string(),
  label: z.string(),
  areaType: z.string(),
  stateName: z.string().nullable(),
  lgaName: z.string().nullable(),
  cityName: z.string().nullable(),
  townName: z.string().nullable(),
});
const AreaListSchema = z.array(AreaSchema.passthrough());
type Area = z.infer<typeof AreaSchema>;

const AssignedAreaSchema = z.object({
  serviceAreaKey: z.string(),
  label: z.string(),
  isPrimary: z.boolean(),
  effectiveFrom: z.string(),
});
const AssignedAreaListSchema = z.array(AssignedAreaSchema);

const FleetVehicleSchema = z.object({
  vehicleId: z.string().uuid(),
  registrationNumber: z.string().nullable(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  status: z.string(),
  complianceReady: z.boolean(),
  currentDriverProfileId: z.string().uuid().nullable(),
  currentAssignmentId: z.string().uuid().nullable(),
});
const FleetVehicleListSchema = z.array(FleetVehicleSchema.passthrough());

export function AdminManagedDriverCoverageWorkspace(props: { readonly onNavigate: (href: string) => void }) {
  const { supabase, status, context } = useSessionState();
  const queryClient = useQueryClient();
  const [driverId, setDriverId] = useState("");
  const [areaKey, setAreaKey] = useState("");
  const [primary, setPrimary] = useState("yes");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const isSuperAdmin = context?.platformAdmin?.admin_kind === "super_admin";
  const canManageCoverage = Boolean(isSuperAdmin || context?.permissions.includes("platform.coverage.manage"));

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

  const fleetVehicles = useQuery({
    queryKey: ["platform-fleet-vehicles"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_platform_fleet_vehicle_options");
      if (error) throw error;
      return FleetVehicleListSchema.parse(data ?? []);
    },
  });

  const serviceAreas = useQuery({
    queryKey: ["lpg-internal-service-area-options"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_lpg_internal_service_area_options");
      if (error) throw error;
      return AreaListSchema.parse(data ?? []);
    },
  });

  const managedDrivers = useMemo(() => (drivers.data ?? []).filter((driver) => driver.isManaged), [drivers.data]);
  const selectedDriver = managedDrivers.find((driver) => driver.driverProfileId === driverId) ?? null;
  const assignedFleetVehicle = (fleetVehicles.data ?? []).find((vehicle) => vehicle.currentDriverProfileId === driverId) ?? null;

  useEffect(() => {
    if (driverId && managedDrivers.some((driver) => driver.driverProfileId === driverId)) return;
    setDriverId(managedDrivers[0]?.driverProfileId ?? "");
  }, [driverId, managedDrivers]);

  const assignedAreas = useQuery({
    queryKey: ["lpg-managed-driver-service-areas", driverId],
    enabled: status === "authenticated" && Boolean(driverId),
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_lpg_managed_driver_service_areas", {
        target_driver_profile_id: driverId,
      });
      if (error) throw error;
      return AssignedAreaListSchema.parse(data ?? []);
    },
  });

  const assignedKeys = new Set((assignedAreas.data ?? []).map((area) => area.serviceAreaKey));
  const availableAreas = (serviceAreas.data ?? []).filter((area) => !assignedKeys.has(area.key));

  useEffect(() => {
    if (areaKey && availableAreas.some((area) => area.key === areaKey)) return;
    setAreaKey(availableAreas[0]?.key ?? "");
  }, [areaKey, availableAreas]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["lpg-managed-drivers-admin"] }),
      queryClient.invalidateQueries({ queryKey: ["platform-fleet-vehicles"] }),
      queryClient.invalidateQueries({ queryKey: ["lpg-managed-driver-service-areas"] }),
      queryClient.invalidateQueries({ queryKey: ["lpg-launch-assurance-readiness"] }),
    ]);
  };

  const updateArea = useMutation({
    mutationFn: async ({ area, active, makePrimary }: { area: Area | z.infer<typeof AssignedAreaSchema>; active: boolean; makePrimary: boolean }) => {
      if (!selectedDriver) throw new Error("Choose a SKIMA Managed Driver.");
      const serviceAreaKey = "key" in area ? area.key : area.serviceAreaKey;
      const label = area.label;
      const { data, error } = await supabase.rpc("set_lpg_managed_driver_service_area", {
        target_active: active,
        target_driver_profile_id: selectedDriver.driverProfileId,
        target_idempotency_key: createClientIdempotencyKey("admin.lpg.managed-driver-area", `${selectedDriver.driverProfileId}:${serviceAreaKey}:${active}:${makePrimary}`),
        target_metadata: { surface: "managed_driver_coverage" },
        target_primary: active ? makePrimary : false,
        target_reason: reason.trim() || `${active ? "Added" : "Removed"} ${label} ${active ? "to" : "from"} Managed Driver coverage`,
        target_service_area_key: serviceAreaKey,
      });
      if (error) throw error;
      return { data, label, active };
    },
    onSuccess: async (result) => {
      setNotice(`${result.label} ${result.active ? "added to" : "removed from"} the Driver's LPG coverage.`);
      setReason("");
      await refresh();
    },
  });

  if (drivers.isPending || serviceAreas.isPending || fleetVehicles.isPending) return <LoadingState label="Loading Managed Driver coverage…" />;
  const queryError = drivers.error ?? serviceAreas.error ?? fleetVehicles.error;
  if (queryError) return <ErrorState error={queryError} onRetry={() => void refresh()} />;

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="Operations · Managed Drivers"
        title="Managed Driver Coverage"
        description="Choose where each SKIMA Managed Driver can fulfil LPG orders and verify that a SKIMA-owned fleet vehicle is assigned. Personal Driver vehicles are not used for Managed Fulfillment."
        actions={<Button icon={RefreshCcw} variant="outline" onClick={() => void refresh()}>Refresh</Button>}
      />

      {notice ? <div className="sk-panel"><StatusBadge tone="success">{notice}</StatusBadge></div> : null}

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Managed Drivers" value={managedDrivers.length} icon={UsersRound} />
        <MetricTile label="SKIMA vehicle ready" value={managedDrivers.filter((driver) => driver.vehicleReady).length} icon={Truck} />
        <MetricTile label="Coverage ready" value={managedDrivers.filter((driver) => driver.coverageReady).length} icon={MapPinned} />
        <MetricTile label="Fully ready" value={managedDrivers.filter((driver) => driver.vehicleReady && driver.coverageReady).length} icon={ShieldCheck} tone={managedDrivers.some((driver) => driver.vehicleReady && driver.coverageReady) ? "success" : "warning"} />
      </section>

      <section className="sk-panel stack-md">
        <div className="section-heading"><div><span className="section-kicker">Driver</span><h2>Choose a Managed Driver</h2></div></div>
        <SelectInput
          label="SKIMA Managed Driver"
          value={driverId}
          onChange={(event) => setDriverId(event.currentTarget.value)}
          options={[
            { label: managedDrivers.length ? "Choose a Managed Driver" : "No Managed Drivers yet", value: "" },
            ...managedDrivers.map((driver) => ({ label: driverLabel(driver), value: driver.driverProfileId })),
          ]}
        />

        {selectedDriver ? (
          <div className="skima-grid skima-grid--compact">
            <div className="sk-panel">
              <StatusBadge tone={selectedDriver.vehicleReady ? "success" : "warning"}>{selectedDriver.vehicleReady ? "SKIMA vehicle ready" : "SKIMA vehicle needed"}</StatusBadge>
              <h3>{assignedFleetVehicle?.registrationNumber ?? "No company vehicle assigned"}</h3>
              <span>{assignedFleetVehicle ? `${assignedFleetVehicle.manufacturer ?? "Vehicle"} ${assignedFleetVehicle.model ?? ""}`.trim() : "Assign an existing SKIMA-owned vehicle"}</span>
            </div>
            <div className="sk-panel"><StatusBadge tone={selectedDriver.coverageReady ? "success" : "warning"}>{selectedDriver.coverageReady ? "Coverage ready" : "Coverage setup needed"}</StatusBadge><h3>{selectedDriver.serviceAreaCount} service area{selectedDriver.serviceAreaCount === 1 ? "" : "s"}</h3></div>
            <div className="sk-panel"><StatusBadge tone={selectedDriver.verificationStatus === "approved" ? "success" : "warning"}>{normalizeStatusLabel(selectedDriver.verificationStatus)}</StatusBadge><h3>{normalizeStatusLabel(selectedDriver.operationalStatus)}</h3></div>
          </div>
        ) : null}

        {selectedDriver && !assignedFleetVehicle ? (
          <div className="sk-panel stack-md">
            <strong>No SKIMA vehicle is assigned to this Managed Driver.</strong>
            <p className="skima-muted">Managed Drivers use vehicles owned by SKIMA. Open SKIMA Fleet to register a company vehicle or assign an existing available vehicle to this Driver.</p>
            <Button variant="outline" icon={Truck} onClick={() => props.onNavigate("/partners/fleet")}>Open SKIMA Fleet</Button>
          </div>
        ) : null}

        {selectedDriver && assignedFleetVehicle && !selectedDriver.vehicleReady ? (
          <div className="sk-panel stack-md">
            <strong>The assigned SKIMA vehicle is not service-ready yet.</strong>
            <p className="skima-muted">Complete the vehicle's compliance checks and approval before it can be used for live LPG dispatch.</p>
            <Button variant="outline" icon={Truck} onClick={() => props.onNavigate("/partners/fleet")}>Review assigned vehicle</Button>
          </div>
        ) : null}
      </section>

      {selectedDriver ? (
        <section className="sk-panel stack-md">
          <div className="section-heading"><div><span className="section-kicker">Service areas</span><h2>Where can this Driver fulfil LPG orders?</h2></div></div>
          {assignedAreas.isPending ? <LoadingState label="Loading Driver service areas…" /> : null}
          {assignedAreas.error ? <ErrorState error={assignedAreas.error} onRetry={() => void assignedAreas.refetch()} /> : null}

          {(assignedAreas.data ?? []).length ? (assignedAreas.data ?? []).map((area) => (
            <div className="skima-list-row" key={area.serviceAreaKey}>
              <div><strong>{area.label}</strong><span>{area.isPrimary ? "Primary service area" : "Additional service area"}</span></div>
              <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
                <StatusBadge tone={area.isPrimary ? "success" : "info"}>{area.isPrimary ? "Primary" : "Active"}</StatusBadge>
                {canManageCoverage ? <Button size="sm" variant="outline" disabled={updateArea.isPending} onClick={() => updateArea.mutate({ area, active: false, makePrimary: false })}>Remove</Button> : null}
              </div>
            </div>
          )) : !assignedAreas.isPending ? <p className="skima-muted">This Driver does not have an LPG service area yet.</p> : null}

          <div className="skima-form-grid">
            <SelectInput
              label="Add service area"
              value={areaKey}
              onChange={(event) => setAreaKey(event.currentTarget.value)}
              options={[
                { label: availableAreas.length ? "Choose an area" : "All available areas are already assigned", value: "" },
                ...availableAreas.map((area) => ({ label: areaLabel(area), value: area.key })),
              ]}
            />
            <SelectInput
              label="Area priority"
              value={primary}
              onChange={(event) => setPrimary(event.currentTarget.value)}
              options={[
                { label: "Primary service area", value: "yes" },
                { label: "Additional service area", value: "no" },
              ]}
            />
          </div>
          <TextAreaInput label="Admin note (optional)" value={reason} onChange={(event) => setReason(event.currentTarget.value)} placeholder="Example: Awka launch coverage" />
          <Button
            disabled={!canManageCoverage || updateArea.isPending || !areaKey}
            onClick={() => {
              const area = availableAreas.find((item) => item.key === areaKey);
              if (area) updateArea.mutate({ area, active: true, makePrimary: primary === "yes" });
            }}
          >
            {updateArea.isPending ? "Saving…" : "Add service area"}
          </Button>
          {updateArea.error ? <ErrorState error={updateArea.error} /> : null}
          {!canManageCoverage ? <p className="skima-muted">You can review coverage, but only an administrator with coverage-management access can change it.</p> : null}
        </section>
      ) : null}
    </div>
  );
}

function driverLabel(driver: Driver) {
  return driver.publicDriverId ? `${driver.displayName} · ${driver.publicDriverId}` : driver.displayName;
}

function areaLabel(area: Area) {
  const context = [area.lgaName, area.stateName].filter(Boolean).join(", ");
  return context ? `${area.label} · ${context}` : area.label;
}
