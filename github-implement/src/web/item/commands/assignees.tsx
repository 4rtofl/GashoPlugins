// ⌘K: gh's own login as an assignee, or off the assignees, as sections/assignees.tsx does.
import { UserMinus, UserPlus } from "lucide-react";
import { useRequest } from "@gasho/plugin-sdk";
import type { RepoMeta } from "../../../types.ts";
import { readOp } from "../../daemon.ts";
import type { PaletteCommand } from "../../palette.tsx";
import { useItem } from "../context.tsx";
import type { ItemCommands } from "../palette.tsx";

function useAssigneeCommands(): PaletteCommand[] {
  const { machine, item, where, busy, run } = useItem();
  // The same read as the assignees' row: gasho-daemon and the screen share it.
  const meta = useRequest<RepoMeta>(readOp(machine, "meta", { repo: where.repo }), { staleSeconds: 300 });
  const me = meta.data?.me;
  if (!me) return [];
  const id = `#${where.number}`;
  if (item.assignees.includes(me)) {
    return [
      {
        id: "unassign-me",
        label: "自分を担当から外す",
        icon: UserMinus,
        keywords: "unassign me",
        disabled: busy !== undefined,
        writes: true,
        run: () =>
          void run({
            id: `assign-${me}`,
            op: "edit",
            params: { removeAssignees: [me] },
            summary: `${id} の担当から ${me} を外す`,
            done: `担当から ${me} を外しました`,
            undo: { op: "edit", params: { addAssignees: [me] }, summary: `${id} の担当に ${me} を戻す` },
          }),
      },
    ];
  }
  return [
    {
      id: "assign-me",
      label: "自分を担当にする",
      icon: UserPlus,
      keywords: "assign me",
      disabled: busy !== undefined,
      writes: true,
      run: () =>
        void run({
          id: `assign+${me}`,
          op: "edit",
          params: { addAssignees: ["@me"] },
          summary: `${id} の担当に ${me} を足す`,
          done: `担当に ${me} を足しました`,
          undo: { op: "edit", params: { removeAssignees: ["@me"] }, summary: `${id} の担当から ${me} を外す` },
        }),
    },
  ];
}

export default { order: 20, useCommands: useAssigneeCommands } satisfies ItemCommands;
