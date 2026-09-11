import type { AdminResourceConsoleConfig } from "../../admin-resource-console";
import { financeConsoleConfig } from "../../admin-resource-config";

export const moneyBalancesConfig = focusFinanceGroup(
  "wallets",
  "Balances & deposits",
  "Review wallet balances and deposit funding without mixing them with withdrawals or settlement operations.",
);

export const moneyWithdrawalsConfig = focusFinanceGroup(
  "withdrawals",
  "Withdrawals",
  "Manage beneficiaries, withdrawal requests and transfer outcomes in one focused workspace.",
);

export const moneySettlementsConfig = focusFinanceGroup(
  "settlements",
  "Settlements & escrow",
  "Review commissions and settlement statements, then perform governed escrow and reconciliation work.",
);

function focusFinanceGroup(
  groupKey: string,
  title: string,
  description: string,
): AdminResourceConsoleConfig {
  const group = financeConsoleConfig.groups.find((candidate) => candidate.key === groupKey);

  if (!group) {
    throw new Error(`Finance workspace group '${groupKey}' is unavailable.`);
  }

  return {
    eyebrow: "Money",
    title,
    description,
    groups: [group],
  };
}
