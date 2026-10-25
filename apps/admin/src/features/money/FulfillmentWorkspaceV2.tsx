import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  Building2,
  CircleAlert,
  CircleCheck,
  Coins,
  Compass,
  Fuel,
  MapPinned,
  RefreshCcw,
  Route,
  Settings2,
  Truck,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  TextInput,
} from "@skima/ui";

import { AdminFulfillmentPriorityControl } from "../../admin-fulfillment-priority-control";
import { useSessionState } from "../../session";
import "./fulfillment-v2.css";

const BASE = "/money/pricing/launch-assurance";

type FulfillmentSection =
  | "overview"
  | "routing"
  | "availability"
  | "driver-pay"
  | "lpg-price"
  | "team"
  | "activity"
  | "advanced"
  | "station-affiliates";

type FulfillmentMode = "marketplace_only" | "internal_only" | "hybrid";

const ConfigSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(["marketplace_only", "internal_only", "hybrid"]),
  priority: z.enum(["marketplace_first", "internal_first"]),
  marketplaceFirstFallbackOnly: z.boolean(),
  driverCompensation: z.record(z.unknown()).optional(),
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
  fullyReadyDriverCount: z.coerce.number().int().nonnegative(),
  reasons: z.array(z.string()),
});

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

type ServiceArea = z.infer<typeof AreaSchema>;

const FinancialsSchema = z.object({
  procurements: z.array(z.record(z.unknown())),
  earnings: z.array(z.record(z.unknown())),
});

const PayoutSchema = z.object({
  payoutId: z.string().uuid(),
  driverProfileId: z.string().uuid(),
  displayName: z.string(),
  publicDriverId: z.string().nullable(),
  amount: z.coerce.number(),
  currencyCode: z.string(),
  status: z.string(),
  paidAt: z.string(),
});
const PayoutListSchema = z.array(PayoutSchema);

const sections: readonly {
  key: FulfillmentSection;
  label: string;
  short: string;
  icon: typeof Compass;
}[] = [
  { key: "overview", label: "Overview", short: "Readiness", icon: Compass },
  { key: "routing", label: "Order routing", short: "Who goes first", icon: Route },
  { key: "availability", label: "Availability", short: "Allowed networks", icon: Building2 },
  { key: "driver-pay", label: "Driver pay", short: "Pay rate", icon: Coins },
  { key: "lpg-price", label: "LPG buying price", short: "Area reference", icon: Fuel },
  { key: "team", label: "Managed team", short: "Drivers & fleet", icon: UsersRound },
  { key: "activity", label: "Activity", short: "Purchases & pay", icon: Activity },
  { key: "station-affiliates", label: "Station affiliates", short: "Referrals & commission", icon: UsersRound },
  { key: "advanced", label: "Advanced", short: "All settings", icon: Settings2 },
];

export function FulfillmentWorkspaceV2(props: {
  readonly route: string;
  readonly onNavigate: (href: string) => void;
  readonly renderAdvanced: () => ReactNode;
}) {
  const { supabase, status, context } = useSessionState();
  const queryClient = useQueryClient();
  const section = sectionFromRoute(props.route);

  const isSuperAdmin = context?.platformAdmin?.admin_kind === "super_admin";
  const canManageDispatch = Boolean(isSuperAdmin || context?.permissions.includes("platform.dispatch.manage"));
  const canManagePricing = Boolean(
    isSuperAdmin ||
      context?.permissions.includes("platform.financial_policy.activate") ||
      context?.permissions.includes("platform.financial_policy.manage"),
  );
  const canReadAffiliateAdmin = Boolean(
    isSuperAdmin ||
      context?.permissions.includes("platform.dispatch.read") ||
      context?.permissions.includes("platform.wallets.read") ||
      context?.permissions.includes("platform.revenue.read") ||
      context?.permissions.includes("platform.financial_policy.draft") ||
      context?.permissions.includes("platform.financial_policy.approve") ||
      context?.permissions.includes("platform.financial_policy.activate"),
  );
  const canManageAffiliate = Boolean(isSuperAdmin || context?.permissions.includes("platform.wallets.manage"));
  const canDraftFinancialPolicy = Boolean(isSuperAdmin || context?.permissions.includes("platform.financial_policy.draft"));
  const canApproveFinancialPolicy = Boolean(isSuperAdmin || context?.permissions.includes("platform.financial_policy.approve"));
  const canActivateFinancialPolicy = Boolean(isSuperAdmin || context?.permissions.includes("platform.financial_policy.activate"));

  const configuration = useQuery({
    queryKey: ["lpg-launch-assurance-configuration"],
    enabled: status === "authenticated" && section !== "advanced" && section !== "station-affiliates",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_lpg_launch_assurance_configuration");
      if (error) throw error;
      return ConfigSchema.parse(data);
    },
  });

  const readiness = useQuery({
    queryKey: ["lpg-launch-assurance-readiness"],
    enabled: status === "authenticated" && section !== "advanced" && section !== "station-affiliates",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_lpg_internal_launch_readiness");
      if (error) throw error;
      return ReadinessSchema.parse(data);
    },
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["lpg-launch-assurance-configuration"] }),
      queryClient.invalidateQueries({ queryKey: ["lpg-launch-assurance-readiness"] }),
      queryClient.invalidateQueries({ queryKey: ["lpg-internal-service-area-options"] }),
      queryClient.invalidateQueries({ queryKey: ["lpg-launch-assurance-financials"] }),
      queryClient.invalidateQueries({ queryKey: ["lpg-managed-driver-payouts"] }),
    ]);
  };

  if (section === "station-affiliates") {
    return (
      <div className="fulfillment-v2 stack-lg">
        <FulfillmentHeader onRefresh={null} />
        <FulfillmentSectionNav active={section} onNavigate={props.onNavigate} />
        <AffiliateAdminSection
          canRead={canReadAffiliateAdmin}
          canManageAffiliate={canManageAffiliate}
          canDraftPolicy={canDraftFinancialPolicy}
          canApprovePolicy={canApproveFinancialPolicy}
          canActivatePolicy={canActivateFinancialPolicy}
          canRetryCommission={Boolean(isSuperAdmin || (context?.permissions.includes("platform.financial.manage") && context?.permissions.includes("platform.wallets.manage")))}
        />
      </div>
    );
  }

  if (section === "advanced") {
    return (
      <div className="fulfillment-v2 stack-lg">
        <FulfillmentHeader onRefresh={null} />
        <FulfillmentSectionNav active={section} onNavigate={props.onNavigate} />
        <div className="admin-inline-warning">
          <strong>Advanced view:</strong> this is the complete all-in-one console for specialist use. Routine configuration is easier from the focused sections above.
        </div>
        {props.renderAdvanced()}
      </div>
    );
  }

  if (configuration.isPending || readiness.isPending) {
    return <LoadingState label="Loading SKIMA fulfillment…" />;
  }

  const topError = configuration.error ?? readiness.error;
  if (topError || !configuration.data || !readiness.data) {
    return <ErrorState title="SKIMA fulfillment unavailable" error={topError} onRetry={() => void refresh()} />;
  }

  return (
    <div className="fulfillment-v2 stack-lg">
      <FulfillmentHeader onRefresh={() => void refresh()} />
      <FulfillmentSectionNav active={section} onNavigate={props.onNavigate} />

      {section === "overview" ? (
        <OverviewSection readiness={readiness.data} configuration={configuration.data} onNavigate={props.onNavigate} />
      ) : null}

      {section === "routing" ? (
        <AdminFulfillmentPriorityControl onNavigate={props.onNavigate} />
      ) : null}

      {section === "availability" ? (
        <AvailabilitySection
          configuration={configuration.data}
          readiness={readiness.data}
          canManage={canManageDispatch}
          onSaved={refresh}
        />
      ) : null}

      {section === "driver-pay" ? (
        <DriverPaySection
          configuration={configuration.data}
          canManage={canManagePricing}
          onSaved={refresh}
        />
      ) : null}

      {section === "lpg-price" ? (
        <LpgPriceSection canManage={canManagePricing} onSaved={refresh} />
      ) : null}

      {section === "team" ? (
        <ManagedTeamSection readiness={readiness.data} onNavigate={props.onNavigate} />
      ) : null}

      {section === "activity" ? <ActivitySection onNavigate={props.onNavigate} /> : null}
    </div>
  );
}

