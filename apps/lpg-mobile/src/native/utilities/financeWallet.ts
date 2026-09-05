import { firstString, type PlatformRecord } from "../api/records";

export type FinanceWorkspace = "customer" | "driver" | "station";

export function selectWorkspaceWallet(
  walletList: readonly PlatformRecord[],
  workspace: FinanceWorkspace,
): PlatformRecord | null {
  const active = walletList.filter(
    (wallet) => firstString(wallet, ["wallet_status", "status"]) !== "closed",
  );

  if (workspace === "customer") {
    return active.find(
      (wallet) =>
        firstString(wallet, ["wallet_type", "walletType"]) === "customer" &&
        firstString(wallet, ["owner_entity_type", "ownerEntityType"]) === "user",
    ) ?? null;
  }

  if (workspace === "driver") {
    return active.find(
      (wallet) =>
        firstString(wallet, ["wallet_type", "walletType"]) === "driver" &&
        firstString(wallet, ["owner_entity_type", "ownerEntityType"]) === "driver",
    ) ?? null;
  }

  return active.find(
    (wallet) =>
      firstString(wallet, ["wallet_type", "walletType"]) === "partner" &&
      firstString(wallet, ["owner_entity_type", "ownerEntityType"]) === "organization",
  ) ??
    active.find(
      (wallet) => firstString(wallet, ["wallet_type", "walletType"]) === "partner",
    ) ??
    null;
}

export function walletRecordId(wallet: PlatformRecord | null): string | null {
  return firstString(wallet, ["wallet_id", "walletId", "id"]);
}
