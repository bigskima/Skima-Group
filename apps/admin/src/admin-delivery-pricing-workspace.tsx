import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, RefreshCcw, Send, Truck } from "lucide-react";
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

const DeliveryConfigurationSchema = z.object({
  base_amount: z.coerce.number().nonnegative().default(0),
  included_km: z.coerce.number().nonnegative().default(0),
  per_km_amount: z.coerce.number().nonnegative().default(0),
  minimum_amount: z.coerce.number().nonnegative().default(0),
  load_amount_per_kg: z.coerce.number().nonnegative().default(0),
  distance_bands: z.array(z.record(z.unknown())).optional(),
}).passthrough();

const ResolvedDeliveryPolicySchema = z.object({
  policyKey: z.literal("pricing.lpg.delivery"),
  policyFamily: z.string(),
  policyVersionId: z.string().uuid(),
  version: z.coerce.number().int(),
  currencyCode: z.string(),
  configuration: DeliveryConfigurationSchema,
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
  configuration: DeliveryConfigurationSchema,
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

type DeliveryForm = {
  baseAmount: string;
  includedKm: string;
  perKmAmount: string;
  minimumAmount: string;
  loadAmountPerKg: string;
  reason: string;
};

const EMPTY_FORM: DeliveryForm = {
  baseAmount: "0",
  includedKm: "0",
  perKmAmount: "0",
  minimumAmount: "0",
  loadAmountPerKg: "0",
  reason: "",
};

export function AdminDeliveryPricingWorkspace() {
  const { api, context, status } = useSessionState();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<DeliveryForm>(EMPTY_FORM);
  const [notice, setNotice] = useState<string | null>(null);

  const canDraft = isSuperAdmin(context) || context?.permissions.includes("platform.financial_policy.draft") || false;
  const canApprove = isSuperAdmin(context) || context?.permissions.includes("platform.financial_policy.approve") || false;
  const canActivate = isSuperAdmin(context) || context?.permissions.includes("platform.financial_policy.activate") || false;

  const current = useQuery({
    queryKey: ["admin-delivery-pricing", "resolved"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: () => api.post(
      "/admin/financial-policies/resolve",
      {
        policyKey: "pricing.lpg.delivery",
        currencyCode: "NGN",
        moduleKey: "lpg",
        serviceKey: "lpg.refill.delivery",
        geographyType: "global",
      },
      ResolvedDeliveryPolicySchema,
    ),
  });

  const versions = useQuery({
    queryKey: ["admin-delivery-pricing", "versions"],
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

  const saveDraft = useMutation({
    mutationFn: async (input: DeliveryForm) => {
      if (!current.data) throw new Error("Current LPG delivery pricing has not loaded yet.");
      const next = parseForm(input);
      const currentConfig = current.data.configuration;
      const nextConfiguration = {
        ...currentConfig,
        base_amount: next.baseAmount,
        included_km: next.includedKm,
        per_km_amount: next.perKmAmount,
        minimum_amount: next.minimumAmount,
        load_amount_per_kg: next.loadAmountPerKg,
        distance_bands: updatePrimaryDistanceBand(currentConfig.distance_bands, next),
      };
      const createId = await api.post(
        "/admin/financial-policies",
        {
          policyKey: "pricing.lpg.delivery",
          displayName: "LPG delivery pricing",
          policyFamily: "pricing",
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
          metadata: { surface: "skima.admin.delivery_pricing" },
          idempotencyKey: createClientIdempotencyKey("admin.delivery-pricing.create", current.data.policyVersionId),
        },
        MutationIdSchema,
      );

      await api.post(
        "/admin/financial-policies/submit",
        {
          policyVersionId: createId,
          reason: input.reason.trim(),
          idempotencyKey: createClientIdempotencyKey("admin.delivery-pricing.submit", createId),
        },
        MutationIdSchema,
      );

      return createId;
    },
    onSuccess: async () => {
      setNotice("Delivery pricing change submitted for approval. The live customer quote remains unchanged until an approved version is activated.");
      setForm((value) => ({ ...value, reason: "" }));
      await queryClient.invalidateQueries({ queryKey: ["admin-delivery-pricing"] });
    },
    onError: (error) => setNotice(readError(error)),
  });

  const reviewVersion = useMutation({
    mutationFn: async ({ version, decision }: { version: PolicyVersion; decision: "approved" | "rejected" }) => {
      await api.post(
        "/admin/financial-policies/review",
        {
          policyVersionId: version.id,
          decision,
          reason: decision === "approved"
            ? "Approved from the SKIMA LPG delivery pricing workspace."
            : "Rejected from the SKIMA LPG delivery pricing workspace.",
          idempotencyKey: createClientIdempotencyKey(`admin.delivery-pricing.${decision}`, version.id),
        },
        MutationIdSchema,
      );
      return { version, decision };
    },
    onSuccess: async ({ decision }) => {
      setNotice(decision === "approved"
        ? "Delivery pricing change approved. Activate it when you want customer quotes to use it."
        : "Delivery pricing change rejected.");
      await queryClient.invalidateQueries({ queryKey: ["admin-delivery-pricing"] });
    },
    onError: (error) => setNotice(readError(error)),
  });

  const activateVersion = useMutation({
    mutationFn: async (version: PolicyVersion) => {
      await api.post(
        "/admin/financial-policies/activate",
        {
          policyVersionId: version.id,
          reason: "Activated from the SKIMA LPG delivery pricing workspace.",
          idempotencyKey: createClientIdempotencyKey("admin.delivery-pricing.activate", version.id),
        },
        MutationIdSchema,
      );
      return version;
    },
    onSuccess: async () => {
      setNotice("LPG delivery pricing is now active for new quotes.");
      await queryClient.invalidateQueries({ queryKey: ["admin-delivery-pricing"] });
    },
    onError: (error) => setNotice(readError(error)),
  });

  const deliveryVersions = useMemo(
    () => (versions.data ?? []).filter((version) =>
      version.financial_policy_definitions.key === "pricing.lpg.delivery" &&
      version.currency_code === "NGN" &&
      ["draft", "submitted", "approved", "scheduled"].includes(version.lifecycle_status)
    ),
    [versions.data],
  );

  const pendingColumns = useMemo<TableColumn<PolicyVersion>[]>(() => [
    {
      key: "version",
      header: "Change",
      render: (version) => (
        <span>
          <strong>Delivery pricing v{version.version}</strong><br />
          <small>{version.change_reason ?? "Pricing update"} · {formatDate(version.created_at)}</small>
        </span>
      ),
    },
    {
      key: "pricing",
      header: "Pricing",
      render: (version) => (
        <span>
          Base <strong>{money(version.configuration.base_amount)}</strong><br />
          <small>
            {version.configuration.included_km} km included · {money(version.configuration.per_km_amount)}/km after · minimum {money(version.configuration.minimum_amount)}
          </small>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (version) => <StatusBadge tone={version.lifecycle_status === "approved" ? "success" : "warning"}>
        {normalizeStatusLabel(version.lifecycle_status)}
      </StatusBadge>,
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
              Approve change
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
        return <span className="skima-muted">No action available for your role</span>;
      },
    },
  ], [
    activateVersion.isPending,
    activateVersion.variables?.id,
    canActivate,
    canApprove,
    reviewVersion.isPending,
    reviewVersion.variables?.version.id,
  ]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(null);
    try {
      parseForm(form);
      if (!form.reason.trim()) throw new Error("Explain why the delivery price is changing.");
      saveDraft.mutate(form);
    } catch (error) {
      setNotice(readError(error));
    }
  };

  const configuration = current.data?.configuration;
  const hasChanged = configuration ? formChanged(form, configuration) : false;

  return (
    <>
      <PageHeader
        eyebrow="LPG pricing"
        title="Delivery Pricing"
        description="Set the customer-facing LPG delivery fee without editing policy JSON. Changes use SKIMA's existing financial governance and do not affect station gas price or the separate SKIMA per-kg service fee."
        actions={(
          <Button
            icon={RefreshCcw}
            variant="outline"
            onClick={() => void Promise.all([current.refetch(), versions.refetch()])}
          >
            Refresh pricing
          </Button>
        )}
      />

      {current.isLoading ? <LoadingState label="Loading LPG delivery pricing" /> : null}
      {current.error ? (
        <ErrorState title="Delivery pricing unavailable" message={readError(current.error)} onRetry={() => void current.refetch()} />
      ) : null}

      {current.data ? (
        <>
          <section className="skima-grid skima-grid--compact">
            <MetricTile label="Base delivery fee" value={money(current.data.configuration.base_amount)} icon={Truck} tone="info" />
            <MetricTile label="Included distance" value={`${current.data.configuration.included_km} km`} icon={Truck} />
            <MetricTile label="Extra distance" value={`${money(current.data.configuration.per_km_amount)} / km`} icon={Truck} />
            <MetricTile label="Minimum delivery fee" value={money(current.data.configuration.minimum_amount)} icon={Truck} />
          </section>

          {notice ? (
            <div className={(saveDraft.error || reviewVersion.error || activateVersion.error) ? "admin-notice is-error" : "admin-notice"} role="status">
              {notice}
            </div>
          ) : null}

          <section className="sk-panel">
            <div className="sk-panel__header">
              <div>
                <h2>Edit LPG delivery pricing</h2>
                <p className="skima-muted">
                  These values apply to new LPG quotes after approval and activation. Existing accepted quotes keep their financial snapshot.
                </p>
              </div>
              <StatusBadge tone="success">Live version {current.data.version}</StatusBadge>
            </div>

            <form className="skima-form" onSubmit={submit}>
              <div className="skima-grid skima-grid--compact">
                <TextInput
                  label="Base delivery fee (₦)"
                  name="baseAmount"
                  type="number"
                  min="0"
                  step="1"
                  value={form.baseAmount}
                  onChange={(event) => setForm((value) => ({ ...value, baseAmount: event.currentTarget.value }))}
                  required
                />
                <TextInput
                  label="Distance included in base fee (km)"
                  name="includedKm"
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.includedKm}
                  onChange={(event) => setForm((value) => ({ ...value, includedKm: event.currentTarget.value }))}
                  required
                />
                <TextInput
                  label="Fee per extra kilometre (₦)"
                  name="perKmAmount"
                  type="number"
                  min="0"
                  step="1"
                  value={form.perKmAmount}
                  onChange={(event) => setForm((value) => ({ ...value, perKmAmount: event.currentTarget.value }))}
                  required
                />
                <TextInput
                  label="Minimum delivery fee (₦)"
                  name="minimumAmount"
                  type="number"
                  min="0"
                  step="1"
                  value={form.minimumAmount}
                  onChange={(event) => setForm((value) => ({ ...value, minimumAmount: event.currentTarget.value }))}
                  required
                />
                <TextInput
                  label="Extra load fee per kg (₦)"
                  name="loadAmountPerKg"
                  type="number"
                  min="0"
                  step="1"
                  value={form.loadAmountPerKg}
                  onChange={(event) => setForm((value) => ({ ...value, loadAmountPerKg: event.currentTarget.value }))}
                  required
                />
              </div>
              <TextAreaInput
                label="Reason for this change"
                value={form.reason}
                onChange={(event) => setForm((value) => ({ ...value, reason: event.currentTarget.value }))}
                rows={3}
                required
              />
              <div className="admin-inline-warning">
                Saving does <strong>not</strong> immediately change customer prices. It submits a governed pricing version for approval; an approved version must then be made live.
              </div>
              <Button
                icon={Send}
                type="submit"
                isLoading={saveDraft.isPending}
                disabled={!canDraft || !hasChanged || saveDraft.isPending}
              >
                Submit pricing change
              </Button>
              {!canDraft ? <p className="skima-muted">Your admin role can view delivery pricing but cannot propose changes.</p> : null}
              {canDraft && !hasChanged ? <p className="skima-muted">Change at least one pricing field before submitting.</p> : null}
            </form>
          </section>
        </>
      ) : null}

      <section className="sk-panel">
        <div className="sk-panel__header">
          <div>
            <h2>Pending delivery pricing changes</h2>
            <p className="skima-muted">Review and activate delivery pricing by its business meaning—not by policy IDs or JSON.</p>
          </div>
        </div>
        {versions.isLoading ? <LoadingState label="Loading pricing approvals" /> : null}
        {versions.error ? <ErrorState title="Pricing approvals unavailable" message={readError(versions.error)} onRetry={() => void versions.refetch()} /> : null}
        {!versions.isLoading && !versions.error ? (
          <DataTable
            caption="LPG delivery pricing approvals"
            columns={pendingColumns}
            records={deliveryVersions}
            getRowKey={(version) => version.id}
            emptyTitle="No delivery pricing changes waiting"
            emptyMessage="The live delivery price is the only active configuration."
          />
        ) : null}
      </section>
    </>
  );
}

function parseForm(form: DeliveryForm) {
  const values = {
    baseAmount: Number(form.baseAmount),
    includedKm: Number(form.includedKm),
    perKmAmount: Number(form.perKmAmount),
    minimumAmount: Number(form.minimumAmount),
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
  const current = bands?.length ? bands : [{
    key: "configured-local-service",
    min_km: 0,
    max_km: 20,
    supported: true,
  }];
  return current.map((band, index) => index === 0 ? {
    ...band,
    base_amount: values.baseAmount,
    per_km_amount: values.perKmAmount,
    minimum_amount: values.minimumAmount,
  } : band);
}

function formChanged(form: DeliveryForm, configuration: z.infer<typeof DeliveryConfigurationSchema>): boolean {
  const values = parseForm(form);
  return values.baseAmount !== configuration.base_amount ||
    values.includedKm !== configuration.included_km ||
    values.perKmAmount !== configuration.per_km_amount ||
    values.minimumAmount !== configuration.minimum_amount ||
    values.loadAmountPerKg !== configuration.load_amount_per_kg;
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

function readError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "details", "hint", "code"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  return "SKIMA could not load LPG delivery pricing. Refresh the page or check the financial policy gateway.";
}
