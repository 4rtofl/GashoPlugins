// A pull request's row, with what GitHub's list of pull requests shows (its state, title, labels, checks, number,
// author, when it was opened, its review decision and its comments), where the Agent's review of it is (verdict.ts), the
// worktrees it has on the working servers, and its buttons: "マージしてもらう", "差し戻す" or "修正してもらう" for the
// verdict, "worktree を作る" (with the template to send) when it has none, "開く" (or, in the lower part of the page,
// "新たにセッションを作成する") and "片付ける" when it has one, and "レビューする" (with the template to send) on my own
// open one with a worktree. A review worktree whose folder is gone does not open: it is made again or removed.
// Pressing the row opens its side panel (a page on a phone).
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
  ScanSearch,
  Trash2,
  Undo2,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { createContext, useContext, type MouseEvent, type ReactNode } from "react";
import { cn, relativeTime } from "@gasho/plugin-sdk";
import { askEffort, askInstruction, type MergeMethod } from "../instructions.ts";
import type { Template } from "../template.ts";
import type { CheckState, PrRow, ReviewState } from "../types.ts";
import { askOf, type AskKind, type ReviewProgress } from "../verdict.ts";
import { askAgent, createWorktree, followCleanup, newSessionIn, reviewIn, openWorktree, progressOf, removeWorktree, sessionsIn, type Item, type Spot, type Tools } from "./actions";
import { Badge, Button, type BadgeTone, type ButtonVariant } from "./ui/parts";
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
  /** The settings of "マージしてもらう". */
  merge: { method: MergeMethod; deleteBranch: boolean };
  /** Opens a pull request's side panel (or its page, on a phone). */
  select?: (item: Item) => void;
  /** The URL of the pull request whose side panel is open. */
  selected?: string;
}

export const RowContext = createContext<RowShared | undefined>(undefined);

const GREEN = "text-emerald-600 dark:text-emerald-400";
const RED = "text-red-600 dark:text-red-400";

