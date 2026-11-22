import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { respond, sdk } from "../../test/sdk.tsx";
import type { WorktreeInfo } from "@gasho/plugin-sdk";
import { HomePalette, Palette, useWorktreeCommands, type PaletteGroup } from "../src/web/palette.tsx";
import type { ItemSummary, WorktreeItems } from "../src/types.ts";
import { useChosenTab } from "../src/web/item/context.tsx";
import { detail, github, itemScreen } from "./render.tsx";

const worktree: WorktreeInfo = { path: "/work/app", branch: "feat/7-x", github, sessions: [] };

const commands = () => {
  const run = { reload: vi.fn(), merge: vi.fn(), open: vi.fn() };
  const groups: PaletteGroup[] = [
    {
      label: "この画面の操作",
      commands: [
        { id: "reload", label: "再読み込み", keywords: "reload refresh", run: run.reload },
        { id: "merge", label: "マージする", disabled: true, run: run.merge },
      ],
    },
    { label: "Issue と Pull request", commands: [{ id: "open-7", label: "#7 テストを足す", hint: "Pull request", run: run.open }] },
  ];
  render(<Palette label="操作" groups={groups} />);
  return run;
};
// happy-dom is not a Mac (navigator.platform), where it would be ⌘K.
const open = () => userEvent.keyboard("{Control>}k{/Control}");
const box = () => screen.queryByRole("combobox", { name: "探す操作や Issue・Pull request" });
const options = () => screen.queryAllByRole("option").map((o) => o.textContent);

describe("Palette", () => {
  it("opens on Ctrl+K but on a Mac, and closes on it again", async () => {
    commands();
    expect(box()).toBeNull();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    expect(box()).toBeNull();
    await open();
    expect(box()).toBeTruthy();
    await open();
    expect(box()).toBeNull();
  });

  it("finds the commands that have every word typed in their label, hint or keywords, in any case", async () => {
    commands();
    await open();
    await userEvent.type(box()!, "REFRESH");
    expect(options()).toEqual(["再読み込み"]);
    await userEvent.clear(box()!);
    await userEvent.type(box()!, "pull テスト");
    expect(options()).toEqual(["#7 テストを足すPull request"]);
    await userEvent.type(box()!, " zzz");
    expect(options()).toEqual([]);
    expect(screen.getByText("見つかりません。")).toBeTruthy();
  });

  it("moves with the arrows, round from the first to the last, and runs the one chosen with Enter", async () => {
    const run = commands();
    await open();
    expect(screen.getByRole("option", { selected: true }).textContent).toBe("再読み込み");
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByRole("option", { selected: true }).textContent).toBe("#7 テストを足すPull request");
    await userEvent.keyboard("{Enter}");
    expect(run.open).toHaveBeenCalledOnce();
    expect(box()).toBeNull();
  });

  it("runs a command that is off neither with Enter nor with a press", async () => {
    const run = commands();
    await open();
    await userEvent.type(box()!, "マージ");
    await userEvent.keyboard("{Enter}");
    await userEvent.click(screen.getByRole("option", { name: "マージする" }));
    expect(run.merge).not.toHaveBeenCalled();
    expect(box()).toBeTruthy();
  });

  it("runs nothing on the Enter that ends the composition of Japanese text", async () => {
    const run = commands();
    await open();
    fireEvent.keyDown(box()!, { key: "Enter", keyCode: 229 });
    expect(run.reload).not.toHaveBeenCalled();
    expect(box()).toBeTruthy();
  });
});

const summary = (kind: ItemSummary["kind"], number: number, title: string): ItemSummary => ({ kind, number, title, state: "open", url: `https://github.com/4rtofl/app/${kind === "pulls" ? "pull" : "issues"}/${number}` });
const items = (added: ItemSummary[]): WorktreeItems => ({ pulls: [], added, missing: [], at: 0 });

describe("the palettes of the worktree's screens", () => {
  it("on the GitHub tab, lists the worktree's issues and pull requests to open, and reads them again", async () => {
    respond({ read: { data: items([summary("issues", 7, "不具合"), summary("pulls", 8, "直す")]) } });
    render(<HomePalette machine="m1" worktree={worktree} />);
    await open();
    expect(options()).toEqual(["再読み込み", "GitHub でリポジトリを開く", "#7 不具合Issue", "#8 直すPull request"]);
    await userEvent.click(screen.getByRole("option", { name: /#8 直す/ }));
    expect(sdk.nav.openWorktreeView).toHaveBeenCalledWith("item", { kind: "pulls", number: "8" }, undefined);

    await open();
    await userEvent.click(screen.getByRole("option", { name: "再読み込み" }));
    expect(sdk.reload).toHaveBeenCalledWith("read");
  });

  it("on an item's screen, leaves out that item and offers the GitHub tab", async () => {
    respond({ read: { data: items([summary("issues", 7, "不具合"), summary("pulls", 8, "直す")]) } });
    function OnItem() {
      return <Palette label="操作" groups={[useWorktreeCommands("m1", worktree, { kind: "pulls", number: 8 })]} />;
    }
    render(<OnItem />);
    await open();
    expect(options()).toEqual(["#7 不具合Issue", "GitHub（一覧と、番号で足す欄）タブ"]);
    await userEvent.click(screen.getByRole("option", { name: /GitHub（一覧/ }));
    expect(sdk.nav.openWorktreeView).toHaveBeenCalledWith("home", undefined, undefined);
  });
});

describe("the tab of an item's screen, which ⌘K opens too", () => {
  function Tabs() {
    const [chosen, choose] = useChosenTab(["conversation", "commits"]);
    return (
      <button type="button" onClick={() => choose("commits")}>
        {chosen}
      </button>
    );
  }
  const shown = () => screen.getByRole("button").textContent;

  it("goes back to the one the screen opened with on the browser's back, and shows the one shown last when opened again", async () => {
    const item = detail({ kind: "pulls" });
    const view = render(itemScreen(item, <Tabs />));
    expect(shown()).toBe("conversation");
    await userEvent.click(screen.getByRole("button"));
    expect(sdk.nav.openWorktreeView).toHaveBeenCalledWith("item", { kind: "pulls", number: "12", tab: "commits" }, undefined);
    view.rerender(itemScreen(item, <Tabs />, { tab: "commits" }));
    expect(shown()).toBe("commits");
    // Back: the URL of the worktree tab, without a tab.
    view.rerender(itemScreen(item, <Tabs />));
    expect(shown()).toBe("conversation");

    // Opened again after another screen (a session's), from the worktree tab.
    view.rerender(itemScreen(item, <Tabs />, { tab: "commits" }));
    view.unmount();
    render(itemScreen(item, <Tabs />));
    expect(shown()).toBe("commits");
  });
});
