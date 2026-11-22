import assert from "node:assert/strict";
import { test } from "node:test";
import { elapsed, tokenCount, toolLabel } from "../src/web/format.ts";
import { hash, PHRASES, pickPhrase } from "../src/web/phrases.ts";
import { dropped, KEPT, nextBaseline, shown, type Baseline } from "../src/web/work.ts";

test("the time is written as Claude Code's spinner writes it", () => {
  assert.equal(elapsed(0), "0s");
  assert.equal(elapsed(999), "0s");
  assert.equal(elapsed(12_500), "12s");
  assert.equal(elapsed(59_999), "59s");
  assert.equal(elapsed(60_000), "1m 0s");
  assert.equal(elapsed(65_000), "1m 5s");
  assert.equal(elapsed(3_599_000), "59m 59s");
  assert.equal(elapsed(3_600_000), "1h 0m 0s");
  assert.equal(elapsed(3_725_000), "1h 2m 5s");
  // The working server's clock ahead of the browser's.
  assert.equal(elapsed(-4000), "0s");
});

test("tokens are cut, never rounded up, and keep no .0", () => {
  assert.equal(tokenCount(0), "0");
  assert.equal(tokenCount(850), "850");
  assert.equal(tokenCount(999), "999");
  assert.equal(tokenCount(1000), "1k");
  assert.equal(tokenCount(1250), "1.2k");
  assert.equal(tokenCount(1300), "1.3k");
  assert.equal(tokenCount(1999), "1.9k");
  assert.equal(tokenCount(9999), "9.9k");
  assert.equal(tokenCount(10_000), "10k");
  assert.equal(tokenCount(999_999), "999k");
  assert.equal(tokenCount(1_000_000), "1M");
  assert.equal(tokenCount(1_250_000), "1.2M");
  assert.equal(tokenCount(-5), "0");
});

test("a tool is written as its call, an MCP server's tool with its server", () => {
  assert.equal(toolLabel({ name: "Bash", summary: "npm test" }), "Bash(npm test)");
  assert.equal(toolLabel({ name: "Bash", summary: "cd app &&\n  npm   test" }), "Bash(cd app && npm test)");
  assert.equal(toolLabel({ name: "Read" }), "Read");
  assert.equal(toolLabel({ name: "Read", summary: "  " }), "Read");
  assert.equal(toolLabel({ name: "mcp__claude_ai_Gmail__search_threads", summary: "from:me" }), "claude_ai_Gmail · search_threads(from:me)");
});

test("the phrases are six languages' words, none empty and none twice", () => {
  assert.deepEqual(Object.keys(PHRASES).sort(), ["de", "en", "ja", "ko", "tok", "zh-Hans"]);
  for (const [lang, list] of Object.entries(PHRASES)) {
    assert.ok(list.length >= 8, lang);
    assert.equal(new Set(list).size, list.length, lang);
    for (const p of list) assert.ok(p.trim() === p && p.length > 0 && !p.endsWith("…"), `${lang}: ${p}`);
  }
});

test("a seed always gets the same phrase, and the seeds of many works reach every language and most phrases", () => {
  assert.deepEqual(pickPhrase("s1/1731580000000"), pickPhrase("s1/1731580000000"));
  assert.equal(hash("a"), hash("a"));
  assert.notEqual(hash("a"), hash("b"));
  const seen = new Map<string, Set<string>>();
  for (let i = 0; i < 6000; i++) {
    const p = pickPhrase(`d5f0c1aa-session/${1_731_580_000_000 + i * 37_123}`);
    assert.ok(PHRASES[p.lang]?.includes(p.text), JSON.stringify(p));
    if (!seen.has(p.lang)) seen.set(p.lang, new Set());
    seen.get(p.lang)?.add(p.text);
  }
  assert.equal(seen.size, 6);
  // Each language about as often as the others: a sixth of 6000 is 1000.
  const counts = [...seen.keys()].map((lang) => [...Array(6000).keys()].filter((i) => pickPhrase(`d5f0c1aa-session/${1_731_580_000_000 + i * 37_123}`).lang === lang).length);
  for (const n of counts) assert.ok(n > 800 && n < 1200, String(counts));
  for (const [lang, texts] of seen) assert.equal(texts.size, PHRASES[lang]?.length, lang);
});

