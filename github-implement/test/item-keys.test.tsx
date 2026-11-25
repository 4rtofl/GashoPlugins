// The keys of the boxes of an item's screen: ⌘ + Enter that sends a new comment or a review, and Esc that closes the
// title's edit.
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { CallResult } from "@gasho/plugin-sdk";
import { answerCalls, machine, respond } from "../../test/sdk.tsx";
import NewComment from "../src/web/item/conversation/new-comment.tsx";
import Reviewers from "../src/web/item/sections/reviewers.tsx";
import { ItemView } from "../src/web/item/view.tsx";
import { detail, fill, github, reads, renderItem, writes } from "./render.tsx";

// Chrome sends the keys of a composition with isComposing, Safari the Enter that ends one with keyCode 229.
const composingEnters = (box: HTMLElement) => {
  fireEvent.keyDown(box, { key: "Enter", metaKey: true, isComposing: true });
  fireEvent.keyDown(box, { key: "Enter", ctrlKey: true, keyCode: 229 });
};

describe("⌘ + Enter while Japanese text is being composed", () => {
  it("sends no comment, and sends it after", async () => {
    renderItem(detail(), <NewComment.UnderBody />);
    const box = screen.getByRole("textbox", { name: "新しいコメント" });
    await fill(box, "LGTM");
    composingEnters(box);
    expect(writes()).toEqual([]);

    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    expect(writes()).toEqual([expect.objectContaining({ op: "comment", body: "LGTM" })]);
  });

  it("sends no review, and sends it after", async () => {
    reads({ meta: { data: { labels: [], assignable: [] } } });
    renderItem(detail({ kind: "pulls" }), <Reviewers.View />);
    await userEvent.click(screen.getByRole("button", { name: "レビューする" }));
    const box = screen.getByRole("textbox", { name: "レビューの本文" });
    await fill(box, "直してください");
    composingEnters(box);
    expect(writes()).toEqual([]);

    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    expect(writes()).toEqual([expect.objectContaining({ op: "review", event: "comment", body: "直してください" })]);
  });
});

describe("Esc in the title's box", () => {
  const show = () => {
    respond({ read: (p: { op: string }) => (p.op === "item" ? { data: detail({ title: "古い題" }) } : undefined) });
    render(<ItemView machine={machine()} worktree={{ path: "/work/app", github, sessions: [] }} params={{ kind: "issues", number: "12" }} />);
  };
  const box = () => screen.queryByRole("textbox", { name: "題" });

  it("closes the edit, but not while the title is being saved: the title typed stays when the save fails", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: "題を変える" }));
    await userEvent.keyboard("{Escape}");
    expect(box()).toBeNull();

    let saved: (r: CallResult<unknown>) => void = () => {};
    answerCalls({ write: new Promise<CallResult<unknown>>((r) => (saved = r)) });
    await userEvent.click(screen.getByRole("button", { name: "題を変える" }));
    await fill(box()!, "新しい題");
    await userEvent.click(screen.getByRole("button", { name: "保存する" }));
    fireEvent.keyDown(box()!, { key: "Escape" });
    await act(async () => saved({ ok: false, error: "GitHub に届きませんでした" }));
    expect(box()).toHaveProperty("value", "新しい題");
  });
});
