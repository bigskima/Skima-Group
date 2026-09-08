import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  PlugZap,
  RefreshCcw,
  Route,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { z } from "zod";

import {
  Button,
  ErrorState,
  LoadingState,
  MetricTile,
  PageHeader,
  StatusBadge,
  TextInput,
} from "@skima/ui";

import { useSessionState } from "./session";

const RecordSchema = z.record(z.unknown());
const ConfigurationSchema = z.object({
  definitions: z.array(RecordSchema).default([]),
  providers: z.array(RecordSchema).default([]),
  routes: z.array(RecordSchema).default([]),
});
const ExceptionsSchema = z.array(RecordSchema);
const MutationIdSchema = z.string().uuid();

type PlatformRecord = Readonly<Record<string, unknown>>;

export function AdminVerificationWorkspace(props: {
  readonly onOpenApplications?: () => void;
}) {
  const { api, status, context } = useSessionState();
  const queryClient = useQueryClient();
  const [verificationKey, setVerificationKey] = useState("");
  const [providerKey, setProviderKey] = useState("");
  const [workflowRef, setWorkflowRef] = useState("");
  const [routeStatus, setRouteStatus] = useState<"inactive" | "active" | "paused">("inactive");
  const [priority, setPriority] = useState("100");
  const [notice, setNotice] = useState<string | null>(null);

  const configuration = useQuery({
    queryKey: ["admin-verification-configuration"],
    queryFn: () =>
      api.get("/admin/verification/configuration", ConfigurationSchema),
    enabled: status === "authenticated",
    retry: false,
  });

  const exceptions = useQuery({
    queryKey: ["admin-verification-exceptions"],
    queryFn: () =>
      api.get("/admin/verification/exceptions", ExceptionsSchema),
    enabled: status === "authenticated",
    retry: false,
  });

  const definitions = configuration.data?.definitions ?? [];
  const providers = configuration.data?.providers ?? [];
  const routes = configuration.data?.routes ?? [];

  const canManage =
    context?.platformAdmin?.admin_kind === "super_admin" ||
    context?.permissions.includes("platform.verification.manage") ||
    false;

  const activeProviders = providers.filter(
    (provider) => recordString(provider, "status") === "active",
  );
  const activeRoutes = routes.filter(
    (route) => recordString(route, "status") === "active",
  );
  const exceptionRows = exceptions.data ?? [];
  const supabaseBaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)
    ?.trim()
    .replace(/\/$/, "");
  const diditWebhookUrl = supabaseBaseUrl
    ? `${supabaseBaseUrl}/functions/v1/verification-provider-webhook/didit`
    : "/functions/v1/verification-provider-webhook/didit";

  const selectedRoute = useMemo(
    () =>
      routes.find(
        (route) =>
          recordString(route, "verificationKey") === verificationKey &&
          recordString(route, "providerKey") === providerKey,
      ) ?? null,
    [providerKey, routes, verificationKey],
  );

  const configureRoute = useMutation({
    mutationFn: () =>
      api.post(
        "/admin/verification/provider-route",
        {
          verificationKey,
          providerKey,
          workflowRef: workflowRef.trim() || null,
          status: routeStatus,
          priority: Number(priority) || 100,
          config: {
            configuredFrom: "skima-admin",
          },
        },
        MutationIdSchema,
      ),
    onSuccess: async () => {
      setNotice(
        routeStatus === "active"
          ? "Verification route is active. New checks can use it without a mobile app release."
          : "Verification route saved. Automatic checks will use fallback policy while this route is not active.",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-verification-configuration"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-verification-exceptions"] }),
      ]);
    },
    onError: (error) => setNotice(readError(error)),
  });

  const refresh = () => {
    setNotice(null);
    void Promise.all([configuration.refetch(), exceptions.refetch()]);
  };

  const chooseDefinition = (nextKey: string) => {
    setVerificationKey(nextKey);
    const route = routes.find(
      (item) =>
        recordString(item, "verificationKey") === nextKey &&
        (!providerKey || recordString(item, "providerKey") === providerKey),
    );
    if (route) hydrateRoute(route);
  };

  const chooseProvider = (nextKey: string) => {
    setProviderKey(nextKey);
    const route = routes.find(
      (item) =>
        recordString(item, "verificationKey") === verificationKey &&
        recordString(item, "providerKey") === nextKey,
    );
    if (route) hydrateRoute(route);
  };

  const hydrateRoute = (route: PlatformRecord) => {
    setWorkflowRef(recordString(route, "workflowRef") ?? "");
    setPriority(String(recordNumber(route, "priority") ?? 100));
    const nextStatus = recordString(route, "status");
    setRouteStatus(
      nextStatus === "active" || nextStatus === "paused"
        ? nextStatus
        : "inactive",
    );
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(null);

    if (!verificationKey || !providerKey) {
      setNotice("Choose a verification check and provider first.");
      return;
    }
    if (routeStatus === "active" && !workflowRef.trim()) {
      setNotice("An active route needs the provider workflow ID.");
      return;
    }

    void configureRoute.mutateAsync().catch(() => undefined);
  };

  if (configuration.isLoading || exceptions.isLoading) {
    return <LoadingState label="Loading verification controls" />;
  }

  if (configuration.error || exceptions.error) {
    return (
      <ErrorState
        title="Verification controls unavailable"
        message={readError(configuration.error ?? exceptions.error)}
        onRetry={refresh}
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Partner trust"
        title="Verification"
        description="Automatic verification is the primary path for identity, licence and business checks. Admin review is reserved for exceptions and compliance evidence that cannot be verified automatically."
        actions={
          <Button icon={RefreshCcw} variant="outline" onClick={refresh}>
            Refresh
          </Button>
        }
      />

      <section className="skima-grid skima-grid--compact">
        <MetricTile
          label="Active providers"
          value={activeProviders.length}
          icon={PlugZap}
          tone={activeProviders.length ? "success" : "warning"}
        />
        <MetricTile
          label="Automatic routes"
          value={activeRoutes.length}
          icon={Route}
          tone={activeRoutes.length ? "success" : "neutral"}
        />
        <MetricTile
          label="Exceptions"
          value={exceptionRows.length}
          icon={AlertTriangle}
          tone={exceptionRows.length ? "warning" : "success"}
        />
        <MetricTile
          label="Verification checks"
          value={definitions.length}
          icon={ShieldCheck}
          tone="info"
        />
      </section>

      <section className="sk-panel">
        <div className="sk-panel__header">
          <div>
            <p className="admin-section-kicker">Didit callbacks</p>
            <h2>Verification webhook destination</h2>
            <p>
              Use this endpoint in Didit → API & Webhooks. Subscribe to
              <strong> status.updated</strong> and <strong>data.updated</strong>.
              The signing secret belongs in the Supabase function secret
              <code> DIDIT_WEBHOOK_SECRET</code>; do not paste the secret into this dashboard.
            </p>
          </div>
          <StatusBadge tone="success">Signed HMAC endpoint</StatusBadge>
        </div>
        <div className="admin-notice">
          <strong>Webhook URL</strong>
          <div style={{ marginTop: 6, overflowWrap: "anywhere" }}>
            <code>{diditWebhookUrl}</code>
          </div>
          <div className="skima-action-row" style={{ marginTop: 10 }}>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(diditWebhookUrl);
                setNotice("Didit webhook URL copied.");
              }}
            >
              Copy webhook URL
            </Button>
          </div>
        </div>
      </section>

      {notice ? (
        <div
          className={`admin-notice ${notice.toLowerCase().includes("error") ? "is-error" : ""}`}
          role="status"
        >
          {notice}
        </div>
      ) : null}

      <section className="skima-grid skima-grid--two">
        <div className="sk-panel">
          <div className="sk-panel__header">
            <div>
              <p className="admin-section-kicker">Provider routing</p>
              <h2>Automatic verification route</h2>
              <p>
                Choose the provider workflow for a SKIMA verification check. Secrets stay in Supabase function secrets and are never entered here.
              </p>
            </div>
            <StatusBadge tone={canManage ? "success" : "neutral"}>
              {canManage ? "Manage access" : "Read only"}
            </StatusBadge>
          </div>

          <form className="skima-form-grid" onSubmit={submit}>
            <label className="skima-field">
              <span>Verification check</span>
              <select
                value={verificationKey}
                onChange={(event) => chooseDefinition(event.currentTarget.value)}
                disabled={!canManage}
                required
              >
                <option value="">Choose a check</option>
                {definitions.map((definition) => {
                  const key = recordString(definition, "key") ?? "";
                  return (
                    <option key={key} value={key}>
                      {recordString(definition, "displayName") ?? friendly(key)}
                    </option>
                  );
                })}
              </select>
            </label>

            <label className="skima-field">
              <span>Verification provider</span>
              <select
                value={providerKey}
                onChange={(event) => chooseProvider(event.currentTarget.value)}
                disabled={!canManage}
                required
              >
                <option value="">Choose a provider</option>
                {providers.map((provider) => {
                  const key = recordString(provider, "key") ?? "";
                  return (
                    <option key={key} value={key}>
                      {recordString(provider, "displayName") ?? friendly(key)}
                    </option>
                  );
                })}
              </select>
            </label>

            <TextInput
              label="Provider workflow ID"
              name="workflow-ref"
              helperText={
                verificationKey === "verification.business.registry"
                  ? "Use the Didit KYB workflow ID. A passed KYB check replaces duplicate business-registration evidence only; SKIMA still keeps separate safety and regulatory evidence where required."
                  : verificationKey === "verification.person.identity"
                    ? "Use the Didit KYC workflow that includes identity, liveness and face matching. It is not an API key."
                    : "This is the hosted verification workflow configured with the provider. It is not an API key."
              }
              value={workflowRef}
              onChange={(event) => setWorkflowRef(event.currentTarget.value)}
              disabled={!canManage}
            />

            <label className="skima-field">
              <span>Route status</span>
              <select
                value={routeStatus}
                onChange={(event) =>
                  setRouteStatus(
                    event.currentTarget.value as "inactive" | "active" | "paused",
                  )
                }
                disabled={!canManage}
              >
                <option value="inactive">Inactive — use fallback</option>
                <option value="active">Active — automatic first</option>
                <option value="paused">Paused — temporarily use fallback</option>
              </select>
            </label>

            <TextInput
              label="Route priority"
              name="priority"
              type="number"
              min={0}
              max={10000}
              value={priority}
              onChange={(event) => setPriority(event.currentTarget.value)}
              disabled={!canManage}
            />

            {selectedRoute ? (
              <div className="admin-notice">
                Existing route: {friendly(recordString(selectedRoute, "status") ?? "inactive")}.
                Saving updates this route in place.
              </div>
            ) : null}

            <Button
              icon={ShieldCheck}
              type="submit"
              isLoading={configureRoute.isPending}
              disabled={!canManage}
            >
              Save verification route
            </Button>
          </form>

          <div className="sk-panel__body">
            {providers.map((provider) => (
              <div className="admin-summary-row" key={recordString(provider, "id") ?? recordString(provider, "key")}>
                <div>
                  <strong>{recordString(provider, "displayName") ?? "Verification provider"}</strong>
                  <p>{recordString(provider, "key") ?? "Provider key unavailable"}</p>
                </div>
                <div>
                  <StatusBadge tone={recordString(provider, "status") === "active" ? "success" : "neutral"}>
                    {friendly(recordString(provider, "status") ?? "inactive")}
                  </StatusBadge>
                  <small>
                    Secret: {recordString(provider, "secretRef") ?? "No secret reference configured"}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="sk-panel">
          <div className="sk-panel__header">
            <div>
              <p className="admin-section-kicker">Exception-only review</p>
              <h2>Needs human attention</h2>
              <p>
                Passed automatic checks stay out of this queue. These records still have a failed/provider-review check or manual regulatory evidence outstanding.
              </p>
            </div>
            <StatusBadge tone={exceptionRows.length ? "warning" : "success"}>
              {exceptionRows.length ? `${exceptionRows.length} open` : "Clear"}
            </StatusBadge>
          </div>

          <div className="sk-panel__body">
            {exceptionRows.length === 0 ? (
              <div className="admin-empty-state">
                <CheckCircle2 aria-hidden="true" />
                <strong>No verification exceptions</strong>
                <p>Automatic checks and required evidence are currently reconciled.</p>
              </div>
            ) : (
              exceptionRows.map((item) => {
                const unresolved = recordNumber(item, "unresolvedVerificationCount") ?? 0;
                const manual = recordNumber(item, "manualReviewCount") ?? 0;
                const latestStatus = recordString(item, "latestVerificationStatus");
                return (
                  <div
                    className="admin-summary-row"
                    key={recordString(item, "applicationId") ?? recordString(item, "publicReference")}
                  >
                    <div>
                      <strong>
                        {recordString(item, "applicantName") ??
                          recordString(item, "publicReference") ??
                          "Partner application"}
                      </strong>
                      <p>
                        {friendly(recordString(item, "applicationCategory") ?? "partner")} ·{" "}
                        {recordString(item, "publicReference") ?? "Reference pending"}
                      </p>
                      {recordString(item, "latestFailureMessage") ? (
                        <small>{recordString(item, "latestFailureMessage")}</small>
                      ) : null}
                    </div>
                    <div>
                      <StatusBadge tone={latestStatus === "failed" ? "danger" : "warning"}>
                        {latestStatus
                          ? friendly(latestStatus)
                          : manual > 0
                            ? "Manual compliance review"
                            : "Verification pending"}
                      </StatusBadge>
                      <small>
                        {unresolved} automatic · {manual} manual
                      </small>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {exceptionRows.length && props.onOpenApplications ? (
            <div className="sk-panel__footer">
              <Button icon={UserCheck} variant="outline" onClick={props.onOpenApplications}>
                Open application review
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      <section className="sk-panel">
        <div className="sk-panel__header">
          <div>
            <p className="admin-section-kicker">Current routes</p>
            <h2>Verification routing map</h2>
            <p>
              The mobile app asks SKIMA which route is active, so providers can be changed here without redeploying the app.
            </p>
          </div>
        </div>
        <div className="sk-panel__body">
          {routes.length === 0 ? (
            <div className="admin-empty-state">
              <Route aria-hidden="true" />
              <strong>No provider routes configured</strong>
              <p>Choose a check and provider above to create the first route.</p>
            </div>
          ) : (
            routes.map((route) => (
              <div className="admin-summary-row" key={recordString(route, "id") ?? JSON.stringify(route)}>
                <div>
                  <strong>
                    {recordString(route, "verificationDisplayName") ??
                      friendly(recordString(route, "verificationKey") ?? "Verification")}
                  </strong>
                  <p>{recordString(route, "providerDisplayName") ?? "Provider unavailable"}</p>
                </div>
                <div>
                  <StatusBadge tone={recordString(route, "status") === "active" ? "success" : "neutral"}>
                    {friendly(recordString(route, "status") ?? "inactive")}
                  </StatusBadge>
                  <small>
                    {recordString(route, "workflowRef")
                      ? `Workflow ${recordString(route, "workflowRef")}`
                      : "Workflow not configured"}
                  </small>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}

function recordString(record: PlatformRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordNumber(record: PlatformRecord, key: string): number | null {
  const value = record[key];
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function friendly(value: string): string {
  return value
    .replace(/^verification\./, "")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Verification controls could not be loaded.";
}
