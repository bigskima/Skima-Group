import { WalletCards } from "lucide-react";

import { useCurrenciesQuery } from "@lpg/features/config/api";
import { useCommissionsQuery, useWalletBalancesQuery, useWithdrawalsQuery } from "@lpg/features/wallet/api";
import { PageHeading, TransactionList, WalletArt } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { displayMoney, resolveCurrencyCode } from "@lpg/shared/utilities/display";
import { walletTotal } from "@lpg/shared/utilities/lpgFormat";
import type { DriverScreenProps } from "../../navigation/driverRoutes";

export function DriverEarningsScreen(props: DriverScreenProps) {
  const wallets = useWalletBalancesQuery();
  const commissions = useCommissionsQuery();
  const withdrawals = useWithdrawalsQuery();
  const currencies = useCurrenciesQuery();
  const currencyCode = resolveCurrencyCode(currencies.data ?? [], wallets.data?.[0] ?? commissions.data?.[0]);

  return (
    <QueryState loading={wallets.isLoading || commissions.isLoading} error={wallets.error ?? commissions.error}>
      <PageHeading title="Earnings" subtitle="Commission and payout history" icon={<WalletCards />} />
      <section className="wallet-hero">
        <div><span>Available Balance</span><strong>{displayMoney(walletTotal(wallets.data ?? [], currencyCode ?? ""), currencyCode)}</strong><button type="button" className="light-button" onClick={() => props.navigation.navigate("earnings-withdrawal")}>Withdraw</button></div>
        <WalletArt />
      </section>
      <TransactionList commissions={commissions.data ?? []} currencyCode={currencyCode ?? "XXX"} deposits={[]} settlements={[]} withdrawals={withdrawals.data ?? []} />
    </QueryState>
  );
}
