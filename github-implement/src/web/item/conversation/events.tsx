// The changes between the comments: labels and assignees put on and taken off, closed, reopened and merged. They are
// read apart from the item (the operation "events"), when the conversation shows.
import { CircleCheck, CircleDot, CircleSlash, GitMerge, GitPullRequestClosed, Tag, UserMinus, UserPlus } from "lucide-react";
import type { ReactNode } from "react";
import { RelativeTime, useRequest } from "@gasho/plugin-sdk";
import type { GitHubEvent, GitHubKind } from "../../../types.ts";
import { readOp } from "../../daemon.ts";
import { useRefreshOptions } from "../../tabs.ts";
import { Alert } from "../../ui/alert.tsx";
import { Badge } from "../../ui/badge.tsx";
import type { TimelineEntry } from "../../ui/timeline.tsx";
import { useAfterChange, useItem } from "../context.tsx";
import type { ConversationEntry, ConversationPart } from "../parts.ts";

function useEvents() {
  const { machine, where } = useItem();
  return useRequest<GitHubEvent[]>(readOp(machine, "events", { repo: where.repo, number: where.number }), useRefreshOptions());
}

const who = (name?: string) => <span className="font-medium text-foreground/90">{name ?? "不明"}</span>;

function label(e: GitHubEvent): ReactNode {
  return e.label ? (
    <Badge variant="outline" dot={e.label.color ? `#${e.label.color}` : true} className="mx-0.5 h-5 align-middle">
      {e.label.name}
    </Badge>
  ) : null;
}

/** How an event shows: its node and its line. */
function look(e: GitHubEvent, kind: GitHubKind): Pick<TimelineEntry, "icon" | "tone" | "title"> {
  switch (e.type) {
    case "labeled":
      return { icon: Tag, title: <>{who(e.actor)} がラベル{label(e)}を付けました</> };
    case "unlabeled":
      return { icon: Tag, title: <>{who(e.actor)} がラベル{label(e)}を外しました</> };
    case "assigned":
      return { icon: UserPlus, title: e.assignee === e.actor ? <>{who(e.actor)} が自分を担当にしました</> : <>{who(e.actor)} が {who(e.assignee)} を担当にしました</> };
    case "unassigned":
      return { icon: UserMinus, title: e.assignee === e.actor ? <>{who(e.actor)} が自分を担当から外しました</> : <>{who(e.actor)} が {who(e.assignee)} を担当から外しました</> };
    case "closed":
      if (kind === "pulls") return { icon: GitPullRequestClosed, tone: "danger", title: <>{who(e.actor)} が閉じました</> };
      return e.stateReason === "not_planned"
        ? { icon: CircleSlash, title: <>{who(e.actor)} が閉じました（対応しない）</> }
        : { icon: CircleCheck, tone: "merged", title: <>{who(e.actor)} が閉じました（完了）</> };
    case "reopened":
      return { icon: CircleDot, tone: "success", title: <>{who(e.actor)} が開き直しました</> };
    case "merged":
      return { icon: GitMerge, tone: "merged", title: <>{who(e.actor)} がマージしました</> };
  }
}

function useEventEntries(): ConversationEntry[] {
  const { item, now } = useItem();
  const r = useEvents();
  useAfterChange(r.reload);
  return (r.data ?? []).map((e, i) => ({ key: `event${i}`, at: e.at, ...look(e, item.kind), time: <RelativeTime at={e.at} now={now} /> }));
}

/** Under the body when the changes could not be read: the rest of the conversation is still there. */
function EventsError() {
  const r = useEvents();
  if (!r.error) return null;
  return <Alert tone="warning">ラベル・担当・閉じた・開き直したの記録を読めませんでした：{r.error}</Alert>;
}

export default { order: 10, useEntries: useEventEntries, UnderBody: EventsError } satisfies ConversationPart;
