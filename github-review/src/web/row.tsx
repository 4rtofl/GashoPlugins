// A pull request's row, with what GitHub's list of pull requests shows (its state, title, labels, checks, number,
// author, when it was opened, its review decision and its comments), where the Agent's review of it is (verdict.ts), the
// worktrees it has on the working servers, and its buttons: "マージしてもらう", "差し戻す" or "修正してもらう" for the
// verdict, "worktree を作る" (with the template to send) when it has none, "開く" (or, in the lower part of the page,
// "新たにセッションを作成する") and "片付ける" when it has one, and "レビューする" (with the template to send) on my own
// open one with a worktree. Pressing the row opens its side panel (a page on a phone).
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
  LoaderCircle,
  MessageSquare,
  ScanSearch,
  Trash2,
  Undo2,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { createContext, useContext, useLayoutEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { cn, relativeTime } from "@gasho/plugin-sdk";
import { askEffort, askInstruction, type MergeMethod } from "../instructions.ts";
import type { Template } from "../template.ts";
import type { CheckState, PrRow, ReviewState } from "../types.ts";
import { askOf, underway, workEndUnseen, workRechecking, type AskKind, type ReviewProgress, type Underway } from "../verdict.ts";
import { askAgent, createWorktree, followCleanup, newSessionIn, reviewIn, reviewingIn, openWorktree, progressOf, removeWorktree, sessionsIn, workingIn, type Item, type Spot, type Tools } from "./actions";
import { markAsked, recheck, useAsked } from "./asked";
import { Badge, Button, type BadgeTone, type ButtonVariant } from "./ui/parts";
import { MENU, MENU_ITEM } from "./ui/styles";

/** What the rows share: the tools of the buttons, the templates, and which rows' buttons are at work. */
export interface RowShared {
  tools: Tools;
  templates: Template[];
  /** Why some of the setting of the templates is left out (template.ts readTemplates). */
  templatesProblem?: string;
  busy: Pick<ReadonlySet<string>, "has">;
  /** Runs a button's work, with the row's buttons off meanwhile. */
  run: (url: string, work: () => Promise<void>) => void;
  /** More than one working server is on the page: the rows name them. */
  machines: boolean;
  /** The settings of "マージしてもらう". */
  merge: { method: MergeMethod; deleteBranch: boolean };
  /** When the oldest of these working servers' lists came (ms, by this browser's clock); undefined when one has none. */
  listedAt: (machines: string[]) => number | undefined;
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
  changes: { text: "要修正", tone: "danger", hint: "今の head をレビューして、マージの前に直すところがあると判定しました" },
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
            {s.cleanup && !s.cleanup.problem ? (
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
      {/* At most the row's width: on a phone its buttons wrap rather than run past the edge. */}
      <div className="ml-auto flex max-w-full min-w-0 items-start justify-end gap-3">
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
    // Those made for the review, and one of any name that a merge asked to clean up.
    const review = placed.filter((s) => s.worktree?.review || s.cleanup);
    // A worktree with no Gasho session opens only where Gasho can start one.
    const canOpen = (s: Spot) => s.machine.canLaunch === true || sessionsIn(s.machine, s.worktree?.path ?? "").length > 0;
    return (
      <div className="flex min-w-0 flex-wrap justify-end gap-1.5">
        <AgentAsk item={item} />
        {fresh ? (
          <SpotButton label="新たにセッションを作成する" icon={<SquarePlus />} spots={placed} disabled={off} usable={(s) => s.machine.canLaunch === true} onPick={(s) => run(pr.url, () => newSessionIn(s, tools))} />
        ) : (
          <SpotButton label="開く" icon={<FolderOpen />} spots={placed} disabled={off} usable={canOpen} onPick={(s) => run(pr.url, () => openWorktree(s, tools))} />
        )}
        <ReviewMenu item={item} />
        {review.length > 0 && <SpotButton label="片付ける" icon={<Trash2 />} spots={review} disabled={off} onPick={(s) => run(pr.url, () => removeWorktree(item, s, tools))} />}
      </div>
    );
  }
  return (
    <TemplateMenu
      label="worktree を作る"
      icon={<FolderGit2 />}
      spots={spots}
      disabled={off || spots.length === 0}
      heading={(s) => (spots.length > 1 ? `${s.machine.name} に作り、送る指示` : "作ってセッションを起動し、送る指示")}
      none
      onPick={(s, t) =>
        run(pr.url, async () => {
          if (await createWorktree(item, s, t, tools)) markReview(item);
        })
      }
    />
  );
}

/** A review of the pull request was sent: the page says so at once, as a session's state comes a little later. */
const markReview = ({ pr }: Item) => markAsked(pr.url, { kind: "review", sha: pr.mark?.sha ?? pr.head ?? "", at: Date.now() });

/** "レビューする" is there for a pull request: my own open one with a worktree, with a template to send. */
const canReview = ({ pr, spots }: Item, shared: RowShared | undefined): boolean => Boolean(shared && pr.own && pr.state === "open" && spots.some((s) => s.worktree) && shared.templates.length > 0);

/**
 * "レビューする" on my own open pull request with a worktree (the one I made it in, so "worktree を作る" is not there):
 * a new session in it gets the template. Not there while a session in the worktree works, as AgentAsk says then.
 */
export function ReviewMenu({ item, reading }: { item: Item; reading?: OwnReading | undefined }) {
  const shared = useContext(RowContext);
  const { shown } = useWork(item, reading);
  const { pr, spots } = item;
  const placed = spots.filter((s) => s.worktree);
  if (!shared || !canReview(item, shared) || shown) return null;
  const { tools, run } = shared;
  return (
    <TemplateMenu
      label="レビューする"
      icon={<ScanSearch />}
      spots={placed}
      disabled={shared.busy.has(pr.url)}
      heading={(s) => (placed.length > 1 ? `${s.machine.name} の worktree で新しいセッションを起動し、送る指示` : "worktree で新しいセッションを起動し、送る指示")}
      onPick={(s, t) =>
        t &&
        run(pr.url, async () => {
          if (await reviewIn(item, s, t, tools)) markReview(item);
        })
      }
    />
  );
}

const cannotLaunch = "この working server では、Gasho からセッションを起動できません。";

const ASK_ICONS: Record<AskKind, ReactNode> = { merge: <GitMerge />, sendBack: <Undo2 />, fix: <Wrench /> };

/** What the row shows in place of its buttons while a session works in the worktree. */
const RUNNING: Record<Underway, { text: string; hint: string }> = {
  merge: { text: "マージしてもらっています", hint: "「マージしてもらう」を頼み、worktree のセッションが作業しています" },
  sendBack: { text: "差し戻してもらっています", hint: "「差し戻す」を頼み、worktree のセッションが作業しています" },
  fix: { text: "修正してもらっています", hint: "「修正してもらう」を頼み、worktree のセッションが作業しています" },
  review: { text: "レビューしてもらっています", hint: "worktree のセッションがレビューしています。終わると、結果に合うボタンが出ます" },
  session: { text: "セッションが作業しています", hint: "worktree のセッションの作業が終わると、ボタンが出ます" },
};
const RECHECK_HINT = "セッションの作業が終わったので、Pull request の状態を GitHub から読み直しています";

/** What the panel read itself of a pull request the lists do not hold, which it shows in their place. */
export interface OwnReading {
  /** By when GitHub was read again since what was asked ended; absent until it was. */
  refreshed?: number | undefined;
  /** When what was read last came. */
  at?: number | undefined;
}

/**
 * What goes on in a pull request's worktree, the same on its row and in its panel: `going` while a session works or
 * what was asked has only just been sent, and `shown`, which goes on until the list (`reading`, for a pull request the
 * lists do not hold) has been read from GitHub again: only that tells how it went, and which button is to come back.
 */
function useWork(item: Item, reading: OwnReading | undefined) {
  const shared = useContext(RowContext);
  const { asked, rechecks } = useAsked();
  const { pr, spots } = item;
  const ask = askOf(pr, progressOf(item));
  const mark = pr.mark;
  const followed = spots.find((s) => s.worktree && s.cleanup && !s.cleanup.problem)?.cleanup;
  const now = Date.now();
  const mine = asked.get(pr.url);
  const going = pr.state === "open" ? underway(ask, mark, { working: workingIn(item), reviewing: reviewingIn(item), asked: mine, followed, now }) : undefined;
  const machines = [...new Set(spots.map((s) => s.machine.id))];
  const kept = rechecks.get(pr.url);
  const rechecking =
    pr.state === "open"
      ? workRechecking(ask, mark, {
          recheck: reading && kept ? { ...kept, refreshed: reading.refreshed } : kept,
          listedAt: reading ? reading.at : shared?.listedAt(machines),
          now,
        })
      : undefined;
  const unseen = workEndUnseen(ask, mark, { going: going !== undefined, asked: mine, recheck: kept });
  return { ask, mark, going, shown: going ?? rechecking, unseen: unseen ? mine?.kind : undefined, machines };
}

/**
 * "マージしてもらう", "差し戻す" or "修正してもらう": sends the Agent in the worktree what the verdict calls for. While a
 * session works in the worktree, or until the list is read again after that, a badge says so in place of the buttons
 * that ask an Agent for something ("レビューする" too): what they send would come on top of that work.
 */
export function AgentAsk({ item, reading }: { item: Item; reading?: OwnReading | undefined }) {
  const shared = useContext(RowContext);
  const { pr, spots } = item;
  const { ask, mark, going, shown, unseen, machines } = useWork(item, reading);
  const placed = spots.filter((s) => s.worktree);
  // When the work ends, or is found to have ended while the page was left, GitHub is read again. Before the screen is
  // painted, so that the button does not show for a moment between that end and the badge that waits for that reading.
  const wasGoing = useRef(going);
  useLayoutEffect(() => {
    const ended = (!going ? wasGoing.current : undefined) ?? unseen;
    wasGoing.current = going;
    if (ended && shared && placed.length > 0) {
      recheck(pr.url, { kind: ended, sha: mark?.sha ?? pr.head ?? "" }, () => Promise.all(machines.map((id) => shared.tools.actions.refresh(id))));
    }
  });
  if (!shared || placed.length === 0) return null;
  const { tools, run } = shared;
  if (shown && (ask || canReview(item, shared))) {
    const r = RUNNING[shown];
    return (
      <Badge tone="neutral" role="status" className="h-8 px-3" title={going ? r.hint : RECHECK_HINT}>
        <LoaderCircle className="size-3.5 shrink-0 text-muted-foreground motion-safe:animate-spin" />
        {r.text}
      </Badge>
    );
  }
  if (!ask || !mark) return null;
  const canOpen = (s: Spot) => s.machine.canLaunch === true || sessionsIn(s.machine, s.worktree?.path ?? "").length > 0;
  const asking = (s: Spot, kind: AskKind) => askAgent(s, ask.label, askInstruction(kind, pr, mark, shared.merge), askEffort(kind), tools);
  const sent = (kind: AskKind) => markAsked(pr.url, { kind, sha: mark.sha, at: Date.now() });
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
          const kind = ask.kind;
          if (kind === "fix") {
            if (await asking(s, kind)) sent(kind);
            return;
          }
          const answer = await tools.actions.askAgentFor({ kind, item, spot: s });
          if (!answer || !(await asking(s, kind))) return;
          sent(kind);
          await followCleanup(item, s, kind, answer.cleanup, tools);
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
  heading,
  none,
  onPick,
}: {
  label: string;
  icon: ReactNode;
  spots: Spot[];
  disabled: boolean;
  heading: (s: Spot) => string;
  none?: boolean;
  onPick: (s: Spot, t: Template | undefined) => void;
}) {
  const shared = useContext(RowContext);
  if (!shared) return null;
  const { templatesProblem } = shared;
  const choices = none ? [undefined, ...shared.templates] : shared.templates;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button size="sm" variant="primary" leftIcon={icon} disabled={disabled}>
          {label}
          <ChevronDown className="ml-0.5 inline size-3.5" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={MENU}>
          {templatesProblem && <p className="max-w-72 px-2.5 pt-1 pb-1.5 text-[11px] text-amber-700 dark:text-amber-300">{templatesProblem}</p>}
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

/** "totosuki が 3 日前に開いた", "totosuki が 昨日開いた": who opened a pull request, and when. */
export function openedText(pr: Pick<PrRow, "author" | "createdAt">, now: number): string {
  const when = pr.createdAt ? relativeTime(Date.parse(pr.createdAt), now) : undefined;
  // relativeTime says "3 日前" and "5 分後", but also "昨日" and "たった今", which take no に.
  const opened = when ? `${when}${/[前後]$/.test(when) ? "に" : ""}開いた` : "開いた";
  return pr.author ? `${pr.author} が ${opened}` : opened;
}
