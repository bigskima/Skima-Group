import { CheckCircle2, ClipboardList, Gauge, Truck, WalletCards } from "lucide-react";

import { useCurrenciesQuery } from "@lpg/features/config/api";
import { useJobsQuery } from "@lpg/features/orders/api";
import { useStationRuntimeQuery } from "@lpg/features/stations/api";
import { useSettlementsQuery } from "@lpg/features/wallet/api";
import { canReadStationFinance, displayReference, formatStatus, getFirstRecordNumber, getFirstRecordString, getRecordArray, getRecordId, getRecordObject, getStatus, recordKey } from "@lpg/shared/api/records";
import { BrandLockup, MenuRow, MetricCard, PolishedEmpty, SectionHeader, StatusChip } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { StationDashboardSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import { displayMoney, resolveCurrencyCode } from "@lpg/shared/utilities/display";
import type { StationScreenProps } from "../../navigation/stationRoutes";

export function StationDashboardScreen(props: StationScreenProps) {
  const runtime = useStationRuntimeQuery();
  const jobs = useJobsQuery("station");
  const currencies = useCurrenciesQuery();
  const canReadFinance = canReadStationFinance(props.context);
  const settlements = useSettlementsQuery(canReadFinance);
  const station = getRecordObject(runtime.data, "branch");
  const summary = getRecordObject(runtime.data, "summary");
  const pricing = getRecordArray(runtime.data, "pricing")[0] ?? null;
  const currencyCode = resolveCurrencyCode(currencies.data ?? [], settlements.data?.[0]);
  const settlementTotal = (settlements.data ?? []).reduce((total, item) => total + (getFirstRecordNumber(item, ["net_amount", "gross_amount"]) ?? 0), 0);
  const activeJobs = getFirstRecordNumber(summary, ["activeJobs"]) ?? jobs.data?.length ?? 0;
  const atStation = getFirstRecordNumber(summary, ["atStationJobs"]) ?? (jobs.data ?? []).filter((job) => getStatus(job, "").includes("station")).length;
  const completedJobs = getFirstRecordNumber(summary, ["completedJobs"]) ?? 0;
  const totalRefilledKg = getFirstRecordNumber(summary, ["totalRefilledKg"]);

  return (
    <QueryState loading={runtime.isLoading || jobs.isLoading || currencies.isLoading || settlements.isLoading} error={runtime.error ?? jobs.error ?? currencies.error ?? settlements.error} skeleton={<StationDashboardSkeleton />}>
      <BrandLockup badge="STATION" />
      <section className="station-title-card">
        <div>
          <h1>{getFirstRecordString(station, ["display_name", "displayName"]) ?? "Station workspace"}</h1>
          <p>{getFirstRecordString(station, ["formattedAddress"]) ?? "Branch address unavailable"}</p>
          <StatusChip tone={getFirstRecordString(station, ["availabilityStatus"]) === "available" ? "success" : "warning"} label={formatStatus(getFirstRecordString(station, ["availabilityStatus"]) ?? "pending")} />
        </div>
      </section>
      <div className="metric-grid">
        <MetricCard icon={<ClipboardList />} value={String(activeJobs)} label="Incoming Jobs" />
        <MetricCard icon={<Truck />} value={String(atStation)} label="Drivers At Station" />
        {canReadFinance ? <MetricCard icon={<WalletCards />} value={displayMoney(settlementTotal, currencyCode)} label="Visible Settlements" /> : null}
        <MetricCard icon={<Gauge />} value={getFirstRecordNumber(pricing, ["pricePerKg"]) !== null ? `${displayMoney(getFirstRecordNumber(pricing, ["pricePerKg"]), getFirstRecordString(pricing, ["currencyCode"]) ?? currencyCode)}/kg` : "Backend configured"} label="Current Price" />
      </div>
      <SectionHeader title="Incoming Refill Jobs" action="View all" onAction={() => props.navigation.replace("jobs")} />
      <section className="panel-card station-dashboard-jobs">{(jobs.data ?? []).slice(0, 3).map((job, index) => <button type="button" className="unstyled-record-button" key={recordKey(job, `dashboard-job-${index}`)} onClick={() => props.navigation.navigate("job-details", { jobId: getRecordId(job) ?? "" })}><MenuRow icon={<Truck />} title={displayReference(job, "Station job")} text={`${getFirstRecordNumber(job, ["requestedKg"]) ?? "Pending"} kg - ${formatStatus(getStatus(job))}`} /></button>)}{(jobs.data ?? []).length === 0 ? <PolishedEmpty icon={<ClipboardList />} title="No incoming jobs" message="Paid and dispatched branch work will appear here." /> : null}</section>
      <section className="today-summary"><SectionHeader title="Branch Summary" /><div className="metric-grid"><MetricCard icon={<CheckCircle2 />} value={String(completedJobs)} label="Completed Jobs" /><MetricCard icon={<Gauge />} value={totalRefilledKg === null ? "Not available" : `${totalRefilledKg} kg`} label="Total Refilled" />{canReadFinance ? <MetricCard icon={<WalletCards />} value={displayMoney(settlementTotal, currencyCode)} label="Total Settled" /> : null}</div></section>
    </QueryState>
  );
}
