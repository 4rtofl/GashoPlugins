// The buttons of a pull request's row, drawn by the review page: the page gives them their tools (useCall, the session
// launcher, the dialogs that ask first, the notice at the bottom).
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallResult, LaunchResult } from "@gasho/plugin-sdk";
import { answerCalls, callsOf, machine, respond, sdk, session, set } from "../../test/sdk.tsx";
import { batchRun, hideBatch, startBatch } from "../src/web/batch-run.ts";
import { ForkDialog } from "../src/web/dialogs.tsx";
import type { Actions, ForkQuestion, Item, Tools } from "../src/web/actions.ts";
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

/** Answers the question shown once it has been read (stopClock: the dialogs take no press within 0.5 s of it showing). */
async function answerTrust(dialog: HTMLElement, name: "信頼して起動する" | "やめる") {
  read();
  await userEvent.click(within(dialog).getByRole("button", { name }));
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

  it("keeps the notice of its work while \"まとめてレビューさせる\" runs for another pull request", async () => {
    answerCalls({ create: { ok: false, error: "gh: could not fetch the pull request" } });
    render(<ReviewPage params={{}} />);
    // The run holds on making #99's worktree.
    let release!: () => void;
    const held = new Promise<CallResult<unknown>>((resolve) => (release = () => resolve({ ok: false, error: "held" })));
    const spot = { machine: machine({ canLaunch: true }), primary: "/work/app" };
    const other = { item: { pr: pr({ number: 99, url: "https://github.com/4rtofl/app/pull/99" }), spots: [spot] } as Item, spot };
    const actions = { notify: () => {}, dismiss: () => {}, reload: () => {} } as unknown as Actions;
    act(() => {
      startBatch({ machine: spot.machine, template: { name: "レビュー", body: "" }, targets: [other] }, [other], { call: () => held, actions } as unknown as Tools);
      hideBatch();
    });
    try {
      expect(await screen.findByText("1 / 1：#99 のレビューを用意しています…")).toBeTruthy();
      await choose("何も送らない");
      // The row's notice takes the place of the run's, and stays though the page is drawn again.
      await waitFor(() => expect(screen.queryByText("1 / 1：#99 のレビューを用意しています…")).toBeNull());
      expect(screen.getByRole("alert").textContent).toContain("gh: could not fetch the pull request");
    } finally {
      // The run is kept outside the page: it ends here, not to hold the rows of the tests after this one.
      await act(async () => release());
      await waitFor(() => expect(batchRun()?.running).toBe(false));
    }
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
    // Drawn where the plugin's CSS applies, though the portal puts it outside the page.
    expect(dialog.closest('[data-gasho-plugin="github-review"]')).not.toBeNull();
    // A press as it shows (the second click of a double click, say) is not its answer.
    await userEvent.click(within(dialog).getByRole("button", { name: "信頼して起動する" }));
    expect(sdk.launchSession).toHaveBeenCalledTimes(1);
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

  it("keeps the question of a row's work while the page is left, shows it once the page is back, and the work goes on", async () => {
    let made!: () => void;
    answerCalls({ create: () => new Promise((resolve) => (made = () => resolve({ ok: true, data: { path: "/work/review-7", created: true } }))) });
    sdk.launchSession.mockReturnValueOnce({ ok: false, error: "not trusted", needsTrust: true });
    stopClock();
    const page = render(<ReviewPage params={{}} />);
    await choose("レビュー");
    // Left while the worktree is made: a session opened from the notice or the sidebar closes the page.
    page.unmount();
    await act(async () => made());
    await waitFor(() => expect(sdk.launchSession).toHaveBeenCalledTimes(1));
    render(<ReviewPage params={{}} />);
    await answerTrust(await screen.findByRole("dialog", { name: "このフォルダーを信頼しますか" }), "信頼して起動する");
    await waitFor(() => expect(sdk.sendInput).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "launched", text: expect.stringMatching(/^#7 をレビューして/) })));
    expect(sdk.launchSession).toHaveBeenLastCalledWith({ machine: "m1", cwd: "/work/review-7", trust: true });
    expect(await screen.findByText("#7 のセッションを起動し、「レビュー」を送りました。")).toBeTruthy();
  });

  it("takes the notice of a closed panel's work off the page once the next one shows in a panel opened since", async () => {
    let made!: () => void;
    answerCalls({ create: () => new Promise((resolve) => (made = () => resolve({ ok: true, data: { path: "/work/review-7", created: true } }))) });
    let started!: () => void;
    sdk.launchSession.mockReturnValueOnce(new Promise<LaunchResult>((resolve) => (started = () => resolve({ ok: true, sessionId: "launched" }))) as unknown as LaunchResult);
    // Two parts of the screen that draw the rows, as the review page and the panel of a pull request do.
    const page = render(<ReviewPage params={{}} />);
    const panel = render(<ReviewPage params={{}} />);
    await userEvent.click(within(panel.container).getByRole("button", { name: /worktree を作る/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "何も送らない" }));
    panel.unmount();
    await act(async () => made());
    expect(await within(page.container).findByText("review-7 でセッションを起動しています…")).toBeTruthy();
    const next = render(<ReviewPage params={{}} />);
    await act(async () => started());
    expect(await within(next.container).findByText("#7 のセッションを起動しました。")).toBeTruthy();
    await waitFor(() => expect(within(page.container).queryByText("review-7 でセッションを起動しています…")).toBeNull());
  });

  it("shows a question once while the page and a panel are both open", async () => {
    answerCalls({ create: { ok: true, data: { path: "/work/review-7", created: true } } });
    sdk.launchSession.mockReturnValueOnce({ ok: false, error: "not trusted", needsTrust: true });
    stopClock();
    // Two parts of the screen that draw the rows, as the review page and the panel of a pull request do.
    render(<ReviewPage params={{}} />);
    render(<ReviewPage params={{}} />);
    await userEvent.click(screen.getAllByRole("button", { name: /worktree を作る/ })[0]!);
    await userEvent.click(await screen.findByRole("menuitem", { name: "何も送らない" }));
    const dialog = await screen.findByRole("dialog", { name: "このフォルダーを信頼しますか" });
    // Counted in the document: Radix hides from the roles all but the dialog in front.
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    await answerTrust(dialog, "信頼して起動する");
    await waitFor(() => expect(sdk.launchSession).toHaveBeenLastCalledWith({ machine: "m1", cwd: "/work/review-7", trust: true }));
    expect(sdk.launchSession).toHaveBeenCalledTimes(2);
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

  it("keeps the notice of a session started while another row waits to ask about its folder, which opens it once that is answered", async () => {
    const other = pr({ number: 8, title: "設定を足す", url: "https://github.com/4rtofl/app/pull/8", branch: "feat/8-settings", place: { primary: "/work/app", worktree: { ...review, path: "/work/review-8" } } });
    respond({ list: listed({ requested: [pr({ place: { primary: "/work/app", worktree: review } }), other] }) });
    // Claude Code answers for review-8 only when the test says.
    let answer!: (r: LaunchResult) => void;
    sdk.launchSession.mockImplementation((input) =>
      input.cwd === "/work/review-8" ? (new Promise<LaunchResult>((resolve) => (answer = resolve)) as unknown as LaunchResult) : { ok: true, sessionId: "s-7" },
    );
    stopClock();
    render(<ReviewPage params={{}} />);
    const row = (title: string) => within(screen.getByText(title).closest("li")!);
    await userEvent.click(row("設定を足す").getByRole("button", { name: "開く" }));
    await userEvent.click(row("ログインを直す").getByRole("button", { name: "開く" }));
    expect(await screen.findByText("review-7 のセッションを開けます。ほかのセッションの起動中だったので、このページのままにしました。")).toBeTruthy();
    await act(async () => answer({ ok: false, error: "not trusted", needsTrust: true }));
    await answerTrust(await screen.findByRole("dialog", { name: "このフォルダーを信頼しますか" }), "やめる");
    await openFromNotice();
    expect(sdk.nav.openSession).toHaveBeenCalledWith("m1", "s-7");
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
