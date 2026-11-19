import assert from "node:assert/strict";
import { test } from "node:test";
import { numberFrom } from "../src/web/number.ts";
import { leftAfter, withDraft } from "../src/web/ui/input.ts";

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

test("a draft is set for the number it is typed for, and a send that ends on another number leaves that one's", () => {
  const typed = withDraft<string>(undefined, "issues#1", "comment", "LGTM");
  assert.deepEqual(typed, { at: "issues#1", values: { comment: "LGTM" } });
  assert.deepEqual(withDraft<string>(typed, "issues#1", "comment", (d) => `${d}!`), { at: "issues#1", values: { comment: "LGTM!" } });
  assert.deepEqual(withDraft<string>(typed, "issues#1", "comment", undefined), { at: "issues#1", values: {} });
  // #1's comment was sent, and the worktree's screen shows #2 when it ends.
  const onTwo = { at: "issues#2", values: { comment: "#2 に書いている" } };
  assert.equal(withDraft<string>(onTwo, "issues#1", "comment", () => undefined), onTwo);
  // Nothing typed on #2: what #2 types next must not go to drafts made for #1.
  assert.equal(withDraft<string>(undefined, "issues#1", "comment", () => undefined), undefined);
});
