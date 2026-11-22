// The buttons of a pull request's row, drawn by the review page: the page gives them their tools (useCall, the session
// launcher, the dialogs that ask first, the notice at the bottom).
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerCalls, callsOf, machine, respond, scene, sdk, session, set } from "../../test/sdk.tsx";
import { ForkDialog } from "../src/web/dialogs.tsx";
import type { ForkQuestion } from "../src/web/actions.ts";
import { ReviewPage } from "../src/web/page.tsx";
import type { Listing, PrRow } from "../src/types.ts";

const pr = (over: Partial<PrRow> = {}): PrRow => ({
  repo: "4rtofl/app",
  number: 7,
  title: "ログインを直す",
  url: "https://github.com/4rtofl/app/pull/7",
  state: "open",
  author: "octocat",
  createdAt: "2026-11-17T12:00:00Z",
  labels: [],
  comments: 0,
  branch: "fix/7-login",
  place: { primary: "/work/app" },
  ...over,
});
const listing = (over: Partial<Listing> = {}): Listing => ({ watched: ["/work/app"], requested: [], repos: [], errors: [], ...over });
const listed = (over: Partial<Listing> = {}) => ({ data: listing(over) });
const review = { path: "/work/review-7", branch: "pr-7", review: true };

/**
 * The clock of the presses and of when a question shows (the dialogs take no press within 0.5 s of that): once stopped,
 * it moves only as a test reads the question shown.
 */
let now = 0;
function stopClock(): void {
  now = 10_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(Event.prototype, "timeStamp", "get").mockImplementation(() => now);
}
const read = () => {
  now += 1_000;
};
afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
  set({ machines: [machine({ canLaunch: true })], settings: { templates: JSON.stringify([{ name: "レビュー", body: "#{number} をレビューして" }]) } });
});

/** The page stays where it is after the session started; the notice at the bottom has the button that opens it. */
async function openFromNotice() {
  const open = await screen.findByRole("button", { name: "セッションを開く" });
  expect(sdk.nav.openSession).not.toHaveBeenCalled();
  await userEvent.click(open);
}

async function choose(template: string) {
  await userEvent.click(screen.getByRole("button", { name: /worktree を作る/ }));
  await userEvent.click(await screen.findByRole("menuitem", { name: template }));
}

