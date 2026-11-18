import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { answerCalls, callsOf, lastRequest, machine, respond, sdk, set } from "../../test/sdk.tsx";
import { ReviewPage } from "../src/web/page.tsx";
import type { Listing, PrRow } from "../src/types.ts";

const pr = (over: Partial<PrRow> = {}): PrRow => ({
  repo: "4rtofl/app",
  number: 7,
  title: "ログインを直す",
  url: "https://github.com/4rtofl/app/pull/7",
  state: "open",
  labels: [],
  comments: 0,
  branch: "fix/7-login",
  place: { primary: "/work/app" },
  ...over,
});
const listing = (over: Partial<Listing> = {}): Listing => ({ watched: ["/work/app"], requested: [], repos: [], errors: [], ...over });
const listed = (over: Partial<Listing> = {}) => ({ data: listing(over) });

beforeEach(() => set({ machines: [machine({ canLaunch: true })] }));

describe("ReviewPage", () => {
  it("searches with the words typed, without the spaces around them", async () => {
    respond({ list: listed() });
    render(<ReviewPage params={{}} />);
    expect(lastRequest("list")?.params).toEqual({ query: "is:open" });
    const box = screen.getByRole("textbox", { name: "Pull request を探す" });
    await userEvent.clear(box);
    await userEvent.type(box, "  is:open label:bug  {Enter}");
    expect(lastRequest("list")?.params).toEqual({ query: "is:open label:bug" });
    expect(box).toHaveProperty("value", "is:open label:bug");
  });

  it("asks GitHub again on 更新, and shows that it failed until the search words change", async () => {
    respond({ list: listed() });
    answerCalls({ list: { ok: false, error: "API rate limit exceeded" } });
    render(<ReviewPage params={{}} />);
    await userEvent.click(screen.getByRole("button", { name: /更新/ }));
    expect(await screen.findByText("API rate limit exceeded")).toBeTruthy();
    expect(screen.getByText("読めなかったものがあります")).toBeTruthy();
    expect(callsOf("list")).toEqual([{ query: "is:open", fresh: true }]);
    expect(sdk.reload).toHaveBeenCalledWith("list");

    await userEvent.type(screen.getByRole("textbox", { name: "Pull request を探す" }), " draft:false{Enter}");
    await waitFor(() => expect(screen.queryByText("API rate limit exceeded")).toBeNull());
  });

  it("with several working servers, names the one that could not read something", () => {
    set({ machines: [machine({ id: "m1", name: "mac" }), machine({ id: "m2", name: "linux" })] });
    const mac = listed();
    const linux = listed({ errors: ["4rtofl/old: Could not resolve to a Repository"] });
    sdk.request.mockImplementation((t) => (t.machine === "m2" ? linux : mac));
    render(<ReviewPage params={{}} />);
    expect(screen.getByText("linux：4rtofl/old: Could not resolve to a Repository")).toBeTruthy();
  });

  it("reads only from the working servers whose daemon part runs", () => {
    set({ machines: [machine({ id: "m1", name: "mac" }), machine({ id: "m2", name: "linux" })], daemon: (id) => (id === "m2" ? { ready: false, reason: "gasho-daemon が古い" } : { ready: true }) });
    respond({ list: listed() });
    render(<ReviewPage params={{}} />);
    expect(new Set(sdk.request.mock.calls.map(([t]) => t.machine))).toEqual(new Set(["m1"]));
    expect(screen.queryByText("使える working server がありません")).toBeNull();
  });

  it("says why for each working server when none can read, and offers nothing to press", () => {
    set({ daemon: { ready: false, reason: "gasho-daemon が古い" } });
    render(<ReviewPage params={{}} />);
    expect(screen.getByText("使える working server がありません")).toBeTruthy();
    expect(screen.getByText("mac：gasho-daemon が古い")).toBeTruthy();
    expect(sdk.request).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "更新" })).toHaveProperty("disabled", true);
  });

  it("shows neither a count nor that there is nothing while the lists are being read", () => {
    respond({ list: { loading: true } });
    render(<ReviewPage params={{}} />);
    expect(screen.queryByText(/\d+ 件/)).toBeNull();
    expect(screen.queryByText(/Pull request もありません/)).toBeNull();
    expect(screen.queryByText(/対象リポジトリを選ぶと/)).toBeNull();
  });

  it("with no repository watched, offers to choose some, which opens the dialog", async () => {
    respond({ list: listed({ watched: [] }), options: { data: [] } });
    render(<ReviewPage params={{}} />);
    expect(screen.getByText("検索の語に合う、レビューを頼まれた Pull request も、自分の Pull request もありません。")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "対象リポジトリを選ぶ" }));
    expect(await screen.findByRole("dialog", { name: "対象リポジトリ" })).toBeTruthy();
  });

  it("says that the upper part holds my own pull requests too, in its heading, its description and when it is empty", async () => {
    respond({ list: listed() });
    render(<ReviewPage params={{}} />);
    expect(screen.getByRole("heading", { name: /^レビューを頼まれた Pull request と自分の Pull request/ })).toBeTruthy();
    expect(screen.getByText(/^レビューを頼まれた Pull request と自分の Pull request、対象リポジトリの Pull request。/)).toBeTruthy();
    await userEvent.clear(screen.getByRole("textbox", { name: "Pull request を探す" }));
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByText("レビューを頼まれた Pull request も、自分の Pull request もありません。")).toBeTruthy();
  });

  it("says how many more GitHub found, and why a repository not watched is there", () => {
    respond({
      list: listed({
        requested: [pr()],
        requestedMore: 5,
        repos: [{ repo: "4rtofl/lib", watched: false, prs: [pr({ repo: "4rtofl/lib", number: 3, url: "https://github.com/4rtofl/lib/pull/3", place: { primary: "/work/lib", worktree: { path: "/work/review-3", review: true } } })] }],
      }),
    });
    render(<ReviewPage params={{}} />);
    expect(screen.getByText("ほかに 5 件あります。検索の語で絞り込んでください。")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^4rtofl\/lib\s*対象リポジトリではありませんが、Pull request の worktree があります$/ })).toBeTruthy();
  });

  it("puts a pull request listed by two working servers in one row, which offers both", async () => {
    set({ machines: [machine({ id: "m1", name: "mac", canLaunch: true }), machine({ id: "m2", name: "linux", canLaunch: true })] });
    const both = listed({ requested: [pr()] });
    sdk.request.mockImplementation(() => both);
    render(<ReviewPage params={{}} />);
    expect(screen.getAllByText("ログインを直す")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: /worktree を作る/ }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("mac に作り、送る指示")).toBeTruthy();
    expect(within(menu).getByText("linux に作り、送る指示")).toBeTruthy();
  });
});
