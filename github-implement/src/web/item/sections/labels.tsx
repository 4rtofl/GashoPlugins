// The labels, each a Badge in its color with an ×, and a list of the repository's labels with a box that narrows it by
// name. Several are checked and unchecked in a row, and go to GitHub in one edit when the list closes, as on GitHub. A
// name no label has can be made a new label with a color, and put on at once. An Undo Toast can put each change back.
import { Check, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { cn, Popover, useRequest } from "@gasho/plugin-sdk";
import type { RepoMeta } from "../../../types.ts";
import { readOp, useWriteOp } from "../../daemon.ts";
import { Badge } from "../../ui/badge.tsx";
import { Button } from "../../ui/button.tsx";
import { useItem } from "../context.tsx";
import type { ItemSection } from "../parts.ts";
import { Row } from "../row.tsx";

type Label = RepoMeta["labels"][number];

/** The colors GitHub offers for a new label. */
const COLORS = ["b60205", "d93f0b", "fbca04", "0e8a16", "006b75", "1d76db", "0052cc", "5319e7", "e99695", "f9d0c4", "fef2c0", "c2e0c6", "bfdadc", "c5def5", "bfd4f2", "d4c5f9"];
const HEX = /^[0-9a-f]{6}$/i;
const SMALL_INPUT = "w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus:border-border-hover";

const names = (list: string[]) => list.map((n) => `「${n}」`).join("");

function Labels() {
  const { machine, item, where, busy, run } = useItem();
  // The repository's labels and assignable people, and gh's own login (gasho-daemon keeps them for 10 minutes).
  const meta = useRequest<RepoMeta>(readOp(machine, "meta", { repo: where.repo }), { staleSeconds: 300 });
  const id = `#${where.number}`;
  return (
    <Row label="ラベル">
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
      <LabelMenu labels={meta.data?.labels} error={meta.error} reload={meta.reload} disabled={busy !== undefined} />
    </Row>
  );
}

function LabelMenu({ labels, error, reload, disabled }: { labels?: Label[]; error?: string; reload: () => void; disabled: boolean }) {
  const { item, where, run } = useItem();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Checked (true) or unchecked (false) since the list opened.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  // The item's labels when the list opened, listed first: checking one does not move it.
  const [first, setFirst] = useState<Label[]>([]);
  const [making, setMaking] = useState<{ name: string; color: string; description: string }>();

  const has = (name: string) => item.labels.some((l) => l.name === name);
  const isOn = (name: string) => toggled.get(name) ?? has(name);
  const toggle = (name: string) => setToggled((t) => new Map(t).set(name, !isOn(name)));
  const adding = [...toggled].filter(([n, on]) => on && !has(n)).map(([n]) => n);
  const removing = [...toggled].filter(([n, on]) => !on && has(n)).map(([n]) => n);

  /** Puts on and takes off what was checked and unchecked, in one edit, with `made` (a label just made) put on too. */
  const apply = (made?: string) => {
    const add = made && !adding.includes(made) ? [...adding, made] : adding;
    const remove = removing;
    if (add.length === 0 && remove.length === 0) return;
    const what = [add.length > 0 && `${names(add)}を付ける`, remove.length > 0 && `${names(remove)}を外す`].filter(Boolean).join("、");
    const back = [remove.length > 0 && `${names(remove)}を付け直す`, add.length > 0 && `${names(add)}を外す`].filter(Boolean).join("、");
    const done =
      made && add.length === 1 && remove.length === 0
        ? `ラベル「${made}」を作って付けました`
        : `ラベル${[made && `「${made}」を作り`, add.length > 0 && `${names(add)}を付け`, remove.length > 0 && `${names(remove)}を外し`].filter(Boolean).join("、")}ました`;
    void run({
      id: "labels",
      op: "edit",
      params: { addLabels: add, removeLabels: remove },
      summary: `#${where.number} のラベルを変える（${what}）`,
      done,
      undo: { op: "edit", params: { addLabels: remove, removeLabels: add }, summary: `#${where.number} のラベルを戻す（${back}）` },
    });
  };

  const close = (send: boolean, made?: string) => {
    setOpen(false);
    if (send) apply(made);
    setQuery("");
    setToggled(new Map());
    setMaking(undefined);
  };

  const q = query.trim().toLowerCase();
  const all = labels && [...first, ...labels.filter((l) => !first.some((f) => f.name === l.name))];
  const shown = all?.filter((l) => !q || l.name.toLowerCase().includes(q));
  const canMake = labels !== undefined && q !== "" && !labels.some((l) => l.name.toLowerCase() === q);
  const startMaking = () => setMaking({ name: query.trim(), color: COLORS[Math.floor(Math.random() * COLORS.length)] ?? "ededed", description: "" });
  const changes = adding.length + removing.length;

  return (
    <Popover
      label="ラベルを付け外しする"
      open={open}
      onOpenChange={(next) => {
        if (!next) return close(true);
        setFirst(item.labels);
        setOpen(true);
      }}
      trigger={
        <Button variant="ghost" size="icon" disabled={disabled} aria-label="ラベルを付け外しする" title="ラベルを付け外しする">
          <Plus />
        </Button>
      }
      className="w-72 p-1"
    >
      {making ? (
        <NewLabelForm
          draft={making}
          onChange={setMaking}
          taken={labels?.some((l) => l.name.toLowerCase() === making.name.trim().toLowerCase()) ?? false}
          onBack={() => setMaking(undefined)}
          onMade={(name) => {
            reload();
            close(true, name);
          }}
        />
      ) : (
        <>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              const top = shown?.[0];
              if (top) toggle(top.name);
              else if (canMake) startMaking();
            }}
            placeholder="名前で探す・新しく作る"
            aria-label="ラベルを名前で探す"
            className={cn(SMALL_INPUT, "mb-1")}
          />
          <div className="max-h-64 overflow-y-auto" role="group" aria-label="ラベル">
            {error && <p className="px-2 py-1.5 text-xs text-red-500 dark:text-red-400">{error}</p>}
            {!labels && !error && <p className="px-2 py-1.5 text-xs text-muted-foreground">読み込み中…</p>}
            {labels && shown?.length === 0 && !canMake && <p className="px-2 py-1.5 text-xs text-muted-foreground">{q ? `「${query}」に合うラベルがありません。` : "ラベルがありません。"}</p>}
            {shown?.map((l) => {
              const on = isOn(l.name);
              return (
                <button
                  key={l.name}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(l.name)}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-raised"
                >
                  <span aria-hidden className={cn("grid size-3.5 shrink-0 place-items-center rounded-[4px] border", on ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                    {on && <Check className="size-3" />}
                  </span>
                  <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: l.color ? `#${l.color}` : "var(--color-muted-foreground)" }} />
                  <span className="min-w-0 truncate">{l.name}</span>
                </button>
              );
            })}
            {canMake && (
              <button type="button" onClick={startMaking} className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-raised">
                <Plus className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">「{query.trim()}」を新しく作る</span>
              </button>
            )}
          </div>
          {changes > 0 && (
            <div className="mt-1 flex items-center justify-between gap-2 border-t border-border px-1 pt-1.5">
              <span className="text-[11px] text-muted-foreground">閉じると {changes} 件を反映</span>
              <div className="flex gap-1">
                <Button size="xs" variant="ghost" onClick={() => close(false)}>
                  やめる
                </Button>
                <Button size="xs" variant="primary" onClick={() => close(true)}>
                  反映する
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </Popover>
  );
}

/** The name, color and description of a new label; it is made on GitHub, then `onMade` puts it on. */
function NewLabelForm({
  draft,
  onChange,
  taken,
  onBack,
  onMade,
}: {
  draft: { name: string; color: string; description: string };
  onChange: (d: { name: string; color: string; description: string }) => void;
  taken: boolean;
  onBack: () => void;
  onMade: (name: string) => void;
}) {
  const { machine, where } = useItem();
  const write = useWriteOp();
  const [making, setMaking] = useState(false);
  const [error, setError] = useState<string>();
  const name = draft.name.trim();
  const problem = !name ? "名前を入れてください。" : /[,\n\r]/.test(name) ? "名前に「,」は使えません。" : taken ? `「${name}」はもうあります。` : !HEX.test(draft.color) ? "色は 16 進数 6 桁で入れてください（例: 1d76db）。" : undefined;

  const make = async (e: FormEvent) => {
    e.preventDefault();
    if (problem || making) return;
    setMaking(true);
    setError(undefined);
    const description = draft.description.trim();
    const res = await write(machine, "create-label", { repo: where.repo, name, color: draft.color, ...(description ? { description } : {}) }, `${where.repo} にラベル「${name}」を作る`);
    setMaking(false);
    if (res.ok) onMade(name);
    else setError(res.error);
  };

  return (
    <form onSubmit={(e) => void make(e)} className="space-y-2 p-1" aria-label="新しいラベル">
      <p className="text-xs font-medium">新しいラベル</p>
      <input autoFocus value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} maxLength={50} aria-label="ラベルの名前" placeholder="名前" className={SMALL_INPUT} />
      <input value={draft.description} onChange={(e) => onChange({ ...draft, description: e.target.value })} maxLength={100} aria-label="ラベルの説明" placeholder="説明（なくてよい）" className={SMALL_INPUT} />
      <div role="radiogroup" aria-label="ラベルの色" className="flex flex-wrap gap-1.5">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={draft.color.toLowerCase() === c}
            aria-label={`#${c}`}
            title={`#${c}`}
            onClick={() => onChange({ ...draft, color: c })}
            style={{ backgroundColor: `#${c}` }}
            className={cn("size-5 cursor-pointer rounded-full border border-black/10 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:border-white/15", draft.color.toLowerCase() === c && "ring-2 ring-foreground ring-offset-1 ring-offset-surface")}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">#</span>
        <input value={draft.color} onChange={(e) => onChange({ ...draft, color: e.target.value.replace(/^#/, "").trim() })} maxLength={6} aria-label="色（16 進数 6 桁）" className={cn(SMALL_INPUT, "w-20 font-mono")} />
        <Badge variant="outline" dot={HEX.test(draft.color) ? `#${draft.color}` : true} className="min-w-0">
          <span className="truncate">{name || "ラベル"}</span>
        </Badge>
      </div>
      {(error ?? (name && problem)) && <p className="text-xs break-words text-red-500 dark:text-red-400">{error ?? problem}</p>}
      <div className="flex justify-end gap-1.5">
        <Button size="xs" variant="ghost" onClick={onBack} disabled={making}>
          戻る
        </Button>
        <Button size="xs" variant="primary" type="submit" isLoading={making} loadingText="作っています…" disabled={problem !== undefined}>
          作って付ける
        </Button>
      </div>
    </form>
  );
}

export default { order: 30, kinds: ["issues", "pulls"], place: "row", View: Labels } satisfies ItemSection;
