import { describe, expect, it } from "vitest";

import { buildOrderRecordRoute, parseOrderRecordRoute } from "./order-record-route";

describe("LPG order record routes", () => {
  it("recognizes the order queue", () => {
    expect(parseOrderRecordRoute("/operations/orders")).toEqual({ kind: "queue" });
    expect(parseOrderRecordRoute("/operations/orders/")).toEqual({ kind: "queue" });
  });

  it("recognizes a public refill reference", () => {
    expect(parseOrderRecordRoute("/operations/orders/SK-REFILL-1042")).toEqual({
      kind: "order",
      reference: "SK-REFILL-1042",
    });
  });

  it("round-trips encoded references", () => {
    const route = buildOrderRecordRoute("SKIMA REF 1042");
    expect(route).toBe("/operations/orders/SKIMA%20REF%201042");
    expect(parseOrderRecordRoute(route)).toEqual({ kind: "order", reference: "SKIMA REF 1042" });
  });

  it("ignores query and hash suffixes", () => {
    expect(parseOrderRecordRoute("/operations/orders/SK-1042?from=attention#assignment")).toEqual({
      kind: "order",
      reference: "SK-1042",
    });
  });

  it("rejects deeper and unrelated routes", () => {
    expect(parseOrderRecordRoute("/operations/orders/SK-1042/history")).toEqual({ kind: "invalid" });
    expect(parseOrderRecordRoute("/operations/support/SK-1042")).toEqual({ kind: "invalid" });
  });
});
