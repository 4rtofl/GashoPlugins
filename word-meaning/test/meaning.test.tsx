import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { lastRequest, machine, respond, sdk, session } from "../../test/sdk.tsx";
import { shows } from "../src/web/index.tsx";
import { paramsOf, WordMeaning } from "../src/web/meaning.tsx";
import { CONTEXT, MAX_WORD } from "../src/word.ts";

const answer = "この処理は冪等なので、二度呼んでも同じです。";
const select = (text: string, over: { answer?: string } = {}) => {
  const a = over.answer ?? answer;
  const start = a.indexOf(text);
  return { text, answer: a, start, end: start + text.length };
};
const props = (text = "冪等") => ({ machine: machine(), session: session(), ...select(text) });

describe("WordMeaning", () => {
  it("shows for a word, not for a sentence, and only where the daemon part can be asked", () => {
    const ctx = (text: string, o: { connected?: boolean; ready?: boolean } = {}) => ({
      machine: machine({ connected: o.connected ?? true }),
      session: session(),
      daemon: { ready: o.ready ?? true },
      selection: select(text, { answer: `${text}。` }),
    });
    expect(shows(ctx("冪等"))).toBe(true);
    expect(shows(ctx("x".repeat(MAX_WORD)))).toBe(true);
    expect(shows(ctx("x".repeat(MAX_WORD + 1)))).toBe(false);
    expect(shows(ctx("一行目\n二行目"))).toBe(false);
    expect(shows(ctx("冪等", { connected: false }))).toBe(false);
    expect(shows(ctx("冪等", { ready: false }))).toBe(false);
  });

  it("asks for the meaning only once the button is pressed, and says it is asking meanwhile", async () => {
    render(<WordMeaning {...props()} />);
    expect(lastRequest("meaning")).toBeUndefined();
    await userEvent.click(screen.getByRole("button", { name: "意味を調べる" }));
    expect(lastRequest("meaning")).toMatchObject({ machine: "m1", params: { word: "冪等", before: "この処理は", after: "なので、二度呼んでも同じです。" } });
    expect(screen.getByRole("status").textContent).toContain("意味を調べています");
  });

  it("shows the meaning with the word", async () => {
    respond({ meaning: { data: { meaning: "何度しても結果が同じになること。" }, loading: false } });
    render(<WordMeaning {...props()} />);
    await userEvent.click(screen.getByRole("button", { name: "意味を調べる" }));
    expect(screen.getByText("冪等")).toBeTruthy();
    expect(screen.getByText("何度しても結果が同じになること。")).toBeTruthy();
  });

  it("shows why there is no meaning, with a retry", async () => {
    respond({ meaning: { error: "意味を、時間内に調べられませんでした。", loading: false } });
    render(<WordMeaning {...props()} />);
    await userEvent.click(screen.getByRole("button", { name: "意味を調べる" }));
    expect(screen.getByRole("alert").textContent).toBe("意味を、時間内に調べられませんでした。");
    await userEvent.click(screen.getByRole("button", { name: "もう一度" }));
    expect(sdk.reload).toHaveBeenCalledWith("meaning");
  });

  it("sends as much of a long answer around the word as the setting can ask for", () => {
    const long = `${"a".repeat(CONTEXT.max + 5)}語${"b".repeat(CONTEXT.max + 5)}`;
    const p = paramsOf(select("語", { answer: long }));
    expect(p).toEqual({ word: "語", before: "a".repeat(CONTEXT.max), after: "b".repeat(CONTEXT.max) });
  });
});
