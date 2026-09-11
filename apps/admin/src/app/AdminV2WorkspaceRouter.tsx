import { AdminWorkspaceRouter } from "../admin-workspace-router";
import { IntelligenceWorkspaceRouter } from "../features/intelligence/IntelligenceWorkspaceRouter";
import { MoneyWorkspaceRouter } from "../features/money/MoneyWorkspaceRouter";
import { OperationsWorkspaceRouter } from "../features/operations/OperationsWorkspaceRouter";
import { PartnersWorkspaceRouter } from "../features/partners/PartnersWorkspaceRouter";
import { ServicesWorkspaceRouter } from "../features/services/ServicesWorkspaceRouter";
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

  if (props.route === "/services" || props.route.startsWith("/services/")) {
    return <ServicesWorkspaceRouter route={props.route} onNavigate={props.onNavigate} />;
  }

  if (props.route === "/intelligence" || props.route.startsWith("/intelligence/")) {
    return <IntelligenceWorkspaceRouter route={props.route} onNavigate={props.onNavigate} />;
  }

  return (
    <AdminWorkspaceRouter
      route={toLegacyAdminWorkspacePath(props.route)}
      onNavigate={props.onNavigate}
    />
  );
}