function FulfillmentHeader(props: { readonly onRefresh: (() => void) | null }) {
  return (
    <PageHeader
      eyebrow="Money · LPG operations"
      title="SKIMA Fulfillment"
      description="Configure one operational task at a time. Order routing, Managed Driver pay, LPG buying prices, fleet readiness and payments are separated so mobile admins do not have to work through one long form."
      actions={props.onRefresh ? (
        <Button icon={RefreshCcw} variant="outline" onClick={props.onRefresh}>Refresh</Button>
      ) : undefined}
    />
  );
}

function FulfillmentSectionNav(props: {
  readonly active: FulfillmentSection;
  readonly onNavigate: (href: string) => void;
}) {
  return (
    <nav className="fulfillment-v2__nav" aria-label="SKIMA fulfillment sections">
      {sections.map((item) => {
        const Icon = item.icon;
        const active = item.key === props.active;
        return (
          <button
            key={item.key}
            type="button"
            className={active ? "is-active" : undefined}
            aria-current={active ? "page" : undefined}
            onClick={() => props.onNavigate(sectionHref(item.key))}
          >
            <Icon aria-hidden="true" />
            <span><strong>{item.label}</strong><small>{item.short}</small></span>
          </button>
        );
      })}
    </nav>
  );
}

function OverviewSection(props: {
  readonly readiness: z.infer<typeof ReadinessSchema>;
  readonly configuration: z.infer<typeof ConfigSchema>;
  readonly onNavigate: (href: string) => void;
}) {
  const ready = props.readiness;
  const steps = [
    {
      label: "Order routing",
      detail: props.configuration.priority === "marketplace_first" ? "Partner Network goes first" : "SKIMA Fleet goes first",
      done: true,
      href: sectionHref("routing"),
      icon: Route,
    },
    {
      label: "Managed Driver pay",
      detail: ready.driverCompensationPercent ? `${ready.driverCompensationPercent}% of delivery fee` : "Set the Driver share",
      done: Boolean(ready.driverCompensationPercent && ready.driverCompensationPercent > 0),
      href: sectionHref("driver-pay"),
      icon: Coins,
    },
    {
      label: "Local LPG buying price",
      detail: ready.internalReferencePriceScopeCount ? `${ready.internalReferencePriceScopeCount} area${ready.internalReferencePriceScopeCount === 1 ? "" : "s"} configured` : "Set at least one area price",
      done: ready.internalReferencePriceScopeCount > 0,
      href: sectionHref("lpg-price"),
      icon: Fuel,
    },
    {
      label: "Managed Drivers",
      detail: ready.managedApprovedDriverCount ? `${ready.managedApprovedDriverCount} approved` : "Add at least one approved Driver",
      done: ready.managedApprovedDriverCount > 0,
      href: sectionHref("team"),
      icon: UsersRound,
    },
    {
      label: "SKIMA vehicle",
      detail: ready.vehicleReadyDriverCount ? `${ready.vehicleReadyDriverCount} Driver${ready.vehicleReadyDriverCount === 1 ? "" : "s"} vehicle-ready` : "Assign a compliant SKIMA vehicle",
      done: ready.vehicleReadyDriverCount > 0,
      href: "/partners/fleet",
      icon: Truck,
    },
    {
      label: "Service area",
      detail: ready.coverageReadyDriverCount ? `${ready.coverageReadyDriverCount} Driver${ready.coverageReadyDriverCount === 1 ? "" : "s"} covered` : "Assign Managed Driver coverage",
      done: ready.coverageReadyDriverCount > 0,
      href: "/operations/managed-driver-coverage",
      icon: MapPinned,
    },
  ] as const;

  const complete = steps.filter((step) => step.done).length;

  return (
    <>
      <section className="fulfillment-v2__metrics">
        <MetricTile label="Setup" value={ready.ready ? "Ready" : `${complete}/${steps.length}`} icon={ready.ready ? CircleCheck : CircleAlert} tone={ready.ready ? "success" : "warning"} />
        <MetricTile label="Managed Drivers" value={ready.managedApprovedDriverCount} icon={UsersRound} />
        <MetricTile label="Vehicle ready" value={ready.vehicleReadyDriverCount} icon={Truck} tone={ready.vehicleReadyDriverCount ? "success" : "warning"} />
        <MetricTile label="Priced areas" value={ready.internalReferencePriceScopeCount} icon={MapPinned} />
      </section>

      <section className="sk-panel stack-md">
        <div className="sk-panel__header">
          <div>
            <span className="section-kicker">Setup progress</span>
            <h2>{ready.ready ? "Managed fulfillment is ready" : "Finish the remaining setup"}</h2>
            <p className="skima-muted">Open only the item you want to configure. Completed items stay collapsed here as a status summary.</p>
          </div>
          <StatusBadge tone={ready.enabled ? "success" : "neutral"}>{ready.enabled ? "SKIMA Fleet on" : "SKIMA Fleet off"}</StatusBadge>
        </div>

        <div className="fulfillment-v2__setup-grid">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <button key={step.label} type="button" className="fulfillment-v2__setup-card" onClick={() => props.onNavigate(step.href)}>
                <span className={step.done ? "is-ready" : "needs-work"}><Icon aria-hidden="true" /></span>
                <span><strong>{step.label}</strong><small>{step.detail}</small></span>
                <StatusBadge tone={step.done ? "success" : "warning"}>{step.done ? "Ready" : "Set up"}</StatusBadge>
                <ArrowRight aria-hidden="true" />
              </button>
            );
          })}
        </div>

        {!ready.ready && ready.reasons.length ? (
          <div className="fulfillment-v2__next-step">
            <strong>Still needed</strong>
            <span>{friendlyReason(ready.reasons[0])}</span>
          </div>
        ) : null}
      </section>
    </>
  );
}

