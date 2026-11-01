import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowDownLeft, ArrowUpRight, Banknote, CircleAlert, RefreshCcw, WalletCards } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";

import { createClientIdempotencyKey } from "@skima/frontend-core";
import {
  Button,
  DataTable,
  ErrorState,
  LoadingState,
  MetricTile,
  PageHeader,
  SelectInput,
  StatusBadge,
  TextAreaInput,
  TextInput,
  type TableColumn,
} from "@skima/ui";

import { useSessionState } from "./session";

type RecordValue = Readonly<Record<string, unknown>>;

const RecordSchema = z.record(z.unknown());
const RevenueSchema = z.object({
  currentRevenueBalance: z.coerce.number().default(0),
  netRevenue: z.coerce.number().default(0),
  grossCredits: z.coerce.number().default(0),
  reversalsAndDebits: z.coerce.number().default(0),
  entryCount: z.coerce.number().default(0),
}).passthrough();

const FleetSchema = z.object({
  orderCount: z.coerce.number().default(0),
  customerCollections: z.coerce.number().default(0),
  customerLpgPrincipal: z.coerce.number().default(0),
  procurementSpread: z.coerce.number().default(0),
  fundsAllocatedToFleet: z.coerce.number().default(0),
  platformMarkupCollected: z.coerce.number().default(0),
  deliveryFeesCollected: z.coerce.number().default(0),
  procurementCost: z.coerce.number().default(0),
  supplierPaid: z.coerce.number().default(0),
  supplierOutstanding: z.coerce.number().default(0),
  driverEarnings: z.coerce.number().default(0),
  driverPaidToWallet: z.coerce.number().default(0),
  driverUnpaidEarnings: z.coerce.number().default(0),
  orders: z.array(RecordSchema).default([]),
  supplierPayments: z.array(RecordSchema).default([]),
  driverPayouts: z.array(RecordSchema).default([]),
  earningRecords: z.array(RecordSchema).default([]),
}).passthrough();

const AnalyticsSchema = z.object({
  currencyCode: z.string().default("NGN"),
  canReadFinance: z.boolean().default(false),
  canReadRevenue: z.boolean().default(false),
  revenue: RevenueSchema.nullable().default(null),
  walletBalances: z.array(RecordSchema).default([]),
  transactionSummary: z.array(RecordSchema).default([]),
  withdrawals: RecordSchema.default({}),
  settlements: RecordSchema.default({}),
  fleet: FleetSchema,
  recentTransactions: z.array(RecordSchema).default([]),
  recentLedgerEntries: z.array(RecordSchema).default([]),
}).passthrough();

type Analytics = z.infer<typeof AnalyticsSchema>;
type FleetOrder = RecordValue;

const orderColumns: readonly TableColumn<FleetOrder>[] = [
  {
    key: "orderReference",
    header: "Order",
    render: (row) => <strong>{recordString(row, "orderReference") ?? "—"}</strong>,
  },
  {
    key: "supplierName",
    header: "Supplier",
    render: (row) => recordString(row, "supplierName") ?? "—",
  },
  {
    key: "actualKg",
    header: "Actual kg",
    render: (row) => numberValue(row, "actualKg").toLocaleString("en-NG", { maximumFractionDigits: 3 }),
  },
  {
    key: "customerTotal",
    header: "Customer paid",
    render: (row) => money(numberValue(row, "customerTotal"), recordString(row, "currencyCode") ?? "NGN"),
  },
  {
    key: "lpgPrincipalAllocated",
    header: "LPG principal credited to SKIMA",
    render: (row) => money(numberValue(row, "lpgPrincipalAllocated"), recordString(row, "currencyCode") ?? "NGN"),
  },
  {
    key: "procurementCost",
    header: "Actual supplier cost",
    render: (row) => money(numberValue(row, "procurementCost"), recordString(row, "currencyCode") ?? "NGN"),
  },
  {
    key: "procurementSpread",
    header: "Procurement spread · unclassified",
    render: (row) => {
      const spread = numberValue(row, "procurementSpread");
      return <StatusBadge tone={spread >= 0 ? "neutral" : "warning"}>{money(spread, recordString(row, "currencyCode") ?? "NGN")}</StatusBadge>;
    },
  },
  {
    key: "supplierPaid",
    header: "Supplier paid",
    render: (row) => money(numberValue(row, "supplierPaid"), recordString(row, "currencyCode") ?? "NGN"),
  },
  {
    key: "supplierOutstanding",
    header: "Unpaid supplier balance",
    render: (row) => {
      const outstanding = numberValue(row, "supplierOutstanding");
      return <StatusBadge tone={outstanding > 0 ? "warning" : "success"}>{money(outstanding, recordString(row, "currencyCode") ?? "NGN")}</StatusBadge>;
    },
  },
];

