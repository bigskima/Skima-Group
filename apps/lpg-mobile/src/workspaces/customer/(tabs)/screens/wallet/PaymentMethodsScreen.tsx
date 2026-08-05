import { CreditCard, Landmark, WalletCards } from "lucide-react";

import { useProviderAdaptersQuery } from "@lpg/features/config/api";
import { useWithdrawalBeneficiariesQuery } from "@lpg/features/wallet/api";
import { formatStatus, getFirstRecordString, recordKey, statusTone } from "@lpg/shared/api/records";
import { MenuRow, PolishedEmpty, StatusChip } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { WalletSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import { WorkflowHeader } from "@lpg/shared/ui/WorkflowScreen";
import type { CustomerScreenProps } from "../../navigation/customerRoutes";

export function PaymentMethodsScreen(props: CustomerScreenProps) {
  const providers = useProviderAdaptersQuery();
  const beneficiaries = useWithdrawalBeneficiariesQuery();
  const paymentProviders = (providers.data ?? []).filter((provider) => getFirstRecordString(provider, ["provider_kind", "providerKind"]) === "payment" && getFirstRecordString(provider, ["status"]) === "active");

  return (
    <QueryState loading={providers.isLoading || beneficiaries.isLoading} error={providers.error ?? beneficiaries.error} skeleton={<WalletSkeleton />}>
      <WorkflowHeader title="Payment Methods" subtitle="Backend-configured funding and payout channels" onBack={props.navigation.goBack} />
      <section className="record-list-section">
        <h2>Funding Providers</h2>
        {paymentProviders.map((provider, index) => <MenuRow key={recordKey(provider, `payment-provider-${index}`)} icon={<CreditCard />} title={getFirstRecordString(provider, ["display_name", "displayName"]) ?? "Payment provider"} text={formatStatus(getFirstRecordString(provider, ["status"]))} />)}
        {paymentProviders.length === 0 ? <PolishedEmpty icon={<WalletCards />} title="No funding provider" message="A platform administrator must activate a payment adapter." /> : null}
      </section>
      <section className="record-list-section">
        <h2>Withdrawal Accounts</h2>
        {(beneficiaries.data ?? []).map((beneficiary, index) => {
          const status = getFirstRecordString(beneficiary, ["status"]) ?? "pending";
          return <article key={recordKey(beneficiary, `beneficiary-${index}`)} className="menu-row"><Landmark aria-hidden="true" /><div><strong>{getFirstRecordString(beneficiary, ["account_name", "accountName"]) ?? "Bank account"}</strong><small>Ending {getFirstRecordString(beneficiary, ["account_number_last4", "accountNumberLast4"]) ?? "unavailable"}</small></div><StatusChip tone={statusTone(status)} label={formatStatus(status)} /></article>;
        })}
      </section>
    </QueryState>
  );
}
