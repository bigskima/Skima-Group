import type { LucideIcon } from "lucide-react";

export interface AdminWorkspaceSection {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: LucideIcon;
  readonly badge?: string | number | null;
}

export function AdminWorkspaceSections(props: {
  readonly label: string;
  readonly sections: readonly AdminWorkspaceSection[];
  readonly activeKey: string;
  readonly onChange: (key: string) => void;
  readonly compact?: boolean;
}) {
  return (
    <div
      className={`admin-workspace-sections${props.compact ? " is-compact" : ""}`}
      role="tablist"
      aria-label={props.label}
    >
      {props.sections.map((section) => {
        const Icon = section.icon;
        const active = section.key === props.activeKey;

        return (
          <button
            key={section.key}
            type="button"
            role="tab"
            aria-selected={active}
            className={active ? "is-active" : undefined}
            onClick={() => props.onChange(section.key)}
          >
            {Icon ? <Icon aria-hidden="true" /> : null}
            <span className="admin-workspace-sections__copy">
              <strong>{section.label}</strong>
              {section.description ? <small>{section.description}</small> : null}
            </span>
            {section.badge !== null && section.badge !== undefined ? (
              <span className="admin-workspace-sections__badge">{section.badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function AdminWorkspaceIntro(props: {
  readonly title: string;
  readonly description: string;
  readonly kicker?: string;
}) {
  return (
    <div className="admin-workspace-intro">
      {props.kicker ? <p className="admin-section-kicker">{props.kicker}</p> : null}
      <h2>{props.title}</h2>
      <p>{props.description}</p>
    </div>
  );
}
