// The #numbers in the conversation's cards (the body, comments, reviews), as GitHub shows them: in the color of a link,
// opening the issue or pull request on GitHub when clicked, and with a card that GitHub calls a hovercard (the
// repository and the day it was made, the title, the state, the start of the body, the labels, and how gh's login is
// related to it), read once the pointer has stayed on one a moment (ops/card.ts). Gasho's Markdown leaves #numbers as
// text, and the text React drew is not changed: the color is a CSS highlight (style.css), and the number under the
// pointer is found in the text where the browser would put a caret. It draws nothing else; what it listens to is the
// screen it is drawn in.
import { UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRequest } from "@gasho/plugin-sdk";
import type { ItemCard } from "../../../daemon/ops/card.ts";
import { readOp } from "../../daemon.ts";
import { refAt, refsIn } from "../../refs.ts";
import { Badge } from "../../ui/badge.tsx";
import { SkeletonText } from "../../ui/skeleton.tsx";
import { useItem } from "../context.tsx";
import type { ItemSection } from "../parts.ts";
import { StateBadge } from "../state-badge.tsx";

/** How long the pointer stays on a #number before its card shows: each card takes a point of GitHub's hourly limit. */
const SHOW_AFTER_MS = 350;
const WIDTH = 320;
/** About the height of a card with labels and the line of how gh's login is related to it. */
const HEIGHT = 240;
/** The name style.css colors the #numbers by. */
const HIGHLIGHT = "github-implement-ref";
/** Text that is code, or that a person types: its #numbers are not GitHub's. */
const NOT_PROSE = "code, pre, textarea, input";

interface Hovered {
  number: number;
  rect: DOMRect;
  /** In a link of the Markdown, which goes where it says when clicked. */
  linked: boolean;
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

const inConversation = (scope: HTMLElement, el: Element | null): el is Element => Boolean(el && scope.contains(el) && el.closest("article") && !el.closest(NOT_PROSE));

/** The #number under the point, in a card of the conversation's timeline, and where it is. */
function hoveredAt(scope: HTMLElement, x: number, y: number): Hovered | undefined {
  const caret = caretAt(x, y);
  const node = caret?.node;
  if (!caret || !(node instanceof Text) || !inConversation(scope, node.parentElement)) return undefined;
  const ref = refAt(node.data, caret.offset);
  if (!ref) return undefined;
  // The caret is the nearest place to the point: past the end of a line, it is at the line's last character.
  const range = document.createRange();
  range.setStart(node, ref.start);
  range.setEnd(node, ref.end);
  const rect = [...range.getClientRects()].find((r) => x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1);
  return rect ? { number: ref.number, rect, linked: Boolean(node.parentElement?.closest("a")) } : undefined;
}

/** The #numbers of the conversation that are not in a link already. */
function refRanges(scope: HTMLElement): Range[] {
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (!text.data.includes("#") || !inConversation(scope, text.parentElement) || text.parentElement.closest("a")) continue;
    for (const ref of refsIn(text.data)) {
      const range = document.createRange();
      range.setStart(text, ref.start);
      range.setEnd(text, ref.end);
      ranges.push(range);
    }
  }
  return ranges;
}

let highlight: Highlight | undefined;

/** The highlight every screen adds its #numbers to: the page has one per name. Undefined in browsers without it. */
function refHighlight(): Highlight | undefined {
  if (typeof Highlight === "undefined" || !("highlights" in CSS)) return undefined;
  if (!highlight) {
    highlight = new Highlight();
    CSS.highlights.set(HIGHLIGHT, highlight);
  }
  return highlight;
}

/** "11月14日", with the year when it is not this year's. */
function day(iso: string): string | undefined {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString("ja-JP", { ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }), month: "long", day: "numeric" });
}

function CardBody({ card, repo }: { card: ItemCard; repo: string }) {
  const made = day(card.createdAt);
  const mine = [card.assigned && "担当", card.authored && "作成", card.commented && "コメント済み"].filter((m) => m !== false);
  return (
    <div className="space-y-2">
      <p className="truncate text-muted-foreground">
        {repo}
        {made && ` · ${made}に作成`}
      </p>
      <p className="text-sm leading-snug font-medium break-words text-foreground">
        {card.title} <span className="font-normal text-muted-foreground tabular-nums">#{card.number}</span>
      </p>
      <StateBadge item={card} />
      {card.excerpt && <p className="line-clamp-3 break-words text-muted-foreground">{card.excerpt}</p>}
      {card.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {card.labels.map((l) => (
            <Badge key={l.name} variant="outline" dot={l.color ? `#${l.color}` : true}>
              {l.name}
            </Badge>
          ))}
        </div>
      )}
      {mine.length > 0 && (
        <p className="flex items-center gap-1.5 border-t border-border pt-2 text-muted-foreground">
          <UserRound className="size-3.5 shrink-0" />
          自分：{mine.join("・")}
        </p>
      )}
    </div>
  );
}

