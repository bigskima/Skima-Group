import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { usePermissionCheck } from "@skima/ui";

import "./workspace-landing.css";

export interface WorkspaceLandingAction {
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly meta?: string;
  readonly requiredPermissions?: readonly string[];
  readonly anyOfPermissions?: readonly string[];
}

export function canAccessWorkspaceLandingAction(
  action: WorkspaceLandingAction,
  can: (permission: string) => boolean,
): boolean {
  const hasAllRequired = (action.requiredPermissions ?? []).every((permission) => can(permission));
  const anyOf = action.anyOfPermissions ?? [];
  const hasAnyRequired = anyOf.length === 0 || anyOf.some((permission) => can(permission));
  return hasAllRequired && hasAnyRequired;
}

export function WorkspaceLanding(props: {
  readonly eyebrow?: string;
  readonly title: string;
  readonly description: string;
  readonly actions: readonly WorkspaceLandingAction[];
  readonly onNavigate: (href: string) => void;
  readonly aside?: ReactNode;
}) {
  const can = usePermissionCheck();
  const visibleActions = props.actions.filter((action) => canAccessWorkspaceLandingAction(action, can));

  return (
    <section className="workspace-landing">
      <header className="workspace-landing__header">
        <div>
          {props.eyebrow ? <small>{props.eyebrow}</small> : null}
          <h1>{props.title}</h1>
          <p>{props.description}</p>
        </div>
        {props.aside ? <div className="workspace-landing__aside">{props.aside}</div> : null}
      </header>

      <div className="workspace-landing__grid">
        {visibleActions.length > 0 ? visibleActions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.key}
              type="button"
              className="workspace-landing__card"
              onClick={() => props.onNavigate(action.href)}
            >
              <span className="workspace-landing__icon"><Icon aria-hidden="true" /></span>
              <span className="workspace-landing__copy">
                {action.meta ? <small>{action.meta}</small> : null}
                <strong>{action.title}</strong>
                <span>{action.description}</span>
              </span>
              <ArrowRight className="workspace-landing__arrow" aria-hidden="true" />
            </button>
          );
        }) : (
          <div className="sk-panel" role="status">
            <strong>No tasks are available for your current access.</strong>
            <p className="skima-muted">Ask a Super Admin to review your role if you need access to this workspace.</p>
          </div>
        )}
      </div>
    </section>
  );
}
