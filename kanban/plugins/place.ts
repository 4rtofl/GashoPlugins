// What the kanban makes of what a board plugin's `state` and `headings` give: the board and check.ts use the same, so
// that check.ts lists the cards as the board shows them. The kanban writes this file again whenever it starts.
import type { BoardHeading, CardAction, CardMark, FetchRepo, KanbanColumn, Placement, StateCard } from "./types.ts";

/** The columns, in their order on the board. */
export const KANBAN_COLUMNS: { id: KanbanColumn; label: string }[] = [
  { id: "mine", label: "自分の番" },
  { id: "agent", label: "エージェント作業中" },
  { id: "github", label: "GitHub 待ち" },
  { id: "review", label: "レビュー待ち" },
  { id: "done", label: "完了" },
];

const COLUMN_IDS = new Set<string>(KANBAN_COLUMNS.map((c) => c.id));

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The instructions `state` gave, or why they cannot be used; none given is an empty list. */
function actionsOf(given: unknown): CardAction[] | string {
  if (given === undefined) return [];
  if (!Array.isArray(given)) return "actions が配列ではありません。";
  const out: CardAction[] = [];
  for (const a of given) {
    const { label, text } = (a ?? {}) as { label?: unknown; text?: unknown };
    if (typeof label !== "string" || !label.trim() || typeof text !== "string" || !text.trim()) return "actions のそれぞれに、空でない label と text が要ります。";
    out.push({ label: label.trim(), text: text.trim() });
  }
  return out;
}

/** The marks `state` gave, or why they cannot be used; none given is an empty list. */
function marksOf(given: unknown): CardMark[] | string {
  if (given === undefined) return [];
  if (!Array.isArray(given)) return "marks が配列ではありません。";
  const out: CardMark[] = [];
  for (const m of given) {
    if (!isRecord(m) || !text(m.text)) return "marks のそれぞれに、空でない text が要ります。";
    const detail = text(m.detail);
    out.push({ text: text(m.text), ...(detail ? { detail } : {}), ...(m.active === true ? { active: true } : {}) });
  }
  return out;
}

/**
 * Where `state` (what a board plugin exports as it) puts `card`, with what its `fetch` gave: the column, the reason and
 * the marks and instructions, trimmed and without empty ones; or why it cannot be used (the board then puts the card
 * in "mine").
 */
export function placeWith(state: unknown, card: StateCard, fetched: unknown): Placement | { error: string } {
  if (typeof state !== "function") return { error: "index.ts が state を export していません。" };
  let placed: unknown;
  try {
    placed = state(card, fetched);
  } catch (e) {
    return { error: `state が失敗しました：${why(e)}` };
  }
  const { column, reason, marks, actions } = (placed ?? {}) as { column?: unknown; reason?: unknown; marks?: unknown; actions?: unknown };
  if (typeof column !== "string" || !COLUMN_IDS.has(column)) return { error: `state が知らない列を返しました：${String(column)}` };
  const shown = marksOf(marks);
  if (typeof shown === "string") return { error: `state が返した印を使えません：${shown}` };
  const menu = actionsOf(actions);
  if (typeof menu === "string") return { error: `state が返した指示を使えません：${menu}` };
  const said = text(reason);
  return {
    column: column as KanbanColumn,
    ...(said ? { reason: said } : {}),
    ...(shown.length > 0 ? { marks: shown } : {}),
    ...(menu.length > 0 ? { actions: menu } : {}),
  };
}

/** The headings `headings` (what a board plugin may export as it) gives for `repo`, or why they cannot be used. */
export function headingsWith(headings: unknown, repo: FetchRepo, fetched: unknown): BoardHeading[] | { error: string } {
  if (typeof headings !== "function") return [];
  let given: unknown;
  try {
    given = headings(structuredClone(repo), fetched);
  } catch (e) {
    return { error: `headings が失敗しました：${why(e)}` };
  }
  if (!Array.isArray(given)) return { error: "headings が返した見出しを使えません：配列ではありません。" };
  const out: BoardHeading[] = [];
  for (const h of given) {
    if (!isRecord(h) || !text(h.label)) return { error: "headings が返した見出しを使えません：それぞれに、空でない label が要ります。" };
    const [said, detail] = [text(h.text), text(h.detail)];
    out.push({
      label: text(h.label),
      ...(said ? { text: said } : {}),
      ...(typeof h.at === "number" && Number.isFinite(h.at) ? { at: h.at } : {}),
      ...(h.active === true ? { active: true } : {}),
      ...(detail ? { detail } : {}),
    });
  }
  return out;
}
