import type { SessionContext } from "@skima/frontend-core";

import { MobileShell } from "@lpg/app/shell/MobileShell";
import { WorkspaceGuard } from "@lpg/app/guards/WorkspaceGuard";
import { useNestedNavigator } from "@lpg/shared/hooks/useNestedNavigator";
import { customerTabs, type CustomerTab } from "./customerTabs";
import {
  customerRouteScreens,
  customerRouteTabs,
  customerTabRoots,
  type CustomerRoute,
} from "./customerRoutes";

export function CustomerNavigator(props: { readonly context: SessionContext }) {
  const navigation = useNestedNavigator<CustomerRoute>("home");
  const activeTab = customerRouteTabs[navigation.route];
  const Screen = customerRouteScreens[navigation.route];

  const changeTab = (tab: CustomerTab) => navigation.replace(customerTabRoots[tab]);

  return (
    <WorkspaceGuard workspace="customer">
      <MobileShell
        activeTab={activeTab}
        onTabChange={changeTab}
        tabs={customerTabs}
        workspace="customer"
      >
        <Screen context={props.context} navigation={navigation} />
      </MobileShell>
    </WorkspaceGuard>
  );
}
