import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { answerCalls, callsOf, lastRequest, respond, sdk, session } from "../../test/sdk.tsx";
import type { CallResult, WorktreeInfo } from "@gasho/plugin-sdk";
import { NewPullBox } from "../src/web/home/new-pull.tsx";
import type { NewPull } from "../src/types.ts";
import { github, renderWithToasts } from "./render.tsx";

const worktree: WorktreeInfo = { path: "/work/app", branch: "feat/7-x", github, sessions: [session({ sessionId: "s7" })] };

const pushed = (over: Partial<NewPull> = {}): NewPull => ({
  defaultBranch: "main",
  branches: ["main", "release"],
  headOid: "abc1234",
  templates: [],
  compare: { base: "main", ahead: 2, behind: 0, commits: ["一つ目", "二つ目"] },
  ...over,
});
/** What the daemon part answers for each base asked ("" for none); a base without an answer is still being read. */
const newPull = (byBase: Record<string, NewPull | undefined>) =>
  respond({
    read: (p: { base?: string }) => {
      const data = byBase[p.base ?? ""];
      return data && { data };
    },
  });

const show = (over: { title?: string; branch?: string } = {}) => {
  const onCreated = vi.fn();
  const view = renderWithToasts(
    <NewPullBox machine="m1" worktree={worktree} branch={over.branch ?? "feat/7-x"} repo="4rtofl/app" {...(over.title ? { title: over.title } : {})} onCreated={onCreated} />,
  );
  return { ...view, onCreated };
};

