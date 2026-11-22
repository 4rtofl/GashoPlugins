// The ring in the line under the chat box (P14): the share of the session's context window in use. Pressing it opens a
// popover with the context window's tokens and the Claude.ai plan's usage limits. The limits are read with get_usage
// (the daemon part) only while the popover is open; until they come, when they cannot be read, and when a reply came
// after them, the popover shows those the status line reported (SessionInfo.limits), which lack the models' weekly limits.
import { useEffect } from "react";
import { cn, Popover, relativeTime, useDaemonReady, useNow, usePluginState, useRequest, type ComposerFooterProps } from "@gasho/plugin-sdk";
import type { UsageLimits } from "../types.ts";
import { clampPercent, latestStatusLineLimits, limitsView, resetLabel, shownPercent, toneOf, tokens, type Tone } from "./limits.ts";

const TONE_TEXT: Record<Exclude<Tone, "normal">, string> = {
  warn: "text-amber-600 dark:text-amber-400",
  danger: "text-red-600 dark:text-red-400",
};
const TONE_BAR: Record<Tone, string> = {
  normal: "bg-foreground/60",
  warn: "bg-amber-500",
  danger: "bg-red-500",
};

/** The size of the ring and its line, in px. */
const SIZE = 16;
const STROKE = 2;
const RADIUS = (SIZE - STROKE) / 2;
const ROUND = 2 * Math.PI * RADIUS;

export function UsageRing({ machine, session }: ComposerFooterProps) {
  const context = session.context;
  if (!context) return null;
  const percent = clampPercent(context.percent);
  const tone = toneOf(percent);
  return (
    <Popover
      side="top"
      align="end"
      label="使用量"
      className="w-80"
      trigger={
        <button
          type="button"
          aria-label={`コンテキスト ${percent}% 使用。使用量の詳細を開く`}
          className={cn(
            "inline-flex items-center gap-1 rounded tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring",
            // Only the plain ring turns to the text's color: hover: comes after text-amber-600 and would win over it.
            tone === "normal" ? "hover:text-foreground data-[state=open]:text-foreground" : TONE_TEXT[tone],
          )}
        >
          <Ring percent={percent} />
          <span aria-hidden>{percent}%</span>
        </button>
      }
    >
      <UsagePanel machine={machine} session={session} />
    </Popover>
  );
}

function Ring({ percent }: { percent: number }) {
  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden className="shrink-0 -rotate-90">
      <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={STROKE} />
      {percent > 0 && (
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={ROUND}
          strokeDashoffset={ROUND * (1 - percent / 100)}
        />
      )}
    </svg>
  );
}

/** A share as a bar, read out as its name and percent. */
function Bar({ label, percent, tone }: { label: string; percent: number; tone: Tone }) {
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10"
    >
      <div className={cn("h-full rounded-full", TONE_BAR[tone])} style={{ width: `${percent}%` }} />
    </div>
  );
}

function Heading({ label, percent }: { label: string; percent?: number }) {
  return (
    <p className="flex items-baseline justify-between gap-3 text-[13px] font-medium">
      <span className="min-w-0 truncate">{label}</span>
      {percent !== undefined && <span className="shrink-0 tabular-nums">{percent}%</span>}
    </p>
  );
}

/** What the popover shows. Drawn only while it is open, so that the limits are read only then. */
function UsagePanel({ machine, session }: ComposerFooterProps) {
  const now = useNow(30_000);
  const daemon = useDaemonReady(machine.id);
  const read = useRequest<UsageLimits>(daemon.ready && machine.connected ? { machine: machine.id, method: "limits" } : undefined, { staleSeconds: 60 });
  // Kept while the page is open, so that what was read stays while the working server is offline.
  const [kept, keep] = usePluginState<UsageLimits | undefined>(`limits:${machine.id}`, undefined);
  useEffect(() => {
    if (read.data && read.data !== kept) keep(read.data);
  }, [read.data, kept, keep]);
  // A read that failed is read again each time the popover opens (this effect runs then only): Gasho before
  // 4rtofl/Gasho#127 would not.
  const { error, loading, reload } = read;
  useEffect(() => {
    if (error && !loading) reload();
  }, []);
  const data = read.data ?? kept;
  const view = limitsView(data, latestStatusLineLimits(machine));
  const problem = machine.connected && !daemon.ready && daemon.reason ? `使用量の上限を読めません（${daemon.reason.replace(/。$/, "")}）。` : read.error;
  const hasUsage = view !== undefined && view.source !== "none" && (view.source === "usage" || view.rows.some((r) => r.at !== undefined));
  const modelsNote = hasUsage || problem ? undefined : data && !data.available ? "この working server の Claude Code のログインでは、モデルごとの週の上限を読めません。" : read.loading ? "モデルごとの週の上限を読んでいます…" : undefined;
  const context = session.context;
  return (
    <div className="flex flex-col gap-3">
      {context && (
        <section className="flex flex-col gap-1.5">
          <Heading label="コンテキスト" percent={clampPercent(context.percent)} />
          <Bar label="コンテキストの使用率" percent={clampPercent(context.percent)} tone={toneOf(context.percent)} />
          <p className="text-xs text-muted-foreground tabular-nums">
            {tokens(context.used)} / {tokens(context.size)} トークン
          </p>
          <p className="text-xs text-muted-foreground">最後の返答の時点（{relativeTime(context.at, now)}）</p>
        </section>
      )}
      <section className="flex flex-col gap-2 border-t border-border pt-3">
        {view === undefined ? (
          !problem && (
            <p className="text-xs text-muted-foreground">
              {read.loading ? "使用量の上限を読んでいます…" : "使用量の上限は、Claude.ai のプランで使っているとき、最初の返答のあとに出ます。"}
            </p>
          )
        ) : view.source === "none" ? (
          <p className="text-xs text-muted-foreground">この working server の Claude Code は Claude.ai のプランで使っていないので、使用量の上限はありません。</p>
        ) : (
          <>
            {view.rows.map((row) => {
              const percent = shownPercent(row.window, now);
              const resetsAt = row.window.resetsAt;
              return (
                <div key={row.key} className={cn("flex flex-col gap-1", percent === undefined && "opacity-60")}>
                  <Heading label={row.label} percent={percent} />
                  {percent !== undefined && <Bar label={row.label} percent={percent} tone={toneOf(percent)} />}
                  {resetsAt !== undefined && <p className="text-xs text-muted-foreground">{resetLabel(resetsAt, now)}</p>}
                  {row.at !== undefined && <p className="text-xs text-muted-foreground">Claude.ai から読んだ値（{relativeTime(row.at, now)}）</p>}
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground">
              {view.source === "usage" ? `Claude.ai から読んだ値（${relativeTime(view.at, now)}）` : `最後の返答の時点（${relativeTime(view.at, now)}）`}
            </p>
            {modelsNote && <p className="text-xs text-muted-foreground">{modelsNote}</p>}
          </>
        )}
        {problem && (
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {problem}
              {view && view.source !== "none" && !hasUsage ? " モデルごとの週の上限は出せません。" : ""}
            </p>
            {read.error && (
              <button
                type="button"
                onClick={() => read.reload()}
                className="h-6 shrink-0 cursor-pointer rounded-md border border-border bg-surface px-2 text-xs font-medium text-foreground outline-none hover:border-border-hover hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                読み直す
              </button>
            )}
          </div>
        )}
        {!machine.connected && <p className="text-xs text-muted-foreground">working server がオフラインです。最後に受け取った値を出しています。</p>}
      </section>
    </div>
  );
}
