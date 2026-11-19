// The kanban's page (moved here from Gasho's views/kanban.tsx of PR #8, after 4rtofl/Dashboard): the worktrees and my
// pull requests of the watched repositories, read by each working server's daemon part, in the columns the board plugin
// of each repository gives (in the first one without a plugin), run from the working server's folder. The look follows
// easyui.site: dark tiles with hairline borders, color only where it tells a state, and springs. On a computer the board
// fills the page and each column scrolls by itself; on a phone one column shows at a time, picked with a sliding pill.
import { ArrowUpDown, Check, FileDown, LoaderCircle, RefreshCw, Settings2, SquareKanban, X } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, MotionConfig } from "framer-motion";
import { Dialog, Popover } from "radix-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cn,
  useCall,
  useDaemonReady,
  useEvent,
  useMachines,
  useNavigation,
  useNow,
  usePluginState,
  relativeTime,
  useRequest,
  type MachineInfo,
  type PageProps,
} from "@gasho/plugin-sdk";
import {
  arrangeCards,
  boardHeadings,
  boardStateCards,
  COLUMN_WIDTH,
  KANBAN_COLUMNS,
  KANBAN_SORTS,
  kanbanCards,
  type BoardPlugins,
  type KanbanColumn,
  type KanbanSort,
  type KanbanSortKey,
  type PlacedCard,
  type RepoHeadings,
} from "../cards.ts";
import type { PluginProblem, PluginSet } from "../board-code.ts";
import type { Board } from "../types.ts";
import { useBoardPlugins } from "./board-plugins";
import { Card, CardActionsContext, CardSkeleton, CompactCard, type CardActions, type Notice, type Where } from "./card";
import { clampWidth, columnCompact, columnWidth, setColumnCompact, setColumnSort, setColumnWidth, useKanbanPrefs, type KanbanPrefs } from "./prefs";
import { ReposDialog } from "./repos-dialog";
import { Alert, AlertDescription, AlertTitle, Badge, Button, DESKTOP, useMediaQuery, type BadgeTone } from "./ui/parts";
import { DIALOG_OVERLAY, DIALOG_PANEL, motionTransitions, TILE, TILE_SHADOW } from "./ui/styles";

/** The daemon part reads every minute while the board shows; an older reading means it stopped. */
const STALE_MS = 5 * 60_000;
/** How often the board is asked for: every minute, and every 2 seconds while a reading goes on. */
const ASK_SECONDS = 60;
const ASK_READING_SECONDS = 2;
/** How long the refresh button waits for a working server to start reading. */
const REFRESH_WAIT_MS = 3000;
/** What one call of "カードを書き出す" may send (the Gasho server takes 64 KB of params). */
const EXPORT_MAX_BYTES = 60_000;

/** Each column's dot and count, in the colors Gasho gives the same states elsewhere (amber: needs me; green: working). */
const COLUMN_LOOK: Record<KanbanColumn, { dot: string; tone: BadgeTone; pulse?: boolean }> = {
  mine: { dot: "bg-amber-500", tone: "warning" },
  agent: { dot: "bg-emerald-500", tone: "success", pulse: true },
  github: { dot: "bg-sky-500", tone: "neutral" },
  review: { dot: "bg-violet-400", tone: "neutral" },
  done: { dot: "bg-neutral-500", tone: "neutral" },
};

const NO_PLUGINS: BoardPlugins = new Map();

const time = (ms: number): string => new Date(ms).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });

/** One working server's board as the page has it. */
interface Source {
  /** Its daemon part runs (connected, allowed, and new enough); else why not. */
  ready: boolean;
  reason?: string;
  board?: Board;
  /** The last call failed (the board read before stays). */
  error?: string;
  refreshing: boolean;
  reload: () => void;
  /** Its board plugins' folder, as last read. */
  pluginSet?: PluginSet;
  /** Its board plugins as this browser runs them, and those that cannot be used; undefined before they first load. */
  plugins?: { plugins: BoardPlugins; problems: PluginProblem[] };
}

/**
 * Asks one working server's daemon part for its board, and tells the page. A component per working server, as hooks
 * cannot be called for a list that changes; it draws nothing.
 */
