import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, RefreshCcw, ShieldCheck, Star, Truck, UsersRound } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { z } from "zod";

import { createClientIdempotencyKey, normalizeStatusLabel } from "@skima/frontend-core";
import {
  Button,
  DataTable,
  Dialog,
  ErrorState,
  LoadingState,
  MetricTile,
  PageHeader,
  SelectInput,
  StatusBadge,
  TextAreaInput,
  TextInput,
  type TableColumn,
} from "@skima/ui";

import { useSessionState } from "./session";

const DriverParticipationSchema = z.object({
  driverProfileId: z.string().uuid(),
  userId: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  displayName: z.string(),
  publicDriverId: z.string().nullable(),
  verificationStatus: z.string(),
  operationalStatus: z.string(),
  approvedAt: z.string().nullable(),
  programKey: z.enum(["driver.independent", "driver.skima_special"]),
  programLabel: z.string(),
  programPublicLabel: z.string(),
  programType: z.enum(["baseline", "priority"]),
  membershipId: z.string().uuid().nullable(),
  programStartsAt: z.string().nullable(),
  activeVehicleCount: z.coerce.number().int().nonnegative(),
  vehicleRelationshipTypes: z.array(z.string()),
  serviceAreaCount: z.coerce.number().int().nonnegative(),
});

const DriverParticipationListSchema = z.array(DriverParticipationSchema);
type DriverParticipation = z.infer<typeof DriverParticipationSchema>;

const PriorityPolicySchema = z.object({
  specialDriverPriorityEnabled: z.boolean(),
  specialDriverPriorityBonusMeters: z.coerce.number().nonnegative(),
  specialDriverPriorityBonusKilometers: z.coerce.number().nonnegative(),
  fairnessModel: z.string(),
  updatedAt: z.string(),
});

type PriorityPolicy = z.infer<typeof PriorityPolicySchema>;

