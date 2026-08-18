import {
  WorkspaceTabs,
  customerTabs,
} from "../../src/native/navigation/WorkspaceTabs";
import { WorkspaceGate } from "../../src/native/navigation/WorkspaceGate";
export default function Layout() {
  return (
    <WorkspaceGate workspace="customer">
      <WorkspaceTabs
        tabs={customerTabs}
        hidden={[
          "cylinder/register",
          "cylinder/[id]",
          "orders/[id]",
          "orders/[id]/tracking",
          "orders/[id]/verify",
          "orders/[id]/receipt",
          "orders/new",
          "notifications",
          "stations",
          "station/[id]",
          "locations",
          "transactions",
          "payment-methods",
          "support",
          "wallet/top-up",
          "wallet/withdraw",
          "driver-application",
          "station-application",
          "driver-documents",
          "station-documents",
        ]}
      />
    </WorkspaceGate>
  );
}
