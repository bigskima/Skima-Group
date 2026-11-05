import { Boxes, ClipboardList, Fuel, MapPinned, Settings2, ShieldCheck, Store, Truck } from "lucide-react";

import { MoneyWorkspaceRouter } from "../money/MoneyWorkspaceRouter";
import { OperationsWorkspaceRouter } from "../operations/OperationsWorkspaceRouter";
import { PartnersWorkspaceRouter } from "../partners/PartnersWorkspaceRouter";
import { ServicesWorkspaceRouter } from "../services/ServicesWorkspaceRouter";
import { WorkspaceLanding } from "../../shared/patterns/WorkspaceLanding";

export function RefillWorkspaceRouter(props: {
  readonly route: string;
  readonly onNavigate: (href: string) => void;
}) {
  const onNavigate = (href: string) => props.onNavigate(toRefillRoute(href));

  if (props.route === "/refill") {
    return (
      <WorkspaceLanding
        eyebrow="SKIMA Refill workspace"
        title="Refill"
        description="Operate SKIMA's LPG refill and supported energy services from one place. These focused screens reuse the existing station, order, inventory, coverage and fuel controls, with their current permissions and workflows intact."
        onNavigate={props.onNavigate}
        actions={[
          {
            key: "refill-orders",
            title: "Orders & dispatch",
            description: "Review incoming LPG refill orders, dispatch activity and operational exceptions.",
            href: "/refill/orders",
            icon: ClipboardList,
            meta: "Customer fulfilment",
            permissionKey: "operations",
          },
          {
            key: "refill-stations",
            title: "Stations & refill partners",
            description: "Manage station profiles, partner pricing and refill partner operations.",
            href: "/refill/stations",
            icon: Store,
            meta: "Supply partners",
            permissionKey: "stations",
          },
          {
            key: "refill-inventory",
            title: "Station inventory",
            description: "Review LPG stock, installed capacity and station inventory controls.",
            href: "/refill/inventory",
            icon: Boxes,
            meta: "Stock & capacity",
            permissionKey: "inventory",
          },
          {
            key: "refill-coverage",
            title: "Service coverage",
            description: "Manage the locations where SKIMA Refill can accept and fulfil orders.",
            href: "/refill/coverage",
            icon: MapPinned,
            meta: "Geography & availability",
            permissionKey: "coverage",
          },
          {
            key: "refill-fuel",
            title: "Fuel products",
            description: "Configure supported petrol, diesel and kerosene services separately from LPG refill operations.",
            href: "/refill/fuel",
            icon: Fuel,
            meta: "PMS · AGO · DPK",
            permissionKey: "fuel",
          },
          {
            key: "refill-fulfillment",
            title: "SKIMA fulfillment",
            description: "Review order routing, Managed Driver readiness and the existing LPG fulfilment controls.",
            href: "/refill/fulfillment",
            icon: Settings2,
            meta: "Managed fulfilment",
            anyOfPermissions: ["platform.dispatch.manage", "platform.financial_policy.read", "platform.drivers.manage", "platform.financial.manage"],
          },
        ]}
      />
    );
  }

  if (props.route === "/refill/orders" || props.route.startsWith("/refill/orders/")) {
    return <OperationsWorkspaceRouter route={"/operations/orders" + props.route.slice("/refill/orders".length)} onNavigate={onNavigate} />;
  }
  if (props.route === "/refill/stations" || props.route.startsWith("/refill/stations/")) {
    return <PartnersWorkspaceRouter route={"/partners/stations" + props.route.slice("/refill/stations".length)} onNavigate={onNavigate} />;
  }
  if (props.route === "/refill/inventory") {
    return <OperationsWorkspaceRouter route="/operations/inventory" onNavigate={onNavigate} />;
  }
  if (props.route === "/refill/coverage" || props.route.startsWith("/refill/coverage/")) {
    return <OperationsWorkspaceRouter route={"/operations/coverage" + props.route.slice("/refill/coverage".length)} onNavigate={onNavigate} />;
  }
  if (props.route === "/refill/fuel") {
    return <ServicesWorkspaceRouter route="/services/fuel" onNavigate={onNavigate} />;
  }
  if (props.route === "/refill/fulfillment" || props.route.startsWith("/refill/fulfillment/")) {
    return <MoneyWorkspaceRouter route={"/money/pricing/launch-assurance" + props.route.slice("/refill/fulfillment".length)} onNavigate={onNavigate} />;
  }

  return (
    <WorkspaceLanding
      eyebrow="SKIMA Refill"
      title="Refill page not found"
      description="This link is not part of the Refill workspace. Return to the overview and choose an available task."
      onNavigate={props.onNavigate}
      actions={[{
        key: "refill-home",
        title: "Back to Refill",
        description: "Return to LPG orders, stations, inventory, coverage and supported fuel products.",
        href: "/refill",
        icon: Fuel,
        meta: "Refill",
      }]}
    />
  );
}

function toRefillRoute(href: string): string {
  const mappings: readonly [string, string][] = [
    ["/operations/orders", "/refill/orders"],
    ["/operations/inventory", "/refill/inventory"],
    ["/operations/coverage", "/refill/coverage"],
    ["/partners/stations", "/refill/stations"],
    ["/stations", "/refill/stations"],
    ["/services/fuel", "/refill/fuel"],
    ["/money/pricing/launch-assurance", "/refill/fulfillment"],
  ];
  for (const [source, target] of mappings) {
    if (href === source || href.startsWith(source + "/")) return target + href.slice(source.length);
  }
  return href;
}
