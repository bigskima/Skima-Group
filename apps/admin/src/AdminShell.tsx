import { ChevronRight, Circle, LogOut, Menu, UserCircle, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { NavItem } from "@skima/ui";

import { AdminAiAssistant } from "./admin-ai-assistant";
import { AdminBrandLogo } from "./admin-brand-logo";

interface AdminShellProps {
  readonly brand: string;
  readonly navItems: readonly NavItem[];
  readonly activeHref: string;
  readonly pageLabel?: string;
  readonly pageHref?: string;
  readonly userLabel: string;
  readonly contextLabel?: string;
  readonly onNavigate: (href: string) => void;
  readonly onSignOut: () => void;
  readonly children: ReactNode;
}

const mobilePriorityKeys = ["dashboard", "partners", "operations", "money"] as const;

export function AdminShell(props: AdminShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navItems = useMemo(() => dedupeNavigationItems(props.navItems), [props.navItems]);
  const activeItem = useMemo(
    () => navItems.find((item) => item.href === props.activeHref) ?? navItems[0],
    [props.activeHref, navItems],
  );
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
          <AdminBrandLogo compact className="admin-shell__brand-mark" />
          <div>
            <strong>{props.brand}</strong>
            <small>Administration</small>
          </div>
        </div>

        <nav className="admin-shell__nav">
          <section className="admin-shell__nav-group" data-section="Workspaces">
            <p>Workspaces</p>
            {navItems.map((item) => (
              <AdminNavItem
                key={item.key}
                item={item}
                active={item.href === props.activeHref}
                onNavigate={navigate}
              />
            ))}
          </section>
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
            <small>{activeItem?.label ?? "SKIMA"}</small>
            <strong>{props.pageLabel ?? activeItem?.label ?? "Home"}</strong>
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

      <AdminAiAssistant
        pageLabel={props.pageLabel ?? activeItem?.label ?? "Home"}
        pageHref={props.pageHref ?? props.activeHref}
      />

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
                <AdminBrandLogo compact className="admin-shell__brand-mark" />
                <div>
                  <strong>{props.brand}</strong>
                  <small>Administration</small>
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

            <nav className="admin-mobile-nav__links" aria-label="Administration workspaces">
              <section className="admin-mobile-nav__group" data-section="Workspaces">
                <p>Workspaces</p>
                {navItems.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={item.href === props.activeHref ? "is-active" : undefined}
                    aria-current={item.href === props.activeHref ? "page" : undefined}
                    onClick={() => navigate(item.href)}
                  >
                    {item.icon ? <item.icon aria-hidden="true" /> : <Circle aria-hidden="true" />}
                    <span>{item.label}</span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                ))}
              </section>
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

export function dedupeNavigationItems(items: readonly NavItem[]): readonly NavItem[] {
  const seenKeys = new Set<string>();
  const seenHrefs = new Set<string>();

  return items.filter((item) => {
    const normalizedHref = normalizeNavigationHref(item.href);

    if (seenKeys.has(item.key) || seenHrefs.has(normalizedHref)) {
      return false;
    }

    seenKeys.add(item.key);
    seenHrefs.add(normalizedHref);
    return true;
  });
}

function normalizeNavigationHref(href: string): string {
  const normalized = href.trim().replace(/\/+$/, "");
  return normalized || "/";
}

function AdminNavItem(props: {
  readonly item: NavItem;
  readonly active: boolean;
  readonly onNavigate: (href: string) => void;
}) {
  const Icon = props.item.icon ?? Circle;
  return (
    <button
      type="button"
      className={props.active ? "is-active" : undefined}
      aria-current={props.active ? "page" : undefined}
      onClick={() => props.onNavigate(props.item.href)}
    >
      <Icon aria-hidden="true" />
      <span>{props.item.label}</span>
      {props.item.badge !== undefined ? <small>{props.item.badge}</small> : null}
    </button>
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
  if (label === "People & Partners") return "Partners";
  if (label === "SKIMA Intelligence") return "AI";
  return label;
}
