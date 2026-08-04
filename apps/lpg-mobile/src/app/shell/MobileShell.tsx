import { LogOut } from "lucide-react";
import type { ReactNode } from "react";

import { workspaceConfigs, type LpgWorkspace } from "../../features/permissions/workspaceAccess";
import { useSession } from "../providers/SessionProvider";
import { useTheme } from "../providers/ThemeProvider";
import { PhoneStatus } from "../../shared/ui/lpgComponents";
import type { WorkspaceTab } from "../../shared/types/navigation";
import { WorkspaceSelector } from "./WorkspaceSelector";

export function MobileShell<TTab extends string>(props: {
  readonly activeTab: TTab;
  readonly children: ReactNode;
  readonly onTabChange: (tab: TTab) => void;
  readonly tabs: readonly WorkspaceTab<TTab>[];
  readonly workspace: LpgWorkspace;
}) {
  const session = useSession();
  const theme = useTheme();
  const config = workspaceConfigs[props.workspace];

  return (
    <main className="lpg-app-shell" data-theme={theme.resolved}>
      <section className="phone-frame app-screen" data-theme={theme.resolved}>
        <PhoneStatus />
        <header className="app-header">
          <div>
            <strong>{config.title}</strong>
            <span>{config.subtitle}</span>
          </div>
          <button type="button" className="icon-button" aria-label="Sign out" onClick={session.signOut}>
            <LogOut aria-hidden="true" />
          </button>
          <WorkspaceSelector />
        </header>
        <section className="screen-scroll">{props.children}</section>
        <nav className="bottom-nav" aria-label={`${config.label} navigation`}>
          {props.tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`${tab.key === props.activeTab ? "is-active" : ""} ${tab.center ? "is-center" : ""}`}
              aria-current={tab.key === props.activeTab ? "page" : undefined}
              onClick={() => props.onTabChange(tab.key)}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </section>
    </main>
  );
}
