import {
  Building2,
  ClipboardCheck,
  MapPinned,
  ShieldCheck,
  Store,
  Truck,
  UserRoundCheck,
} from "lucide-react";

import { AdminWorkspaceRouter } from "../../admin-workspace-router";
import { toLegacyAdminWorkspacePath } from "../../app/admin-v2-navigation";
import { WorkspaceLanding } from "../../shared/patterns/WorkspaceLanding";

export function PartnersWorkspaceRouter(props: {
  readonly route: string;
  readonly onNavigate: (href: string) => void;
}) {
  if (props.route === "/partners") {
    return <PartnersOverviewScreen onNavigate={props.onNavigate} />;
  }

  return (
    <AdminWorkspaceRouter
      route={toLegacyAdminWorkspacePath(props.route)}
      onNavigate={props.onNavigate}
    />
  );
}

function PartnersOverviewScreen(props: { readonly onNavigate: (href: string) => void }) {
  return (
    <WorkspaceLanding
      eyebrow="People & Partners"
      title="People & Partners"
      description="Manage the people and organisations that operate on SKIMA. Choose the job you need instead of moving between unrelated platform screens."
      onNavigate={props.onNavigate}
      actions={[
        {
          key: "applications",
          title: "Applications",
          description: "Review driver and station applications, submitted documents and approval decisions.",
          href: "/partners/applications",
          icon: ClipboardCheck,
          meta: "Approvals",
        },
        {
          key: "verification",
          title: "Verification",
          description: "Review identity and business verification policy, exceptions and service status.",
          href: "/partners/verification",
          icon: ShieldCheck,
          meta: "Identity & business checks",
        },
        {
          key: "companies",
          title: "Companies",
          description: "Review registered partner organisations and their platform relationship.",
          href: "/partners/companies",
          icon: Building2,
          meta: "Organisations",
        },
        {
          key: "drivers",
          title: "Drivers",
          description: "Manage driver participation, eligibility and operational availability.",
          href: "/partners/drivers",
          icon: UserRoundCheck,
          meta: "Delivery partners",
        },
        {
          key: "stations",
          title: "Stations",
          description: "Open station profiles and station-owned commercial settings without mixing them with stock operations.",
          href: "/partners/stations",
          icon: Store,
          meta: "LPG partners",
        },
        {
          key: "location-review",
          title: "Location review",
          description: "Review applicant and partner locations that need an administrator decision.",
          href: "/partners/location-review",
          icon: MapPinned,
          meta: "Location checks",
        },
        {
          key: "fleet",
          title: "Fleet & vehicles",
          description: "Review vehicles and the fleet records linked to delivery operations.",
          href: "/partners/fleet",
          icon: Truck,
          meta: "Vehicles",
        },
      ]}
    />
  );
}