export function AdminDriverParticipationWorkspace() {
  const { supabase, status, context } = useSessionState();
  const queryClient = useQueryClient();
  const [assignmentTarget, setAssignmentTarget] = useState<DriverParticipation | null>(null);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const canManageDrivers = context?.platformAdmin?.admin_kind === "super_admin" ||
    context?.permissions.includes("platform.drivers.manage") ||
    false;
  const canManageDispatch = context?.platformAdmin?.admin_kind === "super_admin" ||
    context?.permissions.includes("platform.dispatch.manage") ||
    false;

  const drivers = useQuery({
    queryKey: ["driver-participation-admin"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_driver_participation_admin", {
        target_driver_profile_id: null,
      });
      if (error) throw error;
      return DriverParticipationListSchema.parse(data ?? []);
    },
  });

  const priorityPolicy = useQuery({
    queryKey: ["driver-priority-policy"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_lpg_driver_priority_policy");
      if (error) throw error;
      return PriorityPolicySchema.parse(data);
    },
  });

  const assignProgram = useMutation({
    mutationFn: async ({
      driver,
      programKey,
      reason,
    }: {
      driver: DriverParticipation;
      programKey: "driver.independent" | "driver.skima_special";
      reason: string;
    }) => {
      const { data, error } = await supabase.rpc("set_driver_participation_program", {
        target_driver_profile_id: driver.driverProfileId,
        target_program_key: programKey,
        target_reason: reason.trim(),
        target_idempotency_key: createClientIdempotencyKey(
          "admin.driver.participation",
          `${driver.driverProfileId}:${programKey}`,
        ),
        target_metadata: { surface: "admin_driver_participation_workspace" },
        target_source: "skima.admin.driver_participation",
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (_data, variables) => {
      setAssignmentTarget(null);
      setNotice(`${variables.driver.displayName} is now ${programLabel(variables.programKey)}.`);
      await queryClient.invalidateQueries({ queryKey: ["driver-participation-admin"] });
    },
  });

  const updatePriority = useMutation({
    mutationFn: async ({ enabled, bonusKilometers, reason }: {
      enabled: boolean;
      bonusKilometers: number;
      reason: string;
    }) => {
      const { data, error } = await supabase.rpc("set_lpg_driver_priority_policy", {
        target_enabled: enabled,
        target_bonus_meters: Math.round(bonusKilometers * 1000),
        target_reason: reason.trim(),
        target_idempotency_key: createClientIdempotencyKey(
          "admin.driver.priority",
          `${enabled}:${bonusKilometers}`,
        ),
        target_metadata: { surface: "admin_driver_participation_workspace" },
      });
      if (error) throw error;
      return PriorityPolicySchema.parse(data);
    },
    onSuccess: async () => {
      setPriorityOpen(false);
      setNotice("Special Driver dispatch preference updated.");
      await queryClient.invalidateQueries({ queryKey: ["driver-priority-policy"] });
    },
  });

  const rows = drivers.data ?? [];
  const specialCount = rows.filter((driver) => driver.programKey === "driver.skima_special").length;
  const independentCount = rows.filter((driver) => driver.programKey === "driver.independent").length;
  const approvedCount = rows.filter((driver) => driver.verificationStatus === "approved").length;

  const columns = useMemo<TableColumn<DriverParticipation>[]>(() => [
    {
      key: "driver",
      header: "Driver",
      render: (driver) => (
        <span>
          <strong>{driver.displayName}</strong><br />
          <small>{driver.publicDriverId ?? shortId(driver.driverProfileId)}</small>
        </span>
      ),
    },
    {
      key: "participation",
      header: "Participation",
      render: (driver) => (
        <StatusBadge tone={driver.programKey === "driver.skima_special" ? "warning" : "neutral"}>
          {driver.programPublicLabel}
        </StatusBadge>
      ),
    },
    {
      key: "approval",
      header: "Approval",
      render: (driver) => (
        <StatusBadge tone={driver.verificationStatus === "approved" ? "success" : "warning"}>
          {normalizeStatusLabel(driver.verificationStatus)}
        </StatusBadge>
      ),
    },
    {
      key: "operations",
      header: "Operations",
      render: (driver) => (
        <span>
          {normalizeStatusLabel(driver.operationalStatus)}<br />
          <small>{driver.activeVehicleCount} active vehicle{driver.activeVehicleCount === 1 ? "" : "s"} • {driver.serviceAreaCount} service area{driver.serviceAreaCount === 1 ? "" : "s"}</small>
        </span>
      ),
    },
    {
      key: "vehicleRelationship",
      header: "Vehicle relationship",
      render: (driver) => driver.vehicleRelationshipTypes.length
        ? driver.vehicleRelationshipTypes.map(normalizeStatusLabel).join(", ")
        : "No active vehicle",
    },
    {
      key: "action",
      header: "Action",
      render: (driver) => canManageDrivers
        ? <Button size="sm" variant="outline" onClick={() => setAssignmentTarget(driver)}>Change class</Button>
        : <span className="skima-muted">View only</span>,
    },
  ], [canManageDrivers]);

  return (
    <>
      <PageHeader
        eyebrow="Driver network"
        title="Driver Participation"
        description="Manage Independent Driver Partners and admin-assigned SKIMA Special Drivers. Participation class is separate from who owns the vehicle."
        actions={(
          <>
            {canManageDispatch ? <Button icon={Gauge} variant="outline" onClick={() => setPriorityOpen(true)}>Dispatch priority</Button> : null}
            <Button icon={RefreshCcw} variant="outline" onClick={() => void Promise.all([drivers.refetch(), priorityPolicy.refetch()])}>Refresh</Button>
          </>
        )}
      />

      {notice ? <StatusBadge tone="success" className="skima-status-note">{notice}</StatusBadge> : null}

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Approved drivers" value={approvedCount} icon={ShieldCheck} tone="success" />
        <MetricTile label="Independent" value={independentCount} icon={UsersRound} tone="info" />
        <MetricTile label="SKIMA Special" value={specialCount} icon={Star} tone={specialCount ? "warning" : "neutral"} />
        <MetricTile label="Active vehicles" value={rows.reduce((sum, driver) => sum + driver.activeVehicleCount, 0)} icon={Truck} tone="info" />
      </section>

      <section className="sk-panel">
        <div className="sk-panel__header">
          <div>
            <h2>Dispatch fairness</h2>
            <p className="skima-muted">
              SKIMA Special status gives a bounded preference only. Distance, active workload, vehicle capacity, route bundling and eligibility still affect assignment.
            </p>
          </div>
          {priorityPolicy.data ? (
            <StatusBadge tone={priorityPolicy.data.specialDriverPriorityEnabled ? "success" : "neutral"}>
              {priorityPolicy.data.specialDriverPriorityEnabled
                ? `${priorityPolicy.data.specialDriverPriorityBonusKilometers.toFixed(2)} km bounded advantage`
                : "Special priority disabled"}
            </StatusBadge>
          ) : null}
        </div>
        {priorityPolicy.isLoading ? <LoadingState label="Loading dispatch preference" /> : null}
        {priorityPolicy.error ? <ErrorState title="Dispatch preference unavailable" message={readError(priorityPolicy.error)} onRetry={() => void priorityPolicy.refetch()} /> : null}
      </section>

      <section className="sk-panel">
        <div className="sk-panel__header">
          <div>
            <h2>Driver network</h2>
            <p className="skima-muted">
              Fleet-assigned, leased, rented and third-party-authorized vehicles remain vehicle relationships; they do not create another driver identity.
            </p>
          </div>
        </div>
        {drivers.isLoading ? <LoadingState label="Loading drivers" /> : null}
        {drivers.error ? <ErrorState title="Drivers unavailable" message={readError(drivers.error)} onRetry={() => void drivers.refetch()} /> : null}
        {!drivers.isLoading && !drivers.error ? (
          <DataTable
            caption="SKIMA driver participation"
            columns={columns}
            records={rows}
            getRowKey={(driver) => driver.driverProfileId}
            emptyTitle="No drivers yet"
            emptyMessage="Approved driver profiles will appear here after onboarding."
          />
        ) : null}
      </section>

      <AssignmentDialog
        driver={assignmentTarget}
        isSubmitting={assignProgram.isPending}
        error={assignProgram.error}
        onClose={() => {
          if (assignProgram.isPending) return;
          assignProgram.reset();
          setAssignmentTarget(null);
        }}
        onSubmit={(programKey, reason) => {
          if (!assignmentTarget) return;
          assignProgram.mutate({ driver: assignmentTarget, programKey, reason });
        }}
      />

      <PriorityDialog
        policy={priorityPolicy.data ?? null}
        isOpen={priorityOpen}
        isSubmitting={updatePriority.isPending}
        error={updatePriority.error}
        onClose={() => {
          if (updatePriority.isPending) return;
          updatePriority.reset();
          setPriorityOpen(false);
        }}
        onSubmit={(enabled, bonusKilometers, reason) => updatePriority.mutate({ enabled, bonusKilometers, reason })}
      />
    </>
  );
}

function AssignmentDialog({
  driver,
  isSubmitting,
  error,
  onClose,
  onSubmit,
}: {
  driver: DriverParticipation | null;
  isSubmitting: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (programKey: "driver.independent" | "driver.skima_special", reason: string) => void;
}) {
  const [programKey, setProgramKey] = useState<"driver.independent" | "driver.skima_special">("driver.independent");
  const [reason, setReason] = useState("");

  if (!driver) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(programKey, reason);
  };

  return (
    <Dialog
      title={`Driver class • ${driver.displayName}`}
      isOpen
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" disabled={isSubmitting} onClick={onClose}>Cancel</Button>
          <Button type="submit" form="driver-class-form" isLoading={isSubmitting}>Save class</Button>
        </>
      )}
    >
      <form id="driver-class-form" className="skima-form-grid" onSubmit={submit}>
        <p className="admin-dialog-guidance">Current class: {driver.programPublicLabel}. SKIMA Special is only available to approved drivers.</p>
        <SelectInput
          label="Participation class"
          value={programKey}
          options={[
            { label: "Independent Driver Partner", value: "driver.independent" },
            { label: "SKIMA Special Driver", value: "driver.skima_special" },
          ]}
          onChange={(event) => setProgramKey(event.currentTarget.value as typeof programKey)}
        />
        <TextAreaInput
          label="Reason for change"
          helperText="This reason is retained in the driver participation history."
          required
          value={reason}
          onChange={(event) => setReason(event.currentTarget.value)}
        />
        {programKey === "driver.skima_special" && driver.verificationStatus !== "approved" ? (
          <StatusBadge tone="danger">This driver must be approved before Special status can be assigned.</StatusBadge>
        ) : null}
        {error ? <StatusBadge tone="danger">{readError(error)}</StatusBadge> : null}
      </form>
    </Dialog>
  );
}

