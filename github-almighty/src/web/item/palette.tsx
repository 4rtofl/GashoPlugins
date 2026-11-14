// ⌘K on an item's screen: the operations that fit the item now, each file of commands/ giving some, then the worktree's
// other issues and pull requests. The screen takes every file of commands/ (Vite's import.meta.glob), as it does those
// of tabs/ and sections/, so that a new operation is a new file.
import type { WorktreeInfo } from "@gasho/plugin-sdk";
import { Palette, useWorktreeCommands, type PaletteCommand } from "../palette.tsx";
import { useItem } from "./context.tsx";
import { partsOf } from "./parts.ts";

/** Operations for ⌘K: a file of commands/. */
export interface ItemCommands {
  /** Smaller first. */
  order: number;
  /** A React hook (it may use useItem): the operations that fit the item now. */
  useCommands: () => PaletteCommand[];
}

const COMMANDS = partsOf(import.meta.glob<{ default: ItemCommands }>("./commands/*.tsx", { eager: true }));

export function ItemPalette({ worktree }: { worktree: WorktreeInfo }) {
  const { machine, where } = useItem();
  // Every file's hook, in the same order on every render.
  const commands = COMMANDS.flatMap((c) => c.useCommands());
  const items = useWorktreeCommands(machine, worktree, where);
  return (
    <Palette
      label={`#${where.number} の操作と、worktree の Issue・Pull request`}
      groups={[
        { label: `#${where.number} の操作`, commands },
        items,
      ]}
    />
  );
}