function BoardSource({ machine, refreshAsk, onChange }: { machine: MachineInfo; refreshAsk: number; onChange: (id: string, s: Source | undefined) => void }) {
  const daemon = useDaemonReady(machine.id);
  const on = machine.connected && daemon.ready;
  // The interval follows the last answer: shorter while the daemon part reads.
  const [reading, setReading] = useState(false);
  const r = useRequest<Board>(on ? { machine: machine.id, method: "board" } : undefined, {
    staleSeconds: 0,
    refreshSeconds: reading ? ASK_READING_SECONDS : ASK_SECONDS,
  });
  const checking = r.data?.checking === true;
  useEffect(() => setReading(checking), [checking]);
  // The board plugins: asked for again when the daemon part says they changed (a file saved in their folder), or when
  // the board has another version of them.
  const told = useEvent<{ version?: string }>("plugins", { machine: machine.id });
  const seen = [told?.version, r.data?.pluginsVersion].filter(Boolean).join(" ");
  const set = useRequest<PluginSet>(on && seen ? { machine: machine.id, method: "plugins", params: { seen } } : undefined);
  const plugins = useBoardPlugins(set.data);
  // The daemon part runs the `fetch` of a plugin that changed before it tells: the board is asked for now, and every 2
  // seconds while that reading goes on, rather than in a minute.
  const toldBefore = useRef(told?.version);
  useEffect(() => {
    if (told?.version === toldBefore.current) return;
    toldBefore.current = told?.version;
    r.reload();
  }, [told?.version]);

  const call = useCall();
  const { reload } = r;
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<{ error: string; at: number }>();
  const asked = useRef(refreshAsk);
  useEffect(() => {
    if (refreshAsk === asked.current || !on) return;
    asked.current = refreshAsk;
    let live = true;
    setRefreshing(true);
    void call<Board>({ machine: machine.id, method: "refresh" }).then((res) => {
      if (!live) return;
      setRefreshing(false);
      if (!res.ok) {
        setRefreshError({ error: res.error, at: Date.now() });
        return;
      }
      setRefreshError(undefined);
      reload();
    });
    return () => {
      live = false;
    };
  }, [refreshAsk]);

  // A failed "今すぐ見直す" shows until the board is read after it.
  const refreshFailed = refreshError && !((r.at ?? 0) > refreshError.at) ? refreshError.error : undefined;
  const error = refreshFailed ?? r.error ?? set.error;
  useEffect(() => {
    onChange(machine.id, {
      ready: on,
      ...(daemon.reason ? { reason: daemon.reason } : {}),
      board: r.data,
      ...(error ? { error } : {}),
      refreshing,
      reload,
      ...(set.data ? { pluginSet: set.data } : {}),
      ...(plugins ? { plugins } : {}),
    });
  }, [machine.id, on, daemon.reason, r.data, error, refreshing, reload, onChange, set.data, plugins]);
  useEffect(() => () => onChange(machine.id, undefined), [machine.id, onChange]);
  return null;
}

