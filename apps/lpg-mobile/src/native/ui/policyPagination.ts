export type PolicyBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "paragraph"; text: string };

export function paginatePolicyBlocks(blocks: readonly PolicyBlock[], targetSize = 8): PolicyBlock[][] {
  if (!blocks.length) return [[]];
  const pages: PolicyBlock[][] = [];
  let current: PolicyBlock[] = [];
  for (const block of blocks) {
    if (current.length >= targetSize && block.kind === "heading") {
      pages.push(current);
      current = [];
    }
    current.push(block);
    if (current.length >= targetSize + 4) {
      pages.push(current);
      current = [];
    }
  }
  if (current.length) pages.push(current);
  return pages;
}
