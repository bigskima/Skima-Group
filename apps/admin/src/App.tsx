// SKIMA Admin composition root. Feature workspaces, authentication UI, navigation
// configuration, and domain workflows live in dedicated modules.
import {
  Activity,
  BadgeDollarSign,
  Boxes,
  Building2,
  ClipboardList,
  FileText,
  Image,
  LayoutDashboard,
  LifeBuoy,
  MapPinned,
  Megaphone,
  PlugZap,
  ServerCog,
  Settings2,
  ShieldCheck,
  Sparkles,
  Truck,
  UsersRound,
  WalletCards,
  Warehouse,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  filterNavigationItems,
  hasPermission,
  type NavigationItem,
} from "@skima/frontend-core";
import {
  ErrorState,
  LoadingState,
  type NavItem,
  PermissionProvider,
} from "@skima/ui";

import { AdminShell } from "./AdminShell";
import { AdminLoginView } from "./admin-login-view";
import { foundationNavigation } from "./admin-navigation-config";
import { AdminWorkspaceRouter } from "./admin-workspace-router";
import { useSessionState } from "./session";

const navIconMap = {
  overview: LayoutDashboard,
  company: Building2,
  access: UsersRound,
  governance: Settings2,
  applications: ClipboardList,
  verification: ShieldCheck,
  organizations: Building2,
  operations: Activity,
  coverage: MapPinned,
  locationReview: MapPinned,
  drivers: UsersRound,
  deliveryPricing: BadgeDollarSign,
  driverPricing: BadgeDollarSign,
  quality: ShieldCheck,
  revenue: WalletCards,
  policies: FileText,
  ai: Sparkles,
  fleet: Truck,
  finance: WalletCards,
  content: Megaphone,
  branding: Image,
  stations: BadgeDollarSign,
  inventory: Warehouse,
  catalog: Boxes,
  providers: PlugZap,
  system: ServerCog,
  support: LifeBuoy,
  billing: BadgeDollarSign,
} as const;

export function App() {
  const sessionState = useSessionState();
  const [route, setRoute] = useState(readRouteFromHash);

  useEffect(() => {
    const handleHashChange = () => setRoute(readRouteFromHash());
    window.addEventListener("hashchange", handleHashChange);

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  if (sessionState.status === "loading") {
    return <LoadingState label="Loading your account" />;
  }

  if (sessionState.status === "unauthenticated") {
    return <AdminLoginView />;
  }

  if (sessionState.status === "error" || !sessionState.context) {
    return (
      <div className="skima-auth-page">
        <ErrorState
          title="Account unavailable"
          message={sessionState.error ?? "We could not load your account. Please try again."}
          onRetry={sessionState.refreshContext}
        />
      </div>
    );
  }

  const permissionContext = {
    permissions: sessionState.context.permissions,
    roles: sessionState.context.roles,
    organizations: sessionState.context.organizations,
  };
  const can = (permission: string) =>
    sessionState.context?.platformAdmin?.admin_kind === "super_admin" ||
    hasPermission(permissionContext, permission);
  const grantedPermissions = new Set(sessionState.context.permissions);
  const hasAnyPermission = (permissions: readonly string[]) =>
    permissions.some((permission) => grantedPermissions.has(permission));
  const filteredNavigation = sessionState.context.platformAdmin?.admin_kind === "super_admin"
    ? foundationNavigation
    : foundationNavigation.filter((item) => {
      if (item.key === "verification") {
        return hasAnyPermission([
          "platform.verification.read",
          "platform.verification.manage",
          "platform.applications.review",
        ]);
      }
      if (item.key === "operations") {
        return hasAnyPermission([
          "lpg.orders.manage",
          "lpg.dispatch.execute",
          "lpg.cylinders.manage",
          "lpg.safety.manage",
          "lpg.config.manage",
        ]);
      }
      if (item.key === "coverage") {
        return hasAnyPermission([
          "platform.coverage.read",
          "platform.coverage.manage",
          "lpg.config.manage",
        ]);
      }
      if (item.key === "drivers") {
        return hasAnyPermission([
          "platform.drivers.read",
          "platform.drivers.manage",
          "platform.drivers.verify",
        ]);
      }
      if (item.key === "quality") {
        return hasAnyPermission([
          "lpg.quality.read",
          "lpg.quality.manage",
          "lpg.operations.manage",
        ]);
      }
      if (item.key === "delivery-pricing" || item.key === "driver-pricing") {
        return hasAnyPermission([
          "platform.financial_policy.read",
          "platform.financial_policy.draft",
          "platform.financial_policy.approve",
          "platform.financial_policy.activate",
        ]);
      }
      return filterNavigationItems([item], permissionContext).length > 0;
    });
  const shellNavItems = filteredNavigation.map(toShellNavItem);
  const stationRoute = route === "/stations" || route.startsWith("/stations/");
  const activeRoute = stationRoute
    ? "/stations"
    : shellNavItems.some((item) => item.href === route)
    ? route
    : "/";
  const workspaceRoute = stationRoute ? route : activeRoute;

  const navigate = (href: string) => {
    window.location.hash = href === "/" ? "" : href;
    setRoute(href);
  };

  return (
    <PermissionProvider can={can}>
      <AdminShell
        brand="Skima"
        navItems={shellNavItems}
        activeHref={activeRoute}
        contextLabel={sessionState.context.platformAdmin?.title ?? "Platform administrator"}
        userLabel={sessionState.context.profile?.display_name ??
          sessionState.context.user.email ??
          "Administrator"}
        onNavigate={navigate}
        onSignOut={sessionState.signOut}
      >
        <AdminWorkspaceRouter route={workspaceRoute} onNavigate={navigate} />
      </AdminShell>
    </PermissionProvider>
  );
}

function toShellNavItem(item: NavigationItem): NavItem {
  const Icon = navIconMap[item.icon as keyof typeof navIconMap] ?? LayoutDashboard;

  return {
    key: item.key,
    label: item.label,
    href: item.href,
    icon: Icon,
    requiredPermissions: item.requiredPermissions,
  };
}

function readRouteFromHash(): string {
  const route = window.location.hash.replace(/^#/, "");
  return route.length > 0 ? route : "/";
}
