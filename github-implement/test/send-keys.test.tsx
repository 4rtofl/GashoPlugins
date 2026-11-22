// ⌘ + Enter in the boxes of an item's screen that send to GitHub: a new comment and a review.
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import NewComment from "../src/web/item/conversation/new-comment.tsx";
import Reviewers from "../src/web/item/sections/reviewers.tsx";
import { detail, fill, reads, renderItem, writes } from "./render.tsx";

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
