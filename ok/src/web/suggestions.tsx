// The buttons above the chat box: the prompts the daemon part predicted for the session's last reply. Pressing one
// sends it to the session, as the chat box would; so does holding the digit key of its number for the time of the
// setting holdSeconds (hold.ts), while a ring around the number fills. They go away once one is sent, or "×" is pressed, until the next reply.
import { useState, type CSSProperties } from "react";
import { Sparkles, X } from "lucide-react";
import { cn, usePluginState, useRequest, useSendInput, useSetting, type ConversationEndProps } from "@gasho/plugin-sdk";
import type { Prediction } from "../types.ts";
import { holdMsOf, useHoldKeys } from "./hold.ts";

const CHIP =
  "inline-flex max-w-full items-center rounded-full border border-border bg-background px-3 py-1 text-left text-sm " +
  "outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:pointer-events-none disabled:opacity-50";

export function Suggestions({ machine, session }: ConversationEndProps) {
  const at = session.lastActivityAt ?? 0;
  const { data, error, loading, reload } = useRequest<Prediction>(
    { machine: machine.id, sessionId: session.sessionId, method: "predict", params: { at } },
    // A reply's prediction does not change: the daemon part keeps it too.
    { staleSeconds: 24 * 60 * 60 },
  );
  // The reply (its `at`) whose buttons were used or put away: kept while the page is open.
  const [doneAt, setDoneAt] = usePluginState<number | undefined>(`done:${machine.id}:${session.sessionId}`, undefined);
  const send = useSendInput();
  const [holdSeconds] = useSetting<number | undefined>("holdSeconds");
  const holdMs = holdMsOf(holdSeconds);
  const [sending, setSending] = useState<string | undefined>();
  const [failed, setFailed] = useState<string | undefined>();

  const pick = async (text: string) => {
    setSending(text);
    setFailed(undefined);
    const r = await send({ machine: machine.id, sessionId: session.sessionId, text });
    setSending(undefined);
    if (r.ok) setDoneAt(at);
    else setFailed(r.error);
  };

  const hidden = doneAt === at;
  const prompts = hidden ? [] : (data?.prompts ?? []);
  const holding = useHoldKeys(prompts.length, sending === undefined, holdMs, (i) => {
    const p = prompts[i];
    if (p !== undefined) void pick(p);
  });

  if (hidden) return null;

  if (prompts.length === 0) {
    if (loading) {
      return (
        <div className="flex items-center gap-1.5 px-1 py-1 text-xs text-muted-foreground" role="status">
          <Sparkles className="size-3.5 animate-pulse" aria-hidden />
          次の指示を予測しています…
        </div>
      );
    }
    if (error) {
      return (
        <div className="flex items-center gap-2 px-1 py-1 text-xs text-muted-foreground" role="alert">
          <span className="min-w-0 truncate">{error}</span>
          <button type="button" className="shrink-0 underline hover:text-foreground" onClick={reload}>
            もう一度
          </button>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="flex flex-col gap-1 px-1 py-1">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="次の指示の候補">
        <Sparkles className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        {prompts.map((p, i) => (
          <button
            key={p}
            type="button"
            className={cn(CHIP, "gap-1.5 pl-1", sending === p && "animate-pulse")}
            disabled={sending !== undefined}
            title={`「${p}」を送る（${i + 1} のキーを ${holdMs / 1000} 秒押し続けても送る）`}
            aria-keyshortcuts={String(i + 1)}
            onClick={() => void pick(p)}
          >
            <KeyRing n={i + 1} filling={holding === i} ms={holdMs} />
            <span className="truncate">{p}</span>
          </button>
        ))}
        <button
          type="button"
          className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="候補を閉じる"
          title="候補を閉じる"
          onClick={() => setDoneAt(at)}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      {failed && (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {failed}
        </p>
      )}
    </div>
  );
}

/** The size of the ring and its line, in px. */
const SIZE = 20;
const STROKE = 2;
const RADIUS = (SIZE - STROKE) / 2;
const ROUND = 2 * Math.PI * RADIUS;

/** The number of a suggestion's key, in a ring that fills over `ms` while the key is held. */
function KeyRing({ n, filling, ms }: { n: number; filling: boolean; ms: number }) {
  // From empty to full while held; back to empty at once when let go.
  const progress: CSSProperties = {
    strokeDasharray: ROUND,
    strokeDashoffset: filling ? 0 : ROUND,
    transition: filling ? `stroke-dashoffset ${ms}ms linear` : "none",
  };
  return (
    <span className="relative inline-grid size-5 shrink-0 place-items-center text-[11px] font-medium tabular-nums text-muted-foreground" data-holding={filling || undefined}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden className="absolute inset-0 -rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={STROKE} />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeLinecap="round"
          className="text-foreground"
          style={progress}
        />
      </svg>
      <span aria-hidden>{n}</span>
    </span>
  );
}
