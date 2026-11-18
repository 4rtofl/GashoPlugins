// A "+" button that opens a list to pick one from, with a box that narrows it by name; picking closes it. When the list
// holds only the first of them (a repository with many labels or people), what is typed is also looked up on GitHub.
import { Plus } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Popover, useRequest, type RequestTarget } from "@gasho/plugin-sdk";
import type { FoundAssignable } from "../../daemon/ops/assignable.ts";
import type { FoundLabels } from "../../daemon/ops/labels.ts";
import { readOp } from "../daemon.ts";
import { Button } from "../ui/button.tsx";

export interface Choice {
  key: string;
  /** What the box narrows by. */
  name: string;
  text: ReactNode;
  pick: () => void;
}

/** The read that looks up what is typed on GitHub, and the choices of its answer. */
export interface PickerSearch<T extends { more: boolean }> {
  target: (query: string) => RequestTarget;
  choices: (found: T) => Choice[];
}

/** What is typed, once it has not changed for a moment: what the lookups on GitHub are asked for. */
export function useSettled(query: string, on: boolean): string {
  const [settled, setSettled] = useState("");
  useEffect(() => {
    if (!on) return setSettled("");
    const t = setTimeout(() => setSettled(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query, on]);
  return on ? settled : "";
}

/** `choices` narrowed by what is typed, and what `search` (when given) found of it on GitHub, each once. */
export function useFound<T extends { more: boolean }>(choices: Choice[] | undefined, query: string, open: boolean, search?: PickerSearch<T>) {
  const q = query.trim().toLowerCase();
  const asked = useSettled(query, open && search !== undefined);
  const r = useRequest<T>(search && open && asked ? search.target(asked) : undefined, { staleSeconds: 30 });
  const local = choices?.filter((c) => !q || c.name.toLowerCase().includes(q));
  // Only what was found of what is typed now.
  const found = search && asked !== "" && asked.toLowerCase() === q && r.data ? search.choices(r.data) : [];
  const shown = local && [...local, ...found.filter((f) => !local.some((c) => c.key === f.key))];
  return { shown, searching: search !== undefined && q !== "" && (asked.toLowerCase() !== q || r.loading), more: search !== undefined && (q === "" || (asked.toLowerCase() === q && r.data?.more === true)), error: r.error };
}

/** Looks up the people who can be assigned on GitHub (the operation "assignable"); `choice` is undefined for one already there. */
export function assignableSearch(machine: string, repo: string, choice: (login: string) => Choice | undefined): PickerSearch<FoundAssignable> {
  return { target: (query) => readOp(machine, "assignable", { repo, query }), choices: (found) => found.logins.flatMap((l) => choice(l) ?? []) };
}

/** Looks up the labels on GitHub (the operation "labels"). */
export function labelSearch(machine: string, repo: string, choice: (label: FoundLabels["labels"][number]) => Choice | undefined): PickerSearch<FoundLabels> {
  return { target: (query) => readOp(machine, "labels", { repo, query }), choices: (found) => found.labels.flatMap((l) => choice(l) ?? []) };
}

export function Picker<T extends { more: boolean }>({ label, choices, error, disabled, search }: { label: string; choices?: Choice[]; error?: string; disabled: boolean; search?: PickerSearch<T> }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { shown, searching, more, error: searchError } = useFound(choices, query, open, search);
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
      {choices && (choices.length > 0 || search) && (
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            const first = shown?.[0];
            if (e.key === "Enter" && first) {
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
        {searchError && <p className="px-2 py-1.5 text-xs text-red-500 dark:text-red-400">GitHub で探せませんでした：{searchError}</p>}
        {!choices && !error && <p className="px-2 py-1.5 text-xs text-muted-foreground">読み込み中…</p>}
        {choices?.length === 0 && !search && <p className="px-2 py-1.5 text-xs text-muted-foreground">足せるものがありません。</p>}
        {shown?.length === 0 && query.trim() !== "" && !searching && <p className="px-2 py-1.5 text-xs text-muted-foreground">「{query}」に合うものがありません。</p>}
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
        {searching && <p className="px-2 py-1.5 text-xs text-muted-foreground">GitHub で探しています…</p>}
        {more && !searching && <p className="px-2 py-1.5 text-xs text-muted-foreground">ほかにもあります。名前で探してください。</p>}
      </div>
    </Popover>
  );
}
