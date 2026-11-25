// The panel of a pull request beside the review page: it reads the pull request on the working server that lists it,
// and its buttons get the tools of the page's rows. What was asked of the Agents is kept for the whole file (asked.ts),
// so each test that asks or ends something has a pull request of its own.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { answerCalls, callsOf, changed, lastRequest, machine, respond, scene, sdk, session, set } from "../../test/sdk.tsx";
import { recheck } from "../src/web/asked.ts";
import { PrPanel } from "../src/web/detail.tsx";
import type { Listing, PrDetail, PrRow } from "../src/types.ts";

const head = "abc1234";
const url = (n: number) => `https://github.com/4rtofl/app/pull/${n}`;
const pr = (over: Partial<PrRow> = {}): PrRow => ({
  repo: "4rtofl/app",
  number: 7,
  title: "ログインを直す",
  url: url(7),
  state: "open",
  labels: [],
  comments: 0,
  branch: "fix/7-login",
  head,
  place: { primary: "/work/app" },
  ...over,
});
const mergeable = (n: number) => ({ verdict: "mergeable" as const, sha: head, url: `${url(n)}#issuecomment-1` });
/** #n with its review worktree, whose review says it can be merged: the panel offers "マージしてもらう". */
const reviewed = (n: number): PrRow => pr({ number: n, url: url(n), mark: mergeable(n), place: { primary: "/work/app", worktree: { path: `/work/review-${n}`, branch: `pr-${n}`, review: true } } });
const listing = (over: Partial<Listing> = {}): Listing => ({ watched: ["/work/app"], requested: [], repos: [], hidden: [], errors: [], ...over });
const detail = (over: Partial<PrDetail> = {}): PrDetail => ({ pr: pr(), body: "", comments: [], commentsMore: 0, checks: [], ...over });
const panel = (n = 7) => <PrPanel params={{ repo: "4rtofl/app", number: String(n) }} docked />;

/** useCall's answers to "detail" wait until `done` is called. */
function holdDetail(): { done: () => void } {
  const held = { done: () => {} };
  answerCalls({ detail: () => new Promise((resolve) => (held.done = () => resolve({ ok: true, data: undefined }))) });
  return held;
}

beforeEach(() => set({ machines: [machine({ canLaunch: true })] }));

