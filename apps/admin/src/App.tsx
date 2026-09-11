// SKIMA Admin V2 composition root. Domain business logic remains inside the
// existing feature workspaces while navigation and presentation move to real,
// category-based browser routes.
// AdminV2WorkspaceRouter is the compatibility bridge to AdminWorkspaceRouter,
// preserving the existing verification, finance, operations and partner workflows.
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
import { AdminV2WorkspaceRouter } from "./app/AdminV2WorkspaceRouter";
import {
  buildAdminCategoryNavigation,
  getAdminScreenLabel,
  getAdminWorkspaceForRoute,
  getAdminWorkspaceNavigation,
  toAdminV2NavigationItem,
} from "./app/admin-v2-navigation";
import { useAdminRoute } from "./app/use-admin-route";
import { AdminWorkspaceLayout } from "./layouts/AdminWorkspaceLayout";
import { useSessionState } from "./session";

const navIconMap = {
  overview: LayoutDashboard,
  dashboard: LayoutDashboard,
  partners: UsersRound,
  operations: Activity,
  money: WalletCards,
  services: Boxes,
  intelligence: Sparkles,
  experience: Megaphone,
  platform: Settings2,
  company: Building2,
  access: UsersRound,
  governance: Settings2,
  applications: ClipboardList,
  verification: ShieldCheck,
  organizations: Building2,
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
  const [route, navigate] = useAdminRoute();

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

  const visibleScreens = filteredNavigation.map(toAdminV2NavigationItem);
  const categoryNavigation = buildAdminCategoryNavigation(visibleScreens);
  const shellNavItems = categoryNavigation.map(toShellNavItem);
  const workspace = getAdminWorkspaceForRoute(route);
  const workspaceNavigation = getAdminWorkspaceNavigation(workspace.key, visibleScreens).map(toShellNavItem);
  const activeCategory = categoryNavigation.find((item) => item.key === workspace.key) ?? categoryNavigation[0];
  const screenLabel = getAdminScreenLabel(route, visibleScreens);
  const isWorkspaceLanding = route === workspace.basePath && workspaceNavigation.length > 0;
  const hasVisibleScreen = isWorkspaceLanding || visibleScreens.some((item) =>
    route === item.href || route.startsWith(`${item.href}/`)
  );
  const safeRoute = hasVisibleScreen ? route : "/dashboard";
  const safeWorkspace = getAdminWorkspaceForRoute(safeRoute);
  const safeWorkspaceNavigation = getAdminWorkspaceNavigation(safeWorkspace.key, visibleScreens).map(toShellNavItem);
  const safeCategory = categoryNavigation.find((item) => item.key === safeWorkspace.key) ?? activeCategory;

  return (
    <PermissionProvider can={can}>
      <AdminShell
        brand="Skima"
        navItems={shellNavItems}
        activeHref={safeCategory?.href ?? "/dashboard"}
        pageLabel={hasVisibleScreen ? screenLabel : "Home"}
        pageHref={safeRoute}
        contextLabel={sessionState.context.platformAdmin?.title ?? "Platform administrator"}
        userLabel={sessionState.context.profile?.display_name ??
          sessionState.context.user.email ??
          "Administrator"}
        onNavigate={navigate}
        onSignOut={sessionState.signOut}
      >
        {safeWorkspace.key === "dashboard" ? (
          <AdminV2WorkspaceRouter route={safeRoute} onNavigate={navigate} />
        ) : (
          <AdminWorkspaceLayout
            title={safeWorkspace.label}
            description={safeWorkspace.description}
            items={safeWorkspaceNavigation}
            activeHref={safeRoute}
            onNavigate={navigate}
          >
            <AdminV2WorkspaceRouter route={safeRoute} onNavigate={navigate} />
          </AdminWorkspaceLayout>
        )}
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
