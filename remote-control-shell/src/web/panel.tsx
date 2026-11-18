// The shell panel of a session (README.md「画面」): the commands run in the session's folder, oldest first, each with
// its state and output, and at the bottom the box to type the next one in. On a computer it sits beside the session;
// on a phone it takes the screen, with a row of keys that are hard to type there.
import { ArrowUp, CircleCheck, CircleStop, CircleX, CornerDownLeft, Ellipsis, LoaderCircle, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import { cn, Panel, PANEL_BUTTON, useCall, useDaemonReady, useNow, useRequest, useSetting, type PanelProps } from "@gasho/plugin-sdk";
import type { OutputAnswer, ShellJob, StatusAnswer } from "../types.ts";
import { lastLines, linesFrom, plainText, type Line, type Style } from "./ansi";
import { onBackground, paletteFrom, type Palette } from "./colors";
import { useShell } from "./follow";
import { commandHistory, commandSummary, duration, folderLabel, insideFolder } from "./format";
import { addJob, joinPiece, windowEnd, type OutputWindow } from "./state";

/** Lines of an ended command shown until it is opened (characters at most, for a long line), and lines shown per page once it is. */
const COLLAPSED_LINES = 20;
const COLLAPSED_CHARS = 4096;
const PAGE_LINES = 2000;
/** After "停止", the button offers "強制終了" this long later. */
const STOP_TO_KILL_MS = 3000;
/** Characters read at once of an ended command's earlier output. */
const READ_CHARS = 1024 * 1024;

export function ShellPanel({ machine, session, docked }: PanelProps) {
  const daemon = useDaemonReady(machine.id);
  const enabled = machine.connected && daemon.ready;
  const { state, update } = useShell(machine.id, session.sessionId, enabled);
  const call = useCall();
  const [wrap] = useSetting<boolean>("wrap");
  const [logCommands] = useSetting<boolean>("logCommands");
  const [input, setInput] = useState("");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [announce, setAnnounce] = useState("");
  /** Commands opened past their last lines: how many lines they show. */
  const [opened, setOpened] = useState<Record<string, number>>({});
  /** When "停止" was pressed, per command. */
  const [stopAt, setStopAt] = useState<Record<string, number>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const atBottom = useRef(true);
  /** Output read whole for "出力をコピー" that could not be copied then: copied at the next press. */
  const readForCopy = useRef<{ id: string; text: string }>(undefined);
  const palette = usePalette(rootRef);

  const running = state.jobs.filter((j) => j.state === "running");
  // The header's number (index.tsx) is read every 10 seconds; the panel sees a command start or end at once.
  const badge = useRequest<StatusAnswer>(enabled ? { machine: machine.id, sessionId: session.sessionId, method: "status" } : undefined);
  useEffect(() => {
    if (state.loaded && badge.data && badge.data.running !== running.length) badge.reload();
  }, [state.loaded, running.length]);
  const now = useNow(running.length > 0 ? 1000 : 60_000);
  const folder = state.folder ?? session.cwd;
  const cwd = state.cwd ?? folder;
  const history = useMemo(() => commandHistory(state.jobs.map((j) => j.command)), [state.jobs]);
  const reason = !machine.connected
    ? `${machine.name} はオフラインです。`
    : !daemon.ready
      ? (daemon.reason ?? "この working server では、Remote Control Shell の daemon の部分が動いていません。")
      : undefined;

  // Commands seen running stay open once they end; one that ends is read out.
  const seen = useRef<Map<string, ShellJob["state"]>>(new Map());
  useEffect(() => {
    const fresh = running.filter((j) => opened[j.id] === undefined);
    if (fresh.length > 0) setOpened((o) => ({ ...o, ...Object.fromEntries(fresh.map((j) => [j.id, PAGE_LINES])) }));
    for (const job of state.jobs) {
      if (seen.current.get(job.id) === "running" && job.state !== "running") setAnnounce(`${job.command.split("\n")[0]}：${stateText(job)}`);
      seen.current.set(job.id, job.state);
    }
  }, [state.jobs]);

  // Kept at the bottom while the reader is there (the panel's content is what scrolls).
  useEffect(() => {
    const scroller = rootRef.current?.parentElement;
    if (!scroller) return;
    const onScroll = () => {
      atBottom.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);
  useLayoutEffect(() => {
    const scroller = rootRef.current?.parentElement;
    if (scroller && atBottom.current) scroller.scrollTop = scroller.scrollHeight;
  }, [state.jobs, state.windows, opened]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  const target = (method: string, params: unknown, summary?: string) => ({
    machine: machine.id,
    sessionId: session.sessionId,
    method,
    params,
    ...(summary ? { summary } : {}),
  });
  const said = (command: string) => (logCommands === false ? "" : `：${commandSummary(command)}`);

  const run = async (params: { command: string } | { again: string }, command: string): Promise<boolean> => {
    setError(undefined);
    const cols = columns(rootRef.current, measureRef.current);
    const r = await call<ShellJob>(target("run", { ...params, ...(cols ? { cols } : {}) }, logCommands === false ? "コマンドを実行" : commandSummary(command)));
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    atBottom.current = true;
    update((s) => addJob(s, r.data));
    setOpened((o) => ({ ...o, [r.data.id]: PAGE_LINES }));
    return true;
  };
  const stop = async (job: ShellJob, signal: "INT" | "KILL") => {
    setError(undefined);
    if (signal === "INT") setStopAt((s) => ({ ...s, [job.id]: Date.now() }));
    const name = signal === "INT" ? "SIGINT" : "SIGKILL";
    const r = await call(target("signal", { job: job.id, signal }, `コマンドを止めた（${name}）${said(job.command)}`));
    if (!r.ok) setError(r.error);
  };
  const stopNewest = () => {
    const job = running[running.length - 1];
    if (!job) return;
    void stop(job, stopAt[job.id] !== undefined && now - stopAt[job.id]! >= STOP_TO_KILL_MS ? "KILL" : "INT");
  };
  const backHome = async () => {
    setError(undefined);
    const r = await call(target("chdir", {}, "作業フォルダーをセッションのフォルダーに戻した"));
    if (!r.ok) setError(r.error);
  };
  const clear = async (job?: ShellJob) => {
    setError(undefined);
    const r = await call(target("clear", job ? { job: job.id } : {}, job ? `シェルの記録を消した${said(job.command)}` : "終わったコマンドの記録をすべて消した"));
    if (!r.ok) setError(r.error);
  };
  /** Reads the output before what is here, up to READ_CHARS. */
  const readEarlier = async (job: ShellJob): Promise<OutputWindow | undefined> => {
    const w = state.windows[job.id];
    const end = w ? w.from : job.size;
    const from = Math.max(job.dropped, end - READ_CHARS);
    if (end <= from) return w;
    const r = await call<OutputAnswer>(target("output", { job: job.id, from, limit: end - from }));
    if (!r.ok) {
      setError(r.error);
      return undefined;
    }
    let joined: OutputWindow | undefined;
    update((s) => {
      joined = joinPiece(s.windows[job.id], r.data);
      return { ...s, windows: { ...s.windows, [job.id]: joined } };
    });
    return joined;
  };
  /** All the output that is kept of a command, read in stretches (as it is now, for one that runs). */
  const readAll = async (job: ShellJob): Promise<string> => {
    let text = "";
    for (let from = job.dropped; ; ) {
      const r = await call<OutputAnswer>(target("output", { job: job.id, from, limit: READ_CHARS }));
      if (!r.ok) throw new Error(r.error);
      // Output dropped meanwhile (it runs): what is kept now.
      text = r.data.from === from ? text + r.data.text : r.data.text;
      from = r.data.from + r.data.text.length;
      if (!r.data.text || from >= r.data.size) return text;
    }
  };
  const copyOutput = (job: ShellJob) => {
    setError(undefined);
    const more = job.state === "running";
    const done = (ok: boolean) => setNotice(ok ? "出力をコピーしました。" : "コピーできませんでした。");
    const w = state.windows[job.id];
    const read = readForCopy.current?.id === job.id ? readForCopy.current.text : undefined;
    readForCopy.current = undefined;
    const here = w && w.from <= job.dropped && windowEnd(w) >= job.size ? w.text : read;
    if (here !== undefined) {
      void copyText(plainText(here, more)).then(done);
      return;
    }
    // Not all here: read from the daemon part. Copying waits for it, which Safari allows only through ClipboardItem;
    // else the output read is kept, and the next press copies it while the press is being handled.
    const reading = readAll(job);
    void copyText(reading.then((t) => plainText(t, more))).then(
      async (ok) => {
        if (ok) return done(true);
        readForCopy.current = { id: job.id, text: await reading };
        setNotice("出力を読み込みました。もう一度「出力をコピー」を押すとコピーします。");
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  };
  const putInput = (command: string) => {
    setInput(command);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(command.length, command.length);
    });
  };

  const ended = state.jobs.some((j) => j.state !== "running");
  return (
    <Panel title="シェル" subtitle={`${machine.name} · ${session.cwd}`} actions={<ClearButton disabled={!enabled || !ended} onClear={() => void clear()} />}>
      <div ref={rootRef} className="rcs relative flex min-h-full flex-col">
        <span ref={measureRef} aria-hidden className="pointer-events-none invisible absolute font-mono text-xs whitespace-pre">
          0000000000
        </span>
        <p role="status" className="sr-only">
          {announce}
        </p>
        <div className="flex-1 space-y-5 pb-4">
          {reason && <p className="text-sm text-muted-foreground">{reason}</p>}
          {enabled && state.error && <p className="text-sm text-red-400">{state.error}</p>}
          {enabled && !state.loaded && !state.error && <p className="text-sm text-muted-foreground">読み込み中…</p>}
          {state.loaded && state.jobs.length === 0 && (
            <p className="text-sm text-muted-foreground">
              このフォルダーでは、まだコマンドを実行していません。下の入力欄にコマンドを入れて、Enter で実行します。出力は Claude の会話には入りません。
            </p>
          )}
          {state.jobs.map((job) => (
            <JobBlock
              key={job.id}
              job={job}
              win={state.windows[job.id]}
              folder={folder}
              home={state.home}
              now={now}
              skew={state.skew}
              wrap={wrap !== false}
              shown={opened[job.id]}
              palette={palette}
              stopAt={stopAt[job.id]}
              enabled={enabled}
              onOpen={async () => {
                setOpened((o) => ({ ...o, [job.id]: PAGE_LINES }));
                const w = state.windows[job.id];
                if (!w || w.from > job.dropped) await readEarlier(job);
              }}
              onClose={() =>
                setOpened((o) => {
                  const { [job.id]: _gone, ...rest } = o;
                  return rest;
                })
              }
              onMore={(lines) => {
                const shown = opened[job.id] ?? PAGE_LINES;
                if (lines > shown) setOpened((o) => ({ ...o, [job.id]: shown + PAGE_LINES }));
                else void readEarlier(job).then(() => setOpened((o) => ({ ...o, [job.id]: shown + PAGE_LINES })));
              }}
              onStop={(signal) => void stop(job, signal)}
              onAgain={() => void run({ again: job.id }, job.command)}
              onPutInput={() => putInput(job.command)}
              onCopyCommand={async () => setNotice((await copyText(job.command)) ? "コマンドをコピーしました。" : "コピーできませんでした。")}
              onCopyOutput={() => void copyOutput(job)}
              onRemove={() => void clear(job)}
            />
          ))}
        </div>
        <Composer
          docked={docked}
          value={input}
          onChange={setInput}
          inputRef={inputRef}
          cwd={cwd}
          cwdLabel={folderLabel(cwd, folder, state.home)}
          outside={state.loaded && !insideFolder(cwd, folder)}
          enabled={enabled}
          history={history}
          canStop={running.length > 0}
          message={error ? { text: error, error: true } : notice ? { text: notice } : undefined}
          onRun={(command) => run({ command }, command)}
          onStopNewest={stopNewest}
          onBackHome={() => void backHome()}
        />
      </div>
    </Panel>
  );
}

/** How wide the panel is, in characters of the output's font (COLUMNS for the command). */
function columns(root: HTMLElement | null, measure: HTMLElement | null): number | undefined {
  const width = measure ? measure.getBoundingClientRect().width / 10 : 0;
  if (!root || width <= 0) return undefined;
  return Math.max(20, Math.floor((root.clientWidth - 24) / width));
}

function stateText(job: ShellJob): string {
  switch (job.state) {
    case "running":
      return "実行中";
    case "exited":
      return job.exitCode === 0 ? "終わりました" : `終了コード ${job.exitCode} で終わりました`;
    case "stopped":
      return `止めました（${job.signal ?? "合図"}）`;
    case "failed":
      return "起動できませんでした";
    case "lost":
      return "プラグインが止まったため終了しました";
  }
}

// ---- one command ----

interface JobBlockProps {
  job: ShellJob;
  win: OutputWindow | undefined;
  folder: string;
  home: string | undefined;
  now: number;
  skew: number;
  wrap: boolean;
  /** Lines shown once opened; undefined while it shows its last lines only. */
  shown: number | undefined;
  palette: Palette | undefined;
  stopAt: number | undefined;
  enabled: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** Shows more before what shows (`lines`: the lines here). */
  onMore: (lines: number) => void;
  onStop: (signal: "INT" | "KILL") => void;
  onAgain: () => void;
  onPutInput: () => void;
  onCopyCommand: () => void;
  onCopyOutput: () => void;
  onRemove: () => void;
}

function JobBlock(p: JobBlockProps) {
  const { job, win } = p;
  const runningNow = job.state === "running";
  /** More of the text here may come: the command runs, or the rest of its output is still to be read. */
  const growing = runningNow || (win !== undefined && windowEnd(win) < job.size);
  /** The text here starts after the first character kept, maybe inside a line: that line is not shown. */
  const partial = win !== undefined && win.from > job.dropped;
  const text = win?.text;
  const lines = useMemo(() => (text !== undefined ? linesFrom(text, partial, growing) : []), [text, partial, growing]);
  const short = useMemo(() => lastLines(lines, COLLAPSED_LINES, COLLAPSED_CHARS), [lines]);
  const open = p.shown !== undefined;
  const hidden = open ? Math.max(0, lines.length - (p.shown as number)) : 0;
  const visible = open ? (hidden > 0 ? lines.slice(-(p.shown as number)) : lines) : short.lines;
  /** Characters of output kept on the working server but not here. */
  const notHere = (win ? win.from : job.size) - job.dropped;
  const more = hidden > 0 || notHere > 0;
  return (
    <section className="min-w-0" aria-label={`$ ${job.command.split("\n")[0]}`}>
      <header className="flex items-start gap-2 text-xs">
        <p className="min-w-0 flex-1 font-mono break-all whitespace-pre-wrap">
          <span className="text-muted-foreground">{folderLabel(job.cwd, p.folder, p.home)} $ </span>
          <span className="text-foreground">{job.command}</span>
        </p>
        <JobStatus job={job} now={p.now} skew={p.skew} stopAt={p.stopAt} enabled={p.enabled} onStop={p.onStop} />
        <JobMenu
          items={[
            { label: "もう一度実行", disabled: !p.enabled, onSelect: p.onAgain },
            { label: "入力欄に入れる", onSelect: p.onPutInput },
            { label: "コマンドをコピー", onSelect: p.onCopyCommand },
            { label: "出力をコピー", disabled: job.size === 0, onSelect: p.onCopyOutput },
            { label: "この記録を消す", disabled: runningNow || !p.enabled, onSelect: p.onRemove },
          ]}
        />
      </header>
      {job.note && <p className={cn("mt-1 text-xs", job.state === "failed" ? "text-red-400" : "text-amber-400")}>{job.note}</p>}
      {lines.length > 0 && (
        <div className="mt-1.5 rounded-lg border border-border bg-surface/60 px-2.5 py-2">
          {open && more && (
            <p className="mb-1.5 text-xs text-muted-foreground">
              {runningNow ? (
                hidden > 0 ? (
                  <button type="button" onClick={() => p.onMore(lines.length)} className="underline-offset-2 hover:text-foreground hover:underline">
                    前の {Math.min(hidden, PAGE_LINES).toLocaleString("ja-JP")} 行を表示
                  </button>
                ) : (
                  "これより前の出力は、コマンドが終わってから読めます。"
                )
              ) : (
                <button type="button" onClick={() => p.onMore(lines.length)} className="underline-offset-2 hover:text-foreground hover:underline">
                  前を読む
                </button>
              )}
            </p>
          )}
          {open && !more && job.dropped > 0 && (
            <p className="mb-1.5 text-xs text-muted-foreground">
              先頭の {job.dropped.toLocaleString("ja-JP")} 文字は、残す量の上限を超えたので残っていません。
            </p>
          )}
          <Output lines={visible} wrap={p.wrap} palette={p.palette} />
        </div>
      )}
      {!runningNow && (open ? short.cut : short.cut || notHere > 0) && (
        <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
          {open ? (
            <button type="button" onClick={p.onClose} className="underline-offset-2 hover:text-foreground hover:underline">
              末尾の {COLLAPSED_LINES} 行だけにする
            </button>
          ) : (
            <button type="button" onClick={p.onOpen} className="underline-offset-2 hover:text-foreground hover:underline">
              すべて表示（{job.lines.toLocaleString("ja-JP")} 行）
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function JobStatus({
  job,
  now,
  skew,
  stopAt,
  enabled,
  onStop,
}: {
  job: ShellJob;
  now: number;
  skew: number;
  stopAt: number | undefined;
  enabled: boolean;
  onStop: (signal: "INT" | "KILL") => void;
}) {
  const took = job.endedAt !== undefined ? duration(job.endedAt - job.startedAt) : "";
  const tag = "flex shrink-0 items-center gap-1 tabular-nums";
  switch (job.state) {
    case "running": {
      const force = stopAt !== undefined && now - stopAt >= STOP_TO_KILL_MS;
      return (
        <span className={cn(tag, "text-muted-foreground")}>
          <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
          実行中 {duration(now + skew - job.startedAt)}
          <button type="button" disabled={!enabled} onClick={() => onStop(force ? "KILL" : "INT")} className={cn(PANEL_BUTTON, "ml-1 px-2 py-0.5")}>
            {force ? "強制終了" : "停止"}
          </button>
        </span>
      );
    }
    case "exited":
      return job.exitCode === 0 ? (
        <span className={cn(tag, "text-emerald-400")}>
          <CircleCheck aria-label="成功" className="size-3.5" />
          {took}
        </span>
      ) : (
        <span className={cn(tag, "text-red-400")}>
          <CircleX aria-hidden className="size-3.5" />
          終了コード {job.exitCode} · {took}
        </span>
      );
    case "stopped":
      return (
        <span className={cn(tag, "text-amber-400")}>
          <CircleStop aria-hidden className="size-3.5" />
          止めた（{job.signal}）· {took}
        </span>
      );
    case "failed":
      return (
        <span className={cn(tag, "text-red-400")}>
          <TriangleAlert aria-hidden className="size-3.5" />
          起動できなかった
        </span>
      );
    case "lost":
      return (
        <span className={cn(tag, "text-muted-foreground")}>
          <TriangleAlert aria-hidden className="size-3.5" />
          プラグインが止まったため終了
        </span>
      );
  }
}

function Output({ lines, wrap, palette }: { lines: Line[]; wrap: boolean; palette: Palette | undefined }) {
  return (
    <div className={cn("rcs-output font-mono text-xs leading-relaxed", wrap ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "overflow-x-auto whitespace-pre")}>
      {lines.map((line, i) => (
        <div key={i}>
          {line.length === 0 ? (
            <br />
          ) : (
            line.map((s, k) => {
              const own = palette ? onBackground(s.style, palette) : undefined;
              return (
                <span key={k} className={spanClass(s.style, own !== undefined)} style={own ?? spanStyle(s.style)}>
                  {s.text}
                </span>
              );
            })
          )}
        </div>
      ))}
    </div>
  );
}

/** The colors a span is drawn in: inverse swaps them, the default ones included. */
function colors(s: Style): { fg?: number | string; bg?: number | string; fgIsBg: boolean; bgIsFg: boolean } {
  if (!s.inverse) return { fg: s.fg, bg: s.bg, fgIsBg: false, bgIsFg: false };
  return { fg: s.bg, bg: s.fg, fgIsBg: s.bg === undefined, bgIsFg: s.fg === undefined };
}

/** `colored`: its colors are set in its style (on a background of its own, colors.ts), so that only the rest is here. */
function spanClass(s: Style, colored: boolean): string | undefined {
  const c: string[] = [];
  if (!colored) {
    const { fg, bg, fgIsBg, bgIsFg } = colors(s);
    if (typeof fg === "number") c.push(`rcs-fg-${fg}`);
    else if (fgIsBg) c.push("rcs-fg-bg");
    if (typeof bg === "number") c.push(`rcs-bg-${bg}`);
    else if (bgIsFg) c.push("rcs-bg-fg");
  }
  if (s.bold) c.push("rcs-b");
  if (s.dim) c.push("rcs-d");
  if (s.italic) c.push("rcs-i");
  if (s.underline) c.push("rcs-u");
  if (s.strike) c.push("rcs-s");
  return c.length > 0 ? c.join(" ") : undefined;
}

function spanStyle(s: Style): CSSProperties | undefined {
  const { fg, bg } = colors(s);
  if (typeof fg !== "string" && typeof bg !== "string") return undefined;
  return { ...(typeof fg === "string" ? { color: fg } : {}), ...(typeof bg === "string" ? { backgroundColor: bg } : {}) };
}

/** The palette of the theme on screen, as the stylesheet sets it on the panel; read again when the theme changes. */
function usePalette(root: RefObject<HTMLElement | null>): Palette | undefined {
  const [palette, setPalette] = useState<Palette>();
  useLayoutEffect(() => {
    const read = () => {
      const el = root.current;
      if (!el) return;
      const style = getComputedStyle(el);
      const next = paletteFrom((name) => style.getPropertyValue(name));
      setPalette((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    read();
    // Gasho's screen is dark while <html> has the class "dark".
    const watcher = new MutationObserver(read);
    watcher.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => watcher.disconnect();
  }, [root]);
  return palette;
}

// ---- small parts ----

interface MenuItem {
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

function JobMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    // Esc closes the menu, not the panel.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label="この記録のメニュー"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="-my-0.5 grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-surface-raised hover:text-foreground"
      >
        <Ellipsis className="size-4" />
      </button>
      {open && (
        <div role="menu" className="absolute top-7 right-0 z-20 min-w-44 rounded-lg border border-border bg-popover p-1 text-xs shadow-lg">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className="block w-full rounded-md px-2.5 py-1.5 text-left hover:bg-surface-raised disabled:pointer-events-none disabled:opacity-50"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ClearButton({ disabled, onClear }: { disabled: boolean; onClear: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onClear();
      }}
      title="終わったコマンドの記録を消す（実行中のものは残す）"
      className={cn(PANEL_BUTTON, armed && "border-red-400/60 text-red-300")}
    >
      <Trash2 className="size-3.5" />
      {armed ? "もう一度押すと消す" : "記録を消す"}
    </button>
  );
}

/** Keys that are hard to type on a phone's keyboard. */
const KEYS = [
  { label: "|", text: " | " },
  { label: "&&", text: " && " },
  { label: ">", text: " > " },
  { label: "~", text: "~" },
  { label: "/", text: "/" },
  { label: "-", text: "-" },
];

interface ComposerProps {
  docked: boolean;
  value: string;
  onChange: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  cwd: string;
  cwdLabel: string;
  outside: boolean;
  enabled: boolean;
  history: string[];
  canStop: boolean;
  message: { text: string; error?: boolean } | undefined;
  onRun: (command: string) => Promise<boolean>;
  onStopNewest: () => void;
  onBackHome: () => void;
}

/** The box at the bottom: the working folder, the command being typed, and on a phone a row of keys. */
function Composer(p: ComposerProps) {
  const [sending, setSending] = useState(false);
  /** While going through the history: where in it, and what was being typed before. */
  const [at, setAt] = useState<number>();
  const draft = useRef("");
  const rows = Math.min(6, Math.max(1, p.value.split("\n").length));

  const submit = async () => {
    const command = p.value;
    if (!command.trim() || sending || !p.enabled) return;
    setSending(true);
    const ok = await p.onRun(command);
    setSending(false);
    // What was typed while it was being sent stays in the box.
    if (!ok || p.inputRef.current?.value !== command) return;
    p.onChange("");
    setAt(undefined);
    draft.current = "";
  };
  const browse = (step: -1 | 1): boolean => {
    const h = p.history;
    if (h.length === 0) return false;
    if (at === undefined) {
      if (step === 1) return false;
      draft.current = p.value;
      setAt(h.length - 1);
      p.onChange(h[h.length - 1] ?? "");
      return true;
    }
    const next = at + step;
    if (next < 0) return true;
    if (next >= h.length) {
      setAt(undefined);
      p.onChange(draft.current);
      return true;
    }
    setAt(next);
    p.onChange(h[next] ?? "");
    return true;
  };
  const insert = (text: string) => {
    const el = p.inputRef.current;
    const start = el?.selectionStart ?? p.value.length;
    const end = el?.selectionEnd ?? p.value.length;
    p.onChange(p.value.slice(0, start) + text + p.value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + text.length, start + text.length);
    });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    // Keys pressed for a Japanese (or other) input method belong to it: ↑ and ↓ pick a candidate, Esc cancels. Safari
    // sends the Enter that ends a conversion after it has ended, with keyCode 229.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
      return;
    }
    if (e.key === "ArrowUp" && !e.altKey && !e.metaKey && !el.value.slice(0, el.selectionStart).includes("\n")) {
      if (browse(-1)) e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown" && !e.altKey && !e.metaKey && !el.value.slice(el.selectionEnd).includes("\n")) {
      if (browse(1)) e.preventDefault();
      return;
    }
    if (e.key === "Escape" && el.value) {
      // The text goes first; Esc on an empty box closes the panel, as Gasho's panels do.
      e.preventDefault();
      e.stopPropagation();
      p.onChange("");
      setAt(undefined);
      return;
    }
    if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "c") {
      const selected = el.selectionStart !== el.selectionEnd || (window.getSelection()?.toString() ?? "") !== "";
      if (!selected && p.canStop) {
        e.preventDefault();
        p.onStopNewest();
      }
    }
  };

  return (
    // The panel's content scrolls with a padding of 1rem; sticking 1rem below its edge keeps nothing showing under the box.
    <div className="sticky -bottom-4 -mx-4 -mb-4 space-y-1.5 border-t border-border bg-background px-4 pt-2 pb-3">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <span className={cn("min-w-0 truncate font-mono", p.outside ? "text-amber-400" : "text-muted-foreground")} title={p.cwd}>
          {p.cwdLabel}
        </span>
        {p.outside && (
          <button
            type="button"
            disabled={!p.enabled}
            onClick={p.onBackHome}
            className="inline-flex shrink-0 items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <Undo2 className="size-3.5" />
            セッションのフォルダーに戻る
          </button>
        )}
      </div>
      {!p.docked && (
        <div role="toolbar" aria-label="打ちにくい記号と操作" className="scrollbar-none -mx-4 flex gap-1.5 overflow-x-auto px-4">
          {KEYS.map((k) => (
            <button
              key={k.label}
              type="button"
              disabled={!p.enabled}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => insert(k.text)}
              className="h-8 min-w-9 shrink-0 rounded-md border border-border px-2 font-mono text-sm disabled:opacity-50"
            >
              {k.label}
            </button>
          ))}
          <button
            type="button"
            aria-label="前のコマンド"
            disabled={!p.enabled || p.history.length === 0}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => browse(-1)}
            className="grid h-8 min-w-9 shrink-0 place-items-center rounded-md border border-border disabled:opacity-50"
          >
            <ArrowUp className="size-4" />
          </button>
          <button
            type="button"
            disabled={!p.enabled || !p.canStop}
            onPointerDown={(e) => e.preventDefault()}
            onClick={p.onStopNewest}
            className="h-8 shrink-0 rounded-md border border-border px-2.5 text-xs disabled:opacity-50"
          >
            停止
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <label className="flex min-w-0 flex-1 items-start gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 focus-within:border-border-hover">
          <span aria-hidden className="font-mono text-sm leading-6 text-muted-foreground select-none">
            $
          </span>
          <textarea
            ref={p.inputRef}
            value={p.value}
            rows={rows}
            disabled={!p.enabled}
            onChange={(e) => {
              p.onChange(e.target.value);
              setAt(undefined);
            }}
            onKeyDown={onKeyDown}
            placeholder={p.docked ? "コマンド（Enter で実行、Shift+Enter で改行）" : "コマンド"}
            aria-label="実行するコマンド"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="send"
            className="min-w-0 flex-1 resize-none bg-transparent font-mono text-sm leading-6 outline-none placeholder:text-muted-foreground/70 disabled:opacity-60"
          />
        </label>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!p.enabled || !p.value.trim() || sending}
          aria-label="実行"
          title="実行（Enter）"
          className="grid size-9 shrink-0 place-items-center rounded-lg border border-border hover:border-border-hover disabled:opacity-50"
        >
          {sending ? <LoaderCircle className="size-4 animate-spin" /> : <CornerDownLeft className="size-4" />}
        </button>
      </div>
      {p.message && <p className={cn("text-xs", p.message.error ? "text-red-400" : "text-muted-foreground")}>{p.message.text}</p>}
    </div>
  );
}

/**
 * Copies text: with the Clipboard API where the page may use it, else as Gasho over plain http must (execCommand). Both
 * work only while a press is being handled, in Safari strictly: text that comes later (read from the daemon part) goes
 * to the clipboard at once as a ClipboardItem, which waits for it, where there is one. Rejects when `text` does.
 */
async function copyText(text: string | Promise<string>): Promise<boolean> {
  if (typeof text !== "string" && window.isSecureContext && navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": text.then((t) => new Blob([t], { type: "text/plain" })) })]);
      return true;
    } catch {
      // falls back below
    }
  }
  const value = await text;
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // falls back below
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  // Under 16px, Safari on an iPhone zooms the page in on it.
  area.style.fontSize = "16px";
  document.body.appendChild(area);
  area.select();
  // Safari on an iPhone does not select with select() alone.
  area.setSelectionRange(0, value.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}
