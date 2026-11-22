// Drawing the parts of github-implement's screens in the tests: an item's tab or section as the item's screen gives
// it (item/view.tsx), its changes run by the same useChanges, and the toasts they show.
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { Params, RequestState, WorktreeInfo } from "@gasho/plugin-sdk";
import { callsOf, machine, NOW, respond } from "../../test/sdk.tsx";
import { ItemProvider, useChanges } from "../src/web/item/context.tsx";
import { ToastProvider } from "../src/web/ui/toast.tsx";
import type { GitHubItemDetail } from "../src/types.ts";

export const REPO = "4rtofl/app";
export const github = { owner: "4rtofl", name: "app", url: `https://github.com/${REPO}` };

/** An open issue of REPO (`kind: "pulls"` for a pull request), with nothing on it. */
export const detail = (over: Partial<GitHubItemDetail> = {}): GitHubItemDetail => {
  const kind = over.kind ?? "issues";
  const number = over.number ?? 12;
  return {
    kind,
    number,
    title: "テストを足す",
    url: `https://github.com/${REPO}/${kind === "pulls" ? "pull" : "issues"}/${number}`,
    createdAt: "2026-11-18T10:00:00Z",
    updatedAt: "2026-11-18T11:00:00Z",
    labels: [],
    state: "open",
    assignees: [],
    body: "",
    ...over,
  };
};

function Scope({ item, worktree, params, children }: { item: GitHubItemDetail; worktree: WorktreeInfo; params: Params; children: ReactNode }) {
  const where = { repo: REPO, kind: item.kind, number: item.number };
  const { busy, run, revision, changed } = useChanges("m1", where, () => {});
  return <ItemProvider value={{ machine: "m1", machineInfo: machine(), worktree, params, where, item, now: NOW, busy, run, revision, reload: changed }}>{children}</ItemProvider>;
}

/** Draws `part` with the toasts it may show. */
export const renderWithToasts = (part: ReactNode) => render(<ToastProvider>{part}</ToastProvider>);

/** `part` (a tab's or a section's View) in the screen of `item`, in a worktree of REPO, opened from the item's worktree tab and `extra` params of its URL. */
export const itemScreen = (item: GitHubItemDetail, part: ReactNode, extra: Params = {}, worktree: WorktreeInfo = { path: "/work/app", github, sessions: [] }) => (
  <ToastProvider>
    <Scope item={item} worktree={worktree} params={{ kind: item.kind, number: String(item.number), ...extra }}>
      {part}
    </Scope>
  </ToastProvider>
);

/** Draws itemScreen. */
export const renderItem = (item: GitHubItemDetail, part: ReactNode, worktree?: WorktreeInfo) => render(itemScreen(item, part, {}, worktree));

/** Every read of the daemon part goes to the method "read", with the operation in its params: what each op gives. */
export const reads = (byOp: Record<string, Partial<RequestState<unknown>> | undefined>) => respond({ read: (p: { op: string }) => byOp[p.op] });

/** The params of the calls of the method "write", which every change goes to. */
export const writes = () => callsOf("write");

/** Pasted rather than typed: a key at a time draws the part again for each, which is slow on a busy machine. */
export const fill = async (input: HTMLElement, text: string) => {
  await userEvent.clear(input);
  await userEvent.paste(text);
};
