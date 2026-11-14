// The sample board plugin: puts a card in a column by its pull request and its Claude Code sessions, and offers what to
// ask Claude next on the card's menu. "GitHub 待ち" needs CI, which cards do not have yet, so no card goes there.
import type { State } from "../types.ts";

export const state: State = (card) => {
  if (card.pr?.state === "merged") return { column: "done", reason: "マージ済み" };
  if (card.pr?.state === "closed") return { column: "done", reason: "クローズ済み" };
  if (card.sessions.some((s) => s.status === "waiting")) return { column: "mine", reason: "Claude が答えを待っている" };
  if (card.sessions.some((s) => s.status === "busy")) return { column: "agent", reason: "Claude が作業している" };
  if (card.pr && !card.pr.draft) {
    const text = `PR #${card.pr.number} のレビューのコメントを読んで、直すものを直して`;
    return { column: "review", reason: "PR がレビュー待ち", actions: [{ label: "レビューのコメントに対応する", text }] };
  }
  if (card.pr?.draft) {
    const text = `PR #${card.pr.number} の差分を見直して、Ready for review にしてよいか教えて`;
    return { column: "mine", reason: "PR が Draft", actions: [{ label: "PR を見直す", text }] };
  }
  const actions = card.issue === undefined ? [] : [{ label: "Issue を実装する", text: `Issue #${card.issue} を読んで実装して` }];
  return { column: "mine", reason: "PR がまだない", actions };
};
