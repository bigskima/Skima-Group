import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeDollarSign, CheckCircle2, Clock3, RefreshCcw, ShieldCheck } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { z } from "zod";

import { createClientIdempotencyKey } from "@skima/frontend-core";
import { Button, ErrorState, LoadingState, PageHeader, StatusBadge, TextAreaInput, TextInput } from "@skima/ui";
import { useSessionState } from "./session";
import "./admin-logistics-fee-workspace.css";

const ConfigurationSchema = z.object({
  fixed_amount: z.coerce.number().nonnegative(),
  percentage_basis_points: z.coerce.number().int().min(0).max(10000),
}).passthrough();

const PolicyVersionSchema = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int(),
  lifecycle_status: z.string(),
  currency_code: z.string(),
  configuration: ConfigurationSchema,
  effective_from: z.string(),
  effective_until: z.string().nullable(),
  change_reason: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  service_key: z.string().nullable().optional(),
  geography_type: z.string().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  financial_policy_definitions: z.object({
    key: z.string(),
    display_name: z.string(),
    policy_family: z.string(),
  }).passthrough(),
}).passthrough();

const PolicyVersionsSchema = z.array(PolicyVersionSchema);
type PolicyVersion = z.infer<typeof PolicyVersionSchema>;

type FeePolicySpec = {
  key: string;
  displayName: string;
  family: "marketplace_fee" | "commission";
  title: string;
  description: string;
  fixedAmountLabel: string;
  percentageLabel: string;
  showFixedAmount: boolean;
  applyWhen: string;
};

const POLICIES: FeePolicySpec[] = [
  {
    key: "fees.logistics.customer_booking",
    displayName: "Logistics customer booking fee",
    family: "marketplace_fee",
    title: "Customer booking fee",
    description: "Charged to the customer when they confirm an accepted company offer. It is itemised before the customer pays or confirms an offline booking.",
    fixedAmountLabel: "Fixed customer fee (NGN)",
    percentageLabel: "Additional fee (% of provider delivery price)",
    showFixedAmount: true,
    applyWhen: "Collected once when the customer confirms the provider offer.",
  },
  {
    key: "commission.logistics.provider",
    displayName: "Logistics provider online settlement commission",
    family: "commission",
    title: "Company online settlement commission",
    description: "Percentage deducted from the provider's delivery proceeds only after successful customer-confirmed delivery and online settlement.",
    fixedAmountLabel: "Fixed commission (NGN)",
    percentageLabel: "Company settlement commission (%)",
    showFixedAmount: false,
    applyWhen: "Deducted only at successful online settlement. No deduction for an offline booking.",
  },
  {
    key: "fees.logistics.provider_receival",
    displayName: "Logistics provider offline booking receival fee",
    family: "marketplace_fee",
    title: "Company offline booking fee",
    description: "The provider-side fee for an offline booking. This is separate from the customer's booking fee and the online settlement commission.",
    fixedAmountLabel: "Fixed company fee (NGN)",
    percentageLabel: "Additional fee (% of provider delivery price)",
    showFixedAmount: true,
    applyWhen: "Collected from the company wallet when the offline booking is confirmed.",
  },
];

