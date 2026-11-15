// The files a pull request changes, with the lines each adds and takes away. The diff itself is on GitHub.
import { ExternalLink, FileDiff } from "lucide-react";
import { buttonClass } from "../../ui/button.tsx";
import { useItem } from "../context.tsx";
import type { ItemTab } from "../parts.ts";

function Files() {
  const { item } = useItem();
  const files = item.files ?? [];
  if (files.length === 0) return <p className="text-sm text-muted-foreground">変更したファイルはありません。</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {item.changedFiles ?? files.length} ファイル{" "}
          {item.additions !== undefined && item.deletions !== undefined && (
            <>
              <span className="text-emerald-600 dark:text-emerald-400">+{item.additions.toLocaleString()}</span> <span className="text-red-600 dark:text-red-400">−{item.deletions.toLocaleString()}</span>
            </>
          )}
        </span>
        <a href={`${item.url}/files`} target="_blank" rel="noreferrer" className={buttonClass("ghost", "xs")}>
          GitHub で差分を見る <ExternalLink />
        </a>
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border text-xs">
        {files.map((f) => (
          <li key={f.path} className="flex items-center gap-3 px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate font-mono" title={f.path}>
              {f.path}
            </span>
            <span className="shrink-0 tabular-nums">
              <span className="text-emerald-600 dark:text-emerald-400">+{f.additions}</span> <span className="text-red-600 dark:text-red-400">−{f.deletions}</span>
            </span>
          </li>
        ))}
      </ul>
      {item.changedFiles !== undefined && item.changedFiles > files.length && (
        <p className="text-xs text-muted-foreground">ほかに {item.changedFiles - files.length} ファイルあります。GitHub で見られます。</p>
      )}
    </div>
  );
}

export default { id: "files", label: "ファイル", order: 40, kinds: ["pulls"], icon: FileDiff, badge: (item) => item.changedFiles ?? item.files?.length, View: Files } satisfies ItemTab;
