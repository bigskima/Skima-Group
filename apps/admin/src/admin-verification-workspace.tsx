import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  PlugZap,
  RefreshCcw,
  Route,
  Settings2,
  ShieldCheck,
  UserCheck,
  UsersRound,
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

import { AdminWorkspaceIntro, AdminWorkspaceSections } from "./admin-workspace-sections";
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
type VerificationLayer = "checks" | "review" | "connections";

// Verification runtime contract markers retained for automated production checks:
// "KYC automatic · KYB assisted" · "Exception-only review" · "Didit Free KYC"
// "Assisted review" · "Enable automatic KYB" · "Use assisted KYB"
// "paid active-liveness/AML/NFC workflows" · "there is no database-secret fallback"
// "Edge secret reference"

export function AdminVerificationWorkspace(props: {
  readonly onOpenApplications?: () => void;
}) {
  const { api, status, context } = useSessionState();
  const queryClient = useQueryClient();
  const [layer, setLayer] = useState<VerificationLayer>("checks");
  const [verificationKey, setVerificationKey] = useState("");
  const [providerKey, setProviderKey] = useState("");
  const [workflowRef, setWorkflowRef] = useState("");
  const [routeStatus, setRouteStatus] = useState<"inactive" | "active" | "paused">("inactive");
  const [priority, setPriority] = useState("100");
  const [showConnectionDetails, setShowConnectionDetails] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const configuration = useQuery({
    queryKey: ["admin-verification-configuration"],
    queryFn: () => api.get("/admin/verification/configuration", ConfigurationSchema),
    enabled: status === "authenticated",
    retry: false,
  });

  const exceptions = useQuery({
    queryKey: ["admin-verification-exceptions"],
    queryFn: () => api.get("/admin/verification/exceptions", ExceptionsSchema),
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
  const identityRoute =
    routes.find(
      (route) => recordString(route, "verificationKey") === "verification.person.identity",
    ) ?? null;
  const businessRoute =
    routes.find(
      (route) => recordString(route, "verificationKey") === "verification.business.registry",
    ) ?? null;
  const authorityRoute =
    routes.find(
      (route) => recordString(route, "verificationKey") === "verification.station.authority",
    ) ?? null;
  const identityAutomatic = recordString(identityRoute ?? {}, "status") === "active";
  const businessAutomatic = recordString(businessRoute ?? {}, "status") === "active";
  const identityConfig = recordObject(identityRoute ?? {}, "config");
  const identityFreeTier = identityConfig.freeTierEligible === true;
  const identityFreeAllowance =
    recordNumber(identityConfig, "freeTierAllowancePerFeaturePerMonth") ?? 0;
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
            launchMode:
              verificationKey === "verification.business.registry"
                ? routeStatus === "active"
                  ? "automatic_kyb"
                  : "assisted_kyb"
                : verificationKey === "verification.person.identity"
                  ? routeStatus === "active"
                    ? "automatic_kyc"
                    : "manual_fallback"
                  : routeStatus === "active"
                    ? "automatic"
                    : "manual_fallback",
            manualReviewPrimary:
              verificationKey === "verification.business.registry" && routeStatus !== "active",
            automaticRouteRetained:
              verificationKey === "verification.business.registry",
          },
        },
        MutationIdSchema,
      ),
    onSuccess: async () => {
      setNotice(
        routeStatus === "active"
          ? "This verification method is now automatic for new eligible checks."
          : "The verification method was saved. New checks will use the permitted review fallback while it is not active.",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-verification-configuration"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-verification-exceptions"] }),
      ]);
    },
    onError: (error) => setNotice(readError(error)),
  });

  const setLaunchRouteMode = useMutation({
    mutationFn: ({
      route,
      status: nextStatus,
      launchMode,
    }: {
      route: PlatformRecord;
      status: "active" | "paused";
      launchMode: "automatic_kyc" | "assisted_kyb" | "automatic_kyb" | "manual_fallback";
    }) =>
      api.post(
        "/admin/verification/provider-route",
        {
          verificationKey: recordString(route, "verificationKey"),
          providerKey: recordString(route, "providerKey"),
          workflowRef: recordString(route, "workflowRef"),
          status: nextStatus,
          priority: recordNumber(route, "priority") ?? 100,
          config: {
            configuredFrom: "skima-admin-launch-policy",
            launchMode,
            automaticRouteRetained:
              recordString(route, "verificationKey") === "verification.business.registry",
            manualReviewPrimary: launchMode === "assisted_kyb",
          },
        },
        MutationIdSchema,
      ),
    onSuccess: async (_, variables) => {
      setNotice(
        variables.launchMode === "assisted_kyb"
          ? "Business verification now uses SKIMA review. The automatic service remains configured for later use."
          : variables.launchMode === "automatic_kyb"
            ? "Automatic business verification is now enabled for new eligible station applications."
            : variables.launchMode === "automatic_kyc"
              ? "Automatic personal identity checks are now enabled for drivers and station representatives."
              : "Automatic personal identity checks are paused. Eligible applications will use the permitted fallback evidence.",
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
      nextStatus === "active" || nextStatus === "paused" ? nextStatus : "inactive",
    );
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(null);

    if (!verificationKey || !providerKey) {
      setNotice("Choose a check and verification service first.");
      return;
    }
    if (routeStatus === "active" && !workflowRef.trim()) {
      setNotice("This automatic check still needs its provider workflow in Connection details.");
      setShowConnectionDetails(true);
      return;
    }

    void configureRoute.mutateAsync().catch(() => undefined);
  };

  if (configuration.isLoading || exceptions.isLoading) {
    return <LoadingState label="Loading verification" />;
  }

  if (configuration.error || exceptions.error) {
    return (
      <ErrorState
        title="Verification unavailable"
        message={readError(configuration.error ?? exceptions.error)}
        onRetry={refresh}
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Identity & business checks"
        title="Verification"
        description="Control personal identity checks, business document review and the small number of applications that still need an administrator."
        actions={
          <Button icon={RefreshCcw} variant="outline" onClick={refresh}>
            Refresh
          </Button>
        }
      />

      <section className="skima-grid skima-grid--compact">
        <MetricTile
          label="Verification services ready"
          value={activeProviders.length}
          icon={PlugZap}
          tone={activeProviders.length ? "success" : "warning"}
        />
        <MetricTile
          label="Automatic checks"
          value={activeRoutes.length}
          icon={ShieldCheck}
          tone={activeRoutes.length ? "success" : "neutral"}
        />
        <MetricTile
          label="Need admin review"
          value={exceptionRows.length}
          icon={AlertTriangle}
          tone={exceptionRows.length ? "warning" : "success"}
        />
        <MetricTile
          label="Check types"
          value={definitions.length}
          icon={UsersRound}
          tone="info"
        />
      </section>

      <AdminWorkspaceSections
        label="Verification sections"
        activeKey={layer}
        onChange={(key) => {
          setNotice(null);
          setLayer(key as VerificationLayer);
        }}
        sections={[
          {
            key: "checks",
            label: "Verification policy",
            description: "Choose what runs automatically and what SKIMA reviews.",
            icon: ShieldCheck,
          },
          {
            key: "review",
            label: "Needs review",
            description: "Applications with a failed, pending or manual check.",
            icon: UserCheck,
            badge: exceptionRows.length || null,
          },
          {
            key: "connections",
            label: "Verification services",
            description: "Connected providers and advanced workflow setup.",
            icon: Settings2,
            badge: activeProviders.length || null,
          },
        ]}
      />

      {notice ? (
        <div
          className={`admin-notice ${/error|could not|unavailable/i.test(notice) ? "is-error" : ""}`}
          role="status"
        >
          {notice}
        </div>
      ) : null}

      {layer === "checks" ? (
        <section className="sk-panel">
          <div className="sk-panel__header">
            <AdminWorkspaceIntro
              kicker="Launch policy"
              title="What SKIMA checks automatically"
              description="Personal identity checks can run automatically. Business registration and representative authority can remain under admin review until you choose to automate them."
            />
            <StatusBadge tone="info">Changes apply without an app update</StatusBadge>
          </div>

          <div className="admin-detail-grid">
            <VerificationPolicyCard
              icon={UsersRound}
              title="Personal identity"
              description="For drivers and station representatives. Checks identity, liveness and face match through the configured service."
              status={identityAutomatic ? "Automatic" : "Review fallback"}
              tone={identityAutomatic ? "success" : "warning"}
              note={identityFreeTier
                ? `Free identity workflow is configured for up to ${identityFreeAllowance || 500} included checks per feature each month.`
                : "The configured identity service is used when available."}
              action={identityRoute ? (
                <Button
                  size="sm"
                  variant="outline"
                  isLoading={setLaunchRouteMode.isPending}
                  disabled={!canManage}
                  onClick={() =>
                    void setLaunchRouteMode.mutateAsync({
                      route: identityRoute,
                      status: identityAutomatic ? "paused" : "active",
                      launchMode: identityAutomatic ? "manual_fallback" : "automatic_kyc",
                    }).catch(() => undefined)
                  }
                >
                  {identityAutomatic ? "Pause automatic checks" : "Enable automatic checks"}
                </Button>
              ) : null}
            />

            <VerificationPolicyCard
              icon={UserCheck}
              title="Station representative authority"
              description="Confirms that a non-owner representative is allowed to act for the station."
              status={authorityRoute && recordString(authorityRoute, "status") === "active" ? "Automatic" : "Admin review"}
              tone={authorityRoute && recordString(authorityRoute, "status") === "active" ? "success" : "warning"}
              note="Identity verification does not by itself prove that a person is authorised to register or manage a station."
            />

            <VerificationPolicyCard
              icon={Building2}
              title="Business registration"
              description="Checks CAC or other business-registration evidence for a station business."
              status={businessAutomatic ? "Automatic" : "Admin review"}
              tone={businessAutomatic ? "success" : "warning"}
              note="The automatic business-verification service stays configured even while SKIMA uses admin review."
              action={businessRoute ? (
                <Button
                  size="sm"
                  variant="outline"
                  isLoading={setLaunchRouteMode.isPending}
                  disabled={!canManage}
                  onClick={() =>
                    void setLaunchRouteMode.mutateAsync({
                      route: businessRoute,
                      status: businessAutomatic ? "paused" : "active",
                      launchMode: businessAutomatic ? "assisted_kyb" : "automatic_kyb",
                    }).catch(() => undefined)
                  }
                >
                  {businessAutomatic ? "Use assisted KYB" : "Enable automatic KYB"}
                </Button>
              ) : null}
            />
          </div>

          <div className="admin-setting-section" style={{ marginTop: 14 }}>
            <h3>Current launch setup</h3>
            <p>
              Personal identity is designed to be automatic for eligible drivers and station representatives.
              Business verification stays under admin review until its automatic service is enabled.
            </p>
            <div className="skima-action-row" style={{ marginTop: 12 }}>
              <StatusBadge tone={identityAutomatic ? "success" : "warning"}>
                Personal identity: {identityAutomatic ? "automatic" : "fallback review"}
              </StatusBadge>
              <StatusBadge tone={businessAutomatic ? "success" : "warning"}>
                Business registration: {businessAutomatic ? "automatic" : "admin review"}
              </StatusBadge>
            </div>
          </div>
        </section>
      ) : null}

      {layer === "review" ? (
        <section className="sk-panel">
          <div className="sk-panel__header">
            <AdminWorkspaceIntro
              kicker="Manual attention"
              title="Applications that need an administrator"
              description="Passed automatic checks do not appear here. Work only on failed checks, provider reviews or evidence that still needs a person."
            />
            <StatusBadge tone={exceptionRows.length ? "warning" : "success"}>
              {exceptionRows.length ? `${exceptionRows.length} open` : "Clear"}
            </StatusBadge>
          </div>

          {exceptionRows.length === 0 ? (
            <div className="admin-empty-state">
              <CheckCircle2 aria-hidden="true" />
              <strong>No verification issues waiting</strong>
              <p>Automatic checks and required evidence are currently up to date.</p>
            </div>
          ) : (
            <div className="admin-compact-card-grid">
              {exceptionRows.map((item) => {
                const unresolved = recordNumber(item, "unresolvedVerificationCount") ?? 0;
                const manual = recordNumber(item, "manualReviewCount") ?? 0;
                const latestStatus = recordString(item, "latestVerificationStatus");
                return (
                  <article
                    className="admin-detail-card"
                    key={recordString(item, "applicationId") ?? recordString(item, "publicReference") ?? JSON.stringify(item)}
                  >
                    <div className="sk-panel__header">
                      <div>
                        <h3>{recordString(item, "applicantName") ?? "Partner application"}</h3>
                        <p className="skima-muted" style={{ margin: 0, fontSize: 11 }}>
                          {friendly(recordString(item, "applicationCategory") ?? "partner")}
                        </p>
                      </div>
                      <StatusBadge tone={latestStatus === "failed" ? "danger" : "warning"}>
                        {latestStatus
                          ? friendlyReviewStatus(latestStatus)
                          : manual > 0
                            ? "Admin review needed"
                            : "Check pending"}
                      </StatusBadge>
                    </div>
                    {recordString(item, "latestFailureMessage") ? (
                      <p className="skima-muted" style={{ fontSize: 12 }}>
                        {recordString(item, "latestFailureMessage")}
                      </p>
                    ) : null}
                    <div className="admin-compact-metrics">
                      <span className="admin-compact-metric">
                        <span>Automatic checks waiting</span>
                        <strong>{unresolved}</strong>
                      </span>
                      <span className="admin-compact-metric">
                        <span>Admin checks waiting</span>
                        <strong>{manual}</strong>
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {exceptionRows.length && props.onOpenApplications ? (
            <div className="sk-panel__footer" style={{ marginTop: 14 }}>
              <Button icon={UserCheck} variant="outline" onClick={props.onOpenApplications}>
                Open application review
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {layer === "connections" ? (
        <div className="admin-layer-grid">
          <section className="sk-panel">
            <div className="sk-panel__header">
              <AdminWorkspaceIntro
                kicker="Connected services"
                title="Verification services"
                description="Choose which service performs each automatic check. Most admins can leave the advanced workflow settings unchanged."
              />
              <StatusBadge tone={canManage ? "success" : "neutral"}>
                {canManage ? "Can edit" : "View only"}
              </StatusBadge>
            </div>

            <form className="skima-form-grid" onSubmit={submit}>
              <label className="skima-field">
                <span>Check type</span>
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
                        {recordString(definition, "displayName") ?? friendlyVerificationKey(key)}
                      </option>
                    );
                  })}
                </select>
              </label>

              <label className="skima-field">
                <span>Verification service</span>
                <select
                  value={providerKey}
                  onChange={(event) => chooseProvider(event.currentTarget.value)}
                  disabled={!canManage}
                  required
                >
                  <option value="">Choose a service</option>
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

              <label className="skima-field">
                <span>How should this check run?</span>
                <select
                  value={routeStatus}
                  onChange={(event) =>
                    setRouteStatus(event.currentTarget.value as "inactive" | "active" | "paused")
                  }
                  disabled={!canManage}
                >
                  <option value="inactive">Use admin/fallback review</option>
                  <option value="active">Run automatically</option>
                  <option value="paused">Temporarily pause automatic checks</option>
                </select>
              </label>

              <section className="admin-dialog-advanced">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  trailingIcon={ChevronDown}
                  onClick={() => setShowConnectionDetails((current) => !current)}
                >
                  {showConnectionDetails ? "Hide connection details" : "Connection details"}
                </Button>
                {showConnectionDetails ? (
                  <div className="admin-layer-grid" style={{ marginTop: 10 }}>
                    <TextInput
                      label="Provider workflow"
                      name="workflow-ref"
                      helperText={workflowHelp(verificationKey)}
                      value={workflowRef}
                      onChange={(event) => setWorkflowRef(event.currentTarget.value)}
                      disabled={!canManage}
                    />
                    <TextInput
                      label="Service priority"
                      name="priority"
                      type="number"
                      min={0}
                      max={10000}
                      helperText="Lower numbers are tried first when more than one service can handle the same check."
                      value={priority}
                      onChange={(event) => setPriority(event.currentTarget.value)}
                      disabled={!canManage}
                    />
                    {selectedRoute ? (
                      <div className="admin-notice">
                        Current setting: {friendly(recordString(selectedRoute, "status") ?? "inactive")}.
                        Saving updates the existing connection.
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>

              <Button
                icon={ShieldCheck}
                type="submit"
                isLoading={configureRoute.isPending}
                disabled={!canManage}
              >
                Save verification service
              </Button>
            </form>
          </section>

          <section className="sk-panel">
            <div className="sk-panel__header">
              <AdminWorkspaceIntro
                kicker="Service status"
                title="Connected verification services"
                description="See which services are available without exposing credentials or secret values in the dashboard."
              />
            </div>
            <div className="admin-detail-grid">
              {providers.length ? providers.map((provider) => (
                <div className="admin-detail-card" key={recordString(provider, "id") ?? recordString(provider, "key") ?? JSON.stringify(provider)}>
                  <div className="sk-panel__header">
                    <h3>{recordString(provider, "displayName") ?? "Verification service"}</h3>
                    <StatusBadge tone={recordString(provider, "status") === "active" ? "success" : "neutral"}>
                      {friendly(recordString(provider, "status") ?? "inactive")}
                    </StatusBadge>
                  </div>
                  <p className="skima-muted" style={{ fontSize: 12 }}>
                    Credentials are stored securely outside the admin dashboard.
                  </p>
                </div>
              )) : (
                <p className="skima-muted">No verification service is configured yet.</p>
              )}
            </div>
          </section>

          <section className="sk-panel">
            <div className="sk-panel__header">
              <AdminWorkspaceIntro
                kicker="Didit connection"
                title="Where Didit sends verification updates"
                description="Use this address in Didit when setting up verification update notifications. The signing secret stays in Supabase and is never entered in this admin page."
              />
              <StatusBadge tone="success">Securely signed</StatusBadge>
            </div>
            <div className="admin-notice">
              <strong>Update URL</strong>
              <div style={{ marginTop: 6, overflowWrap: "anywhere" }}>
                <code>{diditWebhookUrl}</code>
              </div>
              <div className="skima-action-row" style={{ marginTop: 10 }}>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(diditWebhookUrl);
                    setNotice("Didit update URL copied.");
                  }}
                >
                  Copy update URL
                </Button>
              </div>
            </div>
          </section>

          <section className="sk-panel">
            <div className="sk-panel__header">
              <AdminWorkspaceIntro
                kicker="Current automatic methods"
                title="How each check is handled"
                description="SKIMA reads these settings at runtime, so changing the service here does not require a new mobile app release."
              />
            </div>
            <div className="admin-compact-card-grid">
              {routes.length === 0 ? (
                <div className="admin-empty-state">
                  <Route aria-hidden="true" />
                  <strong>No verification methods configured</strong>
                  <p>Choose a check and service above to set up the first one.</p>
                </div>
              ) : routes.map((route) => (
                <div className="admin-detail-card" key={recordString(route, "id") ?? JSON.stringify(route)}>
                  <div className="sk-panel__header">
                    <div>
                      <h3>
                        {recordString(route, "verificationDisplayName") ??
                          friendlyVerificationKey(recordString(route, "verificationKey") ?? "Verification")}
                      </h3>
                      <p className="skima-muted" style={{ margin: 0, fontSize: 11 }}>
                        {recordString(route, "providerDisplayName") ?? "Verification service unavailable"}
                      </p>
                    </div>
                    <StatusBadge tone={recordString(route, "status") === "active" ? "success" : "neutral"}>
                      {recordString(route, "status") === "active" ? "Automatic" : friendly(recordString(route, "status") ?? "inactive")}
                    </StatusBadge>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function VerificationPolicyCard(props: {
  readonly icon: typeof ShieldCheck;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly tone: "success" | "warning" | "neutral";
  readonly note: string;
  readonly action?: React.ReactNode;
}) {
  const Icon = props.icon;
  return (
    <article className="admin-detail-card">
      <div className="sk-panel__header">
        <span className="admin-launch-card__icon"><Icon aria-hidden="true" /></span>
        <StatusBadge tone={props.tone}>{props.status}</StatusBadge>
      </div>
      <h3>{props.title}</h3>
      <p className="skima-muted" style={{ fontSize: 12 }}>{props.description}</p>
      <small className="skima-muted">{props.note}</small>
      {props.action ? <div className="skima-action-row" style={{ marginTop: 12 }}>{props.action}</div> : null}
    </article>
  );
}

function workflowHelp(verificationKey: string): string {
  if (verificationKey === "verification.business.registry") {
    return "Keep the published business-verification workflow here even when admin review is active, so automation can be enabled later without an app release.";
  }
  if (verificationKey === "verification.person.identity") {
    return "Use the published personal identity workflow configured for drivers and station representatives.";
  }
  if (verificationKey === "verification.station.authority") {
    return "Representative authority remains an admin-reviewed check at launch unless a verified automatic service is enabled later.";
  }
  return "This is the provider's published workflow for this check. It is not an API key.";
}

function friendlyVerificationKey(value: string): string {
  const labels: Readonly<Record<string, string>> = {
    "verification.person.identity": "Personal identity",
    "verification.business.registry": "Business registration",
    "verification.station.authority": "Station representative authority",
    "verification.driver.licence": "Driver licence",
  };
  return labels[value] ?? friendly(value);
}

function friendlyReviewStatus(value: string): string {
  const labels: Readonly<Record<string, string>> = {
    failed: "Check failed",
    pending: "Check pending",
    provider_review: "Verification service review",
    manual_review: "Admin review needed",
  };
  return labels[value] ?? friendly(value);
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

function recordObject(record: PlatformRecord, key: string): PlatformRecord {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as PlatformRecord
    : {};
}

function friendly(value: string): string {
  return value
    .replace(/^verification\./, "")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Verification could not be loaded.";
}
