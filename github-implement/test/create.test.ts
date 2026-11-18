import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import type { DaemonContext } from "@gasho/plugin-sdk/daemon";
import { createIssueArgs } from "../src/daemon/ops/create-issue.ts";
import { createPullArgs } from "../src/daemon/ops/create-pull.ts";
import { branchPageArgs, localState, parseBranchPage, parseCompare, parseNewPull } from "../src/daemon/ops/new-pull.ts";
import { parseSearch } from "../src/daemon/ops/search.ts";

const run = promisify(execFile);

test("a branch GitHub does not have is told apart, and the base offered is never the branch itself", () => {
  const json = (head: unknown) =>
    JSON.stringify({
      data: {
        repository: {
          defaultBranchRef: { name: "main" },
          head,
          pullRequestTemplates: [
            { filename: "feature.md", body: "feature" },
            { filename: "PULL_REQUEST_TEMPLATE.md", body: "## 内容" },
          ],
          refs: { nodes: [{ name: "feat/19-almighty-ui" }, { name: "feat/27-almighty-create" }, { name: "main" }] },
        },
      },
    });
  const pushed = parseNewPull(json({ target: { oid: "a".repeat(40) } }), "feat/27-almighty-create");
  assert.equal(pushed.headOid, "a".repeat(40));
  assert.deepEqual(pushed.branches, ["main", "feat/19-almighty-ui"]);
  // The body starts from the default template.
  assert.equal(pushed.templates[0]?.body, "## 内容");
  assert.equal(parseNewPull(json(null), "feat/27-almighty-create").headOid, undefined);
  // A base GitHub does not have compares as nothing, never as "no commits".
  assert.equal(parseCompare(JSON.stringify({ data: { repository: { ref: null } } }), "gone"), undefined);
});

test("the bases offered are the branches with the latest commits first, of every page read", () => {
  const node = (name: string, committedDate: string) => ({ name, target: { committedDate } });
  const first = JSON.stringify({
    data: {
      repository: {
        defaultBranchRef: { name: "main" },
        head: null,
        pullRequestTemplates: [],
        refs: { pageInfo: { hasNextPage: true, endCursor: "MTAw" }, nodes: [node("a-old", "2026-01-01T00:00:00Z"), node("main", "2026-11-01T00:00:00Z")] },
      },
    },
  });
  const page = parseBranchPage(first);
  assert.equal(page.next, "MTAw");
  const second = parseBranchPage(JSON.stringify({ data: { repository: { refs: { pageInfo: { hasNextPage: false, endCursor: "MjAw" }, nodes: [node("z-new", "2026-11-17T00:00:00Z"), node("m-mid", "2026-06-01T00:00:00Z")] } } } }));
  assert.equal(second.next, undefined);
  assert.deepEqual(parseNewPull(first, "feat/1-x", [...page.refs, ...second.refs]).branches, ["main", "z-new", "m-mid", "a-old"]);
  // The cursor goes to GitHub as a variable.
  assert.ok(branchPageArgs("o/r", "MTAw").includes("after=MTAw"));
});

test("the commits not pushed are counted from the worktree's HEAD, and GitHub's commits it lacks are told apart", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "almighty-"));
  try {
    const git = (...args: string[]) => run("git", ["-C", dir, ...args]);
    await git("init", "-q", "-b", "feat/1-x");
    await git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "pushed");
    const pushed = (await git("rev-parse", "HEAD")).stdout.trim();
    await git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "not pushed");
    const ctx = {
      session: { repo: () => ({ dir }) },
      exec: (command: string, args: string[]) => run(command, args),
      log: () => undefined,
    } as unknown as Pick<DaemonContext, "session" | "exec" | "log">;
    assert.deepEqual(await localState(ctx, "feat/1-x", pushed), { ahead: 1, behind: false });
    // GitHub's latest commit is one the worktree has not fetched.
    assert.deepEqual(await localState(ctx, "feat/1-x", "b".repeat(40)), { behind: true });
    // A session on another branch says nothing of this one.
    assert.equal(await localState(ctx, "feat/2-y", pushed), undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("what the forms send never becomes a flag of gh, and gh never pushes the branch", () => {
  const pull = createPullArgs("o/r", { branch: "feat/1-x", base: "main", title: "-t", bodyFile: "/tmp/b.md", draft: true });
  assert.deepEqual(pull, ["pr", "create", "--repo", "o/r", "--head=feat/1-x", "--base=main", "--title=-t", "--body-file=/tmp/b.md", "--draft"]);
  assert.deepEqual(createIssueArgs("o/r", { title: "-t", bodyFile: "/tmp/b.md", labels: ["bug"], assignees: ["@me"] }), ["issue", "create", "--repo", "o/r", "--title=-t", "--body-file=/tmp/b.md", "--label=bug", "--assignee=@me"]);
});

test("a search keeps only the repository's own issues and pull requests", () => {
  const node = (repo: string, number: number) => ({ __typename: "Issue", number, title: `#${number}`, state: "OPEN", url: `https://github.com/${repo}/issues/${number}` });
  // The words may name another repository (repo:…); its #5 is not this repository's #5.
  const json = JSON.stringify({ data: { search: { nodes: [node("4rtofl/GashoPlugins", 27), node("4rtofl/Gasho", 5), node("4rtofl/GashoPlugins2", 6)] } } });
  assert.deepEqual(
    parseSearch(json, "4rtofl/GashoPlugins").map((i) => i.number),
    [27],
  );
});
