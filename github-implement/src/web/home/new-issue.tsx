// The "GitHub" tab's form for a new issue: title, body, labels and assignees from the repository's (the pickers of an
// item's screen), and whether to add it to the worktree, which makes it a tab beside the sessions.
import { CirclePlus } from "lucide-react";
import { useState } from "react";
import { useRequest, type WorktreeInfo } from "@gasho/plugin-sdk";
import type { RepoMeta } from "../../types.ts";
import { readOp, useWriteOp } from "../daemon.ts";
import { assignableSearch, labelSearch, Picker, type Choice } from "../item/picker.tsx";
import { Alert } from "../ui/alert.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { INPUT } from "../ui/input.ts";
import { useToast } from "../ui/toast.tsx";

type Label = RepoMeta["labels"][number];

interface Form {
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
  add: boolean;
}

const EMPTY: Form = { title: "", body: "", labels: [], assignees: [], add: true };

export function NewIssueBox({ machine, worktree, repo, onCreated }: { machine: string; worktree: WorktreeInfo; repo: string; onCreated: () => void }) {
  const [form, setForm] = useState<Form>();
  const meta = useRequest<RepoMeta>(form ? readOp(machine, "meta", { repo }) : undefined, { staleSeconds: 300 });
  const write = useWriteOp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (!form) {
    return (
      <Button
        leftIcon={<CirclePlus />}
        onClick={() => {
          setForm(EMPTY);
          setError(undefined);
        }}
      >
        Issue を起票する
      </Button>
    );
  }

  const create = async () => {
    setBusy(true);
    setError(undefined);
    const params = { repo, title: form.title, body: form.body, labels: form.labels, assignees: form.assignees, ...(form.add ? { worktree: worktree.path } : {}) };
    const res = await write(machine, "create-issue", params, `${repo} に Issue「${form.title}」を起票する`);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const n = (res.data as { number?: number } | undefined)?.number;
    toast({ title: n ? `Issue #${n} を起票しました` : "Issue を起票しました", description: form.title });
    setForm(undefined);
    onCreated();
  };

  const colors = new Map(meta.data?.labels.map((l) => [l.name, l.color]));
  const me = meta.data?.me;
  const labelChoice = (l: Label): Choice | undefined =>
    form.labels.includes(l.name)
      ? undefined
      : {
          key: l.name,
          name: l.name,
          text: (
            <span className="inline-flex items-center gap-1.5">
              {l.color && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: `#${l.color}` }} />}
              {l.name}
            </span>
          ),
          pick: () => setForm((f) => f && { ...f, labels: [...f.labels, l.name] }),
        };
  const assigneeChoice = (a: string): Choice | undefined => (form.assignees.includes(a) ? undefined : { key: a, name: a, text: <span>{a}</span>, pick: () => setForm((f) => f && { ...f, assignees: [...f.assignees, a] }) });
  return (
    <form
      aria-label="Issue を起票する"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
      className="space-y-2 rounded-xl border border-border p-3"
    >
      <p className="text-sm font-medium">Issue を起票する</p>
      <input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-label="Issue の題" placeholder="題" maxLength={256} className={INPUT} />
      <textarea
        value={form.body}
        onChange={(e) => setForm({ ...form, body: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && form.title.trim() && !busy) {
            e.preventDefault();
            void create();
          }
        }}
        aria-label="Issue の本文"
        placeholder="本文（Markdown。⌘ + Enter で起票する）"
        rows={6}
        className={INPUT}
      />
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="w-10 shrink-0 text-muted-foreground">ラベル</span>
        {form.labels.map((l) => {
          const color = colors.get(l);
          return (
            <Badge key={l} variant="outline" dot={color ? `#${color}` : true} removeLabel={`ラベル「${l}」を外す`} onRemove={() => setForm({ ...form, labels: form.labels.filter((x) => x !== l) })}>
              {l}
            </Badge>
          );
        })}
        {form.labels.length === 0 && <span className="text-muted-foreground">なし</span>}
        <Picker
          label="ラベルを付ける"
          error={meta.error}
          disabled={busy}
          choices={meta.data?.labels.flatMap((l) => labelChoice(l) ?? [])}
          {...(meta.data?.labelsMore && { search: labelSearch(machine, repo, labelChoice) })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="w-10 shrink-0 text-muted-foreground">担当</span>
        {form.assignees.map((a) => (
          <Badge key={a} variant="outline" removeLabel={`${a} を担当から外す`} onRemove={() => setForm({ ...form, assignees: form.assignees.filter((x) => x !== a) })}>
            {a}
          </Badge>
        ))}
        {form.assignees.length === 0 && <span className="text-muted-foreground">なし</span>}
        {me && !form.assignees.includes(me) && (
          <Button size="xs" variant="ghost" onClick={() => setForm({ ...form, assignees: [...form.assignees, me] })} disabled={busy}>
            自分を担当にする
          </Button>
        )}
        <Picker
          label="担当を足す"
          error={meta.error}
          disabled={busy}
          choices={meta.data?.assignable.flatMap((a) => assigneeChoice(a) ?? [])}
          {...(meta.data?.assignableMore && { search: assignableSearch(machine, repo, assigneeChoice) })}
        />
      </div>
      <label className="flex items-center gap-1.5 text-xs">
        <input type="checkbox" checked={form.add} onChange={(e) => setForm({ ...form, add: e.target.checked })} />
        この worktree に足す（タブに出す）
      </label>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button onClick={() => setForm(undefined)} disabled={busy}>
          やめる
        </Button>
        <Button type="submit" variant="primary" disabled={!form.title.trim()} isLoading={busy} loadingText="起票しています…">
          起票する
        </Button>
      </div>
    </form>
  );
}
