import assert from "node:assert/strict";
import { test } from "node:test";
import { refAt, refsIn, refUrl } from "../src/web/refs.ts";

test("a #number is found at any place of it, as GitHub links it", () => {
  const text = "#19 の上に作る。(#35) と 4rtofl/Gasho#12 と https://x.example/#7、issue#8 と #9。";
  const at = (s: string, k = 1) => refAt(text, text.indexOf(s) + k);
  assert.deepEqual(refAt(text, 0), { start: 0, end: 3, number: 19 });
  assert.equal(refAt(text, 3)?.number, 19);
  assert.equal(at("#35")?.number, 35);
  // Right after Japanese text and before "。".
  assert.equal(at("#9")?.number, 9);
  // Another repository's is its own; inside a URL or a word, none.
  assert.deepEqual(at("#12"), { start: text.indexOf("4rtofl"), end: text.indexOf("#12") + 3, repo: "4rtofl/Gasho", number: 12 });
  assert.equal(at("#7"), undefined);
  assert.equal(at("#8"), undefined);
  // Between them.
  assert.equal(refAt(text, text.indexOf("の上")), undefined);
});

test("digits that run on or a letter right after are no #number", () => {
  assert.equal(refAt("#12abc", 1), undefined);
  assert.equal(refAt("#0 は無い", 1), undefined);
  assert.equal(refAt("#1234567890", 1), undefined);
});

test("a commit's hash is a link where GitHub makes one, and words and numbers in hex are not", () => {
  const text = "64dda90 で直した。4rtofl/Gasho@2c37208、https://github.com/o/r/commit/abc1234 と defaced と 1234567 と @c0ffee1 と 123e4567-e89b。";
  assert.deepEqual(
    refsIn(text).map((r) => refUrl(r, "o/r")),
    ["https://github.com/o/r/commit/64dda90", "https://github.com/4rtofl/Gasho/commit/2c37208"],
  );
  assert.equal(refUrl({ start: 0, end: 3, number: 12 }, "o/r"), "https://github.com/o/r/issues/12");
});
