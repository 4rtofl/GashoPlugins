// Output with ANSI escape sequences, as a terminal would show it, in lines of styled spans (README.md「出力の表示」).
// SGR (colors, bold, …) becomes styles; a carriage return goes back to the start of the line, so that what follows
// overwrites it (progress shown on one line); a backspace steps back; "erase in line" clears. Every other escape
// sequence (cursor movement, window titles, …) is left out. An escape sequence cut off at the end of the text is left
// for later: the panel parses a command's output again, whole, as more of it comes. Pure, and imports nothing.

export interface Style {
  /** 0-15: the palette of the theme; "#rrggbb": as given. */
  fg?: number | string;
  bg?: number | string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  strike?: boolean;
}

export interface Span {
  text: string;
  style: Style;
}

export type Line = Span[];

interface Cell {
  ch: string;
  style: Style;
}

const PLAIN: Style = Object.freeze({});
/** An OSC (window title, link, …) longer than this without its end is taken as broken: its start is dropped. */
const MAX_STRING_SEQUENCE = 4096;

const hex = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map((x) => Math.min(255, Math.max(0, Math.round(x))).toString(16).padStart(2, "0")).join("")}`;

/** A color of the 256-color palette: 0-15 stay the theme's, 16-231 are the 6x6x6 cube, 232-255 the grays. */
export function color256(n: number): number | string | undefined {
  if (!Number.isInteger(n) || n < 0 || n > 255) return undefined;
  if (n < 16) return n;
  if (n < 232) {
    const levels = [0, 95, 135, 175, 215, 255];
    const c = n - 16;
    return hex(levels[Math.floor(c / 36)] ?? 0, levels[Math.floor(c / 6) % 6] ?? 0, levels[c % 6] ?? 0);
  }
  const g = 8 + (n - 232) * 10;
  return hex(g, g, g);
}

/** The color of SGR 38 or 48: "5;n" or "2;r;g;b" after it, or its colon form ("38:5:n", "38:2::r:g:b"). */
function extendedColor(sub: string[], rest: string[]): { color?: number | string; used: number } {
  if (sub.length > 1) {
    const mode = Number(sub[1]);
    if (mode === 5) return { color: color256(Number(sub[2])), used: 0 };
    if (mode === 2) {
      const rgb = sub.slice(2).filter((x) => x !== "").slice(-3).map(Number);
      return { color: rgb.length === 3 && rgb.every(Number.isFinite) ? hex(rgb[0]!, rgb[1]!, rgb[2]!) : undefined, used: 0 };
    }
    return { used: 0 };
  }
  const mode = Number(rest[0]);
  if (mode === 5) return { color: color256(Number(rest[1])), used: 2 };
  if (mode === 2) {
    const rgb = rest.slice(1, 4).map(Number);
    return { color: rgb.length === 3 && rgb.every(Number.isFinite) ? hex(rgb[0]!, rgb[1]!, rgb[2]!) : undefined, used: 4 };
  }
  return { used: 0 };
}

/** The style after an SGR sequence (`ESC [ params m`). Styles are never changed in place: cells share them. */
export function applySgr(style: Style, params: string): Style {
  const parts = params === "" ? ["0"] : params.split(";");
  let s: Style = { ...style };
  for (let i = 0; i < parts.length; i++) {
    const sub = (parts[i] ?? "").split(":");
    const code = sub[0] === "" ? 0 : Number(sub[0]);
    if (!Number.isInteger(code)) continue;
    if (code === 38 || code === 48) {
      const { color, used } = extendedColor(sub, parts.slice(i + 1));
      i += used;
      if (color !== undefined) s = code === 38 ? { ...s, fg: color } : { ...s, bg: color };
      continue;
    }
    switch (code) {
      case 0:
        s = {};
        break;
      case 1:
        s.bold = true;
        break;
      case 2:
        s.dim = true;
        break;
      case 3:
        s.italic = true;
        break;
      case 4:
        if (sub[1] === "0") delete s.underline;
        else s.underline = true;
        break;
      case 7:
        s.inverse = true;
        break;
      case 9:
        s.strike = true;
        break;
      case 21:
        s.underline = true;
        break;
      case 22:
        delete s.bold;
        delete s.dim;
        break;
      case 23:
        delete s.italic;
        break;
      case 24:
        delete s.underline;
        break;
      case 27:
        delete s.inverse;
        break;
      case 29:
        delete s.strike;
        break;
      case 39:
        delete s.fg;
        break;
      case 49:
        delete s.bg;
        break;
      default:
        if (code >= 30 && code <= 37) s.fg = code - 30;
        else if (code >= 40 && code <= 47) s.bg = code - 40;
        else if (code >= 90 && code <= 97) s.fg = code - 90 + 8;
        else if (code >= 100 && code <= 107) s.bg = code - 100 + 8;
    }
  }
  return Object.keys(s).length === 0 ? PLAIN : s;
}

const sameStyle = (a: Style, b: Style): boolean =>
  a === b ||
  (a.fg === b.fg &&
    a.bg === b.bg &&
    !a.bold === !b.bold &&
    !a.dim === !b.dim &&
    !a.italic === !b.italic &&
    !a.underline === !b.underline &&
    !a.inverse === !b.inverse &&
    !a.strike === !b.strike);

function spans(cells: Cell[]): Line {
  const line: Line = [];
  for (const cell of cells) {
    const last = line[line.length - 1];
    if (last && sameStyle(last.style, cell.style)) last.text += cell.ch;
    else line.push({ text: cell.ch, style: cell.style });
  }
  return line;
}

/** The lines of `text`. A newline at the very end makes no empty line after it. */
export function toLines(text: string): Line[] {
  const lines: Line[] = [];
  let cells: Cell[] = [];
  let col = 0;
  let style: Style = PLAIN;
  const put = (ch: string) => {
    const cell = { ch, style };
    if (col < cells.length) cells[col] = cell;
    else {
      while (cells.length < col) cells.push({ ch: " ", style: PLAIN });
      cells.push(cell);
    }
    col++;
  };
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 0x1b) {
      const next = text[i + 1];
      if (next === undefined) break;
      if (next === "[") {
        // CSI: parameter bytes, intermediate bytes, a final byte.
        let j = i + 2;
        while (j < n && text.charCodeAt(j) >= 0x30 && text.charCodeAt(j) <= 0x3f) j++;
        const params = text.slice(i + 2, j);
        while (j < n && text.charCodeAt(j) >= 0x20 && text.charCodeAt(j) <= 0x2f) j++;
        if (j >= n) break;
        const final = text[j];
        const privateParams = /[<=>?]/.test(params);
        if (final === "m" && !privateParams) style = applySgr(style, params);
        else if (final === "K" && !privateParams) {
          const mode = Number(params || "0");
          if (mode === 0) cells.length = Math.min(cells.length, col);
          else if (mode === 1) for (let k = 0; k <= col && k < cells.length; k++) cells[k] = { ch: " ", style: PLAIN };
          else if (mode === 2) cells = [];
        }
        i = j + 1;
        continue;
      }
      if (next === "]" || next === "P" || next === "_" || next === "^" || next === "X") {
        // OSC, DCS, APC, PM, SOS: up to BEL or ST (ESC \).
        let end = -1;
        for (let j = i + 2; j < n; j++) {
          const d = text.charCodeAt(j);
          if (d === 0x07) {
            end = j + 1;
            break;
          }
          if (d === 0x1b && text[j + 1] === "\\") {
            end = j + 2;
            break;
          }
        }
        if (end >= 0) {
          i = end;
          continue;
        }
        if (n - i > MAX_STRING_SEQUENCE) {
          i += 2;
          continue;
        }
        break;
      }
      // Character sets take one more byte (ESC ( B); anything else is ESC and one byte (ESC 7, ESC =, …).
      i += next === "(" || next === ")" || next === "*" || next === "+" ? 3 : 2;
      continue;
    }
    if (c === 0x0a) {
      lines.push(spans(cells));
      cells = [];
      col = 0;
      i++;
      continue;
    }
    if (c === 0x0d) {
      col = 0;
      i++;
      continue;
    }
    if (c === 0x08) {
      if (col > 0) col--;
      i++;
      continue;
    }
    if (c === 0x09) {
      put("\t");
      i++;
      continue;
    }
    if (c < 0x20 || c === 0x7f) {
      i++;
      continue;
    }
    // A surrogate pair stays one character.
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < n) {
      put(text.slice(i, i + 2));
      i += 2;
      continue;
    }
    put(text[i] as string);
    i++;
  }
  if (cells.length > 0) lines.push(spans(cells));
  return lines;
}

/** The text as the panel shows it, without styles (what "出力をコピー" copies). */
export function plainText(text: string): string {
  return toLines(text)
    .map((line) => line.map((s) => s.text).join(""))
    .join("\n");
}