function PriorityDialog({
  policy,
  isOpen,
  isSubmitting,
  error,
  onClose,
  onSubmit,
}: {
  policy: PriorityPolicy | null;
  isOpen: boolean;
  isSubmitting: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (enabled: boolean, bonusKilometers: number, reason: string) => void;
}) {
  const [enabledValue, setEnabledValue] = useState("enabled");
  const [bonusValue, setBonusValue] = useState("1");
  const [reason, setReason] = useState("");

  if (!isOpen) return null;

  const currentEnabled = policy?.specialDriverPriorityEnabled ?? true;
  const currentBonus = policy?.specialDriverPriorityBonusKilometers ?? 1;
  const resolvedEnabled = enabledValue === "enabled";
  const resolvedBonus = Number(bonusValue);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(resolvedEnabled, resolvedBonus, reason);
  };

  return (
    <Dialog
      title="Special Driver dispatch preference"
      isOpen
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" disabled={isSubmitting} onClick={onClose}>Cancel</Button>
          <Button type="submit" form="driver-priority-form" isLoading={isSubmitting}>Save dispatch rule</Button>
        </>
      )}
    >
      <form id="driver-priority-form" className="skima-form-grid" onSubmit={submit}>
        <p className="admin-dialog-guidance">
          Current rule: {currentEnabled ? `${currentBonus.toFixed(2)} km bounded advantage` : "disabled"}. This is a ranking adjustment, not guaranteed assignment.
        </p>
        <SelectInput
          label="Special Driver preference"
          value={enabledValue}
          options={[
            { label: "Enabled", value: "enabled" },
            { label: "Disabled", value: "disabled" },
          ]}
          onChange={(event) => setEnabledValue(event.currentTarget.value)}
        />
        <TextInput
          label="Maximum ranking advantage (km)"
          helperText="0 to 5 km. A closer or less-loaded Independent Driver can still rank first."
          type="number"
          min="0"
          max="5"
          step="0.1"
          value={bonusValue}
          onChange={(event) => setBonusValue(event.currentTarget.value)}
          required
        />
        <TextAreaInput
          label="Reason for policy change"
          required
          value={reason}
          onChange={(event) => setReason(event.currentTarget.value)}
        />
        {(!Number.isFinite(resolvedBonus) || resolvedBonus < 0 || resolvedBonus > 5) ? (
          <StatusBadge tone="danger">The ranking advantage must be between 0 and 5 km.</StatusBadge>
        ) : null}
        {error ? <StatusBadge tone="danger">{readError(error)}</StatusBadge> : null}
      </form>
    </Dialog>
  );
}

function programLabel(programKey: "driver.independent" | "driver.skima_special") {
  return programKey === "driver.skima_special" ? "SKIMA Special Driver" : "Independent Driver Partner";
}

function shortId(value: string) {
  return `Driver ${value.slice(0, 8).toUpperCase()}`;
}

function readError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string") return String((error as Record<string, unknown>).message);
  return "The driver participation action could not be completed. Please try again.";
}
