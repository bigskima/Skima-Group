import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity,
  BadgeDollarSign,
  BadgePercent,
  Boxes,
  CheckCircle2,
  CircleAlert,
  FlaskConical,
  LayoutDashboard,
  PlugZap,
  RefreshCcw,
  ServerCog,
  Settings2,
} from "lucide-react";

import { ApiGatewayError } from "@skima/frontend-core";
import { Button, ErrorState, LoadingState, MetricTile, StatusBadge } from "@skima/ui";

import { AdminUtilityBillingWorkspace } from "../../admin-utility-billing-workspace";
import { useSessionState } from "../../session";
import { AdminV2PageHeader } from "../../shared/patterns/AdminV2Patterns";
import { UtilityCampaignsScreen } from "./UtilityCampaignsScreen";
import { UtilityCatalogueScreen } from "./UtilityCatalogueScreen";
import { UtilityEconomicsScreen, UtilityRoutingScreen } from "./UtilityEconomicsScreens";
import { UtilityLiveTestScreen } from "./UtilityLiveTestScreen";
import { UtilityOperationsScreen } from "./UtilityOperationsScreen";
import { UtilityProvidersScreen } from "./UtilityProvidersScreen";
import {
  UtilityMutationIdSchema,
  UtilityPreviewSchema,
  UtilitySnapshotSchema,
  friendlyUtilityText,
  utilityError,
  utilityFlag,
  utilityText,
} from "./utility-billing-v2-shared";
import "./utility-billing-v2.css";

const BASE = "/services/utility-billing";

const sections = [
  { key: "overview", label: "Overview", href: BASE, icon: LayoutDashboard },
  { key: "providers", label: "Providers", href: `${BASE}/providers`, icon: ServerCog },
  { key: "catalogue", label: "Catalogue", href: `${BASE}/catalogue`, icon: Boxes },
  { key: "routing", label: "Routing", href: `${BASE}/routing`, icon: PlugZap },
  { key: "economics", label: "Economics", href: `${BASE}/economics`, icon: BadgeDollarSign },
  { key: "campaigns", label: "Campaigns", href: `${BASE}/campaigns`, icon: BadgePercent },
  { key: "operations", label: "Operations", href: `${BASE}/operations`, icon: Activity },
  { key: "live-test", label: "Live test", href: `${BASE}/live-test`, icon: FlaskConical },
] as const;

export function UtilityBillingWorkspaceV2(props: {
  route: string;
  onNavigate: (href: string) => void;
}) {
  const { api, status, supabase } = useSessionState();
  const snapshot = useQuery({
    queryKey: ["admin-utility-billing-v2"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      try {
        return await api.get("/admin/utility-billing/configuration", UtilitySnapshotSchema);
      } catch (error) {
        // The utility configuration endpoint historically returned an RPC result through the
        // mutation/id envelope helper. Older deployed gateway versions therefore fail the JSON
        // envelope contract even though the protected database RPC itself is healthy. Keep the
        // gateway as the primary path, but recover through the same permission-checked RPC so the
        // operator console does not become unavailable while an Edge deployment catches up.
        if (
          !(error instanceof ApiGatewayError) ||
          !["invalid_json_response", "invalid_backend_response"].includes(error.code)
        ) {
          throw error;
        }

        const { data, error: rpcError } = await supabase.rpc("read_utility_admin_configuration");
        if (rpcError) throw new Error(rpcError.message);
        return UtilitySnapshotSchema.parse(data);
      }
    },
  });

  if (props.route === `${BASE}/advanced`) {
    return (
      <div className="utility-v2">
        <UtilitySectionNav route={props.route} onNavigate={props.onNavigate} />
        <section className="admin-notice">
          <strong>Advanced utility setup</strong>
          <p>This compatibility console contains manual service-type/company/plan creation and the original all-in-one controls. Normal provider, catalogue, economics, routing, campaign and payment work should use the focused V2 screens.</p>
        </section>
        <AdminUtilityBillingWorkspace />
      </div>
    );
  }

  if (snapshot.isLoading) return <LoadingState label="Loading utility billing" />;
  if (snapshot.error || !snapshot.data) {
    return <ErrorState title="Utility billing unavailable" message={snapshot.error?.message ?? "The utility billing configuration could not be loaded."} onRetry={() => void snapshot.refetch()} />;
  }

  const data = snapshot.data;
  const refresh = async () => { await snapshot.refetch(); };
  const content = routeContent(props.route, data, refresh, props.onNavigate);

  return (
    <div className="utility-v2">
      {props.route !== BASE ? <UtilitySectionNav route={props.route} onNavigate={props.onNavigate} /> : null}
      {content}
    </div>
  );
}

