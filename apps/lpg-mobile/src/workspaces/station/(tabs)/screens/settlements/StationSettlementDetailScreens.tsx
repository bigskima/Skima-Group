import { Banknote, CalendarDays, ReceiptText, WalletCards } from "lucide-react";

import { PermissionGuard } from "@lpg/app/guards/PermissionGuard";
import { WithdrawalWorkflow } from "@lpg/features/wallet/WithdrawalWorkflow";
import { useCurrenciesQuery } from "@lpg/features/config/api";
import { useSettlementsQuery, useWithdrawalsQuery } from "@lpg/features/wallet/api";
import { displayReference, findRecordById, formatStatus, getFirstRecordNumber, getFirstRecordString, recordKey, statusTone } from "@lpg/shared/api/records";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { MenuRow, PolishedEmpty, StatusChip, TransactionList } from "@lpg/shared/ui/lpgComponents";
import { ActivityListSkeleton, OrderDetailsSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import { RecordField, WorkflowHeader } from "@lpg/shared/ui/WorkflowScreen";
import { displayMoney, resolveCurrencyCode } from "@lpg/shared/utilities/display";
import { formatDateValue } from "@lpg/shared/utilities/lpgFormat";
import type { StationScreenProps } from "../../navigation/stationRoutes";

export function StationSettlementDetailsScreen(props: StationScreenProps) {
  const settlements = useSettlementsQuery();
  const settlement = findRecordById(settlements.data ?? [], props.navigation.params.settlementId) ?? settlements.data?.[0] ?? null;
  const currencyCode = getFirstRecordString(settlement, ["currency_code", "currencyCode"]);
  return <FinanceGuard props={props}>
    <QueryState loading={settlements.isLoading} error={settlements.error} skeleton={<OrderDetailsSkeleton />}>
      <WorkflowHeader title="Settlement Details" subtitle={displayReference(settlement, "Settlement record")} onBack={props.navigation.goBack} />
      {settlement ? <section className="panel-card settlement-detail-grid"><StatusChip tone={statusTone(getFirstRecordString(settlement, ["status"]))} label={formatStatus(getFirstRecordString(settlement, ["status"]))} /><RecordField label="Gross amount" value={displayMoney(getFirstRecordNumber(settlement, ["gross_amount", "grossAmount"]), currencyCode)} /><RecordField label="Platform fee" value={displayMoney(getFirstRecordNumber(settlement, ["platform_fee_amount", "platformFeeAmount"]), currencyCode)} /><RecordField label="Net settlement" value={displayMoney(getFirstRecordNumber(settlement, ["net_amount", "netAmount"]), currencyCode)} /><RecordField label="Period start" value={formatDateValue(getFirstRecordString(settlement, ["period_start", "periodStart"]) ?? "")} /><RecordField label="Period end" value={formatDateValue(getFirstRecordString(settlement, ["period_end", "periodEnd"]) ?? "")} /></section> : <PolishedEmpty icon={<ReceiptText />} title="Settlement unavailable" message="No branch settlement record was returned." />}
    </QueryState>
  </FinanceGuard>;
}

export function StationSettlementTransactionsScreen(props: StationScreenProps) {
  const settlements = useSettlementsQuery();
  const withdrawals = useWithdrawalsQuery();
  const currencies = useCurrenciesQuery();
  const currencyCode = resolveCurrencyCode(currencies.data ?? [], settlements.data?.[0] ?? withdrawals.data?.[0]);
  return <FinanceGuard props={props}>
    <QueryState loading={settlements.isLoading || withdrawals.isLoading || currencies.isLoading} error={settlements.error ?? withdrawals.error ?? currencies.error} skeleton={<ActivityListSkeleton />}>
      <WorkflowHeader title="Transactions" subtitle="Station ledger activity" onBack={props.navigation.goBack} />
      <TransactionList commissions={[]} currencyCode={currencyCode ?? "XXX"} deposits={[]} settlements={settlements.data ?? []} withdrawals={withdrawals.data ?? []} />
    </QueryState>
  </FinanceGuard>;
}

export function StationSettlementPayoutsScreen(props: StationScreenProps) {
  const withdrawals = useWithdrawalsQuery();
  return <FinanceGuard props={props}>
    <QueryState loading={withdrawals.isLoading} error={withdrawals.error} skeleton={<ActivityListSkeleton />}>
      <WorkflowHeader title="Payouts" subtitle="Withdrawal requests and transfers" onBack={props.navigation.goBack} />
      <section className="panel-card">{(withdrawals.data ?? []).map((withdrawal, index) => <MenuRow key={recordKey(withdrawal, `station-withdrawal-${index}`)} icon={<Banknote />} title={displayReference(withdrawal, "Withdrawal")} text={formatStatus(getFirstRecordString(withdrawal, ["status"]))} trailing={<strong>{displayMoney(getFirstRecordNumber(withdrawal, ["amount", "total_debit_amount"]), getFirstRecordString(withdrawal, ["currency_code", "currencyCode"]))}</strong>} />)}{(withdrawals.data ?? []).length === 0 ? <PolishedEmpty icon={<CalendarDays />} title="No payouts yet" message="Verified withdrawal requests will appear here." /> : null}</section>
    </QueryState>
  </FinanceGuard>;
}

export function StationSettlementWithdrawalScreen(props: StationScreenProps) {
  return <FinanceGuard props={props}><WithdrawalWorkflow idempotencyScope="station" onBack={props.navigation.goBack} subtitle="Withdraw available station funds" title="Station Withdrawal" /></FinanceGuard>;
}

function FinanceGuard(props: { readonly children: React.ReactNode; readonly props: StationScreenProps }) {
  return <PermissionGuard context={props.props.context} permissions={["lpg.orders.finance", "business.finance.read", "business.settlements.read"]} fallback={<section><WorkflowHeader title="Station Finance" onBack={props.props.navigation.goBack} /><PolishedEmpty icon={<WalletCards />} title="Settlement access restricted" message="Your current station role does not include finance visibility." /></section>}>{props.children}</PermissionGuard>;
}
