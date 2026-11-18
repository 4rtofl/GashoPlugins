import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { answerCalls, callsOf, machine, sdk, session, set } from "../../test/sdk.tsx";
import { ShellPanel } from "../src/web/panel.tsx";
import type { OutputAnswer, ShellJob, ShellView } from "../src/types.ts";
import type { CallResult } from "@gasho/plugin-sdk";

const job = (over: Partial<ShellJob> = {}): ShellJob => ({
  id: "mhz0a1b2-aaaaaa",
  command: "npm test",
  cwd: "/work/app",
  startedAt: Date.now() - 5000,
  state: "running",
  size: 0,
  dropped: 0,
  lines: 0,
  ...over,
});

type Answer = CallResult<unknown> | ((params: any) => CallResult<unknown>);

/**
 * The daemon part: `watch` answers `view` once and then waits for good (as with nothing changing), so that the panel
 * shows what the test gave; the other methods answer as given.
 */
function daemon(view: Partial<ShellView>, others: Record<string, Answer> = {}) {
  let watched = false;
  const first: CallResult<ShellView> = {
    ok: true,
    data: { version: "1", folder: "/work/app", cwd: "/work/app", home: "/Users/me", now: Date.now(), jobs: [], output: {}, ...view },
  };
  answerCalls({
    watch: () => (watched ? new Promise<never>(() => {}) : ((watched = true), first)),
    ...others,
  });
}

// Typing waits for nothing between the keys: the tests type whole commands.
const user = userEvent.setup({ delay: null });

const draw = (m = machine()) => render(<ShellPanel machine={m} session={session()} params={{}} docked />);
const box = () => screen.getByRole("textbox", { name: "実行するコマンド" });