const paymentColumns: readonly TableColumn<RecordValue>[] = [
  { key: "paidAt", header: "Paid at", render: (row) => formatDate(recordString(row, "paidAt")) },
  { key: "orderReference", header: "Order", render: (row) => recordString(row, "orderReference") ?? "—" },
  { key: "supplierName", header: "Supplier", render: (row) => recordString(row, "supplierName") ?? "—" },
  { key: "paymentMethod", header: "Method", render: (row) => label(recordString(row, "paymentMethod")) },
  { key: "paymentReference", header: "Reference", render: (row) => recordString(row, "paymentReference") ?? "Cash / no bank reference" },
  { key: "amount", header: "Amount", render: (row) => money(numberValue(row, "amount"), recordString(row, "currencyCode") ?? "NGN") },
  { key: "paidBy", header: "Recorded by", render: (row) => recordString(row, "paidBy") ?? "—" },
  { key: "financialTransactionId", header: "Ledger transaction", render: (row) => shortId(recordString(row, "financialTransactionId")) },
];

const payoutColumns: readonly TableColumn<RecordValue>[] = [
  { key: "paidAt", header: "Paid at", render: (row) => formatDate(recordString(row, "paidAt")) },
  { key: "payoutReference", header: "Payout reference", render: (row) => recordString(row, "payoutReference") ?? "—" },
  { key: "batchReference", header: "Batch", render: (row) => recordString(row, "batchReference") ?? "—" },
  { key: "driverName", header: "Driver", render: (row) => recordString(row, "driverName") ?? "—" },
  { key: "amount", header: "Amount", render: (row) => money(numberValue(row, "amount"), recordString(row, "currencyCode") ?? "NGN") },
  { key: "status", header: "Status", render: (row) => <StatusBadge tone={recordString(row, "status") === "posted" ? "success" : "warning"}>{label(recordString(row, "status"))}</StatusBadge> },
  { key: "allocationCount", header: "Orders paid", render: (row) => numberValue(row, "allocationCount").toString() },
];

const transactionColumns: readonly TableColumn<RecordValue>[] = [
  { key: "createdAt", header: "Date", render: (row) => formatDate(recordString(row, "createdAt")) },
  { key: "transactionType", header: "Type", render: (row) => label(recordString(row, "transactionType")) },
  { key: "source", header: "Source", render: (row) => recordString(row, "source") ?? "—" },
  { key: "status", header: "Status", render: (row) => <StatusBadge tone={recordString(row, "status") === "posted" ? "success" : "warning"}>{label(recordString(row, "status"))}</StatusBadge> },
  { key: "amount", header: "Amount", render: (row) => money(numberValue(row, "amount"), recordString(row, "currencyCode") ?? "NGN") },
  { key: "externalReference", header: "Reference", render: (row) => recordString(row, "externalReference") ?? "—" },
  { key: "transactionId", header: "Transaction ID", render: (row) => shortId(recordString(row, "transactionId")) },
];

const ledgerColumns: readonly TableColumn<RecordValue>[] = [
  { key: "createdAt", header: "Date", render: (row) => formatDate(recordString(row, "createdAt")) },
  { key: "walletType", header: "Account", render: (row) => label(recordString(row, "walletPurpose") ?? recordString(row, "walletType")) },
  { key: "direction", header: "Movement", render: (row) => <StatusBadge tone={recordString(row, "direction") === "credit" ? "success" : "warning"}>{label(recordString(row, "direction"))}</StatusBadge> },
  { key: "amount", header: "Amount", render: (row) => money(numberValue(row, "amount"), "NGN") },
  { key: "source", header: "Source", render: (row) => recordString(row, "source") ?? "—" },
  { key: "reference", header: "Reference", render: (row) => recordString(row, "reference") ?? "—" },
  { key: "transactionStatus", header: "Transaction status", render: (row) => label(recordString(row, "transactionStatus")) },
];

