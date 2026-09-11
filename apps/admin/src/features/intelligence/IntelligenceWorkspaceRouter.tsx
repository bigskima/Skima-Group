import { Bot, Sparkles } from "lucide-react";

import { AdminAiWorkspace } from "../../admin-ai-workspace";
import { WorkspaceLanding } from "../../shared/patterns/WorkspaceLanding";

export function IntelligenceWorkspaceRouter(props: {
  readonly route: string;
  readonly onNavigate: (href: string) => void;
}) {
  if (props.route === "/intelligence") {
    return <IntelligenceOverviewScreen onNavigate={props.onNavigate} />;
  }

  if (props.route === "/intelligence/ask") {
    return <AdminAiWorkspace />;
  }

  return <IntelligenceOverviewScreen onNavigate={props.onNavigate} />;
}

function IntelligenceOverviewScreen(props: { readonly onNavigate: (href: string) => void }) {
  return (
    <WorkspaceLanding
      eyebrow="SKIMA Intelligence"
      title="SKIMA Intelligence"
      description="Use SKIMA's decision-support workspace without mixing AI controls into operational screens. The intelligence workspace already separates Ask SKIMA, attention signals, decision insights and AI settings into focused internal sections."
      onNavigate={props.onNavigate}
      actions={[
        {
          key: "intelligence-workspace",
          title: "Open SKIMA Intelligence",
          description: "Ask SKIMA, review what needs attention, inspect demand and pricing insights, and manage AI routing from the existing governed intelligence workspace.",
          href: "/intelligence/ask",
          icon: Sparkles,
          meta: "Decision support",
          requiredPermissions: ["platform.ai.read"],
        },
        {
          key: "ask-skima",
          title: "Ask SKIMA",
          description: "Start with the read-only platform copilot for operational briefs and evidence-backed next-review guidance.",
          href: "/intelligence/ask",
          icon: Bot,
          meta: "Read only",
          requiredPermissions: ["platform.ai.read"],
        },
      ]}
    />
  );
}
