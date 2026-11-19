import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { lastRequest, respond, sdk } from "../../test/sdk.tsx";
import { useItem } from "../src/web/item/context.tsx";
import files from "../src/web/item/tabs/files.tsx";
import type { GitHubFile, GitHubItemDetail } from "../src/types.ts";
import { detail, renderItem } from "./render.tsx";

const pull = (over: Partial<GitHubItemDetail> = {}) => detail({ kind: "pulls", number: 7, ...over });

const file = (path: string, status: GitHubFile["status"], previousPath?: string): GitHubFile => ({
  path,
  status,
  ...(previousPath ? { previousPath } : {}),
  additions: 1,
  deletions: 1,
  anchor: `diff-${path}`,
});
const FILES = [file("README.md", "modified"), file("src/web/a.ts", "added"), file("src/web/b.ts", "modified"), file("src/old.ts", "removed")];

// A part elsewhere on the item's screen that changes the item, as the sections do.
function OtherPart() {
  const { run } = useItem();
  return (
    <button type="button" onClick={() => void run({ id: "x", op: "edit", params: {}, summary: "題を変える", done: "変えました" })}>
      ほかの部品の変更
    </button>
  );
}

const show = (item = pull()) =>
  renderItem(
    item,
    <>
      <files.View />
      <OtherPart />
    </>,
  );
const shown = () => screen.queryAllByRole("link").filter((a) => a.getAttribute("href")?.includes("/files#")).map((a) => a.getAttribute("href")?.split("#")[1]);

describe("the files tab", () => {
  it("shows only the files of the kind of change pressed, and all of them on a second press", async () => {
    respond({ read: { data: FILES } });
    show();
    expect(lastRequest("read")?.params).toEqual({ op: "files", repo: "4rtofl/app", number: 7 });
    expect(screen.getByRole("button", { name: /すべて 4/, pressed: true })).toBeTruthy();
    // No file was renamed, so there is nothing to choose for it.
    expect(screen.queryByRole("button", { name: /名前の変更/ })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /削除 1/ }));
    expect(shown()).toEqual(["diff-src/old.ts"]);
    await userEvent.click(screen.getByRole("button", { name: /削除 1/, pressed: true }));
    expect(shown()).toHaveLength(4);
  });

  it("folds a folder, and all of them at once", async () => {
    respond({ read: { data: FILES } });
    show();
    const web = screen.getByRole("button", { name: /^web/ });
    await userEvent.click(web);
    expect(web.getAttribute("aria-expanded")).toBe("false");
    expect(shown()).toEqual(["diff-src/old.ts", "diff-README.md"]);

    await userEvent.click(screen.getByRole("button", { name: "すべて畳む" }));
    expect(shown()).toEqual(["diff-README.md"]);
    await userEvent.click(screen.getByRole("button", { name: "すべて開く" }));
    expect(shown()).toHaveLength(4);
  });

  it("shows a renamed file's old name, with its folder only when it moved to another", () => {
    respond({ read: { data: [file("src/new.ts", "renamed", "src/old.ts"), file("lib/moved.ts", "renamed", "src/moved.ts")] } });
    show();
    expect(screen.getByText("← old.ts")).toBeTruthy();
    expect(screen.getByText("← src/moved.ts")).toBeTruthy();
  });

  it("says how many files there are beyond those GitHub sent", () => {
    respond({ read: { data: FILES } });
    show(pull({ changedFiles: 9 }));
    expect(screen.getByText("ほかに 5 ファイルあります。GitHub で見られます。")).toBeTruthy();
  });

  it("keeps the files read before when reading again fails, and offers to read again", async () => {
    respond({ read: { data: FILES, error: "gh: timeout" } });
    show();
    expect(screen.getByRole("alert").textContent).toContain("変更したファイルを読めませんでした：gh: timeout");
    expect(shown()).toHaveLength(4);
    await userEvent.click(screen.getByRole("button", { name: "読み直す" }));
    expect(sdk.reload).toHaveBeenCalledWith("read");
  });

  it("reads the files again after a change made elsewhere on the item's screen", async () => {
    respond({ read: { data: FILES } });
    show();
    expect(sdk.reload).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "ほかの部品の変更" }));
    await waitFor(() => expect(sdk.reload).toHaveBeenCalledWith("read"));
  });
});
