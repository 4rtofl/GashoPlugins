import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { answerCalls, sdk } from "../../test/sdk.tsx";
import type { GitHubItemDetail } from "../src/types.ts";
import More from "../src/web/item/sections/more.tsx";
import { detail, fill, reads, renderItem, REPO, writes } from "./render.tsx";

const item = (over: Partial<GitHubItemDetail> = {}) => detail({ title: "移す", ...over });
const mergedPull = () => item({ kind: "pulls", state: "merged", head: "feat/12-x", base: "main" });

const show = (it = item()) => renderItem(it, <More.View />);

const unlocked = { locked: { data: { locked: false } } };
const readsOf = (op: string) => sdk.request.mock.calls.filter(([t]) => (t.params as { op?: string }).op === op);

describe("locking the conversation", () => {
  it("locks it with the reason chosen", async () => {
    reads(unlocked);
    show();
    await userEvent.click(screen.getByRole("button", { name: "会話をロックする" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "会話をロックする" })).getByRole("button", { name: "解決した" }));
    expect(writes()).toMatchObject([{ op: "lock", repo: REPO, number: 12, lock: true, reason: "resolved" }]);
  });

  it("unlocks a locked one, and the toast locks it again for the same reason", async () => {
    reads({ locked: { data: { locked: true, reason: "too_heated" } } });
    show();
    expect(screen.getByText("ロック中（白熱しすぎている）")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "ロックを外す" }));
    expect(writes()).toMatchObject([{ op: "lock", lock: false }]);
    await userEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(writes()[1]).toMatchObject({ op: "lock", lock: true, reason: "too_heated" });
  });

  it("puts the focus back where it was before F8 when the toast's Undo is pressed from the keys", async () => {
    reads({ locked: { data: { locked: true, reason: "too_heated" } } });
    show();
    const unlock = screen.getByRole("button", { name: "ロックを外す" });
    unlock.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{F8}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "元に戻す" }));
    // The button goes away as it is pressed.
    await userEvent.keyboard("{Enter}");
    expect(writes()[1]).toMatchObject({ op: "lock", lock: true });
    expect(document.activeElement).toBe(unlock);
  });

  it("offers no lock when its state could not be read", () => {
    reads({ locked: { error: "gh: HTTP 404" } });
    show();
    expect(screen.getByText("ロックの状態を読めませんでした")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /ロック/ })).toBeNull();
  });
});

describe("pinning an issue", () => {
  it("pins one that is not pinned, and unpins one that is", async () => {
    reads(unlocked);
    const { unmount } = show();
    await userEvent.click(screen.getByRole("button", { name: "ピン留めする" }));
    expect(writes()).toMatchObject([{ op: "pin", pin: true }]);
    unmount();

    show(item({ pinned: true }));
    expect(screen.getByText("ピン留め中")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "ピン留めを外す" }));
    expect(writes()[1]).toMatchObject({ op: "pin", pin: false });
  });

  it("is not offered for a pull request, nor is moving it", () => {
    reads(unlocked);
    show(item({ kind: "pulls" }));
    expect(screen.queryByRole("button", { name: "ピン留めする" })).toBeNull();
    expect(screen.queryByRole("button", { name: "別の repo に移す" })).toBeNull();
  });
});

