import { Bell, CheckCircle2 } from "lucide-react";

import { useMessagesQuery } from "@lpg/features/notifications/api";
import { formatStatus, getFirstRecordString, getRecordObject, getStatus, recordKey, statusTone } from "@lpg/shared/api/records";
import { PolishedEmpty, StatusChip } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { ActivityListSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import { WorkflowHeader } from "@lpg/shared/ui/WorkflowScreen";
import { formatDateValue } from "@lpg/shared/utilities/lpgFormat";
import type { CustomerScreenProps } from "../../navigation/customerRoutes";

export function NotificationsScreen(props: CustomerScreenProps) {
  const messages = useMessagesQuery();

  return (
    <QueryState loading={messages.isLoading} error={messages.error} onRetry={() => void messages.refetch()} skeleton={<ActivityListSkeleton />}>
      <WorkflowHeader title="Notifications" subtitle="Order, payment, and safety updates" onBack={props.navigation.goBack} />
      <div className="notification-list">
        {(messages.data ?? []).map((message, index) => {
          const payload = getRecordObject(message, "payload");
          const status = getStatus(message, "queued");
          return (
            <article key={recordKey(message, `message-${index}`)} className="notification-row">
              <span>{status.includes("deliver") || status.includes("sent") ? <CheckCircle2 aria-hidden="true" /> : <Bell aria-hidden="true" />}</span>
              <div>
                <strong>{getFirstRecordString(payload, ["title", "subject"]) ?? formatStatus(getFirstRecordString(message, ["purpose"]) ?? "Skima update")}</strong>
                <p>{getFirstRecordString(payload, ["body", "message", "text"]) ?? "Your account has a new backend update."}</p>
                <small>{formatDateValue(getFirstRecordString(message, ["created_at", "createdAt"]) ?? "")}</small>
              </div>
              <StatusChip tone={statusTone(status)} label={formatStatus(status)} />
            </article>
          );
        })}
        {(messages.data ?? []).length === 0 ? <PolishedEmpty icon={<Bell />} title="No notifications" message="Order, payment, verification, and safety updates will appear here." /> : null}
      </div>
    </QueryState>
  );
}
