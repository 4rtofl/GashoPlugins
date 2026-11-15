// The reactions of the body, a comment or a review: a button per kind someone gave, with how many gave it (pressed when
// gh's login is one of them) and, as GitHub's tooltip, who gave it while the pointer is on it; and a button that opens
// the 8 kinds GitHub has. Pressing one gives it or takes it back, and an Undo Toast can put that back.
import { SmilePlus } from "lucide-react";
import { useEffect, useState } from "react";
import { cn, Popover } from "@gasho/plugin-sdk";
import type { Reaction, ReactionContent } from "../../daemon/ops/comments.ts";
import { Button } from "../ui/button.tsx";
import { useItem } from "./context.tsx";

/** In GitHub's order. */
const EMOJI: Record<ReactionContent, string> = { THUMBS_UP: "👍", THUMBS_DOWN: "👎", LAUGH: "😄", HOORAY: "🎉", CONFUSED: "😕", HEART: "❤️", ROCKET: "🚀", EYES: "👀" };
const KINDS = Object.keys(EMOJI) as ReactionContent[];

/** Who gave it, as GitHub's tooltip says: the first ones by name, then how many more. */
function reactorsText(r: Reaction): string {
  const others = r.count - r.users.length;
  const who = r.users.length === 0 ? `${r.count} 人` : others > 0 ? `${r.users.join("、")} ほか ${others} 人` : r.users.join("、");
  return `${who} が ${EMOJI[r.content]} を付けました`;
}

/** The reaction the pointer (or the keyboard's focus) is on, and where its button is. */
interface Tip {
  content: ReactionContent;
  rect: DOMRect;
}

/** Above the button, or below it near the window's top; from the button's left, within the window's width. */
function Tooltip({ text, rect }: { text: string; rect: DOMRect }) {
  const left = Math.max(8, rect.left);
  const place = rect.top > 64 ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 };
  return (
    <div
      aria-hidden
      style={{ left, maxWidth: Math.min(320, window.innerWidth - left - 8), ...place }}
      className="pointer-events-none fixed z-[90] rounded-md bg-neutral-800 px-2 py-1 text-xs leading-snug break-words text-white shadow-md dark:bg-neutral-700"
    >
      {text}
    </div>
  );
}

/** `of` names what they are given to, for the operation log ("本文", "コメント（totosuki）"). */
export function Reactions({ subject, reactions, of }: { subject: string; reactions: Reaction[]; of: string }) {
  const { where, busy, run } = useItem();
  const [open, setOpen] = useState(false);
  const [tip, setTip] = useState<Tip>();
  // It stays where the button was: scrolling (of any part of the page) takes it away.
  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(undefined);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("scroll", hide, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [tip]);
  // Read again after a change, it names who gives it now; a kind no one gives any longer has no button.
  const tipped = tip && reactions.find((r) => r.content === tip.content);
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
          aria-label={`${reactorsText(r)}${r.mine ? "（自分も付けています。押すと外します）" : "（押すと付けます）"}`}
          disabled={busy !== undefined}
          onClick={() => toggle(r.content)}
          onPointerEnter={(e) => e.pointerType !== "touch" && setTip({ content: r.content, rect: e.currentTarget.getBoundingClientRect() })}
          onPointerLeave={() => setTip(undefined)}
          onFocus={(e) => e.currentTarget.matches(":focus-visible") && setTip({ content: r.content, rect: e.currentTarget.getBoundingClientRect() })}
          onBlur={() => setTip(undefined)}
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
      {tip && tipped && <Tooltip text={reactorsText(tipped)} rect={tip.rect} />}
    </div>
  );
}
