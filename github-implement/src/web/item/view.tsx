// The tab of one issue or pull request of a worktree: its title and state, the parts of sections/ (the buttons that
// change the state at the end of its line, the rows of assignees, labels and a pull request's branches, and blocks such
// as the merge), and the tabs of tabs/ (the conversation, and for a pull request its commits, checks and files). After
// a change, gasho-daemon drops what it kept of the repository, so reading again shows GitHub as it is now.
import { ExternalLink, Pencil, RefreshCw } from "lucide-react";
import { useState } from "react";
import { cn, RelativeTime, useDaemonReady, useNow, useRequest, type WorktreeViewProps } from "@gasho/plugin-sdk";
import type { GitHubItemDetail, GitHubKind, WorktreeItems } from "../../types.ts";
import { readOp, useFreshReload } from "../daemon.ts";
import { itemsTarget, useRefreshOptions } from "../tabs.ts";
import { Alert } from "../ui/alert.tsx";
import { Button, buttonClass } from "../ui/button.tsx";
import { INPUT } from "../ui/input.ts";
import { Skeleton, SkeletonText } from "../ui/skeleton.tsx";
import { AnimatedTabs } from "../ui/tabs.tsx";
import { ToastProvider } from "../ui/toast.tsx";
import { ItemProvider, useChanges, useChosenTab, useItem, type Where } from "./context.tsx";
import { ItemPalette } from "./palette.tsx";
import { partsOf, type ItemSection, type ItemTab } from "./parts.ts";
import { Rows } from "./row.tsx";
import { StateBadge } from "./state-badge.tsx";

const TABS = partsOf(import.meta.glob<{ default: ItemTab }>("./tabs/*.tsx", { eager: true }));
const SECTIONS = partsOf(import.meta.glob<{ default: ItemSection }>("./sections/*.tsx", { eager: true }));

const NAME: Record<GitHubKind, string> = { issues: "Issue", pulls: "Pull request" };

export function ItemView(props: WorktreeViewProps) {
  return (
    <ToastProvider>
      <ItemScreen {...props} />
    </ToastProvider>
  );
}

function ItemScreen({ machine, worktree, params }: WorktreeViewProps) {
  const asked: GitHubKind = params.kind === "pulls" ? "pulls" : "issues";
  const number = Number(params.number);
  const valid = Number.isInteger(number) && number >= 1 && number <= 1e9;
  const daemon = useDaemonReady(machine.id);
  const github = worktree.github;
  const repo = github ? `${github.owner}/${github.name}` : undefined;
  const clock = useNow(60_000);
  const options = useRefreshOptions();
  const r = useRequest<GitHubItemDetail>(daemon.ready && repo && valid ? readOp(machine.id, "item", { repo, kind: asked, number }) : undefined, options);
  const item = r.data?.number === number ? r.data : undefined;
  // A link or a typed number may name a pull request as an issue or the other way round: the daemon part reads it as
  // the kind it is, and the changes go to that kind.
  const kind = item?.kind ?? asked;
  const where: Where | undefined = repo && valid ? { repo, kind, number } : undefined;
  // The worktree's tabs show the title and the state: they are read again after a change too.
  const tabs = useRequest<WorktreeItems>(itemsTarget(machine.id, worktree, daemon.ready), options);
  const changes = useChanges(machine.id, where, () => {
    r.reload();
    tabs.reload();
  });
  const reload = useFreshReload(machine.id, repo, changes.changed);
  // Not before the read: what GitHub changed since the clock last ticked would read as "in 1 minute".
  const now = Math.max(clock, r.at ?? 0);
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
      {item && item.kind !== asked && (
        <Alert>
          #{number} は {NAME[item.kind]} なので、{NAME[item.kind]} として出しています。
        </Alert>
      )}
      {!item && r.loading && <DetailSkeleton />}
      {item && where && (
        <ItemProvider value={{ machine: machine.id, machineInfo: machine, worktree, params, where, item, now, busy: changes.busy, run: changes.run, revision: changes.revision, reload }}>
          <Detail />
          <ItemPalette worktree={worktree} />
        </ItemProvider>
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
  const { item, now } = useItem();
  const tabs = TABS.filter((t) => t.kinds.includes(item.kind));
  const [chosen, choose] = useChosenTab(tabs.map((t) => t.id));
  const tab = tabs.find((t) => t.id === chosen);
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
          onChange={choose}
        >
          <tab.View />
        </AnimatedTabs>
      )}
    </>
  );
}

function Title() {
  const { item, where, busy, run } = useItem();
  const [draft, setDraft] = useState<string>();
  if (draft === undefined) {
    return (
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 text-lg leading-snug font-semibold break-words">{item.title}</h2>
        <Button variant="ghost" size="icon" onClick={() => setDraft(item.title)} aria-label="題を変える" title="題を変える">
          <Pencil />
        </Button>
      </div>
    );
  }
  const save = async () => {
    const ok = await run({
      id: "title",
      op: "edit",
      params: { title: draft },
      summary: `#${where.number} の題を変える`,
      done: "題を変えました",
      undo: { op: "edit", params: { title: item.title }, summary: `#${where.number} の題を戻す` },
    });
    if (ok) setDraft(undefined);
  };
  return (
    <div className="space-y-2">
      <input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="題" className={INPUT} maxLength={256} />
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => void save()} isLoading={busy === "title"} loadingText="保存しています…" disabled={busy !== undefined || !draft.trim() || draft === item.title}>
          保存する
        </Button>
        <Button onClick={() => setDraft(undefined)} disabled={busy === "title"}>
          やめる
        </Button>
      </div>
    </div>
  );
}
