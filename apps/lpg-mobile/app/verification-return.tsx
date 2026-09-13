import { WorkspaceGate } from "../src/native/navigation/WorkspaceGate";
import { VerificationReturnScreen } from "../src/native/ui/VerificationReturnScreen";

export default function VerificationReturn() {
  return (
    <WorkspaceGate workspace="customer">
      <VerificationReturnScreen />
    </WorkspaceGate>
  );
}
