import { ClipboardList, CreditCard, Headphones, MapPin, QrCode } from "lucide-react";

import { useCurrenciesQuery } from "@lpg/features/config/api";
import { useWalletBalancesQuery } from "@lpg/features/wallet/api";
import { ProfileCard, QuickLinks, WalletMiniPanel } from "@lpg/shared/ui/lpgComponents";
import { resolveCurrencyCode } from "@lpg/shared/utilities/display";
import { walletTotal } from "@lpg/shared/utilities/lpgFormat";
import type { CustomerScreenProps } from "../../navigation/customerRoutes";

export function CustomerAccountScreen(props: CustomerScreenProps) {
  const wallets = useWalletBalancesQuery();
  const currencies = useCurrenciesQuery();
  const currencyCode = resolveCurrencyCode(currencies.data ?? [], wallets.data?.[0]);

  return (
    <>
      <ProfileCard context={props.context} />
      <WalletMiniPanel
        balance={walletTotal(wallets.data ?? [], currencyCode ?? "")}
        currencyCode={currencyCode ?? "XXX"}
        onWallet={() => props.navigation.replace("wallet")}
        onWithdraw={() => props.navigation.navigate("wallet-top-up")}
      />
      <QuickLinks links={[
        ["My Orders", <ClipboardList aria-hidden="true" />, () => props.navigation.replace("orders")],
        ["My Cylinders", <QrCode aria-hidden="true" />, () => props.navigation.replace("cylinders")],
        ["Payment Methods", <CreditCard aria-hidden="true" />, () => props.navigation.navigate("payment-methods")],
        ["Addresses", <MapPin aria-hidden="true" />, () => props.navigation.navigate("account-addresses")],
        ["Support", <Headphones aria-hidden="true" />, () => props.navigation.navigate("account-support")],
      ]} />
      <button type="button" className="primary-button" onClick={() => props.navigation.navigate("partner-routes")}>
        Partner With Skima
      </button>
    </>
  );
}
