import { PlugZap, ServerCog, Settings2, UsersRound } from "lucide-react";

import { AdminAccessWorkspace } from "../../admin-access-workspace";
import { AdminSystemWorkspace } from "../../admin-system-workspace";
import { WorkspaceLanding } from "../../shared/patterns/WorkspaceLanding";
import { PlatformConfigurationWorkspaceV2 } from "./PlatformConfigurationWorkspaceV2";
import { PlatformIntegrationsWorkspaceV2 } from "./PlatformIntegrationsWorkspaceV2";

export function PlatformWorkspaceRouter(props: {
  readonly route: string;
  readonly onNavigate: (href: string) => void;
}) {
  if (props.route === "/platform") return <PlatformOverviewScreen onNavigate={props.onNavigate} />;
  if (props.route === "/platform/people-access") return <AdminAccessWorkspace />;
  if (props.route === "/platform/configuration" || props.route.startsWith("/platform/configuration/")) {
    return <PlatformConfigurationWorkspaceV2 route={props.route} onNavigate={props.onNavigate} />;
  }
  if (props.route === "/platform/integrations" || props.route.startsWith("/platform/integrations/")) {
    return <PlatformIntegrationsWorkspaceV2 route={props.route} onNavigate={props.onNavigate} />;
  }
  if (props.route === "/platform/system") return <AdminSystemWorkspace />;
  return <PlatformOverviewScreen onNavigate={props.onNavigate} />;
}

function PlatformOverviewScreen(props: { readonly onNavigate: (href: string) => void }) {
  return (
    <WorkspaceLanding
      eyebrow="Platform workspace"
      title="Platform"
      description="Manage administrator access, shared platform configuration, external connections and system health from focused operational areas instead of one technical control surface."
      onNavigate={props.onNavigate}
      actions={[
        {
          key: "people-access",
          title: "People & access",
          description: "Manage the admin team, role templates and allowed actions using the existing permission model.",
          href: "/platform/people-access",
          icon: UsersRound,
          meta: "Admin authority",
          permissionKey: "access",
        },
        {
          key: "configuration",
          title: "Configuration",
          description: "Manage business lines and external event destinations through focused V2 configuration tasks.",
          href: "/platform/configuration",
          icon: Settings2,
          meta: "Platform setup",
          permissionKey: "governance",
        },
        {
          key: "integrations",
          title: "Integrations",
          description: "Review maps, provider adapters and communication delivery from separate operational workspaces.",
          href: "/platform/integrations",
          icon: PlugZap,
          meta: "External connections",
          permissionKey: "providers",
        },
        {
          key: "system",
          title: "System health",
          description: "Inspect operational health, runtime status and platform diagnostics without exposing them across business workspaces.",
          href: "/platform/system",
          icon: ServerCog,
          meta: "Health & diagnostics",
          permissionKey: "system",
        },
      ]}
    />
  );
}