describe("ShellPanel", () => {
  it("runs the command typed on Enter, shows it running, and empties the box", async () => {
    daemon({}, { run: { ok: true, data: job() } });
    draw();
    await screen.findByText(/まだコマンドを実行していません/);
    await user.type(box(), "npm test{Enter}");
    expect(sdk.call).toHaveBeenCalledWith(expect.objectContaining({ method: "run", params: expect.objectContaining({ command: "npm test" }), summary: "$ npm test" }));
    const record = await screen.findByRole("region", { name: "$ npm test" });
    expect(within(record).getByText(/実行中/)).toBeTruthy();
    expect(box()).toHaveProperty("value", "");
  });

  it("keeps the command in the box and shows why when it could not run", async () => {
    daemon({}, { run: { ok: false, error: "同時に動かせるコマンドは 8 個までです。" } });
    draw();
    await screen.findByText(/まだコマンドを実行していません/);
    await user.type(box(), "npm test{Enter}");
    expect(await screen.findByText("同時に動かせるコマンドは 8 個までです。")).toBeTruthy();
    expect(box()).toHaveProperty("value", "npm test");
  });

  it("stops a running command with SIGINT, and with SIGKILL once it has not stopped for 3 seconds", async () => {
    set({ now: Date.now() });
    daemon({ jobs: [job()] });
    draw();
    const record = await screen.findByRole("region", { name: "$ npm test" });
    // The panel keeps the time of the press (Date.now()), which is not before this.
    const pressed = Date.now();
    await user.click(within(record).getByRole("button", { name: "停止" }));
    expect(callsOf("signal")).toEqual([{ job: "mhz0a1b2-aaaaaa", signal: "INT" }]);

    act(() => set({ now: pressed + 2000 }));
    expect(within(record).queryByRole("button", { name: "強制終了" })).toBeNull();
    expect(within(record).getByRole("button", { name: "停止" })).toBeTruthy();

    act(() => set({ now: Date.now() + 3000 }));
    await user.click(within(record).getByRole("button", { name: "強制終了" }));
    expect(callsOf("signal")).toEqual([
      { job: "mhz0a1b2-aaaaaa", signal: "INT" },
      { job: "mhz0a1b2-aaaaaa", signal: "KILL" },
    ]);
  });

  it("stops the newest running command on Ctrl+C when nothing is selected, and leaves it to copying while text is", async () => {
    daemon({ jobs: [job({ id: "mhz0a1b2-aaaaaa", command: "sleep 100" }), job({ id: "mhz0a1b3-bbbbbb", command: "npm run dev" })] });
    draw();
    await screen.findByRole("region", { name: "$ npm run dev" });
    await user.type(box(), "ls");
    (box() as HTMLTextAreaElement).setSelectionRange(0, 2);
    await user.keyboard("{Control>}c{/Control}");
    expect(callsOf("signal")).toEqual([]);

    (box() as HTMLTextAreaElement).setSelectionRange(2, 2);
    await user.keyboard("{Control>}c{/Control}");
    expect(callsOf("signal")).toEqual([{ job: "mhz0a1b3-bbbbbb", signal: "INT" }]);
  });

  it("clears the records of ended commands only on a second press", async () => {
    daemon({ jobs: [job({ state: "exited", exitCode: 0, endedAt: Date.now() })] });
    draw();
    await screen.findByRole("region", { name: "$ npm test" });
    await user.click(screen.getByRole("button", { name: "記録を消す" }));
    expect(callsOf("clear")).toEqual([]);
    await user.click(screen.getByRole("button", { name: "もう一度押すと消す" }));
    expect(callsOf("clear")).toEqual([{}]);
  });

  it("follows nothing on an offline working server, and says so", () => {
    draw(machine({ connected: false }));
    expect(screen.getByText("mac はオフラインです。")).toBeTruthy();
    expect(box()).toHaveProperty("disabled", true);
    expect(sdk.call).not.toHaveBeenCalled();
  });

  it("shows why the folder's commands could not be read", async () => {
    let asked = false;
    answerCalls({ watch: () => (asked ? new Promise<never>(() => {}) : ((asked = true), { ok: false, error: "プラグインが応答しません。" })) });
    draw();
    expect(await screen.findByText("プラグインが応答しません。")).toBeTruthy();
  });

  it("goes back to the session's folder when the working folder is outside it", async () => {
    daemon({ cwd: "/tmp" });
    draw();
    await user.click(await screen.findByRole("button", { name: "セッションのフォルダーに戻る" }));
    expect(callsOf("chdir")).toEqual([{}]);
  });

  it("brings back the commands run before with ↑, and what was being typed with ↓", async () => {
    const ended = { state: "exited" as const, exitCode: 0, endedAt: Date.now() };
    daemon({ jobs: [job({ id: "mhz0a1b2-aaaaaa", command: "ls", ...ended }), job({ id: "mhz0a1b3-bbbbbb", command: "npm test", ...ended })] });
    draw();
    await screen.findByRole("region", { name: "$ ls" });
    await user.type(box(), "gi");
    await user.keyboard("{ArrowUp}");
    expect(box()).toHaveProperty("value", "npm test");
    await user.keyboard("{ArrowUp}");
    expect(box()).toHaveProperty("value", "ls");
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(box()).toHaveProperty("value", "gi");
  });

  it("reads the earlier output of an ended command from the working server when it is opened", async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const head = `${lines.slice(0, 10).join("\n")}\n`;
    const tail = lines.slice(10).join("\n");
    const ended = job({ state: "exited", exitCode: 1, endedAt: Date.now(), size: head.length + tail.length, lines: 30 });
    const earlier: CallResult<OutputAnswer> = { ok: true, data: { from: 0, text: head, size: ended.size, dropped: 0 } };
    daemon({ jobs: [ended], output: { [ended.id]: { from: head.length, text: tail } } }, { output: earlier });
    draw();
    expect(await screen.findByText("line 30")).toBeTruthy();
    expect(screen.queryByText("line 1")).toBeNull();
    await user.click(screen.getByRole("button", { name: "すべて表示（30 行）" }));
    expect(callsOf("output")).toEqual([{ job: ended.id, from: 0, limit: head.length }]);
    await waitFor(() => expect(screen.getByText("line 1")).toBeTruthy());
  });
});
