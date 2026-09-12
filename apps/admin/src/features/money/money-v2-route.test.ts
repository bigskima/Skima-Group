import { describe, expect, it } from "vitest";

import { getAdminWorkspaceForRoute } from "../../app/admin-v2-navigation";

describe("Admin V2 money route cutover", () => {
  it("keeps routine finance routes inside the Money workspace", () => {
    expect(getAdminWorkspaceForRoute("/money/balances").key).toBe("money");
    expect(getAdminWorkspaceForRoute("/money/withdrawals").key).toBe("money");
    expect(getAdminWorkspaceForRoute("/money/settlements").key).toBe("money");
  });

  it("keeps advanced finance tools nested beneath an allowed Money screen", () => {
    expect(getAdminWorkspaceForRoute("/money/balances/advanced").key).toBe("money");
  });
});
