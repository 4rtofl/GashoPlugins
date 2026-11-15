// The reactions of the body or a comment: a button per kind someone gave, with how many gave it (pressed when gh's login
// is one of them), and a button that opens the 8 kinds GitHub has. Pressing one gives it or takes it back, and an Undo
// Toast can put that back.
import { SmilePlus } from "lucide-react";
import { useState } from "react";
import { cn, Popover } from "@gasho/plugin-sdk";
import type { Reaction, ReactionContent } from "../../daemon/ops/comments.ts";
import { Button } from "../ui/button.tsx";
import { useItem } from "./context.tsx";

/** In GitHub's order. */
const EMOJI: Record<ReactionContent, string> = { THUMBS_UP: "👍", THUMBS_DOWN: "👎", LAUGH: "😄", HOORAY: "🎉", CONFUSED: "😕", HEART: "❤️", ROCKET: "🚀", EYES: "👀" };
const KINDS = Object.keys(EMOJI) as ReactionContent[];

/** `of` names what they are given to, for the operation log ("本文", "コメント（totosuki）"). */
export function Reactions({ subject, reactions, of }: { subject: string; reactions: Reaction[]; of: string }) {
  const { where, busy, run } = useItem();
  const [open, setOpen] = useState(false);
  const mine = new Set(reactions.filter((r) => r.mine).map((r) => r.content));
  const id = (content: ReactionContent) => `reaction:${subject}:${content}`;
  const toggle = (content: ReactionContent) => {
    const e = EMOJI[content];
    const on = `#${where.number} の${of}`;
    const give = { op: "reaction", params: { subject, content, add: true }, summary: `${on}に ${e} を付ける` };
    const take = { op: "reaction", params: { subject, content, add: false }, summary: `${on}から ${e} を外す` };
    void run(mine.has(content) ? { id: id(content), ...take, done: `${e} を外しました`, undo: give } : { id: id(content), ...give, done: `${e} を付けました`, undo: take });
  };
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
      {reactions.map((r) => (
        <button
          key={r.content}
          type="button"
          aria-pressed={r.mine}
          aria-label={`${EMOJI[r.content]} ${r.count} 人${r.mine ? "（自分も付けています。押すと外します）" : "（押すと付けます）"}`}
          title={r.mine ? "押すと外します" : "押すと付けます"}
          disabled={busy !== undefined}
          onClick={() => toggle(r.content)}
          className={cn(
            "inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border px-2 text-xs tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default",
            r.mine ? "border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-300" : "border-border text-muted-foreground hover:border-border-hover hover:text-foreground",
            busy === id(r.content) && "animate-pulse",
          )}
        >
          <span aria-hidden>{EMOJI[r.content]}</span>
          {r.count}
        </button>
      ))}
      <Popover
        label="リアクションを選ぶ"
        open={open}
        onOpenChange={setOpen}
        side="top"
        align="start"
        trigger={
          <Button variant="ghost" size="icon" disabled={busy !== undefined} aria-label="リアクションを付ける" title="リアクションを付ける">
            <SmilePlus />
          </Button>
        }
        className="w-auto p-1"
      >
        <div className="flex gap-0.5">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={mine.has(k)}
              aria-label={`${EMOJI[k]} を${mine.has(k) ? "外す" : "付ける"}`}
              onClick={() => {
                setOpen(false);
                toggle(k);
              }}
              className={cn("flex size-8 cursor-pointer items-center justify-center rounded-md text-base transition-colors hover:bg-surface-raised", mine.has(k) && "bg-sky-500/10")}
            >
              {EMOJI[k]}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}
