// A pull request's base: a picker that changes it to a branch found by name (an Undo Toast puts it back), how many
// commits of the base its head does not have, with a button that merges them in (Update branch), and, when the parent
// was merged or the base branch deleted, a button that moves the base to where the parent went.
import { Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { cn, Popover, useRequest } from "@gasho/plugin-sdk";
import { readOp } from "../../daemon.ts";
import { Alert } from "../../ui/alert.tsx";
import { Button } from "../../ui/button.tsx";
import { useItem } from "../context.tsx";
import type { ItemSection } from "../parts.ts";
import { useStack } from "../stack.ts";

function Base() {
  const { item, where, busy, run } = useItem();
  const r = useStack();
  const s = r.data;
  const base = item.base;
  if (!base) return null;
  const open = item.state === "open";
  const id = `#${where.number}`;
  const gone = s?.base.gone === true;
  const behind = open && !gone ? (s?.base.behindBy ?? 0) : 0;
  const parent = s?.parents.at(-1);

  const change = (to: string) =>
    void run({
      id: `base:${to}`,
      op: "base",
      params: { base: to },
      summary: `${id} の base を ${to} に変える`,
      done: `base を ${to} に変えました`,
      // A deleted branch cannot be the base again.
      ...(!gone && { undo: { op: "base", params: { base }, summary: `${id} の base を ${base} に戻す` } }),
    });
  const into = open ? s?.mergedInto : undefined;
  const moveTo = into && (
    <Button size="xs" onClick={() => change(into)} disabled={busy !== undefined} isLoading={busy === `base:${into}`} loadingText="変えています…">
      base を {into} に変える
    </Button>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="w-10 shrink-0 text-muted-foreground">base</span>
        <span className={cn("font-mono break-all", gone && "text-muted-foreground line-through")}>{base}</span>
        {open && <BasePicker current={base} head={item.head} first={s?.defaultBranch} disabled={busy !== undefined} onPick={change} />}
        {behind > 0 && (
          <>
            <span className="text-amber-700 dark:text-amber-400">base より {behind.toLocaleString()} commit 遅れています</span>
            <Button
              size="xs"
              onClick={() =>
                void run({
                  id: "update-branch",
                  op: "update-branch",
                  params: {},
                  summary: `${id} に base（${base}）を取り込む`,
                  done: "base を取り込みました。worktree には git pull で入ります",
                })
              }
              disabled={busy !== undefined}
              isLoading={busy === "update-branch"}
              loadingText="取り込んでいます…"
              title="Update branch：GitHub で base をこの Pull request のブランチにマージする"
            >
              base を取り込む
            </Button>
          </>
        )}
        {r.error && <span className="text-red-600 dark:text-red-400">（親と子・base との差を読めませんでした：{r.error}）</span>}
      </div>
      {gone && (
        <Alert tone="warning" action={moveTo}>
          base のブランチ <span className="font-mono">{base}</span> はもうありません。
          {parent?.state === "merged" && `親の #${parent.number} はマージされています。`}
          {open && !into && "上の「base を変える」から選び直してください。"}
        </Alert>
      )}
      {!gone && into && parent?.state === "merged" && (
        <Alert action={moveTo}>
          親の #{parent.number} はマージされています。マージ先の <span className="font-mono">{into}</span> を base にできます。
        </Alert>
      )}
    </div>
  );
}

/** A pencil that opens the branches GitHub finds by the name typed (the default branch first); picking one changes the base. */
function BasePicker({ current, head, first, disabled, onPick }: { current: string; head?: string; first?: string; disabled: boolean; onPick: (branch: string) => void }) {
  const { machine, where } = useItem();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setAsked(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  const r = useRequest<{ names: string[]; more: boolean }>(open ? readOp(machine, "branches", { repo: where.repo, query: asked }) : undefined, { staleSeconds: 30 });
  const names = r.data?.names.filter((n) => n !== current && n !== head).sort((a, b) => Number(b === first) - Number(a === first));
  const close = () => {
    setOpen(false);
    setQuery("");
    setAsked("");
  };
  const pick = (branch: string) => {
    close();
    onPick(branch);
  };
  return (
    <Popover
      label="base を変える"
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      trigger={
        <Button variant="ghost" size="icon" disabled={disabled} aria-label="base を変える" title="base を変える">
          <Pencil />
        </Button>
      }
      className="w-72 p-1"
    >
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          // Only from the branches of what is typed now, not of what was typed before.
          const top = asked === query.trim() ? names?.[0] : undefined;
          if (e.key === "Enter" && top) {
            e.preventDefault();
            pick(top);
          }
        }}
        placeholder="ブランチの名前で探す"
        aria-label="base にするブランチ：名前で探す"
        className="mb-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus:border-border-hover"
      />
      <div className="max-h-64 overflow-y-auto">
        {r.error && <p className="px-2 py-1.5 text-xs text-red-500 dark:text-red-400">{r.error}</p>}
        {!r.data && !r.error && <p className="px-2 py-1.5 text-xs text-muted-foreground">読み込み中…</p>}
        {names?.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">{asked ? `「${asked}」を名前に含むブランチがありません。` : "ほかのブランチがありません。"}</p>}
        {names?.map((n) => (
          <button key={n} type="button" onClick={() => pick(n)} className="flex w-full cursor-pointer items-center rounded-md px-2 py-1.5 text-left font-mono text-xs break-all hover:bg-surface-raised">
            {n}
          </button>
        ))}
        {r.data?.more && <p className="px-2 py-1.5 text-xs text-muted-foreground">ほかにもあります。名前で絞ってください。</p>}
      </div>
    </Popover>
  );
}

export default { order: 36, kinds: ["pulls"], View: Base } satisfies ItemSection;
