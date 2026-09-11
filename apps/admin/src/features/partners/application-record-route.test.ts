import { describe, expect, it } from "vitest";

import {
  APPLICATIONS_BASE_PATH,
  buildApplicationRecordPath,
  parseApplicationRecordRoute,
} from "./application-record-route";

describe("application record routes", () => {
  it("recognizes the review queue route", () => {
    expect(parseApplicationRecordRoute(APPLICATIONS_BASE_PATH)).toEqual({ kind: "queue" });
  });

  it("reads one application identifier from a record route", () => {
    expect(parseApplicationRecordRoute(`${APPLICATIONS_BASE_PATH}/application-123`)).toEqual({
      kind: "record",
      applicationId: "application-123",
    });
  });

  it("round-trips encoded identifiers safely", () => {
    const path = buildApplicationRecordPath("application / 123");
    expect(path).toBe(`${APPLICATIONS_BASE_PATH}/application%20%2F%20123`);
    expect(parseApplicationRecordRoute(path)).toEqual({
      kind: "record",
      applicationId: "application / 123",
    });
  });

  it("rejects deeper or malformed application routes", () => {
    expect(parseApplicationRecordRoute(`${APPLICATIONS_BASE_PATH}/one/two`)).toEqual({ kind: "invalid" });
    expect(parseApplicationRecordRoute(`${APPLICATIONS_BASE_PATH}/%E0%A4%A`)).toEqual({ kind: "invalid" });
  });

  it("does not accept unrelated partner routes", () => {
    expect(parseApplicationRecordRoute("/partners/stations/example")).toEqual({ kind: "invalid" });
  });
});
