// The files a pull request changes, in the folders that hold them (each folds), each marked added, modified, removed or
// renamed, with the lines it adds and takes away; the kinds of change choose which show. They are read apart from the
// item (the operation "files"), when the tab shows. The diff itself is on GitHub: a file opens its diff there.
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, ExternalLink, FileDiff, Folder, FolderOpen, SquareArrowRight, SquareDot, SquareMinus, SquarePlus, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn, useRequest } from "@gasho/plugin-sdk";
import type { GitHubFile } from "../../../types.ts";
import { readOp } from "../../daemon.ts";
import { useRefreshOptions } from "../../tabs.ts";
import { Alert } from "../../ui/alert.tsx";
import { Button, buttonClass } from "../../ui/button.tsx";
import { Skeleton } from "../../ui/skeleton.tsx";
import { useAfterChange, useItem } from "../context.tsx";
import { baseName, fileTree, folderOf, folderPaths, type FileFolder } from "../file-tree.ts";
import type { ItemTab } from "../parts.ts";

type Status = GitHubFile["status"];

// GitHub's marks and colors for the same kinds.
const STATUS: Record<Status, { label: string; Icon: LucideIcon; color: string }> = {
  added: { label: "作成", Icon: SquarePlus, color: "text-emerald-600 dark:text-emerald-400" },
  modified: { label: "変更", Icon: SquareDot, color: "text-amber-600 dark:text-amber-400" },
  removed: { label: "削除", Icon: SquareMinus, color: "text-red-600 dark:text-red-400" },
  renamed: { label: "名前の変更", Icon: SquareArrowRight, color: "text-muted-foreground" },
};
const STATUSES = Object.keys(STATUS) as Status[];

/** Each level of folders moves its rows by the width of a folder's arrow and its gap, so a file's mark is under its folder's. */
const indent = (depth: number) => ({ paddingLeft: `${12 + depth * 20}px` });

type Row = { folder: FileFolder; depth: number } | { file: GitHubFile; depth: number };

function rowsOf(d: FileFolder, depth: number, folded: ReadonlySet<string>): Row[] {
  return [
    ...d.folders.flatMap((c): Row[] => [{ folder: c, depth }, ...(folded.has(c.path) ? [] : rowsOf(c, depth + 1, folded))]),
    ...d.files.map((file): Row => ({ file, depth })),
  ];
}

function Lines({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="shrink-0 tabular-nums" title={`${additions.toLocaleString()} 行増えて、${deletions.toLocaleString()} 行減った`}>
      <span className="text-emerald-600 dark:text-emerald-400">+{additions.toLocaleString()}</span> <span className="text-red-600 dark:text-red-400">−{deletions.toLocaleString()}</span>
    </span>
  );
}

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5",
        pressed ? "border-border-hover bg-surface text-foreground shadow-xs" : "border-border text-muted-foreground hover:border-border-hover hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function FileRow({ file, depth, url }: { file: GitHubFile; depth: number; url: string }) {
  const s = STATUS[file.status];
  const from = file.previousPath && (folderOf(file.previousPath) === folderOf(file.path) ? baseName(file.previousPath) : file.previousPath);
  return (
    <a
      href={`${url}/files#${file.anchor}`}
      target="_blank"
      rel="noreferrer"
      title={`${s.label}：${file.previousPath ? `${file.previousPath} → ` : ""}${file.path}（GitHub で差分を見る）`}
      className="flex items-center gap-1.5 py-1.5 pr-3 outline-none hover:bg-surface-hover focus-visible:bg-surface-hover"
      style={indent(depth)}
    >
      <s.Icon aria-label={s.label} className={cn("size-3.5 shrink-0", s.color)} />
      <span className="min-w-0 flex-1 truncate font-mono">
        {baseName(file.path)}
        {from && <span className="text-muted-foreground"> ← {from}</span>}
      </span>
      <Lines additions={file.additions} deletions={file.deletions} />
    </a>
  );
}

function FolderRow({ folder, depth, open, onToggle }: { folder: FileFolder; depth: number; open: boolean; onToggle: () => void }) {
  const Icon = open ? FolderOpen : Folder;
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      title={folder.path}
      className="flex w-full cursor-pointer items-center gap-1.5 py-1.5 pr-3 text-left outline-none hover:bg-surface-hover focus-visible:bg-surface-hover"
      style={indent(depth)}
    >
      <ChevronRight aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-mono">{folder.name}</span>
      <span className="shrink-0 text-muted-foreground tabular-nums">{folder.count} ファイル</span>
      <Lines additions={folder.additions} deletions={folder.deletions} />
    </button>
  );
}

