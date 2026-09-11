import {
  Boxes,
  ClipboardList,
  LifeBuoy,
  MapPinned,
  ShieldCheck,
} from "lucide-react";

import { AdminOperationsWorkspace } from "../../admin-operations-workspace";
import { AdminSupportWorkspace } from "../../admin-support-workspace";
import { AdminWorkspaceRouter } from "../../admin-workspace-router";
import { toLegacyAdminWorkspacePath } from "../../app/admin-v2-navigation";
import { WorkspaceLanding } from "../../shared/patterns/WorkspaceLanding";

export function OperationsWorkspaceRouter(props: {
  readonly route: string;
  readonly onNavigate: (href: string) => void;
}) {
  if (props.route === "/operations") {
    return <OperationsOverviewScreen onNavigate={props.onNavigate} />;
  }

  if (props.route === "/operations/orders" || props.route.startsWith("/operations/orders/")) {
    return <AdminOperationsWorkspace route={props.route} onNavigate={props.onNavigate} />;
  }

  if (props.route === "/operations/support" || props.route.startsWith("/operations/support/")) {
    return <AdminSupportWorkspace route={props.route} onNavigate={props.onNavigate} />;
  }

  return (
    <AdminWorkspaceRouter
      route={toLegacyAdminWorkspacePath(props.route)}
      onNavigate={props.onNavigate}
    />
  );
}

function OperationsOverviewScreen(props: { readonly onNavigate: (href: string) => void }) {
  return (
    <WorkspaceLanding
      eyebrow="Operations"
      title="Operations"
      description="Run SKIMA's day-to-day service operation from focused workspaces. Orders, coverage, station stock, quality and support stay connected without being placed on one endless page."
      onNavigate={props.onNavigate}
      actions={[
        {
          key: "orders",
          title: "Orders & dispatch",
          description: "Review LPG orders, dispatch activity and operational exceptions that need intervention.",
          href: "/operations/orders",
          icon: ClipboardList,
          meta: "Live operations",
          permissionKey: "operations",
        },
        {
          key: "coverage",
          title: "Service coverage",
          description: "Manage where SKIMA is available and review the service areas used by matching and onboarding.",
          href: "/operations/coverage",
          icon: MapPinned,
          meta: "Availability",
          permissionKey: "coverage",
        },
        {
          key: "inventory",
          title: "Station stock",
          description: "Review station LPG stock, source capacity and stock controls without mixing them into station profiles.",
          href: "/operations/inventory",
          icon: Boxes,
          meta: "Supply",
          permissionKey: "inventory",
        },
        {
          key: "quality",
          title: "Service quality",
          description: "Review quality signals and operational service issues that require attention.",
          href: "/operations/quality",
          icon: ShieldCheck,
          meta: "Quality",
          permissionKey: "quality",
        },
        {
          key: "support",
          title: "Support",
          description: "Work through customer and partner support cases in their dedicated operations inbox.",
          href: "/operations/support",
          icon: LifeBuoy,
          meta: "Cases",
          permissionKey: "support",
        },
      ]}
    />
  );
}
