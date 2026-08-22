import { useLocalSearchParams } from "expo-router";

import { PolicyDocumentScreen } from "../../src/native/ui/PolicyDocumentScreen";

export default function PartnerTermsRoute() {
  const params = useLocalSearchParams<{
    applicationId?: string | string[];
    roleKey?: string | string[];
  }>();
  const applicationId = firstParam(params.applicationId);
  const roleKey = firstParam(params.roleKey);

  return (
    <PolicyDocumentScreen
      policyKey="policy.partner.participation"
      applicationId={applicationId}
      roleKey={roleKey}
    />
  );
}

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}
