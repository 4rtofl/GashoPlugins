// The tab of one issue or pull request of a worktree: its title and state, the parts of sections/ (the buttons that
// change the state at the end of its line, the rows of assignees, labels and a pull request's branches, and blocks such
// as the merge), and the tabs of tabs/ (the conversation, and for a pull request its commits, checks and files). After
// a change, gasho-daemon drops what it kept of the repository, so reading again shows GitHub as it is now.
import { ExternalLink, Pencil, RefreshCw } from "lucide-react";
import { useRef } from "react";
import { cn, RelativeTime, useDaemonReady, useNow, usePluginState, useRequest, type WorktreeViewProps } from "@gasho/plugin-sdk";
import type { GitHubItemDetail, GitHubKind, WorktreeItems } from "../../types.ts";
import { readOp, useFreshReload } from "../daemon.ts";
import { itemsTarget, OfflineContext, useRefreshOptions } from "../tabs.ts";
import { Alert } from "../ui/alert.tsx";
import { Button, buttonClass } from "../ui/button.tsx";
import { INPUT, isComposing, useComposingEscape } from "../ui/input.ts";
import { Skeleton, SkeletonText } from "../ui/skeleton.tsx";
import { AnimatedTabs } from "../ui/tabs.tsx";
import { ToastProvider } from "../ui/toast.tsx";
import { ItemProvider, useChanges, useDraft, useDraftsOf, useItem, type Where } from "./context.tsx";
import { ItemPalette } from "./palette.tsx";
import { partsOf, type ItemSection, type ItemTab } from "./parts.ts";
import { Rows } from "./row.tsx";
import { StateBadge } from "./state-badge.tsx";

const TABS = partsOf(import.meta.glob<{ default: ItemTab }>("./tabs/*.tsx", { eager: true }));
const SECTIONS = partsOf(import.meta.glob<{ default: ItemSection }>("./sections/*.tsx", { eager: true }));

const NAME: Record<GitHubKind, string> = { issues: "Issue", pulls: "Pull request" };

export function ItemView(props: WorktreeViewProps) {
  useComposingEscape();
  // Gasho keeps one view per worktree, so moving to another number of the same worktree only changes params: the key
  // makes the screen anew, and nothing typed or asked for one number (a title, a merge's confirmation) shows on another.
  return (
    <ToastProvider>
      <ItemScreen key={`${props.params.kind}#${props.params.number}`} {...props} />
    </ToastProvider>
  );
}

