import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeDollarSign, RefreshCcw, RotateCcw, TrendingUp, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
  readonly currentRevenueBalance: number;
  readonly netRevenue: number;
  readonly grossCredits: number;
  readonly reversalsAndDebits: number;
  readonly entryCount: number;
  readonly byStream: readonly PlatformRecord[];
  readonly byComponent: readonly PlatformRecord[];
};

type RevenueConfiguration = {
  readonly currencyCode: string;
  readonly currentRevenueBalance: number;
  readonly lpgPlatformRevenuePerKg: number;
  readonly policyVersionId: string | null;
  readonly policyVersion: number;
  readonly effectiveFrom: string | null;
  readonly effectiveUntil: string | null;
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
  const [revenuePerKg, setRevenuePerKg] = useState("");
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [saveSucceeded, setSaveSucceeded] = useState(false);

  const isSuperAdmin = context?.platformAdmin?.admin_kind === "super_admin";
  const canReadRevenue = isSuperAdmin ||
    context?.permissions.includes("platform.revenue.read") ||
    context?.permissions.includes("platform.revenue.manage") ||
    false;
  const canDirectlyManageRevenue = Boolean(isSuperAdmin);

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

  const configuration = useQuery({
    queryKey: ["admin-revenue", "configuration"],
    enabled: status === "authenticated" && canReadRevenue,
    queryFn: async (): Promise<RevenueConfiguration> => {
      const result = await supabase.rpc("read_lpg_platform_revenue_configuration", {
        target_currency_code: "NGN",
      });
      if (result.error) throw result.error;
      return normalizeConfiguration(result.data);
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

  useEffect(() => {
    if (configuration.data) {
      setRevenuePerKg(String(configuration.data.lpgPlatformRevenuePerKg));
    }
  }, [configuration.data]);

  const updateRevenueRate = useMutation({
    mutationFn: async (amount: number): Promise<RevenueConfiguration> => {
      const result = await supabase.rpc("configure_lpg_platform_revenue_rate", {
        target_amount_per_kg: amount,
        target_reason: "Updated from Money & Revenue",
        target_idempotency_key: revenueChangeKey(),
        target_effective_from: new Date().toISOString(),
      });
      if (result.error) throw result.error;
      return normalizeConfiguration(result.data);
    },
    onSuccess: async (next) => {
      setRevenuePerKg(String(next.lpgPlatformRevenuePerKg));
      setSaveSucceeded(true);
      setSaveNotice(`SKIMA LPG revenue is now ${money(next.lpgPlatformRevenuePerKg, next.currencyCode)} per kg.`);
      await queryClient.invalidateQueries({ queryKey: ["admin-revenue"] });
    },
    onError: (error) => {
      setSaveSucceeded(false);
      setSaveNotice(readError(error));
    },
  });

  const saveRevenueRate = () => {
    setSaveNotice(null);
    const amount = Number(revenuePerKg);
    if (!Number.isFinite(amount) || amount < 0) {
      setSaveSucceeded(false);
      setSaveNotice("Enter a valid SKIMA revenue amount per kilogram. Zero is allowed.");
      return;
    }
    updateRevenueRate.mutate(amount);
  };

  if (!canReadRevenue) {
    return (
      <ErrorState
        title="Revenue access restricted"
        message="SKIMA Revenue is available only to authorized Finance Admin and Super Admin accounts."
      />
    );
  }

  const current = summary.data ?? emptySummary();
  const liveRate = configuration.data?.lpgPlatformRevenuePerKg ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Company money"
        title="Money & Revenue"
        description="See SKIMA's actual earned balance and set the LPG revenue amount without editing policy JSON. Customer money, station earnings, driver earnings, escrow and clearing remain separate."
        actions={(
          <div className="admin-inline-actions">
            <Button variant="outline" onClick={props.onOpenFinance}>Advanced policies</Button>
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
            <p className="admin-section-kicker">Revenue pricing</p>
            <h2>Set SKIMA LPG revenue per kg</h2>
          </div>
          <StatusBadge tone="success">{money(liveRate, configuration.data?.currencyCode ?? "NGN")} / kg</StatusBadge>
        </div>

        {configuration.isLoading ? <LoadingState label="Loading current revenue price" /> : null}
        {configuration.error ? (
          <ErrorState
            title="Revenue price unavailable"
            message={readError(configuration.error)}
            onRetry={() => void configuration.refetch()}
          />
        ) : null}

        {!configuration.isLoading && !configuration.error ? (
          <div style={{ display: "grid", gap: "1rem", maxWidth: 620 }}>
            <div style={{ display: "grid", gap: "0.35rem" }}>
              <strong>Platform revenue per kilogram</strong>
              <span style={{ color: "var(--sk-muted, #667085)" }}>
                This amount is added by SKIMA on top of the station's own LPG selling price. Delivery pricing is managed separately.
              </span>
            </div>

            <div style={{ display: "flex", gap: "0.75rem", alignItems: "end", flexWrap: "wrap" }}>
              <label style={{ display: "grid", gap: "0.4rem", minWidth: 220, flex: "1 1 260px" }}>
                <span style={{ fontWeight: 700 }}>₦ per kg</span>
                <input
                  aria-label="SKIMA LPG revenue per kilogram"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="decimal"
                  value={revenuePerKg}
                  disabled={!canDirectlyManageRevenue || updateRevenueRate.isPending}
                  onChange={(event) => setRevenuePerKg(event.currentTarget.value)}
                  style={{
                    minHeight: 46,
                    border: "1px solid var(--sk-border, #d0d5dd)",
                    borderRadius: 12,
                    padding: "0 0.85rem",
                    font: "inherit",
                    background: "var(--sk-surface, #fff)",
                    color: "inherit",
                  }}
                />
              </label>
              <Button
                icon={BadgeDollarSign}
                disabled={!canDirectlyManageRevenue || updateRevenueRate.isPending}
                onClick={saveRevenueRate}
              >
                {updateRevenueRate.isPending ? "Saving…" : "Save revenue price"}
              </Button>
            </div>

            {!canDirectlyManageRevenue ? (
              <p style={{ margin: 0 }}>
                Direct price changes are reserved for Super Admin. Finance Admin can review governed versions under Advanced policies.
              </p>
            ) : null}

            {configuration.data?.effectiveFrom ? (
              <p style={{ margin: 0, color: "var(--sk-muted, #667085)" }}>
                Active policy version {configuration.data.policyVersion || "—"} · effective {formatDate(configuration.data.effectiveFrom)}
              </p>
            ) : null}

            {saveNotice ? (
              <div
                role="status"
                style={{
                  borderRadius: 12,
                  padding: "0.8rem 0.9rem",
                  background: saveSucceeded ? "rgba(16, 185, 129, 0.10)" : "rgba(239, 68, 68, 0.10)",
                  fontWeight: 650,
                }}
              >
                {saveNotice}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

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
            label="Current SKIMA Revenue balance"
            value={money(current.currentRevenueBalance, current.currencyCode)}
            icon={WalletCards}
            tone="success"
          />
          <MetricTile
            label={`Net revenue · ${windowDays} days`}
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
    currentRevenueBalance: recordNumber(record, "currentRevenueBalance"),
    netRevenue: recordNumber(record, "netRevenue"),
    grossCredits: recordNumber(record, "grossCredits"),
    reversalsAndDebits: recordNumber(record, "reversalsAndDebits"),
    entryCount: recordNumber(record, "entryCount"),
    byStream: recordArray(record, "byStream"),
    byComponent: recordArray(record, "byComponent"),
  };
}

function normalizeConfiguration(value: unknown): RevenueConfiguration {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as PlatformRecord : {};
  return {
    currencyCode: recordString(record, "currencyCode") ?? "NGN",
    currentRevenueBalance: recordNumber(record, "currentRevenueBalance"),
    lpgPlatformRevenuePerKg: recordNumber(record, "lpgPlatformRevenuePerKg"),
    policyVersionId: recordString(record, "policyVersionId") ?? recordString(record, "newPolicyVersionId"),
    policyVersion: recordNumber(record, "policyVersion"),
    effectiveFrom: recordString(record, "effectiveFrom"),
    effectiveUntil: recordString(record, "effectiveUntil"),
  };
}

function emptySummary(): RevenueSummary {
  return {
    currencyCode: "NGN",
    from: null,
    until: null,
    currentRevenueBalance: 0,
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
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { readonly message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "The protected Revenue data could not be loaded.";
}

function revenueChangeKey(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `admin-revenue-rate:${uuid ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}
