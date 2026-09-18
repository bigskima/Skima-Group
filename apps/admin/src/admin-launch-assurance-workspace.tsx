import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleCheck,
  CircleOff,
  Coins,
  MapPinned,
  RefreshCcw,
  ShieldCheck,
  Truck,
  UserPlus,
  WalletCards,
} from "lucide-react";
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
  TextInput,
} from "@skima/ui";

import { useSessionState } from "./session";

const LaunchConfigSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(["marketplace_only", "internal_only", "hybrid"]),
  priority: z.enum(["marketplace_first", "internal_first"]),
  marketplaceFirstFallbackOnly: z.boolean(),
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

const ManagedDriverSchema = z.object({
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

const ManagedDriverListSchema = z.array(ManagedDriverSchema);
type ManagedDriver = z.infer<typeof ManagedDriverSchema>;

const AreaSchema = z.object({
  key: z.string(),
  label: z.string(),
  areaType: z.string(),
  stateName: z.string().nullable(),
  lgaName: z.string().nullable(),
  cityName: z.string().nullable(),
  townName: z.string().nullable(),
  referencePricePerKg: z.coerce.number().nullable(),
  estimatedRouteKm: z.coerce.number().nullable(),
  maxSupplierVariancePercent: z.coerce.number().nullable(),
  priceConfigured: z.boolean(),
});

const AreaListSchema = z.array(AreaSchema);

const PayoutSchema = z.object({
  payoutId: z.string().uuid(),
  driverProfileId: z.string().uuid(),
  displayName: z.string(),
  publicDriverId: z.string().nullable(),
  amount: z.coerce.number(),
  currencyCode: z.string(),
  status: z.string(),
  payoutReference: z.string(),
  paidAt: z.string(),
  note: z.string().nullable(),
  driverWalletId: z.string().uuid(),
  financialTransactionId: z.string().uuid(),
});

const PayoutListSchema = z.array(PayoutSchema);

const PaymentResultSchema = z.object({
  payoutId: z.string().uuid(),
  driverProfileId: z.string().uuid(),
  amount: z.coerce.number(),
  currencyCode: z.string(),
  payoutReference: z.string(),
  unpaidAfter: z.coerce.number(),
  walletBalanceAfter: z.coerce.number(),
  driverWalletId: z.string().uuid(),
});

type FulfillmentMode = "marketplace_only" | "internal_only" | "hybrid";
type FulfillmentPriority = "marketplace_first" | "internal_first";

export function AdminLaunchAssuranceWorkspace() {
  const { supabase, status, context } = useSessionState();
  const queryClient = useQueryClient();

  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<FulfillmentMode>("hybrid");
  const [priority, setPriority] = useState<FulfillmentPriority>("marketplace_first");
  const [fallbackOnly, setFallbackOnly] = useState(true);
  const [configurationReason, setConfigurationReason] = useState("");

  const [compensationPercent, setCompensationPercent] = useState("");
  const [compensationReason, setCompensationReason] = useState("");

  const [areaKey, setAreaKey] = useState("");
  const [pricePerKg, setPricePerKg] = useState("");
  const [estimatedRouteKm, setEstimatedRouteKm] = useState("");
  const [maxVariancePercent, setMaxVariancePercent] = useState("10");
  const [priceReason, setPriceReason] = useState("");

  const [driverToAdd, setDriverToAdd] = useState("");
  const [driverNote, setDriverNote] = useState("");

  const [payoutDriverId, setPayoutDriverId] = useState("");
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutNote, setPayoutNote] = useState("");

  const [notice, setNotice] = useState<string | null>(null);

  const isSuperAdmin = context?.platformAdmin?.admin_kind === "super_admin";
  const canManageDispatch = Boolean(isSuperAdmin || context?.permissions.includes("platform.dispatch.manage"));
  const canManageDrivers = Boolean(isSuperAdmin || context?.permissions.includes("platform.drivers.manage"));
  const canManageFinance = Boolean(isSuperAdmin || context?.permissions.includes("platform.financial.manage"));
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

  const managedDrivers = useQuery({
    queryKey: ["lpg-managed-drivers-admin"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_lpg_managed_driver_admin", {
        target_driver_profile_id: null,
      });
      if (error) throw error;
      return ManagedDriverListSchema.parse(data ?? []);
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

  const payouts = useQuery({
    queryKey: ["lpg-managed-driver-payouts"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_lpg_managed_driver_payouts", {
        target_driver_profile_id: null,
        target_limit: 50,
      });
      if (error) throw error;
      return PayoutListSchema.parse(data ?? []);
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

  useEffect(() => {
    if (areaKey || !serviceAreas.data?.length) return;
    setAreaKey(serviceAreas.data[0].key);
  }, [areaKey, serviceAreas.data]);

  useEffect(() => {
    if (!areaKey || !serviceAreas.data) return;
    const area = serviceAreas.data.find((item) => item.key === areaKey);
    if (!area) return;
    setPricePerKg(area.referencePricePerKg === null ? "" : String(area.referencePricePerKg));
    setEstimatedRouteKm(area.estimatedRouteKm === null ? "" : String(area.estimatedRouteKm));
    setMaxVariancePercent(area.maxSupplierVariancePercent === null ? "10" : String(area.maxSupplierVariancePercent));
  }, [areaKey, serviceAreas.data]);

  const drivers = managedDrivers.data ?? [];
  const activeManagedDrivers = useMemo(() => drivers.filter((driver) => driver.isManaged), [drivers]);
  const approvedCandidates = useMemo(
    () => drivers.filter((driver) => driver.verificationStatus === "approved" && !driver.isManaged),
    [drivers],
  );
  const payoutDriver = activeManagedDrivers.find((driver) => driver.driverProfileId === payoutDriverId) ?? null;
  const selectedArea = serviceAreas.data?.find((area) => area.key === areaKey) ?? null;

  useEffect(() => {
    if (payoutDriverId && activeManagedDrivers.some((driver) => driver.driverProfileId === payoutDriverId)) return;
    const first = activeManagedDrivers[0];
    setPayoutDriverId(first?.driverProfileId ?? "");
    setPayoutAmount(first && first.availableForPayout > 0 ? String(first.availableForPayout) : "");
  }, [activeManagedDrivers, payoutDriverId]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["lpg-launch-assurance-configuration"] }),
      queryClient.invalidateQueries({ queryKey: ["lpg-launch-assurance-readiness"] }),
      queryClient.invalidateQueries({ queryKey: ["lpg-launch-assurance-financials"] }),
      queryClient.invalidateQueries({ queryKey: ["lpg-managed-drivers-admin"] }),
      queryClient.invalidateQueries({ queryKey: ["lpg-internal-service-area-options"] }),
      queryClient.invalidateQueries({ queryKey: ["lpg-managed-driver-payouts"] }),
    ]);
  };

  const updateConfiguration = useMutation({
    mutationFn: async () => {
      const reason = configurationReason.trim() || "Updated from SKIMA Fulfillment Setup";
      const { data, error } = await supabase.rpc("set_lpg_launch_assurance_configuration", {
        target_enabled: enabled,
        target_idempotency_key: createClientIdempotencyKey("admin.lpg.launch-assurance", `${enabled}:${mode}:${priority}:${fallbackOnly}`),
        target_marketplace_first_fallback_only: fallbackOnly,
        target_mode: mode,
        target_priority: priority,
        target_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      setNotice("Fulfillment settings saved.");
      setConfigurationReason("");
      await refresh();
    },
  });

  const updateCompensation = useMutation({
    mutationFn: async () => {
      const percentage = Number(compensationPercent);
      if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
        throw new Error("Enter a Driver share greater than 0 and no more than 100 percent.");
      }
      const reason = compensationReason.trim() || "Updated from SKIMA Fulfillment Setup";
      const { data, error } = await supabase.rpc("set_lpg_internal_driver_compensation", {
        target_idempotency_key: createClientIdempotencyKey("admin.lpg.internal-driver-compensation", String(percentage)),
        target_percentage: percentage,
        target_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      setNotice("Managed Driver pay rate saved. New completed internal deliveries will use the current configured rate at quote time.");
      setCompensationReason("");
      await refresh();
    },
  });

  const updateReferencePrice = useMutation({
    mutationFn: async () => {
      const price = Number(pricePerKg);
      const routeKm = Number(estimatedRouteKm);
      const variance = Number(maxVariancePercent);
      if (!selectedArea) throw new Error("Choose a service area.");
      if (!Number.isFinite(price) || price <= 0) throw new Error("Enter a valid LPG reference price per kg.");
      if (!Number.isFinite(routeKm) || routeKm < 0) throw new Error("Enter a valid estimated route distance.");
      if (!Number.isFinite(variance) || variance < 0 || variance > 100) throw new Error("Supplier variance must be between 0 and 100 percent.");
      const reason = priceReason.trim() || `Updated ${selectedArea.label} internal LPG buying reference`;
      const { data, error } = await supabase.rpc("set_lpg_internal_reference_price", {
        target_estimated_route_km: routeKm,
        target_geography_key: selectedArea.key,
        target_geography_type: "service_area",
        target_idempotency_key: createClientIdempotencyKey("admin.lpg.internal-reference-price", `${selectedArea.key}:${price}:${routeKm}:${variance}`),
        target_max_supplier_variance_percent: variance,
        target_price_per_kg: price,
        target_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      setNotice(`LPG buying reference saved for ${selectedArea?.label ?? "the selected area"}.`);
      setPriceReason("");
      await refresh();
    },
  });

  const changeManagedDriver = useMutation({
    mutationFn: async ({ driver, managed }: { driver: ManagedDriver; managed: boolean }) => {
      const defaultReason = managed
        ? "Added to SKIMA Managed Drivers from fulfillment setup"
        : "Returned to Independent Driver from fulfillment setup";
      const { data, error } = await supabase.rpc("set_lpg_managed_driver_assignment", {
        target_driver_profile_id: driver.driverProfileId,
        target_idempotency_key: createClientIdempotencyKey("admin.lpg.managed-driver", `${driver.driverProfileId}:${managed}`),
        target_managed: managed,
        target_metadata: { surface: "skima_fulfillment_setup" },
        target_reason: driverNote.trim() || defaultReason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (_data, variables) => {
      setNotice(`${variables.driver.displayName} is now ${variables.managed ? "a SKIMA Managed Driver" : "an Independent Driver"}.`);
      setDriverToAdd("");
      setDriverNote("");
      await refresh();
    },
  });

  const payDriver = useMutation({
    mutationFn: async () => {
      if (!payoutDriver) throw new Error("Choose a SKIMA Managed Driver.");
      const amount = Number(payoutAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a payment amount greater than zero.");
      if (amount > payoutDriver.availableForPayout) throw new Error("Payment cannot exceed the Driver's available earnings.");
      const { data, error } = await supabase.rpc("pay_lpg_managed_driver_to_wallet", {
        target_amount: amount,
        target_currency_code: payoutDriver.currencyCode,
        target_driver_profile_id: payoutDriver.driverProfileId,
        target_idempotency_key: createClientIdempotencyKey("admin.lpg.managed-driver-payout", `${payoutDriver.driverProfileId}:${amount}`),
        target_metadata: { surface: "skima_fulfillment_setup" },
        target_note: payoutNote.trim() || null,
      });
      if (error) throw error;
      return PaymentResultSchema.parse(data);
    },
    onSuccess: async (result) => {
      setNotice(`${money(result.amount, result.currencyCode)} paid to ${payoutDriver?.displayName ?? "Driver"}'s SKIMA Wallet. ${money(result.unpaidAfter, result.currencyCode)} remains unpaid.`);
      setPayoutNote("");
      setPayoutAmount("");
      await refresh();
    },
  });

  if (configuration.isPending || readiness.isPending || managedDrivers.isPending || serviceAreas.isPending) {
    return <LoadingState label="Loading SKIMA fulfillment setup…" />;
  }

  const topError = configuration.error ?? readiness.error ?? managedDrivers.error ?? serviceAreas.error;
  if (topError) return <ErrorState error={topError} onRetry={() => void refresh()} />;

  const ready = readiness.data;
  const recentProcurements = financials.data?.procurements ?? [];
  const selectedCandidate = approvedCandidates.find((driver) => driver.driverProfileId === driverToAdd) ?? null;

  const setupChecks = [
    { label: "Driver pay", detail: ready?.driverCompensationPercent ? `${ready.driverCompensationPercent}% of delivery fee` : "Set a Driver share", done: Boolean(ready?.driverCompensationPercent && ready.driverCompensationPercent > 0) },
    { label: "Local LPG price", detail: ready?.internalReferencePriceScopeCount ? `${ready.internalReferencePriceScopeCount} area${ready.internalReferencePriceScopeCount === 1 ? "" : "s"} configured` : "Set at least one area price", done: Boolean(ready?.internalReferencePriceScopeCount) },
    { label: "Managed Driver", detail: ready?.managedApprovedDriverCount ? `${ready.managedApprovedDriverCount} approved` : "Add at least one approved Driver", done: Boolean(ready?.managedApprovedDriverCount) },
    { label: "Vehicle", detail: ready?.vehicleReadyDriverCount ? `${ready.vehicleReadyDriverCount} Driver${ready.vehicleReadyDriverCount === 1 ? "" : "s"} ready` : "A managed Driver needs an LPG-ready SKIMA-owned vehicle", done: Boolean(ready?.vehicleReadyDriverCount) },
    { label: "Coverage", detail: ready?.coverageReadyDriverCount ? `${ready.coverageReadyDriverCount} Driver${ready.coverageReadyDriverCount === 1 ? "" : "s"} covered` : "Approve LPG service coverage for a managed Driver", done: Boolean(ready?.coverageReadyDriverCount) },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="LPG · SKIMA operations"
        title="SKIMA Fulfillment Setup"
        description="Configure the Partner Network and SKIMA Fleet as two fulfillment routes. Choose which routes are available, which one gets first chance, and when SKIMA Fleet is used as fallback."
        actions={<Button icon={RefreshCcw} variant="outline" onClick={() => void refresh()}>Refresh</Button>}
      />

      {notice ? <div className="sk-panel"><StatusBadge tone="success">{notice}</StatusBadge></div> : null}

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Launch status" value={ready?.ready ? "Ready" : "Setup needed"} icon={ready?.ready ? CircleCheck : CircleOff} tone={ready?.ready ? "success" : "warning"} />
        <MetricTile label="Managed Drivers" value={ready?.managedApprovedDriverCount ?? 0} icon={Truck} />
        <MetricTile label="Drivers fully ready" value={Math.min(ready?.vehicleReadyDriverCount ?? 0, ready?.coverageReadyDriverCount ?? 0)} icon={ShieldCheck} />
        <MetricTile label="Priced areas" value={ready?.internalReferencePriceScopeCount ?? 0} icon={MapPinned} />
      </section>

      <section className="sk-panel stack-md">
        <div className="section-heading"><div><span className="section-kicker">Setup progress</span><h2>{ready?.ready ? "SKIMA fulfillment is ready to be enabled" : "Complete these five launch items"}</h2></div></div>
        <div className="skima-grid skima-grid--compact">
          {setupChecks.map((check) => (
            <div className="sk-panel" key={check.label}>
              <StatusBadge tone={check.done ? "success" : "warning"}>{check.done ? "Ready" : "Needs setup"}</StatusBadge>
              <h3>{check.label}</h3>
              <p className="skima-muted">{check.detail}</p>
            </div>
          ))}
        </div>
        <p className="skima-muted">Technical program keys, policy IDs and geography keys are handled by SKIMA automatically. Admins only choose Drivers, areas, prices and operating preferences.</p>
      </section>

      <section className="sk-panel stack-md">
        <div className="section-heading"><div><span className="section-kicker">1 · Order coverage</span><h2>How should SKIMA fulfil LPG orders?</h2></div></div>
        <div className="skima-form-grid">
          <SelectInput label="Fulfillment mode" value={mode} onChange={(event) => setMode(event.currentTarget.value as FulfillmentMode)} options={[
            { label: "Partner Network + SKIMA Fleet", value: "hybrid" },
            { label: "Partner Network only", value: "marketplace_only" },
            { label: "SKIMA Fleet only", value: "internal_only" },
          ]} />
          <SelectInput label="Who gets the first chance?" value={priority} onChange={(event) => setPriority(event.currentTarget.value as FulfillmentPriority)} options={[
            { label: "Marketplace first", value: "marketplace_first" },
            { label: "SKIMA Managed Drivers first", value: "internal_first" },
          ]} />
          <SelectInput label="SKIMA managed fulfillment" value={enabled ? "enabled" : "disabled"} onChange={(event) => setEnabled(event.currentTarget.value === "enabled")} options={[
            { label: "Off", value: "disabled" },
            { label: "On", value: "enabled" },
          ]} />
          <SelectInput label="When marketplace goes first" value={fallbackOnly ? "fallback_only" : "show_both"} onChange={(event) => setFallbackOnly(event.currentTarget.value === "fallback_only")} options={[
            { label: "Use SKIMA only when marketplace cannot serve", value: "fallback_only" },
            { label: "Show both marketplace and SKIMA options", value: "show_both" },
          ]} />
        </div>
        <TextAreaInput label="Admin note (optional)" value={configurationReason} onChange={(event) => setConfigurationReason(event.currentTarget.value)} placeholder="Example: Partner Network first, SKIMA Fleet as fallback in Awka" />
        <Button disabled={!canManageDispatch || updateConfiguration.isPending || (enabled && !ready?.ready)} onClick={() => updateConfiguration.mutate()}>
          {updateConfiguration.isPending ? "Saving…" : enabled && !ready?.ready ? "Complete setup before turning on" : "Save fulfillment settings"}
        </Button>
        {updateConfiguration.error ? <ErrorState error={updateConfiguration.error} /> : null}
      </section>

      <section className="skima-grid">
        <div className="sk-panel stack-md">
          <div className="section-heading"><div><span className="section-kicker">2 · Driver pay</span><h2>Set Managed Driver share</h2></div><Coins size={20} /></div>
          <TextInput label="Driver share of delivery fee (%)" value={compensationPercent} onChange={(event) => setCompensationPercent(event.currentTarget.value)} placeholder="Example: 40" />
          <p className="skima-muted">After a completed SKIMA-managed delivery, this amount becomes unpaid Driver earnings. Finance later pays all or part of those earnings into the Driver's SKIMA Wallet.</p>
          <TextAreaInput label="Admin note (optional)" value={compensationReason} onChange={(event) => setCompensationReason(event.currentTarget.value)} placeholder="Why is this pay rate changing?" />
          <Button disabled={!canManagePricing || updateCompensation.isPending} onClick={() => updateCompensation.mutate()}>{updateCompensation.isPending ? "Saving…" : "Save Driver pay"}</Button>
          {updateCompensation.error ? <ErrorState error={updateCompensation.error} /> : null}
        </div>

        <div className="sk-panel stack-md">
          <div className="section-heading"><div><span className="section-kicker">3 · Local LPG price</span><h2>Set SKIMA buying reference by area</h2></div><MapPinned size={20} /></div>
          <SelectInput
            label="Service area"
            value={areaKey}
            onChange={(event) => setAreaKey(event.currentTarget.value)}
            options={[
              { label: "Choose a service area", value: "" },
              ...(serviceAreas.data ?? []).map((area) => ({ label: areaContextLabel(area), value: area.key })),
            ]}
          />
          <div className="skima-form-grid">
            <TextInput label="LPG reference price / kg (NGN)" value={pricePerKg} onChange={(event) => setPricePerKg(event.currentTarget.value)} placeholder="Example: 1400" />
            <TextInput label="Typical route distance (km)" value={estimatedRouteKm} onChange={(event) => setEstimatedRouteKm(event.currentTarget.value)} placeholder="Example: 8" />
            <TextInput label="Allowed supplier increase (%)" value={maxVariancePercent} onChange={(event) => setMaxVariancePercent(event.currentTarget.value)} placeholder="Example: 10" />
          </div>
          {selectedArea?.priceConfigured ? <StatusBadge tone="success">Current price loaded for {selectedArea.label}</StatusBadge> : null}
          <p className="skima-muted">This is SKIMA's local LPG cost reference, not a nationwide fixed price. A Driver who meets a supplier above the allowed increase must choose another supplier or request Operations approval.</p>
          <TextAreaInput label="Admin note (optional)" value={priceReason} onChange={(event) => setPriceReason(event.currentTarget.value)} placeholder="Example: Updated after local supplier price review" />
          <Button disabled={!canManagePricing || updateReferencePrice.isPending || !selectedArea} onClick={() => updateReferencePrice.mutate()}>{updateReferencePrice.isPending ? "Saving…" : "Save area price"}</Button>
          {updateReferencePrice.error ? <ErrorState error={updateReferencePrice.error} /> : null}
        </div>
      </section>

      <section className="sk-panel stack-md">
        <div className="section-heading"><div><span className="section-kicker">4 · Managed Drivers</span><h2>Add approved Drivers to the SKIMA team</h2><p className="skima-muted">Admins choose a person. SKIMA handles the internal Driver classification automatically.</p></div><UserPlus size={20} /></div>
        <div className="skima-form-grid">
          <SelectInput
            label="Approved Driver"
            value={driverToAdd}
            onChange={(event) => setDriverToAdd(event.currentTarget.value)}
            options={[
              { label: approvedCandidates.length ? "Choose an approved Driver" : "No approved Independent Drivers available", value: "" },
              ...approvedCandidates.map((driver) => ({ label: driverOptionLabel(driver), value: driver.driverProfileId })),
            ]}
          />
          <TextInput label="Admin note (optional)" value={driverNote} onChange={(event) => setDriverNote(event.currentTarget.value)} placeholder="Example: Awka launch team" />
        </div>
        <Button
          disabled={!canManageDrivers || changeManagedDriver.isPending || !selectedCandidate}
          onClick={() => selectedCandidate && changeManagedDriver.mutate({ driver: selectedCandidate, managed: true })}
        >
          {changeManagedDriver.isPending ? "Saving…" : "Add as SKIMA Managed Driver"}
        </Button>
        {changeManagedDriver.error ? <ErrorState error={changeManagedDriver.error} /> : null}

        <div className="stack-md">
          <h3>Current SKIMA Managed Drivers</h3>
          {activeManagedDrivers.length ? activeManagedDrivers.map((driver) => (
            <div className="skima-list-row" key={driver.driverProfileId}>
              <div>
                <strong>{driver.displayName}</strong>
                <span>{driver.publicDriverId ?? "Driver"} · {normalizeStatusLabel(driver.operationalStatus)}</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: ".35rem", marginTop: ".4rem" }}>
                  <StatusBadge tone={driver.vehicleReady ? "success" : "warning"}>{driver.vehicleReady ? "Vehicle ready" : "Vehicle setup needed"}</StatusBadge>
                  <StatusBadge tone={driver.coverageReady ? "success" : "warning"}>{driver.coverageReady ? "Coverage ready" : "Coverage approval needed"}</StatusBadge>
                </div>
              </div>
              <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <span className="skima-muted">Unpaid {money(driver.availableForPayout, driver.currencyCode)}</span>
                {canManageDrivers ? (
                  <Button size="sm" variant="outline" disabled={changeManagedDriver.isPending} onClick={() => changeManagedDriver.mutate({ driver, managed: false })}>Return to Independent</Button>
                ) : null}
              </div>
            </div>
          )) : <p className="skima-muted">No SKIMA Managed Driver has been added yet.</p>}
        </div>
      </section>

      <section className="sk-panel stack-md">
        <div className="section-heading"><div><span className="section-kicker">5 · Driver payments</span><h2>Pay earnings to SKIMA Wallet</h2><p className="skima-muted">Pay all or part of a Driver's approved earnings. Only the amount paid is cleared from unpaid earnings; the rest remains outstanding.</p></div><WalletCards size={20} /></div>
        <SelectInput
          label="Managed Driver"
          value={payoutDriverId}
          onChange={(event) => {
            const nextId = event.currentTarget.value;
            const nextDriver = activeManagedDrivers.find((driver) => driver.driverProfileId === nextId);
            setPayoutDriverId(nextId);
            setPayoutAmount(nextDriver && nextDriver.availableForPayout > 0 ? String(nextDriver.availableForPayout) : "");
          }}
          options={[
            { label: activeManagedDrivers.length ? "Choose a Managed Driver" : "No Managed Drivers yet", value: "" },
            ...activeManagedDrivers.map((driver) => ({ label: driverOptionLabel(driver), value: driver.driverProfileId })),
          ]}
        />

        {payoutDriver ? (
          <>
            <div className="skima-grid skima-grid--compact">
              <MetricTile label="Available earnings" value={money(payoutDriver.availableForPayout, payoutDriver.currencyCode)} icon={Coins} tone={payoutDriver.availableForPayout > 0 ? "success" : "neutral"} />
              <MetricTile label="SKIMA Wallet" value={money(payoutDriver.driverWalletBalance, payoutDriver.currencyCode)} icon={WalletCards} />
              <MetricTile label="Paid to Wallet" value={money(payoutDriver.paidToWallet, payoutDriver.currencyCode)} icon={CircleCheck} />
              <MetricTile label="Pending completion" value={money(payoutDriver.pendingEarnings, payoutDriver.currencyCode)} icon={CircleOff} />
            </div>
            <div className="skima-form-grid">
              <TextInput label="Amount to pay" value={payoutAmount} onChange={(event) => setPayoutAmount(event.currentTarget.value)} placeholder="Enter amount" />
              <TextInput label="Payment note (optional)" value={payoutNote} onChange={(event) => setPayoutNote(event.currentTarget.value)} placeholder="Example: Weekly Driver pay" />
            </div>
            <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
              <Button variant="outline" disabled={payoutDriver.availableForPayout <= 0} onClick={() => setPayoutAmount(String(payoutDriver.availableForPayout))}>Pay full available balance</Button>
              <Button disabled={!canManageFinance || payDriver.isPending || payoutDriver.availableForPayout <= 0} onClick={() => payDriver.mutate()}>{payDriver.isPending ? "Paying…" : "Pay to SKIMA Wallet"}</Button>
            </div>
          </>
        ) : <p className="skima-muted">Add a SKIMA Managed Driver before using Driver payments.</p>}
        {payDriver.error ? <ErrorState error={payDriver.error} /> : null}
      </section>

      <section className="sk-panel stack-md">
        <div className="section-heading"><div><span className="section-kicker">Payment history</span><h2>Recent Managed Driver payments</h2></div></div>
        {payouts.error ? <ErrorState error={payouts.error} onRetry={() => void payouts.refetch()} /> : null}
        {payouts.data?.length ? payouts.data.slice(0, 12).map((payout) => (
          <div className="skima-list-row" key={payout.payoutId}>
            <div><strong>{payout.displayName}</strong><span>{payout.payoutReference} · {formatDate(payout.paidAt)}</span></div>
            <div><strong>{money(payout.amount, payout.currencyCode)}</strong><span>Paid to SKIMA Wallet</span></div>
          </div>
        )) : <p className="skima-muted">No Managed Driver payment has been made yet.</p>}
      </section>

      <section className="sk-panel stack-md">
        <div className="section-heading"><div><span className="section-kicker">Operations activity</span><h2>Recent SKIMA supplier purchases</h2></div></div>
        {financials.error ? <ErrorState error={financials.error} onRetry={() => void financials.refetch()} /> : null}
        {recentProcurements.length ? recentProcurements.slice(0, 10).map((row) => (
          <div className="skima-list-row" key={String(row.id)}>
            <strong>{String(row.supplierName ?? "Supplier")}</strong>
            <span>{money(row.procurementAmount)} · {String(row.actualKg ?? "—")} kg · {normalizeStatusLabel(String(row.status ?? "recorded"))}</span>
          </div>
        )) : <p className="skima-muted">No SKIMA supplier purchase has been recorded yet.</p>}
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

function areaContextLabel(area: z.infer<typeof AreaSchema>) {
  const context = [area.lgaName, area.stateName].filter(Boolean).join(", ");
  return context ? `${area.label} · ${context}` : area.label;
}

function driverOptionLabel(driver: ManagedDriver) {
  return driver.publicDriverId ? `${driver.displayName} · ${driver.publicDriverId}` : driver.displayName;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}
