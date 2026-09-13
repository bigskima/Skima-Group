export type CanonicalTransactionStatus =
  | "successful"
  | "pending"
  | "processing"
  | "cancelled"
  | "failed"
  | "reversed"
  | "refunded"
  | "expired"
  | "unknown";

export type TransactionStatusTone = "neutral" | "brand" | "success" | "warning" | "danger";

export interface TransactionStatusPresentation {
  readonly status: CanonicalTransactionStatus;
  readonly label: string;
  readonly explanation: string;
  readonly tone: TransactionStatusTone;
  readonly fundsAdded: boolean;
  readonly terminal: boolean;
}

export function canonicalTransactionStatus(value: string | null | undefined): CanonicalTransactionStatus {
  const normalized = (value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) return "unknown";
  if (/refund/.test(normalized)) return "refunded";
  if (/revers/.test(normalized)) return "reversed";
  if (/cancel/.test(normalized)) return "cancelled";
  if (/expir/.test(normalized)) return "expired";
  if (/fail|reject|declin|error|dead_letter/.test(normalized)) return "failed";
  if (/processing|confirming|authorizing|authorising|queued|initiated/.test(normalized)) return "processing";
  if (/pending|reserved|hold|review|awaiting/.test(normalized)) return "pending";
  if (/success|succeed|complete|confirm|posted|paid|settled|credited|released|delivered/.test(normalized)) return "successful";
  return "unknown";
}

export function transactionStatusPresentation(value: string | null | undefined): TransactionStatusPresentation {
  const status = canonicalTransactionStatus(value);
  switch (status) {
    case "successful":
      return { status, label: "Successful", explanation: "Funds were successfully processed.", tone: "success", fundsAdded: true, terminal: true };
    case "pending":
      return { status, label: "Pending", explanation: "Payment confirmation is still pending.", tone: "warning", fundsAdded: false, terminal: false };
    case "processing":
      return { status, label: "Processing", explanation: "SKIMA is still processing this transaction.", tone: "brand", fundsAdded: false, terminal: false };
    case "cancelled":
      return { status, label: "Cancelled", explanation: "The transaction was cancelled and funds were not added.", tone: "neutral", fundsAdded: false, terminal: true };
    case "failed":
      return { status, label: "Failed", explanation: "The payment attempt was unsuccessful.", tone: "danger", fundsAdded: false, terminal: true };
    case "reversed":
      return { status, label: "Reversed", explanation: "The transaction was reversed after processing.", tone: "danger", fundsAdded: false, terminal: true };
    case "refunded":
      return { status, label: "Refunded", explanation: "Funds were returned.", tone: "brand", fundsAdded: false, terminal: true };
    case "expired":
      return { status, label: "Expired", explanation: "The payment window expired before completion.", tone: "neutral", fundsAdded: false, terminal: true };
    default:
      return { status, label: "Recorded", explanation: "This transaction has been recorded by SKIMA.", tone: "neutral", fundsAdded: false, terminal: false };
  }
}
