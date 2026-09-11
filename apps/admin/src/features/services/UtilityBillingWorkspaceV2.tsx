import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BadgeDollarSign,
  BadgePercent,
  Boxes,
  FlaskConical,
  LayoutDashboard,
  PlugZap,
  RefreshCcw,
  ServerCog,
  Settings2,
} from "lucide-react";

import { AdminUtilityBillingWorkspace } from "../../admin-utility-billing-workspace";
import { useSessionState } from "../../session";
import { AdminV2PageHeader } from "../../shared/patterns/AdminV2Patterns";
import { Button, ErrorState, LoadingState, MetricTile, StatusBadge } from "@skima/ui";
import { UtilityCampaignsScreen } from "./UtilityCampaignsScreen";
import { UtilityCatalogueScreen } from "./UtilityCatalogueScreen";
import { UtilityEconomicsScreen, UtilityRoutingScreen } from "./UtilityEconomicsScreens";
import { UtilityLiveTestScreen } from "./UtilityLiveTestScreen";
import { UtilityOperationsScreen } from "./UtilityOperationsScreen";
import { UtilityProvidersScreen } from "./UtilityProvidersScreen";
import {
  UtilitySnapshotSchema,
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
  const { api, status } = useSessionState();
  const snapshot = useQuery({
    queryKey: ["admin-utility-billing-v2"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: () => api.get("/admin/utility-billing/configuration", UtilitySnapshotSchema),
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
  const readyProviders = props.data.providers.filter((item) => utilityFlag(item, "runtime_ready")).length;
  const activeRoutes = props.data.routes.filter((item) => utilityText(item, "status") === "active").length;
  const unresolved = props.data.payments.filter((item) => ["processing", "reconciliation_required"].includes(utilityText(item, "status"))).length;
  const campaigns = props.data.promotions.length + props.data.cashbacks.length;

  const tasks = [
    { key: "providers", title: "Provider connections", description: "Add providers, verify secret references, test their APIs and control activation.", href: `${BASE}/providers`, icon: ServerCog },
    { key: "catalogue", title: "Provider catalogue", description: "Sync categories, companies and plans from provider adapters instead of copying them manually.", href: `${BASE}/catalogue`, icon: Boxes },
    { key: "routing", title: "Product routing", description: "Connect SKIMA plans to provider product codes and activate only ready routes.", href: `${BASE}/routing`, icon: PlugZap },
    { key: "economics", title: "Economics & profit guard", description: "Set provider margin, costs and SKIMA's protected minimum contribution.", href: `${BASE}/economics`, icon: BadgeDollarSign },
    { key: "campaigns", title: "Campaigns", description: "Create cashback and discounts that cannot cross the protected profit floor.", href: `${BASE}/campaigns`, icon: BadgePercent },
    { key: "operations", title: "Payment operations", description: "Review provider outcomes and reconcile ambiguous utility transactions safely.", href: `${BASE}/operations`, icon: Activity },
    { key: "live-test", title: "Live provider test", description: "Run a small real-money vend before enabling provider fulfillment for customers.", href: `${BASE}/live-test`, icon: FlaskConical },
  ] as const;

  return (
    <div className="utility-v2__screen">
      <AdminV2PageHeader
        eyebrow="Services · Utility billing"
        title="Bills & everyday payments"
        description="Run provider connections, catalogue, routing, economics, campaigns and payment operations as separate jobs instead of one 11-section administration form."
        actions={<><Button icon={RefreshCcw} variant="outline" onClick={() => void props.refresh()}>Refresh</Button><Button icon={Settings2} variant="outline" onClick={() => props.onNavigate(`${BASE}/advanced`)}>Advanced setup</Button></>}
      />

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Providers ready for live vend" value={`${readyProviders}/${props.data.providers.length}`} icon={ServerCog} tone={readyProviders ? "success" : "warning"} />
        <MetricTile label="Customer plans" value={props.data.products.length} icon={Boxes} tone="info" />
        <MetricTile label="Active routes" value={activeRoutes} icon={PlugZap} tone={activeRoutes ? "success" : "warning"} />
        <MetricTile label="Campaigns" value={campaigns} icon={BadgePercent} />
        <MetricTile label="Needs reconciliation" value={unresolved} icon={Activity} tone={unresolved ? "warning" : "success"} />
      </section>

      {unresolved ? <section className="admin-notice"><strong>Payments need attention</strong><p>{unresolved} utility payment{unresolved === 1 ? "" : "s"} still require provider reconciliation. Open Payment Operations before making assumptions about failure or refund.</p><Button size="sm" variant="outline" onClick={() => props.onNavigate(`${BASE}/operations`)}>Review payments</Button></section> : null}

      <section className="utility-v2__task-grid">
        {tasks.map((task) => {
          const Icon = task.icon;
          return (
            <button className="utility-v2__task" type="button" key={task.key} onClick={() => props.onNavigate(task.href)}>
              <span className="utility-v2__task-icon"><Icon aria-hidden="true" /></span>
              <span><strong>{task.title}</strong><small>{task.description}</small></span>
            </button>
          );
        })}
      </section>

      <section className="admin-notice">
        <strong>Profit and payment protection remains server-authoritative</strong>
        <p>V2 changes the operator workflow, not the rules. Provider readiness, route economics, campaign protection and reconciliation continue to use the existing production APIs and database controls.</p>
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
