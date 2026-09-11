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
import {
  canAccessAdminNavigationKey,
  foundationNavigation,
} from "./admin-navigation-config";
import { shouldShowWorkspaceRouteUnavailable } from "./app/admin-route-recovery";
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
  const filteredNavigation = foundationNavigation.filter((item) =>
    canAccessAdminNavigationKey(item.key, can)
  );

  const visibleScreens = filteredNavigation.map(toAdminV2NavigationItem);
  const categoryNavigation = buildAdminCategoryNavigation(visibleScreens);
  const shellNavItems = categoryNavigation.map(toShellNavItem);
  const workspace = getAdminWorkspaceForRoute(route);
  const workspaceNavigationItems = getAdminWorkspaceNavigation(workspace.key, visibleScreens);
  const activeCategory = categoryNavigation.find((item) => item.key === workspace.key) ?? categoryNavigation[0];
  const screenLabel = getAdminScreenLabel(route, visibleScreens);
  const isWorkspaceLanding = route === workspace.basePath && workspaceNavigationItems.length > 0;
  const hasVisibleScreen = isWorkspaceLanding || workspaceNavigationItems.some((item) =>
    route === item.href || route.startsWith(`${item.href}/`)
  ) || visibleScreens.some((item) =>
    route === item.href || route.startsWith(`${item.href}/`)
  );
  const workspaceVisible = categoryNavigation.some((item) => item.key === workspace.key);
  const showUnavailableRoute = shouldShowWorkspaceRouteUnavailable({
    route,
    workspaceBasePath: workspace.basePath,
    workspaceVisible,
    hasVisibleScreen,
  });
  const safeRoute = hasVisibleScreen ? route : showUnavailableRoute ? workspace.basePath : "/dashboard";
  const safeWorkspace = showUnavailableRoute ? workspace : getAdminWorkspaceForRoute(safeRoute);
  const safeWorkspaceNavigationItems = getAdminWorkspaceNavigation(safeWorkspace.key, visibleScreens);
  const safeWorkspaceNavigation = safeWorkspaceNavigationItems.map(toShellNavItem);
  const safeCategory = categoryNavigation.find((item) => item.key === safeWorkspace.key) ?? activeCategory;
  const pageLabel = showUnavailableRoute ? "Page unavailable" : hasVisibleScreen ? screenLabel : "Home";
  const pageHref = showUnavailableRoute ? safeWorkspace.basePath : safeRoute;

  const workspaceContent = (
    <div className="admin-v2-screen" data-route={safeRoute}>
      {showUnavailableRoute ? (
        <ErrorState
          title="Page unavailable"
          message="This page is not available from your current SKIMA admin access. Open the workspace overview and choose one of the tasks available to you."
          onRetry={() => navigate(safeWorkspace.basePath, { replace: true })}
        />
      ) : (
        <AdminV2WorkspaceRouter route={safeRoute} onNavigate={navigate} />
      )}
    </div>
  );

  return (
    <PermissionProvider can={can}>
      <AdminShell
        brand="SKIMA"
        navItems={shellNavItems}
        activeHref={safeCategory?.href ?? "/dashboard"}
        pageLabel={pageLabel}
        pageHref={pageHref}
        contextLabel={sessionState.context.platformAdmin?.title ?? "Platform administrator"}
        userLabel={sessionState.context.profile?.display_name ??
          sessionState.context.user.email ??
          "Administrator"}
        onNavigate={navigate}
        onSignOut={sessionState.signOut}
      >
        {safeWorkspace.key === "dashboard" ? (
          workspaceContent
        ) : (
          <AdminWorkspaceLayout
            title={safeWorkspace.label}
            description={safeWorkspace.description}
            items={safeWorkspaceNavigation}
            activeHref={showUnavailableRoute ? safeWorkspace.basePath : safeRoute}
            onNavigate={navigate}
          >
            {workspaceContent}
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
