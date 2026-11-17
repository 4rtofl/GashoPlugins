import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { lastRequest, machine, respond, sdk, session } from "../../test/sdk.tsx";
import { BoardPanel, ProjectsPanel } from "../src/web/projects.tsx";
import type { Board, BoardItem, ProjectRef, Projects } from "../src/types.ts";

const github = { owner: "4rtofl", name: "app", url: "https://github.com/4rtofl/app" };
const s = session({ github });

const project = (over: Partial<ProjectRef> = {}): ProjectRef => ({ number: 3, title: "ロードマップ", url: "https://github.com/orgs/4rtofl/projects/3", closed: false, items: 12, ...over });
const projects = (over: Partial<Projects> = {}): Projects => ({ repo: github, linked: [project()], owner: [], ownerLogin: "4rtofl", ...over });

describe("ProjectsPanel", () => {
  it("in a folder of several repositories, reads the one of the tab chosen and opens its projects with it", async () => {
    const api = { owner: "4rtofl", name: "api", url: "https://github.com/4rtofl/api" };
    const folder = session({ cwd: "/work", repos: [{ path: "api", github: api }, { path: "web", github }, { path: "notes" }] });
    respond({ projects: { data: projects() } });
    render(<ProjectsPanel machine={machine()} session={folder} params={{ repo: "web" }} docked />);
    expect(lastRequest("projects")?.params).toEqual({ repo: "web" });
    // Only the repositories on GitHub get a tab.
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["api", "web"]);

    await userEvent.click(screen.getByRole("tab", { name: "api" }));
    expect(sdk.nav.replacePanel).toHaveBeenCalledWith("projects", { repo: "api" });
    await userEvent.click(screen.getByRole("link", { name: /ロードマップ/ }));
    expect(sdk.nav.openPanel).toHaveBeenCalledWith("project", { repo: "web", number: "3" }, undefined);
  });

  it("says which scope gh's login lacks and the command that adds it, in place of the lists", () => {
    respond({ projects: { data: projects({ linked: [], missing: { scope: "read:project", command: "gh auth refresh -s read:project" } }) } });
    render(<ProjectsPanel machine={machine()} session={s} params={{}} docked />);
    expect(screen.getByText("read:project", { selector: "code" })).toBeTruthy();
    expect(screen.getByText("gh auth refresh -s read:project")).toBeTruthy();
    expect(screen.queryByText("このリポジトリの Project")).toBeNull();
  });

  it("reads nothing for a folder without a repository on GitHub, and says so", () => {
    render(<ProjectsPanel machine={machine()} session={session()} params={{}} docked />);
    expect(screen.getByText("このセッションのフォルダーには、GitHub のリポジトリがありません。")).toBeTruthy();
    expect(sdk.request).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "再読み込み" })).toHaveProperty("disabled", true);
  });
});

describe("BoardPanel", () => {
  const item = (id: string, title: string, values: Record<string, string>): BoardItem => ({ id, type: "issue", title, state: "open", number: Number(id.slice(1)), assignees: [], values });
  const board = (items: BoardItem[]): Board => ({
    repo: github,
    number: 3,
    title: "ロードマップ",
    url: "https://github.com/orgs/4rtofl/projects/3",
    closed: false,
    fields: [
      { id: "priority", name: "Priority", options: [{ id: "high", name: "High", color: "RED" }] },
      {
        id: "status",
        name: "Status",
        options: [
          { id: "todo", name: "Todo", color: "GRAY" },
          { id: "done", name: "Done", color: "GREEN" },
        ],
      },
    ],
    defaultField: "status",
    items,
    truncated: false,
  });
  const titles = (column: string) => within(screen.getByRole("region", { name: column })).getAllByRole("listitem").map((li) => li.textContent);

  it("makes columns of the board view's field, with the items of none of its options in a column of their own", () => {
    respond({ project: { data: board([item("i1", "設計", { status: "todo" }), item("i2", "実装", { status: "done" }), item("i3", "調査", { priority: "high" })]) } });
    render(<BoardPanel machine={machine()} session={s} params={{ number: "3" }} docked />);
    expect(lastRequest("project")?.params).toEqual({ number: "3" });
    expect(titles("Todo")).toEqual([expect.stringContaining("設計")]);
    expect(titles("Done")).toEqual([expect.stringContaining("実装")]);
    expect(titles("Status なし")).toEqual([expect.stringContaining("調査")]);
  });

  it("makes columns of the field chosen, without a column of items lacking it when every item has it", async () => {
    respond({ project: { data: board([item("i1", "設計", { status: "todo", priority: "high" }), item("i2", "実装", { priority: "high" })]) } });
    render(<BoardPanel machine={machine()} session={s} params={{ number: "3", field: "priority" }} docked />);
    expect(titles("High")).toHaveLength(2);
    expect(screen.queryByRole("region", { name: "Priority なし" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Todo" })).toBeNull();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "列" }), "Status");
    expect(sdk.nav.replacePanel).toHaveBeenCalledWith("project", { number: "3", field: "status" });
  });

  it("reads nothing for a number that is not one, and says it is wrong", () => {
    render(<BoardPanel machine={machine()} session={s} params={{ number: "3x" }} docked />);
    expect(screen.getByText("Project の番号が正しくありません。")).toBeTruthy();
    expect(sdk.request).not.toHaveBeenCalled();
  });
});
