// The #numbers in the text of an issue or pull request: #17 as GitHub links it, after a space, a bracket or the start,
// and not inside a word, a URL (…/#17) or another repository's owner/name#17.

export interface TextRef {
  /** Where "#17" starts and ends in the text. */
  start: number;
  end: number;
  number: number;
}

/** The #number that the place `offset` of `text` is in or at the edge of. */
export function refAt(text: string, offset: number): TextRef | undefined {
  for (const m of text.matchAll(/#(\d{1,9})(?![\w])/g)) {
    const start = m.index;
    const end = start + m[0].length;
    if (offset < start) return undefined;
    if (offset > end) continue;
    if (start > 0 && /[\w/&#@.-]/.test(text[start - 1] ?? "")) return undefined;
    const number = Number(m[1]);
    return number >= 1 ? { start, end, number } : undefined;
  }
  return undefined;
}
