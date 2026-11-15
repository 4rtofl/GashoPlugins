// Close and reopen, and a pull request's draft and ready, each of which an Undo Toast can put back. A merged pull
// request has none. As on GitHub, a close or reopen button says what it closes and has the icon and color of the state
// it leads to, and an issue closes as done or, when that is picked in the menu beside its button, as not planned.
import { Check, ChevronDown, CircleCheck, CircleDot, CircleSlash, GitPullRequest, GitPullRequestClosed, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { cn, Popover } from "@gasho/plugin-sdk";
import { Button } from "../../ui/button.tsx";
import { useItem, type Change } from "../context.tsx";
import type { ItemSection } from "../parts.ts";

type Reason = "completed" | "not_planned";

interface Action extends Change {
  label: string;
  doing: string;
  icon?: LucideIcon;
  color?: string;
}

// The colors of the states in the badge and the timeline.
const OPEN = "text-emerald-600 dark:text-emerald-400";
const PULL_CLOSED = "text-red-600 dark:text-red-400";

const REASONS: Record<Reason, { word: string; button: string; menu: string; hint: string; icon: LucideIcon; color: string }> = {
  completed: { word: "完了", button: "Issue を閉じる", menu: "完了として閉じる", hint: "済んだ・直した・解決した", icon: CircleCheck, color: "text-violet-600 dark:text-violet-300" },
  not_planned: { word: "対応しない", button: "Issue を閉じる（対応しない）", menu: "対応しないとして閉じる", hint: "直さない・再現しない・古くなった", icon: CircleSlash, color: "text-muted-foreground" },
};

const MENU_ITEM = "flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-raised";

const reopenChange = (id: string) => ({ op: "state", params: { action: "reopen" }, summary: `${id} を開き直す` });

function ActionButton({ action, className }: { action: Action; className?: string }) {
  const { busy, run } = useItem();
  const { label, doing, icon: Icon, color, ...c } = action;
  return (
    <Button onClick={() => void run(c)} disabled={busy !== undefined} isLoading={busy === c.id} loadingText={doing} leftIcon={Icon && <Icon className={color} />} className={className}>
      {label}
    </Button>
  );
}

function CloseIssue({ id }: { id: string }) {
  const { busy } = useItem();
  const [reason, setReason] = useState<Reason>("completed");
  const [open, setOpen] = useState(false);
  const r = REASONS[reason];
  const close: Action = {
    id: "close",
    label: r.button,
    doing: "閉じています…",
    icon: r.icon,
    color: r.color,
    op: "state",
    params: { action: "close", reason },
    summary: `${id} を閉じる（${r.word}）`,
    done: `閉じました（${r.word}）`,
    undo: reopenChange(id),
  };
  return (
    <div className="inline-flex">
      <ActionButton action={close} className="rounded-r-none hover:z-10 focus-visible:z-10" />
      <Popover
        label="Issue の閉じ方"
        open={open}
        onOpenChange={setOpen}
        align="start"
        className="w-64 p-1"
        trigger={
          <Button aria-label="Issue の閉じ方を選ぶ" title="Issue の閉じ方を選ぶ" disabled={busy !== undefined} className="-ml-px rounded-l-none px-2 hover:z-10 focus-visible:z-10">
            <ChevronDown />
          </Button>
        }
      >
        {(Object.keys(REASONS) as Reason[]).map((k) => {
          const x = REASONS[k];
          return (
            <button
              key={k}
              type="button"
              aria-pressed={k === reason}
              onClick={() => {
                setReason(k);
                setOpen(false);
              }}
              className={MENU_ITEM}
            >
              <x.icon className={cn("mt-0.5 size-3.5 shrink-0", x.color)} />
              <span className="min-w-0 flex-1">
                <span className="block text-foreground">{x.menu}</span>
                <span className="block text-[11px] text-muted-foreground">{x.hint}</span>
              </span>
              {k === reason && <Check className="mt-0.5 size-3.5 shrink-0" />}
            </button>
          );
        })}
      </Popover>
    </div>
  );
}

function StateActions() {
  const { item, where } = useItem();
  if (item.state === "merged") return null;
  const id = `#${where.number}`;
  const noun = item.kind === "issues" ? "Issue" : "Pull request";
  const actions: Action[] = [];
  if (item.kind === "pulls" && item.state === "open") {
    actions.push(
      item.draft
        ? { id: "ready", label: "Ready for review にする", doing: "変えています…", op: "ready", params: { ready: true }, summary: `${id} を Ready for review にする`, done: "Ready for review にしました", undo: { op: "ready", params: { ready: false }, summary: `${id} を Draft に戻す` } }
        : { id: "draft", label: "Draft に戻す", doing: "変えています…", op: "ready", params: { ready: false }, summary: `${id} を Draft に戻す`, done: "Draft に戻しました", undo: { op: "ready", params: { ready: true }, summary: `${id} を Ready for review にする` } },
    );
  }
  if (item.state === "open" && item.kind === "pulls") {
    actions.push({ id: "close", label: "Pull request を閉じる", doing: "閉じています…", icon: GitPullRequestClosed, color: PULL_CLOSED, op: "state", params: { action: "close" }, summary: `${id} を閉じる`, done: "閉じました", undo: reopenChange(id) });
  } else if (item.state === "closed") {
    const reason = item.kind === "issues" ? (item.stateReason ?? "completed") : undefined;
    actions.push({
      id: "reopen",
      label: `${noun} を開き直す`,
      doing: "開き直しています…",
      icon: item.kind === "issues" ? CircleDot : GitPullRequest,
      color: OPEN,
      ...reopenChange(id),
      done: "開き直しました",
      undo: { op: "state", params: { action: "close", ...(reason ? { reason } : {}) }, summary: `${id} を閉じる` },
    });
  }
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((a) => (
        <ActionButton key={a.id} action={a} />
      ))}
      {item.state === "open" && item.kind === "issues" && <CloseIssue id={id} />}
    </div>
  );
}

export default { order: 10, kinds: ["issues", "pulls"], View: StateActions } satisfies ItemSection;
