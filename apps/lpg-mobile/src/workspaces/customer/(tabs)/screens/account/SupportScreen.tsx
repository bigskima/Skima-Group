import { AlertTriangle, ShieldAlert } from "lucide-react";
import { type FormEvent, useState } from "react";

import { useLpgConfigQuery } from "@lpg/features/config/api";
import { useOrdersQuery } from "@lpg/features/orders/api";
import { ActionResponseSchema, createLpgIdempotencyKey, displayReference, getConfigRecords, getFirstRecordString, getRecordId, type ActionResult } from "@lpg/shared/api/records";
import { useGatewayMutation } from "@lpg/shared/api/useGatewayMutation";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { WorkflowFormSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import { WorkflowForm, WorkflowHeader } from "@lpg/shared/ui/WorkflowScreen";
import type { CustomerScreenProps } from "../../navigation/customerRoutes";

export function SupportScreen(props: CustomerScreenProps) {
  const orders = useOrdersQuery();
  const config = useLpgConfigQuery();
  const [orderId, setOrderId] = useState("");
  const [incidentType, setIncidentType] = useState("");
  const [severity, setSeverity] = useState("");
  const [description, setDescription] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const incidentTypes = getConfigRecords(config.data, "safetyIncidentTypes");
  const severities = getConfigRecords(config.data, "safetySeverities");
  const mutation = useGatewayMutation<ActionResult, Record<string, unknown>>({
    invalidate: [["safety-incidents"]],
    path: "/lpg/safety-incidents",
    schema: ActionResponseSchema,
  });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(null);
    try {
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
    } catch {
      // React Query exposes the request error through mutation.error.
    }
  };

  return (
    <QueryState loading={orders.isLoading || config.isLoading} error={orders.error ?? config.error} skeleton={<WorkflowFormSkeleton />}>
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
          <select value={incidentType} onChange={(event) => setIncidentType(event.currentTarget.value)} required>
            <option value="">Choose issue type</option>
            {incidentTypes.map((type) => {
              const key = getFirstRecordString(type, ["key"]) ?? "";
              return <option key={key} value={key}>{getFirstRecordString(type, ["displayName", "display_name"]) ?? key}</option>;
            })}
          </select>
        </label>
        <label>
          Severity
          <select value={severity} onChange={(event) => setSeverity(event.currentTarget.value)} required>
            <option value="">Choose severity</option>
            {severities.map((item) => {
              const key = getFirstRecordString(item, ["key"]) ?? "";
              return <option key={key} value={key}>{getFirstRecordString(item, ["displayName", "display_name"]) ?? key}</option>;
            })}
          </select>
        </label>
        <label>Description<textarea value={description} onChange={(event) => setDescription(event.currentTarget.value)} required /></label>
        <p className="action-copy"><AlertTriangle aria-hidden="true" />Reports are recorded with your authenticated account.</p>
      </WorkflowForm>
    </QueryState>
  );
}
