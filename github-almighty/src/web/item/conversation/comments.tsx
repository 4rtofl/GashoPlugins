// The comments, and how many older ones are left out (GitHub has them).
import { ExternalLink, History, MessageSquare } from "lucide-react";
import { Markdown, RelativeTime } from "@gasho/plugin-sdk";
import { buttonClass } from "../../ui/button.tsx";
import { useItem } from "../context.tsx";
import type { ConversationEntry, ConversationPart } from "../parts.ts";

function useComments(): ConversationEntry[] {
  const { item, now } = useItem();
  const comments = item.comments ?? [];
  const entries = comments.map(
    (c, i): ConversationEntry => ({
      key: `comment${i}`,
      at: c.createdAt,
      icon: MessageSquare,
      title: (
        <>
          <span className="font-medium text-foreground/90">{c.author ?? "不明"}</span> がコメント
        </>
      ),
      time: <RelativeTime at={c.createdAt} now={now} />,
      ...(c.url && {
        actions: (
          <a href={c.url} target="_blank" rel="noreferrer" aria-label="GitHub で開く" title="GitHub で開く" className={buttonClass("ghost", "icon")}>
            <ExternalLink />
          </a>
        ),
      }),
      body: c.minimized ? (
        <p className="text-sm text-muted-foreground">GitHub で非表示にされたコメントです。</p>
      ) : c.body.trim() ? (
        <Markdown text={c.body} />
      ) : (
        <p className="text-sm text-muted-foreground">（本文なし）</p>
      ),
    }),
  );
  const first = comments[0];
  if (item.commentsLeftOut && first) {
    // Just before the oldest comment shown.
    const at = new Date(new Date(first.createdAt).getTime() - 1).toISOString();
    entries.unshift({ key: "left-out", at, icon: History, title: `古いコメント ${item.commentsLeftOut} 件は省いています。GitHub で読めます。` });
  }
  return entries;
}

export default { order: 20, useEntries: useComments } satisfies ConversationPart;
