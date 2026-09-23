import { PolicyDocumentScreen } from "../../src/native/ui/PolicyDocumentScreen";

export default function PrivacyPolicy() {
  return <PolicyDocumentScreen policyKey="policy.privacy.notice" allowAcceptance={false} />;
}
