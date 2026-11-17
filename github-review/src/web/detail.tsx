// The panel of a pull request beside the review page (P19: as a session's panel, beside the page on a computer and in
// its place on a phone): where the Agent's review is, with the button its verdict calls for; the review's comment; the
// checks of its head; its body; and its latest comments. A light cut of github-implement's pull request screen, with
// a link to GitHub for the rest.
import { Check, CircleDashed, Dot, ExternalLink, MinusCircle, RefreshCw, X, type LucideIcon } from "lucide-react";
import { useContext, useEffect, useState, type ReactNode } from "react";
import {
  cn,
  Markdown,
  Panel,
  PANEL_BUTTON,
  RelativeTime,
  useCall,
  useDaemonReady,
  useNow,
  usePluginState,
  useRequest,
  type MachineInfo,
  type PagePanelProps,
} from "@gasho/plugin-sdk";
import type { CheckRunState, PrComment, PrDetail } from "../types.ts";
import { askOf, withoutMark } from "../verdict.ts";
import { progressOf, type Item } from "./actions";
import { DEFAULT_QUERY, useListings } from "./listing";
import { AgentAsk, openedText, PROGRESS, ProgressBadge, RowContext, stateLook } from "./row";
import { useRowShell } from "./shell";
import { Alert, AlertDescription, Skeleton } from "./ui/parts";

const CHECK_LOOKS: Record<CheckRunState, { Icon: LucideIcon; className: string; label: string }> = {
  success: { Icon: Check, className: "text-emerald-600 dark:text-emerald-400", label: "成功" },
  failure: { Icon: X, className: "text-red-600 dark:text-red-400", label: "失敗" },
  pending: { Icon: Dot, className: "text-amber-600 dark:text-amber-400", label: "実行中" },
  neutral: { Icon: CircleDashed, className: "text-muted-foreground", label: "中立" },
  skipped: { Icon: MinusCircle, className: "text-muted-foreground", label: "スキップ" },
};

/** The key of a pull request whose panel is open, as the list marks its row (usePluginState "openPr"). */
export const prKey = (repo: string, number: number): string => `${repo.toLowerCase()}#${number}`;

/** The panel "pr" of the review page: { repo, number }. */
export function PrPanel({ params }: PagePanelProps) {
  const repo = /^[^/\s]+\/[^/\s]+$/.test(params.repo ?? "") ? (params.repo as string) : undefined;
  const number = Number(params.number);
  const valid = repo !== undefined && Number.isInteger(number) && number >= 1 && number <= 1e9;
  // The list the review page asks for (the same search words), for where the pull request is on every working server.
  const [query] = usePluginState("query", DEFAULT_QUERY);
  const { sourcesEl, sources, ready, page } = useListings(query, 0);
  const { shared, overlays } = useRowShell({ sources, ready });
  const item = valid ? [...page.requested, ...page.groups.flatMap((g) => g.items)].find((i) => prKey(i.pr.repo, i.pr.number) === prKey(repo, number)) : undefined;
  const machine = item?.spots[0]?.machine ?? ready[0];
  // The list marks the row of the pull request open here, while it is open.
  const [, setOpen] = usePluginState<string | null>("openPr", null);
  const key = valid ? prKey(repo, number) : null;
  useEffect(() => {
    setOpen(key);
    return () => setOpen((cur) => (cur === key ? null : cur));
  }, [key]);

  return (
    <RowContext.Provider value={shared}>
      {sourcesEl}
      {valid && machine ? (
        <PrPanelOf repo={repo} number={number} {...(item ? { item } : {})} machine={machine} />
      ) : (
        <Panel title="Pull request">
          {valid ? (
            <Alert>github-review の daemon の部分が動く working server がつながると、Pull request を読みます。</Alert>
          ) : (
            <Alert tone="danger">Pull request の指定が正しくありません。</Alert>
          )}
        </Panel>
      )}
      {overlays}
    </RowContext.Provider>
  );
}

/**
 * `item`: the pull request as the page lists it, with where it is on every working server (absent when the list does
 * not hold it: then it is where `machine` has it). `machine` reads it.
 */