export function KanbanPage(_: PageProps) {
  const machines = useMachines();
  const now = useNow(15_000);
  const wide = useMediaQuery(DESKTOP);
  const nav = useNavigation();
  const [sources, setSources] = useState<Record<string, Source>>({});
  const onSource = useCallback((id: string, s: Source | undefined) => {
    setSources((cur) => {
      if (s) return { ...cur, [id]: s };
      if (!(id in cur)) return cur;
      const next = { ...cur };
      delete next[id];
      return next;
    });
  }, []);
  const [refreshAsk, setRefreshAsk] = useState(0);
  const [choosing, setChoosing] = useState(false);
  const [asked, setAsked] = useState(false);
  const [tab, setTab] = useState<KanbanColumn>("mine");
  // What a card's menu is doing or did: starting a session.
  const [notice, setNotice] = useState<Notice>();
  const [trust, setTrust] = useState<{ path: string; warnings: string[]; answer: (yes: boolean) => void }>();
  // How many repositories each working server watched when last read, kept while the page is open: an offline one
  // is named above the board.
  const [lastWatched, setLastWatched] = usePluginState<Record<string, number>>("lastWatched", {});

  const prefs = useKanbanPrefs();
  const ready = machines.filter((m) => m.connected && sources[m.id]?.ready);
  const boards = ready.flatMap((machine) => {
    const board = sources[machine.id]?.board;
    return board ? [{ machine, board, plugins: sources[machine.id]?.plugins?.plugins ?? NO_PLUGINS }] : [];
  });
  const cards = useMemo(() => kanbanCards(boards), [machines, sources]);
  const headings = useMemo(() => boardHeadings(boards), [machines, sources]);
  const problems = ready.flatMap((machine) => (sources[machine.id]?.plugins?.problems ?? []).map((p) => ({ machine, ...p })));
  // A board whose repositories chose board plugins waits for them, rather than putting every card in "mine" first.
  const pluginsPending = boards.some((b) => b.board.repos.some((m) => m.plugin) && !sources[b.machine.id]?.plugins && !sources[b.machine.id]?.error);
  const watched = boards.reduce((n, b) => n + b.board.watched.length, 0);
  const updatedAt = Math.max(0, ...boards.map((b) => b.board.updatedAt ?? 0)) || undefined;
  const stale = updatedAt !== undefined && now - updatedAt > STALE_MS;
  const checking = asked || boards.some((b) => b.board.checking) || ready.some((m) => sources[m.id]?.refreshing);
  const errors = boards.flatMap(({ machine, board }) => board.errors.map((e) => ({ machine, ...e })));
  const paused = boards.flatMap(({ machine, board }) => (board.fetchPausedUntil ? [{ machine, until: board.fetchPausedUntil }] : []));
  const failed = ready.flatMap((m) => {
    const error = sources[m.id]?.error;
    return error ? [{ machine: m, error }] : [];
  });
  const unavailable = machines.filter((m) => m.connected && sources[m.id] && !sources[m.id]?.ready);
  const offline = machines.filter((m) => !m.connected && (lastWatched[m.id] ?? 0) > 0);
  // A working server's first board is on its way: what it watches is not known yet.
  const pending = ready.some((m) => !sources[m.id]?.board && !sources[m.id]?.error);
  // Nothing read yet, and nothing failed: the first reading is under way.
  const loading = pending || pluginsPending || (updatedAt === undefined && errors.length === 0 && watched > 0);
  const where: Where = { machines: new Set(cards.map((c) => c.machine.id)).size > 1, repos: new Set(cards.map((c) => c.card.repo)).size > 1 };
  const byColumn = (id: KanbanColumn) => cards.filter((c) => c.card.column === id);
  // An offline working server that watched repositories keeps the board, empty, rather than asking to choose some.
  const showBoard = watched > 0 || pending || offline.length > 0;
  // No working server has answered yet: what they watch is not known, so neither a board nor the request to choose shows.
  const firstLoad = pending && boards.length === 0;

  const counts = JSON.stringify(Object.fromEntries(boards.map((b) => [b.machine.id, b.board.watched.length])));
  useEffect(() => {
    const c = JSON.parse(counts) as Record<string, number>;
    if (Object.entries(c).every(([id, n]) => lastWatched[id] === n)) return;
    setLastWatched((prev) => ({ ...prev, ...c }));
  }, [counts]);

  useEffect(() => {
    if (!asked) return;
    const t = setTimeout(() => setAsked(false), REFRESH_WAIT_MS);
    return () => clearTimeout(t);
  }, [asked]);

  const actions = useMemo<CardActions>(
    () => ({
      notify: setNotice,
      askTrust: (q) => new Promise<boolean>((resolve) => setTrust({ ...q, answer: resolve })),
    }),
    [],
  );
  const answerTrust = (yes: boolean) => {
    trust?.answer(yes);
    setTrust(undefined);
  };

  const call = useCall();
  const [exporting, setExporting] = useState(false);
  /** Writes each working server's cards, as `state` gets them, to its board plugins' folder (cards/), for check.ts. */
  const exportCards = async () => {
    setExporting(true);
    setNotice({ text: "カードを書き出しています…", busy: true });
    const failed: string[] = [];
    const dirs: string[] = [];
    let repos = 0;
    for (const { machine, board } of boards) {
      // In calls of at most EXPORT_MAX_BYTES.
      const chunks: { path: string; cards: unknown[] }[][] = [];
      let size = 0;
      for (const r of boardStateCards(machine, board)) {
        const row = { path: r.path, cards: r.cards };
        const bytes = new Blob([JSON.stringify(row)]).size;
        if (chunks.length === 0 || size + bytes > EXPORT_MAX_BYTES) {
          chunks.push([]);
          size = 0;
        }
        chunks[chunks.length - 1]?.push(row);
        size += bytes;
      }
      for (const chunk of chunks) {
        const res = await call<{ dir: string; files: string[] }>({
          machine: machine.id,
          method: "exportCards",
          params: { repos: chunk },
          summary: `${chunk.length} 個の repo のカードを、カンバン用のプラグインの置き場に書き出す`,
        });
        if (!res.ok) failed.push(`${ready.length > 1 ? `${machine.name}：` : ""}${res.error}`);
        else {
          repos += chunk.length;
          if (!dirs.includes(res.data.dir)) dirs.push(res.data.dir);
        }
      }
    }
    setExporting(false);
    setNotice(
      failed.length > 0
        ? { text: `カードを書き出せませんでした：${failed.join("、")}`, tone: "danger" }
        : { text: `${repos} 個の repo のカードを ${dirs.join("、")} に書き出しました` },
    );
  };

  return (
    <MotionConfig reducedMotion="user">
      <CardActionsContext.Provider value={actions}>
        {machines.map((m) => (
          <BoardSource key={m.id} machine={m} refreshAsk={refreshAsk} onChange={onSource} />
        ))}
        {/* On a computer the board fills the page's height and each column scrolls by itself; on a phone the page scrolls. */}
        <div className={cn("flex flex-col gap-4 p-4 md:p-6", wide && showBoard && "h-full min-h-0")}>
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">カンバン</h1>
              <p className="text-sm text-muted-foreground">{firstLoad ? "読み込み中…" : `${watched} 個の repo・${cards.length} 枚のカード`}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {watched > 0 && (
                <Badge variant="outline" tone={stale ? "danger" : "neutral"} dot={stale} title="working server が最後に repo を読んだ時刻">
                  {updatedAt === undefined ? "まだ読んでいない" : stale ? `${time(updatedAt)} から更新されていない` : `${time(updatedAt)} 更新`}
                </Badge>
              )}
              <Button size="sm" leftIcon={<Settings2 />} onClick={() => setChoosing(true)} disabled={ready.length === 0}>
                見る repo
              </Button>
              {watched > 0 && (
                <Button
                  size="sm"
                  leftIcon={<FileDown />}
                  isLoading={exporting}
                  loadingText="書き出し中…"
                  disabled={boards.length === 0}
                  title="カードと fetch の結果を、working server のカンバン用のプラグインの置き場（cards/）に JSON で書き出す。置き場で node check.ts を流すと、state を当てた結果を一覧にできる"
                  onClick={() => void exportCards()}
                >
                  カードを書き出す
                </Button>
              )}
              {watched > 0 && (
                <Button
                  size="sm"
                  leftIcon={<RefreshCw />}
                  isLoading={checking}
                  loadingText="見直し中…"
                  disabled={ready.length === 0}
                  onClick={() => {
                    setAsked(true);
                    setRefreshAsk((n) => n + 1);
                  }}
                >
                  今すぐ見直す
                </Button>
              )}
            </div>
          </header>

          <Headings rows={headings} now={now} />

          {problems.length > 0 && (
            <Alert tone="danger">
              <AlertTitle>読み込めないカンバン用のプラグインがあります</AlertTitle>
              <AlertDescription>
                <ul className="space-y-0.5">
                  {problems.map((p, i) => (
                    <li key={`${p.machine.id}/${p.plugin ?? ""}/${i}`} className="break-words">
                      {ready.length > 1 && `${p.machine.name} · `}
                      {p.file && (
                        <code className="text-neutral-900 dark:text-neutral-200">
                          {p.file}
                          {p.line !== undefined && `:${p.line}`}
                        </code>
                      )}
                      {p.file && "："}
                      {p.error}
                    </li>
                  ))}
                </ul>
                <p className="mt-1">ファイルを直して保存すると、読み込み直します。それまで、そのプラグインを選んだ repo のカードは「自分の番」に置きます。</p>
              </AlertDescription>
            </Alert>
          )}

          {errors.length > 0 && (
            <Alert tone="danger">
              <AlertTitle>読めなかった repo があります</AlertTitle>
              <AlertDescription>
                <ul className="space-y-0.5">
                  {errors.map((e) => (
                    <li key={`${e.machine.id}/${e.path}`} className="break-words">
                      {ready.length > 1 && `${e.machine.name} · `}
                      <span className="text-neutral-900 dark:text-neutral-200">{e.repo}</span>：{e.error}
                    </li>
                  ))}
                </ul>
                <p className="mt-1">前に読めたカードは、そのまま出しています。</p>
              </AlertDescription>
            </Alert>
          )}
          {paused.length > 0 && (
            <Alert tone="warning">
              <AlertTitle>GitHub の API の残りが少ないので、カンバン用のプラグインの fetch を止めています</AlertTitle>
              <AlertDescription>
                {paused.map((p) => `${ready.length > 1 ? `${p.machine.name}：` : ""}${time(p.until)}`).join("、")}
                に再開します。それまでは、前に fetch で読んだ情報でカードの列を決めます。
              </AlertDescription>
            </Alert>
          )}
          {failed.length > 0 && (
            <Alert tone="danger">
              <AlertTitle>カンバンを読み込めなかった working server があります</AlertTitle>
              <AlertDescription>
                <ul className="space-y-0.5">
                  {failed.map((f) => (
                    <li key={f.machine.id} className="break-words">
                      {f.machine.name}：{f.error}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          {unavailable.length > 0 && (
            <Alert tone="warning">
              <AlertTitle>カンバンを使えない working server があります</AlertTitle>
              <AlertDescription>
                <ul className="space-y-0.5">
                  {unavailable.map((m) => (
                    <li key={m.id} className="break-words">
                      {m.name}：{sources[m.id]?.reason ?? "カンバンの daemon の部分が動いていません。"}
                    </li>
                  ))}
                </ul>
                <p className="mt-1">
                  <a href="#/plugins" className="underline underline-offset-2 hover:text-foreground">
                    プラグインの画面
                  </a>
                  で、カンバンの状態を見られます。
                </p>
              </AlertDescription>
            </Alert>
          )}
          {offline.length > 0 && (
            <Alert>
              <AlertTitle>オフラインの working server があります</AlertTitle>
              <AlertDescription>{offline.map((m) => m.name).join("、")} の repo のカードは、つながるまで出しません。</AlertDescription>
            </Alert>
          )}

          {firstLoad ? (
            <FirstLoad />
          ) : !showBoard ? (
            <EmptyState canChoose={ready.length > 0} onChoose={() => setChoosing(true)} />
          ) : wide ? (
            <LayoutGroup>
              {/* layoutScroll: cards that move between columns start from where they show, however far the board scrolled. */}
              <motion.div layoutScroll className="-mx-4 min-h-0 flex-1 overflow-x-auto pb-2 pl-4 md:-mx-6 md:pl-6">
                <div className="flex h-full w-max gap-3 pr-4 md:pr-6">
                  {KANBAN_COLUMNS.map((col) => (
                    <Column key={col.id} id={col.id} label={col.label} rows={byColumn(col.id)} loading={loading} now={now} where={where} prefs={prefs} wide />
                  ))}
                </div>
              </motion.div>
            </LayoutGroup>
          ) : (
            <div className="flex flex-col gap-3">
              <ColumnTabs value={tab} onChange={setTab} count={(id) => byColumn(id).length} />
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={motionTransitions.springGentle}>
                  <Column
                    id={tab}
                    label={KANBAN_COLUMNS.find((c) => c.id === tab)?.label ?? ""}
                    rows={byColumn(tab)}
                    loading={loading}
                    now={now}
                    where={where}
                    prefs={prefs}
                  />
                </motion.div>
              </AnimatePresence>
            </div>
          )}

          <ReposDialog
            open={choosing}
            onClose={() => setChoosing(false)}
            machines={ready}
            watched={(id) => {
              const board = sources[id]?.board;
              return board && { paths: board.watched, plugins: board.plugins ?? {} };
            }}
            pluginSet={(id) => sources[id]?.pluginSet}
            reload={(id) => sources[id]?.reload()}
          />
          <TrustDialog question={trust} onAnswer={answerTrust} />
          <Toast
            notice={notice}
            onClose={() => setNotice(undefined)}
            onOpen={(s) => {
              setNotice(undefined);
              nav.openSession(s.machine, s.sessionId);
            }}
          />
        </div>
      </CardActionsContext.Provider>
    </MotionConfig>
  );
}

const HEADING =
  "inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-lg border border-black/[0.08] bg-black/[0.015] px-2.5 text-xs whitespace-nowrap text-neutral-600 dark:border-white/[0.08] dark:bg-white/[0.02] dark:text-neutral-400";
const HEADING_ACTIVE = "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300";

/**
 * The headings the repositories' board plugins give above the board (the worktree that deployed to each Stack last),
 * named by their working server and repository when there are several.
 */
function Headings({ rows, now }: { rows: RepoHeadings[]; now: number }) {
  if (rows.every((r) => r.headings.length === 0 && !r.error)) return null;
  const machines = new Set(rows.map((r) => r.machine.id)).size > 1;
  const repos = new Set(rows.map((r) => r.repo)).size > 1;
  return (
    <div role="group" aria-label="カンバン用のプラグインの見出し" className="-mt-1 flex flex-wrap items-center gap-2">
      {rows.flatMap((r) => {
        const from = [machines && r.machine.name, repos && r.repo.split("/").pop()].filter(Boolean).join(" · ");
        const key = `${r.machine.id}/${r.repo}`;
        const source = from && <span className="shrink-0 text-neutral-500">{from}</span>;
        if (r.error) {
          return (
            <span key={key} className={cn(HEADING, HEADING_ACTIVE)} title={r.error}>
              {source}
              <span className="truncate">見出しを出せませんでした（{r.plugin}）</span>
            </span>
          );
        }
        return r.headings.map((h, i) => (
          <span key={`${key}/${i}`} className={cn(HEADING, h.active && HEADING_ACTIVE)} title={h.detail}>
            {h.active && <span className="size-1.5 shrink-0 rounded-full bg-amber-500 motion-safe:animate-pulse" />}
            {source}
            <b className="shrink-0 font-medium text-neutral-900 dark:text-neutral-100">{h.label}</b>
            {h.text && <span className="truncate">{h.text}</span>}
            {h.at !== undefined && !h.active && <span className="shrink-0 text-neutral-500 tabular-nums">{relativeTime(h.at, now)}</span>}
          </span>
        ));
      })}
    </div>
  );
}

function ColumnDot({ id }: { id: KanbanColumn }) {
  const look = COLUMN_LOOK[id];
  return (
    <span className="relative inline-flex size-2 shrink-0">
      {look.pulse && <span className={cn("absolute inline-flex size-full rounded-full opacity-60 motion-safe:animate-ping", look.dot)} />}
      <span className={cn("relative inline-flex size-2 rounded-full", look.dot)} />
    </span>
  );
}

/**
 * One column. `wide`: on the board of a computer, with its heading, a width that can be changed, and its own scroll
 * once its cards pass the bottom of the page; on a phone the tab above names the column and counts its cards, and the
 * column takes the screen's width.
 */
function Column({
  id,
  label,
  rows,
  loading,
  now,
  where,
  prefs,
  wide = false,
}: {
  id: KanbanColumn;
  label: string;
  rows: PlacedCard[];
  loading: boolean;
  now: number;
  where: Where;
  prefs: KanbanPrefs;
  wide?: boolean;
}) {
  // The width while its grip is dragged; stored only when the drag ends.
  const [dragged, setDragged] = useState<number>();
  const width = dragged ?? columnWidth(prefs, id);
  const compact = columnCompact(prefs, id);
  const sort = prefs.sort[id];
  const shown = arrangeCards(rows, sort);
  const column = (
    <section
      aria-label={`${label}：${rows.length} 枚`}
      className={cn(TILE, "relative flex min-w-0 flex-col", wide ? "max-h-full min-h-0" : "pt-2")}
      style={{ boxShadow: TILE_SHADOW }}
    >
      {wide && (
        <h2 className="flex shrink-0 items-center gap-2 px-3.5 pt-3 pb-2 text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
          <ColumnDot id={id} />
          <span className="truncate">{label}</span>
          <Badge tone={rows.length > 0 ? COLUMN_LOOK[id].tone : "neutral"} className="ml-auto h-5 px-2">
            {rows.length}
          </Badge>
        </h2>
      )}
      <div className="flex shrink-0 items-center gap-1.5 px-2.5 pb-2">
        <SortMenu label={label} sort={sort} onChange={(next) => setColumnSort(id, next)} />
        <ModeSwitch id={id} label={label} compact={compact} onChange={(c) => setColumnCompact(id, c)} />
      </div>
      <motion.div
        layoutScroll
        className={cn(
          "relative flex flex-col px-2 pb-2",
          compact ? "gap-1" : "gap-2",
          // Sideways scrolling over a column goes on to the board.
          wide && "scrollbar-none min-h-0 overflow-x-hidden overflow-y-auto overscroll-y-contain",
        )}
      >
        {loading && rows.length === 0 ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-black/[0.08] px-3 py-5 text-center text-xs text-neutral-500 dark:border-white/[0.06]">なし</p>
        ) : (
          <AnimatePresence initial={false} mode="popLayout">
            {shown.map((row) => (
              <motion.div
                key={`${row.machine.id}/${row.card.id}`}
                // Only the position glides: a width or a view that changes shows at once, without the card stretching.
                layout="position"
                layoutId={`kanban/${row.machine.id}/${row.card.id}`}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={motionTransitions.springSmooth}
              >
                {compact ? <CompactCard row={row} now={now} where={where} /> : <Card row={row} now={now} where={where} />}
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </motion.div>
    </section>
  );
  if (!wide) return column;
  // On the board, the grip sits beside the column in a box as tall as the board, so it is as long in every column
  // however many cards each holds.
  return (
    <div className="relative flex shrink-0 flex-col" style={{ width }}>
      {column}
      <Grip
        label={label}
        width={width}
        onDrag={setDragged}
        onDone={(w) => {
          setDragged(undefined);
          setColumnWidth(id, w);
        }}
      />
    </div>
  );
}

/** The grip on a column's right edge: drag it, or use ← → (with Shift, four times as far); a double click goes back. */
function Grip({
  label,
  width,
  onDrag,
  onDone,
}: {
  label: string;
  width: number;
  /** The width while dragging; undefined when a press ends without a move. */
  onDrag: (w: number | undefined) => void;
  /** The width chosen; undefined goes back to the default one. */
  onDone: (w: number | undefined) => void;
}) {
  const from = useRef<{ x: number; width: number } | null>(null);
  const [active, setActive] = useState(false);
  const at = (x: number) => clampWidth((from.current?.width ?? width) + x - (from.current?.x ?? x));
  const end = (x: number) => {
    if (!from.current) return;
    const w = at(x);
    const moved = w !== from.current.width;
    from.current = null;
    setActive(false);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    // A press without a move keeps the width as it was, the default one included.
    if (moved) onDone(w);
    else onDrag(undefined);
  };
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={`${label}の列の幅`}
      aria-valuemin={COLUMN_WIDTH.min}
      aria-valuemax={COLUMN_WIDTH.max}
      aria-valuenow={width}
      title="ドラッグか左右キーで幅を変える（ダブルクリックで元の幅）"
      className={cn(
        "absolute top-3 -right-[9px] bottom-3 z-10 w-1.5 cursor-col-resize touch-none rounded-full outline-none transition-colors hover:bg-white/20 focus-visible:bg-primary",
        active && "bg-primary hover:bg-primary",
      )}
      onPointerDown={(e) => {
        // preventDefault keeps text from being selected, but also keeps the grip from taking focus for ← →.
        e.preventDefault();
        e.currentTarget.focus();
        from.current = { x: e.clientX, width };
        e.currentTarget.setPointerCapture(e.pointerId);
        setActive(true);
        // The cursor stays a resize cursor, and no text is selected, while the pointer leaves the grip.
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(e) => {
        if (from.current) onDrag(at(e.clientX));
      }}
      onPointerUp={(e) => end(e.clientX)}
      onPointerCancel={(e) => end(e.clientX)}
      onDoubleClick={() => onDone(undefined)}
      onKeyDown={(e) => {
        const step = ({ ArrowLeft: -16, ArrowRight: 16 } as Record<string, number>)[e.key];
        if (!step) return;
        e.preventDefault();
        onDone(clampWidth(width + step * (e.shiftKey ? 4 : 1)));
      }}
    />
  );
}

const BAR_BUTTON =
  "inline-flex h-6 cursor-pointer items-center gap-1 rounded-md border px-1.5 text-[11px] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

/** The order of a column's cards: the default one, or Issue number, PR number or last update, either way. */
function SortMenu({ label, sort, onChange }: { label: string; sort: KanbanSort | undefined; onChange: (sort: KanbanSort | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const name = sort ? `${KANBAN_SORTS[sort.key].short} ${sort.desc ? "降順" : "昇順"}` : "既定の順";
  const pick = (next: KanbanSort | undefined) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`${label}の並び：${name}`}
          title={`並びを変える（今は${name}）`}
          className={cn(
            BAR_BUTTON,
            sort
              ? "border-border-hover bg-surface-raised text-foreground"
              : "border-transparent text-neutral-500 hover:border-border hover:text-neutral-300 data-[state=open]:border-border data-[state=open]:text-neutral-300",
          )}
        >
          <ArrowUpDown className="size-3.5" />
          {sort && name}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-64 rounded-xl border border-border bg-surface p-1.5 text-xs shadow-xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <button
            type="button"
            aria-pressed={!sort}
            onClick={() => pick(undefined)}
            className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-neutral-300 hover:bg-surface-raised aria-pressed:text-foreground"
          >
            <Check className={cn("size-3.5", sort && "invisible")} />
            既定の順
            <span className="ml-auto text-[11px] text-muted-foreground">更新の古い順</span>
          </button>
          <div className="mt-1 space-y-0.5 border-t border-border pt-1">
            {(Object.keys(KANBAN_SORTS) as KanbanSortKey[]).map((key) => (
              <div key={key} role="group" aria-label={KANBAN_SORTS[key].label} className="flex items-center gap-2 px-2 py-1">
                <Check className={cn("size-3.5 shrink-0", sort?.key !== key && "invisible")} />
                <span className="flex-1 text-neutral-300">{KANBAN_SORTS[key].label}</span>
                <span className="inline-flex rounded-md border border-border p-0.5">
                  {[false, true].map((desc) => {
                    const on = sort?.key === key && sort.desc === desc;
                    return (
                      <button
                        key={String(desc)}
                        type="button"
                        aria-pressed={on}
                        title={desc ? KANBAN_SORTS[key].desc : KANBAN_SORTS[key].asc}
                        onClick={() => pick({ key, desc })}
                        className={cn(
                          "cursor-pointer rounded-[5px] px-2 py-0.5 text-[11px] transition-colors",
                          on ? "bg-primary text-primary-foreground" : "text-neutral-400 hover:bg-surface-raised hover:text-foreground",
                        )}
                      >
                        {desc ? "降順" : "昇順"}
                      </button>
                    );
                  })}
                </span>
              </div>
            ))}
          </div>
          <p className="px-2 pt-1.5 pb-0.5 text-[11px] leading-relaxed text-muted-foreground">番号や更新の時刻が無いカードは、どちらの向きでも下に並べます。</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** 詳細 (the full card) or 簡潔 (one line), with a pill that slides to the one chosen. */
function ModeSwitch({ id, label, compact, onChange }: { id: KanbanColumn; label: string; compact: boolean; onChange: (compact: boolean) => void }) {
  return (
    <div role="group" aria-label={`${label}の表示`} className="ml-auto inline-flex rounded-md border border-border p-0.5">
      {[false, true].map((c) => {
        const on = compact === c;
        return (
          <button
            key={String(c)}
            type="button"
            aria-pressed={on}
            title={c ? "1 行で表示する" : "PR の題・Issue・会話の状態も表示する"}
            onClick={() => onChange(c)}
            className={cn("relative cursor-pointer rounded-[5px] px-2 py-0.5 text-[11px] transition-colors", on ? "text-foreground" : "text-neutral-500 hover:text-neutral-300")}
          >
            {on && <motion.span layoutId={`kanban-mode/${id}`} transition={motionTransitions.springMorph} className="absolute inset-0 rounded-[5px] bg-surface-raised" />}
            <span className="relative">{c ? "簡潔" : "詳細"}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The columns as tabs, for a phone: a pill slides to the one shown (after EasyUI's Animated Tabs). */
function ColumnTabs({ value, onChange, count }: { value: KanbanColumn; onChange: (id: KanbanColumn) => void; count: (id: KanbanColumn) => number }) {
  return (
    <div className="scrollbar-none -mx-4 overflow-x-auto px-4">
      <div role="tablist" aria-label="列" className="inline-flex gap-1 rounded-full border border-border bg-surface-raised p-1 dark:border-neutral-800 dark:bg-neutral-950">
        {KANBAN_COLUMNS.map((c) => {
          const active = c.id === value;
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(c.id)}
              className={cn(
                "relative flex cursor-pointer items-center rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
                active ? "text-foreground" : "text-neutral-500 hover:text-neutral-300",
              )}
            >
              {active && (
                <motion.span
                  layoutId="kanban-column-tab"
                  transition={motionTransitions.springMorph}
                  className="absolute inset-0 rounded-full border border-border-hover bg-surface shadow-xs dark:border-neutral-800 dark:bg-neutral-900"
                />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                <ColumnDot id={c.id} />
                {c.label}
                <span className="text-[11px] text-neutral-500 tabular-nums">{count(c.id)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FirstLoad() {
  return (
    <div role="status" className={cn(TILE, "flex items-center justify-center gap-2 px-6 py-12 text-sm text-muted-foreground")} style={{ boxShadow: TILE_SHADOW }}>
      <LoaderCircle className="size-4 motion-safe:animate-spin" />
      working server からカンバンを読み込んでいます…
    </div>
  );
}

function EmptyState({ canChoose, onChoose }: { canChoose: boolean; onChoose: () => void }) {
  return (
    <div className={cn(TILE, "flex flex-col items-center gap-4 px-6 py-12 text-center")} style={{ boxShadow: TILE_SHADOW }}>
      <span className="grid size-11 place-items-center rounded-xl border border-black/[0.08] bg-black/[0.02] text-neutral-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-neutral-300">
        <SquareKanban className="size-5" />
      </span>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">見る repo を選んでください</p>
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
          選んだ repo の worktree と自分の Pull request を、次に動く人ごとの列に並べます。選べるのは、working server で Claude Code が信頼しているフォルダーにある repo です。
        </p>
      </div>
      <Button variant="primary" size="sm" leftIcon={<Settings2 />} onClick={onChoose} disabled={!canChoose}>
        見る repo を選ぶ
      </Button>
      {!canChoose && <p className="text-xs text-muted-foreground">選べる working server がありません。カンバンの daemon の部分が動く working server がつながると選べます。</p>}
    </div>
  );
}

/** Claude Code asks whether to trust a card's folder before a session starts there: the person answers here. */
function TrustDialog({ question, onAnswer }: { question: { path: string; warnings: string[] } | undefined; onAnswer: (yes: boolean) => void }) {
  return (
    <Dialog.Root open={Boolean(question)} onOpenChange={(next) => !next && onAnswer(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className={DIALOG_OVERLAY} />
        <Dialog.Content className={cn(DIALOG_PANEL, "flex flex-col gap-4")}>
          <div className="space-y-1.5">
            <Dialog.Title className="text-base font-semibold tracking-tight">このフォルダーを信頼しますか</Dialog.Title>
            <Dialog.Description className="text-xs leading-relaxed text-muted-foreground">
              Claude Code は、このフォルダーをまだ信頼していません。信頼すると、セッションはこのフォルダーのファイルを読み書きし、コマンドを実行できます。
            </Dialog.Description>
          </div>
          <p className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs break-all">{question?.path}</p>
          {(question?.warnings.length ?? 0) > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-700 dark:text-amber-300">
              {question?.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button size="sm" onClick={() => onAnswer(false)}>
              やめる
            </Button>
            <Button size="sm" variant="primary" onClick={() => onAnswer(true)}>
              信頼して起動する
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A notice at the bottom of the page (after EasyUI's VelocityToast); it goes after a few seconds once nothing is going on. */
function Toast({ notice, onClose, onOpen }: { notice: Notice | undefined; onClose: () => void; onOpen: (s: { machine: string; sessionId: string }) => void }) {
  useEffect(() => {
    if (!notice || notice.busy) return;
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
    // Restarts only for a new notice.
  }, [notice]);
  return (
    <AnimatePresence>
      {notice && (
        <motion.div
          key={notice.text}
          role={notice.tone === "danger" ? "alert" : "status"}
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={motionTransitions.springSnappy}
          className={cn(
            "fixed bottom-4 left-1/2 z-[95] flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl border bg-surface px-4 py-2.5 text-sm shadow-xl",
            notice.tone === "danger" ? "border-red-500/40 text-red-300" : "border-border text-foreground",
          )}
        >
          {notice.busy && <LoaderCircle className="size-4 shrink-0 text-muted-foreground motion-safe:animate-spin" />}
          <span className="min-w-0">{notice.text}</span>
          {notice.session && !notice.busy && (
            <button
              type="button"
              onClick={() => notice.session && onOpen(notice.session)}
              className="shrink-0 cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              セッションを開く
            </button>
          )}
          {!notice.busy && (
            <button type="button" onClick={onClose} aria-label="閉じる" className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
