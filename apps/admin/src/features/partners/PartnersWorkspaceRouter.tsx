import {
  Building2,
  ClipboardCheck,
  MapPinned,
  ShieldCheck,
  Store,
  Truck,
  UserRoundCheck,
} from "lucide-react";

import { AdminApplicationsWorkspace } from "../../admin-applications-workspace";
import { AdminCompanyWorkspace } from "../../admin-company-workspace";
import { AdminDriverParticipationWorkspace } from "../../admin-driver-participation-workspace";
import { AdminFleetWorkspace } from "../../admin-fleet-workspace";
import { AdminPartnerLocationReviewWorkspace } from "../../admin-partner-location-review-workspace";
import { AdminStationPricingWorkspace } from "../../admin-station-pricing-workspace";
import { AdminVerificationWorkspace } from "../../admin-verification-workspace";
import { toLegacyAdminWorkspacePath } from "../../app/admin-v2-navigation";
import { WorkspaceLanding } from "../../shared/patterns/WorkspaceLanding";
import {
  APPLICATIONS_BASE_PATH,
  buildApplicationRecordPath,
  parseApplicationRecordRoute,
} from "./application-record-route";

export function PartnersWorkspaceRouter(props: {
  readonly route: string;
  readonly onNavigate: (href: string) => void;
}) {
  if (props.route === "/partners") return <PartnersOverviewScreen onNavigate={props.onNavigate} />;

  if (props.route === APPLICATIONS_BASE_PATH || props.route.startsWith(`${APPLICATIONS_BASE_PATH}/`)) {
    const applicationRoute = parseApplicationRecordRoute(props.route);

    if (applicationRoute.kind === "invalid") {
      return (
        <WorkspaceLanding
          eyebrow="Applications"
          title="Application link unavailable"
          description="This application link is not valid. Return to the review queue and choose the application again."
          onNavigate={props.onNavigate}
          actions={[
            {
              key: "applications",
              title: "Open review queue",
              description: "Return to all driver and station applications that your role can review.",
              href: APPLICATIONS_BASE_PATH,
              icon: ClipboardCheck,
              meta: "Applications",
              permissionKey: "applications",
            },
          ]}
        />
      );
    }

    return (
      <AdminApplicationsWorkspace
        applicationId={applicationRoute.kind === "record" ? applicationRoute.applicationId : null}
        onOpenApplication={(applicationId) => props.onNavigate(buildApplicationRecordPath(applicationId))}
        onOpenQueue={() => props.onNavigate(APPLICATIONS_BASE_PATH)}
      />
    );
  }

  if (props.route === "/partners/companies") return <AdminCompanyWorkspace />;
  if (props.route === "/partners/drivers") return <AdminDriverParticipationWorkspace />;
  if (props.route === "/partners/verification") {
    return <AdminVerificationWorkspace onOpenApplications={() => props.onNavigate(APPLICATIONS_BASE_PATH)} />;
  }
  if (props.route === "/partners/location-review") return <AdminPartnerLocationReviewWorkspace />;
  if (props.route === "/partners/fleet") return <AdminFleetWorkspace />;
  if (props.route === "/partners/stations" || props.route.startsWith("/partners/stations/")) {
    return (
      <AdminStationPricingWorkspace
        route={toLegacyAdminWorkspacePath(props.route)}
        onNavigate={props.onNavigate}
      />
    );
  }

  return (
    <WorkspaceLanding
      eyebrow="People & Partners"
      title="Partner page not found"
      description="This People & Partners link is not part of the current Admin V2 workspace."
      onNavigate={props.onNavigate}
      actions={[{
        key: "partners-home",
        title: "Back to People & Partners",
        description: "Return to applications, companies, drivers, stations and verification.",
        href: "/partners",
        icon: UserRoundCheck,
        meta: "People & Partners",
      }]}
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
          href: APPLICATIONS_BASE_PATH,
          icon: ClipboardCheck,
          meta: "Approvals",
          permissionKey: "applications",
        },
        {
          key: "verification",
          title: "Verification",
          description: "Review identity and business verification policy, exceptions and service status.",
          href: "/partners/verification",
          icon: ShieldCheck,
          meta: "Identity & business checks",
          permissionKey: "verification",
        },
        {
          key: "companies",
          title: "Companies",
          description: "Review registered partner organisations and their platform relationship.",
          href: "/partners/companies",
          icon: Building2,
          meta: "Organisations",
          permissionKey: "company",
        },
        {
          key: "drivers",
          title: "Drivers",
          description: "Manage driver participation, eligibility and operational availability.",
          href: "/partners/drivers",
          icon: UserRoundCheck,
          meta: "Delivery partners",
          permissionKey: "drivers",
        },
        {
          key: "stations",
          title: "Stations",
          description: "Open station profiles and station-owned commercial settings without mixing them with stock operations.",
          href: "/partners/stations",
          icon: Store,
          meta: "LPG partners",
          permissionKey: "stations",
        },
        {
          key: "location-review",
          title: "Location review",
          description: "Review applicant and partner locations that need an administrator decision.",
          href: "/partners/location-review",
          icon: MapPinned,
          meta: "Location checks",
          permissionKey: "location-review",
        },
        {
          key: "fleet",
          title: "Fleet & vehicles",
          description: "Review vehicles and the fleet records linked to delivery operations.",
          href: "/partners/fleet",
          icon: Truck,
          meta: "Vehicles",
          permissionKey: "fleet",
        },
      ]}
    />
  );
}
