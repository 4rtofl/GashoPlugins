// The colors of output on a colored background (README.md「出力の表示」). The 16 colors of the palette are chosen to be
// read on the panel's own background; on another one (SGR 40-47, 100-107, 48, or inverse), the text's color is made
// lighter or darker until it is 4.5:1 against that background, as VS Code's terminal does (its minimumContrastRatio).
// Pure: the panel reads the palette of the theme on screen from its stylesheet (style.css).
import type { Style } from "./ansi";

/** The palette as hex: the 16 colors, the default text (ink) and the output's background (paper). */
export interface Palette {
  colors: string[];
  ink: string;
  paper: string;
}

/** The contrast the text gets against a background of its own (WCAG's AA for text). */
export const MIN_CONTRAST = 4.5;

const HEX = /^#[0-9a-f]{6}$/i;

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

const toHex = (c: number[]): string => `#${c.map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, "0")).join("")}`;

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((x) => {
    const c = x / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** `fg` as it is when it reads on `bg`; else the least step of it toward white or black that does. */
export function readable(fg: string, bg: string, min = MIN_CONTRAST): string {
  if (contrast(fg, bg) >= min) return fg;
  const from = rgb(fg);
  let best: { color: string; t: number } | undefined;
  for (const end of [255, 0]) {
    for (let k = 1; k <= 20; k++) {
      const t = k / 20;
      const color = toHex(from.map((c) => c + (end - c) * t));
      if (contrast(color, bg) < min) continue;
      if (!best || t < best.t) best = { color, t };
      break;
    }
  }
  // Black or white always reads, on any background.
  return best?.color ?? (contrast("#ffffff", bg) >= contrast("#000000", bg) ? "#ffffff" : "#000000");
}

/** The palette from the stylesheet's variables (`value("--rcs-1")`); undefined until it is there. */
export function paletteFrom(value: (name: string) => string): Palette | undefined {
  const colors = Array.from({ length: 16 }, (_, i) => value(`--rcs-${i}`).trim());
  const ink = value("--rcs-ink").trim();
  const paper = value("--rcs-paper").trim();
  return [...colors, ink, paper].every((c) => HEX.test(c)) ? { colors, ink, paper } : undefined;
}

/** A span's text and background colors when it has a background of its own; undefined when it has not. */
export function onBackground(s: Style, p: Palette): { color: string; backgroundColor: string } | undefined {
  const fg = s.inverse ? s.bg : s.fg;
  const bg = s.inverse ? s.fg : s.bg;
  if (!s.inverse && bg === undefined) return undefined;
  const hex = (c: number | string | undefined, fallback: string): string =>
    typeof c === "number" ? (p.colors[c] ?? fallback) : typeof c === "string" && HEX.test(c) ? c : fallback;
  const backgroundColor = hex(bg, s.inverse ? p.ink : p.paper);
  return { color: readable(hex(fg, s.inverse ? p.paper : p.ink), backgroundColor), backgroundColor };
}
