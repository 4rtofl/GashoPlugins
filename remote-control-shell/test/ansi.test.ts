import assert from "node:assert/strict";
import { test } from "node:test";
import { applySgr, color256, plainText, toLines, type Line } from "../src/web/ansi.ts";

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
  // Erase in line: up to the cursor (1), the whole line (2). Moving the cursor is left out, so it stays at the end.
  assert.deepEqual(texts(toLines("abcdef\x1b[3D\x1b[1K")), ["      "]);
  assert.deepEqual(texts(toLines("abc\x1b[2Kz")), ["   z"]);
  // Windows' line ends, and a backspace (man's bold and underline overstrike).
  assert.deepEqual(texts(toLines("one\r\ntwo\r\n")), ["one", "two"]);
  assert.deepEqual(texts(toLines("A\bA_\bB")), ["AB"]);
});

test("other escape sequences and control characters are left out", () => {
  assert.deepEqual(texts(toLines("\x1b]0;title\x07hi\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\")), ["hilink"]);
  assert.deepEqual(texts(toLines("\x1b[2J\x1b[H\x1b[?25lok\x1b[?25h\x1b(B\x1b7\x1b8\x07!")), ["ok!"]);
  assert.deepEqual(texts(toLines("a\tb\x00c")), ["a\tbc"]);
});

test("an escape sequence cut off at the end waits for the rest", () => {
  for (const cut of ["ok\x1b", "ok\x1b[3", "ok\x1b[38;5", "ok\x1b]0;tit"]) assert.deepEqual(texts(toLines(cut)), ["ok"], JSON.stringify(cut));
  assert.deepEqual(toLines("ok\x1b[31"), [[{ text: "ok", style: {} }]]);
  // An OSC that never ends does not swallow everything after it.
  assert.equal(texts(toLines(`\x1b]0;${"x".repeat(5000)}`)).length, 1);
});

test("lines: a newline at the very end adds no line, an empty line stays", () => {
  assert.deepEqual(texts(toLines("a\nb\n")), ["a", "b"]);
  assert.deepEqual(texts(toLines("a\n\nb")), ["a", "", "b"]);
  assert.deepEqual(toLines(""), []);
  // A character outside the BMP stays whole when it is overwritten.
  assert.deepEqual(texts(toLines("😀x\rY")), ["Yx"]);
  assert.equal(plainText("\x1b[31mred\x1b[0m\nnext\n"), "red\nnext");
});