export function AdminLogisticsFeeWorkspace() {
  const { api, context, session, status } = useSessionState();
  const client = useQueryClient();
  const superAdmin = context?.platformAdmin?.admin_kind === "super_admin";
  const canDraft = superAdmin || Boolean(context?.permissions.includes("platform.financial_policy.draft"));
  const canApprove = superAdmin || Boolean(context?.permissions.includes("platform.financial_policy.approve"));
  const canActivate = superAdmin || Boolean(context?.permissions.includes("platform.financial_policy.activate"));
  const [notice, setNotice] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const versions = useQuery({
    queryKey: ["admin-logistics-financial-policies"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: () => api.get("/admin/financial-policies", PolicyVersionsSchema),
  });

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["admin-logistics-financial-policies"] });
    await versions.refetch();
  };

  const latestByPolicy = useMemo(() => {
    const grouped = new Map<string, PolicyVersion[]>();
    for (const version of versions.data ?? []) {
      const key = version.financial_policy_definitions.key;
      if (!POLICIES.some((policy) => policy.key === key)) continue;
      if (version.currency_code !== "NGN") continue;
      if (version.service_key !== "logistics.booking") continue;
      if (version.geography_type !== "global") continue;
      if (version.organization_id) continue;
      grouped.set(key, [...(grouped.get(key) ?? []), version]);
    }
    return grouped;
  }, [versions.data]);

  return (
    <div className="admin-workspace">
      <PageHeader
        eyebrow="Money · Logistics"
        title="Logistics fees & settlement"
        description="Configure the customer booking charge, offline company fee and the percentage SKIMA retains when an online delivery is successfully settled."
        actions={<Button icon={RefreshCcw} variant="outline" onClick={() => void refresh()}>Refresh</Button>}
      />
      <div className="admin-money-guardrail">
        <ShieldCheck size={17} />
        <div><strong>No lead unlock fee.</strong> Companies can view and quote matched opportunities for free. The values below apply only at the booking and settlement stages shown on each policy.</div>
      </div>
      {notice ? <div className={isError ? "admin-inline-alert admin-inline-alert--error" : "admin-inline-alert"}>{notice}</div> : null}
      {versions.isPending ? <LoadingState label="Loading Logistics fee policies…" /> : versions.error ? (
        <ErrorState title="Logistics fee policies unavailable" message={versions.error instanceof Error ? versions.error.message : "The financial policy service could not be reached."} onRetry={() => void versions.refetch()} />
      ) : (
        <div className="admin-logistics-fee-grid">
          {POLICIES.map((policy) => (
            <LogisticsFeePolicyCard
              key={policy.key}
              policy={policy}
              versions={latestByPolicy.get(policy.key) ?? []}
              canDraft={canDraft}
              canApprove={canApprove}
              canActivate={canActivate}
              actorId={session?.user.id ?? null}
              onSuccess={(message) => { setIsError(false); setNotice(message); void refresh(); }}
              onError={(message) => { setIsError(true); setNotice(message); }}
            />
          ))}
        </div>
      )}
      <div className="admin-money-guardrail admin-money-guardrail--muted">
        A fee policy must be drafted, submitted, approved by a different authorised administrator, and activated before it affects new Logistics bookings. Existing bookings retain their original fee snapshots. The system intentionally does not invent or silently default any NGN amount or percentage.
      </div>
    </div>
  );
}

