import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { LaunchResult } from "@gasho/plugin-sdk";
import { answerCalls, lastRequest, machine, NOW, respond, sdk, set } from "../../test/sdk.tsx";
import { KanbanPage } from "../src/web/board.tsx";
import type { Board } from "../src/types.ts";

const board = (over: Partial<Board> = {}): Board => ({
  watched: ["/work/app"],
  repos: [{ repo: "4rtofl/app", primary: { path: "/work/app", branch: "main" }, worktrees: [{ branch: "feat/1-x", path: "/work/issue-1-x" }], prs: [], closed: [] }],
  errors: [],
  updatedAt: NOW - 30_000,
  ...over,
});

/** Answers the question whether to trust a folder, which takes an answer half a second after it shows (board.tsx). */
async function answerTrust(dialog: HTMLElement, name: "信頼して起動する" | "やめる") {
  const button = within(dialog).getByRole("button", { name });
  await waitFor(() => expect(button).toHaveProperty("disabled", false), { timeout: 5000 });
  await userEvent.click(button);
}

describe("KanbanPage", () => {
  it("asks for the board every minute, and every 2 seconds while the working server reads the repositories", () => {
    set({ machines: [machine()] });
    respond({ board: { data: board() } });
    render(<KanbanPage params={{}} />);
    expect(lastRequest("board")?.options?.refreshSeconds).toBe(60);
    act(() => respond({ board: { data: board({ checking: true }) } }));
    expect(lastRequest("board")?.options?.refreshSeconds).toBe(2);
  });

  it("says the board stopped being read when its last reading is old, and not while it is new", () => {
    set({ machines: [machine()] });
    respond({ board: { data: board() } });
    render(<KanbanPage params={{}} />);
    expect(screen.getByText(/ 更新$/)).toBeTruthy();
    expect(screen.queryByText(/から更新されていない$/)).toBeNull();

    act(() => respond({ board: { data: board({ updatedAt: NOW - 6 * 60_000 }) } }));
    expect(screen.getByText(/から更新されていない$/)).toBeTruthy();
  });

  it("reads the repositories again on 「今すぐ見直す」, and then the board", async () => {
    set({ machines: [machine()] });
    respond({ board: { data: board() } });
    answerCalls({ refresh: { ok: true, data: board() } });
    render(<KanbanPage params={{}} />);
    await userEvent.click(screen.getByRole("button", { name: "今すぐ見直す" }));
    expect(sdk.call).toHaveBeenCalledWith({ machine: "m1", method: "refresh" });
    await waitFor(() => expect(sdk.reload).toHaveBeenCalledWith("board"));
  });

  it("names the working server when 「今すぐ見直す」 fails", async () => {
    set({ machines: [machine()] });
    respond({ board: { data: board() } });
    answerCalls({ refresh: { ok: false, error: "gh が見つかりません" } });
    render(<KanbanPage params={{}} />);
    await userEvent.click(screen.getByRole("button", { name: "今すぐ見直す" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("カンバンを読み込めなかった working server があります")).toBeTruthy();
    expect(within(alert).getByText("mac：gh が見つかりません")).toBeTruthy();
  });

  it("names a working server whose daemon part does not run, and asks it for nothing", () => {
    set({ machines: [machine()], daemon: { ready: false, reason: "gasho-daemon が古すぎます。" } });
    render(<KanbanPage params={{}} />);
    expect(screen.getByText("カンバンを使えない working server があります")).toBeTruthy();
    expect(screen.getByText("mac：gasho-daemon が古すぎます。")).toBeTruthy();
    expect(sdk.request).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "見る repo を選ぶ" })).toHaveProperty("disabled", true);
  });

  it("keeps the board for an offline working server that watched repositories, rather than asking to choose some", () => {
    set({ machines: [machine({ connected: false })], pluginState: { lastWatched: { m1: 2 } } });
    render(<KanbanPage params={{}} />);
    expect(screen.getByText("オフラインの working server があります")).toBeTruthy();
    expect(screen.getByText("mac の repo のカードは、つながるまで出しません。")).toBeTruthy();
    expect(screen.queryByText("見る repo を選んでください")).toBeNull();
    expect(screen.getByRole("region", { name: "自分の番：0 枚" })).toBeTruthy();
  });

  it("asks the person whether to trust a card's folder, then starts the session there and opens it", async () => {
    set({ machines: [machine({ canLaunch: true })] });
    respond({ board: { data: board() } });
    sdk.launchSession.mockReturnValueOnce({ ok: false, error: "trust", needsTrust: true, trustWarnings: [".claude/settings.json に hooks があります"] });
    render(<KanbanPage params={{}} />);
    await userEvent.click(screen.getByRole("button", { name: "issue-1-x のメニュー" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "セッションを起動して開く" }));

    const dialog = await screen.findByRole("dialog", { name: "このフォルダーを信頼しますか" });
    expect(within(dialog).getByText("/work/issue-1-x")).toBeTruthy();
    expect(within(dialog).getByText(".claude/settings.json に hooks があります")).toBeTruthy();
    await answerTrust(dialog, "信頼して起動する");

    await waitFor(() => expect(sdk.nav.openSession).toHaveBeenCalledWith("m1", "launched"));
    expect(sdk.launchSession).toHaveBeenLastCalledWith({ machine: "m1", cwd: "/work/issue-1-x", trust: true });
    // The "starting…" notice may still be leaving while this one comes in, so both can be a status for a moment.
    expect((await screen.findByText("issue-1-x でセッションを起動しました。")).closest('[role="status"]')).not.toBeNull();
  });

  it("keeps the notice of a card's session started while another card waits to ask about its folder, which opens it once that is answered", async () => {
    set({ machines: [machine({ canLaunch: true })] });
    const two = board();
    two.repos[0]!.worktrees.push({ branch: "feat/2-y", path: "/work/issue-2-y" });
    respond({ board: { data: two } });
    // Claude Code answers for issue-2-y only when the test says.
    let answer!: (r: LaunchResult) => void;
    sdk.launchSession.mockImplementation((input) =>
      input.cwd === "/work/issue-2-y" ? (new Promise<LaunchResult>((resolve) => (answer = resolve)) as unknown as LaunchResult) : { ok: true, sessionId: "s-1" },
    );
    render(<KanbanPage params={{}} />);
    for (const label of ["issue-2-y", "issue-1-x"]) {
      await userEvent.click(screen.getByRole("button", { name: `${label} のメニュー` }));
      await userEvent.click(screen.getByRole("menuitem", { name: "セッションを起動して開く" }));
    }
    expect(await screen.findByText("issue-1-x でセッションを起動しました。ほかのカードの起動中だったので、カンバンのままにしました。")).toBeTruthy();
    await act(async () => answer({ ok: false, error: "trust", needsTrust: true }));
    await answerTrust(await screen.findByRole("dialog", { name: "このフォルダーを信頼しますか" }), "やめる");
    await userEvent.click(await screen.findByRole("button", { name: "セッションを開く" }));
    expect(sdk.nav.openSession).toHaveBeenCalledWith("m1", "s-1");
  });

  it("starts nothing when the person does not trust the folder", async () => {
    set({ machines: [machine({ canLaunch: true })] });
    respond({ board: { data: board() } });
    sdk.launchSession.mockReturnValue({ ok: false, error: "trust", needsTrust: true });
    render(<KanbanPage params={{}} />);
    await userEvent.click(screen.getByRole("button", { name: "issue-1-x のメニュー" }));
  it("keeps a card's question while the board is left, shows it once the board is back, and then starts the session and opens it", async () => {
    set({ machines: [machine({ canLaunch: true })] });
    respond({ board: { data: board() } });
    let answer!: (r: LaunchResult) => void;
    sdk.launchSession.mockImplementationOnce(() => new Promise<LaunchResult>((resolve) => (answer = resolve)) as unknown as LaunchResult);
    const page = render(<KanbanPage params={{}} />);
    await userEvent.click(screen.getByRole("button", { name: "issue-1-x のメニュー" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "セッションを起動して開く" }));
    // Left while Claude Code answers: a session opened from the notice, a card or the sidebar closes the board.
    page.unmount();
    await act(async () => answer({ ok: false, error: "trust", needsTrust: true }));
    render(<KanbanPage params={{}} />);
    await answerTrust(await screen.findByRole("dialog", { name: "このフォルダーを信頼しますか" }), "信頼して起動する");
    await waitFor(() => expect(sdk.nav.openSession).toHaveBeenCalledWith("m1", "launched"));
    expect(sdk.launchSession).toHaveBeenLastCalledWith({ machine: "m1", cwd: "/work/issue-1-x", trust: true });
  });

  it("asks about two cards' folders one after the other, in the order they were asked, and opens the last to start", async () => {
    set({ machines: [machine({ canLaunch: true })] });
    const two = board();
    two.repos[0]!.worktrees.push({ branch: "feat/2-y", path: "/work/issue-2-y" });
    respond({ board: { data: two } });
    const answers: Record<string, (r: LaunchResult) => void> = {};
    sdk.launchSession.mockImplementation((input) =>
      input.trust ? { ok: true, sessionId: `s-${input.cwd.slice(-3)}` } : (new Promise<LaunchResult>((resolve) => (answers[input.cwd] = resolve)) as unknown as LaunchResult),
    );
    render(<KanbanPage params={{}} />);
    for (const label of ["issue-2-y", "issue-1-x"]) {
      await userEvent.click(screen.getByRole("button", { name: `${label} のメニュー` }));
      await userEvent.click(screen.getByRole("menuitem", { name: "セッションを起動して開く" }));
    }
    await act(async () => {
      answers["/work/issue-1-x"]!({ ok: false, error: "trust", needsTrust: true });
      answers["/work/issue-2-y"]!({ ok: false, error: "trust", needsTrust: true });
    });
    const asked = () => within(screen.getByRole("dialog", { name: "このフォルダーを信頼しますか" }));
    await waitFor(() => expect(asked().getByText("/work/issue-1-x")).toBeTruthy());
    await answerTrust(screen.getByRole("dialog"), "信頼して起動する");
    await waitFor(() => expect(asked().getByText("/work/issue-2-y")).toBeTruthy());
    expect(sdk.nav.openSession).not.toHaveBeenCalled();
    await answerTrust(screen.getByRole("dialog"), "信頼して起動する");
    await waitFor(() => expect(sdk.nav.openSession).toHaveBeenCalledWith("m1", "s-2-y"));
    expect(sdk.launchSession.mock.calls.flatMap(([input]) => (input.trust ? [input.cwd] : []))).toEqual(["/work/issue-1-x", "/work/issue-2-y"]);
  });

    await userEvent.click(screen.getByRole("menuitem", { name: "セッションを起動して開く" }));
    await answerTrust(await screen.findByRole("dialog", { name: "このフォルダーを信頼しますか" }), "やめる");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sdk.launchSession).toHaveBeenCalledTimes(1);
    expect(sdk.nav.openSession).not.toHaveBeenCalled();
  });
});