function AvailabilitySection(props: {
  readonly configuration: z.infer<typeof ConfigSchema>;
  readonly readiness: z.infer<typeof ReadinessSchema>;
  readonly canManage: boolean;
  readonly onSaved: () => Promise<void>;
}) {
  const { supabase } = useSessionState();
  const [mode, setMode] = useState<FulfillmentMode>(props.configuration.mode);
  const [fallbackOnly, setFallbackOnly] = useState(props.configuration.marketplaceFirstFallbackOnly);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setMode(props.configuration.mode);
    setFallbackOnly(props.configuration.marketplaceFirstFallbackOnly);
  }, [props.configuration.mode, props.configuration.marketplaceFirstFallbackOnly]);

  const save = useMutation({
    mutationFn: async () => {
      const enableFleet = mode !== "marketplace_only";
      if (enableFleet && !props.readiness.ready) {
        throw new Error("Finish the Managed Driver, SKIMA vehicle, service-area, Driver-pay and LPG-price setup before turning on the SKIMA Fleet route.");
      }
      const { error } = await supabase.rpc("set_lpg_launch_assurance_configuration", {
        target_enabled: enableFleet,
        target_idempotency_key: createClientIdempotencyKey("admin.fulfillment.availability", `${mode}:${fallbackOnly}:${props.configuration.priority}`),
        target_marketplace_first_fallback_only: fallbackOnly,
        target_mode: mode,
        target_priority: props.configuration.priority,
        target_reason: `Admin changed LPG service availability to ${availabilityLabel(mode)}`,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setNotice("LPG service availability saved.");
      await props.onSaved();
    },
  });

  const choices: readonly { mode: FulfillmentMode; title: string; detail: string; icon: typeof Building2 }[] = [
    { mode: "hybrid", title: "Partner Network + SKIMA Fleet", detail: "Use both delivery networks according to your order-routing priority.", icon: Building2 },
    { mode: "marketplace_only", title: "Partner Network only", detail: "Use registered stations and Independent Drivers. SKIMA Fleet stays off.", icon: UsersRound },
    { mode: "internal_only", title: "SKIMA Fleet only", detail: "Use Managed Drivers with assigned SKIMA-owned vehicles only.", icon: Truck },
  ];

  return (
    <>
    <section className="sk-panel stack-md">
      <div className="sk-panel__header">
        <div>
          <span className="section-kicker">Service availability</span>
          <h2>Which networks can take new LPG orders?</h2>
          <p className="skima-muted">Choose the operating model. This screen does not change prices or Driver earnings.</p>
        </div>
        <StatusBadge tone={props.configuration.enabled ? "success" : "neutral"}>{availabilityLabel(props.configuration.mode)}</StatusBadge>
      </div>

      <div className="fulfillment-v2__choice-grid">
        {choices.map((choice) => {
          const Icon = choice.icon;
          const selected = choice.mode === mode;
          return (
            <button key={choice.mode} type="button" className={selected ? "fulfillment-v2__choice is-selected" : "fulfillment-v2__choice"} onClick={() => setMode(choice.mode)}>
              <Icon aria-hidden="true" />
              <strong>{choice.title}</strong>
              <span>{choice.detail}</span>
              <StatusBadge tone={selected ? "success" : "neutral"}>{selected ? "Selected" : "Choose"}</StatusBadge>
            </button>
          );
        })}
      </div>

      {mode === "hybrid" && props.configuration.priority === "marketplace_first" ? (
        <div className="sk-panel fulfillment-v2__compact-form">
          <SelectInput
            label="When the Partner Network goes first"
            value={fallbackOnly ? "fallback" : "both"}
            onChange={(event) => setFallbackOnly(event.currentTarget.value === "fallback")}
            options={[
              { label: "Use SKIMA Fleet only if partners cannot serve", value: "fallback" },
              { label: "Keep both routes available", value: "both" },
            ]}
          />
        </div>
      ) : null}

      {mode !== "marketplace_only" && !props.readiness.ready ? (
        <div className="admin-inline-warning">
          <strong>SKIMA Fleet cannot be turned on yet.</strong> {friendlyReason(props.readiness.reasons[0] ?? "Complete Managed Fulfillment setup.")}
        </div>
      ) : null}

      {notice ? <StatusBadge tone="success">{notice}</StatusBadge> : null}
      {save.error ? <ErrorState title="Could not save availability" error={save.error} /> : null}
      <Button disabled={!props.canManage || save.isPending} isLoading={save.isPending} onClick={() => save.mutate()}>Save availability</Button>
    </section>
    <StationManagedCoveragePolicySection canManage={props.canManage} />
    </>
  );
}

const StationManagedCoveragePolicySchema = z.object({
  outsideCustomerCoverageEnabled: z.boolean(),
  updatedAt: z.string().nullable().optional(),
  changeReason: z.string(),
  version: z.coerce.number().int().positive(),
});

function StationManagedCoveragePolicySection(props: { readonly canManage: boolean }) {
  const { supabase, status } = useSessionState();
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const policy = useQuery({
    queryKey: ["lpg-station-managed-coverage-policy"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_lpg_station_managed_coverage_policy");
      if (error) throw error;
      return StationManagedCoveragePolicySchema.parse(data);
    },
  });

  useEffect(() => {
    if (policy.data) setEnabled(policy.data.outsideCustomerCoverageEnabled);
  }, [policy.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!reason.trim() || reason.trim().length < 5) {
        throw new Error("Enter a reason of at least 5 characters for the policy change.");
      }
      const { data, error } = await supabase.rpc("configure_lpg_station_managed_coverage_policy", {
        target_enabled: enabled,
        target_reason: reason.trim(),
      });
      if (error) throw error;
      return StationManagedCoveragePolicySchema.parse(data);
    },
    onSuccess: async (next) => {
      setEnabled(next.outsideCustomerCoverageEnabled);
      setReason("");
      setNotice("Station Managed coverage policy saved.");
      await queryClient.invalidateQueries({ queryKey: ["lpg-station-managed-coverage-policy"] });
    },
  });

  if (policy.isPending) return <LoadingState label="Loading Station Managed coverage policy" />;
  if (policy.error || !policy.data) {
    return <ErrorState title="Station Managed coverage policy unavailable" error={policy.error} onRetry={() => void policy.refetch()} />;
  }

  return (
    <section className="sk-panel stack-md fulfillment-v2__single-task">
      <div className="sk-panel__header">
        <div>
          <span className="section-kicker">Station Managed · Coverage expansion</span>
          <h2>Allow qualified stations to serve beyond SKIMA launch areas</h2>
          <p className="skima-muted">
            This switch affects only explicitly Station Managed orders. The branch must be approved and available,
            Station Managed must be enabled, an active branch driver must exist, stock and current price must qualify,
            and the station's configured delivery radius must cover both pickup and return locations. It does not open
            SKIMA Managed or Independent delivery outside their own service areas.
          </p>
        </div>
        <StatusBadge tone={policy.data.outsideCustomerCoverageEnabled ? "success" : "neutral"}>
          {policy.data.outsideCustomerCoverageEnabled ? "Enabled" : "Disabled"}
        </StatusBadge>
      </div>

      <SelectInput
        label="Station Managed delivery outside SKIMA customer coverage"
        value={enabled ? "enabled" : "disabled"}
        onChange={(event) => setEnabled(event.currentTarget.value === "enabled")}
        options={[
          { label: "Disabled — require SKIMA customer-ordering coverage", value: "disabled" },
          { label: "Enabled — allow eligible Station Managed branches within their own radius", value: "enabled" },
        ]}
        disabled={!props.canManage || save.isPending}
      />
      <TextInput
        label="Reason for change (required)"
        value={reason}
        onChange={(event) => setReason(event.currentTarget.value)}
        placeholder="e.g. Approve limited Station Managed expansion for launch"
        disabled={!props.canManage || save.isPending}
      />
      <div className="skima-muted">
        Policy version {policy.data.version}
        {policy.data.updatedAt ? ` · Last changed ${new Date(policy.data.updatedAt).toLocaleString()}` : ""}
        {policy.data.changeReason ? ` · ${policy.data.changeReason}` : ""}
      </div>
      {notice ? <StatusBadge tone="success">{notice}</StatusBadge> : null}
      {save.error ? <ErrorState title="Could not save Station Managed coverage" error={save.error} /> : null}
      <Button
        disabled={!props.canManage || save.isPending || reason.trim().length < 5 || enabled === policy.data.outsideCustomerCoverageEnabled}
        isLoading={save.isPending}
        onClick={() => save.mutate()}
      >
        Save Station Managed coverage
      </Button>
    </section>
  );
}


