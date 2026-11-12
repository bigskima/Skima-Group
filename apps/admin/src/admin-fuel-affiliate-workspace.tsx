import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, CircleCheck, WalletCards } from "lucide-react";
import { useEffect, useState } from "react";

import { createClientIdempotencyKey, normalizeStatusLabel } from "@skima/frontend-core";
import { Button, ErrorState, LoadingState, MetricTile, SelectInput, StatusBadge, TextInput } from "@skima/ui";
import { useSessionState } from "./session";

type Row = Record<string, unknown>;
type Workspace = {
  policy: { latestVersion?: Row | null; activeVersion?: Row | null } | null;
  affiliates: Row[];
  referrals: Row[];
  earnings: Row[];
  commissionFailures: Row[];
  reversalFailures: Row[];
};

function value(row: Row | null | undefined, key: string): string | null {
  return typeof row?.[key] === "string" ? row[key] as string : null;
}
function objectValue(row: Row | null | undefined, key: string): Row {
  const item = row?.[key];
  return item && typeof item === "object" && !Array.isArray(item) ? item as Row : {};
}
function amount(row: Row, key: string): number {
  const number = Number(row[key] ?? 0);
  return Number.isFinite(number) ? number : 0;
}
function money(number: number, currency = "NGN"): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number);
}
function rows(source: unknown, key: string): Row[] {
  const raw = source && typeof source === "object" && !Array.isArray(source) ? (source as Row)[key] : [];
  return Array.isArray(raw) ? raw.filter((item): item is Row => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

export function AdminFuelAffiliateWorkspace(props: {
  readonly canRead: boolean;
  readonly canManageAffiliate: boolean;
  readonly canDraftPolicy: boolean;
  readonly canApprovePolicy: boolean;
  readonly canActivatePolicy: boolean;
  readonly canRetryCommission: boolean;
}) {
  const { supabase, status } = useSessionState();
  const client = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [commissionPercent, setCommissionPercent] = useState("");
  const [earningMonths, setEarningMonths] = useState("");
  const [policyReason, setPolicyReason] = useState("");
  const [affiliateReason, setAffiliateReason] = useState("");
  const [retryReason, setRetryReason] = useState("");
  const [reversalReason, setReversalReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const workspace = useQuery<Workspace>({
    queryKey: ["fuel-station-affiliate-admin-workspace"],
    enabled: props.canRead && status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_fuel_station_affiliate_admin_workspace");
      if (error) throw error;
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Fuel Affiliate workspace returned an invalid response.");
      const policyRaw = (data as Row).policy;
      const policy = policyRaw && typeof policyRaw === "object" && !Array.isArray(policyRaw)
        ? policyRaw as Workspace["policy"] : null;
      return {
        policy,
        affiliates: rows(data, "affiliates"),
        referrals: rows(data, "referrals"),
        earnings: rows(data, "earnings"),
        commissionFailures: rows(data, "commissionFailures"),
        reversalFailures: rows(data, "reversalFailures"),
      };
    },
  });

  const latestPolicy = workspace.data?.policy?.latestVersion ?? null;
  const activePolicy = workspace.data?.policy?.activeVersion ?? null;
  const latestVersionId = value(latestPolicy, "id");
  const latestLifecycle = value(latestPolicy, "lifecycle_status") ?? "";
  const activeVersionId = value(activePolicy, "id");
  const activeConfiguration = objectValue(activePolicy, "configuration");
  const hasActivePolicy = Boolean(activeVersionId);
  const createDraftReady = !latestVersionId || ["active", "inactive", "rejected", "superseded"].includes(latestLifecycle);
  const submitReady = Boolean(latestVersionId && latestLifecycle === "draft" && props.canDraftPolicy);
  const reviewReady = Boolean(latestVersionId && latestLifecycle === "submitted" && props.canApprovePolicy);
  const activateReady = Boolean(latestVersionId && latestLifecycle === "approved" && props.canActivatePolicy);

  useEffect(() => {
    const policyRecord = latestPolicy ?? activePolicy;
    if (!policyRecord) return;
    const configuration = objectValue(policyRecord, "configuration");
    const programEnabled = configuration.program_enabled;
    const rate = Number(configuration.commission_percent);
    const months = Number(configuration.earning_period_months);
    if (typeof programEnabled === "boolean") setEnabled(programEnabled);
    if (Number.isFinite(rate) && rate > 0) setCommissionPercent(String(rate));
    if (Number.isInteger(months) && months >= 1) setEarningMonths(String(months));
  }, [latestPolicy, activePolicy]);

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["fuel-station-affiliate-admin-workspace"] });
  };

  const draft = useMutation({
    mutationFn: async () => {
      if (policyReason.trim().length < 5) throw new Error("Enter a policy reason of at least five characters.");
      const rate = Number(commissionPercent);
      const months = Number(earningMonths);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100 || (enabled && rate <= 0)) {
        throw new Error("Commission must be from 0 to 100%; set a positive rate when enabled.");
      }
      if (!Number.isInteger(months) || months < 1 || months > 36) {
        throw new Error("Earning period must be a whole number from 1 to 36 months.");
      }
      const configuration = {
        program_enabled: enabled,
        commission_percent: rate,
        earning_period_months: months,
        eligible_revenue_streams: ["platform_fee"],
      };
      const { data, error } = await supabase.rpc("create_financial_policy_version", {
        target_policy_key: "commission.fuel.station_affiliate",
        target_display_name: "Fuel Station Affiliate Commission",
        target_policy_family: "affiliate",
        target_currency_code: "NGN",
        target_configuration: configuration,
        target_effective_from: new Date().toISOString(),
        target_change_reason: policyReason.trim(),
        target_idempotency_key: createClientIdempotencyKey("admin.fuel.station-affiliate.policy-draft", JSON.stringify(configuration) + ":" + policyReason.trim()),
        target_module_key: "fuel",
        target_organization_id: null,
        target_service_key: "fuel.station.affiliate",
        target_geography_type: "country",
        target_geography_key: "NG",
        target_effective_until: null,
        target_priority: 100,
        target_approval_required: true,
        target_allow_partner_delegation: false,
        target_based_on_version_id: activeVersionId,
        target_supersedes_version_id: activeVersionId,
        target_rollback_of_version_id: null,
        target_metadata: { module: "fuel", programme: "station_affiliate", createdFrom: "admin-fuel-affiliate-workspace" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => { setPolicyReason(""); setNotice("Fuel commission policy draft created. Submit it for independent approval."); await refresh(); },
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!latestVersionId || policyReason.trim().length < 5) throw new Error("Select a draft and provide a reason.");
      const { data, error } = await supabase.rpc("submit_financial_policy_version", {
        target_policy_version_id: latestVersionId,
        target_reason: policyReason.trim(),
        target_idempotency_key: createClientIdempotencyKey("admin.fuel.station-affiliate.policy-submit", latestVersionId + ":" + policyReason.trim()),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => { setPolicyReason(""); setNotice("Fuel commission policy submitted for independent approval."); await refresh(); },
  });

  const review = useMutation({
    mutationFn: async (decision: "approved" | "rejected") => {
      if (!latestVersionId || policyReason.trim().length < 5) throw new Error("Select a submitted policy and provide a reason.");
      const { data, error } = await supabase.rpc("review_financial_policy_version", {
        target_policy_version_id: latestVersionId,
        target_decision: decision,
        target_reason: policyReason.trim(),
        target_idempotency_key: createClientIdempotencyKey("admin.fuel.station-affiliate.policy-review", latestVersionId + ":" + decision + ":" + policyReason.trim()),
      });
      if (error) throw error;
      return { decision, data };
    },
    onSuccess: async ({ decision }) => { setPolicyReason(""); setNotice(decision === "approved" ? "Fuel commission policy approved." : "Fuel commission policy rejected."); await refresh(); },
  });

  const activate = useMutation({
    mutationFn: async () => {
      if (!latestVersionId || policyReason.trim().length < 5) throw new Error("Select an approved policy and provide a reason.");
      if (activeVersionId && activeVersionId !== latestVersionId) throw new Error("Deactivate the current active policy before activating a replacement.");
      const { data, error } = await supabase.rpc("activate_financial_policy_version", {
        target_policy_version_id: latestVersionId,
        target_reason: policyReason.trim(),
        target_idempotency_key: createClientIdempotencyKey("admin.fuel.station-affiliate.policy-activate", latestVersionId + ":" + policyReason.trim()),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => { setPolicyReason(""); setNotice("Approved Fuel commission policy activated."); await refresh(); },
  });

  const deactivate = useMutation({
    mutationFn: async () => {
      if (!activeVersionId || policyReason.trim().length < 5) throw new Error("Select the active policy and provide a reason.");
      const { data, error } = await supabase.rpc("deactivate_financial_policy_version", {
        target_policy_version_id: activeVersionId,
        target_reason: policyReason.trim(),
        target_idempotency_key: createClientIdempotencyKey("admin.fuel.station-affiliate.policy-deactivate", activeVersionId + ":" + policyReason.trim()),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => { setPolicyReason(""); setNotice("Fuel commission policy deactivated."); await refresh(); },
  });

  const affiliateDecision = useMutation({
    mutationFn: async (input: { id: string; decision: "active" | "rejected" | "suspended" }) => {
      if (!props.canManageAffiliate || affiliateReason.trim().length < 5) throw new Error("Affiliate review permission and a reason are required.");
      const { data, error } = await supabase.rpc("review_lpg_station_affiliate", {
        target_affiliate_id: input.id,
        target_decision: input.decision,
        target_reason: affiliateReason.trim(),
      });
      if (error) throw error;
      return input;
    },
    onSuccess: async ({ decision }) => { setAffiliateReason(""); setNotice("Affiliate request " + decision + "."); await refresh(); },
  });

  const retryCommission = useMutation({
    mutationFn: async (orderId: string) => {
      if (!props.canRetryCommission || retryReason.trim().length < 5) throw new Error("Revenue/wallet permission and a retry reason are required.");
      const { data, error } = await supabase.rpc("retry_fuel_station_affiliate_commission", {
        target_fuel_order_id: orderId,
        target_reason: retryReason.trim(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => { setRetryReason(""); setNotice("Fuel affiliate commission retry completed."); await refresh(); },
  });

  const reverseCommission = useMutation({
    mutationFn: async (earningId: string) => {
      if (!props.canRetryCommission || reversalReason.trim().length < 5) throw new Error("Revenue/wallet permission and a reversal reason are required.");
      const { data, error } = await supabase.rpc("reverse_fuel_station_affiliate_commission", {
        target_earning_id: earningId,
        target_reason: reversalReason.trim(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (result) => {
      setReversalReason("");
      setNotice(result && typeof result === "object" && (result as Row).status === "pending_recovery"
        ? "Insufficient affiliate wallet balance. The reversal remains queued for recovery."
        : "Fuel affiliate commission reversal processed.");
      await refresh();
    },
  });

  const retryReversal = useMutation({
    mutationFn: async (earningId: string) => {
      if (!props.canRetryCommission || reversalReason.trim().length < 5) throw new Error("Revenue/wallet permission and a reversal reason are required.");
      const { data, error } = await supabase.rpc("retry_fuel_station_affiliate_reversal", {
        target_earning_id: earningId,
        target_reason: reversalReason.trim(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (result) => {
      setReversalReason("");
      setNotice(result && typeof result === "object" && (result as Row).status === "pending_recovery"
        ? "The commission wallet still cannot fund the reversal. The recovery exception remains open."
        : "Fuel commission reversal recovery completed.");
      await refresh();
    },
  });

  if (!props.canRead) return <div className="admin-inline-warning"><strong>Access required.</strong> You need a platform operations, wallet, revenue or financial-policy read permission.</div>;
  if (workspace.isPending) return <LoadingState label="Loading Fuel Affiliate programme…" />;
  if (workspace.error || !workspace.data) return <ErrorState title="Fuel Affiliate workspace unavailable" error={workspace.error} onRetry={() => void workspace.refetch()} />;

  const affiliates = workspace.data.affiliates;
  const referrals = workspace.data.referrals;
  const earnings = workspace.data.earnings;
  const failures = workspace.data.commissionFailures;
  const reversalFailures = workspace.data.reversalFailures;
  const policyVersion = latestVersionId
    ? `v${value(latestPolicy, "version") ?? "?"} · ${normalizeStatusLabel(latestLifecycle || "draft")}`
    : "Not configured";

  return <div className="stack-lg">
    <section className="fulfillment-v2__metrics">
      <MetricTile label="Pending applicants" value={affiliates.filter((row) => value(row, "status") === "pending").length} icon={CircleCheck} />
      <MetricTile label="Active affiliates" value={affiliates.filter((row) => value(row, "status") === "active").length} icon={CircleCheck} tone="success" />
      <MetricTile label="Fuel referrals" value={referrals.length} icon={Building2} />
      <MetricTile label="Posted Fuel commissions" value={earnings.filter((row) => value(row, "status") === "posted").length} icon={WalletCards} />
    </section>

    <section className="sk-panel stack-md">
      <div className="sk-panel__header">
        <div><span className="section-kicker">Governed policy · Nigeria / NGN</span><h2>Fuel Station Affiliate commission</h2>
          <p className="skima-muted">A separate Fuel commission policy. Commission is calculated only from the SKIMA Fuel platform-fee component after successful settlement—not from supplier funds, station principal, customer deposits, driver pay or taxes.</p></div>
        <StatusBadge tone={latestLifecycle === "active" ? "success" : latestLifecycle === "submitted" ? "warning" : "neutral"}>{policyVersion}</StatusBadge>
      </div>
      {hasActivePolicy ? <div className="admin-inline-warning"><strong>Current Fuel policy:</strong> {Number(activeConfiguration.commission_percent ?? 0)}% for {Number(activeConfiguration.earning_period_months ?? 0)} months. {activeConfiguration.program_enabled === false ? "The programme is disabled." : "The programme is enabled."}</div>
        : <div className="admin-inline-warning"><strong>No active Fuel commission policy.</strong> No Fuel affiliate commission will accrue until a policy is drafted, independently approved and activated.</div>}
      <SelectInput label="Fuel commission programme" value={enabled ? "enabled" : "disabled"}
        onChange={(event) => setEnabled(event.currentTarget.value === "enabled")}
        options={[{ label: "Disabled (no new Fuel commission)", value: "disabled" }, { label: "Enabled after policy activation", value: "enabled" }]}
        disabled={!props.canDraftPolicy || !createDraftReady} />
      <TextInput label="Commission percentage of SKIMA Fuel platform fee" value={commissionPercent} onChange={(event) => setCommissionPercent(event.currentTarget.value)} placeholder="Set a rate" disabled={!props.canDraftPolicy || !createDraftReady} />
      <TextInput label="Earning window after station activation (months)" value={earningMonths} onChange={(event) => setEarningMonths(event.currentTarget.value)} placeholder="e.g. 12" disabled={!props.canDraftPolicy || !createDraftReady} />
      <div className="admin-inline-warning"><strong>Eligible revenue stream:</strong> Fuel platform fee only. This is fixed by the policy validator and cannot be broadened in the Admin screen.</div>
      <TextInput label="Policy change reason" value={policyReason} onChange={(event) => setPolicyReason(event.currentTarget.value)} placeholder="Why is this Fuel commission policy being changed?" />
      {createDraftReady && props.canDraftPolicy ? <Button disabled={draft.isPending || policyReason.trim().length < 5} isLoading={draft.isPending} onClick={() => draft.mutate()}>{latestVersionId ? "Create new Fuel policy draft" : "Create Fuel commission policy draft"}</Button> : null}
      {submitReady ? <Button disabled={submit.isPending || policyReason.trim().length < 5} isLoading={submit.isPending} onClick={() => submit.mutate()}>Submit for independent approval</Button> : null}
      {reviewReady ? <div className="fulfillment-v2__action-row"><Button disabled={review.isPending || policyReason.trim().length < 5} isLoading={review.isPending} onClick={() => review.mutate("approved")}>Approve Fuel policy</Button><Button variant="outline" disabled={review.isPending || policyReason.trim().length < 5} onClick={() => review.mutate("rejected")}>Reject Fuel policy</Button></div> : null}
      {activateReady ? <Button disabled={activate.isPending || policyReason.trim().length < 5 || Boolean(activeVersionId && activeVersionId !== latestVersionId)} isLoading={activate.isPending} onClick={() => activate.mutate()}>Activate approved Fuel policy</Button> : null}
      {activeVersionId && activeVersionId !== latestVersionId && props.canActivatePolicy ? <Button variant="outline" disabled={deactivate.isPending || policyReason.trim().length < 5} isLoading={deactivate.isPending} onClick={() => deactivate.mutate()}>Deactivate current Fuel policy</Button> : null}
      {notice ? <StatusBadge tone="success">{notice}</StatusBadge> : null}
      {draft.error ? <ErrorState title="Could not create Fuel policy draft" error={draft.error} /> : null}
      {submit.error ? <ErrorState title="Could not submit Fuel policy" error={submit.error} /> : null}
      {review.error ? <ErrorState title="Could not review Fuel policy" error={review.error} /> : null}
      {activate.error ? <ErrorState title="Could not activate Fuel policy" error={activate.error} /> : null}
      {deactivate.error ? <ErrorState title="Could not deactivate Fuel policy" error={deactivate.error} /> : null}
    </section>

    <section className="sk-panel stack-md">
      <div className="sk-panel__header"><div><span className="section-kicker">Shared affiliate identity · Fuel earnings</span><h2>Affiliate applicants and referrals</h2>
        <p className="skima-muted">The existing approved affiliate identity and station referral relationship are reused. Fuel earnings are tracked separately from LPG earnings.</p></div></div>
      <TextInput label="Affiliate review reason" value={affiliateReason} onChange={(event) => setAffiliateReason(event.currentTarget.value)} placeholder="Reason for review" disabled={!props.canManageAffiliate} />
      {affiliates.map((affiliate) => {
        const id = value(affiliate, "id") ?? "";
        const status = value(affiliate, "status") ?? "pending";
        return <div className="skima-list-row" key={id}>
          <div className="stack-xs"><strong>{value(affiliate, "displayName") ?? "SKIMA affiliate"}</strong>
            <span className="skima-muted">Code {value(affiliate, "referralCode") ?? "—"} · {amount(affiliate, "referralCount")} referrals · {amount(affiliate, "activeReferrals")} active · Fuel earned {money(amount(affiliate, "earned"))}</span></div>
          <StatusBadge tone={status === "active" ? "success" : status === "pending" ? "warning" : "neutral"}>{normalizeStatusLabel(status)}</StatusBadge>
          {props.canManageAffiliate && status !== "rejected" ? <div className="fulfillment-v2__action-row">
            {status !== "active" ? <Button size="sm" disabled={affiliateReason.trim().length < 5 || affiliateDecision.isPending} onClick={() => affiliateDecision.mutate({ id, decision: "active" })}>Approve</Button> : null}
            {status === "pending" ? <Button size="sm" variant="outline" disabled={affiliateReason.trim().length < 5 || affiliateDecision.isPending} onClick={() => affiliateDecision.mutate({ id, decision: "rejected" })}>Reject</Button> : null}
            {status === "active" ? <Button size="sm" variant="outline" disabled={affiliateReason.trim().length < 5 || affiliateDecision.isPending} onClick={() => affiliateDecision.mutate({ id, decision: "suspended" })}>Suspend</Button> : null}
          </div> : null}
        </div>;
      })}
      {referrals.map((referral) => <div className="skima-list-row" key={String(referral.id)}>
        <div className="stack-xs"><strong>{value(referral, "stationName") ?? "Referred station"}</strong>
          <span className="skima-muted">{normalizeStatusLabel(value(referral, "status") ?? "pending")} · {value(referral, "affiliateName") ?? "Affiliate"} · {money(amount(referral, "earnings"))} Fuel earnings</span></div>
        <StatusBadge tone={value(referral, "status") === "activated" ? "success" : "neutral"}>{normalizeStatusLabel(value(referral, "status") ?? "pending")}</StatusBadge>
      </div>)}
      {!affiliates.length && !referrals.length ? <p className="skima-muted">No affiliate applications or Fuel station referrals yet.</p> : null}
      {affiliateDecision.error ? <ErrorState title="Could not update affiliate status" error={affiliateDecision.error} /> : null}
    </section>

    <section className="sk-panel stack-md">
      <div className="sk-panel__header"><div><span className="section-kicker">Fuel-only ledger activity</span><h2>Fuel affiliate earnings</h2>
        <p className="skima-muted">Each earning references the Fuel order, original settlement transaction, policy version, platform-fee base and commission wallet posting.</p></div></div>
      <TextInput label="Commission retry reason" value={retryReason} onChange={(event) => setRetryReason(event.currentTarget.value)} placeholder="Reason for retry" disabled={!props.canRetryCommission} />
      {failures.map((failure) => <div className="skima-list-row" key={String(failure.id)}>
        <div className="stack-xs"><strong>Fuel order {value(failure, "orderId") ?? "—"}</strong>
          <span className="skima-muted">{value(failure, "lastError") ?? "Commission post failed"} · {amount(failure, "attemptCount")} attempts</span></div>
        <Button size="sm" disabled={!props.canRetryCommission || retryReason.trim().length < 5 || retryCommission.isPending} isLoading={retryCommission.isPending} onClick={() => retryCommission.mutate(value(failure, "orderId") ?? "")}>Retry</Button>
      </div>)}
      {earnings.map((earning) => <div className="skima-list-row" key={String(earning.id)}>
        <div className="stack-xs"><strong>{value(earning, "publicReference") ?? value(earning, "orderId") ?? "Fuel order"}</strong>
          <span className="skima-muted">{value(earning, "affiliateName") ?? "Affiliate"} · {value(earning, "stationName") ?? "Station"} · platform fee {money(amount(earning, "revenueBaseAmount"))} · {amount(earning, "commissionPercent")}% · commission {money(amount(earning, "amount"))}</span>
          <small className="skima-muted">{normalizeStatusLabel(value(earning, "status") ?? "posted")} · policy {value(earning, "policyVersion") ?? "—"}</small></div>
        {value(earning, "status") === "posted" ? <Button size="sm" variant="outline" disabled={!props.canRetryCommission || reversalReason.trim().length < 5 || reverseCommission.isPending} onClick={() => reverseCommission.mutate(value(earning, "id") ?? "")}>Reverse</Button> : null}
      </div>)}
      {reversalFailures.map((failure) => <div className="skima-list-row" key={String(failure.id)}>
        <div className="stack-xs"><strong>Reversal recovery</strong><span className="skima-muted">Required {money(amount(failure, "requiredAmount"))}; available {money(amount(failure, "availableAmount"))} · {value(failure, "lastError") ?? "Pending"}</span></div>
        <Button size="sm" disabled={!props.canRetryCommission || reversalReason.trim().length < 5 || retryReversal.isPending} onClick={() => retryReversal.mutate(value(failure, "earningId") ?? "")}>Retry recovery</Button>
      </div>)}
      <TextInput label="Reversal / recovery reason" value={reversalReason} onChange={(event) => setReversalReason(event.currentTarget.value)} placeholder="Reason for reversing or retrying" disabled={!props.canRetryCommission} />
      {retryCommission.error ? <ErrorState title="Fuel commission retry failed" error={retryCommission.error} /> : null}
      {reverseCommission.error ? <ErrorState title="Fuel commission reversal failed" error={reverseCommission.error} /> : null}
      {retryReversal.error ? <ErrorState title="Fuel reversal recovery failed" error={retryReversal.error} /> : null}
      {!earnings.length && !failures.length && !reversalFailures.length ? <p className="skima-muted">No Fuel affiliate ledger activity yet.</p> : null}
    </section>
  </div>;
}
