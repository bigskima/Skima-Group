import { RecordArraySchema } from "../../shared/api/records";
import { useGatewayQuery } from "../../shared/api/useGatewayQuery";

export function useWalletBalancesQuery() {
  return useGatewayQuery({
    key: ["wallet-balances"],
    path: "/runtime/wallet-balances",
    schema: RecordArraySchema,
  });
}

export function useDepositsQuery(enabled = true) {
  return useGatewayQuery({
    enabled,
    key: ["deposits"],
    path: "/runtime/payments/deposits",
    schema: RecordArraySchema,
  });
}

export function useWithdrawalsQuery() {
  return useGatewayQuery({
    key: ["withdrawals"],
    path: "/runtime/withdrawals",
    schema: RecordArraySchema,
  });
}

export function useSettlementsQuery(enabled = true) {
  return useGatewayQuery({
    enabled,
    key: ["settlements"],
    path: "/runtime/settlement-statements",
    schema: RecordArraySchema,
  });
}

export function useCommissionsQuery(enabled = true) {
  return useGatewayQuery({
    enabled,
    key: ["commissions"],
    path: "/runtime/commission-executions",
    schema: RecordArraySchema,
  });
}

export function useWithdrawalBeneficiariesQuery(enabled = true) {
  return useGatewayQuery({
    enabled,
    key: ["withdrawal-beneficiaries"],
    path: "/runtime/withdrawal-beneficiaries",
    schema: RecordArraySchema,
  });
}
