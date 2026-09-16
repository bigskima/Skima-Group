import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleOff, Coins, MapPinned, RefreshCcw, ShieldCheck, Truck } from "lucide-react";
import { useEffect, useState } from "react";
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
  TextInput,
} from "@skima/ui";

import { useSessionState } from "./session";

const LaunchConfigSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(["marketplace_only", "internal_only", "hybrid"]),
  priority: z.enum(["marketplace_first", "internal_first"]),
  marketplaceFirstFallbackOnly: z.boolean(),
  internalDriverProgramKey: z.string(),
  digitalStationLabel: z.string(),
  requireSupplierReceipt: z.boolean(),
  driverCompensation: z.record(z.unknown()).optional(),
  updatedAt: z.string().nullable().optional(),
});

const ReadinessSchema = z.object({
  ready: z.boolean(),
  enabled: z.boolean(),
  mode: z.string(),
  priority: z.string(),
  programKey: z.string(),
  driverCompensationPercent: z.coerce.number().nullable(),
  internalReferencePriceScopeCount: z.coerce.number().int().nonnegative(),
  managedApprovedDriverCount: z.coerce.number().int().nonnegative(),
  vehicleReadyDriverCount: z.coerce.number().int().nonnegative(),
  coverageReadyDriverCount: z.coerce.number().int().nonnegative(),
  reasons: z.array(z.string()),
});

const FinancialsSchema = z.object({
  procurements: z.array(z.record(z.unknown())),
  earnings: z.array(z.record(z.unknown())),
});

