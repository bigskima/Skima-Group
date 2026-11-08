import {
  WorkspaceTabs,
  customerTabs,
} from "../../src/native/navigation/WorkspaceTabs";
import { WorkspaceGate } from "../../src/native/navigation/WorkspaceGate";
import { RefillCustomerPolicyGate } from "../../src/native/policies/RefillCustomerPolicyGate";
export default function Layout() {
  return (
    <WorkspaceGate workspace="customer">
      <RefillCustomerPolicyGate>
      <WorkspaceTabs
        guideScope="customer"
        tabs={customerTabs}
        hidden={[
          "assistant",
          "store",
          "store-order/[id]",
          "cylinder/register",
          "cylinder/[id]",
          "cylinder/[id]/edit",
          "cylinder/[id]/media",
          "cylinder/[id]/identity",
          "orders/[id]",
          "orders/[id]/payment",
          "orders/[id]/tracking",
          "orders/[id]/verify",
          "orders/[id]/receipt",
          "orders/[id]/feedback",
          "orders/new",
          "fuel",
          "fuel-orders",
          "fuel-order/[id]",
          "notifications",
          "stations",
          "station/[id]",
          "locations",
          "location-editor",
          "transactions",
          "bills",
          "payment-methods",
          "support",
          "wallet/top-up",
          "wallet/withdraw",
          "wallet/affiliate-withdraw",
          "driver-application",
          "station-application",
          "driver-documents",
          "station-documents",
          "station-invitation",
          "fleet",
          "cylinder-capacity/[id]",
          "account-tools",
          "account-settings",
          "referrals",
        ]}
      />
      </RefillCustomerPolicyGate>
    </WorkspaceGate>
  );
}
