import { Bell, ClipboardList, Headphones, MapPin, Plus, QrCode, ShieldCheck, WalletCards } from "lucide-react";

import { useCurrenciesQuery } from "@lpg/features/config/api";
import { useCylindersQuery } from "@lpg/features/cylinders/api";
import { useMessagesQuery } from "@lpg/features/notifications/api";
import { useActiveOrdersQuery, useQuotesQuery } from "@lpg/features/orders/api";
import { useLocationsQuery } from "@lpg/features/profiles/api";
import { useWalletBalancesQuery } from "@lpg/features/wallet/api";
import { firstMediaAssetId, RuntimeMediaImage } from "@lpg/features/media/RuntimeMediaImage";
import {
  displayReference,
  getFirstRecordNumber,
  getRecordString,
  getStatus,
  isTerminalStatus,
  recordKey,
} from "@lpg/shared/api/records";
import {
  ActiveOrderCard,
  BrandLockup,
  EmptyMiniCard,
  HorizontalCards,
  IconBubble,
  MiniCylinderCard,
  SectionHeader,
} from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { displayMoney, resolveCurrencyCode } from "@lpg/shared/utilities/display";
import { formatCylinderTitle, walletTotal } from "@lpg/shared/utilities/lpgFormat";
import { resolveProfileName } from "@lpg/features/permissions/workspaceAccess";
import type { CustomerScreenProps } from "../../navigation/customerRoutes";

export function CustomerHomeScreen(props: CustomerScreenProps) {
  const cylinders = useCylindersQuery();
  const orders = useActiveOrdersQuery();
  const quotes = useQuotesQuery();
  const locations = useLocationsQuery();
  const wallets = useWalletBalancesQuery();
  const messages = useMessagesQuery();
  const currencies = useCurrenciesQuery();
  const primaryCylinder = cylinders.data?.[0] ?? null;
  const activeOrder = orders.data?.[0] ?? null;
  const latestQuote = quotes.data?.[0] ?? null;
  const currencyCode = resolveCurrencyCode(currencies.data ?? [], activeOrder ?? latestQuote);
  const amount = getFirstRecordNumber(activeOrder ?? latestQuote, ["total_amount", "totalAmount"]);
  const error = cylinders.error ?? orders.error ?? locations.error ?? wallets.error ?? currencies.error;
  const loading = cylinders.isLoading || orders.isLoading || locations.isLoading || wallets.isLoading || currencies.isLoading;

  return (
    <QueryState loading={loading} error={error} onRetry={() => void Promise.all([
      cylinders.refetch(), orders.refetch(), locations.refetch(), wallets.refetch(), currencies.refetch(),
    ])}>
      <header className="page-title">
        <BrandLockup badge="LPG" />
        <div className="header-actions">
          <IconBubble
            label="Notifications"
            badge={String((messages.data ?? []).filter((item) => !isTerminalStatus(getStatus(item, "queued"))).length || "") || undefined}
          ><Bell aria-hidden="true" /></IconBubble>
          <IconBubble label="Support"><Headphones aria-hidden="true" /></IconBubble>
        </div>
      </header>
      <section className="greeting">
        <h1>Hello, {resolveProfileName(props.context)}</h1>
        <p>How can we help you today?</p>
      </section>
      <button type="button" className="address-pill" onClick={() => props.navigation.navigate("account-addresses")}>
        <MapPin aria-hidden="true" />
        <span>Delivering to<strong>{getRecordString(locations.data?.[0], "label") ?? "Add delivery address"}</strong></span>
      </button>
      <section className="hero-refill-card">
        <div>
          <span>Refill a cylinder</span>
          <h2>{formatCylinderTitle(primaryCylinder)}</h2>
          <p>{primaryCylinder ? "Your registered cylinder is ready for a backend quote." : "Register a cylinder to begin."}</p>
          <strong>{displayMoney(amount, currencyCode)}</strong>
          <button
            type="button"
            className="primary-button"
            onClick={() => props.navigation.navigate(primaryCylinder ? "order-new" : "cylinder-register")}
          >
            {primaryCylinder ? "Refill Now" : "Register Cylinder"}
          </button>
        </div>
        <RuntimeMediaImage alt={formatCylinderTitle(primaryCylinder)} assetId={firstMediaAssetId(primaryCylinder)} />
      </section>
      <ActiveOrderCard order={activeOrder} onOpenOrders={() => props.navigation.navigate("order-details", {
        orderId: getRecordString(activeOrder, "id") ?? "",
      })} />
      <section className="quick-actions" aria-label="Quick actions">
        <button type="button" onClick={() => props.navigation.navigate("order-new")}><span><ClipboardList /></span><strong>Refill Cylinder</strong></button>
        <button type="button" onClick={() => props.navigation.navigate("cylinder-register")}><span><Plus /></span><strong>Register Cylinder</strong></button>
        <button type="button" onClick={() => props.navigation.navigate("wallet-top-up")}><span><WalletCards /></span><strong>Top Up Wallet</strong></button>
        <button type="button" onClick={() => props.navigation.navigate("account-support")}><span><ShieldCheck /></span><strong>Safety & Support</strong></button>
      </section>
      <SectionHeader title="My Cylinders" action="View all" onAction={() => props.navigation.replace("cylinders")} />
      <HorizontalCards>
        {(cylinders.data ?? []).slice(0, 2).map((cylinder, index) => (
          <MiniCylinderCard
            key={recordKey(cylinder, `home-cylinder-${index}`)}
            cylinder={cylinder}
            media={<RuntimeMediaImage alt={formatCylinderTitle(cylinder)} assetId={firstMediaAssetId(cylinder)} />}
          />
        ))}
        {(cylinders.data ?? []).length === 0 ? <EmptyMiniCard title="No cylinder yet" /> : null}
      </HorizontalCards>
      <section className="two-column">
        <article className="summary-card"><span>Wallet Balance</span><strong>{displayMoney(walletTotal(wallets.data ?? [], currencyCode ?? ""), currencyCode)}</strong></article>
        <article className="summary-card"><span>Recent Refill</span><strong>{activeOrder ? displayReference(activeOrder) : "No refill yet"}</strong></article>
      </section>
    </QueryState>
  );
}