/** A pull request's state as GitHub shows it. */
export function stateLook(pr: Pick<PrRow, "state" | "draft">): { Icon: LucideIcon; className: string; label: string } {
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

/** Where the Agent's review is, as the row and the side panel show it. */
export const PROGRESS: Record<ReviewProgress, { text: string; tone: BadgeTone; hint: string }> = {
  reviewing: { text: "レビュー中", tone: "neutral", hint: "worktree のセッションが作業していて、今の head についてのレビュー結果のコメントがまだありません" },
  mergeable: { text: "マージ可能", tone: "success", hint: "今の head をレビューして、マージしてよいと判定しました" },
  changes: { text: "要修正", tone: "danger", hint: "今の head をレビューして、直すところがあると判定しました" },
  stale: { text: "再レビューが要る", tone: "warning", hint: "レビューのあとに push がありました" },
};

export function ProgressBadge({ progress }: { progress: ReviewProgress }) {
  const p = PROGRESS[progress];
  return (
    <Badge tone={p.tone} dot className={cn("h-5 px-2 text-[11px]", progress === "reviewing" && "[&>span:first-child]:motion-safe:animate-pulse")} title={p.hint}>
      {p.text}
    </Badge>
  );
}

const folderName = (p: string): string => p.split("/").filter(Boolean).pop() ?? p;

const CLEANUP_HINT: Record<"merge" | "sendBack", string> = {
  merge: "マージされて、セッションの作業が終わったら、worktree とその中のセッションを片付けます",
  sendBack: "request changes のレビューが付いて、セッションの作業が終わったら、worktree とその中のセッションを片付けます",
};

/** A click on the row itself, not on one of its links, buttons or menus. */
const onRowItself = (e: MouseEvent): boolean => !(e.target as Element).closest("a, button, [role=menu], [role=menuitem], [role=dialog]");

export function PrItemRow({ item, now, showRepo, fresh }: { item: Item; now: number; showRepo?: boolean; fresh?: boolean }) {
  const shared = useContext(RowContext);
  const { pr, spots } = item;
  const look = stateLook(pr);
  const checks = pr.checks && CHECKS[pr.checks];
  const review = pr.review && REVIEWS[pr.review];
  const placed = spots.filter((s) => s.worktree);
  const progress = progressOf(item);
  const ask = askOf(pr, progress);
  const selected = shared?.selected === pr.url;
  return (
    // The buttons go below the title when the row is too narrow for both (a phone).
    <li
      onClick={(e) => onRowItself(e) && shared?.select?.(item)}
      aria-current={selected || undefined}
      className={cn(
        "flex flex-wrap gap-3 px-4 py-3 transition-colors",
        shared?.select && "cursor-pointer",
        selected ? "bg-blue-500/[0.06] dark:bg-blue-400/[0.08]" : "hover:bg-black/[0.02] dark:hover:bg-white/[0.02]",
      )}
    >
      <span title={look.label} className="mt-0.5 inline-flex shrink-0">
        <look.Icon className={cn("size-4", look.className)} aria-label={look.label} />
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {showRepo && <span className="text-sm text-muted-foreground">{pr.repo}</span>}
          {shared?.select ? (
            <button
              type="button"
              onClick={() => shared.select?.(item)}
              className="cursor-pointer text-left text-sm font-semibold break-words text-foreground hover:text-blue-600 hover:underline dark:hover:text-blue-400"
            >
              {pr.title}
            </button>
          ) : (
            <a href={pr.url} target="_blank" rel="noreferrer" className="text-sm font-semibold break-words text-foreground hover:text-blue-600 hover:underline dark:hover:text-blue-400">
              {pr.title}
            </a>
          )}
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
          {progress && <ProgressBadge progress={progress} />}
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
            {s.worktree?.missing && <span className="text-amber-700 dark:text-amber-300">フォルダーがありません</span>}
            {s.worktree?.review && s.cleanup && !s.cleanup.problem ? (
              <Badge tone="neutral" dot className="h-5 px-2 text-[11px]" title={CLEANUP_HINT[s.cleanup.kind]}>
                {s.cleanup.done ? "終わったので片付けます" : "終わったら片付けます"}
              </Badge>
            ) : (
              s.worktree?.review &&
              pr.state !== "open" && (
                <Badge tone="success" dot className="h-5 px-2 text-[11px]">
                  {pr.state === "merged" ? "マージされたので片付けてよい" : "閉じられたので片付けてよい"}
                </Badge>
              )
            )}
          </p>
        ))}
        {placed.map(
          (s) =>
            s.cleanup?.problem && (
              <p key={`${s.machine.id}-cleanup`} className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                {shared?.machines ? `${s.machine.name}：` : ""}
                {s.cleanup.problem}
              </p>
            ),
        )}
        {ask?.blocked && placed.length > 0 && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{ask.blocked}</p>}
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
  const placed = spots.filter((s) => s.worktree && !s.worktree.missing);
  const review = spots.filter((s) => s.worktree?.review);
  const removeButton = review.length > 0 && <SpotButton label="片付ける" icon={<Trash2 />} spots={review} disabled={off} onPick={(s) => run(pr.url, () => removeWorktree(item, s, tools))} />;
  if (placed.length > 0) {
    // A worktree with no Gasho session opens only where Gasho can start one.
    const canOpen = (s: Spot) => s.machine.canLaunch === true || sessionsIn(s.machine, s.worktree?.path ?? "").length > 0;
    return (
      <div className="flex flex-wrap justify-end gap-1.5">
        <AgentAsk item={item} />
        {fresh ? (
          <SpotButton label="新たにセッションを作成する" icon={<SquarePlus />} spots={placed} disabled={off} usable={(s) => s.machine.canLaunch === true} onPick={(s) => run(pr.url, () => newSessionIn(s, tools))} />
        ) : (
          <SpotButton label="開く" icon={<FolderOpen />} spots={placed} disabled={off} usable={canOpen} onPick={(s) => run(pr.url, () => openWorktree(s, tools))} />
        )}
        <ReviewMenu item={item} />
        {removeButton}
      </div>
    );
  }
  return (
    <div className="flex gap-1.5">
      <TemplateMenu
        label="worktree を作る"
        icon={<FolderGit2 />}
        spots={spots}
        disabled={off || spots.length === 0}
        heading={(s) => (spots.length > 1 ? `${s.machine.name} に作り、送る指示` : "作ってセッションを起動し、送る指示")}
        none
        onPick={(s, t) => run(pr.url, () => createWorktree(item, s, t, tools))}
      />
      {removeButton}
    </div>
  );
}

/**
 * "レビューする" on my own open pull request with a worktree (the one I made it in, so "worktree を作る" is not there):
 * a new session in it gets the template. Off while a session there works, as its review would not show apart.
 */
export function ReviewMenu({ item }: { item: Item }) {
  const shared = useContext(RowContext);
  const { pr, spots } = item;
  const placed = spots.filter((s) => s.worktree && !s.worktree.missing);
  if (!shared || !pr.own || pr.state !== "open" || placed.length === 0 || shared.templates.length === 0) return null;
  const { tools, run } = shared;
  const reviewing = progressOf(item) === "reviewing";
  return (
    <TemplateMenu
      label="レビューする"
      icon={<ScanSearch />}
      spots={placed}
      disabled={shared.busy.has(pr.url) || reviewing}
      {...(reviewing ? { title: "worktree のセッションが作業しています" } : {})}
      heading={(s) => (placed.length > 1 ? `${s.machine.name} の worktree で新しいセッションを起動し、送る指示` : "worktree で新しいセッションを起動し、送る指示")}
      onPick={(s, t) => t && run(pr.url, () => reviewIn(item, s, t, tools))}
    />
  );
}

