// The "GitHub" tab of a worktree: its issues and pull requests (the one its branch is named after, the pull requests of
// its branch, the ones added by hand), a box that makes the pull request of a branch without one, a box that adds one by
// its number, its GitHub URL or words of its title (home/), and a form for a new issue.
import { ExternalLink, RefreshCw, X } from "lucide-react";
import { useRef, useState } from "react";
import { cn, useDaemonReady, useNavigation, useRequest, type WorktreeViewProps } from "@gasho/plugin-sdk";
import type { ItemSummary, WorktreeItems } from "../types.ts";
import { useWriteOp } from "./daemon.ts";
import { AddBox } from "./home/add.tsx";
import { NewIssueBox } from "./home/new-issue.tsx";
import { NewPullBox } from "./home/new-pull.tsx";
import { HomePalette } from "./palette.tsx";
import { itemLook, itemsInOrder, itemsTarget, useRefreshOptions } from "./tabs.ts";
import { Alert } from "./ui/alert.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button, buttonClass } from "./ui/button.tsx";
import { Skeleton } from "./ui/skeleton.tsx";
import { ToastProvider, useToast } from "./ui/toast.tsx";

export function HomeView(props: WorktreeViewProps) {
  return (
    <ToastProvider>
      <Home {...props} />
    </ToastProvider>
  );
}

