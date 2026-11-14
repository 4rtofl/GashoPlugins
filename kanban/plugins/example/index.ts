// The sample board plugin: puts a card in a column by its pull request and its Claude Code sessions. "GitHub 待ち"
// needs CI, which cards do not have yet, so no card goes there.
import type { State } from "../types.ts";

export const state: State = (card) => {
  if (card.pr?.state === "merged") return { column: "done", reason: "マージ済み" };
  if (card.pr?.state === "closed") return { column: "done", reason: "クローズ済み" };
  if (card.sessions.some((s) => s.status === "waiting")) return { column: "mine", reason: "Claude が答えを待っている" };
  if (card.sessions.some((s) => s.status === "busy")) return { column: "agent", reason: "Claude が作業している" };
  if (card.pr && !card.pr.draft) return { column: "review", reason: "PR がレビュー待ち" };
  if (card.pr?.draft) return { column: "mine", reason: "PR が Draft" };
  return { column: "mine", reason: "PR がまだない" };
};
