// A pull request's branches, size and review decision.
import { GitBranch } from "lucide-react";
import type { GitHubItemDetail } from "../../../types.ts";
import { Badge, type BadgeTone } from "../../ui/badge.tsx";
import { useItem } from "../context.tsx";
import type { ItemSection } from "../parts.ts";

const REVIEW: Record<NonNullable<GitHubItemDetail["review"]>, { label: string; tone: BadgeTone }> = {
  approved: { label: "承認済み", tone: "success" },
  changes_requested: { label: "修正の依頼あり", tone: "warning" },
  review_required: { label: "レビュー待ち", tone: "neutral" },
};

function PullSummary() {
  const { item } = useItem();
  const decision = item.review ? REVIEW[item.review] : undefined;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground">
      {item.head && item.base && (
        <span className="inline-flex min-w-0 items-center gap-1.5 font-mono break-all">
          <GitBranch className="size-3.5 shrink-0" />
          {item.head} → {item.base}
        </span>
      )}
      {item.additions !== undefined && item.deletions !== undefined && (
        <span className="tabular-nums">
          <span className="text-emerald-600 dark:text-emerald-400">+{item.additions.toLocaleString()}</span> <span className="text-red-600 dark:text-red-400">−{item.deletions.toLocaleString()}</span>
        </span>
      )}
      {decision && (
        <Badge tone={decision.tone} dot>
          {decision.label}
        </Badge>
      )}
    </div>
  );
}

export default { order: 40, kinds: ["pulls"], View: PullSummary } satisfies ItemSection;
