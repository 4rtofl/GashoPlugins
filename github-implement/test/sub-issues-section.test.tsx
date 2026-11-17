import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { sdk } from "../../test/sdk.tsx";
import type { IssueRef, SubIssues } from "../src/daemon/ops/sub-issues.ts";
import type { GitHubItemDetail } from "../src/types.ts";
import SubIssuesSection from "../src/web/item/sections/sub-issues.tsx";
import { detail, fill, reads, renderItem, REPO, writes } from "./render.tsx";

const issue = (over: Partial<GitHubItemDetail> = {}) => detail({ title: "分けて進める", ...over });

const show = (item = issue()) => renderItem(item, <SubIssuesSection.View />);

const ref = (repo: string, number: number, title: string, state: IssueRef["state"] = "open"): IssueRef => ({
  repo,
  number,
  title,
  state,
  ...(state === "closed" ? { stateReason: "completed" as const } : {}),
  url: `https://github.com/${repo}/issues/${number}`,
});

const children = [ref(REPO, 5, "小さい作業", "closed"), ref("4rtofl/other", 7, "別の repo の作業"), ref(REPO, 6, "もう 1 つの作業")];

const subIssues = (state: { data?: SubIssues; error?: string }) => reads({ "sub-issues": state });

describe("the parent and sub-issues of an issue", () => {
  it("counts the sub-issues that are closed", () => {
    subIssues({ data: { children } });
    show();
    expect(screen.getByText("3 件中 1 件を閉じた")).toBeTruthy();
  });

  it("chooses the parent by a number or a URL of this repository, and refuses an issue of another one", async () => {
    subIssues({ data: { children: [] } });
    show();
    await userEvent.click(screen.getByRole("button", { name: "親を決める" }));
    const box = within(screen.getByRole("dialog", { name: "親を決める" }));
    const input = box.getByRole("textbox", { name: "親を決める：Issue の番号" });
    await fill(input, "https://github.com/4rtofl/other/issues/3");
    expect(box.getByText("4rtofl/app の Issue の番号か URL を入れてください。")).toBeTruthy();
    expect(box.getByRole("button", { name: "決める" })).toHaveProperty("disabled", true);

    await fill(input, "#17");
    await userEvent.click(box.getByRole("button", { name: "決める" }));
    expect(writes()).toMatchObject([{ op: "sub-issue", repo: REPO, number: 12, action: "add", parent: 17, child: 12 }]);
  });

  it("adds a sub-issue by the URL of an issue of this repository", async () => {
    subIssues({ data: { children } });
    show();
    await userEvent.click(screen.getByRole("button", { name: "sub-issue を足す" }));
    await fill(screen.getByRole("textbox", { name: "sub-issue を足す：Issue の番号" }), "https://github.com/4rtofl/app/issues/30");
    await userEvent.keyboard("{Enter}");
    expect(writes()).toMatchObject([{ op: "sub-issue", action: "add", parent: 12, child: 30 }]);
  });

  it("names the repository of a sub-issue of another one when taking it off, and when the toast puts it back", async () => {
    subIssues({ data: { children } });
    show();
    await userEvent.click(screen.getByRole("button", { name: "4rtofl/other#7 を sub-issue から外す" }));
    expect(writes()).toMatchObject([{ op: "sub-issue", action: "remove", parent: 12, child: 7, childRepo: "4rtofl/other" }]);
    await userEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(writes()[1]).toMatchObject({ op: "sub-issue", action: "add", parent: 12, child: 7, childRepo: "4rtofl/other" });
  });

  it("takes off a sub-issue of this repository by its number alone", async () => {
    subIssues({ data: { children } });
    show();
    await userEvent.click(screen.getByRole("button", { name: "#5 を sub-issue から外す" }));
    expect(writes()).toMatchObject([{ op: "sub-issue", action: "remove", parent: 12, child: 5 }]);
    expect(writes()[0]).not.toHaveProperty("childRepo");
  });

  it("takes the issue off a parent in another repository", async () => {
    subIssues({ data: { parent: ref("4rtofl/other", 3, "大きな作業"), children: [] } });
    show();
    expect(screen.queryByRole("button", { name: "親を決める" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "4rtofl/other#3 の sub-issue から外す" }));
    expect(writes()).toMatchObject([{ op: "sub-issue", action: "remove", parent: 3, parentRepo: "4rtofl/other", child: 12 }]);
  });

  it("opens an issue of this repository in the worktree's tabs, and one of another repository on GitHub", async () => {
    subIssues({ data: { children } });
    show();
    await userEvent.click(screen.getByRole("link", { name: /小さい作業/ }));
    expect(sdk.nav.openWorktreeView).toHaveBeenCalledWith("item", { kind: "issues", number: "5" }, undefined);
    const other = screen.getByRole("link", { name: /別の repo の作業/ });
    expect(other.getAttribute("href")).toBe("https://github.com/4rtofl/other/issues/7");
    expect(other.getAttribute("target")).toBe("_blank");
  });

  it("says why they could not be read", () => {
    subIssues({ error: "gh: HTTP 502" });
    show();
    expect(screen.getByText("読めませんでした：gh: HTTP 502")).toBeTruthy();
  });
});
