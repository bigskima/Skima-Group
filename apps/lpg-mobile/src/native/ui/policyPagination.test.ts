import { paginatePolicyBlocks, type PolicyBlock } from "./policyPagination";

describe("paginatePolicyBlocks", () => {
  it("splits long policy content into progressive sections without losing blocks", () => {
    const blocks: PolicyBlock[] = Array.from({ length: 23 }, (_, index) =>
      index % 6 === 0 ? { kind: "heading", level: 2, text: `Section ${index}` } : { kind: "paragraph", text: `Paragraph ${index}` });
    const pages = paginatePolicyBlocks(blocks, 6);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flat()).toEqual(blocks);
  });
  it("returns a stable empty page for an empty policy", () => {
    expect(paginatePolicyBlocks([])).toEqual([[]]);
  });
});
