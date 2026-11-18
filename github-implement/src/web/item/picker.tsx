// A "+" button that opens a list to pick one from, with a box that narrows it by name; picking closes it.
import { Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Popover } from "@gasho/plugin-sdk";
import { Button } from "../ui/button.tsx";
import { isComposing } from "../ui/input.ts";

export interface Choice {
  key: string;
  /** What the box narrows by. */
  name: string;
  text: ReactNode;
  pick: () => void;
}

export function Picker({ label, choices, error, disabled }: { label: string; choices?: Choice[]; error?: string; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = choices?.filter((c) => !q || c.name.toLowerCase().includes(q));
  return (
    <Popover
      label={label}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
      trigger={
        <Button variant="ghost" size="icon" disabled={disabled} aria-label={label} title={label}>
          <Plus />
        </Button>
      }
      className="w-64 p-1"
    >
      {choices && choices.length > 0 && (
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            const first = shown?.[0];
            // The Enter that ends a composition picks nothing.
            if (e.key === "Enter" && first && !isComposing(e)) {
              e.preventDefault();
              setOpen(false);
              setQuery("");
              first.pick();
            }
          }}
          placeholder="名前で探す"
          aria-label={`${label}：名前で探す`}
          className="mb-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus:border-border-hover"
        />
      )}
      <div className="max-h-64 overflow-y-auto">
        {error && <p className="px-2 py-1.5 text-xs text-red-500 dark:text-red-400">{error}</p>}
        {!choices && !error && <p className="px-2 py-1.5 text-xs text-muted-foreground">読み込み中…</p>}
        {choices?.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">足せるものがありません。</p>}
        {choices && choices.length > 0 && shown?.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">「{query}」に合うものがありません。</p>}
        {shown?.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => {
              setOpen(false);
              setQuery("");
              c.pick();
            }}
            className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-raised"
          >
            {c.text}
          </button>
        ))}
      </div>
    </Popover>
  );
}
