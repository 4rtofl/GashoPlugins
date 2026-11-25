import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { respond, sdk } from "../../test/sdk.tsx";
import type { PullMerge } from "../src/daemon/ops/mergeable.ts";
import type { GitHubItemDetail } from "../src/types.ts";
import Merge from "../src/web/item/sections/merge.tsx";
import Merged from "../src/web/item/sections/merged.tsx";
import { detail, github, reads, renderItem, REPO, writes } from "./render.tsx";

const pull = (over: Partial<GitHubItemDetail> = {}) => detail({ kind: "pulls", title: "マージを足す", head: "feat/12-merge", base: "main", ...over });

const show = (item = pull()) => renderItem(item, <Merge.View />);

const merge = (over: Partial<PullMerge> = {}): PullMerge => ({
  methods: ["merge", "squash", "rebase"],
  preferred: "squash",
  rebaseable: true,
  deletesBranch: false,
  head: "feat/12-merge",
  headOid: "abc1234",
  base: "main",
  queue: false,
  queued: false,
  blockers: [],
  unstable: [],
  auto: { allowed: true, canEnable: true, canDisable: false },
  ...over,
});

const mergeable = (m: PullMerge) => reads({ mergeable: { data: m } });

describe("the merge of an open pull request", () => {
  it("merges only once it is asked again, with the method GitHub offers first and the head as read", async () => {
    mergeable(merge());
    show();
    await userEvent.click(screen.getByRole("button", { name: "マージする…" }));
    expect(writes()).toEqual([]);
    expect(screen.getByText("マージは、ここでは元に戻せません。")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Squash でマージする" }));
    expect(writes()).toMatchObject([{ op: "merge", repo: REPO, number: 12, action: "merge", method: "squash", deleteBranch: false, head: "abc1234" }]);
  });

  it("goes back without merging when the second question is declined", async () => {
    mergeable(merge());
    show();
    await userEvent.click(screen.getByRole("button", { name: "マージする…" }));
    await userEvent.click(screen.getByRole("button", { name: "やめる" }));
    expect(writes()).toEqual([]);
    expect(screen.getByRole("button", { name: "マージする…" })).toBeTruthy();
  });

  it("deletes the head branch with the merge only when asked to", async () => {
    mergeable(merge());
    show();
    await userEvent.click(screen.getByRole("checkbox", { name: /マージしたら、GitHub の feat\/12-merge を消す/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Merge commit" }));
    await userEvent.click(screen.getByRole("button", { name: "マージする…" }));
    await userEvent.click(screen.getByRole("button", { name: "Merge commit でマージする" }));
    expect(writes()).toMatchObject([{ action: "merge", method: "merge", deleteBranch: true }]);
  });

  it("asks nothing about the branch when the repository deletes it itself", async () => {
    mergeable(merge({ deletesBranch: true }));
    show();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText(/マージすると、GitHub が/).textContent).toContain("feat/12-merge");
    await userEvent.click(screen.getByRole("button", { name: "マージする…" }));
    await userEvent.click(screen.getByRole("button", { name: "Squash でマージする" }));
    expect(writes()).toMatchObject([{ deleteBranch: false }]);
  });

  it("offers the next method when GitHub's first is a rebase that would conflict", async () => {
    mergeable(merge({ preferred: "rebase", rebaseable: false }));
    show();
    expect(screen.getByRole("radio", { name: "Rebase" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("radio", { name: "Merge commit" })).toHaveProperty("checked", true);
    await userEvent.click(screen.getByRole("button", { name: "マージする…" }));
    expect(screen.getByRole("button", { name: "Merge commit でマージする" })).toBeTruthy();
  });

  it("says why it cannot be merged, and offers no auto-merge for what needs a person first", () => {
    mergeable(merge({ blockers: [{ kind: "draft" }, { kind: "conflict" }, { kind: "checks", failing: ["test"], pending: ["build"] }] }));
    show();
    expect(screen.getByText("いまはマージできません")).toBeTruthy();
    expect(screen.getByText("Draft です。Ready for review にすると、マージできます。")).toBeTruthy();
    expect(screen.getByText("main と衝突しています。衝突を解消すると、マージできます。")).toBeTruthy();
    expect(screen.getByText("必須のチェックが通っていません：test。必須のチェックが終わっていません：build。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "マージする…" })).toHaveProperty("disabled", true);
    expect(screen.queryByRole("button", { name: "自動マージを入れる" })).toBeNull();
  });

  it("offers auto-merge while it only waits for checks and reviews", async () => {
    mergeable(merge({ blockers: [{ kind: "checks", failing: [], pending: ["build"] }, { kind: "review", decision: "review_required" }] }));
    show();
    expect(screen.getByRole("button", { name: "マージする…" })).toHaveProperty("disabled", true);
    await userEvent.click(screen.getByRole("button", { name: "自動マージを入れる" }));
    expect(writes()).toMatchObject([{ op: "merge", action: "auto", method: "squash", head: "abc1234" }]);
  });

  it("says so when the repository does not allow auto-merge for one that waits", () => {
    mergeable(merge({ blockers: [{ kind: "behind" }], auto: { allowed: false, canEnable: false, canDisable: false } }));
    show();
    expect(screen.queryByRole("button", { name: "自動マージを入れる" })).toBeNull();
    expect(screen.getByText("この repo では自動マージが許されていません（GitHub の Settings で選べます）。")).toBeTruthy();
  });

  it("puts one that still waits in the merge queue, which deletes no branch", async () => {
    mergeable(merge({ queue: true, blockers: [{ kind: "checks", failing: [], pending: ["build"] }] }));
    show();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "マージキューに入れる…" }));
    await userEvent.click(screen.getByRole("button", { name: "マージキューに入れる" }));
    expect(writes()).toMatchObject([{ action: "merge", method: "squash", deleteBranch: false }]);
  });

  it("shows the auto-merge that is on, and turns it off", async () => {
    mergeable(merge({ blockers: [{ kind: "checks", failing: [], pending: ["build"] }], auto: { allowed: true, canEnable: false, canDisable: true, on: { method: "rebase" } } }));
    show();
    expect(screen.getByText(/自動マージが入っています（Rebase）/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "マージする…" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "自動マージをやめる" }));
    expect(writes()).toMatchObject([{ op: "merge", action: "cancel-auto" }]);
  });

  it("offers to read again while GitHub has not worked out whether it merges", async () => {
    mergeable(merge({ blockers: [{ kind: "unknown" }] }));
    show();
    await userEvent.click(screen.getByRole("button", { name: "読み直す" }));
    expect(sdk.reload).toHaveBeenCalledWith("read");
  });

  it("shows an error of the read with a button that reads again", async () => {
    respond({ read: { error: "gh: HTTP 502" } });
    show();
    expect(screen.getByRole("alert").textContent).toContain("gh: HTTP 502");
    await userEvent.click(screen.getByRole("button", { name: "読み直す" }));
    expect(sdk.reload).toHaveBeenCalledWith("read");
  });
});

describe("the dialog that removes the worktree of a merged pull request", () => {
  it("closes on a press that begins and ends on the backdrop, and not on one that begins inside (selecting the folder)", async () => {
    const worktree = { path: "/work/app-12", repo: "/work/app", branch: "feat/12-merge", github, sessions: [] };
    reads({ items: { data: { pulls: [{ kind: "pulls", number: 12, title: "マージを足す", state: "merged", url: "" }], added: [], missing: [], at: 0 } } });
    renderItem(pull({ state: "merged" }), <Merged.View />, worktree);
    await userEvent.click(screen.getByRole("button", { name: "worktree とセッションを削除…" }));
    // A press on the backdrop is a press on the dialog itself.
    const dialog = screen.getByRole("dialog", { name: "worktree とセッションを削除" });
    fireEvent.pointerDown(screen.getByText("/work/app-12"));
    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).toBeTruthy();
    fireEvent.pointerDown(dialog);
    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says why removing it without asking did not, as the worktree's items have it", () => {
    const worktree = { path: "/work/app-12", repo: "/work/app", branch: "feat/12-merge", github, sessions: [] };
    const notRemoved = { problem: "未コミットの変更が 2 件あります。", at: 0 };
    reads({ items: { data: { pulls: [{ kind: "pulls", number: 12, title: "マージを足す", state: "merged", url: "" }], added: [], missing: [], at: 0, notRemoved } } });
    renderItem(pull({ state: "merged" }), <Merged.View />, worktree);
    expect(screen.getByRole("alert").textContent).toBe("自動では削除しませんでした：未コミットの変更が 2 件あります。");
  });
});