export function AdminFinancialAnalyticsWorkspace() {
  const { supabase, status, context } = useSessionState();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState("30");
  const [currency, setCurrency] = useState("NGN");
  const [selectedOrder, setSelectedOrder] = useState<FleetOrder | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank_transfer">("bank_transfer");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => localDateTimeInput(new Date()));
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<"success" | "danger">("success");

  const isSuperAdmin = context?.platformAdmin?.admin_kind === "super_admin";
  const canRead = Boolean(isSuperAdmin ||
    context?.permissions.includes("platform.financial.read") ||
    context?.permissions.includes("platform.financial.manage") ||
    context?.permissions.includes("platform.revenue.read"));
  const canRecordSupplierPayment = Boolean(isSuperAdmin || context?.permissions.includes("platform.financial.manage"));

  const range = useMemo(() => {
    if (period === "all") return { from: null, until: null };
    const until = new Date();
    const from = new Date(until.getTime() - Number(period) * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), until: until.toISOString() };
  }, [period]);

  const analytics = useQuery({
    queryKey: ["platform-financial-analytics", currency, period],
    enabled: status === "authenticated" && canRead,
    retry: false,
    queryFn: async (): Promise<Analytics> => {
      const { data, error } = await supabase.rpc("read_platform_financial_analytics", {
        target_currency_code: currency,
        target_from: range.from,
        target_until: range.until,
        target_limit: 100,
      });
      if (error) throw error;
      return AnalyticsSchema.parse(data);
    },
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["platform-financial-analytics"] });
  };

  const recordSupplierPayment = useMutation({
    mutationFn: async () => {
      if (!selectedOrder) throw new Error("Choose the supplier order to record.");
      const amount = Number(paymentAmount);
      const outstanding = numberValue(selectedOrder, "supplierOutstanding");
      if (!Number.isFinite(amount) || amount <= 0 || amount > outstanding) {
        throw new Error("Enter a positive amount no greater than the outstanding supplier balance.");
      }
      if (!paymentReference.trim()) {
        throw new Error(paymentMethod === "bank_transfer"
          ? "Enter the bank transfer reference before recording this payment."
          : "Enter the cash voucher or receipt reference before recording this payment.");
      }
      const paidAt = new Date(paymentDate);
      if (!paymentDate || !Number.isFinite(paidAt.getTime())) {
        throw new Error("Enter a valid supplier payment date and time.");
      }
      const { data, error } = await supabase.rpc("record_lpg_internal_supplier_payment", {
        target_procurement_id: recordString(selectedOrder, "procurementId"),
        target_amount: amount,
        target_payment_method: paymentMethod,
        target_payment_reference: paymentReference.trim() || null,
        target_evidence_media_asset_id: null,
        target_note: paymentNote.trim() || null,
        target_idempotency_key: createClientIdempotencyKey(
          "admin.lpg.supplier-payment",
          `${recordString(selectedOrder, "orderReference") ?? "order"}:${amount}:${paymentMethod}:${paymentReference.trim()}`,
        ),
        target_paid_at: paidAt.toISOString(),
      });
      if (error) throw error;
      return data as RecordValue;
    },
    onSuccess: async (result) => {
      setNotice(
        `Supplier payment recorded · ${money(numberValue(result, "amount"), recordString(result, "currencyCode") ?? currency)} · ${recordString(result, "orderReference") ?? ""}`,
      );
      setNoticeTone("success");
      setSelectedOrder(null);
      setPaymentAmount("");
      setPaymentReference("");
      setPaymentNote("");
      setPaymentDate(localDateTimeInput(new Date()));
      await refresh();
    },
    onError: (error) => {
      setNotice(readError(error));
      setNoticeTone("danger");
    },
  });

  if (!canRead) {
    return (
      <ErrorState
        title="Financial analytics access restricted"
        message="Your Admin role does not include platform financial or revenue read access."
      />
    );
  }

  if (analytics.isPending) return <LoadingState label="Loading financial analytics from the ledger…" />;
  if (analytics.error || !analytics.data) {
    return <ErrorState error={analytics.error ?? new Error("Financial analytics could not be loaded.")} onRetry={() => void refresh()} />;
  }

  const data = analytics.data;
  const fleet = data.fleet;
  const clearingBalance = data.walletBalances
    .filter((wallet) => recordString(wallet, "walletType") === "platform_clearing")
    .reduce((sum, wallet) => sum + numberValue(wallet, "balance"), 0);
  const supplierExpenseBalance = data.walletBalances
    .filter((wallet) => recordString(wallet, "walletPurpose") === "lpg_supplier_disbursements")
    .reduce((sum, wallet) => sum + numberValue(wallet, "balance"), 0);
  const revenueBalance = data.revenue?.currentRevenueBalance ?? 0;
  const selectedOutstanding = selectedOrder ? numberValue(selectedOrder, "supplierOutstanding") : 0;

  return (
    <div className="money-v2 skima-financial-analytics stack-lg">
      <PageHeader
        eyebrow="Money · Finance control"
        title="Financial analytics"
        description="A ledger-backed view of collections, revenue, supplier expenses, settlements, payouts and wallet activity. Totals follow the selected date window; account balances are current."
        actions={
          <>
            <SelectInput
              label="Period"
              value={period}
              options={[
                { label: "Last 7 days", value: "7" },
                { label: "Last 30 days", value: "30" },
                { label: "Last 90 days", value: "90" },
                { label: "All time", value: "all" },
              ]}
              onChange={(event) => setPeriod(event.currentTarget.value)}
            />
            <SelectInput
              label="Currency"
              value={currency}
              options={[{ label: "NGN", value: "NGN" }]}
              onChange={(event) => setCurrency(event.currentTarget.value)}
            />
            <Button icon={RefreshCcw} variant="outline" onClick={() => void refresh()}>Refresh</Button>
          </>
        }
      />

      {notice ? (
        <div className="sk-panel">
          <StatusBadge tone={noticeTone}>{notice}</StatusBadge>
        </div>
      ) : null}

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="SKIMA Fleet collections" value={money(fleet.customerCollections, currency)} icon={ArrowDownLeft} />
        <MetricTile
          label="SKIMA net revenue"
          value={data.canReadRevenue && data.revenue ? money(data.revenue.netRevenue, currency) : "Restricted"}
          icon={ArrowUpRight}
          tone="success"
        />
        <MetricTile label="Supplier paid out" value={money(fleet.supplierPaid, currency)} icon={Banknote} />
        <MetricTile label="Driver paid to SKIMA Wallet" value={money(fleet.driverPaidToWallet, currency)} icon={WalletCards} />
        <MetricTile label="Unpaid supplier balance" value={money(fleet.supplierOutstanding, currency)} icon={CircleAlert} tone={fleet.supplierOutstanding > 0 ? "warning" : "success"} />
        <MetricTile label="Unpaid driver earnings" value={money(fleet.driverUnpaidEarnings, currency)} icon={Activity} tone={fleet.driverUnpaidEarnings > 0 ? "warning" : "success"} />
      </section>

      <section className="sk-panel stack-md">
        <div className="sk-panel__header">
          <div>
            <p className="admin-section-kicker">SKIMA Fleet · Customer collections</p>
            <h2>Money collected by SKIMA from in-app orders</h2>
            <p className="skima-muted">
              The customer payment is held in SKIMA-controlled escrow, then settled into SKIMA platform clearing, revenue and driver-liability accounts. None of these are station wallet credits. SKIMA pays the physical supplier separately by cash or bank transfer below.
            </p>
          </div>
          <StatusBadge tone="success">SKIMA is funds recipient</StatusBadge>
        </div>
        <div className="skima-grid skima-grid--compact">
          <MetricTile label="Settled orders" value={fleet.orderCount} />
          <MetricTile label="Customer LPG principal credited to SKIMA clearing" value={money(fleet.customerLpgPrincipal, currency)} />
          <MetricTile label="Explicit per-kg platform markup" value={money(fleet.platformMarkupCollected, currency)} />
          <MetricTile label="Procurement spread held in clearing · not revenue-classified" value={money(fleet.procurementSpread, currency)} tone={fleet.procurementSpread !== 0 ? "warning" : "success"} />
          <MetricTile label="Customer delivery fees" value={money(fleet.deliveryFeesCollected, currency)} />
          <MetricTile label="Recorded procurement cost" value={money(fleet.procurementCost, currency)} />
          <MetricTile label="Current shared SKIMA clearing balance" value={money(clearingBalance, currency)} />
        </div>
        {data.canReadRevenue ? (
          <p className="skima-muted">
            Current SKIMA revenue wallet: <strong>{money(revenueBalance, currency)}</strong>.
            This is distinct from platform clearing and the supplier expense ledger. The procurement spread is shown separately and is not assumed to be recognized revenue.
          </p>
        ) : (
          <p className="skima-muted">Revenue wallet details are hidden because this Admin role does not have platform revenue read permission.</p>
        )}
      </section>

      <section className="sk-panel stack-md">
        <div className="sk-panel__header">
          <div>
            <p className="admin-section-kicker">Order-level accounting</p>
            <h2>Fleet collections, procurement and supplier balance</h2>
            <p className="skima-muted">Each row reconciles the customer amount collected by SKIMA against the actual station purchase cost and recorded supplier payment. Procurement alone does not count as proof of payment.</p>
          </div>
        </div>
        <DataTable columns={orderColumns} caption="SKIMA Fleet orders and supplier balances" records={fleet.orders as FleetOrder[]}
          getRowKey={(row) => recordString(row, "orderId") ?? JSON.stringify(row)}
          emptyTitle="No SKIMA Fleet orders" emptyMessage="No settled SKIMA Fleet procurement records are available for this period." />
        {canRecordSupplierPayment && fleet.orders.some((order) => numberValue(order, "supplierOutstanding") > 0) ? (
          <div className="skima-form-grid">
            <SelectInput
              label="Order with outstanding supplier balance"
              value={recordString(selectedOrder, "orderId") ?? ""}
              options={fleet.orders
                .filter((order) => numberValue(order, "supplierOutstanding") > 0)
                .map((order) => ({
                  label: `${recordString(order, "orderReference") ?? "Order"} · ${money(numberValue(order, "supplierOutstanding"), currency)} outstanding`,
                  value: recordString(order, "orderId") ?? "",
                }))}
              onChange={(event) => {
                const selectedId = event.currentTarget.value;
                const selected = fleet.orders.find((order) => recordString(order, "orderId") === selectedId) ?? null;
                setSelectedOrder(selected);
                setPaymentAmount(selected ? String(numberValue(selected, "supplierOutstanding")) : "");
                setPaymentReference("");
                setPaymentNote("");
                setPaymentDate(localDateTimeInput(new Date()));
              }}
            />
            <TextInput
              label="Actual amount paid to supplier"
              type="number"
              min="0.01"
              max={selectedOutstanding}
              step="0.01"
              value={paymentAmount}
              disabled={!selectedOrder}
              onChange={(event) => setPaymentAmount(event.currentTarget.value)}
            />
            <SelectInput
              label="How SKIMA paid the station"
              value={paymentMethod}
              options={[
                { label: "Bank transfer", value: "bank_transfer" },
                { label: "Physical cash", value: "cash" },
              ]}
              onChange={(event) => setPaymentMethod(event.currentTarget.value as "cash" | "bank_transfer")}
            />
            <TextInput
              label={paymentMethod === "bank_transfer" ? "Bank transfer reference (required)" : "Cash voucher / receipt reference (required)"}
              value={paymentReference}
              onChange={(event) => setPaymentReference(event.currentTarget.value)}
              disabled={!selectedOrder}
              placeholder={paymentMethod === "bank_transfer" ? "Enter the bank transaction reference" : "Enter the cash voucher or signed handover reference"}
            />
            <TextInput
              label="Actual supplier payment date and time"
              type="datetime-local"
              value={paymentDate}
              onChange={(event) => setPaymentDate(event.currentTarget.value)}
              disabled={!selectedOrder}
            />
            <TextAreaInput
              label="Payment note (optional)"
              value={paymentNote}
              onChange={(event) => setPaymentNote(event.currentTarget.value)}
              rows={2}
              disabled={!selectedOrder}
              placeholder="Recipient or cash handover details"
            />
            <div className="sk-panel">
              <strong>Payment control</strong>
              <p className="skima-muted">This records a disbursement from the SKIMA platform clearing account and credits the supplier-disbursement ledger. Both payment methods require an auditable reference: the bank transaction reference or the cash voucher / signed handover reference.</p>
              <Button
                disabled={!selectedOrder || recordSupplierPayment.isPending || Number(paymentAmount) <= 0}
                isLoading={recordSupplierPayment.isPending}
                onClick={() => recordSupplierPayment.mutate()}
              >
                Record supplier payment
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="sk-panel stack-md">
        <div className="sk-panel__header">
          <div><p className="admin-section-kicker">Supplier expenses</p><h2>Actual SKIMA payments to stations</h2></div>
          <StatusBadge tone="success">Separate from customer collections</StatusBadge>
        </div>
        <DataTable columns={paymentColumns} caption="Supplier payment history" records={fleet.supplierPayments as RecordValue[]}
          getRowKey={(row) => recordString(row, "id") ?? JSON.stringify(row)}
          emptyTitle="No supplier payments recorded" emptyMessage="No supplier disbursements have been recorded yet. An approved procurement is not counted as paid." />
        <div className="skima-grid skima-grid--compact">
          <MetricTile label="Procurement cost recorded" value={money(fleet.procurementCost, currency)} />
          <MetricTile label="Supplier cash / bank transfer recorded" value={money(fleet.supplierPaid, currency)} />
          <MetricTile label="Supplier balance outstanding" value={money(fleet.supplierOutstanding, currency)} tone={fleet.supplierOutstanding > 0 ? "warning" : "success"} />
          <MetricTile label="Cumulative supplier disbursements in expense ledger" value={money(supplierExpenseBalance, currency)} />
        </div>
      </section>

      <section className="sk-panel stack-md">
        <div className="sk-panel__header">
          <div><p className="admin-section-kicker">Driver compensation</p><h2>Driver earnings and wallet payouts</h2>
            <p className="skima-muted">Earned, paid into a SKIMA Driver Wallet and externally withdrawn are different states. This view does not describe an in-app wallet credit as a bank withdrawal.</p>
          </div>
        </div>
        <div className="skima-grid skima-grid--compact">
          <MetricTile label="Driver earnings" value={money(fleet.driverEarnings, currency)} />
          <MetricTile label="Paid into Driver Wallets" value={money(fleet.driverPaidToWallet, currency)} />
          <MetricTile label="Still unpaid" value={money(fleet.driverUnpaidEarnings, currency)} tone={fleet.driverUnpaidEarnings > 0 ? "warning" : "success"} />
        </div>
        <h3>Recent payout batches</h3>
        <DataTable columns={payoutColumns} caption="SKIMA Fleet driver wallet payout batches" records={fleet.driverPayouts as RecordValue[]}
          getRowKey={(row) => recordString(row, "payoutId") ?? JSON.stringify(row)}
          emptyTitle="No driver payouts" emptyMessage="No driver wallet payouts found for this period." />
        <h3>Driver earning records</h3>
        <DataTable
          columns={[
            { key: "orderReference", header: "Order", render: (row) => recordString(row, "orderReference") ?? "—" },
            { key: "driverName", header: "Driver", render: (row) => recordString(row, "driverName") ?? "—" },
            { key: "basisAmount", header: "Delivery fee basis", render: (row) => money(numberValue(row, "basisAmount"), currency) },
            { key: "ratePercent", header: "Share", render: (row) => `${numberValue(row, "ratePercent")}%` },
            { key: "earningAmount", header: "Earned", render: (row) => money(numberValue(row, "earningAmount"), currency) },
            { key: "paidAmount", header: "Paid", render: (row) => money(numberValue(row, "paidAmount"), currency) },
            { key: "unpaidAmount", header: "Unpaid", render: (row) => money(numberValue(row, "unpaidAmount"), currency) },
            { key: "status", header: "Status", render: (row) => label(recordString(row, "status")) },
          ]}
          records={fleet.earningRecords as RecordValue[]}
          getRowKey={(row) => recordString(row, "earningId") ?? JSON.stringify(row)}
          caption="SKIMA Fleet driver earning records"
          emptyTitle="No driver earning records" emptyMessage="No internal Driver earning records found for this period."
        />
      </section>

      <section className="sk-panel stack-md">
        <div className="sk-panel__header"><div><p className="admin-section-kicker">Platform-wide finance</p><h2>Revenue, withdrawals and settlements</h2></div></div>
        {data.canReadRevenue && data.revenue ? (
          <div className="skima-grid skima-grid--compact">
            <MetricTile label="Gross SKIMA revenue credits" value={money(data.revenue.grossCredits, currency)} />
            <MetricTile label="Revenue reversals / debits" value={money(data.revenue.reversalsAndDebits, currency)} />
            <MetricTile label="Net SKIMA revenue" value={money(data.revenue.netRevenue, currency)} />
            <MetricTile label="Current revenue wallet" value={money(data.revenue.currentRevenueBalance, currency)} />
          </div>
        ) : (
          <p className="skima-muted">Revenue figures require platform revenue read permission.</p>
        )}
        <div className="skima-grid skima-grid--compact">
          <MetricTile label="Withdrawal requests" value={numberValue(data.withdrawals, "count")} />
          <MetricTile label="Withdrawals processed" value={money(numberValue(data.withdrawals, "processedAmount"), currency)} />
          <MetricTile label="Withdrawals pending" value={money(numberValue(data.withdrawals, "pendingAmount"), currency)} tone="warning" />
          <MetricTile label="Settlements posted" value={money(numberValue(data.settlements, "postedAmount"), currency)} />
        </div>
        <h3>Financial transaction summary</h3>
        <DataTable
          columns={[
            { key: "transactionType", header: "Type", render: (row) => label(recordString(row, "transactionType")) },
            { key: "status", header: "Status", render: (row) => label(recordString(row, "status")) },
            { key: "count", header: "Count", render: (row) => numberValue(row, "count").toLocaleString("en-NG") },
            { key: "amount", header: "Total amount", render: (row) => money(numberValue(row, "amount"), currency) },
          ]}
          caption="Financial transaction totals by type and status" records={data.transactionSummary as RecordValue[]}
          getRowKey={(row) => `${recordString(row, "transactionType") ?? "type"}:${recordString(row, "status") ?? "status"}`}
          emptyTitle="No transactions" emptyMessage="No financial transactions found for this period."
        />
      </section>

      <section className="sk-panel stack-md">
        <div className="sk-panel__header"><div><p className="admin-section-kicker">Evidence and reconciliation</p><h2>Recent financial transactions</h2></div></div>
        <DataTable columns={transactionColumns} caption="Recent financial transactions" records={data.recentTransactions as RecordValue[]}
          getRowKey={(row) => recordString(row, "transactionId") ?? JSON.stringify(row)}
          emptyTitle="No transactions" emptyMessage="No posted financial transactions found." />
        <h3>Recent wallet ledger entries</h3>
        <DataTable columns={ledgerColumns} caption="Recent wallet ledger activity" records={data.recentLedgerEntries as RecordValue[]}
          getRowKey={(row) => recordString(row, "ledgerEntryId") ?? JSON.stringify(row)}
          emptyTitle="No ledger activity" emptyMessage="No ledger activity found." />
        <h3>Platform wallet and accounting control balances</h3>
        <p className="skima-muted">The supplier disbursement control account is an expense-side ledger total, not cash available in a bank account. Platform clearing is a shared SKIMA-controlled account, not a separate Fleet bank wallet. Ledger balances are not bank statement balances.</p>
        <DataTable
          columns={[
            { key: "walletType", header: "Wallet class", render: (row) => label(recordString(row, "walletType")) },
            { key: "walletPurpose", header: "Purpose", render: (row) => label(recordString(row, "walletPurpose")) },
            { key: "currencyCode", header: "Currency", render: (row) => recordString(row, "currencyCode") ?? "—" },
            { key: "balance", header: "Ledger balance / control amount", render: (row) => money(numberValue(row, "balance"), recordString(row, "currencyCode") ?? currency) },
            { key: "walletId", header: "Wallet ID", render: (row) => shortId(recordString(row, "walletId")) },
          ]}
          caption="Platform-controlled wallet balances" records={data.walletBalances as RecordValue[]}
          getRowKey={(row) => recordString(row, "walletId") ?? JSON.stringify(row)}
          emptyTitle="No platform balances" emptyMessage="No platform wallet balances found."
        />
      </section>

      <p className="skima-muted">
        Accounting note: customer collections, supplier cash/bank disbursements, SKIMA revenue, driver wallet payouts and bank withdrawals are shown as separate events. Unrecorded off-app expenses cannot be inferred from an approved procurement record or a wallet balance. Reconcile receipts, bank statements and cash vouchers before treating an external payment as proven.
      </p>
    </div>
  );
}

function recordString(record: RecordValue | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(record: RecordValue | null | undefined, key: string): number {
  const value = record?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return 0;
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
  if (!value) return "—";
  return value.replace(/[._:-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function localDateTimeInput(value: Date): string {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function shortId(value: string | null): string {
  return value ? `${value.slice(0, 8)}…${value.slice(-4)}` : "—";
}

function readError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { readonly message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "The financial action could not be completed.";
}
