import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeDollarSign, CheckCircle2, RefreshCcw, Send, Truck } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { z } from "zod";

import { createClientIdempotencyKey, normalizeStatusLabel } from "@skima/frontend-core";
import {
  Button,
  DataTable,
  ErrorState,
  LoadingState,
  MetricTile,
  PageHeader,
  StatusBadge,
  TextAreaInput,
  TextInput,
  type TableColumn,
} from "@skima/ui";

import { useSessionState } from "./session";

const MoneyPolicyConfigurationSchema = z.object({
  base_amount: z.coerce.number().nonnegative().default(0),
  included_km: z.coerce.number().nonnegative().default(0),
  per_km_amount: z.coerce.number().nonnegative().default(0),
  minimum_amount: z.coerce.number().nonnegative().default(0),
  load_amount_per_kg: z.coerce.number().nonnegative().default(0),
  distance_bands: z.array(z.record(z.unknown())).optional(),
}).passthrough();

const ResolvedMoneyPolicySchema = z.object({
  policyKey: z.string(),
  policyFamily: z.string(),
  policyVersionId: z.string().uuid(),
  version: z.coerce.number().int(),
  currencyCode: z.string(),
  configuration: MoneyPolicyConfigurationSchema,
  effectiveFrom: z.string(),
  effectiveUntil: z.string().nullable().optional(),
  geographyType: z.string(),
  priority: z.coerce.number().int(),
}).passthrough();

const PolicyVersionSchema = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int(),
  lifecycle_status: z.string(),
  currency_code: z.string(),
  configuration: MoneyPolicyConfigurationSchema,
  effective_from: z.string(),
  effective_until: z.string().nullable(),
  change_reason: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  financial_policy_definitions: z.object({
    key: z.string(),
    display_name: z.string(),
    policy_family: z.string(),
  }).passthrough(),
}).passthrough();

const PolicyVersionsSchema = z.array(PolicyVersionSchema);
const MutationIdSchema = z.string().uuid();

type PolicyVersion = z.infer<typeof PolicyVersionSchema>;
type MoneyPolicyConfiguration = z.infer<typeof MoneyPolicyConfigurationSchema>;
type PricingKind = "delivery" | "driver";

type PricingForm = {
  baseAmount: string;
  includedKm: string;
  perKmAmount: string;
  minimumAmount: string;
  loadAmountPerKg: string;
  reason: string;
};

type PricingSpec = {
  readonly kind: PricingKind;
  readonly policyKey: "pricing.lpg.delivery" | "payout.lpg.driver";
  readonly displayName: string;
  readonly policyFamily: "pricing" | "payout";
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly editTitle: string;
  readonly pendingTitle: string;
  readonly pendingDescription: string;
  readonly immediateSuccess: string;
  readonly delegatedSuccess: string;
  readonly showIncludedKm: boolean;
  readonly showMinimumAmount: boolean;
};

const PRICING_SPECS: Record<PricingKind, PricingSpec> = {
  delivery: {
    kind: "delivery",
    policyKey: "pricing.lpg.delivery",
    displayName: "LPG delivery pricing",
    policyFamily: "pricing",
    eyebrow: "Money · LPG pricing",
    title: "Delivery Pricing",
    description:
      "Set what the customer pays for LPG pickup and return logistics. This is separate from the station gas price, SKIMA service fee, and driver payout.",
    editTitle: "Customer delivery price",
    pendingTitle: "Pending delivery pricing proposals",
    pendingDescription: "Delegated finance admins can propose changes here. Super Admin edits do not enter this queue.",
    immediateSuccess: "LPG delivery pricing is now live for new quotes.",
    delegatedSuccess: "Delivery pricing change submitted for review. The current live customer price remains unchanged.",
    showIncludedKm: true,
    showMinimumAmount: true,
  },
  driver: {
    kind: "driver",
    policyKey: "payout.lpg.driver",
    displayName: "LPG driver logistics payout",
    policyFamily: "payout",
    eyebrow: "Money · Driver pricing",
    title: "Driver Pricing",
    description:
      "Set how SKIMA pays drivers for LPG logistics. Driver payout is independent of LPG product value and cannot exceed the customer delivery fee.",
    editTitle: "Driver payout formula",
    pendingTitle: "Pending driver pricing proposals",
    pendingDescription: "Delegated finance admins can propose driver payout changes here. Super Admin edits apply immediately.",
    immediateSuccess: "Driver pricing is now live for new LPG quotes and jobs.",
    delegatedSuccess: "Driver pricing change submitted for review. The current live payout formula remains unchanged.",
    showIncludedKm: false,
    showMinimumAmount: false,
  },
};

