// The comments, and how many older ones are left out (GitHub has them). gh's login edits its own comments (an Undo
// Toast puts the old text back) and deletes them once it is asked again; the comments of bots can be hidden, each run
// of them one line that shows them again. Which comments those are, and the reactions, come from conversation-meta.ts.
import { Bot, EyeOff, ExternalLink, History, MessageSquare, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { cn, Markdown, RelativeTime, usePluginState } from "@gasho/plugin-sdk";
import type { GitHubComment } from "../../../types.ts";
import { Alert } from "../../ui/alert.tsx";
import { Badge } from "../../ui/badge.tsx";
import { Button, buttonClass } from "../../ui/button.tsx";
import { INPUT } from "../../ui/input.ts";
import { useAfterChange, useItem } from "../context.tsx";
import { useConversationMeta } from "../conversation-meta.ts";
import type { ConversationEntry, ConversationPart } from "../parts.ts";
import { Reactions } from "../reactions.tsx";

/** The daemon part cuts a longer comment (gh.ts, clip): saving the cut text would lose the rest, so it is not edited here. */
const EDITABLE_MAX = 60_000;

/** The comment being edited, with its new text, or being asked about before it is deleted: one at a time. */
type Opened = { url: string; draft: string } | { url: string; deleting: true };

function useComments(): ConversationEntry[] {
  const { item, where, now, busy, run } = useItem();
  const meta = useConversationMeta();
  useAfterChange(meta.reload);
  const [hideBots, setHideBots] = usePluginState("hideBots", false);
  const [opened, setOpened] = useState<Opened>();
  const byUrl = new Map((meta.data?.comments ?? []).map((m) => [m.url, m]));
  const comments = item.comments ?? [];
  const entries: ConversationEntry[] = [];
  let hidden: GitHubComment[] = [];
  const endHidden = () => {
    const first = hidden[0];
    if (!first) return;
    const authors = [...new Set(hidden.map((c) => c.author ?? "不明"))].join("、");
    entries.push({
      key: `bots-${first.url ?? first.createdAt}`,
      at: first.createdAt,
      icon: Bot,
      title: (
        <>
          bot のコメント {hidden.length} 件を隠しています（{authors}）
          <button type="button" onClick={() => setHideBots(false)} className={cn(buttonClass("ghost", "xs"), "ml-1.5 h-6 align-middle")}>
            表示する
          </button>
        </>
      ),
    });
    hidden = [];
  };
  comments.forEach((c, i) => {
    const m = c.url ? byUrl.get(c.url) : undefined;
    if (m?.bot && hideBots) {
      hidden.push(c);
      return;
    }
    endHidden();
    const open = opened && opened.url === c.url ? opened : undefined;
    const edit = m?.editable && !c.minimized && c.body.length <= EDITABLE_MAX ? m : undefined;
    const save = async (draft: string) => {
      if (!edit) return;
      const id = `#${where.number} の自分のコメント`;
      const ok = await run({
        id: `comment-edit:${edit.id}`,
        op: "comment-edit",
        params: { id: edit.id, body: draft },
        summary: `${id}を変える`,
        done: "コメントを変えました",
        undo: { op: "comment-edit", params: { id: edit.id, body: c.body }, summary: `${id}を戻す` },
      });
      if (ok) setOpened(undefined);
    };
    const remove = async () => {
      if (!m?.deletable) return;
      const ok = await run({ id: `comment-delete:${m.id}`, op: "comment-delete", params: { id: m.id }, summary: `#${where.number} の自分のコメントを削除する`, done: "コメントを削除しました" });
      if (ok) setOpened(undefined);
    };
    const text = c.minimized ? (
      <p className="text-sm text-muted-foreground">GitHub で非表示にされたコメントです。</p>
    ) : c.body.trim() ? (
      <Markdown text={c.body} />
    ) : (
      <p className="text-sm text-muted-foreground">（本文なし）</p>
    );
    entries.push({
      key: `comment${i}`,
      at: c.createdAt,
      icon: m?.bot ? Bot : MessageSquare,
      title: (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span>
            <span className="font-medium text-foreground/90">{c.author ?? "不明"}</span> がコメント
          </span>
          {m?.bot && <Badge>bot</Badge>}
        </span>
      ),
      time: <RelativeTime at={c.createdAt} now={now} />,
      actions: (
        <>
          {m?.bot && (
            <Button variant="ghost" size="icon" onClick={() => setHideBots(true)} aria-label="bot のコメントを隠す" title="bot のコメントを隠す">
              <EyeOff />
            </Button>
          )}
          {!open && edit && (
            <Button variant="ghost" size="xs" leftIcon={<Pencil />} onClick={() => setOpened({ url: edit.url, draft: c.body })} disabled={busy !== undefined}>
              編集
            </Button>
          )}
          {!open && m?.deletable && (
            <Button variant="ghost" size="icon" onClick={() => setOpened({ url: m.url, deleting: true })} disabled={busy !== undefined} aria-label="コメントを削除する" title="コメントを削除する">
              <Trash2 />
            </Button>
          )}
          {c.url && (
            <a href={c.url} target="_blank" rel="noreferrer" aria-label="GitHub で開く" title="GitHub で開く" className={buttonClass("ghost", "icon")}>
              <ExternalLink />
            </a>
          )}
        </>
      ),
      body:
        open && "draft" in open ? (
          <div className="space-y-2">
            <textarea
              value={open.draft}
              onChange={(e) => setOpened({ url: open.url, draft: e.target.value })}
              aria-label="コメント"
              rows={Math.min(30, Math.max(6, open.draft.split("\n").length + 2))}
              className={cn(INPUT, "font-mono text-xs")}
            />
            <div className="flex gap-2">
              <Button
                variant="primary"
                onClick={() => void save(open.draft)}
                isLoading={busy === `comment-edit:${edit?.id}`}
                loadingText="保存しています…"
                disabled={busy !== undefined || !open.draft.trim() || open.draft === c.body}
              >
                保存する
              </Button>
              <Button onClick={() => setOpened(undefined)} disabled={busy !== undefined}>
                やめる
              </Button>
            </div>
          </div>
        ) : (
          <>
            {open && (
              <Alert
                tone="warning"
                className="mb-2.5"
                action={
                  <div className="flex gap-1.5">
                    <Button variant="destructive" size="xs" onClick={() => void remove()} isLoading={busy === `comment-delete:${m?.id}`} loadingText="削除しています…" disabled={busy !== undefined}>
                      削除する
                    </Button>
                    <Button size="xs" onClick={() => setOpened(undefined)} disabled={busy !== undefined}>
                      やめる
                    </Button>
                  </div>
                }
              >
                このコメントを削除します。GitHub でも元に戻せません。
              </Alert>
            )}
            {text}
            {m && !c.minimized && <Reactions subject={m.id} reactions={m.reactions} of={`コメント（${c.author ?? "不明"}）`} />}
          </>
        ),
    });
  });
  endHidden();
  const first = comments[0];
  if (item.commentsLeftOut && first) {
    // Just before the oldest comment shown.
    const at = new Date(new Date(first.createdAt).getTime() - 1).toISOString();
    entries.unshift({ key: "left-out", at, icon: History, title: `古いコメント ${item.commentsLeftOut} 件は省いています。GitHub で読めます。` });
  }
  return entries;
}

/** Below the timeline when the comments' ids and reactions could not be read: the comments themselves are still there. */
function MetaError() {
  const meta = useConversationMeta();
  if (!meta.error) return null;
  return <Alert tone="warning">リアクションと、コメントの編集・削除・bot を隠すのに使う情報を読めませんでした：{meta.error}</Alert>;
}

export default { order: 20, useEntries: useComments, End: MetaError } satisfies ConversationPart;
