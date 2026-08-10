import { WorkspaceGate } from "../src/native/navigation/WorkspaceGate";
import { PaymentReturnScreen } from "../src/native/ui/PaymentReturnScreen";
export default function PaymentReturn() {
  return (
    <WorkspaceGate workspace="customer">
      <PaymentReturnScreen />
    </WorkspaceGate>
  );
}