const EMPTY_FORM: PricingForm = {
  baseAmount: "0",
  includedKm: "0",
  perKmAmount: "0",
  minimumAmount: "0",
  loadAmountPerKg: "0",
  reason: "",
};

export function AdminDeliveryPricingWorkspace() {
  return <AdminMoneyPricingWorkspace kind="delivery" />;
}

export function AdminDriverPricingWorkspace() {
  return <AdminMoneyPricingWorkspace kind="driver" />;
}

function AdminMoneyPricingWorkspace(props: { readonly kind: PricingKind }) {
  const spec = PRICING_SPECS[props.kind];
  const { api, context, status, supabase } = useSessionState();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PricingForm>(EMPTY_FORM);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeIsError, setNoticeIsError] = useState(false);

  const superAdmin = isSuperAdmin(context);
  const canDraft = superAdmin || context?.permissions.includes("platform.financial_policy.draft") || false;
  const canApprove = superAdmin || context?.permissions.includes("platform.financial_policy.approve") || false;
  const canActivate = superAdmin || context?.permissions.includes("platform.financial_policy.activate") || false;

  const current = useQuery({
    queryKey: ["admin-money-pricing", spec.kind, "resolved"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const resolved = await api.post(
        "/admin/financial-policies/resolve",
        {
          policyKey: spec.policyKey,
          currencyCode: "NGN",
          moduleKey: "lpg",
          serviceKey: "lpg.refill.delivery",
          geographyType: "global",
        },
        ResolvedMoneyPolicySchema,
      );
      if (resolved.policyKey !== spec.policyKey) {
        throw new Error(`Expected ${spec.displayName}, but SKIMA resolved ${resolved.policyKey}.`);
      }
      return resolved;
    },
  });

  const versions = useQuery({
    queryKey: ["admin-money-pricing", spec.kind, "versions"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: () => api.get("/admin/financial-policies", PolicyVersionsSchema),
  });

  useEffect(() => {
    if (!current.data) return;
    const config = current.data.configuration;
    setForm((existing) => ({
      baseAmount: String(config.base_amount ?? 0),
      includedKm: String(config.included_km ?? 0),
      perKmAmount: String(config.per_km_amount ?? 0),
      minimumAmount: String(config.minimum_amount ?? 0),
      loadAmountPerKg: String(config.load_amount_per_kg ?? 0),
      reason: existing.reason,
    }));
  }, [current.data?.policyVersionId]);

  const applyImmediately = useMutation({
    mutationFn: async (input: PricingForm) => {
      if (!superAdmin) throw new Error("Only an active Super Admin can apply pricing immediately.");
      if (!current.data) throw new Error(`Current ${spec.title.toLowerCase()} has not loaded yet.`);
      const nextConfiguration = buildConfiguration(spec, current.data.configuration, input);
      const result = await supabase.rpc("set_active_financial_policy_configuration", {
        target_policy_key: spec.policyKey,
        target_configuration: nextConfiguration,
        target_reason: input.reason.trim(),
        target_idempotency_key: createClientIdempotencyKey(
          `admin.${spec.kind}-pricing.apply`,
          current.data.policyVersionId,
        ),
        target_currency_code: current.data.currencyCode,
        target_module_key: "lpg",
        target_service_key: "lpg.refill.delivery",
        target_organization_id: null,
        target_geography_type: "global",
        target_geography_key: null,
      });
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async () => {
      setNoticeIsError(false);
      setNotice(spec.immediateSuccess);
      setForm((value) => ({ ...value, reason: "" }));
      await queryClient.invalidateQueries({ queryKey: ["admin-money-pricing", spec.kind] });
      await current.refetch();
    },
    onError: (error) => {
      setNoticeIsError(true);
      setNotice(readError(error, spec));
    },
  });

  const saveDraft = useMutation({
    mutationFn: async (input: PricingForm) => {
      if (!current.data) throw new Error(`Current ${spec.title.toLowerCase()} has not loaded yet.`);
      const nextConfiguration = buildConfiguration(spec, current.data.configuration, input);
      const createId = await api.post(
        "/admin/financial-policies",
        {
          policyKey: spec.policyKey,
          displayName: spec.displayName,
          policyFamily: spec.policyFamily,
          approvalRequired: true,
          allowPartnerDelegation: false,
          basedOnVersionId: current.data.policyVersionId,
          supersedesVersionId: current.data.policyVersionId,
          changeReason: input.reason.trim(),
          configuration: nextConfiguration,
          currencyCode: current.data.currencyCode,
          effectiveFrom: new Date().toISOString(),
          geographyType: "global",
          moduleKey: "lpg",
          serviceKey: "lpg.refill.delivery",
          priority: current.data.priority,
          metadata: { surface: `skima.admin.${spec.kind}_pricing` },
          idempotencyKey: createClientIdempotencyKey(
            `admin.${spec.kind}-pricing.create`,
            current.data.policyVersionId,
          ),
        },
        MutationIdSchema,
      );

      await api.post(
        "/admin/financial-policies/submit",
        {
          policyVersionId: createId,
          reason: input.reason.trim(),
          idempotencyKey: createClientIdempotencyKey(
            `admin.${spec.kind}-pricing.submit`,
            createId,
          ),
        },
        MutationIdSchema,
      );

      return createId;
    },
    onSuccess: async () => {
      setNoticeIsError(false);
      setNotice(spec.delegatedSuccess);
      setForm((value) => ({ ...value, reason: "" }));
      await queryClient.invalidateQueries({ queryKey: ["admin-money-pricing", spec.kind] });
    },
    onError: (error) => {
      setNoticeIsError(true);
      setNotice(readError(error, spec));
    },
  });

  const reviewVersion = useMutation({
    mutationFn: async ({ version, decision }: { version: PolicyVersion; decision: "approved" | "rejected" }) => {
      await api.post(
        "/admin/financial-policies/review",
        {
          policyVersionId: version.id,
          decision,
          reason: decision === "approved"
            ? `Approved from the SKIMA ${spec.title.toLowerCase()} workspace.`
            : `Rejected from the SKIMA ${spec.title.toLowerCase()} workspace.`,
          idempotencyKey: createClientIdempotencyKey(
            `admin.${spec.kind}-pricing.${decision}`,
            version.id,
          ),
        },
        MutationIdSchema,
      );
      return { version, decision };
    },
    onSuccess: async ({ decision }) => {
      setNoticeIsError(false);
      setNotice(
        decision === "approved"
          ? `${spec.displayName} proposal approved. An authorized activator can make it live.`
          : `${spec.displayName} proposal rejected.`,
      );
      await queryClient.invalidateQueries({ queryKey: ["admin-money-pricing", spec.kind] });
    },
    onError: (error) => {
      setNoticeIsError(true);
      setNotice(readError(error, spec));
    },
  });

  const activateVersion = useMutation({
    mutationFn: async (version: PolicyVersion) => {
      await api.post(
        "/admin/financial-policies/replace-active",
        {
          policyVersionId: version.id,
          reason: `Replaced live ${spec.displayName.toLowerCase()} from the guided SKIMA money workspace.`,
          idempotencyKey: createClientIdempotencyKey(
            `admin.${spec.kind}-pricing.activate`,
            version.id,
          ),
        },
        MutationIdSchema,
      );
      return version;
    },
    onSuccess: async () => {
      setNoticeIsError(false);
      setNotice(spec.immediateSuccess);
      await queryClient.invalidateQueries({ queryKey: ["admin-money-pricing", spec.kind] });
      await current.refetch();
    },
    onError: (error) => {
      setNoticeIsError(true);
      setNotice(readError(error, spec));
    },
  });

  const pendingVersions = useMemo(
    () => (versions.data ?? []).filter((version) =>
      version.financial_policy_definitions.key === spec.policyKey &&
      version.currency_code === "NGN" &&
      ["draft", "submitted", "approved", "scheduled"].includes(version.lifecycle_status)
    ),
    [spec.policyKey, versions.data],
  );

  const pendingColumns = useMemo<TableColumn<PolicyVersion>[]>(() => [
    {
      key: "version",
      header: "Proposal",
      render: (version) => (
        <span>
          <strong>{spec.displayName} v{version.version}</strong><br />
          <small>{version.change_reason ?? "Pricing update"} · {formatDate(version.created_at)}</small>
        </span>
      ),
    },
    {
      key: "pricing",
      header: "Proposed pricing",
      render: (version) => <span>{pricingSummary(spec, version.configuration)}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (version) => (
        <StatusBadge tone={version.lifecycle_status === "approved" ? "success" : "warning"}>
          {normalizeStatusLabel(version.lifecycle_status)}
        </StatusBadge>
      ),
    },
    {
      key: "action",
      header: "Action",
      render: (version) => {
        if (version.lifecycle_status === "submitted" && canApprove) {
          return (
            <Button
              size="sm"
              variant="outline"
              icon={CheckCircle2}
              isLoading={reviewVersion.isPending && reviewVersion.variables?.version.id === version.id}
              disabled={reviewVersion.isPending || activateVersion.isPending}
              onClick={() => reviewVersion.mutate({ version, decision: "approved" })}
            >
              Approve proposal
            </Button>
          );
        }
        if (version.lifecycle_status === "approved" && canActivate) {
          return (
            <Button
              size="sm"
              icon={Send}
              isLoading={activateVersion.isPending && activateVersion.variables?.id === version.id}
              disabled={reviewVersion.isPending || activateVersion.isPending}
              onClick={() => activateVersion.mutate(version)}
            >
              Make live
            </Button>
          );
        }
        return <span className="skima-muted">No action for your role</span>;
      },
    },
  ], [
    activateVersion.isPending,
    activateVersion.variables?.id,
    canActivate,
    canApprove,
    reviewVersion.isPending,
    reviewVersion.variables?.version.id,
    spec,
  ]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(null);
    setNoticeIsError(false);
    try {
      parseForm(spec, form);
      if (!form.reason.trim()) throw new Error("Explain why this price is changing.");
      if (superAdmin) {
        applyImmediately.mutate(form);
      } else {
        saveDraft.mutate(form);
      }
    } catch (error) {
      setNoticeIsError(true);
      setNotice(readError(error, spec));
    }
  };

  const configuration = current.data?.configuration;
  const hasChanged = configuration ? formChanged(spec, form, configuration) : false;
  const isSaving = applyImmediately.isPending || saveDraft.isPending;
  const canEdit = superAdmin || canDraft;

  const updateField = (field: keyof PricingForm, nextValue: string) => {
    setForm((currentForm) => ({ ...currentForm, [field]: nextValue }));
  };

  return (
    <>
      <PageHeader
        eyebrow={spec.eyebrow}
        title={spec.title}
        description={spec.description}
        actions={(
          <Button
            icon={RefreshCcw}
            variant="outline"
            onClick={() => void Promise.all([current.refetch(), versions.refetch()])}
          >
            Refresh
          </Button>
        )}
      />

      {current.isLoading ? <LoadingState label={`Loading ${spec.title.toLowerCase()}`} /> : null}
      {current.error ? (
        <ErrorState
          title={`${spec.title} unavailable`}
          message={readError(current.error, spec)}
          onRetry={() => void current.refetch()}
        />
      ) : null}

      {current.data ? (
        <>
          <section className="skima-grid skima-grid--compact">
            <MetricTile
              label={spec.kind === "delivery" ? "Base delivery fee" : "Base driver payout"}
              value={money(current.data.configuration.base_amount)}
              icon={spec.kind === "delivery" ? Truck : BadgeDollarSign}
              tone="info"
            />
            {spec.showIncludedKm ? (
              <MetricTile
                label="Distance included"
                value={`${current.data.configuration.included_km} km`}
                icon={Truck}
              />
            ) : null}
            <MetricTile
              label={spec.kind === "delivery" ? "Extra distance" : "Driver distance rate"}
              value={`${money(current.data.configuration.per_km_amount)} / km`}
              icon={Truck}
            />
            <MetricTile
              label={spec.kind === "delivery" ? "Load adjustment" : "Driver load rate"}
              value={`${money(current.data.configuration.load_amount_per_kg)} / kg`}
              icon={BadgeDollarSign}
            />
            {spec.showMinimumAmount ? (
              <MetricTile
                label="Minimum delivery fee"
                value={money(current.data.configuration.minimum_amount)}
                icon={Truck}
              />
            ) : null}
          </section>

          {notice ? (
            <div className={noticeIsError ? "admin-notice is-error" : "admin-notice"} role={noticeIsError ? "alert" : "status"}>
              {notice}
            </div>
          ) : null}

          <section className="sk-panel admin-money-editor">
            <div className="sk-panel__header">
              <div>
                <p className="admin-section-kicker">{superAdmin ? "Direct control" : "Governed proposal"}</p>
                <h2>{spec.editTitle}</h2>
                <p className="skima-muted">
                  {superAdmin
                    ? "As Super Admin, Save & apply now creates an audited version and immediately replaces the live price. There is no second approval step."
                    : "Your delegated finance role can propose a change. Approval and activation remain separate from proposal creation."}
                </p>
              </div>
              <div className="admin-money-status-stack">
                <StatusBadge tone="success">Live version {current.data.version}</StatusBadge>
                {superAdmin ? <StatusBadge tone="info">Super Admin · immediate</StatusBadge> : null}
              </div>
            </div>

            <form className="skima-form" onSubmit={submit}>
              <div className="skima-grid skima-grid--compact">
                <TextInput
                  label={spec.kind === "delivery" ? "Base delivery fee (₦)" : "Base driver payout (₦)"}
                  name={`${spec.kind}-baseAmount`}
                  type="number"
                  min="0"
                  step="1"
                  value={form.baseAmount}
                  onChange={(event) => {
                    const nextValue = event.currentTarget.value;
                    updateField("baseAmount", nextValue);
                  }}
                  disabled={!canEdit || isSaving}
                  required
                />
                {spec.showIncludedKm ? (
                  <TextInput
                    label="Distance included in base fee (km)"
                    name="delivery-includedKm"
                    type="number"
                    min="0"
                    step="0.1"
                    value={form.includedKm}
                    onChange={(event) => {
                      const nextValue = event.currentTarget.value;
                      updateField("includedKm", nextValue);
                    }}
                    disabled={!canEdit || isSaving}
                    required
                  />
                ) : null}
                <TextInput
                  label={spec.kind === "delivery" ? "Fee per extra kilometre (₦)" : "Driver payout per kilometre (₦)"}
                  name={`${spec.kind}-perKmAmount`}
                  type="number"
                  min="0"
                  step="1"
                  value={form.perKmAmount}
                  onChange={(event) => {
                    const nextValue = event.currentTarget.value;
                    updateField("perKmAmount", nextValue);
                  }}
                  disabled={!canEdit || isSaving}
                  required
                />
                {spec.showMinimumAmount ? (
                  <TextInput
                    label="Minimum delivery fee (₦)"
                    name="delivery-minimumAmount"
                    type="number"
                    min="0"
                    step="1"
                    value={form.minimumAmount}
                    onChange={(event) => {
                      const nextValue = event.currentTarget.value;
                      updateField("minimumAmount", nextValue);
                    }}
                    disabled={!canEdit || isSaving}
                    required
                  />
                ) : null}
                <TextInput
                  label={spec.kind === "delivery" ? "Extra load fee per kg (₦)" : "Driver payout per kg carried (₦)"}
                  name={`${spec.kind}-loadAmountPerKg`}
                  type="number"
                  min="0"
                  step="1"
                  value={form.loadAmountPerKg}
                  onChange={(event) => {
                    const nextValue = event.currentTarget.value;
                    updateField("loadAmountPerKg", nextValue);
                  }}
                  disabled={!canEdit || isSaving}
                  required
                />
              </div>

              <TextAreaInput
                label="Reason for this change"
                value={form.reason}
                onChange={(event) => {
                  const nextValue = event.currentTarget.value;
                  updateField("reason", nextValue);
                }}
                rows={3}
                disabled={!canEdit || isSaving}
                required
              />

              <div className={superAdmin ? "admin-money-immediate-note" : "admin-inline-warning"}>
                {superAdmin ? (
                  <>
                    <strong>Immediate for new work.</strong> Existing accepted LPG quotes keep their locked financial snapshot, so changing this price does not rewrite an order already accepted by a customer.
                  </>
                ) : (
                  <>
                    Saving here submits a proposal. It does <strong>not</strong> change the live price until an authorized reviewer and activator completes the governed workflow.
                  </>
                )}
              </div>

              {spec.kind === "driver" ? (
                <div className="admin-money-guardrail">
                  Driver payout = base + route distance × per-km rate + requested kg × per-kg rate. The quote engine rejects a driver payout that is greater than the customer delivery fee.
                </div>
              ) : null}

              <div className="admin-money-form-actions">
                <Button
                  icon={superAdmin ? BadgeDollarSign : Send}
                  type="submit"
                  isLoading={isSaving}
                  disabled={!canEdit || !hasChanged || isSaving}
                >
                  {superAdmin ? "Save & apply now" : "Submit pricing proposal"}
                </Button>
                {!canEdit ? <p className="skima-muted">Your admin role can view this pricing but cannot change it.</p> : null}
                {canEdit && !hasChanged ? <p className="skima-muted">Change at least one pricing field before saving.</p> : null}
              </div>
            </form>
          </section>
        </>
      ) : null}

      {(!superAdmin || pendingVersions.length > 0 || versions.isLoading || versions.error) ? (
        <section className="sk-panel">
          <div className="sk-panel__header">
            <div>
              <p className="admin-section-kicker">Delegated finance workflow</p>
              <h2>{spec.pendingTitle}</h2>
              <p className="skima-muted">{spec.pendingDescription}</p>
            </div>
          </div>
          {versions.isLoading ? <LoadingState label="Loading pricing proposals" /> : null}
          {versions.error ? (
            <ErrorState
              title="Pricing proposals unavailable"
              message={readError(versions.error, spec)}
              onRetry={() => void versions.refetch()}
            />
          ) : null}
          {!versions.isLoading && !versions.error ? (
            <DataTable
              caption={spec.pendingTitle}
              columns={pendingColumns}
              records={pendingVersions}
              getRowKey={(version) => version.id}
              emptyTitle="No pricing proposals waiting"
              emptyMessage="The live pricing version is the only active configuration."
            />
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function buildConfiguration(
  spec: PricingSpec,
  currentConfiguration: MoneyPolicyConfiguration,
  form: PricingForm,
): MoneyPolicyConfiguration {
  const values = parseForm(spec, form);
  if (spec.kind === "driver") {
    return {
      ...currentConfiguration,
      base_amount: values.baseAmount,
      per_km_amount: values.perKmAmount,
      load_amount_per_kg: values.loadAmountPerKg,
    };
  }

  return {
    ...currentConfiguration,
    base_amount: values.baseAmount,
    included_km: values.includedKm,
    per_km_amount: values.perKmAmount,
    minimum_amount: values.minimumAmount,
    load_amount_per_kg: values.loadAmountPerKg,
    distance_bands: updatePrimaryDistanceBand(currentConfiguration.distance_bands, values),
  };
}

function parseForm(spec: PricingSpec, form: PricingForm) {
  const values = {
    baseAmount: Number(form.baseAmount),
    includedKm: spec.showIncludedKm ? Number(form.includedKm) : 0,
    perKmAmount: Number(form.perKmAmount),
    minimumAmount: spec.showMinimumAmount ? Number(form.minimumAmount) : 0,
    loadAmountPerKg: Number(form.loadAmountPerKg),
  };

  for (const [key, value] of Object.entries(values)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${normalizeStatusLabel(key)} must be zero or greater.`);
    }
  }
  return values;
}

function updatePrimaryDistanceBand(
  bands: readonly Record<string, unknown>[] | undefined,
  values: ReturnType<typeof parseForm>,
): Record<string, unknown>[] {
  const currentBands = bands?.length ? bands : [{
    key: "configured-local-service",
    min_km: 0,
    max_km: 20,
    supported: true,
  }];

  return currentBands.map((band, index) => index === 0 ? {
    ...band,
    base_amount: values.baseAmount,
    included_km: values.includedKm,
    per_km_amount: values.perKmAmount,
    minimum_amount: values.minimumAmount,
  } : band);
}

function formChanged(
  spec: PricingSpec,
  form: PricingForm,
  configuration: MoneyPolicyConfiguration,
): boolean {
  const values = parseForm(spec, form);
  return values.baseAmount !== configuration.base_amount ||
    values.perKmAmount !== configuration.per_km_amount ||
    values.loadAmountPerKg !== configuration.load_amount_per_kg ||
    (spec.showIncludedKm && values.includedKm !== configuration.included_km) ||
    (spec.showMinimumAmount && values.minimumAmount !== configuration.minimum_amount);
}

function pricingSummary(spec: PricingSpec, configuration: MoneyPolicyConfiguration) {
  if (spec.kind === "driver") {
    return (
      <>
        Base <strong>{money(configuration.base_amount)}</strong><br />
        <small>{money(configuration.per_km_amount)}/km · {money(configuration.load_amount_per_kg)}/kg carried</small>
      </>
    );
  }

  return (
    <>
      Base <strong>{money(configuration.base_amount)}</strong><br />
      <small>
        {configuration.included_km} km included · {money(configuration.per_km_amount)}/km after · minimum {money(configuration.minimum_amount)}
      </small>
    </>
  );
}

function money(amount: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function isSuperAdmin(context: ReturnType<typeof useSessionState>["context"]): boolean {
  return context?.platformAdmin?.admin_kind === "super_admin";
}

function readError(error: unknown, spec: PricingSpec): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "details", "hint", "code"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  return `SKIMA could not load ${spec.title.toLowerCase()}. Refresh the page or check the financial policy runtime.`;
}
