import { FileText, Image, Megaphone } from "lucide-react";

import { AdminContentWorkspace } from "../../admin-content-workspace";
import { AdminPolicyWorkspace } from "../../admin-policy-workspace";
import { AdminStartupBrandingWorkspace } from "../../admin-startup-branding-workspace";
import { WorkspaceLanding } from "../../shared/patterns/WorkspaceLanding";

export function ExperienceWorkspaceRouter(props: {
  readonly route: string;
  readonly onNavigate: (href: string) => void;
}) {
  if (props.route === "/experience") return <ExperienceOverviewScreen onNavigate={props.onNavigate} />;
  if (props.route === "/experience/content") return <AdminContentWorkspace />;
  if (props.route === "/experience/policies") return <AdminPolicyWorkspace />;
  if (props.route === "/experience/branding") return <AdminStartupBrandingWorkspace />;
  return <ExperienceOverviewScreen onNavigate={props.onNavigate} />;
}

function ExperienceOverviewScreen(props: { readonly onNavigate: (href: string) => void }) {
  return (
    <WorkspaceLanding
      eyebrow="Experience workspace"
      title="Experience"
      description="Manage what customers and partners see without mixing campaign content, legal policies and application branding into one long administration page."
      onNavigate={props.onNavigate}
      actions={[
        {
          key: "content",
          title: "Brand & content",
          description: "Manage customer-facing placements, banners, campaigns, media and other published SKIMA content.",
          href: "/experience/content",
          icon: Megaphone,
          meta: "Customer-facing content",
          permissionKey: "content",
        },
        {
          key: "policies",
          title: "Terms & policies",
          description: "Review policy documents, create controlled drafts, publish approved versions and manage re-acceptance requirements.",
          href: "/experience/policies",
          icon: FileText,
          meta: "Policy governance",
          permissionKey: "policies",
        },
        {
          key: "branding",
          title: "App branding",
          description: "Manage the SKIMA startup screen, logo presentation and branded launch experience without rebuilding the app.",
          href: "/experience/branding",
          icon: Image,
          meta: "Startup experience",
          permissionKey: "branding",
        },
      ]}
    />
  );
}
