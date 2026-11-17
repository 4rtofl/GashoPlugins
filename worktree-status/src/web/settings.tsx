// On the settings screen: the headings of 「手で決めた状態」, to add, rename, move up and down and remove. Every change is
// kept on the Gasho server at once, the same for every browser (useSharedState).
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { cn, useSharedState } from "@gasho/plugin-sdk";
import { DEFAULT_HEADINGS, forget, HEADINGS, MAX_TITLE, moveHeading, newHeadingId, PLACED, type Heading, type Placed } from "./headings";

const FIELD = "w-full min-w-0 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-border-hover";
const BUTTON =
  "inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-medium whitespace-nowrap transition-colors duration-150 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5";
const SECONDARY = "border-border bg-surface text-foreground hover:border-border-hover hover:bg-surface-hover";
const GHOST = "border-transparent text-muted-foreground hover:bg-surface-hover hover:text-foreground";

interface RowProps {
  heading: Heading;
  index: number;
  count: number;
  onRename: (title: string) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}

/** A heading's name is kept once it is left (Enter or another field), so that the sidebar does not change at every key. */
function HeadingRow({ heading, index, count, onRename, onMove, onRemove }: RowProps) {
  const [draft, setDraft] = useState(heading.title);
  // What another browser saved shows here.
  useEffect(() => setDraft(heading.title), [heading.title]);
  const commit = () => {
    const title = draft.trim();
    // Gasho leaves out a category without a title, and its worktrees with it: an empty name is not kept.
    if (!title || title === heading.title) setDraft(heading.title);
    else onRename(title);
  };
  const n = index + 1;
  return (
    <li className="flex items-center gap-1.5">
      <input
        value={draft}
        maxLength={MAX_TITLE}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setDraft(heading.title);
        }}
        aria-label={`見出し ${n} の名前`}
        className={FIELD}
      />
      <button type="button" disabled={index === 0} onClick={() => onMove(-1)} aria-label={`見出し ${n} を上へ`} title="上へ" className={cn(BUTTON, GHOST, "w-8 px-0")}>
        <ArrowUp />
      </button>
      <button type="button" disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`見出し ${n} を下へ`} title="下へ" className={cn(BUTTON, GHOST, "w-8 px-0")}>
        <ArrowDown />
      </button>
      <button type="button" onClick={onRemove} aria-label={`見出し ${n} を消す`} className={cn(BUTTON, GHOST)}>
        <Trash2 />
        消す
      </button>
    </li>
  );
}

export function HeadingSettings() {
  const [headings, setHeadings] = useSharedState<Heading[]>(HEADINGS, DEFAULT_HEADINGS);
  const [, setPlaced] = useSharedState<Placed>(PLACED, {});
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string>();
  const save = (...saving: Promise<void>[]) => {
    setError(undefined);
    Promise.all(saving).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  const add = () => {
    const t = title.trim();
    if (!t) return;
    save(setHeadings((hs) => [...hs, { id: newHeadingId(hs), title: t }]));
    setTitle("");
  };
  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        サイドバーの worktree の一覧の ▤ のメニューで、分け方を「手で決めた状態」にすると、この順に見出しが並びます。worktree の行を見出しへドラッグすると、その見出しに入ります。どの見出しにも入れていない
        worktree と、消した見出しにあった worktree は、最後の「その他」に並びます。見出しと、worktree を入れた見出しは、どのブラウザーでも同じです。
      </p>
      {headings.length === 0 ? (
        <p className="text-xs text-muted-foreground">見出しはありません。どの worktree も「その他」に並びます。</p>
      ) : (
        <ol className="space-y-2">
          {headings.map((h, i) => (
            <HeadingRow
              key={h.id}
              heading={h}
              index={i}
              count={headings.length}
              onRename={(t) => save(setHeadings((hs) => hs.map((x) => (x.id === h.id ? { ...x, title: t } : x))))}
              onMove={(delta) => save(setHeadings((hs) => moveHeading(hs, h.id, delta)))}
              onRemove={() => save(setHeadings((hs) => hs.filter((x) => x.id !== h.id)), setPlaced((p) => forget(p, h.id)))}
            />
          ))}
        </ol>
      )}
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input value={title} maxLength={MAX_TITLE} onChange={(e) => setTitle(e.target.value)} placeholder="新しい見出しの名前" aria-label="新しい見出しの名前" className={FIELD} />
        <button type="submit" disabled={!title.trim()} className={cn(BUTTON, SECONDARY)}>
          <Plus />
          見出しを足す
        </button>
      </form>
      {error && <p className="text-xs text-red-500">保存できませんでした：{error}</p>}
    </div>
  );
}
