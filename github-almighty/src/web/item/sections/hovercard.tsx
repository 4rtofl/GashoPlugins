// The card over a #number in the conversation's cards (the body, comments, reviews), as GitHub's hovercard: the title
// and state of that issue or pull request, read once the pointer has stayed on it a moment (ops/summary.ts). Gasho's
// Markdown leaves #numbers as text, so the number is found in the text where the browser would put a caret under the
// pointer. It shows nothing else; what it listens to is the screen it is drawn in.
import { useEffect, useRef, useState } from "react";
import { useRequest } from "@gasho/plugin-sdk";
import type { ItemSummary } from "../../../types.ts";
import { readOp } from "../../daemon.ts";
import { refAt } from "../../refs.ts";
import { itemIcon } from "../../tabs.ts";
import { Badge, type BadgeTone } from "../../ui/badge.tsx";
import { SkeletonText } from "../../ui/skeleton.tsx";
import { useItem } from "../context.tsx";
import type { ItemSection } from "../parts.ts";

/** How long the pointer stays on a #number before its card shows: each card takes a point of GitHub's hourly limit. */
const SHOW_AFTER_MS = 350;
const WIDTH = 320;

interface Hovered {
  number: number;
  rect: DOMRect;
}

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

function caretAt(x: number, y: number): { node: Node; offset: number } | undefined {
  const d = document as CaretDocument;
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : undefined;
  }
  const r = d.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : undefined;
}

/** The #number under the point, in a card of the conversation's timeline (not in code), and where it is. */
function hoveredAt(scope: HTMLElement, x: number, y: number): Hovered | undefined {
  const caret = caretAt(x, y);
  const node = caret?.node;
  if (!caret || !(node instanceof Text)) return undefined;
  const el = node.parentElement;
  if (!el || !scope.contains(el) || !el.closest("article") || el.closest("code, pre, textarea, input")) return undefined;
  const ref = refAt(node.data, caret.offset);
  if (!ref) return undefined;
  // The caret is the nearest place to the point: past the end of a line, it is at the line's last character.
  const range = document.createRange();
  range.setStart(node, ref.start);
  range.setEnd(node, ref.end);
  const rect = [...range.getClientRects()].find((r) => x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1);
  return rect ? { number: ref.number, rect } : undefined;
}

/** An item's state, as GitHub colors it. */
function look(i: ItemSummary): [string, BadgeTone] {
  if (i.state === "merged") return ["Merged", "merged"];
  if (i.state === "closed") return ["Closed", i.kind === "pulls" ? "danger" : "merged"];
  return i.draft ? ["Draft", "neutral"] : ["Open", "success"];
}

function Card({ machine, repo, at }: { machine: string; repo: string; at: Hovered }) {
  const r = useRequest<ItemSummary | null>(readOp(machine, "summary", { repo, number: at.number }), { staleSeconds: 300 });
  const s = r.data;
  const Icon = s ? itemIcon(s) : undefined;
  const [state, tone] = s ? look(s) : [];
  // Below the #number, or above it when the window's bottom is near; within the window's width.
  const left = Math.max(8, Math.min(at.rect.left, window.innerWidth - WIDTH - 8));
  const place = at.rect.bottom + 110 < window.innerHeight ? { top: at.rect.bottom + 6 } : { bottom: window.innerHeight - at.rect.top + 6 };
  return (
    <div role="tooltip" style={{ left, width: WIDTH, ...place }} className="pointer-events-none fixed z-[90] rounded-lg border border-border bg-surface p-3 text-xs shadow-lg">
      {s && Icon ? (
        <div className="flex gap-2.5">
          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-sm leading-snug font-medium break-words text-foreground">{s.title}</p>
            <p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
              <Badge tone={tone} className="h-5 px-2">
                {state}
              </Badge>
              <span className="tabular-nums">#{s.number}</span> · {s.kind === "pulls" ? "Pull request" : "Issue"}
            </p>
          </div>
        </div>
      ) : s === null ? (
        <p className="text-muted-foreground">#{at.number} は、このリポジトリの Issue にも Pull request にもありません。</p>
      ) : r.error ? (
        <p className="text-red-600 dark:text-red-400">#{at.number} を読めませんでした：{r.error}</p>
      ) : (
        <div role="status" aria-label="読み込み中">
          <SkeletonText lines={2} />
        </div>
      )}
    </div>
  );
}

function Hovercard() {
  const { machine, where } = useItem();
  const anchor = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState<Hovered>();
  useEffect(() => {
    // The screen this is drawn in: the rows and the tabs of the item are its other children.
    const scope = anchor.current?.parentElement;
    if (!scope) return;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: string | undefined;
    const hide = () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      current = undefined;
      setHovered(undefined);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const { clientX: x, clientY: y } = e;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const found = hoveredAt(scope, x, y);
        const key = found && `${found.number}@${Math.round(found.rect.left)},${Math.round(found.rect.top)}`;
        if (key === current) return;
        current = key;
        clearTimeout(timer);
        setHovered(undefined);
        if (found) timer = setTimeout(() => setHovered(found), SHOW_AFTER_MS);
      });
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    scope.addEventListener("pointermove", onMove);
    scope.addEventListener("pointerleave", hide);
    // The card stays where the #number was: scrolling (of any part of the page) takes it away.
    window.addEventListener("scroll", hide, true);
    window.addEventListener("keydown", onKey);
    return () => {
      hide();
      scope.removeEventListener("pointermove", onMove);
      scope.removeEventListener("pointerleave", hide);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <>
      <span ref={anchor} hidden />
      {hovered && <Card machine={machine} repo={where.repo} at={hovered} />}
    </>
  );
}

export default { order: 1000, kinds: ["issues", "pulls"], View: Hovercard } satisfies ItemSection;
