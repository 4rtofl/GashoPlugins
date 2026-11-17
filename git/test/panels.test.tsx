import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { lastRequest, machine, respond, sdk, session } from "../../test/sdk.tsx";
import { ItemPanel, ListPanel } from "../src/web/panels.tsx";
import type { GitHubItem, GitHubItemDetail } from "../src/types.ts";

const app = { owner: "4rtofl", name: "app", url: "https://github.com/4rtofl/app" };
const lib = { owner: "4rtofl", name: "lib", url: "https://github.com/4rtofl/lib" };

const item = (over: Partial<GitHubItem> = {}): GitHubItem => ({
  number: 12,
  title: "画面を直す",
  url: "https://github.com/4rtofl/app/issues/12",
  createdAt: "2026-11-17T10:00:00Z",
  updatedAt: "2026-11-18T10:00:00Z",
  labels: [],
  ...over,
});
const detail = (over: Partial<GitHubItemDetail> = {}): GitHubItemDetail => ({ ...item(), kind: "pulls", state: "open", assignees: [], body: "", comments: [], ...over });

describe("ListPanel", () => {
  it("in a folder of several repositories, shows those on GitHub as tabs and reads the first one", async () => {
    const workspace = session({
      cwd: "/work",
      repos: [
        { path: "app", github: app },
        { path: "notes" },
        { path: "lib", github: lib },
      ],
    });
    respond({ list: { data: { repo: app, kind: "issues", items: [], truncated: false } } });
    render(<ListPanel machine={machine()} session={workspace} params={{}} docked />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["app", "lib"]);
    expect(lastRequest("list")?.params).toEqual({ kind: "issues", repo: "app" });

    await userEvent.click(screen.getByRole("tab", { name: "lib" }));
    expect(sdk.nav.replacePanel).toHaveBeenCalledWith("list", { kind: "issues", repo: "lib" });
  });

  it("reads nothing in a folder whose repositories are none on GitHub, and says so", () => {
    render(<ListPanel machine={machine()} session={session({ cwd: "/work", repos: [{ path: "notes" }] })} params={{ kind: "pulls" }} docked />);
    expect(screen.getByText("このセッションのフォルダーには、GitHub のリポジトリがありません。")).toBeTruthy();
    expect(sdk.request).not.toHaveBeenCalled();
  });

  it("opens an item in place of the list, with the kind and the repository it came from", async () => {
    const workspace = session({ cwd: "/work", repos: [{ path: "lib", github: lib }] });
    respond({ list: { data: { repo: lib, kind: "pulls", items: [item({ number: 5, title: "版を上げる" })], truncated: false } } });
    render(<ListPanel machine={machine()} session={workspace} params={{ kind: "pulls" }} docked />);
    await userEvent.click(screen.getByRole("link", { name: /版を上げる/ }));
    expect(sdk.nav.openPanel).toHaveBeenCalledWith("item", { kind: "pulls", number: "5", repo: "lib" }, undefined);
  });
});

describe("ItemPanel", () => {
  const s = session({ github: app });

  it("reads nothing for a number that is not one, and says it is wrong", () => {
    render(<ItemPanel machine={machine()} session={s} params={{ kind: "issues", number: "0" }} docked />);
    expect(screen.getByText("番号が正しくありません。")).toBeTruthy();
    expect(sdk.request).not.toHaveBeenCalled();
  });

  it("puts comments and reviews in one conversation, oldest first", () => {
    respond({
      item: {
        data: detail({
          comments: [
            { author: "ama", createdAt: "2026-11-18T09:00:00Z", body: "三つ目" },
            { author: "ama", createdAt: "2026-11-17T09:00:00Z", body: "一つ目" },
          ],
          reviews: [{ author: "toto", submittedAt: "2026-11-17T12:00:00Z", state: "changes_requested", body: "二つ目" }],
        }),
      },
    });
    render(<ItemPanel machine={machine()} session={s} params={{ kind: "pulls", number: "12" }} docked />);
    expect(lastRequest("item")?.params).toEqual({ kind: "pulls", number: 12 });
    const said = screen.getAllByText(/^(一つ目|二つ目|三つ目)$/).map((e) => e.textContent);
    expect(said).toEqual(["一つ目", "二つ目", "三つ目"]);
  });

  it("does not show the body of a comment hidden on GitHub", () => {
    respond({ item: { data: detail({ comments: [{ author: "spam", createdAt: "2026-11-18T09:00:00Z", body: "宣伝です", minimized: true }] }) } });
    render(<ItemPanel machine={machine()} session={s} params={{ kind: "pulls", number: "12" }} docked />);
    expect(screen.getByText("GitHub で非表示にされたコメントです。")).toBeTruthy();
    expect(screen.queryByText("宣伝です")).toBeNull();
  });

  it("counts a pull request's checks by how they went", () => {
    respond({
      item: {
        data: detail({
          checks: [
            { name: "lint", state: "success" },
            { name: "test", state: "failure" },
            { name: "build", state: "pending" },
            { name: "e2e", state: "success" },
            { name: "deploy", state: "skipped" },
          ],
        }),
      },
    });
    render(<ItemPanel machine={machine()} session={s} params={{ kind: "pulls", number: "12" }} docked />);
    expect(screen.getByText("失敗 1")).toBeTruthy();
    expect(screen.getByText("実行中 1")).toBeTruthy();
    expect(screen.getByText("成功 2")).toBeTruthy();
    expect(screen.getByText("その他 1")).toBeTruthy();
  });

  it("says how many more files a large pull request changes than gh sent", () => {
    respond({ item: { data: detail({ changedFiles: 120, files: [{ path: "src/a.ts", additions: 1, deletions: 0 }] }) } });
    render(<ItemPanel machine={machine()} session={s} params={{ kind: "pulls", number: "12" }} docked />);
    expect(screen.getByText("ほかに 119 ファイルあります。GitHub で見られます。")).toBeTruthy();
  });
});
