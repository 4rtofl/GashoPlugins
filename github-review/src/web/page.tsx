// The review page (P2): above, the open pull requests GitHub asks me to review (all of GitHub); below, those of the
// repositories each working server watches, and those that have a review worktree. One search box narrows both, in the
// words of GitHub's list of pull requests. Every working server's daemon part is asked once a minute while the page shows.
import { MotionConfig } from "framer-motion";
import { RefreshCw, Search, Settings2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Page,
  useCall,
  useDaemonReady,
  useLaunchSession,
  useMachines,
  useNavigation,
  useNow,
  usePluginState,
  useRequest,
  useSendInput,
  useSetting,
  type MachineInfo,
  type PageProps,
} from "@gasho/plugin-sdk";
import { pageItems } from "../items.ts";
import { parseTemplates } from "../template.ts";
import { MAX_QUERY, type Listing } from "../types.ts";
import type { Actions, Item, Notice, Spot, Tools } from "./actions";
import { RemoveDialog, Toast, TrustDialog } from "./dialogs";
import { ReposDialog } from "./repos-dialog";
import { PrItemRow, RowContext, type RowShared } from "./row";
import { Alert, AlertDescription, AlertTitle, Button, Skeleton } from "./ui/parts";

/** How often the page asks for the lists, in seconds. */
const ASK_SECONDS = 60;
const DEFAULT_QUERY = "is:open";

/** What the page knows of one working server's list. */
interface Source {
  ready: boolean;
  reason?: string;
  listing?: Listing;
  error?: string;
  refreshing: boolean;
  reload: () => void;
}

/**
 * Asks one working server's daemon part for its list, and tells the page. A component per working server, as hooks
 * cannot be called for a list that changes; it draws nothing.
 */
function ListingSource({ machine, query, freshAsk, onChange }: { machine: MachineInfo; query: string; freshAsk: number; onChange: (id: string, s: Source | undefined) => void }) {
  const daemon = useDaemonReady(machine.id);
  const on = machine.connected && daemon.ready;
  const r = useRequest<Listing>(on ? { machine: machine.id, method: "list", params: { query } } : undefined, { staleSeconds: ASK_SECONDS, refreshSeconds: ASK_SECONDS });
  const call = useCall();
  const { reload } = r;
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string>();
  const asked = useRef(freshAsk);
  useEffect(() => {
    if (freshAsk === asked.current || !on) return;
    asked.current = freshAsk;
    let live = true;
    setRefreshing(true);
    // Reads GitHub again; the list asked for next gets what gasho-daemon kept of that.
    void call<Listing>({ machine: machine.id, method: "list", params: { query, fresh: true } }).then((res) => {
      if (!live) return;
      setRefreshing(false);
      setRefreshError(res.ok ? undefined : res.error);
      reload();
    });
    return () => {
      live = false;
    };
  }, [freshAsk]);
  useEffect(() => setRefreshError(undefined), [query]);

  const error = refreshError ?? r.error;
  useEffect(() => {
    onChange(machine.id, { ready: on, ...(daemon.reason ? { reason: daemon.reason } : {}), listing: r.data, ...(error ? { error } : {}), refreshing, reload });
  }, [machine.id, on, daemon.reason, r.data, error, refreshing, reload, onChange]);
  useEffect(() => () => onChange(machine.id, undefined), [machine.id, onChange]);
  return null;
}

