// The cards of the kanban and the menu that opens from them (moved here from Gasho's views/kanban.tsx of PR #8). A card
// shows why its board plugin put it in its column. Pressing a card opens its menu: its Gasho sessions to open, or one to
// start in its worktree and open, and its pull request on GitHub. The pull request opens from the menu only, so a press
// meant for the menu does not leave for GitHub.
import { ExternalLink, FolderGit2, GitBranch, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, Hand, Moon, Plus, Server, Zap, type LucideIcon } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { createContext, useContext, useRef, useState, type ReactElement, type ReactNode } from "react";
import { cn, relativeTime, useLaunchSession, useNavigation, type MachineInfo, type SessionInfo } from "@gasho/plugin-sdk";
import type { KanbanCard, PlacedCard } from "../cards.ts";
import { Skeleton, StatusDot, sessionLabel } from "./ui/parts";
import { MENU, MENU_ITEM } from "./ui/styles";

/** Where the cards come from, on each card only when it is not obvious. */
export interface Where {
  machines: boolean;
  repos: boolean;
}

/** What a card's menu is doing or did, shown at the bottom of the page. */
export interface Notice {
  text: string;
  tone?: "danger";
  /** Still going: the notice stays until it is done. */
  busy?: boolean;
  /** The session it went to, to open from the notice. */
  session?: { machine: string; sessionId: string };
}

/** What the cards ask of the page: to show a notice, and to ask the person whether Claude Code may trust a folder. */
export interface CardActions {
  notify: (n: Notice | undefined) => void;
  askTrust: (q: { path: string; warnings: string[] }) => Promise<boolean>;
}

export const CardActionsContext = createContext<CardActions>({ notify: () => undefined, askTrust: async () => false });

/** The pull request's state, as an icon in GitHub's colors: none yet, open, draft, merged or closed. */
function prLook(card: KanbanCard): { Icon: LucideIcon; className: string; label: string } {
  if (!card.pr) return { Icon: GitBranch, className: "text-neutral-500", label: "PR なし" };
  if (card.pr.state === "merged") return { Icon: GitMerge, className: "text-violet-400", label: "マージ済み" };
  if (card.pr.state === "closed") return { Icon: GitPullRequestClosed, className: "text-red-400", label: "クローズ済み" };
  if (card.pr.draft) return { Icon: GitPullRequestDraft, className: "text-neutral-400", label: "Draft" };
  return { Icon: GitPullRequest, className: "text-emerald-400", label: "開いている PR" };
}

/** The pull request's state as an icon, named when the pointer rests on it. */
function PrIcon({ card, className }: { card: KanbanCard; className?: string }) {
  const look = prLook(card);
  return (
    <span title={look.label} className={cn("inline-flex shrink-0", className)}>
      <look.Icon className={cn("size-3.5", look.className)} aria-label={look.label} />
    </span>
  );
}

/** What a Claude Code session started outside Gasho is doing; Gasho's own show with their names instead. */
const AGENT: Record<"busy" | "waiting" | "idle", { Icon: LucideIcon; text: string }> = {
  busy: { Icon: Zap, text: "Claude Code 作業中" },
  waiting: { Icon: Hand, text: "Claude Code 答え待ち" },
  idle: { Icon: Moon, text: "Claude Code 指示待ち" },
};

/** One line: the pull request's state, the name and the age. Pressing it opens the card's menu. */
export function CompactCard({ row, now, where }: { row: PlacedCard; now: number; where: Where }) {
  const { machine, card } = row;
  const updated = card.updatedAt ? Date.parse(card.updatedAt) : undefined;
  const tip = [where.machines && machine.name, where.repos && card.repo, card.title, card.reason?.text].filter(Boolean).join("\n");
  return (
    <CardMenu row={row}>
      <button
        type="button"
        title={tip}
        className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-black/[0.06] bg-black/[0.015] px-2.5 py-1.5 text-left text-xs text-neutral-800 transition-colors outline-none hover:border-black/[0.12] focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:border-border-hover dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-neutral-200 dark:hover:border-white/[0.12] dark:hover:bg-white/[0.035]"
      >
        <PrIcon card={card} />
        <span className="min-w-0 flex-1 truncate">{card.label}</span>
        {card.sessions.some((s) => s.status === "busy" || s.status === "waiting") && (
          <StatusDot status={card.sessions.some((s) => s.status === "waiting") ? "waiting" : "busy"} />
        )}
        {updated !== undefined && <span className="shrink-0 text-[11px] text-neutral-500 tabular-nums">{relativeTime(updated, now)}</span>}
      </button>
    </CardMenu>
  );
}

/**
 * The full card. Pressing it anywhere but its session buttons opens the card's menu: a button covers the card under
 * its content, and only the session buttons of the content take the pointer.
 */
