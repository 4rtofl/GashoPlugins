// The state of an issue or pull request, as GitHub colors it, with its icon: on an item's screen and on the card over a
// #number.
import type { GitHubItemDetail } from "../../types.ts";
import { itemLook } from "../tabs.ts";
import { Badge } from "../ui/badge.tsx";

export function StateBadge({ item }: { item: Pick<GitHubItemDetail, "kind" | "state" | "stateReason" | "draft"> }) {
  const { Icon, label, tone } = itemLook(item);
  return (
    <Badge tone={tone} icon={<Icon />}>
      {label}
    </Badge>
  );
}
