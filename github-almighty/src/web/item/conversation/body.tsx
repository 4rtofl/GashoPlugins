// The body, first in the conversation, with a button that edits it; an Undo Toast can put the old text back.
import { FileText, Pencil } from "lucide-react";
import { useState } from "react";
import { cn, Markdown, RelativeTime } from "@gasho/plugin-sdk";
import { Button } from "../../ui/button.tsx";
import { INPUT } from "../../ui/input.ts";
import { useItem } from "../context.tsx";
import type { ConversationPart } from "../parts.ts";

function useBody() {
  const { item, where, now, busy, run } = useItem();
  const [draft, setDraft] = useState<string>();
  const save = async () => {
    if (draft === undefined) return;
    const ok = await run({
      id: "body",
      op: "edit",
      params: { body: draft },
      summary: `#${where.number} の本文を変える`,
      done: "本文を変えました",
      undo: { op: "edit", params: { body: item.body }, summary: `#${where.number} の本文を戻す` },
    });
    if (ok) setDraft(undefined);
  };
  return [
    {
      key: "body",
      at: item.createdAt,
      icon: FileText,
      title: (
        <>
          <span className="font-medium text-foreground/90">{item.author ?? "不明"}</span> が作成
        </>
      ),
      time: <RelativeTime at={item.createdAt} now={now} />,
      ...(draft === undefined && {
        actions: (
          <Button variant="ghost" size="xs" leftIcon={<Pencil />} onClick={() => setDraft(item.body)}>
            編集
          </Button>
        ),
      }),
      body:
        draft !== undefined ? (
          <div className="space-y-2">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="本文" rows={Math.min(30, Math.max(8, draft.split("\n").length + 2))} className={cn(INPUT, "font-mono text-xs")} />
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void save()} isLoading={busy === "body"} loadingText="保存しています…" disabled={busy !== undefined || draft === item.body}>
                保存する
              </Button>
              <Button onClick={() => setDraft(undefined)} disabled={busy === "body"}>
                やめる
              </Button>
            </div>
          </div>
        ) : item.body.trim() ? (
          <Markdown text={item.body} />
        ) : (
          <p className="text-sm text-muted-foreground">説明はありません。</p>
        ),
    },
  ];
}

export default { order: 0, useEntries: useBody } satisfies ConversationPart;
