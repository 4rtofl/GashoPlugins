// The milestone, with an × that takes it off and a list of the repository's open milestones (the nearest due first)
// to choose one from; an Undo Toast can put each change back.
import { useRequest } from "@gasho/plugin-sdk";
import type { GitHubMilestone } from "../../../daemon/detail/milestone.ts";
import { readOp } from "../../daemon.ts";
import { Badge } from "../../ui/badge.tsx";
import { useItem } from "../context.tsx";
import type { ItemSection } from "../parts.ts";
import { Picker } from "../picker.tsx";

// GitHub keeps a due date as a moment of that day in UTC.
const due = (m: GitHubMilestone): string | undefined => (m.dueOn ? `${new Date(m.dueOn).toLocaleDateString("ja-JP", { timeZone: "UTC" })} まで` : undefined);

function Milestone() {
  const { machine, item, where, busy, run } = useItem();
  const list = useRequest<GitHubMilestone[]>(readOp(machine, "milestones", { repo: where.repo }), { staleSeconds: 300 });
  const id = `#${where.number}`;
  const now = item.milestone;
  const back = now
    ? { op: "milestone", params: { milestone: now.number }, summary: `${id} のマイルストーンを「${now.title}」に戻す` }
    : { op: "milestone", params: { milestone: null }, summary: `${id} のマイルストーンを外す` };
  const choose = (m: GitHubMilestone) =>
    void run({ id: "milestone", op: "milestone", params: { milestone: m.number }, summary: `${id} のマイルストーンを「${m.title}」にする`, done: `マイルストーンを「${m.title}」にしました`, undo: back });
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="shrink-0 text-muted-foreground">マイルストーン</span>
      {now ? (
        <Badge
          variant="outline"
          title={due(now)}
          removeLabel={`マイルストーン「${now.title}」を外す`}
          removeDisabled={busy !== undefined}
          onRemove={() =>
            void run({ id: "milestone", op: "milestone", params: { milestone: null }, summary: `${id} のマイルストーン「${now.title}」を外す`, done: `マイルストーン「${now.title}」を外しました`, undo: back })
          }
        >
          {now.title}
        </Badge>
      ) : (
        <span className="text-muted-foreground">なし</span>
      )}
      {now && due(now) && <span className="text-muted-foreground">{due(now)}</span>}
      <Picker
        label={now ? "マイルストーンを変える" : "マイルストーンを選ぶ"}
        error={list.error}
        disabled={busy !== undefined}
        choices={list.data
          ?.filter((m) => m.number !== now?.number)
          .map((m) => ({
            key: String(m.number),
            name: m.title,
            text: (
              <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <span className="truncate">{m.title}</span>
                {due(m) && <span className="shrink-0 text-muted-foreground">{due(m)}</span>}
              </span>
            ),
            pick: () => choose(m),
          }))}
      />
    </div>
  );
}

export default { order: 35, kinds: ["issues", "pulls"], View: Milestone } satisfies ItemSection;
