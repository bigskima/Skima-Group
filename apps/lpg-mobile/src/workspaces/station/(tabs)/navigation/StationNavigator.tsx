import type { SessionContext } from "@skima/frontend-core";
import { useEffect, useMemo } from "react";

import { MobileShell } from "@lpg/app/shell/MobileShell";
import { WorkspaceGuard } from "@lpg/app/guards/WorkspaceGuard";
import { useNestedNavigator } from "@lpg/shared/hooks/useNestedNavigator";
import { buildStationTabs, type StationTab } from "./stationTabs";
import { stationRouteScreens, stationRouteTabs, stationTabRoots, type StationRoute } from "./stationRoutes";

export function StationNavigator(props: { readonly context: SessionContext }) {
  const tabs = useMemo(() => buildStationTabs(props.context), [props.context]);
  const initialRoute = stationTabRoots[tabs[0]?.key ?? "account"];
  const navigation = useNestedNavigator<StationRoute>(initialRoute);
  const activeTab = stationRouteTabs[navigation.route];
  const Screen = stationRouteScreens[navigation.route];
  const visibleTabKeys = useMemo(() => new Set(tabs.map((tab) => tab.key)), [tabs]);
  const replace = navigation.replace;

  useEffect(() => {
    if (!visibleTabKeys.has(activeTab)) replace(initialRoute);
  }, [activeTab, initialRoute, replace, visibleTabKeys]);

  const changeTab = (tab: StationTab) => navigation.replace(stationTabRoots[tab]);

  return (
    <WorkspaceGuard workspace="station">
      <MobileShell activeTab={activeTab} onTabChange={changeTab} tabs={tabs} workspace="station">
        <Screen context={props.context} navigation={navigation} />
      </MobileShell>
    </WorkspaceGuard>
  );
}