// The start of a work as Gasho first gives it, from the hook of the person's message.
const HOOK = 1_731_580_000_000;

test("a start that moves by milliseconds is the same work: its tokens, start and phrase stay", () => {
  const base = nextBaseline(null, HOOK, 1000, HOOK + 500, HOOK - 60_000);
  assert.deepEqual(base, { turn: HOOK, output: 1000, early: true, seen: HOOK + 500 });
  // Three minutes on, the hook is gone from those Gasho keeps: the start is the message's in the conversation.
  for (const turn of [HOOK + 230, HOOK - 300]) {
    assert.equal(nextBaseline(base, turn, 13_300, HOOK + 180_000, undefined), base);
    assert.deepEqual(shown(base, turn, 13_300, true), { start: HOOK, tokens: 12_300, seed: 1000 });
  }
});

test("a start further away is another work, counted only when seen near its start", () => {
  const base: Baseline = { turn: HOOK, output: 1000, early: true };
  const next = HOOK + 60_000;
  assert.deepEqual(nextBaseline(base, next, 5000, next + 2000, undefined), { turn: next, output: 5000, early: true, seen: next + 2000 });
  assert.deepEqual(nextBaseline(base, next, 5000, next + 120_000, undefined), { turn: next, output: 5000, early: false, seen: next + 120_000 });
  assert.deepEqual(shown(base, next, 5000, true), { start: next, tokens: undefined, seed: next });
});

test("after a reload, the baseline kept in the browser counts on for the same work", () => {
  const stored: Baseline = { turn: HOOK, output: 1000, early: true };
  // The reloaded page gets fewer hooks: the start is the message's in the conversation, and nothing was seen out of work.
  assert.equal(nextBaseline(stored, HOOK + 230, 20_000, HOOK + 600_000, undefined), stored);
  assert.deepEqual(shown(stored, HOOK + 230, 20_000, false), { start: HOOK, tokens: 19_000, seed: 1000 });
});

test("a start Gasho no longer knows keeps the baseline: counted on while watched, and again once known", () => {
  const base: Baseline = { turn: HOOK, output: 1000, early: true };
  assert.equal(nextBaseline(base, undefined, 6000, HOOK + 600_000, undefined), base);
  assert.deepEqual(shown(base, undefined, 6000, true), { start: HOOK, tokens: 5000, seed: 1000 });
  // Not watched since the start was known (a reload): the baseline may be of an earlier work. Only the phrase stays.
  assert.deepEqual(shown(base, undefined, 6000, false), { start: undefined, tokens: undefined, seed: 1000 });
  assert.deepEqual(shown(base, HOOK + 230, 7000, false), { start: HOOK, tokens: 6000, seed: 1000 });
  // A work seen from its start, before Gasho tells when it started.
  const fresh = nextBaseline(base, undefined, 6000, HOOK + 600_000, HOOK + 590_000);
  assert.deepEqual(fresh, { output: 6000, early: true, seen: HOOK + 600_000 });
  assert.deepEqual(shown(fresh, undefined, 6100, false), { start: undefined, tokens: 100, seed: 6000 });
  // Its start, told a few seconds later, joins the baseline: the count and the phrase go on.
  const told = nextBaseline(fresh, HOOK + 599_000, 6300, HOOK + 604_000, undefined);
  assert.deepEqual(told, { turn: HOOK + 599_000, output: 6000, early: true, seen: HOOK + 600_000 });
  assert.deepEqual(shown(told, HOOK + 599_000, 6300, true), { start: HOOK + 599_000, tokens: 300, seed: 6000 });
  // A second such work, seen from its start too, is counted from its own start.
  assert.deepEqual(nextBaseline(fresh, undefined, 9000, HOOK + 900_000, HOOK + 890_000), { output: 9000, early: true, seen: HOOK + 900_000 });
});

