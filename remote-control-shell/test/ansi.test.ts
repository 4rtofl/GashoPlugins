import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applySgr, color256, lastLines, linesFrom, plainText, toLines, type Line } from "../src/web/ansi.ts";
import { contrast, MIN_CONTRAST, onBackground, paletteFrom, readable, type Palette } from "../src/web/colors.ts";

const texts = (lines: Line[]) => lines.map((l) => l.map((s) => s.text).join(""));

test("colors and bold become styles, and a reset ends them", () => {
  assert.deepEqual(toLines("\x1b[1;31merror\x1b[0m: x \x1b[32mok\x1b[39m done"), [
    [
      { text: "error", style: { bold: true, fg: 1 } },
      { text: ": x ", style: {} },
      { text: "ok", style: { fg: 2 } },
      { text: " done", style: {} },
    ],
  ]);
  assert.deepEqual(toLines("\x1b[91mx\x1b[100my\x1b[m"), [[{ text: "x", style: { fg: 9 } }, { text: "y", style: { fg: 9, bg: 8 } }]]);
  // 22, 24, 27, 29 end what they end, and nothing else.
  assert.deepEqual(applySgr({ bold: true, dim: true, underline: true, inverse: true, strike: true, fg: 3 }, "22;24;27;29"), { fg: 3 });
  assert.deepEqual(applySgr({ fg: 3, bg: 4 }, "39;49"), {});
  assert.deepEqual(applySgr({ underline: true }, "4:0"), {});
});

test("256 colors and 24-bit colors, also in their colon form", () => {
  assert.equal(color256(1), 1);
  assert.equal(color256(196), "#ff0000");
  assert.equal(color256(21), "#0000ff");
  assert.equal(color256(244), "#808080");
  assert.equal(color256(256), undefined);
  assert.deepEqual(toLines("\x1b[38;5;196mR\x1b[48;2;1;2;3mB\x1b[m."), [
    [
      { text: "R", style: { fg: "#ff0000" } },
      { text: "B", style: { fg: "#ff0000", bg: "#010203" } },
      { text: ".", style: {} },
    ],
  ]);
  assert.deepEqual(applySgr({}, "38:2::10:20:30"), { fg: "#0a141e" });
  assert.deepEqual(applySgr({}, "38:2:10:20:30"), { fg: "#0a141e" });
  assert.deepEqual(applySgr({}, "48:5:21"), { bg: "#0000ff" });
  // A broken one changes nothing, and what follows still counts.
  assert.deepEqual(applySgr({}, "38;5;999;1"), { bold: true });
});

test("a carriage return goes back to the start of the line, and what follows overwrites it", () => {
  assert.deepEqual(texts(toLines("50%\r100%\n")), ["100%"]);
  assert.deepEqual(texts(toLines("abcdef\rXY")), ["XYcdef"]);
  assert.deepEqual(texts(toLines("abcdef\r\x1b[Kxy")), ["xy"]);
  // Erase in line: up to the cursor (1), the whole line (2); the cursor stays where it is.
  assert.deepEqual(texts(toLines("abcdef\x1b[3D\x1b[1K")), ["    ef"]);
  assert.deepEqual(texts(toLines("abc\x1b[2Kz")), ["   z"]);
  // The cursor along the line: Node's readline clears the line and goes back to its start for each update.
  assert.deepEqual(texts(toLines("10%\x1b[2K\x1b[1G20%\x1b[2K\x1b[1G30%")), ["30%"]);
  assert.deepEqual(texts(toLines("ab\x1b[3Cc\x1b[G>\x1b[99D<")), ["<b   c"]);
  // Past the end of the line, the cursor goes no further right than 500 columns; along a longer line, it does.
  assert.equal(texts(toLines("a\x1b[99999Cz"))[0], `a${" ".repeat(499)}z`);
  const long = "x".repeat(1000);
  assert.equal(texts(toLines(`${long}\x1b[1DZ`))[0], `${"x".repeat(999)}Z`);
  assert.equal(texts(toLines(`${long}\x1b[800GZ`))[0]?.indexOf("Z"), 799);
  assert.equal(texts(toLines(`${long}\x1b[2D\x1b[1CZ`))[0], `${"x".repeat(999)}Z`);
  // Windows' line ends, and a backspace (man's bold and underline overstrike).
  assert.deepEqual(texts(toLines("one\r\ntwo\r\n")), ["one", "two"]);
  assert.deepEqual(texts(toLines("A\bA_\bB")), ["AB"]);
});

