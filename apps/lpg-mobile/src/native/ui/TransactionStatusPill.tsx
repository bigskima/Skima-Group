import { transactionStatusPresentation } from "../utilities/transactionStatus";
import { StatusPill } from "./StatusPill";

export function TransactionStatusPill({ status }: { status: string | null | undefined }) {
  const presentation = transactionStatusPresentation(status);
  return <StatusPill label={presentation.label} tone={presentation.tone} />;
}