function routeContent(
  route: string,
  data: ReturnType<typeof UtilitySnapshotSchema.parse>,
  refresh: () => Promise<void>,
  onNavigate: (href: string) => void,
) {
  if (route === `${BASE}/providers`) return <UtilityProvidersScreen data={data} refresh={refresh} />;
  if (route === `${BASE}/catalogue`) return <UtilityCatalogueScreen data={data} refresh={refresh} onNavigate={onNavigate} />;
  if (route === `${BASE}/routing`) return <UtilityRoutingScreen data={data} refresh={refresh} />;
  if (route === `${BASE}/economics`) return <UtilityEconomicsScreen data={data} refresh={refresh} />;
  if (route === `${BASE}/campaigns`) return <UtilityCampaignsScreen data={data} refresh={refresh} />;
  if (route === `${BASE}/operations`) return <UtilityOperationsScreen data={data} refresh={refresh} />;
  if (route === `${BASE}/live-test`) return <UtilityLiveTestScreen data={data} refresh={refresh} />;
  return <UtilityOverview data={data} refresh={refresh} onNavigate={onNavigate} />;
}

function UtilityOverview(props: {
  data: ReturnType<typeof UtilitySnapshotSchema.parse>;
  refresh: () => Promise<void>;
  onNavigate: (href: string) => void;
}) {
  const { api } = useSessionState();
  const provider = props.data.providers.find((item) => utilityText(item, "status") !== "disabled") ?? props.data.providers[0];
  const providerKey = utilityText(provider, "key");
  const providerName = utilityText(provider, "display_name") || "Utility provider";
  const secretReady = utilityFlag(provider, "secret_configured");
  const runtimeReady = utilityFlag(provider, "runtime_ready");
  const syncReady = utilityFlag(provider, "catalog_sync_ready");
  const providerActive = utilityText(provider, "status") === "active";
  const catalogueReady = props.data.products.length > 0;
  const economicsReady = props.data.economics.length > 0;
  const activeRoutes = props.data.routes.filter((item) => utilityText(item, "status") === "active").length;
  const routesReady = activeRoutes > 0;
  const readyProviders = props.data.providers.filter((item) => utilityFlag(item, "runtime_ready")).length;
  const unresolved = props.data.payments.filter((item) => ["processing", "reconciliation_required"].includes(utilityText(item, "status"))).length;
  const campaigns = props.data.promotions.length + props.data.cashbacks.length;
  const activeCategories = props.data.categories.filter((item) => utilityText(item, "status") === "active");

  const testProvider = useMutation({
    mutationFn: () => api.post(
      "/admin/utility-billing/providers/test",
      { providerKey },
      UtilityPreviewSchema,
    ),
    onSuccess: props.refresh,
  });

  const syncCatalogue = useMutation({
    mutationFn: () => api.post(
      "/admin/utility-billing/catalog-sync/run",
      { providerKey },
      UtilityPreviewSchema,
    ),
    onSuccess: props.refresh,
  });

  const activateProvider = useMutation({
    mutationFn: () => api.post(
      "/admin/utility-billing/providers/status",
      { providerKey, status: "active" },
      UtilityMutationIdSchema,
    ),
    onSuccess: props.refresh,
  });

  const setupSteps = [
    {
      key: "provider",
      number: 1,
      title: "Connect & test provider",
      description: providerKey
        ? `${providerName} is connected. Test the API once the Edge secret is available.`
        : "Add the bill-payment provider that will fulfill airtime, data and electricity purchases.",
      complete: Boolean(providerKey && secretReady && runtimeReady),
      actionLabel: providerKey ? "Test connection" : "Add provider",
      disabled: Boolean(providerKey && !secretReady),
      loading: testProvider.isPending,
      action: () => providerKey ? testProvider.mutate() : props.onNavigate(`${BASE}/providers`),
    },
    {
      key: "catalogue",
      number: 2,
      title: "Import services",
      description: catalogueReady
        ? `${props.data.products.length} customer plan${props.data.products.length === 1 ? "" : "s"} imported.`
        : "Import networks, discos, billers and plans from the provider instead of entering them one by one.",
      complete: catalogueReady,
      actionLabel: catalogueReady ? "Review catalogue" : "Sync catalogue",
      disabled: !providerKey || !syncReady,
      loading: syncCatalogue.isPending,
      action: () => catalogueReady ? props.onNavigate(`${BASE}/catalogue`) : syncCatalogue.mutate(),
    },
    {
      key: "economics",
      number: 3,
      title: "Set your profit rules",
      description: economicsReady
        ? "Pricing and minimum-profit protection have been configured."
        : "Set what SKIMA earns while keeping provider cost and campaign discounts inside the protected profit floor.",
      complete: economicsReady,
      actionLabel: economicsReady ? "Review pricing" : "Set pricing",
      disabled: false,
      loading: false,
      action: () => props.onNavigate(`${BASE}/economics`),
    },
    {
      key: "routes",
      number: 4,
      title: "Enable & test selling",
      description: routesReady
        ? `${activeRoutes} active route${activeRoutes === 1 ? "" : "s"}. Run a small live vend before broad customer release.`
        : "Choose which imported plans SKIMA should sell, then run a small provider test vend before going fully live.",
      complete: routesReady && providerActive,
      actionLabel: routesReady ? "Live test" : "Enable services",
      disabled: false,
      loading: false,
      action: () => props.onNavigate(routesReady ? `${BASE}/live-test` : `${BASE}/routing`),
    },
  ] as const;

  const nextStep = setupSteps.find((step) => !step.complete);
  const canActivateProvider = Boolean(providerKey && runtimeReady && secretReady && catalogueReady && economicsReady && routesReady && !providerActive);

  const tasks = [
    { key: "campaigns", title: "Campaigns", description: "Create cashback and discounts without crossing your protected profit floor.", href: `${BASE}/campaigns`, icon: BadgePercent },
    { key: "operations", title: "Payment operations", description: "Review provider outcomes and reconcile ambiguous utility transactions safely.", href: `${BASE}/operations`, icon: Activity },
    { key: "live-test", title: "Live provider test", description: "Run a small real-money vend before releasing a service widely to customers.", href: `${BASE}/live-test`, icon: FlaskConical },
  ] as const;

  return (
    <div className="utility-v2__screen">
      <AdminV2PageHeader
        eyebrow="Services · Utility billing"
        title="Start selling bills in a few steps"
        description="Connect a provider once, import its catalogue, set SKIMA profit rules and enable only the airtime, data, electricity and other services you want to sell."
        actions={<><Button icon={RefreshCcw} variant="outline" onClick={() => void props.refresh()}>Refresh</Button><Button icon={Settings2} variant="outline" onClick={() => props.onNavigate(`${BASE}/advanced`)}>Advanced</Button></>}
      />

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Provider ready" value={`${readyProviders}/${props.data.providers.length}`} icon={ServerCog} tone={readyProviders ? "success" : "warning"} />
        <MetricTile label="Imported plans" value={props.data.products.length} icon={Boxes} tone={catalogueReady ? "success" : "info"} />
        <MetricTile label="Active services" value={activeRoutes} icon={PlugZap} tone={activeRoutes ? "success" : "warning"} />
        <MetricTile label="Campaigns" value={campaigns} icon={BadgePercent} />
        <MetricTile label="Needs reconciliation" value={unresolved} icon={Activity} tone={unresolved ? "warning" : "success"} />
      </section>

      <section className="sk-panel utility-v2__quick-setup">
        <div className="sk-panel__header">
          <div>
            <h2>Quick setup</h2>
            <p className="skima-muted">Follow these in order. Technical provider fields stay under Advanced and do not need to be touched for normal setup.</p>
          </div>
          <StatusBadge tone={setupSteps.every((step) => step.complete) ? "success" : "warning"}>
            {setupSteps.filter((step) => step.complete).length}/{setupSteps.length} complete
          </StatusBadge>
        </div>

        <div className="utility-v2__setup-grid">
          {setupSteps.map((step) => (
            <article className={`utility-v2__setup-step ${step.complete ? "is-complete" : ""}`} key={step.key}>
              <div className="utility-v2__setup-step-heading">
                <span className="utility-v2__setup-number">{step.complete ? <CheckCircle2 aria-hidden="true" /> : step.number}</span>
                <StatusBadge tone={step.complete ? "success" : "warning"}>{step.complete ? "Done" : "Next"}</StatusBadge>
              </div>
              <div>
                <strong>{step.title}</strong>
                <p>{step.description}</p>
              </div>
              <Button size="sm" variant={step.complete ? "outline" : "primary"} disabled={step.disabled} isLoading={step.loading} onClick={step.action}>
                {step.actionLabel}
              </Button>
            </article>
          ))}
        </div>

        {nextStep ? (
          <div className="utility-v2__next-action">
            <span><strong>Next:</strong> {nextStep.title}</span>
            <Button size="sm" disabled={nextStep.disabled} isLoading={nextStep.loading} onClick={nextStep.action}>{nextStep.actionLabel}</Button>
          </div>
        ) : null}

        {canActivateProvider ? (
          <div className="utility-v2__next-action">
            <span><strong>Provider is prepared.</strong> Activate it after your live vend has passed.</span>
            <Button size="sm" variant="outline" isLoading={activateProvider.isPending} onClick={() => activateProvider.mutate()}>Activate provider</Button>
          </div>
        ) : null}

        {(!secretReady && providerKey) ? <section className="admin-notice"><strong>Provider secret is not ready</strong><p>Add the provider API key as a Supabase Edge secret, then return here and tap Test connection. The key value is never stored in the database.</p><Button size="sm" variant="outline" onClick={() => props.onNavigate(`${BASE}/providers`)}>Open provider setup</Button></section> : null}
        {testProvider.error || syncCatalogue.error || activateProvider.error ? <StatusBadge tone="danger">{utilityError(testProvider.error ?? syncCatalogue.error ?? activateProvider.error)}</StatusBadge> : null}
      </section>

      <section className="sk-panel">
        <div className="sk-panel__header">
          <div><h2>Services you can configure</h2><p className="skima-muted">These service types come from SKIMA configuration. Provider plans appear automatically after catalogue sync.</p></div>
          <Button size="sm" variant="outline" onClick={() => props.onNavigate(`${BASE}/catalogue`)}>Open catalogue</Button>
        </div>
        <div className="utility-v2__service-chips">
          {activeCategories.map((category) => (
            <span className="utility-v2__service-chip" key={utilityText(category, "id") || utilityText(category, "key")}>
              <CheckCircle2 aria-hidden="true" />
              <span>
                <strong>{utilityText(category, "display_name") || friendlyUtilityText(utilityText(category, "key"))}</strong>
                <small>{utilityText(category, "description") || "Ready to configure"}</small>
              </span>
            </span>
          ))}
          {activeCategories.length === 0 ? <p className="skima-muted">No utility service categories are enabled yet.</p> : null}
        </div>
      </section>

      {unresolved ? <section className="admin-notice"><strong>Payments need attention</strong><p>{unresolved} utility payment{unresolved === 1 ? "" : "s"} still require provider reconciliation. Open Payment Operations before making assumptions about failure or refund.</p><Button size="sm" variant="outline" onClick={() => props.onNavigate(`${BASE}/operations`)}>Review payments</Button></section> : null}

      <section>
        <div className="utility-v2__section-heading"><div><h2>After setup</h2><p className="skima-muted">These are day-to-day tools; they do not need to be part of the initial configuration flow.</p></div></div>
        <div className="utility-v2__task-grid">
          {tasks.map((task) => {
            const Icon = task.icon;
            return (
              <button className="utility-v2__task" type="button" key={task.key} onClick={() => props.onNavigate(task.href)}>
                <span className="utility-v2__task-icon"><Icon aria-hidden="true" /></span>
                <span><strong>{task.title}</strong><small>{task.description}</small></span>
              </button>
            );
          })}
        </div>
      </section>

      {!runtimeReady && providerKey ? <section className="admin-notice"><CircleAlert aria-hidden="true" /><div><strong>{providerName} still needs a successful API test</strong><p>Your Edge secret reference is {secretReady ? "configured" : "not configured"}. Test the provider before syncing customer products.</p></div></section> : null}

      <section className="admin-notice">
        <strong>Profit and payment protection remains server-authoritative</strong>
        <p>The simplified setup changes only the operator workflow. Provider readiness, route economics, campaign protection and reconciliation continue to use the existing production APIs and database controls.</p>
      </section>
    </div>
  );
}

function UtilitySectionNav(props: { route: string; onNavigate: (href: string) => void }) {
  return (
    <nav className="utility-v2__nav" aria-label="Utility billing sections">
      {sections.map((section) => {
        const Icon = section.icon;
        const active = props.route === section.href;
        return <button key={section.key} type="button" className={active ? "is-active" : undefined} aria-current={active ? "page" : undefined} onClick={() => props.onNavigate(section.href)}><Icon aria-hidden="true" />{section.label}</button>;
      })}
    </nav>
  );
}
