import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, BadgeDollarSign, Boxes, PlugZap, RefreshCcw, ServerCog, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button, ErrorState, LoadingState, MetricTile, SelectInput, StatusBadge, TextInput } from "@skima/ui";

import { useSessionState } from "../../session";
import { AdminV2PageHeader } from "../../shared/patterns/AdminV2Patterns";
import {
  UtilitySnapshotSchema,
  formatUtilityNaira,
  utilityError,
  utilityFlag,
  utilityNumber,
  utilityNumeric,
  utilityText,
} from "./utility-billing-v2-shared";

const BASE = "/services/utility-billing";

export function UtilitySimpleDashboard(props: { onNavigate: (href: string) => void }) {
  const { status, supabase } = useSessionState();
  const snapshot = useQuery({
    queryKey: ["admin-utility-billing-simple"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_utility_admin_configuration");
      if (error) throw new Error(error.message);
      return UtilitySnapshotSchema.parse(data);
    },
  });

  if (snapshot.isLoading) return <LoadingState label="Loading utility billing" />;
  if (snapshot.error || !snapshot.data) {
    return <ErrorState title="Utility billing unavailable" message={snapshot.error?.message ?? "Utility billing could not be loaded."} onRetry={() => void snapshot.refetch()} />;
  }

  return (
    <UtilitySimpleDashboardContent
      data={snapshot.data}
      refresh={async () => { await snapshot.refetch(); }}
      onNavigate={props.onNavigate}
    />
  );
}

