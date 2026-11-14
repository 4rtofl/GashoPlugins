// The tabs github-almighty adds beside a worktree's sessions: one per issue and pull request of the worktree (the one
// its branch is named after, the pull requests of its branch, the ones added by hand), then "GitHub", which lists them
// and adds more. They are read again every "refreshSeconds" while they show.
import { CircleCheck, CircleDot, CircleSlash, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, ListPlus } from "lucide-react";
import { useRequest, useSetting, type RequestOptions, type RequestTarget, type WorktreeContext, type WorktreeInfo, type WorktreeTab } from "@gasho/plugin-sdk";
import type { ItemSummary, WorktreeItems } from "../types.ts";

/** The call that reads a worktree's items; undefined when there is nothing to read. */
export function itemsTarget(machine: string, worktree: WorktreeInfo, ready: boolean): RequestTarget | undefined {
  const github = worktree.github;
  if (!ready || !github) return undefined;
  return {
    machine,
    method: "items",
    params: { repo: `${github.owner}/${github.name}`, worktree: worktree.path, ...(worktree.branch ? { branch: worktree.branch } : {}) },
  };
}

/** How often the screen reads again: the setting, or (0) only when shown and when asked. */
export function useRefreshOptions(): RequestOptions {
  const [refresh] = useSetting<number>("refreshSeconds");
  const seconds = typeof refresh === "number" && refresh >= 0 ? refresh : 60;
  return seconds > 0 ? { refreshSeconds: seconds, staleSeconds: seconds } : { staleSeconds: 30 };
}

/** The icon of an issue or pull request, by its state. */
export function itemIcon(i: Pick<ItemSummary, "kind" | "state" | "draft">) {
  if (i.kind === "pulls") {
    if (i.state === "merged") return GitMerge;
    if (i.state === "closed") return GitPullRequestClosed;
    return i.draft ? GitPullRequestDraft : GitPullRequest;
  }
  return i.state === "closed" ? CircleCheck : CircleDot;
}

export const NOT_PLANNED_ICON = CircleSlash;

/** The worktree's items, each once, in the order of the tabs. */
export function itemsInOrder(items: WorktreeItems): ItemSummary[] {
  const seen = new Set<number>();
  return [...(items.named ? [items.named] : []), ...items.pulls, ...items.added].filter((i) => !seen.has(i.number) && Boolean(seen.add(i.number)));
}

export function useItemTabs({ machine, worktree, daemon }: WorktreeContext): WorktreeTab[] {
  const target = itemsTarget(machine.id, worktree, daemon.ready);
  const r = useRequest<WorktreeItems>(target, useRefreshOptions());
  if (!worktree.github || !daemon.ready) return [];
  const tabs: WorktreeTab[] = (r.data ? itemsInOrder(r.data) : []).map((i) => ({
    label: `#${i.number}`,
    icon: itemIcon(i),
    title: `${i.kind === "pulls" ? "Pull request" : "Issue"} #${i.number}：${i.title}`,
    view: "item",
    params: { kind: i.kind, number: String(i.number) },
  }));
  tabs.push({ label: "GitHub", icon: ListPlus, title: "この worktree の Issue と Pull request（手で足す）", view: "home" });
  return tabs;
}
