import { useMutation } from "@tanstack/react-query";
import { RefreshCcw, ShieldCheck } from "lucide-react";

import { Button, MetricTile, StatusBadge } from "@skima/ui";

import { useSessionState } from "../../session";
import { AdminV2PageHeader } from "../../shared/patterns/AdminV2Patterns";
import {
  UtilityMutationIdSchema,
  formatUtilityNaira,
  friendlyUtilityText,
  utilityError,
  utilityNumber,
  utilityText,
  type UtilitySnapshot,
} from "./utility-billing-v2-shared";

export function UtilityOperationsScreen(props: { data: UtilitySnapshot; refresh: () => Promise<void> }) {
  const { api } = useSessionState();
  const retry = useMutation({
    mutationFn: (requestId: string) => api.post(
      "/admin/utility-billing/payments/reconcile",
      { requestId },
      UtilityMutationIdSchema,
    ),
    onSuccess: props.refresh,
  });

  const unresolved = props.data.payments.filter((payment) =>
    ["processing", "reconciliation_required"].includes(utilityText(payment, "status"))
  );
  const failed = props.data.payments.filter((payment) => utilityText(payment, "status") === "failed");
  const successful = props.data.payments.filter((payment) => ["successful", "completed", "fulfilled"].includes(utilityText(payment, "status")));
  const recent = props.data.payments.slice(0, 35);

  return (
    <div className="utility-v2__screen">
      <AdminV2PageHeader
        eyebrow="Utility billing · Operations"
        title="Payment operations"
        description="Review provider outcomes and reconcile ambiguous payments without repeating a purchase or prematurely releasing reserved customer funds."
        actions={<Button icon={RefreshCcw} variant="outline" onClick={() => void props.refresh()}>Refresh</Button>}
      />

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Recent utility payments" value={props.data.payments.length} icon={RefreshCcw} />
        <MetricTile label="Needs reconciliation" value={unresolved.length} icon={RefreshCcw} tone={unresolved.length ? "warning" : "success"} />
        <MetricTile label="Successful" value={successful.length} icon={ShieldCheck} tone="success" />
        <MetricTile label="Failed" value={failed.length} icon={ShieldCheck} tone={failed.length ? "warning" : "success"} />
      </section>

      <section className="admin-notice">
        <strong>Provider status is authoritative</strong>
        <p>A timeout does not mean failure. SKIMA keeps funds reserved and queries the provider status rather than repeating a vend or automatically refunding an uncertain transaction.</p>
      </section>

      <section className="sk-panel">
        <div className="sk-panel__header"><div><h2>Recent payment activity</h2><p className="skima-muted">Only unresolved payments expose a manual provider-status retry.</p></div><StatusBadge tone={unresolved.length ? "warning" : "success"}>{unresolved.length} unresolved</StatusBadge></div>
        <div className="utility-v2__record-list">
          {recent.map((payment) => {
            const requestId = utilityText(payment, "id");
            const paymentStatus = utilityText(payment, "status") || "unknown";
            const canRetry = ["processing", "reconciliation_required"].includes(paymentStatus);
            return (
              <article className="utility-v2__record" key={requestId || utilityText(payment, "public_reference")}>
                <span className="utility-v2__record-copy">
                  <strong>{utilityText(payment, "public_reference") || "Utility payment"}</strong>
                  <small>{friendlyUtilityText(paymentStatus)} · {formatUtilityNaira(utilityNumber(payment, "total_amount"))}</small>
                  {utilityText(payment, "provider_reference") ? <small>Provider ref: {utilityText(payment, "provider_reference")}</small> : null}
                  {utilityText(payment, "last_error_message") ? <small>{utilityText(payment, "last_error_message")}</small> : null}
                </span>
                {canRetry ? (
                  <Button size="sm" variant="outline" isLoading={retry.isPending && retry.variables === requestId} disabled={!requestId} onClick={() => retry.mutate(requestId)}>Retry provider status</Button>
                ) : (
                  <StatusBadge tone={statusTone(paymentStatus)}>{friendlyUtilityText(paymentStatus)}</StatusBadge>
                )}
              </article>
            );
          })}
          {recent.length === 0 ? <p className="skima-muted">No utility transactions yet. Live customer transactions will appear after a provider route is activated.</p> : null}
        </div>
      </section>
      {retry.error ? <StatusBadge tone="danger">{utilityError(retry.error)}</StatusBadge> : null}
    </div>
  );
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (["successful", "completed", "fulfilled"].includes(status)) return "success";
  if (["processing", "reconciliation_required", "pending"].includes(status)) return "warning";
  if (["failed", "rejected", "cancelled"].includes(status)) return "danger";
  return "neutral";
}
