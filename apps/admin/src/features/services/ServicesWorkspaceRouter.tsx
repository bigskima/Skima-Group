import { Boxes, ShieldCheck, Zap } from "lucide-react";

import { AdminResourceConsole } from "../../admin-resource-console";
import { WorkspaceLanding } from "../../shared/patterns/WorkspaceLanding";
import {
  serviceAvailabilityConfig,
  serviceCatalogConfig,
} from "./services-resource-configs";
import { UtilityBillingWorkspaceV2 } from "./UtilityBillingWorkspaceV2";

export function ServicesWorkspaceRouter(props: {
  readonly route: string;
  readonly onNavigate: (href: string) => void;
}) {
  if (props.route === "/services") return <ServicesOverviewScreen onNavigate={props.onNavigate} />;
  if (props.route === "/services/utility-billing" || props.route.startsWith("/services/utility-billing/")) {
    return <UtilityBillingWorkspaceV2 route={props.route} onNavigate={props.onNavigate} />;
  }
  if (props.route === "/services/catalog") return <AdminResourceConsole config={serviceCatalogConfig} />;
  if (props.route === "/services/availability") return <AdminResourceConsole config={serviceAvailabilityConfig} />;
  return <ServicesOverviewScreen onNavigate={props.onNavigate} />;
}

function ServicesOverviewScreen(props: { readonly onNavigate: (href: string) => void }) {
  return (
    <WorkspaceLanding
      eyebrow="Services workspace"
      title="Services"
      description="Manage what SKIMA offers, how those services are fulfilled and whether they are currently available without combining every service control on one page."
      onNavigate={props.onNavigate}
      actions={[
        {
          key: "utility-billing",
          title: "Utility billing",
          description: "Run airtime, data and electricity providers through focused catalogue, routing, economics, campaign and payment workspaces.",
          href: "/services/utility-billing",
          icon: Zap,
          meta: "Bills & payments",
          permissionKey: "billing",
        },
        {
          key: "catalog",
          title: "Service catalog",
          description: "Manage service categories, items, variants, prices and customer-facing media.",
          href: "/services/catalog",
          icon: Boxes,
          meta: "What SKIMA offers",
          permissionKey: "catalog",
        },
        {
          key: "availability",
          title: "Service availability",
          description: "Control availability, capacity and orderability separately from service definitions and prices.",
          href: "/services/availability",
          icon: ShieldCheck,
          meta: "Can customers order?",
          permissionKey: "catalog",
        },
      ]}
    />
  );
}
