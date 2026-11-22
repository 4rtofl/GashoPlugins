// The output of one command as kept in memory (README.md「出力の残し方」): its end, up to a limit; what goes beyond the
// limit is dropped from its start, at the start of a line when one is near. Positions count characters (UTF-16 code
// units, as JavaScript strings do) from the start of the output, dropped ones included, and never split a surrogate
// pair. Lines count what is kept.

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** How far past the cut a line's start may be looked for. */
const LINE_LOOKAHEAD = 4096;

function countNewlines(s: string): number {
  let n = 0;
  for (let i = s.indexOf("\n"); i >= 0; i = s.indexOf("\n", i + 1)) n++;
  return n;
}

export class OutputBuffer {
  /** The kept text, and the characters dropped before it. */
  text: string;
  dropped: number;
  /** The most characters kept once the command has ended (while it runs, up to an eighth more). */
  readonly max: number;
  private newlines: number;

  constructor(max: number, start: { text: string; dropped: number } = { text: "", dropped: 0 }) {
    this.max = Math.max(1, max);
    this.text = start.text;
    this.dropped = start.dropped;
    this.newlines = countNewlines(start.text);
  }

  get size(): number {
    return this.dropped + this.text.length;
  }

  /** The lines of the kept text, the last one without a newline too ("すべて表示（N 行）"). */
  get lines(): number {
    return this.newlines + (this.text && !this.text.endsWith("\n") ? 1 : 0);
  }

  append(s: string): void {
    if (!s) return;
    this.text += s;
    this.newlines += countNewlines(s);
    // Dropped in steps of an eighth of the limit, so that a busy command does not copy its output for every piece.
    if (this.text.length > this.max + (this.max >> 3)) this.trim();
  }

  /** Down to the limit (the command has ended). */
  final(): void {
    if (this.text.length > this.max) this.trim();
  }

  private trim(): void {
    let cut = this.text.length - this.max;
    const line = this.text.indexOf("\n", cut);
    if (line >= 0 && line - cut < LINE_LOOKAHEAD) cut = line + 1;
    if (cut < this.text.length && isLow(this.text.charCodeAt(cut))) cut++;
    this.newlines -= countNewlines(this.text.slice(0, cut));
    this.text = this.text.slice(cut);
    this.dropped += cut;
  }

  /**
   * Up to `limit` characters from `from` (or from the first one kept), never starting or ending inside a surrogate pair:
   * asked from inside one, it starts with the whole pair, so that it joins what was read before it (web/state.ts).
   */
  slice(from: number, limit: number): { from: number; text: string } {
    let start = Math.min(Math.max(from, this.dropped), this.size);
    let end = Math.min(this.size, start + Math.max(0, limit));
    if (start > this.dropped && start < this.size && isLow(this.text.charCodeAt(start - this.dropped))) start--;
    if (end < this.size && end > start && isHigh(this.text.charCodeAt(end - this.dropped - 1))) end--;
    return { from: start, text: this.text.slice(start - this.dropped, end - this.dropped) };
  }
}
