// The tabs github-implement adds beside a worktree's sessions: one per issue and pull request of the worktree (the one
// its branch is named after, the pull requests of its branch, the ones added by hand), then "GitHub", which lists them
// and adds more. They are read again every "refreshSeconds" while they show.
import { CircleCheck, CircleDot, CircleSlash, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, ListPlus, type LucideIcon } from "lucide-react";
import { createElement, type ComponentType } from "react";
import { cn, useRequest, useSetting, type RequestOptions, type RequestTarget, type WorktreeContext, type WorktreeInfo, type WorktreeTab } from "@gasho/plugin-sdk";
import { newsCount } from "../news.ts";
import type { ItemSummary, WorktreeItems } from "../types.ts";
import { readOp } from "./daemon.ts";
import { newsText, useNews } from "./news.ts";
import type { BadgeTone } from "./ui/badge.tsx";

/** The call that reads a worktree's items; undefined when there is nothing to read. */
export function itemsTarget(machine: string, worktree: WorktreeInfo, ready: boolean): RequestTarget | undefined {
  const github = worktree.github;
  if (!ready || !github) return undefined;
  return readOp(machine, "items", {
    repo: `${github.owner}/${github.name}`,
    worktree: worktree.path,
    ...(worktree.branch ? { branch: worktree.branch } : {}),
    ...(worktree.repo ? { repoDir: worktree.repo } : {}),
  });
}

/** How often the screen reads again: the setting, or (0) only when shown and when asked. */
export function useRefreshOptions(): RequestOptions {
  const [refresh] = useSetting<number>("refreshSeconds");
  const seconds = typeof refresh === "number" && refresh >= 0 ? refresh : 60;
  return seconds > 0 ? { refreshSeconds: seconds, staleSeconds: seconds } : { staleSeconds: 30 };
}

/** An issue's or pull request's state as GitHub shows it: its icon, the icon in GitHub's color, and the badge. */
export interface ItemLook {
  Icon: LucideIcon;
  /** The icon in its color, whatever color the className gives (the size comes from it). */
  ColoredIcon: ComponentType<{ className?: string }>;
  label: string;
  tone: BadgeTone;
}

type ItemState = Pick<ItemSummary, "kind" | "state" | "draft" | "stateReason">;

// Made once: a tab's icon made while the tabs are drawn would be another component each time, drawn anew.
function look(Icon: LucideIcon, color: string, label: string, tone: BadgeTone): ItemLook {
  // Gasho draws the tabs, where the plugin's CSS (and so the color) applies only inside an element of the plugin's id
  // (Gasho's docs/plugins.md, of what a plugin draws outside its parts).
  const ColoredIcon = ({ className }: { className?: string }) =>
    createElement("span", { "data-gasho-plugin": "github-implement", style: { display: "contents" } }, createElement(Icon, { className: cn(className, color) }));
  return { Icon, ColoredIcon, label, tone };
}

const GREEN = "text-emerald-600 dark:text-emerald-400";
const PURPLE = "text-violet-600 dark:text-violet-400";
const LOOKS = {
  issueOpen: look(CircleDot, GREEN, "Open", "success"),
  issueDone: look(CircleCheck, PURPLE, "Closed", "merged"),
  issueNotPlanned: look(CircleSlash, "text-muted-foreground", "Closed（対応しない）", "neutral"),
  pullOpen: look(GitPullRequest, GREEN, "Open", "success"),
  pullDraft: look(GitPullRequestDraft, "text-muted-foreground", "Draft", "neutral"),
  pullMerged: look(GitMerge, PURPLE, "Merged", "merged"),
  pullClosed: look(GitPullRequestClosed, "text-red-600 dark:text-red-400", "Closed", "danger"),
};

/** How GitHub shows an issue or pull request in its state. An issue closed as a duplicate looks closed as done. */
export function itemLook(i: ItemState): ItemLook {
  if (i.kind === "pulls") {
    if (i.state === "merged") return LOOKS.pullMerged;
    if (i.state === "closed") return LOOKS.pullClosed;
    return i.draft ? LOOKS.pullDraft : LOOKS.pullOpen;
  }
  if (i.state !== "closed") return LOOKS.issueOpen;
  return i.stateReason === "not_planned" ? LOOKS.issueNotPlanned : LOOKS.issueDone;
}

/** The icon of an issue or pull request, by its state. */
export const itemIcon = (i: ItemState): LucideIcon => itemLook(i).Icon;

export const NOT_PLANNED_ICON = CircleSlash;

/** The worktree's items, each once, in the order of the tabs. */
export function itemsInOrder(items: WorktreeItems): ItemSummary[] {
  const seen = new Set<number>();
  return [...(items.named ? [items.named] : []), ...items.pulls, ...items.added].filter((i) => !seen.has(i.number) && Boolean(seen.add(i.number)));
}

export function useItemTabs({ machine, worktree, daemon }: WorktreeContext): WorktreeTab[] {
  const target = itemsTarget(machine.id, worktree, daemon.ready);
  const options = useRefreshOptions();
  const r = useRequest<WorktreeItems>(target, options);
  const github = worktree.github;
  const news = useNews(machine.id, github && `${github.owner}/${github.name}`, daemon.ready ? r.data : undefined, options);
  if (!github || !daemon.ready) return [];
  const tabs: WorktreeTab[] = (r.data ? itemsInOrder(r.data) : []).map((i) => {
    const n = news.get(i.number);
    return {
      label: `#${i.number}`,
      icon: itemLook(i).ColoredIcon,
      title: `${i.kind === "pulls" ? "Pull request" : "Issue"} #${i.number}：${i.title}${n ? `（新着：${newsText(n)}）` : ""}`,
      view: "item",
      params: { kind: i.kind, number: String(i.number) },
      ...(n && { badge: newsCount(n) }),
    };
  });
  tabs.push({ label: "GitHub", icon: ListPlus, title: "この worktree の Issue と Pull request（手で足す）", view: "home" });
  return tabs;
}
