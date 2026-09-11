import { describe, expect, it } from "vitest";

import { buildSupportThreadRoute, parseSupportRecordRoute } from "./support-record-route";

describe("support record routes", () => {
  it("recognizes the support queue", () => {
    expect(parseSupportRecordRoute("/operations/support")).toEqual({ kind: "queue" });
    expect(parseSupportRecordRoute("/operations/support/")).toEqual({ kind: "queue" });
  });

  it("recognizes one support thread record", () => {
    expect(parseSupportRecordRoute("/operations/support/abc-123")).toEqual({
      kind: "thread",
      threadId: "abc-123",
    });
  });

  it("round-trips encoded thread identifiers", () => {
    const route = buildSupportThreadRoute("thread with spaces");
    expect(route).toBe("/operations/support/thread%20with%20spaces");
    expect(parseSupportRecordRoute(route)).toEqual({
      kind: "thread",
      threadId: "thread with spaces",
    });
  });

  it("ignores query and hash when resolving a record", () => {
    expect(parseSupportRecordRoute("/operations/support/abc?from=queue#reply")).toEqual({
      kind: "thread",
      threadId: "abc",
    });
  });

  it("rejects deeper and unrelated routes", () => {
    expect(parseSupportRecordRoute("/operations/support/a/b")).toEqual({ kind: "invalid" });
    expect(parseSupportRecordRoute("/operations/orders/abc")).toEqual({ kind: "invalid" });
  });
});