test("other escape sequences and control characters are left out", () => {
  assert.deepEqual(texts(toLines("\x1b]0;title\x07hi\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\")), ["hilink"]);
  assert.deepEqual(texts(toLines("\x1b[2J\x1b[H\x1b[?25lok\x1b[?25h\x1b(B\x1b7\x1b8\x07!")), ["ok!"]);
  assert.deepEqual(texts(toLines("a\tb\x00c")), ["a\tbc"]);
});

test("an escape sequence cut off at the end waits for the rest while more may come", () => {
  for (const cut of ["ok\x1b", "ok\x1b[3", "ok\x1b[38;5", "ok\x1b]0;tit", "ok\x1b]0;tit\x1b"]) assert.deepEqual(texts(toLines(cut, true)), ["ok"], JSON.stringify(cut));
  assert.deepEqual(toLines("ok\x1b[31", true), [[{ text: "ok", style: {} }]]);
  // An OSC that never ends does not swallow everything after it.
  assert.equal(texts(toLines(`\x1b]0;${"x".repeat(5000)}`, true)).length, 1);
});

test("a broken escape sequence leaves what follows it to show, and to copy", () => {
  // No more comes (the command has ended): an OSC without its end shows what follows its start.
  assert.deepEqual(texts(toLines("ok\x1b]0;title")), ["ok0;title"]);
  assert.deepEqual(texts(toLines("ok\x1b[38;5")), ["ok"]);
  // An OSC ends at a newline or another escape sequence before its end, whether or not more may come.
  assert.deepEqual(texts(toLines("\x1b]0;title\nnext\n", true)), ["", "next"]);
  assert.deepEqual(toLines("\x1b]0;title\x1b[31mred", true), [[{ text: "red", style: { fg: 1 } }]]);
  // A CSI without a final byte is left out, and the byte that ended it stays.
  assert.deepEqual(texts(toLines("a\x1b[12\nb")), ["a", "b"]);
  assert.deepEqual(texts(toLines("\x1b[あい")), ["あい"]);
  assert.equal(plainText("ok\x1b]8;;https://example.com\nlink\n"), "ok\nlink");
});

test("the last lines of output, a few characters at most; and a stretch from its first whole line", () => {
  const lines = toLines("one\ntwo\nthree\n");
  assert.deepEqual(lastLines(lines, 2, 100), { lines: lines.slice(1), cut: true });
  assert.deepEqual(lastLines(lines, 5, 100), { lines, cut: false });
  // One long line loses its start.
  assert.deepEqual(lastLines(toLines("\x1b[31mabcdefgh\x1b[0m"), 20, 3), { lines: [[{ text: "fgh", style: { fg: 1 } }]], cut: true });
  assert.deepEqual(texts(lastLines(toLines("aaaa\nbb\n"), 20, 5).lines), ["aa", "bb"]);
  assert.deepEqual(texts(lastLines(toLines("😀😀"), 20, 3).lines), ["😀"]);
  assert.deepEqual(texts(linesFrom("2mINFO a\nINFO b\n", true)), ["INFO b"]);
  assert.deepEqual(texts(linesFrom("2mINFO a\nINFO b\n", false)), ["2mINFO a", "INFO b"]);
  assert.deepEqual(texts(linesFrom("no newline", true)), ["no newline"]);
  // Nothing would be left after the cut-off line (the end of a long line, read from inside it): its end shows.
  assert.deepEqual(texts(linesFrom("xxxx\n", true)), ["xxxx"]);
  assert.deepEqual(texts(linesFrom("xxxx\n\x1b[0m", true)), ["xxxx"]);
});

/** The palettes of style.css: the light theme's, and the dark theme's over it. */
function palettes(): { light: Palette; dark: Palette } {
  const css = readFileSync(new URL("../src/web/style.css", import.meta.url), "utf8");
  const vars = (selector: string): Record<string, string> => {
    const body = css.slice(css.indexOf(`${selector} {`)).split("}")[0] ?? "";
    return Object.fromEntries([...body.matchAll(/(--rcs-[a-z0-9]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]]));
  };
  const light = vars(".rcs");
  const dark = { ...light, ...vars(".rcs:is(.dark *)") };
  const of = (v: Record<string, string>) => paletteFrom((name) => v[name] ?? "");
  const p = { light: of(light), dark: of(dark) };
  assert.ok(p.light && p.dark, "the palette is not in style.css");
  return p as { light: Palette; dark: Palette };
}

test("the 16 colors read on the output's background, and any text reads on a background of its own", () => {
  for (const [theme, p] of Object.entries(palettes())) {
    for (const [i, c] of p.colors.entries()) assert.ok(contrast(c, p.paper) >= MIN_CONTRAST, `${theme} ${i}: ${contrast(c, p.paper).toFixed(2)}`);
    // Every pair of the 16 colors (white on red, blue on green, …), the default text on each, and inverse.
    for (let bg = 0; bg < 16; bg++) {
      for (const fg of [undefined, ...p.colors.keys()]) {
        const c = onBackground({ ...(fg !== undefined ? { fg } : {}), bg }, p);
        assert.ok(c && c.backgroundColor === p.colors[bg] && contrast(c.color, c.backgroundColor) >= MIN_CONTRAST, `${theme} ${fg} on ${bg}`);
        const inv = onBackground({ ...(fg !== undefined ? { fg } : {}), bg, inverse: true }, p);
        assert.ok(inv && contrast(inv.color, inv.backgroundColor) >= MIN_CONTRAST, `${theme} inverse ${fg} on ${bg}`);
      }
    }
    assert.ok(contrast(onBackground({ bg: "#ffff00", fg: "#ffffff" }, p)!.color, "#ffff00") >= MIN_CONTRAST);
    // Without a background of its own, a span keeps its classes.
    assert.equal(onBackground({ fg: 1 }, p), undefined);
  }
  // A color that reads already stays as it is.
  assert.equal(readable("#000000", "#ffffff"), "#000000");
});

test("lines: a newline at the very end adds no line, an empty line stays", () => {
  assert.deepEqual(texts(toLines("a\nb\n")), ["a", "b"]);
  assert.deepEqual(texts(toLines("a\n\nb")), ["a", "", "b"]);
  assert.deepEqual(toLines(""), []);
  // A character outside the BMP stays whole when it is overwritten.
  assert.deepEqual(texts(toLines("😀x\rY")), ["Yx"]);
  assert.equal(plainText("\x1b[31mred\x1b[0m\nnext\n"), "red\nnext");
});
