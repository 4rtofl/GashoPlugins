// Close and reopen, and a pull request's draft and ready, each of which an Undo Toast can put back. A merged pull
// request has none.
import { Button } from "../../ui/button.tsx";
import { useItem, type Change } from "../context.tsx";
import type { ItemSection } from "../parts.ts";

function StateActions() {
  const { item, where, busy, run } = useItem();
  if (item.state === "merged") return null;
  const id = `#${where.number}`;
  const changes: (Change & { label: string; doing: string })[] = [];
  if (item.kind === "pulls" && item.state === "open") {
    changes.push(
      item.draft
        ? { id: "ready", label: "Ready for review にする", doing: "変えています…", op: "ready", params: { ready: true }, summary: `${id} を Ready for review にする`, done: "Ready for review にしました", undo: { op: "ready", params: { ready: false }, summary: `${id} を Draft に戻す` } }
        : { id: "draft", label: "Draft に戻す", doing: "変えています…", op: "ready", params: { ready: false }, summary: `${id} を Draft に戻す`, done: "Draft に戻しました", undo: { op: "ready", params: { ready: true }, summary: `${id} を Ready for review にする` } },
    );
  }
  const reopen = { op: "state", params: { action: "reopen" }, summary: `${id} を開き直す` };
  if (item.state === "open" && item.kind === "issues") {
    changes.push({ id: "close", label: "閉じる（完了）", doing: "閉じています…", op: "state", params: { action: "close", reason: "completed" }, summary: `${id} を閉じる（完了）`, done: "閉じました（完了）", undo: reopen });
    changes.push({ id: "notplanned", label: "閉じる（対応しない）", doing: "閉じています…", op: "state", params: { action: "close", reason: "not_planned" }, summary: `${id} を閉じる（対応しない）`, done: "閉じました（対応しない）", undo: reopen });
  } else if (item.state === "open") {
    changes.push({ id: "close", label: "閉じる", doing: "閉じています…", op: "state", params: { action: "close" }, summary: `${id} を閉じる`, done: "閉じました", undo: reopen });
  } else {
    const reason = item.kind === "issues" ? (item.stateReason ?? "completed") : undefined;
    changes.push({
      id: "reopen",
      label: "開き直す",
      doing: "開き直しています…",
      ...reopen,
      done: "開き直しました",
      undo: { op: "state", params: { action: "close", ...(reason ? { reason } : {}) }, summary: `${id} を閉じる` },
    });
  }
  return (
    <div className="flex flex-wrap gap-2">
      {changes.map(({ label, doing, ...c }) => (
        <Button key={c.id} onClick={() => void run(c)} disabled={busy !== undefined} isLoading={busy === c.id} loadingText={doing}>
          {label}
        </Button>
      ))}
    </div>
  );
}

export default { order: 10, kinds: ["issues", "pulls"], View: StateActions } satisfies ItemSection;