function Card({ machine, repo, at }: { machine: string; repo: string; at: Hovered }) {
  const r = useRequest<ItemCard | null>(readOp(machine, "card", { repo, number: at.number }), { staleSeconds: 300 });
  const card = r.data;
  // Below the #number, or above it when the window's bottom is near; within the window's width.
  const left = Math.max(8, Math.min(at.rect.left, window.innerWidth - WIDTH - 8));
  const place = at.rect.bottom + HEIGHT < window.innerHeight ? { top: at.rect.bottom + 6 } : { bottom: window.innerHeight - at.rect.top + 6 };
  return (
    <div role="tooltip" style={{ left, width: WIDTH, ...place }} className="pointer-events-none fixed z-[90] rounded-lg border border-border bg-surface p-3 text-xs shadow-lg">
      {card ? (
        <CardBody card={card} repo={repo} />
      ) : card === null ? (
        <p className="text-muted-foreground">#{at.number} は、このリポジトリの Issue にも Pull request にもありません。</p>
      ) : r.error ? (
        <p className="text-red-600 dark:text-red-400">#{at.number} を読めませんでした：{r.error}</p>
      ) : (
        <div role="status" aria-label="読み込み中">
          <SkeletonText lines={3} />
        </div>
      )}
    </div>
  );
}

function Hovercard() {
  const { machine, where } = useItem();
  const anchor = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState<Hovered>();
  const repo = where.repo;
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
      scope.style.cursor = "";
      setHovered(undefined);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const { clientX: x, clientY: y } = e;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const found = hoveredAt(scope, x, y);
        scope.style.cursor = found && !found.linked ? "pointer" : "";
        const key = found && `${found.number}@${Math.round(found.rect.left)},${Math.round(found.rect.top)}`;
        if (key === current) return;
        current = key;
        clearTimeout(timer);
        setHovered(undefined);
        if (found) timer = setTimeout(() => setHovered(found), SHOW_AFTER_MS);
      });
    };
    const onClick = (e: MouseEvent) => {
      // Not when the click ends a selection of the text.
      if (e.button !== 0 || e.defaultPrevented || document.getSelection()?.isCollapsed === false) return;
      const found = hoveredAt(scope, e.clientX, e.clientY);
      if (!found || found.linked) return;
      e.preventDefault();
      // GitHub opens a pull request's page from its number's issue page.
      window.open(`https://github.com/${repo}/issues/${found.number}`, "_blank", "noopener,noreferrer");
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();

    // The #numbers are colored again whenever the conversation changes; their ranges follow the text till then.
    const marks = refHighlight();
    let ranges: Range[] = [];
    let colorFrame = 0;
    const color = () => {
      if (!marks) return;
      for (const r of ranges) marks.delete(r);
      ranges = refRanges(scope);
      for (const r of ranges) marks.add(r);
    };
    const changes = new MutationObserver(() => {
      cancelAnimationFrame(colorFrame);
      colorFrame = requestAnimationFrame(color);
    });
    if (marks) {
      color();
      changes.observe(scope, { childList: true, subtree: true, characterData: true });
    }

    scope.addEventListener("pointermove", onMove);
    scope.addEventListener("pointerleave", hide);
    scope.addEventListener("click", onClick);
    // The card stays where the #number was: scrolling (of any part of the page) takes it away.
    window.addEventListener("scroll", hide, true);
    window.addEventListener("keydown", onKey);
    return () => {
      hide();
      changes.disconnect();
      cancelAnimationFrame(colorFrame);
      for (const r of ranges) marks?.delete(r);
      scope.removeEventListener("pointermove", onMove);
      scope.removeEventListener("pointerleave", hide);
      scope.removeEventListener("click", onClick);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [repo]);
  return (
    <>
      <span ref={anchor} hidden />
      {hovered && <Card machine={machine} repo={repo} at={hovered} />}
    </>
  );
}

export default { order: 1000, kinds: ["issues", "pulls"], View: Hovercard } satisfies ItemSection;
