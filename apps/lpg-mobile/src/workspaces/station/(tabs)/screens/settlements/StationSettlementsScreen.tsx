import { Banknote, ListChecks, ReceiptText, WalletCards } from "lucide-react";

import { PermissionGuard } from "@lpg/app/guards/PermissionGuard";
import { useCurrenciesQuery } from "@lpg/features/config/api";
import { useSettlementsQuery, useWalletBalancesQuery, useWithdrawalsQuery } from "@lpg/features/wallet/api";
import { MenuRow, PageHeading, PolishedEmpty, TransactionList, WalletArt } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { WalletSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import { displayMoney, resolveCurrencyCode } from "@lpg/shared/utilities/display";
import { walletTotal } from "@lpg/shared/utilities/lpgFormat";
import { displayReference, formatStatus, getFirstRecordString, getRecordId, recordKey } from "@lpg/shared/api/records";
import type { StationScreenProps } from "../../navigation/stationRoutes";

export function StationSettlementsScreen(props: StationScreenProps) {
  const wallets = useWalletBalancesQuery();
  const settlements = useSettlementsQuery();
  const withdrawals = useWithdrawalsQuery();
  const currencies = useCurrenciesQuery();
  const currencyCode = resolveCurrencyCode(currencies.data ?? [], wallets.data?.[0] ?? settlements.data?.[0]);

  return (
    <PermissionGuard
      context={props.context}
      permissions={["lpg.orders.finance", "business.finance.read", "business.settlements.read"]}
      fallback={<PolishedEmpty icon={<WalletCards />} title="Settlement access restricted" message="This station role does not have finance visibility." />}
    >
      <QueryState loading={wallets.isLoading || settlements.isLoading} error={wallets.error ?? settlements.error} skeleton={<WalletSkeleton />}>
        <PageHeading title="Settlements" subtitle="Station ledger and payout records" icon={<WalletCards />} />
        <section className="settlement-hero">
          <div><span>Station Wallet Balance</span><strong>{displayMoney(walletTotal(wallets.data ?? [], currencyCode ?? ""), currencyCode)}</strong><button type="button" className="light-button" onClick={() => props.navigation.navigate("settlement-withdrawal")}>Withdraw</button></div>
          <WalletArt />
        </section>
        <div className="settlement-action-grid"><button type="button" className="secondary-button" onClick={() => props.navigation.navigate("settlement-transactions")}><ListChecks aria-hidden="true" />Transactions</button><button type="button" className="secondary-button" onClick={() => props.navigation.navigate("settlement-payouts")}><Banknote aria-hidden="true" />Payouts</button></div>
        <section className="panel-card"><h2>Settlement Statements</h2>{(settlements.data ?? []).slice(0, 5).map((settlement, index) => <button type="button" className="unstyled-record-button" key={recordKey(settlement, `settlement-${index}`)} onClick={() => props.navigation.navigate("settlement-details", { settlementId: getRecordId(settlement) ?? "" })}><MenuRow icon={<ReceiptText />} title={displayReference(settlement, "Settlement")} text={formatStatus(getFirstRecordString(settlement, ["status"]))} /></button>)}{(settlements.data ?? []).length === 0 ? <PolishedEmpty icon={<ReceiptText />} title="No settlements yet" message="Completed refill settlements will appear here." /> : null}</section>
        <TransactionList commissions={[]} currencyCode={currencyCode ?? "XXX"} deposits={[]} settlements={settlements.data ?? []} withdrawals={withdrawals.data ?? []} />
      </QueryState>
    </PermissionGuard>
  );
}