describe("a pull request without a worktree", () => {
  beforeEach(() => respond({ list: listed({ requested: [pr()] }) }));

  it("gets its review worktree and a session started there with the template filled in, stays on the page, and opens the session from the notice", async () => {
    answerCalls({ create: { ok: true, data: { path: "/work/review-7", created: true } } });
    render(<ReviewPage params={{}} />);
    await choose("レビュー");
    await openFromNotice();
    expect(sdk.nav.openSession).toHaveBeenCalledWith("m1", "launched");
    expect(callsOf("create")).toEqual([{ repo: "4rtofl/app", number: 7 }]);
    expect(sdk.launchSession).toHaveBeenCalledWith({ machine: "m1", cwd: "/work/review-7" });
    // The instruction is the template filled in, followed by how to post the review (instructions.ts).
    expect(sdk.sendInput).toHaveBeenCalledWith({ machine: "m1", sessionId: "launched", text: expect.stringMatching(/^#7 をレビューして(\n|$)/) });
  });

  it("opens the Gasho session already in a worktree that turns out to be there, without starting another", async () => {
    const there = session({ sessionId: "old", cwd: "/work/review-7", managed: true });
    set({ machines: [machine({ canLaunch: true, sessions: [there] })] });
    answerCalls({ create: { ok: true, data: { path: "/work/review-7", created: false } } });
    render(<ReviewPage params={{}} />);
    await choose("何も送らない");
    await openFromNotice();
    expect(sdk.nav.openSession).toHaveBeenCalledWith("m1", "old");
    expect(sdk.launchSession).not.toHaveBeenCalled();
  });

  it("says why the worktree could not be made, starts nothing, and keeps the row's buttons off meanwhile", async () => {
    let fail!: () => void;
    answerCalls({ create: () => new Promise((resolve) => (fail = () => resolve({ ok: false, error: "gh: could not fetch the pull request" }))) });
    render(<ReviewPage params={{}} />);
    await choose("何も送らない");
    await waitFor(() => expect(screen.getByRole("button", { name: /worktree を作る/ })).toHaveProperty("disabled", true));
    fail();
    expect((await screen.findByRole("alert")).textContent).toContain("gh: could not fetch the pull request");
    expect(screen.getByRole("button", { name: /worktree を作る/ })).toHaveProperty("disabled", false);
    expect(sdk.launchSession).not.toHaveBeenCalled();
  });

  it("asks before Claude Code trusts the new folder, and starts the session only once trusted", async () => {
    answerCalls({ create: { ok: true, data: { path: "/work/review-7", created: true } } });
    sdk.launchSession.mockReturnValueOnce({ ok: false, error: "not trusted", needsTrust: true, trustWarnings: [".claude/settings.json があります"] });
    stopClock();
    render(<ReviewPage params={{}} />);
    await choose("何も送らない");
    const dialog = await screen.findByRole("dialog", { name: "このフォルダーを信頼しますか" });
    expect(within(dialog).getByText("/work/review-7")).toBeTruthy();
    expect(within(dialog).getByText(".claude/settings.json があります")).toBeTruthy();
    read();
    await userEvent.click(within(dialog).getByRole("button", { name: "信頼して起動する" }));
    await openFromNotice();
    expect(sdk.nav.openSession).toHaveBeenCalledWith("m1", "launched");
    expect(sdk.launchSession).toHaveBeenLastCalledWith({ machine: "m1", cwd: "/work/review-7", trust: true });
  });

  it("starts nothing when the person does not trust the folder", async () => {
    answerCalls({ create: { ok: true, data: { path: "/work/review-7", created: true } } });
    sdk.launchSession.mockReturnValueOnce({ ok: false, error: "not trusted", needsTrust: true });
    stopClock();
    render(<ReviewPage params={{}} />);
    await choose("レビュー");
    const dialog = await screen.findByRole("dialog");
    read();
    await userEvent.click(within(dialog).getByRole("button", { name: "やめる" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sdk.launchSession).toHaveBeenCalledTimes(1);
    expect(sdk.sendInput).not.toHaveBeenCalled();
    expect(sdk.nav.openSession).not.toHaveBeenCalled();
  });

  it("says that the session started but the template could not be sent, and does not open it", async () => {
    answerCalls({ create: { ok: true, data: { path: "/work/review-7", created: true } } });
    sdk.sendInput.mockReturnValueOnce({ ok: false, error: "the session is not ready" });
    render(<ReviewPage params={{}} />);
    await choose("レビュー");
    expect((await screen.findByRole("alert")).textContent).toContain("セッションは起動しましたが、「レビュー」を送れませんでした：the session is not ready");
    expect(sdk.nav.openSession).not.toHaveBeenCalled();
  });

  it("offers no template on a working server where Gasho cannot start a session, and says why", async () => {
    set({ machines: [machine({ canLaunch: false })] });
    render(<ReviewPage params={{}} />);
    await userEvent.click(screen.getByRole("button", { name: /worktree を作る/ }));
    expect(await screen.findByText("この working server では、Gasho からセッションを起動できません。")).toBeTruthy();
    for (const item of screen.getAllByRole("menuitem")) expect(item.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("a pull request with a worktree", () => {
  it("opens the Gasho session used last in it", async () => {
    const older = session({ sessionId: "older", cwd: "/work/review-7", managed: true, lastActivityAt: 1 });
    const newer = session({ sessionId: "newer", cwd: "/work/review-7/src", managed: true, lastActivityAt: 2 });
    set({ machines: [machine({ sessions: [older, newer] })] });
    respond({ list: listed({ requested: [pr({ place: { primary: "/work/app", worktree: review } })] }) });
    render(<ReviewPage params={{}} />);
    await userEvent.click(screen.getByRole("button", { name: "開く" }));
    await waitFor(() => expect(sdk.nav.openSession).toHaveBeenCalledWith("m1", "newer"));
    expect(sdk.launchSession).not.toHaveBeenCalled();
  });

  it("cannot be opened when it has no Gasho session and Gasho cannot start one there", () => {
    set({ machines: [machine({ canLaunch: false })] });
    respond({ list: listed({ requested: [pr({ place: { primary: "/work/app", worktree: review } })] }) });
    render(<ReviewPage params={{}} />);
    expect(screen.getByRole("button", { name: "開く" })).toHaveProperty("disabled", true);
  });

  it("in a watched repository, starts a new session there rather than opening the one used last", async () => {
    set({ machines: [machine({ canLaunch: true, sessions: [session({ sessionId: "old", cwd: "/work/review-7", managed: true })] })] });
    respond({ list: listed({ repos: [{ repo: "4rtofl/app", watched: true, prs: [pr({ place: { primary: "/work/app", worktree: review } })] }] }) });
    render(<ReviewPage params={{}} />);
    await userEvent.click(screen.getByRole("button", { name: "新たにセッションを作成する" }));
    await waitFor(() => expect(sdk.nav.openSession).toHaveBeenCalledWith("m1", "launched"));
    expect(sdk.launchSession).toHaveBeenCalledWith({ machine: "m1", cwd: "/work/review-7" });
  });

  it("once merged, can be removed with its branch after the person agrees, and says what went", async () => {
    respond({ list: listed({ requested: [pr({ state: "merged", place: { primary: "/work/app", worktree: review } })] }) });
    answerCalls({ remove: { ok: true, data: { path: "/work/review-7", branch: "pr-7" } } });
    render(<ReviewPage params={{}} />);
    expect(screen.getByText("マージされたので片付けてよい")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "片付ける" }));
    const dialog = await screen.findByRole("dialog", { name: "worktree を片付けますか" });
    expect(within(dialog).getByText("pr-7")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "片付ける" }));
    // The "removing…" notice may still be leaving while this one comes in, so both can be a status for a moment.
    expect((await screen.findByText("review-7 を片付けました（ローカルのブランチ pr-7 も消しました）。")).closest('[role="status"]')).not.toBeNull();
    expect(callsOf("remove")).toEqual([{ repo: "4rtofl/app", number: 7 }]);
  });

  it("is not removed when the person does not agree", async () => {
    respond({ list: listed({ requested: [pr({ state: "closed", place: { primary: "/work/app", worktree: review } })] }) });
    render(<ReviewPage params={{}} />);
    await userEvent.click(screen.getByRole("button", { name: "片付ける" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "やめる" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(callsOf("remove")).toEqual([]);
  });

  it("offers no removal for a worktree that was not made for the review", () => {
    respond({ list: listed({ requested: [pr({ state: "merged", place: { primary: "/work/app", worktree: { path: "/work/app-fix", branch: "fix/7-login", review: false } } })] }) });
    render(<ReviewPage params={{}} />);
    expect(screen.getByRole("button", { name: "開く" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "片付ける" })).toBeNull();
  });
});

describe("my own open pull request with a worktree", () => {
  const head = "abc1234";
  // A number of its own: what the tests above sent for #7 is remembered on the page for a while (asked.ts).
  const own = (over: Partial<PrRow> = {}) => pr({ number: 70, url: "https://github.com/4rtofl/app/pull/70", own: true, head, place: { primary: "/work/app", worktree: review }, ...over });
  const verdict = (v: "changes" | "mergeable", sha = head) => ({ verdict: v, sha, url: "https://github.com/4rtofl/app/pull/7#issuecomment-1" });
  const button = (name: RegExp) => screen.queryByRole("button", { name });

  it("offers only 修正してもらう, not レビューする, when the review asks for changes", () => {
    respond({ list: listed({ requested: [own({ mark: verdict("changes") })] }) });
    render(<ReviewPage params={{}} />);
    expect(button(/修正してもらう/)).not.toBeNull();
    expect(button(/レビューする/)).toBeNull();
  });

  it.each([
    ["has no review yet", undefined],
    ["was pushed to after the review asked for changes", verdict("changes", "def5678")],
    ["can be merged", verdict("mergeable")],
  ])("offers レビューする when it %s", (_, mark) => {
    respond({ list: listed({ requested: [own(mark ? { mark } : {})] }) });
    render(<ReviewPage params={{}} />);
    expect(button(/レビューする/)).not.toBeNull();
    expect(button(/修正してもらう/)).toBeNull();
  });
});

describe("fork pull requests asked about one after another", () => {
  const fork = (n: number) =>
    pr({ number: n, url: `https://github.com/4rtofl/app/pull/${n}`, fork: true, place: { primary: "/work/app", worktree: { path: `/work/review-${n}`, branch: `pr-${n}`, review: true } } });
  const yes = (dialog: HTMLElement) => within(dialog).getByRole("button", { name: "起動する" });
  const launched = () => sdk.launchSession.mock.calls.map(([input]) => input.cwd);
  beforeEach(stopClock);

  it("takes no press begun within 0.5 s of a question showing, which starts only once pressed later", async () => {
    let show = () => {};
    const shown = new Promise<void>((r) => (show = r));
    respond({ list: listed({ requested: [fork(7), fork(8)] }) });
    answerCalls({ projectFiles: (p) => shown.then(() => ({ ok: true, data: { path: `/work/review-${(p as { number: number }).number}`, files: [".claude/"] } })) });
    render(<ReviewPage params={{}} />);
    for (const open of screen.getAllByRole("button", { name: "開く" })) await userEvent.click(open);
    show();
    const first = await screen.findByRole("dialog", { description: /^#7「/ });
    await userEvent.click(yes(first));
    expect(launched()).toEqual([]);
    read();
    await userEvent.click(yes(first));
    // #8 shows in its place: a second click, Enter and Esc at once are not its answers, nor is a press begun then and let go later.
    const next = await screen.findByRole("dialog", { description: /^#8「/ });
    await userEvent.click(yes(next));
    await userEvent.keyboard("{Enter}{Escape}");
    await userEvent.pointer({ keys: "[MouseLeft>]", target: yes(next) });
    read();
    await userEvent.pointer({ keys: "[/MouseLeft]", target: yes(next) });
    expect(screen.getByRole("dialog", { description: /^#8「/ })).toBe(next);
    expect(document.activeElement?.textContent).toBe("起動しない");
    expect(launched()).toEqual(["/work/review-7"]);
    await userEvent.click(yes(next));
    await waitFor(() => expect(launched()).toEqual(["/work/review-7", "/work/review-8"]));
  });

  it("shows one question at a time across the dialogs of the page and the side panel, the one asked first", async () => {
    const answers: string[] = [];
    // A part of the screen that asks a question in its own dialog, as the page and the side panel do.
    function Asking({ n }: { n: number }) {
      const [question, setQuestion] = useState<ForkQuestion | undefined>({ pr: fork(n), path: `/work/review-${n}`, files: [] });
      return <ForkDialog question={question} onAnswer={(a) => (answers.push(`#${n} ${a}`), setQuestion(undefined))} />;
    }
    render(<Asking n={12} />);
    render(<Asking n={11} />);
    expect(screen.getAllByRole("dialog").map((d) => d.textContent)).toEqual([expect.stringContaining("#12「")]);
    read();
    await userEvent.click(yes(screen.getByRole("dialog")));
    expect(answers).toEqual(["#12 true"]);
    expect(screen.getAllByRole("dialog").map((d) => d.textContent)).toEqual([expect.stringContaining("#11「")]);
  });
});

// Each test has a pull request of its own: what the rows asked is remembered on the page for a while (asked.ts).
const numbered = (n: number, place: Partial<NonNullable<PrRow["place"]>> = {}, over: Partial<PrRow> = {}) =>
  pr({ number: n, url: `https://github.com/4rtofl/app/pull/${n}`, head: "abc1234", place: { primary: "/work/app", worktree: { path: `/work/review-${n}`, branch: `pr-${n}`, review: true }, ...place }, ...over });
const mergeable = (n: number) => ({ verdict: "mergeable" as const, sha: "abc1234", url: `https://github.com/4rtofl/app/pull/${n}#issuecomment-1` });
/** A working server with a Gasho session in /work/review-<n>. */
const withSession = (n: number, over: Parameters<typeof session>[0] = {}) => [machine({ canLaunch: true, sessions: [session({ cwd: `/work/review-${n}`, managed: true, ...over })] })];

describe("the tools the page gives the rows", () => {
  it.each<[string, number, Record<string, unknown>, string, boolean]>([
    ["squash, keeping the head branch", 40, { mergeMethod: "squash", deleteBranch: false }, "--squash", false],
    ["rebase, deleting the head branch", 41, { mergeMethod: "rebase", deleteBranch: true }, "--rebase", true],
  ])("ask the Agent to merge as the settings say: %s", async (_, n, settings, method, deletes) => {
    set({ machines: withSession(n), settings: { ...scene.settings, ...settings } });
    respond({ list: listed({ requested: [numbered(n, {}, { mark: mergeable(n) })] }) });
    render(<ReviewPage params={{}} />);
    await userEvent.click(screen.getByRole("button", { name: "マージしてもらう" }));
    const dialog = await screen.findByRole("dialog", { name: "Agent にマージを頼みますか" });
    expect(within(dialog).queryByText("GitHub の head のブランチ（fix/7-login）を消します") !== null).toBe(deletes);
    await userEvent.click(within(dialog).getByRole("button", { name: "マージを頼む" }));
    await waitFor(() => expect(sdk.sendInput).toHaveBeenCalled());
    const text = sdk.sendInput.mock.calls[0]?.[0].text ?? "";
    expect(text).toContain(`gh pr merge ${n} ${method} --match-head-commit`);
    expect(text.includes("git/refs/heads/fix/7-login")).toBe(deletes);
  });

  it("give a row its buttons back when the page is left while it asks the person first", async () => {
    set({ machines: withSession(42) });
    respond({ list: listed({ requested: [numbered(42, {}, { mark: mergeable(42) })] }) });
    const left = render(<ReviewPage params={{}} />);
    await userEvent.click(screen.getByRole("button", { name: "マージしてもらう" }));
    await screen.findByRole("dialog", { name: "Agent にマージを頼みますか" });
    expect(screen.getByRole("button", { name: "マージしてもらう", hidden: true })).toHaveProperty("disabled", true);
    left.unmount();
    render(<ReviewPage params={{}} />);
    expect(screen.getByRole("button", { name: "マージしてもらう" })).toHaveProperty("disabled", false);
  });

  it("say what went wrong when a button's work fails unexpectedly, and give the row its buttons back", async () => {
    respond({ list: listed({ requested: [numbered(43, { worktree: undefined })] }) });
    sdk.call.mockImplementation(() => {
      throw new Error("the daemon part went away");
    });
    render(<ReviewPage params={{}} />);
    await choose("何も送らない");
    expect((await screen.findByRole("alert")).textContent).toContain("the daemon part went away");
    expect(screen.getByRole("button", { name: /worktree を作る/ })).toHaveProperty("disabled", false);
  });
});

describe("what the page removes by itself", () => {
  const claimed = (p: { action?: string }) => (p.action === "claim" ? { ok: true as const, data: { claimed: true } } : { ok: true as const, data: undefined });

  it("removes a review worktree whose merge is done once no session works in it, and tries it once", async () => {
    const merged = numbered(44, { cleanup: { kind: "merge", sha: "abc1234", done: true } }, { state: "merged" });
    set({ machines: withSession(44, { status: "busy" }) });
    answerCalls({ cleanup: claimed });
    respond({ list: listed({ requested: [merged] }) });
    render(<ReviewPage params={{}} />);
    expect(callsOf("cleanup")).toEqual([]);
    act(() => set({ machines: withSession(44) }));
    await waitFor(() => expect(sdk.removeWorktree).toHaveBeenCalledWith({ machine: "m1", path: "/work/review-44", branch: "pr-44", pushed: ["abc1234"] }));
    act(() => set({ machines: withSession(44) }));
    await waitFor(() => expect(callsOf("cleanup")).toHaveLength(2));
    expect(callsOf("cleanup")).toEqual([
      { repo: "4rtofl/app", number: 44, action: "claim" },
      { repo: "4rtofl/app", number: 44, action: "forget" },
    ]);
  });

  it.each<[string, number, NonNullable<PrRow["place"]>["cleanup"], string | undefined]>([
    ["is not done yet", 45, { kind: "merge", sha: "abc1234", done: false }, undefined],
    ["could not be removed before", 46, { kind: "merge", sha: "abc1234", done: true, problem: "未コミットの変更が 1 件あります" }, undefined],
    ["Gasho cannot remove", 47, { kind: "merge", sha: "abc1234", done: true }, "この worktree では Gasho のセッションが動いています"],
  ])("leaves alone a review worktree to remove once a merge is done that %s", (_, n, cleanup, problem) => {
    sdk.removeWorktreeProblem.mockReturnValue(problem);
    set({ machines: withSession(n) });
    respond({ list: listed({ requested: [numbered(n, cleanup ? { cleanup } : {}, { state: "merged" })] }) });
    render(<ReviewPage params={{}} />);
    expect(callsOf("cleanup")).toEqual([]);
    expect(sdk.removeWorktree).not.toHaveBeenCalled();
  });

  it("removes a session that has posted its review once it is at rest, forgets one that is gone, and tries each once", async () => {
    set({ machines: withSession(48, { sessionId: "posted", status: "busy" }) });
    answerCalls({ reviewSession: claimed });
    respond({ list: listed({ requested: [numbered(48, { finishedSessions: ["posted", "gone"] })] }) });
    render(<ReviewPage params={{}} />);
    await waitFor(() => expect(callsOf("reviewSession")).toEqual([{ action: "forget", sessionId: "gone" }]));
    expect(sdk.removeSession).not.toHaveBeenCalled();
    act(() => set({ machines: withSession(48, { sessionId: "posted" }) }));
    await waitFor(() => expect(sdk.removeSession).toHaveBeenCalledWith({ machine: "m1", sessionId: "posted" }));
    act(() => set({ machines: withSession(48, { sessionId: "posted" }) }));
    await waitFor(() => expect(callsOf("reviewSession")).toHaveLength(3));
    expect(callsOf("reviewSession")).toEqual([
      { action: "forget", sessionId: "gone" },
      { action: "claim", sessionId: "posted" },
      { action: "forget", sessionId: "posted" },
    ]);
    expect(sdk.removeSession).toHaveBeenCalledTimes(1);
  });
});
