import type { ReactNode } from "react";

import { AdminAccessWorkspace } from "./admin-access-workspace";
import { AdminAiWorkspace } from "./admin-ai-workspace";
import { AdminCompanyWorkspace } from "./admin-company-workspace";
import { AdminContentWorkspace } from "./admin-content-workspace";
import { AdminDeliveryPricingWorkspace, AdminDriverPricingWorkspace } from "./admin-delivery-pricing-workspace";
import { AdminDriverParticipationWorkspace } from "./admin-driver-participation-workspace";
import { AdminFleetWorkspace } from "./admin-fleet-workspace";
import { AdminOperationsWorkspace } from "./admin-operations-workspace";
import { AdminOverviewWorkspace } from "./admin-overview-workspace";
import { AdminPartnerLocationReviewWorkspace } from "./admin-partner-location-review-workspace";
import { AdminPolicyWorkspace } from "./admin-policy-workspace";
import { AdminQualityWorkspace } from "./admin-quality-workspace";
import { AdminResourceConsole } from "./admin-resource-console";
import {
  catalogConsoleConfig,
  financeConsoleConfig,
  governanceConsoleConfig,
  integrationConsoleConfig,
} from "./admin-resource-config";
import { AdminRevenueWorkspace } from "./admin-revenue-workspace";
import { AdminServiceCoverageWorkspace } from "./admin-service-coverage-workspace";
import { AdminStartupBrandingWorkspace } from "./admin-startup-branding-workspace";
import { AdminStationInventoryWorkspace } from "./admin-station-inventory-workspace";
import { AdminStationPricingWorkspace } from "./admin-station-pricing-workspace";
import { AdminSupportWorkspace } from "./admin-support-workspace";
import { AdminSystemWorkspace } from "./admin-system-workspace";
import { AdminUtilityBillingWorkspace } from "./admin-utility-billing-workspace";
import { AdminVerificationWorkspace } from "./admin-verification-workspace";

export function AdminWorkspaceRouter(props: {
  readonly route: string;
  readonly onNavigate: (href: string) => void;
  readonly applicationsWorkspace: ReactNode;
  /** Temporary compatibility bridge while the remaining App.tsx workspace is extracted. */
  readonly overviewWorkspace: ReactNode;
}) {
  if (props.route === "/station-inventory") return <AdminStationInventoryWorkspace />;
  if (props.route === "/stations" || props.route.startsWith("/stations/")) {
    return <AdminStationPricingWorkspace route={props.route} onNavigate={props.onNavigate} />;
  }
  if (props.route === "/company") return <AdminCompanyWorkspace />;
  if (props.route === "/access") return <AdminAccessWorkspace />;
  if (props.route === "/content") return <AdminContentWorkspace />;
  if (props.route === "/branding") return <AdminStartupBrandingWorkspace />;
  if (props.route === "/governance") return <AdminResourceConsole config={governanceConsoleConfig} />;
  if (props.route === "/applications") return props.applicationsWorkspace;
  if (props.route === "/verification") {
    return <AdminVerificationWorkspace onOpenApplications={() => props.onNavigate("/applications")} />;
  }
  if (props.route === "/fleet") return <AdminFleetWorkspace />;
  if (props.route === "/operations") return <AdminOperationsWorkspace />;
  if (props.route === "/coverage") return <AdminServiceCoverageWorkspace />;
  if (props.route === "/location-review") return <AdminPartnerLocationReviewWorkspace />;
  if (props.route === "/drivers") return <AdminDriverParticipationWorkspace />;
  if (props.route === "/quality") return <AdminQualityWorkspace />;
  if (props.route === "/revenue") {
    return <AdminRevenueWorkspace onOpenFinance={() => props.onNavigate("/finance")} />;
  }
  if (props.route === "/delivery-pricing") return <AdminDeliveryPricingWorkspace />;
  if (props.route === "/driver-pricing") return <AdminDriverPricingWorkspace />;
  if (props.route === "/policies") return <AdminPolicyWorkspace />;
  if (props.route === "/support") return <AdminSupportWorkspace />;
  if (props.route === "/utility-billing") return <AdminUtilityBillingWorkspace />;
  if (props.route === "/finance") return <AdminResourceConsole config={financeConsoleConfig} />;
  if (props.route === "/ai") return <AdminAiWorkspace />;
  if (props.route === "/catalog") return <AdminResourceConsole config={catalogConsoleConfig} />;
  if (props.route === "/providers") return <AdminResourceConsole config={integrationConsoleConfig} />;
  if (props.route === "/system") return <AdminSystemWorkspace />;
  return <AdminOverviewWorkspace onNavigate={props.onNavigate} />;
}
