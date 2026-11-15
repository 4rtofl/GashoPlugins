// The reviews of a pull request that have text of their own, with what they decided.
import { CircleAlert, CircleCheck, CircleSlash, Clock, MessageSquareText, type LucideIcon } from "lucide-react";
import { Markdown, RelativeTime } from "@gasho/plugin-sdk";
import type { GitHubReview } from "../../../types.ts";
import { Badge, type BadgeTone } from "../../ui/badge.tsx";
import type { TimelineTone } from "../../ui/timeline.tsx";
import { useItem } from "../context.tsx";
import type { ConversationEntry, ConversationPart } from "../parts.ts";

const STATE: Record<GitHubReview["state"], { label: string; badge: BadgeTone; tone: TimelineTone; icon: LucideIcon }> = {
  approved: { label: "承認", badge: "success", tone: "success", icon: CircleCheck },
  changes_requested: { label: "修正を依頼", badge: "warning", tone: "warning", icon: CircleAlert },
  commented: { label: "レビューのコメント", badge: "neutral", tone: "neutral", icon: MessageSquareText },
  dismissed: { label: "取り消されたレビュー", badge: "neutral", tone: "neutral", icon: CircleSlash },
  pending: { label: "未送信のレビュー", badge: "neutral", tone: "neutral", icon: Clock },
};

function useReviews(): ConversationEntry[] {
  const { item, now } = useItem();
  return (item.reviews ?? []).map((r, i) => {
    const s = STATE[r.state];
    return {
      key: `review${i}`,
      at: r.submittedAt,
      icon: s.icon,
      tone: s.tone,
      title: (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span>
            <span className="font-medium text-foreground/90">{r.author ?? "不明"}</span> がレビュー
          </span>
          <Badge tone={s.badge}>{s.label}</Badge>
        </span>
      ),
      time: <RelativeTime at={r.submittedAt} now={now} />,
      body: r.body.trim() ? <Markdown text={r.body} /> : <p className="text-sm text-muted-foreground">（本文なし）</p>,
    };
  });
}

export default { order: 30, useEntries: useReviews } satisfies ConversationPart;
