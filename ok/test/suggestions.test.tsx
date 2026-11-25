import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lastRequest, machine, respond, sdk, session, set } from "../../test/sdk.tsx";
import { HOLD_MS, holdMsOf } from "../src/web/hold.ts";
import { shows } from "../src/web/index.tsx";
import { Suggestions } from "../src/web/suggestions.tsx";

const idle = (over = {}) => session({ status: "idle", managed: true, lastActivityAt: 1000, ...over });

describe("Suggestions", () => {
  it("shows only for an idle Claude Code session that Gasho can type into", () => {
    const ctx = (over = {}, daemon = true) => ({ machine: machine(), session: idle(over), daemon: { ready: daemon } });
    expect(shows(ctx())).toBe(true);
    expect(shows(ctx({ status: "busy" }))).toBe(false);
    expect(shows(ctx({ status: "waiting" }))).toBe(false);
    expect(shows(ctx({ managed: false }))).toBe(false);
    expect(shows(ctx({ agent: "codex" }))).toBe(false);
    expect(shows(ctx({}, false))).toBe(false);
  });

  it("asks for the prediction of the last reply, and says it is predicting meanwhile", () => {
    render(<Suggestions machine={machine()} session={idle()} />);
    expect(lastRequest("predict")).toMatchObject({ machine: "m1", sessionId: "s1", params: { at: 1000 } });
    expect(screen.getByRole("status").textContent).toContain("予測しています");
  });

  it("sends the prompt pressed, then hides until the next reply", async () => {
    const data = { prompts: ["はい、進めて", "テストも足して"] };
    respond({ predict: { data, loading: false } });
    const { rerender } = render(<Suggestions machine={machine()} session={idle()} />);
    await userEvent.click(screen.getByRole("button", { name: "テストも足して" }));
    expect(sdk.sendInput).toHaveBeenCalledWith({ machine: "m1", sessionId: "s1", text: "テストも足して" });
    expect(screen.queryByRole("button", { name: "はい、進めて" })).toBeNull();
    rerender(<Suggestions machine={machine()} session={idle({ lastActivityAt: 2000 })} />);
    expect(screen.getByRole("button", { name: "はい、進めて" })).toBeTruthy();
  });

  it("puts the prompts away with ×, and keeps them when sending fails", async () => {
    respond({ predict: { data: { prompts: ["OK"] }, loading: false } });
    sdk.sendInput.mockReturnValueOnce({ ok: false, error: "送れませんでした。" });
    render(<Suggestions machine={machine()} session={idle()} />);
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.getByRole("alert").textContent).toBe("送れませんでした。");
    await userEvent.click(screen.getByRole("button", { name: "候補を閉じる" }));
    expect(screen.queryByRole("button", { name: "OK" })).toBeNull();
  });

  it("shows why it could not predict, with a retry, and nothing when there is nothing to suggest", async () => {
    respond({ predict: { error: "次の指示を予測できませんでした。", loading: false } });
    const { unmount } = render(<Suggestions machine={machine()} session={idle()} />);
    expect(screen.getByRole("alert").textContent).toContain("予測できませんでした");
    await userEvent.click(screen.getByRole("button", { name: "もう一度" }));
    expect(sdk.reload).toHaveBeenCalledWith("predict");
    unmount();
    respond({ predict: { data: { prompts: [] }, loading: false } });
    const { container } = render(<Suggestions machine={machine()} session={idle()} />);
    expect(container.textContent).toBe("");
  });
});

describe("holding a digit key", () => {
  const three = { prompts: ["はい", "テストも足して", "差分を見せて"] };
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const ring = (n: number) => screen.getByRole("button", { name: three.prompts[n - 1] }).querySelector("[data-holding]");

  it("numbers the suggestions from the left, and sends one after its key is held for 2.5 s", () => {
    respond({ predict: { data: three, loading: false } });
    render(<Suggestions machine={machine()} session={idle()} />);
    expect(screen.getByRole("button", { name: "テストも足して" }).getAttribute("aria-keyshortcuts")).toBe("2");
    fireEvent.keyDown(document.body, { key: "2" });
    expect(ring(2)).toBeTruthy();
    expect(ring(1)).toBeNull();
    // Repeats while it is held do not start again.
    act(() => vi.advanceTimersByTime(HOLD_MS - 100));
    fireEvent.keyDown(document.body, { key: "2", repeat: true });
    expect(sdk.sendInput).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(100));
    expect(sdk.sendInput).toHaveBeenCalledWith({ machine: "m1", sessionId: "s1", text: "テストも足して" });
  });

  it("sends nothing when the key is let go early, or has no suggestion, or comes with a modifier", () => {
    respond({ predict: { data: three, loading: false } });
    render(<Suggestions machine={machine()} session={idle()} />);
    fireEvent.keyDown(document.body, { key: "1" });
    act(() => vi.advanceTimersByTime(HOLD_MS - 1));
    fireEvent.keyUp(document.body, { key: "1" });
    expect(ring(1)).toBeNull();
    fireEvent.keyDown(document.body, { key: "4" });
    fireEvent.keyDown(document.body, { key: "1", metaKey: true });
    act(() => vi.advanceTimersByTime(HOLD_MS * 2));
    expect(sdk.sendInput).not.toHaveBeenCalled();
  });

  it("leaves the digit keys to the chat box while it has the focus, empty or not", () => {
    respond({ predict: { data: three, loading: false } });
    render(
      <>
        <textarea aria-label="入力" />
        <Suggestions machine={machine()} session={idle()} />
      </>,
    );
    const box = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "入力" });
    box.focus();
    expect(fireEvent.keyDown(box, { key: "1" })).toBe(true);
    expect(ring(1)).toBeNull();
    act(() => vi.advanceTimersByTime(HOLD_MS * 2));
    fireEvent.keyUp(box, { key: "1" });
    expect(sdk.sendInput).not.toHaveBeenCalled();
  });

  it("ends the hold when the focus goes to the chat box", () => {
    respond({ predict: { data: three, loading: false } });
    render(
      <>
        <textarea aria-label="入力" />
        <Suggestions machine={machine()} session={idle()} />
      </>,
    );
    fireEvent.keyDown(document.body, { key: "2" });
    expect(ring(2)).toBeTruthy();
    act(() => screen.getByRole("textbox", { name: "入力" }).focus());
    expect(ring(2)).toBeNull();
    act(() => vi.advanceTimersByTime(HOLD_MS * 2));
    expect(sdk.sendInput).not.toHaveBeenCalled();
  });

  it("waits for the seconds of the setting holdSeconds", () => {
    set({ settings: { holdSeconds: 1 } });
    respond({ predict: { data: three, loading: false } });
    render(<Suggestions machine={machine()} session={idle()} />);
    expect(screen.getByRole("button", { name: "はい" }).getAttribute("title")).toContain("1 秒押し続けても送る");
    fireEvent.keyDown(document.body, { key: "1" });
    act(() => vi.advanceTimersByTime(999));
    expect(sdk.sendInput).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(sdk.sendInput).toHaveBeenCalledWith({ machine: "m1", sessionId: "s1", text: "はい" });
  });
});

describe("holdMsOf", () => {
  it("is 2.5 s without a number, and keeps to the range of the setting", () => {
    expect(holdMsOf(undefined)).toBe(HOLD_MS);
    expect(holdMsOf("3")).toBe(HOLD_MS);
    expect(holdMsOf(Number.NaN)).toBe(HOLD_MS);
    expect(holdMsOf(1.5)).toBe(1500);
    expect(holdMsOf(0)).toBe(500);
    expect(holdMsOf(60)).toBe(10_000);
  });
});
