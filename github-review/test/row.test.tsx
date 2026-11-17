// The buttons of a pull request's row, drawn by the review page: the page gives them their tools (useCall, the session
// launcher, the dialogs that ask first, the notice at the bottom).
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { answerCalls, callsOf, machine, respond, sdk, session, set } from "../../test/sdk.tsx";
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

beforeEach(() => {
  set({ machines: [machine({ canLaunch: true })], settings: { templates: JSON.stringify([{ name: "レビュー", body: "#{number} をレビューして" }]) } });
});

async function choose(template: string) {
  await userEvent.click(screen.getByRole("button", { name: /worktree を作る/ }));
  await userEvent.click(await screen.findByRole("menuitem", { name: template }));
}

describe("a pull request without a worktree", () => {
  beforeEach(() => respond({ list: listed({ requested: [pr()] }) }));

  it("gets its review worktree, a session started there with the template filled in, and that session opened", async () => {
    answerCalls({ create: { ok: true, data: { path: "/work/review-7", created: true } } });
    render(<ReviewPage params={{}} />);
    await choose("レビュー");
    await waitFor(() => expect(sdk.nav.openSession).toHaveBeenCalledWith("m1", "launched"));
    expect(callsOf("create")).toEqual([{ repo: "4rtofl/app", number: 7 }]);
    expect(sdk.launchSession).toHaveBeenCalledWith({ machine: "m1", cwd: "/work/review-7" });
    expect(sdk.sendInput).toHaveBeenCalledWith({ machine: "m1", sessionId: "launched", text: "#7 をレビューして" });
  });

  it("opens the Gasho session already in a worktree that turns out to be there, without starting another", async () => {
    const there = session({ sessionId: "old", cwd: "/work/review-7", managed: true });
    set({ machines: [machine({ canLaunch: true, sessions: [there] })] });
    answerCalls({ create: { ok: true, data: { path: "/work/review-7", created: false } } });
    render(<ReviewPage params={{}} />);
    await choose("何も送らない");
    await waitFor(() => expect(sdk.nav.openSession).toHaveBeenCalledWith("m1", "old"));
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
    render(<ReviewPage params={{}} />);
    await choose("何も送らない");
    const dialog = await screen.findByRole("dialog", { name: "このフォルダーを信頼しますか" });
    expect(within(dialog).getByText("/work/review-7")).toBeTruthy();
    expect(within(dialog).getByText(".claude/settings.json があります")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "信頼して起動する" }));
    await waitFor(() => expect(sdk.nav.openSession).toHaveBeenCalledWith("m1", "launched"));
    expect(sdk.launchSession).toHaveBeenLastCalledWith({ machine: "m1", cwd: "/work/review-7", trust: true });
  });

  it("starts nothing when the person does not trust the folder", async () => {
    answerCalls({ create: { ok: true, data: { path: "/work/review-7", created: true } } });
    sdk.launchSession.mockReturnValueOnce({ ok: false, error: "not trusted", needsTrust: true });
    render(<ReviewPage params={{}} />);
    await choose("レビュー");
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "やめる" }));
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
    const dialog = await screen.findByRole("dialog", { name: "レビュー用の worktree を片付けますか" });
    expect(within(dialog).getByText("pr-7")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "片付ける" }));
    expect((await screen.findByRole("status")).textContent).toContain("review-7 を片付けました（ローカルのブランチ pr-7 も消しました）。");
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