const AffiliateAdminWorkspaceSchema = z.object({
  policy: z.object({
    policyKey: z.string().optional(),
    displayName: z.string().optional(),
    policyFamily: z.string().optional(),
    definitionId: z.string().uuid().optional(),
    latestVersion: z.record(z.unknown()).nullable().optional(),
    activeVersion: z.record(z.unknown()).nullable().optional(),
  }).nullable().optional(),
  affiliates: z.array(z.record(z.unknown())).default([]),
  referrals: z.array(z.record(z.unknown())).default([]),
  earnings: z.array(z.record(z.unknown())).default([]),
  commissionFailures: z.array(z.record(z.unknown())).default([]),
});
type AffiliateAdminWorkspace = z.infer<typeof AffiliateAdminWorkspaceSchema>;
type AffiliateDecision = "active" | "rejected" | "suspended";

function AffiliateAdminSection(props: {
  readonly canRead: boolean;
  readonly canManageAffiliate: boolean;
  readonly canDraftPolicy: boolean;
  readonly canApprovePolicy: boolean;
  readonly canActivatePolicy: boolean;
  readonly canRetryCommission: boolean;
}) {
  const { supabase, status } = useSessionState();
  const queryClient = useQueryClient();
  const [policyEnabled, setPolicyEnabled] = useState(false);
  const [commissionPercent, setCommissionPercent] = useState("");
  const [earningMonths, setEarningMonths] = useState("");
  const [eligibleStreams, setEligibleStreams] = useState<"both" | "refill" | "delivery">("both");
  const [policyReason, setPolicyReason] = useState("");
  const [affiliateReason, setAffiliateReason] = useState("");
  const [retryReason, setRetryReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const workspace = useQuery<AffiliateAdminWorkspace>({
    queryKey: ["lpg-station-affiliate-admin-workspace"],
    enabled: props.canRead && status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_lpg_station_affiliate_admin_workspace");
      if (error) throw error;
      return AffiliateAdminWorkspaceSchema.parse(data);
    },
  });

  const latestPolicy = workspace.data?.policy?.latestVersion ?? null;
  const activePolicy = workspace.data?.policy?.activeVersion ?? null;
  const latestVersionId = recordText(latestPolicy, "id");
  const latestLifecycle = recordText(latestPolicy, "lifecycle_status");
  const activeVersionId = recordText(activePolicy, "id");
  const activeConfiguration = recordObject(activePolicy, "configuration");
  const hasActivePolicy = Boolean(activeVersionId);
  const programAlreadyConfigured = Boolean(latestVersionId);

  useEffect(() => {
    const policyRecord = latestPolicy ?? activePolicy;
    const config = recordObject(policyRecord, "configuration");
    if (!policyRecord) return;
    const enabled = config.program_enabled;
    const rate = Number(config.commission_percent);
    const months = Number(config.earning_period_months);
    const streams = Array.isArray(config.eligible_revenue_streams)
      ? config.eligible_revenue_streams.filter((item): item is string => typeof item === "string")
      : ["refill", "delivery"];
    if (typeof enabled === "boolean") setPolicyEnabled(enabled);
    if (Number.isFinite(rate) && rate >= 0) setCommissionPercent(String(rate));
    if (Number.isInteger(months) && months >= 1) setEarningMonths(String(months));
    setEligibleStreams(streams.includes("refill") && streams.includes("delivery")
      ? "both" : streams.includes("refill") ? "refill" : "delivery");
  }, [latestPolicy, activePolicy]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["lpg-station-affiliate-admin-workspace"] });
  };

  const createPolicyDraft = useMutation({
    mutationFn: async () => {
      if (policyReason.trim().length < 5) throw new Error("Enter a change reason of at least 5 characters.");
      const rate = Number(commissionPercent);
      const months = Number(earningMonths);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100 || (policyEnabled && rate <= 0)) {
        throw new Error("Commission must be 0–100%; use a positive percentage while the programme is enabled.");
      }
      if (!Number.isInteger(months) || months < 1 || months > 36) {
        throw new Error("The earning period must be a whole number from 1 to 36 months.");
      }
      const streams = eligibleStreams === "both" ? ["refill", "delivery"] : [eligibleStreams];
      const configuration = {
        program_enabled: policyEnabled,
        commission_percent: rate,
        earning_period_months: months,
        eligible_revenue_streams: streams,
      };
      const { data, error } = await supabase.rpc("create_financial_policy_version", {
        target_policy_key: "commission.lpg.station_affiliate",
        target_display_name: "LPG Station Affiliate Commission",
        target_policy_family: "affiliate",
        target_currency_code: "NGN",
        target_configuration: configuration,
        target_effective_from: new Date().toISOString(),
        target_change_reason: policyReason.trim(),
        target_idempotency_key: createClientIdempotencyKey(
          "admin.lpg.station-affiliate.policy-draft",
          JSON.stringify(configuration) + ":" + policyReason.trim() + ":" + Date.now(),
        ),
        target_module_key: "lpg",
        target_organization_id: null,
        target_service_key: "lpg.station.affiliate",
        target_geography_type: "country",
        target_geography_key: "NG",
        target_effective_until: null,
        target_priority: 100,
        target_approval_required: true,
        target_allow_partner_delegation: false,
        target_based_on_version_id: activeVersionId,
        target_supersedes_version_id: activeVersionId,
        target_rollback_of_version_id: null,
        target_metadata: { module: "lpg", programme: "station_affiliate", createdFrom: "admin-fulfillment-workspace" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      setPolicyReason("");
      setNotice("Commission policy draft created. Submit it for independent approval.");
      await refresh();
    },
  });

  const submitPolicy = useMutation({
    mutationFn: async () => {
      if (!latestVersionId) throw new Error("Create a policy draft first.");
      if (policyReason.trim().length < 5) throw new Error("Enter a reason of at least 5 characters.");
      const { data, error } = await supabase.rpc("submit_financial_policy_version", {
        target_policy_version_id: latestVersionId,
        target_reason: policyReason.trim(),
        target_idempotency_key: createClientIdempotencyKey(
          "admin.lpg.station-affiliate.policy-submit",
          latestVersionId + ":" + policyReason.trim() + ":" + Date.now(),
        ),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      setPolicyReason("");
      setNotice("Commission policy submitted for independent approval.");
      await refresh();
    },
  });

  const reviewPolicy = useMutation({
    mutationFn: async (decision: "approved" | "rejected") => {
      if (!latestVersionId) throw new Error("No policy version is available to review.");
      if (policyReason.trim().length < 5) throw new Error("Enter a reason of at least 5 characters.");
      const { data, error } = await supabase.rpc("review_financial_policy_version", {
        target_policy_version_id: latestVersionId,
        target_decision: decision,
        target_reason: policyReason.trim(),
        target_idempotency_key: createClientIdempotencyKey(
          "admin.lpg.station-affiliate.policy-review",
          latestVersionId + ":" + decision + ":" + policyReason.trim() + ":" + Date.now(),
        ),
      });
      if (error) throw error;
      return { decision, data };
    },
    onSuccess: async ({ decision }) => {
      setPolicyReason("");
      setNotice(decision === "approved" ? "Commission policy approved." : "Commission policy rejected.");
      await refresh();
    },
  });

  const activatePolicy = useMutation({
    mutationFn: async () => {
      if (!latestVersionId) throw new Error("No policy version is available to activate.");
      if (policyReason.trim().length < 5) throw new Error("Enter a reason of at least 5 characters.");
      if (activeVersionId && activeVersionId !== latestVersionId) {
        throw new Error("Deactivate the current active version first. Policy versions are immutable and conflicting active windows are not allowed.");
      }
      const { data, error } = await supabase.rpc("activate_financial_policy_version", {
        target_policy_version_id: latestVersionId,
        target_reason: policyReason.trim(),
        target_idempotency_key: createClientIdempotencyKey(
          "admin.lpg.station-affiliate.policy-activate",
          latestVersionId + ":" + policyReason.trim() + ":" + Date.now(),
        ),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      setPolicyReason("");
      setNotice("Station Affiliate commission policy activated.");
      await refresh();
    },
  });

  const deactivatePolicy = useMutation({
    mutationFn: async () => {
      if (!activeVersionId) throw new Error("There is no active policy version.");
      if (policyReason.trim().length < 5) throw new Error("Enter a reason of at least 5 characters.");
      const { data, error } = await supabase.rpc("deactivate_financial_policy_version", {
        target_policy_version_id: activeVersionId,
        target_reason: policyReason.trim(),
        target_idempotency_key: createClientIdempotencyKey(
          "admin.lpg.station-affiliate.policy-deactivate",
          activeVersionId + ":" + policyReason.trim() + ":" + Date.now(),
        ),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      setPolicyReason("");
      setNotice("Active commission policy deactivated. A replacement policy can be activated after approval.");
      await refresh();
    },
  });

  const reviewAffiliate = useMutation({
    mutationFn: async (input: { id: string; decision: AffiliateDecision }) => {
      if (!props.canManageAffiliate) throw new Error("Affiliate management permission is required.");
      if (affiliateReason.trim().length < 5) throw new Error("Enter a review reason of at least 5 characters.");
      const { data, error } = await supabase.rpc("review_lpg_station_affiliate", {
        target_affiliate_id: input.id,
        target_decision: input.decision,
        target_reason: affiliateReason.trim(),
      });
      if (error) throw error;
      return { ...input, data };
    },
    onSuccess: async ({ decision }) => {
      setAffiliateReason("");
      setNotice("Affiliate request " + (decision === "active" ? "activated." : decision + "."));
      await refresh();
    },
  });

  const retryCommission = useMutation({
    mutationFn: async (orderId: string) => {
      if (!props.canRetryCommission) throw new Error("Financial and wallet management permissions are required.");
      if (retryReason.trim().length < 5) throw new Error("Enter a reason of at least 5 characters.");
      const { data, error } = await supabase.rpc("retry_lpg_station_affiliate_commission", {
        target_lpg_order_id: orderId,
        target_reason: retryReason.trim(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      setRetryReason("");
      setNotice("Affiliate commission retry completed.");
      await refresh();
    },
  });

  if (!props.canRead) {
    return <div className="admin-inline-warning"><strong>Access required.</strong> You need an approved platform operations, wallet, revenue, or financial-policy read permission to view Station Affiliate operations.</div>;
  }
  if (workspace.isPending) return <LoadingState label="Loading Station Affiliate programme…" />;
  if (workspace.error || !workspace.data) {
    return <ErrorState title="Station Affiliate administration unavailable" error={workspace.error} onRetry={() => void workspace.refetch()} />;
  }

  const affiliates = workspace.data.affiliates;
  const referrals = workspace.data.referrals;
  const earnings = workspace.data.earnings;
  const failures = workspace.data.commissionFailures;
  const policyVersionDisplay = latestVersionId
    ? "v" + (recordText(latestPolicy, "version") ?? "?") + " · " + normalizeStatusLabel(latestLifecycle ?? "draft")
    : "Not configured";
  const submitReady = Boolean(latestVersionId && latestLifecycle === "draft" && props.canDraftPolicy);
  const reviewReady = Boolean(latestVersionId && latestLifecycle === "submitted" && props.canApprovePolicy);
  const activateReady = Boolean(latestVersionId && latestLifecycle === "approved" && props.canActivatePolicy);
  const createDraftReady = !latestVersionId || ["active", "inactive", "rejected", "superseded"].includes(latestLifecycle ?? "");

  return (
    <div className="stack-lg">
      <section className="fulfillment-v2__metrics">
        <MetricTile label="Affiliate applicants" value={affiliates.length} icon={UsersRound} />
        <MetricTile label="Active affiliates" value={affiliates.filter((row) => recordText(row, "status") === "active").length} icon={CircleCheck} tone="success" />
        <MetricTile label="Station referrals" value={referrals.length} icon={Building2} />
        <MetricTile label="Posted commissions" value={earnings.filter((row) => recordText(row, "status") === "posted").length} icon={WalletCards} />
      </section>

      <section className="sk-panel stack-md">
        <div className="sk-panel__header">
          <div>
            <span className="section-kicker">Governed financial policy · Nigeria / NGN</span>
            <h2>Station Affiliate commission</h2>
            <p className="skima-muted">
              Configure the percentage paid from eligible SKIMA LPG platform revenue, the earning window and eligible revenue streams. Changes go through the existing draft → submit → independent approval → activation lifecycle; no unaudited direct edits are made to active policy versions.
            </p>
          </div>
          <StatusBadge tone={latestLifecycle === "active" ? "success" : latestLifecycle === "submitted" ? "warning" : "neutral"}>{policyVersionDisplay}</StatusBadge>
        </div>

        {hasActivePolicy ? (
          <div className="admin-inline-warning">
            <strong>Currently active:</strong> {Number(activeConfiguration.commission_percent ?? 0)}% for {Number(activeConfiguration.earning_period_months ?? 0)} months; eligible streams: {Array.isArray(activeConfiguration.eligible_revenue_streams) ? activeConfiguration.eligible_revenue_streams.join(", ") : "not configured"}.
            {activeConfiguration.program_enabled === false ? " The programme is currently disabled by policy." : ""}
          </div>
        ) : (
          <div className="admin-inline-warning"><strong>No active commission policy.</strong> Affiliates can be reviewed and referred stations tracked, but no commission will post until an approved policy version is activated.</div>
        )}

        <SelectInput label="Affiliate commission programme" value={policyEnabled ? "enabled" : "disabled"}
          onChange={(event) => setPolicyEnabled(event.currentTarget.value === "enabled")}
          options={[{ label: "Enabled after policy activation", value: "enabled" }, { label: "Disabled (no new commission accrual)", value: "disabled" }]}
          disabled={!props.canDraftPolicy || createPolicyDraft.isPending || !createDraftReady} />
        <TextInput label="Commission percentage of eligible net SKIMA revenue" value={commissionPercent}
          onChange={(event) => setCommissionPercent(event.currentTarget.value)} placeholder="5"
          disabled={!props.canDraftPolicy || createPolicyDraft.isPending || !createDraftReady} />
        <TextInput label="Earning window after station activation (months)" value={earningMonths}
          onChange={(event) => setEarningMonths(event.currentTarget.value)} placeholder="12"
          disabled={!props.canDraftPolicy || createPolicyDraft.isPending || !createDraftReady} />
        <SelectInput label="Eligible revenue streams" value={eligibleStreams}
          onChange={(event) => setEligibleStreams(event.currentTarget.value as "both" | "refill" | "delivery")}
          options={[
            { label: "Refill markup and delivery margin", value: "both" },
            { label: "Refill markup only", value: "refill" },
            { label: "Delivery margin only", value: "delivery" },
          ]}
          disabled={!props.canDraftPolicy || createPolicyDraft.isPending || !createDraftReady} />
        <TextInput label="Change reason / approval notes (required)" value={policyReason}
          onChange={(event) => setPolicyReason(event.currentTarget.value)}
          placeholder="e.g. Approve the launch commission rate for Nigeria"
          disabled={createPolicyDraft.isPending || submitPolicy.isPending || reviewPolicy.isPending || activatePolicy.isPending || deactivatePolicy.isPending} />
        {createDraftReady && props.canDraftPolicy ? (
          <Button disabled={createPolicyDraft.isPending || policyReason.trim().length < 5} isLoading={createPolicyDraft.isPending} onClick={() => createPolicyDraft.mutate()}>
            {programAlreadyConfigured ? "Create new policy draft" : "Create commission policy draft"}
          </Button>
        ) : null}
        {submitReady ? <Button disabled={submitPolicy.isPending || policyReason.trim().length < 5} isLoading={submitPolicy.isPending} onClick={() => submitPolicy.mutate()}>Submit policy for approval</Button> : null}
        {reviewReady ? (
          <div className="fulfillment-v2__action-row">
            <Button disabled={reviewPolicy.isPending || policyReason.trim().length < 5} isLoading={reviewPolicy.isPending} onClick={() => reviewPolicy.mutate("approved")}>Approve policy</Button>
            <Button variant="outline" disabled={reviewPolicy.isPending || policyReason.trim().length < 5} onClick={() => reviewPolicy.mutate("rejected")}>Reject policy</Button>
          </div>
        ) : null}
        {activateReady ? (
          <Button disabled={activatePolicy.isPending || policyReason.trim().length < 5 || Boolean(activeVersionId && activeVersionId !== latestVersionId)} isLoading={activatePolicy.isPending} onClick={() => activatePolicy.mutate()}>Activate approved policy</Button>
        ) : null}
        {activeVersionId && activeVersionId !== latestVersionId && props.canActivatePolicy ? (
          <Button variant="outline" disabled={deactivatePolicy.isPending || policyReason.trim().length < 5} isLoading={deactivatePolicy.isPending} onClick={() => deactivatePolicy.mutate()}>Deactivate current policy before replacing it</Button>
        ) : null}

        {notice ? <StatusBadge tone="success">{notice}</StatusBadge> : null}
        {createPolicyDraft.error ? <ErrorState title="Could not create commission draft" error={createPolicyDraft.error} /> : null}
        {submitPolicy.error ? <ErrorState title="Could not submit commission policy" error={submitPolicy.error} /> : null}
        {reviewPolicy.error ? <ErrorState title="Could not review commission policy" error={reviewPolicy.error} /> : null}
        {activatePolicy.error ? <ErrorState title="Could not activate commission policy" error={activatePolicy.error} /> : null}
        {deactivatePolicy.error ? <ErrorState title="Could not deactivate commission policy" error={deactivatePolicy.error} /> : null}
      </section>

      <section className="sk-panel stack-md">
        <div className="sk-panel__header"><div><span className="section-kicker">Affiliate governance</span><h2>Review affiliate applications</h2>
          <p className="skima-muted">Referral codes become usable only after activation. Self-referrals are rejected, and commission is calculated only after the referred station activates and eligible platform revenue is posted.</p>
        </div></div>
        <TextInput label="Review reason (required)" value={affiliateReason} onChange={(event) => setAffiliateReason(event.currentTarget.value)}
          placeholder="e.g. Identity and referral terms reviewed" disabled={!props.canManageAffiliate || reviewAffiliate.isPending} />
        {reviewAffiliate.error ? <ErrorState title="Could not update affiliate status" error={reviewAffiliate.error} /> : null}
        {affiliates.length ? affiliates.map((row) => {
          const id = recordText(row, "id") ?? "";
          const affiliateStatus = recordText(row, "status") ?? "pending";
          return (
            <div className="skima-list-row" key={id}>
              <div className="stack-xs">
                <strong>{recordText(row, "displayName") ?? "SKIMA affiliate"}</strong>
                <span className="skima-muted">Code {recordText(row, "referralCode") ?? "—"} · {Number(row.referralCount ?? 0)} station referrals · {Number(row.activeReferrals ?? 0)} activated · earned {money(Number(row.earned ?? 0), "NGN")}</span>
                {recordText(row, "reviewReason") ? <small className="skima-muted">Last review: {recordText(row, "reviewReason")}</small> : null}
              </div>
              <StatusBadge tone={affiliateStatus === "active" ? "success" : affiliateStatus === "pending" ? "warning" : "neutral"}>{normalizeStatusLabel(affiliateStatus)}</StatusBadge>
              {props.canManageAffiliate && affiliateStatus !== "rejected" ? (
                <div className="fulfillment-v2__action-row">
                  {affiliateStatus !== "active" ? <Button size="sm" disabled={!id || affiliateReason.trim().length < 5 || reviewAffiliate.isPending} onClick={() => reviewAffiliate.mutate({ id, decision: "active" })}>{affiliateStatus === "suspended" ? "Reactivate" : "Approve"}</Button> : null}
                  {affiliateStatus === "pending" ? <Button size="sm" variant="outline" disabled={!id || affiliateReason.trim().length < 5 || reviewAffiliate.isPending} onClick={() => reviewAffiliate.mutate({ id, decision: "rejected" })}>Reject</Button> : null}
                  {affiliateStatus === "active" ? <Button size="sm" variant="outline" disabled={!id || affiliateReason.trim().length < 5 || reviewAffiliate.isPending} onClick={() => reviewAffiliate.mutate({ id, decision: "suspended" })}>Suspend</Button> : null}
                </div>
              ) : null}
            </div>
          );
        }) : <p className="skima-muted">No affiliate applications have been received.</p>}
      </section>

      <section className="sk-panel stack-md">
        <div className="sk-panel__header"><div><span className="section-kicker">Referral pipeline</span><h2>Referred stations</h2></div></div>
        {referrals.length ? referrals.map((row, index) => (
          <div className="skima-list-row" key={recordText(row, "id") ?? ("referral-" + index)}>
            <div className="stack-xs">
              <strong>{recordText(row, "stationName") ?? "Station application"}</strong>
              <span className="skima-muted">{recordText(row, "affiliateName") ?? "Affiliate"} · {recordText(row, "referralCode") ?? "—"}</span>
            </div>
            <StatusBadge tone={recordText(row, "status") === "activated" ? "success" : "neutral"}>{normalizeStatusLabel(recordText(row, "status") ?? "submitted")}</StatusBadge>
            <span>{money(Number(row.earnings ?? 0), "NGN")} earned</span>
          </div>
        )) : <p className="skima-muted">No referred station applications yet.</p>}
      </section>

      <section className="sk-panel stack-md">
        <div className="sk-panel__header"><div><span className="section-kicker">Ledger-backed earnings</span><h2>Affiliate commissions</h2>
          <p className="skima-muted">These entries are posted only against eligible SKIMA revenue credits and a locked policy version.</p>
        </div></div>
        {earnings.length ? earnings.map((row, index) => (
          <div className="skima-list-row" key={recordText(row, "id") ?? recordText(row, "orderId") ?? ("earning-" + index)}>
            <div className="stack-xs">
              <strong>{recordText(row, "affiliateName") ?? "Affiliate"} · {recordText(row, "stationName") ?? "Station"}</strong>
              <span className="skima-muted">{recordText(row, "publicReference") ?? recordText(row, "orderId") ?? "LPG order"} · {recordText(row, "policyVersion") ? "Policy v" + recordText(row, "policyVersion") : "policy version recorded"}</span>
            </div>
            <span>{money(Number(row.amount ?? 0), recordText(row, "currencyCode") ?? "NGN")}</span>
            <StatusBadge tone={recordText(row, "status") === "posted" ? "success" : "neutral"}>{normalizeStatusLabel(recordText(row, "status") ?? "pending")}</StatusBadge>
          </div>
        )) : <p className="skima-muted">No affiliate commissions have posted yet.</p>}
      </section>

      <section className="sk-panel stack-md">
        <div className="sk-panel__header"><div><span className="section-kicker">Exception queue</span><h2>Commission posting failures</h2>
          <p className="skima-muted">A failed posting is held for review rather than silently being marked paid.</p>
        </div></div>
        <TextInput label="Reason for retry (required)" value={retryReason} onChange={(event) => setRetryReason(event.currentTarget.value)}
          placeholder="e.g. Rechecked revenue wallet and policy validity" disabled={!props.canRetryCommission || retryCommission.isPending} />
        {retryCommission.error ? <ErrorState title="Could not retry affiliate commission" error={retryCommission.error} /> : null}
        {failures.length ? failures.map((row, index) => {
          const orderId = recordText(row, "orderId") ?? "";
          return (
            <div className="skima-list-row" key={recordText(row, "id") ?? (orderId || "failure-" + index)}>
              <div className="stack-xs">
                <strong>{recordText(row, "publicReference") ?? orderId}</strong>
                <span className="skima-muted">{recordText(row, "lastError") ?? "Commission posting failed"} · {Number(row.attemptCount ?? 1)} attempts</span>
              </div>
              <Button size="sm" variant="outline" disabled={!props.canRetryCommission || !orderId || retryReason.trim().length < 5 || retryCommission.isPending}
                isLoading={retryCommission.isPending && retryCommission.variables === orderId}
                onClick={() => retryCommission.mutate(orderId)}>Retry posting</Button>
            </div>
          );
        }) : <p className="skima-muted">No unresolved affiliate commission failures.</p>}
      </section>
    </div>
  );
}

function recordObject(value: unknown, key: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const child = (value as Record<string, unknown>)[key];
  return child && typeof child === "object" && !Array.isArray(child) ? child as Record<string, unknown> : {};
}

function recordText(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const child = (value as Record<string, unknown>)[key];
  return typeof child === "string" || typeof child === "number" ? String(child) : null;
}

function DriverPaySection(props: {
  readonly configuration: z.infer<typeof ConfigSchema>;
  readonly canManage: boolean;
  readonly onSaved: () => Promise<void>;
}) {
  const { supabase } = useSessionState();
  const currentPercent = nestedNumber(props.configuration.driverCompensation, ["configuration", "percentage"]);
  const [percentage, setPercentage] = useState(currentPercent === null ? "" : String(currentPercent));
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const next = nestedNumber(props.configuration.driverCompensation, ["configuration", "percentage"]);
    setPercentage(next === null ? "" : String(next));
  }, [props.configuration.driverCompensation]);

  const save = useMutation({
    mutationFn: async () => {
      const value = Number(percentage);
      if (!Number.isFinite(value) || value <= 0 || value > 100) throw new Error("Enter a Driver share greater than 0 and no more than 100 percent.");
      const { error } = await supabase.rpc("set_lpg_internal_driver_compensation", {
        target_idempotency_key: createClientIdempotencyKey("admin.fulfillment.driver-pay", String(value)),
        target_percentage: value,
        target_reason: "Admin updated SKIMA Managed Driver delivery share",
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setNotice("Managed Driver pay rate saved.");
      await props.onSaved();
    },
  });

  return (
    <section className="sk-panel stack-md fulfillment-v2__single-task">
      <div className="sk-panel__header">
        <div>
          <span className="section-kicker">Managed Driver pay</span>
          <h2>Set the Driver share for SKIMA Fleet deliveries</h2>
          <p className="skima-muted">This percentage is applied to the delivery fee for new SKIMA-managed orders. Completed earnings are paid later through Managed Driver Payroll.</p>
        </div>
        <StatusBadge tone={currentPercent ? "success" : "warning"}>{currentPercent ? `${currentPercent}% now` : "Not set"}</StatusBadge>
      </div>

      <div className="fulfillment-v2__compact-form">
        <TextInput label="Driver share of delivery fee (%)" type="number" min="0" max="100" step="0.01" value={percentage} onChange={(event) => setPercentage(event.currentTarget.value)} placeholder="Example: 40" />
      </div>

      {notice ? <StatusBadge tone="success">{notice}</StatusBadge> : null}
      {save.error ? <ErrorState title="Could not save Driver pay" error={save.error} /> : null}
      <Button disabled={!props.canManage || save.isPending} isLoading={save.isPending} onClick={() => save.mutate()}>Save Driver pay</Button>
    </section>
  );
}

function LpgPriceSection(props: { readonly canManage: boolean; readonly onSaved: () => Promise<void> }) {
  const { supabase, status } = useSessionState();
  const [areaKey, setAreaKey] = useState("");
  const [price, setPrice] = useState("");
  const [routeKm, setRouteKm] = useState("");
  const [variance, setVariance] = useState("10");
  const [notice, setNotice] = useState<string | null>(null);

  const areas = useQuery({
    queryKey: ["lpg-internal-service-area-options"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_lpg_internal_service_area_options");
      if (error) throw error;
      return AreaListSchema.parse(data ?? []);
    },
  });

  const selected = useMemo(() => areas.data?.find((area) => area.key === areaKey) ?? null, [areaKey, areas.data]);

  useEffect(() => {
    if (!areaKey && areas.data?.length) setAreaKey(areas.data[0].key);
  }, [areaKey, areas.data]);

  useEffect(() => {
    if (!selected) return;
    setPrice(selected.referencePricePerKg === null ? "" : String(selected.referencePricePerKg));
    setRouteKm(selected.estimatedRouteKm === null ? "" : String(selected.estimatedRouteKm));
    setVariance(selected.maxSupplierVariancePercent === null ? "10" : String(selected.maxSupplierVariancePercent));
  }, [selected]);

  const save = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Choose a service area.");
      const priceValue = Number(price);
      const routeValue = Number(routeKm);
      const varianceValue = Number(variance);
      if (!Number.isFinite(priceValue) || priceValue <= 0) throw new Error("Enter a valid LPG buying price per kg.");
      if (!Number.isFinite(routeValue) || routeValue < 0) throw new Error("Enter a valid estimated route distance.");
      if (!Number.isFinite(varianceValue) || varianceValue < 0 || varianceValue > 100) throw new Error("Maximum supplier price difference must be between 0 and 100 percent.");
      const { error } = await supabase.rpc("set_lpg_internal_reference_price", {
        target_estimated_route_km: routeValue,
        target_geography_key: selected.key,
        target_geography_type: "service_area",
        target_idempotency_key: createClientIdempotencyKey("admin.fulfillment.lpg-price", `${selected.key}:${priceValue}:${routeValue}:${varianceValue}`),
        target_max_supplier_variance_percent: varianceValue,
        target_price_per_kg: priceValue,
        target_reason: `Admin updated the SKIMA LPG buying reference for ${selected.label}`,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setNotice(`${selected?.label ?? "Service area"} LPG buying price saved.`);
      await Promise.all([areas.refetch(), props.onSaved()]);
    },
  });

  if (areas.isPending) return <LoadingState label="Loading service areas…" />;
  if (areas.error) return <ErrorState title="Service areas unavailable" error={areas.error} onRetry={() => void areas.refetch()} />;

  return (
    <section className="sk-panel stack-md fulfillment-v2__single-task">
      <div className="sk-panel__header">
        <div>
          <span className="section-kicker">Local LPG buying price</span>
          <h2>Set SKIMA's reference price for one service area</h2>
          <p className="skima-muted">Prices can differ by geography. Choose an area, set the local LPG buying reference, and save. Existing paid orders keep their original quote.</p>
        </div>
        <StatusBadge tone={selected?.priceConfigured ? "success" : "warning"}>{selected?.priceConfigured ? "Configured" : "Needs price"}</StatusBadge>
      </div>

      <div className="fulfillment-v2__compact-form">
        <SelectInput label="Service area" value={areaKey} onChange={(event) => setAreaKey(event.currentTarget.value)} options={(areas.data ?? []).map((area) => ({ label: areaLabel(area), value: area.key }))} />
        <TextInput label="LPG buying reference (₦ per kg)" type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.currentTarget.value)} placeholder="Example: 1400" />
        <TextInput label="Typical total route distance (km)" type="number" min="0" step="0.1" value={routeKm} onChange={(event) => setRouteKm(event.currentTarget.value)} placeholder="Example: 8" />
        <TextInput label="Maximum supplier price difference (%)" type="number" min="0" max="100" step="0.1" value={variance} onChange={(event) => setVariance(event.currentTarget.value)} placeholder="Example: 10" />
      </div>

      {notice ? <StatusBadge tone="success">{notice}</StatusBadge> : null}
      {save.error ? <ErrorState title="Could not save LPG price" error={save.error} /> : null}
      <Button disabled={!props.canManage || !selected || save.isPending} isLoading={save.isPending} onClick={() => save.mutate()}>Save area price</Button>
    </section>
  );
}

function ManagedTeamSection(props: {
  readonly readiness: z.infer<typeof ReadinessSchema>;
  readonly onNavigate: (href: string) => void;
}) {
  const actions = [
    {
      title: "Managed Drivers",
      detail: `${props.readiness.managedApprovedDriverCount} approved Managed Driver${props.readiness.managedApprovedDriverCount === 1 ? "" : "s"}`,
      button: "Manage Drivers",
      href: "/partners/drivers",
      icon: UsersRound,
      ready: props.readiness.managedApprovedDriverCount > 0,
    },
    {
      title: "SKIMA Fleet",
      detail: `${props.readiness.vehicleReadyDriverCount} Managed Driver${props.readiness.vehicleReadyDriverCount === 1 ? "" : "s"} with a service-ready SKIMA vehicle`,
      button: "Manage SKIMA vehicles",
      href: "/partners/fleet",
      icon: Truck,
      ready: props.readiness.vehicleReadyDriverCount > 0,
    },
    {
      title: "Driver service areas",
      detail: `${props.readiness.coverageReadyDriverCount} Managed Driver${props.readiness.coverageReadyDriverCount === 1 ? "" : "s"} with approved LPG coverage`,
      button: "Manage coverage",
      href: "/operations/managed-driver-coverage",
      icon: MapPinned,
      ready: props.readiness.coverageReadyDriverCount > 0,
    },
    {
      title: "Driver Payroll",
      detail: "Pay approved Managed Driver earnings into their normal SKIMA Wallets.",
      button: "Open payroll",
      href: "/money/managed-driver-payroll",
      icon: WalletCards,
      ready: true,
    },
  ] as const;

  return (
    <section className="sk-panel stack-md">
      <div className="sk-panel__header">
        <div>
          <span className="section-kicker">Managed fulfillment team</span>
          <h2>Drivers, SKIMA vehicles and service areas</h2>
          <p className="skima-muted">These are separate operational records. Open the task you need instead of managing all of them inside this pricing screen.</p>
        </div>
      </div>
      <div className="fulfillment-v2__action-grid">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <div className="sk-panel stack-sm" key={action.title}>
              <div className="fulfillment-v2__action-title"><Icon aria-hidden="true" /><strong>{action.title}</strong><StatusBadge tone={action.ready ? "success" : "warning"}>{action.ready ? "Ready" : "Needs setup"}</StatusBadge></div>
              <p className="skima-muted">{action.detail}</p>
              <Button variant="outline" onClick={() => props.onNavigate(action.href)}>{action.button}</Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ActivitySection(props: { readonly onNavigate: (href: string) => void }) {
  const { supabase, status } = useSessionState();
  const financials = useQuery({
    queryKey: ["lpg-launch-assurance-financials"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_lpg_internal_operations_financials", {
        target_driver_profile_id: null,
        target_limit: 10,
      });
      if (error) throw error;
      return FinancialsSchema.parse(data);
    },
  });
  const payouts = useQuery({
    queryKey: ["lpg-managed-driver-payouts"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_lpg_managed_driver_payouts", {
        target_driver_profile_id: null,
        target_limit: 8,
      });
      if (error) throw error;
      return PayoutListSchema.parse(data ?? []);
    },
  });

  if (financials.isPending || payouts.isPending) return <LoadingState label="Loading fulfillment activity…" />;
  const error = financials.error ?? payouts.error;
  if (error) return <ErrorState title="Fulfillment activity unavailable" error={error} onRetry={() => void Promise.all([financials.refetch(), payouts.refetch()])} />;

  const procurements = financials.data?.procurements ?? [];

  return (
    <div className="fulfillment-v2__activity-grid">
      <section className="sk-panel stack-md">
        <div className="sk-panel__header"><div><span className="section-kicker">Supplier activity</span><h2>Recent LPG purchases</h2></div></div>
        {procurements.length ? procurements.slice(0, 8).map((row) => (
          <div className="skima-list-row" key={String(row.id)}>
            <strong>{String(row.supplierName ?? "Supplier")}</strong>
            <span>{money(Number(row.procurementAmount ?? 0))} · {String(row.actualKg ?? "—")} kg · {normalizeStatusLabel(String(row.status ?? "recorded"))}</span>
          </div>
        )) : <p className="skima-muted">No SKIMA Fleet supplier purchase has been recorded yet.</p>}
      </section>

      <section className="sk-panel stack-md">
        <div className="sk-panel__header"><div><span className="section-kicker">Driver payments</span><h2>Recent wallet payments</h2></div></div>
        {(payouts.data ?? []).length ? payouts.data!.map((row) => (
          <div className="skima-list-row" key={row.payoutId}>
            <strong>{row.displayName}</strong>
            <span>{money(row.amount, row.currencyCode)} · {normalizeStatusLabel(row.status)} · {formatDate(row.paidAt)}</span>
          </div>
        )) : <p className="skima-muted">No Managed Driver payment has been made yet.</p>}
        <Button variant="outline" onClick={() => props.onNavigate("/money/managed-driver-payroll")}>Open Managed Driver Payroll</Button>
      </section>
    </div>
  );
}

function sectionFromRoute(route: string): FulfillmentSection {
  if (route === BASE || route === `${BASE}/overview`) return "overview";
  const suffix = route.slice(BASE.length + 1);
  if (sections.some((item) => item.key === suffix)) return suffix as FulfillmentSection;
  return "overview";
}

function sectionHref(section: FulfillmentSection): string {
  return section === "overview" ? BASE : `${BASE}/${section}`;
}

function nestedNumber(value: unknown, path: readonly string[]): number | null {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  const number = Number(current);
  return Number.isFinite(number) ? number : null;
}

function areaLabel(area: ServiceArea): string {
  const detail = area.townName ?? area.cityName ?? area.lgaName ?? area.stateName;
  return detail && detail.toLowerCase() !== area.label.toLowerCase() ? `${area.label} · ${detail}` : area.label;
}

function availabilityLabel(mode: FulfillmentMode): string {
  if (mode === "marketplace_only") return "Partner Network only";
  if (mode === "internal_only") return "SKIMA Fleet only";
  return "Partner Network + SKIMA Fleet";
}

function friendlyReason(reason: string): string {
  return reason
    .replace(/internal driver compensation percentage/gi, "Managed Driver pay rate")
    .replace(/service-area internal LPG reference price/gi, "local LPG buying price")
    .replace(/managed driver/gi, "Managed Driver")
    .replace(/operational coverage/gi, "service-area coverage");
}

function money(value: number, currency = "NGN") {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}