function Home({ machine, worktree }: WorktreeViewProps) {
  const daemon = useDaemonReady(machine.id);
  const target = itemsTarget(machine.id, worktree, daemon.ready);
  const r = useRequest<WorktreeItems>(target, useRefreshOptions());
  const nav = useNavigation();
  const write = useWriteOp();
  const toast = useToast();
  const [busy, setBusy] = useState<string>();
  // Right after its working server comes back, Gasho sends the worktree without its GitHub repository for a few seconds:
  // the one known before stays.
  const lastGithub = useRef(worktree.github);
  if (worktree.github) lastGithub.current = worktree.github;
  const github = worktree.github ?? lastGithub.current;
  const repo = github ? `${github.owner}/${github.name}` : undefined;
  // While the daemon part is not ready (the working server offline for a while), nothing is read: the list read before
  // and the forms stay, with what is typed in them. A form shows only once the daemon part was ready on this screen.
  const last = useRef<{ branch: string | undefined; items: WorktreeItems }>(undefined);
  if (r.data) last.current = { branch: worktree.branch, items: r.data };
  const items = r.data ?? (last.current?.branch === worktree.branch ? last.current.items : undefined);
  const wasReady = useRef(false);
  if (daemon.ready) wasReady.current = true;
  const added = new Set(items?.added.map((i) => i.number));

  const run = async (id: string, op: string, params: Record<string, unknown>, summary: string): Promise<string | undefined> => {
    setBusy(id);
    const res = await write(machine.id, op, params, summary);
    setBusy(undefined);
    r.reload();
    return res.ok ? undefined : res.error;
  };

  const add = async (number: number): Promise<string | undefined> => {
    if (!repo) return undefined;
    const failed = await run("add", "add", { repo, worktree: worktree.path, number }, `${repo} #${number} を worktree に足す`);
    if (!failed) toast({ title: `#${number} を worktree に足しました` });
    return failed;
  };

  const remove = async (number: number) => {
    const failed = await run(`remove${number}`, "remove", { worktree: worktree.path, number }, `#${number} を worktree から外す`);
    if (failed) toast({ title: `「#${number} を worktree から外す」ができませんでした`, description: failed, tone: "error" });
    else
      toast({
        title: `#${number} を worktree から外しました`,
        ...(repo && { undo: () => run(`add${number}`, "add", { repo, worktree: worktree.path, number }, `#${number} を worktree に足し直す（取り消し）`) }),
      });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-5 md:px-6">
      <HomePalette machine={machine.id} worktree={worktree} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Issue と Pull request</h2>
          <p className="truncate text-xs text-muted-foreground">
            {repo ?? "GitHub のリポジトリがありません"}
            {worktree.branch && <span className="font-mono"> · {worktree.branch}</span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {github && (
            <a href={github.url} target="_blank" rel="noreferrer" className={buttonClass("ghost", "xs")}>
              GitHub <ExternalLink />
            </a>
          )}
          <Button variant="ghost" size="icon" onClick={r.reload} disabled={!target || r.loading} aria-label="再読み込み" title="再読み込み">
            <RefreshCw className={cn(r.loading && "animate-spin")} />
          </Button>
        </div>
      </header>

      {!github && <Alert>この worktree のリポジトリは GitHub にありません。</Alert>}
      {github && !daemon.ready && <Alert tone="warning">{daemon.reason ?? `${machine.name} で github-implement の daemon の部分が動いていません。`}</Alert>}
      {r.error && (
        <Alert
          tone="danger"
          action={
            <Button size="xs" onClick={r.reload} isLoading={r.loading}>
              読み直す
            </Button>
          }
        >
          {r.error}
        </Alert>
      )}
      {!items && r.loading && (
        <div role="status" aria-label="読み込み中" className="space-y-px overflow-hidden rounded-xl border border-border">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-2.5 px-3 py-3">
              <Skeleton className="size-4 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      )}

      {items && (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {itemsInOrder(items).map((i) => (
            <Row
              key={i.number}
              item={i}
              why={i.number === items.named?.number ? "ブランチ名の番号" : items.pulls.some((p) => p.number === i.number) ? "このブランチの Pull request" : "手で足したもの"}
              href={nav.worktreeHref("item", { kind: i.kind, number: String(i.number) })}
              onOpen={() => nav.openWorktreeView("item", { kind: i.kind, number: String(i.number) })}
              onRemove={added.has(i.number) ? () => void remove(i.number) : undefined}
              removing={busy === `remove${i.number}`}
            />
          ))}
          {itemsInOrder(items).length === 0 && (
            <li className="px-3 py-2.5 text-sm text-muted-foreground">
              {worktree.branch ? "ブランチ名に番号がなく、このブランチの Pull request もありません。" : "この worktree にはブランチがありません。"}下から番号や題の語で足せます。
            </li>
          )}
        </ul>
      )}
      {items && items.missing.length > 0 && (
        <Alert tone="warning">
          手で足した {items.missing.map((n) => `#${n}`).join("、")} は、GitHub で見つかりません。
          <span className="ml-1 inline-flex flex-wrap gap-1.5 align-middle">
            {items.missing.map((n) => (
              <Button key={n} size="xs" variant="ghost" onClick={() => void remove(n)} isLoading={busy === `remove${n}`}>
                #{n} を外す
              </Button>
            ))}
          </span>
        </Alert>
      )}

      {/* A branch whose pull request is open or merged is done with: a closed one may be made again. */}
      {repo && wasReady.current && items && worktree.branch && !items.pulls.some((p) => p.state !== "closed") && (
        <NewPullBox machine={machine.id} worktree={worktree} branch={worktree.branch} repo={repo} {...(items.named?.kind === "issues" ? { title: items.named.title } : {})} onCreated={r.reload} />
      )}

      {repo && wasReady.current && (
        <>
          <AddBox machine={machine.id} repo={repo} has={new Set(items ? itemsInOrder(items).map((i) => i.number) : [])} busy={busy !== undefined} adding={busy === "add"} onAdd={add} />
          <NewIssueBox machine={machine.id} worktree={worktree} repo={repo} onCreated={r.reload} />
        </>
      )}
      {r.at && <p className="text-xs text-muted-foreground">{new Date(r.at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} に読み込み</p>}
    </div>
  );
}

function Row({ item, why, href, onOpen, onRemove, removing }: { item: ItemSummary; why: string; href: string; onOpen: () => void; onRemove?: () => void; removing: boolean }) {
  const { ColoredIcon, label, tone } = itemLook(item);
  return (
    <li className="flex items-center gap-2 px-3 py-2.5 hover:bg-surface-raised">
      <a
        href={href}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          onOpen();
        }}
        className="flex min-w-0 flex-1 gap-2.5"
      >
        <ColoredIcon className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-snug break-words">{item.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            <Badge tone={tone} className="h-5 px-2">
              {label}
            </Badge>
            <span className="tabular-nums">#{item.number}</span> · {item.kind === "pulls" ? "Pull request" : "Issue"} · {why}
          </span>
        </span>
      </a>
      {onRemove && (
        <Button variant="ghost" size="icon" onClick={onRemove} isLoading={removing} aria-label={`#${item.number} を外す`} title="worktree から外す">
          <X />
        </Button>
      )}
    </li>
  );
}
