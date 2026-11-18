import assert from "node:assert/strict";
import { test } from "node:test";
import { numberFrom } from "../src/web/number.ts";
import { leftAfter } from "../src/web/ui/input.ts";

test("a number typed in full-width (a Japanese input method) is the same number", () => {
  assert.equal(numberFrom("１７", "4rtofl/Gasho"), 17);
  assert.equal(numberFrom("＃１７", "4rtofl/Gasho"), 17);
  assert.equal(numberFrom("　#17　", "4rtofl/Gasho"), 17);
  assert.equal(numberFrom("１７の件", "4rtofl/Gasho"), undefined);
});

test("what was typed while a comment was being sent stays, and only that", () => {
  assert.equal(leftAfter("LGTM", "LGTM"), "");
  assert.equal(leftAfter("LGTM\n\n追記です", "LGTM"), "追記です");
  // Changed inside what was sent: all of it stays, to be looked at again.
  assert.equal(leftAfter("LGTM!", "LGTM?"), "LGTM!");
});
