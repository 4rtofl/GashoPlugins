import assert from "node:assert/strict";
import { test } from "node:test";
import type { MachineInfo } from "@gasho/plugin-sdk";
import { listArgs, listFilterArg, parseList } from "../src/daemon/ops/list.ts";
import { repoPlaces } from "../src/web/places.ts";

test("the search names the repository, the kind, the filter and the words, in a variable", () => {
  const args = listArgs("o/n", "pulls", "review", "worktree tab");
  assert.equal(args.at(-1), "q=repo:o/n is:pr is:open sort:updated-desc review-requested:@me in:title worktree tab");
  assert.ok(!args.some((a) => a.startsWith("query=") && a.includes("worktree tab")));
  assert.equal(listArgs("o/n", "issues", "all", "").at(-1), "q=repo:o/n is:issue is:open sort:updated-desc");
  assert.equal(listFilterArg(undefined), "all");
  assert.throws(() => listFilterArg("mentions"));
});

test("the list keeps only the repository's items, with their author, labels and comments", () => {
  const node = (number: number, url: string, extra: Record<string, unknown> = {}) => ({
    __typename: "PullRequest",
    number,
    title: `t${number}`,
    state: "OPEN",
    url,
    updatedAt: "2026-11-15T10:00:00Z",
    author: { login: "octocat" },
    labels: { nodes: [{ name: "enhancement", color: "a2eeef" }, { name: "bad", color: "zzz" }] },
    comments: { totalCount: 3 },
    ...extra,
  });
  const json = JSON.stringify({
    data: { search: { issueCount: 120, nodes: [node(1, "https://github.com/o/n/pull/1", { isDraft: true }), node(2, "https://github.com/other/repo/pull/2"), null] } },
  });
  const list = parseList(json, "O/N");
  assert.equal(list.total, 120);
  assert.deepEqual(list.items, [
    {
      kind: "pulls",
      number: 1,
      title: "t1",
      state: "open",
      draft: true,
      url: "https://github.com/o/n/pull/1",
      author: "octocat",
      updatedAt: "2026-11-15T10:00:00Z",
      labels: [{ name: "enhancement", color: "a2eeef" }, { name: "bad" }],
      comments: 3,
    },
  ]);
});

test("the page offers registered repositories first, then those of sessions, each once per working server", () => {
  const gh = (name: string) => ({ owner: "o", name, url: `https://github.com/o/${name}` });
  const machine = {
    id: "m",
    name: "ubuntu",
    sessions: [
      { managed: true, github: gh("b"), worktree: { path: "/r/b-old", repo: "/r/b" }, lastActivityAt: 1 },
      { managed: true, github: gh("b"), worktree: { path: "/r/b-new", repo: "/r/b" }, lastActivityAt: 2 },
      { managed: true, github: gh("a"), worktree: { path: "/r/a-1", repo: "/r/a" } },
      { managed: false, github: gh("c"), worktree: { path: "/r/c", repo: "/r/c" } },
    ],
    repos: [
      { path: "/r/a", github: gh("a"), worktrees: [{ path: "/r/a", branch: "main" }] },
      { path: "/r/gone", github: gh("gone"), worktrees: [], error: "no" },
    ],
  } as unknown as MachineInfo;
  assert.deepEqual(
    repoPlaces([machine]).map((p) => [p.repo, p.path]),
    [
      ["o/a", "/r/a"],
      ["o/b", "/r/b-new"],
    ],
  );
});
