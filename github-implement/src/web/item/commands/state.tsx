// ⌘K: close and reopen, and a pull request's ready for review and draft, as the buttons of sections/state.tsx do.
import { CircleCheck, CircleDot, CircleSlash, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, type LucideIcon } from "lucide-react";
import type { PaletteCommand } from "../../palette.tsx";
import { useItem, type Change } from "../context.tsx";
import type { ItemCommands } from "../palette.tsx";

function useStateCommands(): PaletteCommand[] {
  const { item, where, busy, run } = useItem();
  if (item.state === "merged") return [];
  const id = `#${where.number}`;
  const changes: (Change & { label: string; icon: LucideIcon; keywords: string })[] = [];
  if (item.kind === "pulls" && item.state === "open") {
    changes.push(
      item.draft
        ? { id: "ready", label: "Ready for review にする", icon: GitPullRequest, keywords: "ready draft", op: "ready", params: { ready: true }, summary: `${id} を Ready for review にする`, done: "Ready for review にしました", undo: { op: "ready", params: { ready: false }, summary: `${id} を Draft に戻す` } }
        : { id: "draft", label: "Draft に戻す", icon: GitPullRequestDraft, keywords: "draft", op: "ready", params: { ready: false }, summary: `${id} を Draft に戻す`, done: "Draft に戻しました", undo: { op: "ready", params: { ready: true }, summary: `${id} を Ready for review にする` } },
    );
  }
  const reopen = { op: "state", params: { action: "reopen" }, summary: `${id} を開き直す` };
  if (item.state === "open" && item.kind === "issues") {
    changes.push({ id: "close", label: "Issue を閉じる（完了）", icon: CircleCheck, keywords: "close done completed", op: "state", params: { action: "close", reason: "completed" }, summary: `${id} を閉じる（完了）`, done: "閉じました（完了）", undo: reopen });
    changes.push({ id: "notplanned", label: "Issue を閉じる（対応しない）", icon: CircleSlash, keywords: "close not planned", op: "state", params: { action: "close", reason: "not_planned" }, summary: `${id} を閉じる（対応しない）`, done: "閉じました（対応しない）", undo: reopen });
  } else if (item.state === "open") {
    changes.push({ id: "close", label: "Pull request を閉じる", icon: GitPullRequestClosed, keywords: "close", op: "state", params: { action: "close" }, summary: `${id} を閉じる`, done: "閉じました", undo: reopen });
  } else {
    const reason = item.kind === "issues" ? (item.stateReason ?? "completed") : undefined;
    changes.push({ id: "reopen", label: `${item.kind === "issues" ? "Issue" : "Pull request"} を開き直す`, icon: item.kind === "issues" ? CircleDot : GitPullRequest, keywords: "reopen", ...reopen, done: "開き直しました", undo: { op: "state", params: { action: "close", ...(reason ? { reason } : {}) }, summary: `${id} を閉じる` } });
  }
  return changes.map(({ label, icon, keywords, ...c }) => ({ id: `state-${c.id}`, label, icon, keywords, disabled: busy !== undefined, run: () => void run(c) }));
}

export default { order: 10, useCommands: useStateCommands } satisfies ItemCommands;
