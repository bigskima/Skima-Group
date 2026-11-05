import { AdminWorkspaceRouter } from "../admin-workspace-router";
import { ExperienceWorkspaceRouter } from "../features/experience/ExperienceWorkspaceRouter";
import { IntelligenceWorkspaceRouter } from "../features/intelligence/IntelligenceWorkspaceRouter";
import { MoneyWorkspaceRouter } from "../features/money/MoneyWorkspaceRouter";
import { OperationsWorkspaceRouter } from "../features/operations/OperationsWorkspaceRouter";
import { PartnersWorkspaceRouter } from "../features/partners/PartnersWorkspaceRouter";
import { PlatformWorkspaceRouter } from "../features/platform/PlatformWorkspaceRouter";
import { ServicesWorkspaceRouter } from "../features/services/ServicesWorkspaceRouter";
import { StoreWorkspace } from "../features/store/StoreWorkspace";
import { LogisticsWorkspace } from "../features/logistics/LogisticsWorkspace";
import { RefillWorkspaceRouter } from "../features/refill/RefillWorkspaceRouter";
import { UtilityBillingWorkspaceV2 } from "../features/services/UtilityBillingWorkspaceV2";
import { toLegacyAdminWorkspacePath } from "./admin-v2-navigation";

export function AdminV2WorkspaceRouter(props: {
  readonly route: string;
  readonly onNavigate: (href: string) => void;
}) {
  if (props.route === "/money" || props.route.startsWith("/money/")) {
    return <MoneyWorkspaceRouter route={props.route} onNavigate={props.onNavigate} />;
  }

  if (props.route === "/partners" || props.route.startsWith("/partners/")) {
    return <PartnersWorkspaceRouter route={props.route} onNavigate={props.onNavigate} />;
  }

  if (props.route === "/operations" || props.route.startsWith("/operations/")) {
    return <OperationsWorkspaceRouter route={props.route} onNavigate={props.onNavigate} />;
  }

  if (props.route === "/refill" || props.route.startsWith("/refill/")) {
    return <RefillWorkspaceRouter route={props.route} onNavigate={props.onNavigate} />;
  }

  if (props.route === "/bills" || props.route.startsWith("/bills/")) {
    return <UtilityBillingWorkspaceV2 route={props.route} basePath="/bills" onNavigate={props.onNavigate} />;
  }

  if (props.route === "/services" || props.route.startsWith("/services/")) {
    return <ServicesWorkspaceRouter route={props.route} onNavigate={props.onNavigate} />;
  }

  if (props.route === "/store" || props.route.startsWith("/store/")) {
    return <StoreWorkspace onNavigate={props.onNavigate} />;
  }

  if (props.route === "/logistics" || props.route.startsWith("/logistics/")) {
    return <LogisticsWorkspace route={props.route} onNavigate={props.onNavigate} />;
  }

  if (props.route === "/intelligence" || props.route.startsWith("/intelligence/")) {
    return <IntelligenceWorkspaceRouter route={props.route} onNavigate={props.onNavigate} />;
  }

  if (props.route === "/experience" || props.route.startsWith("/experience/")) {
    return <ExperienceWorkspaceRouter route={props.route} onNavigate={props.onNavigate} />;
  }

  if (props.route === "/platform" || props.route.startsWith("/platform/")) {
    return <PlatformWorkspaceRouter route={props.route} onNavigate={props.onNavigate} />;
  }

  return (
    <AdminWorkspaceRouter
      route={toLegacyAdminWorkspacePath(props.route)}
      onNavigate={props.onNavigate}
    />
  );
}
