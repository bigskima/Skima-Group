import { MapPinned, MessageSquareMore, PlugZap, Settings2 } from "lucide-react";

import { AdminResourceConsole } from "../../admin-resource-console";
import { integrationConsoleConfig } from "../../admin-resource-config";
import { WorkspaceLanding } from "../../shared/patterns/WorkspaceLanding";
import { PlatformCommunicationIntegrationsScreen } from "./PlatformCommunicationIntegrationsScreen";
import { PlatformLocationIntegrationScreen } from "./PlatformLocationIntegrationScreen";
import { PlatformProviderConnectionsScreen } from "./PlatformProviderConnectionsScreen";
import "./platform-v2.css";

const INTEGRATIONS_BASE = "/platform/integrations";

export function PlatformIntegrationsWorkspaceV2(props: {
  readonly route: string;
  readonly onNavigate: (href: string) => void;
}) {
  if (props.route === INTEGRATIONS_BASE) return <IntegrationsOverview onNavigate={props.onNavigate} />;
  if (props.route === `${INTEGRATIONS_BASE}/location`) return <PlatformLocationIntegrationScreen />;
  if (props.route === `${INTEGRATIONS_BASE}/providers`) return <PlatformProviderConnectionsScreen />;
  if (props.route === `${INTEGRATIONS_BASE}/communications`) return <PlatformCommunicationIntegrationsScreen onNavigate={props.onNavigate} />;
  if (props.route === `${INTEGRATIONS_BASE}/advanced`) return <AdminResourceConsole config={integrationConsoleConfig} />;

  return (
    <WorkspaceLanding
      eyebrow="Platform integrations"
      title="Integration page not found"
      description="This integration route is not part of the current Admin V2 workspace."
      onNavigate={props.onNavigate}
      actions={[{
        key: "integrations-home",
        title: "Back to integrations",
        description: "Return to the supported provider and communication workspaces.",
        href: INTEGRATIONS_BASE,
        icon: PlugZap,
        meta: "External connections",
        permissionKey: "providers",
      }]}
    />
  );
}

function IntegrationsOverview(props: { readonly onNavigate: (href: string) => void }) {
  return (
    <WorkspaceLanding
      eyebrow="Platform integrations"
      title="Integrations"
      description="See provider health by job—location, external service adapters and communications—without mixing every engine definition into one technical console."
      onNavigate={props.onNavigate}
      actions={[
        {
          key: "location",
          title: "Maps & location",
          description: "Review the active geocoder/router, provider health, cache posture and audited provider changes.",
          href: `${INTEGRATIONS_BASE}/location`,
          icon: MapPinned,
          meta: "Geocoding & routing",
          requiredPermissions: ["platform.providers.manage"],
        },
        {
          key: "providers",
          title: "Provider connections",
          description: "Inspect swappable payment, utility, notification, AI, map, queue and cache adapters by operational status.",
          href: `${INTEGRATIONS_BASE}/providers`,
          icon: PlugZap,
          meta: "Adapter health",
          requiredPermissions: ["platform.providers.manage"],
        },
        {
          key: "communications",
          title: "Communications",
          description: "Review outbound communication health and synchronize pending delivery outcomes.",
          href: `${INTEGRATIONS_BASE}/communications`,
          icon: MessageSquareMore,
          meta: "Delivery operations",
          anyOfPermissions: ["platform.events.manage", "platform.providers.manage"],
        },
        {
          key: "advanced",
          title: "Advanced integrations",
          description: "Open engine definitions, notification templates, dispatch/settlement policies and specialist integration controls.",
          href: `${INTEGRATIONS_BASE}/advanced`,
          icon: Settings2,
          meta: "Specialist tools",
          requiredPermissions: ["platform.providers.manage"],
        },
      ]}
    />
  );
}
