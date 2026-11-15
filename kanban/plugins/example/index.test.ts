// The sample's tests: `node --test` in the board plugins' folder runs them. They give `fetch` what gh and the commands
// print, and look at where `state` puts a card with what `fetch` gave.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FetchContext, FetchRepo, FetchStore, StateCard } from "../types.ts";
import { fetch, headings, state } from "./index.ts";
import type { Stacks } from "./stacks.ts";

const card = (over: Partial<StateCard> = {}): StateCard => ({ id: "o/r:/r/wt", repo: "o/r", label: "wt", path: "/r/wt", branch: "feat/5-x", title: "feat/5-x", sessions: [], ...over });

test("a card goes in a column by its pull request and its Claude Code sessions, with what to ask Claude next", () => {
  const info = { prs: { 7: { ci: "pending" as const } }, stacks: {} };
  const open = { number: 7, url: "https://github.com/o/r/pull/7", state: "open" as const };
  assert.deepEqual(state(card({ pr: { ...open, state: "merged" } }), info), { column: "done", reason: "マージ済み", marks: [] });
  assert.equal(state(card({ sessions: [{ sessionId: "s", status: "waiting" }] }), info).column, "mine");
  assert.equal(state(card({ pr: open }), info).column, "github");
  assert.equal(state(card({ pr: { ...open, number: 8 } }), info).column, "review");
  assert.deepEqual(state(card({ issue: 5 }), undefined).actions, [{ label: "Issue を実装する", text: "Issue #5 を読んで実装して" }]);
});

test("the sample finds the deploys with ps and lsof, puts the deploying card in GitHub 待ち, and keeps the worktree that deployed to each Stack last", async () => {
  const repo: FetchRepo = { repo: "o/r", primary: { path: "/r/main", branch: "main" }, worktrees: [{ branch: "feat/5-x", path: "/r/wt" }], prs: [], closed: [] };
  let ps = [
    "  101 bash ./deploy.sh --stage dev1 -b",
    "  102 /bin/zsh -c cd /r/wt && ./deploy.sh --stage dev1",
    "  103 /bin/bash /r/main/infra/deploy.sh --stage=dev2",
    "  104 vim deploy.sh --stage dev1",
    "  105 bash ./deploy.sh -b -- --stage dev3",
    "  106 bash /elsewhere/deploy.sh --stage dev4",
    "  107 bash ./deploy.sh --stage dev5",
  ].join("\n");
  const exec: FetchContext["exec"] = async (command, args) => {
    if (command === "ps") return { stdout: ps, stderr: "" };
    assert.deepEqual([command, ...args], ["lsof", "-a", "-p", "101,107", "-d", "cwd", "-Fpn"]);
    // 107 ended after ps: lsof fails, and still prints the others.
    throw Object.assign(new Error("exit 1"), { code: 1, stdout: "p101\nfcwd\nn/r/wt/infra\n", stderr: "" });
  };
  let kept: unknown;
  const store: FetchStore<Stacks> = { get: () => kept as Stacks | undefined, set: async (v) => void (kept = v) };
  const github = { read: async () => assert.fail("no pull request: gh is not needed") };
  const fetched = await fetch(repo, { github, exec, store });
  assert.deepEqual(
    Object.entries(fetched.stacks).map(([s, r]) => [s, r.path, r.running]),
    [
      ["dev1", "/r/wt", ["/r/wt"]],
      ["dev2", "/r/main", ["/r/main"]],
    ],
  );
  assert.deepEqual(kept, fetched.stacks);
  const card: StateCard = { id: "o/r:/r/wt", repo: "o/r", label: "wt", path: "/r/wt", branch: "feat/5-x", title: "feat/5-x", sessions: [{ sessionId: "s", status: "busy" }] };
  const deploying = state(card, fetched);
  assert.deepEqual([deploying.column, deploying.reason, deploying.marks?.map((m) => [m.text, m.active])], ["github", "dev1 にデプロイしている", [["dev1 デプロイ中", true]]]);

  // The deploys are over: the worktree stays the one that deployed last, and the card goes back to its column.
  ps = "";
  const after = await fetch(repo, { github, exec, store });
  const done = state(card, after);
  assert.deepEqual([done.column, done.marks?.map((m) => [m.text, m.active ?? false])], ["agent", [["dev1", false]]]);
  assert.deepEqual(
    headings(repo, after).map((h) => [h.label, h.text, h.active ?? false, typeof h.at]),
    [
      ["dev1", "wt", false, "number"],
      ["dev2", "main", false, "number"],
    ],
  );
});