export function ReviewPage(_: PageProps) {
  const machines = useMachines();
  const now = useNow(30_000);
  const nav = useNavigation();
  const call = useCall();
  const launch = useLaunchSession();
  const send = useSendInput();
  const [rawTemplates] = useSetting<string>("templates");
  const templates = useMemo(() => parseTemplates(rawTemplates), [rawTemplates]);
  const [query, setQuery] = usePluginState("query", DEFAULT_QUERY);
  const [draft, setDraft] = useState(query);
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
  const [freshAsk, setFreshAsk] = useState(0);
  const [choosing, setChoosing] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [trust, setTrust] = useState<{ path: string; warnings: string[]; answer: (yes: boolean) => void }>();
  const [removing, setRemoving] = useState<{ item: Item; spot: Spot; answer: (yes: boolean) => void }>();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  const ready = machines.filter((m) => m.connected && sources[m.id]?.ready);
  const lists = ready.flatMap((machine) => {
    const listing = sources[machine.id]?.listing;
    return listing ? [{ machine, listing }] : [];
  });
  const page = useMemo(() => pageItems(lists), [machines, sources]);
  const watched = lists.reduce((n, l) => n + l.listing.watched.length, 0);
  const pending = ready.some((m) => !sources[m.id]?.listing && !sources[m.id]?.error);
  const refreshing = ready.some((m) => sources[m.id]?.refreshing);
  const errors = ready.flatMap((m) => {
    const s = sources[m.id];
    return [...(s?.error ? [s.error] : []), ...(s?.listing?.errors ?? [])].map((e) => (machines.length > 1 ? `${m.name}：${e}` : e));
  });
  const unavailable = machines.filter((m) => m.connected && sources[m.id] && !sources[m.id]?.ready);

  const tools = useMemo<Tools>(() => {
    const actions: Actions = {
      notify: setNotice,
      askTrust: (q) => new Promise<boolean>((resolve) => setTrust({ ...q, answer: resolve })),
      askRemove: (q) => new Promise<boolean>((resolve) => setRemoving({ ...q, answer: resolve })),
      reload: (id) => sources[id]?.reload(),
    };
    return { call, launch, send, nav, actions };
  }, [call, launch, send, nav, sources]);
  const shared: RowShared = {
    tools,
    templates,
    busy,
    machines: ready.length > 1,
    run: (url, work) => {
      setBusy((cur) => new Set(cur).add(url));
      void work()
        .catch((e: unknown) => setNotice({ text: e instanceof Error ? e.message : String(e), tone: "danger" }))
        .finally(() =>
          setBusy((cur) => {
            const next = new Set(cur);
            next.delete(url);
            return next;
          }),
        );
    },
  };
  const search = () => {
    const q = draft.trim().slice(0, MAX_QUERY);
    setDraft(q);
    if (q !== query) setQuery(q);
  };

  return (
    <MotionConfig reducedMotion="user">
      {machines.map((m) => (
        <ListingSource key={m.id} machine={m} query={query} freshAsk={freshAsk} onChange={onSource} />
      ))}
      <Page
        title="レビュー"
        description="レビューを頼まれた Pull request と、対象リポジトリの Pull request。worktree を作ると、その中でセッションを起動して開きます。"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" leftIcon={<Settings2 />} onClick={() => setChoosing(true)} disabled={ready.length === 0}>
              対象リポジトリ
            </Button>
            <Button size="sm" leftIcon={<RefreshCw />} isLoading={refreshing} loadingText="更新中…" disabled={ready.length === 0} onClick={() => setFreshAsk((n) => n + 1)}>
              更新
            </Button>
          </div>
        }
      >
        <RowContext.Provider value={shared}>
          <div className="space-y-6">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                search();
              }}
            >
              <div className="flex gap-2">
                <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm transition-colors focus-within:border-border-hover">
                  <Search className="size-4 shrink-0 text-muted-foreground" />
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    maxLength={MAX_QUERY}
                    placeholder="is:open author:octocat label:bug"
                    aria-label="Pull request を探す"
                    className="min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:text-muted-foreground"
                    spellCheck={false}
                  />
                </label>
                <Button type="submit" size="md" className="h-9 w-9 px-0" leftIcon={<Search />} aria-label="検索" title="検索" />
              </div>
            </form>

            {ready.length === 0 && (
              <Alert>
                <AlertTitle>使える working server がありません</AlertTitle>
                <AlertDescription>
                  github-review の daemon の部分が動く working server がつながると、Pull request を読みます。
                  {unavailable.map((m) => (
                    <span key={m.id} className="block">
                      {m.name}：{sources[m.id]?.reason ?? "daemon の部分を使えません。"}
                    </span>
                  ))}
                </AlertDescription>
              </Alert>
            )}
            {errors.length > 0 && (
              <Alert tone="warning">
                <AlertTitle>読めなかったものがあります</AlertTitle>
                <AlertDescription>
                  {errors.map((e) => (
                    <span key={e} className="block break-words">
                      {e}
                    </span>
                  ))}
                </AlertDescription>
              </Alert>
            )}

            <Section title="レビューを頼まれた Pull request" count={page.requested.length} more={page.requestedMore} loading={pending && page.requested.length === 0}>
              {page.requested.length === 0 ? (
                <Empty>{query ? "検索の語に合う、レビューを頼まれた Pull request はありません。" : "レビューを頼まれた Pull request はありません。"}</Empty>
              ) : (
                <Rows items={page.requested} now={now} showRepo />
              )}
            </Section>

            <Section title="対象リポジトリの Pull request" count={page.groups.reduce((n, g) => n + g.items.length, 0)} more={page.watchedMore} loading={pending && page.groups.length === 0}>
              {watched === 0 && page.groups.length === 0 && !pending ? (
                <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border px-4 py-5">
                  <p className="text-sm text-muted-foreground">対象リポジトリを選ぶと、そのリポジトリの Pull request をここに出します。</p>
                  <Button size="sm" variant="primary" leftIcon={<Settings2 />} onClick={() => setChoosing(true)} disabled={ready.length === 0}>
                    対象リポジトリを選ぶ
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {page.groups.map((g) => (
                    <div key={g.repo} className="space-y-1.5">
                      <h3 className="flex flex-wrap items-baseline gap-x-2 text-xs font-medium text-neutral-700 dark:text-neutral-300">
                        {g.repo}
                        {!g.watched && <span className="font-normal text-muted-foreground">対象リポジトリではありませんが、レビュー用の worktree があります</span>}
                      </h3>
                      {g.items.length === 0 ? <Empty>検索の語に合う Pull request はありません。</Empty> : <Rows items={g.items} now={now} fresh />}
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>
        </RowContext.Provider>
      </Page>
      <ReposDialog
        open={choosing}
        onClose={() => setChoosing(false)}
        machines={ready}
        watched={(id) => sources[id]?.listing?.watched}
        reload={(id) => sources[id]?.reload()}
      />
      <TrustDialog
        question={trust}
        onAnswer={(yes) => {
          trust?.answer(yes);
          setTrust(undefined);
        }}
      />
      <RemoveDialog
        question={removing}
        onAnswer={(yes) => {
          removing?.answer(yes);
          setRemoving(undefined);
        }}
      />
      <Toast notice={notice} onClose={() => setNotice(undefined)} />
    </MotionConfig>
  );
}

function Section({ title, count, more, loading, children }: { title: string; count: number; more: number; loading: boolean; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-baseline gap-2 text-sm font-semibold">
        {title}
        {!loading && <span className="text-xs font-normal text-muted-foreground tabular-nums">{count} 件</span>}
      </h2>
      {loading ? (
        <div className="space-y-2 rounded-xl border border-border p-4">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : (
        children
      )}
      {!loading && more > 0 && <p className="text-[11px] text-muted-foreground">ほかに {more} 件あります。検索の語で絞り込んでください。</p>}
    </section>
  );
}

/** `fresh`: a worktree there gets a new session ("新たにセッションを作成する") instead of opening the one used last. */
function Rows({ items, now, showRepo, fresh }: { items: Item[]; now: number; showRepo?: boolean; fresh?: boolean }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
      {items.map((item) => (
        <PrItemRow key={item.pr.url} item={item} now={now} showRepo={showRepo} fresh={fresh} />
      ))}
    </ul>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">{children}</p>;
}
