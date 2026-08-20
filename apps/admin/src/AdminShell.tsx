import { ChevronRight, Circle, LogOut, Menu, UserCircle, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { NavItem } from "@skima/ui";

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

const mobilePriorityKeys = ["overview", "applications", "operations", "finance", "company", "access"] as const;

export function AdminShell(props: AdminShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const activeItem = useMemo(
    () => props.navItems.find((item) => item.href === props.activeHref) ?? props.navItems[0],
    [props.activeHref, props.navItems],
  );
  const primaryItems = props.navItems.slice(0, 5);
  const managementItems = props.navItems.slice(5);
  const mobileItems = useMemo(() => {
    const prioritized = mobilePriorityKeys
      .map((key) => props.navItems.find((item) => item.key === key))
      .filter((item): item is NavItem => Boolean(item));
    const remaining = props.navItems.filter((item) =>
      !prioritized.some((candidate) => candidate.key === item.key)
    );

    return [...prioritized, ...remaining].slice(0, 4);
  }, [props.navItems]);
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
            <small>Administration</small>
          </div>
        </div>

        <nav className="admin-shell__nav">
          <AdminNavGroup
            label="Company"
            items={primaryItems}
            activeHref={props.activeHref}
            onNavigate={navigate}
          />
          {managementItems.length ? (
            <AdminNavGroup
              label="Management & settings"
              items={managementItems}
              activeHref={props.activeHref}
              onNavigate={navigate}
            />
          ) : null}
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
            aria-label="Open navigation"
            aria-expanded={mobileMenuOpen}
            aria-controls="admin-mobile-menu"
          >
            <Menu aria-hidden="true" />
          </button>

          <div className="admin-shell__page-context">
            <small>SKIMA administration</small>
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

        <nav className="admin-shell__bottom-nav" aria-label="Quick navigation">
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
            aria-label="Close navigation"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside id="admin-mobile-menu" className="admin-mobile-nav__drawer" aria-label="Administration menu">
            <div className="admin-mobile-nav__header">
              <div className="admin-shell__brand admin-shell__brand--mobile">
                <span className="admin-shell__brand-mark" aria-hidden="true">S</span>
                <div>
                  <strong>{props.brand}</strong>
                  <small>Administration</small>
                </div>
              </div>
              <button type="button" onClick={() => setMobileMenuOpen(false)} aria-label="Close navigation">
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

            <nav className="admin-mobile-nav__links">
              {props.navItems.map((item) => {
                const Icon = item.icon ?? Circle;
                const active = item.href === props.activeHref;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={active ? "is-active" : undefined}
                    onClick={() => navigate(item.href)}
                  >
                    <Icon aria-hidden="true" />
                    <span>{item.label}</span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                );
              })}
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
  if (label === "Companies") return "Companies";
  return label;
}
