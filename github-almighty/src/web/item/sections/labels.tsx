// The labels, each a Badge in its color with an ×, and a picker of the repository's labels; an Undo Toast can put each
// change back.
import { useRequest } from "@gasho/plugin-sdk";
import type { RepoMeta } from "../../../types.ts";
import { readOp } from "../../daemon.ts";
import { Badge } from "../../ui/badge.tsx";
import { useItem } from "../context.tsx";
import type { ItemSection } from "../parts.ts";
import { Picker } from "../picker.tsx";

/** A label's name after a dot in its color. */
function LabelText({ name, color }: { name: string; color?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {color && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: `#${color}` }} />}
      {name}
    </span>
  );
}

function Labels() {
  const { machine, item, where, busy, run } = useItem();
  const meta = useRequest<RepoMeta>(readOp(machine, "meta", { repo: where.repo }), { staleSeconds: 300 });
  const id = `#${where.number}`;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="w-10 shrink-0 text-muted-foreground">ラベル</span>
      {item.labels.map((l) => (
        <Badge
          key={l.name}
          variant="outline"
          dot={l.color ? `#${l.color}` : true}
          removeLabel={`ラベル「${l.name}」を外す`}
          removeDisabled={busy !== undefined}
          onRemove={() =>
            void run({
              id: `label-${l.name}`,
              op: "edit",
              params: { removeLabels: [l.name] },
              summary: `${id} のラベル「${l.name}」を外す`,
              done: `ラベル「${l.name}」を外しました`,
              undo: { op: "edit", params: { addLabels: [l.name] }, summary: `${id} にラベル「${l.name}」を付け直す` },
            })
          }
        >
          {l.name}
        </Badge>
      ))}
      {item.labels.length === 0 && <span className="text-muted-foreground">なし</span>}
      <Picker
        label="ラベルを付ける"
        error={meta.error}
        disabled={busy !== undefined}
        choices={meta.data?.labels
          .filter((l) => !item.labels.some((x) => x.name === l.name))
          .map((l) => ({
            key: l.name,
            name: l.name,
            text: <LabelText name={l.name} color={l.color} />,
            pick: () =>
              void run({
                id: `label+${l.name}`,
                op: "edit",
                params: { addLabels: [l.name] },
                summary: `${id} にラベル「${l.name}」を付ける`,
                done: `ラベル「${l.name}」を付けました`,
                undo: { op: "edit", params: { removeLabels: [l.name] }, summary: `${id} のラベル「${l.name}」を外す` },
              }),
          }))}
      />
    </div>
  );
}

export default { order: 30, kinds: ["issues", "pulls"], View: Labels } satisfies ItemSection;
