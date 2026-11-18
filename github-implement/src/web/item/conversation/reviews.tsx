// The reviews of a pull request, with what they decided, how many comments on lines of the code they hold (with a link
// to them on GitHub, which shows them beside the code) and their reactions (read with the comments', conversation-meta.ts).
import { CircleAlert, CircleCheck, CircleSlash, Clock, ExternalLink, History, MessageSquareText, type LucideIcon } from "lucide-react";
import { Markdown, RelativeTime } from "@gasho/plugin-sdk";
import type { GitHubReview } from "../../../types.ts";
import { Badge, type BadgeTone } from "../../ui/badge.tsx";
import type { TimelineTone } from "../../ui/timeline.tsx";
import { useItem } from "../context.tsx";
import { useConversationMeta } from "../conversation-meta.ts";
import type { ConversationEntry, ConversationPart } from "../parts.ts";
import { Reactions } from "../reactions.tsx";

const STATE: Record<GitHubReview["state"], { label: string; badge: BadgeTone; tone: TimelineTone; icon: LucideIcon }> = {
  approved: { label: "承認", badge: "success", tone: "success", icon: CircleCheck },
  changes_requested: { label: "修正を依頼", badge: "warning", tone: "warning", icon: CircleAlert },
  commented: { label: "レビューのコメント", badge: "neutral", tone: "neutral", icon: MessageSquareText },
  dismissed: { label: "取り消されたレビュー", badge: "neutral", tone: "neutral", icon: CircleSlash },
  pending: { label: "未送信のレビュー", badge: "neutral", tone: "neutral", icon: Clock },
};

function useReviews(): ConversationEntry[] {
  const { item, now } = useItem();
  const meta = useConversationMeta().data;
  const byId = new Map((meta?.reviews ?? []).map((m) => [m.id, m]));
  const entries = (item.reviews ?? []).map((r, i): ConversationEntry => {
    const s = STATE[r.state];
    // A review not yet submitted is gh's login's own draft, which no one else sees yet.
    const m = r.id && r.state !== "pending" ? byId.get(r.id) : undefined;
    return {
      key: r.id ?? `review${r.submittedAt}${i}`,
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
      body: (
        <>
          {r.body.trim() ? <Markdown text={r.body} /> : !m?.lineComments && <p className="text-sm text-muted-foreground">（本文なし）</p>}
          {m && m.lineComments > 0 && (
            <p className="text-sm text-muted-foreground">
              コードの行に {m.lineComments} 件
              {m.url && (
                <a href={m.url} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-1 text-foreground/80 hover:underline">
                  GitHub で読む <ExternalLink className="size-3" />
                </a>
              )}
            </p>
          )}
          {m && <Reactions subject={m.id} reactions={m.reactions} of={`レビュー（${r.author ?? "不明"}）`} />}
        </>
      ),
    };
  });
  if (item.reviewsLeftOut) {
    entries.push({ key: "reviews-left-out", at: item.reviews?.[0]?.submittedAt ?? item.createdAt, pin: "bottom", icon: History, title: `古いレビュー ${item.reviewsLeftOut} 件は省いています。GitHub で読めます。` });
  }
  return entries;
}

export default { order: 30, useEntries: useReviews } satisfies ConversationPart;
