// A pull request's row, with what GitHub's list of pull requests shows (its state, title, labels, checks, number,
// author, when it was opened, its review decision and its comments), the worktrees it has on the working servers, and
// its buttons: "worktree を作る" (with the template to send) when it has none, "開く" (or, in the lower part of the page,
// "新たにセッションを作成する") and "片付ける" when it has one.
import {
  Check,
  ChevronDown,
  Dot,
  FolderGit2,
  FolderOpen,
  SquarePlus,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageSquare,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { createContext, useContext, type ReactNode } from "react";
import { cn } from "@gasho/plugin-sdk";
import type { Template } from "../template.ts";
import type { CheckState, PrRow, ReviewState } from "../types.ts";
import { createWorktree, newSessionIn, openedText, openWorktree, removeWorktree, sessionsIn, type Item, type Spot, type Tools } from "./actions";
import { Badge, Button } from "./ui/parts";
import { MENU, MENU_ITEM } from "./ui/styles";

/** What the rows share: the tools of the buttons, the templates, and which rows' buttons are at work. */
export interface RowShared {
  tools: Tools;
  templates: Template[];
  busy: ReadonlySet<string>;
  /** Runs a button's work, with the row's buttons off meanwhile. */
  run: (url: string, work: () => Promise<void>) => void;
  /** More than one working server is on the page: the rows name them. */
  machines: boolean;
}

export const RowContext = createContext<RowShared | undefined>(undefined);

const GREEN = "text-emerald-600 dark:text-emerald-400";
const RED = "text-red-600 dark:text-red-400";

/** A pull request's state as GitHub shows it. */
function stateLook(pr: Pick<PrRow, "state" | "draft">): { Icon: LucideIcon; className: string; label: string } {
  if (pr.state === "merged") return { Icon: GitMerge, className: "text-violet-600 dark:text-violet-400", label: "Merged" };
  if (pr.state === "closed") return { Icon: GitPullRequestClosed, className: RED, label: "Closed" };
  if (pr.draft) return { Icon: GitPullRequestDraft, className: "text-muted-foreground", label: "Draft" };
  return { Icon: GitPullRequest, className: GREEN, label: "Open" };
}

const CHECKS: Record<CheckState, { Icon: LucideIcon; className: string; label: string }> = {
  success: { Icon: Check, className: GREEN, label: "チェックはすべて成功" },
  failure: { Icon: X, className: RED, label: "失敗したチェックがある" },
  pending: { Icon: Dot, className: "text-amber-600 dark:text-amber-400", label: "チェックを実行中" },
};

const REVIEWS: Record<ReviewState, { text: string; className?: string }> = {
  approved: { text: "承認済み", className: GREEN },
  changes_requested: { text: "変更を求められている", className: RED },
  review_required: { text: "レビューが必要" },
};

const folderName = (p: string): string => p.split("/").filter(Boolean).pop() ?? p;

export function PrItemRow({ item, now, showRepo, fresh }: { item: Item; now: number; showRepo?: boolean; fresh?: boolean }) {
  const shared = useContext(RowContext);
  const { pr, spots } = item;
  const look = stateLook(pr);
  const checks = pr.checks && CHECKS[pr.checks];
  const review = pr.review && REVIEWS[pr.review];
  const placed = spots.filter((s) => s.worktree);
  return (
    // The buttons go below the title when the row is too narrow for both (a phone).
    <li className="flex flex-wrap gap-3 px-4 py-3 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
      <span title={look.label} className="mt-0.5 inline-flex shrink-0">
        <look.Icon className={cn("size-4", look.className)} aria-label={look.label} />
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {showRepo && <span className="text-sm text-muted-foreground">{pr.repo}</span>}
          <a href={pr.url} target="_blank" rel="noreferrer" className="text-sm font-semibold break-words text-foreground hover:text-blue-600 hover:underline dark:hover:text-blue-400">
            {pr.title}
          </a>
          {pr.labels.map((l) => (
            <span key={l.name} className="inline-flex h-5 items-center gap-1 rounded-full border border-border px-2 text-[11px] font-medium text-foreground">
              <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: l.color ? `#${l.color}` : "var(--color-muted-foreground)" }} />
              {l.name}
            </span>
          ))}
          {checks && (
            <span title={checks.label} className="inline-flex">
              <checks.Icon className={cn("size-4", checks.className)} aria-label={checks.label} />
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          #{pr.number} · {openedText(pr, now)}
          {pr.draft && " · Draft"}
          {review && (
            <>
              {" · "}
              <span className={review.className}>{review.text}</span>
            </>
          )}
          {pr.fork && " · fork から"}
        </p>
        {placed.map((s) => (
          <p key={s.machine.id} className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            <FolderGit2 className="size-3.5 shrink-0" />
            <span title={s.worktree?.path} className="font-mono text-foreground">
              {folderName(s.worktree?.path ?? "")}
            </span>
            {shared?.machines && <span>（{s.machine.name}）</span>}
            <span className="font-mono">{s.worktree?.branch ?? "detached HEAD"}</span>
            {s.worktree?.review && pr.state !== "open" && (
              <Badge tone="success" dot className="h-5 px-2 text-[11px]">
                {pr.state === "merged" ? "マージされたので片付けてよい" : "閉じられたので片付けてよい"}
              </Badge>
            )}
          </p>
        ))}
      </div>
      <div className="ml-auto flex shrink-0 items-start gap-3">
        {pr.comments > 0 && (
          <span title={`コメント ${pr.comments} 件`} className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
            <MessageSquare className="size-3.5" />
            {pr.comments}
          </span>
        )}
        <RowActions item={item} fresh={fresh} />
      </div>
    </li>
  );
}

function RowActions({ item, fresh }: { item: Item; fresh?: boolean }) {
  const shared = useContext(RowContext);
  if (!shared) return null;
  const { tools, run } = shared;
  const { pr, spots } = item;
  const off = shared.busy.has(pr.url);
  const placed = spots.filter((s) => s.worktree);
  if (placed.length > 0) {
    const review = placed.filter((s) => s.worktree?.review);
    // A worktree with no Gasho session opens only where Gasho can start one.
    const canOpen = (s: Spot) => s.machine.canLaunch === true || sessionsIn(s.machine, s.worktree?.path ?? "").length > 0;
    return (
      <div className="flex gap-1.5">
        {fresh ? (
          <SpotButton label="新たにセッションを作成する" icon={<SquarePlus />} spots={placed} disabled={off} usable={(s) => s.machine.canLaunch === true} onPick={(s) => run(pr.url, () => newSessionIn(s, tools))} />
        ) : (
          <SpotButton label="開く" icon={<FolderOpen />} spots={placed} disabled={off} usable={canOpen} onPick={(s) => run(pr.url, () => openWorktree(s, tools))} />
        )}
        {review.length > 0 && <SpotButton label="片付ける" icon={<Trash2 />} spots={review} disabled={off} onPick={(s) => run(pr.url, () => removeWorktree(item, s, tools))} />}
      </div>
    );
  }
  return <CreateMenu item={item} disabled={off || spots.length === 0} />;
}

const cannotLaunch = "この working server では、Gasho からセッションを起動できません。";

/** A button for one working server, or a menu of them when the pull request is on several. */
function SpotButton({
  label,
  icon,
  spots,
  disabled,
  usable = () => true,
  onPick,
}: {
  label: string;
  icon: ReactNode;
  spots: Spot[];
  disabled: boolean;
  usable?: (s: Spot) => boolean;
  onPick: (s: Spot) => void;
}) {
  const only = spots.length === 1 ? spots[0] : undefined;
  if (only) {
    return (
      <Button size="sm" leftIcon={icon} disabled={disabled || !usable(only)} title={usable(only) ? undefined : cannotLaunch} onClick={() => onPick(only)}>
        {label}
      </Button>
    );
  }
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button size="sm" leftIcon={icon} disabled={disabled}>
          {label}
          <ChevronDown className="ml-0.5 inline size-3.5" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={MENU}>
          {spots.map((s) => (
            <DropdownMenu.Item key={s.machine.id} disabled={!usable(s)} onSelect={() => onPick(s)} className={MENU_ITEM}>
              {s.machine.name}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** "worktree を作る": the template to send to the session started there, on each working server with a clone. */
function CreateMenu({ item, disabled }: { item: Item; disabled: boolean }) {
  const shared = useContext(RowContext);
  if (!shared) return null;
  const { tools, templates, run } = shared;
  const { pr, spots } = item;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button size="sm" variant="primary" leftIcon={<FolderGit2 />} disabled={disabled}>
          worktree を作る
          <ChevronDown className="ml-0.5 inline size-3.5" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={MENU}>
          {spots.map((s, i) => (
            <DropdownMenu.Group key={s.machine.id}>
              {i > 0 && <DropdownMenu.Separator className="my-1 h-px bg-border" />}
              <DropdownMenu.Label className="px-2.5 pt-1 pb-1.5 text-[11px] text-muted-foreground">
                {spots.length > 1 ? `${s.machine.name} に作り、送る指示` : "作ってセッションを起動し、送る指示"}
                {!s.machine.canLaunch && <span className="block text-amber-700 dark:text-amber-300">{cannotLaunch}</span>}
              </DropdownMenu.Label>
              {[undefined, ...templates].map((t, j) => (
                <DropdownMenu.Item
                  key={j}
                  disabled={!s.machine.canLaunch}
                  onSelect={() => run(pr.url, () => createWorktree(item, s, t, tools))}
                  className={cn(MENU_ITEM, !t && "text-muted-foreground")}
                  title={t?.body}
                >
                  {t ? t.name : "何も送らない"}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Group>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
