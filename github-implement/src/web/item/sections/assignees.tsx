// The assignees, with a button that makes gh's own login one, a picker of the repository's assignable people, and an ×
// on each; an Undo Toast can put each change back.
import { useRequest } from "@gasho/plugin-sdk";
import type { RepoMeta } from "../../../types.ts";
import { readOp } from "../../daemon.ts";
import { Badge } from "../../ui/badge.tsx";
import { Button } from "../../ui/button.tsx";
import { useItem } from "../context.tsx";
import type { ItemSection } from "../parts.ts";
import { assignableSearch, Picker, type Choice } from "../picker.tsx";
import { Row } from "../row.tsx";

function Assignees() {
  const { machine, item, where, busy, run } = useItem();
  // The repository's labels and assignable people, and gh's own login (gasho-daemon keeps them for 10 minutes).
  const meta = useRequest<RepoMeta>(readOp(machine, "meta", { repo: where.repo }), { staleSeconds: 300 });
  const id = `#${where.number}`;
  const me = meta.data?.me;
  const add = (who: string, as = who) =>
    void run({
      id: `assign+${who}`,
      op: "edit",
      params: { addAssignees: [as] },
      summary: `${id} の担当に ${who} を足す`,
      done: `担当に ${who} を足しました`,
      undo: { op: "edit", params: { removeAssignees: [as] }, summary: `${id} の担当から ${who} を外す` },
    });
  const choice = (a: string): Choice | undefined => (item.assignees.includes(a) ? undefined : { key: a, name: a, text: <span>{a}</span>, pick: () => add(a) });
  return (
    <Row label="担当">
      {item.assignees.map((a) => (
        <Badge
          key={a}
          variant="outline"
          removeLabel={`${a} を担当から外す`}
          removeDisabled={busy !== undefined}
          onRemove={() =>
            void run({
              id: `assign-${a}`,
              op: "edit",
              params: { removeAssignees: [a] },
              summary: `${id} の担当から ${a} を外す`,
              done: `担当から ${a} を外しました`,
              undo: { op: "edit", params: { addAssignees: [a] }, summary: `${id} の担当に ${a} を戻す` },
            })
          }
        >
          {a}
        </Badge>
      ))}
      {item.assignees.length === 0 && <span className="text-muted-foreground">なし</span>}
      {me && !item.assignees.includes(me) && (
        <Button size="xs" variant="ghost" onClick={() => add(me, "@me")} disabled={busy !== undefined} isLoading={busy === `assign+${me}`} loadingText="足しています…">
          自分を担当にする
        </Button>
      )}
      <Picker
        label="担当を足す"
        error={meta.error}
        disabled={busy !== undefined}
        choices={meta.data?.assignable.flatMap((a) => choice(a) ?? [])}
        {...(meta.data?.assignableMore && { search: assignableSearch(machine, where.repo, choice) })}
      />
    </Row>
  );
}

export default { order: 20, kinds: ["issues", "pulls"], place: "row", View: Assignees } satisfies ItemSection;
