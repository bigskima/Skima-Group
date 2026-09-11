import { Blocks, Settings2, Webhook } from "lucide-react";

import { AdminResourceConsole } from "../../admin-resource-console";
import { governanceConsoleConfig } from "../../admin-resource-config";
import { WorkspaceLanding } from "../../shared/patterns/WorkspaceLanding";
import { PlatformBusinessLinesScreen } from "./PlatformBusinessLinesScreen";
import { PlatformWebhookScreen } from "./PlatformWebhookScreen";
import "./platform-v2.css";

const CONFIG_BASE = "/platform/configuration";

export function PlatformConfigurationWorkspaceV2(props: {
  readonly route: string;
  readonly onNavigate: (href: string) => void;
}) {
  if (props.route === CONFIG_BASE) return <ConfigurationOverview onNavigate={props.onNavigate} />;
  if (props.route === `${CONFIG_BASE}/business-lines`) return <PlatformBusinessLinesScreen />;
  if (props.route === `${CONFIG_BASE}/webhooks`) return <PlatformWebhookScreen onNavigate={props.onNavigate} />;
  if (props.route === `${CONFIG_BASE}/advanced`) return <AdminResourceConsole config={governanceConsoleConfig} />;

  return (
    <WorkspaceLanding
      eyebrow="Platform configuration"
      title="Configuration page not found"
      description="This configuration route is not part of the current Admin V2 workspace."
      onNavigate={props.onNavigate}
      actions={[{
        key: "configuration-home",
        title: "Back to configuration",
        description: "Return to the supported platform configuration tasks.",
        href: CONFIG_BASE,
        icon: Settings2,
        meta: "Platform setup",
        permissionKey: "governance",
      }]}
    />
  );
}

function ConfigurationOverview(props: { readonly onNavigate: (href: string) => void }) {
  return (
    <WorkspaceLanding
      eyebrow="Platform configuration"
      title="Configuration"
      description="Manage SKIMA's reusable business-line setup and outbound webhook destinations without exposing the full technical configuration console during normal work."
      onNavigate={props.onNavigate}
      actions={[
        {
          key: "business-lines",
          title: "Business lines",
          description: "Create and release reusable SKIMA modules and review their active versions.",
          href: `${CONFIG_BASE}/business-lines`,
          icon: Blocks,
          meta: "Modules & releases",
          requiredPermissions: ["platform.configuration.manage"],
        },
        {
          key: "webhooks",
          title: "External notifications",
          description: "Review webhook destinations and recent delivery health while sensitive delivery setup stays protected.",
          href: `${CONFIG_BASE}/webhooks`,
          icon: Webhook,
          meta: "Outbound webhooks",
          requiredPermissions: ["platform.providers.manage"],
        },
        {
          key: "advanced",
          title: "Advanced configuration",
          description: "Open low-level module components, manifests, event delivery controls and legacy technical records only when required.",
          href: `${CONFIG_BASE}/advanced`,
          icon: Settings2,
          meta: "Specialist tools",
          requiredPermissions: ["platform.configuration.manage"],
        },
      ]}
    />
  );
}
