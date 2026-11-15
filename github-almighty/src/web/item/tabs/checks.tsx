// The checks of a pull request's latest commit: how many failed, run and passed, and each with a link to its details.
import { CircleCheck, CircleDashed, CircleMinus, CircleX, ListChecks } from "lucide-react";
import type { GitHubCheck } from "../../../types.ts";
import { Badge } from "../../ui/badge.tsx";
import { useItem } from "../context.tsx";
import type { ItemTab } from "../parts.ts";

function CheckIcon({ state }: { state: GitHubCheck["state"] }) {
  if (state === "success") return <CircleCheck aria-label="成功" className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />;
  if (state === "failure") return <CircleX aria-label="失敗" className="size-4 shrink-0 text-red-600 dark:text-red-400" />;
  if (state === "pending") return <CircleDashed aria-label="実行中" className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />;
  return <CircleMinus aria-label="スキップ" className="size-4 shrink-0 text-muted-foreground" />;
}

function Checks() {
  const { item } = useItem();
  const checks = item.checks ?? [];
  if (checks.length === 0) return <p className="text-sm text-muted-foreground">この Pull request の最新のコミットには、チェックがありません。</p>;
  const count = (s: GitHubCheck["state"]) => checks.filter((c) => c.state === s).length;
  const others = checks.length - count("failure") - count("pending") - count("success");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {count("failure") > 0 && <Badge tone="danger" dot>{`失敗 ${count("failure")}`}</Badge>}
        {count("pending") > 0 && <Badge tone="warning" dot>{`実行中 ${count("pending")}`}</Badge>}
        {count("success") > 0 && <Badge tone="success" dot>{`成功 ${count("success")}`}</Badge>}
        {others > 0 && <Badge dot>{`その他 ${others}`}</Badge>}
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border text-xs">
        {checks.map((c, i) => (
          <li key={`${c.name}${i}`} className="flex min-w-0 items-center gap-2 px-3 py-2">
            <CheckIcon state={c.state} />
            {c.url ? (
              <a href={c.url} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:underline" title={c.name}>
                {c.name}
              </a>
            ) : (
              <span className="min-w-0 truncate" title={c.name}>
                {c.name}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default { id: "checks", label: "チェック", order: 30, kinds: ["pulls"], icon: ListChecks, badge: (item) => item.checks?.length, View: Checks } satisfies ItemTab;
