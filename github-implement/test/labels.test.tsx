import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { answerCalls, respond, sdk } from "../../test/sdk.tsx";
import type { GitHubItemDetail, RepoMeta } from "../src/types.ts";
import Labels from "../src/web/item/sections/labels.tsx";
import { detail, fill, reads, renderItem, REPO, writes } from "./render.tsx";

const issue = (over: Partial<GitHubItemDetail> = {}) => detail({ title: "ラベルを足す", labels: [{ name: "bug", color: "d73a4a" }], ...over });

const show = (item = issue()) => renderItem(item, <Labels.View />);

const meta: RepoMeta = { labels: [{ name: "bug", color: "d73a4a" }, { name: "docs" }, { name: "ui", color: "1d76db" }], assignable: [] };
const labelsRead = () => reads({ meta: { data: meta } });

const menu = () => screen.getByRole("button", { name: "ラベルを付け外しする" });
const list = () => within(screen.getByRole("dialog", { name: "ラベルを付け外しする" }));

describe("the labels of an item", () => {
  it("sends what was checked and unchecked in one edit when the list closes", async () => {
    labelsRead();
    show();
    await userEvent.click(menu());
    await userEvent.click(list().getByRole("button", { name: "docs", pressed: false }));
    await userEvent.click(list().getByRole("button", { name: "ui", pressed: false }));
    await userEvent.click(list().getByRole("button", { name: "bug", pressed: true }));
    expect(writes()).toEqual([]);
    expect(list().getByText("閉じると 3 件を反映")).toBeTruthy();

    await userEvent.click(menu());
    expect(writes()).toMatchObject([{ op: "edit", repo: REPO, number: 12, addLabels: ["docs", "ui"], removeLabels: ["bug"] }]);
  });

  it("sends nothing when a label is checked and unchecked again, or when the changes are given up", async () => {
    labelsRead();
    show();
    await userEvent.click(menu());
    await userEvent.click(list().getByRole("button", { name: "docs" }));
    await userEvent.click(list().getByRole("button", { name: "docs" }));
    await userEvent.click(list().getByRole("button", { name: "bug" }));
    await userEvent.click(list().getByRole("button", { name: "bug" }));
    await userEvent.click(menu());
    await userEvent.click(menu());
    await userEvent.click(list().getByRole("button", { name: "ui" }));
    await userEvent.click(list().getByRole("button", { name: "やめる" }));
    expect(writes()).toEqual([]);

    await userEvent.click(menu());
    expect(list().getByRole("button", { name: "ui" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("checks the first label the box narrows to on Enter", async () => {
    labelsRead();
    show();
    await userEvent.click(menu());
    await fill(list().getByRole("textbox", { name: "ラベルを名前で探す" }), "ui");
    await userEvent.keyboard("{Enter}");
    expect(list().queryByRole("button", { name: "bug" })).toBeNull();
    expect(list().getByRole("button", { name: "ui" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("makes a label no label is named as, with the color chosen, and puts it on", async () => {
    labelsRead();
    show();
    await userEvent.click(menu());
    await fill(list().getByRole("textbox", { name: "ラベルを名前で探す" }), "needs-review");
    await userEvent.click(list().getByRole("button", { name: "「needs-review」を新しく作る" }));
    await userEvent.click(screen.getByRole("radio", { name: "#0e8a16" }));
    await userEvent.click(screen.getByRole("button", { name: "作って付ける" }));
    expect(writes()).toMatchObject([
      { op: "create-label", repo: REPO, name: "needs-review", color: "0e8a16" },
      { op: "edit", addLabels: ["needs-review"], removeLabels: [] },
    ]);
    // The repository's labels are read again, so that the new one is listed.
    expect(sdk.reload).toHaveBeenCalledWith("read");
  });

  it("does not make a label with a name taken or unusable, or with a color that is not six hex digits", async () => {
    labelsRead();
    show();
    await userEvent.click(menu());
    await fill(list().getByRole("textbox", { name: "ラベルを名前で探す" }), "BUG");
    expect(list().queryByRole("button", { name: /新しく作る/ })).toBeNull();
    await fill(list().getByRole("textbox", { name: "ラベルを名前で探す" }), "new");
    await userEvent.click(list().getByRole("button", { name: "「new」を新しく作る" }));
    const form = within(screen.getByRole("form", { name: "新しいラベル" }));
    const name = form.getByRole("textbox", { name: "ラベルの名前" });
    const make = form.getByRole("button", { name: "作って付ける" });

    await fill(name, "BUG");
    expect(form.getByText("「BUG」はもうあります。")).toBeTruthy();
    expect(make).toHaveProperty("disabled", true);

    await fill(name, "a,b");
    expect(form.getByText("名前に「,」は使えません。")).toBeTruthy();

    await fill(name, "ok");
    const color = form.getByRole("textbox", { name: "色（16 進数 6 桁）" });
    await fill(color, "12345g");
    expect(form.getByText("色は 16 進数 6 桁で入れてください（例: 1d76db）。")).toBeTruthy();
    expect(make).toHaveProperty("disabled", true);
    expect(writes()).toEqual([]);
  });

  it("puts nothing on when GitHub does not make the label, and says why", async () => {
    labelsRead();
    answerCalls({ write: (p: { op: string }) => (p.op === "create-label" ? { ok: false, error: "gh: label already exists" } : { ok: true, data: undefined }) });
    show();
    await userEvent.click(menu());
    await fill(list().getByRole("textbox", { name: "ラベルを名前で探す" }), "late");
    await userEvent.click(list().getByRole("button", { name: "「late」を新しく作る" }));
    await userEvent.click(screen.getByRole("button", { name: "作って付ける" }));
    expect(screen.getByRole("form", { name: "新しいラベル" }).textContent).toContain("gh: label already exists");
    expect(writes()).toMatchObject([{ op: "create-label" }]);
  });

  it("takes a label off with its ×, and puts it back from the toast", async () => {
    labelsRead();
    show();
    await userEvent.click(screen.getByRole("button", { name: "ラベル「bug」を外す" }));
    expect(writes()).toMatchObject([{ op: "edit", removeLabels: ["bug"] }]);
    expect(screen.getByText("ラベル「bug」を外しました")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(writes()).toMatchObject([{ op: "edit", removeLabels: ["bug"] }, { op: "edit", addLabels: ["bug"] }]);
  });

  it("says why the repository's labels are missing from the list", async () => {
    respond({ read: (p: { op: string }) => (p.op === "meta" ? { error: "gh: HTTP 403" } : undefined) });
    show();
    await userEvent.click(menu());
    expect(list().getByText("gh: HTTP 403")).toBeTruthy();
  });
});
