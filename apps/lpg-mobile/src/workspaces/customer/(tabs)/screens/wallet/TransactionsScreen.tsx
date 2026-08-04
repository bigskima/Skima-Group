import { ReceiptText } from "lucide-react";

import { useCurrenciesQuery } from "@lpg/features/config/api";
import { useCommissionsQuery, useDepositsQuery, useSettlementsQuery, useWithdrawalsQuery } from "@lpg/features/wallet/api";
import { TransactionList } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { WorkflowHeader } from "@lpg/shared/ui/WorkflowScreen";
import { resolveCurrencyCode } from "@lpg/shared/utilities/display";
import type { CustomerScreenProps } from "../../navigation/customerRoutes";

export function TransactionsScreen(props: CustomerScreenProps) {
  const deposits = useDepositsQuery();
  const withdrawals = useWithdrawalsQuery();
  const settlements = useSettlementsQuery();
  const commissions = useCommissionsQuery();
  const currencies = useCurrenciesQuery();
  const currencyCode = resolveCurrencyCode(currencies.data ?? [], deposits.data?.[0] ?? withdrawals.data?.[0]);

  return (
    <QueryState loading={deposits.isLoading || withdrawals.isLoading || currencies.isLoading} error={deposits.error ?? withdrawals.error ?? currencies.error}>
      <WorkflowHeader title="Transactions" subtitle="Ledger-backed wallet activity" onBack={props.navigation.goBack} />
      <TransactionList commissions={commissions.data ?? []} currencyCode={currencyCode ?? "XXX"} deposits={deposits.data ?? []} settlements={settlements.data ?? []} withdrawals={withdrawals.data ?? []} />
      {(deposits.data ?? []).length + (withdrawals.data ?? []).length === 0 ? <section className="route-empty-state"><span><ReceiptText aria-hidden="true" /></span><h2>No wallet activity</h2><p>Verified deposits, payments, refunds, and withdrawals will appear here.</p></section> : null}
    </QueryState>
  );
}
