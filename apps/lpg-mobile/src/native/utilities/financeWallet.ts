import { firstString, type PlatformRecord } from "../api/records";

export type FinanceWorkspace = "customer" | "driver" | "station";

export function selectWorkspaceWallet(
  walletList: readonly PlatformRecord[],
  workspace: FinanceWorkspace,
  ownerEntityId?: string | null,
): PlatformRecord | null {
  const active = walletList.filter(
    (wallet) => !["closed", "disabled"].includes(firstString(wallet, ["wallet_status", "status"]) ?? ""),
  );
  const belongsToOwner = (wallet: PlatformRecord) =>
    Boolean(ownerEntityId) &&
    firstString(wallet, ["owner_entity_id", "ownerEntityId"]) === ownerEntityId;

  if (workspace === "customer") {
    return active.find(
      (wallet) =>
        firstString(wallet, ["wallet_type", "walletType"]) === "customer" &&
        firstString(wallet, ["owner_entity_type", "ownerEntityType"]) === "user" &&
        (!ownerEntityId || belongsToOwner(wallet)),
    ) ?? null;
  }

  if (!ownerEntityId) return null;

  if (workspace === "driver") {
    return active.find(
      (wallet) =>
        firstString(wallet, ["wallet_type", "walletType"]) === "driver" &&
        firstString(wallet, ["owner_entity_type", "ownerEntityType"]) === "driver" &&
        belongsToOwner(wallet),
    ) ?? null;
  }

  // Station partner wallets belong to the owning organisation, not the branch.
  // Never fall back to another organisation's first partner wallet.
  return active.find(
    (wallet) =>
      firstString(wallet, ["wallet_type", "walletType"]) === "partner" &&
      firstString(wallet, ["owner_entity_type", "ownerEntityType"]) === "organization" &&
      belongsToOwner(wallet),
  ) ?? null;
}

export function walletRecordId(wallet: PlatformRecord | null): string | null {
  return firstString(wallet, ["wallet_id", "walletId", "id"]);
}
