import { Banknote, Building2, CircleAlert, Plus } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

import { useProviderAdaptersQuery } from "@lpg/features/config/api";
import {
  useWalletBalancesQuery,
  useWithdrawalBeneficiariesQuery,
} from "@lpg/features/wallet/api";
import {
  ActionResponseSchema,
  createLpgIdempotencyKey,
  formatStatus,
  getFirstRecordNumber,
  getFirstRecordString,
  getRecordId,
  recordKey,
  type ActionResult,
} from "@lpg/shared/api/records";
import { useGatewayMutation } from "@lpg/shared/api/useGatewayMutation";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { PolishedEmpty, StatusChip } from "@lpg/shared/ui/lpgComponents";
import { WorkflowFormSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import { WorkflowForm, WorkflowHeader } from "@lpg/shared/ui/WorkflowScreen";
import { displayMoney } from "@lpg/shared/utilities/display";

export function WithdrawalWorkflow(props: {
  readonly idempotencyScope: string;
  readonly onBack: () => void;
  readonly subtitle: string;
  readonly title: string;
}) {
  const wallets = useWalletBalancesQuery();
  const beneficiaries = useWithdrawalBeneficiariesQuery();
  const providers = useProviderAdaptersQuery();
  const [beneficiaryId, setBeneficiaryId] = useState("");
  const [amount, setAmount] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [providerKey, setProviderKey] = useState("");
  const [addingAccount, setAddingAccount] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<Error | null>(null);
  const beneficiaryMutation = useGatewayMutation<ActionResult, Record<string, unknown>>({ invalidate: [["withdrawal-beneficiaries"]], path: "/runtime/withdrawal-beneficiaries", schema: ActionResponseSchema });
  const withdrawalMutation = useGatewayMutation<ActionResult, Record<string, unknown>>({ invalidate: [["withdrawals"], ["wallet-balances"]], path: "/runtime/withdrawals", schema: ActionResponseSchema });
  const wallet = wallets.data?.[0] ?? null;
  const walletId = getFirstRecordString(wallet, ["wallet_id", "walletId", "id"]);
  const currencyCode = getFirstRecordString(wallet, ["currency_code", "currencyCode"]);
  const availableBalance = getFirstRecordNumber(wallet, ["available_balance", "availableBalance", "balance"]);
  const paymentProviders = useMemo(() => (providers.data ?? []).filter((provider) => getFirstRecordString(provider, ["provider_kind", "providerKind"]) === "payment" && getFirstRecordString(provider, ["status"]) === "active"), [providers.data]);
  const activeBeneficiaries = (beneficiaries.data ?? []).filter((record) => getFirstRecordString(record, ["status"]) === "active");
  const shouldAddAccount = addingAccount || (beneficiaries.data ?? []).length === 0;

  const addBeneficiary = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);
    setNotice(null);
    try {
      if (!walletId) throw new Error("An active wallet is required.");
      if (!providerKey) throw new Error("Choose an active payment provider.");
      await beneficiaryMutation.mutateAsync({
        accountName: accountName.trim(),
        accountNumber: accountNumber.trim(),
        bankCode: bankCode.trim() || undefined,
        idempotencyKey: createLpgIdempotencyKey(`${props.idempotencyScope}-beneficiary`, walletId),
        providerAdapterKey: providerKey,
        walletId,
      });
      setAccountNumber("");
      setAddingAccount(false);
      setNotice("Withdrawal account submitted for provider verification.");
    } catch (error) {
      setLocalError(error instanceof Error ? error : new Error("The withdrawal account could not be added."));
    }
  };

  const withdraw = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);
    setNotice(null);
    try {
      const parsedAmount = Number(amount);
      if (!walletId) throw new Error("An active wallet is required.");
      if (!beneficiaryId) throw new Error("Choose a verified withdrawal account.");
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) throw new Error("Enter a valid withdrawal amount.");
      if (availableBalance !== null && parsedAmount > availableBalance) throw new Error("The withdrawal amount exceeds the available balance.");
      await withdrawalMutation.mutateAsync({
        amount: parsedAmount,
        beneficiaryId,
        idempotencyKey: createLpgIdempotencyKey(`${props.idempotencyScope}-withdrawal`, walletId),
        walletId,
      });
      setAmount("");
      setNotice("Withdrawal request submitted.");
    } catch (error) {
      setLocalError(error instanceof Error ? error : new Error("The withdrawal request could not be submitted."));
    }
  };

  const loading = wallets.isLoading || beneficiaries.isLoading || providers.isLoading;
  const error = wallets.error ?? beneficiaries.error ?? providers.error;
  return <QueryState loading={loading} error={error} skeleton={<WorkflowFormSkeleton />}>
    <WorkflowHeader title={props.title} subtitle={props.subtitle} onBack={props.onBack} />
    <section className="withdrawal-balance"><Banknote aria-hidden="true" /><div><span>Available balance</span><strong>{displayMoney(availableBalance, currencyCode)}</strong></div></section>
    {notice ? <p className="form-message is-success">{notice}</p> : null}
    {shouldAddAccount ? <>
      {paymentProviders.length === 0 ? <PolishedEmpty icon={<CircleAlert />} title="Payment provider unavailable" message="No active payment adapter was returned by the backend." /> : <WorkflowForm error={localError ?? beneficiaryMutation.error} isPending={beneficiaryMutation.isPending} onSubmit={(event) => void addBeneficiary(event)} submitLabel="Add Withdrawal Account">
        <label>Account name<input value={accountName} onChange={(event) => setAccountName(event.currentTarget.value)} required /></label>
        <label>Account number<input value={accountNumber} onChange={(event) => setAccountNumber(event.currentTarget.value)} inputMode="numeric" autoComplete="off" required /></label>
        <label>Bank code<input value={bankCode} onChange={(event) => setBankCode(event.currentTarget.value)} /></label>
        <label>Payment provider<select value={providerKey} onChange={(event) => setProviderKey(event.currentTarget.value)} required><option value="">Choose provider</option>{paymentProviders.map((provider) => { const key = getFirstRecordString(provider, ["key"]) ?? ""; return <option key={key} value={key}>{getFirstRecordString(provider, ["display_name", "displayName"]) ?? key}</option>; })}</select></label>
      </WorkflowForm>}
    </> : activeBeneficiaries.length > 0 ? <WorkflowForm error={localError ?? withdrawalMutation.error} isPending={withdrawalMutation.isPending} onSubmit={(event) => void withdraw(event)} submitLabel="Request Withdrawal">
      <label>Destination<select value={beneficiaryId} onChange={(event) => setBeneficiaryId(event.currentTarget.value)} required><option value="">Choose account</option>{activeBeneficiaries.map((record, index) => <option key={recordKey(record, `beneficiary-${index}`)} value={getRecordId(record) ?? ""}>{getFirstRecordString(record, ["account_name", "accountName"]) ?? "Bank account"} ending {getFirstRecordString(record, ["account_number_last4", "accountNumberLast4"]) ?? ""}</option>)}</select></label>
      <label>Amount<input type="number" min="1" max={availableBalance ?? undefined} step="0.01" value={amount} onChange={(event) => setAmount(event.currentTarget.value)} required /></label>
      <p className="action-copy"><Building2 aria-hidden="true" />Funds are reserved by the backend before provider transfer.</p>
      <button type="button" className="text-button" onClick={() => setAddingAccount(true)}><Plus aria-hidden="true" />Add another account</button>
    </WorkflowForm> : <section className="panel-card"><CircleAlert aria-hidden="true" /><h2>Account verification pending</h2>{(beneficiaries.data ?? []).map((record, index) => <div className="beneficiary-status-row" key={recordKey(record, `pending-beneficiary-${index}`)}><span>{getFirstRecordString(record, ["account_name", "accountName"]) ?? "Withdrawal account"}</span><StatusChip tone="warning" label={formatStatus(getFirstRecordString(record, ["status"]))} /></div>)}<button type="button" className="secondary-button" onClick={() => setAddingAccount(true)}><Plus aria-hidden="true" />Add Another Account</button></section>}
  </QueryState>;
}
