// Chooses the repositories each working server's kanban watches (moved here from Gasho's views/kanban.tsx of PR #8). The
// daemon part of each working server offers the repositories in the folders Gasho can start sessions in, and keeps
// the ones chosen in its own folder.
import { ChevronDown, Search, Server, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import { cn, useCall, useRequest, type MachineInfo } from "@gasho/plugin-sdk";
import { MAX_REPOS, type Board, type RepoOption } from "../types.ts";
import { Button, DrawCheckbox } from "./ui/parts";
import { DIALOG_OVERLAY, DIALOG_PANEL } from "./ui/styles";

export function ReposDialog({
  open,
  onClose,
  machines,
  watched,
  reload,
}: {
  open: boolean;
  onClose: () => void;
  /** The working servers whose daemon part runs. */
  machines: MachineInfo[];
  /** What each one watches now; undefined until its board has been read. */
  watched: (machine: string) => string[] | undefined;
  /** Reads a working server's board again. */
  reload: (machine: string) => void;
}) {
  const call = useCall();
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [query, setQuery] = useState("");
  const [others, setOthers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const known = machines.flatMap((m) => (watched(m.id) ? [m.id] : [])).join("\n");
  useEffect(() => {
    if (!open) return;
    // Only when it opens: what is ticked stays while the machines change.
    setPicked(Object.fromEntries(machines.flatMap((m) => (watched(m.id) ? [[m.id, watched(m.id) ?? []]] : []))));
    setQuery("");
    setOthers(false);
    setError(undefined);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    // A working server whose board arrives while this is open starts from what it watches, so saving does not empty it.
    setPicked((cur) => {
      const added = machines.filter((m) => !(m.id in cur) && watched(m.id));
      return added.length === 0 ? cur : { ...cur, ...Object.fromEntries(added.map((m) => [m.id, watched(m.id) ?? []])) };
    });
  }, [open, known]);

  const toggle = (machine: string, p: string) =>
    setPicked((cur) => {
      const list = cur[machine] ?? [];
      return { ...cur, [machine]: list.includes(p) ? list.filter((x) => x !== p) : [...list, p] };
    });
  const save = async () => {
    const changed = machines.filter((m) => picked[m.id] && JSON.stringify(picked[m.id]) !== JSON.stringify(watched(m.id)));
    if (changed.length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError(undefined);
    const results = await Promise.all(
      changed.map((m) => {
        const paths = picked[m.id] ?? [];
        return call<Board>({ machine: m.id, method: "watch", params: { paths }, summary: `見る repo を ${paths.length} 個にする` });
      }),
    );
    for (const m of changed) reload(m.id);
    setSaving(false);
    const failed = results.flatMap((r, i) => (r.ok ? [] : [`${changed[i]?.name ?? ""}：${r.error}`]));
    if (failed.length > 0) setError(failed.join("\n"));
    else onClose();
  };
  const q = query.trim().toLowerCase();
  const chosen = Object.values(picked).reduce((n, l) => n + l.length, 0);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={DIALOG_OVERLAY} />
        <Dialog.Content className={cn(DIALOG_PANEL, "flex w-[min(36rem,calc(100vw-2rem))] flex-col gap-4")}>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <Dialog.Title className="text-base font-semibold tracking-tight">見る repo</Dialog.Title>
              <Dialog.Description className="text-xs leading-relaxed text-muted-foreground">
                選んだ repo の worktree と自分の PR を、カンバンを開いているあいだ、working server の gh で 1 分おきに読みます。working server ごとに {MAX_REPOS}{" "}
                個まで選べます。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="閉じる">
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm transition-colors focus-within:border-border-hover">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="repo の名前やフォルダーで絞り込む"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
              spellCheck={false}
            />
          </label>

          {machines.map((m) => (
            <MachineRepos
              key={m.id}
              machine={m}
              list={picked[m.id]}
              query={q}
              others={others}
              onOthers={() => setOthers(!others)}
              onToggle={(p) => toggle(m.id, p)}
            />
          ))}

          {error && <p className="text-xs whitespace-pre-line text-red-400">{error}</p>}
          <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
            <span className="text-xs text-muted-foreground tabular-nums">{chosen} 個の repo を見る</span>
            <div className="flex gap-2">
              <Dialog.Close asChild>
                <Button size="sm">キャンセル</Button>
              </Dialog.Close>
              <Button size="sm" variant="primary" isLoading={saving} loadingText="保存中…" onClick={() => void save()}>
                保存
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The repositories one working server offers, with the ones it watches ticked. */
function MachineRepos({
  machine,
  list,
  query,
  others,
  onOthers,
  onToggle,
}: {
  machine: MachineInfo;
  /** What is ticked; undefined until the board has been read. */
  list: string[] | undefined;
  query: string;
  others: boolean;
  onOthers: () => void;
  onToggle: (path: string) => void;
}) {
  // Read again whenever the dialog opens (the daemon part keeps the list for 30 seconds).
  const r = useRequest<RepoOption[]>({ machine: machine.id, method: "options" }, { staleSeconds: 0 });
  const options = r.data ?? [];
  const ticked = list ?? [];
  const matches = (text: string) => !query || text.toLowerCase().includes(query);
  const onGitHub = options.filter((o) => o.github && matches(`${o.github} ${o.path}`));
  const elsewhere = options.filter((o) => !o.github && !ticked.includes(o.path) && matches(o.path));
  // Chosen before, but no longer among the options on GitHub: shown first so they can be taken off.
  const gone = r.data ? ticked.filter((p) => !options.some((o) => o.path === p && o.github) && matches(p)) : [];
  const waiting = !list || (!r.data && r.loading);
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-xs font-medium text-neutral-700 dark:text-neutral-300">
        <Server className="size-3.5 text-muted-foreground" />
        {machine.name}
        <span className="ml-auto text-[11px] font-normal text-muted-foreground tabular-nums">
          {ticked.length} / {MAX_REPOS} を選択中
        </span>
      </h3>
      <ul className="max-h-[45dvh] divide-y divide-black/[0.05] overflow-y-auto rounded-xl border border-border dark:divide-white/[0.05]">
        {gone.map((p) => (
          <li key={p} className="px-3 py-2.5">
            <DrawCheckbox
              checked
              onChange={() => onToggle(p)}
              label={<span className="text-amber-700 dark:text-amber-300">{options.some((o) => o.path === p) ? "GitHub にない repo" : "見つからない repo"}</span>}
              description={<span className="font-mono break-all">{p}</span>}
            />
          </li>
        ))}
        {!waiting &&
          onGitHub.map((o) => {
            const checked = ticked.includes(o.path);
            const [owner, name] = (o.github ?? "").split("/");
            return (
              <li key={o.path} className="px-3 py-2.5 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                <DrawCheckbox
                  checked={checked}
                  disabled={!checked && ticked.length >= MAX_REPOS}
                  onChange={() => onToggle(o.path)}
                  label={
                    <>
                      <span className="text-muted-foreground">{owner}/</span>
                      <span className="font-medium">{name}</span>
                    </>
                  }
                  description={<span className="font-mono break-all">{o.path}</span>}
                />
              </li>
            );
          })}
        {(waiting || gone.length + onGitHub.length === 0) && (
          <li className="px-3 py-6 text-center text-xs text-muted-foreground">
            {waiting ? "読み込み中…" : r.error ? r.error : query ? "一致する repo がありません。" : "選べる repo がありません。"}
          </li>
        )}
      </ul>
      {!waiting && elsewhere.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <button type="button" onClick={onOthers} aria-expanded={others} className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground">
            <ChevronDown className={cn("size-3.5 transition-transform", others && "rotate-180")} />
            GitHub にない repo（{elsewhere.length}）
          </button>
          {others && (
            <ul className="mt-1.5 space-y-0.5 pl-5 font-mono text-[11px]">
              <li className="font-sans">origin が GitHub にないので、選べません。</li>
              {elsewhere.map((o) => (
                <li key={o.path} className="break-all">
                  {o.path}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
