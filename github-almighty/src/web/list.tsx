// A repository's open issues or pull requests (ops/list.ts), for the "GitHub" tab and the page of the sidebar: issues
// or pull requests, narrowed to those of the gh login, and to words of the title; the latest updated first. A row opens
// the item's screen, where it is said whose it is (`open`); where it opens is the caller's.
import { RefreshCw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { cn, RelativeTime, useNow, usePluginState, useRequest } from "@gasho/plugin-sdk";
import type { ListedItem, ListFilter, RepoList } from "../daemon/ops/list.ts";
import type { GitHubKind } from "../types.ts";
import { readOp } from "./daemon.ts";
import { itemIcon, useRefreshOptions } from "./tabs.ts";
import { Alert } from "./ui/alert.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { INPUT } from "./ui/input.ts";
import { Skeleton } from "./ui/skeleton.tsx";

/** How long typing pauses before the words are searched: every search takes a point of GitHub's hourly limit. */
const SEARCH_AFTER_MS = 400;

const FILTERS: { id: ListFilter; label: string; kinds: GitHubKind[] }[] = [
  { id: "all", label: "すべて", kinds: ["issues", "pulls"] },
  { id: "assigned", label: "自分が担当", kinds: ["issues", "pulls"] },
  { id: "created", label: "自分が作成", kinds: ["issues", "pulls"] },
  { id: "review", label: "レビューを頼まれた", kinds: ["pulls"] },
];

const CHIP = "h-7 rounded-full border px-3 text-xs transition-colors";

export interface RepoListProps {
  machine: string;
  /** owner/name */
  repo: string;
  href: (item: ListedItem) => string;
  open: (item: ListedItem) => void;
}

export function RepoItems({ machine, repo, href, open }: RepoListProps) {
  const [kind, setKind] = usePluginState<GitHubKind>("list:kind", "issues");
  const [chosen, setFilter] = usePluginState<ListFilter>("list:filter", "all");
  const filter = FILTERS.find((f) => f.id === chosen && f.kinds.includes(kind))?.id ?? "all";
  const [text, setText] = useState("");
  const [words, setWords] = useState("");
  useEffect(() => {
    const typed = text.trim();
    const timer = setTimeout(() => setWords(typed.length >= 2 ? typed : ""), SEARCH_AFTER_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const r = useRequest<RepoList>(readOp(machine, "list", { repo, kind, filter, ...(words ? { query: words } : {}) }), useRefreshOptions());
  const now = useNow(60_000);
  const list = r.data;

  return (
    <section className="space-y-2.5" aria-label={`${repo} の Open な Issue と Pull request`}>
      <div className="flex flex-wrap items-center gap-1.5">
        {(["issues", "pulls"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={cn(CHIP, kind === k ? "border-foreground/30 bg-surface-raised font-medium text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
          >
            {k === "issues" ? "Issue" : "Pull request"}
          </button>
        ))}
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        {FILTERS.filter((f) => f.kinds.includes(kind)).map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cn(CHIP, filter === f.id ? "border-foreground/30 bg-surface-raised font-medium text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
          >
            {f.label}
          </button>
        ))}
        <Button variant="ghost" size="icon" className="ml-auto" onClick={r.reload} disabled={r.loading} aria-label="一覧を読み直す" title="一覧を読み直す">
          <RefreshCw className={cn(r.loading && "animate-spin")} />
        </Button>
      </div>
      <label className="relative block">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="題の語で探す（2 文字から）" aria-label="題の語で探す" className={cn(INPUT, "pl-8")} maxLength={200} />
      </label>

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
      {!list && r.loading && (
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
      {list && (
        <ul className={cn("divide-y divide-border overflow-hidden rounded-xl border border-border transition-opacity", r.loading && "opacity-60")}>
          {list.items.map((i) => (
            <Row key={i.number} item={i} now={Math.max(now, r.at ?? 0)} href={href(i)} onOpen={() => open(i)} />
          ))}
          {list.items.length === 0 && <li className="px-3 py-2.5 text-sm text-muted-foreground">{words ? `「${words}」を題に含む、` : ""}Open な{kind === "issues" ? " Issue" : " Pull request"}はありません。</li>}
        </ul>
      )}
      {list && list.total > list.items.length && (
        <p className="text-xs text-muted-foreground">
          {list.total.toLocaleString()} 件のうち、新しく更新された {list.items.length} 件を出しています。題の語や絞り込みで探してください。
        </p>
      )}
    </section>
  );
}

function Row({ item, now, href, onOpen }: { item: ListedItem; now: number; href: string; onOpen: () => void }) {
  const Icon = itemIcon(item);
  return (
    <li className="hover:bg-surface-raised">
      <a
        href={href}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          onOpen();
        }}
        className="flex min-w-0 gap-2.5 px-3 py-2.5"
      >
        <Icon className={cn("mt-0.5 size-4 shrink-0", item.draft ? "text-muted-foreground" : "text-emerald-600 dark:text-emerald-400")} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-snug break-words">{item.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            <span className="tabular-nums">#{item.number}</span>
            {item.draft && (
              <Badge tone="neutral" className="h-5 px-2">
                Draft
              </Badge>
            )}
            {item.author && <span>· {item.author}</span>}
            {item.updatedAt && (
              <span>
                · 更新 <RelativeTime at={item.updatedAt} now={now} />
              </span>
            )}
            {item.comments ? <span>· コメント {item.comments}</span> : null}
            {item.labels.map((l) => (
              <Badge key={l.name} dot={l.color ? `#${l.color}` : true} className="h-5 px-2">
                {l.name}
              </Badge>
            ))}
          </span>
        </span>
      </a>
    </li>
  );
}
