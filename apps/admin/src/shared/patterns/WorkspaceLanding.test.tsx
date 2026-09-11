import { Circle } from "lucide-react";
import { describe, expect, it } from "vitest";

import {
  canAccessWorkspaceLandingAction,
  type WorkspaceLandingAction,
} from "./WorkspaceLanding";

function action(overrides: Partial<WorkspaceLandingAction> = {}): WorkspaceLandingAction {
  return {
    key: "test",
    title: "Test task",
    description: "Test task description",
    href: "/test",
    icon: Circle,
    ...overrides,
  };
}

describe("workspace landing permissions", () => {
  it("allows tasks with no permission requirement", () => {
    expect(canAccessWorkspaceLandingAction(action(), () => false)).toBe(true);
  });

  it("requires every explicit permission", () => {
    const permitted = new Set(["platform.one.read", "platform.two.read"]);
    const target = action({ requiredPermissions: ["platform.one.read", "platform.two.read"] });

    expect(canAccessWorkspaceLandingAction(target, (permission) => permitted.has(permission))).toBe(true);
    expect(canAccessWorkspaceLandingAction(target, (permission) => permission === "platform.one.read")).toBe(false);
  });

  it("supports aggregate cards that require any one child permission", () => {
    const target = action({
      anyOfPermissions: ["platform.revenue.read", "platform.financial.read", "platform.financial_policy.read"],
    });

    expect(canAccessWorkspaceLandingAction(target, (permission) => permission === "platform.financial.read")).toBe(true);
    expect(canAccessWorkspaceLandingAction(target, () => false)).toBe(false);
  });

  it("inherits the authoritative any-of rule for a navigation screen", () => {
    const target = action({ permissionKey: "operations" });

    expect(canAccessWorkspaceLandingAction(target, (permission) => permission === "lpg.dispatch.execute")).toBe(true);
    expect(canAccessWorkspaceLandingAction(target, () => false)).toBe(false);
  });

  it("inherits simple navigation permissions for focused cards", () => {
    const target = action({ permissionKey: "support" });

    expect(canAccessWorkspaceLandingAction(target, (permission) => permission === "platform.support.read")).toBe(true);
    expect(canAccessWorkspaceLandingAction(target, () => false)).toBe(false);
  });

  it("enforces all-of and any-of requirements together", () => {
    const target = action({
      requiredPermissions: ["platform.workspace.read"],
      anyOfPermissions: ["platform.option.a", "platform.option.b"],
    });
    const permitted = new Set(["platform.workspace.read", "platform.option.b"]);

    expect(canAccessWorkspaceLandingAction(target, (permission) => permitted.has(permission))).toBe(true);
    expect(canAccessWorkspaceLandingAction(target, (permission) => permission === "platform.option.b")).toBe(false);
  });
});
