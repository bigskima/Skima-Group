import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeDollarSign, Building2, Landmark, RefreshCcw, RotateCcw, Send, TrendingUp, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";

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
  readonly treasuryNetOutflow: number;
  readonly treasuryEntryCount: number;
  readonly byStream: readonly PlatformRecord[];
  readonly byComponent: readonly PlatformRecord[];
};

const ProviderBalanceSchema = z.object({
  provider: z.string(),
  available: z.boolean(),
  currencyCode: z.string().default("NGN"),
  balance: z.coerce.number().nullable(),
  balanceMinor: z.coerce.number().nullable(),
}).passthrough();

const RevenuePayoutBeneficiarySchema = z.object({
  id: z.string().uuid(),
  bankCode: z.string().nullable(),
  accountName: z.string(),
  accountNumberLast4: z.string().nullable(),
  status: z.string(),
  verifiedAt: z.string().nullable(),
  createdAt: z.string(),
}).passthrough();

const RevenuePayoutSchema = z.object({
  id: z.string().uuid(),
  publicReference: z.string().nullable(),
  beneficiaryId: z.string().uuid(),
  amount: z.coerce.number(),
  currencyCode: z.string(),
  status: z.string(),
  providerReference: z.string().nullable(),
  requestedAt: z.string().nullable(),
  processedAt: z.string().nullable(),
  failedAt: z.string().nullable(),
  reversedAt: z.string().nullable(),
}).passthrough();

const RevenuePayoutContextSchema = z.object({
  currencyCode: z.string().default("NGN"),
  walletId: z.string().uuid().nullable(),
  availableBalance: z.coerce.number(),
  beneficiaries: z.array(RevenuePayoutBeneficiarySchema),
  recentPayouts: z.array(RevenuePayoutSchema),
}).passthrough();

const PayoutBanksSchema = z.object({
  currencyCode: z.string().default("NGN"),
  provider: z.string().optional(),
  source: z.string().optional(),
  banks: z.array(z.object({
    name: z.string(),
    code: z.string(),
  }).passthrough()),
}).passthrough();

const ResolvedPayoutAccountSchema = z.object({
  accountName: z.string(),
  accountNumber: z.string(),
  bankCode: z.string(),
  verified: z.boolean().optional(),
}).passthrough();

const RevenuePayoutResultSchema = z.object({
  id: z.string().uuid(),
  amount: z.coerce.number(),
  status: z.string(),
  public_reference: z.string().nullable().optional(),
  publicReference: z.string().nullable().optional(),
  provider_reference: z.string().nullable().optional(),
  providerReference: z.string().nullable().optional(),
}).passthrough();

