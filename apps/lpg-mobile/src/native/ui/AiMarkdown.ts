export function inlineMarkdown(value: string): Array<{ text: string; bold?: boolean; code?: boolean }> {
  const parts: Array<{ text: string; bold?: boolean; code?: boolean }> = [];
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`)/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) parts.push({ text: value.slice(cursor, start) });
    const token = match[0];
    parts.push(token.startsWith("`") ? { text: token.slice(1, -1), code: true } : { text: token.slice(2, -2), bold: true });
    cursor = start + token.length;
  }
  if (cursor < value.length) parts.push({ text: value.slice(cursor) });
  return parts.length ? parts : [{ text: value }];
}

export function speechText(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, " omitted technical detail ")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`/g, "$1$2$3")
    .replace(/^\s*[-*#]+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
