import type { SessionContext } from "@skima/frontend-core";

import { MobileShell } from "@lpg/app/shell/MobileShell";
import { WorkspaceGuard } from "@lpg/app/guards/WorkspaceGuard";
import { useNestedNavigator } from "@lpg/shared/hooks/useNestedNavigator";
import { driverTabs, type DriverTab } from "./driverTabs";
import { driverRouteScreens, driverRouteTabs, driverTabRoots, type DriverRoute } from "./driverRoutes";

export function DriverNavigator(props: { readonly context: SessionContext }) {
  const navigation = useNestedNavigator<DriverRoute>("home");
  const activeTab = driverRouteTabs[navigation.route];
  const Screen = driverRouteScreens[navigation.route];
  const changeTab = (tab: DriverTab) => navigation.replace(driverTabRoots[tab]);

  return (
    <WorkspaceGuard workspace="driver">
      <MobileShell activeTab={activeTab} onTabChange={changeTab} tabs={driverTabs} workspace="driver">
        <Screen context={props.context} navigation={navigation} />
      </MobileShell>
    </WorkspaceGuard>
  );
}