type FeeControl = {
  readonly key: string;
  readonly displayName: string;
  readonly description: string;
  readonly unitLabel: string;
  readonly currencyCode: string;
  readonly amount: number;
  readonly policyVersionId: string | null;
  readonly policyVersion: number;
  readonly effectiveFrom: string | null;
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

export function AdminRevenueWorkspace(_props: { readonly onOpenFinance: () => void }) {
  const { api, context, status, supabase } = useSessionState();
  const queryClient = useQueryClient();
  const [windowDays, setWindowDays] = useState(30);
  const [rangeRevision, setRangeRevision] = useState(0);
  const [feeAmounts, setFeeAmounts] = useState<Record<string, string>>({});
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [saveSucceeded, setSaveSucceeded] = useState(false);
  const [payoutBankSearch, setPayoutBankSearch] = useState("");
  const [payoutBankCode, setPayoutBankCode] = useState("");
  const [payoutAccountNumber, setPayoutAccountNumber] = useState("");
  const [resolvedPayoutName, setResolvedPayoutName] = useState("");
  const [resolvedPayoutKey, setResolvedPayoutKey] = useState("");
  const [selectedRevenueBeneficiaryId, setSelectedRevenueBeneficiaryId] = useState("");
  const [revenuePayoutAmount, setRevenuePayoutAmount] = useState("");
  const [payoutNotice, setPayoutNotice] = useState<string | null>(null);

  const isSuperAdmin = context?.platformAdmin?.admin_kind === "super_admin";
  const canReadRevenue = isSuperAdmin ||
    context?.permissions.includes("platform.revenue.read") ||
    context?.permissions.includes("platform.revenue.manage") ||
    false;
  const canSubmitRevenueRate = Boolean(isSuperAdmin || context?.permissions.includes("platform.revenue.manage"));

  const range = useMemo(() => {
    const until = new Date();
    const from = new Date(until.getTime() - windowDays * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), until: until.toISOString() };
  }, [rangeRevision, windowDays]);

  const summary = useQuery({
    queryKey: ["admin-revenue", "summary", windowDays, rangeRevision],
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
    queryFn: async (): Promise<readonly FeeControl[]> => {
      const result = await supabase.rpc("read_platform_fee_controls", {
        target_currency_code: "NGN",
      });
      if (result.error) throw result.error;
      return normalizeFeeControls(result.data);
    },
  });

  const providerBalance = useQuery({
    queryKey: ["admin-revenue", "provider-balance"],
    enabled: status === "authenticated" && canReadRevenue,
    retry: false,
    queryFn: () => api.get("/admin/revenue/provider-balance", ProviderBalanceSchema),
  });

  const payoutContext = useQuery({
    queryKey: ["admin-revenue", "payout-context"],
    enabled: status === "authenticated" && isSuperAdmin,
    retry: false,
    queryFn: () => api.get("/admin/revenue/payout-context?currency=NGN", RevenuePayoutContextSchema),
  });

  const payoutBanks = useQuery({
    queryKey: ["admin-revenue", "payout-banks"],
    enabled: status === "authenticated" && isSuperAdmin,
    retry: false,
    queryFn: () => api.get("/admin/revenue/payout-banks", PayoutBanksSchema),
  });

  const activity = useQuery({
    queryKey: ["admin-revenue", "activity", windowDays, rangeRevision],
    enabled: status === "authenticated" && canReadRevenue,
    queryFn: async (): Promise<readonly PlatformRecord[]> => {
      const result = await supabase.rpc("platform_revenue_activity", {
        target_currency_code: "NGN",
        target_from: range.from,
        target_until: range.until,
        target_limit: 250,
      });
      if (result.error) throw result.error;
      if (!Array.isArray(result.data)) {
        throw new Error("Revenue activity returned an invalid response.");
      }
      const records = result.data.filter(
        (item): item is PlatformRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item),
      );
      if (records.length !== result.data.length) {
        throw new Error("Revenue activity contained an invalid entry.");
      }
      return records;
    },
  });

  useEffect(() => {
    if (configuration.data) {
      setFeeAmounts(Object.fromEntries(configuration.data.map((fee) => [fee.key, String(fee.amount)])));
    }
  }, [configuration.data]);

  const resolvePayoutAccount = useMutation({
    mutationFn: (payload: { bankCode: string; accountNumber: string }) =>
      api.post(
        "/admin/revenue/payout-account/resolve",
        payload,
        ResolvedPayoutAccountSchema,
      ),
  });

  const createRevenuePayoutAccount = useMutation({
    mutationFn: (payload: { bankCode: string; accountNumber: string }) =>
      api.post(
        "/admin/revenue/payout-account",
        {
          ...payload,
          idempotencyKey: revenuePayoutKey("beneficiary"),
        },
        z.object({
          id: z.string().uuid(),
          accountName: z.string(),
          accountNumberLast4: z.string(),
          bankCode: z.string(),
          status: z.string(),
        }).passthrough(),
      ),
    onSuccess: async (created) => {
      setPayoutNotice(`SKIMA revenue payout account confirmed: ${created.accountName}.`);
      setPayoutBankCode("");
      setPayoutAccountNumber("");
      setResolvedPayoutName("");
      setResolvedPayoutKey("");
      await queryClient.invalidateQueries({ queryKey: ["admin-revenue", "payout-context"] });
      await payoutContext.refetch();
      setSelectedRevenueBeneficiaryId(created.id);
    },
    onError: (error) => setPayoutNotice(readError(error)),
  });

  const retryRevenuePayout = useMutation({
    mutationFn: (withdrawalRequestId: string) =>
      api.post(
        "/admin/revenue/payout/retry",
        {
          withdrawalRequestId,
          idempotencyKey: revenuePayoutKey("retry"),
        },
        RevenuePayoutResultSchema,
      ),
    onSuccess: async (result) => {
      const reference = result.publicReference ?? result.public_reference ?? result.id;
      setPayoutNotice(
        `SKIMA revenue withdrawal ${reference} is ${label(result.status).toLowerCase()}.`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-revenue"] }),
        payoutContext.refetch(),
        providerBalance.refetch(),
      ]);
    },
    onError: (error) => setPayoutNotice(readError(error)),
  });

  const withdrawRevenue = useMutation({
    mutationFn: (payload: { beneficiaryId: string; amount: number }) =>
      api.post(
        "/admin/revenue/payout",
        {
          ...payload,
          idempotencyKey: revenuePayoutKey("withdrawal"),
          metadata: { initiatedFrom: "money_revenue" },
        },
        RevenuePayoutResultSchema,
      ),
    onSuccess: async (result) => {
      const reference = result.publicReference ?? result.public_reference ?? result.id;
      setPayoutNotice(
        `SKIMA revenue withdrawal ${reference} is ${label(result.status).toLowerCase()}.`,
      );
      setRevenuePayoutAmount("");
      setRangeRevision((revision) => revision + 1);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-revenue"] }),
        payoutContext.refetch(),
        providerBalance.refetch(),
      ]);
    },
    onError: (error) => setPayoutNotice(readError(error)),
  });

  const payoutAccountIsValid = /^\d{10}$/.test(payoutAccountNumber);
  const payoutAccountKey = payoutBankCode && payoutAccountIsValid
    ? `${payoutBankCode}:${payoutAccountNumber}`
    : "";

  useEffect(() => {
    setResolvedPayoutName("");
    setResolvedPayoutKey("");
    if (!isSuperAdmin || !payoutBankCode || !payoutAccountIsValid) return;

    const key = `${payoutBankCode}:${payoutAccountNumber}`;
    const timer = window.setTimeout(() => {
      setPayoutNotice(null);
      resolvePayoutAccount.mutate({
        bankCode: payoutBankCode,
        accountNumber: payoutAccountNumber,
      }, {
        onSuccess: (resolved) => {
          if (
            resolved.bankCode === payoutBankCode &&
            resolved.accountNumber === payoutAccountNumber
          ) {
            setResolvedPayoutName(resolved.accountName);
            setResolvedPayoutKey(key);
          }
        },
        onError: (error) => setPayoutNotice(readError(error)),
      });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [isSuperAdmin, payoutBankCode, payoutAccountNumber, payoutAccountIsValid]);

  const updateRevenueRate = useMutation({
    mutationFn: async ({ feeKey, amount }: { feeKey: string; amount: number }) => {
      const result = await supabase.rpc("set_platform_fee_amount", {
        target_fee_key: feeKey,
        target_amount: amount,
        target_reason: "Changed immediately by Super Admin in Money & Revenue",
        target_idempotency_key: revenueChangeKey(feeKey),
        target_currency_code: "NGN",
      });
      if (result.error) throw result.error;
      return requireRecord(result.data, "Platform fee update");
    },
    onSuccess: async (_next, requested) => {
      setSaveSucceeded(true);
      const fee = configuration.data?.find((item) => item.key === requested.feeKey);
      setSaveNotice(`${fee?.displayName ?? "Platform fee"} is now ${money(requested.amount, fee?.currencyCode ?? "NGN")}. The change is active immediately.`);
      setRangeRevision((revision) => revision + 1);
      await queryClient.invalidateQueries({ queryKey: ["admin-revenue", "configuration"] });
    },
    onError: (error) => {
      setSaveSucceeded(false);
      setSaveNotice(readError(error));
    },
  });

  const saveRevenueRate = (feeKey: string) => {
    setSaveNotice(null);
    const amount = Number(feeAmounts[feeKey]);
    if (!Number.isFinite(amount) || amount < 0) {
      setSaveSucceeded(false);
      setSaveNotice("Enter a valid fee amount. Zero is allowed.");
      return;
    }
    updateRevenueRate.mutate({ feeKey, amount });
  };

  const refreshRevenue = () => {
    setRangeRevision((revision) => revision + 1);
    void queryClient.invalidateQueries({ queryKey: ["admin-revenue", "configuration"] });
  };

  if (!canReadRevenue) {
    return (
      <ErrorState
        title="Revenue access restricted"
        message="SKIMA Revenue is available only to authorized Finance Admin and Super Admin accounts."
      />
    );
  }

  const current = summary.data;

  return (
    <>
      <PageHeader
        eyebrow="Company money"
        title="Money & Revenue"
        description="See SKIMA's earned balance and set the fees customers and partners pay. Super Admin changes take effect immediately without policy codes or a separate approval step."
        actions={(
          <div className="admin-inline-actions">
            <Button
              icon={RefreshCcw}
              variant="outline"
              onClick={refreshRevenue}
            >
              Refresh
            </Button>
          </div>
        )}
      />

      <section className="sk-panel admin-money-editor">
        <div className="sk-panel__header">
          <div>
            <p className="admin-section-kicker">Revenue pricing</p>
            <h2>Platform fees</h2>
            <p className="skima-muted">Each fee has one live value. Saving a permitted change replaces that value immediately for new transactions.</p>
          </div>
          <div className="admin-money-status-stack">
            {isSuperAdmin ? <StatusBadge tone="info">Super Admin · immediate</StatusBadge> : null}
            {configuration.isLoading ? (
              <StatusBadge>Loading…</StatusBadge>
            ) : configuration.error ? (
              <StatusBadge tone="warning">Unavailable</StatusBadge>
            ) : configuration.data ? (
              <StatusBadge tone="success">{configuration.data.length} live fee controls</StatusBadge>
            ) : null}
          </div>
        </div>

        {configuration.isLoading ? <LoadingState label="Loading current revenue price" /> : null}
        {configuration.error ? (
          <ErrorState
            title="Revenue price unavailable"
            message={readError(configuration.error)}
            onRetry={() => void configuration.refetch()}
          />
        ) : null}

        {configuration.data && !configuration.error ? (
          <div className="admin-money-price-grid">
            {configuration.data.map((fee) => <div key={fee.key} className="admin-money-price-card">
              <div><strong>{fee.displayName}</strong><p className="skima-muted">{fee.description}</p></div>
              <div className="admin-money-price-row">
              <label className="admin-money-price-field">
                <span style={{ fontWeight: 700 }}>Amount ({fee.unitLabel})</span>
                <input
                  aria-label={fee.displayName}
                  type="number"
                  min="0"
                  step="1"
                  inputMode="decimal"
                  value={feeAmounts[fee.key] ?? ""}
                  disabled={!canSubmitRevenueRate || updateRevenueRate.isPending}
                  onChange={(event) => {
                    // React clears currentTarget after the event handler. Capture
                    // the primitive now instead of reading the event later from
                    // inside the state-updater callback.
                    const nextValue = event.currentTarget.value;
                    setFeeAmounts((current) => ({ ...current, [fee.key]: nextValue }));
                  }}
                  className="sk-input"
                />
              </label>
              <Button
                icon={BadgeDollarSign}
                disabled={!canSubmitRevenueRate || updateRevenueRate.isPending}
                onClick={() => saveRevenueRate(fee.key)}
              >
                {updateRevenueRate.isPending ? "Saving…" : "Save & apply now"}
              </Button>
              </div>
              <span className="admin-money-active-price">Live now: {money(fee.amount,fee.currencyCode)} {fee.unitLabel}</span>
            </div>)}

            {!canSubmitRevenueRate ? (
              <p style={{ margin: 0 }}>
                You need platform revenue management access to change fees.
              </p>
            ) : (
              <div className="admin-money-immediate-note">
                <strong>One save, one final price.</strong> SKIMA keeps the audit history in the background, but there is no second approval step for this direct fee control.
              </div>
            )}

            {saveNotice ? (
              <div
                role={saveSucceeded ? "status" : "alert"}
                className={saveSucceeded ? "admin-notice" : "admin-notice is-error"}
              >
                {saveNotice}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <FuelPricingControls />

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

      {summary.isSuccess && current ? (
        <>
          <section className="skima-grid skima-grid--compact">
          <MetricTile
            label="SKIMA Revenue available"
            value={money(current.currentRevenueBalance, current.currencyCode)}
            icon={WalletCards}
            tone="success"
          />
          <MetricTile
            label="Paystack transfer balance"
            value={providerBalance.data?.balance === null || providerBalance.data?.balance === undefined
              ? "Unavailable"
              : money(providerBalance.data.balance, (providerBalance.data.currencyCode ?? "NGN"))}
            icon={Landmark}
            tone={providerBalance.data?.available ? "info" : "neutral"}
          />
          <MetricTile
            label={`Revenue earned · ${windowDays} days`}
            value={money(current.netRevenue, current.currencyCode)}
            icon={TrendingUp}
            tone="success"
          />
          <MetricTile
            label={`Treasury outflow · ${windowDays} days`}
            value={money(current.treasuryNetOutflow, current.currencyCode)}
            icon={Send}
            tone={current.treasuryNetOutflow > 0 ? "info" : "neutral"}
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
        </>
      ) : null}

      <section className="sk-panel">
        <div className="sk-panel__header">
          <div>
            <p className="admin-section-kicker">Protected ledger activity</p>
            <h2>Revenue activity</h2>
          </div>
          <StatusBadge>
            {activity.isLoading ? "Loading…" : activity.error ? "Unavailable" : String(activity.data?.length ?? 0)}
          </StatusBadge>
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

      {isSuperAdmin ? (
        <section className="sk-panel">
          <div className="sk-panel__header">
            <div>
              <p className="admin-section-kicker">Company treasury</p>
              <h2>Withdraw SKIMA Revenue</h2>
              <p className="skima-muted">
                Withdraw only from SKIMA's protected revenue wallet. Customer balances, driver earnings,
                station earnings, escrow, and provider liabilities are never included here.
              </p>
            </div>
            <StatusBadge tone="info">Super Admin only</StatusBadge>
          </div>

          {payoutContext.isLoading ? <LoadingState label="Loading SKIMA revenue payout account" /> : null}
          {payoutContext.error ? (
            <ErrorState
              title="Revenue payout controls unavailable"
              message={readError(payoutContext.error)}
              onRetry={() => void payoutContext.refetch()}
            />
          ) : null}

          {payoutContext.data ? (
            <div style={{ display: "grid", gap: "1rem" }}>
              <div className="skima-grid skima-grid--compact">
                <MetricTile
                  label="Ledger available for company withdrawal"
                  value={money(payoutContext.data.availableBalance, (payoutContext.data.currencyCode ?? "NGN"))}
                  icon={WalletCards}
                  tone="success"
                />
                <MetricTile
                  label="Paystack available for transfers"
                  value={providerBalance.data?.balance === null || providerBalance.data?.balance === undefined
                    ? "Unavailable"
                    : money(providerBalance.data.balance, (providerBalance.data.currencyCode ?? "NGN"))}
                  icon={Landmark}
                  tone="info"
                />
              </div>
              <p className="skima-muted" style={{ margin: 0 }}>
                Paystack transfer balance is external provider cash and may include money owed to customers or partners.
                It is not the same as SKIMA Revenue. The revenue-ledger balance is the maximum company-owned amount this screen permits.
              </p>
              <p className="skima-muted" style={{ margin: 0 }}>
                Live automated payouts require SKIMA's Paystack account to have Transfers enabled as a Registered Business
                and transfer confirmation/OTP disabled. Bank-account holder names are resolved by Paystack; they are never typed into this screen.
              </p>

              <div className="admin-command-grid">
                <div style={{ display: "grid", gap: "0.8rem" }}>
                  <h3 style={{ margin: 0 }}>Company payout account</h3>
                  {payoutContext.data.beneficiaries.length ? (
                    <div style={{ display: "grid", gap: "0.55rem" }}>
                      {payoutContext.data.beneficiaries.map((beneficiary) => (
                        <button
                          key={beneficiary.id}
                          type="button"
                          aria-pressed={selectedRevenueBeneficiaryId === beneficiary.id}
                          onClick={() => setSelectedRevenueBeneficiaryId(beneficiary.id)}
                          style={{
                            textAlign: "left",
                            border: selectedRevenueBeneficiaryId === beneficiary.id
                              ? "2px solid var(--sk-brand, #0f9d8a)"
                              : "1px solid var(--sk-border, #d0d5dd)",
                            borderRadius: 12,
                            padding: "0.8rem",
                            background: "var(--sk-surface, #fff)",
                            color: "inherit",
                            cursor: "pointer",
                          }}
                        >
                          <strong>{beneficiary.accountName}</strong>
                          <div className="skima-muted">
                            {payoutBankName(payoutBanks.data?.banks ?? [], beneficiary.bankCode)}
                            {beneficiary.accountNumberLast4 ? ` · •••• ${beneficiary.accountNumberLast4}` : ""}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="skima-muted">No verified company payout account has been saved yet.</p>
                  )}

                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <span style={{ fontWeight: 700 }}>Bank</span>
                    <input
                      aria-label="Search payout bank"
                      placeholder="Search bank"
                      value={payoutBankSearch}
                      onChange={(event) => {
                        const nextValue = event.currentTarget.value;
                        setPayoutBankSearch(nextValue);
                      }}
                      style={adminInputStyle}
                    />
                  </label>
                  <div style={{ display: "grid", gap: "0.4rem", maxHeight: 220, overflow: "auto" }}>
                    {filteredPayoutBanks(payoutBanks.data?.banks ?? [], payoutBankSearch).slice(0, 25).map((bank) => (
                      <button
                        key={bank.code}
                        type="button"
                        onClick={() => {
                          setPayoutBankCode(bank.code);
                          setResolvedPayoutName("");
                          setResolvedPayoutKey("");
                          setPayoutNotice(null);
                        }}
                        style={{
                          textAlign: "left",
                          border: payoutBankCode === bank.code
                            ? "2px solid var(--sk-brand, #0f9d8a)"
                            : "1px solid var(--sk-border, #d0d5dd)",
                          borderRadius: 10,
                          padding: "0.65rem 0.75rem",
                          background: "transparent",
                          color: "inherit",
                          cursor: "pointer",
                        }}
                      >
                        <Building2 size={15} style={{ marginRight: 8, verticalAlign: "middle" }} />
                        {bank.name}
                      </button>
                    ))}
                  </div>
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <span style={{ fontWeight: 700 }}>10-digit account number</span>
                    <input
                      inputMode="numeric"
                      maxLength={10}
                      value={payoutAccountNumber}
                      onChange={(event) => {
                        const nextValue = event.currentTarget.value.replace(/\D/g, "").slice(0, 10);
                        setPayoutAccountNumber(nextValue);
                        setResolvedPayoutName("");
                        setResolvedPayoutKey("");
                        setPayoutNotice(null);
                      }}
                      style={adminInputStyle}
                    />
                  </label>
                  {payoutBankCode && payoutAccountIsValid ? (
                    <div style={{
                      border: "1px solid var(--sk-border, #d0d5dd)",
                      borderRadius: 12,
                      padding: "0.75rem",
                    }}>
                      <small className="skima-muted">ACCOUNT NAME</small>
                      <div style={{ fontWeight: 800, marginTop: 3 }}>
                        {resolvePayoutAccount.isPending
                          ? "Confirming with Paystack…"
                          : resolvedPayoutName || "Account name could not be confirmed yet"}
                      </div>
                    </div>
                  ) : null}
                  <Button
                    icon={Building2}
                    variant="outline"
                    disabled={
                      !payoutBankCode ||
                      !payoutAccountIsValid ||
                      !resolvedPayoutName ||
                      resolvedPayoutKey !== payoutAccountKey ||
                      createRevenuePayoutAccount.isPending
                    }
                    isLoading={createRevenuePayoutAccount.isPending}
                    onClick={() => createRevenuePayoutAccount.mutate({
                      bankCode: payoutBankCode,
                      accountNumber: payoutAccountNumber,
                    })}
                  >
                    Save verified company payout account
                  </Button>
                </div>

                <div style={{ display: "grid", gap: "0.8rem", alignContent: "start" }}>
                  <h3 style={{ margin: 0 }}>Withdraw company revenue</h3>
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <span style={{ fontWeight: 700 }}>Amount (NGN)</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={revenuePayoutAmount}
                      onChange={(event) => {
                        const nextValue = event.currentTarget.value;
                        setRevenuePayoutAmount(nextValue);
                      }}
                      style={adminInputStyle}
                    />
                  </label>
                  <p className="skima-muted" style={{ margin: 0 }}>
                    This company treasury payout has no SKIMA withdrawal fee. The amount entered is the amount sent to the selected bank.
                  </p>
                  <Button
                    icon={Send}
                    disabled={
                      !selectedRevenueBeneficiaryId ||
                      !validRevenuePayoutAmount(
                        revenuePayoutAmount,
                        payoutContext.data.availableBalance,
                        providerBalance.data?.balance ?? null,
                      ) ||
                      withdrawRevenue.isPending
                    }
                    isLoading={withdrawRevenue.isPending}
                    onClick={() => withdrawRevenue.mutate({
                      beneficiaryId: selectedRevenueBeneficiaryId,
                      amount: Number(revenuePayoutAmount),
                    })}
                  >
                    Withdraw SKIMA revenue
                  </Button>

                  {payoutContext.data.recentPayouts.length ? (
                    <div style={{ display: "grid", gap: "0.45rem" }}>
                      <h4 style={{ margin: "0.4rem 0 0" }}>Recent company withdrawals</h4>
                      {payoutContext.data.recentPayouts.slice(0, 6).map((payout) => (
                        <div key={payout.id} className="admin-detail-row">
                          <span>
                            {payout.publicReference ?? payout.id}
                            <br />
                            <small>{formatDate(payout.requestedAt)}</small>
                          </span>
                          <span style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                            <strong>
                              {money(payout.amount, payout.currencyCode)} · {label(payout.status)}
                            </strong>
                            {payout.status === "approved" ? (
                              <Button
                                variant="outline"
                                size="sm"
                                icon={RefreshCcw}
                                disabled={retryRevenuePayout.isPending}
                                isLoading={retryRevenuePayout.isPending}
                                onClick={() => retryRevenuePayout.mutate(payout.id)}
                              >
                                Retry transfer
                              </Button>
                            ) : null}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              {payoutNotice ? (
                <div role="status" style={{
                  borderRadius: 12,
                  padding: "0.8rem 0.9rem",
                  background: "rgba(15, 157, 138, 0.08)",
                  fontWeight: 650,
                }}>
                  {payoutNotice}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

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

type FuelPricingWorkspace = {
  readonly products: readonly PlatformRecord[];
  readonly branches: readonly PlatformRecord[];
  readonly offers: readonly PlatformRecord[];
  readonly managedPrices: readonly PlatformRecord[];
  readonly modeControls: readonly PlatformRecord[];
};

function FuelPricingControls() {
  const { context, status, supabase } = useSessionState();
  const queryClient = useQueryClient();
  const isSuperAdmin = context?.platformAdmin?.admin_kind === "super_admin";
  const permissions = context?.permissions ?? [];
  const canRead = Boolean(
    isSuperAdmin ||
    permissions.includes("platform.revenue.read") ||
    permissions.includes("platform.revenue.manage") ||
    permissions.includes("platform.financial_policy.read") ||
    permissions.includes("platform.fuel.manage")
  );
  const canManageProducts = Boolean(isSuperAdmin || permissions.includes("platform.fuel.manage"));
  const canManageModes = Boolean(canManageProducts || permissions.includes("platform.dispatch.manage"));
  const canManageRetail = Boolean(canManageProducts || permissions.includes("platform.financial_policy.manage") || permissions.includes("platform.revenue.manage"));
  const canManageOverrides = Boolean(canManageProducts || permissions.includes("platform.financial_policy.manage"));
  const [currencyCode, setCurrencyCode] = useState("NGN");
  const [managedPriceDrafts, setManagedPriceDrafts] = useState<Record<string, string>>({});
  const [overrideDrafts, setOverrideDrafts] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const workspace = useQuery({
    queryKey: ["admin-revenue", "fuel-pricing"],
    enabled: status === "authenticated" && canRead,
    retry: false,
    queryFn: async (): Promise<FuelPricingWorkspace> => {
      const result = await supabase.rpc("read_fuel_admin_pricing_workspace");
      if (result.error) throw result.error;
      const record = requireRecord(result.data, "Fuel pricing workspace");
      return {
        products: requireRecordArray(record, "products", "Fuel pricing workspace"),
        branches: requireRecordArray(record, "branches", "Fuel pricing workspace"),
        offers: requireRecordArray(record, "offers", "Fuel pricing workspace"),
        managedPrices: requireRecordArray(record, "managedPrices", "Fuel pricing workspace"),
        modeControls: requireRecordArray(record, "modeControls", "Fuel pricing workspace"),
      };
    },
  });

  const currencies = useQuery({
    queryKey: ["admin-revenue", "fuel-pricing-currencies"],
    enabled: status === "authenticated" && canRead,
    retry: false,
    queryFn: async (): Promise<readonly string[]> => {
      const result = await supabase
        .from("currency_definitions")
        .select("code")
        .eq("status", "enabled")
        .order("code", { ascending: true });
      if (result.error) throw result.error;
      return (result.data ?? [])
        .map((row) => String(row.code ?? ""))
        .filter(Boolean);
    },
  });

  const products = workspace.data?.products ?? [];
  const offers = workspace.data?.offers ?? [];
  const managedPrices = workspace.data?.managedPrices ?? [];
  const modeControls = workspace.data?.modeControls ?? [];
  const currencyOptions = currencies.data?.length ? currencies.data : ["NGN"];
  const branchNames = new Map((workspace.data?.branches ?? []).map((branch) => [
    recordString(branch, "id") ?? "",
    recordString(branch, "display_name") ?? recordString(branch, "key") ?? "Station branch",
  ] as const));

  useEffect(() => {
    if (!currencyOptions.includes(currencyCode)) setCurrencyCode(currencyOptions[0] ?? "NGN");
  }, [currencyOptions.join("|"), currencyCode]);

  const productTitle = (productKey: string) =>
    recordString(products.find((product) => recordString(product, "key") === productKey), "display_name") ?? label(productKey);

  const runFuelAction = async (key: string, successMessage: string, action: () => Promise<void>) => {
    setBusyKey(key);
    setNotice(null);
    setError(null);
    try {
      await action();
      setNotice(successMessage);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-revenue", "fuel-pricing"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-revenue", "configuration"] }),
      ]);
    } catch (cause) {
      setError(readError(cause));
    } finally {
      setBusyKey(null);
    }
  };

  const setGlobalProductStatus = (productKey: string, enabled: boolean) => {
    const actionKey = `product:${productKey}`;
    void runFuelAction(
      actionKey,
      `${productTitle(productKey)} is now globally ${enabled ? "enabled" : "disabled"}.`,
      async () => {
        const result = await supabase.rpc("set_fuel_product_status", {
          target_product_key: productKey,
          target_status: enabled ? "enabled" : "disabled",
          target_reason: "Changed by an authorized Admin in Money & Revenue",
          target_idempotency_key: fuelAdminChangeKey(actionKey),
        });
        if (result.error) throw result.error;
      },
    );
  };

  const setGlobalModeStatus = (productKey: string, mode: string, enabled: boolean) => {
    const actionKey = `mode:${productKey}:${mode}`;
    void runFuelAction(
      actionKey,
      `${productTitle(productKey)} · ${label(mode)} is now ${enabled ? "enabled" : "disabled"} platform-wide.`,
      async () => {
        const result = await supabase.rpc("set_fuel_fulfillment_mode_control", {
          target_product_key: productKey,
          target_fulfillment_mode: mode,
          target_enabled: enabled,
          target_reason: "Changed by an authorized Admin in Money & Revenue",
          target_idempotency_key: fuelAdminChangeKey(actionKey),
        });
        if (result.error) throw result.error;
      },
    );
  };

  const saveManagedPrice = (productKey: string, code: string, currentValue: string) => {
    const key = `managed:${productKey}:${code}`;
    const amount = Number(managedPriceDrafts[`${productKey}:${code}`] ?? currentValue);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a positive SKIMA Managed retail price per litre.");
      setNotice(null);
      return;
    }
    void runFuelAction(
      key,
      `${productTitle(productKey)} SKIMA Managed retail pricing is active at ${money(amount, code)}/L.`,
      async () => {
        const result = await supabase.rpc("configure_fuel_managed_product_price", {
          target_product_key: productKey,
          target_currency_code: code,
          target_price_per_litre: amount,
          target_enabled: true,
          target_reason: "SKIMA Managed retail price configured in Money & Revenue",
          target_idempotency_key: fuelAdminChangeKey(key),
          target_metadata: { module_key: "fuel", pricing_owner: "skima_platform" },
        });
        if (result.error) throw result.error;
      },
    );
  };

  const saveStationOverride = (offer: PlatformRecord, clear: boolean) => {
    const offerId = recordString(offer, "id");
    if (!offerId) return;
    const key = `override:${offerId}`;
    const amount = Number(overrideDrafts[offerId] ?? "");
    if (!clear && (!Number.isFinite(amount) || amount <= 0)) {
      setError("Enter a positive Admin override price per litre, or use Clear override.");
      setNotice(null);
      return;
    }
    const productKey = recordString(offer, "product_key") ?? "Fuel";
    const code = recordString(offer, "currency_code") ?? "NGN";
    const branchName = branchNames.get(recordString(offer, "branch_id") ?? "") ?? "Station";
    void runFuelAction(
      key,
      clear
        ? `Admin price override cleared for ${branchName} · ${productTitle(productKey)}.`
        : `Admin price override applied to ${branchName} · ${productTitle(productKey)} at ${money(amount, code)}/L.`,
      async () => {
        const result = await supabase.rpc("configure_fuel_station_price_override", {
          target_offer_id: offerId,
          target_override_price_per_litre: clear ? null : amount,
          target_reason: clear
            ? "Admin cleared station price override in Money & Revenue"
            : "Admin overrode station fuel price in Money & Revenue",
          target_idempotency_key: fuelAdminChangeKey(key),
        });
        if (result.error) throw result.error;
      },
    );
  };

  if (!canRead) return null;

  return (
    <section className="sk-panel stack-md">
      <div className="sk-panel__header">
        <div>
          <p className="admin-section-kicker">Fuel commercial controls</p>
          <h2>Fuel products, SKIMA pricing & station overrides</h2>
          <p className="skima-muted">This is part of Money & Revenue. Fuel litre markups remain in Platform Fees above; product switches, SKIMA Managed retail prices and station overrides are controlled here.</p>
        </div>
        <div className="admin-money-status-stack">
          {workspace.isLoading ? <StatusBadge>Loading…</StatusBadge> : null}
          {workspace.isSuccess ? <StatusBadge tone="success">{products.length} Fuel products</StatusBadge> : null}
        </div>
      </div>

      {workspace.isLoading ? <LoadingState label="Loading Fuel commercial settings…" /> : null}
      {workspace.error ? (
        <ErrorState
          title="Fuel commercial settings unavailable"
          message={readError(workspace.error)}
          onRetry={() => void workspace.refetch()}
        />
      ) : null}
      {error ? <div role="alert" className="admin-notice is-error">{error}</div> : null}
      {notice ? <div role="status" className="admin-notice">{notice}</div> : null}

      {workspace.data ? (
        <>
          <div className="stack-sm">
            <div className="sk-panel__header">
              <div>
                <p className="admin-section-kicker">Global catalogue control</p>
                <h3>Products SKIMA allows stations to sell</h3>
              </div>
            </div>
            <div className="admin-money-price-grid">
              {products.map((product) => {
                const key = recordString(product, "key") ?? "";
                const enabled = recordString(product, "status") === "enabled";
                return (
                  <div key={key} className="admin-money-price-card">
                    <div>
                      <strong>{recordString(product, "display_name") ?? label(key)}</strong>
                      <p className="skima-muted">{enabled ? "Available for station offers and customer ordering." : "Globally disabled. Stations cannot enable or sell this product."}</p>
                    </div>
                    <div className="admin-money-price-row">
                      <StatusBadge tone={enabled ? "success" : "warning"}>{enabled ? "Globally enabled" : "Globally off"}</StatusBadge>
                      <Button
                        variant={enabled ? "outline" : "primary"}
                        disabled={!canManageProducts || busyKey === `product:${key}`}
                        onClick={() => setGlobalProductStatus(key, !enabled)}
                      >
                        {enabled ? "Disable globally" : "Enable globally"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="divider" />

          <div className="stack-sm">
            <div className="sk-panel__header">
              <div>
                <p className="admin-section-kicker">SKIMA Managed retail prices</p>
                <h3>Retail price per litre</h3>
                <p className="skima-muted">Used for SKIMA Managed orders only. Station and Independent Managed orders use the station's price, unless an Admin override is active.</p>
              </div>
              <div className="admin-inline-actions">
                {currencyOptions.map((code) => (
                  <Button key={code} size="sm" variant={currencyCode === code ? "primary" : "outline"} onClick={() => setCurrencyCode(code)}>{code}</Button>
                ))}
              </div>
            </div>
            <div className="admin-money-price-grid">
              {products.map((product) => {
                const key = recordString(product, "key") ?? "";
                const priceRecord = managedPrices.find((item) =>
                  recordString(item, "product_key") === key && recordString(item, "currency_code") === currencyCode
                );
                const draftKey = `${key}:${currencyCode}`;
                const livePrice = recordNumberOrNull(priceRecord, "price_per_litre");
                const currentValue = managedPriceDrafts[draftKey] ?? (livePrice === null ? "" : String(livePrice));
                const liveEnabled = recordBoolean(priceRecord, "enabled") === true;
                return (
                  <div key={draftKey} className="admin-money-price-card">
                    <div>
                      <strong>{productTitle(key)}</strong>
                      <p className="skima-muted">{liveEnabled ? "Live SKIMA Managed retail price." : "Not configured yet. SKIMA Managed orders remain unavailable until this is saved."}</p>
                    </div>
                    <div className="admin-money-price-row">
                      <label className="admin-money-price-field">
                        <span style={{ fontWeight: 700 }}>Retail price ({currencyCode}/L)</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          className="sk-input"
                          value={currentValue}
                          disabled={!canManageRetail || busyKey === `managed:${key}:${currencyCode}`}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setManagedPriceDrafts((current) => ({ ...current, [draftKey]: value }));
                          }}
                        />
                      </label>
                      <Button
                        disabled={!canManageRetail || !currentValue || busyKey === `managed:${key}:${currencyCode}`}
                        onClick={() => saveManagedPrice(key, currencyCode, currentValue)}
                      >
                        {liveEnabled ? "Save & apply" : "Configure & enable"}
                      </Button>
                    </div>
                    <span className="admin-money-active-price">{liveEnabled && livePrice !== null ? `Live now: ${money(livePrice, currencyCode)}/L` : "No active SKIMA retail price"}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="divider" />

          <div className="stack-sm">
            <div>
              <p className="admin-section-kicker">Three fulfilment models</p>
              <h3>Global delivery-mode controls</h3>
              <p className="skima-muted">A mode must be enabled here and selected by the station before it can be offered to customers.</p>
            </div>
            <div className="admin-money-price-grid">
              {products.map((product) => {
                const productKey = recordString(product, "key") ?? "";
                return (
                  <div key={productKey} className="admin-money-price-card">
                    <strong>{productTitle(productKey)}</strong>
                    {([
                      ["station_managed", "Station Managed", "Station's own qualified driver and vehicle"],
                      ["independent_driver", "Independent Managed", "Independent provider and own qualified vehicle"],
                      ["skima_managed", "SKIMA Managed", "SKIMA driver programme and SKIMA fleet vehicle"],
                    ] as const).map(([mode, title, description]) => {
                      const control = modeControls.find((item) =>
                        recordString(item, "product_key") === productKey &&
                        recordString(item, "fulfillment_mode") === mode
                      );
                      const enabled = recordBoolean(control, "enabled") === true;
                      const key = `mode:${productKey}:${mode}`;
                      return (
                        <div key={mode} className="admin-money-price-row">
                          <div>
                            <strong>{title}</strong>
                            <p className="skima-muted">{description}</p>
                          </div>
                          <Button
                            size="sm"
                            variant={enabled ? "outline" : "primary"}
                            disabled={!canManageModes || busyKey === key}
                            onClick={() => setGlobalModeStatus(productKey, mode, !enabled)}
                          >
                            {enabled ? "Disable" : "Enable"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="divider" />

          <div className="stack-sm">
            <div>
              <p className="admin-section-kicker">Station price governance</p>
              <h3>Admin overrides</h3>
              <p className="skima-muted">The station remains the source of its own local price. An override temporarily replaces that effective price for new quotes until cleared.</p>
            </div>
            {offers.length === 0 ? <p className="skima-muted">No station Fuel offers have been configured yet.</p> : (
              <div className="admin-money-price-grid">
                {offers.map((offer) => {
                  const offerId = recordString(offer, "id") ?? "";
                  const productKey = recordString(offer, "product_key") ?? "";
                  const code = recordString(offer, "currency_code") ?? "NGN";
                  const stationPrice = recordNumber(offer, "price_per_litre");
                  const override = recordNumberOrNull(offer, "admin_override_price_per_litre");
                  const branch = offer.branch && typeof offer.branch === "object" && !Array.isArray(offer.branch)
                    ? offer.branch as PlatformRecord
                    : null;
                  const branchName = recordString(branch, "display_name") ??
                    branchNames.get(recordString(offer, "branch_id") ?? "") ?? "Station";
                  const draft = overrideDrafts[offerId] ?? (override === null ? "" : String(override));
                  return (
                    <div key={offerId} className="admin-money-price-card">
                      <div>
                        <strong>{branchName} · {productTitle(productKey)}</strong>
                        <p className="skima-muted">Station price: {money(stationPrice, code)}/L</p>
                        <p className="skima-muted">{override !== null ? `Admin override active: ${money(override, code)}/L` : "No Admin override · station price is effective."}</p>
                      </div>
                      <div className="admin-money-price-row">
                        <label className="admin-money-price-field">
                          <span style={{ fontWeight: 700 }}>Override price ({code}/L)</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="sk-input"
                            value={draft}
                            disabled={!canManageOverrides || busyKey === `override:${offerId}`}
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              setOverrideDrafts((current) => ({ ...current, [offerId]: value }));
                            }}
                          />
                        </label>
                        <Button
                          size="sm"
                          disabled={!canManageOverrides || !draft || busyKey === `override:${offerId}`}
                          onClick={() => saveStationOverride(offer, false)}
                        >
                          Save override
                        </Button>
                        {override !== null ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canManageOverrides || busyKey === `override:${offerId}`}
                            onClick={() => saveStationOverride(offer, true)}
                          >
                            Clear
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function fuelAdminChangeKey(scope: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `admin-fuel:${scope}:${uuid ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function normalizeSummary(value: unknown): RevenueSummary {
  const record = requireRecord(value, "Revenue summary");
  return {
    currencyCode: recordString(record, "currencyCode") ?? "NGN",
    from: recordString(record, "from"),
    until: recordString(record, "until"),
    currentRevenueBalance: requireRecordNumber(record, "currentRevenueBalance", "Revenue summary"),
    netRevenue: requireRecordNumber(record, "netRevenue", "Revenue summary"),
    grossCredits: requireRecordNumber(record, "grossCredits", "Revenue summary"),
    reversalsAndDebits: requireRecordNumber(record, "reversalsAndDebits", "Revenue summary"),
    entryCount: requireRecordNumber(record, "entryCount", "Revenue summary"),
    treasuryNetOutflow: recordNumber(record, "treasuryNetOutflow"),
    treasuryEntryCount: recordNumber(record, "treasuryEntryCount"),
    byStream: requireRecordArray(record, "byStream", "Revenue summary"),
    byComponent: requireRecordArray(record, "byComponent", "Revenue summary"),
  };
}

function normalizeFeeControls(value: unknown): readonly FeeControl[] {
  if (!Array.isArray(value)) throw new Error("Platform fee controls returned an invalid response.");
  return value.map((item) => {
    const record = requireRecord(item, "Platform fee control");
    const key = recordString(record, "key");
    const displayName = recordString(record, "displayName");
    const description = recordString(record, "description");
    const unitLabel = recordString(record, "unitLabel");
    if (!key || !displayName || !description || !unitLabel) throw new Error("A platform fee control is incomplete.");
    return { key, displayName, description, unitLabel, currencyCode: recordString(record,"currencyCode") ?? "NGN", amount: requireRecordNumber(record,"amount","Platform fee control"), policyVersionId: recordString(record,"policyVersionId"), policyVersion: recordNumber(record,"policyVersion"), effectiveFrom: recordString(record,"effectiveFrom") };
  });
}

const adminInputStyle = {
  minHeight: 44,
  border: "1px solid var(--sk-border, #d0d5dd)",
  borderRadius: 10,
  padding: "0 0.75rem",
  font: "inherit",
  background: "var(--sk-surface, #fff)",
  color: "inherit",
} as const;

function filteredPayoutBanks(
  banks: readonly { readonly name: string; readonly code: string }[],
  query: string,
) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return banks;
  return banks.filter((bank) =>
    bank.name.toLowerCase().includes(normalized) || bank.code.includes(normalized)
  );
}

function payoutBankName(
  banks: readonly { readonly name: string; readonly code: string }[],
  code: string | null,
) {
  if (!code) return "Bank";
  return banks.find((bank) => bank.code === code)?.name ?? `Bank code ${code}`;
}

function validRevenuePayoutAmount(
  value: string,
  ledgerBalance: number,
  providerBalance: number | null,
) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > ledgerBalance) return false;
  if (providerBalance !== null && amount > providerBalance) return false;
  return true;
}

function revenuePayoutKey(scope: string) {
  return `admin-revenue-${scope}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function requireRecord(value: unknown, label: string): PlatformRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as PlatformRecord;
  throw new Error(`${label} returned an invalid response.`);
}

function recordString(record: PlatformRecord | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function recordNumber(record: PlatformRecord | null | undefined, key: string): number {
  return recordNumberOrNull(record, key) ?? 0;
}

function recordNumberOrNull(record: PlatformRecord | null | undefined, key: string): number | null {
  const value = record?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function requireRecordNumber(record: PlatformRecord, key: string, label: string): number {
  const value = recordNumberOrNull(record, key);
  if (value !== null) return value;
  throw new Error(`${label} did not include ${key}.`);
}

function recordBoolean(record: PlatformRecord | null | undefined, key: string): boolean | null {
  const value = record?.[key];
  return typeof value === "boolean" ? value : null;
}

function recordArray(record: PlatformRecord | null | undefined, key: string): readonly PlatformRecord[] {
  const value = record?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is PlatformRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function requireRecordArray(record: PlatformRecord, key: string, label: string): readonly PlatformRecord[] {
  if (!Array.isArray(record[key])) throw new Error(`${label} did not include ${key}.`);
  return recordArray(record, key);
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

function revenueChangeKey(feeKey: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `admin-platform-fee:${feeKey}:${uuid ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}