export function Card({ row, now, where }: { row: PlacedCard; now: number; where: Where }) {
  const { machine, card } = row;
  const nav = useNavigation();
  const updated = card.updatedAt ? Date.parse(card.updatedAt) : undefined;
  const managed = card.sessions.flatMap((s) => {
    const info = s.managed ? machine.sessions.find((x) => x.sessionId === s.sessionId) : undefined;
    return info ? [{ s, info }] : [];
  });
  return (
    <article className="relative flex min-w-0 flex-col rounded-xl border border-black/[0.06] bg-black/[0.015] transition-colors hover:border-black/[0.12] dark:border-white/[0.06] dark:bg-white/[0.02] dark:hover:border-white/[0.12] dark:hover:bg-white/[0.035]">
      <CardMenu row={row}>
        <button
          type="button"
          aria-label={`${card.label} のメニュー`}
          className="absolute inset-0 cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:ring-1 data-[state=open]:ring-border-hover"
        />
      </CardMenu>
      <div className="pointer-events-none relative flex flex-col gap-2 p-3">
        <div className="flex items-baseline gap-2">
          <PrIcon card={card} className="self-center" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100" title={card.path ?? card.branch}>
            {card.label}
          </span>
          {updated !== undefined && (
            <span className="shrink-0 text-[11px] text-neutral-500 tabular-nums" title="PR の最終更新">
              {relativeTime(updated, now)}
            </span>
          )}
        </div>
        {card.pr ? (
          <p className="-mt-1 line-clamp-2 text-xs break-words text-neutral-600 dark:text-neutral-400">{card.title}</p>
        ) : (
          <p className="-mt-1 truncate font-mono text-[11px] text-neutral-500">{card.title}</p>
        )}
        {card.reason && <p className={cn("-mt-1 truncate text-[11px]", reasonTone(card))}>{card.reason.text}</p>}
        <Chips machine={machine} card={card} where={where}>
          {managed.map(({ s, info }) => (
            <button
              key={s.sessionId}
              type="button"
              onClick={() => nav.openSession(machine.id, s.sessionId)}
              className={cn(CHIP, "pointer-events-auto max-w-full cursor-pointer text-neutral-700 hover:bg-black/[0.08] dark:text-neutral-300 dark:hover:bg-white/[0.1]")}
              title="このセッションを開く"
            >
              <StatusDot status={s.status} />
              <span className="truncate">{sessionLabel(info)}</span>
            </button>
          ))}
        </Chips>
      </div>
    </article>
  );
}

/** A reason in the muted color of the card's details; one the board plugin failed to give in amber. */
const reasonTone = (card: KanbanCard): string => (card.reason?.error ? "text-amber-700 dark:text-amber-300" : "text-neutral-500");

const CHIP = "inline-flex h-5 items-center gap-1 rounded-full bg-black/[0.05] px-2 text-[11px] whitespace-nowrap text-neutral-600 dark:bg-white/[0.06] dark:text-neutral-400";