function ItemScreen({ machine, worktree, params }: WorktreeViewProps) {
  const kind: GitHubKind = params.kind === "pulls" ? "pulls" : "issues";
  const number = Number(params.number);
  const valid = Number.isInteger(number) && number >= 1 && number <= 1e9;
  const daemon = useDaemonReady(machine.id);
  // Right after its working server comes back, Gasho sends the worktree without its GitHub repository for a few seconds:
  // the one known before stays, so that the screen (and what is typed on it) does not go away meanwhile.
  const lastGithub = useRef(worktree.github);
  if (worktree.github) lastGithub.current = worktree.github;
  const github = worktree.github ?? lastGithub.current;
  const repo = github ? `${github.owner}/${github.name}` : undefined;
  const clock = useNow(60_000);
  const options = useRefreshOptions();
  const where: Where | undefined = repo && valid ? { repo, kind, number } : undefined;
  useDraftsOf(machine.id, worktree, where);
  const r = useRequest<GitHubItemDetail>(daemon.ready && where ? readOp(machine.id, "item", { ...where }) : undefined, options);
  // The worktree's tabs show the title and the state: they are read again after a change too.
  const tabs = useRequest<WorktreeItems>(itemsTarget(machine.id, worktree, daemon.ready), options);
  const changes = useChanges(machine.id, where, () => {
    r.reload();
    tabs.reload();
  });
  const reload = useFreshReload(machine.id, repo, changes.changed);
  // Not before the read: what GitHub changed since the clock last ticked would read as "in 1 minute".
  const now = Math.max(clock, r.at ?? 0);
  // While the daemon part is not ready (the working server offline for a while), nothing is read and r.data is none: the
  // item read before stays on the screen, and with it what is being typed.
  const last = useRef<GitHubItemDetail>(undefined);
  if (r.data) last.current = r.data;
  const item = r.data ?? last.current;
  const url = item?.url ?? (github && valid ? `${github.url}/${kind === "issues" ? "issues" : "pull"}/${number}` : undefined);

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-5 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {NAME[kind]} #{valid ? number : "?"} · {repo ?? "GitHub のリポジトリがありません"}
        </span>
        <div className="flex items-center gap-1.5">
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className={buttonClass("ghost", "xs")}>
              GitHub <ExternalLink />
            </a>
          )}
          <Button variant="ghost" size="icon" onClick={reload} disabled={r.loading || !where || !daemon.ready} aria-label="再読み込み" title="再読み込み">
            <RefreshCw className={cn(r.loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {!valid && <Alert tone="danger">番号が正しくありません。</Alert>}
      {!github && <Alert>この worktree のリポジトリは GitHub にありません。</Alert>}
      {github && !daemon.ready && <Alert tone="warning">{daemon.reason ?? `${machine.name} で github-implement の daemon の部分が動いていません。`}</Alert>}
      {r.error && (
        <Alert
          tone="danger"
          action={
            <Button size="xs" onClick={reload} isLoading={r.loading}>
              読み直す
            </Button>
          }
        >
          {r.error}
        </Alert>
      )}
      {!item && r.loading && <DetailSkeleton />}
      {item && where && (
        <OfflineContext.Provider value={!daemon.ready}>
          <ItemProvider value={{ machine: machine.id, machineInfo: machine, worktree, where, item, now, busy: changes.busy, run: changes.run, revision: changes.revision, reload }}>
            <Detail />
            <ItemPalette worktree={worktree} />
          </ItemProvider>
        </OfflineContext.Provider>
      )}
      {r.at && <p className="text-xs text-muted-foreground">{new Date(r.at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} に読み込み</p>}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div role="status" aria-label="読み込み中" className="space-y-4">
      <Skeleton className="h-6 w-2/3" />
      <div className="flex gap-2">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-6 w-40 rounded-full" />
      </div>
      <Skeleton className="h-9 w-72 rounded-lg" />
      <div className="rounded-xl border border-border p-3">
        <SkeletonText lines={4} />
      </div>
    </div>
  );
}

function Detail() {
  const { item, where, now } = useItem();
  const tabs = TABS.filter((t) => t.kinds.includes(item.kind));
  const [chosen, setChosen] = usePluginState<string>(`tab:${where.repo}#${where.number}`, tabs[0]?.id ?? "");
  const tab = tabs.find((t) => t.id === chosen) ?? tabs[0];
  const sections = SECTIONS.filter((s) => s.kinds.includes(item.kind));
  const at = (place: ItemSection["place"]) => sections.filter((s) => s.place === place).map((s, i) => <s.View key={i} />);
  return (
    <>
      <div className="space-y-2">
        <Title />
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 text-xs text-muted-foreground">
          <StateBadge item={item} />
          <span>
            {item.author ?? "不明"} が<RelativeTime at={item.createdAt} now={now} />
            に作成
          </span>
          <span>
            更新 <RelativeTime at={item.updatedAt} now={now} />
          </span>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">{at("actions")}</div>
        </div>
      </div>
      <Rows>{at("row")}</Rows>
      {at(undefined)}
      {tab && (
        <AnimatedTabs
          label={`${NAME[item.kind]} #${item.number} の内容`}
          tabs={tabs.map((t) => {
            const Icon = t.icon;
            const badge = t.badge?.(item);
            return { id: t.id, label: t.label, ...(Icon ? { icon: <Icon /> } : {}), ...(badge !== undefined ? { badge } : {}) };
          })}
          value={tab.id}
          onChange={setChosen}
        >
          <tab.View />
        </AnimatedTabs>
      )}
    </>
  );
}

function Title() {
  const { item, where, busy, run } = useItem();
  // What is typed, and GitHub's title when the edit started: the daemon part refuses to save over another one. `over`:
  // the title a save replaced, which the item read before the save still shows until it is read again.
  const [edit, setEdit] = useDraft<{ draft: string; from: string; over?: string }>("title");
  if (edit === undefined) {
    return (
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 text-lg leading-snug font-semibold break-words">{item.title}</h2>
        <Button variant="ghost" size="icon" onClick={() => setEdit({ draft: item.title, from: item.title })} aria-label="題を変える" title="題を変える">
          <Pencil />
        </Button>
      </div>
    );
  }
  const { draft, from } = edit;
  const changed = from !== item.title && edit.over !== item.title;
  // `base`: GitHub's title the draft is saved over.
  const save = async (base: string) => {
    const sent = draft;
    const ok = await run({
      id: "title",
      op: "edit",
      params: { title: sent, was: { title: base } },
      summary: `#${where.number} の題を変える`,
      done: "題を変えました",
      undo: { op: "edit", params: { title: base }, summary: `#${where.number} の題を戻す` },
    });
    // A title changed while it was being saved stays in the box, to be saved again over the one just saved.
    if (ok) setEdit((e) => (!e || e.draft === sent ? undefined : { ...e, from: sent, over: base }));
  };
  return (
    <div className="space-y-2">
      <input
        autoFocus
        value={draft}
        onChange={(e) => setEdit({ ...edit, draft: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !isComposing(e)) {
            e.preventDefault();
            setEdit(undefined);
          }
        }}
        aria-label="題"
        className={INPUT}
        maxLength={256}
      />
      {changed && (
        <Alert tone="warning">
          <p>
            編集を始めたあとに、GitHub で題が「<span className="break-words">{item.title}</span>」に変わりました。このまま保存すると、その変更は消えます。
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="xs" onClick={() => setEdit({ draft: item.title, from: item.title })} disabled={busy !== undefined}>
              今の題から書き直す
            </Button>
            <Button size="xs" onClick={() => void save(item.title)} disabled={busy !== undefined || !draft.trim() || draft === item.title}>
              自分の題で上書きする
            </Button>
          </div>
        </Alert>
      )}
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => void save(from)} isLoading={busy === "title"} loadingText="保存しています…" disabled={busy !== undefined || changed || !draft.trim() || draft === item.title}>
          保存する
        </Button>
        <Button onClick={() => setEdit(undefined)} disabled={busy === "title"}>
          やめる
        </Button>
      </div>
    </div>
  );
}
