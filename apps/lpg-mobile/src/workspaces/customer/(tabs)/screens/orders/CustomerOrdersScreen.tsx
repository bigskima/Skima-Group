import { ClipboardList } from "lucide-react";

import { useOrdersQuery } from "@lpg/features/orders/api";
import { displayReference, formatStatus, getStatus, recordKey, statusTone } from "@lpg/shared/api/records";
import { PageHeading, PolishedEmpty, StatusChip } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import type { CustomerScreenProps } from "../../navigation/customerRoutes";

export function CustomerOrdersScreen(props: CustomerScreenProps) {
  const query = useOrdersQuery();

  return (
    <QueryState loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
      <PageHeading title="My Orders" subtitle="Track every verified refill step" />
      <div className="stack">
        {(query.data ?? []).map((order, index) => {
          const status = getStatus(order, "pending");
          return (
            <button
              key={recordKey(order, `order-${index}`)}
              type="button"
              className="menu-row"
              onClick={() => props.navigation.navigate("order-details", { orderId: String(order.id ?? "") })}
            >
              <ClipboardList aria-hidden="true" />
              <div><strong>{displayReference(order)}</strong><small>{formatStatus(status)}</small></div>
              <StatusChip tone={statusTone(status)} label={formatStatus(status)} />
            </button>
          );
        })}
        {(query.data ?? []).length === 0 ? (
          <PolishedEmpty
            icon={<ClipboardList />}
            title="No LPG orders yet"
            message="Your refill history will appear here."
            actionLabel="Start Refill"
            onAction={() => props.navigation.navigate("order-new")}
          />
        ) : null}
      </div>
    </QueryState>
  );
}
