// The "GitHub" tab of a worktree: its issues and pull requests (the one its branch is named after, the pull requests of
// its branch, the ones added by hand), and a box that adds one by its number or its GitHub URL.
import { ExternalLink, RefreshCw, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { cn, PANEL_BUTTON, useCall, useDaemonReady, useNavigation, useRequest, type WorktreeViewProps } from "@gasho/plugin-sdk";
import type { ItemSummary, WorktreeItems } from "../types.ts";
import { numberFrom } from "./number.ts";
import { itemIcon, itemsInOrder, itemsTarget, useRefreshOptions } from "./tabs.ts";

export function HomeView({ machine, worktree }: WorktreeViewProps) {
  const daemon = useDaemonReady(machine.id);
  const target = itemsTarget(machine.id, worktree, daemon.ready);
  const r = useRequest<WorktreeItems>(target, useRefreshOptions());
  const nav = useNavigation();
  const call = useCall();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const github = worktree.github;
  const repo = github ? `${github.owner}/${github.name}` : undefined;
  const items = r.data;
  const added = new Set(items?.added.map((i) => i.number));

  const run = async (label: string, method: string, params: Record<string, unknown>, summary: string): Promise<boolean> => {
    setBusy(label);
    setError(undefined);
    const res = await call({ machine: machine.id, method, params, summary });
    setBusy(undefined);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    r.reload();
    return true;
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!repo) return;
    const number = numberFrom(text, repo);
    if (!number) {
      setError(`番号（17 や #17）か、${repo} の Issue や Pull request の URL を入れてください。`);
      return;
    }
    if (await run("add", "add", { repo, worktree: worktree.path, number }, `${repo} #${number} を worktree に足す`)) setText("");
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-5 md:px-6">
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
            <a href={github.url} target="_blank" rel="noreferrer" className={PANEL_BUTTON}>
              GitHub <ExternalLink className="size-3.5" />
            </a>
          )}
          <button type="button" onClick={r.reload} disabled={!target || r.loading} aria-label="再読み込み" title="再読み込み" className={PANEL_BUTTON}>
            <RefreshCw className={cn("size-3.5", r.loading && "animate-spin")} />
          </button>
        </div>
      </header>

      {!github && <p className="text-sm text-muted-foreground">この worktree のリポジトリは GitHub にありません。</p>}
      {github && !daemon.ready && <p className="text-sm text-muted-foreground">{daemon.reason ?? `${machine.name} で github-almighty の daemon の部分が動いていません。`}</p>}
      {r.error && <p className="text-sm text-red-400">{r.error}</p>}
      {!items && r.loading && <p className="text-sm text-muted-foreground">読み込み中…</p>}

      {items && (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {itemsInOrder(items).map((i) => (
            <Row
              key={i.number}
              item={i}
              why={i.number === items.named?.number ? "ブランチ名の番号" : items.pulls.some((p) => p.number === i.number) ? "このブランチの Pull request" : "手で足したもの"}
              href={nav.worktreeHref("item", { kind: i.kind, number: String(i.number) })}
              onOpen={() => nav.openWorktreeView("item", { kind: i.kind, number: String(i.number) })}
              onRemove={added.has(i.number) ? () => void run(`remove${i.number}`, "remove", { worktree: worktree.path, number: i.number }, `#${i.number} を worktree から外す`) : undefined}
              removing={busy === `remove${i.number}`}
            />
          ))}
          {itemsInOrder(items).length === 0 && (
            <li className="px-3 py-2.5 text-sm text-muted-foreground">
              {worktree.branch ? "ブランチ名に番号がなく、このブランチの Pull request もありません。" : "この worktree にはブランチがありません。"}下から番号で足せます。
            </li>
          )}
        </ul>
      )}
      {items && items.missing.length > 0 && (
        <p className="text-xs text-amber-400">
          手で足した {items.missing.map((n) => `#${n}`).join("、")} は、GitHub で見つかりません。
          {items.missing.map((n) => (
            <button key={n} type="button" className="ml-2 underline" onClick={() => void run(`remove${n}`, "remove", { worktree: worktree.path, number: n }, `#${n} を worktree から外す`)}>
              #{n} を外す
            </button>
          ))}
        </p>
      )}

      {github && daemon.ready && (
        <form onSubmit={add} className="flex flex-wrap items-center gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="番号か URL（例: 17）"
            aria-label="worktree に足す Issue や Pull request"
            className="min-w-0 flex-1 rounded-lg border border-border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-foreground/40"
          />
          <button type="submit" disabled={busy !== undefined || !text.trim()} className={cn(PANEL_BUTTON, "px-3 py-1.5")}>
            {busy === "add" ? "確かめています…" : "worktree に足す"}
          </button>
        </form>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {r.at && <p className="text-xs text-muted-foreground">{new Date(r.at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} に読み込み</p>}
    </div>
  );
}

function Row({ item, why, href, onOpen, onRemove, removing }: { item: ItemSummary; why: string; href: string; onOpen: () => void; onRemove?: () => void; removing: boolean }) {
  const Icon = itemIcon(item);
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
        <Icon className={cn("mt-0.5 size-4 shrink-0", item.state === "open" && !item.draft ? "text-emerald-400" : item.state === "merged" ? "text-violet-400" : "text-muted-foreground")} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-snug break-words">{item.title}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            <span className="tabular-nums">#{item.number}</span> · {item.kind === "pulls" ? "Pull request" : "Issue"} · {why}
          </span>
        </span>
      </a>
      {onRemove && (
        <button type="button" onClick={onRemove} disabled={removing} aria-label={`#${item.number} を外す`} title="worktree から外す" className={PANEL_BUTTON}>
          <X className="size-3.5" />
        </button>
      )}
    </li>
  );
}
