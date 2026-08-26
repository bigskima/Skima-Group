import { ChevronRight, Circle, FileText, LogOut, MapPinned, Menu, UserCircle, WalletCards, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { NavItem } from "@skima/ui";

import { useSessionState } from "./session";

interface AdminShellProps {
  readonly brand: string;
  readonly navItems: readonly NavItem[];
  readonly activeHref: string;
  readonly userLabel: string;
  readonly contextLabel?: string;
  readonly onNavigate: (href: string) => void;
  readonly onSignOut: () => void;
  readonly children: ReactNode;
}

interface NavigationGroupDefinition {
  readonly label: string;
  readonly keys: readonly string[];
}

interface NavigationGroup extends NavigationGroupDefinition {
  readonly items: readonly NavItem[];
}

const mobilePriorityKeys = ["overview", "applications", "location-review", "operations", "revenue", "finance"] as const;

const navigationGroupDefinitions: readonly NavigationGroupDefinition[] = [
  {
    label: "Daily work",
    keys: ["overview", "applications", "location-review", "operations", "revenue", "finance"],
  },
  {
    label: "Company management",
    keys: ["company", "access", "content", "policies", "catalog"],
  },
  {
    label: "Platform controls",
    keys: ["coverage", "governance", "providers", "system"],
  },
];

export function AdminShell(props: AdminShellProps) {
  const sessionState = useSessionState();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const canSeeRevenue = sessionState.context?.platformAdmin?.admin_kind === "super_admin" ||
    sessionState.context?.permissions.includes("platform.revenue.read") ||
    sessionState.context?.permissions.includes("platform.revenue.manage") ||
    false;
  const canManageCoverage = sessionState.context?.platformAdmin?.admin_kind === "super_admin" ||
    sessionState.context?.permissions.includes("platform.coverage.read") ||
    sessionState.context?.permissions.includes("platform.coverage.manage") ||
    sessionState.context?.permissions.includes("lpg.config.manage") ||
    false;
  const canReviewApplications = sessionState.context?.platformAdmin?.admin_kind === "super_admin" ||
    sessionState.context?.permissions.includes("platform.applications.review") ||
    false;
  const canReadPolicies = sessionState.context?.platformAdmin?.admin_kind === "super_admin" ||
    sessionState.context?.permissions.includes("platform.policy.read") ||
    false;

  const navItems = useMemo<readonly NavItem[]>(() => {
    let resolved = [...props.navItems];

    if (canSeeRevenue && !resolved.some((item) => item.key === "revenue")) {
      const revenueItem: NavItem = {
        key: "revenue",
        label: "Money & Revenue",
        href: "/revenue",
        icon: WalletCards,
      };
      const financeIndex = resolved.findIndex((item) => item.key === "finance");
      resolved = financeIndex < 0
        ? [...resolved, revenueItem]
        : [
          ...resolved.slice(0, financeIndex),
          revenueItem,
          ...resolved.slice(financeIndex),
        ];
    }

    if (canManageCoverage && !resolved.some((item) => item.key === "coverage")) {
      const coverageItem: NavItem = {
        key: "coverage",
        label: "Service Coverage",
        href: "/coverage",
        icon: MapPinned,
      };
      const governanceIndex = resolved.findIndex((item) => item.key === "governance");
      resolved = governanceIndex < 0
        ? [...resolved, coverageItem]
        : [
          ...resolved.slice(0, governanceIndex),
          coverageItem,
          ...resolved.slice(governanceIndex),
        ];
    }

    if (canReviewApplications && !resolved.some((item) => item.key === "location-review")) {
      const locationReviewItem: NavItem = {
        key: "location-review",
        label: "Location Review",
        href: "/location-review",
        icon: MapPinned,
      };
      const applicationIndex = resolved.findIndex((item) => item.key === "applications");
      resolved = applicationIndex < 0
        ? [...resolved, locationReviewItem]
        : [
          ...resolved.slice(0, applicationIndex + 1),
          locationReviewItem,
          ...resolved.slice(applicationIndex + 1),
        ];
    }

    if (canReadPolicies && !resolved.some((item) => item.key === "policies")) {
      const policyItem: NavItem = {
        key: "policies",
        label: "Terms & Policies",
        href: "/policies",
        icon: FileText,
      };
      const contentIndex = resolved.findIndex((item) => item.key === "content");
      const catalogIndex = resolved.findIndex((item) => item.key === "catalog");
      const insertAt = contentIndex >= 0 ? contentIndex + 1 : catalogIndex >= 0 ? catalogIndex : resolved.length;
      resolved = [
        ...resolved.slice(0, insertAt),
        policyItem,
        ...resolved.slice(insertAt),
      ];
    }

    return resolved;
  }, [canManageCoverage, canReadPolicies, canReviewApplications, canSeeRevenue, props.navItems]);

  const activeItem = useMemo(
    () => navItems.find((item) => item.href === props.activeHref) ?? navItems[0],
    [props.activeHref, navItems],
  );
  const navigationGroups = useMemo(() => groupNavigationItems(navItems), [navItems]);
  const mobileItems = useMemo(() => {
    const prioritized = mobilePriorityKeys
      .map((key) => navItems.find((item) => item.key === key))
      .filter((item): item is NavItem => Boolean(item));
    const remaining = navItems.filter((item) =>
      !prioritized.some((candidate) => candidate.key === item.key)
    );

    return [...prioritized, ...remaining].slice(0, 4);
  }, [navItems]);
  const activeIsInMobileBar = mobileItems.some((item) => item.href === props.activeHref);

  const navigate = (href: string) => {
    setMobileMenuOpen(false);
    props.onNavigate(href);
  };

  return (
    <div className="admin-shell">
      <aside className="admin-shell__sidebar" aria-label="Administration navigation">
        <div className="admin-shell__brand">
          <span className="admin-shell__brand-mark" aria-hidden="true">S</span>
          <div>
            <strong>{props.brand}</strong>
            <small>Company administration</small>
          </div>
        </div>

        <nav className="admin-shell__nav">
          {navigationGroups.map((group) => (
            <AdminNavGroup
              key={group.label}
              label={group.label}
              items={group.items}
              activeHref={props.activeHref}
              onNavigate={navigate}
            />
          ))}
        </nav>

        <div className="admin-shell__sidebar-account">
          <UserCircle aria-hidden="true" />
          <div>
            <strong>{props.userLabel}</strong>
            <small>{props.contextLabel ?? "Administrator"}</small>
          </div>
          <button type="button" onClick={props.onSignOut} aria-label="Sign out" title="Sign out">
            <LogOut aria-hidden="true" />
          </button>
        </div>
      </aside>

      <div className="admin-shell__main">
        <header className="admin-shell__topbar">
          <button
            type="button"
            className="admin-shell__menu-button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open administration menu"
            aria-expanded={mobileMenuOpen}
            aria-controls="admin-mobile-menu"
          >
            <Menu aria-hidden="true" />
          </button>

          <div className="admin-shell__page-context">
            <small>SKIMA company administration</small>
            <strong>{activeItem?.label ?? "Overview"}</strong>
          </div>

          <div className="admin-shell__desktop-account">
            <UserCircle aria-hidden="true" />
            <div>
              <strong>{props.userLabel}</strong>
              <small>{props.contextLabel ?? "Administrator"}</small>
            </div>
            <button type="button" onClick={props.onSignOut} aria-label="Sign out" title="Sign out">
              <LogOut aria-hidden="true" />
            </button>
          </div>
        </header>

        <main className="admin-shell__content">{props.children}</main>

        <nav className="admin-shell__bottom-nav" aria-label="Quick administration navigation">
          {mobileItems.map((item) => (
            <AdminBottomNavItem
              key={item.key}
              item={item}
              active={item.href === props.activeHref}
              onClick={() => navigate(item.href)}
            />
          ))}
          <button
            type="button"
            className={`admin-shell__bottom-item ${!activeIsInMobileBar ? "is-active" : ""}`}
            onClick={() => setMobileMenuOpen(true)}
            aria-label="More administration areas"
          >
            <Menu aria-hidden="true" />
            <span>More</span>
          </button>
        </nav>
      </div>

      {mobileMenuOpen ? (
        <div className="admin-mobile-nav" role="presentation">
          <button
            type="button"
            className="admin-mobile-nav__backdrop"
            aria-label="Close administration menu"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside id="admin-mobile-menu" className="admin-mobile-nav__drawer" aria-label="Administration menu">
            <div className="admin-mobile-nav__header">
              <div className="admin-shell__brand admin-shell__brand--mobile">
                <span className="admin-shell__brand-mark" aria-hidden="true">S</span>
                <div>
                  <strong>{props.brand}</strong>
                  <small>Company administration</small>
                </div>
              </div>
              <button type="button" onClick={() => setMobileMenuOpen(false)} aria-label="Close administration menu">
                <X aria-hidden="true" />
              </button>
            </div>

            <div className="admin-mobile-nav__account">
              <UserCircle aria-hidden="true" />
              <div>
                <strong>{props.userLabel}</strong>
                <small>{props.contextLabel ?? "Administrator"}</small>
              </div>
            </div>

            <nav className="admin-mobile-nav__links" aria-label="All administration areas">
              {navigationGroups.map((group) => (
                <AdminMobileNavGroup
                  key={group.label}
                  group={group}
                  activeHref={props.activeHref}
                  onNavigate={navigate}
                />
              ))}
            </nav>

            <button type="button" className="admin-mobile-nav__signout" onClick={props.onSignOut}>
              <LogOut aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function groupNavigationItems(items: readonly NavItem[]): readonly NavigationGroup[] {
  const assignedKeys = new Set<string>();
  const groups = navigationGroupDefinitions
    .map((definition) => {
      const groupItems = definition.keys
        .map((key) => items.find((item) => item.key === key))
        .filter((item): item is NavItem => Boolean(item));
      groupItems.forEach((item) => assignedKeys.add(item.key));
      return { ...definition, items: groupItems };
    })
    .filter((group) => group.items.length > 0);
  const remaining = items.filter((item) => !assignedKeys.has(item.key));

  return remaining.length > 0
    ? [...groups, { label: "Other", keys: remaining.map((item) => item.key), items: remaining }]
    : groups;
}

function AdminNavGroup(props: {
  readonly label: string;
  readonly items: readonly NavItem[];
  readonly activeHref: string;
  readonly onNavigate: (href: string) => void;
}) {
  return (
    <section className="admin-shell__nav-group">
      <p>{props.label}</p>
      {props.items.map((item) => {
        const Icon = item.icon ?? Circle;
        const active = item.href === props.activeHref;
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
            {item.badge !== undefined ? <small>{item.badge}</small> : null}
          </button>
        );
      })}
    </section>
  );
}

function AdminMobileNavGroup(props: {
  readonly group: NavigationGroup;
  readonly activeHref: string;
  readonly onNavigate: (href: string) => void;
}) {
  return (
    <section className="admin-mobile-nav__group">
      <p>{props.group.label}</p>
      {props.group.items.map((item) => {
        const Icon = item.icon ?? Circle;
        const active = item.href === props.activeHref;
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
    </section>
  );
}

function AdminBottomNavItem(props: {
  readonly item: NavItem;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  const Icon = props.item.icon ?? Circle;
  return (
    <button
      type="button"
      className={`admin-shell__bottom-item ${props.active ? "is-active" : ""}`}
      aria-current={props.active ? "page" : undefined}
      onClick={props.onClick}
    >
      <Icon aria-hidden="true" />
      <span>{shortMobileLabel(props.item.label)}</span>
    </button>
  );
}

function shortMobileLabel(label: string) {
  if (label === "People & Access") return "People";
  if (label === "Applications") return "Approvals";
  if (label === "Location Review") return "Locations";
  if (label === "Systems & Audit") return "Systems";
  if (label === "Money & Revenue") return "Revenue";
  if (label === "Service Coverage") return "Coverage";
  if (label === "Terms & Policies") return "Policies";
  return label;
}
