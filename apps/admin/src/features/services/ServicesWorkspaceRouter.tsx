import { Boxes, ShieldCheck, Zap } from "lucide-react";

import { WorkspaceLanding } from "../../shared/patterns/WorkspaceLanding";
import { ServiceAvailabilityWorkspaceV2 } from "./ServiceAvailabilityWorkspaceV2";
import { ServiceCatalogWorkspaceV2 } from "./ServiceCatalogWorkspaceV2";
import { UtilityBillingWorkspaceV2 } from "./UtilityBillingWorkspaceV2";

export function ServicesWorkspaceRouter(props: {
  readonly route: string;
  readonly onNavigate: (href: string) => void;
}) {
  if (props.route === "/services") return <ServicesOverviewScreen onNavigate={props.onNavigate} />;
  if (props.route === "/services/utility-billing" || props.route.startsWith("/services/utility-billing/")) {
    return <UtilityBillingWorkspaceV2 route={props.route} onNavigate={props.onNavigate} />;
  }
  if (props.route === "/services/catalog" || props.route.startsWith("/services/catalog/")) {
    return <ServiceCatalogWorkspaceV2 route={props.route} onNavigate={props.onNavigate} />;
  }
  if (props.route === "/services/availability" || props.route.startsWith("/services/availability/")) {
    return <ServiceAvailabilityWorkspaceV2 route={props.route} onNavigate={props.onNavigate} />;
  }
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
          description: "Manage categories, customer-facing services, variants and prices through focused screens instead of raw resource forms.",
          href: "/services/catalog",
          icon: Boxes,
          meta: "What SKIMA offers",
          permissionKey: "catalog",
        },
        {
          key: "availability",
          title: "Service availability",
          description: "Control customer availability, stock/capacity and orderability separately from service definitions and prices.",
          href: "/services/availability",
          icon: ShieldCheck,
          meta: "Can customers order?",
          permissionKey: "catalog",
        },
      ]}
    />
  );
}