describe("PrPanel", () => {
  it("marks its pull request open for the list while it is open, and leaves the mark of one opened after it", () => {
    respond({ list: { data: listing() } });
    const first = render(panel(7));
    expect(scene.pluginState.openPr).toBe("4rtofl/app#7");
    const second = render(panel(8));
    first.unmount();
    expect(scene.pluginState.openPr).toBe("4rtofl/app#8");
    second.unmount();
    expect(scene.pluginState.openPr).toBeNull();
  });

  it("reads the pull request on the working server that lists it, and on the first that answers when none does", () => {
    set({ machines: [machine({ id: "m1", name: "mac" }), machine({ id: "m2", name: "linux" })] });
    // The same answers at every drawing, as useRequest gives: a new list each time would be taken in again without end.
    const onLinux = { data: listing({ requested: [pr()] }) };
    const onMac = { data: listing() };
    sdk.request.mockImplementation((t) => (t.method === "list" ? (t.machine === "m2" ? onLinux : onMac) : undefined));
    const listed = render(panel(7));
    expect(new Set(sdk.request.mock.calls.flatMap(([t]) => (t.method === "detail" ? [t.machine] : [])))).toEqual(new Set(["m2"]));
    listed.unmount();
    render(panel(8));
    expect(lastRequest("detail")).toMatchObject({ machine: "m1", params: { repo: "4rtofl/app", number: 8 } });
  });

  it("reads GitHub again on 読み直す, and asks for the detail again only once that is done", async () => {
    respond({ list: { data: listing({ requested: [pr()] }) }, detail: { data: detail() } });
    const held = holdDetail();
    render(panel());
    const button = screen.getByRole("button", { name: "読み直す" });
    await userEvent.click(button);
    expect(callsOf("detail")).toEqual([{ repo: "4rtofl/app", number: 7, fresh: true }]);
    expect(button).toHaveProperty("disabled", true);
    expect(sdk.reload).not.toHaveBeenCalled();
    await act(async () => held.done());
    expect(sdk.reload).toHaveBeenCalledWith("detail");
    expect(button).toHaveProperty("disabled", false);
  });

  it("shows the review's comment apart from the others and without its mark, and links to it when it is older than those read", () => {
    const review = { author: "totosuki", body: `## 🤖 Agent によるレビュー\n直すところはありません。\n<!-- gasho-review verdict=mergeable sha=${head} -->`, url: mergeable(7).url, mine: true };
    const other = { author: "octocat", body: "ありがとうございます", url: `${url(7)}#issuecomment-2`, mine: false };
    const list = { data: listing({ requested: [pr({ mark: mergeable(7) })] }) };
    respond({ list, detail: { data: detail({ comments: [review, other] }) } });
    const both = render(panel());
    const section = (name: RegExp) => screen.getByRole("heading", { name }).closest("section")?.textContent;
    expect(section(/^レビューの結果/)).toContain("直すところはありません。");
    expect(section(/^レビューの結果/)).not.toContain("gasho-review");
    expect(section(/^コメント/)).toContain("ありがとうございます");
    expect(section(/^コメント/)).not.toContain("直すところはありません。");
    both.unmount();

    respond({ list, detail: { data: detail({ comments: [other] }) } });
    render(panel());
    expect(screen.getByRole("link", { name: "GitHub でレビュー結果のコメントを見る" }).getAttribute("href")).toBe(mergeable(7).url);
  });

  it("asks the Agent in the worktree for what the verdict calls for, as the page's row does", async () => {
    set({ machines: [machine({ canLaunch: true, sessions: [session({ sessionId: "s9", cwd: "/work/review-9", managed: true })] })] });
    respond({ list: { data: listing({ requested: [reviewed(9)] }) }, detail: { data: detail({ pr: reviewed(9) }) } });
    render(panel(9));
    await userEvent.click(screen.getByRole("button", { name: "マージしてもらう" }));
    const dialog = await screen.findByRole("dialog", { name: "Agent にマージを頼みますか" });
    await userEvent.click(within(dialog).getByRole("button", { name: "マージを頼む" }));
    await waitFor(() => expect(sdk.sendInput).toHaveBeenCalledWith(expect.objectContaining({ machine: "m1", sessionId: "s9", text: expect.stringContaining("#9「ログインを直す」をマージしてください") })));
  });

  it("says that the Agent cannot be asked for a pull request without a worktree", () => {
    respond({ list: { data: listing({ requested: [pr({ number: 10, url: url(10), mark: mergeable(10) })] }) } });
    render(panel(10));
    expect(screen.getByText("この Pull request の worktree が無いので、Agent に頼めません。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "マージしてもらう" })).toBeNull();
  });

  it("gives the buttons from what it read of a pull request that no list holds", async () => {
    respond({ list: { data: listing() }, detail: { data: detail({ pr: reviewed(11) }) } });
    render(panel(11));
    expect(await screen.findByRole("button", { name: "マージしてもらう" })).toBeTruthy();
  });

  it("reads GitHub again once what was asked of it ends, and says it is being done until that reading comes", async () => {
    let at = Date.now() - 60_000;
    const read = detail({ pr: reviewed(12) });
    respond({ list: { data: listing() }, detail: () => ({ data: read, at }) });
    const held = holdDetail();
    render(panel(12));
    expect(await screen.findByRole("button", { name: "マージしてもらう" })).toBeTruthy();
    // The merge asked from the page's row was seen to end there: what the panel read is from before that.
    act(() => recheck(url(12), { kind: "merge", sha: head }, async () => {}));
    expect(await screen.findByText("マージしてもらっています")).toBeTruthy();
    expect(callsOf("detail")).toEqual([{ repo: "4rtofl/app", number: 12, fresh: true }]);
    await act(async () => held.done());
    expect(sdk.reload).toHaveBeenCalledWith("detail");
    expect(screen.getByText("マージしてもらっています")).toBeTruthy();
    at = Date.now() + 1;
    act(() => changed());
    expect(await screen.findByRole("button", { name: "マージしてもらう" })).toBeTruthy();
  });

  it("does not read GitHub again when it is opened after the work ended and has read it since", async () => {
    act(() => recheck(url(13), { kind: "merge", sha: head }, async () => {}));
    respond({ list: { data: listing() }, detail: { data: detail({ pr: reviewed(13) }), at: Date.now() + 1_000 } });
    render(panel(13));
    expect(await screen.findByRole("button", { name: "マージしてもらう" })).toBeTruthy();
    expect(callsOf("detail")).toEqual([]);
  });
});