function UtilitySimpleDashboardContent(props: {
  data: ReturnType<typeof UtilitySnapshotSchema.parse>;
  refresh: () => Promise<void>;
  onNavigate: (href: string) => void;
}) {
  const { supabase } = useSessionState();
  const provider = props.data.providers.find((item) => utilityText(item, "status") !== "disabled") ?? props.data.providers[0] ?? null;
  const serviceFee = props.data.serviceFees.find((item) => utilityText(item, "currency_code") === "NGN") ?? props.data.serviceFees[0] ?? null;

  const [feePercent, setFeePercent] = useState(String(utilityNumber(serviceFee, "fee_percent")));
  const [feeFixed, setFeeFixed] = useState(String(utilityNumber(serviceFee, "fee_fixed")));
  const [feeStatus, setFeeStatus] = useState(utilityText(serviceFee, "status") || "active");

  const [selectedProviderKey, setSelectedProviderKey] = useState(utilityText(provider, "key"));
  const selectedProvider = props.data.providers.find((item) => utilityText(item, "key") === selectedProviderKey) ?? provider;
  const selectedTreasury = props.data.treasury.find((item) => utilityText(item, "provider_key") === selectedProviderKey) ?? null;
  const [currentBalance, setCurrentBalance] = useState(selectedTreasury?.["last_known_balance"] == null ? "" : String(utilityNumber(selectedTreasury, "last_known_balance")));
  const [lowThreshold, setLowThreshold] = useState(selectedTreasury?.["low_balance_threshold"] == null ? "" : String(utilityNumber(selectedTreasury, "low_balance_threshold")));
  const [targetBalance, setTargetBalance] = useState(selectedTreasury?.["target_balance"] == null ? "" : String(utilityNumber(selectedTreasury, "target_balance")));

  useEffect(() => {
    setFeePercent(String(utilityNumber(serviceFee, "fee_percent")));
    setFeeFixed(String(utilityNumber(serviceFee, "fee_fixed")));
    setFeeStatus(utilityText(serviceFee, "status") || "active");
  }, [serviceFee]);

  useEffect(() => {
    setCurrentBalance(selectedTreasury?.["last_known_balance"] == null ? "" : String(utilityNumber(selectedTreasury, "last_known_balance")));
    setLowThreshold(selectedTreasury?.["low_balance_threshold"] == null ? "" : String(utilityNumber(selectedTreasury, "low_balance_threshold")));
    setTargetBalance(selectedTreasury?.["target_balance"] == null ? "" : String(utilityNumber(selectedTreasury, "target_balance")));
  }, [selectedTreasury]);

  const saveFee = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("set_utility_service_fee", {
        target_currency_code: "NGN",
        target_fee_percent: Math.max(0, utilityNumeric(feePercent)),
        target_fee_fixed: Math.max(0, utilityNumeric(feeFixed)),
        target_status: feeStatus,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: props.refresh,
  });

  const saveTreasury = useMutation({
    mutationFn: async () => {
      if (!selectedProviderKey) throw new Error("Choose a utility provider first.");
      const low = lowThreshold.trim() === "" ? null : Math.max(0, utilityNumeric(lowThreshold));
      const target = targetBalance.trim() === "" ? null : Math.max(0, utilityNumeric(targetBalance));
      const policy = await supabase.rpc("set_utility_provider_treasury_policy", {
        target_provider_key: selectedProviderKey,
        target_low_balance_threshold: low,
        target_target_balance: target,
      });
      if (policy.error) throw new Error(policy.error.message);
      if (currentBalance.trim() !== "") {
        const balance = await supabase.rpc("record_utility_provider_balance", {
          target_provider_key: selectedProviderKey,
          target_balance: Math.max(0, utilityNumeric(currentBalance)),
          target_currency_code: "NGN",
          target_source: "skima.admin.utility_billing.manual_balance",
        });
        if (balance.error) throw new Error(balance.error.message);
      }
    },
    onSuccess: props.refresh,
  });

  const readyProviders = props.data.providers.filter((item) => utilityFlag(item, "runtime_ready")).length;
  const activeRoutes = props.data.routes.filter((item) => utilityText(item, "status") === "active").length;
  const unresolved = props.data.payments.filter((item) => ["processing", "reconciliation_required"].includes(utilityText(item, "status"))).length;
  const balanceLow = selectedTreasury?.["balance_low"] === true;
  const lastKnownBalance = selectedTreasury?.["last_known_balance"] == null ? null : utilityNumber(selectedTreasury, "last_known_balance");
  const recommendedTopUp = selectedTreasury?.["recommended_top_up"] == null ? null : utilityNumber(selectedTreasury, "recommended_top_up");

  const providerOptions = useMemo(() => [
    { label: "Choose provider", value: "" },
    ...props.data.providers.map((item) => ({ label: utilityText(item, "display_name") || utilityText(item, "key"), value: utilityText(item, "key") })).filter((item) => item.value),
  ], [props.data.providers]);

  return (
    <div className="utility-v2 utility-v2__screen">
      <AdminV2PageHeader
        eyebrow="Services · Utility billing"
        title="Utility billing control center"
        description="Use the simple controls here for normal operations. Provider API mapping, route economics and campaign controls remain available under Advanced setup."
        actions={<Button icon={RefreshCcw} variant="outline" onClick={() => void props.refresh()}>Refresh</Button>}
      />

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Providers ready" value={`${readyProviders}/${props.data.providers.length}`} icon={ServerCog} tone={readyProviders ? "success" : "warning"} />
        <MetricTile label="Utility plans" value={props.data.products.length} icon={Boxes} tone={props.data.products.length ? "success" : "info"} />
        <MetricTile label="Active services" value={activeRoutes} icon={PlugZap} tone={activeRoutes ? "success" : "warning"} />
        <MetricTile label="Needs reconciliation" value={unresolved} icon={Activity} tone={unresolved ? "warning" : "success"} />
      </section>

      <section className="sk-panel utility-v2__form-card">
        <div className="sk-panel__header">
          <div>
            <h2>SKIMA utility service fee</h2>
            <p className="skima-muted">This is an optional SKIMA fee added on top of the bill amount and provider economics. It starts at 0 and takes effect immediately for new utility purchases after saving.</p>
          </div>
          <StatusBadge tone={utilityNumeric(feePercent) > 0 || utilityNumeric(feeFixed) > 0 ? "warning" : "success"}>{utilityNumeric(feePercent) > 0 || utilityNumeric(feeFixed) > 0 ? "Fee enabled" : "No extra fee"}</StatusBadge>
        </div>
        <div className="skima-form-grid">
          <TextInput label="Fee percentage (%)" type="number" value={feePercent} onChange={(event) => setFeePercent(event.currentTarget.value)} />
          <TextInput label="Fixed fee (₦)" type="number" value={feeFixed} onChange={(event) => setFeeFixed(event.currentTarget.value)} />
          <SelectInput label="Fee status" value={feeStatus} onChange={(event) => setFeeStatus(event.currentTarget.value)} options={[{ label: "Active", value: "active" }, { label: "Inactive", value: "inactive" }]} />
        </div>
        <p className="skima-muted">Example: 0% + ₦0 keeps customer pricing unchanged. This fee is separate from provider cost, provider discount/commission and route-specific economics.</p>
        <Button icon={BadgeDollarSign} isLoading={saveFee.isPending} onClick={() => saveFee.mutate()}>Save utility fee</Button>
        {saveFee.error ? <StatusBadge tone="danger">{utilityError(saveFee.error)}</StatusBadge> : null}
      </section>

      <section className="sk-panel utility-v2__form-card">
        <div className="sk-panel__header">
          <div>
            <h2>Provider float</h2>
            <p className="skima-muted">Track the money SKIMA keeps with the utility provider so you know when to replenish it. Customer SKIMA Wallet balances remain separate.</p>
          </div>
          <StatusBadge tone={balanceLow ? "danger" : lastKnownBalance == null ? "warning" : "success"}>{balanceLow ? "Low balance" : lastKnownBalance == null ? "Balance not recorded" : "Float tracked"}</StatusBadge>
        </div>

        <div className="skima-form-grid">
          <SelectInput label="Utility provider" value={selectedProviderKey} onChange={(event) => setSelectedProviderKey(event.currentTarget.value)} options={providerOptions} />
          <TextInput label="Current provider balance (₦)" type="number" value={currentBalance} onChange={(event) => setCurrentBalance(event.currentTarget.value)} placeholder="Record from provider dashboard" />
          <TextInput label="Low-balance alert at (₦)" type="number" value={lowThreshold} onChange={(event) => setLowThreshold(event.currentTarget.value)} placeholder="e.g. 10000" />
          <TextInput label="Target provider balance (₦)" type="number" value={targetBalance} onChange={(event) => setTargetBalance(event.currentTarget.value)} placeholder="e.g. 50000" />
        </div>

        <div className="utility-v2__review-grid">
          <div><small>Last known balance</small><strong>{lastKnownBalance == null ? "Not recorded" : formatUtilityNaira(lastKnownBalance)}</strong></div>
          <div><small>Recommended top-up</small><strong>{recommendedTopUp == null ? "Set target balance" : formatUtilityNaira(recommendedTopUp)}</strong></div>
          <div><small>Provider spend today</small><strong>{formatUtilityNaira(utilityNumber(selectedTreasury, "provider_spend_today"))}</strong></div>
          <div><small>Provider spend · 7 days</small><strong>{formatUtilityNaira(utilityNumber(selectedTreasury, "provider_spend_7d"))}</strong></div>
          <div><small>Pending provider cost</small><strong>{formatUtilityNaira(utilityNumber(selectedTreasury, "pending_provider_cost"))}</strong></div>
          <div><small>Provider runtime</small><strong>{utilityFlag(selectedProvider, "runtime_ready") ? "Ready" : "Not ready"}</strong></div>
        </div>

        <Button icon={WalletCards} isLoading={saveTreasury.isPending} disabled={!selectedProviderKey} onClick={() => saveTreasury.mutate()}>Save float settings</Button>
        {saveTreasury.error ? <StatusBadge tone="danger">{utilityError(saveTreasury.error)}</StatusBadge> : null}
      </section>

      <section className="sk-panel">
        <div className="sk-panel__header">
          <div><h2>Setup and operations</h2><p className="skima-muted">The normal path is intentionally short. Open technical screens only when you need to connect or tune a provider.</p></div>
        </div>
        <div className="utility-v2__setup-grid">
          <QuickAction title="1. Provider" description="Connect or switch a provider and keep its secret server-side." action="Open providers" onClick={() => props.onNavigate(`${BASE}/providers`)} />
          <QuickAction title="2. Services" description="Import or review airtime, data and electricity plans." action="Open catalogue" onClick={() => props.onNavigate(`${BASE}/catalogue`)} />
          <QuickAction title="3. Pricing" description="Advanced provider margin, costs and protected-profit rules." action="Open economics" onClick={() => props.onNavigate(`${BASE}/economics`)} />
          <QuickAction title="4. Go live" description="Route products, run a small real-money test, then activate." action="Open routing" onClick={() => props.onNavigate(`${BASE}/routing`)} />
          <QuickAction title="Payments" description="Review completed, processing and reconciliation-required bills." action="Open operations" onClick={() => props.onNavigate(`${BASE}/operations`)} />
          <QuickAction title="Advanced" description="Campaigns, technical mapping and legacy/manual controls." action="Advanced setup" onClick={() => props.onNavigate(`${BASE}/advanced`)} />
        </div>
      </section>
    </div>
  );
}

function QuickAction(props: { title: string; description: string; action: string; onClick: () => void }) {
  return (
    <article className="utility-v2__setup-step">
      <div><strong>{props.title}</strong><p>{props.description}</p></div>
      <Button size="sm" variant="outline" onClick={props.onClick}>{props.action}</Button>
    </article>
  );
}