function PrPanelOf({ repo, number, item, machine }: { repo: string; number: number; item?: Item; machine: MachineInfo }) {
  const daemon = useDaemonReady(machine.id);
  const target = daemon.ready ? { machine: machine.id, method: "detail", params: { repo, number } } : undefined;
  const r = useRequest<PrDetail>(target, { staleSeconds: 60, refreshSeconds: 60 });
  const call = useCall();
  const [refreshing, setRefreshing] = useState(false);
  const clock = useNow(60_000);
  const now = Math.max(clock, r.at ?? 0);
  const d = r.data;
  const shown: Item | undefined =
    item ?? (d ? { pr: (({ place: _, ...pr }) => pr)(d.pr), spots: d.pr.place ? [{ machine, primary: d.pr.place.primary, ...(d.pr.place.worktree ? { worktree: d.pr.place.worktree } : {}) }] : [] } : undefined);
  const pr = shown?.pr;
  const refresh = () => {
    if (!target) return;
    setRefreshing(true);
    // Reads GitHub again; the detail asked for next gets what gasho-daemon kept of that.
    void call({ ...target, params: { repo, number, fresh: true } }).finally(() => {
      setRefreshing(false);
      r.reload();
    });
  };

  return (
    <Panel
      title={pr?.title ?? `#${number}`}
      subtitle={`${repo} #${number}`}
      actions={
        <>
          <button type="button" className={PANEL_BUTTON} onClick={refresh} disabled={!target || refreshing} title="読み直す" aria-label="読み直す">
            <RefreshCw className={cn("size-3.5", (refreshing || r.loading) && "motion-safe:animate-spin")} />
          </button>
          <a href={pr?.url ?? `https://github.com/${repo}/pull/${number}`} target="_blank" rel="noreferrer" className={PANEL_BUTTON}>
            GitHub <ExternalLink className="size-3.5" />
          </a>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {!daemon.ready && <Alert tone="warning">{daemon.reason ?? `${machine.name} で github-review の daemon の部分が動いていません。`}</Alert>}
        {r.error && (
          <Alert tone="danger">
            <AlertDescription>{r.error}</AlertDescription>
          </Alert>
        )}
        {shown && <Progress item={shown} now={now} />}
        {!d && r.loading && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}
        {d && <Body detail={d} markUrl={shown?.pr.mark?.url} now={now} />}
      </div>
    </Panel>
  );
}

function StateIcon({ pr }: { pr: Item["pr"] }) {
  const look = stateLook(pr);
  return (
    <span title={look.label} className="inline-flex shrink-0">
      <look.Icon className={cn("size-4", look.className)} aria-label={look.label} />
    </span>
  );
}

/** Where the review is, and the button its verdict calls for. */
function Progress({ item, now }: { item: Item; now: number }) {
  const shared = useContext(RowContext);
  const { pr } = item;
  const progress = progressOf(item);
  const ask = askOf(pr, progress);
  const placed = item.spots.some((s) => s.worktree);
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <StateIcon pr={pr} />
        <span>
          {stateLook(pr).label} · {openedText(pr, now)} · <span className="font-mono">{pr.branch}</span>
          {pr.fork && " · fork から"}
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {progress ? <ProgressBadge progress={progress} /> : <span className="text-xs text-muted-foreground">{pr.state === "open" ? "Agent のレビュー結果はまだありません" : "閉じられています"}</span>}
        {progress && <span className="text-xs text-muted-foreground">{PROGRESS[progress].hint}</span>}
      </div>
      {ask && placed && shared && (
        <div className="flex flex-wrap items-center gap-2">
          <AgentAsk item={item} />
          {ask.blocked && <span className="text-xs text-amber-700 dark:text-amber-300">{ask.blocked}</span>}
        </div>
      )}
      {ask && !placed && <p className="text-xs text-muted-foreground">この Pull request の worktree が無いので、Agent に頼めません。</p>}
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-baseline gap-2 text-sm font-semibold">
        {title}
        {aside && <span className="text-xs font-normal text-muted-foreground">{aside}</span>}
      </h3>
      {children}
    </section>
  );
}

function Body({ detail, markUrl, now }: { detail: PrDetail; markUrl?: string; now: number }) {
  const { pr } = detail;
  const review = markUrl ? detail.comments.find((c) => c.url === markUrl) : undefined;
  const others = detail.comments.filter((c) => c !== review);
  const failed = detail.checks.filter((c) => c.state === "failure").length;
  return (
    <>
      <Section title="レビューの結果">
        {review ? (
          <CommentCard comment={review} now={now} text={withoutMark(review.body)} />
        ) : markUrl ? (
          <a href={markUrl} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
            GitHub でレビュー結果のコメントを見る
          </a>
        ) : (
          <p className="text-sm text-muted-foreground">Agent のレビュー結果のコメントはまだありません。</p>
        )}
      </Section>

      <Section title="チェック" aside={detail.checks.length > 0 ? `${detail.checks.length} 件${failed ? `・失敗 ${failed} 件` : ""}` : undefined}>
        {detail.checks.length === 0 ? (
          <p className="text-sm text-muted-foreground">チェックはありません。</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {detail.checks.map((c, i) => {
              const look = CHECK_LOOKS[c.state];
              return (
                <li key={`${c.name}-${i}`} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <look.Icon className={cn("size-4 shrink-0", look.className)} aria-label={look.label} />
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:underline" title={c.description ?? c.name}>
                      {c.name}
                    </a>
                  ) : (
                    <span className="min-w-0 truncate" title={c.description ?? c.name}>
                      {c.name}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{look.label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="本文">
        <div className="rounded-xl border border-border bg-surface px-3 py-2.5">
          {detail.body.trim() ? <Markdown text={detail.body} /> : <p className="text-sm text-muted-foreground">説明はありません。</p>}
        </div>
      </Section>

      <Section title="コメント" aside={`${others.length + detail.commentsMore} 件`}>
        {others.length === 0 ? (
          <p className="text-sm text-muted-foreground">ほかのコメントはありません。</p>
        ) : (
          <div className="space-y-2">
            {detail.commentsMore > 0 && (
              <a href={pr.url} target="_blank" rel="noreferrer" className="block text-xs text-blue-600 hover:underline dark:text-blue-400">
                それより前の {detail.commentsMore} 件は GitHub で見る
              </a>
            )}
            {others.map((c) => (
              <CommentCard key={c.url} comment={c} now={now} text={withoutMark(c.body)} />
            ))}
          </div>
        )}
      </Section>

      <a href={pr.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 self-start text-xs text-blue-600 hover:underline dark:text-blue-400">
        変更されたファイル・commit・レビューのコメントは GitHub で見る <ExternalLink className="size-3.5" />
      </a>
    </>
  );
}

function CommentCard({ comment, text, now }: { comment: PrComment; text: string; now: number }) {
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface">
      <header className="flex items-center gap-2 border-b border-border bg-surface-raised/50 px-3 py-1.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground/90">{comment.author ?? "不明"}</span>
        {comment.at && <RelativeTime at={comment.at} now={now} />}
        <a href={comment.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex hover:text-foreground" title="GitHub で開く" aria-label="GitHub で開く">
          <ExternalLink className="size-3.5" />
        </a>
      </header>
      <div className="px-3 py-2.5">{text.trim() ? <Markdown text={text} /> : <p className="text-sm text-muted-foreground">本文はありません。</p>}</div>
    </article>
  );
}
