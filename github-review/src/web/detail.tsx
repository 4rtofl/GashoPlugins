// The side panel of a pull request (on a phone, its own page): where the Agent's review is, with the button its verdict
// calls for; the review's comment; the checks of its head; its body; and its latest comments. A light cut of
// github-implement's pull request screen, with a link to GitHub for the rest.
import { Check, CircleDashed, Dot, ExternalLink, MinusCircle, RefreshCw, X, type LucideIcon } from "lucide-react";
import { useContext, useState, type ReactNode } from "react";
import { cn, Markdown, RelativeTime, useCall, useDaemonReady, useNow, useRequest, type MachineInfo } from "@gasho/plugin-sdk";
import type { CheckRunState, PrComment, PrDetail } from "../types.ts";
import { askOf, withoutMark } from "../verdict.ts";
import { openedText, progressOf, type Item } from "./actions";
import { AgentAsk, PROGRESS, ProgressBadge, RowContext, stateLook } from "./row";
import { Alert, AlertDescription, Skeleton } from "./ui/parts";

const ICON_BUTTON = "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground [&_svg]:size-4";

const CHECK_LOOKS: Record<CheckRunState, { Icon: LucideIcon; className: string; label: string }> = {
  success: { Icon: Check, className: "text-emerald-600 dark:text-emerald-400", label: "成功" },
  failure: { Icon: X, className: "text-red-600 dark:text-red-400", label: "失敗" },
  pending: { Icon: Dot, className: "text-amber-600 dark:text-amber-400", label: "実行中" },
  neutral: { Icon: CircleDashed, className: "text-muted-foreground", label: "中立" },
  skipped: { Icon: MinusCircle, className: "text-muted-foreground", label: "スキップ" },
};

/**
 * `item`: the pull request as the page lists it, with where it is on every working server (absent when the list does
 * not hold it: then it is where `machine` has it). `machine` reads it.
 */
export function PrDetailView({ repo, number, item, machine, onClose }: { repo: string; number: number; item?: Item; machine: MachineInfo; onClose?: () => void }) {
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
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-2">
        {pr && <StateIcon pr={pr} />}
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            {repo} #{number}
          </p>
          <h2 className="mt-0.5 text-base font-semibold break-words">{pr?.title ?? <Skeleton className="h-5 w-48" />}</h2>
        </div>
        <div className="flex shrink-0 items-center">
          <a href={pr?.url ?? `https://github.com/${repo}/pull/${number}`} target="_blank" rel="noreferrer" className={ICON_BUTTON} title="GitHub で開く" aria-label="GitHub で開く">
            <ExternalLink />
          </a>
          <button type="button" className={ICON_BUTTON} onClick={refresh} disabled={!target || refreshing} title="読み直す" aria-label="読み直す">
            <RefreshCw className={cn((refreshing || r.loading) && "motion-safe:animate-spin")} />
          </button>
          {onClose && (
            <button type="button" className={ICON_BUTTON} onClick={onClose} title="閉じる" aria-label="閉じる">
              <X />
            </button>
          )}
        </div>
      </div>

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
  );
}

function StateIcon({ pr }: { pr: Item["pr"] }) {
  const look = stateLook(pr);
  return (
    <span title={look.label} className="mt-1 inline-flex shrink-0">
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
      <p className="text-xs text-muted-foreground">
        {openedText(pr, now)} · <span className="font-mono">{pr.branch}</span>
        {pr.fork && " · fork から"}
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
