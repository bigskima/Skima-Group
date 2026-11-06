import { ProviderOpportunitiesScreen } from "../../src/screens/ProviderOpportunitiesScreen";

// Backwards-compatible route: existing customer/provider links may still point to /works.
export default function ProviderWorksRoute() {
  return <ProviderOpportunitiesScreen />;
}
