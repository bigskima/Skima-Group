import { ClipboardList, ShieldCheck, Star, Truck, WalletCards } from "lucide-react";

import { useCurrenciesQuery } from "@lpg/features/config/api";
import { useDriversQuery, useVehiclesQuery } from "@lpg/features/drivers/api";
import { firstLinkedMediaAssetId, useEntityMediaLinksQuery } from "@lpg/features/media/api";
import { RuntimeMediaImage } from "@lpg/features/media/RuntimeMediaImage";
import { useJobsQuery } from "@lpg/features/orders/api";
import { resolveProfileName } from "@lpg/features/permissions/workspaceAccess";
import { useCommissionsQuery, useWalletBalancesQuery } from "@lpg/features/wallet/api";
import { formatStatus, getFirstRecordNumber, getFirstRecordString, getRecordId, getStatus } from "@lpg/shared/api/records";
import { MetricCard, SectionHeader, StatusChip } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { DriverJobsSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import { displayMoney, resolveCurrencyCode } from "@lpg/shared/utilities/display";
import { walletTotal } from "@lpg/shared/utilities/lpgFormat";
import type { DriverScreenProps } from "../../navigation/driverRoutes";

export function DriverHomeScreen(props: DriverScreenProps) {
  const drivers = useDriversQuery();
  const vehicles = useVehiclesQuery();
  const jobs = useJobsQuery("driver");
  const wallets = useWalletBalancesQuery();
  const commissions = useCommissionsQuery();
  const currencies = useCurrenciesQuery();
  const driver = drivers.data?.find((item) => item.user_id === props.context.user.id) ?? drivers.data?.[0];
  const vehicle = vehicles.data?.[0];
  const mediaLinks = useEntityMediaLinksQuery("driver", getRecordId(driver));
  const driverPhotoId = firstLinkedMediaAssetId(mediaLinks.data, "profile.photo");
  const currencyCode = resolveCurrencyCode(currencies.data ?? [], wallets.data?.[0] ?? commissions.data?.[0]);
  const earned = (commissions.data ?? []).reduce((total, item) => total + (getFirstRecordNumber(item, ["amount", "net_amount"]) ?? 0), 0);
  const status = getStatus(driver, "pending");

  return (
    <QueryState
      loading={drivers.isLoading || vehicles.isLoading || jobs.isLoading || wallets.isLoading || commissions.isLoading || currencies.isLoading || mediaLinks.isLoading}
      error={drivers.error ?? vehicles.error ?? jobs.error ?? wallets.error ?? commissions.error ?? currencies.error ?? mediaLinks.error}
      skeleton={<DriverJobsSkeleton />}
    >
      <section className="driver-hero">
        <div className="avatar-large"><RuntimeMediaImage assetId={driverPhotoId} alt="Driver profile" fallback={<span>{resolveProfileName(props.context).slice(0, 2).toUpperCase()}</span>} /></div>
        <div>
          <span>Welcome back</span>
          <h1>{resolveProfileName(props.context)}</h1>
          <StatusChip tone={status === "approved" ? "success" : "warning"} label={formatStatus(status)} />
          <p><Truck aria-hidden="true" /> {vehicle ? [vehicle.manufacturer, vehicle.model, vehicle.registration_number].filter(Boolean).join(" ") : "No active vehicle returned"}</p>
        </div>
        <button type="button" className="online-toggle" onClick={() => props.navigation.navigate("availability")}>
          {formatStatus(getFirstRecordString(driver, ["operational_status"]) ?? "offline")}
        </button>
      </section>
      <section className="earnings-hero">
        <div><span>Recorded Earnings</span><strong>{displayMoney(earned, currencyCode)}</strong></div>
        <div><span>Wallet Balance</span><strong>{displayMoney(walletTotal(wallets.data ?? [], currencyCode ?? ""), currencyCode)}</strong></div>
      </section>
      <section className="availability-card">
        <ShieldCheck aria-hidden="true" />
        <div><h2>{formatStatus(getFirstRecordString(driver, ["operational_status"]) ?? "offline")}</h2><p>Dispatch eligibility is controlled by your approved profile, vehicle, capabilities, and location.</p></div>
      </section>
      <SectionHeader title="Available Jobs" action="View all" onAction={() => props.navigation.replace("jobs")} />
      <div className="metric-grid">
        <MetricCard icon={<ClipboardList />} value={String(jobs.data?.length ?? 0)} label="Visible Jobs" />
        <MetricCard icon={<WalletCards />} value={displayMoney(earned, currencyCode)} label="Commission" />
        <MetricCard icon={<Star />} value="Backend" label="Rating" />
      </div>
    </QueryState>
  );
}
