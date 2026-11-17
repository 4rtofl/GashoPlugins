// How a browser keeps the columns (src/web/prefs.ts). It reads localStorage, which Node does not have: this file puts
// one in globalThis, so it runs apart from the other tests (node --test runs each file in a process of its own), and
// loads the module anew for each browser, as it reads what was stored once per page view.
import assert from "node:assert/strict";
import { test } from "node:test";

type Prefs = typeof import("../src/web/prefs.ts");

const KEY = "gasho.plugin.kanban.columns";
let loads = 0;

/** A page view of a browser whose localStorage holds `stored`; `written` is what the page stored since. */
async function page(stored: string | null, storage: { get?: "throws"; set?: "throws" } = {}) {
  const written: string[] = [];
  let failSet = storage.set === "throws";
  globalThis.localStorage = {
    getItem: (k: string) => {
      if (storage.get === "throws") throw new DOMException("denied", "SecurityError");
      return k === KEY ? stored : null;
    },
    setItem: (k: string, v: string) => {
      if (failSet) throw new DOMException("full", "QuotaExceededError");
      if (k === KEY) written.push(v);
    },
  } as Storage;
  const prefs = (await import(`${new URL("../src/web/prefs.ts", import.meta.url).href}?page=${loads++}`)) as Prefs;
  return { prefs, written, last: () => JSON.parse(written.at(-1) ?? "null") as unknown, storageWorks: () => void (failSet = false) };
}

test("what an older or broken value stored leaves out is dropped: columns that are gone, values of the wrong kind, orders there are none of", async () => {
  const stored = JSON.stringify({
    widths: { mine: 9999, agent: "wide", gone: 300, review: 100 },
    compact: { done: false, mine: "yes" },
    sort: { mine: { key: "pr", desc: true }, agent: { key: "toString", desc: false }, review: { key: "updated" } },
  });
  const p = await page(stored);
  p.prefs.setColumnCompact("agent", true);
  assert.deepEqual(p.last(), { widths: { mine: 720, review: 180 }, compact: { done: false, agent: true }, sort: { mine: { key: "pr", desc: true } } });

  for (const broken of ["{", "null", "[1]", JSON.stringify({ widths: null, compact: 3, sort: "x" })]) {
    const b = await page(broken);
    b.prefs.setColumnWidth("mine", 100);
    assert.deepEqual(b.last(), { widths: { mine: 180 }, compact: {}, sort: {} }, broken);
    b.prefs.setColumnWidth("mine", undefined);
    b.prefs.setColumnSort("done", { key: "issue", desc: false });
    b.prefs.setColumnSort("done", undefined);
    assert.deepEqual(b.last(), { widths: {}, compact: {}, sort: {} }, broken);
  }
});

test("a browser that does not let the page store (a private window, a full storage) keeps the changes for the page view", async () => {
  const p = await page(JSON.stringify({ widths: { mine: 400 } }), { get: "throws", set: "throws" });
  p.prefs.setColumnWidth("agent", 250);
  assert.deepEqual(p.written, []);
  p.storageWorks();
  p.prefs.setColumnCompact("done", false);
  assert.deepEqual(p.last(), { widths: { agent: 250 }, compact: { done: false }, sort: {} });
});
