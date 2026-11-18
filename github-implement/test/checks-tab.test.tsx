import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { answerCalls, lastRequest, respond, sdk } from "../../test/sdk.tsx";
import checks from "../src/web/item/tabs/checks.tsx";
import type { GitHubCheck } from "../src/types.ts";
import { detail, renderItem, writes } from "./render.tsx";

const job = (name: string, run: number, id: number, state: GitHubCheck["state"] = "failure"): GitHubCheck => ({
  name,
  state,
  url: `https://github.com/4rtofl/app/actions/runs/${run}/job/${id}`,
  run,
  job: id,
});

const show = (list: GitHubCheck[]) => renderItem(detail({ kind: "pulls", number: 7, checks: list }), <checks.View />);

describe("the checks tab", () => {
  it("counts the failed, running and passed checks, and the skipped, neutral and cancelled ones together", () => {
    show([
      job("test", 11, 21),
      { name: "build", state: "pending" },
      { name: "lint", state: "success" },
      { name: "deploy", state: "success" },
      { name: "docs", state: "skipped" },
      { name: "e2e", state: "cancelled" },
    ]);
    for (const badge of ["失敗 1", "実行中 1", "成功 2", "その他 2"]) expect(screen.getByText(badge)).toBeTruthy();
  });

  it("reads a failed job's log only when it is opened, and shows its end", async () => {
    respond({ read: (p: { op: string }) => (p.op === "log" ? { data: { lines: [{ text: "npm test" }, { text: "1 failing", level: "error" }], cut: true } } : undefined) });
    show([job("test", 11, 21)]);
    expect(lastRequest("read")).toBeUndefined();

    const toggle = screen.getByRole("button", { name: "test" });
    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(lastRequest("read")?.params).toEqual({ op: "log", repo: "4rtofl/app", job: 21 });
    const log = screen.getByLabelText("test のログの末尾");
    expect(within(log).getByText("1 failing")).toBeTruthy();
    expect(screen.getByText("ログの末尾です。前の部分は GitHub で読めます。")).toBeTruthy();

    await userEvent.click(toggle);
    expect(screen.queryByLabelText("test のログの末尾")).toBeNull();
  });

  it("offers to read the log again when it could not be read", async () => {
    respond({ read: { error: "ログを読めませんでした" } });
    show([job("test", 11, 21)]);
    await userEvent.click(screen.getByRole("button", { name: "test" }));
    expect(screen.getByRole("alert").textContent).toContain("ログを読めませんでした");
    await userEvent.click(screen.getByRole("button", { name: "読み直す" }));
    expect(sdk.reload).toHaveBeenCalledWith("read");
  });

  it("runs a run's failed jobs again, keeping every other button off until it is done", async () => {
    let finish = (_: { ok: true; data: undefined }) => {};
    answerCalls({ write: () => new Promise((resolve) => (finish = resolve)) });
    show([job("test", 11, 21), job("lint", 12, 22)]);
    const [first, second] = screen.getAllByRole("button", { name: "再実行" });
    await userEvent.click(first!);
    expect(writes()).toEqual([{ op: "rerun", repo: "4rtofl/app", kind: "pulls", number: 7, run: 11 }]);
    expect(sdk.call.mock.calls[0]?.[0].summary).toBe("#7 の失敗したジョブを再実行する（test のワークフロー）");
    expect(second).toHaveProperty("disabled", true);

    finish({ ok: true, data: undefined });
    expect(await screen.findByText("失敗したジョブを再実行しました")).toBeTruthy();
    expect(second).toHaveProperty("disabled", false);
  });

  it("says what failed when running again failed", async () => {
    answerCalls({ write: { ok: false, error: "権限がありません" } });
    show([job("test", 11, 21)]);
    await userEvent.click(screen.getByRole("button", { name: "再実行" }));
    const toast = await screen.findByRole("alert");
    expect(toast.textContent).toContain("権限がありません");
  });

  it("links a check without a job of its own to the pull request's checks, and a passed job to its page", () => {
    show([{ name: "ci/circleci", state: "success" }, job("build", 13, 23, "success")]);
    expect(screen.getByRole("link", { name: /ci\/circleci/ }).getAttribute("href")).toBe("https://github.com/4rtofl/app/pull/7/checks");
    expect(screen.getByRole("link", { name: "build" }).getAttribute("href")).toBe("https://github.com/4rtofl/app/actions/runs/13/job/23");
    // Only a failed job has a log to open and failed jobs to run again.
    expect(screen.queryByRole("button", { name: "build" })).toBeNull();
    expect(screen.queryByRole("button", { name: "再実行" })).toBeNull();
  });
});
