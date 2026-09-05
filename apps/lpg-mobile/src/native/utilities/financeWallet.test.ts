import { describe, expect, it } from "vitest";
import { selectWorkspaceWallet, walletRecordId } from "./financeWallet";

const wallets = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    wallet_type: "customer",
    owner_entity_type: "user",
    status: "active",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    wallet_type: "driver",
    owner_entity_type: "driver",
    status: "active",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    wallet_type: "partner",
    owner_entity_type: "organization",
    status: "active",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    wallet_type: "customer",
    owner_entity_type: "user",
    status: "closed",
  },
] as const;

describe("role-aware finance wallet selection", () => {
  it("never uses the first accessible wallet as a role shortcut", () => {
    expect(walletRecordId(selectWorkspaceWallet(wallets, "customer")))
      .toBe("11111111-1111-4111-8111-111111111111");
    expect(walletRecordId(selectWorkspaceWallet(wallets, "driver")))
      .toBe("22222222-2222-4222-8222-222222222222");
    expect(walletRecordId(selectWorkspaceWallet(wallets, "station")))
      .toBe("33333333-3333-4333-8333-333333333333");
  });

  it("ignores closed wallets", () => {
    expect(
      walletRecordId(
        selectWorkspaceWallet(
          wallets.filter((wallet) => wallet.id === "44444444-4444-4444-8444-444444444444"),
          "customer",
        ),
      ),
    ).toBeNull();
  });
});
