import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { callsOf, lastRequest, machine, respond, sdk, session } from "../../test/sdk.tsx";
import { RunPanel, RunsPanel } from "../src/web/actions.tsx";
import type { Job, Run, RunDetail, Runs } from "../src/types.ts";

const github = { owner: "4rtofl", name: "app", url: "https://github.com/4rtofl/app" };
const s = session({ github, gitBranch: "feat/1-x" });

const run = (over: Partial<Run> = {}): Run => ({
  id: 11,
  number: 7,
  workflow: "CI",
  title: "テストを足す",
  branch: "feat/1-x",
  event: "push",
  state: "success",
  createdAt: "2026-11-18T11:50:00Z",
  updatedAt: "2026-11-18T11:55:00Z",
  url: "https://github.com/4rtofl/app/actions/runs/11",
  ...over,
});
const runs = (list: Run[]): Runs => ({ repo: github, workflows: [{ id: 1, name: "CI", path: ".github/workflows/ci.yml", active: true }], runs: list, truncated: false });

describe("RunsPanel", () => {
  it("reads again every 15 seconds while a run is going, and stops once none is", () => {
    respond({ runs: { data: runs([run({ state: "in_progress" })]) } });
    render(<RunsPanel machine={machine()} session={s} params={{}} docked />);
    expect(lastRequest("runs")?.options?.refreshSeconds).toBe(15);
    expect(screen.getByText("実行中のものがあるあいだ、15 秒ごとに読み直します。")).toBeTruthy();

    act(() => respond({ runs: { data: runs([run({ state: "success" })]) } }));
    expect(lastRequest("runs")?.options?.refreshSeconds).toBeUndefined();
    expect(screen.queryByText(/秒ごとに読み直します/)).toBeNull();
  });

  it("filters by the session's branch with one press, and a second press shows every branch again", async () => {
    respond({ runs: { data: runs([run()]) } });
    const { rerender } = render(<RunsPanel machine={machine()} session={s} params={{}} docked />);
    const button = screen.getByRole("button", { name: /このブランチ/ });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(button);
    expect(sdk.nav.replacePanel).toHaveBeenLastCalledWith("actions", { branch: "feat/1-x" });

    rerender(<RunsPanel machine={machine()} session={s} params={{ branch: "feat/1-x" }} docked />);
    expect(lastRequest("runs")?.params).toEqual({ branch: "feat/1-x" });
    await userEvent.click(screen.getByRole("button", { name: /このブランチ/, pressed: true }));
    expect(sdk.nav.replacePanel).toHaveBeenLastCalledWith("actions", { branch: "" });
  });

  it("opens a run keeping the filters, so that its back button returns to them", async () => {
    respond({ runs: { data: runs([run()]) } });
    render(<RunsPanel machine={machine()} session={s} params={{ workflow: "1", branch: "feat/1-x" }} docked />);
    await userEvent.click(screen.getByRole("link", { name: /テストを足す/ }));
    expect(sdk.nav.openPanel).toHaveBeenCalledWith("run", { id: "11", workflow: "1", branch: "feat/1-x" }, undefined);
  });

  it("back from a run, the list is where it was scrolled to, once", async () => {
    respond({ runs: { data: runs([run()]) } });
    const panel = () => (
      <div data-testid="box" style={{ overflowY: "auto" }}>
        <RunsPanel machine={machine()} session={s} params={{}} docked />
      </div>
    );
    const opened = render(panel());
    screen.getByTestId("box").scrollTop = 120;
    await userEvent.click(screen.getByRole("link", { name: /テストを足す/ }));
    opened.unmount();
    const back = render(panel());
    expect(screen.getByTestId("box").scrollTop).toBe(120);
    back.unmount();
    render(panel());
    expect(screen.getByTestId("box").scrollTop).toBe(0);
  });

  it("asks gh to read GitHub again on the reload button, then reads the request again", async () => {
    respond({ runs: { data: runs([run()]) } });
    render(<RunsPanel machine={machine()} session={s} params={{}} docked />);
    await userEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(callsOf("runs")).toEqual([{ fresh: true }]);
    expect(sdk.reload).toHaveBeenCalledWith("runs");
  });

  it("reads nothing from an offline working server, and says so", () => {
    render(<RunsPanel machine={machine({ connected: false })} session={s} params={{}} docked />);
    expect(screen.getByText("mac はオフラインです。")).toBeTruthy();
    expect(sdk.request).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "再読み込み" })).toHaveProperty("disabled", true);
  });
});

describe("RunPanel", () => {
  const job = (over: Partial<Job>): Job => ({ id: 1, name: "test", state: "success", steps: [], ...over });
  const detail = (jobs: Job[], over: Partial<Run> = {}): RunDetail => ({ ...run({ state: "failure", ...over }), jobs });

  it("opens a failed job by itself with the end of its log, and leaves the others closed", () => {
    respond({
      run: {
        data: detail([
          job({ id: 1, name: "lint" }),
          job({ id: 2, name: "test", state: "failure", log: ["npm test", "1 failing"], url: "https://github.com/4rtofl/app/actions/runs/11/job/2" }),
        ]),
      },
    });
    render(<RunPanel machine={machine()} session={s} params={{ id: "11" }} docked />);
    expect(lastRequest("run")?.params).toEqual({ id: "11" });
    const [lint, test] = screen.getAllByRole("group");
    expect(lint).toHaveProperty("open", false);
    expect(test).toHaveProperty("open", true);
    expect(within(test!).getByText("失敗したステップのログ（末尾 2 行）")).toBeTruthy();
    expect(within(test!).getByText(/1 failing/)).toBeTruthy();
  });

  it("reads again while the run is going", () => {
    respond({ run: { data: detail([job({ state: "in_progress" })], { state: "in_progress" }) } });
    render(<RunPanel machine={machine()} session={s} params={{ id: "11" }} docked />);
    expect(lastRequest("run")?.options?.refreshSeconds).toBe(15);
    expect(screen.getByText("実行が終わるまで、15 秒ごとに読み直します。")).toBeTruthy();
  });

  it("reads nothing for an id that is not a number, and says it is wrong", () => {
    render(<RunPanel machine={machine()} session={s} params={{ id: "11;rm" }} docked />);
    expect(screen.getByText("実行の番号が正しくありません。")).toBeTruthy();
    expect(sdk.request).not.toHaveBeenCalled();
  });

  it("goes back to the list with the filters it was opened from", async () => {
    respond({ run: { data: detail([]) } });
    render(<RunPanel machine={machine()} session={s} params={{ id: "11", branch: "feat/1-x" }} docked />);
    await userEvent.click(screen.getByRole("button", { name: /Actions の一覧/ }));
    expect(sdk.nav.back).toHaveBeenCalledWith({ id: "actions", params: { branch: "feat/1-x" } });
  });
});
