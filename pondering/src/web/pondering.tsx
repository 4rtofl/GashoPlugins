// The line at the end of a session's conversation while Claude works, as Claude Code's spinner: a twinkling star, a
// word for thinking, the time the work has taken and the tokens written, and below them the tool running now.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNow, usePluginState, useSessionActivity, type ConversationEndProps, type SessionActivity } from "@gasho/plugin-sdk";
import { elapsed, tokenCount, toolLabel } from "./format";
import { pickPhrase } from "./phrases";
import { dropped, nextBaseline, shown, type Baseline } from "./work";

/**
 * Claude Code's star, there and back, a frame every 120 ms (style.css). ✳ asks for its text form (U+FE0E), so that
 * it is not drawn as an emoji.
 */
const FRAMES = ["·", "✢", "✳︎", "✶", "✻", "✽", "✻", "✶", "✳︎", "✢"];

/** The baseline kept in this browser too, so that a reload of the page (a phone does that) keeps the count. */
const STORE = "gasho.pondering.tokens.";

function parse(text: string | null): Baseline | null {
  try {
    const v = JSON.parse(text ?? "null") as Baseline | null;
    return v && typeof v.output === "number" && typeof v.early === "boolean" ? v : null;
  } catch {
    return null;
  }
}

function saved(key: string): Baseline | null {
  try {
    return parse(localStorage.getItem(STORE + key));
  } catch {
    return null;
  }
}

/** Keeps `b`, and removes the baselines of the sessions seen longest ago: else there would be one for every session. */
function save(key: string, b: Baseline): void {
  try {
    localStorage.setItem(STORE + key, JSON.stringify(b));
    const stored: [string, Baseline | null][] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(STORE)) stored.push([k, parse(localStorage.getItem(k))]);
    }
    for (const k of dropped(stored)) localStorage.removeItem(k);
  } catch {
    // kept for this page view only
  }
}

export function Pondering({ machine, session }: ConversationEndProps) {
  const working = session.status === "busy";
  // Gasho tells the start of the work also while the session waits for an answer: that is still the same work.
  const inWork = working || session.status === "waiting";
  const activity = useSessionActivity(machine.id, session.sessionId);
  const turn = activity.turnStartedAt;
  const output = session.tokens?.output;
  // Kept while the page is open, through a new version of the plugin, and in this browser through a reload.
  const key = `${machine.id}/${session.sessionId}`;
  const stored = useMemo(() => saved(key), [key]);
  const [base, setBase] = usePluginState<Baseline | null>(`tokens:${key}`, stored);
  // When the session was first shown here out of work since the baseline was taken: the work that follows is seen
  // from its start.
  const idleSince = useRef<number | undefined>(undefined);
  // This view has watched the work of `base` go on since Gasho last told its start (see sameWork).
  const [watched, setWatched] = useState(false);
  // Worked out as it is drawn, so that even the first frame of a new work shows nothing of the last one; kept below.
  const next = working && output !== undefined ? nextBaseline(base, turn, output, Date.now(), idleSince.current) : base;
  useEffect(() => {
    if (!inWork) {
      idleSince.current ??= Date.now();
      setWatched(false);
      return;
    }
    if (!working) return;
    if (next && next !== base) {
      setBase(next);
      save(key, next);
      idleSince.current = undefined;
    }
    if (turn !== undefined) setWatched(true);
  }, [inWork, working, turn, next, base, setBase, key]);

  if (!working) return null;
  const { start, tokens, seed } = shown(next, turn, output, watched);
  return <Spinner seed={`${session.sessionId}/${seed ?? ""}`} start={start} tokens={tokens} tool={activity.tool} />;
}

function Spinner({ seed, start, tokens, tool }: { seed: string; start?: number; tokens?: number; tool?: SessionActivity["tool"] }) {
  const now = useNow(1000);
  const phrase = useMemo(() => pickPhrase(seed), [seed]);
  const meta = [start !== undefined ? elapsed(now - start) : undefined, tokens && tokens > 0 ? `↓ ${tokenCount(tokens)} tokens` : undefined].filter(Boolean);
  return (
    <div className="pondering flex min-w-0 flex-col gap-0.5 text-sm">
      {/* Read out once for each piece of work: the time and the tool change too often. */}
      <p role="status" className="sr-only">
        <span lang={phrase.lang}>{phrase.text}…</span>
      </p>
      <div aria-hidden className="flex min-w-0 items-baseline gap-2">
        <span className="pondering-glyph">
          {FRAMES.map((f, i) => (
            <span key={i} style={{ animationDelay: `${i * 120}ms` }}>
              {f}
            </span>
          ))}
        </span>
        <span lang={phrase.lang} className="pondering-phrase shrink-0">
          {phrase.text}…
        </span>
        {meta.length > 0 && <span className="min-w-0 truncate text-xs text-muted-foreground tabular-nums">({meta.join(" · ")})</span>}
      </div>
      {tool && (
        <div aria-hidden className="flex min-w-0 items-baseline gap-2 pl-7 text-xs text-muted-foreground">
          <span className="shrink-0">⎿</span>
          <span className="min-w-0 truncate font-mono" title={toolLabel(tool)}>
            {toolLabel(tool)}
          </span>
        </div>
      )}
    </div>
  );
}
