import { ActionResponseSchema, createLpgIdempotencyKey, RecordArraySchema, RecordObjectSchema, type ActionResult } from "../../shared/api/records";
import { useGatewayMutation } from "../../shared/api/useGatewayMutation";
import { useGatewayQuery } from "../../shared/api/useGatewayQuery";

export function useOrdersQuery() {
  return useGatewayQuery({ key: ["orders"], path: "/lpg/orders", schema: RecordArraySchema });
}

export function useCreateQuoteMutation() {
  const mutation = useGatewayMutation<ActionResult, Record<string, unknown>>({
    invalidate: [["quotes"]], path: "/lpg/quotes", schema: ActionResponseSchema,
  });
  return { ...mutation, submit: (input: Record<string, unknown>) => mutation.mutateAsync({
    ...input, idempotencyKey: createLpgIdempotencyKey("create-quote", String(input.cylinderId ?? "")),
  }) };
}

export function useCreateOrderMutation() {
  const mutation = useGatewayMutation<ActionResult, Record<string, unknown>>({
    invalidate: [["orders"], ["orders", "active"]], path: "/lpg/orders", schema: ActionResponseSchema,
  });
  return { ...mutation, submit: (lpgRefillQuoteId: string) => mutation.mutateAsync({
    lpgRefillQuoteId, idempotencyKey: createLpgIdempotencyKey("create-order", lpgRefillQuoteId),
  }) };
}

export function useReserveOrderPaymentMutation() {
  const mutation = useGatewayMutation<ActionResult, Record<string, unknown>>({
    invalidate: [["orders"], ["orders", "active"], ["wallet-balances"]],
    path: "/lpg/orders/reserve-payment", schema: ActionResponseSchema,
  });
  return { ...mutation, submit: (lpgOrderId: string, customerWalletId?: string) => mutation.mutateAsync({
    lpgOrderId, customerWalletId: customerWalletId || undefined,
    idempotencyKey: createLpgIdempotencyKey("reserve-order-payment", lpgOrderId),
  }) };
}

export function useActiveOrdersQuery() {
  return useGatewayQuery({ key: ["orders", "active"], path: "/lpg/orders/active", schema: RecordArraySchema });
}

export function useQuotesQuery() {
  return useGatewayQuery({ key: ["quotes"], path: "/lpg/quotes", schema: RecordArraySchema });
}

export function useJobsQuery(queue: "driver" | "station") {
  return useGatewayQuery({
    key: ["jobs", queue],
    path: `/lpg/jobs?queue=${queue}&limit=50`,
    schema: RecordArraySchema,
  });
}

export function useOrderFinancialSummaryQuery(orderId: string | null) {
  return useGatewayQuery({
    enabled: Boolean(orderId),
    key: ["orders", "financial-summary", orderId],
    path: `/lpg/orders/financial-summary?lpgOrderId=${encodeURIComponent(orderId ?? "")}`,
    schema: RecordObjectSchema,
  });
}