function Chips({ machine, card, where, children }: { machine: MachineInfo; card: KanbanCard; where: Where; children: ReactNode }) {
  const pr = card.pr && card.label !== `PR #${card.pr.number}` ? card.pr : undefined;
  // Sessions Gasho did not start, once per state.
  const others = [...new Set(card.sessions.filter((s) => !s.managed && s.status !== "unknown").map((s) => s.status as keyof typeof AGENT))];
  const any = where.machines || where.repos || pr || card.issue !== undefined || !card.path || others.length > 0 || card.sessions.some((s) => s.managed);
  if (!any) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {where.machines && (
        <span className={CHIP}>
          <Server className="size-3" />
          {machine.name}
        </span>
      )}
      {where.repos && (
        <span className={CHIP}>
          <FolderGit2 className="size-3" />
          {card.repo.split("/").pop()}
        </span>
      )}
      {pr && <span className={CHIP}>PR #{pr.number}</span>}
      {card.issue !== undefined && <span className={CHIP}>Issue #{card.issue}</span>}
      {!card.path && <span className={cn(CHIP, "bg-transparent ring-1 ring-black/[0.1] ring-inset dark:bg-transparent dark:ring-white/[0.1]")}>worktree なし</span>}
      {others.map((status) => {
        const a = AGENT[status];
        return (
          <span key={status} className={CHIP}>
            <a.Icon className={cn("size-3", status === "waiting" && "text-amber-400", status === "busy" && "text-emerald-400")} />
            {a.text}
          </span>
        );
      })}
      {children}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="space-y-2.5 rounded-xl border border-black/[0.06] p-3 dark:border-white/[0.06]">
      <Skeleton className="h-3.5 w-2/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

/** How a session started from Gasho was last used: its latest activity, or for one with no conversation, its start. */
const lastUsed = (s: SessionInfo): number => s.lastActivityAt ?? s.startedAt ?? 0;

/** The sessions Gasho started in a card's worktree, the one used last first. Only these open in Gasho. */
function gashoSessions({ machine, card }: PlacedCard): SessionInfo[] {
  const ids = new Set(card.sessions.filter((s) => s.managed).map((s) => s.sessionId));
  return machine.sessions.filter((s) => ids.has(s.sessionId)).sort((a, b) => lastUsed(b) - lastUsed(a));
}

/**
 * Starts a session in a card's worktree; its id, or undefined (with the reason noticed) when it did not start. When
 * Claude Code asks whether to trust the folder, the person is asked first, as in a terminal.
 */
async function startSession({ machine, card }: PlacedCard, launch: ReturnType<typeof useLaunchSession>, actions: CardActions): Promise<string | undefined> {
  const cwd = card.path;
  if (!cwd) return undefined;
  const starting: Notice = { text: `${card.label} でセッションを起動しています…`, busy: true };
  actions.notify(starting);
  let r = await launch({ machine: machine.id, cwd });
  if (!r.ok && r.needsTrust) {
    actions.notify(undefined);
    if (!(await actions.askTrust({ path: cwd, warnings: r.trustWarnings ?? [] }))) return undefined;
    actions.notify(starting);
    r = await launch({ machine: machine.id, cwd, trust: true });
  }
  if (r.ok) return r.sessionId;
  actions.notify({ text: r.error, tone: "danger" });
  return undefined;
}

/**
 * The menu that opens from a card, from the edge nearest it (after EasyUI's OriginDropdown): its Gasho sessions to
 * open, or one to start there and open; and its pull request on GitHub. Instructions are written in the session itself.
 */
function CardMenu({ row, children }: { row: PlacedCard; children: ReactElement }) {
  const { machine, card } = row;
  const nav = useNavigation();
  const launch = useLaunchSession();
  const actions = useContext(CardActionsContext);
  const [open, setOpen] = useState(false);
  // A touch opens the menu on a tap, not when the finger lands: a swipe over the cards must only scroll the page.
  const touch = useRef(false);
  const sessions = gashoSessions(row);
  const canStart = Boolean(card.path && machine.canLaunch);
  const hint = !card.path
    ? "worktree が無いので、セッションを起動できません。"
    : sessions.length === 0 && !canStart
      ? "この working server では、Gasho からセッションを起動できません。"
      : undefined;
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger
        asChild
        onPointerDown={(e) => {
          touch.current = e.pointerType !== "mouse";
          // Keeps Radix from opening the menu now.
          if (touch.current) e.preventDefault();
        }}
        onClick={() => {
          if (touch.current) setOpen((o) => !o);
          touch.current = false;
        }}
      >
        {children}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className={cn(
            MENU,
            "origin-(--radix-dropdown-menu-content-transform-origin) data-[side=bottom]:slide-in-from-top-1.5 data-[side=left]:slide-in-from-right-1.5 data-[side=right]:slide-in-from-left-1.5 data-[side=top]:slide-in-from-bottom-1.5",
          )}
        >
          <DropdownMenu.Label className="truncate px-2.5 pt-1 pb-1.5 text-xs text-muted-foreground">{card.label}</DropdownMenu.Label>
          {card.reason && (
            <p className={cn("max-w-64 px-2.5 pb-1.5 text-xs break-words", reasonTone(card))}>
              {card.reason.text}
              {card.reason.error && <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">{card.reason.error}</span>}
            </p>
          )}
          {sessions.map((s) => (
            <DropdownMenu.Item key={s.sessionId} onSelect={() => nav.openSession(machine.id, s.sessionId)} className={MENU_ITEM}>
              <span className="flex size-4 items-center justify-center">
                <StatusDot status={s.status} />
              </span>
              <span className="truncate">{sessionLabel(s)} を開く</span>
            </DropdownMenu.Item>
          ))}
          {sessions.length === 0 && card.path && (
            <DropdownMenu.Item
              disabled={!canStart}
              onSelect={() =>
                void startSession(row, launch, actions).then((sessionId) => {
                  if (!sessionId) return;
                  actions.notify({ text: `${card.label} でセッションを起動しました。`, session: { machine: machine.id, sessionId } });
                  nav.openSession(machine.id, sessionId);
                })
              }
              className={MENU_ITEM}
            >
              <Plus />
              セッションを起動して開く
            </DropdownMenu.Item>
          )}
          {card.pr && (
            <DropdownMenu.Item asChild className={MENU_ITEM}>
              <a href={card.pr.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink />
                PR #{card.pr.number} を GitHub で開く
              </a>
            </DropdownMenu.Item>
          )}
          {hint && <p className="max-w-64 px-2.5 pt-1.5 pb-1 text-xs text-muted-foreground">{hint}</p>}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
