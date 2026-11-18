import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { askedState, recheck } from "../src/web/asked.ts";

const URL = "https://github.com/o/r/pull/5";
const OF = { kind: "merge", sha: "abc1234" } as const;

/** A reading of GitHub that ends when told. */
function reading() {
  let calls = 0;
  const ends: { ok: () => void; fail: () => void }[] = [];
  return {
    refresh: () => {
      calls++;
      return new Promise<void>((ok, no) => ends.push({ ok, fail: () => no(new Error("読めません")) }));
    },
    calls: () => calls,
    end: (i: number) => ends[i],
  };
}
const settled = () => new Promise<void>((r) => setImmediate(r));

test("recheck: the rows that saw one end of the work read GitHub once; the time it was read is kept for the end it was of", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  try {
    const r = reading();
    recheck(URL, OF, r.refresh);
    recheck(URL, OF, r.refresh);
    assert.equal(r.calls(), 1);
    assert.deepEqual(askedState().rechecks.get(URL), { ...OF, ended: 1_000_000 });

    mock.timers.tick(400);
    r.end(0)?.ok();
    await settled();
    assert.equal(askedState().rechecks.get(URL)?.refreshed, 1_000_400);

    // The work went on, and ended again.
    mock.timers.tick(5000);
    recheck(URL, OF, r.refresh);
    assert.equal(r.calls(), 2);
    const again = askedState().rechecks.get(URL);
    assert.deepEqual(again, { ...OF, ended: 1_005_400 });

    // Reading failed: the rows do not wait for it any longer.
    mock.timers.tick(100);
    r.end(1)?.fail();
    await settled();
    assert.equal(askedState().rechecks.get(URL)?.refreshed, 1_005_500);
  } finally {
    mock.timers.reset();
  }
});

test("recheck: a reading that ends after a later end of the work does not speak for it", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 2_000_000 });
  try {
    const r = reading();
    const url = `${URL}#later`;
    recheck(url, OF, r.refresh);
    mock.timers.tick(2000);
    recheck(url, OF, r.refresh);
    r.end(0)?.ok();
    await settled();
    assert.equal(askedState().rechecks.get(url)?.refreshed, undefined);
    r.end(1)?.ok();
    await settled();
    assert.equal(askedState().rechecks.get(url)?.refreshed, 2_002_000);
  } finally {
    mock.timers.reset();
  }
});
