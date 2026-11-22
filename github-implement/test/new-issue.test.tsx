import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { callsOf } from "../../test/sdk.tsx";
import type { WorktreeInfo } from "@gasho/plugin-sdk";
import { NewIssueBox } from "../src/web/home/new-issue.tsx";
import { fill, github, reads, renderWithToasts } from "./render.tsx";

const worktree: WorktreeInfo = { path: "/work/app", branch: "feat/7-x", github, sessions: [] };

const show = () => {
  reads({ meta: { data: { labels: [], assignable: [] } } });
  return renderWithToasts(<NewIssueBox machine="m1" worktree={worktree} repo="4rtofl/app" onCreated={vi.fn()} />);
};
const title = () => screen.getByRole("textbox", { name: "Issue の題" });
const body = () => screen.getByRole("textbox", { name: "Issue の本文" });

describe("NewIssueBox", () => {
  it("makes none on ⌘ + Enter in the body while Japanese text is being composed, and makes it after", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: "Issue を起票する" }));
    await fill(title(), "題");
    await fill(body(), "本文");
    // Chrome sends the keys of a composition with isComposing, Safari the Enter that ends one with keyCode 229.
    fireEvent.keyDown(body(), { key: "Enter", metaKey: true, isComposing: true });
    fireEvent.keyDown(body(), { key: "Enter", ctrlKey: true, keyCode: 229 });
    expect(callsOf("write")).toEqual([]);

    fireEvent.keyDown(body(), { key: "Enter", metaKey: true });
    expect(callsOf("write")).toEqual([expect.objectContaining({ op: "create-issue", title: "題", body: "本文" })]);
  });
});
