import assert from "node:assert/strict";
import { test } from "node:test";
import { refAt } from "../src/web/refs.ts";

test("a #number is found at any place of it, as GitHub links it", () => {
  const text = "#19 の上に作る。(#35) と 4rtoflow/Gasho#12 と https://x.example/#7、issue#8 と #9。";
  const at = (s: string, k = 1) => refAt(text, text.indexOf(s) + k);
  assert.deepEqual(refAt(text, 0), { start: 0, end: 3, number: 19 });
  assert.equal(refAt(text, 3)?.number, 19);
  assert.equal(at("#35")?.number, 35);
  // Right after Japanese text and before "。".
  assert.equal(at("#9")?.number, 9);
  // Another repository's, inside a URL, inside a word.
  assert.equal(at("#12"), undefined);
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
