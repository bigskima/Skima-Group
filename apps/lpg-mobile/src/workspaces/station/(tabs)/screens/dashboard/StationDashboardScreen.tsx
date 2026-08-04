import { ClipboardList, Truck, WalletCards } from "lucide-react";

import { useCurrenciesQuery, useLpgConfigQuery } from "@lpg/features/config/api";
import { useJobsQuery } from "@lpg/features/orders/api";
import { useStationsQuery } from "@lpg/features/stations/api";
import { useSettlementsQuery } from "@lpg/features/wallet/api";
import { canReadStationFinance, formatStatus, getFirstRecordNumber, getFirstRecordString, getStatus } from "@lpg/shared/api/records";
import { BrandLockup, MetricCard, SectionHeader, StatusChip, TodaySummary } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { displayMoney, resolveCurrencyCode } from "@lpg/shared/utilities/display";
import { pricingAmount } from "@lpg/shared/utilities/lpgFormat";
import type { StationScreenProps } from "../../navigation/stationRoutes";

export function StationDashboardScreen(props: StationScreenProps) {
  const stations = useStationsQuery();
  const jobs = useJobsQuery("station");
  const config = useLpgConfigQuery();
  const currencies = useCurrenciesQuery();
  const canReadFinance = canReadStationFinance(props.context);
  const settlements = useSettlementsQuery(canReadFinance);
  const station = stations.data?.[0];
  const currencyCode = resolveCurrencyCode(currencies.data ?? [], settlements.data?.[0]);
  const settlementTotal = (settlements.data ?? []).reduce((total, item) => total + (getFirstRecordNumber(item, ["net_amount", "gross_amount"]) ?? 0), 0);
  const atStation = (jobs.data ?? []).filter((job) => getStatus(job, "").includes("station")).length;

  return (
    <QueryState loading={stations.isLoading || jobs.isLoading || config.isLoading} error={stations.error ?? jobs.error ?? config.error}>
      <BrandLockup badge="STATION" />
      <section className="station-title-card">
        <div>
          <h1>{getFirstRecordString(station, ["display_name", "displayName"]) ?? "Station workspace"}</h1>
          <p>{getFirstRecordString(station, ["formatted_address", "formattedAddress"]) ?? "Branch address unavailable"}</p>
          <StatusChip tone={getStatus(station, "pending") === "active" ? "success" : "warning"} label={formatStatus(getFirstRecordString(station, ["availability_status", "status"]) ?? "pending")} />
        </div>
      </section>
      <div className="metric-grid">
        <MetricCard icon={<ClipboardList />} value={String(jobs.data?.length ?? 0)} label="Incoming Jobs" />
        <MetricCard icon={<Truck />} value={String(atStation)} label="Drivers At Station" />
        {canReadFinance ? <MetricCard icon={<WalletCards />} value={displayMoney(settlementTotal, currencyCode)} label="Visible Settlements" /> : null}
        <MetricCard icon={<WalletCards />} value={pricingAmount(config.data, currencyCode ?? "")} label="Current Price" />
      </div>
      <SectionHeader title="Incoming Refill Jobs" action="View all" onAction={() => props.navigation.replace("jobs")} />
      <TodaySummary currencyCode={currencyCode ?? "XXX"} jobs={jobs.data ?? []} settlements={canReadFinance ? settlements.data ?? [] : []} />
    </QueryState>
  );
}
