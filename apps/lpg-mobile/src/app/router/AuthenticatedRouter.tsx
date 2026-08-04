import type { SessionContext } from "@skima/frontend-core";

import { WorkspaceProvider, useWorkspace } from "../../features/permissions/WorkspaceProvider";
import { CustomerNavigator } from "../../workspaces/customer/(tabs)/navigation/CustomerNavigator";
import { DriverNavigator } from "../../workspaces/driver/(tabs)/navigation/DriverNavigator";
import { StationNavigator } from "../../workspaces/station/(tabs)/navigation/StationNavigator";

export function AuthenticatedRouter(props: { readonly context: SessionContext }) {
  return (
    <WorkspaceProvider session={props.context}>
      <AuthorisedWorkspaceRouter context={props.context} />
    </WorkspaceProvider>
  );
}

function AuthorisedWorkspaceRouter(props: { readonly context: SessionContext }) {
  const workspace = useWorkspace();

  switch (workspace.current) {
    case "driver":
      return <DriverNavigator context={props.context} />;
    case "station":
      return <StationNavigator context={props.context} />;
    case "customer":
    default:
      return <CustomerNavigator context={props.context} />;
  }
}
