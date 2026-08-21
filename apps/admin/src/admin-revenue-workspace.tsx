import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCcw, RotateCcw, TrendingUp, WalletCards } from "lucide-react";
import { useMemo, useState } from "react";

import {
  Button,
  DataTable,
  ErrorState,
  LoadingState,
  MetricTile,
  PageHeader,
  StatusBadge,
  type TableColumn,
} from "@skima/ui";

import { useSessionState } from "./session";

type PlatformRecord = Readonly<Record<string, unknown>>;

type RevenueSummary = {
  readonly currencyCode: string;
  readonly from: string | null;
  readonly until: string | null;
  readonly netRevenue: number;
  readonly grossCredits: number;
  readonly reversalsAndDebits: number;
  readonly entryCount: number;
  readonly byStream: readonly PlatformRecord[];
  readonly byComponent: readonly PlatformRecord[];
};

const activityColumns: readonly TableColumn<PlatformRecord>[] = [
  {
    key: "createdAt",
    header: "Time",
    render: (record) => formatDate(recordString(record, "createdAt")),
  },
  {
    key: "revenueStream",
    header: "Revenue stream",
    render: (record) => label(recordString(record, "revenueStream")),
  },
  {
    key: "revenueComponent",
    header: "Component",
    render: (record) => label(recordString(record, "revenueComponent")),
  },
  {
    key: "direction",
    header: "Direction",
    render: (record) => {
      const direction = recordString(record, "direction") ?? "unknown";
      return <StatusBadge tone={direction === "credit" ? "success" : "warning"}>{label(direction)}</StatusBadge>;
    },
  },
  {
    key: "amount",
    header: "Amount",
    render: (record) => money(recordNumber(record, "amount"), recordString(record, "currencyCode") ?? "NGN"),
  },
  {
    key: "transactionType",
    header: "Transaction",
    render: (record) => label(recordString(record, "transactionType")),
  },
  {
    key: "source",
    header: "Source",
    render: (record) => recordString(record, "source") ?? "—",
  },
];

