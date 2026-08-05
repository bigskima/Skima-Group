import { Bell, Plus, WalletCards } from "lucide-react";

import { useCurrenciesQuery } from "@lpg/features/config/api";
import { useDepositsQuery, useWalletBalancesQuery, useWithdrawalsQuery } from "@lpg/features/wallet/api";
import { PageHeading, TransactionList, WalletArt } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { WalletSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import { displayMoney, resolveCurrencyCode } from "@lpg/shared/utilities/display";
import { walletTotal } from "@lpg/shared/utilities/lpgFormat";
import type { CustomerScreenProps } from "../../navigation/customerRoutes";

export function CustomerWalletScreen(props: CustomerScreenProps) {
  const wallets = useWalletBalancesQuery();
  const deposits = useDepositsQuery();
  const withdrawals = useWithdrawalsQuery();
  const currencies = useCurrenciesQuery();
  const currencyCode = resolveCurrencyCode(currencies.data ?? [], wallets.data?.[0]);

  return (
    <QueryState loading={wallets.isLoading || currencies.isLoading} error={wallets.error ?? currencies.error} skeleton={<WalletSkeleton />}>
      <PageHeading title="Wallet" subtitle="Your ledger-backed LPG balance" icon={<Bell />} />
      <section className="wallet-hero">
        <div>
          <span>Available Balance</span>
          <strong>{displayMoney(walletTotal(wallets.data ?? [], currencyCode ?? ""), currencyCode)}</strong>
          <button type="button" className="light-button" onClick={() => props.navigation.navigate("wallet-top-up")}>
            <Plus aria-hidden="true" /> Top Up
          </button>
        </div>
        <WalletArt />
      </section>
      <TransactionList
        commissions={[]}
        currencyCode={currencyCode ?? "XXX"}
        deposits={deposits.data ?? []}
        settlements={[]}
        withdrawals={withdrawals.data ?? []}
      />
      <button type="button" className="outline-button" onClick={() => props.navigation.navigate("wallet-transactions")}>
        <WalletCards aria-hidden="true" /> View Transactions
      </button>
    </QueryState>
  );
}
