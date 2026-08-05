import { Banknote, ReceiptText } from "lucide-react";

import { useCommissionsQuery, useWithdrawalsQuery } from "@lpg/features/wallet/api";
import { WithdrawalWorkflow } from "@lpg/features/wallet/WithdrawalWorkflow";
import { displayReference, formatStatus, getFirstRecordNumber, getFirstRecordString, recordKey } from "@lpg/shared/api/records";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { MenuRow } from "@lpg/shared/ui/lpgComponents";
import { ActivityListSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import { WorkflowHeader } from "@lpg/shared/ui/WorkflowScreen";
import { displayMoney } from "@lpg/shared/utilities/display";
import type { DriverScreenProps } from "../../navigation/driverRoutes";

export function DriverEarningsTransactionsScreen(props: DriverScreenProps) {
  const commissions = useCommissionsQuery();
  const withdrawals = useWithdrawalsQuery();
  const records = [...(commissions.data ?? []).map((record) => ({ ...record, recordKind: "commission" })), ...(withdrawals.data ?? []).map((record) => ({ ...record, recordKind: "withdrawal" }))].sort((left, right) => (getFirstRecordString(right, ["created_at", "createdAt"]) ?? "").localeCompare(getFirstRecordString(left, ["created_at", "createdAt"]) ?? ""));
  return <QueryState loading={commissions.isLoading || withdrawals.isLoading} error={commissions.error ?? withdrawals.error} skeleton={<ActivityListSkeleton />}>
    <WorkflowHeader title="Earnings Transactions" subtitle="Commission and withdrawal records" onBack={props.navigation.goBack} />
    <section className="panel-card">{records.map((record, index) => <MenuRow key={recordKey(record, `earning-${index}`)} icon={record.recordKind === "commission" ? <ReceiptText /> : <Banknote />} title={record.recordKind === "commission" ? "Driver commission" : displayReference(record, "Withdrawal")} text={formatStatus(getFirstRecordString(record, ["status"]))} trailing={<strong>{getFirstRecordNumber(record, ["net_amount", "amount", "commission_amount"]) !== null ? displayMoney(getFirstRecordNumber(record, ["net_amount", "amount", "commission_amount"]), getFirstRecordString(record, ["currency_code", "currencyCode"])) : "Pending"}</strong>} />)}</section>
  </QueryState>;
}

export function DriverWithdrawalScreen(props: DriverScreenProps) {
  return <WithdrawalWorkflow idempotencyScope="driver" onBack={props.navigation.goBack} subtitle="Send available wallet funds" title="Withdraw Earnings" />;
}