function FilesSkeleton() {
  return (
    <div role="status" aria-label="読み込み中" className="space-y-3">
      <div className="flex gap-1.5">
        <Skeleton className="h-7 w-20 rounded-full" />
        <Skeleton className="h-7 w-16 rounded-full" />
        <Skeleton className="h-7 w-16 rounded-full" />
      </div>
      <div className="space-y-2.5 rounded-xl border border-border p-3">
        {["70%", "55%", "62%", "48%", "66%"].map((w) => (
          <Skeleton key={w} className="h-3.5" style={{ width: w }} />
        ))}
      </div>
    </div>
  );
}

function Files() {
  const { machine, where, item } = useItem();
  const r = useRequest<GitHubFile[]>(readOp(machine, "files", { repo: where.repo, number: where.number }), useRefreshOptions());
  useAfterChange(r.reload);
  const [only, setOnly] = useState<Status>();
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const error = r.error && (
    <Alert
      tone="danger"
      action={
        <Button size="xs" onClick={r.reload} isLoading={r.loading}>
          読み直す
        </Button>
      }
    >
      変更したファイルを読めませんでした：{r.error}
    </Alert>
  );
  if (!r.data) return error || <FilesSkeleton />;
  const files = r.data;
  if (files.length === 0) return error || <p className="text-sm text-muted-foreground">変更したファイルはありません。</p>;

  const count = (s: Status) => files.filter((f) => f.status === s).length;
  const tree = fileTree(only ? files.filter((f) => f.status === only) : files);
  const paths = folderPaths(tree);
  const allFolded = paths.length > 0 && paths.every((p) => folded.has(p));
  const toggle = (path: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  const rows = rowsOf(tree, 0, folded);
  return (
    <div className="space-y-3">
      {error}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {(item.changedFiles ?? files.length).toLocaleString()} ファイル{" "}
          {item.additions !== undefined && item.deletions !== undefined && <Lines additions={item.additions} deletions={item.deletions} />}
        </span>
        <div className="flex items-center gap-1">
          {paths.length > 0 && (
            <Button variant="ghost" size="xs" onClick={() => setFolded(allFolded ? new Set() : new Set(paths))}>
              {allFolded ? <ChevronsUpDown /> : <ChevronsDownUp />}
              {allFolded ? "すべて開く" : "すべて畳む"}
            </Button>
          )}
          <a href={`${item.url}/files`} target="_blank" rel="noreferrer" className={buttonClass("ghost", "xs")}>
            GitHub で差分を見る <ExternalLink />
          </a>
        </div>
      </div>
      <div role="group" aria-label="変更の種類で絞り込む" className="flex flex-wrap gap-1.5">
        <Chip pressed={!only} onClick={() => setOnly(undefined)}>
          すべて <span className="tabular-nums">{files.length}</span>
        </Chip>
        {STATUSES.map((s) => {
          const n = count(s);
          if (n === 0) return null;
          const { label, Icon, color } = STATUS[s];
          return (
            <Chip key={s} pressed={only === s} onClick={() => setOnly(only === s ? undefined : s)}>
              <Icon aria-hidden className={color} />
              {label} <span className="tabular-nums">{n}</span>
            </Chip>
          );
        })}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">この種類の変更はありません。</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border text-xs">
          {rows.map((row) =>
            "folder" in row ? (
              <li key={`folder:${row.folder.path}`}>
                <FolderRow folder={row.folder} depth={row.depth} open={!folded.has(row.folder.path)} onToggle={() => toggle(row.folder.path)} />
              </li>
            ) : (
              <li key={`file:${row.file.path}`}>
                <FileRow file={row.file} depth={row.depth} url={item.url} />
              </li>
            ),
          )}
        </ul>
      )}
      {item.changedFiles !== undefined && item.changedFiles > files.length && (
        <p className="text-xs text-muted-foreground">ほかに {(item.changedFiles - files.length).toLocaleString()} ファイルあります。GitHub で見られます。</p>
      )}
    </div>
  );
}

export default { id: "files", label: "ファイル", order: 40, kinds: ["pulls"], icon: FileDiff, badge: (item) => item.changedFiles, View: Files } satisfies ItemTab;
