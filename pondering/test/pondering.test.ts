import assert from "node:assert/strict";
import { test } from "node:test";
import { elapsed, tokenCount, toolLabel } from "../src/web/format.ts";
import { hash, PHRASES, pickPhrase } from "../src/web/phrases.ts";

test("the time is written as Claude Code's spinner writes it", () => {
  assert.equal(elapsed(0), "0s");
  assert.equal(elapsed(999), "0s");
  assert.equal(elapsed(12_500), "12s");
  assert.equal(elapsed(59_999), "59s");
  assert.equal(elapsed(60_000), "1m 0s");
  assert.equal(elapsed(65_000), "1m 5s");
  assert.equal(elapsed(3_599_000), "59m 59s");
  assert.equal(elapsed(3_600_000), "1h 0m");
  assert.equal(elapsed(3_725_000), "1h 2m");
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