export function AdminLaunchAssuranceWorkspace() {
  const { supabase, status, context } = useSessionState();
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<"marketplace_only" | "internal_only" | "hybrid">("hybrid");
  const [priority, setPriority] = useState<"marketplace_first" | "internal_first">("marketplace_first");
  const [fallbackOnly, setFallbackOnly] = useState(true);
  const [configurationReason, setConfigurationReason] = useState("");
  const [compensationPercent, setCompensationPercent] = useState("");
  const [compensationReason, setCompensationReason] = useState("");
  const [areaKey, setAreaKey] = useState("");
  const [pricePerKg, setPricePerKg] = useState("");
  const [estimatedRouteKm, setEstimatedRouteKm] = useState("");
  const [maxVariancePercent, setMaxVariancePercent] = useState("10");
  const [priceReason, setPriceReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const isSuperAdmin = context?.platformAdmin?.admin_kind === "super_admin";
  const canManageDispatch = Boolean(isSuperAdmin || context?.permissions.includes("platform.dispatch.manage"));
  const canManagePricing = Boolean(
    isSuperAdmin ||
    context?.permissions.includes("platform.financial_policy.activate") ||
    context?.permissions.includes("platform.financial_policy.manage"),
  );

  const configuration = useQuery({
    queryKey: ["lpg-launch-assurance-configuration"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_lpg_launch_assurance_configuration");
      if (error) throw error;
      return LaunchConfigSchema.parse(data);
    },
  });

  const readiness = useQuery({
    queryKey: ["lpg-launch-assurance-readiness"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_lpg_internal_launch_readiness");
      if (error) throw error;
      return ReadinessSchema.parse(data);
    },
  });

  const financials = useQuery({
    queryKey: ["lpg-launch-assurance-financials"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_lpg_internal_operations_financials", {
        target_driver_profile_id: null,
        target_limit: 25,
      });
      if (error) throw error;
      return FinancialsSchema.parse(data);
    },
  });

  useEffect(() => {
    if (!configuration.data) return;
    setEnabled(configuration.data.enabled);
    setMode(configuration.data.mode);
    setPriority(configuration.data.priority);
    setFallbackOnly(configuration.data.marketplaceFirstFallbackOnly);
    const percent = nestedNumber(configuration.data.driverCompensation, ["configuration", "percentage"]);
    if (percent !== null) setCompensationPercent(String(percent));
  }, [configuration.data]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["lpg-launch-assurance-configuration"] }),
      queryClient.invalidateQueries({ queryKey: ["lpg-launch-assurance-readiness"] }),
      queryClient.invalidateQueries({ queryKey: ["lpg-launch-assurance-financials"] }),
    ]);
  };

  const updateConfiguration = useMutation({
    mutationFn: async () => {
      if (!configurationReason.trim()) throw new Error("Enter a reason for this launch-mode change.");
      const { data, error } = await supabase.rpc("set_lpg_launch_assurance_configuration", {
        target_enabled: enabled,
        target_idempotency_key: createClientIdempotencyKey("admin.lpg.launch-assurance", `${enabled}:${mode}:${priority}:${fallbackOnly}`),
        target_marketplace_first_fallback_only: fallbackOnly,
        target_mode: mode,
        target_priority: priority,
        target_reason: configurationReason.trim(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      setNotice("Launch Assurance configuration updated.");
      setConfigurationReason("");
      await refresh();
    },
  });

  const updateCompensation = useMutation({
    mutationFn: async () => {
      const percentage = Number(compensationPercent);
      if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) throw new Error("Enter a driver percentage greater than 0 and no more than 100.");
      if (!compensationReason.trim()) throw new Error("Enter a reason for the compensation change.");
      const { data, error } = await supabase.rpc("set_lpg_internal_driver_compensation", {
        target_idempotency_key: createClientIdempotencyKey("admin.lpg.internal-driver-compensation", String(percentage)),
        target_percentage: percentage,
        target_reason: compensationReason.trim(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      setNotice("Internal Driver compensation updated immediately for new quotes.");
      setCompensationReason("");
      await refresh();
    },
  });

  const updateReferencePrice = useMutation({
    mutationFn: async () => {
      const price = Number(pricePerKg);
      const routeKm = Number(estimatedRouteKm);
      const variance = Number(maxVariancePercent);
      if (!areaKey.trim()) throw new Error("Enter the service-area key used by SKIMA geography.");
      if (!Number.isFinite(price) || price <= 0) throw new Error("Enter a valid LPG reference price per kg.");
      if (!Number.isFinite(routeKm) || routeKm < 0) throw new Error("Enter a valid estimated route distance.");
      if (!Number.isFinite(variance) || variance < 0 || variance > 100) throw new Error("Supplier variance must be between 0 and 100 percent.");
      if (!priceReason.trim()) throw new Error("Enter a reason for the price change.");
      const { data, error } = await supabase.rpc("set_lpg_internal_reference_price", {
        target_estimated_route_km: routeKm,
        target_geography_key: areaKey.trim(),
        target_geography_type: "service_area",
        target_idempotency_key: createClientIdempotencyKey("admin.lpg.internal-reference-price", `${areaKey}:${price}:${routeKm}:${variance}`),
        target_max_supplier_variance_percent: variance,
        target_price_per_kg: price,
        target_reason: priceReason.trim(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      setNotice("Internal LPG reference price updated for the selected service area.");
      setPriceReason("");
      await refresh();
    },
  });

  if (configuration.isPending || readiness.isPending) return <LoadingState label="Loading Launch Assurance controls…" />;
  if (configuration.error || readiness.error) return <ErrorState error={configuration.error ?? readiness.error} onRetry={() => void refresh()} />;

  const ready = readiness.data;
  const recentProcurements = financials.data?.procurements ?? [];
  const recentEarnings = financials.data?.earnings ?? [];

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="LPG · Launch operations"
        title="Launch Assurance"
        description="Keep marketplace Stations first while giving SKIMA a guarded internal fulfillment fallback. Internal fulfillment cannot be enabled until pricing, Driver, vehicle and coverage readiness all pass."
        actions={<Button icon={RefreshCcw} variant="outline" onClick={() => void refresh()}>Refresh</Button>}
      />

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Readiness" value={ready?.ready ? "Ready" : "Not ready"} icon={ready?.ready ? CircleCheck : CircleOff} tone={ready?.ready ? "success" : "warning"} />
        <MetricTile label="Managed Drivers" value={ready?.managedApprovedDriverCount ?? 0} icon={Truck} />
        <MetricTile label="Vehicle ready" value={ready?.vehicleReadyDriverCount ?? 0} icon={ShieldCheck} />
        <MetricTile label="Area prices" value={ready?.internalReferencePriceScopeCount ?? 0} icon={MapPinned} />
      </section>

      {!ready?.ready ? (
        <section className="sk-panel stack-md">
          <div className="section-heading"><div><span className="section-kicker">Activation guard</span><h2>Complete these before enabling internal fulfillment</h2></div></div>
          <ul className="skima-muted">{ready?.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          <p className="skima-muted">Driver class assignment remains in Partners → Drivers. Assign approved Drivers to <strong>{ready?.programKey ?? "driver.skima_special"}</strong>, then make sure they have an active LPG-eligible vehicle and approved coverage.</p>
        </section>
      ) : null}

      {notice ? <div className="sk-panel"><StatusBadge tone="success">{notice}</StatusBadge></div> : null}

      <section className="sk-panel stack-md">
        <div className="section-heading"><div><span className="section-kicker">Fulfillment policy</span><h2>Marketplace vs SKIMA fulfillment</h2></div></div>
        <div className="skima-form-grid">
          <SelectInput label="Mode" value={mode} onChange={(event) => setMode(event.currentTarget.value as typeof mode)} options={[
            { label: "Hybrid", value: "hybrid" },
            { label: "Marketplace only", value: "marketplace_only" },
            { label: "SKIMA internal only", value: "internal_only" },
          ]} />
          <SelectInput label="Priority" value={priority} onChange={(event) => setPriority(event.currentTarget.value as typeof priority)} options={[
            { label: "Marketplace first", value: "marketplace_first" },
            { label: "SKIMA internal first", value: "internal_first" },
          ]} />
          <SelectInput label="Internal channel" value={enabled ? "enabled" : "disabled"} onChange={(event) => setEnabled(event.currentTarget.value === "enabled")} options={[
            { label: "Disabled", value: "disabled" },
            { label: "Enabled", value: "enabled" },
          ]} />
          <SelectInput label="Marketplace-first behavior" value={fallbackOnly ? "fallback_only" : "show_both"} onChange={(event) => setFallbackOnly(event.currentTarget.value === "fallback_only")} options={[
            { label: "Use SKIMA only when marketplace has no option", value: "fallback_only" },
            { label: "Allow both options", value: "show_both" },
          ]} />
        </div>
        <TextAreaInput label="Reason for change" value={configurationReason} onChange={(event) => setConfigurationReason(event.currentTarget.value)} placeholder="Why is this launch setting changing?" />
        <Button disabled={!canManageDispatch || updateConfiguration.isPending} onClick={() => updateConfiguration.mutate()}>{updateConfiguration.isPending ? "Saving…" : "Save fulfillment policy"}</Button>
        {updateConfiguration.error ? <ErrorState error={updateConfiguration.error} /> : null}
      </section>

      <section className="skima-grid">
        <div className="sk-panel stack-md">
          <div className="section-heading"><div><span className="section-kicker">Driver payroll accrual</span><h2>Internal Driver share</h2></div><Coins size={20} /></div>
          <TextInput label="Percent of delivery fee" value={compensationPercent} onChange={(event) => setCompensationPercent(event.currentTarget.value)} placeholder="e.g. 60" />
          <TextAreaInput label="Reason" value={compensationReason} onChange={(event) => setCompensationReason(event.currentTarget.value)} placeholder="Reason for this compensation rate" />
          <p className="skima-muted">This is accrued separately from marketplace Driver wallet earnings and cannot be self-withdrawn.</p>
          <Button disabled={!canManagePricing || updateCompensation.isPending} onClick={() => updateCompensation.mutate()}>{updateCompensation.isPending ? "Saving…" : "Save Driver share"}</Button>
          {updateCompensation.error ? <ErrorState error={updateCompensation.error} /> : null}
        </div>

        <div className="sk-panel stack-md">
          <div className="section-heading"><div><span className="section-kicker">Service-area buying policy</span><h2>Internal LPG reference price</h2></div><MapPinned size={20} /></div>
          <TextInput label="Service-area key" value={areaKey} onChange={(event) => setAreaKey(event.currentTarget.value)} placeholder="Configured SKIMA service-area key" />
          <div className="skima-form-grid">
            <TextInput label="Reference price / kg (NGN)" value={pricePerKg} onChange={(event) => setPricePerKg(event.currentTarget.value)} placeholder="e.g. 950" />
            <TextInput label="Estimated route (km)" value={estimatedRouteKm} onChange={(event) => setEstimatedRouteKm(event.currentTarget.value)} placeholder="e.g. 12" />
            <TextInput label="Max supplier variance (%)" value={maxVariancePercent} onChange={(event) => setMaxVariancePercent(event.currentTarget.value)} placeholder="10" />
          </div>
          <TextAreaInput label="Reason" value={priceReason} onChange={(event) => setPriceReason(event.currentTarget.value)} placeholder="Why is this area's internal buying price changing?" />
          <Button disabled={!canManagePricing || updateReferencePrice.isPending} onClick={() => updateReferencePrice.mutate()}>{updateReferencePrice.isPending ? "Saving…" : "Save area reference price"}</Button>
          {updateReferencePrice.error ? <ErrorState error={updateReferencePrice.error} /> : null}
        </div>
      </section>

      <section className="sk-panel stack-md">
        <div className="section-heading"><div><span className="section-kicker">Operations ledger</span><h2>Recent internal procurement & earnings</h2></div></div>
        {financials.error ? <ErrorState error={financials.error} onRetry={() => void financials.refetch()} /> : null}
        <div className="skima-grid">
          <div>
            <h3>Supplier purchases</h3>
            {recentProcurements.length ? recentProcurements.slice(0, 8).map((row) => (
              <div className="skima-list-row" key={String(row.id)}>
                <strong>{String(row.supplierName ?? "Supplier")}</strong>
                <span>{money(row.procurementAmount)} · {String(row.actualKg ?? "—")} kg · {normalizeStatusLabel(String(row.status ?? "recorded"))}</span>
              </div>
            )) : <p className="skima-muted">No internal supplier purchase has been recorded yet.</p>}
          </div>
          <div>
            <h3>Driver accruals</h3>
            {recentEarnings.length ? recentEarnings.slice(0, 8).map((row) => (
              <div className="skima-list-row" key={String(row.id)}>
                <strong>{money(row.earningAmount, String(row.currencyCode ?? "NGN"))}</strong>
                <span>{String(row.ratePercent ?? "—")}% · {normalizeStatusLabel(String(row.status ?? "accrued"))} · withdrawal disabled</span>
              </div>
            )) : <p className="skima-muted">No internal Driver earning has accrued yet.</p>}
          </div>
        </div>
      </section>
    </div>
  );
}

function nestedNumber(record: Record<string, unknown> | undefined, path: string[]): number | null {
  let value: unknown = record;
  for (const key of path) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    value = (value as Record<string, unknown>)[key];
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: unknown, currency = "NGN") {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return `${currency} —`;
  return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
}
