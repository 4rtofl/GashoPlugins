// The body, at the top of the conversation, with a button that edits it (an Undo Toast can put the old text back) and its
// reactions.
import { FileText, Pencil } from "lucide-react";
import { cn, Markdown, RelativeTime } from "@gasho/plugin-sdk";
import { bodyEditParams } from "../../../edit-was.ts";
import { Alert } from "../../ui/alert.tsx";
import { Button } from "../../ui/button.tsx";
import { INPUT } from "../../ui/input.ts";
import { useDraft, useItem } from "../context.tsx";
import { useConversationMeta } from "../conversation-meta.ts";
import type { ConversationEntry, ConversationPart } from "../parts.ts";
import { Reactions } from "../reactions.tsx";

function useBody(): ConversationEntry[] {
  const { item, where, now, busy, run } = useItem();
  const meta = useConversationMeta().data;
  // What is typed, and GitHub's body when the edit started: the daemon part refuses to save over another one. `over`:
  // the body a save replaced, which the item read before the save still shows until it is read again.
  const [edit, setEdit] = useDraft<{ draft: string; from: string; over?: string }>("body");
  const changed = edit !== undefined && edit.from !== item.body && edit.over !== item.body;
  // `base`: GitHub's body the draft is saved over.
  const save = async (base: string) => {
    if (!edit) return;
    const sent = edit.draft;
    const ok = await run({
      id: "body",
      op: "edit",
      params: bodyEditParams(sent, base),
      summary: `#${where.number} の本文を変える`,
      done: "本文を変えました",
      undo: { op: "edit", params: { body: base }, summary: `#${where.number} の本文を戻す` },
    });
    // A body changed while it was being saved stays in the box, to be saved again over the one just saved.
    if (ok) setEdit((e) => (!e || e.draft === sent ? undefined : { ...e, from: sent, over: base }));
  };
  return [
    {
      key: "body",
      at: item.createdAt,
      pin: "top",
      icon: FileText,
      title: (
        <>
          <span className="font-medium text-foreground/90">{item.author ?? "不明"}</span> が作成
        </>
      ),
      time: <RelativeTime at={item.createdAt} now={now} />,
      ...(edit === undefined && {
        actions: (
          <Button variant="ghost" size="xs" leftIcon={<Pencil />} onClick={() => setEdit({ draft: item.body, from: item.body })}>
            編集
          </Button>
        ),
      }),
      body:
        edit !== undefined ? (
          <div className="space-y-2">
            <textarea value={edit.draft} onChange={(e) => setEdit({ ...edit, draft: e.target.value })} aria-label="本文" rows={Math.min(30, Math.max(8, edit.draft.split("\n").length + 2))} className={cn(INPUT, "font-mono text-xs")} />
            {changed && (
              <Alert tone="warning">
                <p>編集を始めたあとに、GitHub で本文が変わりました。このまま保存すると、その変更は消えます。</p>
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-xs">GitHub の今の本文</summary>
                  <pre className="mt-1.5 max-h-60 overflow-auto rounded-md border border-border bg-surface-raised p-2 font-mono text-xs whitespace-pre-wrap break-words">{item.body}</pre>
                </details>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="xs" onClick={() => setEdit({ draft: item.body, from: item.body })} disabled={busy !== undefined}>
                    今の本文から書き直す
                  </Button>
                  <Button size="xs" onClick={() => void save(item.body)} disabled={busy !== undefined || edit.draft === item.body}>
                    自分の本文で上書きする
                  </Button>
                </div>
              </Alert>
            )}
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void save(edit.from)} isLoading={busy === "body"} loadingText="保存しています…" disabled={busy !== undefined || changed || edit.draft === item.body}>
                保存する
              </Button>
              <Button onClick={() => setEdit(undefined)} disabled={busy === "body"}>
                やめる
              </Button>
            </div>
          </div>
        ) : (
          <>
            {item.body.trim() ? <Markdown text={item.body} /> : <p className="text-sm text-muted-foreground">説明はありません。</p>}
            {meta && <Reactions subject={meta.id} reactions={meta.reactions} of="本文" />}
          </>
        ),
    },
  ];
}

export default { order: 0, useEntries: useBody } satisfies ConversationPart;
