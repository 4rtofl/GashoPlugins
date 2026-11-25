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

test("why a worktree was not removed stays while it has the same branch, and goes with it", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "implement-store-"));
  try {
    const file = path.join(dir, "worktrees.json");
    const store = new Store(file, () => undefined);
    const same = async () => false;
    await store.seen("/w", "o/r", "feat/7", 1000, same, "/r");
    await store.notRemoved("/w", "未コミットの変更が 1 件あります。", 2000);
    // Shown again, without the repository's folder: what was kept of it stays, and the file has it all.
    await store.seen("/w", "o/r", "feat/7", 3000, same);
    const reread = new Store(file, () => undefined);
    await reread.load();
    assert.equal(reread.get("/w")?.repoDir, "/r");
    assert.deepEqual(reread.get("/w")?.notRemoved, { problem: "未コミットの変更が 1 件あります。", at: 2000 });
    await store.seen("/w", "o/r", "other", 4000, same);
    assert.equal(store.get("/w")?.notRemoved, undefined);
    await store.forget("/w");
    assert.equal(store.get("/w"), undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