describe("NewPullBox", () => {
  it("offers no pull request for the default branch itself", () => {
    newPull({ "": pushed() });
    const { container } = show({ branch: "main" });
    expect(container.textContent).toBe("");
  });

  it("waits for the branch to be pushed, and asks GitHub again on reading again", async () => {
    newPull({ "": pushed({ headOid: undefined, compare: undefined }) });
    show();
    expect(lastRequest("read")?.params).toEqual({ op: "new-pull", repo: "4rtofl/app", branch: "feat/7-x" });
    expect(screen.getByRole("alert").textContent).toContain("を GitHub に push していません");
    expect(screen.getByRole("button", { name: "Pull request を作る" })).toHaveProperty("disabled", true);

    await userEvent.click(screen.getByRole("button", { name: "読み直す" }));
    expect(lastRequest("read")?.params).toMatchObject({ op: "new-pull", fresh: true });
  });

  it("asks through a session of the worktree, which can tell the commits not pushed yet", () => {
    newPull({ "": pushed({ local: { ahead: 3, behind: false } }) });
    show();
    expect(lastRequest("read")?.sessionId).toBe("s7");
    expect(screen.getByRole("alert").textContent).toContain("GitHub に push していない commit が 3 件あります");
  });

  it("fills the title with the issue's, else the only commit's, else the branch, and the body with the first template", async () => {
    newPull({ "": pushed({ templates: [{ filename: "default.md", body: "### 内容" }] }) });
    const first = show({ title: "Issue の題" });
    await userEvent.click(screen.getByRole("button", { name: "Pull request を作る" }));
    expect(screen.getByRole("textbox", { name: "Pull request の題" })).toHaveProperty("value", "Issue の題");
    expect(screen.getByRole("textbox", { name: "Pull request の本文" })).toHaveProperty("value", "### 内容");
    // The form stays while the page is open, until it is closed.
    await userEvent.click(screen.getByRole("button", { name: "やめる" }));
    first.unmount();

    newPull({ "": pushed({ compare: { base: "main", ahead: 1, behind: 0, commits: ["一つだけの commit"] } }) });
    const second = show();
    await userEvent.click(screen.getByRole("button", { name: "Pull request を作る" }));
    expect(screen.getByRole("textbox", { name: "Pull request の題" })).toHaveProperty("value", "一つだけの commit");
    await userEvent.click(screen.getByRole("button", { name: "やめる" }));
    second.unmount();

    newPull({ "": pushed() });
    show();
    await userEvent.click(screen.getByRole("button", { name: "Pull request を作る" }));
    expect(screen.getByRole("textbox", { name: "Pull request の題" })).toHaveProperty("value", "feat/7-x");
  });

  it("creates a draft by default, and a ready one once the box is unchecked", async () => {
    answerCalls({ write: { ok: true, data: { number: 12 } } });
    newPull({ "": pushed() });
    const { onCreated } = show({ title: "題" });
    await userEvent.click(screen.getByRole("button", { name: "Pull request を作る" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Draft にする" }));
    await userEvent.click(screen.getByRole("button", { name: "Pull request を作る" }));
    expect(callsOf("write")).toEqual([{ op: "create-pull", repo: "4rtofl/app", branch: "feat/7-x", base: "main", title: "題", body: "", draft: false }]);
    expect(await screen.findByText("Pull request #12 を作りました")).toBeTruthy();
    expect(onCreated).toHaveBeenCalledOnce();
    expect(screen.queryByRole("textbox", { name: "Pull request の題" })).toBeNull();
  });

  it("keeps the form and says why when GitHub refused it", async () => {
    answerCalls({ write: { ok: false, error: "A pull request already exists" } });
    newPull({ "": pushed() });
    const { onCreated } = show({ title: "題" });
    await userEvent.click(screen.getByRole("button", { name: "Pull request を作る" }));
    await userEvent.click(screen.getByRole("button", { name: "Draft の Pull request を作る" }));
    expect((await screen.findByRole("alert")).textContent).toContain("A pull request already exists");
    expect(screen.getByRole("textbox", { name: "Pull request の題" })).toHaveProperty("value", "題");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("makes no second one when the box is drawn anew (another tab chosen and this one again) while it is being made", async () => {
    let made: (r: CallResult<unknown>) => void = () => {};
    answerCalls({ write: new Promise<CallResult<unknown>>((r) => (made = r)) });
    newPull({ "": pushed() });
    const first = show({ title: "題" });
    await userEvent.click(screen.getByRole("button", { name: "Pull request を作る" }));
    await userEvent.click(screen.getByRole("button", { name: "Draft の Pull request を作る" }));
    first.unmount();

    show({ title: "題" });
    expect(screen.getByRole("button", { name: "作っています…" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("textbox", { name: "Pull request の題" })).toHaveProperty("readOnly", true);
    await act(async () => made({ ok: true, data: { number: 12 } }));
    expect(callsOf("write")).toHaveLength(1);
    expect(screen.queryByRole("textbox", { name: "Pull request の題" })).toBeNull();
  });

  it("creates with ⌘Enter in the body", async () => {
    newPull({ "": pushed() });
    show({ title: "題" });
    await userEvent.click(screen.getByRole("button", { name: "Pull request を作る" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Pull request の本文" }), "本文{Meta>}{Enter}{/Meta}");
    expect(callsOf("write")).toEqual([expect.objectContaining({ op: "create-pull", body: "本文", draft: true })]);
  });

  it("keeps the form while another base is read, and compares with the base chosen", async () => {
    newPull({ "": pushed(), release: undefined });
    show({ title: "題" });
    await userEvent.click(screen.getByRole("button", { name: "Pull request を作る" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "base" }), "release");
    expect(lastRequest("read")?.params).toMatchObject({ base: "release" });
    expect(screen.getByRole("textbox", { name: "Pull request の題" })).toHaveProperty("value", "題");

    act(() => newPull({ "": pushed(), release: pushed({ compare: { base: "release", ahead: 0, behind: 4, commits: [] } }) }));
    expect(screen.getByText(/と同じ内容で、Pull request にする commit がありません。/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Draft の Pull request を作る" })).toHaveProperty("disabled", true);
  });

  it("puts the body of the template chosen", async () => {
    newPull({ "": pushed({ templates: [{ filename: "default.md", body: "既定" }, { filename: "bug.md", body: "不具合" }] }) });
    show({ title: "題" });
    await userEvent.click(screen.getByRole("button", { name: "Pull request を作る" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "テンプレート" }), "bug.md");
    expect(screen.getByRole("textbox", { name: "Pull request の本文" })).toHaveProperty("value", "不具合");
  });
});