export function AdminRevenueWorkspace(props: { readonly onOpenFinance: () => void }) {
  const { context, status, supabase } = useSessionState();
  const queryClient = useQueryClient();
  const [windowDays, setWindowDays] = useState(30);

  const canReadRevenue = context?.platformAdmin?.admin_kind === "super_admin" ||
    context?.permissions.includes("platform.revenue.read") ||
    context?.permissions.includes("platform.revenue.manage") ||
    false;

  const range = useMemo(() => {
    const until = new Date();
    const from = new Date(until.getTime() - windowDays * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), until: until.toISOString() };
  }, [windowDays]);

  const summary = useQuery({
    queryKey: ["admin-revenue", "summary", windowDays],
    enabled: status === "authenticated" && canReadRevenue,
    queryFn: async (): Promise<RevenueSummary> => {
      const result = await supabase.rpc("platform_revenue_summary", {
        target_currency_code: "NGN",
        target_from: range.from,
        target_until: range.until,
      });
      if (result.error) throw result.error;
      return normalizeSummary(result.data);
    },
  });

  const activity = useQuery({
    queryKey: ["admin-revenue", "activity", windowDays],
    enabled: status === "authenticated" && canReadRevenue,
    queryFn: async (): Promise<readonly PlatformRecord[]> => {
      const result = await supabase.rpc("platform_revenue_activity", {
        target_currency_code: "NGN",
        target_from: range.from,
        target_until: range.until,
        target_limit: 250,
      });
      if (result.error) throw result.error;
      return Array.isArray(result.data)
        ? result.data.filter((item): item is PlatformRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
        : [];
    },
  });

  if (!canReadRevenue) {
    return (
      <ErrorState
        title="Revenue access restricted"
        message="SKIMA Revenue is available only to authorized Finance Admin and Super Admin accounts."
      />
    );
  }

  const current = summary.data ?? emptySummary();

  return (
    <>
      <PageHeader
        eyebrow="Company money"
        title="Money & Revenue"
        description="Monitor SKIMA's own earned revenue separately from customer balances, station earnings, driver earnings, escrow, provider clearing, and liabilities. Values shown here come directly from the protected ledger-backed Revenue account."
        actions={(
          <div className="admin-inline-actions">
            <Button variant="outline" onClick={props.onOpenFinance}>Financial policies</Button>
            <Button
              icon={RefreshCcw}
              variant="outline"
              onClick={() => void queryClient.invalidateQueries({ queryKey: ["admin-revenue"] })}
            >
              Refresh
            </Button>
          </div>
        )}
      />

      <section className="sk-panel">
        <div className="sk-panel__header">
          <div>
            <p className="admin-section-kicker">Reporting window</p>
            <h2>Revenue period</h2>
          </div>
          <div className="admin-inline-actions">
            {[7, 30, 90].map((days) => (
              <Button
                key={days}
                variant={windowDays === days ? "primary" : "outline"}
                onClick={() => setWindowDays(days)}
              >
                {days} days
              </Button>
            ))}
          </div>
        </div>
      </section>

      {summary.isLoading ? <LoadingState label="Loading protected revenue totals" /> : null}
      {summary.error ? (
        <ErrorState
          title="Revenue summary unavailable"
          message={readError(summary.error)}
          onRetry={() => void summary.refetch()}
        />
      ) : null}

      {!summary.isLoading && !summary.error ? (
        <section className="skima-grid skima-grid--compact">
          <MetricTile
            label="Net SKIMA revenue"
            value={money(current.netRevenue, current.currencyCode)}
            icon={TrendingUp}
            tone="success"
          />
          <MetricTile
            label="Gross revenue credits"
            value={money(current.grossCredits, current.currencyCode)}
            icon={WalletCards}
            tone="info"
          />
          <MetricTile
            label="Revenue reversals / debits"
            value={money(current.reversalsAndDebits, current.currencyCode)}
            icon={RotateCcw}
            tone={current.reversalsAndDebits > 0 ? "warning" : "neutral"}
          />
          <MetricTile
            label="Revenue ledger entries"
            value={current.entryCount}
            icon={WalletCards}
          />
        </section>
      ) : null}

      <div className="admin-command-grid">
        <section className="sk-panel">
          <div className="sk-panel__header">
            <div>
              <p className="admin-section-kicker">Revenue streams</p>
              <h2>Where SKIMA earned money</h2>
            </div>
            <StatusBadge>{String(current.byStream.length)}</StatusBadge>
          </div>
          <div className="admin-detail-list">
            {current.byStream.length ? current.byStream.map((stream, index) => (
              <div key={`${recordString(stream, "key") ?? "stream"}-${index}`} className="admin-detail-row">
                <span>{label(recordString(stream, "key"))}</span>
                <strong>{money(recordNumber(stream, "amount"), current.currencyCode)}</strong>
              </div>
            )) : (
              <p>No SKIMA revenue has been posted in this reporting window yet.</p>
            )}
          </div>
        </section>

        <section className="sk-panel">
          <div className="sk-panel__header">
            <div>
              <p className="admin-section-kicker">Revenue components</p>
              <h2>Detailed classification</h2>
            </div>
            <StatusBadge>{String(current.byComponent.length)}</StatusBadge>
          </div>
          <div className="admin-detail-list">
            {current.byComponent.length ? current.byComponent.map((component, index) => (
              <div key={`${recordString(component, "stream") ?? "stream"}-${recordString(component, "component") ?? "component"}-${index}`} className="admin-detail-row">
                <span>
                  {label(recordString(component, "stream"))} · {label(recordString(component, "component"))}
                </span>
                <strong>{money(recordNumber(component, "amount"), current.currencyCode)}</strong>
              </div>
            )) : (
              <p>No classified Revenue entries are available for this period.</p>
            )}
          </div>
        </section>
      </div>

      <section className="sk-panel">
        <div className="sk-panel__header">
          <div>
            <p className="admin-section-kicker">Protected ledger activity</p>
            <h2>Revenue activity</h2>
          </div>
          <StatusBadge>{String(activity.data?.length ?? 0)}</StatusBadge>
        </div>
        {activity.isLoading
          ? <LoadingState label="Loading Revenue activity" />
          : activity.error
          ? (
            <ErrorState
              title="Revenue activity unavailable"
              message={readError(activity.error)}
              onRetry={() => void activity.refetch()}
            />
          )
          : (
            <DataTable
              caption="SKIMA Revenue ledger activity"
              columns={activityColumns}
              records={activity.data ?? []}
              getRowKey={(record) => recordString(record, "ledgerEntryId") ?? JSON.stringify(record)}
              emptyTitle="No Revenue activity yet"
              emptyMessage="Revenue entries will appear here after eligible SKIMA fees or margins are actually earned and posted."
            />
          )}
      </section>

      <section className="sk-panel">
        <div className="sk-panel__header">
          <div>
            <p className="admin-section-kicker">Accounting boundary</p>
            <h2>What is not Revenue</h2>
          </div>
          <StatusBadge tone="success">Ledger enforced</StatusBadge>
        </div>
        <p>
          Customer wallet balances, station earnings, driver earnings, escrow, provider clearing,
          refundable amounts, and taxes/pass-through liabilities are excluded from SKIMA Revenue.
          A successful fee or margin must be posted through the financial engine before it appears here.
        </p>
      </section>
    </>
  );
}

function normalizeSummary(value: unknown): RevenueSummary {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as PlatformRecord : {};
  return {
    currencyCode: recordString(record, "currencyCode") ?? "NGN",
    from: recordString(record, "from"),
    until: recordString(record, "until"),
    netRevenue: recordNumber(record, "netRevenue"),
    grossCredits: recordNumber(record, "grossCredits"),
    reversalsAndDebits: recordNumber(record, "reversalsAndDebits"),
    entryCount: recordNumber(record, "entryCount"),
    byStream: recordArray(record, "byStream"),
    byComponent: recordArray(record, "byComponent"),
  };
}

function emptySummary(): RevenueSummary {
  return {
    currencyCode: "NGN",
    from: null,
    until: null,
    netRevenue: 0,
    grossCredits: 0,
    reversalsAndDebits: 0,
    entryCount: 0,
    byStream: [],
    byComponent: [],
  };
}

function recordString(record: PlatformRecord | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function recordNumber(record: PlatformRecord | null | undefined, key: string): number {
  const value = record?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function recordArray(record: PlatformRecord | null | undefined, key: string): readonly PlatformRecord[] {
  const value = record?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is PlatformRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("en-NG")}`;
  }
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-NG");
}

function label(value: string | null): string {
  if (!value) return "Uncategorized";
  return value.replace(/[._:-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "The protected Revenue data could not be loaded.";
}
