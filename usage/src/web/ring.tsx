// The ring in the line under the chat box (P14): the share of the session's context window in use. Pressing it opens a
// popover with the context window's tokens and the Claude.ai plan's usage limits. The limits are read with get_usage
// (the daemon part) only while the popover is open; until they come, and when they cannot be read, the popover shows
// those the status line reported (SessionInfo.limits), which lack the models' weekly limits.
import { cn, Popover, relativeTime, useDaemonReady, useNow, useRequest, type ComposerFooterProps } from "@gasho/plugin-sdk";
import type { UsageLimits } from "../types.ts";
import { clampPercent, latestStatusLineLimits, limitsView, resetLabel, toneOf, tokens, type Tone } from "./limits.ts";

const TONE_TEXT: Record<Tone, string> = {
  normal: "",
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
            "inline-flex items-center gap-1 rounded tabular-nums outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:text-foreground",
            TONE_TEXT[tone],
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
  const ready = useDaemonReady(machine.id).ready;
  const read = useRequest<UsageLimits>(ready && machine.connected ? { machine: machine.id, method: "limits" } : undefined, { staleSeconds: 60 });
  const view = limitsView(read.data, latestStatusLineLimits(machine));
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
          <p className="text-xs text-muted-foreground">
            {read.loading ? "使用量の上限を読んでいます…" : "使用量の上限は、Claude.ai のプランで使っているとき、最初の返答のあとに出ます。"}
          </p>
        ) : view.source === "none" ? (
          <p className="text-xs text-muted-foreground">この working server の Claude Code は Claude.ai のプランで使っていないので、使用量の上限はありません。</p>
        ) : (
          <>
            {view.rows.map((row) => {
              const percent = clampPercent(row.window.percent);
              const done = row.window.resetsAt <= now;
              return (
                <div key={row.key} className={cn("flex flex-col gap-1", done && "opacity-60")}>
                  <Heading label={row.label} percent={done ? undefined : percent} />
                  {!done && <Bar label={row.label} percent={percent} tone={toneOf(percent)} />}
                  <p className="text-xs text-muted-foreground">{resetLabel(row.window.resetsAt, now)}</p>
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground">
              {view.source === "usage" ? `Claude.ai から読んだ値（${relativeTime(view.at, now)}）` : `最後の返答の時点（${relativeTime(view.at, now)}）`}
            </p>
            {view.source === "statusline" && read.error && <p className="text-xs text-amber-600 dark:text-amber-400">{read.error} モデルごとの週の上限は出せません。</p>}
          </>
        )}
        {!machine.connected && <p className="text-xs text-muted-foreground">working server がオフラインです。最後に受け取った値を出しています。</p>}
      </section>
    </div>
  );
}
