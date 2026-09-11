import { PlugZap, ServerCog, Settings2, UsersRound } from "lucide-react";

import { AdminAccessWorkspace } from "../../admin-access-workspace";
import { AdminResourceConsole } from "../../admin-resource-console";
import {
  governanceConsoleConfig,
  integrationConsoleConfig,
} from "../../admin-resource-config";
import { AdminSystemWorkspace } from "../../admin-system-workspace";
import { WorkspaceLanding } from "../../shared/patterns/WorkspaceLanding";

export function PlatformWorkspaceRouter(props: {
  readonly route: string;
  readonly onNavigate: (href: string) => void;
}) {
  if (props.route === "/platform") {
    return <PlatformOverviewScreen onNavigate={props.onNavigate} />;
  }

  if (props.route === "/platform/people-access") return <AdminAccessWorkspace />;
  if (props.route === "/platform/configuration") return <AdminResourceConsole config={governanceConsoleConfig} />;
  if (props.route === "/platform/integrations") return <AdminResourceConsole config={integrationConsoleConfig} />;
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
          requiredPermissions: ["platform.admins.read"],
        },
        {
          key: "configuration",
          title: "Configuration",
          description: "Manage shared SKIMA setup and governed platform behavior without mixing it with day-to-day operations.",
          href: "/platform/configuration",
          icon: Settings2,
          meta: "Platform setup",
          requiredPermissions: ["platform.configuration.read"],
        },
        {
          key: "integrations",
          title: "Integrations",
          description: "Review swappable provider connections for maps, payments, utilities, notifications, AI and related services.",
          href: "/platform/integrations",
          icon: PlugZap,
          meta: "External connections",
          requiredPermissions: ["platform.providers.manage"],
        },
        {
          key: "system",
          title: "System health",
          description: "Inspect operational health, runtime status and platform diagnostics without exposing them across business workspaces.",
          href: "/platform/system",
          icon: ServerCog,
          meta: "Health & diagnostics",
          requiredPermissions: ["platform.health.read"],
        },
      ]}
    />
  );
}