describe("moving an issue to another repository", () => {
  it("reads where it can go only once asked, asks again, then says where it went", async () => {
    reads({ ...unlocked, "transfer-targets": { data: ["4rtofl/docs", "4rtofl/other"] } });
    answerCalls({ write: (p: { op: string }) => (p.op === "transfer" ? { ok: true, data: { url: "https://github.com/4rtofl/other/issues/3", number: 3 } } : { ok: true, data: undefined }) });
    show();
    expect(readsOf("transfer-targets")).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "別の repo に移す" }));
    expect(readsOf("transfer-targets").length).toBeGreaterThan(0);
    const popup = () => within(screen.getByRole("dialog", { name: "別の repo に移す" }));
    await fill(popup().getByRole("textbox", { name: "移す先の repo：名前で探す" }), "oth");
    expect(popup().queryByRole("button", { name: "4rtofl/docs" })).toBeNull();
    await userEvent.click(popup().getByRole("button", { name: "4rtofl/other" }));
    expect(writes()).toEqual([]);
    expect(popup().getByText(/#12 を 4rtofl\/other に移します。/)).toBeTruthy();

    await userEvent.click(popup().getByRole("button", { name: "移す" }));
    expect(writes()).toMatchObject([{ op: "transfer", repo: REPO, number: 12, to: "4rtofl/other" }]);
    expect(screen.getByText("#12 を 4rtofl/other に移しました（移した先の番号は #3）。この画面の番号では、もう読めません。")).toBeTruthy();
    expect(screen.getByRole("link", { name: /GitHub で開く/ }).getAttribute("href")).toBe("https://github.com/4rtofl/other/issues/3");
  });

  it("says why it could not move it, and shows nothing as moved", async () => {
    reads({ ...unlocked, "transfer-targets": { data: ["4rtofl/other"] } });
    answerCalls({ write: { ok: false, error: "gh: not allowed" } });
    show();
    await userEvent.click(screen.getByRole("button", { name: "別の repo に移す" }));
    await userEvent.click(screen.getByRole("button", { name: "4rtofl/other" }));
    await userEvent.click(screen.getByRole("button", { name: "移す" }));
    expect(screen.getByText("「#12 を 4rtofl/other に移す」ができませんでした")).toBeTruthy();
    expect(screen.getByText("gh: not allowed")).toBeTruthy();
    expect(screen.queryByText(/に移しました/)).toBeNull();
  });

  it("says which repositories it can go to when there is none", async () => {
    reads({ ...unlocked, "transfer-targets": { data: [] } });
    show();
    await userEvent.click(screen.getByRole("button", { name: "別の repo に移す" }));
    expect(screen.getByText("移せる repo がありません（同じ owner で、Issue があり、書き込める repo だけに移せます）。")).toBeTruthy();
  });
});

describe("reverting a merged pull request", () => {
  it("makes the pull request that reverts it, as a draft when asked, and opens it here", async () => {
    reads(unlocked);
    answerCalls({ write: (p: { op: string }) => (p.op === "revert" ? { ok: true, data: { number: 40, url: `https://github.com/${REPO}/pull/40` } } : { ok: true, data: undefined }) });
    show(mergedPull());
    await userEvent.click(screen.getByRole("button", { name: "Revert する Pull request を作る" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Draft で作る" }));
    await userEvent.click(screen.getByRole("button", { name: "作る" }));
    expect(writes()).toMatchObject([{ op: "revert", repo: REPO, kind: "pulls", number: 12, draft: true }]);
    expect(screen.getByText("#12 を Revert する Pull request #40 を作りました。")).toBeTruthy();
    await userEvent.click(screen.getByRole("link", { name: "#40 を開く" }));
    expect(sdk.nav.openWorktreeView).toHaveBeenCalledWith("item", { kind: "pulls", number: "40" }, undefined);
  });

  it("says why it could not make it", async () => {
    reads(unlocked);
    answerCalls({ write: { ok: false, error: "gh: merge commit not found" } });
    show(mergedPull());
    await userEvent.click(screen.getByRole("button", { name: "Revert する Pull request を作る" }));
    await userEvent.click(screen.getByRole("button", { name: "作る" }));
    expect(screen.getByText("「#12 を Revert する Pull request を作る」ができませんでした")).toBeTruthy();
    expect(screen.queryByText(/を作りました。/)).toBeNull();
  });

  it("is offered only for a merged pull request", () => {
    reads(unlocked);
    show(item({ kind: "pulls", state: "open" }));
    expect(screen.queryByRole("button", { name: "Revert する Pull request を作る" })).toBeNull();
  });
});
