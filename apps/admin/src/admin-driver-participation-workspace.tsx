import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, RefreshCcw, ShieldCheck, Star, Truck, UsersRound, WalletCards } from "lucide-react";
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

const DriverSchema = z.object({
  driverProfileId: z.string().uuid(),
  userId: z.string().uuid(),
  displayName: z.string(),
  publicDriverId: z.string().nullable(),
  verificationStatus: z.string(),
  operationalStatus: z.string(),
  isManaged: z.boolean(),
  driverTypeLabel: z.string(),
  managedSince: z.string().nullable(),
  activeVehicleCount: z.coerce.number().int().nonnegative(),
  serviceAreaCount: z.coerce.number().int().nonnegative(),
  vehicleReady: z.boolean(),
  coverageReady: z.boolean(),
  pendingEarnings: z.coerce.number(),
  availableForPayout: z.coerce.number(),
  paidToWallet: z.coerce.number(),
  lifetimeEarnings: z.coerce.number(),
  driverWalletId: z.string().uuid().nullable(),
  driverWalletBalance: z.coerce.number(),
  currencyCode: z.string(),
  lastPaidAt: z.string().nullable(),
});

const DriverListSchema = z.array(DriverSchema);
type Driver = z.infer<typeof DriverSchema>;

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
  const [assignmentTarget, setAssignmentTarget] = useState<Driver | null>(null);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const canManageDrivers = context?.platformAdmin?.admin_kind === "super_admin" ||
    context?.permissions.includes("platform.drivers.manage") ||
    false;
  const canManageDispatch = context?.platformAdmin?.admin_kind === "super_admin" ||
    context?.permissions.includes("platform.dispatch.manage") ||
    false;

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

  const assignDriverType = useMutation({
    mutationFn: async ({ driver, managed, reason }: { driver: Driver; managed: boolean; reason: string }) => {
      const { data, error } = await supabase.rpc("set_lpg_managed_driver_assignment", {
        target_driver_profile_id: driver.driverProfileId,
        target_managed: managed,
        target_reason: reason.trim(),
        target_idempotency_key: createClientIdempotencyKey(
          "admin.driver.type",
          `${driver.driverProfileId}:${managed}`,
        ),
        target_metadata: { surface: "admin_driver_management" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (_data, variables) => {
      setAssignmentTarget(null);
      setNotice(`${variables.driver.displayName} is now ${variables.managed ? "a SKIMA Managed Driver" : "an Independent Driver"}.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["lpg-managed-drivers-admin"] }),
        queryClient.invalidateQueries({ queryKey: ["lpg-launch-assurance-readiness"] }),
      ]);
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
        target_metadata: { surface: "admin_driver_management" },
      });
      if (error) throw error;
      return PriorityPolicySchema.parse(data);
    },
    onSuccess: async () => {
      setPriorityOpen(false);
      setNotice("Managed Driver dispatch preference updated.");
      await queryClient.invalidateQueries({ queryKey: ["driver-priority-policy"] });
    },
  });

  const rows = drivers.data ?? [];
  const managedCount = rows.filter((driver) => driver.isManaged).length;
  const independentCount = rows.filter((driver) => !driver.isManaged).length;
  const approvedCount = rows.filter((driver) => driver.verificationStatus === "approved").length;

  const columns = useMemo<TableColumn<Driver>[]>(() => [
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
      key: "type",
      header: "Driver type",
      render: (driver) => (
        <StatusBadge tone={driver.isManaged ? "warning" : "neutral"}>
          {driver.isManaged ? "SKIMA Managed Driver" : "Independent Driver"}
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
      key: "readiness",
      header: "Fulfillment readiness",
      render: (driver) => (
        <span>
          {driver.isManaged ? (
            <>
              {driver.vehicleReady ? "Vehicle ready" : "Vehicle setup needed"}<br />
              <small>{driver.coverageReady ? "Coverage ready" : "Coverage approval needed"}</small>
            </>
          ) : (
            <>{normalizeStatusLabel(driver.operationalStatus)}<br /><small>{driver.activeVehicleCount} active vehicle{driver.activeVehicleCount === 1 ? "" : "s"}</small></>
          )}
        </span>
      ),
    },
    {
      key: "earnings",
      header: "Managed earnings",
      render: (driver) => driver.isManaged
        ? <span><strong>{money(driver.availableForPayout, driver.currencyCode)}</strong><br /><small>available for payout</small></span>
        : <span className="skima-muted">Not applicable</span>,
    },
    {
      key: "action",
      header: "Action",
      render: (driver) => canManageDrivers
        ? <Button size="sm" variant="outline" onClick={() => setAssignmentTarget(driver)}>Manage Driver</Button>
        : <span className="skima-muted">View only</span>,
    },
  ], [canManageDrivers]);

  return (
    <>
      <PageHeader
        eyebrow="Driver network"
        title="Driver Management"
        description="Manage normal Independent Drivers and the Drivers SKIMA directly uses for its own fulfillment. Technical participation codes are handled automatically."
        actions={(
          <>
            {canManageDispatch ? <Button icon={Gauge} variant="outline" onClick={() => setPriorityOpen(true)}>Dispatch preference</Button> : null}
            <Button icon={RefreshCcw} variant="outline" onClick={() => void Promise.all([drivers.refetch(), priorityPolicy.refetch()])}>Refresh</Button>
          </>
        )}
      />

      {notice ? <StatusBadge tone="success" className="skima-status-note">{notice}</StatusBadge> : null}

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Approved Drivers" value={approvedCount} icon={ShieldCheck} tone="success" />
        <MetricTile label="Independent Drivers" value={independentCount} icon={UsersRound} tone="info" />
        <MetricTile label="SKIMA Managed Drivers" value={managedCount} icon={Star} tone={managedCount ? "warning" : "neutral"} />
        <MetricTile label="Managed Wallet Value" value={money(rows.filter((driver) => driver.isManaged).reduce((sum, driver) => sum + driver.driverWalletBalance, 0), "NGN")} icon={WalletCards} tone="info" />
      </section>

      <section className="sk-panel">
        <div className="sk-panel__header">
          <div>
            <h2>Dispatch fairness</h2>
            <p className="skima-muted">
              SKIMA Managed Drivers can receive a bounded dispatch preference when that policy is enabled. Distance, workload, vehicle capacity, route bundling and eligibility still affect assignment.
            </p>
          </div>
          {priorityPolicy.data ? (
            <StatusBadge tone={priorityPolicy.data.specialDriverPriorityEnabled ? "success" : "neutral"}>
              {priorityPolicy.data.specialDriverPriorityEnabled
                ? `${priorityPolicy.data.specialDriverPriorityBonusKilometers.toFixed(2)} km bounded advantage`
                : "Managed Driver preference disabled"}
            </StatusBadge>
          ) : null}
        </div>
        {priorityPolicy.isLoading ? <LoadingState label="Loading dispatch preference" /> : null}
        {priorityPolicy.error ? <ErrorState title="Dispatch preference unavailable" message={readError(priorityPolicy.error)} onRetry={() => void priorityPolicy.refetch()} /> : null}
      </section>

      <section className="sk-panel">
        <div className="sk-panel__header">
          <div>
            <h2>Drivers</h2>
            <p className="skima-muted">Change a Driver between Independent and SKIMA Managed without creating another Driver account.</p>
          </div>
        </div>
        {drivers.isLoading ? <LoadingState label="Loading Drivers" /> : null}
        {drivers.error ? <ErrorState title="Drivers unavailable" message={readError(drivers.error)} onRetry={() => void drivers.refetch()} /> : null}
        {!drivers.isLoading && !drivers.error ? (
          <DataTable
            caption="SKIMA Driver management"
            columns={columns}
            records={rows}
            getRowKey={(driver) => driver.driverProfileId}
            emptyTitle="No Drivers yet"
            emptyMessage="Driver profiles will appear here after onboarding."
          />
        ) : null}
      </section>

      <DriverTypeDialog
        driver={assignmentTarget}
        isSubmitting={assignDriverType.isPending}
        error={assignDriverType.error}
        onClose={() => {
          if (assignDriverType.isPending) return;
          assignDriverType.reset();
          setAssignmentTarget(null);
        }}
        onSubmit={(managed, reason) => {
          if (!assignmentTarget) return;
          assignDriverType.mutate({ driver: assignmentTarget, managed, reason });
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

function DriverTypeDialog({
  driver,
  isSubmitting,
  error,
  onClose,
  onSubmit,
}: {
  driver: Driver | null;
  isSubmitting: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (managed: boolean, reason: string) => void;
}) {
  const [driverType, setDriverType] = useState<"independent" | "managed">(driver?.isManaged ? "managed" : "independent");
  const [reason, setReason] = useState("");

  if (!driver) return null;

  const managed = driverType === "managed";
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(managed, reason.trim() || (managed ? "Added to SKIMA Managed Drivers" : "Returned to Independent Driver"));
  };

  return (
    <Dialog
      title={`Manage Driver • ${driver.displayName}`}
      isOpen
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" disabled={isSubmitting} onClick={onClose}>Cancel</Button>
          <Button type="submit" form="driver-type-form" isLoading={isSubmitting}>Save Driver type</Button>
        </>
      )}
    >
      <form id="driver-type-form" className="skima-form-grid" onSubmit={submit}>
        <p className="admin-dialog-guidance">Current type: {driver.isManaged ? "SKIMA Managed Driver" : "Independent Driver"}.</p>
        <SelectInput
          label="Driver type"
          value={driverType}
          options={[
            { label: "Independent Driver", value: "independent" },
            { label: "SKIMA Managed Driver", value: "managed" },
          ]}
          onChange={(event) => setDriverType(event.currentTarget.value as typeof driverType)}
        />
        <TextAreaInput
          label="Admin note (optional)"
          helperText="The change is retained in Driver history for audit."
          value={reason}
          onChange={(event) => setReason(event.currentTarget.value)}
        />
        {managed && driver.verificationStatus !== "approved" ? (
          <StatusBadge tone="danger">This Driver must be approved before they can become a SKIMA Managed Driver.</StatusBadge>
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
  const [enabledValue, setEnabledValue] = useState(policy?.specialDriverPriorityEnabled === false ? "disabled" : "enabled");
  const [bonusValue, setBonusValue] = useState(String(policy?.specialDriverPriorityBonusKilometers ?? 1));
  const [reason, setReason] = useState("");

  if (!isOpen) return null;

  const currentEnabled = policy?.specialDriverPriorityEnabled ?? true;
  const currentBonus = policy?.specialDriverPriorityBonusKilometers ?? 1;
  const resolvedEnabled = enabledValue === "enabled";
  const resolvedBonus = Number(bonusValue);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(resolvedEnabled, resolvedBonus, reason.trim() || "Updated Managed Driver dispatch preference");
  };

  return (
    <Dialog
      title="Managed Driver dispatch preference"
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
          Current rule: {currentEnabled ? `${currentBonus.toFixed(2)} km bounded advantage` : "disabled"}. This helps SKIMA Managed Drivers rank when appropriate; it does not guarantee assignment.
        </p>
        <SelectInput
          label="Managed Driver preference"
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
          label="Admin note (optional)"
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

function shortId(value: string) {
  return `Driver ${value.slice(0, 8).toUpperCase()}`;
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function readError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string") return String((error as Record<string, unknown>).message);
  return "The Driver action could not be completed. Please try again.";
}
