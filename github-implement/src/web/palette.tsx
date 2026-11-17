// ⌘K (Ctrl+K) on github-implement's screens: a box that finds what the screen offers (its operations, the worktree's
// issues and pull requests) by words of its name, and runs one with Enter or a click. Gasho has nothing of its own on
// ⌘K, and one of the plugin's screens shows at a time, so the screen that shows listens for it on the window.
import { ExternalLink, ListPlus, RefreshCw, Search } from "lucide-react";
import { useEffect, useId, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import { cn, useDaemonReady, useNavigation, useRequest, type WorktreeInfo } from "@gasho/plugin-sdk";
import type { GitHubKind, WorktreeItems } from "../types.ts";
import { itemLook, itemsInOrder, itemsTarget, useRefreshOptions } from "./tabs.ts";

export interface PaletteCommand {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  /** Shown at the right, and found by too: "Pull request", "タブ". */
  hint?: string;
  /** More words it is found by (its English name, …). */
  keywords?: string;
  /** Shown but not run: a change runs now. */
  disabled?: boolean;
  run: () => void;
}

export interface PaletteGroup {
  label: string;
  commands: PaletteCommand[];
}

/** The commands that have every word typed in their label, hint or keywords (any case), in their groups. */
function findCommands(groups: PaletteGroup[], text: string): PaletteGroup[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  return groups
    .map((g) => ({ ...g, commands: g.commands.filter((c) => words.every((w) => [c.label, c.hint, c.keywords].join(" ").toLowerCase().includes(w))) }))
    .filter((g) => g.commands.length > 0);
}

const isPaletteKey = (e: globalThis.KeyboardEvent) => (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k";

/** Opens on ⌘K or Ctrl+K and closes on it again, on Esc, and on a press outside it. */
export function Palette({ groups, label }: { groups: PaletteGroup[]; label: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!isPaletteKey(e) || e.isComposing) return;
      e.preventDefault();
      const d = dialog.current;
      if (d?.open) d.close();
      else if (d) {
        d.showModal();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Closing gives the focus back to where it was before (the dialog does), and then the command runs.
  const choose = (c: PaletteCommand) => {
    dialog.current?.close();
    c.run();
  };
  return (
    <dialog
      ref={dialog}
      aria-label={label}
      onClose={() => setOpen(false)}
      // A press on the backdrop is a press on the dialog itself.
      onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
      className="mx-auto mt-[12vh] mb-auto w-[min(36rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-black/40"
    >
      {open && <PaletteBox groups={groups} onChoose={choose} />}
    </dialog>
  );
}

function PaletteBox({ groups, onChoose }: { groups: PaletteGroup[]; onChoose: (c: PaletteCommand) => void }) {
  const id = useId();
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const found = findCommands(groups, text);
  const flat = found.flatMap((g) => g.commands);
  const at = Math.min(active, Math.max(0, flat.length - 1));
  useEffect(() => {
    list.current?.querySelector(`[data-index="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter that ends the composition of Japanese text chooses nothing.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length > 0) setActive((at + (e.key === "ArrowDown" ? 1 : -1) + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = flat[at];
      if (c && !c.disabled) onChoose(c);
    }
  };
  let index = 0;
  return (
    <div className="flex max-h-[min(28rem,70vh)] flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={flat[at] ? `${id}-${at}` : undefined}
          aria-label="探す操作や Issue・Pull request"
          placeholder="操作や Issue・Pull request を探す"
          className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div ref={list} id={`${id}-list`} role="listbox" aria-label="見つかったもの" className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {found.map((g) => (
          <div key={g.label} role="group" aria-label={g.label} className="pb-1">
            <div aria-hidden className="px-2 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground">
              {g.label}
            </div>
            {g.commands.map((c) => {
              const i = index++;
              const Icon = c.icon;
              return (
                <div
                  key={c.id}
                  id={`${id}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === at}
                  aria-disabled={c.disabled || undefined}
                  onMouseMove={() => i !== at && setActive(i)}
                  onClick={() => !c.disabled && onChoose(c)}
                  className={cn("flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm", i === at && "bg-surface-hover", c.disabled && "cursor-default opacity-40")}
                >
                  {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" /> : <span className="size-4 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.hint && <span className="shrink-0 text-xs text-muted-foreground">{c.hint}</span>}
                </div>
              );
            })}
          </div>
        ))}
        {flat.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted-foreground">見つかりません。</p>}
      </div>
      <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">↑↓ で選ぶ · Enter で実行 · Esc で閉じる</div>
    </div>
  );
}

/** The worktree's issues and pull requests and its "GitHub" tab, each opening its tab, but for the item on screen. */
export function useWorktreeCommands(machine: string, worktree: WorktreeInfo, current?: { kind: GitHubKind; number: number }): PaletteGroup {
  const daemon = useDaemonReady(machine);
  const r = useRequest<WorktreeItems>(itemsTarget(machine, worktree, daemon.ready), useRefreshOptions());
  const nav = useNavigation();
  const items = (r.data ? itemsInOrder(r.data) : []).filter((i) => !(current && i.kind === current.kind && i.number === current.number));
  return {
    label: "Issue と Pull request",
    commands: [
      ...items.map(
        (i): PaletteCommand => ({
          id: `open-${i.kind}-${i.number}`,
          label: `#${i.number} ${i.title}`,
          icon: itemLook(i).ColoredIcon,
          hint: i.kind === "pulls" ? "Pull request" : "Issue",
          run: () => nav.openWorktreeView("item", { kind: i.kind, number: String(i.number) }),
        }),
      ),
      ...(current ? [{ id: "open-home", label: "GitHub（一覧と、番号で足す欄）", icon: ListPlus, hint: "タブ", keywords: "home list add", run: () => nav.openWorktreeView("home") }] : []),
    ],
  };
}

/** ⌘K on the "GitHub" tab: reading again, the repository on GitHub, and the worktree's issues and pull requests. */
export function HomePalette({ machine, worktree }: { machine: string; worktree: WorktreeInfo }) {
  const daemon = useDaemonReady(machine);
  const r = useRequest<WorktreeItems>(itemsTarget(machine, worktree, daemon.ready), useRefreshOptions());
  const items = useWorktreeCommands(machine, worktree);
  const github = worktree.github;
  const commands: PaletteCommand[] = [
    { id: "reload", label: "再読み込み", icon: RefreshCw, keywords: "reload refresh", run: r.reload },
    ...(github ? [{ id: "github", label: "GitHub でリポジトリを開く", icon: ExternalLink, keywords: "open browser", run: () => void window.open(github.url, "_blank", "noopener") }] : []),
  ];
  return (
    <Palette
      label="この worktree の操作と Issue・Pull request"
      groups={[
        { label: "この画面の操作", commands },
        items,
      ]}
    />
  );
}
