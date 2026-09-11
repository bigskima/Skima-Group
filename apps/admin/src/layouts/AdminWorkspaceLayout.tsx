import { ChevronRight, Circle } from "lucide-react";
import type { ReactNode } from "react";
import type { NavItem } from "@skima/ui";

import "./admin-workspace-layout.css";

interface AdminWorkspaceLayoutProps {
  readonly title: string;
  readonly description: string;
  readonly items: readonly NavItem[];
  readonly activeHref: string;
  readonly onNavigate: (href: string) => void;
  readonly children: ReactNode;
}

export function AdminWorkspaceLayout(props: AdminWorkspaceLayoutProps) {
  if (props.items.length <= 1) {
    return <>{props.children}</>;
  }

  return (
    <div className="admin-workspace-layout">
      <aside className="admin-workspace-layout__rail" aria-label={`${props.title} workspace navigation`}>
        <div className="admin-workspace-layout__heading">
          <small>Workspace</small>
          <strong>{props.title}</strong>
          <p>{props.description}</p>
        </div>

        <nav className="admin-workspace-layout__nav">
          {props.items.map((item) => {
            const Icon = item.icon ?? Circle;
            const active = isRouteActive(props.activeHref, item.href);

            return (
              <button
                key={item.key}
                type="button"
                className={active ? "is-active" : undefined}
                aria-current={active ? "page" : undefined}
                onClick={() => props.onNavigate(item.href)}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
                <ChevronRight aria-hidden="true" />
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="admin-workspace-layout__body">
        <nav className="admin-workspace-layout__mobile-nav" aria-label={`${props.title} workspace sections`}>
          {props.items.map((item) => {
            const active = isRouteActive(props.activeHref, item.href);
            return (
              <button
                key={item.key}
                type="button"
                className={active ? "is-active" : undefined}
                aria-current={active ? "page" : undefined}
                onClick={() => props.onNavigate(item.href)}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
        {props.children}
      </div>
    </div>
  );
}

function isRouteActive(current: string, target: string): boolean {
  return current === target || current.startsWith(`${target}/`);
}
