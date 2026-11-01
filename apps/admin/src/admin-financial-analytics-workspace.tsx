import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowDownLeft, ArrowUpRight, Banknote, CircleAlert, RefreshCcw, WalletCards } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { z } from "zod";

import { createClientIdempotencyKey, type ApiGatewayClient } from "@skima/frontend-core";
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
const UploadSessionSchema = z.object({
  token: z.string(),
  publicUrl: z.string().url(),
  signedUrl: z.string().url(),
  method: z.literal("PUT"),
  storageBucket: z.string(),
  storagePath: z.string(),
});
const MediaAssetSchema = z.object({ id: z.string().uuid() }).passthrough();
const RevenueSchema = z.object({
  currentRevenueBalance: z.coerce.number().default(0),
  netRevenue: z.coerce.number().default(0),
  grossCredits: z.coerce.number().default(0),
  reversalsAndDebits: z.coerce.number().default(0),
  entryCount: z.coerce.number().default(0),
  treasuryEntryCount: z.coerce.number().default(0),
  treasuryNetOutflow: z.coerce.number().default(0),
  byStream: z.array(RecordSchema).default([]),
  byComponent: z.array(RecordSchema).default([]),
}).passthrough();

const FleetSchema = z.object({
  orderCount: z.coerce.number().default(0),
  customerCollections: z.coerce.number().default(0),
  platformAllocatedCollections: z.coerce.number().default(0),
  unallocatedCustomerCollections: z.coerce.number().default(0),
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
  transactionSources: z.array(RecordSchema).default([]),
  platformAccountMovements: z.array(RecordSchema).default([]),
  withdrawals: RecordSchema.default({}),
  settlements: RecordSchema.default({}),
  settlementStatements: z.array(RecordSchema).default([]),
  financialAdjustments: z.array(RecordSchema).default([]),
  reconciliationFindings: z.array(RecordSchema).default([]),
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
    key: "supplierPricePerKg",
    header: "Supplier price / kg",
    render: (row) => money(numberValue(row, "supplierPricePerKg"), recordString(row, "currencyCode") ?? "NGN"),
  },
  {
    key: "referencePricePerKg",
    header: "Reference price / kg",
    render: (row) => money(numberValue(row, "referencePricePerKg"), recordString(row, "currencyCode") ?? "NGN"),
  },
  {
    key: "supplierVariancePercent",
    header: "Price variance",
    render: (row) => `${numberValue(row, "supplierVariancePercent").toFixed(2)}%`,
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
    header: "Supplier amount without payment record",
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
  {
    key: "evidenceMediaAssetId",
    header: "Supporting file",
    render: (row) => {
      const evidenceId = recordString(row, "evidenceMediaAssetId");
      return evidenceId
        ? <StatusBadge tone="success">Attached · {shortId(evidenceId)}</StatusBadge>
        : <StatusBadge tone="warning">Reference only</StatusBadge>;
    },
  },
  { key: "note", header: "Payment note", render: (row) => recordString(row, "note") ?? "—" },
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
  { key: "financialTransactionId", header: "Wallet ledger transaction", render: (row) => shortId(recordString(row, "financialTransactionId")) },
];

const transactionSourceColumns: readonly TableColumn<RecordValue>[] = [
  { key: "source", header: "Financial source", render: (row) => recordString(row, "source") ?? "—" },
  { key: "transactionType", header: "Type", render: (row) => label(recordString(row, "transactionType")) },
  { key: "status", header: "Status", render: (row) => label(recordString(row, "status")) },
  { key: "count", header: "Entries", render: (row) => numberValue(row, "count").toLocaleString("en-NG") },
  { key: "amount", header: "Total amount", render: (row) => money(numberValue(row, "amount"), recordString(row, "currencyCode") ?? "NGN") },
];

const accountMovementColumns: readonly TableColumn<RecordValue>[] = [
  { key: "walletType", header: "Account type", render: (row) => label(recordString(row, "walletType")) },
  { key: "walletPurpose", header: "Account purpose", render: (row) => label(recordString(row, "walletPurpose")) },
  { key: "direction", header: "Movement", render: (row) => <StatusBadge tone={recordString(row, "direction") === "credit" ? "success" : "warning"}>{label(recordString(row, "direction"))}</StatusBadge> },
  { key: "entryType", header: "Entry classification", render: (row) => label(recordString(row, "entryType")) },
  { key: "source", header: "Source", render: (row) => recordString(row, "source") ?? "—" },
  { key: "count", header: "Entries", render: (row) => numberValue(row, "count").toLocaleString("en-NG") },
  { key: "amount", header: "Total movement", render: (row) => money(numberValue(row, "amount"), "NGN") },
];

const transactionColumns: readonly TableColumn<RecordValue>[] = [
  { key: "createdAt", header: "Date", render: (row) => formatDate(recordString(row, "createdAt")) },
  { key: "transactionType", header: "Type", render: (row) => label(recordString(row, "transactionType")) },
  { key: "source", header: "Source", render: (row) => recordString(row, "source") ?? "—" },
  { key: "status", header: "Status", render: (row) => <StatusBadge tone={recordString(row, "status") === "posted" ? "success" : "warning"}>{label(recordString(row, "status"))}</StatusBadge> },
  { key: "amount", header: "Amount", render: (row) => money(numberValue(row, "amount"), recordString(row, "currencyCode") ?? "NGN") },
  { key: "externalReference", header: "Reference", render: (row) => recordString(row, "externalReference") ?? "—" },
  { key: "transactionId", header: "Transaction ID", render: (row) => shortId(recordString(row, "transactionId")) },
  { key: "subject", header: "Linked subject", render: (row) => `${label(recordString(row, "subjectType"))} · ${shortId(recordString(row, "subjectId"))}` },
  {
    key: "metadata",
    header: "Evidence details",
    render: (row) => {
      const metadata = recordObject(row, "metadata");
      if (!metadata) return "—";
      const references = [
        recordString(metadata, "lpg_public_reference"),
        recordString(metadata, "lpg_order_id"),
        recordString(metadata, "payoutReference"),
        recordString(metadata, "payment_reference"),
      ].filter(Boolean).join(" · ");
      return (
        <div className="stack-xs">
          <span>{references || "See source record"}</span>
          <details>
            <summary>Full transaction metadata</summary>
            <pre style={{ maxWidth: "560px", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {JSON.stringify(metadata, null, 2)}
            </pre>
          </details>
        </div>
      );
    },
  },
];

const settlementStatementColumns: readonly TableColumn<RecordValue>[] = [
  { key: "publicReference", header: "Statement", render: (row) => <strong>{recordString(row, "publicReference") ?? "—"}</strong> },
  { key: "createdAt", header: "Created", render: (row) => formatDate(recordString(row, "createdAt")) },
  { key: "grossAmount", header: "Gross", render: (row) => money(numberValue(row, "grossAmount"), recordString(row, "currencyCode") ?? "NGN") },
  { key: "platformFeeAmount", header: "Platform fee", render: (row) => money(numberValue(row, "platformFeeAmount"), recordString(row, "currencyCode") ?? "NGN") },
  { key: "netAmount", header: "Net", render: (row) => money(numberValue(row, "netAmount"), recordString(row, "currencyCode") ?? "NGN") },
  { key: "status", header: "Status", render: (row) => <StatusBadge tone={recordString(row, "status") === "posted" ? "success" : "warning"}>{label(recordString(row, "status"))}</StatusBadge> },
  { key: "source", header: "Source", render: (row) => recordString(row, "source") ?? "—" },
  { key: "settlementExecutionId", header: "Execution", render: (row) => shortId(recordString(row, "settlementExecutionId")) },
];

const adjustmentColumns: readonly TableColumn<RecordValue>[] = [
  { key: "createdAt", header: "Created", render: (row) => formatDate(recordString(row, "createdAt")) },
  { key: "orderReference", header: "Order", render: (row) => recordString(row, "orderReference") ?? shortId(recordString(row, "orderId")) },
  { key: "adjustmentType", header: "Adjustment", render: (row) => label(recordString(row, "adjustmentType")) },
  { key: "amount", header: "Amount", render: (row) => money(numberValue(row, "amount"), recordString(row, "currencyCode") ?? "NGN") },
  { key: "status", header: "Status", render: (row) => <StatusBadge tone={recordString(row, "status") === "posted" ? "success" : recordString(row, "status") === "blocked" ? "warning" : "neutral"}>{label(recordString(row, "status"))}</StatusBadge> },
  { key: "reasonKey", header: "Reason", render: (row) => label(recordString(row, "reasonKey")) },
  { key: "transactionId", header: "Ledger transaction", render: (row) => shortId(recordString(row, "transactionId")) },
];

const reconciliationColumns: readonly TableColumn<RecordValue>[] = [
  {
    key: "severity",
    header: "Severity",
    render: (row) => {
      const severity = recordString(row, "severity");
      return <StatusBadge tone={severity === "critical" ? "danger" : severity === "high" ? "warning" : "neutral"}>{label(severity)}</StatusBadge>;
    },
  },
  { key: "findingType", header: "Finding", render: (row) => label(recordString(row, "findingType")) },
  { key: "subjectType", header: "Subject", render: (row) => `${label(recordString(row, "subjectType"))} · ${shortId(recordString(row, "subjectId"))}` },
  { key: "expectedAmount", header: "Expected", render: (row) => money(numberValue(row, "expectedAmount"), recordString(row, "currencyCode") ?? "NGN") },
  { key: "observedAmount", header: "Observed", render: (row) => money(numberValue(row, "observedAmount"), recordString(row, "currencyCode") ?? "NGN") },
  { key: "varianceAmount", header: "Variance", render: (row) => money(numberValue(row, "varianceAmount"), recordString(row, "currencyCode") ?? "NGN") },
  {
    key: "evidence",
    header: "Evidence posture",
    render: (row) => {
      const evidence = recordObject(row, "evidence");
      const advisoryOnly = evidence?.advisoryOnly === true;
      const noMovement = evidence?.doesNotMoveFunds === true && evidence?.doesNotPostLedger === true;
      if (!evidence) return <StatusBadge tone="neutral">Evidence unavailable</StatusBadge>;
      const currency = recordString(row, "currencyCode") ?? "NGN";
      const breakdown = [
        `Hold ${money(recordNumber(evidence, "holdTotal"), currency)}`,
        `Quote ${money(recordNumber(evidence, "quoteTotal"), currency)}`,
        `Order ${money(recordNumber(evidence, "orderTotal"), currency)}`,
        `Release ${money(recordNumber(evidence, "releaseTotal"), currency)}`,
        `Refund ${money(recordNumber(evidence, "refundTotal"), currency)}`,
      ].join(" · ");
      return (
        <div className="stack-xs">
          <span>{breakdown}</span>
          {advisoryOnly && noMovement
            ? <StatusBadge tone="warning">Advisory only · no funds moved or ledger posted</StatusBadge>
            : <StatusBadge tone="neutral">Review authoritative records</StatusBadge>}
          <details>
            <summary>Full reconciliation evidence</summary>
            <pre style={{ maxWidth: "560px", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {JSON.stringify(evidence, null, 2)}
            </pre>
          </details>
        </div>
      );
    },
  },
  { key: "recommendedAction", header: "Recommended review", render: (row) => recordString(row, "recommendedAction") ?? "Review source records." },
];

const ledgerColumns: readonly TableColumn<RecordValue>[] = [
  { key: "createdAt", header: "Date", render: (row) => formatDate(recordString(row, "createdAt")) },
  { key: "walletType", header: "Account", render: (row) => label(recordString(row, "walletPurpose") ?? recordString(row, "walletType")) },
  { key: "direction", header: "Movement", render: (row) => <StatusBadge tone={recordString(row, "direction") === "credit" ? "success" : "warning"}>{label(recordString(row, "direction"))}</StatusBadge> },
  { key: "amount", header: "Amount", render: (row) => money(numberValue(row, "amount"), "NGN") },
  { key: "source", header: "Source", render: (row) => recordString(row, "source") ?? "—" },
  { key: "reference", header: "Reference", render: (row) => recordString(row, "reference") ?? "—" },
  { key: "transactionStatus", header: "Transaction status", render: (row) => label(recordString(row, "transactionStatus")) },
  {
    key: "role",
    header: "Ledger role",
    render: (row) => {
      const metadata = recordObject(row, "metadata");
      if (!metadata) return "—";
      return (
        <div className="stack-xs">
          <span>{label(recordString(metadata, "role"))}</span>
          <details>
            <summary>Full ledger metadata</summary>
            <pre style={{ maxWidth: "560px", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {JSON.stringify(metadata, null, 2)}
            </pre>
          </details>
        </div>
      );
    },
  },
  {
    key: "linkedOrder",
    header: "Linked order / procurement",
    render: (row) => {
      const metadata = recordObject(row, "metadata");
      return shortId(recordString(metadata, "lpg_order_id") ?? recordString(metadata, "procurement_id"));
    },
  },
];

export function AdminFinancialAnalyticsWorkspace() {
  const { api, supabase, status, context } = useSessionState();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState("30");
  const [currency, setCurrency] = useState("NGN");
  const [selectedOrder, setSelectedOrder] = useState<FleetOrder | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank_transfer">("bank_transfer");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => localDateTimeInput(new Date()));
  const supplierPaymentAttemptsRef = useRef(new Map<string, string>());
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceMediaAssetId, setEvidenceMediaAssetId] = useState<string | null>(null);
  const [evidenceFileName, setEvidenceFileName] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<"success" | "danger">("success");

  const isSuperAdmin = context?.platformAdmin?.admin_kind === "super_admin";
  const canRead = Boolean(isSuperAdmin ||
    context?.permissions.includes("platform.financial.read") ||
    context?.permissions.includes("platform.financial.manage"));
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

  const uploadEvidence = useMutation({
    mutationFn: async () => {
      if (!evidenceFile) throw new Error("Choose a bank receipt, transfer confirmation or cash voucher first.");
      const ownerUserId = context?.user.id;
      if (!ownerUserId) throw new Error("The authenticated Admin identity is unavailable.");
      if (evidenceFile.size <= 0 || evidenceFile.size > 10 * 1024 * 1024) {
        throw new Error("Payment evidence must be a non-empty file no larger than 10 MB.");
      }
      const contentType = evidenceFile.type || "application/octet-stream";
      if (!(contentType.startsWith("image/") || contentType === "application/pdf")) {
        throw new Error("Payment evidence must be an image or PDF document.");
      }
      const upload = await api.post(
        "/runtime/media/upload-sessions",
        {
          contentType,
          fileName: evidenceFile.name,
          idempotencyKey: createClientIdempotencyKey("admin.lpg.supplier-payment.upload", evidenceFile.name),
          storageBucket: "skima-platform-media",
        },
        UploadSessionSchema,
      );
      const stored = await supabase.storage
        .from(upload.storageBucket)
        .uploadToSignedUrl(upload.storagePath, upload.token, evidenceFile, {
          contentType,
          upsert: true,
        });
      if (stored.error) throw new Error(stored.error.message || "The payment evidence upload did not complete.");
      const media = await api.post(
        "/runtime/media/assets",
        {
          assetTypeKey: "media.lpg.supplier_payment_evidence",
          byteSize: evidenceFile.size,
          contentType,
          idempotencyKey: createClientIdempotencyKey("admin.lpg.supplier-payment.asset", evidenceFile.name),
          metadata: {
            originalFileName: evidenceFile.name,
            purpose: "SKIMA Fleet supplier payment evidence",
            procurementId: recordString(selectedOrder, "procurementId"),
            orderReference: recordString(selectedOrder, "orderReference"),
          },
          ownerUserId,
          source: "skima.admin.financial.analytics",
          storageBucket: upload.storageBucket,
          storagePath: upload.storagePath,
        },
        MediaAssetSchema,
      );
      return { id: media.id, fileName: evidenceFile.name };
    },
    onSuccess: (result) => {
      setEvidenceMediaAssetId(result.id);
      setEvidenceFileName(result.fileName);
      setNotice("Payment evidence uploaded and registered in SKIMA media records.");
      setNoticeTone("success");
    },
    onError: (error) => {
      setNotice(readError(error));
      setNoticeTone("danger");
    },
  });

  const recordSupplierPayment = useMutation({
    mutationFn: async () => {
      if (!selectedOrder) throw new Error("Choose the supplier order to record.");
      const amount = Number(paymentAmount);
      const outstanding = numberValue(selectedOrder, "supplierOutstanding");
      if (!Number.isFinite(amount) || amount <= 0 || amount > outstanding) {
        throw new Error("Enter a positive amount no greater than the supplier amount not yet matched to a recorded payment.");
      }
      if (!paymentReference.trim()) {
        throw new Error(paymentMethod === "bank_transfer"
          ? "Enter the bank transfer reference before recording this payment."
          : "Enter the cash voucher or receipt reference before recording this payment.");
      }
      if (evidenceFile && !evidenceMediaAssetId) {
        throw new Error("Upload the selected evidence file before recording the supplier payment.");
      }
      const paidAt = new Date(paymentDate);
      if (!paymentDate || !Number.isFinite(paidAt.getTime())) {
        throw new Error("Enter a valid supplier payment date and time.");
      }
      const procurementId = recordString(selectedOrder, "procurementId");
      if (!procurementId) throw new Error("The selected Fleet order is missing its procurement record.");
      const paymentReferenceValue = paymentReference.trim();
      const paymentNoteValue = paymentNote.trim();
      const paidAtValue = paidAt.toISOString();
      const paymentFingerprint = JSON.stringify([
        procurementId,
        amount,
        paymentMethod,
        paymentReferenceValue,
        evidenceMediaAssetId,
        paymentNoteValue,
        paidAtValue,
      ]);
      const paymentIdempotencyKey = supplierPaymentAttemptsRef.current.get(paymentFingerprint)
        ?? createClientIdempotencyKey("admin.lpg.supplier-payment", paymentFingerprint);
      supplierPaymentAttemptsRef.current.set(paymentFingerprint, paymentIdempotencyKey);
      const { data, error } = await supabase.rpc("record_lpg_internal_supplier_payment", {
        target_procurement_id: procurementId,
        target_amount: amount,
        target_payment_method: paymentMethod,
        target_payment_reference: paymentReferenceValue,
        target_evidence_media_asset_id: evidenceMediaAssetId,
        target_note: paymentNoteValue || null,
        target_idempotency_key: paymentIdempotencyKey,
        target_paid_at: paidAtValue,
      });
      if (error) throw error;
      return data as RecordValue;
    },
    onSuccess: async (result) => {
      setNotice(
        `Supplier payment accounting record posted · ${money(numberValue(result, "amount"), recordString(result, "currencyCode") ?? currency)} · ${recordString(result, "orderReference") ?? ""}`,
      );
      setNoticeTone("success");
      setSelectedOrder(null);
      setPaymentAmount("");
      setPaymentReference("");
      setPaymentNote("");
      setPaymentDate(localDateTimeInput(new Date()));
      supplierPaymentAttemptsRef.current.clear();
      setEvidenceFile(null);
      setEvidenceMediaAssetId(null);
      setEvidenceFileName(null);
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
        message="This workspace requires platform Finance read or manage permission. Revenue read permission alone does not grant access to supplier costs, Driver payouts or platform wallet activity."
      />
    );
  }

  if (analytics.isPending) return <LoadingState label="Loading financial analytics from the ledger…" />;
  if (analytics.error || !analytics.data) {
    return (
      <ErrorState
        title="Financial analytics unavailable"
        message="The live ledger analytics service did not return data. Retry after checking your Finance access. If the problem continues, share this screen and the time of the failure with Platform Admin."
        onRetry={() => void refresh()}
      />
    );
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

  const openSupplierEvidence = async (row: RecordValue) => {
    const bucket = recordString(row, "evidenceStorageBucket");
    const storagePath = recordString(row, "evidenceStoragePath");
    if (!bucket || !storagePath) {
      setNotice("No stored payment evidence is attached to this supplier payment.");
      setNoticeTone("danger");
      return;
    }
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setNotice("Allow pop-ups for SKIMA Admin to open private payment evidence.");
      setNoticeTone("danger");
      return;
    }
    popup.opener = null;
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 300);
    if (error || !data?.signedUrl) {
      popup.close();
      setNotice(error?.message ?? "The payment evidence link could not be created.");
      setNoticeTone("danger");
      return;
    }
    popup.location.href = data.signedUrl;
  };

  const paymentColumnsWithEvidence: readonly TableColumn<RecordValue>[] = [
    ...paymentColumns,
    {
      key: "openEvidence",
      header: "Evidence file",
      render: (row) => recordString(row, "evidenceStoragePath")
        ? <Button variant="outline" onClick={() => { void openSupplierEvidence(row); }}>View file</Button>
        : <StatusBadge tone="warning">No file attached</StatusBadge>,
    },
  ];


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
        <MetricTile label="Supplier payments recorded" value={money(fleet.supplierPaid, currency)} icon={Banknote} />
        <MetricTile label="Driver paid to SKIMA Wallet" value={money(fleet.driverPaidToWallet, currency)} icon={WalletCards} />
        <MetricTile label="Supplier amount without payment record" value={money(fleet.supplierOutstanding, currency)} icon={CircleAlert} tone={fleet.supplierOutstanding > 0 ? "warning" : "success"} />
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
          <MetricTile label="Full amount credited to SKIMA-controlled accounts" value={money(fleet.platformAllocatedCollections, currency)} />
          <MetricTile
            label="Unallocated customer collection"
            value={money(fleet.unallocatedCustomerCollections, currency)}
            tone={Math.abs(fleet.unallocatedCustomerCollections) > 0.01 ? "warning" : "success"}
          />
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
            <p className="skima-muted">Each row reconciles the customer amount collected by SKIMA against the actual station purchase cost and payment records. The amount not matched to a payment record is not proof that the station has not physically been paid. Payment entries are Admin-recorded declarations; supporting files and transaction references are shown for reconciliation.</p>
          </div>
        </div>
        <DataTable columns={orderColumns} caption="SKIMA Fleet orders and supplier balances" records={fleet.orders as FleetOrder[]}
          getRowKey={(row) => recordString(row, "orderId") ?? JSON.stringify(row)}
          emptyTitle="No SKIMA Fleet orders" emptyMessage="No settled SKIMA Fleet procurement records are available for this period." />
        {canRecordSupplierPayment && fleet.orders.some((order) => numberValue(order, "supplierOutstanding") > 0) ? (
          <div className="skima-form-grid">
            <SelectInput
              label="Order with supplier amount not yet recorded as paid"
              value={recordString(selectedOrder, "orderId") ?? ""}
              options={fleet.orders
                .filter((order) => numberValue(order, "supplierOutstanding") > 0)
                .map((order) => ({
                  label: `${recordString(order, "orderReference") ?? "Order"} · ${money(numberValue(order, "supplierOutstanding"), currency)} not yet recorded`,
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
                setSupplierPaymentIdempotencyKey(null);
                setEvidenceFile(null);
                setEvidenceMediaAssetId(null);
                setEvidenceFileName(null);
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
              onChange={(event) => {
                setPaymentAmount(event.currentTarget.value);
                setSupplierPaymentIdempotencyKey(null);
              }}
            />
            <SelectInput
              label="How SKIMA paid the station"
              value={paymentMethod}
              options={[
                { label: "Bank transfer", value: "bank_transfer" },
                { label: "Physical cash", value: "cash" },
              ]}
              onChange={(event) => {
                setPaymentMethod(event.currentTarget.value as "cash" | "bank_transfer");
                setSupplierPaymentIdempotencyKey(null);
              }}
            />
            <TextInput
              label={paymentMethod === "bank_transfer" ? "Bank transfer reference (required)" : "Cash voucher / receipt reference (required)"}
              value={paymentReference}
              onChange={(event) => {
                setPaymentReference(event.currentTarget.value);
                setSupplierPaymentIdempotencyKey(null);
              }}
              disabled={!selectedOrder}
              placeholder={paymentMethod === "bank_transfer" ? "Enter the bank transaction reference" : "Enter the cash voucher or signed handover reference"}
            />
            <TextInput
              label="Actual supplier payment date and time"
              type="datetime-local"
              value={paymentDate}
              onChange={(event) => {
                setPaymentDate(event.currentTarget.value);
                setSupplierPaymentIdempotencyKey(null);
              }}
              disabled={!selectedOrder}
            />
            <TextInput
              label="Payment evidence file (optional)"
              type="file"
              accept="image/*,.pdf"
              disabled={!selectedOrder || uploadEvidence.isPending}
              onChange={(event) => {
                setEvidenceFile(event.currentTarget.files?.[0] ?? null);
                setSupplierPaymentIdempotencyKey(null);
                setEvidenceMediaAssetId(null);
                setEvidenceFileName(null);
              }}
            />
            <div className="skima-action-row">
              <Button
                variant="outline"
                disabled={!selectedOrder || !evidenceFile || uploadEvidence.isPending}
                isLoading={uploadEvidence.isPending}
                onClick={() => uploadEvidence.mutate()}
              >
                Upload payment evidence
              </Button>
              {evidenceMediaAssetId ? (
                <StatusBadge tone="success">Evidence attached: {evidenceFileName ?? "File uploaded"}</StatusBadge>
              ) : evidenceFile ? (
                <StatusBadge tone="warning">File selected · upload required before recording</StatusBadge>
              ) : (
                <StatusBadge>Optional · 10 MB maximum · image or PDF</StatusBadge>
              )}
            </div>
            <TextAreaInput
              label="Payment note (optional)"
              value={paymentNote}
              onChange={(event) => {
                setPaymentNote(event.currentTarget.value);
                setSupplierPaymentIdempotencyKey(null);
              }}
              rows={2}
              disabled={!selectedOrder}
              placeholder="Recipient or cash handover details"
            />
            <div className="sk-panel">
              <strong>Payment control</strong>
              <p className="skima-muted">Use this to record a supplier payment SKIMA has already made. The order must first have a posted SKIMA customer collection. Enter the actual earlier payment time when back-recording. This creates the internal accounting allocation from SKIMA clearing to the supplier-cost control ledger; it does not initiate a bank transfer or independently verify the bank. Both methods require a bank reference or cash voucher / signed handover reference.</p>
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
          <div><p className="admin-section-kicker">Supplier expenses</p><h2>Admin-recorded SKIMA payments to stations</h2></div>
          <StatusBadge tone="neutral">Separate from customer collections</StatusBadge>
        </div>
        <DataTable columns={paymentColumnsWithEvidence} caption="Supplier payment history" records={fleet.supplierPayments as RecordValue[]}
          getRowKey={(row) => recordString(row, "id") ?? JSON.stringify(row)}
          emptyTitle="No supplier payments recorded" emptyMessage="No supplier disbursement entries have been recorded yet. This means the database has no payment evidence; it does not prove the station was not physically paid." />
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
          <>
            <div className="skima-grid skima-grid--compact">
              <MetricTile label="Gross SKIMA revenue credits" value={money(data.revenue.grossCredits, currency)} />
              <MetricTile label="Revenue reversals / debits" value={money(data.revenue.reversalsAndDebits, currency)} />
              <MetricTile label="Net SKIMA revenue" value={money(data.revenue.netRevenue, currency)} />
              <MetricTile label="Current revenue wallet" value={money(data.revenue.currentRevenueBalance, currency)} />
              <MetricTile label="Treasury net outflow" value={money(data.revenue.treasuryNetOutflow, currency)} />
              <MetricTile label="Treasury entries" value={data.revenue.treasuryEntryCount} />
            </div>
            <h3>Net revenue by stream</h3>
            <DataTable
              columns={[
                { key: "key", header: "Revenue stream", render: (row) => label(recordString(row, "key")) },
                { key: "amount", header: "Net amount", render: (row) => money(numberValue(row, "amount"), currency) },
              ]}
              caption="Net revenue by accounting stream"
              records={data.revenue.byStream as RecordValue[]}
              getRowKey={(row) => recordString(row, "key") ?? JSON.stringify(row)}
              emptyTitle="No classified revenue streams"
              emptyMessage="No revenue stream totals were returned for the selected period."
            />
            <h3>Net revenue by component</h3>
            <DataTable
              columns={[
                { key: "stream", header: "Stream", render: (row) => label(recordString(row, "stream")) },
                { key: "component", header: "Component", render: (row) => label(recordString(row, "component")) },
                { key: "amount", header: "Net amount", render: (row) => money(numberValue(row, "amount"), currency) },
              ]}
              caption="Revenue components"
              records={data.revenue.byComponent as RecordValue[]}
              getRowKey={(row) => `${recordString(row, "stream") ?? "stream"}:${recordString(row, "component") ?? "component"}`}
              emptyTitle="No classified revenue components"
              emptyMessage="No revenue component totals were returned for the selected period."
            />
          </>
        ) : (
          <p className="skima-muted">Revenue figures require platform revenue read permission.</p>
        )}
        <div className="skima-grid skima-grid--compact">
          <MetricTile label="Withdrawal requests" value={numberValue(data.withdrawals, "count")} />
          <MetricTile label="Withdrawals processed" value={money(numberValue(data.withdrawals, "processedAmount"), currency)} />
          <MetricTile label="Withdrawals pending" value={money(numberValue(data.withdrawals, "pendingAmount"), currency)} tone="warning" />
          <MetricTile label="Settlements posted" value={money(numberValue(data.settlements, "postedAmount"), currency)} />
        </div>
        <h3>Settlement statements</h3>
        <p className="skima-muted">Statements are counterpart/order-level settlement documents. A posted ledger transaction does not automatically mean a settlement statement exists for that order.</p>
        <DataTable
          columns={settlementStatementColumns}
          caption="Settlement statement records"
          records={data.settlementStatements as RecordValue[]}
          getRowKey={(row) => recordString(row, "id") ?? JSON.stringify(row)}
          emptyTitle="No settlement statements in this period"
          emptyMessage="No statement records were generated for the selected period and currency."
        />
        <h3>Financial adjustments and exceptions</h3>
        <DataTable
          columns={adjustmentColumns}
          caption="LPG financial adjustments"
          records={data.financialAdjustments as RecordValue[]}
          getRowKey={(row) => recordString(row, "id") ?? JSON.stringify(row)}
          emptyTitle="No financial adjustments"
          emptyMessage="No LPG financial adjustments were recorded for the selected period and currency."
        />
        <h3>Open reconciliation findings</h3>
        <p className="skima-muted">These are review findings, not instructions to move money. Advisory findings must be reconciled to the original quote, escrow, settlement and refund records before any adjustment is made.</p>
        <DataTable
          columns={reconciliationColumns}
          caption="Finance reconciliation findings"
          records={data.reconciliationFindings as RecordValue[]}
          getRowKey={(row) => recordString(row, "id") ?? recordString(row, "findingKey") ?? JSON.stringify(row)}
          emptyTitle="No open reconciliation findings"
          emptyMessage="No open findings at the configured severity threshold were returned."
        />
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
        <h3>Financial activity by originating source</h3>
        <DataTable
          columns={transactionSourceColumns}
          caption="Transaction totals by source system"
          records={data.transactionSources as RecordValue[]}
          getRowKey={(row) => `${recordString(row, "source") ?? "source"}:${recordString(row, "transactionType") ?? "type"}:${recordString(row, "status") ?? "status"}`}
          emptyTitle="No source breakdown"
          emptyMessage="No transaction-source totals were returned for this period."
        />
        <h3>Platform account inflows and outflows</h3>
        <p className="skima-muted">These totals are ledger movements by account class and originating source. They are not bank statement totals and should not be added together as if they were separate cash balances.</p>
        <DataTable
          columns={accountMovementColumns}
          caption="Platform wallet movement by source"
          records={data.platformAccountMovements as RecordValue[]}
          getRowKey={(row) => [
            recordString(row, "walletType"),
            recordString(row, "direction"),
            recordString(row, "entryType"),
            recordString(row, "source"),
          ].join(":")}
          emptyTitle="No platform account movements"
          emptyMessage="No platform wallet ledger movements were returned for this period."
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

function recordObject(record: RecordValue | null | undefined, key: string): RecordValue | null {
  const value = record?.[key];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function recordNumber(record: RecordValue | null | undefined, key: string): number {
  const value = record?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return 0;
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