function LogisticsFeePolicyCard(props: {
  policy: FeePolicySpec;
  versions: PolicyVersion[];
  canDraft: boolean;
  canApprove: boolean;
  canActivate: boolean;
  actorId: string | null;
  onSuccess(message: string): void;
  onError(message: string): void;
}) {
  const { supabase } = useSessionState();
  const active = props.versions
    .filter((version) => version.lifecycle_status === "active")
    .sort((a, b) => new Date(b.effective_from).getTime() - new Date(a.effective_from).getTime())[0] ?? null;
  const pending = [...props.versions]
    .filter((version) => ["draft", "submitted", "approved", "scheduled"].includes(version.lifecycle_status))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const [fixedAmount, setFixedAmount] = useState(active ? String(active.configuration.fixed_amount) : "");
  const [percentage, setPercentage] = useState(active ? String(active.configuration.percentage_basis_points / 100) : "");
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const createDraft = useMutation({
    mutationFn: async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const fixed = props.policy.showFixedAmount ? Number(fixedAmount) : 0;
      const percent = Number(percentage);
      if (!Number.isFinite(fixed) || fixed < 0) throw new Error("Enter a valid fixed fee amount.");
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error("Enter a percentage between 0 and 100.");
      if (!reason.trim() || reason.trim().length < 3) throw new Error("Explain why this fee policy is being changed.");
      if (props.policy.key === "fees.logistics.customer_booking" && fixed === 0 && percent === 0) {
        throw new Error("Set a fixed fee or a percentage for the customer booking charge.");
      }
      const configuration = {
        fixed_amount: fixed,
        percentage_basis_points: Math.round(percent * 100),
      };
      const idempotencyKey = createClientIdempotencyKey(
        "admin.logistics.fee.create",
        JSON.stringify([props.policy.key, "NGN", active?.id ?? "initial", configuration, reason.trim()]),
      );
      const { data, error } = await supabase.rpc("create_financial_policy_version", {
        target_policy_key: props.policy.key,
        target_display_name: props.policy.displayName,
        target_policy_family: props.policy.family,
        target_currency_code: "NGN",
        target_configuration: configuration,
        target_effective_from: new Date().toISOString(),
        target_change_reason: reason.trim(),
        target_idempotency_key: idempotencyKey,
        target_module_key: "logistics_network",
        target_organization_id: null,
        target_service_key: "logistics.booking",
        target_geography_type: "global",
        target_geography_key: null,
        target_effective_until: null,
        target_priority: 100,
        target_approval_required: true,
        target_allow_partner_delegation: false,
        target_based_on_version_id: active?.id ?? null,
        target_supersedes_version_id: active?.id ?? null,
        target_rollback_of_version_id: null,
        target_metadata: { surface: "skima.admin.logistics_fees" },
      });
      if (error) throw error;
      const policyVersionId = z.string().uuid().parse(data);
      const { error: submitError } = await supabase.rpc("submit_financial_policy_version", {
        target_policy_version_id: policyVersionId,
        target_reason: reason.trim(),
        target_idempotency_key: createClientIdempotencyKey("admin.logistics.fee.submit", policyVersionId),
      });
      if (submitError) throw submitError;
      return policyVersionId;
    },
    onSuccess: () => {
      setReason("");
      props.onSuccess(props.policy.title + " proposal submitted for independent approval. It is not live yet.");
    },
    onError: (error) => props.onError(error instanceof Error ? error.message : "The fee policy draft could not be submitted."),
  });

  const review = useMutation({
    mutationFn: async (input: { version: PolicyVersion; decision: "approved" | "rejected" }) => {
      setBusyId(input.version.id);
      const { error } = await supabase.rpc("review_financial_policy_version", {
        target_policy_version_id: input.version.id,
        target_decision: input.decision,
        target_reason: input.decision === "approved"
          ? "Approved from the SKIMA Logistics " + props.policy.title.toLowerCase() + " workspace."
          : "Rejected from the SKIMA Logistics " + props.policy.title.toLowerCase() + " workspace.",
        target_idempotency_key: createClientIdempotencyKey("admin.logistics.fee." + input.decision, input.version.id),
      });
      if (error) throw error;
      return input.decision;
    },
    onSuccess: (decision) => props.onSuccess(decision === "approved"
      ? props.policy.title + " proposal approved. An authorised activator can now make it live."
      : props.policy.title + " proposal rejected."),
    onError: (error) => props.onError(error instanceof Error ? error.message : "The policy review could not be completed."),
    onSettled: () => setBusyId(null),
  });

  const activate = useMutation({
    mutationFn: async (version: PolicyVersion) => {
      setBusyId(version.id);
      const { error } = await supabase.rpc("activate_financial_policy_version", {
        target_policy_version_id: version.id,
        target_reason: "Activated from the SKIMA Logistics " + props.policy.title.toLowerCase() + " workspace.",
        target_idempotency_key: createClientIdempotencyKey("admin.logistics.fee.activate", version.id),
      });
      if (error) throw error;
    },
    onSuccess: () => props.onSuccess(props.policy.title + " is now active for new NGN Logistics bookings."),
    onError: (error) => props.onError(error instanceof Error ? error.message : "The policy could not be activated."),
    onSettled: () => setBusyId(null),
  });

  return (
    <section className="admin-logistics-fee-card">
      <div className="admin-logistics-fee-card__head">
        <div>
          <div className="admin-section-eyebrow">NGN · LOGISTICS BOOKING</div>
          <h2>{props.policy.title}</h2>
        </div>
        <StatusBadge status={active ? "active" : "not_configured"} />
      </div>
      <p>{props.policy.description}</p>
      <div className="admin-logistics-fee-card__timing"><Clock3 size={15} /> {props.policy.applyWhen}</div>
      {active ? (
        <div className="admin-logistics-fee-card__current">
          <div><span>Live fixed amount</span><strong>{formatNgn(active.configuration.fixed_amount)}</strong></div>
          <div><span>Live percentage</span><strong>{(active.configuration.percentage_basis_points / 100).toFixed(2)}%</strong></div>
          <small>Version {active.version} · Effective {new Date(active.effective_from).toLocaleDateString("en-NG")}</small>
        </div>
      ) : (
        <div className="admin-money-guardrail admin-money-guardrail--warning">
          This policy has no active NGN version. Bookings using this payment mode will remain blocked until this policy is approved and activated.
        </div>
      )}
      {props.canDraft ? (
        <form className="admin-logistics-fee-form" onSubmit={(event) => { event.preventDefault(); createDraft.mutate(event); }}>
          {props.policy.showFixedAmount ? (
            <TextInput label={props.policy.fixedAmountLabel} name="logistics-customer-fee-fixed" type="number" min="0" step="0.01"
              value={fixedAmount} onChange={(event) => setFixedAmount(event.currentTarget.value)} disabled={createDraft.isPending} required />
          ) : null}
          <TextInput label={props.policy.percentageLabel} name="logistics-policy-percentage" type="number" min="0" max="100" step="0.01"
            value={percentage} onChange={(event) => setPercentage(event.currentTarget.value)} disabled={createDraft.isPending} required />
          <TextAreaInput label="Reason for change" name="logistics-policy-reason" value={reason}
            onChange={(event) => setReason(event.currentTarget.value)} rows={2} disabled={createDraft.isPending} required />
          <Button type="submit" icon={BadgeDollarSign} disabled={createDraft.isPending}>{createDraft.isPending ? "Submitting…" : "Submit fee proposal"}</Button>
        </form>
      ) : (
        <p className="skima-muted">You need financial policy draft permission to change this fee.</p>
      )}
      {pending.length ? (
        <div className="admin-logistics-fee-card__pending">
          <h3>Policy proposals</h3>
          {pending.map((version) => (
            <div className="admin-logistics-fee-card__proposal" key={version.id}>
              <div className="admin-logistics-fee-card__proposal-head">
                <div><strong>Version {version.version}</strong><small>{formatNgn(version.configuration.fixed_amount)} + {(version.configuration.percentage_basis_points / 100).toFixed(2)}%</small></div>
                <StatusBadge status={version.lifecycle_status} />
              </div>
              <p>{version.change_reason ?? "No change reason supplied."}</p>
              {version.lifecycle_status === "submitted" && props.canApprove ? (
                <div className="admin-logistics-fee-card__actions">
                  <Button variant="outline" disabled={Boolean(busyId)} onClick={() => review.mutate({ version, decision: "rejected" })}>Reject</Button>
                  <Button icon={CheckCircle2} disabled={Boolean(busyId) || version.created_by === props.actorId} onClick={() => review.mutate({ version, decision: "approved" })}>Approve</Button>
                </div>
              ) : null}
              {version.lifecycle_status === "approved" && props.canActivate ? (
                <Button icon={ShieldCheck} disabled={Boolean(busyId)} onClick={() => activate.mutate(version)}>Activate for new bookings</Button>
              ) : null}
              {version.created_by === props.actorId && version.lifecycle_status === "submitted" && props.canApprove ? (
                <small className="skima-muted">A different authorised administrator must approve your proposal.</small>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function formatNgn(value: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(value);
}
