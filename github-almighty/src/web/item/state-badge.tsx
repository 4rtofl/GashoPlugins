// The state of an issue or pull request, as GitHub colors it, with its icon: on an item's screen and on the card over a
// #number.
import type { GitHubItemDetail } from "../../types.ts";
import { itemIcon, NOT_PLANNED_ICON } from "../tabs.ts";
import { Badge, type BadgeTone } from "../ui/badge.tsx";

export function StateBadge({ item }: { item: Pick<GitHubItemDetail, "kind" | "state" | "stateReason" | "draft"> }) {
  const Icon = item.kind === "issues" && item.state === "closed" && item.stateReason === "not_planned" ? NOT_PLANNED_ICON : itemIcon(item);
  const [label, tone]: [string, BadgeTone] =
    item.state === "merged"
      ? ["Merged", "merged"]
      : item.state === "closed"
        ? item.kind === "pulls"
          ? ["Closed", "danger"]
          : item.stateReason === "not_planned"
            ? ["Closed（対応しない）", "neutral"]
            : ["Closed", "merged"]
        : item.draft
          ? ["Draft", "neutral"]
          : ["Open", "success"];
  return (
    <Badge tone={tone} icon={<Icon />}>
      {label}
    </Badge>
  );
}
