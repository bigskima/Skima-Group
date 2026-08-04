import { CreditCard, ExternalLink, WalletCards } from "lucide-react";
import { type FormEvent, useState } from "react";

import { useCurrenciesQuery, useProviderAdaptersQuery } from "@lpg/features/config/api";
import { useDepositsQuery, useWalletBalancesQuery } from "@lpg/features/wallet/api";
import { ActionResponseSchema, createLpgIdempotencyKey, getActionResultId, getFirstRecordString, type ActionResult } from "@lpg/shared/api/records";
import { useGatewayMutation } from "@lpg/shared/api/useGatewayMutation";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { WorkflowForm, WorkflowHeader } from "@lpg/shared/ui/WorkflowScreen";
import { resolveCurrencyCode } from "@lpg/shared/utilities/display";
import type { CustomerScreenProps } from "../../navigation/customerRoutes";

export function TopUpScreen(props: CustomerScreenProps) {
  const wallets = useWalletBalancesQuery();
  const deposits = useDepositsQuery();
  const currencies = useCurrenciesQuery();
  const providers = useProviderAdaptersQuery();
  const [amount, setAmount] = useState("");
  const [providerKey, setProviderKey] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<Error | null>(null);
  const currencyCode = resolveCurrencyCode(currencies.data ?? [], wallets.data?.[0]);
  const paymentProviders = (providers.data ?? []).filter((provider) =>
    getFirstRecordString(provider, ["provider_kind", "providerKind"]) === "payment" &&
    getFirstRecordString(provider, ["status"]) === "active"
  );
  const mutation = useGatewayMutation<ActionResult, Record<string, unknown>>({
    invalidate: [["deposits"], ["wallet-balances"]],
    path: "/runtime/payments/deposits",
    schema: ActionResponseSchema,
  });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);
    setNotice(null);
    try {
      const parsedAmount = Number(amount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) throw new Error("Enter a valid top-up amount.");
      if (!currencyCode) throw new Error("No active currency is available for this wallet.");
      const walletId = getFirstRecordString(wallets.data?.[0], ["wallet_id", "walletId"]);
      const result = await mutation.mutateAsync({
        amount: parsedAmount,
        currencyCode,
        idempotencyKey: createLpgIdempotencyKey("wallet-top-up", walletId),
        providerAdapterKey: providerKey || undefined,
        source: "skima.lpg.mobile",
        walletId: walletId || undefined,
      });
      const depositId = getActionResultId(result);
      const refreshed = await deposits.refetch();
      const deposit = (refreshed.data ?? []).find((record) => getFirstRecordString(record, ["id"]) === depositId);
      const checkoutUrl = getFirstRecordString(deposit, ["checkout_url", "checkoutUrl"]);
      if (checkoutUrl) {
        window.location.assign(checkoutUrl);
        return;
      }
      setNotice("Top-up request created. Its provider status will update in your transactions.");
    } catch (error) {
      setLocalError(error instanceof Error ? error : new Error("The top-up request could not be created."));
    }
  };

  return (
    <QueryState loading={wallets.isLoading || currencies.isLoading || providers.isLoading} error={wallets.error ?? currencies.error ?? providers.error}>
      <WorkflowHeader title="Top Up" subtitle="Fund your Skima wallet" onBack={props.navigation.goBack} />
      <section className="upload-hero"><WalletCards aria-hidden="true" /><strong>{currencyCode ?? "Wallet funding"}</strong></section>
      <WorkflowForm error={localError ?? mutation.error} isPending={mutation.isPending} notice={notice} onSubmit={(event) => void submit(event)} submitLabel="Continue To Payment">
        <label>Amount<input type="number" inputMode="decimal" min="1" step="0.01" value={amount} onChange={(event) => setAmount(event.currentTarget.value)} required /></label>
        <label>
          Payment provider
          <select value={providerKey} onChange={(event) => setProviderKey(event.currentTarget.value)}>
            <option value="">Backend default</option>
            {paymentProviders.map((provider) => {
              const key = getFirstRecordString(provider, ["key"]) ?? "";
              return <option key={key} value={key}>{getFirstRecordString(provider, ["display_name", "displayName"]) ?? key}</option>;
            })}
          </select>
        </label>
        <p className="action-copy"><CreditCard aria-hidden="true" />Payment details are collected by the configured provider.</p>
        <span className="visually-hidden"><ExternalLink aria-hidden="true" /></span>
      </WorkflowForm>
    </QueryState>
  );
}