test("a new work shows nothing of the last while Gasho still gives the last one's start", () => {
  const last: Baseline = { turn: HOOK, output: 1000, early: true, seen: HOOK + 500 };
  // The session was seen out of work, and works again; the hook of the new message has not come yet.
  const now = HOOK + 300_000;
  const base = nextBaseline(last, HOOK + 230, 13_300, now, HOOK + 200_000);
  assert.deepEqual(base, { output: 13_300, early: true, seen: now, before: HOOK + 230 });
  assert.deepEqual(shown(base, HOOK + 230, 13_400, false), { start: undefined, tokens: 100, seed: 13_300 });
  assert.equal(nextBaseline(base, HOOK, 13_500, now + 1000, undefined), base);
  // Then Gasho gives the new start: the count goes on, and the phrase is the one picked before.
  const told = nextBaseline(base, now - 800, 13_600, now + 2000, undefined);
  assert.deepEqual(told, { turn: now - 800, output: 13_300, early: true, seen: now });
  assert.deepEqual(shown(told, now - 800, 13_600, true), { start: now - 800, tokens: 300, seed: 13_300 });
});

test("without a baseline here, a new work shows nothing of the last message's start, which Gasho still gives", () => {
  // Opened while the session was out of work; the Stop hook of its last work is gone from those Gasho keeps, so Gasho
  // gives the last message in the conversation, three hours old, until the hook of the new one comes.
  const now = HOOK + 3 * 3_600_000;
  const base = nextBaseline(null, HOOK, 5000, now, now - 60_000);
  assert.deepEqual(base, { output: 5000, early: true, seen: now, before: HOOK });
  assert.deepEqual(shown(base, HOOK, 5040, false), { start: undefined, tokens: 40, seed: 5000 });
  const told = nextBaseline(base, now - 500, 5040, now + 2500, undefined);
  assert.deepEqual(shown(told, now - 500, 5040, true), { start: now - 500, tokens: 40, seed: 5000 });
  // A start told before this view saw the session out of work, but less than LATE_MS ago, is the new work's.
  assert.deepEqual(nextBaseline(null, now - 3000, 5000, now, now - 1000), { turn: now - 3000, output: 5000, early: true, seen: now });
});

test("a work seen first well after its start, once out of work was seen here, keeps its start", () => {
  // Seen out of work, then the page stopped (a closed lid, a locked phone) and runs again two minutes into the next work.
  const last: Baseline = { turn: HOOK, output: 1000, early: true, seen: HOOK + 500 };
  const start = HOOK + 600_000;
  const base = nextBaseline(last, start, 9000, start + 120_000, HOOK + 60_000);
  assert.equal(base.turn, start);
  assert.equal(shown(base, start, 9500, false).start, start);
});

test("a baseline kept from an earlier work does not take the start of a later one", () => {
  // Taken while Gasho did not know the start; the page was reloaded during a later work.
  const stored: Baseline = { output: 6000, early: true, seen: HOOK };
  const later = HOOK + 600_000;
  assert.deepEqual(nextBaseline(stored, later, 9000, later + 500, undefined), { turn: later, output: 9000, early: true, seen: later + 500 });
});

test("the browser keeps the baselines of the sessions seen last, and drops those without a time first", () => {
  const stored: [string, Baseline | null][] = [];
  for (let i = 0; i < KEPT; i++) stored.push([`k${i}`, { output: 0, early: true, seen: HOOK + i }]);
  assert.deepEqual(dropped(stored), []);
  stored.push(["old", { turn: HOOK - 1, output: 0, early: true }], ["broken", null]);
  assert.deepEqual(dropped(stored).sort(), ["broken", "old"]);
  stored.push(["new", { output: 0, early: true, seen: HOOK + 1000 }]);
  assert.deepEqual(dropped(stored).sort(), ["broken", "k0", "old"]);
});