const cannotLaunch = "この working server では、Gasho からセッションを起動できません。";

const ASK_ICONS: Record<AskKind, ReactNode> = { merge: <GitMerge />, sendBack: <Undo2 />, fix: <Wrench /> };

/** "マージしてもらう", "差し戻す" or "修正してもらう": sends the Agent in the worktree what the verdict calls for. */
export function AgentAsk({ item }: { item: Item }) {
  const shared = useContext(RowContext);
  const { pr, spots } = item;
  const ask = askOf(pr, progressOf(item));
  const placed = spots.filter((s) => s.worktree && !s.worktree.missing);
  if (!shared || !ask || !pr.mark || placed.length === 0) return null;
  const { tools, run } = shared;
  const mark = pr.mark;
  const canOpen = (s: Spot) => s.machine.canLaunch === true || sessionsIn(s.machine, s.worktree?.path ?? "").length > 0;
  return (
    <SpotButton
      label={ask.label}
      icon={ASK_ICONS[ask.kind]}
      variant="primary"
      spots={placed}
      disabled={shared.busy.has(pr.url) || Boolean(ask.blocked)}
      title={ask.blocked}
      usable={canOpen}
      onPick={(s) =>
        run(pr.url, async () => {
          if (ask.kind === "fix") {
            await askAgent(s, ask.label, askInstruction(ask.kind, pr, mark, shared.merge), askEffort(ask.kind), tools);
            return;
          }
          const kind = ask.kind;
          const answer = await tools.actions.askAgentFor({ kind, item, spot: s });
          if (!answer) return;
          if (await askAgent(s, ask.label, askInstruction(kind, pr, mark, shared.merge), askEffort(kind), tools)) await followCleanup(item, s, kind, answer.cleanup, tools);
        })
      }
    />
  );
}

/** A button for one working server, or a menu of them when the pull request is on several. */
function SpotButton({
  label,
  icon,
  spots,
  disabled,
  usable = () => true,
  onPick,
  variant,
  title,
}: {
  label: string;
  icon: ReactNode;
  spots: Spot[];
  disabled: boolean;
  usable?: (s: Spot) => boolean;
  onPick: (s: Spot) => void;
  variant?: ButtonVariant;
  title?: string;
}) {
  const only = spots.length === 1 ? spots[0] : undefined;
  if (only) {
    return (
      <Button size="sm" variant={variant} leftIcon={icon} disabled={disabled || !usable(only)} title={title ?? (usable(only) ? undefined : cannotLaunch)} onClick={() => onPick(only)}>
        {label}
      </Button>
    );
  }
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button size="sm" variant={variant} leftIcon={icon} disabled={disabled} title={title}>
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

/** A menu of the templates to send to a session started on each working server (`none`: "何も送らない" first). */
function TemplateMenu({
  label,
  icon,
  spots,
  disabled,
  title,
  heading,
  none,
  onPick,
}: {
  label: string;
  icon: ReactNode;
  spots: Spot[];
  disabled: boolean;
  title?: string;
  heading: (s: Spot) => string;
  none?: boolean;
  onPick: (s: Spot, t: Template | undefined) => void;
}) {
  const shared = useContext(RowContext);
  if (!shared) return null;
  const choices = none ? [undefined, ...shared.templates] : shared.templates;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button size="sm" variant="primary" leftIcon={icon} disabled={disabled} title={title}>
          {label}
          <ChevronDown className="ml-0.5 inline size-3.5" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={MENU}>
          {spots.map((s, i) => (
            <DropdownMenu.Group key={s.machine.id}>
              {i > 0 && <DropdownMenu.Separator className="my-1 h-px bg-border" />}
              <DropdownMenu.Label className="px-2.5 pt-1 pb-1.5 text-[11px] text-muted-foreground">
                {heading(s)}
                {!s.machine.canLaunch && <span className="block text-amber-700 dark:text-amber-300">{cannotLaunch}</span>}
              </DropdownMenu.Label>
              {choices.map((t, j) => (
                <DropdownMenu.Item key={j} disabled={!s.machine.canLaunch} onSelect={() => onPick(s, t)} className={cn(MENU_ITEM, !t && "text-muted-foreground")} title={t?.body}>
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

/** "totosuki が 3日前に開いた": who opened a pull request, and when. */
export function openedText(pr: Pick<PrRow, "author" | "createdAt">, now: number): string {
  const when = pr.createdAt ? relativeTime(Date.parse(pr.createdAt), now) : undefined;
  return [pr.author ? `${pr.author} が` : undefined, when ? `${when}に開いた` : "開いた"].filter(Boolean).join(" ");
}
