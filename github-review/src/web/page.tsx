// The review page (P2): above, the open pull requests GitHub asks me to review (all of GitHub); below, those of the
// repositories each working server watches, and those that have a review worktree. One search box narrows both, in the
// words of GitHub's list of pull requests. Every working server's daemon part is asked once a minute while the page shows.
// Pressing a row opens the pull request's panel ("pr", detail.tsx) beside the page, as a session's panel opens.
import { MotionConfig } from "framer-motion";
import { RefreshCw, Search, Settings2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Page, useNavigation, useNow, usePluginState, type PageProps } from "@gasho/plugin-sdk";
import { MAX_QUERY } from "../types.ts";
import { reviewAll, type BatchStep, type Item } from "./actions";
import { BatchDialog, BatchMenu, type BatchChoice } from "./batch";
import { prKey } from "./detail";
import { DEFAULT_QUERY, useListings } from "./listing";
import { ReposDialog } from "./repos-dialog";
import { PrItemRow, RowContext } from "./row";
import { useRowShell } from "./shell";
import { Alert, AlertDescription, AlertTitle, Button, Skeleton } from "./ui/parts";

export function ReviewPage(_: PageProps) {
  const now = useNow(30_000);
  const nav = useNavigation();
  const [query, setQuery] = usePluginState("query", DEFAULT_QUERY);
  const [draft, setDraft] = useState(query);
  const [freshAsk, setFreshAsk] = useState(0);
  const [choosing, setChoosing] = useState(false);
  const [batch, setBatch] = useState<{ choice: BatchChoice; steps?: Record<string, BatchStep>; shown: boolean }>();
  const [batchRunning, setBatchRunning] = useState(false);
  // The pull request whose panel is open (the panel says so while it is open).
  const [open] = usePluginState<string | null>("openPr", null);
  const { sourcesEl, machines, sources, ready, page, pending, refreshing } = useListings(query, freshAsk);
  const watched = ready.reduce((n, m) => n + (sources[m.id]?.listing?.watched.length ?? 0), 0);
  const errors = ready.flatMap((m) => {
    const s = sources[m.id];
    return [...(s?.error ? [s.error] : []), ...(s?.listing?.errors ?? [])].map((e) => (machines.length > 1 ? `${m.name}：${e}` : e));
  });
  const unavailable = machines.filter((m) => m.connected && sources[m.id] && !sources[m.id]?.ready);
  // Pressing the row of the pull request whose panel is open closes it; another row shows its own in its place.
  const select = (item: Item) => {
    const { repo, number } = item.pr;
    if (open === prKey(repo, number)) nav.closePanel();
    else if (open) nav.replacePanel("pr", { repo, number: String(number) });
    else nav.openPanel("pr", { repo, number: String(number) });
  };
  const selected = open ? [...page.requested, ...page.groups.flatMap((g) => g.items)].find((i) => prKey(i.pr.repo, i.pr.number) === open)?.pr.url : undefined;
  const { shared, overlays, runMany } = useRowShell({ sources, ready, select, ...(selected ? { selected } : {}) });
  /** "まとめてレビューさせる": the rows of the pull requests it does stay off until each is done. */
  const startBatch = (targets: BatchChoice["targets"]) => {
    if (!batch || batchRunning) return;
    const urls = targets.map((x) => x.item.pr.url);
    setBatch({ ...batch, steps: Object.fromEntries(urls.map((u) => [u, { state: "waiting" }])) });
    setBatchRunning(true);
    void runMany(urls, async (release) => {
      await reviewAll(targets, batch.choice.template, shared.tools, (url, step) => {
        setBatch((cur) => (cur?.steps ? { ...cur, steps: { ...cur.steps, [url]: step } } : cur));
        if (step.state !== "working") release(url);
      });
    }).finally(() => setBatchRunning(false));
  };
  const search = () => {
    const q = draft.trim().slice(0, MAX_QUERY);
    setDraft(q);
    if (q !== query) setQuery(q);
  };

  const list = (
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

        <Section
          title="レビューを頼まれた Pull request"
          count={page.requested.length}
          more={page.requestedMore}
          loading={pending && page.requested.length === 0}
          action={
            <BatchMenu
              items={page.requested}
              machines={ready}
              templates={shared.templates}
              disabled={batchRunning || page.requested.some((i) => shared.busy.has(i.pr.url))}
              onPick={(choice) => setBatch({ choice, shown: true })}
            />
          }
        >
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
    </Page>
  );

  return (
    <MotionConfig reducedMotion="user">
      {sourcesEl}
      <RowContext.Provider value={shared}>{list}</RowContext.Provider>
      <ReposDialog
        open={choosing}
        onClose={() => setChoosing(false)}
        machines={ready}
        watched={(id) => sources[id]?.listing?.watched}
        reload={(id) => sources[id]?.reload()}
      />
      <BatchDialog
        choice={batch?.shown ? batch.choice : undefined}
        steps={batch?.steps}
        running={batchRunning}
        onStart={startBatch}
        onOpen={(sessionId) => batch && nav.openSession(batch.choice.machine.id, sessionId)}
        onClose={() => setBatch((cur) => (cur && batchRunning ? { ...cur, shown: false } : undefined))}
      />
      {overlays}
    </MotionConfig>
  );
}

function Section({ title, count, more, loading, action, children }: { title: string; count: number; more: number; loading: boolean; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-baseline gap-2 text-sm font-semibold">
          {title}
          {!loading && <span className="text-xs font-normal text-muted-foreground tabular-nums">{count} 件</span>}
        </h2>
        {!loading && action}
      </div>
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
