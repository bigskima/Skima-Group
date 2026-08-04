import { AlertTriangle, Headphones, ShieldAlert } from "lucide-react";
import { type FormEvent, useState } from "react";

import { useOrdersQuery } from "@lpg/features/orders/api";
import { ActionResponseSchema, createLpgIdempotencyKey, displayReference, getRecordId, type ActionResult } from "@lpg/shared/api/records";
import { useGatewayMutation } from "@lpg/shared/api/useGatewayMutation";
import { WorkflowForm, WorkflowHeader } from "@lpg/shared/ui/WorkflowScreen";
import type { CustomerScreenProps } from "../../navigation/customerRoutes";

export function SupportScreen(props: CustomerScreenProps) {
  const orders = useOrdersQuery();
  const [orderId, setOrderId] = useState("");
  const [incidentType, setIncidentType] = useState("lpg.safety.general");
  const [severity, setSeverity] = useState("medium");
  const [description, setDescription] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const mutation = useGatewayMutation<ActionResult, Record<string, unknown>>({
    invalidate: [["safety-incidents"]],
    path: "/lpg/safety-incidents",
    schema: ActionResponseSchema,
  });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(null);
    await mutation.mutateAsync({
      description: description.trim(),
      idempotencyKey: createLpgIdempotencyKey("safety-incident", orderId),
      incidentType,
      lpgOrderId: orderId || undefined,
      severity,
      source: "skima.lpg.mobile",
    });
    setDescription("");
    setNotice("Safety report submitted to Skima operations.");
  };

  return (
    <>
      <WorkflowHeader title="Safety And Support" subtitle="Report an LPG issue" onBack={props.navigation.goBack} />
      <section className="verification-banner"><ShieldAlert aria-hidden="true" /><div><strong>Emergency</strong><span>Move away from immediate danger and contact local emergency services first.</span></div></section>
      <WorkflowForm error={mutation.error} isPending={mutation.isPending} notice={notice} onSubmit={(event) => void submit(event)} submitLabel="Submit Safety Report">
        <label>
          Related order
          <select value={orderId} onChange={(event) => setOrderId(event.currentTarget.value)}>
            <option value="">No related order</option>
            {(orders.data ?? []).map((order) => <option key={getRecordId(order) ?? ""} value={getRecordId(order) ?? ""}>{displayReference(order)}</option>)}
          </select>
        </label>
        <label>
          Issue type
          <select value={incidentType} onChange={(event) => setIncidentType(event.currentTarget.value)}>
            <option value="lpg.safety.general">General LPG safety</option>
            <option value="lpg.safety.leak">Suspected leak</option>
            <option value="lpg.safety.cylinder_damage">Cylinder damage</option>
            <option value="lpg.safety.delivery">Delivery safety</option>
          </select>
        </label>
        <label>
          Severity
          <select value={severity} onChange={(event) => setSeverity(event.currentTarget.value)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </label>
        <label>Description<textarea value={description} onChange={(event) => setDescription(event.currentTarget.value)} required /></label>
        <p className="action-copy"><AlertTriangle aria-hidden="true" />Reports are recorded with your authenticated account.</p>
        <span className="visually-hidden"><Headphones aria-hidden="true" /></span>
      </WorkflowForm>
    </>
  );
}
