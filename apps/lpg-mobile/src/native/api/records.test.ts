import { displayReference, displayStatus, displaySubtitle, displayTitle, firstNumber, firstString, nestedRecord, nestedRecords, recordId } from "./records";
describe("platform record presentation", () => {
  it("supports backend snake and camel case contracts", () => {
    const record = { public_reference: "SKM-100", displayName: "Prime Station", workflow_state: "pickup_en_route", formatted_address: "Lagos", nested: { id: "child" } };
    expect(recordId(record)).toBe("SKM-100");
    expect(displayTitle(record)).toBe("Prime Station");
    expect(displayStatus(record)).toBe("pickup_en_route");
    expect(displaySubtitle(record)).toBe("Lagos");
    expect(nestedRecord(record, "nested")).toEqual({ id: "child" });
  });
  it("does not invent unavailable values", () => {
    expect(firstString({}, ["missing"])).toBeNull();
    expect(displayStatus({})).toBeNull();
    expect(displayTitle({})).toBe("Record");
  });
  it("keeps backend identifiers separate from public references", () => {
    const record = { id: "9cc348c5-b50f-4ca2-a37c-54f061a9eff2", public_reference: "SKM-LPG-100" };
    expect(recordId(record)).toBe(record.id);
    expect(displayReference(record)).toBe("SKM-LPG-100");
  });
  it("normalizes numeric contracts and nested record collections safely", () => {
    expect(firstNumber({ amount: "12.50" }, ["amount"])).toBe(12.5);
    expect(firstNumber({ amount: "invalid" }, ["amount"])).toBeNull();
    expect(nestedRecords({ records: [{ id: "one" }, null, "invalid", ["invalid"]] }, "records")).toEqual([{ id: "one" }]);
  });
});
