import { useLocalSearchParams } from "expo-router";
import { FinanceWithdrawalExperience } from "../../../src/native/ui/FinanceWithdrawalExperience";

export default function AffiliateWithdraw() {
  const params = useLocalSearchParams<{ walletId?: string | string[] }>();
  const walletId = Array.isArray(params.walletId) ? params.walletId[0] : params.walletId;
  return <FinanceWithdrawalExperience workspace="customer" walletIdOverride={walletId ?? null} />;
}
