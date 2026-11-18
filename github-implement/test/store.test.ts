import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { SeenStore } from "../src/daemon/seen.ts";
import { Store } from "../src/daemon/store.ts";

test("a file of what is kept that is broken starts empty, says so in the log, and is written over", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "implement-store-"));
  try {
    for (const broken of ["", '{"worktrees": {"/w": {"repo"', "null", '"text"', '{"worktrees": null, "items": 3}']) {
      const logged: unknown[][] = [];
      const log = (...args: unknown[]) => void logged.push(args);
      const kept = path.join(dir, "worktrees.json");
      await fs.writeFile(kept, broken);
      const store = new Store(kept, log);
      await store.add("/w", "o/r", 7, 1000);
      assert.deepEqual(store.get("/w")?.added, [7]);
      assert.deepEqual(Object.keys((JSON.parse(await fs.readFile(kept, "utf8")) as { worktrees: object }).worktrees), ["/w"]);

      const seenFile = path.join(dir, "seen.json");
      await fs.writeFile(seenFile, broken);
      const seen = new SeenStore(seenFile, log);
      assert.equal(await seen.get("o/r#7"), undefined);
      await seen.mark("o/r#7", { comment: "2026-11-18T00:00:00Z" }, 1000);
      assert.deepEqual(await new SeenStore(seenFile, log).get("o/r#7"), { comment: "2026-11-18T00:00:00Z" });

      // What is not JSON is told; JSON of another shape is just nothing kept.
      const json = broken === "null" || broken.startsWith('"') || broken.startsWith('{"worktrees": null');
      assert.equal(logged.length, json ? 0 : 2, broken);
    }
    // No file yet is nothing to tell.
    const logged: unknown[] = [];
    await new Store(path.join(dir, "none.json"), (...a) => void logged.push(a)).load();
    assert.equal(logged.length, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
